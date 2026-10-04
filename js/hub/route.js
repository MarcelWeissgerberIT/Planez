// Großflughäfen: Rollweg-Routen (Dijkstra über das Netz aus build.js). Bahnkreuzungen kosten extra (lieber außen
// herum), Gassen auf dem Vorfeld etwas mehr als Rollbahnen; Einbahnrollwege nur in Pfeilrichtung. Auf der
// Bahnmittellinie selbst wird nie gerollt.
import { dist, polyLen, smooth, alongPoly, closestOnSeg } from './geom.js';

// Kosten einer Kante in Fahrtrichtung (a -> b: dir = 1)
function cost(e, dir, opt) {
  if (e.kind === 'rwy') return Infinity;
  if (e.oneway && dir !== 1) return Infinity;
  let c = e.len;
  if (e.kind === 'lane') c *= opt.laneK ?? 1.6;
  if (e.kind === 'rwz') c += opt.crossK ?? 70;
  if (opt.avoid && opt.avoid.has(e.id)) c += 400;
  return c;
}

// kürzester Weg von Knoten from zu einem der Zielknoten; liefert [{ e, dir }] oder null
export function findRoute(ap, from, targets, opt = {}) {
  const T = new Set(Array.isArray(targets) ? targets : [targets]);
  if (T.has(from)) return [];
  const n = ap.nodes.length;
  const D = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevDir = new Int8Array(n);
  D[from] = 0;
  // einfacher Binärheap
  const heap = [[0, from]];
  const push = (d, v) => {
    heap.push([d, v]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  let hit = -1;
  while (heap.length) {
    const [d, v] = pop();
    if (d > D[v]) continue;
    if (T.has(v)) {
      hit = v;
      break;
    }
    // Bahnknoten nur durchqueren (Kreuzung), nicht entlang der Bahn
    for (const eid of ap.nodes[v].edges) {
      const e = ap.edges[eid];
      const dir = e.a === v ? 1 : -1;
      const w = dir === 1 ? e.b : e.a;
      const c = cost(e, dir, opt);
      if (!isFinite(c)) continue;
      const nd = d + c;
      if (nd < D[w]) {
        D[w] = nd;
        prev[w] = eid;
        prevDir[w] = dir;
        push(nd, w);
      }
    }
  }
  if (hit < 0) return null;
  const out = [];
  let v = hit;
  while (v !== from) {
    const e = ap.edges[prev[v]];
    const dir = prevDir[v];
    out.push({ e: e.id, dir });
    v = dir === 1 ? e.a : e.b;
  }
  return out.reverse();
}

// Pfad aus Kantenfolge: Punkte (geglättet), Längen, Haltepunkte vor Bahnzonen und Kanten-Abschnitte
export function pathFromRoute(ap, route, startPt = null, opt = {}) {
  const raw = [];
  const marks = []; // { i: Index im Rohpfad, node }
  if (startPt) raw.push({ x: startPt.x, y: startPt.y });
  const segs = [];
  for (const { e: eid, dir } of route) {
    const e = ap.edges[eid];
    const pts = dir === 1 ? e.pts : [...e.pts].reverse();
    const startNode = dir === 1 ? e.a : e.b;
    const endNode = dir === 1 ? e.b : e.a;
    if (!raw.length || dist(raw[raw.length - 1], pts[0]) > 0.02) raw.push({ ...pts[0] });
    marks.push({ i: raw.length - 1, node: startNode });
    for (let k = 1; k < pts.length; k++) raw.push({ ...pts[k] });
    segs.push({ e: eid, dir, from: startNode, to: endNode, kind: e.kind, rwy: e.rwy });
    marks.push({ i: raw.length - 1, node: endNode });
  }
  for (const q of opt.append || []) if (!raw.length || dist(raw[raw.length - 1], q) > 0.02) raw.push({ x: q.x, y: q.y });
  if (raw.length === 1) raw.push({ x: raw[0].x + 0.01, y: raw[0].y });
  const pts = opt.noSmooth ? raw : smooth(raw, opt.r ?? 1.5, 0.5);
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k]));
  // Position eines Knotens entlang des geglätteten Pfads (fortlaufend gesucht)
  let k0 = 0;
  const sOf = (p) => {
    let best = null;
    for (let k = Math.max(1, k0); k < pts.length; k++) {
      const c = closestOnSeg(p, pts[k - 1], pts[k]);
      if (!best || c.d < best.d - 1e-6) best = { d: c.d, s: cum[k - 1] + c.t * (cum[k] - cum[k - 1]), k };
      if (best && best.d < 0.05 && k > best.k + 3) break;
    }
    if (best) k0 = best.k;
    return best ? best.s : 0;
  };
  const nodeS = new Map();
  const segRanges = segs.map((sg) => {
    const s0 = nodeS.has(sg.from) ? nodeS.get(sg.from) : sOf(ap.nodes[sg.from]);
    nodeS.set(sg.from, s0);
    const s1 = sOf(ap.nodes[sg.to]);
    nodeS.set(sg.to, s1);
    return { ...sg, s0, s1 };
  });
  return { pts, cum, total: cum[cum.length - 1], segs: segRanges };
}

// Punkt und Richtung bei Abstand s (mit gemerktem Index für schnelle Folgeabfragen)
export function pathAt(path, s, hint = 0) {
  const { pts, cum } = path;
  if (s <= 0) {
    const d = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
    const l = Math.hypot(d.x, d.y) || 1;
    return { x: pts[0].x, y: pts[0].y, dx: d.x / l, dy: d.y / l, i: 1 };
  }
  let i = Math.max(1, Math.min(hint || 1, pts.length - 1));
  while (i > 1 && cum[i - 1] > s) i--;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const l = cum[i] - cum[i - 1] || 1e-9;
  const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / l));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / l, dy: (b.y - a.y) / l, i };
}

export { polyLen, alongPoly };
