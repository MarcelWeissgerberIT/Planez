// Funkausfall (Squawk 7600, „NORDO“): Das Flugzeug antwortet nicht mehr, fliegt nach Flugplan den Anflug
// und braucht Lichtsignale vom Tower – grünes Dauerlicht = Landung frei, rotes Dauerlicht = durchstarten,
// grünes Blinklicht am Boden = Rollen frei. Nach dem Abstellen ist das Funkgerät repariert.
import * as AS from './airspace.js';
import { PH, tel, goAround, startTaxiIn } from './aircraft.js';
import { radio, log, notify, fx } from './messages.js';
import { stripForArrival } from './runway.js';

export const LIGHTS = {
  green: { name: 'grünes Dauerlicht', col: '#22c55e', blink: false },
  red: { name: 'rotes Dauerlicht', col: '#ef4444', blink: false },
  taxi: { name: 'grünes Blinklicht', col: '#22c55e', blink: true },
};

// ohne Funk fliegt die Besatzung nach Flugplan: direkt in den Anflug (auch nach einem Fehlanflug erneut)
function selfApproach(state, ac) {
  if ([PH.INBOUND, PH.HOLD].includes(ac.phase)) {
    ac.rwy = state.rwy;
    ac.strip = stripForArrival(state);
    ac.route = AS.approachRoute(ac.pos, ac.rwy);
    ac.phase = PH.APPROACH;
    ac.holdFix = null;
    ac.clr.app = true;
    ac.req = null;
    ac.altRestr = undefined;
    ac.stackAlt = ac.stackFix = null;
  }
}

export function startNordo(state, ac) {
  if (!ac || ac.nordo || ac.emergency) return false;
  ac.nordo = true;
  ac.squawkOld = ac.squawk;
  ac.squawk = '7600';
  ac.nordoT = state.time;
  selfApproach(state, ac);
  log(state, 'sys', `📻✖ ${ac.cs} squawkt 7600 – Funkausfall. Die Besatzung fliegt nach Flugplan den Anflug und achtet auf Lichtsignale vom Tower.`);
  notify(state, `📻✖ Funkausfall: ${ac.cs} (Squawk 7600) – Landung nur mit Lichtsignal (grün)`, 'warn');
  return true;
}

// Tower ruft – keine Antwort (höchstens alle 90 s eine Meldung, der Auto-Lotse versucht es sonst ständig)
export function callNordo(state, ac) {
  if (state.time - (ac.nordoCallT || -999) < 90) return;
  ac.nordoCallT = state.time;
  radio(state, 'TWR', `${tel(ac)}, Tower, how do you read?`, 'atc');
  log(state, 'sys', `${ac.cs} antwortet nicht (Squawk 7600).`);
}

export function lightSignal(state, ac, kind) {
  const L = LIGHTS[kind];
  state.lightBeam = { ac: ac.id, col: L.col, blink: L.blink, t: state.time, n: (state.lightBeam ? state.lightBeam.n || 0 : 0) + 1 };
  if (kind === 'green') {
    ac.clr.land = true;
    ac.req = null;
    ac.lightLand = true;
    fx(state, ac.x || 0, (ac.y || 0) - 0.8, '💡 grünes Licht – Flügel wackeln', 'good');
    log(state, 'sys', `💡 Lichtsignal an ${ac.cs}: grünes Dauerlicht – Landung frei. Die Besatzung bestätigt mit Flügelwackeln.`);
  } else if (kind === 'red') {
    log(state, 'sys', `💡 Lichtsignal an ${ac.cs}: rotes Dauerlicht – nicht landen.`);
    goAround(state, ac, 'Lichtsignal rot');
  } else if (kind === 'taxi') {
    ac.clr.taxi = true;
    ac.req = null;
    fx(state, ac.x, ac.y - 0.6, '💡 grünes Blinklicht – Scheinwerfer blinken', 'good');
    log(state, 'sys', `💡 Lichtsignal an ${ac.cs}: grünes Blinklicht – Rollen frei zur Position ${ac.stand}.`);
    if (ac.phase === PH.VACATED || ac.phase === PH.TAXI_WAIT) startTaxiIn(state, ac);
  }
  return { ok: true };
}

// am Stand: Funkgerät getauscht
export function nordoOnBlock(state, ac) {
  if (!ac.nordo) return;
  ac.nordo = false;
  if (ac.squawkOld) ac.squawk = ac.squawkOld;
  if (ac.lightLand) {
    const L = state.life || (state.life = {});
    L.nordoLanded = (L.nordoLanded || 0) + 1;
  }
  ac.lightLand = false;
  log(state, 'gnd', `${ac.cs}: Funkgerät getauscht – für den Abflug wieder erreichbar.`);
}

// Ereignis: ein anfliegendes Flugzeug verliert den Funk
export function nordoCandidate(state) {
  return state.acs.find((a) => a.arr && a.mode === 'air' && [PH.INBOUND, PH.HOLD, PH.APPROACH].includes(a.phase) && !a.emergency && !a.nordo && !a.clr.land && !(a.route && a.route[0] && a.route[0].thr)) || null;
}

export function updateNordo(state) {
  for (const ac of state.acs) if (ac.nordo && ac.mode === 'air' && [PH.INBOUND, PH.HOLD].includes(ac.phase) && !ac.missedPending) selfApproach(state, ac);
}
