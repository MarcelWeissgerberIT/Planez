// Wer funkt gerade? Liefert das Rufzeichen des aktiven Funkkontakts – für Radar-Fokus, Streifen und Kartenschild.
// Mit Sprachausgabe: wer gerade spricht bzw. angesprochen wird (plus kurze Nachlaufzeit), sonst die letzte Meldung.
import { voice } from '../voice.js';
import { tel } from '../sim/aircraft.js';
import { vfrTel } from '../sim/vfr.js';
import { HELI } from '../sim/heli.js';

const owner = new WeakMap(); // Logeintrag -> Rufzeichen
let last = { cs: null, at: -1e9 }; // letzte Meldung (ohne Sprachausgabe)
let spoke = { cs: null, at: -1e9 }; // zuletzt gesprochene Sendung (Nachlauf)

// Lotsenmeldung: angesprochenes Flugzeug steht vor dem ersten Komma („Rheinjet 283, wind …“)
function addressee(state, text) {
  const head = text.split(',')[0].trim();
  if (/^Rescue 7$/i.test(head)) return HELI;
  const a = state.acs.find((x) => tel(x) === head);
  if (a) return a.cs;
  const p = state.vfr && state.vfr.p;
  if (p && (vfrTel(p.cs) === head || vfrTel(p.cs, true) === head)) return p.cs;
  return null;
}

export const csOf = (m) => owner.get(m) || null;

export function noteRadio(state, m) {
  if (!state || (m.kind !== 'atc' && m.kind !== 'pilot')) return;
  const cs = m.kind === 'pilot' ? m.from || null : addressee(state, m.text);
  if (!cs || cs === 'ATIS') return;
  owner.set(m, cs);
  last = { cs, at: performance.now() };
}

// { cs, live }: live = spricht gerade (Sprachausgabe), sonst Nachlauf bzw. letzte Meldung
export function talking() {
  const now = performance.now();
  if (voice.on && voice.current) {
    const cs = owner.get(voice.current);
    if (cs) {
      spoke = { cs, at: now };
      return { cs, live: true };
    }
  }
  if (voice.on) return now - spoke.at < 3500 ? { cs: spoke.cs, live: false } : { cs: null, live: false };
  return now - last.at < 6000 ? { cs: last.cs, live: false } : { cs: null, live: false };
}
