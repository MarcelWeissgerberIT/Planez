// Großflughäfen: aus der Beschreibung eines Flughafens (Bahnen, Rollwege, Positionsreihen, Gebäude) das Rollwegnetz
// bauen – Schnittpunkte und T-Stöße werden zu Knoten, vor jeder Bahn entsteht ein Haltepunkt (Rollhalt), Ausfahrten und
// Rollhalte für Starts werden den Bahnenden zugeordnet.
import { add, sub, mul, dist, norm, dot, segX, closestOnSeg, polyLen, alongPoly, strip, hdgOf, brgOfVec } from './geom.js';

export const HOLD = 4.6; // Rollhalt: Abstand von der Bahnmitte (≈ 90 m)
const MERGE = 0.3; // Punkte näher als das werden ein Knoten
const SNAP = 0.9; // Linienenden so nah an einer anderen Linie werden angeschlossen

export function buildAirport(def) {
  const lines = def.lines.map((l, i) => ({ ...l, i, pts: l.pts.map((p) => ({ x: p.x, y: p.y })), cuts: [] }));
  // Linienenden an andere Linien anschließen (T-Stoß)
  for (const L of lines) {
    for (const end of [0, L.pts.length - 1]) {
      const E = L.pts[end];
      let best = null;
      for (const M of lines) {
        if (M === L) continue;
        for (let k = 1; k < M.pts.length; k++) {
          const c = closestOnSeg(E, M.pts[k - 1], M.pts[k]);
          if (c.d < SNAP && (!best || c.d < best.d)) best = { ...c, M, k };
        }
      }
      if (best && best.d > 1e-6) {
        // Endpunkt genau auf die andere Linie legen
        L.pts[end] = { ...best.p };
      }
    }
  }
  const cum = (L) => {
    const c = [0];
    for (let k = 1; k < L.pts.length; k++) c.push(c[k - 1] + dist(L.pts[k - 1], L.pts[k]));
    return c;
  };
  for (const L of lines) {
    L.cum = cum(L);
    L.total = L.cum[L.cum.length - 1];
    L.cuts.push({ s: 0, p: L.pts[0] }, { s: L.total, p: L.pts[L.pts.length - 1] });
    for (const s of L.extraCuts || []) L.cuts.push({ s, p: alongPoly(L.pts, s) });
  }
  // Schnittpunkte aller Linien untereinander
  for (let a = 0; a < lines.length; a++)
    for (let b = a + 1; b < lines.length; b++) {
      const A = lines[a], B = lines[b];
      for (let i = 1; i < A.pts.length; i++)
        for (let j = 1; j < B.pts.length; j++) {
          const x = segX(A.pts[i - 1], A.pts[i], B.pts[j - 1], B.pts[j]);
          if (!x) continue;
          A.cuts.push({ s: A.cum[i - 1] + x.t * (A.cum[i] - A.cum[i - 1]), p: x.p, rwy: B.kind === 'rwy' ? B.rwy : null });
          B.cuts.push({ s: B.cum[j - 1] + x.u * (B.cum[j] - B.cum[j - 1]), p: x.p, rwy: A.kind === 'rwy' ? A.rwy : null });
        }
    }
  // T-Stöße: Linienende liegt auf einer anderen Linie -> dort teilen
  for (const L of lines)
    for (const E of [L.pts[0], L.pts[L.pts.length - 1]])
      for (const M of lines) {
        if (M === L) continue;
        for (let k = 1; k < M.pts.length; k++) {
          const c = closestOnSeg(E, M.pts[k - 1], M.pts[k]);
          if (c.d < 0.05) M.cuts.push({ s: M.cum[k - 1] + c.t * (M.cum[k] - M.cum[k - 1]), p: c.p });
        }
      }

  // Rollhalte: auf jeder Linie im Abstand HOLD vor und hinter jeder Bahnquerung (auch an Linienenden auf der Bahn)
  for (const L of lines) {
    if (L.kind === 'rwy') continue;
    const rc = [];
    for (const c of L.cuts) if (c.rwy) rc.push({ s: c.s, rwy: c.rwy });
    for (const R of lines) {
      if (R.kind !== 'rwy') continue;
      for (const [s, E] of [[0, L.pts[0]], [L.total, L.pts[L.pts.length - 1]]]) {
        const c = closestOnSeg(E, R.pts[0], R.pts[R.pts.length - 1]);
        if (c.d < 0.05 && !rc.some((q) => Math.abs(q.s - s) < 0.1)) rc.push({ s, rwy: R.rwy });
      }
    }
    L.rwyCuts = rc;
    for (const q of rc)
      for (const sh of [q.s - HOLD, q.s + HOLD]) {
        if (sh < 0.3 || sh > L.total - 0.3) continue;
        // Halt nicht in der Zone einer anderen Bahnquerung
        if (rc.some((o) => o !== q && Math.abs(o.s - sh) < HOLD - 0.01)) continue;
        L.cuts.push({ s: sh, p: alongPoly(L.pts, sh), hold: q.rwy });
      }
  }

  // Knoten (zusammengeführt über ein Raster)
  const nodes = [];
  const grid = new Map();
  const key = (x, y) => `${Math.round(x / MERGE)}|${Math.round(y / MERGE)}`;
  const nodeAt = (p, kind) => {
    const gx = Math.round(p.x / MERGE), gy = Math.round(p.y / MERGE);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${gx + dx}|${gy + dy}`);
        if (!list) continue;
        for (const id of list) if (dist(nodes[id], p) < MERGE) {
          if (kind === 'rwy') nodes[id].kind = 'rwy';
          return id;
        }
      }
    const id = nodes.length;
    nodes.push({ id, x: p.x, y: p.y, kind, edges: [] });
    const k = key(p.x, p.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(id);
    return id;
  };

  const edges = [];
  const addEdge = (a, b, pts, L, kind) => {
    if (a === b) return null;
    const e = { id: edges.length, a, b, pts, len: polyLen(pts), kind, name: L.name, oneway: L.oneway ? 1 : 0, rwy: L.rwy || null, line: L.i, w: L.w };
    edges.push(e);
    nodes[a].edges.push(e.id);
    nodes[b].edges.push(e.id);
    return e;
  };
  // Teilstück eines Linienzugs zwischen zwei Abständen
  const slice = (L, s0, s1) => {
    const out = [alongPoly(L.pts, s0)];
    for (let k = 1; k < L.pts.length - 1; k++) if (L.cum[k] > s0 + 1e-6 && L.cum[k] < s1 - 1e-6) out.push(L.pts[k]);
    out.push(alongPoly(L.pts, s1));
    return out.map((p) => ({ x: p.x, y: p.y }));
  };
  for (const L of lines) {
    L.cuts.sort((p, q) => p.s - q.s);
    const cuts = [];
    for (const c of L.cuts) if (!cuts.length || c.s - cuts[cuts.length - 1].s > 0.08) cuts.push(c);
    L.nodeIds = cuts.map((c) => nodeAt(alongPoly(L.pts, c.s), L.kind === 'rwy' ? 'rwy' : L.kind === 'lane' ? 'lane' : 'twy'));
    L.cutS = cuts.map((c) => c.s);
    // Haltepunkte (auch wenn der Schnitt mit einem anderen zusammengefallen ist)
    for (const h of L.cuts.filter((c) => c.hold)) {
      const k = cuts.reduce((bi, c, i) => (Math.abs(c.s - h.s) < Math.abs(cuts[bi].s - h.s) ? i : bi), 0);
      const n = nodes[L.nodeIds[k]];
      if (n.kind !== 'rwy') {
        n.kind = 'hold';
        n.rwy = h.hold;
      }
    }
    L.edgeIds = [];
    for (let k = 1; k < cuts.length; k++) {
      const mid = (cuts[k - 1].s + cuts[k].s) / 2;
      const zone = L.kind === 'rwy' ? null : (L.rwyCuts || []).find((q) => Math.abs(q.s - mid) < HOLD - 0.01);
      const e = addEdge(L.nodeIds[k - 1], L.nodeIds[k], slice(L, cuts[k - 1].s, cuts[k].s), L, zone ? 'rwz' : L.kind);
      if (e) {
        if (zone) e.rwy = zone.rwy;
        L.edgeIds.push(e.id);
      }
    }
  }
  // Knoten auf einer Bahnmittellinie gehören zur Bahn
  const runways = def.runways.map((r) => ({ ...r }));
  const rwyById = Object.fromEntries(runways.map((r) => [r.id, r]));
  for (const L of lines) if (L.kind === 'rwy') for (const id of L.nodeIds) {
    nodes[id].kind = 'rwy';
    nodes[id].rwy = L.rwy;
  }
  for (const n of nodes) n.edges = [...new Set(n.edges)];

  // Bahnenden: Schwelle, Richtung, Knoten entlang der Bahn
  const ends = {};
  for (const r of runways) {
    const L = lines.find((l) => l.kind === 'rwy' && l.rwy === r.id);
    r.line = L.i;
    r.len = dist(r.a, r.b);
    const d = norm(sub(r.b, r.a));
    r.dir = d;
    // Knoten entlang der Bahn mit Abstand von a
    r.nodes = L.nodeIds.map((id, k) => ({ id, s: L.cutS[k] })).sort((p, q) => p.s - q.s);
    for (const [k, endId] of r.ends.entries()) {
      const thr = k === 0 ? r.a : r.b;
      const dir = k === 0 ? d : mul(d, -1);
      ends[endId] = { id: endId, rwy: r.id, k, thr, dir, hdg: Math.atan2(dir.y, dir.x), brg: brgOfVec(dir.x, dir.y), oppo: r.ends[1 - k], len: r.len, exits: [], entries: [] };
    }
  }
  // Abstand eines Punkts von der Schwelle eines Bahnendes (entlang der Bahn)
  const sFrom = (end, p) => dot(sub(p, end.thr), end.dir);
  // Ausfahrten und Einfahrten je Bahnende
  for (const L of lines) {
    if (!L.exitOf && !L.entryOf) continue;
    // Bahnknoten dieser Linie und der Haltepunkt dahinter
    // Bahnknoten am Linienanfang (Ausfahrt) bzw. -ende (Einfahrt) und der Haltepunkt im Abstand HOLD
    const atStart = nodes[L.nodeIds[0]].kind === 'rwy';
    const rIdx = atStart ? 0 : L.nodeIds.length - 1;
    if (nodes[L.nodeIds[rIdx]].kind !== 'rwy') continue;
    const rn = L.nodeIds[rIdx];
    const sR = L.cutS[rIdx];
    const want = atStart ? sR + HOLD : sR - HOLD;
    let hIdx = -1;
    L.cutS.forEach((cs, i) => {
      if (nodes[L.nodeIds[i]].kind === 'hold' && (hIdx < 0 || Math.abs(cs - want) < Math.abs(L.cutS[hIdx] - want))) hIdx = i;
    });
    if (hIdx < 0) continue;
    const hold = L.nodeIds[hIdx];
    for (const endId of L.exitOf || []) {
      const end = ends[endId];
      if (!end) continue;
      end.exits.push({ line: L.i, name: L.name, rn, hold, s: sFrom(end, nodes[rn]), rapid: !!L.rapid });
    }
    for (const endId of L.entryOf || []) {
      const end = ends[endId];
      if (!end) continue;
      end.entries.push({ line: L.i, name: L.name, rn, hold, s: sFrom(end, nodes[rn]) });
    }
  }
  for (const e of Object.values(ends)) {
    e.exits.sort((p, q) => p.s - q.s);
    e.entries.sort((p, q) => p.s - q.s);
  }
  // Positionen: Ankerknoten auf der Gasse
  const stands = def.stands.map((st) => {
    const L = lines[st.lane];
    let best = null;
    for (const id of L.nodeIds) {
      const d = dist(nodes[id], st.anchor);
      if (!best || d < best.d) best = { id, d };
    }
    return { ...st, node: best.id };
  });
  for (const st of stands) nodes[st.node].stand = true;

  // Kartenbereich
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (p) => {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  for (const n of nodes) grow(n);
  for (const b of def.buildings) for (const p of b.poly) grow(p);
  const M = 30;
  const bounds = { x0: x0 - M, y0: y0 - M, x1: x1 + M, y1: y1 + M };

  return {
    ...def,
    lines,
    nodes,
    edges,
    runways,
    rwyById,
    ends,
    stands,
    bounds,
    center: { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 },
    runwayPoly: (r) => strip(r.a, r.b, r.w / 2),
  };
}

// Kurs eines Bahnendes als Kartenwinkel
export const endHdg = (end) => hdgOf(end.brg);
export { add, sub, mul };
