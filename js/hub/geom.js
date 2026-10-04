// Großflughäfen: Geometrie-Helfer (Kacheln à 20 m, x nach Osten, y nach Süden)
export const DEG = Math.PI / 180;
export const NM = 1852 / 20; // Kacheln je Seemeile
export const KT = 0.5144 / 20; // Kacheln je Sekunde je Knoten

// Richtung eines Kurses (Grad, rechtweisend) als Einheitsvektor
export const dirOf = (brg) => ({ x: Math.sin(brg * DEG), y: -Math.cos(brg * DEG) });
// Kartenwinkel (atan2 in Kachelkoordinaten, 0 = Osten) <-> Kurs
export const hdgOf = (brg) => Math.atan2(-Math.cos(brg * DEG), Math.sin(brg * DEG));
export const brgOfVec = (dx, dy) => ((Math.atan2(dx, -dy) / DEG) % 360 + 360) % 360;

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const angNorm = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

// Schnittpunkt zweier Strecken: { t, u, p } mit t/u als Anteil auf a bzw. b, sonst null
export function segX(a1, a2, b1, b2, eps = 1e-9) {
  const r = sub(a2, a1), s = sub(b2, b1);
  const d = cross(r, s);
  if (Math.abs(d) < eps) return null;
  const q = sub(b1, a1);
  const t = cross(q, s) / d, u = cross(q, r) / d;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)), p: lerpP(a1, a2, t) };
}
// nächster Punkt auf einer Strecke
export function closestOnSeg(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1e-9;
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  const q = lerpP(a, b, t);
  return { t, p: q, d: dist(p, q) };
}
export function polyLen(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}
// Punkt in Abstand s entlang eines Linienzugs (mit Richtung)
export function alongPoly(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (s <= l || i === pts.length - 1) {
      const t = l ? Math.min(1, Math.max(0, s / l)) : 0;
      const d = norm(sub(pts[i], pts[i - 1]));
      return { ...lerpP(pts[i - 1], pts[i], t), dx: d.x, dy: d.y, i };
    }
    s -= l;
  }
  return { ...pts[0], dx: 1, dy: 0, i: 0 };
}
export function pointInPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
export function polyCenter(poly) {
  let x = 0, y = 0;
  for (const p of poly) (x += p.x), (y += p.y);
  return { x: x / poly.length, y: y / poly.length };
}
// Rechteck um eine Mittellinie a–b mit halber Breite hw (Ecken im Uhrzeigersinn)
export function strip(a, b, hw) {
  const d = norm(sub(b, a)), n = { x: -d.y * hw, y: d.x * hw };
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
}
// Bogen glätten: Ecken eines Linienzugs mit Radius r abrunden (für Rollwege)
export function smooth(pts, r = 1.6, step = 0.6) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const d1 = norm(sub(b, a)), d2 = norm(sub(c, b));
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
    if (turn < 0.05) {
      out.push(b);
      continue;
    }
    const rr = Math.min(r, dist(a, b) * 0.45, dist(b, c) * 0.45);
    const p0 = sub(b, mul(d1, rr)), p1 = add(b, mul(d2, rr));
    const n = Math.max(2, Math.ceil((rr * turn) / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      // quadratische Bézierkurve p0 – b – p1
      const q = { x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * b.x + t * t * p1.x, y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * b.y + t * t * p1.y };
      out.push(q);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// deterministischer Zufall
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
