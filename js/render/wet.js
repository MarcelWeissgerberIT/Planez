// Nasse Flächen bei Regen: Asphalt dunkler und glänzend, Pfützen, Spiegelungen der Lichter auf dem Boden
import * as LY from '../layout.js';
import { clamp } from '../util.js';
import { HALF_W, HALF_H } from './camera.js';
import { glowTinted } from '../assets.js';

// Maske der befestigten Flächen mit Pfützen (Weltkoordinaten, dann in den Boden-Cache-Raum projiziert)
function bakeWetMask(cache) {
  const PX = 4, X0 = -12, Y0 = -10, WW = LY.W + 24, HH = LY.H + 20;
  const w = document.createElement('canvas');
  w.width = WW * PX;
  w.height = HH * PX;
  const wg = w.getContext('2d');
  const img = wg.createImageData(w.width, w.height);
  for (let py = 0; py < w.height; py++) {
    const y = Y0 + (py + 0.5) / PX;
    for (let px = 0; px < w.width; px++) {
      const x = X0 + (px + 0.5) / PX;
      if (!LY.isPaved(x, y)) continue;
      const i = (py * w.width + px) * 4;
      img.data[i] = 20;
      img.data[i + 1] = 32;
      img.data[i + 2] = 52;
      img.data[i + 3] = 150;
    }
  }
  wg.putImageData(img, 0, 0);
  // Pfützen: dunklere, glatte Flecken nur auf befestigten Flächen
  wg.globalCompositeOperation = 'source-atop';
  let seed = 913;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 520; i++) {
    const gx = r() * WW * PX, gy = r() * HH * PX, rx = (0.25 + r() * 1.1) * PX, ry = rx * (0.4 + r() * 0.5);
    const gr = wg.createRadialGradient(gx, gy, 0, gx, gy, rx);
    gr.addColorStop(0, 'rgba(8,14,26,0.55)');
    gr.addColorStop(1, 'rgba(8,14,26,0)');
    wg.fillStyle = gr;
    wg.beginPath();
    wg.ellipse(gx, gy, rx, ry, r() * 3, 0, Math.PI * 2);
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

// Nässe folgt dem Wetter langsam (trocknet nach dem Regen ab)
export function updateWetness(r, state, dtGame) {
  const k = state.weather.kind;
  const target = k === 'storm' ? 1 : k === 'rain' ? 0.85 : 0;
  if (r.wet === undefined || r.wetState !== state) {
    r.wet = target; // neues Spiel / geladener Stand: gleich passend nass
    r.wetState = state;
  }
  const rate = target > (r.wet || 0) ? 1 / 600 : 1 / 2400; // in ~10 min nass, ~40 min trocken
  r.wet = clamp((r.wet || 0) + Math.sign(target - (r.wet || 0)) * Math.min(Math.abs(target - (r.wet || 0)), dtGame * rate), 0, 1);
  if (state.snow > 0.3) r.wet = Math.min(r.wet, 0.2);
}

export function drawWetGround(r) {
  const wet = r.wet || 0;
  if (wet < 0.03) return;
  const cam = r.cam, ctx = r.ctx, k = r.cache;
  if (!r.wetMask || r.wetMaskKey !== r.cacheKey) {
    r.wetMask = bakeWetMask(k);
    r.wetMaskKey = r.cacheKey;
  }
  const m = r.wetMask;
  const sc = cam.zoom / k.cs;
  const dx = cam.ox - k.offX * sc, dy = cam.oy - k.offY * sc;
  cam.setScreen(ctx);
  const sx0 = Math.max(0, -dx / sc), sy0 = Math.max(0, -dy / sc);
  const sx1 = Math.min(m.width, (cam.w - dx) / sc), sy1 = Math.min(m.height, (cam.h - dy) / sc);
  if (sx1 <= sx0 || sy1 <= sy0) return;
  ctx.globalAlpha = wet * 0.75;
  ctx.drawImage(m, sx0, sy0, sx1 - sx0, sy1 - sy0, dx + sx0 * sc, dy + sy0 * sc, (sx1 - sx0) * sc, (sy1 - sy0) * sc);
  ctx.globalAlpha = 1;
}

// Spiegelungen: jedes Licht über nassem Boden wirft einen senkrechten, flackernden Streifen nach unten
export function drawWetReflections(r, lights, night) {
  const wet = r.wet || 0;
  if (wet < 0.1) return;
  const { ctx, cam } = r;
  const zf = Math.max(0.55, Math.sqrt(cam.zoom));
  const vis = wet * (0.25 + 0.75 * night);
  if (vis < 0.05) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    if (L.flat || (L.z || 0) > 3) continue;
    if (!LY.isPaved(L.x, L.y)) continue;
    const base = cam.toScreen(L.x, L.y, 0);
    const src = cam.toScreen(L.x, L.y, L.z || 0);
    if (base.x < -40 || base.x > cam.w + 40 || base.y < -40 || base.y > cam.h + 60) continue;
    const s = L.s * zf * 1.1;
    const h = s * 1.6 + (base.y - src.y) * 1.2;
    const flick = 0.75 + 0.25 * Math.sin(r.time * 7 + L.x * 3.1 + L.y * 1.7);
    ctx.globalAlpha = clamp((L.a ?? 1) * vis * 0.45 * flick, 0, 0.6);
    ctx.drawImage(glowTinted(L.c, true), base.x - s * 0.22, base.y - s * 0.1, s * 0.44, h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
