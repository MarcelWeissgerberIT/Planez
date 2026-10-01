// Simulationsschritt: Reihenfolge aller Systeme
import { TIME_SCALE } from '../config.js';
import { dayOf, roundedPath } from '../util.js';
import { spawnArrival, updateAircraft, PH } from './aircraft.js';
import { updateGround } from './ground.js';
import { autoAtc, updateConflicts } from './atc.js';
import { updateEconomy, closeDay } from './economy.js';
import { generateDay, dailyContracts, maybeOffer } from './schedule.js';
import { updateEvents } from './events.js';
import { updateSequence } from './sequence.js';
import { updateDecisions } from './decisions.js';
import { updateNews } from './news.js';
import { updateWinter } from './winter.js';
import { updateAchievements } from './achievements.js';
import { updateAtis } from './atis.js';
import { updateConstruction } from './construction.js';
import { updateAcdm } from './acdm.js';
import { updateScenario } from './scenarios.js';
import { updateSecurity } from './security.js';
import { updateReadback } from './readback.js';
import { updateRival, rivalDayEnd } from './rival.js';
import { updateNordo } from './nordo.js';
import { updateWxDev } from './wxdev.js';
import { updateFuel } from './fuel.js';
import { dailyLoans } from './finance.js';
import { spend } from './economy.js';
import { updateGoals, onDayEnd as goalsDayEnd } from './goals.js';
import { boardDayEnd } from './board.js';
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
  updateSequence(state);
  updateDecisions(state, dt);
  updateNews(state, dt);
  updateWinter(state, dt);
  updateAchievements(state, dt);
  updateAtis(state);
  updateSecurity(state, dt);
  updateReadback(state, dt);
  updateRival(state, dt);
  updateNordo(state);
  updateWxDev(state, dt);
  updateGround(state, dt);
  updateConflicts(state, dt);
  updateAcdm(state, dt);
  updateEconomy(state, dt);
  updateFuel(state, dt);
  updateConstruction(state, dt);
  updateGoals(state, dt);
  maybeOffer(state, dt);
  updateFire(state, dt);
  if (state.scenario) updateScenario(state);
}

function spawnDue(state) {
  state.spawnCheck = (state.spawnCheck || 0) + 1;
  if (state.spawnCheck % 5) return;
  for (const r of Object.values(state.rots)) {
    if (r.status === 'planned' && r.spawnAt <= state.time && !spawnArrival(state, r)) r.spawnAt = state.time + 90;
  }
}

function dayRollover(state) {
  const rec = closeDay(state);
  dailyLoans(state, spend);
  goalsDayEnd(state, rec);
  rivalDayEnd(state);
  boardDayEnd(state, rec);
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
const STATION = { x: 37.2, y: 44.8 };
function updateFire(state, dt) {
  if (!state.fire) {
    state.fire = { trucks: [0, 1, 2].map((i) => ({ x: STATION.x + i * 0.9, y: STATION.y, hx: STATION.x + i * 0.9, hdg: -Math.PI / 2, st: 'home', path: null, pi: 0 })) };
  }
  const f = state.fire;
  // ältere Spielstände: Feuerwache wurde verlegt
  for (const t of f.trucks) if (t.st === 'home' && !t.path && Math.abs(t.y - STATION.y) > 0.5) t.y = STATION.y;
  const alert = state.fireAlert;
  if (alert) {
    const ac = state.acs.find((a) => a.id === alert.ac);
    if (ac && ac.mode === 'map' && (ac.phase === PH.FINAL || ac.phase === PH.ROLLOUT) && !alert.deployed) {
      alert.deployed = true;
      const tx = ac.exitX ?? 40;
      const south = ac.strip === 'S';
      const roadY = south ? 44.0 : 34.5;
      f.trucks.forEach((t, i) => {
        const target = { x: tx + (i - 1) * 1.1, y: south ? LY.RWY_S.y + LY.RWY_S.hw + 0.9 : LY.RWY.y + LY.RWY.hw + 0.9 };
        t.path = roundedPath([{ x: t.x, y: t.y }, { x: t.hx, y: roadY }, { x: target.x, y: roadY }, target], 0.6, 0.2);
        t.roadY = roadY;
        t.pi = 0;
        t.st = 'out';
      });
    }
    // Löschangriff: Fahrzeuge umstellen das auf der Piste stehende Flugzeug und sprühen Schaum auf Triebwerke/Rumpf
    if (alert.deployed && ac && ac.fireStop && !ac.fireDone) {
      const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
      const spots = [[0.1, 1.25], [0.1, -1.25], [-ac.len * 0.75, 0.35]];
      let n = 0;
      f.trucks.forEach((t, i) => {
        const [a, b] = spots[i % 3];
        const tx = ac.x + fx * a + rx * b, ty = ac.y + fy * a + ry * b;
        const d = Math.hypot(tx - t.x, ty - t.y);
        t.path = null;
        if (d > 0.12) {
          const st = Math.min(d, 0.32 * dt);
          t.hdg = Math.atan2(ty - t.y, tx - t.x);
          t.x += ((tx - t.x) / d) * st;
          t.y += ((ty - t.y) / d) * st;
          t.spray = false;
        } else {
          t.hdg = Math.atan2(ac.y - t.y, ac.x - t.x);
          t.spray = { x: ac.x + fx * (i === 2 ? -ac.len * 0.3 : 0.05) + rx * (i === 0 ? 0.55 : i === 1 ? -0.55 : 0), y: ac.y + fy * (i === 2 ? -ac.len * 0.3 : 0.05) + ry * (i === 0 ? 0.55 : i === 1 ? -0.55 : 0) };
          n++;
        }
        t.st = 'standby';
        t.roadY = t.roadY || 34.5;
      });
      if (n >= 2) alert.sprayed = (alert.sprayed || 0) + dt;
    } else for (const t of f.trucks) t.spray = false;
    if (alert.deployed && (!ac || ac.phase === PH.STAND || ac.phase === PH.GONE || ac.phase === PH.TAXI_IN)) {
      alert.doneT = alert.doneT ?? state.time;
      if (state.time - alert.doneT > 180) {
        f.trucks.forEach((t) => {
          const ry = t.roadY || 34.5;
          t.path = roundedPath([{ x: t.x, y: t.y }, { x: t.x, y: ry }, { x: t.hx, y: ry }, { x: t.hx, y: STATION.y }], 0.6, 0.2);
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
