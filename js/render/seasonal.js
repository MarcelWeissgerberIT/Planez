// Jahreszeiten in der Optik: Laubbäume und Gras färben sich (Herbstlaub, kahle Winterbäume, frisches Frühlingsgrün)
import { IMG } from '../assets.js';

const cache = {};
// Pixel umfärben: nur grünliche Pixel (Laub, Gras), Stämme und Schatten bleiben
function recolor(src, fn, scale = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    if (gg < r * 0.95 || gg < b) continue; // nicht grün
    const o = fn(r, gg, b, i / 4, c.width);
    d[i] = o[0];
    d[i + 1] = o[1];
    d[i + 2] = o[2];
    if (o[3] !== undefined) d[i + 3] = Math.round(d[i + 3] * o[3]);
  }
  g.putImageData(img, 0, 0);
  return c;
}
const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
// deterministisches Rauschen je Pixel (für gesprenkeltes Laub)
const hash = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const LEAF = {
  // Herbst: drei Farbvarianten (Gold, Orange, Rostrot), gesprenkelt
  autumn: [
    (r, g, b, i) => { const k = g / 255, n = hash(i) * 0.25; return [cl(250 * k + 40 + n * 40), cl(200 * k + 10), cl(40 * k)]; },
    (r, g, b, i) => { const k = g / 255, n = hash(i) * 0.3; return [cl(255 * k + 50), cl(135 * k + 10 + n * 40), cl(30 * k)]; },
    (r, g, b, i) => { const k = g / 255, n = hash(i) * 0.3; return [cl(210 * k + 30 + n * 30), cl(80 * k + 10), cl(35 * k)]; },
  ],
  // Winter: Laub fast weg (ausgedünnt, graubraun), Äste scheinen durch
  winter: [(r, g, b, i) => { const k = g / 255; return hash(i) < 0.55 ? [cl(120 * k + 30), cl(105 * k + 28), cl(92 * k + 26), 0.15] : [cl(135 * k + 40), cl(120 * k + 35), cl(105 * k + 30), 0.85]; }],
  // Frühling: helles, frisches Grün mit ein paar Blüten
  spring: [
    (r, g, b, i) => (hash(i) < 0.06 ? [255, 214, 228] : [cl(r * 1.12 + 18), cl(g * 1.1 + 12), cl(b * 0.85)]),
    (r, g, b, i) => (hash(i + 7) < 0.05 ? [255, 250, 240] : [cl(r * 1.15 + 22), cl(g * 1.12 + 10), cl(b * 0.8)]),
  ],
};

// Baum-Sprite für die Jahreszeit (Variante je Baum, damit der Herbst bunt wird)
export function seasonalTree(name, seasonId, variant = 0) {
  if (seasonId === 'summer' || !IMG[name]) return IMG[name];
  if (name === 'tree2') {
    // Nadelbäume bleiben grün, im Winter mit hellen Spitzen
    if (seasonId !== 'winter') return IMG[name];
    const key = 'tree2|winter';
    if (!cache[key]) cache[key] = recolor(IMG[name], (r, g, b, i, w) => { const y = Math.floor(i / w) / (IMG[name].height * 0.5); return y < 0.4 && hash(i) < 0.2 + (0.4 - y) * 0.5 ? [228, 236, 244] : [cl(r * 0.78), cl(g * 0.8), cl(b * 0.88)]; }, 0.5);
    return cache[key];
  }
  const list = LEAF[seasonId];
  if (!list) return IMG[name];
  const v = variant % list.length;
  const key = `${name}|${seasonId}|${v}`;
  if (!cache[key]) cache[key] = recolor(IMG[name], list[v], 0.5);
  return cache[key];
}

// Grastextur je Jahreszeit
export function seasonalGrass(seasonId) {
  const img = IMG.tex_grass;
  if (!img || seasonId === 'summer') return img;
  const key = 'grass|' + seasonId;
  if (cache[key]) return cache[key];
  const f = {
    autumn: (r, g, b) => [cl(r * 1.18 + 14), cl(g * 0.93 + 4), cl(b * 0.7)],
    winter: (r, g, b) => [cl(r * 0.92 + 32), cl(g * 0.68 + 34), cl(b * 0.9 + 26)],
    spring: (r, g, b) => [cl(r * 1.02 + 6), cl(g * 1.1 + 10), cl(b * 0.9)],
  }[seasonId];
  if (!f) return img;
  // Gras ist durchgehend grün: ohne Grün-Test umfärben
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const o = f(d[i], d[i + 1], d[i + 2]);
    d[i] = o[0];
    d[i + 1] = o[1];
    d[i + 2] = o[2];
  }
  g.putImageData(data, 0, 0);
  return (cache[key] = c);
}
