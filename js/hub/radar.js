// Großflughäfen: Anflugradar (Norden oben) – Bahnen, verlängerte Anfluglinien mit Meilen-Marken, Entfernungsringe,
// Anflüge mit Kennung, Höhe (in 100 ft) und Geschwindigkeit, Abflüge im Steigflug, Bodenverkehr als Punkte.
// Auto-Zoom: der Luftverkehr füllt das Bild; funkt ein Flugzeug in der Luft, rückt es mit seinen Nachbarn in den Fokus.
import { PHASE as P, NM } from './sim.js';

const AIR = (ac) => ac.phase === P.APP || ac.phase === P.FIN || ac.phase === P.GA || ac.phase === P.CLIMB || (ac.phase === P.TKOF && ac.z > 0.3);

export class HubRadar {
  constructor(canvas, ap, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ap = ap;
    this.sim = sim;
    this.range = 15; // feste Reichweite (NM) ohne Auto-Zoom
    this.auto = true;
    this.view = { x: ap.center.x, y: ap.center.y, r: 15 }; // Mitte (Kacheln), Reichweite bis zum kurzen Rand (NM)
    this.tgt = null;
    this.sel = null;
    this.talk = null; // { id, live } – aktiver Funkkontakt
    this.sweep = 0;
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(10, r.width);
    this.h = Math.max(10, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
  }
  // Welt (Kacheln) -> Radarbild
  toR(x, y) {
    const v = this.view;
    const k = Math.min(this.w, this.h) / 2 / (v.r * NM);
    return { x: this.w / 2 + (x - v.x) * k, y: this.h / 2 + (y - v.y) * k };
  }
  // Bildausschnitt: alle Bahnen immer; spricht ein Flugzeug in der Luft, es selbst und alles in 5 NM Umkreis, sonst der
  // ganze Luftverkehr. Das gewählte Flugzeug bleibt im Bild.
  frame() {
    const sim = this.sim, ap = this.ap;
    const pts = [];
    for (const r of ap.runways) pts.push(r.a, r.b);
    const fa = this.talk && this.talk.id ? sim.acs.find((a) => a.id === this.talk.id) : null;
    const focus = fa && AIR(fa) ? fa : null;
    if (focus) {
      pts.push(focus);
      for (const a of sim.acs) if (a !== focus && AIR(a) && Math.hypot(a.x - focus.x, a.y - focus.y) < 5 * NM) pts.push(a);
    } else for (const a of sim.acs) if (AIR(a)) pts.push(a);
    const sa = this.sel && sim.acs.find((a) => a.id === this.sel);
    if (sa && AIR(sa)) pts.push(sa);
    let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    // Rand ringsum, rechts oben Platz für die Kennung
    const mx = 22, my = 22, lw = 64, lh = 24, half = Math.min(this.w, this.h) / 2;
    const k = Math.min(Math.max(30, this.w - 2 * mx - lw) / Math.max(1, x1 - x0), Math.max(30, this.h - 2 * my - lh) / Math.max(1, y1 - y0));
    const r = Math.max(3, Math.min(25, half / k / NM));
    const kk = half / (r * NM);
    return { x: (x0 + x1) / 2 + lw / 2 / kk, y: (y0 + y1) / 2 - lh / 2 / kk, r, focus: focus ? focus.id : null };
  }
  updateView(dt) {
    let t = { x: this.ap.center.x, y: this.ap.center.y, r: this.range, focus: null };
    if (this.auto) {
      const f = this.frame(), o = this.tgt;
      // ruhiges Bild: nachführen, wenn mehr Platz nötig ist, deutlich weniger reicht, die Mitte wandert oder der Fokus wechselt
      if (!o || f.focus !== o.focus || f.r > o.r * 1.03 || f.r < o.r * 0.82 || Math.hypot(f.x - o.x, f.y - o.y) > o.r * NM * 0.1) this.tgt = f;
      t = this.tgt;
    } else this.tgt = null;
    const v = this.view, a = 1 - Math.exp(-Math.min(0.1, dt) * 2.6);
    v.x += (t.x - v.x) * a;
    v.y += (t.y - v.y) * a;
    v.r = Math.exp(Math.log(v.r) + (Math.log(t.r) - Math.log(v.r)) * a);
  }
  // Funkwellen um das Flugzeug, das gerade spricht (bzw. eben gesprochen hat)
  talkMark(g, p, live) {
    const t = performance.now() / 1000;
    g.save();
    g.strokeStyle = 'rgb(103,232,249)';
    g.lineWidth = 2;
    if (live) {
      for (let i = 0; i < 2; i++) {
        const ph = (t * 1.4 + i / 2) % 1;
        g.globalAlpha = 1 - ph;
        g.beginPath();
        g.arc(p.x, p.y, 7 + ph * 14, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.globalAlpha = live ? 1 : 0.65;
    g.beginPath();
    g.arc(p.x, p.y, 8, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  render(dt) {
    if (!this.w) this.resize();
    const g = this.ctx, sim = this.sim, ap = this.ap;
    // reale Zeit für den Zoom (dt hier ist Bildzeit, unabhängig vom Spieltempo)
    this.updateView(dt);
    this.sweep = (this.sweep + dt * 1.2) % (Math.PI * 2);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#031410';
    g.fillRect(0, 0, this.w, this.h);
    const c = this.toR(ap.center.x, ap.center.y);
    const cx = c.x, cy = c.y;
    const kNM = Math.min(this.w, this.h) / 2 / this.view.r;
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(this.w - cx, cy), Math.hypot(cx, this.h - cy), Math.hypot(this.w - cx, this.h - cy));
    // Ringe (Abstand je nach Zoom)
    g.strokeStyle = 'rgba(52,211,153,.18)';
    g.lineWidth = 1;
    g.font = "9px 'JetBrains Mono', monospace";
    g.fillStyle = 'rgba(52,211,153,.45)';
    const step = this.view.r > 10 ? 5 : this.view.r > 5 ? 2 : 1;
    for (let r = step; r * kNM <= far; r += step) {
      g.beginPath();
      g.arc(cx, cy, r * kNM, 0, Math.PI * 2);
      g.stroke();
      g.fillText(`${r}`, cx + r * kNM * 0.71 + 2, cy - r * kNM * 0.71);
    }
    // Abtaststrahl
    const grd = g.createConicGradient ? g.createConicGradient(this.sweep - 0.5, cx, cy) : null;
    if (grd) {
      grd.addColorStop(0, 'rgba(52,211,153,0)');
      grd.addColorStop(0.08, 'rgba(52,211,153,.12)');
      grd.addColorStop(0.081, 'rgba(52,211,153,0)');
      grd.addColorStop(1, 'rgba(52,211,153,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, this.w, this.h);
    }
    // verlängerte Anfluglinien
    for (const endId of sim.cfg.arr) {
      const end = ap.ends[endId];
      const a = this.toR(end.thr.x, end.thr.y);
      const b = this.toR(end.thr.x - end.dir.x * 12 * NM, end.thr.y - end.dir.y * 12 * NM);
      g.strokeStyle = 'rgba(52,211,153,.4)';
      g.setLineDash([3, 4]);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.setLineDash([]);
      // Meilen-Marken
      for (let n = 2; n <= 12; n += 2) {
        const p = this.toR(end.thr.x - end.dir.x * n * NM, end.thr.y - end.dir.y * n * NM);
        g.fillStyle = 'rgba(52,211,153,.55)';
        g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      g.fillStyle = 'rgba(167,243,208,.85)';
      g.fillText(endId, b.x + 3, b.y);
    }
    // Bahnen
    for (const r of ap.runways) {
      const a = this.toR(r.a.x, r.a.y), b = this.toR(r.b.x, r.b.y);
      const arr = r.ends.some((e) => sim.cfg.arr.includes(e)), dep = r.ends.some((e) => sim.cfg.dep.includes(e));
      g.strokeStyle = arr && dep ? '#facc15' : arr ? '#34d399' : dep ? '#38bdf8' : '#64748b';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.lineWidth = 1;
    // Flugzeuge
    const talkId = this.talk && this.talk.id, live = !!(this.talk && this.talk.live);
    g.font = "600 10px 'JetBrains Mono', monospace";
    for (const ac of sim.acs) {
      const p = this.toR(ac.x, ac.y);
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      const air = AIR(ac);
      const sel = this.sel === ac.id, talk = talkId === ac.id;
      if (!air) {
        if (ac.phase === P.STAND && !talk) continue;
        if (talk) this.talkMark(g, p, live);
        g.fillStyle = sel || talk ? '#38d6f5' : 'rgba(148,163,184,.75)';
        g.fillRect(p.x - 1, p.y - 1, 2, 2);
        continue;
      }
      const col = sel ? '#38d6f5' : ac.phase === P.GA ? '#f87171' : ac.phase === P.CLIMB || ac.phase === P.TKOF ? '#7dd3fc' : ac.req === 'land' ? '#fbbf24' : '#6ee7b7';
      if (talk) this.talkMark(g, p, live);
      g.fillStyle = col;
      g.strokeStyle = col;
      g.beginPath();
      g.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      g.fill();
      // Vektor (1 min)
      const v = ac.spd * 60;
      const q = this.toR(ac.x + Math.cos(ac.hdg) * v, ac.y + Math.sin(ac.hdg) * v);
      g.globalAlpha = 0.6;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
      g.stroke();
      g.globalAlpha = 1;
      const alt = Math.round((ac.z * 65.6) / 100);
      const kt = Math.round(ac.spd / (0.5144 / 20));
      if (talk) {
        const tw = Math.max(g.measureText(ac.cs).width, g.measureText('000 000').width) + 6;
        g.fillStyle = 'rgba(8,47,60,.92)';
        g.fillRect(p.x + 2, p.y - 16, tw, 25);
        g.strokeStyle = 'rgba(103,232,249,.9)';
        g.strokeRect(p.x + 1.5, p.y - 16.5, tw + 1, 26);
        g.fillStyle = col;
      }
      g.fillText(ac.cs, p.x + 5, p.y - 6);
      g.globalAlpha = 0.75;
      g.fillText(`${String(alt).padStart(3, '0')} ${kt}`, p.x + 5, p.y + 5);
      g.globalAlpha = 1;
    }
    // Ausschnitt unten links: Auto-Zoom bzw. feste Reichweite, mit Fokus
    const fa = this.tgt && this.tgt.focus ? sim.acs.find((a) => a.id === this.tgt.focus) : null;
    const zt = `${this.auto ? 'AUTO · ' : ''}${Math.round(this.view.r)} NM${fa ? ' · ' + fa.cs : ''}`;
    g.font = "700 10px 'JetBrains Mono', monospace";
    g.fillStyle = 'rgba(3,20,16,.8)';
    g.fillRect(6, this.h - 21, g.measureText(zt).width + 12, 15);
    g.fillStyle = fa ? 'rgba(103,232,249,.95)' : 'rgba(110,231,183,.8)';
    g.fillText(zt, 12, this.h - 10);
  }
  pick(sx, sy) {
    let best = null;
    for (const ac of this.sim.acs) {
      if (ac.phase === P.STAND) continue;
      const p = this.toR(ac.x, ac.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < 14 && (!best || d < best.d)) best = { id: ac.id, d };
    }
    return best ? best.id : null;
  }
}
