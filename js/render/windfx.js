// Wind am Flugzeug – nur Darstellung, für Karte und 3D-Ansicht gemeinsam:
// · Vorhaltewinkel („Crab“): Im Endanflug, beim Durchstarten und nach dem Abheben fliegt das Flugzeug bei Seitenwind
//   schräg mit der Nase in den Wind und richtet sich erst im Abfangbogen kurz vor dem Aufsetzen auf die Bahn aus.
// · Schaukeln: Böen und Turbulenz lassen es um die Längsachse rollen (leichte Muster stärker als Großraumjets);
//   beim Ausschweben hängt der Pilot die Fläche in den Wind („wing low“), während er den Vorhaltewinkel wegnimmt.
// · Klappenstellung je Phase: Start (beim Rollen zum Start gesetzt) klein, Landung voll; Störklappen nach dem Aufsetzen.
import { AC_TYPES } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { clamp } from '../util.js';

const seedOf = (id) => {
  let h = 7;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h / 997;
};
// Seitenwindkomponente zum Kurs (kt, + = Wind von rechts)
function xwind(state, hdg) {
  const track = (hdg * 180) / Math.PI + 90; // Kartenwinkel -> Kompasskurs
  return state.wind.spd * Math.sin(((state.wind.dir - track) * Math.PI) / 180);
}
// wie stark der Vorhaltewinkel gerade gilt (0 am Boden und im letzten Stück des Abfangbogens)
function crabK(ac) {
  const z = ac.z || 0;
  if (ac.phase === PH.FINAL) return clamp((z - 0.08) / 0.45, 0, 1);
  if (ac.phase === PH.MISSED || ac.phase === PH.TAKEOFF) return clamp((z - 0.05) / 0.6, 0, 1);
  return 0;
}

// Vorhaltewinkel (rad, zum Kurs addieren); t = Echtzeit für das Pendeln in Böen
export function crabAngle(state, ac, t) {
  if (ac.mode !== 'map' || !state.wind || !state.wind.spd) return 0;
  const k = crabK(ac);
  if (!k) return 0;
  const tas = (AC_TYPES[ac.type] && AC_TYPES[ac.type].vapp) || 140;
  let c = clamp((xwind(state, ac.hdg) / tas) * 1.6, -0.3, 0.3);
  const g = state.wind.gust || 0;
  if (g) c += Math.sin(t * 1.7 + seedOf(ac.id) * 9) * Math.min(0.05, g * 0.004);
  return c * k;
}

// Rollwinkel (rad, + = rechte Fläche unten) in der Luft: Böen-Schaukeln plus „wing low“ beim Ausschweben
export function gustRoll(state, ac, t) {
  if (!state.wind) return 0;
  const air = ac.mode === 'air' ? (ac.alt || 0) < 4000 : (ac.z || 0) > 0.02 && (ac.phase === PH.FINAL || ac.phase === PH.TAKEOFF || ac.phase === PH.MISSED);
  if (!air) return 0;
  const w = state.wind, tt = AC_TYPES[ac.type] || {};
  const size = tt.light ? 1.9 : tt.size === 'S' ? 1.25 : tt.size === 'L' ? 0.6 : 1;
  const amp = clamp(0.008 + ((w.gk || 0) * 0.5 + (w.gust || 0) * 1.1 + w.spd * 0.18) / 260, 0, 0.13) * size;
  const ph = seedOf(ac.id) * 20;
  let r = amp * (0.6 * Math.sin(t * 1.15 + ph) + 0.4 * Math.sin(t * 2.7 + ph * 1.7) + 0.22 * Math.sin(t * 4.6 + ph * 2.3));
  // im Abfangbogen: Vorhaltewinkel weg, dafür die Fläche in den Wind hängen
  if (ac.mode === 'map' && ac.phase === PH.FINAL && (ac.z || 0) < 0.55) {
    const de = 1 - crabK(ac);
    r += clamp(xwind(state, ac.hdg) / 28, -1, 1) * 0.07 * de;
  }
  return clamp(r, -0.22, 0.22);
}

// Klappenstellung: 0 eingefahren, 1 Start, 2 Landung
export function flapStage(ac) {
  const ph = ac.phase, z = ac.z || 0;
  if (ph === PH.FINAL) return 2;
  if (ph === PH.ROLLOUT) return ac.vacated ? 0 : 2; // nach dem Verlassen der Bahn eingefahren
  if (ph === PH.TAKEOFF) return z < 1.6 ? 1 : 0;
  if (ph === PH.MISSED) return z < 1.2 ? 1 : 0;
  if (ph === PH.TAXI_OUT || ph === PH.HOLDING || ph === PH.LINEUP || ph === PH.LINED) return 1;
  if (ac.mode === 'air') return ac.arr && (ac.alt || 0) < 3500 ? 2 : !ac.arr && (ac.alt || 0) < 1500 ? 1 : 0;
  return 0;
}
// Störklappen und Schubumkehr nach dem Aufsetzen
export const spoilersOut = (ac) => ac.phase === PH.ROLLOUT && !ac.vacated && (ac.v || 0) > 0.05;
