// Flugzeuge: Lebenszyklus, Navigation im Luftraum, Bewegung auf der Karte
import { AC_TYPES, AIRLINES, CITIES, AIRPORT } from '../config.js';
import { clamp, dist, degDiff, degNorm, DEG, rand, randInt, randRange, angNorm, pathLength } from '../util.js';
import * as LY from '../layout.js';
import * as AS from './airspace.js';
import { radio, log, notify } from './messages.js';
import { nextId } from './schedule.js';
import { onBlock, onPushbackStart, onPushbackDone, assignStandAuto } from './ground.js';
import { onLanding, onTakeoff, penalize } from './economy.js';
import { slotOpen, acdmOnTakeoff } from './acdm.js';
import { wakeDepSec } from './wake.js';
import { runwayClosed, decelFactor, onRunwayLanding, brakingAction, stripGeom, rwyName } from './runway.js';

export const PH = {
  INBOUND: 'ARR_INBOUND', HOLD: 'ARR_HOLD', APPROACH: 'ARR_APPROACH', GOAROUND: 'GO_AROUND',
  FINAL: 'FINAL', ROLLOUT: 'ROLLOUT', VACATED: 'VACATED', TAXI_WAIT: 'TAXI_WAIT', TAXI_IN: 'TAXI_IN', STAND: 'AT_STAND',
  PUSH: 'PUSHBACK', STARTUP: 'STARTUP', TAXI_OUT: 'TAXI_OUT', HOLDING: 'HOLDING', LINEUP: 'LINEUP',
  LINED: 'LINED_UP', TAKEOFF: 'TAKEOFF', MISSED: 'MISSED', DEPART: 'DEPARTURE', GONE: 'GONE',
};
export const PHASE_DE = {
  ARR_INBOUND: 'Im Anflug', ARR_HOLD: 'Warteschleife', ARR_APPROACH: 'Anflug frei', GO_AROUND: 'Durchstarten',
  FINAL: 'Endanflug', ROLLOUT: 'Ausrollen', VACATED: 'Wartet auf Rollfreigabe', TAXI_WAIT: 'Rollt zur Warteposition', TAXI_IN: 'Rollt zur Position', AT_STAND: 'Abfertigung',
  PUSHBACK: 'Pushback', STARTUP: 'Triebwerksstart', TAXI_OUT: 'Rollt zum Rollhalt', HOLDING: 'Am Rollhalt', LINEUP: 'Rollt auf die Piste',
  LINED_UP: 'Aufgestellt', TAKEOFF: 'Startlauf', MISSED: 'Fehlanflug', DEPARTURE: 'Abflug', GONE: '—',
};
export const AIR_PHASES = new Set([PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND, PH.DEPART]);
export const RWY_PHASES = new Set([PH.ROLLOUT, PH.LINEUP, PH.LINED, PH.TAKEOFF]);

export function tel(ac) {
  const al = AIRLINES[ac.airline];
  return `${al.tel} ${ac.cs.replace(/^[A-Z]+/, '')}`;
}
const ATIS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const atisName = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];
export const atis = (state) => atisName[Math.floor(state.time / 3600) % 26];
export const windStr = (state) => `wind ${String(Math.round(state.wind.dir / 10) * 10).padStart(3, '0')} degrees ${Math.round(state.wind.spd)} knots`;

export function getRot(state, ac) {
  return state.rots[ac.rot];
}

// ---------------- Erzeugen ----------------
export function spawnArrival(state, rot) {
  const t = AC_TYPES[rot.type];
  const brg = CITIES[rot.city].brg + randRange(state, -10, 10);
  const pos = AS.spawnPoint(brg);
  const rwy = state.rwy;
  let alt = 13000 + randInt(state, 0, 3) * 1000;
  // Einflug-Staffelung: nicht in der Nähe anderer Flugzeuge erzeugen
  const near = (al) => state.acs.some((o) => o.mode === 'air' && Math.hypot(o.pos.x - pos.x, o.pos.y - pos.y) < 12 && Math.abs(o.alt - al) < 2500);
  if (near(alt)) {
    const alt2 = alt >= 15000 ? alt - 4000 : alt + 4000;
    if (near(alt2)) return null;
    alt = alt2;
  }
  const ac = makeAircraft(state, rot, { pos, alt, crs: degNorm(brg + 180), route: AS.inboundRoute(pos, rwy) });
  rot.ac = ac.id;
  rot.status = 'inbound';
  state.acs.push(ac);
  radio(state, ac.cs, `${AIRPORT.name.split(' ')[0]} Approach, ${tel(ac)}, FL${Math.round(alt / 100)}, information ${atis(state)}.`);
  if (state.auto.ground || state.settings.standAuto) assignStandAuto(state, ac);
  return ac;
}

// Flugzeug steht bereits an einer Position (Spielstart: Morgenwelle)
export function placeAtStand(state, rot, stand) {
  const t = AC_TYPES[rot.type];
  const ac = makeAircraft(state, rot, {});
  ac.mode = 'map';
  ac.phase = PH.STAND;
  ac.x = stand.x;
  ac.y = LY.STAND_NOSE + t.len / 2;
  ac.hdg = -Math.PI / 2;
  ac.stand = stand.id;
  ac.engines = false;
  rot.ac = ac.id;
  state.acs.push(ac);
  stand.bridge = stand.kind === 'contact' ? 1 : 0;
  onBlock(state, ac);
  return ac;
}

function makeAircraft(state, rot, o) {
  const t = AC_TYPES[rot.type];
  const rwy = state.rwy;
  const ac = {
    id: nextId(state, 'a'),
    rot: rot.id,
    cs: rot.arrNo,
    type: rot.type,
    airline: rot.airline,
    len: t.len,
    wake: t.wake,
    mode: 'air',
    phase: PH.INBOUND,
    rwy,
    pos: o.pos || { x: 0, y: 0 },
    alt: o.alt || 0,
    crs: o.crs || 0,
    spd: 280,
    tSpd: 250,
    tAlt: o.alt || 0,
    route: o.route || [],
    holdFix: null,
    holdIdx: 0,
    clr: {},
    req: null,
    reqT: 0,
    x: 0, y: 0, z: 0, hdg: 0, v: 0,
    path: null, pi: 0, rev: false,
    stand: null,
    ta: null,
    trail: [],
    squawk: String(randInt(state, 1, 7)) + String(randInt(state, 0, 7)) + String(randInt(state, 0, 7)) + String(randInt(state, 0, 7)),
    emergency: false,
    created: state.time,
    blockedBy: null, blockedT: 0, ghostUntil: 0,
    engines: true,
    arr: true,
    // Treibstoff für Anflug + Reserve in Minuten (Warteschleifen zehren daran)
    fuelMin: 16 + randRange(state, 28, 50) + (t.size === 'L' ? 8 : 0),
  };
  return ac;
}

// Zusätzliches Flugzeug (VIP / Notfall) ohne Vertrag
export function spawnSpecial(state, opts) {
  const rot = {
    id: nextId(state, 'r'),
    contract: null,
    airline: opts.airline,
    type: opts.type,
    arrNo: opts.arrNo,
    depNo: opts.depNo,
    city: opts.city,
    sta: state.time + 20 * 60,
    std: state.time + (20 + AC_TYPES[opts.type].turn + 20) * 60,
    arrDelay: 0,
    paxIn: opts.pax ?? AC_TYPES[opts.type].pax,
    paxOut: opts.pax ?? AC_TYPES[opts.type].pax,
    cargoIn: 0,
    cargoOut: 0,
    status: 'planned',
    spawnAt: state.time,
    special: opts.special || null,
    feeMult: opts.feeMult || 1,
  };
  state.rots[rot.id] = rot;
  const ac = spawnArrival(state, rot);
  if (opts.emergency) {
    ac.emergency = true;
    ac.squawk = '7700';
  }
  return ac;
}

// Startfreigabe vor dem Slot-Fenster: Pilot wartet
function holdForSlot(state, ac) {
  if (ac.slotCall) return;
  ac.slotCall = true;
  const rot = getRot(state, ac);
  if (rot && rot.ctot) radio(state, ac.cs, `${tel(ac)}, our slot is ${String(Math.floor((rot.ctot % 86400) / 3600)).padStart(2, '0')}${String(Math.floor((rot.ctot % 3600) / 60)).padStart(2, '0')}, we'll wait for the slot window.`);
}

export function setReq(state, ac, req) {
  if (ac.req !== req) {
    ac.req = req;
    ac.reqT = state.time;
  }
}

// ---------------- Laufzeit ----------------
export function updateAircraft(state, dt) {
  for (const ac of state.acs) {
    if (ac.mode === 'air') updateAir(state, ac, dt);
    else updateMap(state, ac, dt);
  }
  // entfernen
  if (state.acs.some((a) => a.phase === PH.GONE)) state.acs = state.acs.filter((a) => a.phase !== PH.GONE);
  resolveDeadlocks(state, dt);
}

// Stapelhöhe am Fix: belegte und reservierte Höhen sowie gerade abfliegende Maschinen meiden
export function holdingAltitude(state, ac, fix) {
  const used = new Set();
  let floor = 7000;
  for (const o of state.acs) {
    if (o === ac || o.mode !== 'air') continue;
    if (o.phase === PH.HOLD && o.holdFix && o.holdFix.name === fix.name) used.add(o.tAlt);
    else if (o.stackFix === fix.name && o.stackAlt) used.add(o.stackAlt);
    else if (Math.hypot(o.pos.x - fix.x, o.pos.y - fix.y) < 10 && o.alt > 5200) floor = Math.max(floor, Math.ceil((o.alt + 1000) / 1000) * 1000);
  }
  for (let a = floor; a <= 15000; a += 1000) if (!used.has(a)) return a;
  return 16000;
}

function enterHold(state, ac, fix) {
  ac.phase = PH.HOLD;
  ac.holdFix = { name: fix.name, x: fix.x, y: fix.y };
  ac.holdIdx = 1;
  ac.holdStart = state.time;
  ac.tAlt = ac.stackFix === fix.name && ac.stackAlt ? ac.stackAlt : holdingAltitude(state, ac, fix);
  ac.stackFix = null;
  ac.stackAlt = null;
  ac.tSpd = 220;
  ac.route = [];
  radio(state, ac.cs, `${tel(ac)}, entering hold at ${fix.name}, ${fmtAlt(ac.tAlt)}.`);
  setReq(state, ac, 'approach');
}

export const fmtAlt = (a) => (a >= 10000 ? `FL${Math.round(a / 100)}` : `${Math.round(a / 100) * 100} feet`);

// Treibstoffreserve der Ankünfte: MINIMUM FUEL -> MAYDAY FUEL -> Ausweichen
function updateFuel(state, ac, dt) {
  if (!ac.arr || ac.fuelMin === undefined || ![PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND].includes(ac.phase)) return false;
  ac.fuelMin -= dt / 60;
  if (ac.fuelMin <= 12 && !ac.minFuel) {
    ac.minFuel = true;
    radio(state, ac.cs, `${tel(ac)}, declaring minimum fuel.`);
    notify(state, `⛽ ${ac.cs}: MINIMUM FUEL – bald Anflug freigeben`, 'warn');
    log(state, 'sys', `${ac.cs} meldet Minimum Fuel (noch ca. ${Math.round(ac.fuelMin)} min Reserve).`);
    state.stats.today.minFuel = (state.stats.today.minFuel || 0) + 1;
  }
  if (ac.fuelMin <= 5 && !ac.fuelEmergency) {
    ac.fuelEmergency = true;
    ac.emergency = true;
    ac.squawk = '7700';
    radio(state, ac.cs, `MAYDAY MAYDAY MAYDAY, ${tel(ac)}, fuel emergency, request immediate approach.`);
    notify(state, `🚨 ${ac.cs}: MAYDAY FUEL – sofort landen lassen!`, 'bad');
    penalize(state, 'fuelEmergency', ac);
    state.fireAlert = state.fireAlert || { ac: ac.id, t: state.time };
  }
  if (ac.fuelMin <= 0 && (ac.phase === PH.HOLD || ac.phase === PH.INBOUND)) {
    divert(state, ac, 'Treibstoffmangel');
    return true;
  }
  return false;
}

function updateAir(state, ac, dt) {
  if (updateFuel(state, ac, dt)) return;
  // Ziel bestimmen
  let tgt = null;
  let localizer = false;
  if (ac.holdFix) {
    const pat = AS.holdPattern(ac.holdFix);
    tgt = pat[ac.holdIdx % pat.length];
    if (dist(ac.pos.x, ac.pos.y, tgt.x, tgt.y) < 1.1) ac.holdIdx++;
  } else if (ac.route.length) {
    tgt = ac.route[0];
    if (ac.phase === PH.APPROACH && tgt.thr) {
      // Landekurssender: Punkt voraus auf der Achse
      const d = AS.distToThr(ac.pos, ac.rwy);
      tgt = { x: AS.THR[ac.rwy].x + AS.appSide(ac.rwy) * Math.max(-1, d - 1.3), y: 0 };
      localizer = true;
    }
  }
  if (tgt) {
    const want = AS.crsTo(ac.pos, tgt);
    const diff = degDiff(ac.crs, want);
    const rate = (ac.phase === PH.APPROACH && localizer ? 4 : 3) * dt;
    ac.crs = degNorm(ac.crs + clamp(diff, -rate, rate));
    if (!ac.holdFix && !localizer && ac.route.length) {
      const w = ac.route[0];
      const d = dist(ac.pos.x, ac.pos.y, w.x, w.y);
      let lead = 0.4;
      if (ac.route[1] && !ac.route[1].thr) {
        const turn = Math.abs(degDiff(AS.crsTo(w, ac.route[1]), AS.crsTo(ac.pos, w)));
        const R = ac.spd / 188.5;
        lead = Math.min(3, R * Math.tan((Math.min(turn, 120) * DEG) / 2)) + 0.25;
      } else if (w.faf) lead = 0.6;
      if (d < lead || d < (ac.spd / 3600) * dt * 1.5) passWaypoint(state, ac, w);
    }
  }

  // Geschwindigkeit & Höhe je Phase
  if (ac.phase === PH.APPROACH) {
    const r0 = ac.route[0];
    const onFinal = r0 && r0.thr;
    const beforeFaf = r0 && r0.faf;
    const t = AC_TYPES[ac.type];
    if (onFinal) {
      const d = AS.distToThr(ac.pos, ac.rwy);
      ac.tSpd = d < 5 ? t.vapp : Math.max(t.vapp, 170);
      const g = AS.glideAlt(d);
      ac.tAlt = g;
      if (ac.alt > g) ac.alt = Math.max(g, ac.alt - 60 * dt);
      if (ac.alt < g - 200) ac.alt = g - 200;
      // Landefreigabe-Anfrage
      if (!ac.clr.land && d < 9) setReq(state, ac, 'land');
      if (!ac.clr.land && d <= 1.0) {
        goAround(state, ac, 'keine Landefreigabe');
        return;
      }
      if (d <= AS.MAP_FINAL_NM) {
        toMapFinal(state, ac);
        return;
      }
    } else {
      ac.tSpd = ac.spdOverride || (beforeFaf ? 180 : 210);
      if (beforeFaf) ac.altRestr = undefined;
      ac.tAlt = Math.max(beforeFaf ? 3000 : 5000, ac.altRestr ?? 0);
    }
  } else if (ac.phase === PH.INBOUND) {
    const nextIaf = ac.route.length && ac.route[0].iaf;
    // Stapelhöhe reservieren, sobald der Fix näher kommt
    if (nextIaf && !ac.stackAlt && Math.hypot(ac.route[0].x - ac.pos.x, ac.route[0].y - ac.pos.y) < 22) {
      ac.stackAlt = holdingAltitude(state, ac, ac.route[0]);
      ac.stackFix = ac.route[0].name;
    }
    if (!nextIaf) ac.stackAlt = ac.stackFix = null;
    ac.tAlt = ac.altRestr ?? (nextIaf ? ac.stackAlt || 9000 : 13000);
    ac.tSpd = ac.spdOverride || (ac.alt > 10500 ? 280 : 250);
  } else if (ac.phase === PH.HOLD) {
    ac.tSpd = ac.spdOverride || 220;
  } else if (ac.phase === PH.GOAROUND) {
    ac.tSpd = 210;
    ac.tAlt = ac.altRestr ?? 4000;
  } else if (ac.phase === PH.DEPART) {
    ac.tAlt = ac.altRestr ?? 24000;
    ac.tSpd = ac.alt < 10000 ? 250 : 300;
    if (Math.hypot(ac.pos.x, ac.pos.y) > AS.RADAR_RANGE + 2 || !ac.route.length) {
      ac.phase = PH.GONE;
      return;
    }
  }

  // Beschleunigen / Steigen / Sinken
  const aRate = 1.6 * dt;
  ac.spd += clamp(ac.tSpd - ac.spd, -aRate, aRate);
  const onGlide = ac.phase === PH.APPROACH && ac.route[0] && ac.route[0].thr;
  if (!onGlide) {
    const vs = ac.tAlt > ac.alt ? (ac.phase === PH.DEPART ? 48 : 30) : 28; // ft/s
    ac.alt += clamp(ac.tAlt - ac.alt, -vs * dt, vs * dt);
  }
  const v = ac.spd / 3600;
  ac.pos.x += Math.sin(ac.crs * DEG) * v * dt;
  ac.pos.y -= Math.cos(ac.crs * DEG) * v * dt;

  // Spur für Radar
  ac.trailT = (ac.trailT || 0) + dt;
  if (ac.trailT > 12) {
    ac.trailT = 0;
    ac.trail.push({ x: ac.pos.x, y: ac.pos.y });
    if (ac.trail.length > 6) ac.trail.shift();
  }
}

function passWaypoint(state, ac, w) {
  ac.route.shift();
  if (w.iaf && ac.phase === PH.INBOUND) {
    enterHold(state, ac, w);
  } else if (w.faf && ac.phase === PH.APPROACH) {
    radio(state, ac.cs, `${tel(ac)}, established ILS runway ${rwyName(state, ac.strip || 'N', ac.rwy)}${ac.clr.land ? '' : ', request landing'}.`);
    if (!ac.clr.land) setReq(state, ac, 'land');
  } else if (w.exit && ac.phase === PH.DEPART) {
    ac.phase = PH.GONE;
  } else if (w.missedEnd && ac.phase === PH.GOAROUND) {
    // nach Fehlanflug: zum IAF
    const fix = AS.FIXES[state.rwy][AS.sideOf(ac.pos)];
    ac.rwy = state.rwy;
    ac.phase = PH.INBOUND;
    ac.route = [{ x: fix.x, y: fix.y, name: fix.name, iaf: true }];
    ac.altRestr = undefined;
  }
}

function toMapFinal(state, ac) {
  const d = LY.rwyDir(ac.rwy);
  const G = stripGeom(ac.strip);
  ac.mode = 'map';
  ac.phase = PH.FINAL;
  ac.x = G.thr[ac.rwy] - d * LY.APPROACH_TILES;
  ac.y = G.y;
  ac.hdg = d > 0 ? 0 : Math.PI;
  const t = AC_TYPES[ac.type];
  ac.v = t.vapp * 0.0031;
  ac.z = (LY.APPROACH_TILES + LY.RWY.td) * 0.075;
  ac.req = null;
}

export function goAround(state, ac, reason) {
  const rot = getRot(state, ac);
  state.stats.today.goArounds++;
  radio(state, ac.cs, `${tel(ac)}, going around${reason ? '' : ''}.`);
  log(state, 'sys', `${ac.cs} startet durch – ${reason}.`);
  notify(state, `↗️ ${ac.cs} startet durch (${reason})`, 'warn');
  penalize(state, 'goaround', ac);
  if (state.life) state.life.landStreak = 0;
  ac.clr = {};
  ac.req = null;
  ac.spdOverride = null;
  if (ac.mode === 'map') {
    ac.phase = PH.MISSED;
    return;
  }
  const s = AS.appSide(ac.rwy);
  ac.phase = PH.GOAROUND;
  ac.route = [{ x: AS.THR[ac.rwy].x - s * 5, y: 0, name: '', missedEnd: true }];
  if (rot) rot.goArounds = (rot.goArounds || 0) + 1;
}

export function divert(state, ac, reason, pen = 'diversion') {
  const rot = getRot(state, ac);
  radio(state, ac.cs, `${tel(ac)}, unable to continue, diverting to alternate.`);
  log(state, 'sys', `${ac.cs} weicht aus: ${reason}.`);
  notify(state, `✈️↪ ${ac.cs} ausgewichen (${reason})`, 'bad');
  state.stats.today.diversions++;
  penalize(state, pen, ac);
  if (rot) rot.status = 'diverted';
  if (ac.stand) {
    const st = state.stands.find((s) => s.id === ac.stand);
    if (st && st.resv === ac.id) st.resv = null;
  }
  ac.phase = PH.GONE;
}

// ---------------- Karte ----------------
function updateMap(state, ac, dt) {
  const t = AC_TYPES[ac.type];
  const d = LY.rwyDir(ac.rwy);
  switch (ac.phase) {
    case PH.FINAL: {
      const G = stripGeom(ac.strip);
      const tdx = G.thr[ac.rwy] + d * G.td;
      ac.x += d * ac.v * dt;
      const rem = (tdx - ac.x) * d;
      ac.z = Math.max(0, rem * 0.075);
      if (!ac.decided && rem < 7) {
        ac.decided = true;
        const blk = runwayBlocker(state, ac);
        const closed = runwayClosed(state, ac.strip || 'N');
        if (blk) {
          goAround(state, ac, `Piste belegt durch ${blk.cs}`);
          if (ac.clr.landGivenBlocked) penalize(state, 'incursion', ac);
          return;
        }
        if (closed) {
          goAround(state, ac, `Piste gesperrt – ${closed}`);
          return;
        }
      }
      if (rem <= 0) {
        ac.z = 0;
        ac.phase = PH.ROLLOUT;
        ac.vacated = false;
        ac.decided = false;
        const south = ac.strip === 'S';
        const exits = south ? LY.exitsAheadS(ac.rwy) : LY.exitsAhead(ac.rwy);
        const decel = (t.wake === 'H' ? 0.0062 : 0.0082) * (state.upgrades.rapidExit ? 1.12 : 1) * decelFactor(state, ac.strip || 'N') * randRange(state, 0.85, 1.12);
        const ve = state.upgrades.rapidExit ? 0.16 : 0.12;
        const need = (ac.v * ac.v - ve * ve) / (2 * decel);
        let ex = exits.find((x) => Math.abs(x - tdx) >= need) ?? exits[exits.length - 1];
        ac.exitX = ex;
        ac.decel = decel;
        ac.ve = ve;
        if (south) {
          ac.crossX = LY.crossingFor(ac.rwy, ex);
          ac.path = LY.pathRolloutS(ac.rwy, ex, ac.len, ac.crossX);
        } else ac.path = LY.pathRollout(ac.rwy, ex, ac.len);
        ac.pi = 0;
        ac.x = ac.path[0].x;
        ac.y = ac.path[0].y;
        onLanding(state, ac);
        onRunwayLanding(state, ac);
        ac.brake = brakingAction(state, ac.strip || 'N');
        radio(state, ac.cs, `${tel(ac)}, touchdown.`, 'sys');
      }
      break;
    }
    case PH.ROLLOUT: {
      // Geschwindigkeitsprofil bis zur Abrollstelle
      const G = stripGeom(ac.strip);
      const onRwy = Math.abs(ac.y - G.y) < 0.2 && (ac.exitX - ac.x) * d > 0.3;
      let vmax;
      if (onRwy) {
        const dx = Math.abs(ac.exitX - ac.x);
        vmax = Math.sqrt(ac.ve * ac.ve + 2 * ac.decel * Math.max(0, dx - 1.0));
        ac.v = Math.min(ac.v, vmax + 0.01);
        ac.v = Math.max(ac.ve, ac.v - ac.decel * 0.5 * dt);
        advance(state, ac, dt, ac.v, false, true);
      } else {
        const done = followPath(state, ac, dt, 0.12);
        const clearY = ac.strip === 'S' ? LY.RWY_S.y - LY.RWY_S.hw - 0.9 : LY.HOLD_Y + 0.15;
        if (!ac.vacated && ac.y + ac.len * 0.5 < clearY) {
          ac.vacated = true;
          if (!state.auto.atc) radio(state, ac.cs, `${tel(ac)}, runway vacated${ac.clr.taxi ? '' : ', request taxi'}.`);
        }
        if (done) {
          ac.vacated = true;
          if (ac.crossX) {
            // Südbahn: vor der Nordbahn halten, Kreuzungsfreigabe abwarten
            ac.phase = PH.VACATED;
            ac.v = 0;
            ac.hdg = -Math.PI / 2;
            if (!ac.stand) ac.waitedStand = true;
            setReq(state, ac, 'cross');
            if (!state.auto.atc) radio(state, ac.cs, `${tel(ac)}, holding short runway ${rwyName(state, 'N', ac.rwy)}, request crossing.`);
          } else if (ac.clr.taxi && ac.stand) startTaxiIn(state, ac);
          else if (!ac.stand) {
            // ohne Parkposition zur Warteposition am Rollweg-Ende rollen
            const slot = state.acs.filter((o) => o !== ac && o.phase === PH.TAXI_WAIT).length;
            ac.waitedStand = true;
            ac.phase = PH.TAXI_WAIT;
            ac.path = LY.pathToWait(ac.x, ac.rwy, ac.len, Math.min(slot, 1));
            ac.path[0] = { x: ac.x, y: ac.y };
            ac.pi = 0;
            setReq(state, ac, 'taxi_in');
          } else {
            ac.phase = PH.VACATED;
            setReq(state, ac, 'taxi_in');
          }
        }
      }
      break;
    }
    case PH.TAXI_WAIT: {
      if (ac.clr.taxi && ac.stand) {
        startTaxiIn(state, ac);
        break;
      }
      if (followPath(state, ac, dt, 0.12)) {
        ac.phase = PH.VACATED;
        ac.v = 0;
      }
      break;
    }
    case PH.VACATED:
      ac.v = 0;
      if (ac.clr.taxi && ac.stand) startTaxiIn(state, ac);
      else if (ac.crossX) setReq(state, ac, 'cross');
      else if (ac.stand) setReq(state, ac, 'taxi_in');
      break;
    case PH.TAXI_IN: {
      ac.crossing = !!ac.crossX && LY.inNorthRunwayZone(ac.y);
      if (followPath(state, ac, dt, 0.13)) {
        ac.crossing = false;
        ac.phase = PH.STAND;
        ac.v = 0;
        ac.req = null;
        onBlock(state, ac);
      }
      break;
    }
    case PH.STAND:
      ac.v = 0;
      break;
    case PH.PUSH: {
      if (followPath(state, ac, dt, 0.045, true)) {
        ac.phase = PH.STARTUP;
        ac.startT = state.time;
        ac.v = 0;
        onPushbackDone(state, ac);
      }
      break;
    }
    case PH.STARTUP: {
      ac.engines = true;
      if (state.time - ac.startT > 55) {
        if (ac.clr.taxiOut) startTaxiOut(state, ac);
        else if (ac.req !== 'taxi_out') {
          setReq(state, ac, 'taxi_out');
          radio(state, ac.cs, `${tel(ac)}, ready to taxi.`);
        }
      }
      break;
    }
    case PH.TAXI_OUT: {
      if (followPath(state, ac, dt, 0.13)) {
        ac.phase = PH.HOLDING;
        ac.v = 0;
        ac.waitT = 0;
        if (ac.clr.lineup || (ac.clr.takeoff && slotOpen(state, ac, 45))) startLineUp(state, ac);
        else if (ac.clr.takeoff) holdForSlot(state, ac);
        else {
          setReq(state, ac, 'takeoff');
          radio(state, ac.cs, `${tel(ac)}, holding point runway ${rwyName(state, 'N', ac.rwy)}, ready for departure.`);
        }
      }
      break;
    }
    case PH.HOLDING:
      ac.v = 0;
      if (ac.clr.lineup || (ac.clr.takeoff && slotOpen(state, ac, 45))) startLineUp(state, ac);
      else if (ac.clr.takeoff) holdForSlot(state, ac);
      break;
    case PH.LINEUP: {
      if (followPath(state, ac, dt, 0.08)) {
        ac.phase = PH.LINED;
        ac.v = 0;
        ac.hdg = d > 0 ? 0 : Math.PI;
      }
      break;
    }
    case PH.LINED:
      ac.v = 0;
      if (ac.clr.takeoff && !slotOpen(state, ac)) holdForSlot(state, ac);
      else if (ac.clr.takeoff && state.time - (state.lastTakeoff || -1e9) < wakeDepSec(state.lastTakeoffWake, ac.wake)) {
        // Wirbelschleppen des vorigen Starts abwarten
        if (!ac.wakeCall) {
          ac.wakeCall = true;
          const w = Math.ceil((wakeDepSec(state.lastTakeoffWake, ac.wake) - (state.time - state.lastTakeoff)) / 60);
          radio(state, ac.cs, `${tel(ac)}, we'll wait ${w} minute${w > 1 ? 's' : ''} for wake turbulence.`);
          state.stats.today.wakeWait = (state.stats.today.wakeWait || 0) + 1;
        }
      } else if (ac.clr.takeoff) {
        // Piste voraus frei?
        const blk = state.acs.find((o) => o !== ac && o.mode === 'map' && ((o.phase === PH.ROLLOUT && !o.vacated && (o.strip || 'N') === 'N') || o.crossing));
        if (!blk) {
          ac.phase = PH.TAKEOFF;
          ac.req = null;
          radio(state, ac.cs, `${tel(ac)}, rolling.`, 'sys');
        }
      } else setReq(state, ac, 'takeoff');
      break;
    case PH.TAKEOFF: {
      const vr = 0.36;
      ac.v = Math.min(0.75, ac.v + (ac.z > 0 ? 0.006 : 0.0095) * dt);
      ac.x += d * ac.v * dt;
      if (ac.v >= vr || ac.z > 0) {
        if (!ac.airborne) {
          ac.airborne = true;
          state.lastTakeoff = state.time;
          state.lastTakeoffWake = ac.wake;
          onTakeoff(state, ac);
          acdmOnTakeoff(state, ac, getRot(state, ac));
        }
        ac.z += ac.v * 0.11 * dt;
      }
      if ((d < 0 && ac.x < -16) || (d > 0 && ac.x > LY.W + 16)) toAirDeparture(state, ac);
      break;
    }
    case PH.MISSED: {
      ac.v = Math.min(0.7, ac.v + 0.004 * dt);
      ac.x += d * ac.v * dt;
      ac.z += ac.v * 0.09 * dt;
      if ((d < 0 && ac.x < -16) || (d > 0 && ac.x > LY.W + 16)) {
        const nm = LY.tileToNm(ac.x, ac.y);
        ac.mode = 'air';
        ac.pos = nm;
        ac.alt = 1500;
        ac.crs = AS.finalCrs(ac.rwy);
        ac.spd = 170;
        ac.phase = PH.GOAROUND;
        const s = AS.appSide(ac.rwy);
        ac.route = [{ x: AS.THR[ac.rwy].x - s * 5, y: 0, name: '', missedEnd: true }];
        const rot = getRot(state, ac);
        if (rot) rot.goArounds = (rot.goArounds || 0) + 1;
      }
      break;
    }
  }
}

function toAirDeparture(state, ac) {
  const rot = getRot(state, ac);
  const nm = LY.tileToNm(ac.x, ac.y);
  ac.mode = 'air';
  ac.pos = nm;
  ac.alt = 1200;
  ac.crs = AS.finalCrs(ac.rwy);
  ac.spd = 180;
  ac.tSpd = 250;
  ac.tAlt = 24000;
  ac.phase = PH.DEPART;
  const brg = rot ? CITIES[rot.city].brg : 0;
  ac.route = AS.departureRoute(ac.rwy, brg + randRange(state, -6, 6));
  ac.trail = [];
  ac.stand = null;
  ac.req = null;
  if (!state.auto.atc) radio(state, ac.cs, `${tel(ac)}, passing 1500 feet, climbing FL240.`);
}

export function startTaxiIn(state, ac) {
  const st = state.stands.find((s) => s.id === ac.stand);
  if (!st) return;
  ac.phase = PH.TAXI_IN;
  ac.path = ac.crossX ? LY.pathCrossIn(ac.crossX, st, ac.len, ac.rwy) : LY.pathTaxiIn(ac.x, st, ac.len, ac.rwy);
  // Startpunkt an aktuelle Position anpassen
  ac.path[0] = { x: ac.x, y: ac.y };
  ac.pi = 0;
  ac.req = null;
}
export function startPushback(state, ac) {
  const st = state.stands.find((s) => s.id === ac.stand);
  if (!st) return;
  ac.rwy = state.rwy;
  ac.phase = PH.PUSH;
  ac.path = LY.pathPushback(st, ac.len, ac.rwy);
  ac.pi = 0;
  ac.rev = true;
  ac.req = null;
  onPushbackStart(state, ac);
}
export function startTaxiOut(state, ac) {
  ac.phase = PH.TAXI_OUT;
  ac.path = LY.pathTaxiOut(ac.x, ac.rwy, ac.len);
  ac.path[0] = { x: ac.x, y: ac.y };
  ac.pi = 0;
  ac.rev = false;
  ac.req = null;
}
export function startLineUp(state, ac) {
  ac.phase = PH.LINEUP;
  ac.path = LY.pathLineUp(ac.rwy, ac.len);
  ac.path[0] = { x: ac.x, y: ac.y };
  ac.pi = 0;
  ac.req = null;
}

// Wer blockiert die Piste für eine Landung?
// Wer blockiert die Piste für eine Landung? (nur dieselbe Bahn; Starts und Kreuzungen betreffen die Nordbahn)
export function runwayBlocker(state, ac) {
  const strip = ac.strip || 'N';
  for (const o of state.acs) {
    if (o === ac || o.mode !== 'map') continue;
    if (o.phase === PH.ROLLOUT && !o.vacated && (o.strip || 'N') === strip) return o;
    if (strip !== 'N') continue;
    if (o.phase === PH.LINEUP || o.phase === PH.LINED) return o;
    if (o.phase === PH.TAKEOFF && o.z < 0.4) return o;
    if (o.crossing) return o;
  }
  return null;
}
export function runwayOccupants(state, strip = 'N') {
  return state.acs.filter((o) => o.mode === 'map' && ((o.phase === PH.ROLLOUT && !o.vacated && (o.strip || 'N') === strip) || (strip === 'N' && (o.phase === PH.LINEUP || o.phase === PH.LINED || (o.phase === PH.TAKEOFF && o.z < 0.6) || o.crossing)) || (o.phase === PH.FINAL && o.z < 1.0 && (o.strip || 'N') === strip) || (o.phase === PH.MISSED && o.z < 0.6 && (o.strip || 'N') === strip)));
}
// Kann ein Flugzeug jetzt die Nordbahn kreuzen?
export function crossingSafe(state) {
  for (const o of state.acs) {
    if (o.mode === 'map' && (o.phase === PH.LINEUP || o.phase === PH.LINED || (o.phase === PH.TAKEOFF && o.z < 0.3))) return false;
    if (o.mode === 'map' && (o.strip || 'N') === 'N' && ((o.phase === PH.ROLLOUT && !o.vacated) || o.phase === PH.FINAL)) return false;
    if (o.mode === 'air' && (o.strip || 'N') === 'N' && o.phase === PH.APPROACH && o.route.length === 1 && AS.distToThr(o.pos, o.rwy) < 3) return false;
  }
  return true;
}

// --------- Pfadverfolgung & Kollisionsvermeidung ---------
function advance(state, ac, dt, v, reverse, keepHeading = false) {
  let s = v * dt;
  const path = ac.path;
  while (s > 1e-6 && ac.pi < path.length - 1) {
    const b = path[ac.pi + 1];
    const seg = Math.hypot(b.x - ac.x, b.y - ac.y);
    if (seg <= s) {
      ac.x = b.x;
      ac.y = b.y;
      ac.pi++;
      s -= seg;
    } else {
      ac.x += ((b.x - ac.x) / seg) * s;
      ac.y += ((b.y - ac.y) / seg) * s;
      s = 0;
    }
  }
  // Blickrichtung
  const la = lookAhead(ac, 0.35);
  if (la) {
    let h = Math.atan2(la.y - ac.y, la.x - ac.x);
    if (reverse) h += Math.PI;
    const diff = angNorm(h - ac.hdg);
    ac.hdg = angNorm(ac.hdg + clamp(diff, -2.5 * dt, 2.5 * dt));
  }
}

function lookAhead(ac, dd) {
  const path = ac.path;
  let px = ac.x, py = ac.y;
  let rem = dd;
  for (let i = ac.pi + 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - px, path[i].y - py);
    if (seg >= rem) return { x: px + ((path[i].x - px) / seg) * rem, y: py + ((path[i].y - py) / seg) * rem };
    rem -= seg;
    px = path[i].x;
    py = path[i].y;
  }
  if (Math.hypot(px - ac.x, py - ac.y) > 0.02) return { x: px, y: py };
  return null;
}

function remaining(ac) {
  const path = ac.path;
  if (!path || ac.pi >= path.length - 1) return 0;
  let L = Math.hypot(path[ac.pi + 1].x - ac.x, path[ac.pi + 1].y - ac.y);
  return L + pathLength(path, ac.pi + 1);
}

function upcomingTurn(ac, dd) {
  const path = ac.path;
  const i = ac.pi;
  if (i + 1 >= path.length) return 0;
  const a0 = Math.atan2(path[i + 1].y - ac.y, path[i + 1].x - ac.x);
  let rem = dd;
  let j = i + 1;
  while (j < path.length - 1 && rem > 0) {
    rem -= Math.hypot(path[j + 1].x - path[j].x, path[j + 1].y - path[j].y);
    j++;
  }
  if (j >= path.length) j = path.length - 1;
  if (j <= i + 1) return 0;
  const a1 = Math.atan2(path[j].y - path[j - 1].y, path[j].x - path[j - 1].x);
  return Math.abs(angNorm(a1 - a0));
}

function samplesAhead(ac, look, step = 0.35) {
  const out = [];
  const path = ac.path;
  let px = ac.x, py = ac.y;
  let acc = 0;
  let next = step;
  for (let i = ac.pi + 1; i < path.length && acc < look; i++) {
    const seg = Math.hypot(path[i].x - px, path[i].y - py);
    while (next <= acc + seg && next <= look) {
      const t = (next - acc) / (seg || 1);
      out.push({ x: px + (path[i].x - px) * t, y: py + (path[i].y - py) * t });
      next += step;
    }
    acc += seg;
    px = path[i].x;
    py = path[i].y;
  }
  if (!out.length && path.length) out.push({ x: path[path.length - 1].x, y: path[path.length - 1].y });
  return out;
}

const COLLIDE_SKIP = new Set([PH.FINAL, PH.MISSED, PH.TAKEOFF]);
function checkBlocked(state, ac, look) {
  if (ac.ghostUntil > state.time) return null;
  const pts = samplesAhead(ac, look);
  if (!pts.length) return null;
  const la = pts[0];
  let mdx = la.x - ac.x, mdy = la.y - ac.y;
  const ml = Math.hypot(mdx, mdy) || 1;
  mdx /= ml;
  mdy /= ml;
  for (const b of state.acs) {
    if (b === ac || b.mode !== 'map' || COLLIDE_SKIP.has(b.phase) || b.z > 0.3) continue;
    const r = 0.45 * (ac.len + b.len) + 0.3;
    const dx = b.x - ac.x, dy = b.y - ac.y;
    const dd = Math.hypot(dx, dy);
    if (dd > look + r + 0.5) continue;
    if (dx * mdx + dy * mdy < 0.15 * dd) continue;
    for (const p of pts) if (Math.hypot(b.x - p.x, b.y - p.y) < r) return b;
  }
  return null;
}

function followPath(state, ac, dt, vmax, reverse = false) {
  const path = ac.path;
  if (!path || ac.pi >= path.length - 1) {
    ac.v = 0;
    return true;
  }
  const rem = remaining(ac);
  let vt = Math.min(vmax, Math.sqrt(2 * 0.0035 * rem) + 0.012);
  if (!reverse && upcomingTurn(ac, 1.0) > 0.4) vt = Math.min(vt, 0.075);
  if (ac.holdPos) vt = 0;
  const look = Math.max(1.0, (ac.v * ac.v) / (2 * 0.01) + 0.6);
  const blk = checkBlocked(state, ac, look);
  if (blk) {
    vt = 0;
    ac.blockedBy = blk.id;
    ac.blockedT += dt;
  } else {
    ac.blockedBy = null;
    ac.blockedT = 0;
  }
  if (ac.v < vt) ac.v = Math.min(vt, ac.v + 0.0045 * dt);
  else ac.v = Math.max(vt, ac.v - 0.02 * dt);
  if (ac.v > 0) advance(state, ac, dt, ac.v, reverse);
  if (rem < 0.02 && ac.pi >= path.length - 2) {
    const last = path[path.length - 1];
    ac.x = last.x;
    ac.y = last.y;
    ac.pi = path.length - 1;
  }
  return ac.pi >= path.length - 1;
}

// Gegenseitige Blockaden auflösen (sehr selten)
function resolveDeadlocks(state) {
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  for (const a of state.acs) {
    if (!a.blockedBy || a.ghostUntil > state.time) continue;
    const b = byId.get(a.blockedBy);
    if (!b) continue;
    const mutual = b.blockedBy === a.id && a.blockedT > 12 && b.blockedT > 12;
    const stuckOnParked = a.blockedT > 120 && [PH.STAND, PH.STARTUP, PH.VACATED, PH.HOLDING].includes(b.phase) && b.v === 0 && !b.blockedBy;
    const longStuck = a.blockedT > 400;
    if (mutual || stuckOnParked || longStuck) {
      const loser = mutual ? (a.id < b.id ? a : b) : a;
      loser.ghostUntil = state.time + 40;
      loser.blockedT = 0;
    }
  }
}
