// Zeichenreihenfolge Fahrzeug ↔ Flugzeug am Boden. Ein Flugzeug ist lang, flach und hat die Flügel in der Höhe – nach
// seinem Mittelpunkt (x + y) sortiert, landet ein Bus hinter dem Rumpf oder unter einer Fläche oft davor. Deshalb wird es
// hier in Quader zerlegt (Rumpfstücke, Flügelfelder, Leitwerk) und mit Sichtstrahlen geprüft: Welche Punkte des Fahrzeugs
// verdeckt das Flugzeug, welche Punkte des Flugzeugs verdeckt das Fahrzeug? Die größere verdeckte Fläche entscheidet.
import { SHAPE_OF, fuselage, wingPoly } from '../acshape.js';
import { VEH_TYPES } from '../config.js';

// Bildschirm in Kacheln: SX = x − y, SY = (x + y) / 2 − z; Quader: Mitte, Richtung (c, s), halbe Länge/Breite, Höhe z0..z1
const box = (cx, cy, c, s, hl, hw, z0, z1) => {
  const ex = Math.abs(c - s) * hl + Math.abs(c + s) * hw, ey = 0.5 * (Math.abs(c + s) * hl + Math.abs(c - s) * hw);
  const X = cx - cy, Y = (cx + cy) / 2;
  return { cx, cy, c, s, hl, hw, z0, z1, x0: X - ex, x1: X + ex, y0: Y - ey - z1, y1: Y + ey - z0 };
};

const DIH = Math.tan((5 * Math.PI) / 180);
const cache = new WeakMap();
// Quader eines Flugzeugs (zwischengespeichert, solange es sich nicht bewegt)
export function acParts(a) {
  const key = `${a.x},${a.y},${a.hdg},${a.type}`, hit = cache.get(a);
  if (hit && hit.key === key) return hit.parts;
  const L = a.len, f = fuselage(a.type, L), kind = SHAPE_OF[a.type] || 'narrow';
  const c = Math.cos(a.hdg), s = Math.sin(a.hdg);
  const at = (al, la, hl, hw, z0, z1) => box(a.x + al * c - la * s, a.y + al * s + la * c, c, s, hl, hw, z0, z1);
  const parts = [];
  // Rumpf in zehn Stücken, Bug und Heck verjüngt
  const N = 10;
  for (let i = 0; i < N; i++) {
    const al = -L / 2 + ((i + 0.5) * L) / N, t = Math.abs(al) / (L / 2), k = t > 0.7 ? 1 - (t - 0.7) * 1.8 : 1;
    parts.push(at(al, 0, L / N / 2, f.rz * k, f.axis - f.ry * k, f.axis + f.ry * k));
  }
  // Tragflächen: je Seite 4 × 3 Felder
  const P = wingPoly(a.type, L), high = kind === 'prop';
  const wz = f.axis + (high ? f.ry * 0.86 : -f.ry * 0.55), rise = high ? 0 : (P[1][1] - P[0][1]) * DIH;
  const NS = 4, NC = 3;
  for (let i = 0; i < NS; i++) {
    const u = (i + 0.5) / NS, la = P[0][1] + (P[1][1] - P[0][1]) * u;
    const le = P[0][0] + (P[1][0] - P[0][0]) * u, te = P[3][0] + (P[2][0] - P[3][0]) * u, ch = le - te, z = wz + rise * u;
    for (let j = 0; j < NC; j++) for (const sd of [-1, 1]) parts.push(at(te + (ch * (j + 0.5)) / NC, sd * la, ch / NC / 2, (P[1][1] - P[0][1]) / NS / 2, z - 0.01, z + 0.02));
  }
  // Seitenleitwerk und Höhenleitwerk
  const tTail = kind === 'prop' || kind === 'rear' || kind === 'biz', fz = f.axis + f.ry * 0.85, fh = (tTail ? 0.3 : 0.36) * 0.8;
  parts.push(at(-0.38 * L, 0, 0.1 * L, 0.008 * L, fz, fz + fh));
  const sz = tTail ? fz + fh : f.axis + f.ry * 0.35;
  for (const sd of [-1, 1]) parts.push(at(-0.44 * L, sd * 0.09 * L, 0.05 * L, 0.08 * L, sz - 0.01, sz + 0.02));
  cache.set(a, { key, parts });
  return parts;
}

// Maße der Vorfeldfahrzeuge auf der Karte (Breite, Höhe; Länge aus VEH_TYPES wie beim Zeichnen × 1.15)
const VW = { bus: 0.15, fuel: 0.125, catering: 0.13, tug: 0.16, baggage: 0.11, stairs: 0.12, cleaning: 0.1, deice: 0.124, police: 0.1 };
const VH = { tug: 0.075, baggage: 0.07, fuel: 0.13, catering: 0.15, cleaning: 0.1, bus: 0.13, deice: 0.15, stairs: 0.19, police: 0.09 }; // Treppe: bis zur Tür hochgefahren
export function vehBox(v) {
  const L = v.len ?? (VEH_TYPES[v.type]?.len || 0.5) * 1.15;
  return box(v.x, v.y, Math.cos(v.hdg || 0), Math.sin(v.hdg || 0), L / 2, (VW[v.type] || 0.12) / 2, 0, VH[v.type] || 0.12);
}

// Sichtstrahl zum Betrachter: Punkte (x + t, y + t, z + t) liegen auf demselben Bildpunkt, t > 0 ist näher. Trifft der
// Strahl von p aus den Quader b?
function hits(b, px, py, pz) {
  const dx = px - b.cx, dy = py - b.cy;
  const o = [dx * b.c + dy * b.s, -dx * b.s + dy * b.c, pz], d = [b.c + b.s, b.c - b.s, 1];
  const lo = [-b.hl, -b.hw, b.z0], hi = [b.hl, b.hw, b.z1];
  let t0 = 1e-4, t1 = 50;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < lo[k] || o[k] > hi[k]) return false;
      continue;
    }
    let a = (lo[k] - o[k]) / d[k], e = (hi[k] - o[k]) / d[k];
    if (a > e) [a, e] = [e, a];
    if ((t0 = Math.max(t0, a)) > (t1 = Math.min(t1, e))) return false;
  }
  return true;
}
// Punkte in einem Quader (Raster entlang × quer × Höhe)
function* pts(b, na, nw, nz) {
  for (let i = 0; i < na; i++) for (let j = 0; j < nw; j++) for (let k = 0; k < nz; k++) {
    const u = na > 1 ? (i / (na - 1) - 0.5) * 1.4 * b.hl : 0, w = nw > 1 ? (j / (nw - 1) - 0.5) * 1.4 * b.hw : 0;
    yield [b.cx + u * b.c - w * b.s, b.cy + u * b.s + w * b.c, b.z0 + (b.z1 - b.z0) * (nz > 1 ? 0.25 + (0.65 * k) / (nz - 1) : 0.5)];
  }
}
const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);

// Fahrzeug gegen ein Flugzeug: < 0 Teile des Fahrzeugs liegen hinter dem Flugzeug (vor ihm zeichnen), > 0 das Fahrzeug
// verdeckt Teile des Flugzeugs (danach zeichnen), 0 keine Überdeckung. Bei beidem gewinnt die größere verdeckte Fläche.
export function vehOrder(vb, parts) {
  const near = parts.filter((b) => Math.min(b.x1, vb.x1) > Math.max(b.x0, vb.x0) && Math.min(b.y1, vb.y1) > Math.max(b.y0, vb.y0));
  if (!near.length) return 0;
  let back = 0, fore = 0;
  const wv = area(vb) / 18;
  for (const [x, y, z] of pts(vb, 3, 3, 2)) if (near.some((b) => hits(b, x, y, z))) back += wv;
  for (const b of near) {
    const wb = area(b) / 3;
    for (const [x, y, z] of pts(b, 3, 1, 1)) if (hits(vb, x, y, z)) fore += wb;
  }
  return fore - back;
}

// wie vehOrder, aber je Fahrzeug und Flugzeug gemerkt, solange beide stehen (am Stand der Normalfall)
const memo = new WeakMap();
export function vehVsAc(v, a) {
  let m = memo.get(v);
  if (!m) memo.set(v, (m = new Map()));
  const key = `${v.x},${v.y},${v.hdg},${v.type},${a.x},${a.y},${a.hdg}`, hit = m.get(a);
  if (hit && hit.key === key) return hit.o;
  const o = vehOrder(vehBox(v), acParts(a));
  m.set(a, { key, o });
  if (m.size > 6) m.delete(m.keys().next().value);
  return o;
}
