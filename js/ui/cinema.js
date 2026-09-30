// Kino-Modus: automatische Kamerafahrten zu Landungen, Starts, Abfertigung, Baustellen und Landseite.
// Oberfläche ausgeblendet, Letterbox-Balken und Bildunterschrift. Taste K oder Esc beendet.
import { AC_TYPES, AIRLINES, CITIES, AIRPORT } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { clamp, hourOf, esc } from '../util.js';
import * as LY from '../layout.js';
import { listeners } from '../sim/messages.js';
import { fmtClock, dayOf } from '../util.js';
import { WEATHER } from '../sim/events.js';
import { temperature } from '../sim/winter.js';

const PHASE_SHOT = {
  [PH.FINAL]: 'land',
  [PH.ROLLOUT]: 'land',
  [PH.TAKEOFF]: 'dep',
  [PH.LINED]: 'dep',
  [PH.LINEUP]: 'dep',
  [PH.MISSED]: 'goaround',
  [PH.PUSH]: 'push',
  [PH.TAXI_IN]: 'taxi',
  [PH.TAXI_OUT]: 'taxi',
};

export class Cinema {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.shot = null;
    this.t = 0;
    const el = document.createElement('div');
    el.id = 'cinema';
    el.className = 'hidden';
    el.innerHTML = `<div class="cn-bar top"></div><div class="cn-bar bot"></div>
      <div class="cn-cap"><div class="cn-k"></div><div class="cn-t"></div><div class="cn-s"></div></div>
      <div class="cn-brand">${esc(AIRPORT.name || 'Planez')} · LIVE</div>
      <div class="cn-help">K / Esc beenden · ← → nächste Szene</div>
      <div class="cn-clock"></div><div class="cn-data"></div><div class="cn-sub"></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.cap = { k: el.querySelector('.cn-k'), t: el.querySelector('.cn-t'), s: el.querySelector('.cn-s') };
    el.addEventListener('click', () => this.next(true));
    this.clockEl = el.querySelector('.cn-clock');
    this.dataEl = el.querySelector('.cn-data');
    this.subEl = el.querySelector('.cn-sub');
    // Funkverkehr als Untertitel
    listeners.radio.push((m) => {
      if (!this.on || (m.kind !== 'atc' && m.kind !== 'pilot')) return;
      this.subEl.innerHTML = `<b>${esc(m.from || '')}</b> ${esc(m.text)}`;
      this.subEl.classList.remove('in');
      void this.subEl.offsetWidth;
      this.subEl.classList.add('in');
    });
  }

  toggle() {
    this.on ? this.stop() : this.start();
  }

  start() {
    const s = this.game.state;
    if (!s) return;
    this.on = true;
    this.prevSpeed = s.speed;
    this.prevZoom = this.game.cam.zoom;
    if (s.speed === 0 || s.speed > 2) s.speed = s.role === 'observer' ? 2 : Math.min(s.speed || 1, 2);
    this.prevLabels = this.game.ui.labels;
    this.game.ui.labels = false;
    document.getElementById('game').classList.add('cinema');
    this.el.classList.remove('hidden');
    this.shot = null;
    this.next(true);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    const s = this.game.state;
    if (s && this.prevSpeed !== undefined) s.speed = this.prevSpeed;
    this.game.ui.labels = this.prevLabels !== false;
    document.getElementById('game').classList.remove('cinema');
    this.el.classList.add('hidden');
    this.game.cam.tx = null;
    this.shot = null;
  }

  // Szenen-Kandidaten mit Gewicht
  candidates(s) {
    const out = [];
    const recent = this.recent || [];
    for (const ac of s.acs) {
      if (ac.mode !== 'map') continue;
      const kind = PHASE_SHOT[ac.phase];
      if (!kind) continue;
      if (ac.phase === PH.FINAL && ac.z > 3.5) continue;
      let w = { land: 6, dep: 6, goaround: 9, push: 3, taxi: 1.5 }[kind];
      if (ac.emergency) w += 8;
      if (AC_TYPES[ac.type].size === 'L') w *= 1.6;
      if (ac.type === 'A388') w *= 3;
      if (recent.includes(ac.id)) w *= 0.15;
      out.push({ kind, id: ac.id, w });
    }
    const turns = s.acs.filter((a) => a.phase === PH.STAND && a.ta);
    if (turns.length) {
      const a = turns[Math.floor(Math.random() * turns.length)];
      out.push({ kind: 'turn', id: a.id, w: recent.includes(a.id) ? 0.4 : 2.2 });
    }
    for (const p of s.projects || []) out.push({ kind: 'site', id: p.id, w: recent.includes(p.id) ? 0.3 : 1.6 });
    out.push({ kind: 'land-side', id: 'curb', w: recent.includes('curb') ? 0.2 : 1 });
    out.push({ kind: 'wide', id: 'wide', w: recent.includes('wide') ? 0.2 : 1.2 });
    if (hourOf(s.time) > 20 || hourOf(s.time) < 5.5) out.push({ kind: 'night', id: 'night', w: recent.includes('night') ? 0.2 : 1.4 });
    return out;
  }

  next(force = false) {
    const s = this.game.state;
    if (!s) return;
    const c = this.candidates(s);
    let tot = c.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * tot;
    let pick = c[0];
    for (const x of c) {
      r -= x.w;
      if (r <= 0) {
        pick = x;
        break;
      }
    }
    this.recent = [pick.id, ...(this.recent || [])].slice(0, 4);
    this.shot = { ...pick, t: 0, dur: { land: 16, dep: 14, goaround: 16, push: 12, taxi: 10, turn: 12, site: 10, 'land-side': 10, wide: 12, night: 12 }[pick.kind] || 12, drift: Math.random() * Math.PI * 2 };
    const cam = this.game.cam;
    if (force || pick.kind === 'wide') cam.tx = null;
    this.caption(s);
  }

  caption(s) {
    const sh = this.shot;
    const set = (k, t, sub) => {
      this.cap.k.textContent = k;
      this.cap.t.textContent = t;
      this.cap.s.textContent = sub;
      this.el.querySelector('.cn-cap').classList.remove('in');
      void this.el.offsetWidth;
      this.el.querySelector('.cn-cap').classList.add('in');
    };
    const ac = sh.id && s.acs.find((a) => a.id === sh.id);
    const acText = (a) => {
      const al = AIRLINES[a.airline];
      const rot = s.rots[a.rot];
      const city = rot ? CITIES[rot.city]?.name : '';
      return { t: `${al ? al.name : ''} ${a.cs.replace(/^[A-Z]+/, '')}`, sub: `${AC_TYPES[a.type].name}${city ? (a.arr && [PH.FINAL, PH.ROLLOUT, PH.TAXI_IN].includes(a.phase) ? ` · aus ${city}` : ` · nach ${city}`) : ''}` };
    };
    if (ac) {
      const x = acText(ac);
      const K = { land: ac.emergency ? 'NOTLANDUNG' : 'LANDUNG', dep: 'START', goaround: 'DURCHSTARTEN', push: 'PUSHBACK', taxi: 'ROLLVERKEHR', turn: 'ABFERTIGUNG' }[sh.kind];
      return set(K, x.t, x.sub);
    }
    if (sh.kind === 'site') {
      const p = (s.projects || []).find((q) => q.id === sh.id);
      return set('BAUSTELLE', p ? p.name : 'Bauarbeiten', p ? `${Math.floor(p.prog * 100)} % fertig` : '');
    }
    if (sh.kind === 'land-side') return set('LANDSEITE', 'Terminal-Vorfahrt', 'Taxis, Busse und Reisende');
    if (sh.kind === 'night') return set('NACHT', s.name, 'Befeuerung und Nachtbetrieb');
    return set('ÜBERBLICK', s.name, `${s.acs.filter((a) => a.mode === 'map').length} Flugzeuge am Platz`);
  }

  // jeden Frame: Kamera führen
  update(dt) {
    if (!this.on) return;
    const s = this.game.state;
    const cam = this.game.cam;
    const sh = this.shot;
    if (!s || !sh) return this.next(true);
    sh.t += dt;
    const ac = sh.id && s.acs.find((a) => a.id === sh.id);
    let tx, ty, tz;
    if (['land', 'dep', 'goaround', 'push', 'taxi', 'turn'].includes(sh.kind)) {
      if (!ac || ac.mode !== 'map' || (sh.kind !== 'turn' && ac.z > 5)) return this.next();
      const lead = ['land', 'dep', 'goaround'].includes(sh.kind) ? 2.2 : 0.6;
      tx = ac.x + Math.cos(ac.hdg) * lead;
      ty = ac.y + Math.sin(ac.hdg) * lead - ac.z * 0.4;
      tz = sh.kind === 'turn' ? 2.3 : sh.kind === 'taxi' ? 1.8 : AC_TYPES[ac.type].size === 'L' ? 1.5 : 1.8;
      if (sh.kind === 'turn') {
        tx += Math.cos(sh.drift + sh.t * 0.05) * 1.2;
        ty += Math.sin(sh.drift + sh.t * 0.05) * 1.2;
      }
    } else if (sh.kind === 'site') {
      const g = (this.game.map.sites || []).find((q) => q.p.id === sh.id);
      if (!g) return this.next();
      tx = (g.g.x0 + g.g.x1) / 2 + Math.cos(sh.drift) * sh.t * 0.08;
      ty = (g.g.y0 + g.g.y1) / 2 + Math.sin(sh.drift) * sh.t * 0.08;
      tz = 1.5;
    } else if (sh.kind === 'land-side') {
      tx = 30 + sh.t * 0.25;
      ty = 1.8;
      tz = 1.9;
    } else if (sh.kind === 'night') {
      tx = 40 + Math.cos(sh.drift) * sh.t * 0.3;
      ty = 24;
      tz = 0.75;
    } else {
      tx = LY.W / 2 + Math.cos(sh.drift) * (8 + sh.t * 0.4);
      ty = 20 + Math.sin(sh.drift) * 6;
      tz = 0.52 + sh.t * 0.006;
    }
    // weich folgen (Position und Zoom)
    const k = 1 - Math.pow(0.02, dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    const kz = 1 - Math.pow(0.15, dt);
    cam.zoom = clamp(cam.zoom + (tz - cam.zoom) * kz, 0.3, 2.6);
    cam.tx = null;
    if (sh.t > sh.dur) this.next();
    // Einblendungen: Uhr/Wetter und Live-Daten des gezeigten Flugzeugs
    this.infoT = (this.infoT || 0) - dt;
    if (this.infoT <= 0) {
      this.infoT = 0.25;
      const w = WEATHER[s.weather.kind];
      const clock = `TAG ${dayOf(s.time)} · ${fmtClock(s.time)} · ${w.icon} ${Math.round(temperature(s))} °C · WIND ${String(Math.round(s.wind.dir / 10) * 10).padStart(3, '0')}/${Math.round(s.wind.spd)}`;
      if (this.clockEl.textContent !== clock) this.clockEl.textContent = clock;
      let data = '';
      if (ac && ac.mode === 'map') {
        const kt = Math.round((ac.v || 0) * 323); // Kacheln je Spielsekunde -> Knoten (Endanflug 0,42 ≈ 135 kt)
        const alt = Math.round(((ac.z || 0) * 500) / 10) * 10;
        data = `<b>${esc(ac.cs)}</b> ${ac.type} · GS ${kt} kt${alt > 0 ? ` · ALT ${alt} ft` : ''} · HDG ${String(Math.round(((ac.hdg * 180) / Math.PI + 90 + 360) % 360)).padStart(3, '0')}°`;
      }
      if (this.dataEl._h !== data) {
        this.dataEl.innerHTML = data;
        this.dataEl._h = data;
      }
    }
  }
}
