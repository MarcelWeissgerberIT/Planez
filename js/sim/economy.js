// Wirtschaft: Erlöse, Kosten, Ausbau, Management-KI
import { gradeOf } from './touchdown.js';
import { AC_TYPES, AIRLINES, COSTS, VEH_TYPES, UPGRADES, STAND_COSTS, MARKETING, FEE_LIMITS, CITIES } from '../config.js';
import { clamp, fmtMoney, rand, dayOf } from '../util.js';
import { log, notify, fx } from './messages.js';
import { newsDayEnd } from './news.js';
import { acceptOffer, feeIndex, standDemand } from './schedule.js';
import { diff } from './difficulty.js';
import { scoreLanding, scoreTakeoff, scoreOffBlock, scoreIncident, scoreDayEnd, scoreState } from './score.js';
import { makeVehicle, freeBay, vehicleAvailable, efficiency } from './ground.js';
import { PH } from './aircraft.js';
import { startProject, standProject, projectFor, standBuildHours, upgradeHours, STAND_HOURS, UPGRADE_NAMES, RWY_WORKS, projects } from './construction.js';
import { onNightMovement, takeLoan, repayLoan, loanLimit, loans } from './finance.js';
import { rwyCond } from './runway.js';
import { bump } from './goals.js';

export const REV_CATS = { landing: 'Landegebühren', pax: 'Passagierentgelte', parking: 'Parkpositionen', handling: 'Abfertigung', fuel: 'Kerosinverkauf (Marge)', retail: 'Shops & Gastro', carpark: 'Parken (Landseite)', cargo: 'Fracht', hotel: 'Hotel', night: 'Nacht-/Lärmentgelte', deice: 'Enteisung', energy: 'Stromverkauf (Solar)', rail: 'Bahnhof', other: 'Sonstiges' };
export const COST_CATS = { staff: 'Personal Boden', atc: 'Flugsicherung', infra: 'Instandhaltung', vehicles: 'Fahrzeuge', admin: 'Verwaltung', utilities: 'Energie & Betrieb', penalties: 'Vertragsstrafen & Bußgelder', incidents: 'Vorfälle', marketing: 'Marketing', interest: 'Kreditzinsen' };

export function earn(state, cat, amount) {
  if (!amount) return;
  state.cash += amount;
  state.ledger.rev[cat] = (state.ledger.rev[cat] || 0) + amount;
}
export function spend(state, cat, amount) {
  if (!amount) return;
  state.cash -= amount;
  state.ledger.cost[cat] = (state.ledger.cost[cat] || 0) + amount;
}
export function capex(state, amount, what) {
  state.cash -= amount;
  state.ledger.capex += amount;
  log(state, 'mgr', `Investition: ${what} (${fmtMoney(amount)}).`);
}
const rep = (state, d) => (state.reputation = clamp(state.reputation + d, 0, 100));

function contractOf(state, rot) {
  return rot && rot.contract ? state.contracts.find((c) => c.id === rot.contract) : null;
}

// Bewegungen je Stunde (für das Tagesdiagramm)
function hourBump(state, key) {
  const t = state.stats.today;
  if (!t[key]) t[key] = new Array(24).fill(0);
  t[key][Math.floor((state.time % 86400) / 3600)]++;
}

// ---------- Ereignisse aus dem Betrieb ----------
export function onLanding(state, ac) {
  scoreLanding(state, ac);
  const t = AC_TYPES[ac.type];
  const rot = state.rots[ac.rot];
  const fee = state.fees.landing * t.mtow * (rot?.feeMult || 1);
  earn(state, 'landing', fee);
  const g = ac.tdFpm ? gradeOf(ac.tdFpm) : null;
  fx(state, ac.x, ac.y, g ? `🛬 ${ac.tdFpm} ft/min ${g[2] || g[1]} · +${fmtK(fee)}` : `🛬 Landung · +${fmtK(fee)}`, g ? g[3] : 'good');
  state.stats.today.mov++;
  hourBump(state, 'arrH');
  onNightMovement(state, ac, earn, spend);
  bump(state, 'landings');
  bump(state, 'landStreak');
  bump(state, 'safeStreak');
  if (ac.wakeReq > 3 && !ac.wakeBad) bump(state, 'wakeStreak');
  if (rot) bump(state, 'pax', rot.paxIn);
  if (ac.type === 'A388') {
    state.life.a380landed = (state.life.a380landed || 0) + 1;
    rep(state, 1);
    fx(state, ac.x, ac.y - 1, '🐋 Superjumbo gelandet – die Spotter jubeln!', 'good');
    log(state, 'mgr', `${ac.cs}: Airbus A380 gelandet – ${rot ? rot.paxIn : 500} Reisende, Spotter säumen den Zaun (+1 Ansehen).`);
  }
  if (rot) {
    rot.status = 'landed';
    if (ac.emergency) state.life.emgLanded = (state.life.emgLanded || 0) + 1;
    rot.landT = state.time;
    state.stats.today.pax += rot.paxIn;
  }
}

export function onOffBlock(state, ac, rot) {
  const t = AC_TYPES[ac.type];
  const hours = Math.max(0, (rot.offBlock - (rot.onBlock || rot.offBlock)) / 3600 - 0.5);
  const sizeF = { S: 0.6, M: 1, L: 1.8 }[t.size];
  earn(state, 'parking', hours * state.fees.parking * sizeF);
  // ATFM-Slotverspätung (Verkehrsflusssteuerung) zählt nicht als Flughafenverspätung
  const delay = (rot.offBlock - rot.std - (rot.atfm || 0)) / 60;
  rot.depDelay = Math.round(delay);
  const td = state.stats.today;
  if (delay > 15 && (!td.peakDelay || delay > td.peakDelay.min)) td.peakDelay = { cs: rot.depNo || ac.cs, min: Math.round(delay) };
  fx(state, ac.x, ac.y, delay <= 5 ? '✓ pünktlich' : delay <= 15 ? `+${Math.round(delay)}′` : `+${Math.round(delay)}′ verspätet`, delay <= 5 ? 'good' : delay <= 15 ? 'warn' : 'bad');
  if (delay <= 5) bump(state, 'depPunctual');
  const quick = rot.onBlock && rot.offBlock - rot.onBlock <= (t.turn + 5) * 60;
  if (quick) bump(state, 'quickTurns');
  scoreOffBlock(state, ac, delay, quick);
  if ((rot.tobt || rot.std) <= rot.std) bump(state, 'tobtKept');
  const attributable = delay - Math.max(0, rot.arrDelay);
  const c = contractOf(state, rot);
  if (delay <= 15) {
    state.stats.today.onTime++;
    rep(state, 0.05);
    if (c) c.sat = clamp(c.sat + 0.6, 0, 100);
  } else {
    state.stats.today.delayed++;
    state.stats.today.delayMin += delay;
    if (attributable > 15) {
      spend(state, 'penalties', (attributable - 15) * COSTS.delayPerMin);
      rep(state, -0.15);
      if (c) c.sat = clamp(c.sat - 2, 0, 100);
    }
  }
}

export function onTakeoff(state, ac) {
  const t = AC_TYPES[ac.type];
  const rot = state.rots[ac.rot];
  let sum = 0;
  const earnF = (cat, v) => {
    sum += v;
    earn(state, cat, v);
  };
  state.stats.today.mov++;
  hourBump(state, 'depH');
  onNightMovement(state, ac, earn, spend);
  bump(state, 'safeStreak');
  if (!rot) return;
  scoreTakeoff(state, ac);
  bump(state, 'pax', rot.paxOut);
  if ((rot.taxiWait || 0) < 120) bump(state, 'lowWaitDeps');
  rot.status = 'departed';
  rot.atd = state.time;
  const mult = rot.feeMult || 1;
  const u = state.upgrades;
  state.stats.today.pax += rot.paxOut;
  earnF('pax', rot.paxOut * state.fees.pax * mult);
  const handling = ({ S: 900, M: 1400, L: 3200 }[t.size] + (t.cargo ? 1200 : 0)) * ((rot.depDelay ?? 0) > 15 ? 0.85 : 1);
  earnF('handling', handling);
  const satF = clamp(0.75 + state.reputation / 250 + u.security * 0.04, 0.6, 1.2);
  earnF('retail', (rot.paxIn + rot.paxOut) * 6.5 * (1 + 0.3 * u.retail) * satF);
  earnF('carpark', rot.paxOut * 2.1 * (1 + 0.4 * u.parking) * (u.rail ? 0.85 : 1));
  if (t.cargo) earnF('cargo', (rot.cargoIn + rot.cargoOut) * 55);
  else earnF('cargo', (rot.cargoIn + rot.cargoOut) * 40);
  if (rot.special === 'vip') earnF('other', 18000);
  if (rot.special === 'state') earnF('other', state.sv && state.sv.arrOk && state.sv.depOk ? 60000 : 30000); // Protokollgebühr
  fx(state, ac.x, ac.y, `🛫 +${fmtK(sum)}`, 'cash');
}

const PEN = {
  goaround: { rep: -0.3, cost: 1500, cat: 'incidents' },
  diversion: { rep: -2, cost: 15000, cat: 'incidents' },
  separation: { rep: -1.5, cost: 40000, cat: 'incidents' },
  airprox: { rep: -5, cost: 250000, cat: 'incidents' },
  incursion: { rep: -3, cost: 80000, cat: 'incidents' },
  fuelEmergency: { rep: -1.5, cost: 20000, cat: 'incidents' },
  diversionWx: { rep: -0.6, cost: 8000, cat: 'incidents', minor: true },
  wake: { rep: -0.6, cost: 12000, cat: 'incidents', minor: true },
  readback: { rep: -1, cost: 8000, cat: 'incidents', minor: true },
  turbulence: { rep: -0.8, cost: 9000, cat: 'incidents', minor: true },
};
export function penalize(state, kind, ac) {
  const p = PEN[kind];
  if (!p) return;
  const f = diff(state).penalty;
  rep(state, p.rep * f);
  spend(state, p.cat, p.cost * f);
  if (kind !== 'goaround' && !p.minor) {
    state.stats.today.incidents++;
    scoreIncident(state, ac);
  }
  if (state.life && kind !== 'wake') state.life.safeStreak = 0;
}

// ---------- Laufende Kosten ----------
export function dailyFixedCosts(state) {
  const u = state.upgrades;
  const built = state.stands.filter((s) => s.built).length;
  const bf = (state.board && state.board.costF) || 1; // Aufsichtsrat: Effizienz-Strategie
  const fc = {
    staff: state.staff * COSTS.staffDaily,
    atc: COSTS.atcDaily,
    infra: built * COSTS.standDaily + COSTS.runwayDaily * (1 + (u.rwy2 || 0)) + COSTS.terminalDaily * (1 + 0.08 * (u.retail + u.security + u.lounge)),
    vehicles: state.vehicles.reduce((t, v) => t + VEH_TYPES[v.type].upkeep, 0),
    admin: COSTS.adminDaily,
    utilities: COSTS.utilitiesDaily * (u.apronLights ? 0.85 : 1) * (1 + 0.05 * u.parking) * (u.solar ? 0.4 : 1),
  };
  if (bf !== 1) for (const k of Object.keys(fc)) fc[k] *= bf;
  return fc;
}

export function updateEconomy(state, dt) {
  const hour = Math.floor(state.time / 3600);
  if (state.lastHour === undefined) state.lastHour = hour;
  while (state.lastHour < hour) {
    state.lastHour++;
    hourly(state);
  }
}

function hourly(state) {
  const fc = dailyFixedCosts(state);
  for (const [k, v] of Object.entries(fc)) spend(state, k, v / 24);
  if (state.upgrades.hotel) earn(state, 'hotel', 21000 / 24);
  // Solarstrom (tagsüber) und Anteil an Bahnfahrkarten
  const hh = (state.time / 3600) % 24;
  if (state.upgrades.solar && hh > 7 && hh < 19) earn(state, 'energy', (9000 / 12) * (state.weather.kind === 'clear' ? 1.3 : state.weather.kind === 'clouds' ? 0.8 : 0.45));
  if (state.upgrades.rail) earn(state, 'rail', 7000 / 24);
  // Airline-Zufriedenheit driftet mit Gebühren/Ansehen
  const fi = feeIndex(state);
  const nightF = state.settings.curfew ? 22 : ((state.fees.night ?? 600) / 4000) * 12;
  for (const c of state.contracts) {
    const t = AC_TYPES[c.type];
    // Frachtairlines fliegen nachts: Nachtflugverbot und hohe Nachtentgelte stören sie
    const target = clamp(72 - (fi - 1) * 55 + (t.size === 'L' && state.upgrades.lounge ? 6 : 0) + (state.reputation - 60) * 0.15 - (c.cargo ? nightF : 0), 5, 98);
    c.sat += (target - c.sat) * 0.02;
  }
  rep(state, (1 - fi) * 0.08 + state.upgrades.security * 0.01 + state.upgrades.hotel * 0.01 + (state.settings.curfew ? 0.015 : 0));
  state.hourTick = (state.hourTick || 0) + 1;
  if (state.auto.manager) autoManager(state);
  // Insolvenz-Warnung
  if (state.cash < 0 && state.hourTick % 6 === 0) notify(state, '⚠️ Kontostand negativ – Kosten senken oder Einnahmen steigern!', 'bad');
}

export function closeDay(state) {
  if (state.stats.today.hadFog && !state.stats.today.diversions) {
    state.life = state.life || {};
    state.life.fogDayOk = (state.life.fogDayOk || 0) + 1;
  }
  const L = state.ledger;
  const rev = Object.values(L.rev).reduce((a, b) => a + b, 0);
  const cost = Object.values(L.cost).reduce((a, b) => a + b, 0);
  const s = state.stats.today;
  const deps = s.onTime + s.delayed;
  const rec = {
    day: dayOf(state.time - 1),
    rev: Math.round(rev),
    cost: Math.round(cost),
    profit: Math.round(rev - cost),
    capex: Math.round(L.capex),
    cash: Math.round(state.cash),
    mov: s.mov,
    pax: s.pax,
    onTime: deps ? Math.round((s.onTime / deps) * 100) : 100,
    rep: Math.round(state.reputation),
    incidents: s.incidents,
    goArounds: s.goArounds,
    diversions: s.diversions,
    revBy: { ...L.rev },
    costBy: { ...L.cost },
    fuelBuy: Math.round(L.fuelBuy || 0),
    repay: Math.round(L.repay || 0),
    slotOk: s.slotOk || 0,
    td: s.tdN ? { n: s.tdN, avg: Math.round(s.tdSum / s.tdN), best: s.tdBest || null, hard: s.hardLand || 0 } : null,
    slotMiss: s.slotMiss || 0,
    slotMissGnd: s.slotMissGnd || 0,
    taxiWait: Math.round((s.taxiWait || 0) / 60),
    depN: s.depN || 0,
    wakeInf: s.wakeInf || 0,
    minFuel: s.minFuel || 0,
    fuelSold: Math.round(s.fuelSold || 0),
    nightMov: s.nightMov || 0,
    complaints: s.complaints || 0,
    rwyCond: Math.round(rwyCond(state)),
    score: scoreDayEnd(state),
    scoreBest: scoreState(state).bestDay,
    arrH: s.arrH || null,
    depH: s.depH || null,
    peakDelay: s.peakDelay || null,
  };
  state.history.push(rec);
  if (state.history.length > 60) state.history.shift();
  newsDayEnd(state, rec);
  state.lastReport = rec;
  state.ledger = { rev: {}, cost: {}, capex: 0, fuelBuy: 0, repay: 0 };
  state.stats.today = freshToday();
  return rec;
}
export const freshToday = () => ({ mov: 0, pax: 0, onTime: 0, delayed: 0, delayMin: 0, goArounds: 0, incidents: 0, diversions: 0, slotOk: 0, slotMiss: 0, slotMissGnd: 0, taxiWait: 0, depN: 0, wakeInf: 0, wakeWait: 0, minFuel: 0, fuelSold: 0, nightMov: 0, complaints: 0 });

// ---------- Aktionen (Manager) ----------
export function standBuildCost(stand) {
  if (stand.kind === 'contact') return stand.size === 'L' ? STAND_COSTS.contactL : STAND_COSTS.contactM;
  if (stand.kind === 'cargo') return STAND_COSTS.contactM;
  return STAND_COSTS.remote;
}
// Bauaufträge: bezahlt wird bei Baubeginn, fertig erst nach der Bauzeit
export function buildStand(state, id) {
  const st = state.stands.find((s) => s.id === id);
  if (!st || st.built || standProject(state, id)) return false;
  const cost = standBuildCost(st);
  if (state.cash < cost) return notify(state, 'Nicht genug Geld', 'bad'), false;
  capex(state, cost, `Parkposition ${id}`);
  startProject(state, 'stand', id, { name: `Parkposition ${id}`, cost, hours: standBuildHours(st) });
  return true;
}
export function upgradeStand(state, id) {
  const st = state.stands.find((s) => s.id === id);
  if (!st || !st.built || st.size === 'L' || standProject(state, id)) return false;
  if (state.cash < STAND_COSTS.upgradeL) return notify(state, 'Nicht genug Geld', 'bad'), false;
  capex(state, STAND_COSTS.upgradeL, `Position ${id} für Großraumflugzeuge`);
  startProject(state, 'standL', id, { name: `Position ${id} → Großraum`, cost: STAND_COSTS.upgradeL, hours: STAND_HOURS.upgradeL });
  return true;
}
export function buyUpgrade(state, key) {
  const u = UPGRADES[key];
  const lvl = state.upgrades[key] || 0;
  if (!u || lvl >= u.max || projectFor(state, 'upgrade', key)) return false;
  const cost = u.cost[lvl];
  if (state.cash < cost) return notify(state, 'Nicht genug Geld', 'bad'), false;
  capex(state, cost, `${u.name} Stufe ${lvl + 1}`);
  startProject(state, 'upgrade', key, { name: UPGRADE_NAMES(key, lvl + 1), cost, hours: upgradeHours(key, lvl + 1), level: lvl + 1 });
  return true;
}
// Pistenarbeiten beauftragen (laufen nachts in Verkehrspausen)
export function orderRunwayWork(state, spec) {
  const [key, strip = 'N'] = String(spec).split(':');
  const w = RWY_WORKS[key];
  if (!w || projects(state).some((p) => p.kind === 'rwy')) return false;
  if (strip === 'S' && !state.upgrades.rwy2) return false;
  if (state.cash < w.cost) return notify(state, 'Nicht genug Geld', 'bad'), false;
  const name = `${w.name}${state.upgrades.rwy2 ? (strip === 'S' ? ' (Südbahn)' : ' (Nordbahn)') : ''}`;
  capex(state, w.cost, name);
  startProject(state, 'rwy', key, { name, cost: w.cost, hours: w.hours, strip });
  return true;
}
export function buyVehicle(state, type) {
  const vt = VEH_TYPES[type];
  if (state.cash < vt.price) return notify(state, 'Nicht genug Geld', 'bad'), false;
  if (state.vehicles.length >= 24) return notify(state, 'Depot voll (max. 24 Fahrzeuge)', 'warn'), false;
  capex(state, vt.price, vt.name);
  state.vehicles.push(makeVehicle(state, type, freeBay(state)));
  return true;
}
export function sellVehicle(state, type) {
  const v = [...state.vehicles].reverse().find((x) => x.type === type && vehicleAvailable(state, x));
  if (!v) return notify(state, 'Kein freies Fahrzeug zum Verkaufen', 'warn'), false;
  if (state.vehicles.filter((x) => x.type === type).length <= 1) return notify(state, 'Mindestens ein Fahrzeug je Typ nötig', 'warn'), false;
  state.vehicles = state.vehicles.filter((x) => x !== v);
  earn(state, 'other', VEH_TYPES[type].price * 0.45);
  return true;
}
export function hire(state, n) {
  if (n > 0) {
    spend(state, 'staff', n * 2500);
    state.staff += n;
  } else {
    const k = Math.min(-n, state.staff - 5);
    spend(state, 'staff', k * 6000);
    state.staff -= k;
    rep(state, -0.3 * k);
  }
}
export function setFee(state, key, v) {
  const [a, b] = FEE_LIMITS[key];
  state.fees[key] = clamp(Math.round(v * 2) / 2, a, b);
}
export function marketing(state) {
  if (state.cash < MARKETING.cost) return notify(state, 'Nicht genug Geld', 'bad'), false;
  spend(state, 'marketing', MARKETING.cost);
  state.marketingUntil = state.time + MARKETING.days * 86400;
  state.offerTimer = Math.min(state.offerTimer ?? 0, 1800);
  rep(state, 2.5);
  notify(state, '📣 Marketingkampagne gestartet', 'good');
  return true;
}

// ---------- Kapazität ----------
export function capacity(state) {
  const hrs = 17;
  const cap = { pax: 0, L: 0, cargo: 0 };
  for (const s of state.stands) {
    if (!s.built) continue;
    if (s.kind === 'cargo') {
      cap.cargo += hrs;
      cap.pax += hrs * 0.3;
    } else cap.pax += hrs;
    if (s.size === 'L') cap.L += hrs;
  }
  return cap;
}
// Pistenkapazität in Bewegungen pro Tag (eine Bahn ≈ 150, Schnellabrollwege +12 %, Parallelbahn ×1,9)
export function runwayCapacity(state) {
  const u = state.upgrades;
  return Math.round(150 * (u.rapidExit ? 1.12 : 1) * (u.rwy2 ? 1.9 : 1));
}
// geplante Bewegungen pro Tag aus den Verträgen (Landung + Start je Umlauf)
export function plannedMovements(state) {
  return state.contracts.reduce((t, c) => t + c.perDay * 2, 0);
}
export function offerFits(state, o) {
  const t = AC_TYPES[o.type];
  const cap = capacity(state);
  const need = standDemand(state);
  const add = (o.perDay * (t.turn + 35)) / 60;
  // Piste: ohne Luft entstehen Warteschleifen, Treibstoffnot und Vorfälle
  if (plannedMovements(state) + o.perDay * 2 > runwayCapacity(state) * 0.9) return false;
  if (t.cargo) return need.cargo + add <= cap.cargo * 0.85;
  const paxNeed = need.S + need.M + need.L + add;
  if (t.size === 'L' && need.L + add > cap.L * 0.85) return false;
  return paxNeed <= cap.pax * 0.8;
}

// ---------- Management-KI ----------
const AUTO_UPGRADES = ['security', 'retail', 'apronLights', 'parking', 'rapidExit', 'solar', 'retail', 'ils3', 'security', 'lounge', 'parking', 'retail', 'hotel', 'rwy2', 'rail', 'security'];
export function autoManager(state) {
  const reserve = 1500000;
  // Angebote
  for (const o of [...state.offers]) {
    if (offerFits(state, o)) acceptOffer(state, o.id);
  }
  // Parkpositionen haben Vorrang
  const cap = capacity(state);
  const need = standDemand(state);
  const paxNeed = need.S + need.M + need.L;
  if (state.acs.some((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand)) state.standShortage = (state.standShortage || 0) + 1;
  let saving = false;
  const paxSite = state.stands.some((s) => !s.built && s.kind !== 'cargo' && standProject(state, s.id));
  if (paxSite) state.standShortage = 0; // Baustelle läuft bereits
  else if (paxNeed > cap.pax * 0.62 || (state.standShortage || 0) > 2) {
    const next = state.stands.find((s) => !s.built && s.kind !== 'cargo');
    if (next) {
      saving = true;
      if (state.cash > standBuildCost(next) + reserve * 0.6) {
        buildStand(state, next.id);
        state.standShortage = 0;
      }
    }
  }
  // Fahrzeuge: lange Wartezeiten -> kaufen (max. alle 6 h)
  if (state.hourTick % 6 === 0) {
    const w = state.stats.vehWait;
    let best = null;
    for (const [type, secs] of Object.entries(w)) if (secs > 2400 && (!best || secs > w[best])) best = type;
    if (best && !saving && state.cash > VEH_TYPES[best].price + reserve) buyVehicle(state, best);
    state.stats.vehWait = {};
  }
  // Personal
  if (efficiency(state) < 0.95 && state.cash > reserve * 0.5 && state.hourTick % 3 === 0) hire(state, 3);
  const cargoWaiting = state.acs.some((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT || a.phase === PH.HOLD) && !a.stand && AC_TYPES[a.type].cargo);
  if (cargoWaiting) state.cargoShortage = (state.cargoShortage || 0) + 1;
  const cargoSite = state.stands.some((s) => !s.built && s.kind === 'cargo' && standProject(state, s.id));
  if (cargoSite) state.cargoShortage = 0;
  else if ((need.cargo > cap.cargo * 0.75 && state.hourTick % 5 === 0) || (state.cargoShortage || 0) > 2) {
    const next = state.stands.find((s) => !s.built && s.kind === 'cargo');
    if (next && state.cash > standBuildCost(next) + reserve * 0.6) {
      buildStand(state, next.id);
      state.cargoShortage = 0;
    }
  }
  // Piste instand halten
  const cond = rwyCond(state);
  if (!projects(state).some((p) => p.kind === 'rwy')) {
    const condS = state.upgrades.rwy2 ? rwyCond(state, 'S') : 100;
    const strip = condS < cond ? 'S' : 'N';
    const c = Math.min(cond, condS);
    if (c < 32 && state.cash > RWY_WORKS.resurface.cost + reserve) orderRunwayWork(state, `resurface:${strip}`);
    else if (c < 58 && state.cash > RWY_WORKS.clean.cost + reserve * 0.3) orderRunwayWork(state, `clean:${strip}`);
  }
  // Liquidität: im Notfall Kredit, bei voller Kasse tilgen
  if (state.cash < 250000 && loanLimit(state) >= 2000000 && state.hourTick % 6 === 0) takeLoan(state, 2000000);
  if (state.cash > 12000000) for (const l of [...loans(state)]) if (state.cash - l.rest > 9000000) repayLoan(state, l.id);
  // Schlangen an der Sicherheitskontrolle: Spuren ausbauen, sobald das Geld reicht
  const sec = state.sec;
  if (sec && (sec.peak || 0) > 15 && (state.upgrades.security || 0) < UPGRADES.security.max && !projectFor(state, 'upgrade', 'security')) {
    const c = UPGRADES.security.cost[state.upgrades.security || 0];
    if (state.cash > c + reserve * 0.5) {
      buyUpgrade(state, 'security');
      sec.peak = 0;
    }
  }
  // Ausbau bei gut gefüllter Kasse
  if (state.cash > 6500000 && state.hourTick % 4 === 0) {
    for (const k of AUTO_UPGRADES) {
      const lvl = state.upgrades[k] || 0;
      if (lvl < UPGRADES[k].max) {
        if (state.cash > UPGRADES[k].cost[lvl] + 4000000) buyUpgrade(state, k);
        break;
      }
    }
  }
}

// kurze Geldangabe für Karten-Rückmeldungen
export function fmtK(v) {
  return v >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' Mio €' : v >= 1000 ? Math.round(v / 100) / 10 + ' Tsd €' : Math.round(v) + ' €';
}
