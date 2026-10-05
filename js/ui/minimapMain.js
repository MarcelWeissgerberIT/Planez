// Minikarte im Hauptspiel (Tower, Vorfeld, Manager, Beobachter): Abbild des eigenen Flughafens je Ausbaustufe aus der
// Geometrie in layout.js, Punkte für Flugzeuge und Fahrzeuge.
import * as LY from '../layout.js';
import { PH, RWY_PHASES } from '../sim/aircraft.js';
import { Minimap, MM_GRAY as G, mmLine } from './minimap.js';

const rect = (g, x0, y0, x1, y1) => g.fillRect(x0, y0, x1 - x0, y1 - y0);
const pt = (x, y) => ({ x, y });

function paintMain(g, k, state) {
  const st = LY.GEO.stage;
  const R = LY.RWY;
  const two = st >= 2 && !!(state.upgrades && state.upgrades.rwy2);
  // Gelände des Flughafens, Landseite mit Straße
  g.fillStyle = G.field;
  rect(g, -2, -1.5, LY.W + 2, LY.H + 1);
  g.fillStyle = G.land;
  rect(g, -2, -1.5, LY.W + 2, st >= 2 ? 9.6 : 7);
  g.strokeStyle = G.twy;
  mmLine(g, [pt(-2, 0), pt(LY.W + 2, 0)], 1.4, k, 1);
  if (st < 2) {
    // Grasplatz / Verkehrslandeplatz
    const x0 = Math.min(LY.CONN[0], R.thr['09']) - 0.6, x1 = Math.max(LY.CONN[LY.CONN.length - 1], R.thr['27']) + 0.6;
    g.strokeStyle = st === 0 ? G.mark : G.twy;
    const w = st === 0 ? 0.9 : 1.2;
    mmLine(g, [pt(x0, LY.TWY_A), pt(x1, LY.TWY_A)], w, k);
    for (const x of LY.EXITS) mmLine(g, [pt(x, R.y), pt(x, LY.TWY_A)], w, k);
    for (const c of LY.CONN) mmLine(g, [pt(c, LY.TWY_A), pt(c, LY.LANE)], w, k);
    mmLine(g, [pt(LY.CONN[0], LY.LANE), pt(LY.CONN[LY.CONN.length - 1], LY.LANE)], w * 0.7, k);
    if (st === 1) {
      g.fillStyle = G.apron;
      rect(g, 10.2, 14.6, 41.6, LY.LANE + 1.4);
    }
    g.fillStyle = R.grass ? G.grassRwy : G.rwy;
    rect(g, R.x0, R.y - R.hw, R.x1, R.y + R.hw);
  } else {
    // Vorfeld, Fracht und Depot, Hangar, Feuerwache, Tanklager
    const TM = LY.TERMINAL;
    g.fillStyle = G.apron;
    rect(g, 10.2, TM.y1, 68.4, LY.LANE + 1.6);
    rect(g, 49.5, 9.6, 74.5, 21);
    rect(g, 0.6, 21.2, 10.8, 27);
    rect(g, 36.9, 43.7, 39.6, 46.8);
    rect(g, 74.4, 12.6, 80.4, 17);
    if (LY.heliBaseOn()) {
      const a = LY.HELIBASE.apron;
      rect(g, a.x0, a.y0, a.x1, a.y1);
    }
    // Servicestraße und Rollwege
    g.strokeStyle = G.mark;
    mmLine(g, [pt(10.5, LY.SERVICE), pt(74, LY.SERVICE)], 0.8, k, 0.8);
    g.strokeStyle = G.twy;
    mmLine(g, [pt(6.4, LY.TWY_A), pt(73.6, LY.TWY_A)], 1.35, k);
    for (const x of LY.EXITS) mmLine(g, [pt(x, R.y), pt(x, LY.TWY_A)], 1.35, k);
    for (const c of LY.CONN) mmLine(g, [pt(c, LY.TWY_A), pt(c, LY.LANE)], 1.35, k);
    mmLine(g, [pt(12, LY.LANE), pt(66, LY.LANE)], 1.1, k);
    mmLine(g, [pt(5.5, 26.8), pt(5.5, LY.TWY_A), pt(9, LY.TWY_A)], 1.1, k);
    mmLine(g, [pt(37.35, R.y), pt(37.35, 43.9)], 0.9, k, 0.8); // Feuerwehrzufahrt
    if (two) {
      const S = LY.RWY_S;
      mmLine(g, [pt(6.4, LY.TWY_B), pt(73.6, LY.TWY_B)], 1.35, k);
      for (const x of LY.EXITS_S) mmLine(g, [pt(x, S.y), pt(x, LY.TWY_B)], 1.35, k);
      for (const c of LY.CROSS) mmLine(g, [pt(c, LY.TWY_B), pt(c, R.y)], 1.35, k);
      g.fillStyle = G.rwy;
      rect(g, S.x0, S.y - S.hw, S.x1, S.y + S.hw);
    }
    g.fillStyle = G.rwy;
    rect(g, R.x0, R.y - R.hw, R.x1, R.y + R.hw);
    // Positionen (gebaute) als dezente Felder
    g.fillStyle = G.mark;
    for (const s of state.stands || []) {
      if (!s.built || s.ga) continue;
      const hw = s.size === 'L' ? 2.4 : 1.8;
      rect(g, s.x - hw, LY.STAND_NOSE, s.x + hw, LY.STAND_NOSE + (s.size === 'L' ? 5.4 : 4));
    }
    // Terminal
    g.fillStyle = G.term;
    rect(g, TM.x0, TM.y0, TM.x1, TM.y1);
  }
  // Wiesenplätze am kleinen Platz
  g.fillStyle = G.mark;
  for (const s of state.stands || []) if (s.ga && s.built) rect(g, s.x - 0.8, LY.GA_NOSE, s.x + 0.8, LY.GA_NOSE + 1.8);
  // Gebäude
  for (const b of LY.BUILDINGS) {
    if (!LY.buildingOn(state, b)) continue;
    g.fillStyle = b.id === 'hall' || b.id === 'sterm' ? G.term : G.bld;
    rect(g, b.fx - b.w, b.fy - b.d, b.fx, b.fy);
  }
}

// Rahmen der Minikarte: am kleinen Platz eng um Bahn, Rollwege und Gebäude, sonst das ganze Gelände
function extentPoints(state) {
  if (!state || LY.GEO.stage >= 2) return [pt(-2, -1.5), pt(LY.W + 2, -1.5), pt(LY.W + 2, LY.H + 1), pt(-2, LY.H + 1)];
  const R = LY.RWY, out = [];
  const box = (x0, y0, x1, y1) => out.push(pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1));
  box(R.x0 - 4, R.y - R.hw - 4, R.x1 + 4, R.y + R.hw + 4);
  box(Math.min(LY.CONN[0], R.thr['09']) - 2, 8, Math.max(LY.CONN[LY.CONN.length - 1], R.thr['27']) + 2, LY.LANE + 2);
  for (const b of LY.BUILDINGS) if (LY.buildingOn(state, b)) box(b.fx - b.w - 2, b.fy - b.d - 2, b.fx + 2, b.fy + 2);
  return out;
}

// Farbe je Flugzeug: Luft (Ring), Bahn rot, rollt grün, an der Position blau
function acClass(state, ac) {
  if (ac.z > 0.05) return 'air';
  if (RWY_PHASES.has(ac.phase)) return 'rwy';
  if (state.upgrades && state.upgrades.rwy2 && ac.y > LY.HOLD_Y - 0.2 && ac.y < LY.HOLD_CROSS + 0.2 && ac.x > LY.RWY.x0 && ac.x < LY.RWY.x1) return 'rwy'; // kreuzt die Nordbahn
  if (ac.phase === PH.STAND) return 'stand';
  return 'taxi';
}

export function createMainMinimap(game, el) {
  return new Minimap({
    el,
    cam: () => game.cam,
    bounds: () => ({ x0: -2, y0: -1.5, x1: LY.W + 2, y1: LY.H + 1 }),
    points: () => extentPoints(game.state),
    key: () => {
      const s = game.state;
      if (!s) return '';
      return [LY.GEO.stage, LY.RWY.x0, LY.RWY.x1, LY.RWY.grass ? 1 : 0, LY.EXITS.join(','), LY.CONN.join(','), s.upgrades && s.upgrades.rwy2 ? 1 : 0, s.upgrades && s.upgrades.hotel ? 1 : 0, (s.stands || []).map((x) => (x.built ? x.size : '-')).join('')].join('|');
    },
    paint: (g, k) => game.state && paintMain(g, k, game.state),
    dots: () => {
      const s = game.state;
      if (!s) return [];
      const out = [];
      for (const v of s.vehicles || []) out.push({ x: v.x, y: v.y, c: 'veh', dim: v.st === 'idle' });
      for (const ac of s.acs || []) if (ac.mode === 'map') out.push({ x: ac.x, y: ac.y, c: acClass(s, ac) });
      return out;
    },
    jump: (x, y) => {
      const cam = game.cam;
      if (game.ui) game.ui.follow = null;
      cam.tx = null;
      cam.x = x;
      cam.y = y;
      cam.clampPos();
    },
    onToggle: (on) => {
      const b = document.getElementById('t-minimap');
      if (b) b.classList.toggle('on', on);
    },
  });
}
