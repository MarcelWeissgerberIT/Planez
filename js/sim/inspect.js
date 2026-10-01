// Pistenkontrolle: Alle paar Stunden (6–22 Uhr) bittet das Kontrollfahrzeug „Runway Check 1“ per Funk,
// die Hauptbahn abfahren zu dürfen (3 Minuten). Der Lotse gibt frei, sobald eine Lücke im Verkehr ist –
// dann ist die Bahn gesperrt (keine Landungen, Starts warten). Freigabe mit Verkehr im kurzen Endanflug oder
// auf der Bahn gilt als Pistenbetretung (Incursion). Bleibt die Kontrolle lange aus, steigt das FOD-Risiko;
// manchmal findet die Kontrolle Fremdkörper, bevor etwas passiert.
import { PH } from './aircraft.js';
import * as AS from './airspace.js';
import { radio, log, notify } from './messages.js';
import { closeRunway, runwayClosed, rwyName } from './runway.js';
import { penalize } from './economy.js';
import { scoreInspect } from './score.js';

export const INSP_MIN = 3; // Minuten auf der Bahn
export const CHECK = 'CHECK1';
const EVERY = 3 * 3600;
const humanTower = (s) => s.role === 'tower' && !s.auto.atc;
// gleichmäßige Pseudozufallszahl aus der Spielzeit (verbraucht den Zufallsgenerator des Spiels nicht)
const hash01 = (t) => {
  let h = (Math.floor(t / 60) * 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

export function inspState(state) {
  if (!state.insp) state.insp = { last: state.time, next: state.time + EVERY * (0.3 + 0.5 * hash01(state.time)), req: null, active: null, found: 0, done: 0 };
  return state.insp;
}

// FOD-Risiko je nach Zeit seit der letzten Kontrolle (Faktor für das Zufallsereignis)
export function fodRisk(state) {
  const I = state.insp;
  if (!I) return 1;
  return Math.max(0.35, Math.min(3, (state.time - I.last) / EVERY));
}

// Wer wäre von einer Sperrung jetzt betroffen? hard = Pistenbetretung (Landefreigabe kurz vor der Schwelle, Flugzeug auf der Bahn)
export function inspConflict(state) {
  let soft = null;
  for (const a of state.acs) {
    if (a.mode === 'map' && [PH.FINAL, PH.ROLLOUT, PH.LINEUP, PH.LINED, PH.TAKEOFF].includes(a.phase)) {
      if (a.phase === PH.ROLLOUT && a.vacated) continue;
      if (a.phase === PH.TAKEOFF && a.z > 1) continue;
      if (a.arr && (a.strip || 'N') !== 'N') continue;
      return { ac: a, hard: true, why: a.phase === PH.FINAL ? 'im kurzen Endanflug' : a.arr ? 'auf der Bahn' : 'auf der Bahn' };
    }
    if (a.mode === 'air' && a.arr && a.phase === PH.APPROACH && (a.strip || 'N') === 'N') {
      const d = AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]);
      if (a.clr.land && d < 6) return { ac: a, hard: true, why: `mit Landefreigabe ${d.toFixed(1)} NM vor der Schwelle` };
      if (d < 11 && (!soft || d < soft.d)) soft = { ac: a, hard: false, d, why: `${d.toFixed(1)} NM im Anflug – müsste durchstarten` };
    }
  }
  return soft;
}

function rq(state) {
  return `${rwyName(state, 'N')}`;
}

export function approveInspection(state) {
  const I = inspState(state);
  if (!I.req) return { ok: false, msg: 'Keine Anfrage der Pistenkontrolle offen' };
  const c = inspConflict(state);
  const rn = rq(state);
  I.req = null;
  I.active = { start: state.time, until: state.time + INSP_MIN * 60 };
  closeRunway(state, INSP_MIN, 'Pistenkontrolle', 'N');
  radio(state, 'TWR', `Runway Check 1, enter runway ${rn}, inspection approved, report vacated.`, 'atc');
  radio(state, CHECK, `Entering runway ${rn} for inspection, wilco, Check 1.`, 'pilot');
  if (c && c.hard) {
    penalize(state, 'incursion', c.ac);
    log(state, 'sys', `⚠ Pistenbetretung: Kontrollfahrzeug auf Bahn ${rn}, während ${c.ac.cs} ${c.why} ist.`);
    notify(state, `⚠ Pistenbetretung! Kontrollfahrzeug auf der Bahn, ${c.ac.cs} ${c.why}`, 'bad');
    return { ok: true, bad: true };
  }
  if (humanTower(state)) scoreInspect(state, !c);
  return { ok: true, soft: c };
}

export function deferInspection(state) {
  const I = inspState(state);
  if (!I.req) return { ok: false };
  radio(state, 'TWR', `Runway Check 1, hold short runway ${rq(state)}, traffic, expect entry in five minutes.`, 'atc');
  radio(state, CHECK, `Holding short, Check 1.`, 'pilot');
  I.req = null;
  I.next = state.time + 5 * 60;
  I.deferred = (I.deferred || 0) + 1;
  return { ok: true };
}

export function updateInspection(state, dt) {
  if (state.scenario && !state.scenario.inspect) return;
  const I = inspState(state);
  const h = (state.time / 3600) % 24;
  // laufende Kontrolle beenden
  if (I.active && state.time >= I.active.until) {
    const rn = rq(state);
    I.active = null;
    I.last = state.time;
    I.done++;
    I.next = state.time + EVERY * (0.85 + 0.3 * hash01(state.time));
    const found = hash01(state.time + 7) < 0.18;
    if (found) {
      I.found++;
      const L = state.life || (state.life = {});
      L.fodFound = (L.fodFound || 0) + 1;
      radio(state, CHECK, `Tower, Check 1, runway ${rn} vacated, debris found and removed, runway clear.`, 'pilot');
      log(state, 'sys', `🚙 Pistenkontrolle beendet – Fremdkörper gefunden und entfernt, bevor etwas passiert ist.`);
      notify(state, '🚙 Pistenkontrolle: Fremdkörper gefunden und entfernt', 'good');
    } else {
      radio(state, CHECK, `Tower, Check 1, runway ${rn} vacated, inspection complete, nothing found.`, 'pilot');
    }
    return;
  }
  if (I.active) return;
  // offene Anfrage: Auto-Lotse gibt in einer Lücke frei, der Spieler entscheidet selbst (Erinnerung nach 20 min)
  if (I.req) {
    if (runwayClosed(state, 'N')) return;
    if (!humanTower(state)) {
      const c = inspConflict(state);
      const quiet = !c && !state.acs.some((a) => a.mode === 'air' && a.arr && a.phase === PH.APPROACH && (a.strip || 'N') === 'N' && AS.routeDistance(a.pos, a.route.length ? a.route : [AS.THR[a.rwy]]) < 13) && !state.acs.some((a) => a.phase === PH.LINEUP || a.phase === PH.LINED);
      if (quiet || (state.time - I.req.t > 40 * 60 && (!c || !c.hard))) approveInspection(state);
    } else if (state.time - (I.req.remind || I.req.t) > 20 * 60) {
      I.req.remind = state.time;
      radio(state, CHECK, `Tower, Check 1, still holding short runway ${rq(state)}, request inspection.`, 'pilot');
    }
    return;
  }
  if (state.time < I.next || h < 6 || h > 22 || runwayClosed(state, 'N') || state.rwyWorking || state.rwyPending) return;
  I.req = { t: state.time };
  radio(state, CHECK, `Tower, Runway Check 1, holding point A, request enter runway ${rq(state)} for inspection, ${INSP_MIN} minutes.`, 'pilot');
  if (humanTower(state)) notify(state, `🚙 Pistenkontrolle bittet, Bahn ${rq(state)} abzufahren (${INSP_MIN} min) – Lücke im Verkehr abpassen`, 'info');
}
