// Abflugrouten (SIDs) nach Zielrichtung über die vier Fixe des Radars.
// Zwei Starts auf derselben Route brauchen mehr Abstand als auf verschiedenen – die Startreihenfolge wird zum Puzzle.
import { CITIES } from '../config.js';
import { wakeDepSec } from './wake.js';

export const SID_SAME_SEC = 100; // gleiche Abflugroute: 100 s zwischen zwei Starts (statt 75 s)
export const SIDS = { NOLTA: 'Nordost', SUDEN: 'Südost', RIMOS: 'Südwest', WELDA: 'Nordwest' };
export function sidOfBrg(brg) {
  const b = ((brg % 360) + 360) % 360;
  return b < 90 ? 'NOLTA' : b < 180 ? 'SUDEN' : b < 270 ? 'RIMOS' : 'WELDA';
}
export function sidOf(state, ac) {
  if (ac.sid) return ac.sid;
  const rot = state.rots[ac.rot];
  const c = rot && CITIES[rot.city];
  if (!c) return null;
  ac.sid = sidOfBrg(c.brg);
  return ac.sid;
}
// Mindestabstand zwischen zwei Starts (Sekunden): Wirbelschleppe oder gleiche Abflugroute
export function depSepSec(leadWake, leadSid, follWake, follSid) {
  return Math.max(wakeDepSec(leadWake, follWake), leadSid && leadSid === follSid ? SID_SAME_SEC : 0);
}
// Abstand zum letzten Start für dieses Flugzeug und der bindende Grund
export function depGap(state, ac) {
  const sid = sidOf(state, ac);
  const wake = wakeDepSec(state.lastTakeoffWake, ac.wake);
  const same = !!(state.lastTakeoffSid && sid && state.lastTakeoffSid === sid);
  const sec = Math.max(wake, same ? SID_SAME_SEC : 0);
  return { sec, since: state.time - (state.lastTakeoff || -1e9), why: same && SID_SAME_SEC >= wake ? `gleiche Abflugroute (${sid})` : 'Wirbelschleppen-Abstand', sid, same };
}
