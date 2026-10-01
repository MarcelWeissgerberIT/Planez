// Schichtpunkte mit Kombo-Multiplikator (Tower und Vorfeld): direkte Rückmeldung für gute Arbeit,
// Durchstarts, Vorfälle und große Verspätungen setzen die Kombo zurück
import { fx } from './messages.js';
import { PH } from './aircraft.js';

const MAXC = 3;
export function scoreState(state) {
  if (!state.score) state.score = { pts: 0, combo: 1, best: 0, today: 0, bestDay: 0, streak: 0 };
  return state.score;
}
const active = (state, role) => state.role === role && !state.auto[role === 'tower' ? 'atc' : 'ground'];

function add(state, ac, base, label) {
  const S = scoreState(state);
  const p = Math.round(base * S.combo);
  S.pts += p;
  S.today += p;
  S.streak++;
  S.best = Math.max(S.best, S.pts);
  const c = S.combo;
  S.combo = Math.min(MAXC, Math.round((S.combo + 0.1) * 10) / 10);
  if (ac && ac.mode === 'map') fx(state, ac.x, ac.y - 0.6, `⭐ +${p} ${label}${c > 1 ? ` ×${c.toFixed(1)}` : ''}`, 'score');
  return p;
}
function fail(state, ac, minus, label) {
  const S = scoreState(state);
  S.pts = Math.max(0, S.pts - minus);
  S.today = Math.max(0, S.today - minus);
  const lost = S.combo > 1.05;
  S.combo = 1;
  S.streak = 0;
  if (ac && ac.mode === 'map') fx(state, ac.x, ac.y - 0.6, `✖ ${label}${lost ? ' · Kombo verloren' : ''}`, 'bad');
}

// ---------- Tower ----------
export function scoreLanding(state, ac) {
  if (!active(state, 'tower')) return;
  if (ac.wakeBad) return fail(state, ac, 100, 'Wirbelschleppe');
  if (ac.tdLate && ac.tdFpm >= 600) return fail(state, ac, 80, 'Späte Freigabe · harte Landung');
  const rot = state.rots[ac.rot];
  add(state, ac, rot && rot.goArounds ? 50 : 100, ac.emergency ? 'Notlandung sicher' : 'Saubere Landung');
}
export function scoreTakeoff(state, ac) {
  if (!active(state, 'tower')) return;
  const rot = state.rots[ac.rot];
  const wait = rot ? rot.taxiWait || 0 : 0;
  // Lücke genutzt: die nächste Landung ist schon im Anflug nah dran
  const gap = state.acs.some((a) => a.arr && ((a.mode === 'map' && a.phase === PH.FINAL) || (a.mode === 'air' && a.phase === PH.APPROACH && a.route && a.route.length <= 2)));
  add(state, ac, 80 + (wait < 120 ? 40 : 0) + (gap ? 80 : 0), gap ? 'Lücke genutzt' : wait < 120 ? 'Zügiger Start' : 'Start');
}
export function scoreGoAround(state, ac, reason) {
  if (!active(state, 'tower')) return;
  if (/Windscherung|Laserblendung/.test(reason || '')) return; // Wetter bzw. Laser – nicht die Schuld des Lotsen
  fail(state, ac, 150, 'Durchstarten');
}
export function scoreIncident(state, ac) {
  if (state.role !== 'tower' && state.role !== 'ground') return;
  if (!active(state, state.role)) return;
  fail(state, ac, 300, 'Vorfall');
}

// Readback-Fehler: sofort gehört = mehr Punkte; überhört = Kombo weg
export function scoreReadback(state, ac, ok, quick) {
  if (!active(state, 'tower')) return;
  if (ok) add(state, ac, quick ? 150 : 70, quick ? 'Readback-Fehler gehört' : 'Readback korrigiert');
  else fail(state, ac, 120, 'Readback überhört');
}

// Wetterumflug: schnell genehmigt = Punkte; überhört oder abgelehnt mit Turbulenz = Kombo weg
export function scoreWx(state, ac, kind) {
  if (!active(state, 'tower')) return;
  if (kind === 'ok') add(state, ac, 60, 'Wetterumflug');
  else if (kind === 'late') fail(state, ac, 60, 'Anfrage überhört');
  else fail(state, ac, 150, 'Turbulenz');
}

// Pistenkontrolle: in einer echten Lücke freigegeben = Punkte; mit Anflug im Weg = Kombo weg (er muss durchstarten)
export function scoreInspect(state, clean) {
  if (!active(state, 'tower')) return;
  if (clean) add(state, null, 80, 'Pistenkontrolle');
  else fail(state, null, 60, 'Kontrolle zur Unzeit');
}

// Staatsbesuch: Landung nach Protokoll (Tower) bzw. pünktlicher Abflug (Vorfeld)
export function scoreProtocol(state, ac, role, ok) {
  if (!active(state, role)) return;
  if (ok) add(state, ac, 200, 'Protokoll eingehalten');
  else fail(state, ac, 100, 'Protokoll verletzt');
}

// Hubschrauber-Querung: in einer Lücke freigegeben = Punkte, mit Verkehr im Weg = Kombo weg
export function scoreHeli(state, clean) {
  if (!active(state, 'tower')) return;
  if (clean) add(state, null, 90, 'Heli-Querung');
  else fail(state, null, 100, 'Querung zur Unzeit');
}

// Platzrunden: Touch-and-Go in eine echte Lücke gesetzt = Punkte, mit Linienverkehr im Weg = Kombo weg
export function scoreVfr(state, clean) {
  if (!active(state, 'tower')) return;
  if (clean) add(state, null, 70, 'Touch and Go');
  else fail(state, null, 100, 'VFR in den Linienverkehr');
}

// ---------- Vorfeld ----------
export function scoreOffBlock(state, ac, delay, quick) {
  if (!active(state, 'ground')) return;
  if (delay > 15) return fail(state, ac, 80, `+${Math.round(delay)}′ verspätet`);
  let base = delay <= 2 ? 120 : delay <= 5 ? 80 : 30;
  let label = delay <= 2 ? 'Auf die Minute' : delay <= 5 ? 'Pünktlich' : 'Knapp';
  if (quick) {
    base += 100;
    label += ' · Boxenstopp';
  }
  add(state, ac, base, label);
}
export function scoreDeice(state, ac) {
  if (!active(state, 'ground')) return;
  add(state, ac, 40, 'Enteist');
}

// Tageswechsel: Tagesbestwert merken
export function scoreDayEnd(state) {
  const S = scoreState(state);
  const today = S.today;
  S.bestDay = Math.max(S.bestDay, today);
  S.today = 0;
  return today;
}
