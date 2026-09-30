// Pisten: Zustand (Gummiabrieb/Reibwert), Bremswirkung, Sperrungen (FOD-Kontrolle, Bauarbeiten),
// zweite Parallelbahn (Süd) mit getrenntem Betrieb: Landungen Süd, Starts Nord
import { clamp, hourOf, randRange, fmtClock, rand } from '../util.js';
import { log, notify, radio } from './messages.js';
import { PH } from './aircraft.js';
import * as AS from './airspace.js';
import * as LY from '../layout.js';

export const BRAKE_DE = { good: 'gut', medium: 'mittel', poor: 'schlecht' };
export const BRAKE_EN = { good: 'good', medium: 'medium', poor: 'poor' };

// ---------- Bahnen ----------
export const hasRwy2 = (state) => !!(state.upgrades && state.upgrades.rwy2);
export const stripGeom = (strip) => (strip === 'S' ? LY.RWY_S : LY.RWY);
// Bezeichnung: Nord = rechts bei 27 / links bei 09
export function rwyName(state, strip = 'N', dir = state.rwy) {
  if (!hasRwy2(state)) return dir;
  const north = strip !== 'S';
  if (dir === '27') return `27${north ? 'R' : 'L'}`;
  return `09${north ? 'L' : 'R'}`;
}
// getrennter Betrieb aktiv? (Landungen Süd, Starts Nord)
export const segregated = (state) => hasRwy2(state) && state.rwyMode !== 'single';
// Bahn für eine neue Anflugfreigabe
export function stripForArrival(state) {
  if (!segregated(state)) return 'N';
  if (runwayClosed(state, 'S') && !runwayClosed(state, 'N')) return 'N';
  return 'S';
}
export function runwayStrips(state) {
  const list = [{ id: 'N', label: `Bahn ${rwyName(state, 'N')}`, icon: '🛫', role: segregated(state) ? 'Starts' : 'Starts & Landungen', len: '1.400 m · Nordbahn' }];
  if (hasRwy2(state)) list.push({ id: 'S', label: `Bahn ${rwyName(state, 'S')}`, icon: '🛬', role: segregated(state) ? 'Landungen' : 'Reserve', len: '1.400 m · Südbahn' });
  return list;
}

// ---------- Zustand ----------
const condKey = (strip) => (strip === 'S' ? 'rwyCondS' : 'rwyCond');
export function rwyCond(state, strip = 'N') {
  const k = condKey(strip);
  if (state[k] === undefined) state[k] = strip === 'S' ? 100 : 88;
  return state[k];
}
export const isWet = (state) => state.weather.kind === 'rain' || state.weather.kind === 'storm';

// Bremswirkung aus Zustand und Nässe
export function brakingAction(state, strip = 'N') {
  const c = rwyCond(state, strip) - (isWet(state) ? 28 : 0);
  return c >= 60 ? 'good' : c >= 35 ? 'medium' : 'poor';
}
export const decelFactor = (state, strip = 'N') => ({ good: 1, medium: 0.86, poor: 0.72 }[brakingAction(state, strip)]);

// Abnutzung je Landung (schwere Flugzeuge hinterlassen mehr Gummi)
export function onRunwayLanding(state, ac) {
  const strip = ac.strip || 'N';
  const w = { L: 0.03, M: 0.06, H: 0.13 }[ac.wake] || 0.06;
  state[condKey(strip)] = clamp(rwyCond(state, strip) - w * (isWet(state) ? 1.2 : 1), 5, 100);
}

// ---------- Sperrungen ----------
// aktuelle Sperrung (Grund) oder null
export function runwayClosed(state, strip = 'N') {
  if (state.rwyClosedUntil > state.time && (state.rwyClosedStrip || 'N') === strip) return state.rwyClosedWhy || 'Sperrung';
  if (state.rwyWorking) {
    const p = (state.projects || []).find((q) => q.id === state.rwyWorking);
    if ((p && p.strip ? p.strip : 'N') === strip) return 'Bauarbeiten';
  }
  return null;
}

// Nachtfenster für Pistenarbeiten
export function nightWindow(state) {
  const h = hourOf(state.time);
  return h >= 22.5 || h < 5.5;
}

// Bahn eines Flugzeugs (Starts immer Nord)
export function stripOf(ac) {
  if (ac.arr && [PH.APPROACH, PH.FINAL, PH.ROLLOUT, PH.GOAROUND, PH.MISSED].includes(ac.phase)) return ac.strip || 'N';
  return 'N';
}

// Bedarf an einer Piste in naher Zukunft (dann keine Arbeiten)
export function runwayDemand(state, strip = 'N') {
  for (const a of state.acs) {
    if (strip === 'N' && a.crossing) return a;
    if (a.mode === 'map' && [PH.FINAL, PH.ROLLOUT, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF, PH.MISSED].includes(a.phase)) {
      if (a.phase === PH.ROLLOUT && a.vacated) continue;
      if (stripOf(a) === strip) return a;
    }
    if (a.mode === 'air' && a.arr && [PH.APPROACH, PH.INBOUND, PH.HOLD, PH.GOAROUND].includes(a.phase)) {
      const s = a.phase === PH.APPROACH ? a.strip || 'N' : stripForArrival(state);
      if (s !== strip) continue;
      const d = AS.routeDistance(a.pos, a.phase === PH.APPROACH && a.route.length ? a.route : AS.approachRoute(a.pos, a.rwy));
      if (d < 24) return a;
    }
  }
  return null;
}

export function canWorkRunway(state, strip = 'N') {
  const closedOther = state.rwyClosedUntil > state.time && (state.rwyClosedStrip || 'N') === strip && state.rwyClosedWhy !== 'Räumung der Baustelle';
  return nightWindow(state) && !runwayDemand(state, strip) && !closedOther;
}

export function closeRunway(state, minutes, why, strip = 'N') {
  state.rwyClosedUntil = state.time + minutes * 60;
  state.rwyClosedWhy = why;
  state.rwyClosedStrip = strip;
}

// FOD (Foreign Object Debris): Fremdkörper auf der Piste -> kurze Kontrolle
export function fodEvent(state) {
  const strip = hasRwy2(state) && rand(state) < 0.5 ? 'S' : 'N';
  const min = Math.round(randRange(state, 4, 8));
  closeRunway(state, min, 'FOD-Kontrolle (Fremdkörper)', strip);
  const name = rwyName(state, strip);
  radio(state, 'TWR', `All stations, runway ${name} closed for inspection, debris reported, expect ${min} minutes delay.`, 'atc');
  notify(state, `🔎 FOD auf Bahn ${name} – Sperrung für ${min} min (bis ${fmtClock(state.rwyClosedUntil)})`, 'warn');
  log(state, 'sys', `Fremdkörper (FOD) gemeldet – Pistenkontrolle, Bahn ${name} bis ${fmtClock(state.rwyClosedUntil)} gesperrt.`);
}

export function updateRunway(state, dt) {
  rwyCond(state);
  if (state.rwyClosedUntil && state.rwyClosedUntil <= state.time && state.rwyClosedWhy) {
    const why = state.rwyClosedWhy;
    const name = rwyName(state, state.rwyClosedStrip || 'N');
    state.rwyClosedWhy = null;
    state.rwyClosedUntil = 0;
    if (why.startsWith('FOD')) {
      radio(state, 'TWR', `All stations, runway ${name} inspection complete, runway open.`, 'atc');
      notify(state, `✅ Bahn ${name} wieder frei`, 'good');
    }
  }
  // Bauarbeiten unterbrechen, sobald Verkehr kommt: Räumung braucht 3 Minuten
  if (state.rwyWorkingPrev && !state.rwyWorking) {
    const p = (state.projects || []).find((q) => q.id === state.rwyWorkingPrev);
    const strip = (p && p.strip) || state.rwyWorkingStrip || 'N';
    if (runwayDemand(state, strip)) {
      closeRunway(state, 3, 'Räumung der Baustelle', strip);
      log(state, 'sys', `Verkehr naht – Pistenbaustelle auf Bahn ${rwyName(state, strip)} wird geräumt (3 min).`);
    }
  }
  state.rwyWorkingPrev = state.rwyWorking;
  if (state.rwyWorking) {
    const p = (state.projects || []).find((q) => q.id === state.rwyWorking);
    state.rwyWorkingStrip = (p && p.strip) || 'N';
  }
}
