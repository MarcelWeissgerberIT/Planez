// Bodenabfertigung: Parkpositionen, Turnaround, Fahrzeuge
import { aiNote } from './aiplay.js';
import { AC_TYPES, TASKS, TASK_ORDER, VEH_TYPES, SIZE_RANK, AIRLINES } from '../config.js';
import { nordoOnBlock } from './nordo.js';
import { sidOf } from './sid.js';
import { crewDispatch, crewDone, crewEmpty, crewOnBlock, crewPushStart, crewPushDone } from './crew.js';
import { scoreDeice } from './score.js';
import * as LY from '../layout.js';
import { clamp, dist, angNorm, hourOf, rand } from '../util.js';
import { radio, log, notify } from './messages.js';
import { nextId } from './schedule.js';
import { tel, setReq, PH, getRot, greet } from './aircraft.js';
import { onOffBlock } from './economy.js';
import { acdmOnBlock } from './acdm.js';
import { FUEL, fuelState, upliftFor, sellFuel, truckTakeFuel } from './fuel.js';
import { earn } from './economy.js';
import { needsDeice } from './winter.js';
import { hardLandingCheck } from './touchdown.js';
import { staffBase } from './career.js';
import { T } from '../i18n.js';

export const BRIDGE_SPEED = 1 / 40; // pro Spielsekunde

// ---------- Parkpositionen ----------
export function standFits(stand, ac) {
  if (!stand.built || stand.closed || stand.closing) return false;
  const t = AC_TYPES[ac.type];
  if (SIZE_RANK[stand.size] < SIZE_RANK[t.size]) return false;
  if (t.cargo && stand.kind !== 'cargo') return false;
  // Wiesenplätze (Karriere) nur für Kleinflugzeuge und Lufttaxis
  if (stand.ga && t.len > 1.35) return false;
  return true;
}
export const standFree = (s) => !s.occ && !s.resv;

export function standScore(stand, ac) {
  const t = AC_TYPES[ac.type];
  let sc = 0;
  if (t.cargo) sc += stand.kind === 'cargo' ? 0 : 100;
  else sc += stand.kind === 'contact' ? 0 : stand.kind === 'remote' ? 20 : 40;
  // Sportflieger auf die Wiese, Vorfeld für die Größeren freihalten
  if (t.light || t.walk) sc += stand.ga ? -30 : 15;
  sc += (SIZE_RANK[stand.size] - SIZE_RANK[t.size]) * 8; // große Positionen für große Flugzeuge freihalten
  return sc;
}

export function assignStand(state, ac, standId, silent = false) {
  const st = state.stands.find((s) => s.id === standId);
  if (!st || !standFits(st, ac) || !standFree(st)) return false;
  releaseReservation(state, ac);
  st.resv = ac.id;
  ac.stand = st.id;
  if (!silent) log(state, 'gnd', T`${ac.cs}: Parkposition ${st.id} zugewiesen.`);
  return true;
}
export function releaseReservation(state, ac) {
  for (const s of state.stands) if (s.resv === ac.id) s.resv = null;
  if (ac.phase !== PH.STAND) ac.stand = null;
}
export function assignStandAuto(state, ac) {
  const cands = state.stands.filter((s) => standFits(s, ac) && standFree(s)).sort((a, b) => standScore(a, ac) - standScore(b, ac));
  if (!cands.length) return false;
  const ok = assignStand(state, ac, cands[0].id, true);
  if (ok && state.aiPlay && state.role === 'ground') aiNote(state, T`Position ${cands[0].id} für ${ac.cs}`, ac);
  return ok;
}

// ---------- Turnaround ----------
function makeTasks(state, ac, stand) {
  const t = AC_TYPES[ac.type];
  const rot = getRot(state, ac);
  const paxF = Math.max(0.45, (rot ? Math.max(rot.paxIn, rot.paxOut) : t.pax) / 180);
  const sizeF = Math.max(0.5, t.scale);
  const contact = stand.kind === 'contact';
  const tasks = {};
  const mk = (k, dur, need, after = []) => (tasks[k] = { k, st: 'wait', dur: dur * 60, prog: 0, need, after, veh: null });
  if (t.light || t.walk) {
    // Kleinflugzeug/Lufttaxi: Gäste gehen zu Fuß, Pilot tankt selbst (Sportflieger) bzw. Tankwagen (Turboprop)
    const paxN = Math.max(1, rot ? Math.max(rot.paxIn, rot.paxOut) : 2);
    const has = (type) => state.vehicles.some((v) => v.type === type);
    mk('deboard', 1.5 + paxN * 0.4, null);
    if (!t.light && has('fuel')) {
      if (has('baggage')) mk('unload', 3, 'baggage');
      mk('fuel', TASKS.fuel.base * 0.5, 'fuel');
      tasks.fuel.uplift = upliftFor(state, ac);
      tasks.fuel.delivered = 0;
      mk('board', 3 + paxN * 0.5, null, ['deboard', 'fuel']);
      if (has('baggage')) mk('load', 3, 'baggage', ['unload']);
    } else mk('board', (t.light ? 2 : 4) + paxN * 0.5, null, ['deboard']); // Sportflieger tanken selbst an der Zapfsäule
    if (needsDeice(state) && !t.light && has('deice')) mk('deice', TASKS.deice.base * 0.5, 'deice', Object.keys(tasks));
    mk('push', 0, null, Object.keys(tasks));
    return tasks;
  }
  if (!t.cargo) {
    const busF = contact ? 1 : 1.35;
    mk('deboard', TASKS.deboard.base * paxF * busF, contact ? null : 'bus');
    mk('clean', TASKS.clean.base * sizeF, 'cleaning', ['deboard']);
    mk('cater', TASKS.cater.base * sizeF, 'catering', ['deboard']);
    mk('board', TASKS.board.base * paxF * busF, contact ? null : 'bus', ['clean', 'cater']);
  }
  const cargoF = t.cargo ? Math.max(1, (rot?.cargoIn || t.cargo) / 55) : sizeF;
  mk('unload', TASKS.unload.base * cargoF, 'baggage');
  mk('fuel', TASKS.fuel.base * Math.max(0.5, Math.sqrt(t.fuel / 11000)), 'fuel');
  tasks.fuel.uplift = upliftFor(state, ac); // Tonnen Kerosin
  tasks.fuel.delivered = 0;
  mk('load', TASKS.load.base * (t.cargo ? Math.max(1, (rot?.cargoOut || t.cargo) / 55) : sizeF), 'baggage', ['unload']);
  // Enteisung als letzte Arbeit vor dem Pushback (Winter)
  if (needsDeice(state) && state.vehicles.some((v) => v.type === 'deice')) mk('deice', TASKS.deice.base * Math.max(0.6, sizeF), 'deice', Object.keys(tasks));
  mk('push', 0, 'tug', Object.keys(tasks));
  return tasks;
}

export function onBlock(state, ac) {
  const st = state.stands.find((s) => s.id === ac.stand);
  const rot = getRot(state, ac);
  if (st) {
    st.occ = ac.id;
    st.resv = null;
  }
  ac.engines = false;
  // Freigaben des Ankunftsflugs gelten nicht für den Abflug
  ac.clr = {};
  ac.holdPos = false;
  ac.spdOverride = null;
  ac.altRestr = undefined;
  ac.vacated = false;
  ac.crossX = null;
  ac.crossing = false;
  ac.strip = 'N';
  ac.ta = { tasks: makeTasks(state, ac, st), onBlock: state.time };
  hardLandingCheck(state, ac);
  if (rot) {
    rot.status = 'onblock';
    rot.onBlock = state.time;
    ac.cs = rot.depNo;
    acdmOnBlock(state, ac);
    if (rot.landT && !ac.waitedStand && state.life) state.life.noStandWait = (state.life.noStandWait || 0) + 1;
  }
  log(state, 'gnd', T`${rot ? rot.arrNo : ac.cs} an Position ${st ? st.id : '?'} angekommen (Abflug als ${ac.cs}).`);
  crewOnBlock(state, ac);
  nordoOnBlock(state, ac);
  ac.sid = null;
  sidOf(state, ac); // Abflugroute des Folgeflugs
}

export function onPushbackStart(state, ac) {
  const rot = getRot(state, ac);
  const tug = ac.ta && ac.ta.tasks.push.veh ? state.vehicles.find((v) => v.id === ac.ta.tasks.push.veh) : null;
  if (tug) tug.st = 'attached';
  crewPushStart(state, ac, tug);
  if (rot) {
    rot.offBlock = state.time;
    rot.status = 'offblock';
    onOffBlock(state, ac, rot);
  }
}

export function onPushbackDone(state, ac) {
  const st = state.stands.find((s) => s.id === ac.stand);
  if (st && st.occ === ac.id) st.occ = null;
  const task = ac.ta && ac.ta.tasks.push;
  if (task) {
    task.st = 'done';
    const tug = state.vehicles.find((v) => v.id === task.veh);
    crewPushDone(state, ac, tug);
    if (tug) releaseVehicle(state, tug, true);
  }
  ac.stand = null;
  ac.ta = null;
}

export function efficiency(state) {
  const needed = staffBase(state) + 2.2 * state.vehicles.length;
  let e = clamp(state.staff / needed, 0.45, 1.15);
  if (state.strikeUntil > state.time) e *= 0.6;
  if (state.moraleUntil > state.time) e *= 1.1;
  const h = hourOf(state.time);
  if ((h < 6 || h > 20.5) && state.upgrades.apronLights) e *= 1.15;
  return e;
}

export function taskStatusAll(ac) {
  if (!ac.ta) return null;
  return TASK_ORDER.filter((k) => ac.ta.tasks[k]).map((k) => ac.ta.tasks[k]);
}

function depsDone(ta, task) {
  return task.after.every((k) => !ta.tasks[k] || ta.tasks[k].st === 'done');
}

export function updateGround(state, dt) {
  const eff = efficiency(state);
  const storm = state.weather.kind === 'storm' || state.rampClosedUntil > state.time;
  state.groundEff = eff;
  // Brücken animieren
  for (const st of state.stands) {
    if (st.kind !== 'contact' || !st.built) continue;
    const ac = st.occ ? state.acs.find((a) => a.id === st.occ) : null;
    let target = 0;
    if (ac && ac.phase === PH.STAND && ac.ta) {
      const tk = ac.ta.tasks;
      const allDone = TASK_ORDER.every((k) => !tk[k] || k === 'push' || tk[k].st === 'done');
      target = allDone ? 0 : 1;
    }
    st.bridge = clamp((st.bridge || 0) + Math.sign(target - (st.bridge || 0)) * BRIDGE_SPEED * dt, 0, 1);
  }

  for (const ac of state.acs) {
    if (ac.phase !== PH.STAND || !ac.ta) continue;
    const st = state.stands.find((s) => s.id === ac.stand);
    const rot = getRot(state, ac);
    const tasks = ac.ta.tasks;
    if (!tasks.deice && tasks.push && tasks.push.st === 'wait' && needsDeice(state) && !AC_TYPES[ac.type].light && state.vehicles.some((v) => v.type === 'deice')) {
      const t = AC_TYPES[ac.type];
      tasks.deice = { k: 'deice', st: 'wait', dur: TASKS.deice.base * Math.max(0.6, t.scale) * 60, prog: 0, need: 'deice', after: Object.keys(tasks).filter((x) => x !== 'push' && x !== 'deice'), veh: null };
      tasks.push.after = [...new Set([...tasks.push.after, 'deice'])];
    }
    for (const k of TASK_ORDER) {
      const task = tasks[k];
      if (!task) continue;
      if (task.st === 'wait' && k === 'push') {
        // Schlepper schon anfordern, sobald die letzten Arbeiten laufen
        const others = TASK_ORDER.filter((o) => o !== 'push' && tasks[o]);
        if (others.every((o) => tasks[o].st === 'active' || tasks[o].st === 'done')) {
          task.st = 'ready';
          task.readyT = state.time;
        }
      } else if (task.st === 'wait' && depsDone(ac.ta, task)) {
        task.st = 'ready';
        task.readyT = state.time;
      }
      if (task.st === 'ready' && !task.need) {
        const bridgeOk = !st || st.kind !== 'contact' || (st.bridge || 0) >= 0.999;
        if (bridgeOk) task.st = 'active';
      }
      if (task.st === 'ready' && task.need) {
        state.stats.vehWait[task.need] = (state.stats.vehWait[task.need] || 0) + dt;
      }
      if (task.st === 'active' && k === 'fuel' && task.uplift) {
        // Betankung: Menge kommt aus dem Tankwagen; ist er leer, muss ein zweiter kommen
        const v = state.vehicles.find((x) => x.id === task.veh);
        if (!v) {
          task.st = 'ready';
          task.veh = null;
        } else if (!storm && !(task.pausedUntil > state.time)) {
          const rate = (task.uplift / Math.max(30, task.dur)) * eff;
          const q = Math.min(rate * dt, v.load || 0, task.uplift - task.delivered);
          v.load = (v.load || 0) - q;
          task.delivered += q;
          sellFuel(state, q, earn);
          task.prog = Math.min(1, task.delivered / task.uplift);
          if (task.prog < 0.999 && (v.load || 0) <= 0.01) {
            task.st = 'ready';
            task.readyT = state.time;
            task.veh = null;
            releaseVehicle(state, v, true);
            log(state, 'gnd', T`${ac.cs}: Tankwagen leer nach ${Math.round(task.delivered)} von ${Math.round(task.uplift)} t – nächster Tankwagen nötig.`);
            crewEmpty(state, v, ac, task);
            continue;
          }
          if (task.prog >= 0.999) task.prog = 1;
        }
      } else if (task.st === 'active' && k !== 'push') {
        // Ereignisse: pausiert (Reparatur, Reinigung) oder verlangsamt (Handarbeit)
        if (!storm && !(task.pausedUntil > state.time)) task.prog += (dt * eff) / (Math.max(30, task.dur) * (task.slow || 1) * (k === 'board' ? state.secSlow || 1 : 1));
      }
      if (task.st === 'active' && k !== 'push') {
        if (task.prog >= 1) {
          task.prog = 1;
          task.st = 'done';
          const tv = task.veh ? state.vehicles.find((x) => x.id === task.veh) : null;
          crewDone(state, tv, ac, k, task);
          if (tv) releaseVehicle(state, tv, false);
          if (k === 'board') log(state, 'gnd', T`${ac.cs}: Boarding abgeschlossen.`);
          if (k === 'deice') {
            state.life = state.life || {};
            state.life.deiced = (state.life.deiced || 0) + 1;
            scoreDeice(state, ac);
            earn(state, 'deice', { S: 1800, M: 3200, L: 7500 }[AC_TYPES[ac.type].size] || 3200);
            log(state, 'gnd', T`${ac.cs}: enteist – Holdover-Zeit läuft, zügig starten.`);
          }
        }
      }
    }
    // Pushback anfragen, wenn alles fertig, Schlepper angekoppelt, Brücke weg
    const push = tasks.push;
    const bridgeGone = !st || st.kind !== 'contact' || (st.bridge || 0) <= 0.001;
    const workDone = TASK_ORDER.every((o) => o === 'push' || !tasks[o] || tasks[o].st === 'done');
    ac.ta.ready = workDone;
    // Pilot meldet sich zur TOBT (bzw. nach „Start-up erwartet“ zur TSAT)
    if (push.st === 'active' && workDone && bridgeGone && rot && state.time >= (rot.tobt || rot.std) - 5 * 60 && !(ac.pushWaitUntil > state.time)) {
      if (ac.req !== 'push') {
        setReq(state, ac, 'push');
        const self = AC_TYPES[ac.type].selfTaxi;
        radio(state, ac.cs, `${greet(state, ac).replace(/^./, (c) => c.toUpperCase())}${tel(ac)}, ${self ? T`parking ${ac.stand}, request start-up` : `stand ${ac.stand}, request pushback`}.`);
      }
    }
  }

  updateVehicles(state, dt, storm);
  const auto = state.auto.ground;
  // Auto-Zuweisung Parkpositionen
  state.standTimer = (state.standTimer || 0) - dt;
  if (state.standTimer <= 0) {
    state.standTimer = 8;
    if (auto || state.settings.standAuto) {
      const waiting = state.acs.filter((a) => a.arr && !a.stand && [PH.INBOUND, PH.HOLD, PH.APPROACH, PH.FINAL, PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.GOAROUND].includes(a.phase));
      waiting.sort((a, b) => (state.rots[a.rot]?.sta || 0) - (state.rots[b.rot]?.sta || 0));
      for (const a of waiting) assignStandAuto(state, a);
    }
  }
  state.dispTimer = (state.dispTimer || 0) - dt;
  if (state.dispTimer <= 0) {
    state.dispTimer = 3;
    autoDispatch(state, auto);
  }
}

// ---------- Fahrzeuge ----------
export function makeVehicle(state, type, bayIdx) {
  const bay = LY.DEPOT_BAYS[bayIdx % LY.DEPOT_BAYS.length];
  const n = state.vehicles.filter((v) => v.type === type).length + 1;
  return {
    id: nextId(state, 'v'),
    type,
    name: `${VEH_TYPES[type].short} ${n}`,
    x: bay.x,
    y: bay.y,
    hdg: -Math.PI / 2,
    st: 'idle',
    job: null,
    path: null,
    pi: 0,
    bay: bayIdx,
    idleT: 0,
    brokenUntil: 0,
    load: type === 'fuel' ? 0 : undefined, // neuer Tankwagen fährt zuerst zum Tanklager
  };
}

export function freeBay(state) {
  const used = new Set(state.vehicles.map((v) => v.bay));
  for (let i = 0; i < LY.DEPOT_BAYS.length; i++) if (!used.has(i)) return i;
  return state.vehicles.length;
}

export function vehicleAvailable(state, v) {
  return (v.st === 'idle' || v.st === 'return') && !(v.brokenUntil > state.time);
}

export function dispatch(state, ac, k, vehId = null) {
  const task = ac.ta && ac.ta.tasks[k];
  if (!task || task.st !== 'ready' || !task.need) return { ok: false, msg: T('Aufgabe nicht bereit') };
  let v;
  if (vehId) v = state.vehicles.find((x) => x.id === vehId && vehicleAvailable(state, x));
  else {
    const need = k === 'fuel' && task.uplift ? Math.min(5, task.uplift - (task.delivered || 0)) : 0;
    const cands = state.vehicles.filter((x) => x.type === task.need && vehicleAvailable(state, x) && (!need || (x.load || 0) >= need));
    cands.sort((a, b) => dist(a.x, a.y, ac.x, ac.y) - dist(b.x, b.y, ac.x, ac.y));
    v = cands[0];
  }
  if (!v) {
    const filling = task.need === 'fuel' && state.vehicles.some((x) => x.type === 'fuel' && (x.st === 'refill' || x.st === 'filling'));
    return { ok: false, msg: filling ? T('Kein Tankwagen mit Ladung frei – Tankwagen werden am Tanklager befüllt') : T`Kein freies Fahrzeug: ${VEH_TYPES[task.need].name}` };
  }
  const sp = LY.servicePoint(k, ac);
  v.job = { ac: ac.id, k };
  v.st = 'drive';
  v.path = LY.vehPath({ x: v.x, y: v.y }, sp);
  v.pi = 0;
  v.target = sp;
  task.st = 'assigned';
  task.veh = v.id;
  crewDispatch(state, v, ac, k);
  return { ok: true, v };
}

function releaseVehicle(state, v, returnNow) {
  v.job = null;
  v.st = 'idle';
  v.idleT = returnNow ? 999 : 0;
  if (v.type === 'fuel' && (v.load || 0) < FUEL.truckCap * 0.35) sendRefill(state, v);
}

// Tankwagen zur Füllstelle am Tanklager
function sendRefill(state, v) {
  v.st = 'refill';
  v.path = LY.vehPath({ x: v.x, y: v.y }, FUEL.fill);
  v.pi = 0;
  v.target = { ...FUEL.fill, hdg: 0 };
}

function sendHome(state, v) {
  const bay = LY.DEPOT_BAYS[v.bay % LY.DEPOT_BAYS.length];
  if (Math.hypot(v.x - bay.x, v.y - bay.y) < 0.1) return;
  v.st = 'return';
  v.path = LY.vehPath({ x: v.x, y: v.y }, { x: bay.x, y: bay.y });
  v.pi = 0;
  v.target = { x: bay.x, y: bay.y, hdg: -Math.PI / 2 };
}

function moveAlong(v, dt, speed) {
  let s = speed * dt;
  const path = v.path;
  while (s > 1e-6 && v.pi < path.length - 1) {
    const b = path[v.pi + 1];
    const seg = Math.hypot(b.x - v.x, b.y - v.y);
    if (seg > 1e-4) {
      const h = Math.atan2(b.y - v.y, b.x - v.x);
      v.hdg = angNorm(v.hdg + clamp(angNorm(h - v.hdg), -4 * dt, 4 * dt));
    }
    if (seg <= s) {
      v.x = b.x;
      v.y = b.y;
      v.pi++;
      s -= seg;
    } else {
      v.x += ((b.x - v.x) / seg) * s;
      v.y += ((b.y - v.y) / seg) * s;
      s = 0;
    }
  }
  return v.pi >= path.length - 1;
}

function updateVehicles(state, dt, storm) {
  const acById = new Map(state.acs.map((a) => [a.id, a]));
  for (const v of state.vehicles) {
    const vt = VEH_TYPES[v.type];
    if (v.st === 'attached') {
      const ac = v.job && acById.get(v.job.ac);
      if (ac) {
        const sp = LY.servicePoint('push', ac);
        v.x = sp.x;
        v.y = sp.y;
        v.hdg = sp.hdg;
      } else releaseVehicle(state, v, true);
      continue;
    }
    if (v.st === 'refill') {
      if (storm) continue;
      if (moveAlong(v, dt, vt.speed)) {
        v.st = 'filling';
        v.hdg = 0;
      }
      continue;
    }
    if (v.st === 'filling') {
      if (truckTakeFuel(state, v, dt)) {
        v.st = 'idle';
        v.idleT = 0;
        sendHome(state, v);
      }
      continue;
    }
    if (v.st === 'drive' || v.st === 'return') {
      if (storm) continue;
      // Ziel noch gültig?
      if (v.st === 'drive') {
        const ac = v.job && acById.get(v.job.ac);
        if (!ac || ac.phase !== PH.STAND) {
          releaseVehicle(state, v, true);
          continue;
        }
      }
      const done = moveAlong(v, dt, vt.speed);
      if (done) {
        if (v.st === 'drive') {
          const ac = acById.get(v.job.ac);
          const task = ac && ac.ta && ac.ta.tasks[v.job.k];
          if (task) {
            task.st = 'active';
            v.st = 'work';
            if (v.target) v.hdg = v.target.hdg;
          } else releaseVehicle(state, v, true);
        } else {
          v.st = 'idle';
          v.idleT = 0;
          v.hdg = -Math.PI / 2;
        }
      }
      continue;
    }
    if (v.st === 'work') {
      const ac = v.job && acById.get(v.job.ac);
      if (!ac || ac.phase !== PH.STAND) releaseVehicle(state, v, true);
      continue;
    }
    if (v.st === 'idle') {
      if (v.type === 'fuel' && (v.load || 0) < FUEL.truckCap * 0.35 && !(v.brokenUntil > state.time)) {
        sendRefill(state, v);
        continue;
      }
      v.idleT += dt;
      const bay = LY.DEPOT_BAYS[v.bay % LY.DEPOT_BAYS.length];
      const atHome = Math.hypot(v.x - bay.x, v.y - bay.y) < 0.1;
      if (!atHome && v.idleT > 45) sendHome(state, v);
    }
  }
}

export function autoDispatch(state, allAuto) {
  const ready = [];
  for (const ac of state.acs) {
    if (ac.phase !== PH.STAND || !ac.ta) continue;
    const rot = getRot(state, ac);
    for (const k of TASK_ORDER) {
      const t = ac.ta.tasks[k];
      if (t && t.st === 'ready' && t.need && (allAuto || state.settings.vehAuto[t.need])) ready.push({ ac, k, std: rot ? rot.std : 0, need: t.need });
    }
  }
  ready.sort((a, b) => a.std - b.std);
  const note = allAuto && state.aiPlay && state.role === 'ground';
  for (const r of ready) {
    const res = dispatch(state, r.ac, r.k);
    if (note && res && res.ok !== false) aiNote(state, `${TASKS[r.k] ? TASKS[r.k].name : r.k} – ${r.ac.cs} (P${r.ac.stand})`, r.ac);
  }
}

// Summen für UI / Management
export function fleetSummary(state) {
  const out = {};
  for (const k of Object.keys(VEH_TYPES)) out[k] = { total: 0, busy: 0, broken: 0 };
  for (const v of state.vehicles) {
    const o = out[v.type];
    o.total++;
    if (v.brokenUntil > state.time) o.broken++;
    else if (!vehicleAvailable(state, v)) o.busy++;
  }
  return out;
}
