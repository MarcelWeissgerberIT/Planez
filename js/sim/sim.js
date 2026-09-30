// Simulationsschritt: Reihenfolge aller Systeme
import { TIME_SCALE } from '../config.js';
import { dayOf, roundedPath } from '../util.js';
import { spawnArrival, updateAircraft, PH } from './aircraft.js';
import { updateGround } from './ground.js';
import { autoAtc, updateConflicts } from './atc.js';
import { updateEconomy, closeDay } from './economy.js';
import { generateDay, dailyContracts, maybeOffer } from './schedule.js';
import { updateEvents } from './events.js';
import { log } from './messages.js';
import * as LY from '../layout.js';

export const hooks = { dayEnd: [] };

export function run(state, realDt) {
  if (!state.speed) return;
  let rem = Math.min(realDt, 0.25) * TIME_SCALE * state.speed;
  while (rem > 1e-6) {
    const d = Math.min(1, rem);
    step(state, d);
    rem -= d;
  }
}

export function step(state, dt) {
  const prevDay = dayOf(state.time);
  state.time += dt;
  if (dayOf(state.time) !== prevDay) dayRollover(state);
  spawnDue(state);
  updateEvents(state, dt);
  autoAtc(state, dt);
  updateAircraft(state, dt);
  updateGround(state, dt);
  updateConflicts(state, dt);
  updateEconomy(state, dt);
  maybeOffer(state, dt);
  updateFire(state, dt);
}

function spawnDue(state) {
  state.spawnCheck = (state.spawnCheck || 0) + 1;
  if (state.spawnCheck % 5) return;
  for (const r of Object.values(state.rots)) {
    if (r.status === 'planned' && r.spawnAt <= state.time) spawnArrival(state, r);
  }
}

function dayRollover(state) {
  const rec = closeDay(state);
  dailyContracts(state);
  const day = dayOf(state.time);
  generateDay(state, day + 1);
  // alte Umläufe aufräumen
  for (const [id, r] of Object.entries(state.rots)) {
    const done = ['departed', 'cancelled', 'diverted'].includes(r.status);
    if (done && r.std < state.time - 86400 && !state.acs.some((a) => a.rot === id)) delete state.rots[id];
  }
  log(state, 'mgr', `Tagesabschluss Tag ${rec.day}: Umsatz ${Math.round(rec.rev / 1000)} Tsd €, Kosten ${Math.round(rec.cost / 1000)} Tsd €, Pünktlichkeit ${rec.onTime} %.`);
  for (const fn of hooks.dayEnd) fn(rec);
}

// Flughafenfeuerwehr bei Notfällen
const STATION = { x: 37.2, y: 35.4 };
function updateFire(state, dt) {
  if (!state.fire) {
    state.fire = { trucks: [0, 1, 2].map((i) => ({ x: STATION.x + i * 0.9, y: STATION.y, hx: STATION.x + i * 0.9, hdg: -Math.PI / 2, st: 'home', path: null, pi: 0 })) };
  }
  const f = state.fire;
  const alert = state.fireAlert;
  if (alert) {
    const ac = state.acs.find((a) => a.id === alert.ac);
    if (ac && ac.mode === 'map' && (ac.phase === PH.FINAL || ac.phase === PH.ROLLOUT) && !alert.deployed) {
      alert.deployed = true;
      const tx = ac.exitX ?? 40;
      f.trucks.forEach((t, i) => {
        const target = { x: tx + (i - 1) * 1.1, y: LY.RWY.y + LY.RWY.hw + 0.9 };
        t.path = roundedPath([{ x: t.x, y: t.y }, { x: t.hx, y: 34.5 }, { x: target.x, y: 34.5 }, target], 0.6, 0.2);
        t.pi = 0;
        t.st = 'out';
      });
    }
    if (alert.deployed && (!ac || ac.phase === PH.STAND || ac.phase === PH.GONE || ac.phase === PH.TAXI_IN)) {
      alert.doneT = alert.doneT ?? state.time;
      if (state.time - alert.doneT > 180) {
        f.trucks.forEach((t) => {
          t.path = roundedPath([{ x: t.x, y: t.y }, { x: t.x, y: 34.5 }, { x: t.hx, y: 34.5 }, { x: t.hx, y: STATION.y }], 0.6, 0.2);
          t.pi = 0;
          t.st = 'back';
        });
        state.fireAlert = null;
      }
    }
    if (!ac && !alert.deployed) state.fireAlert = null;
  }
  for (const t of f.trucks) {
    if (!t.path) continue;
    let s = 0.3 * dt;
    while (s > 0 && t.pi < t.path.length - 1) {
      const b = t.path[t.pi + 1];
      const seg = Math.hypot(b.x - t.x, b.y - t.y);
      if (seg > 1e-4) t.hdg = Math.atan2(b.y - t.y, b.x - t.x);
      if (seg <= s) {
        t.x = b.x;
        t.y = b.y;
        t.pi++;
        s -= seg;
      } else {
        t.x += ((b.x - t.x) / seg) * s;
        t.y += ((b.y - t.y) / seg) * s;
        s = 0;
      }
    }
    if (t.pi >= t.path.length - 1) {
      t.path = null;
      if (t.st === 'back') {
        t.st = 'home';
        t.hdg = -Math.PI / 2;
      } else t.st = 'standby';
    }
  }
}
