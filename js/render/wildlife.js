// Leben am Himmel: Vogelschwärme (tagsüber, bei Vogelschlag-Gefahr kreisend über der Piste)
// und ab und zu ein Rettungshubschrauber, der über den Platz fliegt; am Boden Feldhasen im Gras zwischen den Bahnen,
// die vor rollenden Flugzeugen davonhoppeln
import * as LY from '../layout.js';
import { clamp, hourOf } from '../util.js';
import { Q } from './quality.js';
import { T } from '../i18n.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class Wildlife {
  constructor() {
    this.flocks = [];
    this.heli = null;
    this.nextFlock = 20;
    this.nextHeli = rnd(90, 240);
    // Feldhasen: im Gras südlich der Nordbahn und am Südrand
    this.hares = Array.from({ length: 7 }, (_, i) => {
      const band = i % 2 ? [34.3, 36.2] : [44.6, 48.8];
      return { x: rnd(7, 73), y: rnd(band[0], band[1]), y0: band[0], y1: band[1], hdg: rnd(0, 6.28), st: 'sit', t: rnd(1, 6), hop: 0 };
    });
  }

  // Hasen: sitzen, ab und zu ein Hüpfer, Flucht vor rollenden Flugzeugen
  updateHares(state, dt) {
    for (const h of this.hares) {
      const near = state.acs.some((a) => a.mode === 'map' && (a.z || 0) < 0.6 && a.v > 0.02 && Math.hypot(a.x - h.x, a.y - h.y) < 4);
      h.t -= dt;
      if (h.st === 'hop') {
        const sp = h.flee ? 2.4 : 0.9;
        h.x += Math.cos(h.hdg) * sp * dt;
        h.y += Math.sin(h.hdg) * sp * dt;
        h.hop += dt * (h.flee ? 9 : 6);
        if (h.y < h.y0 || h.y > h.y1) {
          h.y = clamp(h.y, h.y0, h.y1);
          h.hdg = -h.hdg;
        }
        h.x = clamp(h.x, 5, 75);
        if (h.t <= 0) {
          h.st = 'sit';
          h.flee = false;
          h.t = rnd(2, 9);
        }
      } else if (near && !h.flee) {
        const a = state.acs.find((o) => o.mode === 'map' && Math.hypot(o.x - h.x, o.y - h.y) < 4);
        h.hdg = a ? Math.atan2(h.y - a.y, h.x - a.x) : rnd(0, 6.28);
        h.st = 'hop';
        h.flee = true;
        h.t = rnd(1.2, 2);
      } else if (h.t <= 0) {
        h.st = 'hop';
        h.hdg += rnd(-1.2, 1.2);
        h.t = rnd(0.4, 1.2);
      }
    }
  }

  update(state, dt) {
    const h = hourOf(state.time);
    const day = h > 6 && h < 20.5;
    const calm = state.weather.kind === 'clear' || state.weather.kind === 'clouds';
    const D = state.decisions && state.decisions.active ? state.decisions.active : [];
    const danger = D.some((d) => d.key === 'birds') || (state.birdRisk && state.time < state.birdRisk);
    const scare = state.rwyClosedWhy === T('Vogelvergrämung') && state.rwyClosedUntil > state.time;
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
    this.updateHares(state, dt);
    if (!this.heli && this.nextHeli <= 0 && !(state.heli && state.heli.h)) {
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
    // Hasen (nur bei Tag und nah genug herangezoomt)
    const hr = hourOf(state.time);
    if (cam.zoom >= 0.75 && hr > 5.5 && hr < 21.5 && state.weather.kind !== 'storm') {
      for (const h of this.hares) {
        const lift = h.st === 'hop' ? Math.abs(Math.sin(h.hop * Math.PI)) * 0.08 : 0;
        const p = cam.toScreen(h.x, h.y, lift);
        if (p.x < -20 || p.y < -20 || p.x > cam.w + 20 || p.y > cam.h + 20) continue;
        const g = cam.toScreen(h.x, h.y, 0);
        const s = 3.2 * z;
        const dir = Math.cos(h.hdg) - Math.sin(h.hdg) >= 0 ? 1 : -1; // schaut im Bild nach rechts oder links
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(g.x, g.y, s * 1.3, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8a6a48';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - s * 0.7, s * 1.15, s * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(p.x + dir * s * 0.95, p.y - s * 1.25, s * 0.5, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b5136';
        ctx.fillRect(p.x + dir * s * 0.8, p.y - s * 2.5, Math.max(1, s * 0.22), s * 1.05);
        ctx.fillRect(p.x + dir * s * 1.08, p.y - s * 2.4, Math.max(1, s * 0.22), s * 0.95);
        ctx.fillStyle = '#f1f5f9';
        ctx.beginPath();
        ctx.arc(p.x - dir * s * 1.05, p.y - s * 0.75, s * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Vögel von oben: Rumpf in Flugrichtung, Flügel quer dazu, beim Flügelschlag kürzer (Verkürzung); Größe etwa
    // maßstäblich (Möwe ≈ 1,8 m Spannweite, gut erkennbar), aber nie kleiner als ein paar Pixel; Möwen hell mit dunklen Spitzen,
    // Zugvögel als dunkle Silhouetten
    for (const f of this.flocks) {
      const span = Math.max(f.gulls ? 7 : 6, (f.gulls ? 0.09 : 0.07) * 36 * cam.zoom) / 2;
      for (const b of f.birds) {
        let bx = f.cx + b.ox, by = f.cy + b.oy, dx = f.vx || 1, dy = f.vy || 0;
        if (f.gulls && !f.leave) {
          // kreisen um den Schwerpunkt, Blick entlang der Kreisbahn
          const a = t * b.sp + b.ph;
          bx = f.cx + Math.cos(a) * b.r * 1.4;
          by = f.cy + Math.sin(a) * b.r * 0.6;
          dx = -Math.sin(a) * 1.4;
          dy = Math.cos(a) * 0.6;
        } else {
          bx += Math.sin(t * 0.7 + b.ph) * 0.3;
          by += Math.cos(t * 0.6 + b.ph) * 0.2;
        }
        const p = cam.toScreen(bx, by, f.z + Math.sin(t + b.ph) * 0.2);
        if (p.x < -20 || p.y < -20 || p.x > cam.w + 20 || p.y > cam.h + 20) continue;
        // Möwen gleiten meist und schlagen nur ab und zu, kleine Vögel flattern schnell
        const ph = Math.sin(t * (f.gulls ? 7 : 13) + b.ph * 3);
        const glide = f.gulls ? Math.max(0, Math.sin(t * 0.8 + b.ph)) : 1;
        const sf = 1 - 0.45 * glide * ph * ph;
        drawBird(ctx, p.x, p.y, Math.atan2((dx + dy) * 16, (dx - dy) * 32), span, sf, f.gulls);
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

// ein Vogel von oben (Bildschirmraum): Mitte x, y, Flugrichtung ang, halbe Spannweite s, Flügelverkürzung sf
function drawBird(ctx, x, y, ang, s, sf, gull) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const w = s * sf;
  // Flügel: vorn gewölbt mit Knick (Handgelenk), hinten leicht eingebuchtet, Spitzen nach hinten gezogen
  ctx.fillStyle = gull ? '#d9dee4' : 'rgba(38,40,44,0.92)';
  ctx.beginPath();
  for (const k of [-1, 1]) {
    ctx.moveTo(s * 0.14, 0);
    ctx.quadraticCurveTo(s * 0.26, k * w * 0.45, s * 0.02, k * w * 0.62);
    ctx.quadraticCurveTo(-s * 0.1, k * w * 0.86, -s * 0.3, k * w);
    ctx.quadraticCurveTo(-s * 0.16, k * w * 0.55, -s * 0.2, k * w * 0.16);
    ctx.lineTo(-s * 0.12, 0);
  }
  ctx.fill();
  if (gull) {
    // schwarze Flügelspitzen
    ctx.fillStyle = '#23262b';
    ctx.beginPath();
    for (const k of [-1, 1]) {
      ctx.moveTo(-s * 0.04, k * w * 0.78);
      ctx.quadraticCurveTo(-s * 0.14, k * w * 0.9, -s * 0.3, k * w);
      ctx.quadraticCurveTo(-s * 0.2, k * w * 0.84, -s * 0.18, k * w * 0.72);
    }
    ctx.fill();
  }
  // Rumpf mit Kopf und Schwanz
  ctx.fillStyle = gull ? '#f6f7f9' : 'rgba(30,32,36,0.95)';
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.4, s * 0.1, 0, 0, Math.PI * 2);
  ctx.moveTo(-s * 0.32, 0);
  ctx.lineTo(-s * 0.56, -s * 0.11);
  ctx.lineTo(-s * 0.56, s * 0.11);
  ctx.closePath();
  ctx.fill();
  if (gull) {
    ctx.fillStyle = '#e8a33a'; // Schnabel
    ctx.fillRect(s * 0.38, -s * 0.025, s * 0.1, s * 0.05);
  }
  ctx.restore();
}
