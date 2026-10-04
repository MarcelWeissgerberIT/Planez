// Böen: Zum Mittelwind kommen je nach Wetterlage Böenspitzen (im Wetterbericht „260/14G28“ – Spitze 28 kt). Einzelne
// Böen bauen sich auf und flauen ab; zieht eine Gewitterzelle über den Platz, kommt eine Böenfront mit Spitzen über
// 40 kt und drehendem Wind. Wirkung: Seitenwind mit Böen über dem Limit des Musters (Sportflugzeuge 15 kt, Turboprops
// und Regionaljets 32 kt, Mittelstrecke 38 kt, Großraum 40 kt – Werte mit Böen wie in den Flughandbüchern) lässt Anflüge
// durchstarten und Abflüge am Rollhalt warten; kräftige Böen im
// kurzen Endanflug machen Anflüge unruhig (manche starten durch) und Landungen härter.
import { AC_TYPES } from '../config.js';
import { clamp, degNorm } from '../util.js';
import { notify, radio, log } from './messages.js';
import { T } from '../i18n.js';

// eigener Zufall für Böen (xorshift im Spielstand), damit Böen den übrigen Spielablauf (Wetter, Ereignisse) nicht verschieben
function rand(state) {
  let x = (state.wind.gseed ?? 2463534242) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.wind.gseed = x >>> 0;
  return (x >>> 0) / 4294967296;
}
const randRange = (s, a, b) => a + rand(s) * (b - a);

// Seitenwindgrenze je Muster (kt, mit Böen)
export function xwLimit(type) {
  const t = AC_TYPES[type] || {};
  return t.light ? 15 : t.size === 'S' ? 32 : t.size === 'L' ? 40 : 38;
}
// Seitenwindkomponente mit Böenspitze für eine Betriebsrichtung
export function gustXw(state, rwy = state.rwy) {
  const w = state.wind, hdg = rwy === '27' ? 270 : 90;
  return Math.abs((w.spd + (w.gk || 0)) * Math.sin(((w.dir - hdg) * Math.PI) / 180));
}
export const overXw = (state, ac) => gustXw(state, ac.rwy || state.rwy) > xwLimit(ac.type);
// Böenspitze für Anzeige und Funk (wie im Wetterbericht erst ab ≈ 10 kt über dem Mittelwind)
export const gustPeak = (state) => ((state.wind.gk || 0) >= 9 ? Math.round(state.wind.spd + state.wind.gk) : 0);
// „260°/14G28 kt“
export function windShort(state) {
  const g = gustPeak(state);
  return `${Math.round(state.wind.dir / 10) * 10}°/${Math.round(state.wind.spd)}${g ? 'G' + g : ''} kt`;
}

// Böenstärke (Spitze über Mittelwind) je Wetterlage, mit dem Mittelwind zunehmend
function gustTarget(state) {
  const k = state.weather.kind, spd = state.wind.spd;
  const base = { storm: 13, rain: 5, snow: 6, clouds: 2.5 }[k] || 0;
  return clamp(base + Math.max(0, spd - 9) * 0.8, 0, 26);
}

export function updateGusts(state, dt) {
  const w = state.wind;
  // Böenfront: Gewitterzelle (kein Schauer) über dem Platz
  const front = (state.weather.cells || []).find((c) => !c.shower && Math.hypot(c.x, c.y) < c.r + 4);
  if (front && !state.gustFront) {
    state.gustFront = { until: state.time + randRange(state, 900, 1800) };
    // der Wind springt in Richtung der Ausströmung (von der Zelle weg) und frischt auf
    const from = degNorm((Math.atan2(front.x, -front.y) * 180) / Math.PI);
    w.dir = degNorm(w.dir + clamp((((from - w.dir + 540) % 360) - 180) * 0.6, -70, 70));
    w.spd = Math.max(w.spd, randRange(state, 15, 21));
    radio(state, 'TWR', `All stations, gust front passing the airport, wind ${String(Math.round(w.dir / 10) * 10).padStart(3, '0')} degrees ${Math.round(w.spd)} knots gusting ${Math.round(w.spd + 17)}.`, 'atc');
    notify(state, T('⛈️ Böenfront über dem Platz: Spitzen um 40 kt – Anflüge können durchstarten, Starts warten auf ruhigeren Wind'), 'bad');
    log(state, 'sys', T('⛈️ Eine Böenfront zieht über den Flughafen – kräftige Böen und drehender Wind für eine Viertelstunde bis halbe Stunde.'));
  }
  if (state.gustFront && state.time > state.gustFront.until && !front) state.gustFront = null;
  const target = state.gustFront ? 17 + 4 * Math.sin(state.time / 90) : gustTarget(state);
  w.gk = (w.gk ?? target) + clamp(target - (w.gk ?? target), -0.02 * dt, 0.02 * dt);
  // einzelne Böen: setzen ein, erreichen ihre Spitze und flauen wieder ab
  const g = w.gEv;
  if (g) {
    g.t += dt;
    w.gust = g.peak * Math.sin(Math.min(1, g.t / g.dur) * Math.PI);
    if (g.t >= g.dur) w.gEv = null;
  } else {
    w.gust = 0;
    if (w.gk > 2 && rand(state) < dt * (0.015 + w.gk / 600)) w.gEv = { t: 0, dur: randRange(state, 5, 14), peak: w.gk * randRange(state, 0.45, 1) };
  }
}

// Anflug am Entscheidungspunkt: Seitenwind mit Böen über dem Limit bzw. eine kräftige Böe im kurzen Endanflug → Durchstarten
export function windGoAround(state, ac) {
  const lim = xwLimit(ac.type), xw = gustXw(state, ac.rwy);
  if (xw > lim && rand(state) < clamp((xw - lim) / 6, 0.15, 0.85)) {
    radio(state, ac.cs, `${ac.cs}, going around, crosswind exceeds our limits.`, 'pilot');
    return T('Seitenwind über dem Limit');
  }
  const gk = state.wind.gk || 0;
  if (gk > 11 && rand(state) < clamp((gk - 11) / 40 + (state.wind.gust || 0) / 120, 0, 0.32)) {
    radio(state, ac.cs, `${ac.cs}, going around, unstable approach, strong gusts.`, 'pilot');
    return T('Böen im kurzen Endanflug');
  }
  return null;
}
