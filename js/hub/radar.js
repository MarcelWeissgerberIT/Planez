// Großflughäfen: Anflugradar (Norden oben) – Bahnen, verlängerte Anfluglinien mit Meilen-Marken, Ringe 5/10/15 NM,
// Anflüge mit Kennung, Höhe (in 100 ft) und Geschwindigkeit, Abflüge im Steigflug, Bodenverkehr als Punkte
import { PHASE as P, NM } from './sim.js';

export class HubRadar {
  constructor(canvas, ap, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ap = ap;
    this.sim = sim;
    this.range = 15; // NM
    this.sel = null;
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
  // Welt (Kacheln) -> Radarbild: Mittelpunkt Flughafen, Maßstab nach Reichweite
  toR(x, y) {
    const c = this.ap.center;
    const k = Math.min(this.w, this.h) / 2 / (this.range * NM);
    return { x: this.w / 2 + (x - c.x) * k, y: this.h / 2 + (y - c.y) * k };
  }
  render(dt) {
    if (!this.w) this.resize();
    const g = this.ctx, sim = this.sim, ap = this.ap;
    this.sweep = (this.sweep + dt * 1.2) % (Math.PI * 2);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#031410';
    g.fillRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h / 2;
    const kNM = Math.min(this.w, this.h) / 2 / this.range;
    // Ringe
    g.strokeStyle = 'rgba(52,211,153,.18)';
    g.lineWidth = 1;
    g.font = "9px 'JetBrains Mono', monospace";
    g.fillStyle = 'rgba(52,211,153,.45)';
    for (const r of [5, 10, 15]) {
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
    // Flugzeuge
    g.font = "600 10px 'JetBrains Mono', monospace";
    for (const ac of sim.acs) {
      const p = this.toR(ac.x, ac.y);
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      const air = ac.phase === P.APP || ac.phase === P.FIN || ac.phase === P.GA || ac.phase === P.CLIMB || (ac.phase === P.TKOF && ac.z > 0.3);
      const sel = this.sel === ac.id;
      if (!air) {
        if (ac.phase === P.STAND) continue;
        g.fillStyle = sel ? '#38d6f5' : 'rgba(148,163,184,.75)';
        g.fillRect(p.x - 1, p.y - 1, 2, 2);
        continue;
      }
      const col = sel ? '#38d6f5' : ac.phase === P.GA ? '#f87171' : ac.phase === P.CLIMB || ac.phase === P.TKOF ? '#7dd3fc' : ac.req === 'land' ? '#fbbf24' : '#6ee7b7';
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
      g.fillText(ac.cs, p.x + 5, p.y - 6);
      g.globalAlpha = 0.75;
      g.fillText(`${String(alt).padStart(3, '0')} ${kt}`, p.x + 5, p.y + 5);
      g.globalAlpha = 1;
    }
    void kNM;
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
