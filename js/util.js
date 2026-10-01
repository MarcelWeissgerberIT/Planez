import { LOCALE, EN } from './i18n.js';
// Kleine Helfer: Mathe, Zufall, Formatierung
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function angNorm(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export const degNorm = (d) => ((d % 360) + 360) % 360;
export function degDiff(a, b) {
  // kleinste Differenz b - a in Grad (-180..180)
  let d = degNorm(b) - degNorm(a);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
// Kompasskurs (0 = Nord, im Uhrzeigersinn) zwischen zwei Punkten (x = Ost, y = Süd)
export const bearing = (ax, ay, bx, by) => degNorm(Math.atan2(bx - ax, -(by - ay)) / DEG);

// Deterministischer Zufall, Zustand liegt im Spielstand (speicherbar)
export function rand(state) {
  let t = (state.seed = (state.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randRange = (s, a, b) => a + rand(s) * (b - a);
export const randInt = (s, a, b) => Math.floor(randRange(s, a, b + 1));
export const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
export function pickWeighted(s, arr, wf) {
  const total = arr.reduce((t, x) => t + wf(x), 0);
  let r = rand(s) * total;
  for (const x of arr) {
    r -= wf(x);
    if (r <= 0) return x;
  }
  return arr[arr.length - 1];
}

const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtInt = (v) => nf0.format(Math.round(v));
export function fmtMoney(v, short = true) {
  const s = v < 0 ? '−' : '';
  const a = Math.abs(v);
  // Englisch: €1.25m / €12.5k / €950
  if (EN) return short && a >= 1e6 ? `${s}€${nf2.format(a / 1e6)}m` : short && a >= 1e4 ? `${s}€${nf1.format(a / 1e3)}k` : `${s}€${nf0.format(a)}`;
  if (short && a >= 1e6) return `${s}${nf2.format(a / 1e6)} Mio €`;
  if (short && a >= 1e4) return `${s}${nf1.format(a / 1e3)} Tsd €`;
  return `${s}${nf0.format(a)} €`;
}
export function fmtClock(t) {
  const m = Math.floor(((t % 86400) + 86400) % 86400 / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export const dayOf = (t) => Math.floor(t / 86400) + 1;
export const hourOf = (t) => (((t % 86400) + 86400) % 86400) / 3600;
export function fmtDur(sec) {
  const m = Math.round(sec / 60);
  if (Math.abs(m) < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(Math.abs(m) % 60).padStart(2, '0')}`;
}
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Polyline mit abgerundeten Ecken, gleichmäßig abgetastet
export function roundedPath(pts, radius = 1, step = 0.2) {
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out = [];
  const push = (x, y) => {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l.x - x, l.y - y) > 1e-4) out.push({ x, y });
  };
  let cur = { x: pts[0].x, y: pts[0].y };
  push(cur.x, cur.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const n = pts[i + 1];
    let end = p;
    let arc = null;
    if (n) {
      const d1 = Math.hypot(p.x - cur.x, p.y - cur.y);
      const d2 = Math.hypot(n.x - p.x, n.y - p.y);
      const r = Math.min(radius, d1 * 0.5, d2 * 0.5);
      const u1 = { x: (p.x - cur.x) / (d1 || 1), y: (p.y - cur.y) / (d1 || 1) };
      const u2 = { x: (n.x - p.x) / (d2 || 1), y: (n.y - p.y) / (d2 || 1) };
      const cross = u1.x * u2.y - u1.y * u2.x;
      if (r > 0.01 && Math.abs(cross) > 0.01) {
        end = { x: p.x - u1.x * r, y: p.y - u1.y * r };
        arc = { a: end, c: p, b: { x: p.x + u2.x * r, y: p.y + u2.y * r } };
      }
    }
    // Gerade bis end
    const L = Math.hypot(end.x - cur.x, end.y - cur.y);
    const n1 = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n1; k++) push(cur.x + ((end.x - cur.x) * k) / n1, cur.y + ((end.y - cur.y) * k) / n1);
    if (arc) {
      // quadratische Bezier als Bogen-Näherung
      const al = Math.hypot(arc.c.x - arc.a.x, arc.c.y - arc.a.y) * 2;
      const n2 = Math.max(3, Math.ceil(al / step));
      for (let k = 1; k <= n2; k++) {
        const t = k / n2;
        const x = (1 - t) * (1 - t) * arc.a.x + 2 * (1 - t) * t * arc.c.x + t * t * arc.b.x;
        const y = (1 - t) * (1 - t) * arc.a.y + 2 * (1 - t) * t * arc.c.y + t * t * arc.b.y;
        push(x, y);
      }
      cur = arc.b;
    } else cur = end;
  }
  return out;
}

export function pathLength(path, from = 0) {
  let L = 0;
  for (let i = Math.max(1, from + 1); i < path.length; i++) L += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return L;
}

export function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  if (html) e.innerHTML = html;
  return e;
}
