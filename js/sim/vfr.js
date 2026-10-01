// Platzrunden: Tagsüber bei gutem Wetter übt ab und zu eine Cessna 172 Touch-and-Go – Platzrunde nördlich der Bahn
// (Steigflug, Querabflug, Gegenanflug, Queranflug, Endanflug, Aufsetzen und Durchstarten). Im Gegenanflug bittet der
// Pilot um „touch and go“; der Lotse gibt frei, sobald zwischen den Linienflügen Platz ist, sonst fliegt die Cessna
// am Ende des Gegenanflugs einen Vollkreis. Während sie aufsetzt, ist die Bahn belegt (Linienflüge müssen warten bzw.
// durchstarten); ist die Bahn im kurzen Endanflug belegt, startet sie selbst durch.
import { PH, runwayBlocker } from './aircraft.js';
import * as AS from './airspace.js';
import { radio, log, notify } from './messages.js';
import { scoreVfr } from './score.js';
import { runwayClosed } from './runway.js';
import { RWY } from '../layout.js';
import { clamp } from '../util.js';
import { T } from '../i18n.js';

const EVERY = 3 * 3600;
const humanTower = (s) => s.role === 'tower' && !s.auto.atc && !(s.settings && s.settings.inspAuto);
const hash01 = (t) => {
  let h = (Math.floor(t / 60) * 2246822519 + 31) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 3266489917) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};
const LET = 'ABCDEFGHIKLMNOPRSTUW';

// Platzrunde für die Betriebsrichtung (Landerichtung 27 = nach Westen); x gespiegelt für 09
// (Punkte relativ zur aktuellen Piste – in der Karriere ist sie am Grasplatz nur 560 m lang)
function circuit(rwy) {
  const Y = RWY.y, DW = 22;
  const k = (RWY.x1 - RWY.x0) / 70;
  const td = RWY.thr['27'] - 3 * Math.min(1, k * 1.4);
  const lift = td - 12 * k;
  const up = RWY.x0 + 25 * k;
  const P = [
    { x: RWY.x1 + 13, y: Y, z: 1.5, k: 'final' },
    { x: td, y: Y, z: 0, k: 'td' },
    { x: lift, y: Y, z: 0, k: 'lift' },
    { x: up, y: Y, z: 2.4, k: 'up' },
    { x: up - 5, y: 27.5, z: 3, k: 'cross' },
    { x: up, y: DW, z: 3.2, k: 'dw0' },
    { x: RWY.x1 + 9, y: DW, z: 3.2, k: 'dw1' },
    { x: RWY.x1 + 14, y: 26.5, z: 2.4, k: 'base' },
  ];
  const mid = (RWY.x0 + RWY.x1) / 2;
  return rwy === '27' ? P : P.map((p) => ({ ...p, x: 2 * mid - p.x }));
}
const SPD = 0.26, SPD_GND = 0.16; // Kacheln/s – etwa 90 kt im Verhältnis zu den Linienflügen (135 kt ≈ 0,42)
// Funk-Rufzeichen im ICAO-Alphabet: beim Erstanruf vollständig („Delta Echo Kilo Lima Mike“), danach wie in
// Deutschland üblich abgekürzt auf Nationalitätszeichen und die letzten beiden Buchstaben („Delta Lima Mike“)
export const PHON = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', W: 'Whiskey' };
export const vfrTel = (cs, full = false) => {
  const l = cs.replace('-', '');
  return (full ? l.split('') : [l[0], l[3], l[4]]).map((c) => PHON[c] || c).join(' ');
};
const tel = (cs) => vfrTel(cs);

export function vfrState(state) {
  if (!state.vfr) state.vfr = { next: state.time + EVERY * (0.3 + 0.6 * hash01(state.time + 3)), p: null, n: 0 };
  return state.vfr;
}

// Wer wäre im Weg, wenn die Cessna jetzt zum Touch-and-Go freigegeben wird? (Linienverkehr im Endanflug, auf der Bahn, Startlauf)
export function vfrConflict(state) {
  let soft = null;
  for (const a of state.acs) {
    if (a.mode === 'map') {
      if ((a.strip || 'N') !== 'N') continue;
      if (a.phase === PH.FINAL || (a.phase === PH.ROLLOUT && !a.vacated) || (a.phase === PH.TAKEOFF && a.z < 1) || a.phase === PH.LINED || a.phase === PH.LINEUP)
        return { ac: a, hard: true, why: a.phase === PH.FINAL ? T('im kurzen Endanflug') : a.phase === PH.TAKEOFF ? T('im Startlauf') : T('auf der Bahn') };
      continue;
    }
    if (a.arr && a.phase === PH.APPROACH && (a.strip || 'N') === 'N') {
      const d = AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]);
      if (d < 6) return { ac: a, hard: true, why: T`${d.toFixed(1)} NM im Anflug` };
      if (d < 10 && (!soft || d < soft.d)) soft = { ac: a, hard: false, d, why: T`${d.toFixed(1)} NM im Anflug` };
    }
  }
  return soft;
}

// Entfernung der nächsten Linienlandung auf der Nordbahn (NM; 0 = schon im kurzen Endanflug)
function nextArrival(state) {
  let m = 99;
  for (const a of state.acs) {
    if (!a.arr || (a.strip || 'N') !== 'N') continue;
    if (a.mode === 'map' && a.phase === PH.FINAL) return 0;
    if (a.mode === 'air' && a.phase === PH.APPROACH) m = Math.min(m, AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]));
  }
  return m;
}

export function clearVfr(state) {
  const p = vfrState(state).p;
  if (!p || !p.req || p.clr) return { ok: false };
  const c = vfrConflict(state);
  p.clr = true;
  p.req = false;
  p.orbits = 0;
  radio(state, 'TWR', T`${tel(p.cs)}, runway ${p.rwy}, cleared touch and go, wind ${Math.round(state.wind.dir / 10) * 10} degrees ${Math.round(state.wind.spd)} knots.`, 'atc');
  radio(state, p.cs, `Cleared touch and go ${p.rwy}, ${tel(p.cs)}.`, 'pilot');
  if (humanTower(state)) scoreVfr(state, !(c && c.hard));
  return { ok: true, bad: !!(c && c.hard), soft: c && !c.hard ? c : null, c };
}

export function extendVfr(state) {
  const p = vfrState(state).p;
  if (!p || !p.req || p.clr || p.told) return { ok: false };
  p.told = true;
  radio(state, 'TWR', `${tel(p.cs)}, extend downwind, make one orbit at the end of downwind, traffic on final.`, 'atc');
  radio(state, p.cs, `Extending, one orbit, ${tel(p.cs)}.`, 'pilot');
  return { ok: true };
}

function setOcc(state, p) {
  // Freigegebene Cessna im Queranflug/Endanflug: wie eine Landung für die Startplanung (Entfernung in NM bis zum Aufsetzen)
  if (p.clr && p.mode === 'circuit' && [6, 7, 0, 1].includes(p.i)) {
    const C = p.C;
    let dist = Math.hypot(C[p.i].x - p.x, C[p.i].y - p.y);
    for (let k = p.i; k !== 1; k = (k + 1) % C.length) {
      const a = C[k], b = C[(k + 1) % C.length];
      dist += Math.hypot(b.x - a.x, b.y - a.y);
    }
    state.vfrFinal = (dist / SPD) * (135 / 3600); // Flugzeit bis zum Aufsetzen als NM eines Linienflugs im Anflug
  } else state.vfrFinal = null;
  // Belegung der Nordbahn für die Linienflug-Logik: kurz vor dem Aufsetzen und beim Ausrollen/Startlauf
  const onRwy = p.mode !== 'orbit' && p.mode !== 'leave' && p.i >= 0 && ((p.i === 1 && p.z < 0.9) || p.i === 2 || (p.i === 3 && p.z < 0.5));
  state.vfrOcc = onRwy ? { cs: p.cs, phase: p.z < 0.05 ? PH.ROLLOUT : PH.FINAL, mode: 'map', strip: 'N', x: p.x, y: p.y, z: p.z, vacated: false, vfr: true, block: p.z < 0.45 } : null;
}

export function updateVfr(state, dt) {
  if (state.scenario && !state.scenario.side) return; // in Herausforderungen nur, wenn das Drehbuch es vorsieht
  const S = vfrState(state);
  const hr = (state.time / 3600) % 24;
  const wxOk = ['clear', 'clouds'].includes(state.weather.kind);
  let p = S.p;
  if (!p) {
    state.vfrOcc = null;
    state.vfrFinal = null; // sonst hält ein alter Endanflug-Wert alle Starts auf
    if (state.time < S.next || state.time < 2 * 3600 || state.rwyPending) return;
    const early = state.scenario ? 6 : 8; // in Herausforderungen fliegt die Flugschule schon ab 6 Uhr
    if (hr < early || hr > 18.5 || !wxOk) {
      // erst wieder am nächsten Vormittag bzw. bei besserem Wetter
      S.next = hr < early ? state.time + (early - hr) * 3600 + (state.scenario ? 0 : hash01(state.time) * 3 * 3600) : state.time + 3600;
      return;
    }
    S.n++;
    const h = hash01(state.time);
    const cs = `D-E${LET[Math.floor(h * 20)]}${LET[Math.floor(hash01(state.time + 7 * 60) * 20)]}${LET[Math.floor(hash01(state.time + 13 * 60) * 20)]}`;
    const C = circuit(state.rwy);
    const sx = state.rwy === '27' ? 34 : 46;
    S.p = p = { cs, rwy: state.rwy, x: sx, y: -6, z: 3.4, hdg: Math.PI / 2, i: 5, mode: 'join', laps: 0, lapsMax: 3 + Math.floor(h * 3), clr: false, req: false, orbits: 0 };
    p.C = C;
    radio(state, cs, `Planez Tower, ${vfrTel(cs, true)}, Alcedo AL-4, five miles north, request circuits with touch and go.`, 'pilot');
    radio(state, 'TWR', `${vfrTel(cs, true)}, join downwind runway ${state.rwy}, report downwind.`, 'atc');
    if (humanTower(state)) notify(state, T`🛩️ ${cs} übt Platzrunden – im Gegenanflug um „Touch and Go“ bitten lassen und in eine Lücke setzen`, 'info');
    return;
  }
  // Betriebsrichtung gewechselt oder Wetter schlecht: Platzrunden abbrechen
  if (p.mode !== 'leave' && (p.rwy !== state.rwy || !wxOk)) {
    p.mode = 'leave';
    p.clr = false;
    p.req = false;
    radio(state, p.cs, `${tel(p.cs)}, terminating circuits, leaving the control zone to the north.`, 'pilot');
  }
  const C = p.C;
  // Ziel des aktuellen Abschnitts
  let tgt;
  if (p.mode === 'leave') tgt = { x: p.x + (p.rwy === '27' ? -1 : 1) * 30, y: -14, z: 3.6 };
  else if (p.mode === 'orbit') {
    p.oa += dt * 0.1;
    const R = 2.6;
    const cx = p.ox, cy = p.oy;
    tgt = { x: cx + Math.cos(p.oa) * R, y: cy + Math.sin(p.oa) * R, z: 3.2 };
    if (p.oa - p.oa0 > Math.PI * 2) {
      p.mode = 'circuit';
      p.orbits++;
      if (!p.clr && !humanTower(state)) p.told = false;
    }
  } else tgt = C[p.i];
  const dx = tgt.x - p.x, dy = tgt.y - p.y;
  const d = Math.hypot(dx, dy);
  const v = (p.i === 2 && p.mode === 'circuit' ? SPD_GND : SPD) * dt;
  if (p.mode === 'orbit') {
    p.x = tgt.x;
    p.y = tgt.y;
    p.z = 3.2;
    p.hdg = p.oa + Math.PI / 2;
    setOcc(state, p);
    if (p.req && !p.clr && !humanTower(state) && !vfrConflict(state) && nextArrival(state) >= 14 && !runwayClosed(state, 'N')) clearVfr(state);
    return;
  } else if (d > 1e-6) {
    const k = Math.min(1, v / d);
    // Höhe gleitend zum Ziel
    p.z += (tgt.z - p.z) * Math.min(1, k * 1.2);
    p.x += dx * k;
    p.y += dy * k;
    const hd = Math.atan2(dy, dx);
    const diff = ((hd - p.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    p.hdg += clamp(diff, -dt * 0.05, dt * 0.05);
  }
  if (p.mode === 'leave') {
    if (p.y < -12) {
      S.p = null;
      S.next = state.time + EVERY * (0.7 + 0.6 * hash01(state.time + 9));
      state.vfrOcc = null;
    }
    return;
  }
  // Anfrage im Gegenanflug
  if (p.mode === 'circuit' && p.i === 6 && !p.clr && !p.req && Math.abs(p.x - (C[5].x + C[6].x) / 2) < 6) {
    p.req = true;
    p.reqT = state.time;
    p.told = false;
    radio(state, p.cs, `${tel(p.cs)}, downwind runway ${p.rwy}, request touch and go.`, 'pilot');
  }
  // Auto-Lotse: frei, sobald Platz ist – erst am Ende des Gegenanflugs, damit die Lücke bis zum Aufsetzen hält
  if (p.req && !p.clr && !humanTower(state) && Math.abs(p.x - C[6].x) < 12 && !vfrConflict(state) && nextArrival(state) >= 14 && !runwayClosed(state, 'N')) clearVfr(state);
  // Endanflug: belegte Bahn → selbst durchstarten
  if (p.mode === 'circuit' && p.i === 1 && p.z < 1.2 && p.z > 0.05) {
    const blk = runwayBlocker(state, { strip: 'N', vfr: true });
    if (blk || runwayClosed(state, 'N') || !p.clr) {
      p.mode = 'ga';
      p.i = 3;
      p.clr = false;
      radio(state, p.cs, `${tel(p.cs)}, going around${blk ? `, traffic on the runway` : ''}.`, 'pilot');
      const L = state.life || (state.life = {});
      L.vfrGa = (L.vfrGa || 0) + 1;
    }
  }
  if (p.mode === 'ga') p.z = Math.max(p.z, 1.2);
  setOcc(state, p);
  if (d > Math.max(0.35, v * 1.2)) return;
  // Abschnitt erreicht
  if (p.mode === 'join' && p.i === 5) p.mode = 'circuit';
  if (p.mode === 'ga' && p.i === 3) p.mode = 'circuit';
  if (p.i === 6 && !p.clr) {
    // Ende Gegenanflug ohne Freigabe: Vollkreis
    p.mode = 'orbit';
    p.ox = p.x;
    p.oy = p.y - 2.6;
    p.oa0 = p.oa = Math.PI / 2;
    if (p.orbits >= 3) {
      p.mode = 'leave';
      p.req = false;
      radio(state, p.cs, `${tel(p.cs)}, unable to continue, leaving the control zone to the north.`, 'pilot');
      if (humanTower(state)) {
        state.reputation = clamp(state.reputation - 0.3, 0, 100);
        log(state, 'sys', T`🛩️ ${p.cs} hat nach drei Vollkreisen keine Freigabe bekommen und bricht die Platzrunden ab.`);
      }
    }
    return;
  }
  if (p.i === 1) p.z = 0;
  if (p.i === 2) {
    // abgehoben: Runde geschafft
    p.laps++;
    p.clr = false;
    const L = state.life || (state.life = {});
    L.touchGo = (L.touchGo || 0) + 1;
  }
  if (p.i === 3 && p.laps >= p.lapsMax) {
    p.mode = 'leave';
    radio(state, p.cs, `${tel(p.cs)}, last circuit completed, leaving the control zone to the north, thank you.`, 'pilot');
    radio(state, 'TWR', `${tel(p.cs)}, approved, good day.`, 'atc');
    return;
  }
  p.i = (p.i + 1) % C.length;
}
