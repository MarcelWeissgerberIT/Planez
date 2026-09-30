// Erfolge: einmalige Auszeichnungen über alle Spielmodi (mit Popup und Galerie)
import { life, addXp } from './goals.js';
import { notify, listeners } from './messages.js';
import { projects } from './construction.js';

const L = (s, k) => (s.life && s.life[k]) || 0;
// check(state) -> true, wenn erreicht
export const ACHIEVEMENTS = [
  { id: 'firstLanding', icon: '🛬', name: 'Erster Aufsetzer', desc: 'Die erste Landung an deinem Flughafen.', xp: 20, check: (s) => L(s, 'landings') >= 1 },
  { id: 'landings100', icon: '💯', name: 'Hundert Landungen', desc: '100 Landungen insgesamt.', xp: 60, check: (s) => L(s, 'landings') >= 100 },
  { id: 'landings500', icon: '🛫', name: 'Viel Verkehr', desc: '500 Landungen insgesamt.', xp: 120, check: (s) => L(s, 'landings') >= 500 },
  { id: 'pax50k', icon: '🧳', name: '50.000 Passagiere', desc: '50.000 Reisende abgefertigt.', xp: 80, check: (s) => L(s, 'pax') >= 50000 },
  { id: 'pax250k', icon: '🌍', name: 'Viertelmillion', desc: '250.000 Reisende abgefertigt.', xp: 160, check: (s) => L(s, 'pax') >= 250000 },
  { id: 'streak30', icon: '🎯', name: 'Ruhige Hand', desc: '30 Landungen in Folge ohne Durchstarten.', xp: 70, check: (s) => L(s, 'landStreak') >= 30 },
  { id: 'safe150', icon: '🛡️', name: 'Sicherheitskultur', desc: '150 Bewegungen in Folge ohne Vorfall.', xp: 90, check: (s) => L(s, 'safeStreak') >= 150 },
  { id: 'punctual50', icon: '⏱️', name: 'Uhrwerk', desc: '50 Abflüge pünktlich abgefertigt.', xp: 70, check: (s) => L(s, 'depPunctual') >= 50 },
  { id: 'quick25', icon: '⚡', name: 'Boxenstopp', desc: '25 Turnarounds in der Mindestbodenzeit.', xp: 70, check: (s) => L(s, 'quickTurns') >= 25 },
  { id: 'dayPunct95', icon: '🏆', name: 'Pünktlichkeitsweltmeister', desc: 'Ein ganzer Tag mit mindestens 95 % Pünktlichkeit (ab 30 Abflügen).', xp: 100, check: (s) => (s.history || []).some((r) => r.onTime >= 95 && (r.depN || 0) >= 30) },
  { id: 'fogNoDiv', icon: '🌫️', name: 'Durch den Nebel', desc: 'Einen Tag mit Nebel ohne Ausweichlandung überstanden.', xp: 60, check: (s) => !!s.life && L(s, 'fogDayOk') >= 1 },
  { id: 'a380', icon: '🐋', name: 'Superjumbo', desc: 'Ein Airbus A380 hat deinen Flughafen besucht.', xp: 50, check: (s) => (s.acs || []).some((a) => a.type === 'A388' && a.mode === 'map') || L(s, 'a380landed') >= 1 },
  { id: 'nego3', icon: '🤝', name: 'Verhandlungsprofi', desc: 'Drei Verträge mit Aufschlag ausgehandelt.', xp: 70, check: (s) => L(s, 'negoWins') >= 3 },
  { id: 'fireCrew', icon: '🚒', name: 'Löschzug', desc: 'Ein brennendes Triebwerk nach der Landung gelöscht.', xp: 60, check: (s) => L(s, 'fireOut') >= 1 },
  { id: 'winter', icon: '❄️', name: 'Winterdienst', desc: '25 Flugzeuge enteist.', xp: 70, check: (s) => L(s, 'deiced') >= 25 },
  { id: 'plow', icon: '🚜', name: 'Räumkommando', desc: '10 Mal die Piste vom Schnee geräumt.', xp: 50, check: (s) => L(s, 'plows') >= 10 },
  { id: 'firstBuild', icon: '🏗️', name: 'Bauherr', desc: 'Das erste Bauprojekt fertiggestellt.', xp: 40, check: (s) => L(s, 'built') >= 1 },
  { id: 'builder10', icon: '🏙️', name: 'Baumeister', desc: '10 Bauprojekte fertiggestellt.', xp: 120, check: (s) => L(s, 'built') >= 10 },
  { id: 'rwy2', icon: '🛣️', name: 'Zwei Bahnen', desc: 'Die Parallelbahn ist in Betrieb.', xp: 150, check: (s) => !!s.upgrades.rwy2 },
  { id: 'green', icon: '☀️', name: 'Grüner Flughafen', desc: 'Solarpark und Bahnhof gebaut.', xp: 120, check: (s) => !!(s.upgrades.solar && s.upgrades.rail) },
  { id: 'rich', icon: '💰', name: 'Goldgrube', desc: 'Mehr als 25 Mio € in der Kasse.', xp: 100, check: (s) => s.cash >= 25e6 },
  { id: 'debtFree', icon: '🏦', name: 'Schuldenfrei', desc: 'Einen Kredit vollständig zurückgezahlt.', xp: 50, check: (s) => L(s, 'loansRepaid') >= 1 },
  { id: 'rep90', icon: '⭐', name: 'Fünf Sterne', desc: 'Ansehen von 90/100 erreicht.', xp: 120, check: (s) => s.reputation >= 90 },
  { id: 'contracts10', icon: '🤝', name: 'Netzwerker', desc: '10 neue Airline-Verträge abgeschlossen.', xp: 80, check: (s) => L(s, 'contractsAll') >= 10 },
  { id: 'rank2', icon: '🏅', name: 'Internationaler Flughafen', desc: 'Rang 3 erreicht.', xp: 0, check: (s) => (s.goals && s.goals.rank >= 2) },
  { id: 'decisions10', icon: '🧭', name: 'Entscheider', desc: '10 Ereigniskarten selbst entschieden.', xp: 50, check: (s) => L(s, 'decided') >= 10 },
  { id: 'voice', icon: '🎙️', name: 'On Frequency', desc: 'Eine Freigabe per Sprechtaste erteilt.', xp: 40, check: (s) => L(s, 'voiceCmd') >= 1 },
  { id: 'emergency', icon: '🚑', name: 'Retter', desc: 'Einen Notfall sicher gelandet.', xp: 60, check: (s) => L(s, 'emgLanded') >= 1 },
];

export function achState(state) {
  if (!state.ach) state.ach = {};
  return state.ach;
}

// neue Erfolge prüfen (alle paar Sekunden Spielzeit)
export function updateAchievements(state, dt) {
  state.achTimer = (state.achTimer || 0) - dt;
  if (state.achTimer > 0) return;
  state.achTimer = 20;
  const A = achState(state);
  for (const a of ACHIEVEMENTS) {
    if (A[a.id]) continue;
    let ok = false;
    try {
      ok = a.check(state);
    } catch (e) {}
    if (!ok) continue;
    A[a.id] = state.time;
    if (a.xp) addXp(state, Math.round(a.xp / 2));
    for (const fn of listeners.ach || []) fn(a);
  }
}
