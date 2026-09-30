// Flugzeuge: Lebenszyklus, Navigation im Luftraum, Bewegung auf der Karte
import { AC_TYPES, AIRLINES, CITIES, AIRPORT } from '../config.js';
import { clamp, dist, degDiff, degNorm, DEG, rand, randInt, randRange, angNorm, pathLength } from '../util.js';
import * as LY from '../layout.js';
import * as AS from './airspace.js';
import { radio, log, notify } from './messages.js';
import { nextId } from './schedule.js';
import { onBlock, onPushbackStart, onPushbackDone, assignStandAuto } from './ground.js';
import { onLanding, onTakeoff, penalize } from './economy.js';

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
  const alt = 13000 + randInt(state, 0, 3) * 1000;
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

function holdingAltitude(state, ac, fix) {
  const used = new Set(state.acs.filter((o) => o !== ac && o.phase === PH.HOLD && o.holdFix && o.holdFix.name === fix.name).map((o) => o.tAlt));
  for (let a = 7000; a <= 14000; a += 1000) if (!used.has(a)) return a;
  return 15000;
}

function enterHold(state, ac, fix) {
  ac.phase = PH.HOLD;
  ac.holdFix = { name: fix.name, x: fix.x, y: fix.y };
  ac.holdIdx = 1;
  ac.holdStart = state.time;
  ac.tAlt = holdingAltitude(state, ac, fix);
  ac.tSpd = 220;
  ac.route = [];
  radio(state, ac.cs, `${tel(ac)}, entering hold at ${fix.name}, ${fmtAlt(ac.tAlt)}.`);
  setReq(state, ac, 'approach');
}

export const fmtAlt = (a) => (a >= 10000 ? `FL${Math.round(a / 100)}` : `${Math.round(a / 100) * 100} feet`);

function updateAir(state, ac, dt) {
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
      ac.tAlt = beforeFaf ? 3000 : 5000;
    }
  } else if (ac.phase === PH.INBOUND) {
    const nextIaf = ac.route.length && ac.route[0].iaf;
    ac.tAlt = ac.altRestr ?? (nextIaf ? 8000 : 13000);
    ac.tSpd = ac.spdOverride || (ac.alt > 10500 ? 280 : 250);
  } else if (ac.phase === PH.HOLD) {
    ac.tSpd = ac.spdOverride || 220;
    if (state.time - ac.holdStart > 35 * 60 && !ac.emergency) {
      divert(state, ac, 'Treibstoff knapp nach langer Warteschleife');
      return;
    }
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
    radio(state, ac.cs, `${AS.FIXES ? '' : ''}${tel(ac)}, established ILS runway ${ac.rwy}${ac.clr.land ? '' : ', request landing'}.`);
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
  ac.mode = 'map';
  ac.phase = PH.FINAL;
  ac.x = LY.RWY.thr[ac.rwy] - d * LY.APPROACH_TILES;
  ac.y = LY.RWY.y;
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

export function divert(state, ac, reason) {
  const rot = getRot(state, ac);
  radio(state, ac.cs, `${tel(ac)}, unable to continue, diverting to alternate.`);
  log(state, 'sys', `${ac.cs} weicht aus: ${reason}.`);
  notify(state, `✈️↪ ${ac.cs} ausgewichen (${reason})`, 'bad');
  state.stats.today.diversions++;
  penalize(state, 'diversion', ac);
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
      const tdx = LY.RWY.thr[ac.rwy] + d * LY.RWY.td;
      ac.x += d * ac.v * dt;
      const rem = (tdx - ac.x) * d;
      ac.z = Math.max(0, rem * 0.075);
      if (!ac.decided && rem < 7) {
        ac.decided = true;
        const blk = runwayBlocker(state, ac);
        if (blk) {
          goAround(state, ac, `Piste belegt durch ${blk.cs}`);
          if (ac.clr.landGivenBlocked) penalize(state, 'incursion', ac);
          return;
        }
      }
      if (rem <= 0) {
        ac.z = 0;
        ac.phase = PH.ROLLOUT;
        ac.vacated = false;
        ac.decided = false;
        const exits = LY.exitsAhead(ac.rwy);
        const decel = (t.wake === 'H' ? 0.0062 : 0.0082) * (state.upgrades.rapidExit ? 1.12 : 1) * randRange(state, 0.85, 1.12);
        const ve = state.upgrades.rapidExit ? 0.16 : 0.12;
        const need = (ac.v * ac.v - ve * ve) / (2 * decel);
        let ex = exits.find((x) => Math.abs(x - tdx) >= need) ?? exits[exits.length - 1];
        ac.exitX = ex;
        ac.decel = decel;
        ac.ve = ve;
        ac.path = LY.pathRollout(ac.rwy, ex, ac.len);
        ac.pi = 0;
        ac.x = ac.path[0].x;
        ac.y = ac.path[0].y;
        onLanding(state, ac);
        radio(state, ac.cs, `${tel(ac)}, touchdown.`, 'sys');
      }
      break;
    }
    case PH.ROLLOUT: {
      // Geschwindigkeitsprofil bis zur Abrollstelle
      const onRwy = Math.abs(ac.y - LY.RWY.y) < 0.2 && (ac.exitX - ac.x) * d > 0.3;
      let vmax;
      if (onRwy) {
        const dx = Math.abs(ac.exitX - ac.x);
        vmax = Math.sqrt(ac.ve * ac.ve + 2 * ac.decel * Math.max(0, dx - 1.0));
        ac.v = Math.min(ac.v, vmax + 0.01);
        ac.v = Math.max(ac.ve, ac.v - ac.decel * 0.5 * dt);
        advance(state, ac, dt, ac.v, false, true);
      } else {
        const done = followPath(state, ac, dt, 0.12);
        if (!ac.vacated && ac.y + ac.len * 0.5 < LY.HOLD_Y + 0.15) {
          ac.vacated = true;
          if (!state.auto.atc) radio(state, ac.cs, `${tel(ac)}, runway vacated${ac.clr.taxi ? '' : ', request taxi'}.`);
        }
        if (done) {
          ac.vacated = true;
          if (ac.clr.taxi && ac.stand) startTaxiIn(state, ac);
          else if (!ac.stand) {
            // ohne Parkposition zur Warteposition am Rollweg-Ende rollen
            const slot = state.acs.filter((o) => o !== ac && o.phase === PH.TAXI_WAIT).length;
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
      else if (ac.stand) setReq(state, ac, 'taxi_in');
      break;
    case PH.TAXI_IN: {
      if (followPath(state, ac, dt, 0.13)) {
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
        if (ac.clr.takeoff || ac.clr.lineup) startLineUp(state, ac);
        else {
          setReq(state, ac, 'takeoff');
          radio(state, ac.cs, `${tel(ac)}, holding point runway ${ac.rwy}, ready for departure.`);
        }
      }
      break;
    }
    case PH.HOLDING:
      ac.v = 0;
      if (ac.clr.takeoff || ac.clr.lineup) startLineUp(state, ac);
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
      if (ac.clr.takeoff) {
        // Piste voraus frei?
        const blk = state.acs.find((o) => o !== ac && o.mode === 'map' && (o.phase === PH.ROLLOUT && !o.vacated));
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
  ac.path = LY.pathTaxiIn(ac.x, st, ac.len, ac.rwy);
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
export function runwayBlocker(state, ac) {
  for (const o of state.acs) {
    if (o === ac || o.mode !== 'map') continue;
    if (o.phase === PH.ROLLOUT && !o.vacated) return o;
    if (o.phase === PH.LINEUP || o.phase === PH.LINED) return o;
    if (o.phase === PH.TAKEOFF && o.z < 0.4) return o;
  }
  return null;
}
export function runwayOccupants(state) {
  return state.acs.filter((o) => o.mode === 'map' && ((o.phase === PH.ROLLOUT && !o.vacated) || o.phase === PH.LINEUP || o.phase === PH.LINED || (o.phase === PH.TAKEOFF && o.z < 0.6) || (o.phase === PH.FINAL && o.z < 1.0) || (o.phase === PH.MISSED && o.z < 0.6)));
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
