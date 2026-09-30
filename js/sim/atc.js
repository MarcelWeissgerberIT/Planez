// Flugsicherung: Befehle, automatischer Lotse, Konfliktwarnung, Pistenwechsel
import { AC_TYPES } from '../config.js';
import { dist, degNorm } from '../util.js';
import * as AS from './airspace.js';
import * as LY from '../layout.js';
import { PH, tel, windStr, goAround, startTaxiIn, startPushback, startTaxiOut, startLineUp, runwayBlocker, runwayOccupants, setReq, fmtAlt, crossingSafe } from './aircraft.js';
import { radio, log, notify } from './messages.js';
import { penalize } from './economy.js';
import { updateSequence, seqNumber, updateArrQueue, isSeqArrival, isSeqDeparture, sepSec, seqStrip } from './sequence.js';
import { wakeNm, wakeDepSec } from './wake.js';
import { slotOpen } from './acdm.js';
import { runwayClosed, brakingAction, BRAKE_EN, updateRunway, stripForArrival, rwyName, segregated } from './runway.js';
import { fmtClock } from '../util.js';

const numTxt = (s, ac, suffix = '') => {
  updateSequence(s);
  const n = seqNumber(s, ac);
  return n > 1 ? `number ${n}${suffix}, ` : '';
};

const onFinal = (ac) => ac.phase === PH.APPROACH && ac.route.length && ac.route[0].thr;
const say = (state, ac, atc, readback) => {
  radio(state, 'TWR', atc, 'atc');
  if (readback) radio(state, ac.cs, readback, 'pilot');
};

// Befehlskatalog
export const CMDS = {
  approach: {
    label: 'Anflug frei', key: 'A', air: true,
    valid: (s, ac) => [PH.INBOUND, PH.HOLD].includes(ac.phase) && !ac.missedPending,
    run: (s, ac) => {
      ac.rwy = s.rwy;
      ac.strip = stripForArrival(s);
      ac.route = AS.approachRoute(ac.pos, ac.rwy);
      ac.phase = PH.APPROACH;
      ac.holdFix = null;
      ac.clr.app = true;
      ac.clrAppT = s.time;
      ac.req = null;
      ac.altRestr = undefined;
      ac.stackAlt = ac.stackFix = null;
      const rn = rwyName(s, ac.strip);
      say(s, ac, `${tel(ac)}, ${numTxt(s, ac)}cleared ILS approach runway ${rn}, descend 5000 feet.`, `Cleared ILS ${rn}, ${tel(ac)}.`);
    },
  },
  direct: {
    label: 'Direkt FAF', key: 'D', air: true,
    valid: (s, ac) => [PH.INBOUND, PH.HOLD].includes(ac.phase) || (ac.phase === PH.APPROACH && !onFinal(ac) && ac.route.length > 2),
    run: (s, ac) => {
      ac.rwy = s.rwy;
      if (ac.phase !== PH.APPROACH || !ac.strip) ac.strip = stripForArrival(s);
      ac.route = AS.directRoute(ac.pos, ac.rwy);
      ac.phase = PH.APPROACH;
      ac.holdFix = null;
      ac.clr.app = true;
      ac.clrAppT = s.time;
      ac.req = null;
      ac.altRestr = undefined;
      const rn = rwyName(s, ac.strip);
      say(s, ac, `${tel(ac)}, turn direct final approach fix, ${numTxt(s, ac)}cleared ILS runway ${rn}.`, `Direct FAF, cleared ILS ${rn}, ${tel(ac)}.`);
    },
  },
  hold: {
    label: 'Warteschleife', key: 'H', air: true,
    valid: (s, ac) => (ac.phase === PH.APPROACH && !onFinal(ac)) || ac.phase === PH.INBOUND,
    run: (s, ac) => {
      const fix = AS.FIXES[s.rwy][AS.sideOf(ac.pos)];
      ac.phase = PH.INBOUND;
      ac.clr = {};
      ac.route = [{ x: fix.x, y: fix.y, name: fix.name, iaf: true }];
      say(s, ac, `${tel(ac)}, proceed ${fix.name}, hold as published, expect further clearance.`, `Hold at ${fix.name}, ${tel(ac)}.`);
    },
  },
  land: {
    label: 'Landefreigabe', key: 'L', air: true, big: true,
    valid: (s, ac) => (ac.phase === PH.APPROACH || ac.phase === PH.FINAL) && !ac.clr.land && !runwayClosed(s, ac.strip || 'N'),
    run: (s, ac) => {
      ac.clr.land = true;
      ac.clr.landGivenBlocked = !!runwayBlocker(s, ac) && !(runwayBlocker(s, ac).phase === PH.TAKEOFF);
      ac.req = null;
      const ba = brakingAction(s, ac.strip || 'N');
      const rn = rwyName(s, ac.strip || 'N');
      say(s, ac, `${tel(ac)}, ${numTxt(s, ac)}runway ${rn}, cleared to land, ${windStr(s)}${ba !== 'good' ? `, braking action ${BRAKE_EN[ba]}` : ''}.`, `Cleared to land ${rn}, ${tel(ac)}.`);
    },
  },
  goaround: {
    label: 'Durchstarten', key: 'G', air: true, danger: true,
    valid: (s, ac) => onFinal(ac) || (ac.phase === PH.FINAL && ac.z > 0.15),
    run: (s, ac) => {
      say(s, ac, `${tel(ac)}, go around, I say again, go around.`, null);
      goAround(s, ac, 'Anweisung Tower');
    },
  },
  spd160: { label: '160 kt', air: true, spd: 160, valid: (s, ac) => spdValid(ac), run: (s, ac) => setSpeed(s, ac, 160) },
  spd180: { label: '180 kt', air: true, spd: 180, valid: (s, ac) => spdValid(ac), run: (s, ac) => setSpeed(s, ac, 180) },
  spd210: { label: '210 kt', air: true, spd: 210, valid: (s, ac) => spdValid(ac), run: (s, ac) => setSpeed(s, ac, 210) },
  spd250: { label: '250 kt', air: true, spd: 250, valid: (s, ac) => spdValid(ac) && ac.alt > 5500, run: (s, ac) => setSpeed(s, ac, 250) },
  taxiIn: {
    label: 'Rollen zur Position', key: 'R', big: true,
    valid: (s, ac) => (ac.phase === PH.VACATED || ac.phase === PH.ROLLOUT || ac.phase === PH.TAXI_WAIT) && !ac.clr.taxi && !ac.crossX,
    run: (s, ac) => {
      if (!ac.stand) return { ok: false, msg: 'Keine Parkposition zugewiesen (Vorfeld)' };
      ac.clr.taxi = true;
      ac.req = null;
      say(s, ac, `${tel(ac)}, taxi to stand ${ac.stand} via A and L.`, `Taxi stand ${ac.stand}, ${tel(ac)}.`);
      if (ac.phase === PH.VACATED || ac.phase === PH.TAXI_WAIT) startTaxiIn(s, ac);
    },
  },
  cross: {
    label: 'Bahn kreuzen & rollen', key: 'R', big: true,
    valid: (s, ac) => ac.phase === PH.VACATED && !!ac.crossX && !ac.clr.taxi && !!ac.stand && crossingSafe(s),
    run: (s, ac) => {
      ac.clr.taxi = true;
      ac.req = null;
      const rn = rwyName(s, 'N');
      say(s, ac, `${tel(ac)}, cross runway ${rn}, taxi to stand ${ac.stand} via A.`, `Crossing ${rn}, stand ${ac.stand}, ${tel(ac)}.`);
      startTaxiIn(s, ac);
    },
  },
  push: {
    label: 'Pushback frei', key: 'P', big: true,
    valid: (s, ac) => ac.phase === PH.STAND && ac.req === 'push',
    run: (s, ac) => {
      const face = s.rwy === '27' ? 'east' : 'west';
      say(s, ac, `${tel(ac)}, pushback and start-up approved, facing ${face}.`, `Pushback approved, ${tel(ac)}.`);
      startPushback(s, ac);
    },
  },
  startWait: {
    label: 'Warten bis TSAT', key: 'E',
    valid: (s, ac) => ac.phase === PH.STAND && ac.req === 'push' && s.rots[ac.rot] && s.rots[ac.rot].tsat > s.time + 150,
    run: (s, ac) => {
      const rot = s.rots[ac.rot];
      ac.req = null;
      ac.pushWaitUntil = rot.tsat - 90;
      say(s, ac, `${tel(ac)}, expect start-up at ${fmtClock(rot.tsat).replace(':', '')}, remain on stand.`, `Expect start-up ${fmtClock(rot.tsat).replace(':', '')}, ${tel(ac)}.`);
    },
  },
  taxiOut: {
    label: 'Rollen zum Rollhalt', key: 'R', big: true,
    valid: (s, ac) => (ac.phase === PH.STARTUP || ac.phase === PH.PUSH) && !ac.clr.taxiOut,
    run: (s, ac) => {
      ac.clr.taxiOut = true;
      ac.req = null;
      const nd = numTxt(s, ac, ' for departure');
      const rn = rwyName(s, 'N', ac.rwy);
      say(s, ac, `${tel(ac)}, taxi to holding point runway ${rn} via L and A${nd ? ', ' + nd.slice(0, -2) : ''}.`, `Taxi holding point ${rn}, ${tel(ac)}.`);
      if (ac.phase === PH.STARTUP && s.time - ac.startT > 55) startTaxiOut(s, ac);
    },
  },
  lineup: {
    label: 'Line up & wait', key: 'U',
    valid: (s, ac) => (ac.phase === PH.HOLDING || ac.phase === PH.TAXI_OUT) && !ac.clr.lineup && !ac.clr.takeoff && !runwayClosed(s),
    run: (s, ac) => {
      ac.clr.lineup = true;
      ac.req = null;
      const rn = rwyName(s, 'N', ac.rwy);
      say(s, ac, `${tel(ac)}, runway ${rn}, line up and wait.`, `Line up and wait ${rn}, ${tel(ac)}.`);
    },
  },
  takeoff: {
    label: 'Startfreigabe', key: 'T', big: true,
    valid: (s, ac) => [PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED].includes(ac.phase) && !ac.clr.takeoff && !runwayClosed(s),
    run: (s, ac) => {
      ac.clr.takeoff = true;
      ac.req = null;
      const rn = rwyName(s, 'N', ac.rwy);
      say(s, ac, `${tel(ac)}, runway ${rn}, cleared for take-off, ${windStr(s)}.`, `Cleared for take-off ${rn}, ${tel(ac)}.`);
    },
  },
  holdpos: {
    label: 'Halt!', key: 'X', danger: true,
    valid: (s, ac) => [PH.TAXI_IN, PH.TAXI_OUT].includes(ac.phase) && !ac.holdPos,
    run: (s, ac) => {
      ac.holdPos = true;
      say(s, ac, `${tel(ac)}, hold position.`, `Holding position, ${tel(ac)}.`);
    },
  },
  cont: {
    label: 'Weiterrollen', key: 'C',
    valid: (s, ac) => !!ac.holdPos,
    run: (s, ac) => {
      ac.holdPos = false;
      say(s, ac, `${tel(ac)}, continue taxi.`, `Continue, ${tel(ac)}.`);
    },
  },
};
function spdValid(ac) {
  return [PH.INBOUND, PH.HOLD].includes(ac.phase) || (ac.phase === PH.APPROACH && !onFinal(ac));
}
function setSpeed(s, ac, v) {
  ac.spdOverride = v;
  ac.spdManual = true; // Auto-Staffelung lässt dieses Flugzeug in Ruhe
  ac.autoSpd = false;
  const w = v < ac.spd ? 'reduce' : 'increase';
  say(s, ac, `${tel(ac)}, ${w} speed ${v} knots.`, `Speed ${v}, ${tel(ac)}.`);
}

export function command(state, ac, key) {
  const c = CMDS[key];
  if (!c || !c.valid(state, ac)) {
    const rc = runwayClosed(state, key === 'land' ? ac.strip || 'N' : 'N');
    if (key === 'cross' && ac.crossX && !crossingSafe(state)) return { ok: false, msg: `Bahn ${rwyName(state, 'N')} nicht frei – Kreuzen noch nicht möglich` };
    if (key === 'cross' && !ac.stand) return { ok: false, msg: 'Keine Parkposition zugewiesen (Vorfeld)' };
    return { ok: false, msg: rc && ['land', 'takeoff', 'lineup'].includes(key) ? `Piste gesperrt: ${rc}` : 'Befehl gerade nicht möglich' };
  }
  const r = c.run(state, ac);
  return r || { ok: true };
}
export function validCommands(state, ac) {
  return Object.keys(CMDS).filter((k) => CMDS[k].valid(state, ac));
}

// Hauptbefehl zu einer Anfrage (Karte, Bots): mit Auto-Staffelung wartet ein Start am Rollhalt, bis sein Startfenster offen ist –
// sonst landet der nächste Anflug auf eine belegte Piste und muss durchstarten
export const PRIMARY = { approach: ['approach'], land: ['land'], taxi_in: ['taxiIn'], push: ['push', 'startWait'], taxi_out: ['taxiOut'], takeoff: ['takeoff', 'lineup'], cross: ['cross'] };
export function primaryCommand(state, ac) {
  if (!ac.req) return null;
  if (ac.req === 'takeoff' && ac.phase !== PH.LINED && departureWait(state, ac).sec > 0) return null;
  // ohne Parkposition vom Vorfeld hat Rollen keinen Sinn
  if ((ac.req === 'taxi_in' || ac.req === 'cross') && !ac.stand) return null;
  // Anflugfreigaben verteilt die Auto-Staffelung selbst in der richtigen Reihenfolge
  if (ac.req === 'approach' && spacingOn(state)) return null;
  const valid = validCommands(state, ac);
  return (PRIMARY[ac.req] || []).find((x) => valid.includes(x)) || null;
}
// Kann ein Start vom Rollhalt jetzt sicher los? Sonst ungefähre Wartezeit (s) und Grund – wie beim automatischen Lotsen:
// Piste frei, nächste Landung weit genug weg, Wirbelschleppen-Abstand zum letzten Start
export function departureWait(state, ac) {
  const strip = ac.strip || 'N';
  const occ = runwayOccupants(state, strip).filter((o) => o !== ac);
  if (occ.length) return { sec: 30, why: `Piste belegt (${occ[0].cs})` };
  const arrs = state.acs.filter((a) => (a.phase === PH.APPROACH || a.phase === PH.FINAL) && a.rwy === state.rwy && (a.strip || 'N') === strip);
  let next = null, nd = 99;
  for (const a of arrs) {
    const d = distToLand(a);
    if (d < nd) {
      nd = d;
      next = a;
    }
  }
  // vom Rollhalt braucht ein Start gut 1½ Minuten, bis die Piste wieder frei ist
  const need = ac.phase === PH.LINED || ac.phase === PH.LINEUP ? 2.8 : 6;
  if (next && nd < need) return { sec: Math.round((nd / Math.max(120, next.spd || 140)) * 3600 + 45), why: `Landung ${next.cs} zuerst` };
  const gap = wakeDepSec(state.lastTakeoffWake, ac.wake) - (state.time - (state.lastTakeoff || -999)) - 20;
  if (gap > 0) return { sec: Math.round(gap), why: 'Wirbelschleppen-Abstand' };
  return { sec: 0, why: '' };
}

// ---------- Pistenrichtung ----------
export function tailwind(state, rwy) {
  const hdg = rwy === '27' ? 270 : 90;
  return -state.wind.spd * Math.cos(((state.wind.dir - hdg) * Math.PI) / 180);
}
export function preferredRunway(state) {
  return tailwind(state, '27') <= tailwind(state, '09') ? '27' : '09';
}
export function requestRunwayChange(state, to) {
  if (to === state.rwy) {
    state.rwyPending = null;
    return;
  }
  state.rwyPending = to;
  state.rwyPendingSince = state.time;
  log(state, 'sys', `Pistenwechsel auf ${to} angeordnet – laufende Bewegungen werden abgewickelt.`);
}
const DRAIN = new Set([PH.APPROACH, PH.FINAL, PH.ROLLOUT, PH.TAXI_IN, PH.PUSH, PH.STARTUP, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF, PH.MISSED]);
export function drainCount(state) {
  return state.acs.filter((a) => DRAIN.has(a.phase) && a.rwy === state.rwy && !(a.phase === PH.TAKEOFF && a.z > 1)).length;
}
function applyRunwayChange(state) {
  if (!state.rwyPending) return;
  if (drainCount(state) > 0) return;
  const to = state.rwyPending;
  state.rwy = to;
  state.rwyPending = null;
  for (const ac of state.acs) {
    if ([PH.INBOUND, PH.HOLD, PH.GOAROUND].includes(ac.phase) && ac.mode === 'air') {
      ac.rwy = to;
      if (ac.phase !== PH.GOAROUND) {
        ac.phase = PH.INBOUND;
        ac.holdFix = null;
        ac.route = AS.inboundRoute(ac.pos, to);
      }
    }
  }
  radio(state, 'TWR', `All stations, runway in use now ${to}, information ${String.fromCharCode(65 + (Math.floor(state.time / 3600) % 26))}.`, 'atc');
  notify(state, `🧭 Betriebsrichtung jetzt ${to}`, 'info');
}

// ---------- Automatischer Lotse ----------
function distToLand(ac) {
  if (ac.mode === 'map') return ac.phase === PH.FINAL ? 0.2 : 0;
  return AS.routeDistance(ac.pos, ac.route.length ? ac.route : [AS.THR[ac.rwy]]);
}

export function autoAtc(state, dt) {
  state.atcTimer = (state.atcTimer || 0) - dt;
  if (state.atcTimer > 0) return;
  state.atcTimer = 2;
  const groundOnly = !state.auto.atc; // Tower-Spieler mit Boden-Automatik
  if (!groundOnly) {
    const pref = preferredRunway(state);
    if (pref !== state.rwy && tailwind(state, state.rwy) > 5 && !state.rwyPending) requestRunwayChange(state, pref);
  }
  applyRunwayChange(state);
  updateRunway(state, 2);

  if (!groundOnly) {
    autoArrivals(state);
    autoDepartures(state);
  } else if (spacingOn(state)) towerSpacing(state);
  autoGround(state);
}

// Nächste Anflugfreigabe: Kandidaten in Reihenfolge (Notfälle und Treibstoffmangel zuerst),
// aus der Warteschleife immer der Unterste; Abstand zu bereits freigegebenen Anflügen derselben Bahn
function clearNextApproach(state, cands, distCleared, departuresWaiting, order = null) {
  const rwy = state.rwy;
  const nextStrip = stripForArrival(state);
  const lowestInStack = (c) => c.phase !== PH.HOLD || !cands.some((o) => o !== c && o.phase === PH.HOLD && o.holdFix && c.holdFix && o.holdFix.name === c.holdFix.name && o.alt < c.alt - 100);
  const scored = cands.filter(lowestInStack).map((c) => {
    // Flugzeuge oberhalb eines Stapels nicht durch den Stapel sinken lassen
    const below = state.acs.some((o) => o !== c && o.mode === 'air' && o.alt < c.alt - 300 && ((o.phase === PH.HOLD && Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) < 9) || (Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) < 6 && o.alt > 4500)));
    return { c, d: AS.routeDistance(c.pos, AS.approachRoute(c.pos, rwy)) + (below ? 50 : 0), blocked: below, o: order ? order.indexOf(c.id) : 0 };
  });
  const prio = (x) => (x.c.emergency ? 2 : 0) + (x.c.minFuel ? 1 : 0);
  scored.sort((x, y) => prio(y) - prio(x) || (order ? x.o - y.o : 0) || x.d - y.d);
  const next = scored[0];
  if (!next) return null;
  const c = next.c;
  if (next.blocked && !c.emergency) return null; // warten, bis der Stapel darunter frei ist
  if (c.emergency) {
    command(state, c, 'direct');
    return c;
  }
  for (const { a, d } of distCleared) {
    if ((a.strip || 'N') !== nextStrip) continue; // andere Bahn: unabhängig
    const lead = d < next.d ? a : c, foll = lead === a ? c : a;
    const fast = AC_TYPES[foll.type].vapp > AC_TYPES[lead.type].vapp + 12 ? 1.5 : 0;
    // Wirbelschleppen: Mehrabstand hinter schweren Flugzeugen
    let sep = 7 + fast + (wakeNm(lead.wake, foll.wake) - 3) * 1.3 + (state.weather.kind === 'fog' ? 2.5 : 0);
    if (departuresWaiting > 0) sep += 2.5;
    if (Math.abs(next.d - d) < sep) return null;
    if (next.d < d) return null; // nicht vordrängeln
  }
  command(state, c, 'approach');
  return c;
}

// ---------- Auto-Staffelung für den Tower-Spieler ----------
// Die Reihenfolge der Flugstreifen (Drag & Drop) bestimmt: Anflugfreigaben aus der Warteliste,
// Geschwindigkeiten im Anflug, Direktanflug für Vorgezogene und notfalls die Warteschleife.
export const spacingOn = (state) => !state.auto.atc && state.settings.autoSpacing !== false;
const V_NOM = 200; // mittlere Anfluggeschwindigkeit bis zur Schwelle (kt)

// geplante Zeiten je Bahn nach der Reihenfolge, mit Nenngeschwindigkeit gerechnet (schwingt nicht).
// Starts füllen Lücken: Sie verzögern eine Landung nur, wenn der Lotse einen von beiden bewusst
// verschoben hat (seqPin) oder der Start schon auf der Piste steht.
const ON_RWY = new Set([PH.LINEUP, PH.LINED, PH.TAKEOFF]);
export function spacingPlan(state) {
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  const plan = {};
  const lastArr = {}, lastDep = {}, lastAny = {};
  for (const id of state.seq || []) {
    const ac = byId.get(id);
    if (!ac) continue;
    const arr = isSeqArrival(ac);
    const st = seqStrip(ac);
    let eta;
    if (arr && ac.mode === 'air') eta = (distToLand(ac) / V_NOM) * 3600 + 60;
    else eta = Math.max(0, (state.seqSlots && state.seqSlots[id]) ?? 0);
    if (!arr) {
      const r = state.rots[ac.rot];
      if (r && r.ctot && !r.atd) eta = Math.max(eta, r.ctot - 300 - state.time);
    }
    let slot = eta;
    if (arr) {
      const la = lastArr[st], ld = lastDep[st];
      if (la) slot = Math.max(slot, la.t + sepSec(la.ac, ac, true, true));
      if (ld && (ld.ac.seqPin || ac.seqPin || ON_RWY.has(ld.ac.phase))) slot = Math.max(slot, ld.t + sepSec(ld.ac, ac, false, true));
      lastArr[st] = { ac, t: slot };
    } else {
      const la = lastAny[st];
      if (la) slot = Math.max(slot, la.t + sepSec(la.ac, ac, isSeqArrival(la.ac), false));
      lastDep[st] = { ac, t: slot };
    }
    lastAny[st] = { ac, t: slot };
    plan[id] = { eta, slot, delay: slot - eta, strip: st };
  }
  return plan;
}

function towerSpacing(state) {
  updateSequence(state);
  updateArrQueue(state);
  const plan = spacingPlan(state);
  state.spacing = plan;
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  // 1) Geschwindigkeit nach geplanter Pistenzeit, notfalls Warteschleife
  for (const id of state.seq) {
    const a = byId.get(id);
    const p = plan[id];
    if (!a || !p || !isSeqArrival(a) || a.mode !== 'air' || a.phase !== PH.APPROACH || onFinal(a) || a.emergency || a.spdManual) continue;
    const d = distToLand(a);
    const absorb160 = d * (1 / 160 - 1 / V_NOM) * 3600;
    const absorb180 = d * (1 / 180 - 1 / V_NOM) * 3600;
    // Vorgänger in der Folge liegt eigentlich hinter uns? -> Vorgänger direkt, wir notfalls in die Schleife
    if (p.delay > absorb160 + 75 && d > 10 && a.route.length > 2 && !a.minFuel && state.time - (a.clrAppT || 0) > 45) {
      command(state, a, 'hold');
      a.spdOverride = null;
      a.autoSpd = false;
      a.spacingDirect = false;
      a.spacingHold = true;
      a.spacingHoldUntil = state.time + 180;
      state.arrQ = [a.id, ...(state.arrQ || []).filter((x) => x !== a.id)];
      state.arrQManual = true;
      log(state, 'sys', `Staffelung: ${a.cs} kann die gewünschte Reihenfolge nur über die Warteschleife einhalten.`);
      continue;
    }
    const want = p.delay > absorb180 + 10 ? 160 : p.delay > 20 ? 180 : null;
    const cur = a.autoSpd ? a.spdOverride : null;
    if (want !== cur) {
      if (want) {
        a.spdOverride = want;
        a.autoSpd = true;
        say(state, a, `${tel(a)}, reduce speed ${want} knots for spacing.`, `Speed ${want}, ${tel(a)}.`);
      } else if (a.autoSpd) {
        a.spdOverride = null;
        a.autoSpd = false;
        say(state, a, `${tel(a)}, no speed restrictions.`, `No speed restrictions, ${tel(a)}.`);
      }
    }
  }
  // 2) Vorgezogene Anflüge: Direktanflug, wenn der Nachfolger laut Folge eigentlich näher an der Schwelle ist
  const seqArr = state.seq.map((id) => byId.get(id)).filter((a) => a && isSeqArrival(a) && a.mode === 'air');
  for (let i = 0; i < seqArr.length; i++) {
    const a = seqArr[i];
    if (a.phase !== PH.APPROACH || onFinal(a) || a.route.length <= 2 || a.spacingDirect) continue;
    const dA = distToLand(a);
    const behindButLater = seqArr.slice(i + 1).some((b) => (b.strip || 'N') === (a.strip || 'N') && distToLand(b) < dA - 1);
    if (behindButLater && CMDS.direct.valid(state, a)) {
      command(state, a, 'direct');
      a.spacingDirect = true;
    }
  }
  // 3) Anflugfreigabe für den nächsten aus der Warteliste (in der Reihenfolge der Flugstreifen)
  if (!state.rwyPending) {
    const rwy = state.rwy;
    const distCleared = state.acs.filter((a) => (a.phase === PH.APPROACH || a.phase === PH.FINAL) && a.rwy === rwy).map((a) => ({ a, d: distToLand(a) }));
    const cands = (state.arrQ || []).map((id) => byId.get(id)).filter((a) => a && [PH.INBOUND, PH.HOLD].includes(a.phase) && !(a.spacingHoldUntil > state.time));
    // Starts, die laut Folge vor der nächsten Landung dran sind, brauchen eine Lücke
    const deps = stripForArrival(state) === 'N' ? state.seq.filter((id) => { const a = byId.get(id); return a && isSeqDeparture(a); }).length : 0;
    clearNextApproach(state, cands, distCleared, deps, state.arrQ);
  }
}

function autoArrivals(state) {
  const rwy = state.rwy;
  const cleared = state.acs.filter((a) => (a.phase === PH.APPROACH || a.phase === PH.FINAL) && a.rwy === rwy);
  const distCleared = cleared.map((a) => ({ a, d: distToLand(a) }));
  const nextStrip = stripForArrival(state);
  // Starts belegen nur die Nordbahn: im getrennten Betrieb kein Zusatzabstand für Landungen auf der Südbahn
  const departuresWaiting = nextStrip === 'N' ? state.acs.filter((a) => [PH.HOLDING, PH.LINED, PH.LINEUP].includes(a.phase) || (a.phase === PH.TAXI_OUT && a.rwy === rwy)).length : 0;

  // Landefreigaben
  for (const { a, d } of distCleared) {
    if (a.clr.land) continue;
    if (a.phase === PH.APPROACH && !onFinal(a)) continue;
    if (d > 6) continue;
    const blk = runwayBlocker(state, a);
    const ok = !runwayClosed(state, a.strip || 'N') && (!blk || blk.phase === PH.TAKEOFF || (blk.phase === PH.ROLLOUT && d > 2.8));
    if (ok) command(state, a, 'land');
  }

  if (!state.rwyPending) {
    const cands = state.acs.filter((a) => [PH.INBOUND, PH.HOLD].includes(a.phase));
    clearNextApproach(state, cands, distCleared, departuresWaiting);
  }
  // Geschwindigkeit: Aufholen verhindern (einfach)
  for (const strip of ['N', 'S']) {
  const seq = distCleared.filter((x) => x.a.mode === 'air' && (x.a.strip || 'N') === strip).sort((x, y) => x.d - y.d);
  for (let i = 1; i < seq.length; i++) {
    const gap = seq[i].d - seq[i - 1].d;
    const f = seq[i].a;
    if (onFinal(f)) continue;
    const extra = wakeNm(seq[i - 1].a.wake, f.wake) - 3;
    if (gap < 6.2 + extra && f.spdOverride !== 160) f.spdOverride = 160;
    else if (gap > 8.5 + extra && f.spdOverride) f.spdOverride = null;
  }
  }
}

function autoDepartures(state) {
  const rwy = state.rwy;
  const occupants = runwayOccupants(state, 'N');
  const arrivals = state.acs.filter((a) => (a.phase === PH.APPROACH || a.phase === PH.FINAL) && a.rwy === rwy && (a.strip || 'N') === 'N');
  const nextArr = arrivals.reduce((m, a) => Math.min(m, distToLand(a)), 99);
  const lined = state.acs.find((a) => a.phase === PH.LINED || a.phase === PH.LINEUP);
  const sinceTo = state.time - (state.lastTakeoff || -999);
  if (runwayClosed(state)) return;
  if (lined && !lined.clr.takeoff) {
    const others = occupants.filter((o) => o !== lined);
    if (!others.length && nextArr > 2.6 && sinceTo > wakeDepSec(state.lastTakeoffWake, lined.wake) && slotOpen(state, lined)) command(state, lined, 'takeoff');
    return;
  }
  if (lined) return;
  // Wartende Kreuzungen haben Vorrang: dann keine neuen Starts
  if (state.acs.some((a) => a.phase === PH.VACATED && a.crossX && a.stand && state.time - (a.reqT || state.time) > 30)) return;
  // nur Flüge, deren Slot-Fenster offen ist; Slot-Flüge kurz vor Fensterende zuerst
  const key = (a) => {
    const r = state.rots[a.rot];
    return r && r.ctot && r.ctot + 600 - state.time < 480 ? a.reqT - 1e6 : a.reqT;
  };
  const queue = state.acs.filter((a) => a.phase === PH.HOLDING && a.rwy === rwy && slotOpen(state, a, 60)).sort((a, b) => key(a) - key(b));
  const head = queue[0];
  if (!head) return;
  const wakeGap = wakeDepSec(state.lastTakeoffWake, head.wake);
  if (!occupants.length && nextArr > 5.2 && sinceTo > wakeGap - 20) command(state, head, 'takeoff');
  else if (!occupants.length && nextArr > 4.4 && sinceTo > wakeGap - 30) command(state, head, 'lineup');
}

function autoGround(state) {
  const towerManualGround = !state.auto.atc && !state.settings.towerGroundAuto;
  if (towerManualGround) return;
  for (const ac of state.acs) {
    if (ac.phase === PH.VACATED && ac.crossX && ac.stand && !ac.clr.taxi) command(state, ac, 'cross');
    else if ((ac.phase === PH.VACATED || ac.phase === PH.TAXI_WAIT || (ac.phase === PH.ROLLOUT && ac.vacated)) && ac.stand && !ac.clr.taxi && !ac.crossX) command(state, ac, 'taxiIn');
    const rotP = state.rots[ac.rot];
    if (ac.phase === PH.STAND && ac.req === 'push' && rotP && rotP.tsat > state.time + 150) command(state, ac, 'startWait');
    if (ac.phase === PH.STAND && ac.req === 'push' && (!state.rwyPending || state.time - (state.rwyPendingSince || 0) < 600)) {
      const st = state.stands.find((s) => s.id === ac.stand);
      const endX = st ? st.x + (state.rwy === '27' ? -2 : 2) : ac.x;
      const busy = state.acs.some((o) => o !== ac && o.mode === 'map' && [PH.TAXI_IN, PH.TAXI_OUT, PH.PUSH, PH.STARTUP].includes(o.phase) && Math.abs(o.y - LY.LANE) < 1.5 && Math.abs(o.x - endX) < 5.5);
      if (!busy) command(state, ac, 'push');
    }
    if (ac.phase === PH.STARTUP && ac.req === 'taxi_out') command(state, ac, 'taxiOut');
  }
}

// ---------- Konfliktwarnung (STCA) & Radar-Lotse ----------
const TOWER_PH = new Set([PH.APPROACH, PH.GOAROUND]);
export function updateConflicts(state, dt) {
  state.stcaTimer = (state.stcaTimer || 0) - dt;
  if (state.stcaTimer > 0) return;
  state.stcaTimer = 1;
  const air = state.acs.filter((a) => a.mode === 'air' && a.alt > 700);
  // alle zurücksetzen – auch gelandete, sonst bleibt eine alte Warnung am Boden hängen
  for (const a of state.acs) {
    a.conflict = false;
    a.predConflict = false;
  }
  state.conflicts = [];
  state.pairPen = state.pairPen || {};
  for (let i = 0; i < air.length; i++) {
    for (let j = i + 1; j < air.length; j++) {
      const a = air[i], b = air[j];
      const h = dist(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
      const v = Math.abs(a.alt - b.alt);
      const bothFinal = onFinal(a) && onFinal(b);
      // Abflug vor einer Landung in gleicher Richtung: divergierend, kein Konflikt
      const depAhead = (d, f) => d.phase === PH.DEPART && d.alt < 4000 && onFinal(f) && (d.pos.x - f.pos.x) * -AS.appSide(f.rwy) > 0;
      if (depAhead(a, b) || depAhead(b, a)) continue;
      const hMin = bothFinal ? 2.5 : 3;
      const inConflict = h < hMin && v < 900;
      if (inConflict) {
        a.conflict = b.conflict = true;
        state.conflicts.push([a.id, b.id]);
        const towerResp = TOWER_PH.has(a.phase) || TOWER_PH.has(b.phase) || (a.phase === PH.DEPART && a.alt < 5000) || (b.phase === PH.DEPART && b.alt < 5000);
        const key = a.id < b.id ? a.id + b.id : b.id + a.id;
        if (towerResp && (!state.pairPen[key] || state.time - state.pairPen[key] > 300)) {
          state.pairPen[key] = state.time;
          const severe = h < 1 && v < 500;
          penalize(state, severe ? 'airprox' : 'separation', a);
          log(state, 'sys', `${severe ? 'AIRPROX' : 'Staffelungsunterschreitung'}: ${a.cs} / ${b.cs} (${h.toFixed(1)} NM, ${Math.round(v)} ft).`);
          notify(state, `🚨 ${severe ? 'AIRPROX' : 'Staffelung unterschritten'}: ${a.cs} / ${b.cs}`, 'bad');
        }
      }
      // Vorhersage 90 s für Radar-Lotsen (außerhalb Tower-Verantwortung)
      const pa = predict(a, 90), pb = predict(b, 90);
      const hp = dist(pa.x, pa.y, pb.x, pb.y);
      const vp = Math.abs(pa.alt - pb.alt);
      if ((hp < 4 && vp < 1000) || (h < 5 && v < 1000 && !bothFinal)) {
        a.predConflict = b.predConflict = true;
        if (!bothFinal) resolve(state, a, b);
      }
    }
  }
  checkWake(state);
  // Einschränkungen aufheben
  for (const a of air) {
    if (a.altRestr !== undefined && !a.predConflict) {
      a.restrClear = (a.restrClear || 0) + 1;
      if (a.restrClear > 45) {
        a.altRestr = undefined;
        a.restrClear = 0;
      }
    } else a.restrClear = 0;
  }
}

function predict(a, t) {
  const v = a.spd / 3600;
  const alt = a.alt + Math.sign(a.tAlt - a.alt) * Math.min(Math.abs(a.tAlt - a.alt), (a.phase === PH.DEPART ? 48 : 28) * t);
  return { x: a.pos.x + Math.sin((a.crs * Math.PI) / 180) * v * t, y: a.pos.y - Math.cos((a.crs * Math.PI) / 180) * v * t, alt };
}

function resolve(state, a, b) {
  // Tower-Verkehr im Endanflug nicht anfassen
  const preIp = (x) => x.phase === PH.APPROACH && x.route.length > 2;
  const movable = (x) => x.phase === PH.DEPART || x.phase === PH.INBOUND || x.phase === PH.GOAROUND || x.phase === PH.HOLD || preIp(x);
  const lower = a.alt <= b.alt ? a : b;
  const upper = lower === a ? b : a;
  if (lower.phase === PH.DEPART && movable(lower)) {
    lower.altRestr = Math.max(3000, Math.floor((upper.alt - 1200) / 1000) * 1000);
    if (lower.altRestr > lower.alt + 200) lower.altRestr = Math.floor(lower.alt / 1000) * 1000;
  } else if (upper.phase !== PH.DEPART && movable(upper) && upper.phase !== PH.HOLD) {
    upper.altRestr = Math.max(upper.alt, Math.ceil((lower.alt + 1200) / 1000) * 1000);
  } else if (movable(lower) && lower.phase !== PH.HOLD) {
    lower.altRestr = Math.max(3000, Math.floor((upper.alt - 1200) / 1000) * 1000);
  }
}

// Wirbelschleppen-Staffelung im Endanflug prüfen (Folgeflugzeug zu dicht hinter schwerem Vorausfliegenden)
function checkWake(state) {
  const fin = state.acs
    .filter((a) => (a.mode === 'air' && onFinal(a)) || (a.mode === 'map' && a.phase === PH.FINAL))
    .map((a) => ({ a, d: a.mode === 'air' ? AS.distToThr(a.pos, a.rwy) : Math.max(0, (LY.RWY.thr[a.rwy] - a.x) * LY.rwyDir(a.rwy)) * 0.0108 }))
    .sort((x, y) => x.d - y.d);
  state.wakePen = state.wakePen || {};
  for (const { a } of fin) a.wakeWarn = false;
  for (let i = 1; i < fin.length; i++) {
    const foll = fin[i];
    let j = i - 1;
    while (j >= 0 && (fin[j].a.strip || 'N') !== (foll.a.strip || 'N')) j--;
    if (j < 0) continue;
    const lead = fin[j];
    const req = wakeNm(lead.a.wake, foll.a.wake);
    if (req <= 3 || foll.a.mode !== 'air') continue;
    const gap = foll.d - lead.d;
    foll.a.wakeReq = req;
    if (gap < req - 0.3) {
      foll.a.wakeWarn = true;
      const key = lead.a.id + foll.a.id;
      if (!state.wakePen[key]) {
        state.wakePen[key] = state.time;
        state.stats.today.wakeInf = (state.stats.today.wakeInf || 0) + 1;
        foll.a.wakeBad = true;
        penalize(state, 'wake', foll.a);
        log(state, 'sys', `Wirbelschleppen-Staffelung unterschritten: ${foll.a.cs} (${foll.a.wake}) nur ${gap.toFixed(1)} NM hinter ${lead.a.cs} (${lead.a.wake}) – Soll ${req} NM.`);
        notify(state, `🌀 Wirbelschleppe: ${foll.a.cs} zu dicht hinter ${lead.a.cs} (${gap.toFixed(1)} statt ${req} NM)`, 'warn');
      }
    }
  }
}
