// Wetter, Wind und Zufallsereignisse
import { rand, randRange, randInt, pick, pickWeighted, hourOf, clamp, degNorm, fmtClock } from '../util.js';
import { crewBroken } from './crew.js';
import { startNordo, nordoCandidate } from './nordo.js';
import { log, notify, radio } from './messages.js';
import { startStateVisit, stateVisitPossible } from './statevisit.js';
import { spawnSpecial, PH, divert, goAround } from './aircraft.js';
import * as AS from './airspace.js';
import { diff } from './difficulty.js';
import { VEH_TYPES, AIRLINES } from '../config.js';
import { command } from './atc.js';
import { fodEvent } from './runway.js';
import { fodRisk } from './inspect.js';
import { winterWeather, isWinter } from './winter.js';
import { isCareer, typeAllowed, stageOf } from './career.js';

export const WEATHER = {
  clear: { name: 'Klar', icon: '☀️' },
  clouds: { name: 'Bewölkt', icon: '⛅' },
  rain: { name: 'Regen', icon: '🌧️' },
  fog: { name: 'Nebel', icon: '🌫️' },
  storm: { name: 'Gewitter', icon: '⛈️' },
  snow: { name: 'Schnee', icon: '🌨️' },
};

export const belowMinima = (state) => state.weather.kind === 'fog' && (state.weather.rvr ?? 400) < 550 && !state.upgrades.ils3;
export const lvp = (state) => state.weather.kind === 'fog';

export function updateEvents(state, dt) {
  // Wind: langsame Drift Richtung Ziel
  const w = state.wind;
  if (state.time > (w.nextChange || 0)) {
    w.nextChange = state.time + randRange(state, 4, 9) * 3600;
    const flip = rand(state) < 0.3;
    w.tDir = flip ? degNorm(w.dir + 180 + randRange(state, -40, 40)) : degNorm(w.dir + randRange(state, -50, 50));
    w.tSpd = clamp(randRange(state, 3, 18), 2, 25);
    if (flip) log(state, 'sys', `Wetterdienst: Winddrehung erwartet auf ${Math.round(w.tDir / 10) * 10}°.`);
  }
  const dd = ((w.tDir - w.dir + 540) % 360) - 180;
  w.dir = degNorm(w.dir + clamp(dd, -0.01 * dt, 0.01 * dt));
  w.spd += clamp(w.tSpd - w.spd, -0.002 * dt, 0.002 * dt);
  w.gust = (w.gust || 0) * 0.98 + (rand(state) - 0.5) * 0.4;

  // Wetterlagen: die nächste Lage steht schon fest (Vorhersage/TAF) und wird rechtzeitig angekündigt
  const wx = state.weather;
  if (state.time > wx.until) {
    const nx = forecast(state);
    const kind = winterWeather(state, nx.kind);
    const dur = nx.dur;
    // Pistensichtweite (RVR) im Nebel; unter 550 m reicht ILS CAT I nicht mehr
    wx.rvr = kind === 'fog' ? nx.rvr ?? Math.round(randRange(state, 200, 1300) / 25) * 25 : null;
    if (kind !== wx.kind) {
      if (kind === 'fog') {
        const dense = wx.rvr < 550;
        notify(state, `🌫️ Nebel, RVR ${wx.rvr} m – ${!dense ? 'LVP aktiv, Landungen mit CAT I möglich (mehr Abstand).' : state.upgrades.ils3 ? 'ILS CAT III aktiv – Landungen möglich.' : 'unter CAT-I-Minimum: ohne ILS CAT III müssen Anflüge ausweichen.'}`, dense && !state.upgrades.ils3 ? 'bad' : 'warn');
      }
      if (kind === 'storm') notify(state, '⛈️ Gewitter – Vorfeld gesperrt, Abfertigung pausiert', 'warn');
      if (kind === 'snow') notify(state, '🌨️ Schneefall – Abflüge müssen enteist werden, Pisten werden regelmäßig geräumt', 'warn');
      if (wx.kind === 'storm') notify(state, 'Gewitter vorbei – Vorfeld wieder frei', 'good');
      log(state, 'sys', `Wetter: ${WEATHER[kind].name}.`);
    }
    wx.kind = kind;
    if (kind === 'fog') state.stats.today.hadFog = true;
    wx.until = state.time + dur * 3600;
    wx.cells = kind === 'storm' ? makeCells(state) : kind === 'rain' ? showerCells(state) : [];
    wx.next = null;
    forecast(state);
  }
  // Vorwarnung 30 Minuten vor Gewitter, Nebel oder Schnee
  const nx = forecast(state);
  const nk = winterWeather(state, nx.kind);
  if (nk !== wx.kind && ['storm', 'fog', 'snow'].includes(nk) && wx.until - state.time < 1800 && wx.warnedAt !== nx.at) {
    wx.warnedAt = nx.at;
    const txt = { storm: 'Gewitter – das Vorfeld wird gesperrt, Abfertigung pausiert', fog: 'Nebel – Low Visibility Procedures, größere Abstände', snow: 'Schneefall – Enteisung und Räumdienst' }[nk];
    notify(state, `${WEATHER[nk].icon} Vorhersage: ab ${fmtClock(nx.at)} ${txt}`, 'warn');
    log(state, 'sys', `Wetterdienst: ab ${fmtClock(nx.at)} ${WEATHER[nk].name} erwartet.`);
  }
  // Gewitterzellen ziehen
  for (const c of wx.cells || []) {
    c.x += Math.sin((state.wind.dir + 180) * Math.PI / 180) * 0.004 * dt;
    c.y -= Math.cos((state.wind.dir + 180) * Math.PI / 180) * 0.004 * dt;
  }
  // Zelle nahe der Landeschwelle: Windscherung im kurzen Endanflug, manche Anflüge starten durch
  state.wsTimer = (state.wsTimer || 0) - dt;
  if (state.wsTimer <= 0) {
    state.wsTimer = 5;
    const thr = AS.THR[state.rwy];
    const was = state.windshear;
    state.windshear = !!(thr && (wx.cells || []).some((c) => Math.hypot(c.x - thr.x, c.y - thr.y) < c.r + 3.5));
    if (state.windshear && !was) {
      radio(state, 'TWR', `All stations, windshear reported on final runway ${state.rwy}.`, 'atc');
      notify(state, `🌪️ Windscherung im Endanflug ${state.rwy} – Anflüge können durchstarten. Pistenwechsel erwägen.`, 'warn');
    }
    if (state.windshear) {
      for (const ac of state.acs) {
        if (ac.mode !== 'air' || ac.phase !== PH.APPROACH || ac.wsChecked || ac.emergency) continue;
        const d = AS.distToThr(ac.pos, ac.rwy);
        if (d < 0 || d > 4 || Math.abs(ac.pos.y) > 1.5) continue; // nur im kurzen Endanflug
        ac.wsChecked = true;
        if (rand(state) < 0.3) {
          radio(state, ac.cs, `${ac.cs}, windshear, going around.`);
          goAround(state, ac, 'Windscherung');
        }
      }
    }
  }
  // dichter Nebel ohne CAT III: Anflüge warten eine Weile, dann weichen sie aus
  if (belowMinima(state)) {
    for (const ac of state.acs) {
      if (ac.mode === 'air' && [PH.HOLD].includes(ac.phase) && !ac.emergency && state.time - ac.holdStart > 15 * 60) divert(state, ac, `Nebel unter Minima (RVR ${wx.rvr} m)`, 'diversionWx');
      if (ac.mode === 'air' && ac.phase === PH.APPROACH && ac.route.length === 1 && !ac.emergency) divert(state, ac, `Nebel unter Minima (RVR ${wx.rvr} m)`, 'diversionWx');
    }
  }

  // Zufallsereignisse
  state.eventTimer = (state.eventTimer ?? 3 * 3600) - dt;
  if (state.eventTimer <= 0) {
    state.eventTimer = randRange(state, 2.5, 6) * 3600 * diff(state).events;
    if (state.settings.events !== false) randomEvent(state);
  }
}

// Wetter für einen Zeitpunkt würfeln (Art, Dauer in Stunden, Sichtweite)
function rollWeather(state, at) {
  const h = hourOf(at);
  const opts = [
    ['clear', 50],
    ['clouds', 26],
    ['rain', 12],
    ['fog', h < 9 || h > 21 ? 9 : 1],
    ['storm', h > 13 && h < 20 ? 7 : 1.5],
    ['snow', isWinter(state) ? 30 : 0],
  ];
  const kind = pickWeighted(state, opts, (o) => o[1])[0];
  const dur = kind === 'storm' ? randRange(state, 0.5, 1.2) : kind === 'fog' ? randRange(state, 1, 3) : kind === 'snow' ? randRange(state, 1.5, 4) : randRange(state, 2, 6);
  const rvr = kind === 'fog' ? Math.round(randRange(state, 200, 1300) / 25) * 25 : null;
  return { kind, dur, rvr, at };
}
// Vorhersage: nächste Wetterlage ab Ende der aktuellen (bleibt bis dahin fest)
export function forecast(state) {
  const wx = state.weather;
  if (!wx.next || wx.next.at !== wx.until) wx.next = rollWeather(state, wx.until);
  return wx.next;
}
// Anzeigeform der Vorhersage (mit Umwandlung Regen/Schnee nach Temperatur)
export function forecastInfo(state) {
  const nx = forecast(state);
  const kind = winterWeather(state, nx.kind);
  return { kind, at: nx.at, until: nx.at + nx.dur * 3600, name: WEATHER[kind].name, icon: WEATHER[kind].icon, rvr: kind === 'fog' ? nx.rvr : null, change: kind !== state.weather.kind };
}

// Regen: manchmal einzelne Schauerzellen weiter draußen (ohne den Zufallsgenerator des Spiels zu verbrauchen)
function showerCells(state) {
  let h = (Math.floor(state.time / 60) * 2654435761) >>> 0;
  const r01 = () => ((h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
  if (r01() < 0.45) return [];
  const cells = [];
  const n = r01() < 0.6 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const a = r01() * Math.PI * 2, d = 16 + r01() * 18;
    cells.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 2.5 + r01() * 1.5, shower: true });
  }
  return cells;
}

function makeCells(state) {
  const cells = [];
  const n = randInt(state, 2, 4);
  for (let i = 0; i < n; i++) cells.push({ x: randRange(state, -35, 35), y: randRange(state, -35, 35), r: randRange(state, 3, 7) });
  return cells;
}

function randomEvent(state) {
  const h = hourOf(state.time);
  const opts = [
    ['vip', h > 7 && h < 21 ? 3 : 0.3],
    ['a380', h > 8 && h < 19 ? 0.8 + 0.3 * ((state.goals && state.goals.rank) || 0) : 0],
    ['emergency', 1.6],
    ['breakdown', diff(state).breakdowns ? 2.5 : 0],
    ['strike', 0.6],
    ['birdstrike', 1],
    ['nordo', h > 6 && h < 22 && nordoCandidate(state) ? 0.9 : 0],
    ['fod', 0.7 * fodRisk(state)],
    ['state', h > 9 && h < 16 && state.time > 86400 && stateVisitPossible(state) ? 1.2 : 0],
  ];
  triggerEvent(state, pickWeighted(state, opts, (o) => o[1])[0]);
}

// Ereignis gezielt auslösen (auch für Szenarien); gibt das betroffene Flugzeug zurück, falls es eins gibt
export function triggerEvent(state, kind, opt = {}) {
  // Karriere: Sonderbesuche nur, wenn Piste und Vorfeld das Flugzeug aufnehmen können
  if (isCareer(state)) {
    const need = { a380: 'A388', state: 'A333', vip: 'C68A', emergency: 'A320' }[kind];
    if (need && !typeAllowed(state, need)) return null;
    if (stageOf(state) < 2 && (kind === 'strike' || kind === 'breakdown' || kind === 'birdstrike')) return null; // kein Tarifstreik im Fliegerclub
  }
  if (kind === 'a380') {
    // Superjumbo-Besuch: nur mit freier Großraumposition
    if (!state.stands.some((st) => st.built && st.size === 'L' && st.kind !== 'cargo')) return null;
    const n = randInt(state, 380, 389) * 2;
    const ac = spawnSpecial(state, { airline: 'OPL', type: 'A388', arrNo: `OPL${n}`, depNo: `OPL${n + 1}`, city: pick(state, ['DXB', 'SIN', 'HKG', 'PVG']), special: 'a380', feeMult: 1.6 });
    notify(state, '🛬 Sonderbesuch: Eine Aviora AV-38 – der größte Passagierjet der Welt – ist im Anflug!', 'good');
    log(state, 'sys', `Superjumbo ${ac.cs} (AV-38) angekündigt – Spotter strömen an den Zaun.`);
    state.life = state.life || {};
    state.life.a380 = (state.life.a380 || 0) + 1;
    return ac;
  } else if (kind === 'state') {
    return startStateVisit(state);
  } else if (kind === 'vip') {
    const n = randInt(state, 100, 999);
    spawnSpecial(state, { airline: 'VIP', type: 'C68A', arrNo: `VIP${n}`, depNo: `VIP${n + 1}`, city: pick(state, ['NCE', 'GVA', 'OLB', 'LHR']), pax: randInt(state, 2, 8), special: 'vip', feeMult: 2.5 });
    notify(state, '🕴️ VIP-Charter im Anflug – bitte bevorzugt abfertigen', 'info');
    log(state, 'sys', 'VIP-Businessjet angekündigt.');
  } else if (kind === 'emergency') {
    const al = pick(state, ['AUR', 'RHJ', 'NST', 'SKB']);
    const t = pick(state, AIRLINES[al].types.filter((x) => x !== 'B789'));
    const n = randInt(state, 700, 899);
    const ac = spawnSpecial(state, { airline: al, type: t, arrNo: `${al}${n}`, depNo: `${al}${n + 1}`, city: pick(state, ['PMI', 'LHR', 'CDG', 'FCO', 'ARN']), emergency: true, special: 'emergency' });
    const why = opt.kind || pick(state, ['engine', 'medical', 'smoke']);
    ac.emgKind = why;
    radio(state, ac.cs, `MAYDAY MAYDAY MAYDAY, ${AIRLINES[al].tel} ${n}, ${{ engine: 'engine fire', medical: 'medical emergency on board', smoke: 'smoke in the cabin' }[why]}, request immediate landing${why === 'medical' ? '' : ', request fire services'}.`);
    notify(state, `🚨 Notfall: ${ac.cs} (Squawk 7700) – Vorrang geben!`, 'bad');
    state.fireAlert = { ac: ac.id, t: state.time };
    return ac;
  } else if (kind === 'nordo') {
    const ac = opt.ac ? state.acs.find((a) => a.id === opt.ac) : nordoCandidate(state);
    return startNordo(state, ac) ? ac : null;
  } else if (kind === 'breakdown') {
    const vs = state.vehicles.filter((v) => v.st === 'idle' && !(v.brokenUntil > state.time));
    const pool = opt.type ? vs.filter((x) => x.type === opt.type) : vs;
    if (!pool.length) return;
    const v = pick(state, pool);
    v.brokenUntil = state.time + (opt.hours || randRange(state, 2, 5)) * 3600;
    notify(state, `🔧 ${v.name} (${VEH_TYPES[v.type].name}) defekt – in Reparatur`, 'warn');
    log(state, 'gnd', `${v.name} ausgefallen.`);
    crewBroken(state, v, (v.brokenUntil - state.time) / 3600);
  } else if (kind === 'strike') {
    state.strikeUntil = state.time + (opt.hours || randRange(state, 3, 6)) * 3600;
    notify(state, '✊ Warnstreik beim Bodenpersonal – Abfertigung verlangsamt', 'bad');
    log(state, 'gnd', 'Warnstreik: Bodenpersonal nur eingeschränkt verfügbar.');
  } else if (kind === 'fod') {
    if (state.rwyWorking || state.rwyClosedUntil > state.time) return;
    fodEvent(state);
  } else if (kind === 'birdstrike') {
    const deps = state.acs.filter((a) => a.phase === PH.DEPART && a.alt < 6000);
    if (!deps.length) return null;
    const ac = pick(state, deps);
    birdstrikeOn(state, ac);
    return ac;
  }
}

// Vogelschlag nach dem Start: Rückkehr zum Flughafen als Notfall
export function birdstrikeOn(state, ac) {
  radio(state, ac.cs, `PAN PAN, ${ac.cs}, bird strike, request return to land.`);
  notify(state, `🐦 Vogelschlag bei ${ac.cs} – Rückkehr zum Flughafen`, 'warn');
  ac.phase = PH.INBOUND;
  ac.arr = true;
  ac.emergency = true;
  ac.squawk = '7700';
  ac.returning = true;
  ac.emgKind = rand(state) < 0.5 ? 'engine' : 'bird';
  if (!state.fireAlert) state.fireAlert = { ac: ac.id, t: state.time };
  ac.fuelMin = 90; // gerade getankt
  ac.route = [];
  ac.tAlt = 5000;
  const rot = state.rots[ac.rot];
  if (rot) rot.returned = true;
  if (state.auto.atc) command(state, ac, 'direct');
}
