// ATIS: automatische Platzinformation mit Kennbuchstabe, neu bei Wetter-/Pistenwechsel und stündlich
import { gustPeak } from './gusts.js';
import { AIRPORT } from '../config.js';
import { radio } from './messages.js';
import { atis } from './aircraft.js';
import { temperature } from './winter.js';
import { rwyName, hasRwy2, segregated } from './runway.js';
import { T } from '../i18n.js';

// Luftdruck (QNH): langsame Schwankung, Tief bei Gewitter, Hoch bei Nebel
export function qnh(state) {
  const d = state.time / 86400;
  const base = 1013 + Math.round(Math.sin(d * 1.7) * 7 + Math.sin(d * 5.3) * 3);
  return base + ({ storm: -9, rain: -4, snow: -3, fog: 5, clear: 3 }[state.weather.kind] || 0);
}
const VIS = { clear: 'visibility more than 10 kilometers', clouds: 'visibility 10 kilometers, broken clouds', rain: 'visibility 6 kilometers, light rain', storm: 'visibility 4 kilometers, thunderstorm', fog: 'fog', snow: 'visibility 2 kilometers, snow' };

export function atisText(state) {
  const h = Math.floor((state.time % 86400) / 3600), m = Math.floor((state.time % 3600) / 60);
  const w = state.wind;
  const rwy = hasRwy2(state) && segregated(state) ? `runways ${rwyName(state, 'S')} for landing and ${rwyName(state, 'N')} for departure` : T`runway ${rwyName(state, 'N')} in use`;
  const vis = state.weather.kind === 'fog' ? T`runway visual range ${state.weather.rvr ?? 600} meters, low visibility procedures in force` : VIS[state.weather.kind] || '';
  // Hinweise: Platzrunden-Verkehr, Vogelschlag-Gefahr, Pistenzustand bei Schnee
  const notes = [];
  if (state.vfr && state.vfr.p) notes.push(T('caution, VFR traffic in the circuit north of the runway'));
  if (state.birdRisk && state.time < state.birdRisk) notes.push(T('caution, bird activity in the vicinity of the airport'));
  if (state.rwySnow && state.rwySnow.N > 0.15) notes.push('runway contaminated with snow');
  return T`${AIRPORT.name.split(' ')[0]} information ${atis(state)}, time ${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}, ${rwy}, wind ${String(Math.round(w.dir / 10) * 10).padStart(3, '0')} degrees ${Math.round(w.spd)} knots${gustPeak(state) ? ` gusting ${gustPeak(state)}` : ''}, ${vis}, temperature ${Math.round(temperature(state))}, QNH ${qnh(state)}${notes.length ? `, ${notes.join(', ')}` : ''}. Advise on initial contact you have information ${atis(state)}.`;
}

export function updateAtis(state) {
  const key = `${state.rwy}|${state.weather.kind}|${Math.round(state.wind.dir / 30)}|${state.rwyMode || ''}|${Math.floor(state.time / 3600)}|${state.vfr && state.vfr.p ? 'v' : ''}|${Math.round(gustPeak(state) / 5)}`;
  if (state.atisKey === key) return;
  const first = state.atisKey === undefined;
  state.atisKey = key;
  state.atisN = ((state.atisN ?? Math.floor(state.time / 3600)) + (first ? 0 : 1)) % 26;
  if (!first) radio(state, 'ATIS', atisText(state), 'atc');
}
