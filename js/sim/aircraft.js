// Flugzeuge: Lebenszyklus, Navigation im Luftraum, Bewegung auf der Karte
import { windGoAround, gustPeak } from './gusts.js';
import { AC_TYPES, AIRLINES, CITIES, AIRPORT } from '../config.js';
import { touchdown } from './touchdown.js';
import { assignLook } from './spotter.js';
import { clamp, dist, degDiff, degNorm, DEG, rand, randInt, randRange, angNorm, pathLength } from '../util.js';
import * as LY from '../layout.js';
import * as AS from './airspace.js';
import { radio, log, notify } from './messages.js';
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
export const windStr = (state) => T`wind ${String(Math.round(state.wind.dir / 10) * 10).padStart(3, '0')} degrees ${Math.round(state.wind.spd)} knots` + (gustPeak(state) ? ` gusting ${gustPeak(state)}` : '');

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
    blockedBy: null, blockedT: 0, ghostUntil: 0,
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
      const fix = a.holdFix;
      const busy = state.acs.some((o) => o !== a && o.mode === 'air' && Math.hypot(o.pos.x - fix.x, o.pos.y - fix.y) < 8 && Math.abs(o.alt - L) < 900);
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
    notify(state, T`⛽ ${ac.cs}: MINIMUM FUEL – bald Anflug freigeben`, 'warn');
    log(state, 'sys', T`${ac.cs} meldet Minimum Fuel (noch ca. ${Math.round(ac.fuelMin)} min Reserve).`);
    state.stats.today.minFuel = (state.stats.today.minFuel || 0) + 1;
  }
  if (ac.fuelMin <= 5 && !ac.fuelEmergency) {
    ac.fuelEmergency = true;
    ac.emergency = true;
    ac.squawk = '7700';
    radio(state, ac.cs, `MAYDAY MAYDAY MAYDAY, ${tel(ac)}, fuel emergency, request immediate approach.`);
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
    radio(state, ac.cs, `${tel(ac)}, ${smallField(state) ? 'final' : 'established ILS'} runway ${rwyName(state, ac.strip || 'N', ac.rwy)}${ac.clr.land ? '' : ', request landing'}.`);
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
  radio(state, 'TWR', `${tel(ac)}, after departure end turn ${side * s > 0 ? 'right' : 'left'}, climb 3000 feet, traffic ahead on the missed approach.`, 'atc');
  return [{ x: AS.THR[ac.rwy].x - s * 2.5, y: side * 3.2, name: '' }, { x: AS.THR[ac.rwy].x - s * 6, y: side * 3.2, name: '', missedEnd: true }];
}

export function goAround(state, ac, reason) {
  const rot = getRot(state, ac);
  state.stats.today.goArounds++;
  radio(state, ac.cs, `${tel(ac)}, going around${reason ? '' : ''}.`);
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
          return state.acs.some((o) => o !== ac && o.mode === 'map' && ((o.phase === PH.ROLLOUT && o.exitX === x) || ((o.phase === PH.VACATED || o.phase === PH.TAXI_IN) && Math.hypot(o.x - e.x, o.y - e.y) < 0.5 * (o.len + ac.len))));
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
        if (!blk) {
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
    // Schlange vor dem Rollhalt: hinter einem Abflug zur selben Piste wird gewartet, nicht hindurchgerollt (sonst
    // stehen am Ende zwei Flugzeuge übereinander am Haltepunkt)
    const queue = a.phase === PH.TAXI_OUT && [PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED].includes(b.phase) && a.rwy === b.rwy;
    const stuckOnParked = !queue && a.blockedT > 120 && [PH.STAND, PH.STARTUP, PH.VACATED, PH.HOLDING].includes(b.phase) && b.v === 0 && !b.blockedBy;
    const longStuck = a.blockedT > (queue ? 1800 : 400);
    if (mutual || stuckOnParked || longStuck) {
      const loser = mutual ? (a.id < b.id ? a : b) : a;
      // Hinweis an den Spieler: Rollverkehr hat sich verkeilt (die Simulation löst es auf, der eine rollt vorbei)
      if (mutual && !state.auto.atc && (state.role === 'tower' || state.role === 'ground') && !a.dlWarned) {
        a.dlWarned = b.dlWarned = true;
        notify(state, T`⚠ Rollverkehr verkeilt: ${a.cs} und ${b.cs} standen sich im Weg – künftig einen per „Halt“ warten lassen`, 'warn');
      }
      loser.ghostUntil = state.time + 40;
      loser.blockedT = 0;
    }
  }
}
