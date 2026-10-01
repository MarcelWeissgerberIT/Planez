// Visueller Feinschliff: Reifenrauch beim Aufsetzen, Gischt auf nasser Piste, Wolken über den Wolkenschatten,
// Kondensfahnen an den Flügelspitzen bei feuchter Luft (Endanflug, Abheben, Durchstarten)
import { PH } from '../sim/aircraft.js';
import { AC_TYPES } from '../config.js';
import { clamp, hourOf } from '../util.js';
import { Q } from './quality.js';

const TRAIL_S = 0.8; // Sekunden, die eine Kondensfahne sichtbar bleibt

export class Polish {
  constructor() {
    this.prev = new Map(); // Phase je Flugzeug
    this.parts = [];
    this.cloudImg = null;
    this.trails = new Map(); // Flugzeug -> Wirbelschleppen-Punkte (linke/rechte Flügelspitze)
    this.t = 0;
  }

  // Ereignisse erkennen und Partikel erzeugen
  update(r, state, dt) {
    this.t += dt;
    const kind = state.weather.kind;
    const humid = Q.agents > 0.3 && (kind === 'rain' || kind === 'storm' || kind === 'fog' || kind === 'snow' || (kind === 'clouds' && hourOf(state.time) < 10));
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
        // je härter die Landung, desto mehr Rauch (Aufsetzrate in ft/min); Butterlandungen nur ein Hauch
        const hard = ac.tdFpm ? Math.max(0.35, Math.min(2.2, ac.tdFpm / 260)) : 1;
        for (const side of [-1, 1]) {
          for (let k = 0; k < Math.round(7 * hard); k++) {
            this.parts.push({ x: ac.x - fx * ac.len * 0.05 + rx * side * 0.12 * big, y: ac.y - fy * ac.len * 0.05 + ry * side * 0.12 * big, z: 0.03, vx: -fx * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.3, vy: -fy * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.3, vz: 0.05 + Math.random() * 0.08, life: 0, dur: 1.6 + Math.random() * 1.2, r: 0.12 * big, grow: 0.5 * big * Math.sqrt(hard), c: '235,235,235', a: 0.55 });
          }
        }
      }
      // Gischt hinter den Triebwerken bei nasser Piste (Ausrollen und Startlauf)
      if (wet && (ac.phase === PH.ROLLOUT || ac.phase === PH.TAKEOFF) && ac.z < 0.3 && Math.random() < dt * 30 * Q.agents) {
        const sp = ac.phase === PH.TAKEOFF ? 1.3 : 0.9;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.parts.push({ x: ac.x - fx * ac.len * 0.3 + rx * side * 0.25 * big, y: ac.y - fy * ac.len * 0.3 + ry * side * 0.25 * big, z: 0.02, vx: -fx * sp * (0.8 + Math.random()), vy: -fy * sp * (0.8 + Math.random()), vz: 0.03, life: 0, dur: 1 + Math.random() * 0.8, r: 0.1, grow: 0.9 * big, c: state.weather.kind === 'snow' ? '250,252,255' : '215,225,235', a: 0.38 });
      }
      // Brand/Rauch: dunkle Rauchfahne vom Triebwerk, bis die Feuerwehr gelöscht hat
      if (ac.emergency && (ac.emgKind === 'engine' || ac.emgKind === 'smoke') && !ac.fireDone && Math.random() < dt * 14 * Q.agents) {
        const fa = state.fireAlert;
        const k = fa && fa.ac === ac.id ? clamp(1 - (fa.sprayed || 0) / 110, 0.1, 1) : 1;
        const side = ac.emgKind === 'engine' ? 1 : 0;
        const moving = ac.fireStop ? 0 : 1;
        this.parts.push({ x: ac.x + rx * side * 0.32 * big - fx * 0.1, y: ac.y + ry * side * 0.32 * big - fy * 0.1, z: Math.max(0.12, ac.z + 0.1), vx: -fx * moving * 0.8 + (Math.random() - 0.5) * 0.08, vy: -fy * moving * 0.8 + (Math.random() - 0.5) * 0.08, vz: 0.12 + Math.random() * 0.1, life: 0, dur: 2.2 + Math.random() * 1.5, r: 0.1 * big, grow: 0.8 * big, c: ac.emgKind === 'engine' ? '52,52,56' : '120,120,126', a: 0.55 * k });
      }
      // Kondensfahnen: Die Flügelspitzen ziehen bei feuchter Luft dünne weiße Fäden hinter sich her
      const vap = humid && ((ac.phase === PH.FINAL && ac.z > 0.12) || ((ac.phase === PH.TAKEOFF || ac.phase === PH.MISSED) && ac.z > 0.08 && ac.z < 3.5));
      if (vap) {
        let tr = this.trails.get(ac.id);
        if (!tr) this.trails.set(ac.id, (tr = []));
        const last = tr[tr.length - 1];
        if (!last || this.t - last.t > 0.05) {
          const half = ac.len * 0.47, zw = ac.z + 0.1 * big;
          tr.push({ t: this.t, ax: ac.x + rx * half, ay: ac.y + ry * half, bx: ac.x - rx * half, by: ac.y - ry * half, z: zw });
        }
      }
      this.prev.set(ac.id, ac.phase);
    }
    for (const [id, tr] of this.trails) {
      while (tr.length && this.t - tr[0].t > TRAIL_S) tr.shift();
      if (!tr.length || !seen.has(id)) this.trails.delete(id);
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
    if (this.trails.size) this.drawTrails(r);
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

  drawTrails(r) {
    const { ctx, cam } = r;
    cam.setScreen(ctx);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, 1.3 * cam.zoom);
    for (const tr of this.trails.values()) {
      for (let i = 1; i < tr.length; i++) {
        const p = tr[i - 1], q = tr[i];
        const a = 0.42 * (1 - (this.t - q.t) / TRAIL_S) * clamp((this.t - q.t) * 10, 0, 1);
        if (a <= 0.01) continue;
        ctx.strokeStyle = `rgba(245,248,252,${a})`;
        ctx.beginPath();
        let s0 = cam.toScreen(p.ax, p.ay, p.z), s1 = cam.toScreen(q.ax, q.ay, q.z);
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        s0 = cam.toScreen(p.bx, p.by, p.z);
        s1 = cam.toScreen(q.bx, q.by, q.z);
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
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
    // abgedunkelte Varianten vorberechnen (ctx.filter ist pro Bild sehr teuer)
    const dk = kind === 'storm' ? 'storm' : kind === 'rain' || kind === 'snow' ? 'rain' : 'clear';
    this.cloudDark = this.cloudDark || {};
    if (!this.cloudDark[dk]) this.cloudDark[dk] = dk === 'clear' ? this.cloudImg : darken(this.cloudImg, dk === 'storm' ? 0.55 : 0.8);
    const img = this.cloudDark[dk];
    const n = kind === 'clouds' ? 5 : 8;
    const t = r.time * 0.25 + state.time * 0.002;
    const wd = ((state.wind.dir + 180 - 90) * Math.PI) / 180;
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
      if (s.x + w / 2 < 0 || s.x - w / 2 > cam.w || s.y + h / 2 < 0 || s.y - h / 2 > cam.h) continue;
      ctx.drawImage(img, s.x - w / 2, s.y - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
  }
}

function darken(src, f) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(0,0,0,${1 - f})`;
  g.fillRect(0, 0, c.width, c.height);
  return c;
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
