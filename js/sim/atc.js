// Flugsicherung: Befehle, automatischer Lotse, Konfliktwarnung, Pistenwechsel
import { AC_TYPES } from '../config.js';
import { dist, degNorm } from '../util.js';
import * as AS from './airspace.js';
import * as LY from '../layout.js';
import { PH, tel, windStr, goAround, startTaxiIn, startPushback, startTaxiOut, startLineUp, runwayBlocker, runwayOccupants, setReq, fmtAlt } from './aircraft.js';
import { radio, log, notify } from './messages.js';
import { penalize } from './economy.js';

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
      ac.route = AS.approachRoute(ac.pos, ac.rwy);
      ac.phase = PH.APPROACH;
      ac.holdFix = null;
      ac.clr.app = true;
      ac.req = null;
      ac.altRestr = undefined;
      say(s, ac, `${tel(ac)}, cleared ILS approach runway ${ac.rwy}, descend 5000 feet.`, `Cleared ILS ${ac.rwy}, ${tel(ac)}.`);
    },
  },
  direct: {
    label: 'Direkt FAF', key: 'D', air: true,
    valid: (s, ac) => [PH.INBOUND, PH.HOLD].includes(ac.phase) || (ac.phase === PH.APPROACH && !onFinal(ac) && ac.route.length > 2),
    run: (s, ac) => {
      ac.rwy = s.rwy;
      ac.route = AS.directRoute(ac.pos, ac.rwy);
      ac.phase = PH.APPROACH;
      ac.holdFix = null;
      ac.clr.app = true;
      ac.req = null;
      ac.altRestr = undefined;
      say(s, ac, `${tel(ac)}, turn direct final approach fix, cleared ILS runway ${ac.rwy}.`, `Direct FAF, cleared ILS ${ac.rwy}, ${tel(ac)}.`);
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
    valid: (s, ac) => (ac.phase === PH.APPROACH || ac.phase === PH.FINAL) && !ac.clr.land,
    run: (s, ac) => {
      ac.clr.land = true;
      ac.clr.landGivenBlocked = !!runwayBlocker(s, ac) && !(runwayBlocker(s, ac).phase === PH.TAKEOFF);
      ac.req = null;
      say(s, ac, `${tel(ac)}, runway ${ac.rwy}, cleared to land, ${windStr(s)}.`, `Cleared to land ${ac.rwy}, ${tel(ac)}.`);
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
    valid: (s, ac) => (ac.phase === PH.VACATED || ac.phase === PH.ROLLOUT || ac.phase === PH.TAXI_WAIT) && !ac.clr.taxi,
    run: (s, ac) => {
      if (!ac.stand) return { ok: false, msg: 'Keine Parkposition zugewiesen (Vorfeld)' };
      ac.clr.taxi = true;
      ac.req = null;
      say(s, ac, `${tel(ac)}, taxi to stand ${ac.stand} via A and L.`, `Taxi stand ${ac.stand}, ${tel(ac)}.`);
      if (ac.phase === PH.VACATED || ac.phase === PH.TAXI_WAIT) startTaxiIn(s, ac);
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
  taxiOut: {
    label: 'Rollen zum Rollhalt', key: 'R', big: true,
    valid: (s, ac) => (ac.phase === PH.STARTUP || ac.phase === PH.PUSH) && !ac.clr.taxiOut,
    run: (s, ac) => {
      ac.clr.taxiOut = true;
      ac.req = null;
      say(s, ac, `${tel(ac)}, taxi to holding point runway ${ac.rwy} via L and A.`, `Taxi holding point ${ac.rwy}, ${tel(ac)}.`);
      if (ac.phase === PH.STARTUP && s.time - ac.startT > 55) startTaxiOut(s, ac);
    },
  },
  lineup: {
    label: 'Line up & wait', key: 'U',
    valid: (s, ac) => (ac.phase === PH.HOLDING || ac.phase === PH.TAXI_OUT) && !ac.clr.lineup && !ac.clr.takeoff,
    run: (s, ac) => {
      ac.clr.lineup = true;
      ac.req = null;
      say(s, ac, `${tel(ac)}, runway ${ac.rwy}, line up and wait.`, `Line up and wait ${ac.rwy}, ${tel(ac)}.`);
    },
  },
  takeoff: {
    label: 'Startfreigabe', key: 'T', big: true,
    valid: (s, ac) => [PH.HOLDING, PH.LINEUP, PH.LINED].includes(ac.phase) && !ac.clr.takeoff,
    run: (s, ac) => {
      ac.clr.takeoff = true;
      ac.req = null;
      say(s, ac, `${tel(ac)}, runway ${ac.rwy}, cleared for take-off, ${windStr(s)}.`, `Cleared for take-off ${ac.rwy}, ${tel(ac)}.`);
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
  const w = v < ac.spd ? 'reduce' : 'increase';
  say(s, ac, `${tel(ac)}, ${w} speed ${v} knots.`, `Speed ${v}, ${tel(ac)}.`);
}

export function command(state, ac, key) {
  const c = CMDS[key];
  if (!c || !c.valid(state, ac)) return { ok: false, msg: 'Befehl gerade nicht möglich' };
  const r = c.run(state, ac);
  return r || { ok: true };
}
export function validCommands(state, ac) {
  return Object.keys(CMDS).filter((k) => CMDS[k].valid(state, ac));
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

  if (!groundOnly) {
    autoArrivals(state);
    autoDepartures(state);
  }
  autoGround(state);
}

function autoArrivals(state) {
  const rwy = state.rwy;
  const cleared = state.acs.filter((a) => (a.phase === PH.APPROACH || a.phase === PH.FINAL) && a.rwy === rwy);
  const distCleared = cleared.map((a) => ({ a, d: distToLand(a) }));
  const departuresWaiting = state.acs.filter((a) => [PH.HOLDING, PH.LINED, PH.LINEUP].includes(a.phase) || (a.phase === PH.TAXI_OUT && a.rwy === rwy)).length;

  // Landefreigaben
  for (const { a, d } of distCleared) {
    if (a.clr.land) continue;
    if (a.phase === PH.APPROACH && !onFinal(a)) continue;
    if (d > 6) continue;
    const blk = runwayBlocker(state, a);
    const ok = !blk || blk.phase === PH.TAKEOFF || (blk.phase === PH.ROLLOUT && d > 2.8);
    if (ok) command(state, a, 'land');
  }

  if (!state.rwyPending) {
    // Sequenzierung: nächster Kandidat
    const cands = state.acs.filter((a) => [PH.INBOUND, PH.HOLD].includes(a.phase));
    // In der Warteschleife verlässt immer der Unterste zuerst den Stapel
    const lowestInStack = (c) => c.phase !== PH.HOLD || !cands.some((o) => o !== c && o.phase === PH.HOLD && o.holdFix && c.holdFix && o.holdFix.name === c.holdFix.name && o.alt < c.alt - 100);
    const scored = cands.filter(lowestInStack).map((c) => {
      // Flugzeuge oberhalb eines Stapels nicht durch den Stapel sinken lassen
      const below = state.acs.some((o) => o !== c && o.phase === PH.HOLD && o.alt < c.alt - 300 && Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) < 9);
      return { c, d: AS.routeDistance(c.pos, AS.approachRoute(c.pos, rwy)) + (below ? 50 : 0), blocked: below };
    });
    scored.sort((x, y) => (y.c.emergency ? 1 : 0) - (x.c.emergency ? 1 : 0) || x.d - y.d);
    const next = scored[0];
    if (next) {
      const c = next.c;
      if (next.blocked && !c.emergency) {
        // warten, bis der Stapel darunter frei ist
      } else if (c.emergency) command(state, c, 'direct');
      else {
        let ok = true;
        for (const { a, d } of distCleared) {
          const leaderHeavy = (d < next.d ? a.wake : c.wake) === 'H';
          const followerHeavy = (d < next.d ? c.wake : a.wake) === 'H';
          const lead = d < next.d ? a : c, foll = lead === a ? c : a;
          const fast = AC_TYPES[foll.type].vapp > AC_TYPES[lead.type].vapp + 12 ? 1.5 : 0;
          let sep = 7 + fast + (leaderHeavy && !followerHeavy ? 2 : 0);
          if (departuresWaiting > 0) sep += 2.5;
          if (Math.abs(next.d - d) < sep) ok = false;
          if (next.d < d) ok = false; // nicht vordrängeln
        }
        if (ok) command(state, c, 'approach');
      }
    }
  }
  // Geschwindigkeit: Aufholen verhindern (einfach)
  const seq = distCleared.filter((x) => x.a.mode === 'air').sort((x, y) => x.d - y.d);
  for (let i = 1; i < seq.length; i++) {
    const gap = seq[i].d - seq[i - 1].d;
    const f = seq[i].a;
    if (onFinal(f)) continue;
    if (gap < 6.2 && f.spdOverride !== 160) f.spdOverride = 160;
    else if (gap > 8.5 && f.spdOverride) f.spdOverride = null;
  }
}

function autoDepartures(state) {
  const rwy = state.rwy;
  const occupants = runwayOccupants(state);
  const arrivals = state.acs.filter((a) => (a.phase === PH.APPROACH || a.phase === PH.FINAL) && a.rwy === rwy);
  const nextArr = arrivals.reduce((m, a) => Math.min(m, distToLand(a)), 99);
  const lined = state.acs.find((a) => a.phase === PH.LINED || a.phase === PH.LINEUP);
  const sinceTo = state.time - (state.lastTakeoff || -999);
  const wakeGap = state.lastTakeoffWake === 'H' ? 110 : 75;
  if (lined && !lined.clr.takeoff) {
    const others = occupants.filter((o) => o !== lined);
    if (!others.length && nextArr > 2.6 && sinceTo > wakeGap) command(state, lined, 'takeoff');
    return;
  }
  if (lined) return;
  const queue = state.acs.filter((a) => a.phase === PH.HOLDING && a.rwy === rwy).sort((a, b) => a.reqT - b.reqT);
  const head = queue[0];
  if (!head) return;
  if (!occupants.length && nextArr > 5.2 && sinceTo > wakeGap - 20) command(state, head, 'takeoff');
  else if (!occupants.length && nextArr > 4.4 && sinceTo > wakeGap - 30) command(state, head, 'lineup');
}

function autoGround(state) {
  const towerManualGround = !state.auto.atc && !state.settings.towerGroundAuto;
  if (towerManualGround) return;
  for (const ac of state.acs) {
    if ((ac.phase === PH.VACATED || ac.phase === PH.TAXI_WAIT || (ac.phase === PH.ROLLOUT && ac.vacated)) && ac.stand && !ac.clr.taxi) command(state, ac, 'taxiIn');
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
  for (const a of air) {
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
  const movable = (x) => x.phase === PH.DEPART || x.phase === PH.INBOUND || x.phase === PH.GOAROUND || x.phase === PH.HOLD;
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
