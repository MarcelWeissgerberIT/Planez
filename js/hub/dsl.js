// Großflughäfen: kleine Beschreibungssprache für Layouts. Koordinaten in Kacheln (20 m) in einem lokalen Rahmen
// (u entlang einer Achse, v quer dazu), damit sich gedrehte Bahnsysteme (Frankfurt 070°, JFK 031°/121°) bequem
// beschreiben lassen. Bahnenden-bezogene Punkte: R(Ende, s, o) = s Kacheln hinter der Schwelle in Landerichtung,
// o seitlich (positiv = rechts in Landerichtung).
import { dirOf, norm, sub, add, mul, dist, strip } from './geom.js';

const TAN30 = Math.tan(Math.PI / 6);

export function airport(meta, fn) {
  const d = new Def(meta);
  fn(d);
  return d.out();
}

class Def {
  constructor(meta) {
    this.meta = meta;
    this.lines = [];
    this.runways = [];
    this.stands = [];
    this.buildings = [];
    this.aprons = [];
    this.roads = [];
    this.configs = [];
    this.trees = [];
    this.o = { x: 0, y: 0 };
    this.U = { x: 1, y: 0 };
    this.V = { x: 0, y: 1 };
    this.brgU = 90;
  }
  // lokaler Rahmen: Ursprung (Welt) und Kurs der u-Achse (v-Achse = 90° rechts davon)
  frame(ox, oy, brgU) {
    this.o = { x: ox, y: oy };
    this.U = dirOf(brgU);
    this.V = dirOf(brgU + 90);
    this.brgU = brgU;
  }
  P(u, v) {
    return { x: this.o.x + this.U.x * u + this.V.x * v, y: this.o.y + this.U.y * u + this.V.y * v };
  }
  pt(p) {
    return Array.isArray(p) ? this.P(p[0], p[1]) : p;
  }
  pts(a) {
    return a.map((p) => this.pt(p));
  }
  rwy(e1, e2, a, b, w = 2.8) {
    const A = this.pt(a), B = this.pt(b);
    const id = `${e1}/${e2}`;
    this.runways.push({ id, ends: [e1, e2], a: A, b: B, w });
    this.lines.push({ kind: 'rwy', rwy: id, name: id, pts: [A, B], w });
    return id;
  }
  endGeo(endId) {
    const r = this.runways.find((x) => x.ends.includes(endId));
    const k = r.ends.indexOf(endId);
    const thr = k ? r.b : r.a, other = k ? r.a : r.b;
    const d = norm(sub(other, thr));
    return { thr, d, right: { x: -d.y, y: d.x }, len: dist(thr, other), r, k };
  }
  R(endId, s, o = 0) {
    const g = this.endGeo(endId);
    return add(add(g.thr, mul(g.d, s)), mul(g.right, o));
  }
  // Rollweg (Linienzug); opt: oneway (Richtung der Punktfolge), kind ('twy' | 'lane'), w (Breite)
  twy(name, pts, opt = {}) {
    this.lines.push({ kind: opt.kind || 'twy', name, pts: this.pts(pts), oneway: !!opt.oneway, w: opt.w ?? 1.25, rapid: opt.rapid, exitOf: opt.exitOf, entryOf: opt.entryOf, extraCuts: opt.cuts });
    return this.lines.length - 1;
  }
  // Schnellabrollweg: von der Bahnmitte bei s (ab Schwelle von endId) im 30°-Winkel zur Seite bis zum seitlichen
  // Versatz o (Vorzeichen = Seite); danach optional weiter entlang der Rollbahn (more Kacheln)
  rapid(endId, s, o, name, more = 0) {
    const a = this.R(endId, s, 0);
    const run = Math.abs(o) / TAN30;
    const b = this.R(endId, s + run, o);
    const pts = [a, b];
    if (more) pts.push(this.R(endId, s + run + more, o));
    return this.twy(name, pts, { oneway: true, rapid: true, exitOf: [endId] });
  }
  // rechtwinklige Ausfahrt bei s (ab Schwelle von endId) bis zum Versatz o; nutzbar in beiden Landerichtungen
  exit90(endId, s, o, name, both = true) {
    const g = this.endGeo(endId);
    const oppo = g.r.ends[1 - g.k];
    return this.twy(name, [this.R(endId, s, 0), this.R(endId, s, o)], { exitOf: both ? [endId, oppo] : [endId] });
  }
  // Einfahrt an der Schwelle (Rollhalt für Starts): vom Rollweg bei Versatz o zur Bahnmitte bei s; zugleich
  // Ausfahrt am Bahnende für Landungen aus der Gegenrichtung
  entry(endId, o, name, s = 0.8) {
    const g = this.endGeo(endId);
    const oppo = g.r.ends[1 - g.k];
    return this.twy(name, [this.R(endId, s, o), this.R(endId, s, 0)], { entryOf: [endId], exitOf: [oppo] });
  }
  // Vorfeldgasse (Einbahn in Richtung der Punktfolge – benachbarte Gassen im Wechsel ergeben einen Kreisverkehr)
  lane(name, pts, oneway = true) {
    return this.twy(name, pts, { kind: 'lane', w: 1.1, oneway });
  }
  // Positionsreihe an einer Gasse (Index aus lane()) zwischen den lokalen Punkten from und to; side +1/-1 = Seite
  // der Positionen (rechts/links in Richtung from -> to); depth = Abstand Gasse–Positionsmitte; sizes: Folge der
  // Größen (L/M, wiederholt)
  standRow({ lane, from, to, side = 1, depth = 3.6, sizes = ['L'], term, prefix = '', start = 1, gapL = 6.2, gapM = 4.6, apron = true }) {
    const A = this.pt(from), B = this.pt(to);
    const d = norm(sub(B, A));
    const n = { x: -d.y * side, y: d.x * side };
    const L = this.lines[lane];
    const total = dist(A, B);
    let s = 0, k = 0, num = start;
    const cuts = [];
    while (true) {
      const size = sizes[k % sizes.length];
      const g = size === 'L' ? gapL : gapM;
      if (s + g > total + 0.01) break;
      const anchor = add(A, mul(d, s + g / 2));
      const pos = add(anchor, mul(n, depth));
      this.stands.push({ id: `${prefix}${num}`, name: `${prefix}${num}`, term, size, x: pos.x, y: pos.y, hdg: Math.atan2(n.y, n.x), lane, anchor });
      cuts.push(projS(L.pts, anchor));
      num++;
      s += g;
      k++;
    }
    L.extraCuts = [...(L.extraCuts || []), ...cuts];
    if (apron) {
      const ext = depth + 3.3;
      this.aprons.push([sub(A, mul(n, 1.7)), sub(B, mul(n, 1.7)), add(B, mul(n, ext)), add(A, mul(n, ext))]);
    }
    return num;
  }
  // Gebäude: Grundriss (lokal), Höhe in Kacheln (1 Kachel Höhe = 20 m), kind bestimmt Farbe und Details
  bld(kind, poly, h, extra = {}) {
    this.buildings.push({ kind, poly: this.pts(poly), h, ...extra });
  }
  box(kind, u0, v0, u1, v1, h, extra = {}) {
    this.bld(kind, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], h, extra);
  }
  apron(poly) {
    this.aprons.push(this.pts(poly));
  }
  road(pts, w = 1.0) {
    this.roads.push({ pts: this.pts(pts), w });
  }
  // Baumgruppe (lokal) – Kreis aus Bäumen
  grove(u, v, r, n, seed = 1) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * r;
      this.trees.push({ ...this.P(u + Math.cos(a) * rr, v + Math.sin(a) * rr), s: 0.7 + rnd() * 0.6 });
    }
  }
  config(id, c) {
    this.configs.push({ id, ...c });
  }
  out() {
    return { ...this.meta, lines: this.lines, runways: this.runways, stands: this.stands, buildings: this.buildings, aprons: this.aprons, roads: this.roads, configs: this.configs, trees: this.trees, brgU: this.brgU };
  }
}
// Abstand entlang eines Linienzugs bis zum nächsten Punkt zu p
function projS(pts, p) {
  let best = null, acc = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const ab = sub(b, a), l = dist(a, b) || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (l * l)));
    const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    const dd = dist(p, q);
    if (!best || dd < best.d) best = { d: dd, s: acc + t * l };
    acc += l;
  }
  return best ? best.s : 0;
}
export { strip };
