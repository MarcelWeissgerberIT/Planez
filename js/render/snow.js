// Winter-Darstellung: Schneedecke, verschneite Pisten, Räumfahrzeuge, Enteisungs-Sprühnebel, Schneefall, verschneite Dächer
import { IMG } from '../assets.js';
import * as LY from '../layout.js';
import { clamp } from '../util.js';
import { HALF_W, HALF_H } from './camera.js';
import { drawVehicleBody } from './volume.js';

// Maske der Schneedecke: erst in Weltkoordinaten (4 px je Kachel), dann in den Boden-Cache-Raum projiziert (ohne Nahtlinien)
export function bakeSnowMask(cache, state) {
  const PX = 4, X0 = -12, Y0 = -10, WW = LY.W + 24, HH = LY.H + 20;
  const w = document.createElement('canvas');
  w.width = WW * PX;
  w.height = HH * PX;
  const wg = w.getContext('2d');
  const img = wg.createImageData(w.width, w.height);
  let seed = 4711;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let py = 0; py < w.height; py++) {
    const y = Y0 + (py + 0.5) / PX;
    for (let px = 0; px < w.width; px++) {
      const x = X0 + (px + 0.5) / PX;
      let a = 1;
      if (LY.isPaved(x, y)) {
        const rwy = Math.abs(y - LY.RWY.y) < LY.RWY.hw + 0.3 || (state.upgrades.rwy2 && Math.abs(y - LY.RWY_S.y) < LY.RWY_S.hw + 0.3);
        a = rwy ? 0 : y < 1.2 ? 0.2 : 0.42; // Pisten eigene Schicht, Straße geräumt, Vorfeld halb
      }
      const i = (py * w.width + px) * 4;
      img.data[i] = 246;
      img.data[i + 1] = 249;
      img.data[i + 2] = 253;
      img.data[i + 3] = Math.round(255 * a * (0.9 + r() * 0.1));
    }
  }
  wg.putImageData(img, 0, 0);
  // Spuren und Flecken
  wg.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    wg.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.18})`;
    wg.beginPath();
    wg.ellipse((r() * WW) * PX, (r() * HH) * PX, (0.3 + r() * 1.4) * PX, (0.2 + r() * 0.6) * PX, r() * 3, 0, Math.PI * 2);
    wg.fill();
  }
  const c = document.createElement('canvas');
  c.width = cache.c.width;
  c.height = cache.c.height;
  const g = c.getContext('2d');
  const cs = cache.cs;
  g.setTransform(HALF_W * cs, HALF_H * cs, -HALF_W * cs, HALF_H * cs, cache.offX, cache.offY);
  g.imageSmoothingEnabled = true;
  g.drawImage(w, X0, Y0, WW, HH);
  return c;
}

// Schneedecke über den Boden legen (sichtbarer Ausschnitt wie beim Boden-Cache)
export function drawSnowCover(r, state) {
  const snow = state.snow || 0;
  if (snow < 0.02) return;
  const cam = r.cam, ctx = r.ctx, k = r.cache;
  if (!r.snowMask || r.snowMaskKey !== r.cacheKey) {
    r.snowMask = bakeSnowMask(k, state);
    r.snowMaskKey = r.cacheKey;
  }
  const m = r.snowMask;
  const sc = cam.zoom / k.cs;
  const dx = cam.ox - k.offX * sc, dy = cam.oy - k.offY * sc;
  cam.setScreen(ctx);
  const sx0 = Math.max(0, -dx / sc), sy0 = Math.max(0, -dy / sc);
  const sx1 = Math.min(m.width, (cam.w - dx) / sc), sy1 = Math.min(m.height, (cam.h - dy) / sc);
  ctx.globalAlpha = clamp(snow * 1.15, 0, 0.92);
  if (sx1 > sx0 && sy1 > sy0) ctx.drawImage(m, sx0, sy0, sx1 - sx0, sy1 - sy0, dx + sx0 * sc, dy + sy0 * sc, (sx1 - sx0) * sc, (sy1 - sy0) * sc);
  ctx.globalAlpha = 1;
}

// Pisten: Schneebelag nach Kontamination, beim Räumen geräumter Streifen hinter den Pflügen
export function drawRunwaySnow(r, state) {
  if (!state.rwySnow) return;
  const { ctx, cam } = r;
  cam.setIso(ctx, 0);
  for (const strip of state.upgrades.rwy2 ? ['N', 'S'] : ['N']) {
    const rw = strip === 'S' ? LY.RWY_S : LY.RWY;
    const c = state.rwySnow[strip] || 0;
    if (c < 0.02) continue;
    ctx.fillStyle = `rgba(240,245,252,${clamp(c * 1.4, 0, 0.85)})`;
    ctx.fillRect(rw.x0, rw.y - rw.hw, rw.x1 - rw.x0, rw.hw * 2);
    // Reifenspuren
    ctx.fillStyle = `rgba(60,66,74,${clamp(c, 0, 0.35)})`;
    for (const o of [-0.22, 0.22]) ctx.fillRect(rw.x0 + 4, rw.y + o - 0.03, rw.x1 - rw.x0 - 8, 0.06);
  }
}

// Räumfahrzeuge in Staffelformation auf der gesperrten Bahn
// Räumkolonne auf der Bahn: drei Pflüge und ein Enteiser gestaffelt, zwei Durchgänge (hin und zurück)
export function plowFleet(state) {
  const p = state.plow;
  if (!p) return [];
  const rw = p.strip === 'S' ? LY.RWY_S : LY.RWY;
  const u = clamp((state.time - p.start) / Math.max(1, p.until - p.start), 0, 1);
  const pass = u < 0.5 ? u * 2 : (1 - u) * 2;
  const dir = u < 0.5 ? 1 : -1;
  const x = rw.x0 + 2 + (rw.x1 - rw.x0 - 4) * pass;
  return [-0.42, -0.14, 0.14, 0.42].map((o, i) => ({ id: 'plow' + i, type: i === 3 ? 'deice' : 'plow', x: x - dir * i * 0.9, y: rw.y + o, hdg: dir > 0 ? 0 : Math.PI, dir, o, st: 'drive' }));
}

export function plowItems(r, state, items, lights) {
  plowFleet(state).forEach(({ x: vx, y: vy, dir, o }, i) => {
    items.push({
      d: vx + vy,
      f: () => {
        drawVehicleBody(r.ctx, r.cam, i === 3 ? 'veh_deice' : 'veh_plow', vx, vy, dir > 0 ? 0 : Math.PI, 0.85, 0.34, 0.14);
        // Schneefahne seitlich
        const { ctx, cam } = r;
        cam.setScreen(ctx);
        for (let k = 0; k < 5; k++) {
          const ph = (r.time * 1.6 + k / 5 + i * 0.13) % 1;
          const s = cam.toScreen(vx + dir * 0.45 - dir * ph * 0.6, vy + (o < 0 ? -1 : 1) * (0.2 + ph * 0.7), 0.1 + ph * 0.25);
          ctx.fillStyle = `rgba(250,252,255,${0.55 * (1 - ph)})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, (2 + ph * 6) * cam.zoom, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    });
    if ((r.time * 1.3 + i * 0.25) % 1 < 0.5) lights.push({ x: vx, y: vy, z: 0.22, c: '#ffae00', s: 16, a: 0.9, day: true });
  });
}

// Enteisung: orangefarbener Sprühnebel und Dampf zwischen Fahrzeug und Tragfläche
export function deiceFx(r, state, items) {
  for (const v of state.vehicles) {
    if (v.type !== 'deice' || v.st !== 'work' || !v.job) continue;
    const ac = state.acs.find((a) => a.id === v.job.ac);
    if (!ac) continue;
    items.push({
      d: v.x + v.y + 0.2,
      f: () => {
        const { ctx, cam } = r;
        cam.setScreen(ctx);
        const t = r.time;
        const top = cam.toScreen(v.x, v.y, 0.55);
        for (let k = 0; k < 14; k++) {
          const ph = (t * 0.9 + k / 14) % 1;
          const wing = Math.sin(t * 0.7 + k) * 0.5;
          const tx = ac.x + Math.cos(ac.hdg) * wing * ac.len * 0.3, ty = ac.y + Math.sin(ac.hdg) * wing * ac.len * 0.3;
          const s = cam.toScreen(v.x + (tx - v.x) * ph, v.y + (ty - v.y) * ph, 0.55 - ph * 0.3);
          ctx.fillStyle = k % 3 ? `rgba(255,150,40,${0.5 * (1 - ph)})` : `rgba(240,244,250,${0.45 * (1 - ph)})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, (1.5 + ph * (k % 3 ? 4 : 9)) * cam.zoom, 0, Math.PI * 2);
          ctx.fill();
        }
        // Korb am Ausleger
        ctx.fillStyle = '#f97316';
        ctx.fillRect(top.x - 3 * cam.zoom, top.y - 3 * cam.zoom, 6 * cam.zoom, 5 * cam.zoom);
      },
    });
  }
}

// Schneefall (Bildschirmpartikel mit Wind)
export function drawSnowfall(r, dt, state) {
  const { ctx, cam } = r;
  const n = 420;
  if (!r.flakes) r.flakes = [];
  while (r.flakes.length < n) r.flakes.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, v: 30 + Math.random() * 50, s: 0.8 + Math.random() * 2.2, ph: Math.random() * 6 });
  cam.setScreen(ctx);
  const wx = Math.sin(((state.wind.dir + 180) * Math.PI) / 180) * (0.3 + state.wind.spd / 25);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const f of r.flakes) {
    f.y += f.v * dt;
    f.x += (f.v * wx + Math.sin(r.time * 1.3 + f.ph) * 12) * dt;
    if (f.y > cam.h) {
      f.y = -5;
      f.x = Math.random() * cam.w;
    }
    if (f.x > cam.w) f.x -= cam.w;
    if (f.x < 0) f.x += cam.w;
    ctx.globalAlpha = 0.45 + (f.s / 3) * 0.5;
    ctx.fillRect(f.x, f.y, f.s, f.s);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(210,220,235,0.12)';
  ctx.fillRect(0, 0, cam.w, cam.h);
}

// verschneite Variante eines Gebäude-Sprites (weißer Verlauf von oben = Dächer)
const snowyCache = {};
export function snowySprite(name) {
  if (snowyCache[name] !== undefined) return snowyCache[name];
  const im = IMG[name];
  if (!im) return (snowyCache[name] = null);
  const c = document.createElement('canvas');
  const s = Math.min(1, 512 / Math.max(im.width, im.height));
  c.width = Math.round(im.width * s);
  c.height = Math.round(im.height * s);
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, 0, c.height);
  gr.addColorStop(0, 'rgba(250,252,255,0.85)');
  gr.addColorStop(0.45, 'rgba(250,252,255,0.55)');
  gr.addColorStop(0.62, 'rgba(250,252,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  return (snowyCache[name] = c);
}
