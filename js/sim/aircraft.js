// Flugzeuge: Lebenszyklus, Navigation im Luftraum, Bewegung auf der Karte
import { windGoAround, gustPeak } from './gusts.js';
import { AC_TYPES, AIRLINES, CITIES, AIRPORT, TIME_SCALE } from '../config.js';
import { touchdown } from './touchdown.js';
import { assignLook } from './spotter.js';
import { clamp, dist, degDiff, degNorm, DEG, rand, randInt, randRange, angNorm, pathLength } from '../util.js';
import * as LY from '../layout.js';
import * as AS from './airspace.js';
import { radio, log, notify, speech } from './messages.js';
import { nextId } from './schedule.js';
import { onBlock, onPushbackStart, onPushbackDone, assignStandAuto } from './ground.js';
import { onLanding, onTakeoff, penalize } from './economy.js';
import { slotOpen, acdmOnTakeoff } from './acdm.js';
import { wakeDepSec } from './wake.js';
import { depGap, sidOf, SID_SAME_SEC } from './sid.js';
import { runwayClosed, decelFactor, onRunwayLanding, brakingAction, stripGeom, rwyName, closeRunway } from './runway.js';
import { scoreGoAround } from './score.js';
import { diff } from './difficulty.js';
import { vfrTel } from './vfr.js';
import { isReg, typeAllowed, smallField } from './career.js';
import { standFits, standFree } from './ground.js';
import { T } from '../i18n.js';
import { shapeAt, shapeGap, wingsTouch } from './shape.js';
// freie, passende Position für einen Gastflieger? (auch schon reservierte zählen als belegt)
function gaStandFree(state, type) {
  const fake = { type };
  return state.stands.some((s) => standFits(s, fake) && standFree(s));
}

export const PH = {
  INBOUND: 'ARR_INBOUND', HOLD: 'ARR_HOLD', APPROACH: 'ARR_APPROACH', GOAROUND: 'GO_AROUND',
  FINAL: 'FINAL', ROLLOUT: 'ROLLOUT', VACATED: 'VACATED', TAXI_WAIT: 'TAXI_WAIT', TAXI_IN: 'TAXI_IN', STAND: 'AT_STAND',
  PUSH: 'PUSHBACK', STARTUP: 'STARTUP', TAXI_OUT: 'TAXI_OUT', HOLDING: 'HOLDING', LINEUP: 'LINEUP',
  LINED: 'LINED_UP', TAKEOFF: 'TAKEOFF', MISSED: 'MISSED', DEPART: 'DEPARTURE', GONE: 'GONE',
};
export const PHASE_DE = {
  ARR_INBOUND: T('Im Anflug'), ARR_HOLD: T('Warteschleife'), ARR_APPROACH: T('Anflug frei'), GO_AROUND: T('Durchstarten'),
  FINAL: T('Endanflug'), ROLLOUT: T('Ausrollen'), VACATED: T('Wartet auf Rollfreigabe'), TAXI_WAIT: T('Rollt zur Warteposition'), TAXI_IN: T('Rollt zur Position'), AT_STAND: T('Abfertigung'),
  PUSHBACK: T('Pushback'), STARTUP: T('Triebwerksstart'), TAXI_OUT: T('Rollt zum Rollhalt'), HOLDING: T('Am Rollhalt'), LINEUP: T('Rollt auf die Piste'),
  LINED_UP: T('Aufgestellt'), TAKEOFF: T('Startlauf'), MISSED: T('Fehlanflug'), DEPARTURE: T('Abflug'), GONE: '—',
};
export const AIR_PHASES = new Set([PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND, PH.DEPART]);
export const RWY_PHASES = new Set([PH.ROLLOUT, PH.LINEUP, PH.LINED, PH.TAKEOFF]);

// Gruß beim Erstkontakt je nach Tageszeit (nicht jeder grüßt – fest je Flug, ohne Spielzufall)
export function greet(state, ac) {
  let h = 0;
  for (const c of ac.cs) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (h % 3 === 0) return '';
  const hr = (state.time / 3600) % 24;
  return hr < 11 ? 'good morning, ' : hr < 18 ? (h % 2 ? 'good day, ' : 'hello, ') : 'good evening, ';
}

export function tel(ac) {
  // Kleinflugzeuge melden sich mit dem Kennzeichen („Delta Lima Mike“)
  if (isReg(ac.cs)) return vfrTel(ac.cs, !ac.telShort);
  const al = AIRLINES[ac.airline];
  return `${al.tel} ${ac.cs.replace(/^[A-Z]+/, '')}`;
}
const ATIS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const atisName = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];
export const atis = (state) => atisName[(state.atisN ?? Math.floor(state.time / 3600)) % 26];
export const windStr = (state) => `wind ${String(Math.round(state.wind.dir / 10) * 10 || 360).padStart(3, '0')} degrees ${Math.round(state.wind.spd)} knots` + (gustPeak(state) ? ` gusting ${gustPeak(state)} knots` : '');

export function getRot(state, ac) {
  return state.rots[ac.rot];
}

// ---------------- Erzeugen ----------------
// Sportflugzeuge nur nach Sichtflugregeln; bei diesen Wetterlagen bleiben sie am Boden
const VFR_ONLY = new Set(['C172', 'PA28', 'DR40']);
const IMC_WX = new Set(['snow', 'fog', 'storm']);
export function spawnArrival(state, rot, force = false) {
  const t = AC_TYPES[rot.type];
  // Karriere: ist die Wiese voll, fliegen Gastflieger woanders hin (statt den Rollweg zu verstopfen)
  if (rot.ga && rot.airline === 'GAV' && !gaStandFree(state, rot.type)) {
    rot.status = 'cancelled';
    state.stats.today.turnedAway = (state.stats.today.turnedAway || 0) + 1;
    if ((state.stats.today.turnedAway || 0) % 3 === 1) log(state, 'gnd', T`Abstellfläche voll – ${rot.arrNo} fliegt einen anderen Platz an.`);
    return null;
  }
  // Sichtflieger (einmotorige Sportflugzeuge, Fallschirmflüge) starten bei Schnee, Nebel oder Gewitter gar nicht erst
  if (rot.ga && AIRLINES[rot.airline] && AIRLINES[rot.airline].ga && (VFR_ONLY.has(rot.type) || rot.airline === 'SKD') && IMC_WX.has(state.weather.kind)) {
    rot.status = 'cancelled';
    state.stats.today.wxCancel = (state.stats.today.wxCancel || 0) + 1;
    if (state.stats.today.wxCancel % 3 === 1) log(state, 'gnd', T`${rot.arrNo} sagt wetterbedingt ab – kein Sichtflugwetter.`);
    return null;
  }
  const brg = CITIES[rot.city].brg + randRange(state, -10, 10);
  const slow = !!t.vmax;
  const pos = AS.spawnPoint(brg, slow ? 30 : undefined);
  const rwy = state.rwy;
  let alt = slow ? t.cruise + randInt(state, 0, 2) * 500 : 13000 + randInt(state, 0, 3) * 1000;
  // Einflug-Staffelung: nicht in der Nähe anderer Flugzeuge erzeugen
  const near = (al) => state.acs.some((o) => o.mode === 'air' && Math.hypot(o.pos.x - pos.x, o.pos.y - pos.y) < 12 && Math.abs(o.alt - al) < 2500);
  if (near(alt)) {
    // Sonderflüge (Notfall, VIP, A380, Umleitung) kommen immer – notfalls auf einer freien höheren/tieferen Fläche
    const alts = [alt >= 15000 ? alt - 4000 : alt + 4000].concat(force ? [20000, 9000] : []);
    const alt2 = alts.find((a) => !near(a)) ?? (force ? 22000 : null);
    if (alt2 === null) return null;
    alt = alt2;
  }
  const ac = makeAircraft(state, rot, { pos, alt, crs: degNorm(brg + 180), route: AS.inboundRoute(pos, rwy) });
  rot.ac = ac.id;
  rot.status = 'inbound';
  state.acs.push(ac);
  radio(state, ac.cs, `${AIRPORT.city} ${slow ? 'Information' : 'Approach'}, ${greet(state, ac)}${tel(ac)}, ${slow ? fmtAlt(alt) : 'FL' + Math.round(alt / 100)}${rot.special === 'diversion' ? ', diverting from Nordhafen' : ''}, information ${atis(state)}.`);
  ac.telShort = true;
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
  ac.y = LY.noseY(stand) + t.len / 2;
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
    spd: Math.min(280, t.vmax || 280),
    tSpd: Math.min(250, t.vmax || 250),
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
    blockedBy: null, blockedT: 0,
    engines: true,
    arr: true,
    // Treibstoff für Anflug + Reserve in Minuten (Warteschleifen zehren daran)
    fuelMin: (16 + randRange(state, 28, 50) + (t.size === 'L' ? 8 : 0) + (t.vmax ? 50 : 0)) * diff(state).fuel + ((state.scenario && state.scenario.fuelPlus) || 0),
  };
  assignLook(ac, rot);
  return ac;
}

// Zusätzliches Flugzeug (VIP / Notfall) ohne Vertrag
export function spawnSpecial(state, opts) {
  if (!typeAllowed(state, opts.type)) return null; // Karriere: Platz noch zu klein
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
  const ac = spawnArrival(state, rot, true);
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

// Warteschleifen-Stapel: verlässt der Unterste die Schleife, rücken die anderen je 1000 ft nach unten – aber nur,
// wenn die Höhe darunter frei ist und kein anderer Verkehr in der Nähe auf dieser Höhe fliegt
function compactStacks(state) {
  const byFix = new Map();
  for (const a of state.acs) {
    if (a.mode !== 'air') continue;
    const fx = a.phase === PH.HOLD && a.holdFix ? a.holdFix.name : a.stackFix && a.stackAlt ? a.stackFix : null;
    if (!fx) continue;
    if (!byFix.has(fx)) byFix.set(fx, []);
    byFix.get(fx).push(a);
  }
  for (const list of byFix.values()) {
    const lvl = (a) => (a.phase === PH.HOLD ? a.tAlt : a.stackAlt);
    list.sort((x, y) => lvl(x) - lvl(y));
    const used = new Set(list.map(lvl));
    for (const a of list) {
      if (a.phase !== PH.HOLD) continue;
      const L = lvl(a) - 1000;
      if (L < 7000 || used.has(L) || Math.abs(a.alt - a.tAlt) > 300) continue;
      // der ganze Sinkweg muss frei sein: niemand in der Nähe, dessen Höhe (jetzt bis Ziel) in diesen Bereich fällt
      const fix = a.holdFix;
      const lo = L - 900, hi = a.alt + 900;
      const busy = state.acs.some((o) => o !== a && o.mode === 'air' && Math.hypot(o.pos.x - fix.x, o.pos.y - fix.y) < 10 && Math.max(o.alt, o.tAlt) > lo && Math.min(o.alt, o.tAlt) < hi);
      if (busy) continue;
      used.delete(lvl(a));
      a.tAlt = L;
      used.add(L);
    }
  }
}

// ---------------- Laufzeit ----------------
export function updateAircraft(state, dt) {
  for (const ac of state.acs) {
    if (ac.mode === 'air') updateAir(state, ac, dt);
    else updateMap(state, ac, dt);
  }
  state.stackT = (state.stackT || 0) + dt;
  if (state.stackT > 5) {
    state.stackT = 0;
    compactStacks(state);
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
  radio(state, ac.cs, `${tel(ac)}, entering the hold at ${fix.name}, maintaining ${fmtAlt(ac.tAlt)}.`);
  setReq(state, ac, 'approach');
}

export const fmtAlt = (a) => (a >= 10000 ? `FL${Math.round(a / 100)}` : `${Math.round(a / 100) * 100} feet`);

// Treibstoffreserve der Ankünfte: MINIMUM FUEL -> MAYDAY FUEL -> Ausweichen
function updateFuel(state, ac, dt) {
  if (!ac.arr || ac.fuelMin === undefined || ![PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND].includes(ac.phase)) return false;
  ac.fuelMin -= dt / 60;
  if (ac.fuelMin <= 12 && !ac.minFuel) {
    ac.minFuel = true;
    radio(state, ac.cs, `Tower, ${tel(ac)}, minimum fuel.`);
    notify(state, T`⛽ ${ac.cs}: MINIMUM FUEL – bald Anflug freigeben`, 'warn');
    log(state, 'sys', T`${ac.cs} meldet Minimum Fuel (noch ca. ${Math.round(ac.fuelMin)} min Reserve).`);
    state.stats.today.minFuel = (state.stats.today.minFuel || 0) + 1;
  }
  if (ac.fuelMin <= 5 && !ac.fuelEmergency) {
    ac.fuelEmergency = true;
    ac.emergency = true;
    ac.squawk = '7700';
    radio(state, ac.cs, `MAYDAY MAYDAY MAYDAY, Tower, ${tel(ac)}, MAYDAY fuel, fuel emergency, request immediate approach.`);
    notify(state, T`🚨 ${ac.cs}: MAYDAY FUEL – sofort landen lassen!`, 'bad');
    penalize(state, 'fuelEmergency', ac);
    state.fireAlert = state.fireAlert || { ac: ac.id, t: state.time };
  }
  if (ac.fuelMin <= 0 && (ac.phase === PH.HOLD || ac.phase === PH.INBOUND)) {
    divert(state, ac, T('Treibstoffmangel'));
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
    // Rennbahn abfliegen: nächster Punkt, sobald der aktuelle nah oder schon hinter dem Flugzeug liegt
    const pat = AS.holdPattern(ac.holdFix);
    tgt = pat[ac.holdIdx % pat.length];
    const dx = tgt.x - ac.pos.x, dy = tgt.y - ac.pos.y;
    const d = Math.hypot(dx, dy);
    const ahead = dx * Math.sin(ac.crs * DEG) - dy * Math.cos(ac.crs * DEG);
    if (d < 0.45 || (d < 2.5 && ahead < 0)) {
      ac.holdIdx++;
      tgt = pat[ac.holdIdx % pat.length];
    }
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
      if (w.wx) {
        // Wetter-Umweg: kaum abkürzen (sonst geht es doch in die Zelle), aber nie um den Punkt kreisen
        const R = ac.spd / 188.5;
        lead = 0.6;
        if (d < 2.2 * R && Math.abs(degDiff(ac.crs, AS.crsTo(ac.pos, w))) > 75) lead = d + 0.01;
      } else if (ac.route[1] && !ac.route[1].thr) {
        const turn = Math.abs(degDiff(AS.crsTo(w, ac.route[1]), AS.crsTo(ac.pos, w)));
        const R = ac.spd / 188.5;
        lead = Math.min(3, R * Math.tan((Math.min(turn, 120) * DEG) / 2)) + 0.25;
      } else if (w.faf) lead = 0.6;
      if (d < lead || d < (ac.spd / 3600) * dt * 1.5) passWaypoint(state, ac, w);
    }
  }

  // Geschwindigkeit & Höhe je Phase
  if (ac.leaveFix && (ac.phase !== PH.APPROACH || Math.hypot(ac.pos.x - ac.leaveFix.x, ac.pos.y - ac.leaveFix.y) > 5)) {
    ac.leaveFix = null;
    if (ac.phase === PH.APPROACH) ac.altRestr = undefined;
  }
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
        goAround(state, ac, T('keine Landefreigabe'));
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
    // Übergabe an die Abflugkontrolle nach dem Steigen durch 2000 ft
    if (!ac.handoff && ac.alt > 2000 && !ac.emergency) {
      ac.handoff = true;
      const f = ['119.305', '124.475', '127.275'][ac.id.length % 3];
      radio(state, 'TWR', `${tel(ac)}, contact Langen Radar ${f}, goodbye.`, 'atc');
      radio(state, ac.cs, `${f}, ${tel(ac)}, good day.`);
    }
    if (Math.hypot(ac.pos.x, ac.pos.y) > AS.RADAR_RANGE + 2 || !ac.route.length) {
      ac.phase = PH.GONE;
      return;
    }
  }

  // Kleinflugzeuge: Höchstgeschwindigkeit und niedrige Reiseflughöhe
  const tt = AC_TYPES[ac.type];
  if (tt.vmax) {
    ac.tSpd = Math.min(ac.tSpd, tt.vmax);
    if ((ac.phase === PH.INBOUND && !ac.stackAlt) || ac.phase === PH.DEPART) ac.tAlt = Math.min(ac.tAlt, Math.max(tt.cruise, 3000));
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
    radio(state, ac.cs, `Tower, ${tel(ac)}, ${smallField(state) ? 'final' : 'established ILS'} runway ${rwyName(state, ac.strip || 'N', ac.rwy)}.`);
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
    ac.missedSplit = false;
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

// Fehlanflug-Route: geradeaus auf 4000 ft; ist schon jemand im Fehlanflug, seitlich versetzt auf 3000 ft
function missedRoute(state, ac) {
  const s = AS.appSide(ac.rwy);
  const other = state.acs.some((o) => o !== ac && (o.phase === PH.GOAROUND || o.phase === PH.MISSED) && o.rwy === ac.rwy && !o.missedSplit);
  if (!other) {
    ac.missedSplit = false;
    ac.altRestr = undefined;
    return [{ x: AS.THR[ac.rwy].x - s * 5, y: 0, name: '', missedEnd: true }];
  }
  ac.missedSplit = true;
  ac.altRestr = 3000;
  const side = ac.pos && ac.pos.y > 0 ? 1 : -1;
  const turn = side * s > 0 ? 'right' : 'left';
  radio(state, 'TWR', `${tel(ac)}, after the runway end turn ${turn}, climb altitude 3000 feet, traffic ahead on the missed approach.`, 'atc');
  radio(state, ac.cs, `Turning ${turn} after the runway end, climbing 3000 feet, ${tel(ac)}.`);
  return [{ x: AS.THR[ac.rwy].x - s * 2.5, y: side * 3.2, name: '' }, { x: AS.THR[ac.rwy].x - s * 6, y: side * 3.2, name: '', missedEnd: true }];
}

export function goAround(state, ac, reason) {
  const rot = getRot(state, ac);
  state.stats.today.goArounds++;
  radio(state, ac.cs, `Going around, ${tel(ac)}.`);
  log(state, 'sys', T`${ac.cs} startet durch – ${T(reason)}.`);
  notify(state, T`↗️ ${ac.cs} startet durch (${T(reason)})`, 'warn');
  penalize(state, 'goaround', ac);
  scoreGoAround(state, ac, reason);
  if (state.life) state.life.landStreak = 0;
  ac.clr = {};
  ac.req = null;
  ac.spdOverride = null;
  if (ac.mode === 'map') {
    ac.phase = PH.MISSED;
    return;
  }
  ac.phase = PH.GOAROUND;
  ac.route = missedRoute(state, ac);
  if (rot) rot.goArounds = (rot.goArounds || 0) + 1;
}

export function divert(state, ac, reason, pen = 'diversion') {
  const rot = getRot(state, ac);
  radio(state, ac.cs, `${tel(ac)}, unable to continue, diverting to alternate.`);
  log(state, 'sys', T`${ac.cs} weicht aus: ${T(reason)}.`);
  notify(state, T`✈️↪ ${ac.cs} ausgewichen (${T(reason)})`, 'bad');
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
      // früh durchstarten, wenn ein Abflug die Bahn sichtbar noch länger belegt (rollt auf, steht bereit oder ist mitten
      // im Startlauf und nicht rechtzeitig weg) – nicht erst knapp über ihm
      if (!ac.decided && rem < 16 && rem >= 7) {
        const b = runwayBlocker(state, ac);
        if (b && (b.phase === PH.LINEUP || b.phase === PH.LINED || (b.phase === PH.TAKEOFF && takeoffLeft(b) > rem / Math.max(0.1, ac.v)))) {
          ac.decided = true;
          goAround(state, ac, T`Piste belegt durch ${b.cs}`);
          if (ac.clr.landGivenBlocked) penalize(state, 'incursion', ac);
          return;
        }
      }
      if (!ac.decided && rem < 7) {
        let blk = runwayBlocker(state, ac);
        // Vorausfliegender rollt schon in den Abrollweg und ist gleich hinter der Haltelinie: Entscheidung bis kurz
        // vor die Schwelle aufschieben statt sofort durchzustarten (vorausschauende Staffelung wie im echten Turm)
        if (blk && blk.phase === PH.ROLLOUT && rem > 2.2 && blk.v > 0.05 && Math.abs(blk.y - stripGeom(blk.strip).y) > 0.3) break;
        ac.decided = true;
        const closed = runwayClosed(state, ac.strip || 'N');
        // „Landung hinter rollendem Verkehr“ (an kleinen Plätzen üblich): ein leichtes Flugzeug darf aufsetzen, wenn der
        // ausrollende Sportflieger vor ihm schon über 280 m weiter die Bahn hinunter ist
        if (blk && blk.phase === PH.ROLLOUT && t.wake === 'L' && t.size === 'S' && AC_TYPES[blk.type] && AC_TYPES[blk.type].light && (blk.x - tdx) * d > 14) blk = null;
        if (blk) {
          goAround(state, ac, T`Piste belegt durch ${blk.cs}`);
          if (ac.clr.landGivenBlocked) penalize(state, 'incursion', ac);
          return;
        }
        if (closed) {
          goAround(state, ac, T`Piste gesperrt – ${closed}`);
          return;
        }
        // Seitenwind mit Böen über dem Limit des Musters bzw. kräftige Böe im kurzen Endanflug
        const wv = !ac.emergency && windGoAround(state, ac);
        if (wv) {
          goAround(state, ac, wv);
          return;
        }
      }
      if (rem <= 0) {
        ac.z = 0;
        ac.phase = PH.ROLLOUT;
        ac.vacated = false;
        ac.decided = false;
        const south = ac.strip === 'S';
        const exits = south ? LY.exitsAheadS(ac.rwy) : LY.exitsAhead(ac.rwy, t.light ? 2.5 : undefined);
        // Bremsen nach dem Aufsetzen: Verkehrsflugzeuge rollen lang aus (Mittelstrecke ≈ 400 m, schwere ≈ 650 m)
        const decel = (t.light ? 0.0123 : t.wake === 'H' ? 0.0031 : 0.0041) * (state.upgrades.rapidExit ? 1.12 : 1) * decelFactor(state, ac.strip || 'N') * randRange(state, 0.85, 1.12);
        const ve = state.upgrades.rapidExit ? 0.19 : t.light ? 0.12 : 0.15; // Abrollgeschwindigkeit (Schnellabrollweg: höher)
        const need = (ac.v * ac.v - ve * ve) / (2 * decel);
        // Abrollweg, an dessen Ende schon jemand wartet (oder gerade hinrollt), überspringen – sonst stehen zwei
        // Flugzeuge übereinander auf dem Rollweg
        const busy = (x) => {
          if (south) return false;
          const p = LY.pathRollout(ac.rwy, x, ac.len), e = p[p.length - 1];
          return state.acs.some((o) => o !== ac && o.mode === 'map' && ((o.phase === PH.ROLLOUT && o.exitX === x) || ((o.phase === PH.VACATED || o.phase === PH.TAXI_IN || o.phase === PH.TAXI_OUT || o.phase === PH.HOLDING) && Math.hypot(o.x - e.x, o.y - e.y) < 0.5 * (o.len + ac.len) + 0.4)));
        };
        let ex = exits.find((x) => Math.abs(x - tdx) >= need && !busy(x)) ?? exits.find((x) => Math.abs(x - tdx) >= need) ?? exits[exits.length - 1];
        ac.exitX = ex;
        ac.decel = decel;
        ac.ve = ve;
        if (south) {
          ac.crossX = LY.crossingFor(ac.rwy, ex);
          ac.path = LY.pathRolloutS(ac.rwy, ex, ac.len, ac.crossX);
        } else {
          ac.path = LY.pathRollout(ac.rwy, ex, ac.len);
          // Ende des Abrollwegs besetzt (z. B. der letzte Abrollweg für schwere Flugzeuge): auf Rollweg A dahinter aufrücken
          const endOf = (q) => (q.phase === PH.ROLLOUT && q.path ? q.path[q.path.length - 1] : q);
          for (let k = 0; k < 3; k++) {
            const e = ac.path[ac.path.length - 1], pr = ac.path[ac.path.length - 2];
            const o = state.acs.find((q) => q !== ac && q.mode === 'map' && [PH.ROLLOUT, PH.VACATED, PH.TAXI_IN].includes(q.phase) && Math.hypot(endOf(q).x - e.x, endOf(q).y - e.y) < 0.5 * (q.len + ac.len));
            if (!o) break;
            ac.path.push({ x: e.x + (Math.sign(e.x - pr.x) || 1) * (0.5 * (o.len + ac.len) + 0.3), y: e.y });
          }
        }
        ac.pi = 0;
        ac.x = ac.path[0].x;
        ac.y = ac.path[0].y;
        touchdown(state, ac);
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
        // Brand/Rauch: auf der Piste anhalten, bis die Feuerwehr gelöscht hat (Piste gesperrt)
        if (ac.emergency && (ac.emgKind === 'engine' || ac.emgKind === 'smoke') && !ac.fireDone) {
          if (!ac.fireStop && ac.v <= ac.ve + 0.03) {
            ac.fireStop = state.time;
            ac.v = 0;
            closeRunway(state, 8, T('Feuerwehreinsatz'), ac.strip || 'N');
            radio(state, ac.cs, ac.emgKind === 'smoke' ? `${tel(ac)}, stopping on the runway, evacuating via the slides, request fire services.` : `${tel(ac)}, stopping on the runway, evacuation not required, request fire services.`);
            if (state.fireAlert) state.fireAlert.stop = true;
          }
          if (ac.fireStop) {
            ac.v = 0;
            const fa = state.fireAlert;
            // Löschen fertig (oder Feuerwehr kommt nicht): nach der Sprühzeit weiter zum Abrollweg
            if ((fa && (fa.sprayed || 0) > 100) || state.time - ac.fireStop > 480 || !fa) {
              ac.fireDone = true;
              ac.v = ac.ve;
              if (fa && (fa.sprayed || 0) > 100) state.life.fireOut = (state.life.fireOut || 0) + 1;
              if (state.rwyClosedWhy === T('Feuerwehreinsatz')) state.rwyClosedUntil = Math.min(state.rwyClosedUntil, state.time + 60);
              radio(state, ac.cs, `${tel(ac)}, fire services report fire extinguished, vacating the runway.`);
            }
            break;
          }
        }
        const dx = Math.abs(ac.exitX - ac.x);
        vmax = Math.sqrt(ac.ve * ac.ve + 2 * ac.decel * Math.max(0, dx - 1.0));
        ac.v = Math.min(ac.v, vmax + 0.01);
        ac.v = Math.max(ac.ve, ac.v - ac.decel * 0.5 * dt);
        advance(state, ac, dt, ac.v, false, true);
      } else {
        const done = followPath(state, ac, dt, ac.vacated ? 0.12 : Math.max(0.12, ac.ve || 0.12)); // zügig von der Bahn, dann Rollgeschwindigkeit
        const clearY = ac.strip === 'S' ? LY.RWY_S.y - LY.RWY_S.hw - 0.9 : LY.HOLD_Y + 0.15;
        if (!ac.vacated && ac.y + ac.len * 0.5 < clearY) {
          ac.vacated = true;
          if (!state.auto.atc) radio(state, ac.cs, `Tower, ${tel(ac)}, runway vacated${ac.clr.taxi ? '' : ', request taxi to stand'}.`);
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
            if (!state.auto.atc) radio(state, ac.cs, `Tower, ${tel(ac)}, holding short runway ${rwyName(state, 'N', ac.rwy)}, request to cross.`);
          } else if (ac.clr.taxi && ac.stand) startTaxiIn(state, ac);
          else if (!ac.stand) {
            // ohne Parkposition zur Warteposition am Rollweg-Ende rollen – hinter die, die dort schon warten oder
            // hinrollen (nach deren Länge), statt auf denselben Platz
            const side = ac.rwy === '27' ? 1 : -1, base = LY.waitSpotX(ac.rwy, ac.len, 0) - side * ac.len / 2;
            let edge = base;
            for (const o of state.acs) {
              if (o === ac || o.waitX == null || o.waitSide !== side || ![PH.TAXI_WAIT, PH.VACATED].includes(o.phase)) continue;
              edge = side > 0 ? Math.max(edge, o.waitX + o.len / 2 + 0.8) : Math.min(edge, o.waitX - o.len / 2 - 0.8);
            }
            ac.waitX = edge + side * ac.len / 2;
            ac.waitSide = side;
            ac.waitedStand = true;
            ac.phase = PH.TAXI_WAIT;
            ac.path = LY.pathToWait(ac.x, ac.rwy, ac.len, 0, ac.waitX);
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
      if (followPath(state, ac, dt, ac.selfOut ? 0.08 : 0.045, !ac.selfOut)) {
        ac.phase = PH.STARTUP;
        ac.startT = state.time;
        ac.v = 0;
        onPushbackDone(state, ac);
      }
      break;
    }
    case PH.STARTUP: {
      ac.engines = true;
      if (state.time - ac.startT > (ac.selfOut ? 5 : 55)) {
        if (ac.clr.taxiOut) startTaxiOut(state, ac);
        else if (ac.req !== 'taxi_out') {
          setReq(state, ac, 'taxi_out');
          radio(state, ac.cs, `Tower, ${tel(ac)}, request taxi.`);
        }
      }
      break;
    }
    case PH.TAXI_OUT: {
      if (followPath(state, ac, dt, 0.13)) {
        ac.phase = PH.HOLDING;
        ac.v = 0;
        ac.waitT = 0;
        if (ac.clr.lineup || ac.clr.takeoff) {
          ac.luWaitBy = lineupWait(state, ac);
          if (!ac.luWaitBy) startLineUp(state, ac);
          else if (ac.clr.takeoff && !slotOpen(state, ac, 45)) holdForSlot(state, ac);
        } else {
          setReq(state, ac, 'takeoff');
          radio(state, ac.cs, `Tower, ${tel(ac)}, holding point runway ${rwyName(state, 'N', ac.rwy)}, ready for departure.`);
        }
      }
      break;
    }
    case PH.HOLDING:
      ac.v = 0;
      // Line up erst, wenn niemand mehr auf der Bahn aufrollt oder dort steht – sonst stehen zwei hintereinander und
      // die ganze Schlange am Rollhalt blockiert
      // erst losrollen, wenn die Rücklesung auf der Frequenz zu hören war
      if ((ac.clr.lineup || ac.clr.takeoff) && rbHeard(state, ac, Math.max(ac.clr.luT ?? -1e9, ac.clr.toT ?? -1e9))) {
        ac.luWaitBy = lineupWait(state, ac);
        if (!ac.luWaitBy) startLineUp(state, ac);
        else if (ac.clr.takeoff && !slotOpen(state, ac, 45)) holdForSlot(state, ac);
      }
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
      else if (ac.clr.takeoff && state.time - (state.lastTakeoff || -1e9) < depGap(state, ac).sec) {
        // Wirbelschleppen bzw. Abstand auf derselben Abflugroute abwarten
        if (!ac.wakeCall) {
          ac.wakeCall = true;
          const g = depGap(state, ac);
          const w = Math.max(1, Math.ceil((g.sec - g.since) / 60));
          if (g.same && g.sec === SID_SAME_SEC) {
            radio(state, ac.cs, `${tel(ac)}, same departure route as the preceding traffic, we'll wait ${w} minute${w > 1 ? 's' : ''} for spacing.`);
            state.stats.today.sidWait = (state.stats.today.sidWait || 0) + 1;
          } else {
            radio(state, ac.cs, `${tel(ac)}, we'll wait ${w} minute${w > 1 ? 's' : ''} for wake turbulence.`);
            state.stats.today.wakeWait = (state.stats.today.wakeWait || 0) + 1;
          }
        }
      } else if (ac.clr.takeoff) {
        // Piste voraus frei?
        const blk = state.acs.find((o) => o !== ac && o.mode === 'map' && ((o.phase === PH.ROLLOUT && !o.vacated && (o.strip || 'N') === 'N') || o.crossing));
        // erst rollen, wenn Freigabe und Rücklesung auf der Frequenz zu hören waren
        const since = state.time - (ac.clr.toT ?? -1e9);
        if (!blk && since >= 3 && rbHeard(state, ac, ac.clr.toT)) {
          ac.phase = PH.TAKEOFF;
          ac.req = null;
          radio(state, ac.cs, `${tel(ac)}, rolling.`, 'sys');
        }
      } else setReq(state, ac, 'takeoff');
      break;
    case PH.TAKEOFF: {
      // Startlauf nach Muster (takeoffPerf): schwere Flugzeuge beschleunigen langsamer, rotieren schneller und steigen flacher
      const tk = AC_TYPES[ac.type], P = takeoffPerf(ac.type);
      const acc = tk.vmax ? (ac.z > 0 ? 0.006 : 0.0095) * (tk.light ? 0.7 : 1) : ac.z > 0 ? Math.min(0.006, P.a * 0.85) : P.a;
      ac.v = Math.min(P.vmax, ac.v + acc * dt);
      ac.x += d * ac.v * dt;
      if (ac.v >= P.vr || ac.z > 0) {
        if (!ac.airborne) {
          ac.airborne = true;
          state.lastTakeoff = state.time;
          state.lastTakeoffWake = ac.wake;
          state.lastTakeoffSid = sidOf(state, ac);
          onTakeoff(state, ac);
          acdmOnTakeoff(state, ac, getRot(state, ac));
        }
        ac.z += ac.v * P.grad * dt;
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
        ac.route = missedRoute(state, ac);
        const rot = getRot(state, ac);
        if (rot) rot.goArounds = (rot.goArounds || 0) + 1;
      }
      break;
    }
  }
}

// Startleistung je Muster: Rotiergeschwindigkeit vr (Kacheln/s; ×323 = kt), Beschleunigung am Boden a, Zeit bis vr,
// Steiggradient und Pistenbelegung occ (s vom Anrollen bis 0,4 über der Bahn). Vr steigt mit dem Gewicht (Regionaljet
// ≈ 120 kt, Mittelstrecke ≈ 145 kt, Superjumbo ≈ 165 kt), der Startlauf dauert länger (≈ 75 s … 170 s, bei 1× rund
// 10 … 23 s) und wird deutlich länger (≈ 14 … 44 Kacheln, also 270 … 870 m), schwere Flugzeuge steigen flacher.
// Sportflugzeuge und Lufttaxi (vmax) wie bisher.
const PERF = new Map();
export function takeoffPerf(type) {
  let p = PERF.get(type);
  if (p) return p;
  const t = AC_TYPES[type];
  if (t.vmax) {
    const vr = Math.min(0.36, t.vapp * 0.0027), a = 0.0095 * (t.light ? 0.7 : 1);
    p = { vr, a, roll: vr / a, grad: 0.11, vmax: 0.42 };
  } else {
    const lm = Math.log2(Math.max(5, t.mtow) / 20);
    const vr = Math.min(175, t.vapp * (1 + 0.04 * lm)) / 323;
    const roll = clamp(76 + 20 * Math.log2(Math.max(5, t.mtow) / 23), 68, 176);
    p = { vr, a: vr / roll, roll, grad: clamp(0.125 - 0.009 * lm, 0.075, 0.12), vmax: 0.75 };
  }
  p.occ = p.roll + 0.4 / (p.grad * p.vr);
  PERF.set(type, p);
  return p;
}
// Pistenbelegung einer Landung in Sekunden (Ausrollen bis zur Abrollgeschwindigkeit, dann Abrollen von der Bahn)
export function landingRot(type) {
  const t = AC_TYPES[type], v = t.vapp * 0.0031, decel = t.light ? 0.0123 : t.wake === 'H' ? 0.0031 : 0.0041, ve = t.light ? 0.12 : 0.15;
  return Math.max(0, v - ve) / decel + 3.6 / ve;
}
// Sekunden, bis ein startendes Flugzeug 0,4 über der Bahn ist (dann gilt die Piste als frei)
function takeoffLeft(b) {
  const p = takeoffPerf(b.type);
  if (b.z > 0) return Math.max(0, 0.4 - b.z) / Math.max(0.05, b.v * p.grad);
  return Math.max(0, p.vr - b.v) / p.a + 0.4 / (p.grad * p.vr);
}
// zusätzlicher Abstand (NM) zur nächsten Landung, den ein langer Startlauf braucht (Bezug: 48 s Pistenbelegung,
// Anflug mit rund 140 kt ≈ 0,04 NM/s)
export function takeoffExtraNm(ac) {
  return ac ? Math.max(0, (takeoffPerf(ac.type).occ - 48) * 0.04) : 0;
}

function toAirDeparture(state, ac) {
  const rot = getRot(state, ac);
  const nm = LY.tileToNm(ac.x, ac.y);
  ac.mode = 'air';
  ac.pos = nm;
  const tdep = AC_TYPES[ac.type];
  // Höhe an der Übergabe wie auf der Karte (z · 2 Kacheln in 3D ≈ z · 131 ft): schwere Flugzeuge kommen tiefer an
  ac.alt = tdep.vmax ? 1200 : Math.round(clamp(ac.z * 131, 500, 1200) / 50) * 50;
  ac.crs = AS.finalCrs(ac.rwy);
  ac.spd = Math.min(180, tdep.vmax || 180);
  ac.tSpd = Math.min(250, tdep.vmax || 250);
  ac.tAlt = tdep.vmax ? tdep.cruise : 24000;
  ac.phase = PH.DEPART;
  const brg = rot ? CITIES[rot.city].brg : 0;
  ac.route = AS.departureRoute(ac.rwy, brg + randRange(state, -6, 6), tdep.vmax ? 26 : undefined);
  ac.trail = [];
  ac.stand = null;
  ac.req = null;
  if (!state.auto.atc) radio(state, ac.cs, tdep.vmax ? `${tel(ac)}, airborne, climbing ${fmtAlt(ac.tAlt)}.` : `${tel(ac)}, passing 1500 feet, climbing FL240.`);
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
  // Kleinflugzeuge und Lufttaxis rollen aus eigener Kraft vom Platz
  const self = AC_TYPES[ac.type].selfTaxi;
  ac.path = self ? LY.pathPowerOut(st, ac.len, ac.rwy) : LY.pathPushback(st, ac.len, ac.rwy);
  ac.pi = 0;
  ac.rev = !self;
  ac.selfOut = self;
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
// Wer steht der Auffahrt auf die Startbahn im Weg? (ein anderer Abflug beim Aufrollen, aufgerollt oder ganz am
// Anfang seines Startlaufs)
export function lineupBlocker(state, ac) {
  for (const o of state.acs) {
    if (o === ac || o.mode !== 'map') continue;
    if (o.phase === PH.LINEUP || o.phase === PH.LINED) return o;
    if (o.phase === PH.TAKEOFF && o.z === 0 && o.v < 0.12) return o;
  }
  return null;
}
// Grund, am Rollhalt zu bleiben: Bahn noch besetzt oder Slot (CTOT) noch nicht offen – mit Slot nicht auf die Piste,
// sonst steht er dort minutenlang und blockiert Landungen und Starts
function lineupWait(state, ac) {
  const lb = lineupBlocker(state, ac);
  if (lb) return lb.cs;
  if (!slotOpen(state, ac, 90)) {
    const rot = getRot(state, ac);
    return rot && rot.ctot ? `Slot ${String(Math.floor((rot.ctot % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((rot.ctot % 3600) / 60)).padStart(2, '0')}` : 'Slot';
  }
  return null;
}
export function startLineUp(state, ac) {
  ac.luWaitBy = null;
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
  // Cessna beim Touch-and-Go (Platzrunden)
  if (strip === 'N' && state.vfrOcc && state.vfrOcc.block && !ac.vfr) return state.vfrOcc;
  return null;
}
export function runwayOccupants(state, strip = 'N') {
  const vfr = strip === 'N' && state.vfrOcc ? [state.vfrOcc] : [];
  return vfr.concat(state.acs.filter((o) => o.mode === 'map' && ((o.phase === PH.ROLLOUT && !o.vacated && (o.strip || 'N') === strip) || (strip === 'N' && (o.phase === PH.LINEUP || o.phase === PH.LINED || (o.phase === PH.TAKEOFF && o.z < 0.6) || o.crossing)) || (o.phase === PH.FINAL && o.z < 1.0 && (o.strip || 'N') === strip) || (o.phase === PH.MISSED && o.z < 0.6 && (o.strip || 'N') === strip))));
}
// Kann ein Flugzeug jetzt die Nordbahn kreuzen?
export function crossingSafe(state) {
  if (state.vfrOcc) return false;
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
  const x0 = ac.x, y0 = ac.y, pi0 = ac.pi;
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
  const h0 = ac.hdg;
  const la = lookAhead(ac, 0.35);
  if (la) {
    let h = Math.atan2(la.y - ac.y, la.x - ac.x);
    if (reverse) h += Math.PI;
    const diff = angNorm(h - ac.hdg);
    ac.hdg = angNorm(ac.hdg + clamp(diff, -2.5 * dt, 2.5 * dt));
  }
  // harte Abstandsregel: nie in ein anderes Flugzeug hineinrollen oder -schwenken – dann bleibt es stehen
  const hit = hardHit(state, ac, x0, y0, h0);
  if (hit) {
    ac.x = x0;
    ac.y = y0;
    ac.pi = pi0;
    ac.hdg = h0;
    ac.v = 0;
    ac.hardBlock = hit;
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
// Flugzeuge am Boden, die einander im Weg sein können
const onGround = (b) => b.mode === 'map' && !COLLIDE_SKIP.has(b.phase) && !(b.z > 0.3);
// ---- Umriss am Boden: Rumpf, Tragfläche und Höhenleitwerk als Linien mit Dicke (in Kacheln) ----
// Spannweite im Verhältnis zur Länge: Großraum ~0,9 (Superjumbo 1,1), Mittelstrecke ~0,92, Regional 1,05, Sportflieger 1,3
const spanOf = (ac) => {
  const t = AC_TYPES[ac.type] || {};
  return ac.len * (ac.type === 'A388' ? 1.1 : t.light ? 1.3 : t.size === 'L' ? 0.9 : t.size === 'S' ? 1.05 : 0.92);
};
// Rücklesung gehört? Die Spieluhr läuft schon bei 1× 7,5-mal so schnell wie die echte Zeit – das Sicherheitsnetz
// (falls die Sprachausgabe hängt) zählt daher in Echtzeit, rund 45 s; die Sprachausgabe selbst gibt nach 40 s frei
function rbHeard(state, ac, t) {
  return !speech.pending(ac.cs) || state.time - (t ?? -1e9) >= 45 * TIME_SCALE * Math.max(1, state.speed || 1);
}
function shapeOf(ac, x = ac.x, y = ac.y, hdg = ac.hdg || 0) {
  return shapeAt(x, y, hdg, ac.len, spanOf(ac));
}
const reach = (ac) => 0.5 * Math.max(ac.len, spanOf(ac)) + 0.1;
// Überdecken sich die vollen Flügel zweier Flugzeuge (Spitzen)? – für die Auswertung in Tests
export function wingTouch(a, b) {
  return wingsTouch(shapeOf(a), shapeOf(b));
}
// Lücke zwischen zwei Flugzeugen (ac optional an anderer Stelle bzw. mit anderem Kurs)
export function gapBetween(ac, b, x = ac.x, y = ac.y, hdg = ac.hdg) {
  if (Math.hypot(b.x - x, b.y - y) > reach(ac) + reach(b) + 1) return 9;
  return shapeGap(shapeOf(ac, x, y, hdg), shapeOf(b));
}
const HARD_GAP = 0.05; // nie näher (≈ 1 m)
const SAFE_GAP = 0.3; // Rollabstand (≈ 5 m)
// Würde ac mit der Bewegung von (x0, y0) an die aktuelle Position ein anderes Flugzeug berühren?
function hardHit(state, ac, x0, y0, h0 = ac.hdg) {
  if (!onGround(ac)) return null;
  for (const b of state.acs) {
    if (b === ac || !onGround(b)) continue;
    const g1 = gapBetween(ac, b);
    if (g1 >= HARD_GAP) continue;
    // schon zu nah (alter Spielstand): nur Bewegungen, die die Lage verbessern
    if (g1 < gapBetween(ac, b, x0, y0, h0) - 1e-6) return b;
  }
  return null;
}
function checkBlocked(state, ac, look) {
  // noch nicht von der Bahn: Abflüge in der Schlange vor dem Rollhalt halten ihn nicht auf der Piste fest (sonst wartet
  // der vorderste Abflug auf die freie Bahn und die Bahn auf die Schlange – Patt)
  const vacating = ac.phase === PH.ROLLOUT && !ac.vacated;
  const pts = samplesAhead(ac, look);
  if (!pts.length) return null;
  const la = pts[0];
  let mdx = la.x - ac.x, mdy = la.y - ac.y;
  const ml = Math.hypot(mdx, mdy) || 1;
  mdx /= ml;
  mdy /= ml;
  for (const b of state.acs) {
    if (b === ac || b.mode !== 'map' || COLLIDE_SKIP.has(b.phase) || b.z > 0.3) continue;
    if (vacating && (b.phase === PH.TAXI_OUT || b.phase === PH.HOLDING)) continue;
    const dx = b.x - ac.x, dy = b.y - ac.y;
    const dd = Math.hypot(dx, dy);
    if (dd > look + reach(ac) + reach(b) + 0.5) continue;
    if (dx * mdx + dy * mdy < 0.15 * dd) continue;
    if (pathHits(ac, b, pts, b.phase === PH.STAND ? HARD_GAP + 0.05 : SAFE_GAP)) return b;
  }
  return null;
}
// Berührt ac auf den Punkten pts (mit Kurs entlang des Weges) das Flugzeug b (bzw. b an Position bp)?
function pathHits(ac, b, pts, gap, bp = null) {
  const sb = bp ? shapeOf(b, bp.x, bp.y) : shapeOf(b);
  const bx = bp ? bp.x : b.x, by = bp ? bp.y : b.y;
  let px = ac.x, py = ac.y;
  const flip = ac.phase === PH.PUSH && ac.rev ? Math.PI : 0; // Pushback: Heck voraus
  for (const p of pts) {
    const h = Math.atan2(p.y - py, p.x - px) + flip;
    px = p.x;
    py = p.y;
    if (Math.hypot(bx - p.x, by - p.y) > reach(ac) + reach(b) + gap) continue;
    if (shapeGap(shapeOf(ac, p.x, p.y, h), sb) < gap) return true;
  }
  return false;
}

function followPath(state, ac, dt, vmax, reverse = false) {
  const path = ac.path;
  if (ac.yieldBack && yieldStep(state, ac, dt)) return false;
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
  if (blk) vt = 0;
  if (ac.v < vt) ac.v = Math.min(vt, ac.v + 0.0045 * dt);
  else ac.v = Math.max(vt, ac.v - 0.02 * dt);
  ac.hardBlock = null;
  if (ac.v > 0) advance(state, ac, dt, ac.v, reverse);
  const by = blk || ac.hardBlock;
  if (by) {
    ac.blockedBy = by.id;
    ac.blockedT += dt;
  } else {
    ac.blockedBy = null;
    ac.blockedT = 0;
  }
  if (rem < 0.02 && ac.pi >= path.length - 2) {
    const last = path[path.length - 1];
    ac.x = last.x;
    ac.y = last.y;
    ac.pi = path.length - 1;
  }
  return ac.pi >= path.length - 1;
}

// ---- Blockaden ohne Durchrollen auflösen ----
// Rückwärts entlang des eigenen Weges (Schlepper zieht zurück): Position nach dist Kacheln, oder null, wenn dahinter
// jemand steht bzw. der Weg nicht so weit zurückreicht
function retreatPos(state, ac, dist, ignore) {
  const path = ac.path;
  if (!path || !path.length) return null;
  let x = ac.x, y = ac.y, i = Math.min(ac.pi, path.length - 1), left = dist;
  while (left > 1e-6) {
    const a = path[i];
    const seg = Math.hypot(a.x - x, a.y - y);
    if (seg < 1e-6) {
      if (i === 0) return null;
      i--;
      continue;
    }
    const st = Math.min(seg, left, 0.3);
    x += ((a.x - x) / seg) * st;
    y += ((a.y - y) / seg) * st;
    left -= st;
    for (const o of state.acs) {
      if (o === ac || o === ignore || !onGround(o)) continue;
      const g = gapBetween(ac, o, x, y);
      if (g < HARD_GAP + 0.15 && g < gapBetween(ac, o)) return null;
    }
  }
  return { x, y };
}
// Wäre w's Weg frei, wenn y an Position p stünde?
function pathClearOf(w, y, p) {
  return !pathHits(w, y, samplesAhead(w, 3.2), SAFE_GAP, p);
}
// Kann y so weit zurückweichen, dass w vorbeikommt? Liefert die nötige Strecke oder 0
const YIELD_PHASES = new Set([PH.PUSH, PH.TAXI_IN, PH.TAXI_OUT]);
export function yieldDist(state, y, w) {
  if (!YIELD_PHASES.has(y.phase) || y.yieldBack || (y.prioUntil > state.time && !(w.prioUntil > state.time))) return 0;
  for (const d of [1.2, 2, 3, 4.5, 6]) {
    const p = retreatPos(state, y, d, w);
    if (!p) return 0;
    if (pathClearOf(w, y, p)) return d;
  }
  return 0;
}
export function startYield(state, y, w, d) {
  y.yieldBack = { left: d, w: w.id, t0: state.time, wx: w.x, wy: w.y };
  y.blockedT = 0;
  y.v = 0;
}
// Schlepper zieht ac entlang des eigenen Weges zurück (höchstens dist, nie in ein anderes Flugzeug); liefert die Strecke
function retreatMove(state, ac, dist) {
  const path = ac.path;
  let left = dist, moved = 0;
  ac.pi = Math.min(ac.pi, path.length - 1);
  while (left > 1e-6) {
    const a = path[ac.pi];
    const seg = Math.hypot(a.x - ac.x, a.y - ac.y);
    if (seg < 1e-6) {
      if (ac.pi === 0) break;
      ac.pi--;
      continue;
    }
    const st = Math.min(seg, left);
    const nx = ac.x + ((a.x - ac.x) / seg) * st, ny = ac.y + ((a.y - ac.y) / seg) * st;
    for (const o of state.acs) {
      if (o === ac || !onGround(o)) continue;
      const g = gapBetween(ac, o, nx, ny);
      if (g < HARD_GAP && g < gapBetween(ac, o)) return moved;
    }
    ac.x = nx;
    ac.y = ny;
    left -= st;
    moved += st;
  }
  return moved;
}
// ein Schritt Zurückweichen bzw. Warten, bis der andere vorbei ist; true = followPath übernimmt nicht
function yieldStep(state, ac, dt) {
  const yb = ac.yieldBack;
  ac.v = 0;
  ac.blockedBy = null;
  ac.blockedT = 0;
  if (yb.left > 0.005) {
    const st = Math.min(yb.left, 0.05 * dt); // etwa Pushback-Tempo
    const m = retreatMove(state, ac, st);
    yb.left = m < st * 0.5 ? 0 : yb.left - m;
    return true;
  }
  const w = state.acs.find((o) => o.id === yb.w);
  // erst weiter, wenn der andere wirklich vorbeigerollt ist (nicht nur, weil der Weg kurz frei aussieht – sonst
  // rollen beide wieder aufeinander zu)
  const moved = w && Math.hypot(w.x - (yb.wx ?? w.x), w.y - (yb.wy ?? w.y)) > Math.max(1.5, w.len * 0.6);
  const gone = !w || !onGround(w) || (moved && pathClearOf(w, ac, ac) && gapBetween(ac, w) > 0.6 && checkBlocked(state, ac, 3) !== w);
  if (gone || state.time - yb.t0 > 150) {
    ac.yieldBack = null;
    return false;
  }
  return true;
}
// Gegenseitige Blockaden auflösen: niemand rollt durch einen anderen hindurch – wer zurückweichen kann, wird ein
// Stück zurückgeschleppt (Pushback abbrechen, zurück auf die Position bzw. ein Stück den Rollweg zurück)
function resolveDeadlocks(state) {
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  const tryYield = (cands, why) => {
    for (const [y, w] of cands) {
      const d = yieldDist(state, y, w);
      if (!d) continue;
      startYield(state, y, w, d);
      if (!state.auto.atc && (state.role === 'tower' || state.role === 'ground') && !y.dlWarned) {
        y.dlWarned = true;
        notify(state, T`⚠ Rollverkehr verkeilt: ${why} – ein Schlepper zieht ${y.cs} ein Stück zurück, damit ${w.cs} vorbeikommt`, 'warn');
      }
      return true;
    }
    return false;
  };
  // Kreis aus drei oder mehr Flugzeugen, die aufeinander warten
  for (const a of state.acs) {
    if (!a.blockedBy || a.yieldBack || a.blockedT < 10) continue;
    const ring = [a];
    let c = byId.get(a.blockedBy);
    while (c && c !== a && c.blockedBy && c.blockedT >= 10 && ring.length < 8 && !ring.includes(c)) {
      ring.push(c);
      c = byId.get(c.blockedBy);
    }
    if (c === a && ring.length > 2) {
      // wer im Kreis zurückweicht, macht den Weg für den frei, der auf ihn wartet
      const cands = ring.map((y, i) => [y, ring[(i + ring.length - 1) % ring.length]]).sort((p, q) => (q[0].phase === PH.PUSH) - (p[0].phase === PH.PUSH));
      tryYield(cands, ring.map((r) => r.cs).join(', '));
    }
  }
  // zwei, die sich gegenseitig im Weg stehen
  for (const a of state.acs) {
    if (!a.blockedBy || a.yieldBack) continue;
    const b = byId.get(a.blockedBy);
    if (!b || b.blockedBy !== a.id || b.yieldBack || a.blockedT < 8 || b.blockedT < 8) continue;
    // Vorrang (Spieler), sonst zuerst der mit Schlepper (Pushback), dann Abflüge vor Ankünften
    const rank = (x) => (x.prioUntil > state.time ? -10 : 0) + (x.phase === PH.PUSH || x.phase === PH.STARTUP ? 3 : 0) + (x.arr ? 0 : 1);
    const order = rank(a) >= rank(b) ? [[a, b], [b, a]] : [[b, a], [a, b]];
    tryYield(order, T`${a.cs} und ${b.cs}`);
  }
}
