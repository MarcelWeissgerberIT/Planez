// Rettungshubschrauber „Rescue 7“: Ab dem Regionalflughafen hat er seine Luftrettungsstation südlich der Bahnen neben
// der Feuerwache. Bei Alarm läuft der Rotor an, er hebt ab und fliegt nach Süden zum Einsatz. Mit dem Patienten an Bord
// will er auf dem Weg zur Klinik nördlich des Flughafens die Bahnen in der Mitte queren, nach der Übergabe auf dem Rückweg
// zur Station noch einmal in die andere Richtung; dort landet er, der Rotor läuft aus. (Am kleinen Platz ohne Station
// quert er nur auf dem Weg zur Klinik.) Der Lotse gibt die Querung frei, sobald niemand im kurzen Endanflug, auf der Bahn
// oder im Startlauf ist; bis dahin schwebt der Hubschrauber vor den Bahnen. Freigabe mit Verkehr im Weg =
// Verkehrskonflikt. Wer ihn zu lange warten lässt, verzögert einen Patiententransport.
import { PH } from './aircraft.js';
import * as AS from './airspace.js';
import { radio, log, notify } from './messages.js';
import { penalize, earn, rescueLandingFee } from './economy.js';
import { scoreHeli } from './score.js';
import { hasRwy2 } from './runway.js';
import { clamp } from '../util.js';
import { pushNews } from './news.js';
import { T } from '../i18n.js';
import { HELIBASE, heliBaseOn } from '../layout.js';

export const HELI = 'RESCUE7';
const X = 44; // Querung in Bahnmitte
const Y_START = 64, Y_END = -14;
const holdY = (state) => (hasRwy2(state) ? 46.5 : 37.5); // Warteposition südlich der Bahnen
const HOLD_N = 26.5; // Warteposition nördlich der Bahnen (über dem Vorfeldrand)
const southEdge = (state) => (hasRwy2(state) ? 43.6 : 34.6); // ab hier ist er südlich frei von den Bahnen
const EVERY = 5 * 3600;
const CRUISE = 0.16; // Kacheln je Spielsekunde im Reiseflug
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
        return { ac: a, hard: true, why: a.phase === PH.FINAL ? T('im kurzen Endanflug') : a.phase === PH.TAKEOFF ? T('im Startlauf') : a.phase === PH.LINED ? T('mit Startfreigabe auf der Bahn') : T('auf der Bahn') };
      continue;
    }
    if (a.arr && a.phase === PH.APPROACH) {
      const d = AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]);
      if (a.clr.land && d < 5) return { ac: a, hard: true, why: T`mit Landefreigabe ${d.toFixed(1)} NM vor der Schwelle` };
      if (d < 9 && (!soft || d < soft.d)) soft = { ac: a, hard: false, d, why: T`${d.toFixed(1)} NM im Anflug` };
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
  radio(state, 'TWR', `Rescue 7, cross runways at midfield, no delay, report clear ${H.dir > 0 ? 'south' : 'north'}.`, 'atc');
  radio(state, HELI, `Crossing midfield, no delay, Rescue 7.`, 'pilot');
  if (c && c.hard) {
    penalize(state, 'incursion', c.ac);
    log(state, 'sys', T`⚠ Verkehrskonflikt: Rescue 7 quert die Bahn, während ${c.ac.cs} ${c.why} ist.`);
    notify(state, T`⚠ Verkehrskonflikt! Hubschrauber quert, ${c.ac.cs} ${c.why}`, 'bad');
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
  const side = H.dir > 0 ? 'north' : 'south';
  radio(state, 'TWR', `Rescue 7, hold ${side} of the runways, traffic on final, expect crossing shortly.`, 'atc');
  radio(state, HELI, `Holding ${side}, Rescue 7.`, 'pilot');
  return { ok: true };
}

// Hubschrauber über den Bahnen (zwischen den Wartepositionen)?
export function heliOverRunways(state) {
  const H = state.heli && state.heli.h;
  return !!H && H.st === 'cross' && H.y > 26 && H.y < southEdge(state);
}
// sichtbarer Hubschrauber für Karte und 3D-Ansicht: im Flug oder auf der Station abgestellt (Rotor steht)
export function heliOnMap(state) {
  const S = state.heli;
  if (S && S.h) return S.h;
  if (S && S.park && heliBaseOn()) return { x: HELIBASE.pad.x, y: HELIBASE.pad.y, z: 0, hdg: HELIBASE.hdg, rpm: 0, st: 'park' };
  return null;
}

// Anfrage zum Queren: dir -1 = von Süden nach Norden (zur Klinik), +1 = von Norden nach Süden (zurück zur Station)
function request(state, dir) {
  const S = heliState(state);
  S.n++;
  const north = dir > 0;
  // von der Klinik kommend taucht er über der Landseite auf (gleich lange bis zur Warteposition wie von Süden)
  S.h = { x: X + (hash01(state.time) - 0.5) * 6, y: north ? 2 : Y_START, z: 1.3, hdg: north ? Math.PI / 2 : -Math.PI / 2, st: 'req', t: state.time, rot: 0, dir, rpm: 1 };
  if (north) radio(state, HELI, `Planez Tower, Rescue 7, helicopter, three miles north, returning to the rescue station, request crossing your runways at midfield southbound.`, 'pilot');
  else radio(state, HELI, `Planez Tower, Rescue 7, helicopter, five miles south, request crossing your runways at midfield northbound, priority patient transport.`, 'pilot');
  if (humanTower(state)) notify(state, north ? T('🚁 Rettungshubschrauber bittet, auf dem Rückweg zur Station die Bahnen zu queren – Lücke im Verkehr abpassen') : T('🚁 Rettungshubschrauber bittet, die Bahnen zu queren – Lücke im Verkehr abpassen'), 'info');
}

const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export function updateHeli(state, dt) {
  if (state.scenario && !state.scenario.side) return;
  const S = heliState(state);
  const H = S.h;
  const hr = (state.time / 3600) % 24;
  const base = heliBaseOn();
  const pad = HELIBASE.pad;
  if (!H) {
    if (!base) {
      if (state.time < S.next || hr < 7 || hr > 21 || state.time < 3600) return;
      request(state, -1);
      return;
    }
    if (S.park === undefined && !S.away) S.park = true;
    // zurück vom Einsatz mit Patient (Querung nach Norden) bzw. von der Klinik (Querung nach Süden zur Station)
    if ((S.away === 'scene' || S.away === 'clinic') && state.time >= S.back) {
      const dir = S.away === 'scene' ? -1 : 1;
      S.away = null;
      request(state, dir);
      return;
    }
    if (!S.park || state.time < S.next || hr < 7 || hr > 21 || state.time < 3600) return;
    // Alarm: Crew läuft zum Hubschrauber, Rotor läuft an
    S.park = false;
    S.h = { x: pad.x, y: pad.y, z: 0, hdg: HELIBASE.hdg, st: 'spin', t: state.time, rot: 0, dir: 0, rpm: 0 };
    radio(state, HELI, `Planez Tower, Rescue 7, at the rescue station, starting up for an emergency mission, departing southbound.`, 'pilot');
    radio(state, 'TWR', `Rescue 7, depart southbound at your discretion, report leaving the control zone.`, 'atc');
    log(state, 'sys', T('🚁 Alarm an der Luftrettungsstation – Rescue 7 startet zum Einsatz.'));
    return;
  }
  // Station: Rotor an- bzw. auslaufen lassen, abheben, landen
  if (H.st === 'spin') {
    H.rpm = Math.min(1, H.rpm + dt / 75);
    if (H.rpm >= 1) H.st = 'lift';
    return;
  }
  if (H.st === 'lift') {
    H.z = Math.min(1.3, H.z + dt * 0.022);
    H.hdg = turn(H.hdg, Math.PI / 2, Math.min(1, dt * 0.02));
    if (H.z > 0.5) H.y += CRUISE * 0.4 * dt;
    if (H.z >= 1.3) H.st = 'out';
    return;
  }
  if (H.st === 'out') {
    H.hdg = turn(H.hdg, Math.PI / 2, Math.min(1, dt * 0.05));
    H.y += CRUISE * dt;
    H.x += (X - H.x) * Math.min(1, dt * 0.01);
    if (H.y > Y_START) {
      S.h = null;
      S.away = 'scene';
      S.back = state.time + (20 + 15 * hash01(state.time + 7)) * 60;
    }
    return;
  }
  if (H.st === 'home' || H.st === 'land') {
    // zur Station: über dem Landeplatz anhalten, eindrehen, sinken
    const dx = pad.x - H.x, dy = pad.y - H.y, d = Math.hypot(dx, dy);
    if (H.st === 'home') {
      H.hdg = turn(H.hdg, Math.atan2(dy, dx), Math.min(1, dt * 0.05));
      const v = Math.min(CRUISE, 0.03 + d * 0.06);
      if (d > 0.02) {
        H.x += (dx / d) * Math.min(d, v * dt);
        H.y += (dy / d) * Math.min(d, v * dt);
      }
      if (d < 0.08) H.st = 'land';
      return;
    }
    H.x += dx * Math.min(1, dt * 0.05);
    H.y += dy * Math.min(1, dt * 0.05);
    H.hdg = turn(H.hdg, HELIBASE.hdg, Math.min(1, dt * 0.03));
    H.z = Math.max(0, H.z - dt * 0.018);
    if (H.z <= 0) {
      H.st = 'down';
      radio(state, HELI, `Tower, Rescue 7, landed at the rescue station.`, 'pilot');
      earn(state, 'rescue', rescueLandingFee(state)); // Landeentgelt der Luftrettung
    }
    return;
  }
  if (H.st === 'down') {
    H.rpm = Math.max(0, H.rpm - dt / 100);
    if (H.rpm <= 0) {
      S.h = null;
      S.park = true;
      S.next = state.time + EVERY * (0.8 + 0.5 * hash01(state.time + 5));
    }
    return;
  }
  // Flug: Anflug bis zur Warteposition vor den Bahnen, dort schweben; nach Freigabe zügig hinüber
  const dir = H.dir || -1;
  const hy = dir < 0 ? holdY(state) : HOLD_N;
  const v = H.st === 'cross' ? CRUISE : 0.09;
  const fly = dir < 0 ? -Math.PI / 2 : Math.PI / 2;
  if (H.st === 'around') {
    H.x += 0.14 * dt;
    H.y += (hy + 2 * -dir - H.y) * Math.min(1, dt * 0.02);
    H.hdg = 0;
    if (H.x > 100) {
      if (base && dir > 0) {
        // um die Kontrollzone herum zurück zur Station: von Osten südlich an allem vorbei
        S.h = { x: 100, y: 50, z: 1.3, hdg: Math.PI, st: 'home', t: state.time, rot: 0, dir: 0, rpm: 1 };
        return;
      }
      S.h = null;
      if (base) {
        S.away = 'clinic';
        S.back = state.time + 15 * 60;
      } else S.next = state.time + EVERY * (0.8 + 0.5 * hash01(state.time + 5));
    }
    return;
  }
  const before = dir < 0 ? H.y > hy : H.y < hy;
  if (H.st === 'cross' || before) {
    H.y += dir * Math.min(v * dt, H.st === 'cross' ? 99 : Math.abs(H.y - hy));
    H.x += (X - H.x) * Math.min(1, dt * 0.02);
    H.hdg = fly;
  } else {
    // Schwebeflug an der Warteposition: langsam auf der Stelle drehen
    H.hdg = fly + Math.sin(state.time / 40) * 0.35;
  }
  if (H.st === 'cross' && !H.clearRep && (dir < 0 ? H.y < 27 : H.y > southEdge(state))) {
    H.clearRep = true;
    radio(state, HELI, `Tower, Rescue 7, clear of the runways ${dir < 0 ? 'northbound' : 'southbound'}.`, 'pilot');
    if (dir > 0 && base) H.st = 'home'; // weiter zum Landeplatz der Station
  }
  if (dir < 0 && H.y < Y_END) {
    S.h = null;
    if (base) {
      S.away = 'clinic';
      S.back = state.time + (12 + 8 * hash01(state.time + 3)) * 60;
    } else S.next = state.time + EVERY * (0.8 + 0.5 * hash01(state.time + 5));
    return;
  }
  if (H.st !== 'req') return;
  const waited = state.time - H.t;
  const atHold = (m) => (dir < 0 ? H.y <= hy + m : H.y >= hy - m);
  if (!humanTower(state)) {
    const c = heliConflict(state);
    if (atHold(1) && (!c || (waited > 6 * 60 && !c.hard))) approveHeli(state);
    return;
  }
  if (waited > 3 * 60 && atHold(0.5) && !H.remind) {
    H.remind = true;
    if (dir < 0) radio(state, HELI, `Tower, Rescue 7, holding south, request crossing, we have a critical patient on board.`, 'pilot');
    else radio(state, HELI, `Tower, Rescue 7, holding north, request crossing back to the rescue station, we are on standby for the next mission.`, 'pilot');
  }
  if (waited > 7 * 60 && !H.late) {
    H.late = true;
    state.reputation = clamp(state.reputation - 0.5, 0, 100);
    log(state, 'sys', dir < 0 ? T('🚁 Rescue 7 wartet seit sieben Minuten auf die Querung – der Patiententransport verzögert sich.') : T('🚁 Rescue 7 wartet seit sieben Minuten auf die Querung zurück zur Station – so fehlt er beim nächsten Einsatz.'));
  }
  // nach 15 Minuten ohne Antwort: Umweg um die Kontrollzone
  if (waited > 15 * 60) {
    H.st = 'around';
    radio(state, HELI, 'Tower, Rescue 7, unable to wait any longer, routing around your control zone to the east.', 'pilot');
    state.reputation = clamp(state.reputation - 1, 0, 100);
    pushNews(state, T('Rettungshubschrauber muss um den Flughafen herumfliegen – Kritik an der Flugsicherung.'), 'bad', '🚁');
    log(state, 'sys', dir < 0 ? T('🚁 Rescue 7 hat keine Querung bekommen und fliegt um die Kontrollzone herum – der Patient kommt deutlich später an.') : T('🚁 Rescue 7 hat keine Querung bekommen und fliegt um die Kontrollzone herum zurück zur Station.'));
  }
}
