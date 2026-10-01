// Luftraum in NM relativ zum Flughafenbezugspunkt (x = Ost, y = Süd)
import { RWY, ARP, APPROACH_TILES } from '../layout.js';
import { NM_PER_TILE } from '../config.js';
import { DEG, bearing, degNorm } from '../util.js';

export const RADAR_RANGE = 45;
export const FAF_DIST = 10;
export const IP_DIST = 15;
export const THR = {
  '09': { x: (RWY.thr['09'] - ARP.x) * NM_PER_TILE, y: 0 },
  '27': { x: (RWY.thr['27'] - ARP.x) * NM_PER_TILE, y: 0 },
};
// nach einer Änderung der Pistengeometrie (Karriere-Ausbaustufe) die Schwellen im Luftraum nachziehen
export function syncThr() {
  THR['09'].x = (RWY.thr['09'] - ARP.x) * NM_PER_TILE;
  THR['27'].x = (RWY.thr['27'] - ARP.x) * NM_PER_TILE;
}
// Anflugseite: bei 27 kommt der Verkehr von Osten (+x)
export const appSide = (rwy) => (rwy === '27' ? 1 : -1);
export const finalCrs = (rwy) => (rwy === '27' ? 270 : 90);
export const finalPoint = (rwy, d) => ({ x: THR[rwy].x + appSide(rwy) * d, y: 0 });
export const MAP_FINAL_NM = APPROACH_TILES * NM_PER_TILE;

export const FIXES = {
  '27': { N: { name: 'NOLTA', x: 22, y: -11 }, S: { name: 'SUDEN', x: 22, y: 11 } },
  '09': { N: { name: 'WELDA', x: -22, y: -11 }, S: { name: 'RIMOS', x: -22, y: 11 } },
};
export const ALL_FIXES = [...Object.values(FIXES['27']), ...Object.values(FIXES['09'])];

// Warteschleife: Rechteck außen am Fix
export function holdPattern(fix) {
  const dx = Math.sign(fix.x) || 1;
  const dy = Math.sign(fix.y) || 1;
  return [
    { x: fix.x, y: fix.y },
    { x: fix.x + dx * 5, y: fix.y },
    { x: fix.x + dx * 5, y: fix.y + dy * 3.5 },
    { x: fix.x, y: fix.y + dy * 3.5 },
  ];
}

export function sideOf(pos) {
  return pos.y < 0 ? 'N' : 'S';
}

// Route zum IAF (bei Einflug von der „falschen“ Seite über Korridor)
export function inboundRoute(pos, rwy) {
  const side = sideOf(pos);
  const fix = FIXES[rwy][side];
  const s = appSide(rwy);
  const route = [];
  if (pos.x * s < 4) route.push({ x: 0, y: side === 'N' ? -26 : 26, name: '' });
  route.push({ x: fix.x, y: fix.y, name: fix.name, iaf: true });
  return route;
}

// Anflugroute ab aktueller Position
export function approachRoute(pos, rwy) {
  const s = appSide(rwy);
  const thr = THR[rwy];
  const ip = finalPoint(rwy, IP_DIST);
  const faf = finalPoint(rwy, FAF_DIST);
  const along = (pos.x - thr.x) * s; // Abstand entlang der Anflugachse
  const route = [];
  if (along < FAF_DIST + 1.5) {
    // zu nah/überflogen: Umweg
    route.push({ x: thr.x + s * (FAF_DIST + 6), y: pos.y < 0 ? -6 : 6, name: '' });
    route.push({ ...ip, name: 'IP' });
  } else if (along > IP_DIST + 1 || Math.abs(pos.y) > 3) {
    route.push({ ...ip, name: 'IP' });
  }
  route.push({ ...faf, name: 'FAF', faf: true });
  route.push({ x: thr.x, y: thr.y, name: 'THR', thr: true });
  return route;
}

// Direkt zum FAF (Vektor), mit Abkürzung
export function directRoute(pos, rwy) {
  const faf = finalPoint(rwy, FAF_DIST);
  const thr = THR[rwy];
  const s = appSide(rwy);
  const along = (pos.x - thr.x) * s;
  if (along < FAF_DIST + 1.5) return approachRoute(pos, rwy);
  return [{ ...faf, name: 'FAF', faf: true }, { x: thr.x, y: thr.y, name: 'THR', thr: true }];
}

// Abflugroute: Pistenrichtung, dann Richtung Ziel
export function departureRoute(rwy, exitBrg, range = RADAR_RANGE + 3) {
  const s = -appSide(rwy); // Startrichtung
  const route = [{ x: s * (range < RADAR_RANGE ? 3 : 7), y: 0, name: '' }];
  const ex = { x: Math.sin(exitBrg * DEG) * range, y: -Math.cos(exitBrg * DEG) * range, name: 'EXIT', exit: true };
  // Ziel auf der Anflugseite: großzügig nördlich/südlich ausweichen
  if (ex.x * s < -5) {
    const sy = ex.y < 0 ? -1 : 1;
    route.push({ x: s * 9, y: sy * 16, name: '' });
    route.push({ x: 0, y: sy * 32, name: '' });
  }
  route.push(ex);
  return route;
}

export const glideAlt = (dNm) => Math.max(0, dNm * 318 + 50);
export const distToThr = (pos, rwy) => (pos.x - THR[rwy].x) * appSide(rwy);

// Entfernung entlang der verbleibenden Route bis zur Schwelle
export function routeDistance(pos, route) {
  let d = 0;
  let p = pos;
  for (const w of route) {
    d += Math.hypot(w.x - p.x, w.y - p.y);
    p = w;
  }
  return d;
}

export function spawnPoint(brg, r = RADAR_RANGE - 1) {
  return { x: Math.sin(brg * DEG) * r, y: -Math.cos(brg * DEG) * r };
}
export const crsTo = (a, b) => bearing(a.x, a.y, b.x, b.y);
export const crsToWorld = (crs) => (degNorm(crs) - 90) * DEG; // Kompass -> Weltwinkel
export const worldToCrs = (a) => degNorm(a / DEG + 90);
