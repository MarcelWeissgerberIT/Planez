// Pistenzustand (Gummiabrieb/Reibwert), Bremswirkung, Sperrungen (FOD-Kontrolle, Bauarbeiten)
import { clamp, hourOf, randRange, fmtClock } from '../util.js';
import { log, notify, radio } from './messages.js';
import { PH } from './aircraft.js';
import * as AS from './airspace.js';

export const BRAKE_DE = { good: 'gut', medium: 'mittel', poor: 'schlecht' };
export const BRAKE_EN = { good: 'good', medium: 'medium', poor: 'poor' };

export function rwyCond(state) {
  if (state.rwyCond === undefined) state.rwyCond = 88;
  return state.rwyCond;
}
export const isWet = (state) => state.weather.kind === 'rain' || state.weather.kind === 'storm';

// Bremswirkung aus Zustand und Nässe
export function brakingAction(state) {
  const c = rwyCond(state) - (isWet(state) ? 28 : 0);
  return c >= 60 ? 'good' : c >= 35 ? 'medium' : 'poor';
}
export const decelFactor = (state) => ({ good: 1, medium: 0.86, poor: 0.72 }[brakingAction(state)]);

// Abnutzung je Landung (schwere Flugzeuge hinterlassen mehr Gummi)
export function onRunwayLanding(state, ac) {
  const w = { L: 0.03, M: 0.06, H: 0.13 }[ac.wake] || 0.06;
  state.rwyCond = clamp(rwyCond(state) - w * (isWet(state) ? 1.2 : 1), 5, 100);
}

// aktuelle Sperrung (Grund) oder null
export function runwayClosed(state) {
  if (state.rwyClosedUntil > state.time) return state.rwyClosedWhy || 'Sperrung';
  if (state.rwyWorking) return 'Bauarbeiten';
  return null;
}

// Nachtfenster für Pistenarbeiten
export function nightWindow(state) {
  const h = hourOf(state.time);
  return h >= 22.5 || h < 5.5;
}

// Bedarf an der Piste in naher Zukunft (dann keine Arbeiten)
export function runwayDemand(state) {
  for (const a of state.acs) {
    if (a.mode === 'map' && [PH.FINAL, PH.ROLLOUT, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF, PH.MISSED].includes(a.phase)) {
      if (a.phase === PH.ROLLOUT && a.vacated) continue;
      return a;
    }
    if (a.mode === 'air' && a.arr && [PH.APPROACH, PH.INBOUND, PH.HOLD, PH.GOAROUND].includes(a.phase)) {
      const d = AS.routeDistance(a.pos, a.phase === PH.APPROACH && a.route.length ? a.route : AS.approachRoute(a.pos, a.rwy));
      if (d < 24) return a;
    }
  }
  return null;
}

export function canWorkRunway(state) {
  return nightWindow(state) && !runwayDemand(state) && !(state.rwyClosedUntil > state.time && state.rwyClosedWhy !== 'Räumung der Baustelle');
}

export function closeRunway(state, minutes, why) {
  state.rwyClosedUntil = state.time + minutes * 60;
  state.rwyClosedWhy = why;
}

// FOD (Foreign Object Debris): Fremdkörper auf der Piste -> kurze Kontrolle
export function fodEvent(state) {
  const min = Math.round(randRange(state, 4, 8));
  closeRunway(state, min, 'FOD-Kontrolle (Fremdkörper)');
  radio(state, 'TWR', `All stations, runway ${state.rwy} closed for inspection, debris reported, expect ${min} minutes delay.`, 'atc');
  notify(state, `🔎 FOD auf der Piste – Sperrung für ${min} min (bis ${fmtClock(state.rwyClosedUntil)})`, 'warn');
  log(state, 'sys', `Fremdkörper (FOD) gemeldet – Pistenkontrolle, Piste bis ${fmtClock(state.rwyClosedUntil)} gesperrt.`);
}

export function updateRunway(state, dt) {
  rwyCond(state);
  if (state.rwyClosedUntil && state.rwyClosedUntil <= state.time && state.rwyClosedWhy) {
    const why = state.rwyClosedWhy;
    state.rwyClosedWhy = null;
    state.rwyClosedUntil = 0;
    if (why.startsWith('FOD')) {
      radio(state, 'TWR', `All stations, runway ${state.rwy} inspection complete, runway open.`, 'atc');
      notify(state, '✅ Piste wieder frei', 'good');
    }
  }
  // Bauarbeiten unterbrechen, sobald Verkehr kommt: Räumung braucht 3 Minuten
  if (state.rwyWorkingPrev && !state.rwyWorking) {
    if (runwayDemand(state)) {
      closeRunway(state, 3, 'Räumung der Baustelle');
      log(state, 'sys', 'Verkehr naht – Pistenbaustelle wird geräumt (3 min).');
    }
  }
  state.rwyWorkingPrev = state.rwyWorking;
}
