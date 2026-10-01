// Rettungshubschrauber „Rescue 7“: Ein paar Mal am Tag will er die Kontrollzone auf dem Weg zur Klinik nördlich des
// Flughafens queren – im Tiefflug quer über die Bahnen. Der Lotse gibt die Querung frei, sobald niemand im kurzen
// Endanflug, auf der Bahn oder im Startlauf ist; bis dahin schwebt der Hubschrauber südlich der Bahnen.
// Freigabe mit Verkehr im Weg = Verkehrskonflikt. Wer ihn zu lange warten lässt, verzögert einen Patiententransport.
import { PH } from './aircraft.js';
import * as AS from './airspace.js';
import { radio, log, notify } from './messages.js';
import { penalize } from './economy.js';
import { scoreHeli } from './score.js';
import { hasRwy2 } from './runway.js';
import { clamp } from '../util.js';

export const HELI = 'RESCUE7';
const X = 44; // Querung in Bahnmitte
const Y_START = 64, Y_END = -14;
const holdY = (state) => (hasRwy2(state) ? 46.5 : 37.5);
const EVERY = 5 * 3600;
const humanTower = (s) => s.role === 'tower' && !s.auto.atc && !(s.settings && s.settings.inspAuto);
const hash01 = (t) => {
  let h = (Math.floor(t / 60) * 2654435761 + 97) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

export function heliState(state) {
  if (!state.heli) state.heli = { next: state.time + EVERY * (0.4 + 0.5 * hash01(state.time)), h: null, n: 0 };
  return state.heli;
}

// Wer kreuzt den Weg des Hubschraubers? hard = Konflikt (im kurzen Endanflug mit Landefreigabe, auf der Bahn, im Startlauf)
export function heliConflict(state) {
  let soft = null;
  for (const a of state.acs) {
    if (a.mode === 'map') {
      if (a.phase === PH.FINAL || (a.phase === PH.ROLLOUT && !a.vacated) || (a.phase === PH.TAKEOFF && a.z < 2) || (a.phase === PH.LINED && a.clr && a.clr.takeoff))
        return { ac: a, hard: true, why: a.phase === PH.FINAL ? 'im kurzen Endanflug' : a.phase === PH.TAKEOFF ? 'im Startlauf' : a.phase === PH.LINED ? 'mit Startfreigabe auf der Bahn' : 'auf der Bahn' };
      continue;
    }
    if (a.arr && a.phase === PH.APPROACH) {
      const d = AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]);
      if (a.clr.land && d < 5) return { ac: a, hard: true, why: `mit Landefreigabe ${d.toFixed(1)} NM vor der Schwelle` };
      if (d < 9 && (!soft || d < soft.d)) soft = { ac: a, hard: false, d, why: `${d.toFixed(1)} NM im Anflug` };
    }
  }
  return soft;
}

export function approveHeli(state) {
  const H = heliState(state).h;
  if (!H || H.st !== 'req') return { ok: false };
  const c = heliConflict(state);
  H.st = 'cross';
  H.clrT = state.time;
  const L = state.life || (state.life = {});
  L.heliX = (L.heliX || 0) + 1;
  radio(state, 'TWR', `Rescue 7, cross runways at midfield, no delay, report clear north.`, 'atc');
  radio(state, HELI, `Crossing midfield, no delay, Rescue 7.`, 'pilot');
  if (c && c.hard) {
    penalize(state, 'incursion', c.ac);
    log(state, 'sys', `⚠ Verkehrskonflikt: Rescue 7 quert die Bahn, während ${c.ac.cs} ${c.why} ist.`);
    notify(state, `⚠ Verkehrskonflikt! Hubschrauber quert, ${c.ac.cs} ${c.why}`, 'bad');
    if (humanTower(state)) scoreHeli(state, false);
    return { ok: true, bad: true };
  }
  if (humanTower(state)) scoreHeli(state, true);
  return { ok: true, soft: c };
}

export function holdHeli(state) {
  const H = heliState(state).h;
  if (!H || H.st !== 'req' || H.told) return { ok: false };
  H.told = true;
  radio(state, 'TWR', `Rescue 7, hold south of the runways, traffic on final, expect crossing shortly.`, 'atc');
  radio(state, HELI, `Holding south, Rescue 7.`, 'pilot');
  return { ok: true };
}

export function updateHeli(state, dt) {
  if (state.scenario) return;
  const S = heliState(state);
  const H = S.h;
  const hr = (state.time / 3600) % 24;
  if (!H) {
    if (state.time < S.next || hr < 7 || hr > 21 || state.time < 3600) return;
    S.n++;
    S.h = { x: X + (hash01(state.time) - 0.5) * 6, y: Y_START, z: 1.3, hdg: -Math.PI / 2, st: 'req', t: state.time, rot: 0 };
    radio(state, HELI, `Planez Tower, Rescue 7, helicopter, five miles south, request crossing your runways at midfield northbound, priority patient transport.`, 'pilot');
    if (humanTower(state)) notify(state, '🚁 Rettungshubschrauber bittet, die Bahnen zu queren – Lücke im Verkehr abpassen', 'info');
    return;
  }
  // Flug: Anflug bis zum Wartepunkt südlich der Bahnen, dort schweben; nach Freigabe zügig nach Norden
  const hy = holdY(state);
  const v = H.st === 'cross' ? 0.16 : 0.09;
  if (H.st === 'cross' || H.y > hy) {
    H.y -= Math.min(v * dt, H.st === 'cross' ? 99 : H.y - hy);
    H.x += (X - H.x) * Math.min(1, dt * 0.02);
    H.hdg = -Math.PI / 2;
  } else {
    // Schwebeflug am Wartepunkt: langsam auf der Stelle drehen
    H.hdg = -Math.PI / 2 + Math.sin(state.time / 40) * 0.35;
  }
  if (H.st === 'cross' && H.y < 27 && !H.clearRep) {
    H.clearRep = true;
    radio(state, HELI, `Tower, Rescue 7, clear of the runways northbound.`, 'pilot');
  }
  if (H.y < Y_END) {
    S.h = null;
    S.next = state.time + EVERY * (0.8 + 0.5 * hash01(state.time + 5));
    return;
  }
  if (H.st !== 'req') return;
  const waited = state.time - H.t;
  if (!humanTower(state)) {
    const c = heliConflict(state);
    if (H.y <= hy + 1 && (!c || (waited > 6 * 60 && !c.hard))) approveHeli(state);
    return;
  }
  if (waited > 3 * 60 && !H.remind) {
    H.remind = true;
    radio(state, HELI, `Tower, Rescue 7, holding south, request crossing, we have a critical patient on board.`, 'pilot');
  }
  if (waited > 7 * 60 && !H.late) {
    H.late = true;
    state.reputation = clamp(state.reputation - 0.5, 0, 100);
    log(state, 'sys', '🚁 Rescue 7 wartet seit sieben Minuten auf die Querung – der Patiententransport verzögert sich.');
  }
}
