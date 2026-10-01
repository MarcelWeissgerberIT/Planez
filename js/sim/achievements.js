// Erfolge: einmalige Auszeichnungen über alle Spielmodi (mit Popup und Galerie)
import { life, addXp } from './goals.js';
import { notify, listeners } from './messages.js';
import { projects } from './construction.js';
import { T } from '../i18n.js';

const L = (s, k) => (s.life && s.life[k]) || 0;
// check(state) -> true, wenn erreicht
export const ACHIEVEMENTS = [
  { id: 'firstLanding', icon: '🛬', name: T('Erster Aufsetzer'), desc: T('Die erste Landung an deinem Flughafen.'), xp: 20, check: (s) => L(s, 'landings') >= 1 },
  { id: 'landings100', icon: '💯', name: T('Hundert Landungen'), desc: T('100 Landungen insgesamt.'), xp: 60, check: (s) => L(s, 'landings') >= 100 },
  { id: 'landings500', icon: '🛫', name: T('Viel Verkehr'), desc: T('500 Landungen insgesamt.'), xp: 120, check: (s) => L(s, 'landings') >= 500 },
  { id: 'pax50k', icon: '🧳', name: T('50.000 Passagiere'), desc: T('50.000 Reisende abgefertigt.'), xp: 80, check: (s) => L(s, 'pax') >= 50000 },
  { id: 'pax250k', icon: '🌍', name: T('Viertelmillion'), desc: T('250.000 Reisende abgefertigt.'), xp: 160, check: (s) => L(s, 'pax') >= 250000 },
  { id: 'streak30', icon: '🎯', name: T('Ruhige Hand'), desc: T('30 Landungen in Folge ohne Durchstarten.'), xp: 70, check: (s) => L(s, 'landStreak') >= 30 },
  { id: 'safe150', icon: '🛡️', name: T('Sicherheitskultur'), desc: T('150 Bewegungen in Folge ohne Vorfall.'), xp: 90, check: (s) => L(s, 'safeStreak') >= 150 },
  { id: 'punctual50', icon: '⏱️', name: T('Uhrwerk'), desc: T('50 Abflüge pünktlich abgefertigt.'), xp: 70, check: (s) => L(s, 'depPunctual') >= 50 },
  { id: 'quick25', icon: '⚡', name: T('Boxenstopp'), desc: T('25 Turnarounds in der Mindestbodenzeit.'), xp: 70, check: (s) => L(s, 'quickTurns') >= 25 },
  { id: 'dayPunct95', icon: '🏆', name: T('Pünktlichkeitsweltmeister'), desc: T('Ein ganzer Tag mit mindestens 95 % Pünktlichkeit (ab 30 Abflügen).'), xp: 100, check: (s) => (s.history || []).some((r) => r.onTime >= 95 && (r.depN || 0) >= 30) },
  { id: 'fogNoDiv', icon: '🌫️', name: T('Durch den Nebel'), desc: T('Einen Tag mit Nebel ohne Ausweichlandung überstanden.'), xp: 60, check: (s) => !!s.life && L(s, 'fogDayOk') >= 1 },
  { id: 'a380', icon: '🐋', name: T('Superjumbo'), desc: T('Eine Aviora AV-38 hat deinen Flughafen besucht.'), xp: 50, check: (s) => (s.acs || []).some((a) => a.type === 'A388' && a.mode === 'map') || L(s, 'a380landed') >= 1 },
  { id: 'nego3', icon: '🤝', name: T('Verhandlungsprofi'), desc: T('Drei Verträge mit Aufschlag ausgehandelt.'), xp: 70, check: (s) => L(s, 'negoWins') >= 3 },
  { id: 'fireCrew', icon: '🚒', name: T('Löschzug'), desc: T('Ein brennendes Triebwerk nach der Landung gelöscht.'), xp: 60, check: (s) => L(s, 'fireOut') >= 1 },
  { id: 'winter', icon: '❄️', name: T('Winterdienst'), desc: T('25 Flugzeuge enteist.'), xp: 70, check: (s) => L(s, 'deiced') >= 25 },
  { id: 'plow', icon: '🚜', name: T('Räumkommando'), desc: T('10 Mal die Piste vom Schnee geräumt.'), xp: 50, check: (s) => L(s, 'plows') >= 10 },
  { id: 'firstBuild', icon: '🏗️', name: T('Bauherr'), desc: T('Das erste Bauprojekt fertiggestellt.'), xp: 40, check: (s) => L(s, 'built') >= 1 },
  { id: 'builder10', icon: '🏙️', name: T('Baumeister'), desc: T('10 Bauprojekte fertiggestellt.'), xp: 120, check: (s) => L(s, 'built') >= 10 },
  { id: 'rwy2', icon: '🛣️', name: T('Zwei Bahnen'), desc: T('Die Parallelbahn ist in Betrieb.'), xp: 150, check: (s) => !!s.upgrades.rwy2 },
  { id: 'green', icon: '☀️', name: T('Grüner Flughafen'), desc: T('Solarpark und Bahnhof gebaut.'), xp: 120, check: (s) => !!(s.upgrades.solar && s.upgrades.rail) },
  { id: 'rich', icon: '💰', name: T('Goldgrube'), desc: T('Mehr als 25 Mio € in der Kasse.'), xp: 100, check: (s) => s.cash >= 25e6 },
  { id: 'debtFree', icon: '🏦', name: T('Schuldenfrei'), desc: T('Einen Kredit vollständig zurückgezahlt.'), xp: 50, check: (s) => L(s, 'loansRepaid') >= 1 },
  { id: 'rep90', icon: '⭐', name: T('Fünf Sterne'), desc: T('Ansehen von 90/100 erreicht.'), xp: 120, check: (s) => s.reputation >= 90 },
  { id: 'contracts10', icon: '🤝', name: T('Netzwerker'), desc: T('10 neue Airline-Verträge abgeschlossen.'), xp: 80, check: (s) => L(s, 'contractsAll') >= 10 },
  { id: 'rank2', icon: '🏅', name: T('Internationaler Flughafen'), desc: T('Rang 3 erreicht.'), xp: 0, check: (s) => (s.goals && s.goals.rank >= 2) },
  { id: 'decisions10', icon: '🧭', name: T('Entscheider'), desc: T('10 Ereigniskarten selbst entschieden.'), xp: 50, check: (s) => L(s, 'decided') >= 10 },
  { id: 'voice', icon: '🎙️', name: 'On Frequency', desc: T('Eine Freigabe per Sprechtaste erteilt.'), xp: 40, check: (s) => L(s, 'voiceCmd') >= 1 },
  { id: 'nordo', icon: '💡', name: T('Lichtzeichen'), desc: T('Ein Flugzeug mit Funkausfall per Lichtsignal gelandet und zur Position gerollt.'), xp: 70, check: (s) => L(s, 'nordoLanded') >= 1 },
  { id: 'market65', icon: '🥇', name: T('Platzhirsch'), desc: T('65 % Marktanteil gegen Nordhafen erreicht.'), xp: 100, check: (s) => !!s.rival && s.rival.share >= 65 },
  { id: 'board5', icon: '🏛️', name: T('Musterwoche'), desc: T('Alle fünf Wochenziele des Aufsichtsrats erreicht.'), xp: 120, check: (s) => L(s, 'boardPerfect') >= 1 },
  { id: 'fod3', icon: '🚙', name: T('Saubere Bahn'), desc: T('Pistenkontrollen haben drei Fremdkörper gefunden, bevor etwas passiert ist.'), xp: 60, check: (s) => L(s, 'fodFound') >= 3 },
  { id: 'wx10', icon: '⛈️', name: T('Wetterfrosch'), desc: T('Zehn Umwege um Gewitterzellen genehmigt.'), xp: 70, check: (s) => L(s, 'wxOk') >= 10 },
  { id: 'touchgo20', icon: '🛩️', name: T('Platzrunden-Profi'), desc: T('20 Touch and Go der Alcedo zwischen den Linienflügen.'), xp: 50, check: (s) => L(s, 'touchGo') >= 20 },
  { id: 'heli10', icon: '🚁', name: T('Luftrettung'), desc: T('Zehnmal den Rettungshubschrauber über die Bahnen gelassen.'), xp: 60, check: (s) => L(s, 'heliX') >= 10 },
  { id: 'salute5', icon: '💦', name: T('Wassertaufe'), desc: T('Fünf Erstflüge neuer Strecken mit dem Wasserbogen der Feuerwehr begrüßt.'), xp: 50, check: (s) => L(s, 'salutes') >= 5 },
  { id: 'butter50', icon: '🧈', name: T('Butterweich'), desc: T('50 Landungen mit weniger als 110 ft/min Sinkrate beim Aufsetzen.'), xp: 50, check: (s) => L(s, 'butter') >= 50 },
  { id: 'stream', icon: '📡', name: T('Quotenhit'), desc: T('Im Spotter-Livestream schauen 2.500 Menschen gleichzeitig zu.'), xp: 60, check: (s) => L(s, 'streamPeak') >= 2500 },
  { id: 'marshal5', icon: '🦺', name: T('Einwinker'), desc: T('Fünf Flugzeuge punktgenau auf die Haltemarke eingewunken.'), xp: 50, check: (s) => L(s, 'marshalPerfect') >= 5 },
  { id: 'quiz10', icon: '🔎', name: T('Typenkenner'), desc: T('Im Livestream-Quiz zehn Flugzeugtypen richtig erkannt.'), xp: 50, check: (s) => L(s, 'quizOk') >= 10 },
  { id: 'wish10', icon: '💬', name: T('Wunschkonzert'), desc: T('Zehn Zuschauerwünsche im Livestream rechtzeitig erfüllt.'), xp: 50, check: (s) => L(s, 'streamWishes') >= 10 },
  { id: 'state1', icon: '🎖️', name: T('Protokollchef'), desc: T('Ein Staatsbesuch ohne Makel: Landung ohne Warteschleife, Abflug pünktlich.'), xp: 80, check: (s) => L(s, 'svPerfect') >= 1 },
  { id: 'readback5', icon: '👂', name: T('Gutes Gehör'), desc: T('Fünf falsche Readbacks rechtzeitig korrigiert.'), xp: 70, check: (s) => L(s, 'rbFixed') >= 5 },
  { id: 'spot10', icon: '📷', name: T('Spotter'), desc: T('10 Fotos fürs Spotterbuch geschossen.'), xp: 40, check: (s) => L(s, 'spotShots') >= 10 },
  { id: 'spotTypes', icon: '📒', name: T('Typenkenner'), desc: T('Alle 16 Flugzeugtypen im Spotterbuch.'), xp: 120, check: (s) => L(s, 'spotTypes') >= 16 },
  { id: 'spotSpecial', icon: '🌈', name: T('Sonderlack-Jäger'), desc: T('Drei verschiedene Sonderlackierungen fotografiert.'), xp: 90, check: (s) => L(s, 'spotSpecials') >= 3 },
  { id: 'emergency', icon: '🚑', name: T('Retter'), desc: T('Einen Notfall sicher gelandet.'), xp: 60, check: (s) => L(s, 'emgLanded') >= 1 },
];

export function achState(state) {
  if (!state.ach) state.ach = {};
  return state.ach;
}

// neue Erfolge prüfen (alle paar Sekunden Spielzeit)
export function updateAchievements(state, dt) {
  if (state.aiPlay) return; // Erfolge nur für eigene Arbeit, nicht während der KI-Pilot spielt
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
