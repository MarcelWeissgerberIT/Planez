// Radarschirm (Luftlage) für den Tower-Lotsen
import * as AS from '../sim/airspace.js';
import * as LY from '../layout.js';
import { PH } from '../sim/aircraft.js';
import { AC_TYPES } from '../config.js';
import { clamp, esc } from '../util.js';
import { isSeqArrival } from '../sim/sequence.js';
import { markHex } from '../ui/marks.js';
import { wakeNm } from '../sim/wake.js';
import { atis } from '../sim/aircraft.js';
import { qnh } from '../sim/atis.js';
import { temperature } from '../sim/winter.js';
import { forecastInfo } from '../sim/events.js';
import { fmtClock } from '../util.js';

// Farben der Pistenfolge (RGB)
const SC = { land: [34, 211, 238], landClr: [165, 243, 252], dep: [245, 158, 11], depClr: [232, 121, 249] };
const seqRgb = (ac) => (isSeqArrival(ac) ? (ac.clr.land ? SC.landClr : SC.land) : ac.clr.takeoff ? SC.depClr : SC.dep);
const rgbStr = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Chip-Leiste der Pistenfolge (HTML unter dem Radar)
export function seqChips(state) {
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  const items = (state.seq || []).map((id, i) => {
    const a = byId.get(id);
    if (!a) return '';
    const arr = isSeqArrival(a);
    let info;
    if (arr) info = a.mode === 'air' ? `${AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]).toFixed(1)} NM` : a.phase === PH.ROLLOUT ? 'Piste' : 'kurz';
    else info = a.clr.takeoff ? 'frei' : a.phase === PH.HOLDING ? 'Rollhalt' : a.phase === PH.LINED || a.phase === PH.LINEUP ? 'Piste' : 'rollt';
    const mk = markHex(a);
    return `<button class="rs-chip" data-id="${a.id}" style="--c:${rgbStr(seqRgb(a))}"><b>${i + 1}</b>${mk ? `<i class="rs-flag" style="--f:${mk}"></i>` : ''}${esc(a.cs)} ${arr ? '↓' : '↑'} <small>${info}</small></button>`;
  });
  return items.join('') || '<span class="rs-empty">Pistenfolge leer</span>';
}

// Fiktive Landschaft (Flüsse, Städte) für die Karte im Hintergrund
function makeTerrain() {
  let s = 4242;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rivers = [];
  for (let k = 0; k < 2; k++) {
    const pts = [];
    let x = -60, y = -20 + k * 45 + r() * 10;
    while (x < 60) {
      pts.push({ x, y });
      x += 4 + r() * 3;
      y += (r() - 0.5) * 6;
    }
    rivers.push(pts);
  }
  const towns = [];
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = 8 + r() * 36;
    towns.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.8 + r() * 1.8 });
  }
  return { rivers, towns };
}
const TERRAIN = makeTerrain();

export class Radar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.range = 48;
    this.sweep = 0;
    this.blips = [];
    this.w = 300;
    this.h = 300;
    this.dpr = 1;
  }
  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }
  get R() {
    return Math.min(this.w, this.h) / 2 - 8;
  }
  toScreen(x, y) {
    const k = this.R / this.range;
    return { x: this.w / 2 + x * k, y: this.h / 2 + y * k };
  }
  toWorld(sx, sy) {
    const k = this.R / this.range;
    return { x: (sx - this.w / 2) / k, y: (sy - this.h / 2) / k };
  }

  render(state, dt, ui) {
    this.cb = document.documentElement.classList.contains('a11y-cb');
    const ctx = this.ctx;
    const { w, h } = this;
    const R = this.R;
    const cx = w / 2, cy = h / 2;
    const k = R / this.range;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Scope
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, '#07261b');
    bg.addColorStop(1, '#03140e');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    // Landschaft
    ctx.strokeStyle = 'rgba(40,120,160,0.28)';
    ctx.lineWidth = 1.2;
    for (const riv of TERRAIN.rivers) {
      ctx.beginPath();
      riv.forEach((p, i) => {
        const q = this.toScreen(p.x, p.y);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(90,140,90,0.12)';
    for (const t of TERRAIN.towns) {
      const q = this.toScreen(t.x, t.y);
      ctx.beginPath();
      ctx.arc(q.x, q.y, t.r * k, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ringe
    ctx.strokeStyle = 'rgba(80,255,160,0.13)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(80,255,160,0.35)';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    for (let r = 10; r <= this.range; r += 10) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${r}`, cx + 3, cy - r * k + 11);
    }
    // Gewitterzellen
    for (const c of state.weather.cells || []) {
      const q = this.toScreen(c.x, c.y);
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, c.r * k);
      g.addColorStop(0, 'rgba(255,60,60,0.45)');
      g.addColorStop(0.4, 'rgba(255,200,40,0.3)');
      g.addColorStop(1, 'rgba(40,200,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(q.x, q.y, c.r * k, 0, Math.PI * 2);
      ctx.fill();
      // Umriss und Kennung (CB = Gewitterwolke, SHRA = Schauer)
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255,140,60,0.55)';
      ctx.beginPath();
      ctx.arc(q.x, q.y, c.r * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,180,120,0.8)';
      ctx.font = '700 9px ui-monospace, Menlo, monospace';
      ctx.fillText(c.shower ? 'SHRA' : 'CB', q.x - (c.shower ? 11 : 6), q.y + 3);
      ctx.font = '10px ui-monospace, Menlo, monospace';
    }

    // Anflugachse der aktiven Piste
    const rwy = state.rwy;
    const s = AS.appSide(rwy);
    const thr = AS.THR[rwy];
    ctx.strokeStyle = 'rgba(120,255,190,0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    let a = this.toScreen(thr.x, 0), b = this.toScreen(thr.x + s * 18, 0);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let d = 1; d <= 18; d++) {
      const p = this.toScreen(thr.x + s * d, 0);
      const len = d % 5 === 0 ? 5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - len);
      ctx.lineTo(p.x, p.y + len);
      ctx.stroke();
    }
    // FAF / IP
    for (const [d, n, dy] of [[AS.FAF_DIST, 'FAF', 16], [AS.IP_DIST, 'IP', -9]]) {
      const p = this.toScreen(thr.x + s * d, 0);
      ctx.fillStyle = 'rgba(160,255,210,0.6)';
      ctx.fillText(n, p.x - 8, p.y + dy);
    }
    // Fixes & Warteschleifen
    for (const rw of ['09', '27']) {
      for (const f of Object.values(AS.FIXES[rw])) {
        const act = rw === rwy;
        const p = this.toScreen(f.x, f.y);
        ctx.strokeStyle = act ? 'rgba(160,255,210,0.8)' : 'rgba(120,200,160,0.3)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 5);
        ctx.lineTo(p.x + 4.5, p.y + 3.5);
        ctx.lineTo(p.x - 4.5, p.y + 3.5);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = act ? 'rgba(160,255,210,0.85)' : 'rgba(120,200,160,0.35)';
        ctx.fillText(f.name, p.x + 6, p.y + 4);
        if (act) {
          ctx.strokeStyle = 'rgba(120,255,190,0.18)';
          ctx.beginPath();
          AS.holdPattern(f).forEach((q, i) => {
            const qq = this.toScreen(q.x, q.y);
            i ? ctx.lineTo(qq.x, qq.y) : ctx.moveTo(qq.x, qq.y);
          });
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    // Piste
    const r0 = this.toScreen(AS.THR['09'].x, 0), r1 = this.toScreen(AS.THR['27'].x, 0);
    const mid = (r0.x + r1.x) / 2;
    const half = Math.max(7, (r1.x - r0.x) / 2);
    ctx.strokeStyle = '#d6ffe9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mid - half, cy);
    ctx.lineTo(mid + half, cy);
    ctx.stroke();
    // Parallelbahn (maßstäblich sehr nah – leicht versetzt dargestellt)
    if (state.upgrades && state.upgrades.rwy2) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mid - half, cy + 4);
      ctx.lineTo(mid + half, cy + 4);
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    // Abstände zwischen aufeinanderfolgenden Anflügen (je Bahn), farbig gegen den Sollabstand
    for (const strip of ['N', 'S']) {
      const arr = state.acs.filter((a) => a.mode === 'air' && a.arr && (a.phase === PH.APPROACH || a.phase === PH.FINAL) && (a.strip || 'N') === strip).map((a) => ({ a, d: AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]) })).sort((x, y) => x.d - y.d);
      for (let i = 1; i < arr.length; i++) {
        const lead = arr[i - 1], foll = arr[i];
        const gap = foll.d - lead.d;
        if (gap > 20) continue;
        const req = Math.max(3, wakeNm(lead.a.wake, foll.a.wake));
        const c = gap < req ? '248,113,113' : gap < req + 1.5 ? '251,191,36' : '134,239,172';
        const p0 = this.toScreen(lead.a.pos.x, lead.a.pos.y), p1 = this.toScreen(foll.a.pos.x, foll.a.pos.y);
        ctx.strokeStyle = `rgba(${c},0.45)`;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        const txt = `${gap.toFixed(1)}${req > 3 ? '/' + req : ''} NM`;
        ctx.font = '600 10px ui-monospace, monospace';
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(3,20,14,0.85)';
        ctx.fillRect(mx - tw / 2 - 3, my - 7, tw + 6, 13);
        ctx.fillStyle = `rgb(${c})`;
        ctx.textAlign = 'center';
        ctx.fillText(txt, mx, my + 3);
        ctx.textAlign = 'left';
      }
    }

    // Sweep
    this.sweep = (this.sweep + dt * (Math.PI * 2) / 3.2) % (Math.PI * 2);
    const sw = this.sweep;
    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(sw - Math.PI / 2 - 0.9 + Math.PI / 2, cx, cy);
      cg.addColorStop(0, 'rgba(60,255,150,0)');
      cg.addColorStop(0.14, 'rgba(60,255,150,0.13)');
      cg.addColorStop(0.1433, 'rgba(60,255,150,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(120,255,190,0.55)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sw) * R, cy + Math.sin(sw) * R);
    ctx.stroke();

    // Pistenfolge: Verbindungslinie der Landungen und Startmarker
    const seq = state.seq || [];
    const seqPos = new Map(seq.map((id, i) => [id, i + 1]));
    const byIdR = new Map(state.acs.map((a) => [a.id, a]));
    const nmOf = (a) => (a.mode === 'air' ? a.pos : LY.tileToNm(a.x, a.y));
    const seqAcs = seq.map((id) => byIdR.get(id)).filter(Boolean);
    const lands = seqAcs.filter((a) => isSeqArrival(a));
    if (lands.length > 1) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = rgbStr(SC.land, 0.45);
      ctx.beginPath();
      lands.forEach((a, i) => {
        const q = this.toScreen(nmOf(a).x, nmOf(a).y);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const deps = seqAcs.filter((a) => !isSeqArrival(a) && !(a.phase === PH.TAKEOFF && a.z > 0));
    if (deps.length) {
      const q = this.toScreen(AS.THR[state.rwy].x, 0);
      const cleared = deps.some((a) => a.clr.takeoff);
      const c = cleared ? SC.depClr : SC.dep;
      ctx.fillStyle = rgbStr(c, 0.95);
      ctx.beginPath();
      ctx.moveTo(q.x, q.y + 6);
      ctx.lineTo(q.x + 6, q.y + 16);
      ctx.lineTo(q.x - 6, q.y + 16);
      ctx.closePath();
      ctx.fill();
      ctx.font = '700 10px ui-monospace, Menlo, monospace';
      ctx.fillText(`${deps.map((a) => seqPos.get(a.id)).join('·')} ↑`, q.x + 9, q.y + 16);
    }

    // Flugzeuge
    this.blips = [];
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    const sel = ui && ui.selected;
    const placed = [];
    ctx.font = `600 ${this.R > 200 ? 11 : 10}px ui-monospace, Menlo, monospace`;
    for (const ac of state.acs) {
      let pos, alt;
      if (ac.mode === 'air') {
        pos = ac.pos;
        alt = ac.alt;
      } else {
        const onGround = !(ac.phase === PH.FINAL || ac.phase === PH.MISSED || (ac.phase === PH.TAKEOFF && ac.z > 0));
        if (onGround) continue;
        pos = LY.tileToNm(ac.x, ac.y);
        alt = ac.z * 150;
      }
      const p = this.toScreen(pos.x, pos.y);
      const mk = markHex(ac);
      ctx.globalAlpha = ui && ui.markFilter && !mk && sel !== ac.id ? 0.25 : 1;
      // Nachglühen je nach Sweep-Winkel
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const since = ((sw - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const glow = 0.55 + 0.45 * (1 - since / (Math.PI * 2));
      let col = ac.arr ? [110, 255, 170] : [170, 255, 220];
      if (ac.phase === PH.DEPART) col = [150, 220, 255];
      const sp = seqPos.get(ac.id);
      if (sp) col = seqRgb(ac);
      if (ac.predConflict) col = [255, 200, 60];
      if (ac.conflict) col = this.cb ? (blink ? [255, 140, 30] : [255, 200, 140]) : blink ? [255, 70, 70] : [255, 160, 160];
      if (ac.emergency) col = blink ? [255, 80, 220] : [255, 200, 240];
      if (ac.nordo) col = blink ? [255, 150, 40] : [255, 215, 150];
      if (ac.wxReq && !ac.emergency && !ac.conflict) col = blink ? [251, 191, 36] : [254, 240, 138];
      if (sel === ac.id) col = [255, 255, 255];
      const cs = (al) => `rgba(${col[0]},${col[1]},${col[2]},${al})`;
      // Spur
      if (ac.trail) {
        ac.trail.forEach((t, i) => {
          const q = this.toScreen(t.x, t.y);
          ctx.fillStyle = cs(0.12 + i * 0.06);
          ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
        });
      }
      // Vorhersagevektor (1 min)
      if (ac.mode === 'air') {
        const v = (ac.spd / 60) * k;
        ctx.strokeStyle = cs(0.5 * glow);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.sin((ac.crs * Math.PI) / 180) * v, p.y - Math.cos((ac.crs * Math.PI) / 180) * v);
        ctx.stroke();
      }
      // Wetter-Umweg: gestrichelt über den WX-Punkt zum nächsten Wegpunkt
      if (ac.mode === 'air' && ac.route && ac.route[0] && ac.route[0].wx) {
        const q1 = this.toScreen(ac.route[0].x, ac.route[0].y);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(251,191,36,0.75)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q1.x, q1.y);
        if (ac.route[1]) {
          const q2 = this.toScreen(ac.route[1].x, ac.route[1].y);
          ctx.lineTo(q2.x, q2.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(251,191,36,0.9)';
        ctx.font = '700 9px ui-monospace, Menlo, monospace';
        ctx.fillText('WX', q1.x + 4, q1.y - 3);
        ctx.font = `600 ${this.R > 200 ? 11 : 10}px ui-monospace, Menlo, monospace`;
      }
      // Symbol
      ctx.fillStyle = cs(glow);
      ctx.strokeStyle = cs(glow);
      if (ac.arr) ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      else {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 4);
        ctx.lineTo(p.x + 4, p.y);
        ctx.lineTo(p.x, p.y + 4);
        ctx.lineTo(p.x - 4, p.y);
        ctx.closePath();
        ctx.fill();
      }
      if (sel === ac.id) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Markierung: Ring + Fähnchen
      if (mk) {
        const pulse = 11 + Math.sin(performance.now() / 260) * 1.2;
        ctx.strokeStyle = mk;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = mk;
        ctx.beginPath();
        ctx.moveTo(p.x + 7, p.y - 8);
        ctx.lineTo(p.x + 7, p.y - 19);
        ctx.lineTo(p.x + 15, p.y - 16);
        ctx.lineTo(p.x + 7, p.y - 13);
        ctx.fill();
        ctx.strokeStyle = mk;
        ctx.beginPath();
        ctx.moveTo(p.x + 7, p.y - 8);
        ctx.lineTo(p.x + 7, p.y - 19);
        ctx.stroke();
      }
      // Folgenummer
      if (sp) {
        const txt = String(sp);
        const bw2 = 7 + txt.length * 6.5;
        ctx.fillStyle = rgbStr(seqRgb(ac), 0.95);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(p.x - bw2 - 6, p.y - 6, bw2, 12, 3) : ctx.rect(p.x - bw2 - 6, p.y - 6, bw2, 12);
        ctx.fill();
        ctx.fillStyle = '#04121a';
        ctx.font = '800 10px ui-monospace, Menlo, monospace';
        ctx.fillText(txt, p.x - bw2 - 2.5, p.y + 3.5);
        ctx.font = `600 ${this.R > 200 ? 11 : 10}px ui-monospace, Menlo, monospace`;
      }
      // Datenblock
      const fl = String(Math.round(alt / 100)).padStart(3, '0');
      const trend = ac.mode === 'air' ? (ac.tAlt > ac.alt + 150 ? '↑' : ac.tAlt < ac.alt - 150 ? '↓' : ' ') : '↓';
      const spd = String(Math.round((ac.mode === 'air' ? ac.spd : 140) / 10)).padStart(2, '0');
      const t = AC_TYPES[ac.type];
      const l1 = (ac.mode === 'map' && sp ? '#' + sp + ' ' : '') + ac.cs + (ac.req ? ' ●' : '');
      const l2 = `${fl}${trend} ${spd}`;
      const l3 = ac.fuelEmergency ? '7700 FUEL' : ac.emergency ? '7700 EMERG' : ac.nordo ? `7600 NORDO${ac.clr.land ? ' LND' : ''}` : `${sp ? '#' + sp + ' ' : ''}${ac.type}/${t.wake}${ac.wxReq ? ' WX?' : ac.route && ac.route[0] && ac.route[0].wx ? ' WX' : ac.minFuel ? ' MINFUEL' : ac.wakeWarn ? ' WAKE!' : ac.clr.land ? ' LND' : ac.phase === PH.APPROACH ? ' APP' : ac.phase === PH.HOLD ? ' HLD' : ''}`;
      // Datenblock-Position: freie Ecke suchen (Überlappungen vermeiden)
      const compact = ac.mode === 'map';
      const noteTxt = mk && ac.mark.note ? `⚑ ${ac.mark.note}` : '';
      const bw = compact ? 48 : ac.minFuel || ac.wakeWarn || ac.wxReq ? 104 : 78, bh = (compact ? 12 : 38) + (noteTxt ? 12 : 0);
      const cands = [[12, -26], [12, 8], [-bw - 10, -26], [-bw - 10, 8], [14, -44], [-bw - 12, -44]];
      let best = cands[0], bestO = 1e9;
      for (const [ox, oy] of cands) {
        const r = { x: p.x + ox - 2, y: p.y + oy - 2, w: bw, h: bh };
        let o = 0;
        for (const q of placed) o += Math.max(0, Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x)) * Math.max(0, Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y));
        if (r.x < 4 || r.x + r.w > w - 4) o += 500;
        if (o < bestO) {
          bestO = o;
          best = [ox, oy];
        }
        if (o === 0) break;
      }
      const tx = p.x + best[0], ty = p.y + best[1];
      placed.push({ x: tx - 2, y: ty - 2, w: bw, h: bh });
      ctx.strokeStyle = cs(0.4);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tx - 2, ty + 8);
      ctx.stroke();
      if (sel === ac.id) {
        ctx.fillStyle = 'rgba(0,30,20,0.85)';
        ctx.fillRect(tx - 3, ty - 3, bw + 4, bh + 4);
      }
      ctx.fillStyle = cs(Math.max(0.75, glow));
      ctx.fillText(l1, tx, ty + 8);
      if (!compact) {
        ctx.fillText(l2, tx, ty + 20);
        ctx.fillStyle = cs(0.7);
        ctx.fillText(l3, tx, ty + 32);
      }
      if (noteTxt) {
        ctx.fillStyle = mk;
        ctx.fillText(noteTxt, tx, ty + (compact ? 20 : 44));
      }
      ctx.globalAlpha = 1;
      this.blips.push({ id: ac.id, x: p.x, y: p.y, tx, ty });
    }
    ctx.restore();
    // ATIS-Zeile oben links
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(3,20,14,0.8)';
    const at = `ATIS ${atis(state)[0]} · QNH ${qnh(state)} · ${Math.round(temperature(state))}°C`;
    const aw = ctx.measureText(at).width;
    ctx.fillRect(6, 6, aw + 12, 18);
    ctx.fillStyle = 'rgba(134,239,172,0.95)';
    ctx.fillText(at, 12, 19);
    if (state.windshear) {
      const ws = `WS ALERT ${state.rwy}`;
      const blink = Math.floor(performance.now() / 500) % 2;
      ctx.fillStyle = blink ? 'rgba(127,29,29,0.9)' : 'rgba(60,10,10,0.85)';
      ctx.fillRect(aw + 24, 6, ctx.measureText(ws).width + 12, 18);
      ctx.fillStyle = '#fecaca';
      ctx.fillText(ws, aw + 30, 19);
    }
    // TAF-Zeile: nächste Wetterlage (ICAO-Kürzel)
    const fc = forecastInfo(state);
    if (fc.change && fc.at - state.time < 3 * 3600) {
      const code = { clear: 'CAVOK', clouds: 'BKN030', rain: 'RA', fog: `FG ${fc.rvr || ''}M`.replace(' M', ''), storm: 'TSRA', snow: 'SN' }[fc.kind] || fc.kind;
      const tf = `TAF · ab ${fmtClock(fc.at)} ${code}`;
      const tw = ctx.measureText(tf).width;
      const warn = fc.kind === 'storm' || fc.kind === 'fog' || fc.kind === 'snow';
      ctx.fillStyle = 'rgba(3,20,14,0.8)';
      ctx.fillRect(6, 27, tw + 12, 18);
      ctx.fillStyle = warn ? 'rgba(251,191,36,0.95)' : 'rgba(134,239,172,0.75)';
      ctx.fillText(tf, 12, 40);
    }

    // Kompassrose
    ctx.strokeStyle = 'rgba(80,255,160,0.35)';
    ctx.fillStyle = 'rgba(80,255,160,0.6)';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 10) {
      const a2 = ((d - 90) * Math.PI) / 180;
      const l = d % 30 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a2) * R, cy + Math.sin(a2) * R);
      ctx.lineTo(cx + Math.cos(a2) * (R - l), cy + Math.sin(a2) * (R - l));
      ctx.stroke();
      if (d % 30 === 0 && R > 120) ctx.fillText(String(d / 10).padStart(2, '0'), cx + Math.cos(a2) * (R - 16), cy + Math.sin(a2) * (R - 16));
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = 'rgba(80,255,160,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  pick(sx, sy) {
    let best = null, bd = 16;
    for (const b of this.blips) {
      const d = Math.min(Math.hypot(b.x - sx, b.y - sy), Math.hypot(b.tx + 30 - sx, b.ty + 18 - sy) * 1.3);
      if (d < bd) {
        bd = d;
        best = b.id;
      }
    }
    return best;
  }
}
