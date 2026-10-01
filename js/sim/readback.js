// Readback-Fehler: Piloten lesen gelegentlich falsch zurück – der Lotse muss es hören und korrigieren.
// „Line up and wait“ wird zu „cleared for take-off“, die Landebahn wird verwechselt.
// Unkorrigiert rollt der Pilot ohne Startfreigabe los bzw. fliegt die falsche Bahn an und muss durchstarten.
import { TIME_SCALE } from '../config.js';
import { PH, tel, goAround } from './aircraft.js';
import { radio, notify, fx } from './messages.js';
import { rand } from '../util.js';
import { diff } from './difficulty.js';
import { penalize } from './economy.js';
import { rwyName } from './runway.js';
import { scoreReadback } from './score.js';
import { departureWait } from './atc.js';
import { T } from '../i18n.js';

export const RB_WINDOW = 14; // Echtzeit-Sekunden zum Korrigieren
export const RB_HINT = 3.5; // danach blendet die Leiste einen Hinweis ein

const humanTower = (s) => s.role === 'tower' && !s.auto.atc && !(s.settings && s.settings.readback === false);

// Falsche Rücklesung würfeln; liefert den gesprochenen Text (richtig oder falsch)
export function readbackText(state, ac, kind, right) {
  if (!humanTower(state) || ac.emergency || state.acs.some((a) => a.rbErr)) return right;
  if (state.time < (state.rbCool || 0)) return right;
  const L = state.life || {};
  if ((L.landings || 0) < 4) return right; // nicht gleich in den ersten Minuten
  const busy = state.acs.filter((a) => a.mode === 'air' || [PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF].includes(a.phase)).length;
  const p = (0.045 + Math.min(0.04, busy * 0.004)) * (diff(state).events < 1 ? 1.4 : diff(state).events > 1 ? 0.5 : 1);
  if (rand(state) > p) return right;
  let wrong = null;
  if (kind === 'lineup') {
    const rn = rwyName(state, 'N', ac.rwy);
    wrong = `Cleared for take-off ${rn}, ${tel(ac)}.`;
  } else if (kind === 'land') {
    const rn = rwyName(state, ac.strip || 'N');
    const other = state.upgrades.rwy2 ? rwyName(state, (ac.strip || 'N') === 'N' ? 'S' : 'N') : state.rwy === '27' ? '09' : '27';
    if (other === rn) return right;
    wrong = `Cleared to land ${other}, ${tel(ac)}.`;
    ac.rbWrongRwy = other;
  }
  if (!wrong) return right;
  ac.rbErr = { kind, left: RB_WINDOW, age: 0, wrong };
  state.rbCool = state.time + 25 * 60;
  return wrong;
}

// Korrektur durch den Lotsen
export function correctReadback(state, ac) {
  const e = ac && ac.rbErr;
  if (!e) return { ok: false, msg: T('Kein falscher Readback offen') };
  if (e.kind === 'lineup') {
    const rn = rwyName(state, 'N', ac.rwy);
    radio(state, 'TWR', `${tel(ac)}, negative, hold position, runway ${rn} line up and wait only, I say again, line up and wait.`, 'atc');
    radio(state, ac.cs, `Line up and wait ${rn}, holding, sorry for that, ${tel(ac)}.`, 'pilot');
  } else {
    const rn = rwyName(state, ac.strip || 'N');
    radio(state, 'TWR', `${tel(ac)}, negative, runway ${rn}, I say again, runway ${rn}, cleared to land.`, 'atc');
    radio(state, ac.cs, `Runway ${rn}, cleared to land, correction copied, ${tel(ac)}.`, 'pilot');
  }
  const quick = e.age < RB_HINT;
  ac.rbErr = null;
  ac.rbWrongRwy = null;
  const L = state.life || (state.life = {});
  L.rbFixed = (L.rbFixed || 0) + 1;
  scoreReadback(state, ac, true, quick);
  if (ac.mode === 'map') fx(state, ac.x, ac.y - 0.9, quick ? T('👂 Gut aufgepasst!') : T('✔ Readback korrigiert'), 'good');
  return { ok: true, quick };
}

// Zeitfenster ablaufen lassen; unkorrigiert handelt der Pilot nach seiner falschen Rücklesung
export function updateReadback(state, dt) {
  const real = dt / (TIME_SCALE * Math.max(1, state.speed || 1));
  for (const ac of state.acs) {
    const e = ac.rbErr;
    if (!e) continue;
    // Tower auf Autopilot: der Kollege korrigiert selbst
    if (!humanTower(state)) {
      ac.rbErr = null;
      ac.rbWrongRwy = null;
      continue;
    }
    e.age += real;
    e.left -= real;
    // hat sich erledigt: Start inzwischen regulär freigegeben, Flugzeug weg, Anflug abgebrochen
    const moot = (e.kind === 'lineup' && (ac.clr.takeoff || ![PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED].includes(ac.phase))) || (e.kind === 'land' && ![PH.APPROACH, PH.FINAL].includes(ac.phase));
    if (moot) {
      ac.rbErr = null;
      continue;
    }
    if (e.left > 0) continue;
    ac.rbErr = null;
    const L = state.life || (state.life = {});
    L.rbMissed = (L.rbMissed || 0) + 1;
    scoreReadback(state, ac, false);
    if (e.kind === 'lineup') {
      // Pilot hält sich für freigegeben und rollt los
      ac.clr.takeoff = true;
      ac.clr.noClr = true;
      ac.req = null;
      radio(state, ac.cs, `${tel(ac)}, rolling.`, 'pilot');
      notify(state, T`⚠️ ${ac.cs} startet ohne Startfreigabe – der falsche Readback wurde nicht korrigiert.`, 'bad');
      // gefährlich, wenn die Piste belegt ist oder gleich jemand landet
      penalize(state, departureWait(state, ac).sec > 0 && !departureWait(state, ac).wakeOnly ? 'incursion' : 'readback', ac);
    } else {
      // falsche Bahn im Anflug: kurz vor der Schwelle bemerkt der Pilot den Fehler
      ac.rbGoAround = true;
      notify(state, T`⚠️ ${ac.cs} fliegt Piste ${ac.rbWrongRwy || '?'} an – der falsche Readback wurde nicht korrigiert.`, 'bad');
    }
  }
  // unkorrigierte Bahnverwechslung: bei rund 2 NM durchstarten
  for (const ac of state.acs) {
    if (!ac.rbGoAround) continue;
    if (![PH.APPROACH, PH.FINAL].includes(ac.phase)) {
      ac.rbGoAround = false;
      continue;
    }
    const thr = ac.mode === 'air' && ac.route && ac.route.length && ac.route[0].thr ? ac.route[0] : null;
    const d = thr ? Math.hypot(ac.pos.x - thr.x, ac.pos.y - thr.y) : 99;
    if (ac.phase === PH.FINAL || d < 2.5) {
      ac.rbGoAround = false;
      ac.clr.land = false;
      radio(state, ac.cs, `${tel(ac)}, going around, we were lined up for the wrong runway.`, 'pilot');
      goAround(state, ac, T('Falsche Piste (Readback)'));
    }
  }
}
