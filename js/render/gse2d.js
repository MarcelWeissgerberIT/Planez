// Bodenfahrzeuge mit eigener Form auf der Karte: moderner Vorfeldbus (Niederflur, Panoramafenster, Doppeltüren,
// Lackierung) und Treppenfahrzeug (Fahrgestell, Kabine, Treppe, die an der Flugzeugtür hochfährt). Gezeichnet als
// Quader mit Flächen in der Kartenprojektion – Seiten, die vom Betrachter weg zeigen, entfallen.
import { clamp } from '../util.js';

// Punkt am Fahrzeug: a = entlang (Front +), s = quer (rechts +), z = Höhe
function body(x, y, hdg) {
  const fx = Math.cos(hdg), fy = Math.sin(hdg);
  return (a, s) => ({ x: x + fx * a - fy * s, y: y + fy * a + fx * s });
}
// Seitenflächen eines Quaders (Länge L, Breite W): je Fläche Anfang/Ende der Unterkante und sichtbar ja/nein
function faces(P, L, W, hdg) {
  const fx = Math.cos(hdg), fy = Math.sin(hdg);
  const F = [
    { k: 'right', p: P(L / 2, W / 2), q: P(-L / 2, W / 2), n: [-fy, fx], len: L },
    { k: 'left', p: P(-L / 2, -W / 2), q: P(L / 2, -W / 2), n: [fy, -fx], len: L },
    { k: 'front', p: P(L / 2, -W / 2), q: P(L / 2, W / 2), n: [fx, fy], len: W },
    { k: 'back', p: P(-L / 2, W / 2), q: P(-L / 2, -W / 2), n: [-fx, -fy], len: W },
  ];
  // der Betrachter schaut von Südost (+x, +y) auf die Karte
  return F.filter((f) => f.n[0] + f.n[1] > 0.001);
}
// Ausschnitt einer Seitenfläche: u0..u1 entlang der Unterkante (0..1), z0..z1 in Kacheln
function quad(ctx, cam, f, u0, u1, z0, z1, fill) {
  const at = (u, z) => cam.toScreen(f.p.x + (f.q.x - f.p.x) * u, f.p.y + (f.q.y - f.p.y) * u, z);
  const a = at(u0, z0), b = at(u1, z0), c = at(u1, z1), d = at(u0, z1);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();
}
function poly(ctx, cam, pts, z, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const p of pts) {
    const s = cam.toScreen(p.x, p.y, p.z ?? z);
    ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
  ctx.fill();
}
// Seite hell, Front/Heck etwas dunkler (Sonne von Südwest)
const shade = (f) => (f.n[1] > f.n[0] ? 1 : 0.86);
function tone(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(clamp(v * k, 0, 255));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function shadow(ctx, cam, P, L, W, H) {
  const o = { x: H * 0.55, y: H * 0.25 };
  const pts = [P(L / 2, W / 2), P(-L / 2, W / 2), P(-L / 2, -W / 2), P(L / 2, -W / 2)].map((p) => ({ x: p.x + o.x * 0.6, y: p.y + o.y * 0.6 }));
  ctx.globalAlpha = 0.3;
  poly(ctx, cam, pts, 0.002, '#000');
  ctx.globalAlpha = 1;
}

// ---------- Vorfeldbus ----------
const BUS = { L: 0.72, W: 0.15, H: 0.15 };
const BLUE = '#1d4ed8', TEAL = '#14b8a6', WHITE = '#f1f5f9', GLASS = '#1c2b3b';
export const busSize = () => BUS;

export function drawApronBus(r, v, beacon, night, lights) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const { L, W, H } = BUS;
  const P = body(v.x, v.y, v.hdg);
  shadow(ctx, cam, P, L, W, H);
  const lit = night > 0.3;
  for (const f of faces(P, L, W, v.hdg)) {
    const k = shade(f);
    const side = f.k === 'left' || f.k === 'right';
    // Schürze in Blau mit türkisem Zierstreifen, darüber das Glasband, oben weiße Dachkante
    quad(ctx, cam, f, 0, 1, 0.012, 0.036, tone(BLUE, k));
    quad(ctx, cam, f, 0, 1, 0.036, 0.043, tone(TEAL, k));
    quad(ctx, cam, f, 0, 1, 0.043, 0.128, lit ? '#e8d9a8' : tone(GLASS, k));
    quad(ctx, cam, f, 0, 1, 0.128, H, tone(WHITE, k));
    if (side) {
      // Spiegelung im Glas
      if (!lit) quad(ctx, cam, f, 0, 1, 0.1, 0.122, 'rgba(160,190,220,0.28)');
      // Fenstersäulen
      for (let u = 0.07; u < 0.99; u += 0.09) quad(ctx, cam, f, u, u + 0.012, 0.043, 0.128, tone(WHITE, k * 0.92));
      // Doppeltüren (bis zum Boden verglast, silberner Rahmen); links (Fahrerseite) die gleichen wie rechts
      for (const u of [0.16, 0.5, 0.84]) {
        const a = f.k === 'right' ? 1 - u : u;
        quad(ctx, cam, f, a - 0.075, a + 0.075, 0.014, 0.13, tone('#cbd5e1', k));
        quad(ctx, cam, f, a - 0.065, a + 0.065, 0.016, 0.124, lit ? '#f3e7bd' : tone('#22374d', k));
        quad(ctx, cam, f, a - 0.004, a + 0.004, 0.016, 0.124, tone('#cbd5e1', k));
      }
      // Räder (Niederflur: klein, in Radkästen)
      for (const u of [0.18, 0.82]) quad(ctx, cam, f, u - 0.045, u + 0.045, 0, 0.026, '#111418');
    } else {
      // Front/Heck: große Scheibe bis fast nach unten, Lichter, Zielanzeige vorn
      const front = f.k === 'front';
      quad(ctx, cam, f, 0.08, 0.92, front ? 0.03 : 0.05, 0.125, lit ? '#e8d9a8' : tone(front ? '#22374d' : GLASS, k));
      quad(ctx, cam, f, 0.06, 0.2, 0.017, 0.027, front ? '#fff7d6' : '#ef4444');
      quad(ctx, cam, f, 0.8, 0.94, 0.017, 0.027, front ? '#fff7d6' : '#ef4444');
      if (front) quad(ctx, cam, f, 0.2, 0.8, 0.131, 0.145, '#111827'), quad(ctx, cam, f, 0.26, 0.74, 0.134, 0.142, '#f59e0b');
    }
  }
  // Dach: weiß mit zwei Klimaanlagen und blauer Kante
  const T = (a, s) => P(a, s);
  poly(ctx, cam, [T(L / 2, W / 2), T(-L / 2, W / 2), T(-L / 2, -W / 2), T(L / 2, -W / 2)], H, '#f8fafc');
  poly(ctx, cam, [T(L / 2 - 0.01, W / 2 - 0.012), T(-L / 2 + 0.01, W / 2 - 0.012), T(-L / 2 + 0.01, -W / 2 + 0.012), T(L / 2 - 0.01, -W / 2 + 0.012)], H + 0.001, '#e9eef4');
  for (const a of [0.17, -0.16]) {
    const pod = [T(a + 0.07, 0.045), T(a - 0.07, 0.045), T(a - 0.07, -0.045), T(a + 0.07, -0.045)];
    poly(ctx, cam, pod.map((p) => ({ ...p, z: H + 0.001 })), H, '#94a3b8');
    poly(ctx, cam, pod, H + 0.014, '#cbd5e1');
  }
  if (lights) {
    if (beacon) lights.push({ ...P(L / 2 - 0.04, 0), z: H + 0.02, c: '#ffae00', s: 10, a: 0.85, day: true });
    if (night > 0.3) for (const s of [-0.05, 0.05]) lights.push({ ...P(L / 2 + 0.02, s), z: 0.025, c: '#fff4d6', s: 9, a: 0.8 });
  }
}

// ---------- Treppenfahrzeug ----------
const STAIRS = { L: 0.44, W: 0.12 };
export const stairsSize = () => STAIRS;
// Fuß der Treppe (wo die Fluggäste unten ankommen)
export function stairsFoot(v) {
  const P = body(v.x, v.y, v.hdg);
  return P(-STAIRS.L * 0.36, 0);
}

export function drawStairsTruck(r, v, top, beacon, lights) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const { L, W } = STAIRS;
  const P = body(v.x, v.y, v.hdg);
  shadow(ctx, cam, P, L, W, Math.max(0.08, top * 0.7));
  // Fahrgestell mit Warnstreifen
  for (const f of faces(P, L, W, v.hdg)) {
    const k = shade(f);
    quad(ctx, cam, f, 0, 1, 0.008, 0.04, tone('#334155', k));
    quad(ctx, cam, f, 0, 1, 0.03, 0.038, tone('#facc15', k));
    if (f.k === 'left' || f.k === 'right') for (const u of [0.2, 0.8]) quad(ctx, cam, f, u - 0.06, u + 0.06, 0, 0.026, '#111418');
  }
  poly(ctx, cam, [P(L / 2, W / 2), P(-L / 2, W / 2), P(-L / 2, -W / 2), P(L / 2, -W / 2)], 0.04, '#475569');
  // Fahrerkabine vorn links unter dem Podest
  const cab = { a0: L / 2 - 0.11, a1: L / 2, s0: -W / 2, s1: -W / 2 + 0.058 };
  const C = (a, s, z) => ({ ...P(a, s), z });
  const S = (p, z) => cam.toScreen(p.x, p.y, z);
  const box = (a0, a1, s0, s1, z0, z1, col) => {
    const pts = [C(a1, s1, z0), C(a0, s1, z0), C(a0, s0, z0), C(a1, s0, z0)];
    // vier Seiten, nur die zum Betrachter
    const fx = Math.cos(v.hdg), fy = Math.sin(v.hdg);
    const sides = [[0, 1, [-fy, fx]], [1, 2, [-fx, -fy]], [2, 3, [fy, -fx]], [3, 0, [fx, fy]]];
    for (const [i, j, n] of sides) {
      if (n[0] + n[1] <= 0.001) continue;
      const k = n[1] > n[0] ? 1 : 0.86;
      poly(ctx, cam, [pts[i], pts[j], { ...pts[j], z: z1 }, { ...pts[i], z: z1 }], 0, tone(col, k));
    }
    poly(ctx, cam, pts.map((p) => ({ ...p, z: z1 })), z1, tone(col, 1.06));
  };
  box(cab.a0, cab.a1, cab.s0, cab.s1, 0.04, 0.102, '#f8fafc');
  box(cab.a1 - 0.004, cab.a1 + 0.001, cab.s0 + 0.006, cab.s1 - 0.006, 0.07, 0.097, '#22374d');
  // Treppe: Wangen (Seitenteile) als Keil, Stufen als Rampe, oben Podest mit Dach
  const a0 = -L / 2 + 0.05, a1 = L / 2 - 0.07, zb = 0.05;
  const hw = 0.04; // halbe Treppenbreite
  const fx = Math.cos(v.hdg), fy = Math.sin(v.hdg);
  for (const s of [-1, 1]) {
    const n = [-fy * s, fx * s];
    if (n[0] + n[1] <= 0.001) continue;
    poly(ctx, cam, [C(a0, s * hw, 0.04), C(a1, s * hw, 0.04), C(a1, s * hw, top), C(a0, s * hw, zb)], 0, tone('#64748b', n[1] > n[0] ? 1 : 0.86));
  }
  poly(ctx, cam, [C(a0, -hw, zb), C(a0, hw, zb), C(a1, hw, top), C(a1, -hw, top)], 0, '#cbd5e1');
  ctx.strokeStyle = 'rgba(71,85,105,0.85)';
  ctx.lineWidth = Math.max(0.6, cam.zoom * 0.45);
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    const a = a0 + (a1 - a0) * t, z = zb + (top - zb) * t;
    const p = S(P(a, -hw), z), q = S(P(a, hw), z);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  // Podest vorn
  poly(ctx, cam, [C(a1, -hw, top), C(a1, hw, top), C(L / 2, hw, top), C(L / 2, -hw, top)], 0, '#e2e8f0');
  // Geländer (gelb)
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = Math.max(0.8, cam.zoom * 0.7);
  for (const s of [-1, 1]) {
    const p0 = S(P(a0 + 0.02, s * hw), zb + 0.05), p1 = S(P(a1, s * hw), top + 0.05), p2 = S(P(L / 2, s * hw), top + 0.05);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  // Wetterdach über dem Podest auf vier Stützen
  const z = top + 0.1;
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = Math.max(0.7, cam.zoom * 0.55);
  for (const [a, sd] of [[a1, -hw], [a1, hw], [L / 2, -hw], [L / 2, hw]]) {
    const p = S(P(a, sd), top), q = S(P(a, sd), z);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  poly(ctx, cam, [C(a1 - 0.01, -hw - 0.01, z), C(a1 - 0.01, hw + 0.01, z), C(L / 2, hw + 0.01, z), C(L / 2, -hw - 0.01, z)], 0, '#f8fafc');
  if (lights && beacon) lights.push({ ...P(-L / 2 + 0.06, -W / 2 + 0.03), z: 0.11, c: '#ffae00', s: 9, a: 0.85, day: true });
}
