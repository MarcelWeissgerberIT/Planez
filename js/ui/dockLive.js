// Lebendige rechte Leiste: Mini-Radar „Luftlage“ (Ringe, Bahn, umlaufender Strahl, nachleuchtende Echos), Spotlight-
// Karte mit Fotos zum Verkehr am Platz (nächste Landung, Abfertigung, Start – weich überblendet, langsam bewegt),
// Verlaufslinien für die Kennzahlen und Bilder zu Aufgaben und Baustellen.
import { AC_TYPES, AIRLINES, CITIES, NM_PER_TILE, typeName } from '../config.js';
import * as LY from '../layout.js';
import * as AS from '../sim/airspace.js';
import { PH } from '../sim/aircraft.js';
import { esc, fmtClock } from '../util.js';
import { isCareer, stageOf } from '../sim/career.js';
import { stagePic } from './careerUi.js';
import { T } from '../i18n.js';

const SP = (k) => `assets/spot/${k}.webp`;
const CAT = (type) => (AC_TYPES[type] || {}).sprite || 'plane_narrow';
// Foto je Bauart und Lage (Anflug, am Boden, Start)
const PIC = {
  arr: { plane_ga: 'light_final', plane_ga2: 'light_final', plane_tp: 'tp_landing', plane_prop: 'tp_landing', plane_bizjet: 'bizjet', plane_narrow: 'narrow_takeoff', plane_wide: 'wide_landing', plane_cargo: 'wide_landing', plane_super: 'super' },
  stand: { plane_ga: 'light_ground', plane_ga2: 'light_ground', plane_tp: 'apron_small', plane_prop: 'apron_small', plane_bizjet: 'bizjet', plane_narrow: 'narrow_gate', plane_wide: 'narrow_gate', plane_cargo: 'cargo_night', plane_super: 'super' },
  dep: { plane_ga: 'light_ground', plane_ga2: 'light_ground', plane_tp: 'tp_landing', plane_prop: 'tp_landing', plane_bizjet: 'bizjet', plane_narrow: 'narrow_takeoff', plane_wide: 'narrow_takeoff', plane_cargo: 'cargo_night', plane_super: 'super' },
};
const picUrl = (k) => (k === 'apron_small' ? 'assets/career/apron_small.webp' : SP(k));
const night = (s) => {
  const h = (s.time / 3600) % 24;
  return h < 5.5 || h > 21;
};
const ARR = new Set([PH.INBOUND, PH.HOLD, PH.APPROACH, PH.FINAL, PH.ROLLOUT]);
const DEP = new Set([PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF, PH.DEPART]);

// ---------- Spotlight ----------
function etaMin(ac) {
  if (ac.mode === 'map') return 0;
  const d = AS.routeDistance(ac.pos, ac.route && ac.route.length ? ac.route : [AS.THR[ac.rwy]]);
  return Math.max(1, Math.round((d / Math.max(80, ac.spd || 180)) * 60));
}
function who(s, ac) {
  const r = s.rots[ac.rot] || {};
  const al = AIRLINES[ac.airline || r.airline] || {};
  const t = AC_TYPES[ac.type] || {};
  const city = r.city && CITIES[r.city] ? CITIES[r.city].name : '';
  return { al, t, r, city };
}
function slideFor(s, ac) {
  const { al, t, r, city } = who(s, ac);
  const sp = r.special;
  const tag = sp === 'a380' ? T('Sonderbesuch') : sp === 'vip' ? T('VIP-Flug') : sp === 'state' ? T('Staatsbesuch') : al.partner ? al.name : al.ga ? T('Gastflieger') : al.name || '';
  if (ARR.has(ac.phase)) {
    const m = etaMin(ac);
    const kick = ac.phase === PH.ROLLOUT ? T('Gelandet') : ac.phase === PH.FINAL ? T('Im Endanflug') : ac.phase === PH.HOLD ? T('In der Warteschleife') : T('Im Anflug');
    return { key: 'a' + ac.id, kind: 'arr', pic: PIC.arr[CAT(ac.type)], kick, title: ac.cs, tag, sub: `${typeName(ac.type)}${city ? T(' · aus ') + city : ''}`, live: ac.phase === PH.ROLLOUT ? T('rollt aus') : ac.phase === PH.FINAL ? T('gleich am Boden') : T`Landung in ~${m} min`, ac: ac.id };
  }
  if (ac.phase === PH.STAND || ac.phase === PH.PUSH || ac.phase === PH.STARTUP || ac.phase === PH.TAXI_IN) {
    const ta = ac.ta && ac.ta.tasks ? Object.values(ac.ta.tasks) : [];
    const done = ta.filter((x) => x.st === 'done').length;
    const st = s.stands.find((x) => x.id === ac.stand);
    const pos = st ? (st.ga ? T`Wiese W${s.stands.filter((x) => x.ga).indexOf(st) + 1}` : T`Position P${st.id}`) : '';
    const kick = ac.phase === PH.TAXI_IN ? T('Rollt zur Position') : ac.phase === PH.PUSH ? T('Pushback') : ac.phase === PH.STARTUP ? T('Triebwerke an') : T('Abfertigung');
    const live = ac.phase === PH.STAND && ta.length ? T`${done}/${ta.length} Schritte${r.std ? T(' · Abflug ') + fmtClock(r.std) : ''}` : r.std ? T('Abflug ') + fmtClock(r.std) : '';
    return { key: 's' + ac.id, kind: 'stand', pic: night(s) && !AC_TYPES[ac.type]?.light ? 'apron_night' : PIC.stand[CAT(ac.type)], kick, title: ac.cs, tag, sub: `${typeName(ac.type)}${pos ? ' · ' + pos : ''}`, live, prog: ta.length ? done / ta.length : null, ac: ac.id };
  }
  if (DEP.has(ac.phase)) {
    const kick = ac.phase === PH.TAKEOFF ? T('Startlauf') : ac.phase === PH.DEPART ? T('Im Steigflug') : ac.phase === PH.LINEUP || ac.phase === PH.LINED ? T('Auf der Piste') : T('Rollt zum Start');
    return { key: 'd' + ac.id, kind: 'dep', pic: PIC.dep[CAT(ac.type)], kick, title: ac.cs, tag, sub: `${typeName(ac.type)}${city ? T(' · nach ') + city : ''}`, live: T`Bahn ${ac.rwy || s.rwy}`, ac: ac.id };
  }
  return null;
}
function ambient(s) {
  const next = Object.values(s.rots).filter((r) => r.sta && r.sta > s.time).sort((a, b) => a.sta - b.sta)[0];
  const pic = night(s) ? SP('apron_night') : isCareer(s) ? stagePic(stageOf(s)) : SP('narrow_gate');
  return { key: 'amb', kind: 'amb', url: pic, kick: night(s) ? T('Nachtruhe') : T('Ruhige Minute'), title: s.name, tag: '', sub: next ? T`Nächste Ankunft ${fmtClock(next.sta)}` : T('Kein Verkehr angemeldet'), live: '' };
}

export class Spotlight {
  constructor(el, game) {
    this.el = el;
    this.game = game;
    this.i = 0;
    this.cur = null;
    this.next = 0;
    this.flip = false;
    el.innerHTML = `<div class="sl-img a"></div><div class="sl-img b"></div><div class="sl-shade"></div>
      <div class="sl-t"><small class="sl-kick"></small><b class="sl-title"></b><span class="sl-sub"></span><span class="sl-live"></span></div>
      <span class="sl-tag"></span><div class="sl-prog"><i></i></div><div class="sl-run"><i></i></div>`;
    this.A = el.querySelector('.sl-img.a');
    this.B = el.querySelector('.sl-img.b');
    el.addEventListener('click', () => {
      const s = this.game.state;
      const ac = this.cur && this.cur.ac && s && s.acs.find((a) => a.id === this.cur.ac);
      if (ac && this.game.select) this.game.select(ac.id, true);
    });
  }
  candidates(s) {
    const list = [];
    for (const ac of s.acs) {
      const sl = slideFor(s, ac);
      if (sl && !(ac.mode === 'air' && sl.kind === 'dep' && ac.phase === PH.DEPART && (ac.alt || 0) > 6000)) list.push(sl);
    }
    // Sonderflüge zuerst, dann Abwechslung zwischen Anflug, Abfertigung, Start
    const rank = (x) => (x.tag === T('Sonderbesuch') || x.tag === T('VIP-Flug') || x.tag === T('Staatsbesuch') ? 0 : 1);
    list.sort((a, b) => rank(a) - rank(b));
    return list;
  }
  update(s, now = performance.now()) {
    if (!s) return;
    const list = this.candidates(s);
    // laufende Folie aktuell halten (Text live), nach 8 s weiter
    let slide = this.cur && list.find((x) => x.key === this.cur.key);
    if (!slide || now >= this.next) {
      if (list.length) {
        const kinds = ['arr', 'stand', 'dep'];
        const want = kinds[this.i++ % 3];
        const pool = list.filter((x) => x.kind === want && (!this.cur || x.key !== this.cur.key));
        slide = (pool.length ? pool : list.filter((x) => !this.cur || x.key !== this.cur.key))[0] || list[0];
      } else slide = ambient(s);
      if (!this.cur || slide.key !== this.cur.key) this.show(slide);
      this.next = now + 8000;
    }
    this.cur = slide;
    this.text(slide);
  }
  show(sl) {
    const url = sl.url || picUrl(sl.pic);
    const [on, off] = this.flip ? [this.A, this.B] : [this.B, this.A];
    this.flip = !this.flip;
    if (this.lastUrl !== url) {
      on.style.backgroundImage = `url(${url})`;
      on.classList.toggle('kb1', Math.random() < 0.5);
      on.classList.add('on');
      off.classList.remove('on');
      this.lastUrl = url;
    }
    const run = this.el.querySelector('.sl-run i');
    run.style.animation = 'none';
    void run.offsetWidth;
    run.style.animation = '';
    this.el.classList.remove('pulse');
    void this.el.offsetWidth;
    this.el.classList.add('pulse');
  }
  text(sl) {
    const q = (c) => this.el.querySelector(c);
    const set = (c, v) => {
      const n = q(c);
      if (n.textContent !== v) n.textContent = v;
    };
    set('.sl-kick', sl.kick);
    set('.sl-title', sl.title);
    set('.sl-sub', sl.sub);
    set('.sl-live', sl.live);
    set('.sl-tag', sl.tag);
    q('.sl-tag').style.display = sl.tag ? '' : 'none';
    const p = q('.sl-prog');
    p.style.display = sl.prog == null ? 'none' : '';
    if (sl.prog != null) q('.sl-prog i').style.width = `${Math.round(sl.prog * 100)}%`;
    this.el.dataset.kind = sl.kind;
  }
}

// ---------- Mini-Radar ----------
export class MiniRadar {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.ang = 0;
    this.last = 0;
    this.seen = new Map(); // id -> {x,y,t} zuletzt vom Strahl erfasst
  }
  fit() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (this.w !== w || this.h !== h || this.dpr !== dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.c.width = w * dpr;
      this.c.height = h * dpr;
    }
  }
  draw(s, t) {
    this.fit();
    const { ctx, w, h } = this;
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
    this.last = t;
    const prev = this.ang;
    this.ang = (this.ang + dt * ((Math.PI * 2) / 3.2)) % (Math.PI * 2);
    const range = isCareer(s) && stageOf(s) < 2 ? 12 : 22;
    const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2;
    const k = (Math.min(w, h) / 2 - 6) / (range * 0.62);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, '#062a22');
    bg.addColorStop(1, '#020c10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // Ringe und Achsen
    ctx.strokeStyle = 'rgba(94,234,212,0.13)';
    ctx.lineWidth = 1;
    ctx.font = '600 8px ui-monospace, Menlo, monospace';
    for (const r of [2.5, 5, 10, 15, 20]) {
      if (r > range * 1.6) break;
      ctx.beginPath();
      ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
      ctx.stroke();
      if (r * k < h / 2 - 4) {
        ctx.fillStyle = 'rgba(94,234,212,0.35)';
        ctx.fillText(`${r}`, cx + 3, cy - r * k - 2);
      }
    }
    ctx.fillStyle = 'rgba(94,234,212,0.5)';
    ctx.fillText('N', cx - 3, 10);
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
    // Anfluglinien und Bahn
    const T9 = AS.THR['09'], T27 = AS.THR['27'];
    const act = AS.THR[s.rwy] || T27;
    const dir = s.rwy === '27' ? 1 : -1;
    ctx.strokeStyle = 'rgba(56,189,248,0.25)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(cx + act.x * k, cy + act.y * k);
    ctx.lineTo(cx + (act.x + dir * 12) * k, cy + act.y * k);
    ctx.stroke();
    ctx.setLineDash([]);
    // Bahn als Symbol (mindestens 18 px lang), beleuchtet
    const half = Math.max(9, (Math.abs(T27.x - T9.x) * k) / 2);
    const mx = cx + ((T9.x + T27.x) / 2) * k;
    ctx.strokeStyle = 'rgba(226,232,240,0.25)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(mx - half, cy);
    ctx.lineTo(mx + half, cy);
    ctx.stroke();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(mx - half, cy);
    ctx.lineTo(mx + half, cy);
    ctx.stroke();
    // umlaufender Strahl mit Nachleuchten
    const g = ctx.createConicGradient ? ctx.createConicGradient(this.ang - 0.9, cx, cy) : null;
    if (g) {
      g.addColorStop(0, 'rgba(45,212,191,0)');
      g.addColorStop(0.14, 'rgba(45,212,191,0.22)');
      g.addColorStop(0.1433, 'rgba(45,212,191,0)');
      g.addColorStop(1, 'rgba(45,212,191,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = 'rgba(94,234,212,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.ang) * R, cy + Math.sin(this.ang) * R);
    ctx.stroke();
    // Echos: erfasst, wenn der Strahl darüberstreicht; verblassen bis zum nächsten Umlauf
    const now = t / 1000;
    const inSweep = (a) => {
      const d = (a - prev + Math.PI * 4) % (Math.PI * 2);
      const span = (this.ang - prev + Math.PI * 4) % (Math.PI * 2);
      return d <= span;
    };
    const live = new Set();
    let nArr = 0, nDep = 0;
    for (const ac of s.acs) {
      let x, y;
      if (ac.mode === 'air' && ac.pos) (x = ac.pos.x), (y = ac.pos.y);
      else if (ac.mode === 'map' && (ac.phase === PH.FINAL || ac.phase === PH.TAKEOFF || ac.phase === PH.DEPART)) (x = (ac.x - LY.ARP.x) * NM_PER_TILE), (y = (ac.y - LY.ARP.y) * NM_PER_TILE);
      else continue;
      if (ac.arr) nArr++;
      else nDep++;
      live.add(ac.id);
      const a = Math.atan2(y, x);
      const e = this.seen.get(ac.id);
      if (!e) this.seen.set(ac.id, { x, y, t: now, ac, trail: [] });
      else if (inSweep((a + Math.PI * 2) % (Math.PI * 2))) {
        e.trail.unshift({ x: e.x, y: e.y });
        if (e.trail.length > 5) e.trail.pop();
        Object.assign(e, { x, y, t: now, ac });
      } else e.ac = ac;
    }
    for (const [id, e] of this.seen) {
      if (!live.has(id)) {
        this.seen.delete(id);
        continue;
      }
      const age = Math.min(1, (now - e.t) / 3.2);
      const sx = cx + e.x * k, sy = cy + e.y * k;
      if (sx < -10 || sy < -10 || sx > w + 10 || sy > h + 10) continue;
      const ac = e.ac;
      const emg = ac.emergency;
      const light = AC_TYPES[ac.type] && AC_TYPES[ac.type].light;
      const col = emg ? '248,113,113' : ac.arr ? (light ? '134,239,172' : '103,232,249') : '251,191,36';
      const alpha = 1 - age * 0.75;
      // Spur: frühere Echos, blasser
      e.trail.forEach((p, i) => {
        ctx.fillStyle = `rgba(${col},${0.32 - i * 0.06})`;
        ctx.beginPath();
        ctx.arc(cx + p.x * k, cy + p.y * k, 1.3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = `rgba(${col},${alpha * 0.25})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 6 - age * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${col},${alpha})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fill();
      // Kennung für Anflüge in Platznähe
      if (w > 180) {
        ctx.font = '600 9px ui-monospace, Menlo, monospace';
        ctx.fillStyle = `rgba(${col},${0.35 + alpha * 0.6})`;
        ctx.fillText(ac.cs, sx + 5, sy - 4);
      }
    }
    this.counts = { nArr, nDep };
    // Rand-Vignette
    const v = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.35, cx, cy, R);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
}

// ---------- Verlaufslinien ----------
export function sparkPath(vals, W = 100, H = 30) {
  if (!vals || vals.length < 4) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - 3 - ((v - lo) / span) * (H - 8)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="f" d="M0,${H} L${pts.join(' L')} L${W},${H} Z"/><path class="l" d="M${pts.join(' L')}"/></svg>`;
}

// ---------- Bilder zu Aufgaben und Baustellen ----------
export function todoPic(s, key, extra = '') {
  const small = isCareer(s) && stageOf(s) < 2;
  if (key === 'over' && extra) return { fog: 'assets/scn/fog.webp', storm: 'assets/scn/storm.webp', snow: 'assets/scn/winter.webp' }[extra] || '';
  return (
    {
      contracts: small ? 'assets/career/school.webp' : 'assets/menu/marketing.webp',
      stands: small ? 'assets/career/meadow.webp' : 'assets/menu/stand_remote.webp',
      fuel: 'assets/menu/fuel_farm.webp',
      fin: 'assets/scn/rescue.webp',
      runways: LY.RWY.grass ? 'assets/career/grass_mow.webp' : 'assets/menu/rwy_maint.webp',
      fees: 'assets/scn/flytag.webp',
      terminal: 'assets/menu/security.webp',
      career: isCareer(s) ? stagePic(Math.min(4, stageOf(s) + 1)) : '',
      good: isCareer(s) ? stagePic(stageOf(s)) : SP('narrow_gate'),
    }[key] || ''
  );
}
const MENU_PICS = new Set(['retail', 'security', 'lounge', 'parking', 'hotel', 'rwy2', 'ils3', 'rapidExit', 'apronLights', 'solar', 'rail']);
export function sitePic(p) {
  if (p.kind === 'stage') return stagePic(p.target);
  if (p.kind === 'upgrade' && MENU_PICS.has(p.target)) return `assets/menu/${p.target}.webp`;
  if (p.kind === 'rwy') return LY.RWY.grass ? 'assets/career/grass_mow.webp' : 'assets/menu/rwy_maint.webp';
  if (p.kind === 'stand') return 'assets/menu/stand_contact.webp';
  return 'assets/menu/rwy_maint.webp';
}
export const esc2 = esc;
