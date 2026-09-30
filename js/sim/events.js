// Wetter, Wind und Zufallsereignisse
import { rand, randRange, randInt, pick, pickWeighted, hourOf, clamp, degNorm } from '../util.js';
import { log, notify, radio } from './messages.js';
import { spawnSpecial, PH, divert } from './aircraft.js';
import { VEH_TYPES, AIRLINES } from '../config.js';
import { command } from './atc.js';
import { fodEvent } from './runway.js';
import { winterWeather, isWinter } from './winter.js';

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

  // Wetterlagen
  const wx = state.weather;
  if (state.time > wx.until) {
    const h = hourOf(state.time);
    const opts = [
      ['clear', 50],
      ['clouds', 26],
      ['rain', 12],
      ['fog', h < 9 || h > 21 ? 9 : 1],
      ['storm', h > 13 && h < 20 ? 7 : 1.5],
      ['snow', isWinter(state) ? 30 : 0],
    ];
    const kind = winterWeather(state, pickWeighted(state, opts, (o) => o[1])[0]);
    const dur = kind === 'storm' ? randRange(state, 0.5, 1.2) : kind === 'fog' ? randRange(state, 1, 3) : kind === 'snow' ? randRange(state, 1.5, 4) : randRange(state, 2, 6);
    // Pistensichtweite (RVR) im Nebel; unter 550 m reicht ILS CAT I nicht mehr
    wx.rvr = kind === 'fog' ? Math.round(randRange(state, 200, 1300) / 25) * 25 : null;
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
    wx.until = state.time + dur * 3600;
    wx.cells = kind === 'storm' ? makeCells(state) : [];
  }
  // Gewitterzellen ziehen
  for (const c of wx.cells || []) {
    c.x += Math.sin((state.wind.dir + 180) * Math.PI / 180) * 0.004 * dt;
    c.y -= Math.cos((state.wind.dir + 180) * Math.PI / 180) * 0.004 * dt;
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
    state.eventTimer = randRange(state, 2.5, 6) * 3600;
    randomEvent(state);
  }
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
    ['emergency', 1.6],
    ['breakdown', 2.5],
    ['strike', 0.6],
    ['birdstrike', 1],
    ['fod', 0.7],
  ];
  const kind = pickWeighted(state, opts, (o) => o[1])[0];
  if (kind === 'vip') {
    const n = randInt(state, 100, 999);
    spawnSpecial(state, { airline: 'VIP', type: 'C68A', arrNo: `VIP${n}`, depNo: `VIP${n + 1}`, city: pick(state, ['NCE', 'GVA', 'OLB', 'LHR']), pax: randInt(state, 2, 8), special: 'vip', feeMult: 2.5 });
    notify(state, '🕴️ VIP-Charter im Anflug – bitte bevorzugt abfertigen', 'info');
    log(state, 'sys', 'VIP-Businessjet angekündigt.');
  } else if (kind === 'emergency') {
    const al = pick(state, ['AUR', 'RHJ', 'NST', 'SKB']);
    const t = pick(state, AIRLINES[al].types.filter((x) => x !== 'B789'));
    const n = randInt(state, 700, 899);
    const ac = spawnSpecial(state, { airline: al, type: t, arrNo: `${al}${n}`, depNo: `${al}${n + 1}`, city: pick(state, ['PMI', 'LHR', 'CDG', 'FCO', 'ARN']), emergency: true, special: 'emergency' });
    radio(state, ac.cs, `MAYDAY MAYDAY MAYDAY, ${AIRLINES[al].tel} ${n}, ${pick(state, ['engine failure', 'medical emergency on board', 'smoke in the cabin'])}, request immediate landing.`);
    notify(state, `🚨 Notfall: ${ac.cs} (Squawk 7700) – Vorrang geben!`, 'bad');
    state.fireAlert = { ac: ac.id, t: state.time };
  } else if (kind === 'breakdown') {
    const vs = state.vehicles.filter((v) => v.st === 'idle' && !(v.brokenUntil > state.time));
    if (!vs.length) return;
    const v = pick(state, vs);
    v.brokenUntil = state.time + randRange(state, 2, 5) * 3600;
    notify(state, `🔧 ${v.name} (${VEH_TYPES[v.type].name}) defekt – in Reparatur`, 'warn');
    log(state, 'gnd', `${v.name} ausgefallen.`);
  } else if (kind === 'strike') {
    state.strikeUntil = state.time + randRange(state, 3, 6) * 3600;
    notify(state, '✊ Warnstreik beim Bodenpersonal – Abfertigung verlangsamt', 'bad');
    log(state, 'gnd', 'Warnstreik: Bodenpersonal nur eingeschränkt verfügbar.');
  } else if (kind === 'fod') {
    if (state.rwyWorking || state.rwyClosedUntil > state.time) return;
    fodEvent(state);
  } else if (kind === 'birdstrike') {
    const deps = state.acs.filter((a) => a.phase === PH.DEPART && a.alt < 6000);
    if (!deps.length) return;
    birdstrikeOn(state, pick(state, deps));
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
  ac.fuelMin = 90; // gerade getankt
  ac.route = [];
  ac.tAlt = 5000;
  const rot = state.rots[ac.rot];
  if (rot) rot.returned = true;
  if (state.auto.atc) command(state, ac, 'direct');
}
