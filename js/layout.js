// Flughafen-Geometrie (Weltkoordinaten in Kacheln; x = Ost, y = Süd) und Wegeplanung
import { roundedPath, clamp } from './util.js';
import { NM_PER_TILE } from './config.js';

export const W = 80;
export const H = 50;
export const RWY = { y: 32.2, x0: 5, x1: 75, hw: 1.2, thr: { '09': 8, '27': 72 }, td: 3 };
// zweite Parallelbahn (Süd) – erst nach dem Ausbau in Betrieb
export const RWY_S = { y: 41.6, x0: 5, x1: 75, hw: 1.2, thr: { '09': 8, '27': 72 }, td: 3 };
export const TWY_B = 36.9; // Parallelrollweg zwischen den Bahnen
export const HOLD_CROSS = 34.75; // Haltelinie südlich der Nordbahn (vor dem Kreuzen)
export const EXITS_S = [14, 26, 38, 50, 62];
export const CROSS = [20, 32, 44, 56]; // Kreuzungen der Nordbahn
export const TWY_A = 27.6;
export const HOLD_Y = 29.9;
export const LANE = 23.8;
export const SERVICE = 15.3;
export const STAND_NOSE = 16.3;
export const EXITS = [8, 20, 32, 44, 56, 72];
export const CONN = [12, 38.5, 66];
export const ARP = { x: 40, y: 32.2 };
export const TERMINAL = { x0: 12, x1: 49.5, y0: 10.6, y1: 14.6, h: 1.0 };
export const BUS_GATE = { x: 50.4, y: SERVICE };
export const APPROACH_TILES = 24; // sichtbarer Endanflug vor der Schwelle

// Parkpositionen: kind = contact | remote | cargo
export const STAND_DEFS = [
  { id: 1, x: 16, kind: 'contact', size: 'M', built: true },
  { id: 2, x: 21, kind: 'contact', size: 'M', built: true },
  { id: 3, x: 26, kind: 'contact', size: 'L', built: true },
  { id: 4, x: 31, kind: 'contact', size: 'M', built: true },
  { id: 5, x: 36, kind: 'contact', size: 'L', built: true },
  { id: 6, x: 41, kind: 'contact', size: 'M', built: false },
  { id: 7, x: 46, kind: 'contact', size: 'M', built: false },
  { id: 8, x: 51, kind: 'remote', size: 'M', built: true },
  { id: 9, x: 57, kind: 'cargo', size: 'L', built: true },
  { id: 10, x: 63, kind: 'cargo', size: 'L', built: false },
];

// Gebäude: fx/fy = vordere Ecke (max x, max y), w/d = Grundfläche, frac = Lage der Ecke im Sprite
export const BUILDINGS = [
  { id: 'hall', sprite: 'terminal_hall', fx: 36.2, fy: 10.7, w: 11.3, d: 9.6, frac: 0.54, name: 'Terminal' },
  { id: 'tower', sprite: 'tower', fx: 77.2, fy: 8.2, w: 1.6, d: 1.5, frac: 0.51, name: 'Tower' },
  { id: 'hangar', sprite: 'hangar', fx: 9.5, fy: 21.4, w: 6.8, d: 6.6, frac: 0.51, name: 'Wartungshangar' },
  { id: 'cargo', sprite: 'cargo', fx: 64.5, fy: 14.2, w: 10.3, d: 4.2, frac: 0.71, name: 'Frachtterminal' },
  { id: 'depot', sprite: 'gse_depot', fx: 73.5, fy: 14.4, w: 4.6, d: 3.6, frac: 0.56, name: 'Fahrzeugdepot' },
  { id: 'fire', sprite: 'fire_station', fx: 40, fy: 48.6, w: 4.4, d: 2.7, frac: 0.62, name: 'Feuerwache' },
  { id: 'fuel', sprite: 'fuel_farm', fx: 80, fy: 16.6, w: 3.6, d: 3.6, frac: 0.49, name: 'Tanklager' },
  { id: 'parking', sprite: 'parking', fx: 54, fy: 8.8, w: 5.4, d: 4.6, frac: 0.54, name: 'Parkhaus' },
  { id: 'hotel', sprite: 'hotel', fx: 18.5, fy: 8.4, w: 3.1, d: 3.1, frac: 0.49, name: 'Hotel', requires: 'hotel' },
  { id: 'radar', sprite: 'radar', fx: 6.5, fy: 48.5, w: 1.7, d: 1.5, frac: 0.53, name: 'Radar' },
];

// Solarpark südlich der Piste, Bahnhof im Westen der Landseite
export const SOLAR = { x0: 47.5, x1: 62.5, y0: 45.3, y1: 49.6 };
export const RAIL = { y: 5.15, x0: -16, x1: 10.2, station: { x0: 2.0, x1: 8.0, y0: 1.9, y1: 3.7 }, platform: { y0: 4.1, y1: 4.78 } };

export const DEPOT_BAYS = (() => {
  const bays = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) bays.push({ x: 66.9 + c * 0.95, y: 16.4 + r * 1.25 });
  return bays;
})();

// Bäume deterministisch verteilen (nicht auf befestigten Flächen)
export function isPaved(x, y) {
  if (y > RWY.y - RWY.hw - 0.6 && y < RWY.y + RWY.hw + 0.6 && x > RWY.x0 - 1 && x < RWY.x1 + 1) return true;
  if (y > 33 && y < 44.2) return true; // Reservefläche für die Parallelbahn
  if (y > 9 && y < 29 && x > 0 && x < 75) return true; // Vorfeld/Rollwege-Zone grob
  if (y < 1.2) return true; // Straße
  return false;
}
export function makeTrees() {
  const trees = [];
  let s = 1234567;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const zones = [
    { x0: 0, x1: 80, y0: 44.6, y1: 50 },
    { x0: 0, x1: 12, y0: 1.6, y1: 9 },
    { x0: 72.9, x1: 75.3, y0: 1.6, y1: 8 },
    { x0: 0, x1: 4, y0: 23, y1: 29 },
    { x0: 76, x1: 80, y0: 18, y1: 29 },
  ];
  for (const z of zones) {
    const n = Math.round(((z.x1 - z.x0) * (z.y1 - z.y0)) / 7);
    for (let i = 0; i < n; i++) {
      const x = z.x0 + r() * (z.x1 - z.x0);
      const y = z.y0 + r() * (z.y1 - z.y0);
      if (x > 32 && x < 42 && y > 43 && y < 49.6) continue; // Feuerwache
      if (x > 2 && x < 7.5 && y > 45.3 && y < 49.5) continue; // Radar
      if (x > 64 && x < 68 && y > 43.6 && y < 46) continue; // Windsack
      trees.push({ x, y, t: r() < 0.55 ? 'tree1' : 'tree2', s: 0.8 + r() * 0.5 });
    }
  }
  return trees;
}

// ---------- Umrechnung Karte <-> Luftraum ----------
export const tileToNm = (tx, ty) => ({ x: (tx - ARP.x) * NM_PER_TILE, y: (ty - ARP.y) * NM_PER_TILE });
export const nmToTile = (nx, ny) => ({ x: ARP.x + nx / NM_PER_TILE, y: ARP.y + ny / NM_PER_TILE });

// Richtung der Landung/des Starts auf der Karte (+1 = nach Osten, -1 = nach Westen)
export const rwyDir = (rwy) => (rwy === '09' ? 1 : -1);

// Stand-Geometrie
export function standCenter(stand, len) {
  return { x: stand.x, y: STAND_NOSE + len / 2 };
}

// ---------- Rollwege ----------
function P(x, y) {
  return { x, y };
}

// Rollweg vom Abrollpunkt (auf Rollweg A) zur Parkposition
export function pathTaxiIn(fromX, stand, len, rwy) {
  return roundedPath(dedupe(taxiInPts(fromX, stand, len, rwy)), 1.15, 0.2);
}
function taxiInPts(fromX, stand, len, rwy) {
  const sx = stand.x;
  const cy = STAND_NOSE + len / 2;
  const pts = [P(fromX, TWY_A)];
  if (rwy === '27') {
    // Vorfeldstraße ostwärts: Einfahrt westlich des Standes
    const cands = [12, 38.5].filter((c) => c <= sx - 2.4);
    const c = Math.max(...cands);
    pts.push(P(c, TWY_A), P(c, LANE));
  } else {
    const cands = [38.5, 66].filter((c) => c >= sx + 2.4);
    const c = Math.min(...cands);
    pts.push(P(c, TWY_A), P(c, LANE));
  }
  pts.push(P(sx, LANE), P(sx, cy));
  return pts;
}

// Pushback: von Parkposition rückwärts auf die Vorfeldstraße
export function pathPushback(stand, len, rwy) {
  const sx = stand.x;
  const cy = STAND_NOSE + len / 2;
  const d = rwy === '27' ? -1 : 1; // Heck schwenkt in diese Richtung
  const endX = sx + d * Math.max(1.8, len * 0.6);
  const pts = [P(sx, cy), P(sx, LANE), P(endX, LANE)];
  return roundedPath(pts, 1.1, 0.15);
}

// Nach dem Pushback zum Rollhalt
export function pathTaxiOut(fromX, rwy, len) {
  const pts = [P(fromX, LANE)];
  const hy = Math.max(TWY_A + 0.4, HOLD_Y - len / 2 - 0.1);
  if (rwy === '27') {
    pts.push(P(66, LANE), P(66, TWY_A), P(RWY.thr['27'], TWY_A), P(RWY.thr['27'], hy));
  } else {
    pts.push(P(12, LANE), P(12, TWY_A), P(RWY.thr['09'], TWY_A), P(RWY.thr['09'], hy));
  }
  const path = roundedPath(dedupe(pts), 1.15, 0.2);
  return path;
}

// Aufrollen auf die Piste
export function pathLineUp(rwy, len) {
  const tx = RWY.thr[rwy];
  const d = rwyDir(rwy);
  const hy = Math.max(TWY_A + 0.4, HOLD_Y - len / 2 - 0.1);
  return roundedPath([P(tx, hy), P(tx, RWY.y), P(tx + d * Math.max(2.2, len * 0.6), RWY.y)], 1.0, 0.15);
}

// Landung: Ausrollen bis Abrollweg, dann auf Rollweg A (in Flussrichtung)
export function pathRollout(rwy, exitX, len) {
  const d = rwyDir(rwy);
  const tdx = RWY.thr[rwy] + d * RWY.td;
  const pts = [P(tdx, RWY.y), P(exitX, RWY.y), P(exitX, TWY_A)];
  // weiter auf A in Richtung Einfahrt
  let nextX;
  if (rwy === '27') nextX = exitX <= 8.5 ? exitX + 2.2 : exitX - Math.max(1.6, len * 0.7);
  else nextX = exitX >= 71.5 ? exitX - 2.2 : exitX + Math.max(1.6, len * 0.7);
  pts.push(P(nextX, TWY_A));
  return roundedPath(pts, 1.3, 0.2);
}

// ---------- Südbahn ----------
// Landung auf der Südbahn: Ausrollen, nach Norden auf Rollweg B, bis zur Haltelinie vor der Nordbahn
export function crossingFor(rwy, exitX) {
  const d = rwyDir(rwy);
  const ahead = CROSS.filter((c) => (c - exitX) * d >= 1.5).sort((a, b) => (a - exitX) * d - (b - exitX) * d);
  if (ahead.length) return ahead[0];
  return CROSS.reduce((a, b) => (Math.abs(b - exitX) < Math.abs(a - exitX) ? b : a));
}
export function holdCrossY(len) {
  return HOLD_CROSS + len / 2 + 0.15;
}
export function pathRolloutS(rwy, exitX, len, crossX) {
  const d = rwyDir(rwy);
  const tdx = RWY_S.thr[rwy] + d * RWY_S.td;
  const pts = [P(tdx, RWY_S.y), P(exitX, RWY_S.y), P(exitX, TWY_B), P(crossX, TWY_B), P(crossX, holdCrossY(len))];
  return roundedPath(dedupe(pts), 1.3, 0.2);
}
export function exitsAheadS(rwy) {
  const d = rwyDir(rwy);
  const tdx = RWY_S.thr[rwy] + d * RWY_S.td;
  return EXITS_S.filter((x) => (x - tdx) * d > 4).sort((a, b) => (a - tdx) * d - (b - tdx) * d);
}
// Kreuzen der Nordbahn und weiter zur Parkposition
export function pathCrossIn(crossX, stand, len, rwy) {
  return roundedPath(dedupe([P(crossX, holdCrossY(len)), ...taxiInPts(crossX, stand, len, rwy)]), 1.15, 0.2);
}
// Zone der Nordbahn (für Kreuzungen)
export const inNorthRunwayZone = (y) => y > HOLD_Y - 0.2 && y < HOLD_CROSS + 0.2;

// Warteposition ohne Parkposition: Ende von Rollweg A in Flussrichtung
export function waitSpotX(rwy, len, slot = 0) {
  if (rwy === '27') return RWY.thr['09'] + len / 2 + 0.6 + slot * (len + 0.8);
  return RWY.thr['27'] - len / 2 - 0.6 - slot * (len + 0.8);
}
export function pathToWait(fromX, rwy, len, slot = 0) {
  const x = waitSpotX(rwy, len, slot);
  return roundedPath([P(fromX, TWY_A), P(x, TWY_A)], 1, 0.2);
}

// Verfügbare Abrollwege in Landerichtung, nach Entfernung
export function exitsAhead(rwy) {
  const d = rwyDir(rwy);
  const tdx = RWY.thr[rwy] + d * RWY.td;
  return EXITS.filter((x) => (x - tdx) * d > 4).sort((a, b) => (a - tdx) * d - (b - tdx) * d);
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l.x - p.x, l.y - p.y) > 0.05) out.push(p);
  }
  return out;
}

// ---------- Fahrzeuge ----------
// Service-Punkte relativ zum Flugzeug (fwd entlang Nase, right nach Steuerbord), in Kacheln
export function servicePoint(kind, ac) {
  const L = ac.len;
  const off = {
    unload: [-0.22 * L, 0.42, 0],
    load: [-0.22 * L, 0.42, 0],
    fuel: [0.02 * L, 0.36 + L * 0.2, 0],
    cater: [0.3 * L, 0.42, 0],
    clean: [-0.34 * L, -0.42, Math.PI],
    deboard: [0.18 * L, -0.95, 0],
    board: [0.18 * L, -0.95, 0],
    push: [0.5 * L + 0.3, 0, Math.PI],
    deice: [-0.08 * L, -(0.4 + L * 0.2), 0],
  }[kind] || [0, 0.6, 0];
  const h = ac.hdg; // Weltwinkel der Nase
  const fx = Math.cos(h), fy = Math.sin(h);
  const rx = -fy, ry = fx; // rechts (Steuerbord) bei y nach unten
  return { x: ac.x + fx * off[0] + rx * off[1], y: ac.y + fy * off[0] + ry * off[1], hdg: h + off[2] };
}

// Weg für ein Fahrzeug: über die Servicestraße
export function vehPath(from, to) {
  const pts = [P(from.x, from.y)];
  const nearRoad = Math.abs(from.y - SERVICE) < 0.3;
  if (!nearRoad) pts.push(P(from.x, SERVICE));
  if (Math.abs(to.x - from.x) > 0.3 || !nearRoad) pts.push(P(to.x, SERVICE));
  pts.push(P(to.x, to.y));
  return roundedPath(dedupe(pts), 0.5, 0.15);
}

// Fluggastbrücke: Drehpunkt am Terminal
export function bridgeRoot(stand) {
  return { x: stand.x - 1.55, y: TERMINAL.y1 + 0.05 };
}
export function bridgeDoor(stand, len) {
  // linke vordere Tür bei Nase nach Norden
  return { x: stand.x - 0.26, y: STAND_NOSE + len * 0.13 };
}

export function clampToMap(x, y) {
  return { x: clamp(x, -30, W + 30), y: clamp(y, -30, H + 30) };
}
