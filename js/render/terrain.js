// Umland auf der Karte: Felder im Flickenteppich (je Jahreszeit Weizen, Raps, Mais, Acker, Wiese) mit Furchen und
// Hecken, ein Dorf mit Kirche im Nordwesten, Bauernhöfe, Büsche, ein Teich – außerhalb des Zauns immer, auf dem
// Flughafengelände nur, solange der Platz noch klein ist (Aufbau-Modus: Grasplatz und Verkehrslandeplatz).
import * as LY from '../layout.js';
import { IMG } from '../assets.js';
import { HALF_W } from './camera.js';

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// Felder in einem Streifen in Blöcke teilen
function strip(out, x0, x1, y0, y1, r, minW = 4, maxW = 9) {
  let x = x0;
  while (x < x1 - 1) {
    const w = Math.min(x1 - x, minW + r() * (maxW - minW));
    const split = y1 - y0 > 5 && r() < 0.45;
    if (split) {
      const ym = y0 + (y1 - y0) * (0.35 + r() * 0.3);
      out.push({ x0: x, x1: x + w, y0, y1: ym, k: r(), dir: r() < 0.5 }, { x0: x, x1: x + w, y0: ym, y1, k: r(), dir: r() < 0.5 });
    } else out.push({ x0: x, x1: x + w, y0, y1, k: r(), dir: r() < 0.5 });
    x += w;
  }
}

let cache = null;
export function terrainLayout(stage) {
  const key = stage >= 2 ? 'big' : 'small' + stage;
  if (cache && cache.key === key) return cache;
  const r = rng(424242);
  const fields = [];
  // außen herum (immer)
  strip(fields, -8, 89, -8.4, -1.5, r, 5, 10);
  strip(fields, -8, 89, 50.4, 58.6, r, 5, 11);
  for (let y = 1.5; y < 50; ) {
    const h = Math.min(50 - y, 5 + r() * 6);
    fields.push({ x0: -8.4, x1: -0.6, y0: y, y1: y + h, k: r(), dir: r() < 0.5 });
    if (y > 17.5) fields.push({ x0: 81, x1: 88.6, y0: y, y1: y + h, k: r(), dir: r() < 0.5 });
    y += h;
  }
  // auf dem späteren Flughafengelände, solange es noch Acker ist
  if (stage < 2) {
    strip(fields, 0.4, 21.6, 1.6, 10.2, r, 4.5, 8);
    if (stage === 0) strip(fields, 22.4, 42.6, 1.6, 10.2, r, 4.5, 8);
    else strip(fields, 32, 42.6, 1.6, 10.2, r, 4, 7);
    strip(fields, 50.6, stage === 0 ? 79.4 : 67.6, 1.6, 10.2, r, 4.5, 8);
  }
  // Dorf, Höfe, Kirche, Büsche
  const objs = [];
  const house = (x, y, s = 1) => objs.push({ sprite: 'house', fx: x, fy: y, w: 0.75 * s, d: 0.75 * s, frac: 0.55 });
  [[-5.6, -4.2], [-3.9, -5.6], [-2.1, -4.0], [-6.2, -2.3], [-0.4, -5.9], [1.4, -4.4], [3.2, -6.1], [-4.4, -7.6], [-1.6, -7.4], [5.0, -4.6]].forEach(([x, y], i) => house(x, y, 0.9 + (i % 3) * 0.12));
  objs.push({ sprite: 'church', fx: -1.6, fy: -2.2, w: 1.2, d: 1.2, frac: 0.45 });
  objs.push({ sprite: 'farm', fx: 66.5, fy: -2.6, w: 2.4, d: 1.5, frac: 0.36 });
  objs.push({ sprite: 'farm', fx: 23, fy: 55.5, w: 2.4, d: 1.5, frac: 0.36 });
  objs.push({ sprite: 'farm', fx: 87.2, fy: 30, w: 2.4, d: 1.5, frac: 0.36 });
  if (stage < 2) objs.push({ sprite: 'farm', fx: 14, fy: 6.2, w: 2.4, d: 1.5, frac: 0.36 });
  // Büsche entlang mancher Feldränder
  const bushes = [];
  for (const f of fields) {
    if (f.k > 0.55) continue;
    const n = Math.floor((f.x1 - f.x0) / 1.4);
    for (let i = 0; i < n; i++) if (r() < 0.55) bushes.push({ sprite: 'bush', fx: f.x0 + 0.5 + i * 1.4 + r() * 0.4, fy: f.y1 - 0.05, w: 0.32 + r() * 0.15, d: 0.3, frac: 0.51 });
  }
  cache = { key, fields, objs: objs.concat(bushes), pond: { x: 73, y: 53.6, rx: 2.6, ry: 1.4 } };
  return cache;
}

// Feldfarben je Jahreszeit: [Grundfarbe, Furche]
const CROPS = {
  spring: [['#c9cf3c', '#b9bd2e'], ['#e9d83c', '#d6c22a'], ['#6f9a3a', '#5d8730'], ['#8a6c4a', '#765a3c'], ['#7fae4b', '#6c9a3e']],
  summer: [['#d8b54c', '#c49f3c'], ['#93ad42', '#7f9936'], ['#4f7f2b', '#3f6e22'], ['#d2b65a', '#bea048'], ['#86a94a', '#72953e']],
  autumn: [['#a6865a', '#8d6f48'], ['#c7a95c', '#b3934c'], ['#6e8a3a', '#5d7830'], ['#8b6b47', '#74583a'], ['#9aa24f', '#848c43']],
  winter: [['#9c8f78', '#867a64'], ['#7d8a5a', '#6c784c'], ['#8f7c62', '#7a6852'], ['#a8a088', '#928a74'], ['#7c8b58', '#6b7a4a']],
};

export function drawTerrain(g, state, seasonId) {
  const T = terrainLayout(LY.GEO.stage);
  const pal = CROPS[seasonId] || CROPS.autumn;
  for (const f of T.fields) {
    const [base, furrow] = pal[Math.floor(f.k * pal.length)];
    const w = f.x1 - f.x0, h = f.y1 - f.y0;
    g.fillStyle = base;
    g.fillRect(f.x0 + 0.08, f.y0 + 0.08, w - 0.16, h - 0.16);
    // Furchen bzw. Fahrspuren
    g.fillStyle = furrow;
    if (f.dir) for (let x = f.x0 + 0.2; x < f.x1 - 0.15; x += 0.24) g.fillRect(x, f.y0 + 0.12, 0.07, h - 0.24);
    else for (let y = f.y0 + 0.2; y < f.y1 - 0.15; y += 0.24) g.fillRect(f.x0 + 0.12, y, w - 0.24, 0.07);
    // Feldrand: schmaler Grasstreifen, manchmal Hecke
    g.strokeStyle = 'rgba(70,95,40,0.55)';
    g.lineWidth = 0.08;
    g.strokeRect(f.x0 + 0.05, f.y0 + 0.05, w - 0.1, h - 0.1);
    if (f.k < 0.3) {
      g.strokeStyle = 'rgba(40,70,28,0.75)';
      g.lineWidth = 0.22;
      g.beginPath();
      g.moveTo(f.x0, f.y1);
      g.lineTo(f.x1, f.y1);
      g.stroke();
    }
  }
  // Feldwege
  g.fillStyle = 'rgba(160,140,100,0.65)';
  g.fillRect(-8, -4.9, 97, 0.32);
  g.fillRect(-8, 54.4, 97, 0.32);
  g.fillRect(84.6, 17, 0.32, 41);
  // Dorfstraße und Platz
  g.fillStyle = '#8e9196';
  g.fillRect(-7.5, -3.1, 14, 0.5);
  g.fillRect(-1.3, -8, 0.5, 6.6);
  // Teich mit Ufer
  const p = T.pond;
  g.fillStyle = 'rgba(90,120,60,0.9)';
  g.beginPath();
  g.ellipse(p.x, p.y, p.rx + 0.3, p.ry + 0.3, 0.3, 0, Math.PI * 2);
  g.fill();
  const wg = g.createRadialGradient(p.x, p.y, 0.2, p.x, p.y, p.rx);
  wg.addColorStop(0, '#3f7fa6');
  wg.addColorStop(1, '#2f5f7e');
  g.fillStyle = seasonId === 'winter' ? '#bcd3e0' : wg;
  g.beginPath();
  g.ellipse(p.x, p.y, p.rx, p.ry, 0.3, 0, Math.PI * 2);
  g.fill();
}

// Höfe, Häuser, Kirche, Büsche als Objekte mit Tiefensortierung
export function terrainItems(map, state, items, visible) {
  const T = terrainLayout(LY.GEO.stage);
  for (const o of T.objs) {
    if (!IMG[o.sprite] || !visible(o.fx - o.w / 2, o.fy - o.d / 2)) continue;
    items.push({ d: o.fx - o.w / 2 + o.fy - o.d / 2, f: () => drawObj(map, o) });
  }
}
function drawObj(map, o) {
  const img = IMG[o.sprite];
  const ctx = map.ctx, cam = map.cam;
  cam.setScreen(ctx);
  const dw = (o.w + o.d) * HALF_W * cam.zoom;
  const dh = (dw * img.height) / img.width;
  const fc = cam.toScreen(o.fx, o.fy);
  ctx.drawImage(img, fc.x - o.frac * dw, fc.y - dh, dw, dh);
}

// liegt ein Punkt auf einem Feld? (dort keine Einzelbäume)
export function onField(x, y) {
  const T = terrainLayout(LY.GEO.stage);
  const p = T.pond;
  if (((x - p.x) / (p.rx + 0.6)) ** 2 + ((y - p.y) / (p.ry + 0.6)) ** 2 < 1) return true;
  return T.fields.some((f) => x > f.x0 - 0.2 && x < f.x1 + 0.2 && y > f.y0 - 0.2 && y < f.y1 + 0.2);
}
