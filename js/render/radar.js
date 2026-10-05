// Radarschirm (Luftlage) für den Tower-Lotsen
import * as AS from '../sim/airspace.js';
import * as LY from '../layout.js';
import { PH } from '../sim/aircraft.js';
import { AC_TYPES, typeCode } from '../config.js';
import { clamp, esc } from '../util.js';
import { isSeqArrival, arrivalGaps } from '../sim/sequence.js';
import { markHex } from '../ui/marks.js';
import { atis } from '../sim/aircraft.js';
import { qnh } from '../sim/atis.js';
import { temperature } from '../sim/winter.js';
import { forecastInfo } from '../sim/events.js';
import { fmtClock } from '../util.js';
import { T, TC } from '../i18n.js';

// Farben der Pistenfolge (RGB)
const SC = { land: [251, 146, 60], landClr: [254, 215, 170], dep: [56, 189, 248], depClr: [186, 230, 253] }; // wie die Kontrollstreifen: Anflug orange, Abflug blau, hell = Freigabe erteilt
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
    if (arr) info = a.mode === 'air' ? `${AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]).toFixed(1)} NM` : a.phase === PH.ROLLOUT ? T('Piste') : T('kurz');
    else info = a.clr.takeoff ? TC('radar', 'frei') : a.phase === PH.HOLDING ? T('Rollhalt') : a.phase === PH.LINED || a.phase === PH.LINEUP ? T('Piste') : T('rollt');
    const mk = markHex(a);
    return `<button class="rs-chip" data-id="${a.id}" style="--c:${rgbStr(seqRgb(a))}"><b>${i + 1}</b>${mk ? `<i class="rs-flag" style="--f:${mk}"></i>` : ''}${esc(a.cs)} ${arr ? '↓' : '↑'} <small>${info}</small></button>`;
  });
  return items.join('') || T('<span class="rs-empty">Pistenfolge leer</span>');
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
    this.range = 48; // feste Reichweite (NM) ohne Auto-Zoom
    this.auto = true; // Auto-Zoom: Verkehr füllt das Bild, der aktive Funkkontakt rückt in den Fokus
    this.view = { x: 0, y: 0, r: 48 }; // aktueller Ausschnitt: Mitte (NM) und Reichweite bis zum kurzen Rand
    this.tgt = null;
    this.lastT = 0;
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
    const v = this.view, k = this.R / v.r;
    return { x: this.w / 2 + (x - v.x) * k, y: this.h / 2 + (y - v.y) * k };
  }
  toWorld(sx, sy) {
    const v = this.view, k = this.R / v.r;
    return { x: (sx - this.w / 2) / k + v.x, y: (sy - this.h / 2) / k + v.y };
  }
  // Was gehört ins Bild? Platz und Bahn immer; spricht gerade ein Flugzeug in der Luft, es selbst und alles in 8 NM
  // Umkreis, sonst der ganze Luftverkehr (abfliegende nur bis 25 NM). Das gewählte Flugzeug bleibt immer im Bild.
  frame(state, ui) {
    const airPos = (a) => (a.mode === 'air' ? a.pos : a.phase === PH.FINAL || a.phase === PH.MISSED || (a.phase === PH.TAKEOFF && a.z > 0) ? LY.tileToNm(a.x, a.y) : null);
    const pts = [{ x: AS.THR['09'].x, y: -1 }, { x: AS.THR['27'].x, y: 1 }];
    const talkCs = ui && ui.talk && ui.talk.cs;
    const fa = talkCs ? state.acs.find((a) => a.cs === talkCs) : null;
    const fp = fa && airPos(fa);
    if (fp) {
      pts.push(fp);
      for (const a of state.acs) {
        const p = a !== fa && airPos(a);
        if (p && Math.hypot(p.x - fp.x, p.y - fp.y) < 8) pts.push(p);
      }
    } else {
      for (const a of state.acs) {
        const p = airPos(a);
        if (p && !(a.phase === PH.DEPART && Math.hypot(p.x, p.y) > 25)) pts.push(p);
      }
      for (const o of [state.vfr && state.vfr.p, state.heli && state.heli.h]) if (o) pts.push(LY.tileToNm(o.x, o.y));
    }
    const sa = ui && ui.selected ? state.acs.find((a) => a.id === ui.selected) : null;
    const sp = sa && airPos(sa);
    if (sp) pts.push(sp);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    // Rand ringsum, rechts oben Platz für die Datenblöcke
    const mx = 28, my = 24, lw = 86, lh = 30;
    const k = Math.min(Math.max(40, this.w - 2 * mx - lw) / Math.max(1, x1 - x0), Math.max(40, this.h - 2 * my - lh) / Math.max(1, y1 - y0));
    const r = clamp(this.R / k, 6, 60), kk = this.R / r;
    return { x: (x0 + x1) / 2 + lw / 2 / kk, y: (y0 + y1) / 2 - lh / 2 / kk, r, focus: fp ? talkCs : null };
  }
  updateView(state, ui) {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - (this.lastT || now)) / 1000));
    this.lastT = now;
    let t = { x: 0, y: 0, r: this.range, focus: null };
    if (this.auto) {
      const f = this.frame(state, ui), o = this.tgt;
      // ruhiges Bild: nachführen, wenn mehr Platz nötig ist, deutlich weniger reicht, die Mitte wandert oder der Fokus wechselt
      if (!o || f.focus !== o.focus || f.r > o.r * 1.03 || f.r < o.r * 0.82 || Math.hypot(f.x - o.x, f.y - o.y) > o.r * 0.1) this.tgt = f;
      t = this.tgt;
    } else this.tgt = null;
    const v = this.view, a = 1 - Math.exp(-dt * 2.6);
    v.x += (t.x - v.x) * a;
    v.y += (t.y - v.y) * a;
    v.r = Math.exp(Math.log(v.r) + (Math.log(t.r) - Math.log(v.r)) * a);
  }

  render(state, dt, ui) {
    this.cb = document.documentElement.classList.contains('a11y-cb');
    const ctx = this.ctx;
    const { w, h } = this;
    this.updateView(state, ui);
    const R = this.R;
    const k = R / this.view.r;
    // Mittelpunkt des Platzes auf dem Schirm (Ringe, Piste, Sweep); der Schirm füllt die ganze Fläche
    const c0 = this.toScreen(0, 0);
    const cx = c0.x, cy = c0.y;
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Scope
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
    bg.addColorStop(0, '#07261b');
    bg.addColorStop(1, '#03140e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
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
    const ringStep = this.view.r > 30 ? 10 : this.view.r > 12 ? 5 : 2;
    for (let r = ringStep; r * k <= far; r += ringStep) {
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
          // Rennbahnmuster der Warteschleife, belegt heller; Pfeil auf dem Anflugschenkel zeigt die Flugrichtung
          const holders = state.acs.filter((o) => o.mode === 'air' && ((o.phase === PH.HOLD && o.holdFix && o.holdFix.name === f.name) || (o.stackFix === f.name && o.stackAlt)));
          const busy = holders.some((o) => o.phase === PH.HOLD);
          const pat = AS.holdPattern(f);
          ctx.strokeStyle = busy ? 'rgba(251,191,36,0.55)' : 'rgba(120,255,190,0.22)';
          ctx.lineWidth = busy ? 1.4 : 1;
          ctx.beginPath();
          pat.forEach((q, i) => {
            const qq = this.toScreen(q.x, q.y);
            i ? ctx.lineTo(qq.x, qq.y) : ctx.moveTo(qq.x, qq.y);
          });
          ctx.closePath();
          ctx.stroke();
          ctx.lineWidth = 1;
          const hi = AS.holdInfo(f);
          const am = this.toScreen(f.x - hi.u.x * AS.HOLD_LEG * 0.45, f.y - hi.u.y * AS.HOLD_LEG * 0.45);
          const ang = Math.atan2(hi.u.y, hi.u.x);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.moveTo(am.x + Math.cos(ang) * 4, am.y + Math.sin(ang) * 4);
          ctx.lineTo(am.x + Math.cos(ang + 2.5) * 4, am.y + Math.sin(ang + 2.5) * 4);
          ctx.lineTo(am.x + Math.cos(ang - 2.5) * 4, am.y + Math.sin(ang - 2.5) * 4);
          ctx.fill();
          // Höhenstapel neben dem Fix: oben die höchste Höhe, unten die nächste zum Anflug
          if (holders.length) {
            const lv = (o) => (o.phase === PH.HOLD ? o.tAlt : o.stackAlt);
            const rows = holders.sort((x, y) => lv(y) - lv(x)).map((o) => ({ t: `${String(Math.round(lv(o) / 100)).padStart(3, '0')} ${o.cs}${o.phase === PH.HOLD ? '' : ' →'}`, hold: o.phase === PH.HOLD }));
            ctx.font = '600 9.5px ui-monospace, Menlo, monospace';
            const bw = Math.max(...rows.map((r) => ctx.measureText(r.t).width)) + 10;
            const side = hi.o.x >= 0 ? 1 : -1;
            const bx = side > 0 ? p.x + 12 : p.x - 12 - bw, by = p.y + (f.y < 0 ? -14 - rows.length * 11 : 12);
            ctx.fillStyle = 'rgba(3,20,14,0.82)';
            ctx.fillRect(bx, by, bw, rows.length * 11 + 13);
            ctx.fillStyle = 'rgba(251,191,36,0.85)';
            ctx.fillText(`${f.name} ${hi.right ? 'R' : 'L'}`, bx + 5, by + 9);
            rows.forEach((r, i) => {
              ctx.fillStyle = r.hold ? 'rgba(254,240,138,0.95)' : 'rgba(160,255,210,0.55)';
              ctx.fillText(r.t, bx + 5, by + 20 + i * 11);
            });
            ctx.font = '10px ui-monospace, Menlo, monospace';
          }
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

    // Abstände in der Pistenfolge (je Bahn), farbig gegen den Sollabstand. Dazu Sollabstand-Marken auf dem Endanflug
    // (wie die Zeitstaffelungs-Anzeige echter Anflugradare): bis zur Marke darf der Nachfolger aufschließen, nicht weiter
    const gcol = { ok: '134,239,172', tight: '251,191,36', bad: '248,113,113' };
    const posNm = (a) => (a.mode === 'air' ? a.pos : LY.tileToNm(a.x, a.y));
    for (const [id, g] of arrivalGaps(state)) {
      const foll = state.acs.find((a) => a.id === id);
      if (!foll || g.gap > 22) continue;
      const c = gcol[g.st];
      const p0 = this.toScreen(posNm(g.lead).x, posNm(g.lead).y), p1 = this.toScreen(posNm(foll).x, posNm(foll).y);
      ctx.strokeStyle = `rgba(${c},0.5)`;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
      const txt = `${g.gap.toFixed(1)}/${g.req} NM`;
      ctx.font = '700 10px ui-monospace, monospace';
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(3,20,14,0.88)';
      ctx.fillRect(mx - tw / 2 - 3, my - 7, tw + 6, 13);
      ctx.fillStyle = `rgb(${c})`;
      ctx.textAlign = 'center';
      ctx.fillText(txt, mx, my + 3);
      ctx.textAlign = 'left';
      // Marke auf der Anflugachse: Vordermann auf dem Endanflug + Sollabstand
      const lp = posNm(g.lead);
      const lAlong = g.lead.mode === 'air' ? AS.distToThr(lp, g.lead.rwy) : 0;
      if (g.lead.mode === 'map' || (Math.abs(lp.y) < 1.2 && lAlong < 20)) {
        const m = lAlong + g.req;
        const sx = AS.appSide(g.lead.rwy || rwy);
        const q = this.toScreen(AS.THR[g.lead.rwy || rwy].x + sx * m, 0);
        ctx.strokeStyle = `rgba(${c},0.95)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(q.x - sx * 4, q.y - 7);
        ctx.lineTo(q.x, q.y);
        ctx.lineTo(q.x - sx * 4, q.y + 7);
        ctx.stroke();
        ctx.lineWidth = 1;
        const sp2 = (state.seq || []).indexOf(id) + 1;
        if (sp2) {
          ctx.fillStyle = `rgba(${c},0.95)`;
          ctx.font = '700 9px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(String(sp2), q.x, q.y - 10);
          ctx.textAlign = 'left';
        }
      }
    }
    // Landefreigabe: die Bahn gehört diesem Flugzeug – durchgezogene Linie bis zur Schwelle
    for (const a of state.acs) {
      if (!a.arr || !a.clr.land || a.mode !== 'air' || a.phase !== PH.APPROACH) continue;
      const q0 = this.toScreen(a.pos.x, a.pos.y), q1 = this.toScreen(AS.THR[a.rwy].x, 0);
      ctx.strokeStyle = rgbStr(SC.landClr, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
      ctx.lineWidth = 1;
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
      ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = 'rgba(120,255,190,0.55)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sw) * far, cy + Math.sin(sw) * far);
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
    const talkCs = ui && ui.talk && ui.talk.cs, talkLive = !!(ui && ui.talk && ui.talk.live);
    const placed = [];
    ctx.font = `600 ${this.R > 200 ? 11 : 10}px ui-monospace, Menlo, monospace`;
    // Rettungshubschrauber (Sichtflug, Querungsanfrage)
    const HH = state.heli && state.heli.h;
    if (HH) {
      const q = LY.tileToNm(HH.x, HH.y);
      const p = this.toScreen(q.x, q.y);
      if (talkCs === 'RESCUE7') this.talkMark(ctx, p, talkLive);
      ctx.fillStyle = HH.st === 'req' && blink ? 'rgba(251,191,36,0.95)' : 'rgba(255,140,140,0.95)';
      ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
      ctx.textAlign = 'left';
      ctx.fillText('RESCUE7', p.x + 6, p.y - 4);
      ctx.fillText(HH.st === 'req' ? 'HELI X?' : 'HELI X', p.x + 6, p.y + 8);
    }
    const VV = state.vfr && state.vfr.p;
    // Platzrunde als gestrichelte Linie
    if (VV && VV.C && VV.mode !== 'leave') {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(186,230,253,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      VV.C.forEach((c, i) => {
        const q = LY.tileToNm(c.x, c.y);
        const p = this.toScreen(q.x, q.y);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    if (VV) {
      const q = LY.tileToNm(VV.x, VV.y);
      const p = this.toScreen(q.x, q.y);
      if (talkCs === VV.cs) this.talkMark(ctx, p, talkLive);
      ctx.fillStyle = VV.req && blink ? 'rgba(251,191,36,0.95)' : 'rgba(186,230,253,0.9)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillText(VV.cs, p.x + 6, p.y - 4);
      ctx.fillText(VV.req ? 'C172 VFR T&G?' : VV.clr ? 'C172 VFR T&G' : 'C172 VFR', p.x + 6, p.y + 8);
    }
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
      // in die Warteschleife geschickt: gestrichelt zum Fix
      if (ac.mode === 'air' && ac.phase === PH.INBOUND && ac.holdTo && ac.route && ac.route[0] && ac.route[0].iaf) {
        const qf = this.toScreen(ac.route[0].x, ac.route[0].y);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(251,191,36,0.7)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(qf.x, qf.y);
        ctx.stroke();
        ctx.setLineDash([]);
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
      const talk = talkCs === ac.cs;
      if (talk) this.talkMark(ctx, p, talkLive);
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
      const l3 = ac.fuelEmergency ? '7700 FUEL' : ac.emergency ? '7700 EMERG' : ac.nordo ? `7600 NORDO${ac.clr.land ? ' LND' : ''}` : `${sp ? '#' + sp + ' ' : ''}${typeCode(ac.type)}/${t.wake}${ac.wxReq ? ' WX?' : ac.route && ac.route[0] && ac.route[0].wx ? ' WX' : ac.protocol && !ac.clr.land && ac.phase !== PH.HOLD ? ' STATE' : ac.minFuel ? ' MINFUEL' : ac.wakeWarn ? ' WAKE!' : ac.clr.land ? ' LND✓' : ac.phase === PH.APPROACH ? ' APP' : ac.phase === PH.HOLD ? ' HLD' : ''}`;
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
      if (sel === ac.id || talk) {
        ctx.fillStyle = talk ? 'rgba(8,47,60,0.92)' : 'rgba(0,30,20,0.85)';
        ctx.fillRect(tx - 3, ty - 3, bw + 4, bh + 4);
      }
      if (talk) {
        ctx.strokeStyle = 'rgba(103,232,249,0.9)';
        ctx.strokeRect(tx - 3.5, ty - 3.5, bw + 5, bh + 5);
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
    // Kompassrose am Bildrand: Peilung vom Platz aus
    ctx.strokeStyle = 'rgba(80,255,160,0.35)';
    ctx.fillStyle = 'rgba(80,255,160,0.6)';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 10) {
      const a2 = ((d - 90) * Math.PI) / 180, dx = Math.cos(a2), dy = Math.sin(a2);
      const te = Math.min(dx > 1e-6 ? (w - cx) / dx : dx < -1e-6 ? -cx / dx : 1e9, dy > 1e-6 ? (h - cy) / dy : dy < -1e-6 ? -cy / dy : 1e9);
      if (!(te > 20)) continue;
      const ex = cx + dx * te, ey = cy + dy * te;
      const l = d % 30 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - dx * l, ey - dy * l);
      ctx.stroke();
      if (d % 30 === 0 && Math.min(w, h) > 200) ctx.fillText(String(d / 10).padStart(2, '0'), ex - dx * 16, ey - dy * 16);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Ausschnitt unten links: Auto-Zoom bzw. feste Reichweite
    ctx.font = '700 10px ui-monospace, monospace';
    const zt = `${this.auto ? 'AUTO · ' : ''}${Math.round(this.view.r)} NM${this.tgt && this.tgt.focus ? ' · ' + this.tgt.focus : ''}`;
    ctx.fillStyle = 'rgba(3,20,14,0.8)';
    ctx.fillRect(6, h - 22, ctx.measureText(zt).width + 12, 16);
    ctx.fillStyle = this.tgt && this.tgt.focus ? 'rgba(103,232,249,0.95)' : 'rgba(134,239,172,0.8)';
    ctx.fillText(zt, 12, h - 10);
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
      const tf = T`TAF · ab ${fmtClock(fc.at)} ${code}`;
      const tw = ctx.measureText(tf).width;
      const warn = fc.kind === 'storm' || fc.kind === 'fog' || fc.kind === 'snow';
      ctx.fillStyle = 'rgba(3,20,14,0.8)';
      ctx.fillRect(6, 27, tw + 12, 18);
      ctx.fillStyle = warn ? 'rgba(251,191,36,0.95)' : 'rgba(134,239,172,0.75)';
      ctx.fillText(tf, 12, 40);
    }

    ctx.strokeStyle = 'rgba(80,255,160,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  // Funkwellen um das Flugzeug, das gerade spricht (bzw. eben gesprochen hat)
  talkMark(ctx, p, live) {
    const t = performance.now() / 1000;
    ctx.save();
    ctx.strokeStyle = 'rgb(103,232,249)';
    ctx.lineWidth = 2;
    if (live) {
      for (let i = 0; i < 2; i++) {
        const ph = (t * 1.4 + i / 2) % 1;
        ctx.globalAlpha = 1 - ph;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9 + ph * 16, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = live ? 1 : 0.65;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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
