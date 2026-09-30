// Jahreszeiten, Temperatur, Schnee: Schneedecke, Pistenkontamination mit Räumdienst, Enteisung vor dem Start
import { clamp, hourOf, randRange, fmtClock } from '../util.js';
import { log, notify, radio } from './messages.js';
import { runwayDemand, closeRunway, rwyName, hasRwy2 } from './runway.js';

// Jahreszeiten: je 4 Spieltage, das Spiel beginnt im Herbst (Winter ab Tag 5)
export const SEASONS = [
  { id: 'autumn', name: 'Herbst', icon: '🍂', t: 9 },
  { id: 'winter', name: 'Winter', icon: '❄️', t: -2 },
  { id: 'spring', name: 'Frühling', icon: '🌱', t: 12 },
  { id: 'summer', name: 'Sommer', icon: '☀️', t: 23 },
];
export const SEASON_DAYS = 4;
export function season(state) {
  if (state.seasonFix) return SEASONS.find((x) => x.id === state.seasonFix) || SEASONS[0]; // Szenarien: feste Jahreszeit
  const d = Math.floor(state.time / 86400);
  return SEASONS[Math.floor(d / SEASON_DAYS) % 4];
}
export const isWinter = (state) => season(state).id === 'winter';

// Temperatur (°C): Jahreszeit + Tagesgang + Wetter
export function temperature(state) {
  const s = season(state);
  const h = hourOf(state.time);
  const diurnal = -Math.cos(((h - 3) / 24) * Math.PI * 2) * 4.5; // Minimum gegen 3 Uhr, Maximum gegen 15 Uhr
  const wx = { clear: 0, clouds: -1, rain: -2, fog: -1, storm: -3, snow: -3 }[state.weather.kind] || 0;
  return Math.round((s.t + diurnal + wx + (state.tempBias || 0)) * 10) / 10;
}

// Wetterwahl im Winter: Regen wird bei Kälte zu Schnee
export function winterWeather(state, kind) {
  const t = temperature(state);
  if (kind === 'snow' && t >= 2) return 'rain';
  if (!isWinter(state)) return kind;
  if (kind === 'rain' && t < 2) return 'snow';
  if (kind === 'storm') return t < 1 ? 'snow' : 'rain';
  return kind;
}

export function winterState(state) {
  if (state.snow === undefined) state.snow = 0; // Schneedecke 0..1 (Gras, Dächer)
  if (!state.rwySnow) state.rwySnow = { N: 0, S: 0 }; // Kontamination je Bahn 0..1
  return state;
}

// Bremswirkung durch Schnee/Eis: 0 = frei, 1 = mittel, 2 = schlecht
export function snowBraking(state, strip = 'N') {
  winterState(state);
  const c = state.rwySnow[strip] || 0;
  if (c > 0.35) return 2;
  if (c > 0.15) return 1;
  return 0;
}

// braucht ein Abflug Enteisung?
export function needsDeice(state) {
  winterState(state);
  const t = temperature(state);
  return state.weather.kind === 'snow' || (t <= 1 && (state.snow > 0.25 || state.weather.kind === 'fog' || state.weather.kind === 'rain'));
}

export function updateWinter(state, dt) {
  winterState(state);
  const t = temperature(state);
  const snowing = state.weather.kind === 'snow';
  // Schneedecke wächst beim Schneien, taut über 1 °C
  if (snowing) state.snow = clamp(state.snow + dt / (2.5 * 3600), 0, 1);
  else if (t > 1) state.snow = clamp(state.snow - (dt * (t - 1)) / (6 * 3600), 0, 1);
  // Pisten: Schnee sammelt sich schneller an (geräumt wird automatisch)
  for (const strip of hasRwy2(state) ? ['N', 'S'] : ['N']) {
    if (snowing) state.rwySnow[strip] = clamp(state.rwySnow[strip] + dt / (1.6 * 3600), 0, 1);
    else if (t > 1) state.rwySnow[strip] = clamp(state.rwySnow[strip] - (dt * (t - 1)) / (3 * 3600), 0, 1);
    else if (t < 0 && state.rwySnow[strip] > 0.05) state.rwySnow[strip] = clamp(state.rwySnow[strip] + dt / (40 * 3600), 0, 1); // Eisbildung
    // Räumdienst: ab 30 % Kontamination in der nächsten Verkehrslücke
    const plow = state.plow && state.plow.strip === strip ? state.plow : null;
    // Räumdienst: ab 30 % in einer Verkehrslücke, ab 50 % sofort (Sicherheit geht vor)
    if (!plow && !state.plow && ((state.rwySnow[strip] > 0.3 && !runwayDemand(state, strip)) || state.rwySnow[strip] > 0.5)) {
      const min = Math.round(randRange(state, 7, 10));
      closeRunway(state, min, 'Schneeräumung', strip);
      state.plow = { strip, start: state.time, until: state.time + min * 60, from: state.rwySnow[strip] };
      state.life = state.life || {};
      state.life.plows = (state.life.plows || 0) + 1;
      const name = rwyName(state, strip);
      radio(state, 'TWR', `All stations, runway ${name} closed for snow clearing, expect ${min} minutes.`, 'atc');
      notify(state, `❄️ Räumdienst auf Bahn ${name} – gesperrt bis ${fmtClock(state.plow.until)}`, 'warn');
      log(state, 'sys', `Schneeräumung Bahn ${name}: Pflüge und Kehrblasgeräte fahren, Enteisungsmittel wird gestreut.`);
    }
    if (plow) {
      const u = clamp((state.time - plow.start) / (plow.until - plow.start), 0, 1);
      state.rwySnow[strip] = Math.min(state.rwySnow[strip], plow.from * (1 - u) + 0.03);
      if (state.time >= plow.until) {
        state.plow = null;
        state.rwySnow[strip] = Math.min(state.rwySnow[strip], 0.05);
        radio(state, 'TWR', `All stations, runway ${rwyName(state, strip)} open, braking action good.`, 'atc');
        notify(state, `✅ Bahn ${rwyName(state, strip)} geräumt`, 'good');
      }
    }
  }
}
