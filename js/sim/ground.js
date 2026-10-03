// Bodenabfertigung: Parkpositionen, Turnaround, Fahrzeuge
import { aiNote } from './aiplay.js';
import { AC_TYPES, TASKS, TASK_ORDER, VEH_TYPES, SIZE_RANK, AIRLINES } from '../config.js';
import { nordoOnBlock } from './nordo.js';
import { sidOf } from './sid.js';
import { crewDispatch, crewDone, crewEmpty, crewOnBlock, crewPushStart, crewPushDone, crewStairsAway } from './crew.js';
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
  if (t.light || t.walk || (!t.cargo && t.pax <= 20)) {
    // Kleinflugzeug/Lufttaxi/Businessjet: Gäste gehen zu Fuß, Pilot tankt selbst (Sportflieger) bzw. Tankwagen
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
    // Außenposition: die Treppe fährt an die vordere Tür (Turboprops und Regionaljets mit eingebauter Bordtreppe – und
    // Plätze ohne Treppenfahrzeuge – brauchen keine); der Bus darf gleichzeitig kommen, ausgestiegen wird erst an der Treppe
    const stairs = !contact && !t.airstair && state.vehicles.some((v) => v.type === 'stairs');
    if (stairs) mk('stairs', TASKS.stairs.base, 'stairs');
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
  const needed = staffNeeded(state);
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
        const noStairs = k === 'deboard' && tasks.stairs && tasks.stairs.st !== 'done'; // Bus wartet, bis die Treppe steht
        if (!storm && !noStairs && !(task.pausedUntil > state.time)) task.prog += (dt * eff) / (Math.max(30, task.dur) * (task.slow || 1) * (k === 'board' ? state.secSlow || 1 : 1));
      }
      if (task.st === 'active' && k !== 'push') {
        if (task.prog >= 1) {
          task.prog = 1;
          task.st = 'done';
          const tv = task.veh ? state.vehicles.find((x) => x.id === task.veh) : null;
          crewDone(state, tv, ac, k, task);
          if (tv && k === 'stairs') {
            // Treppe bleibt an der Tür, bis alle eingestiegen sind
            tv.st = 'docked';
            tv.dockT = state.time;
          } else if (tv) releaseVehicle(state, tv, false);
          if (k === 'board') undockStairs(state, ac);
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
    if (workDone) undockStairs(state, ac);
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
// Personalbedarf: Grundbedarf plus Besatzung je Fahrzeug (Treppen fährt die Rampencrew mit)
export function staffNeeded(state) {
  return staffBase(state) + state.vehicles.reduce((n, v) => n + (v.type === 'stairs' ? 0.4 : 2.2), 0);
}

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
    // vorab bereitgestellte Treppe zuerst, Treppen anderer Flugzeuge zuletzt
    const pre = (x) => (!x.pre ? 0 : x.pre === ac.id ? -100 : 100);
    cands.sort((a, b) => pre(a) - pre(b) || dist(a.x, a.y, ac.x, ac.y) - dist(b.x, b.y, ac.x, ac.y));
    v = cands[0];
  }
  if (!v) {
    const filling = task.need === 'fuel' && state.vehicles.some((x) => x.type === 'fuel' && (x.st === 'refill' || x.st === 'filling'));
    return { ok: false, msg: filling ? T('Kein Tankwagen mit Ladung frei – Tankwagen werden am Tanklager befüllt') : T`Kein freies Fahrzeug: ${VEH_TYPES[task.need].name}` };
  }
  const sp = LY.servicePoint(k, ac);
  v.job = { ac: ac.id, k };
  v.st = 'drive';
  v.pre = null;
  v.target = sp;
  v.pi = 0;
  v.sh = null;
  if (v.type === 'bus' && k === 'board') {
    // Boarding an der Außenposition: erst an der Haltestelle am Terminal die Fluggäste abholen
    const B = busStopFor(state, v);
    routeTo(v, B);
    v.sh = { k, ph: 'toStop' };
  } else routeTo(v, sp, standAisle(ac, sp));
  task.st = 'assigned';
  task.veh = v.id;
  crewDispatch(state, v, ac, k);
  return { ok: true, v };
}

// Treppe nach dem Boarding abziehen (vor dem Pushback)
function undockStairs(state, ac) {
  for (const v of state.vehicles) {
    if (v.type !== 'stairs' || v.st !== 'docked' || !v.job || v.job.ac !== ac.id) continue;
    crewStairsAway(state, v, ac);
    releaseVehicle(state, v, true);
  }
}

function releaseVehicle(state, v, returnNow) {
  // Bus nach dem Aussteigen: wer schon im Bus sitzt, wird noch zum Terminal gefahren
  const lastLoad = v.type === 'bus' && !returnNow && v.sh && v.sh.k === 'deboard' && (v.sh.ph === 'ac' || v.sh.ph === 'toStop' || v.sh.ph === 'stop');
  v.job = null;
  v.st = 'idle';
  v.idleT = returnNow ? 999 : 0;
  v.dockT = 0;
  if (lastLoad) {
    v.st = 'busEnd';
    if (v.sh.ph === 'ac') busLeg(v, busStopFor(state, v), 'toStop', state);
    v.sh.last = true;
    return;
  }
  v.sh = null;
  if (v.type === 'fuel' && (v.load || 0) < FUEL.truckCap * 0.35) sendRefill(state, v);
}

// ---------- Vorfeldbus an Außenpositionen ----------
// Der Bus pendelt zwischen Flugzeugtür und Haltestelle am Terminal, solange Aus- bzw. Einsteigen läuft (die Dauer der
// Abfertigung hängt davon nicht ab – der Bus zeigt, was passiert). v.sh = { k, ph, t0 }: ph = ac | toStop | stop | toAc
export const BUS_DWELL_AC = 80; // Sekunden an der Tür (Fluggäste steigen um)
export const BUS_DWELL_STOP = 50; // Sekunden an der Haltestelle
const BUS_PAX = 80; // Fluggäste je Busfahrt
// Haltestelle am Terminal: mehrere Buchten hintereinander, jeder Bus nimmt die erste freie
const STOP_SLOTS = [0, -0.95, 0.95, -1.9];
function busStopFor(state, v) {
  const S = LY.busStop();
  const used = new Set();
  for (const o of state.vehicles)
    if (o !== v && o.type === 'bus' && o.sh && o.stopOff != null && (o.sh.ph === 'toStop' || o.sh.ph === 'stop' || (o.sh.ph === 'wait' && Math.abs(o.y - S.y) < 0.4))) used.add(o.stopOff);
  v.stopOff = STOP_SLOTS.find((x) => !used.has(x)) ?? 0;
  return { ...S, x: S.x + v.stopOff };
}
function busLeg(v, to, ph, state) {
  const ac = ph === 'toAc' && v.job ? state.acs.find((a) => a.id === v.job.ac) : null;
  routeTo(v, to, ac ? standAisle(ac, to) : null);
  v.sh = { ...v.sh, ph, t0: state.time };
}
// ein Schritt im Pendelverkehr; true, solange der Bus dabei ist (fährt oder wartet)
function busStep(state, v, dt, storm, ac = null) {
  const B = v.sh;
  if (B.ph === 'wait') return true; // alle Fahrten gemacht: warten, bis die Abfertigung fertig ist
  // Aussteigen erst, wenn die Treppe an der Tür steht
  const T = ac && ac.ta && ac.ta.tasks;
  if (B.ph === 'ac' && B.k === 'deboard' && T && T.stairs && T.stairs.st !== 'done') {
    v.sh = { ...B, t0: state.time };
    return true;
  }
  if (B.ph === 'ac' || B.ph === 'stop') {
    if (state.time - B.t0 < (B.ph === 'ac' ? BUS_DWELL_AC : BUS_DWELL_STOP)) return true;
    if (B.last) return false; // letzte Fahrt: alle ausgestiegen
    // Boarding endet am Flugzeug, Aussteigen an der Haltestelle
    if ((B.k === 'board') === (B.ph === 'ac') && B.n >= B.need) v.sh = { ...B, ph: 'wait' };
    else if (B.ph === 'ac') busLeg(v, busStopFor(state, v), 'toStop', state);
    else busLeg(v, v.target, 'toAc', state);
    return true;
  }
  if (storm) return true;
  if (moveAlong(v, dt, VEH_TYPES.bus.speed, state)) {
    if (B.ph === 'toStop') {
      v.sh = { ...B, ph: 'stop', t0: state.time, n: B.n + (B.k === 'deboard' ? 1 : 0) };
      v.hdg = LY.busStop().hdg;
    } else {
      v.sh = { ...B, ph: 'ac', t0: state.time, n: B.n + (B.k === 'board' ? 1 : 0) };
      if (v.target) v.hdg = v.target.hdg;
    }
  }
  return true;
}

// Tankwagen zur Füllstelle am Tanklager
function sendRefill(state, v) {
  v.st = 'refill';
  routeTo(v, FUEL.fill);
  v.target = { ...FUEL.fill, hdg: 0 };
}

function sendHome(state, v) {
  const bay = LY.DEPOT_BAYS[v.bay % LY.DEPOT_BAYS.length];
  v.sh = null;
  if (Math.hypot(v.x - bay.x, v.y - bay.y) < 0.1) return;
  v.st = 'return';
  routeTo(v, { x: bay.x, y: bay.y }, bay.x + BAY_AISLE);
  v.target = { x: bay.x, y: bay.y, hdg: -Math.PI / 2 };
}

// Gassen: im Depot zwischen den Stellplatzreihen, an der Parkposition außen neben dem Flugzeug (Nase nach Nord/Süd)
const BAY_AISLE = 0.475;
function standAisle(ac, sp) {
  if (!ac || Math.abs(Math.cos(ac.hdg)) > 0.3) return null;
  const side = Math.sign(sp.x - ac.x);
  if (!side) return null;
  // außerhalb aller Service-Punkte dieser Seite (rechts: Tankwagen ganz außen; links: Bus, Enteiser, Treppe)
  const out = side > 0 ? 0.46 + 0.2 * ac.len : Math.max(1.05, 0.5 + 0.2 * ac.len);
  return ac.x + side * (out + 0.3);
}
function exitAisle(v) {
  if (v.aisle && Math.hypot(v.x - v.aisle.x, v.y - v.aisle.y) < 0.35) return v.aisle.ax;
  const bay = LY.DEPOT_BAYS[v.bay % LY.DEPOT_BAYS.length];
  if (bay && Math.hypot(v.x - bay.x, v.y - bay.y) < 0.35) return bay.x + BAY_AISLE;
  return null;
}
// Weg zu einem Ziel; toAisle = Gasse für die Zufahrt (merkt sie sich fürs Wegfahren)
function routeTo(v, to, toAisle = null) {
  v.path = LY.vehPath({ x: v.x, y: v.y }, to, { from: exitAisle(v), to: toAisle });
  v.pi = 0;
  v.aisle = toAisle != null ? { ax: toAisle, x: to.x, y: to.y } : null;
}

// Fahrer: jeder fährt ein wenig anders (±7 %), fest je Fahrzeug
function driver(v) {
  if (v.drv == null) {
    let h = 0;
    for (const c of String(v.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v.drv = 0.93 + ((h % 1000) / 1000) * 0.14;
  }
  return v.drv;
}
// freie Strecke bis zum Vordermann auf derselben Spur in Fahrtrichtung (hx, hy). Gegenverkehr und Fahrzeuge daneben
// (andere Spur, Parkposition) zählen nicht
const vlen = (o) => o.len ?? VEH_TYPES[o.type]?.len ?? 0.5;
function headway(state, v, hx, hy) {
  const half = vlen(v) / 2;
  let free = Infinity;
  const others = state.patrol ? [...state.vehicles, ...state.patrol.cars] : state.vehicles; // auch die Polizeistreife
  for (const o of others) {
    if (o === v || o.st === 'attached') continue;
    const dx = o.x - v.x, dy = o.y - v.y;
    if (dx > 2.5 || dx < -2.5 || dy > 2.5 || dy < -2.5) continue;
    const ahead = dx * hx + dy * hy;
    if (ahead <= 0) continue;
    if (Math.abs(dy * hx - dx * hy) > 0.17) continue;
    const moving = o.st === 'drive' || o.st === 'return' || o.st === 'refill' || (o.sh && (o.sh.ph === 'toStop' || o.sh.ph === 'toAc'));
    if (moving && Math.cos((o.hdg || 0) - Math.atan2(hy, hx)) < -0.3) continue;
    free = Math.min(free, ahead - half - vlen(o) / 2 - 0.1);
  }
  return free;
}
// entlang des Wegs fahren: anfahren und bremsen, vor dem Ziel Schrittgeschwindigkeit, Abstand zum Vordermann halten.
// true = angekommen
export function moveAlong(v, dt, speed, state) {
  const path = v.path;
  if (v.pi >= path.length - 1) return true;
  let rem = 0;
  for (let i = v.pi; i < path.length - 1; i++) {
    const a = i === v.pi ? v : path[i], b = path[i + 1];
    rem += Math.hypot(b.x - a.x, b.y - a.y);
  }
  let top = speed * driver(v) * clamp(0.35 + rem / 1.1, 0.35, 1);
  const nb = path[v.pi + 1], hl = Math.hypot(nb.x - v.x, nb.y - v.y) || 1;
  let free = state ? headway(state, v, (nb.x - v.x) / hl, (nb.y - v.y) / hl) : Infinity;
  // nie dauerhaft verklemmen: nach längerem Warten ein Stück vorbeischieben
  if ((v.wait || 0) > 10) v.squeeze = 0.8;
  if (v.squeeze > 0) free = Infinity;
  if (free < 0.7) top = Math.min(top, speed * clamp(free / 0.7, 0, 1));
  v.spd = (v.spd || 0) + clamp(top - (v.spd || 0), -dt * 0.5, dt * 0.18);
  let s = Math.max(0, Math.min(v.spd * dt, free));
  v.wait = s < 1e-4 ? (v.wait || 0) + dt : 0;
  if (v.squeeze > 0) v.squeeze -= s;
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
  if (v.pi >= path.length - 1) {
    v.spd = 0;
    v.wait = 0;
    return true;
  }
  return false;
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
      if (moveAlong(v, dt, vt.speed, state)) {
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
      if (v.st === 'drive' && v.sh && (v.sh.ph === 'toStop' || v.sh.ph === 'stop')) {
        // Boarding: erst an der Haltestelle die Fluggäste abholen, dann zum Flugzeug
        if (v.sh.ph === 'stop' && state.time - v.sh.t0 >= BUS_DWELL_STOP) busLeg(v, v.target, 'toAc', state);
        else if (v.sh.ph === 'toStop' && moveAlong(v, dt, vt.speed, state)) {
          v.sh = { ...v.sh, ph: 'stop', t0: state.time };
          v.hdg = LY.busStop().hdg;
        }
        continue;
      }
      const done = moveAlong(v, dt, vt.speed, state);
      if (done) {
        if (v.st === 'drive') {
          const ac = acById.get(v.job.ac);
          const task = ac && ac.ta && ac.ta.tasks[v.job.k];
          if (task) {
            task.st = 'active';
            v.st = 'work';
            if (v.target) v.hdg = v.target.hdg;
            if (v.type === 'bus' && (v.job.k === 'deboard' || v.job.k === 'board')) {
              // so viele Fahrten, wie Fluggäste da sind (≈ 80 je Bus); beim Boarding ist die erste Ladung schon da
              const rot = getRot(state, ac);
              const pax = rot ? (v.job.k === 'board' ? rot.paxOut : rot.paxIn) : AC_TYPES[ac.type].pax;
              v.sh = { k: v.job.k, ph: 'ac', t0: state.time, n: v.job.k === 'board' ? 1 : 0, need: Math.max(1, Math.ceil((pax || 0) / BUS_PAX)) };
            }
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
      else if (v.sh) busStep(state, v, dt, storm, ac);
      continue;
    }
    if (v.st === 'docked') {
      const ac = v.job && acById.get(v.job.ac);
      if (!ac || ac.phase !== PH.STAND) releaseVehicle(state, v, true);
      continue;
    }
    if (v.st === 'busEnd') {
      if (!busStep(state, v, dt, storm)) {
        v.sh = null;
        v.st = 'idle';
        v.idleT = 999;
      }
      continue;
    }
    if (v.st === 'idle') {
      if (v.type === 'fuel' && (v.load || 0) < FUEL.truckCap * 0.35 && !(v.brokenUntil > state.time)) {
        sendRefill(state, v);
        continue;
      }
      v.idleT += dt;
      if (v.pre) continue; // Treppe wartet an der Position auf das einrollende Flugzeug
      const bay = LY.DEPOT_BAYS[v.bay % LY.DEPOT_BAYS.length];
      const atHome = Math.hypot(v.x - bay.x, v.y - bay.y) < 0.1;
      if (!atHome && v.idleT > 45) sendHome(state, v);
    }
  }
}

// Treppe vorab: rollt ein Flugzeug zu einer Außenposition, wartet ein freies Treppenfahrzeug schon neben der Position
const inbound = (ph) => ph === PH.FINAL || ph === PH.ROLLOUT || ph === PH.VACATED || ph === PH.TAXI_WAIT || ph === PH.TAXI_IN;
function stairsAhead(state, allAuto) {
  if (!allAuto && !state.settings.vehAuto.stairs) return;
  const stairs = state.vehicles.filter((v) => v.type === 'stairs');
  if (!stairs.length) return;
  for (const v of stairs) if (v.pre && !state.acs.some((a) => a.id === v.pre && (inbound(a.phase) || a.phase === PH.STAND))) v.pre = null;
  for (const ac of state.acs) {
    if (!inbound(ac.phase) || ac.stand == null) continue;
    const t = AC_TYPES[ac.type];
    if (t.light || t.walk || t.cargo || t.airstair || t.pax <= 20) continue;
    const st = state.stands.find((s) => s.id === ac.stand);
    if (!st || st.kind === 'contact' || st.ga || stairs.some((v) => v.pre === ac.id)) continue;
    const free = stairs.filter((v) => v.st === 'idle' && !v.pre && !(v.brokenUntil > state.time));
    if (!free.length) continue;
    // Warteplatz links vor der Position, außerhalb des einrollenden Flugzeugs
    const to = { x: st.x - 1.5, y: LY.STAND_NOSE + 0.35 };
    free.sort((a, b) => dist(a.x, a.y, to.x, to.y) - dist(b.x, b.y, to.x, to.y));
    const v = free[0];
    v.pre = ac.id;
    v.st = 'return';
    routeTo(v, to);
    v.target = { ...to, hdg: 0 };
  }
}

export function autoDispatch(state, allAuto) {
  stairsAhead(state, allAuto);
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
