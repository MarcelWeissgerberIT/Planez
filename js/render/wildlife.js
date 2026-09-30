// Leben am Himmel: Vogelschwärme (tagsüber, bei Vogelschlag-Gefahr kreisend über der Piste)
// und ab und zu ein Rettungshubschrauber, der über den Platz fliegt
import * as LY from '../layout.js';
import { clamp, hourOf } from '../util.js';
import { Q } from './quality.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class Wildlife {
  constructor() {
    this.flocks = [];
    this.heli = null;
    this.nextFlock = 20;
    this.nextHeli = rnd(90, 240);
  }

  update(state, dt) {
    const h = hourOf(state.time);
    const day = h > 6 && h < 20.5;
    const calm = state.weather.kind === 'clear' || state.weather.kind === 'clouds';
    const D = state.decisions && state.decisions.active ? state.decisions.active : [];
    const danger = D.some((d) => d.key === 'birds') || (state.birdRisk && state.time < state.birdRisk);
    const scare = state.rwyClosedWhy === 'Vogelvergrämung' && state.rwyClosedUntil > state.time;
    // Möwen über der Piste bei Vogelschlag-Gefahr
    if (danger && !this.flocks.some((f) => f.gulls)) this.flocks.push(this.makeFlock(true));
    for (const f of this.flocks) if (f.gulls && (scare || !danger)) f.leave = true;
    // gelegentlich ein Schwarm, der über den Platz zieht
    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = rnd(50, 140);
      if (day && calm && this.flocks.length < 2) this.flocks.push(this.makeFlock(false));
    }
    for (const f of this.flocks) {
      f.t += dt;
      if (f.gulls && !f.leave) {
        f.cx += (LY.W * 0.5 + Math.sin(f.t * 0.05) * 14 - f.cx) * Math.min(1, dt * 0.2);
      } else {
        f.cx += f.vx * dt;
        f.cy += f.vy * dt;
      }
      if (f.leave && !f.vx) {
        const a = Math.random() * Math.PI * 2;
        f.vx = Math.cos(a) * 2.2;
        f.vy = Math.sin(a) * 2.2;
      }
    }
    this.flocks = this.flocks.filter((f) => f.t < 400 && f.cx > -30 && f.cx < LY.W + 30 && f.cy > -30 && f.cy < LY.H + 30);
    // Hubschrauber
    this.nextHeli -= dt;
    if (!this.heli && this.nextHeli <= 0) {
      this.nextHeli = rnd(240, 520);
      if (state.weather.kind !== 'storm' && state.weather.kind !== 'fog') {
        const fromW = Math.random() < 0.5;
        const y0 = rnd(4, LY.H - 4), y1 = rnd(4, LY.H - 4);
        this.heli = { x: fromW ? -20 : LY.W + 20, y: y0, tx: fromW ? LY.W + 20 : -20, ty: y1, z: 4.5, spd: 2.6, t: 0 };
      }
    }
    if (this.heli) {
      const hc = this.heli;
      const d = Math.hypot(hc.tx - hc.x, hc.ty - hc.y);
      hc.hdg = Math.atan2(hc.ty - hc.y, hc.tx - hc.x);
      hc.x += ((hc.tx - hc.x) / d) * hc.spd * dt;
      hc.y += ((hc.ty - hc.y) / d) * hc.spd * dt;
      hc.t += dt;
      if (d < 1) this.heli = null;
    }
  }

  makeFlock(gulls) {
    const n = Math.round((gulls ? 16 : rnd(10, 24)) * Q.agents + 4);
    const fromW = Math.random() < 0.5;
    const f = {
      gulls,
      t: 0,
      cx: gulls ? LY.W * 0.5 : fromW ? -10 : LY.W + 10,
      cy: gulls ? LY.RWY.y : rnd(0, LY.H),
      vx: gulls ? 0 : (fromW ? 1 : -1) * rnd(1.6, 2.4),
      vy: gulls ? 0 : rnd(-0.6, 0.6),
      z: gulls ? 1.6 : rnd(3, 5),
      birds: [],
    };
    for (let i = 0; i < n; i++) f.birds.push({ ox: rnd(-2.2, 2.2), oy: rnd(-1.4, 1.4), ph: Math.random() * 6, r: rnd(1.2, 3.2), sp: rnd(0.5, 0.9) });
    return f;
  }

  // über den Flugzeugen am Boden zeichnen (Bildschirmraum)
  draw(r, state) {
    const { ctx, cam } = r;
    const t = r.time;
    cam.setScreen(ctx);
    const z = Math.max(0.35, cam.zoom);
    for (const f of this.flocks) {
      ctx.strokeStyle = f.gulls ? 'rgba(245,245,245,0.9)' : 'rgba(30,34,40,0.8)';
      ctx.lineWidth = Math.max(1, 1.2 * z);
      for (const b of f.birds) {
        let bx = f.cx + b.ox, by = f.cy + b.oy;
        if (f.gulls && !f.leave) {
          // kreisen um den Schwerpunkt
          const a = t * b.sp + b.ph;
          bx = f.cx + Math.cos(a) * b.r * 1.4;
          by = f.cy + Math.sin(a) * b.r * 0.6;
        } else {
          bx += Math.sin(t * 0.7 + b.ph) * 0.3;
          by += Math.cos(t * 0.6 + b.ph) * 0.2;
        }
        const p = cam.toScreen(bx, by, f.z + Math.sin(t + b.ph) * 0.2);
        if (p.x < -20 || p.y < -20 || p.x > cam.w + 20 || p.y > cam.h + 20) continue;
        const w = 4.5 * z, flap = Math.sin(t * 11 + b.ph * 3) * 2.2 * z;
        ctx.beginPath();
        ctx.moveTo(p.x - w, p.y - flap);
        ctx.quadraticCurveTo(p.x - w * 0.4, p.y - flap * 0.2 - 1, p.x, p.y);
        ctx.quadraticCurveTo(p.x + w * 0.4, p.y - flap * 0.2 - 1, p.x + w, p.y - flap);
        ctx.stroke();
      }
    }
    const hc = this.heli;
    if (hc) {
      // Schatten am Boden
      cam.setIso(ctx, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(hc.x + hc.z * 0.5, hc.y + hc.z * 0.2, 0.55, 0.3, hc.hdg, 0, Math.PI * 2);
      ctx.fill();
      cam.setScreen(ctx);
      const p = cam.toScreen(hc.x, hc.y, hc.z);
      const fx = Math.cos(hc.hdg), fy = Math.sin(hc.hdg);
      const tail = cam.toScreen(hc.x - fx * 1.2, hc.y - fy * 1.2, hc.z + 0.05);
      const s = 43 * cam.zoom;
      // Heckausleger
      ctx.strokeStyle = '#e8b400';
      ctx.lineWidth = Math.max(1.5, 0.09 * s);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tail.x, tail.y);
      ctx.stroke();
      // Rumpf
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 0.26 * s, 0.17 * s, Math.atan2(tail.y - p.y, tail.x - p.x), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(40,60,90,0.8)';
      ctx.beginPath();
      ctx.ellipse(p.x + (p.x - tail.x) * 0.12, p.y + (p.y - tail.y) * 0.12, 0.12 * s, 0.09 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      // Rotor: Scheibe und zwei Blätter
      const rr = 0.62 * s;
      ctx.fillStyle = 'rgba(60,60,60,0.12)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 0.12 * s, rr, rr * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,30,30,0.55)';
      ctx.lineWidth = Math.max(1, 0.04 * s);
      const a = t * 28;
      for (const k of [0, Math.PI / 2]) {
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(a + k) * rr, p.y - 0.12 * s - Math.sin(a + k) * rr * 0.5);
        ctx.lineTo(p.x + Math.cos(a + k) * rr, p.y - 0.12 * s + Math.sin(a + k) * rr * 0.5);
        ctx.stroke();
      }
      // Blitzlicht
      if (Math.floor(t * 1.5) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,60,60,0.9)';
        ctx.beginPath();
        ctx.arc(tail.x, tail.y, Math.max(1.5, 0.05 * s), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
