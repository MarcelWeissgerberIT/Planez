// Visueller Feinschliff: Reifenrauch beim Aufsetzen, Gischt auf nasser Piste, Wolken über den Wolkenschatten
import { PH } from '../sim/aircraft.js';
import { AC_TYPES } from '../config.js';
import { clamp } from '../util.js';
import { Q } from './quality.js';

export class Polish {
  constructor() {
    this.prev = new Map(); // Phase je Flugzeug
    this.parts = [];
    this.cloudImg = null;
  }

  // Ereignisse erkennen und Partikel erzeugen
  update(r, state, dt) {
    const wet = state.weather.kind === 'rain' || state.weather.kind === 'storm' || state.weather.kind === 'snow';
    const seen = new Set();
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      seen.add(ac.id);
      const p = this.prev.get(ac.id);
      const big = { S: 0.7, M: 1, L: 1.5 }[AC_TYPES[ac.type].size] || 1;
      const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
      // Aufsetzen: Reifenrauch an beiden Hauptfahrwerken
      if (p === PH.FINAL && ac.phase === PH.ROLLOUT) {
        for (const side of [-1, 1]) {
          for (let k = 0; k < 7; k++) {
            this.parts.push({ x: ac.x - fx * ac.len * 0.05 + rx * side * 0.12 * big, y: ac.y - fy * ac.len * 0.05 + ry * side * 0.12 * big, z: 0.03, vx: -fx * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.3, vy: -fy * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.3, vz: 0.05 + Math.random() * 0.08, life: 0, dur: 1.6 + Math.random() * 1.2, r: 0.12 * big, grow: 0.5 * big, c: '235,235,235', a: 0.55 });
          }
        }
      }
      // Gischt hinter den Triebwerken bei nasser Piste (Ausrollen und Startlauf)
      if (wet && (ac.phase === PH.ROLLOUT || ac.phase === PH.TAKEOFF) && ac.z < 0.3 && Math.random() < dt * 30 * Q.agents) {
        const sp = ac.phase === PH.TAKEOFF ? 1.3 : 0.9;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.parts.push({ x: ac.x - fx * ac.len * 0.3 + rx * side * 0.25 * big, y: ac.y - fy * ac.len * 0.3 + ry * side * 0.25 * big, z: 0.02, vx: -fx * sp * (0.8 + Math.random()), vy: -fy * sp * (0.8 + Math.random()), vz: 0.03, life: 0, dur: 1 + Math.random() * 0.8, r: 0.1, grow: 0.9 * big, c: state.weather.kind === 'snow' ? '250,252,255' : '215,225,235', a: 0.38 });
      }
      this.prev.set(ac.id, ac.phase);
    }
    for (const id of this.prev.keys()) if (!seen.has(id)) this.prev.delete(id);
    for (const q of this.parts) {
      q.life += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.vx *= 0.97;
      q.vy *= 0.97;
    }
    this.parts = this.parts.filter((q) => q.life < q.dur);
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
  }

  drawParticles(r) {
    const { ctx, cam } = r;
    if (!this.parts.length) return;
    cam.setScreen(ctx);
    for (const q of this.parts) {
      const u = q.life / q.dur;
      const s = cam.toScreen(q.x, q.y, q.z);
      const rad = (q.r + q.grow * u) * 32 * cam.zoom;
      const a = q.a * (1 - u) * clamp(u * 8, 0, 1);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad);
      g.addColorStop(0, `rgba(${q.c},${a})`);
      g.addColorStop(1, `rgba(${q.c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(s.x - rad, s.y - rad, rad * 2, rad * 2);
    }
  }

  // Wolken in der Höhe, passend zu den Wolkenschatten (gleiche Bahn, Versatz durch Sonnenstand)
  drawClouds(r, state) {
    const kind = state.weather.kind;
    if (kind !== 'clouds' && kind !== 'rain' && kind !== 'storm' && kind !== 'snow') return;
    const { ctx, cam } = r;
    // bei starkem Zoom unsichtbar (die Kamera ist „unter“ den Wolken)
    const vis = clamp((1.15 - cam.zoom) / 0.6, 0, 1);
    if (vis <= 0.02) return;
    if (!this.cloudImg) this.cloudImg = makeCloud();
    const n = kind === 'clouds' ? 5 : 8;
    const t = r.time * 0.25 + state.time * 0.002;
    const wd = ((state.wind.dir + 180 - 90) * Math.PI) / 180;
    const dark = kind === 'storm' ? 0.55 : kind === 'rain' || kind === 'snow' ? 0.8 : 1;
    cam.setScreen(ctx);
    for (let i = 0; i < n; i++) {
      const bx = ((i * 37.7 + Math.cos(wd) * t * 3) % 120) - 20;
      const by = ((i * 23.3 + Math.sin(wd) * t * 3) % 70) - 14;
      const x = ((bx % 120) + 120) % 120 - 20, y = ((by % 70) + 70) % 70 - 14;
      const rx = 7 + (i % 3) * 3;
      // Schatten liegt rechts unten versetzt: Wolke entsprechend links oben in 7 Kacheln Höhe
      const s = cam.toScreen(x - 2.2, y - 1.2, 7);
      const w = rx * 2.6 * 32 * cam.zoom, h = w * 0.55;
      ctx.globalAlpha = vis * (kind === 'clouds' ? 0.5 : 0.62);
      ctx.filter = dark < 1 ? `brightness(${dark})` : 'none';
      ctx.drawImage(this.cloudImg, s.x - w / 2, s.y - h / 2, w, h);
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }
}

// weiche Kumuluswolke aus überlagerten Kreisen
function makeCloud() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 280;
  const g = c.getContext('2d');
  let seed = 99;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = 90 + r() * 330, y = 90 + r() * 110 - Math.abs(x - 256) * 0.12;
    const rad = 40 + r() * 70;
    const gr = g.createRadialGradient(x, y - rad * 0.3, rad * 0.1, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.6, 'rgba(236,241,248,0.6)');
    gr.addColorStop(1, 'rgba(220,228,240,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // Unterseite etwas dunkler
  g.globalCompositeOperation = 'source-atop';
  const sh = g.createLinearGradient(0, 80, 0, 280);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(90,105,125,0.35)');
  g.fillStyle = sh;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
