// KI-Pilot: übernimmt auf Wunsch die eigene Station (Tower, Vorfeld, Management) mit derselben Automatik, die sonst
// die Nebenrollen erledigt. Man sieht im KI-Protokoll, was sie tut (Freigaben, Fahrzeuge, Verträge, Bauten,
// Entscheidungen), und kann jederzeit eingreifen: Eigene Befehle haben Vorrang – das betroffene Flugzeug überlässt
// die KI dann ein paar Minuten dem Spieler. Ein Klick auf „Selbst übernehmen“ schaltet sie ab.
// Solange die KI spielt, gibt es keine Schichtpunkte und keine neuen Erfolge – sie zählen nur für eigene Arbeit.
import { projects } from './construction.js';
import { loans } from './finance.js';

export const ROLE_AUTO = { tower: 'atc', ground: 'ground', manager: 'manager' };
export const MANUAL_HOLD = 300; // Spielsekunden, die ein eigener Befehl Vorrang vor der KI hat
export const AI_DECIDE_AFTER = 90; // Spielsekunden, bis die KI eine offene Entscheidung trifft

export const aiAvailable = (state) => !!ROLE_AUTO[state.role] && !state.scenario && !state.daily;

export function setAiPlay(state, on) {
  const k = ROLE_AUTO[state.role];
  if (!k) return false;
  state.aiPlay = !!on && aiAvailable(state);
  state.auto[k] = state.aiPlay;
  if (state.aiPlay) state.aiFeed = [];
  return true;
}

// Eintrag im KI-Protokoll (nur solange die KI spielt)
export function aiNote(state, text, ac = null, kind = 'act') {
  if (!state.aiPlay) return;
  const f = state.aiFeed || (state.aiFeed = []);
  f.push({ t: state.time, text, ac: ac ? ac.id : null, kind, n: (state.aiN = (state.aiN || 0) + 1) });
  if (f.length > 8) f.splice(0, f.length - 8);
}

// eigener Befehl: dieses Flugzeug gehört ein paar Minuten dem Spieler
export function markManual(state, ac) {
  if (!state.aiPlay || !ac) return;
  const was = ac.manualUntil > state.time;
  ac.manualUntil = state.time + MANUAL_HOLD;
  if (!was) aiNote(state, `${ac.cs}: du übernimmst – die KI hält sich ${Math.round(MANUAL_HOLD / 60)} min heraus`, ac, 'you');
}
export const manualLocked = (state, ac) => !!(ac && ac.manualUntil > state.time);

// Management: was die KI in dieser Stunde verändert hat, aus dem Vorher-Nachher ablesen
function snap(state) {
  return {
    contracts: (state.contracts || []).length,
    stands: state.stands.filter((s) => s.built).length,
    vehicles: state.vehicles.length,
    staff: state.staff || 0,
    projects: projects(state).map((p) => p.name || p.kind).join('|'),
    loans: loans(state).length,
  };
}
export function withManagerNotes(state, fn) {
  if (!state.aiPlay || state.role !== 'manager') return fn();
  const a = snap(state);
  fn();
  const b = snap(state);
  const nc = b.contracts - a.contracts;
  if (nc > 0) aiNote(state, nc > 1 ? `${nc} neue Airline-Verträge angenommen` : 'Neuen Airline-Vertrag angenommen');
  if (b.vehicles > a.vehicles) aiNote(state, `Fahrzeug gekauft (jetzt ${b.vehicles})`);
  if (b.staff > a.staff) aiNote(state, `${b.staff - a.staff} Leute eingestellt`);
  if (b.projects !== a.projects) {
    const before = new Set(a.projects.split('|'));
    for (const p of b.projects.split('|')) if (p && !before.has(p)) aiNote(state, `Bauauftrag: ${p}`);
  }
  if (b.loans > a.loans) aiNote(state, 'Kredit aufgenommen, um flüssig zu bleiben');
  if (b.loans < a.loans) aiNote(state, 'Kredit getilgt');
}
