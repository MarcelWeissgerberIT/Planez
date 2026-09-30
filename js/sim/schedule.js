// Flugpläne: Verträge -> tägliche Umläufe (Ankunft + Abflug), Angebote
import { AC_TYPES, AIRLINES, CITIES } from '../config.js';
import { rand, randRange, randInt, pick, pickWeighted, clamp } from '../util.js';
import { log, notify } from './messages.js';

export function nextId(state, prefix = '') {
  state.nextId = (state.nextId || 1) + 1;
  return prefix + state.nextId;
}

function citiesFor(state, type) {
  const t = AC_TYPES[type];
  const cats = t.size === 'L' ? ['long'] : t.size === 'S' ? ['short'] : ['short', 'mid'];
  return Object.keys(CITIES).filter((c) => cats.includes(CITIES[c].cat));
}

export function makeContract(state, airlineCode, type, city, perDay, days) {
  const al = AIRLINES[airlineCode];
  const base = 100 + randInt(state, 1, 89) * 10;
  return {
    id: nextId(state, 'c'),
    airline: airlineCode,
    type,
    city,
    perDay,
    days,
    since: Math.floor(state.time / 86400) + 1,
    base,
    cargo: !!AC_TYPES[type].cargo,
    sat: 70,
  };
}

// Startverträge je nach Verkehrsdichte
export function initialContracts(state, density = 1) {
  const list = [
    ['AUR', 'A320', 3], ['AUR', 'A320', 2], ['AUR', 'A321', 2], ['AUR', 'B789', 1],
    ['RHJ', 'A320', 3], ['RHJ', 'E190', 3], ['RHJ', 'A321', 2],
    ['ALP', 'AT76', 3], ['ALP', 'E190', 3], ['ALP', 'AT76', 2],
    ['NST', 'B738', 3], ['NST', 'B738', 2], ['SKB', 'B738', 3], ['SKB', 'A321', 2],
    ['OPL', 'A359', 1], ['OPL', 'B77W', 1], ['BWG', 'AT76', 3], ['BWG', 'E190', 2],
    ['TGC', 'B748F', 1], ['TGC', 'B77F', 1],
  ];
  const out = [];
  for (const [al, type, n] of list) {
    const per = Math.max(1, Math.round(n * density));
    // mehrere Ziele: pro Vertrag 1 Ziel
    const cands = AC_TYPES[type].cargo ? ['LEJ', 'HKG', 'DXB', 'ORD', 'PVG', 'JFK'] : citiesFor(state, type);
    const city = pick(state, cands);
    const c = makeContract(state, al, type, city, per, randInt(state, 20, 45));
    out.push(c);
  }
  return out;
}

// Umläufe für einen Tag erzeugen
// Flugnummern je Tag eindeutig halten
export function uniqueFn(state, airline, fn, day) {
  const used = new Set(Object.values(state.rots).filter((r) => r.airline === airline && Math.floor(r.sta / 86400) + 1 === day).flatMap((r) => [r.arrNo, r.depNo]));
  let n = fn;
  while (used.has(`${airline}${n}`) || used.has(`${airline}${n + 1}`)) n += 2;
  return n;
}

export function generateDay(state, day, onlyContract = null) {
  const dayStart = (day - 1) * 86400;
  const rots = [];
  for (const c of state.contracts) {
    if (onlyContract && c.id !== onlyContract.id) continue;
    if (c.days <= 0) continue;
    const t = AC_TYPES[c.type];
    const n = c.perDay;
    for (let k = 0; k < n; k++) {
      let sta;
      if (c.cargo) {
        // Fracht bevorzugt nachts/früh
        const slot = (state.contracts.filter((x) => x.cargo).indexOf(c) + k) % 3;
        sta = dayStart + [randRange(state, 0.5, 4), randRange(state, 11, 15), randRange(state, 19, 22.5)][slot] * 3600;
      } else if (t.size === 'L') {
        sta = dayStart + randRange(state, 6.5 + k * 5, 10 + k * 5) * 3600;
      } else {
        // Verkehrswellen: Morgen-, Mittags- und Abendspitze
        const seg = 16.3 / n;
        let h = 6.0 + seg * k + randRange(state, 0.05, seg * 0.95);
        const waves = [7.8, 12.8, 18.2];
        const w = waves.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a));
        h = h + (w - h) * randRange(state, 0.25, 0.6);
        sta = dayStart + h * 3600;
      }
      sta = Math.round(sta / 300) * 300;
      const buffer = randInt(state, 2, 7) * 5 * 60;
      const std = sta + t.turn * 60 + buffer;
      const lf = clamp(randRange(state, 0.62, 0.97) * (0.85 + state.reputation / 400), 0.4, 1);
      const al = AIRLINES[c.airline];
      const fn = uniqueFn(state, c.airline, c.base + ((k * 2 + day * 2) % 40), day);
      // Ankunftsverspätung (vom Abflughafen mitgebracht)
      let arrDelay = Math.round(randRange(state, -8, 10));
      if (rand(state) < 0.12) arrDelay += randInt(state, 15, 55);
      const rot = {
        id: nextId(state, 'r'),
        contract: c.id,
        airline: c.airline,
        type: c.type,
        arrNo: `${al.code}${fn}`,
        depNo: `${al.code}${fn + 1}`,
        city: c.city,
        sta,
        std,
        arrDelay,
        paxIn: Math.round(t.pax * lf),
        paxOut: Math.round(t.pax * clamp(lf + randRange(state, -0.1, 0.08), 0.35, 1)),
        cargoIn: t.cargo ? Math.round(t.cargo * randRange(state, 0.6, 0.95)) : Math.round(t.pax * 0.01),
        cargoOut: t.cargo ? Math.round(t.cargo * randRange(state, 0.55, 0.95)) : Math.round(t.pax * 0.012),
        status: 'planned',
        spawnAt: sta + arrDelay * 60 - 21 * 60,
        ac: null,
      };
      rots.push(rot);
      state.rots[rot.id] = rot;
    }
  }
  return rots;
}

// Tageswechsel: Verträge altern, Verlängerungen
export function dailyContracts(state) {
  for (const c of state.contracts) {
    c.days -= 1;
    if (c.days === 0) {
      const al = AIRLINES[c.airline];
      const p = clamp(c.sat / 100 + (state.reputation - 60) / 200, 0.1, 0.97);
      if (rand(state) < p) {
        c.days = randInt(state, 20, 45);
        log(state, 'mgr', `${al.name} verlängert den Vertrag ${c.city} (${c.type}) um ${c.days} Tage.`);
        notify(state, `✍️ ${al.name} verlängert: ${CITIES[c.city].name}`, 'good');
      } else {
        log(state, 'mgr', `${al.name} beendet die Verbindung nach ${CITIES[c.city].name}.`);
        notify(state, `📉 ${al.name} beendet ${CITIES[c.city].name}`, 'bad');
      }
    }
  }
  state.contracts = state.contracts.filter((c) => c.days > 0);
}

// Neue Vertragsangebote
export function maybeOffer(state, dt) {
  state.offerTimer = (state.offerTimer ?? 3 * 3600) - dt;
  // abgelaufene Angebote entfernen
  state.offers = state.offers.filter((o) => o.expires > state.time);
  if (state.offerTimer > 0) return;
  const feeIdx = feeIndex(state);
  const mkt = state.marketingUntil > state.time ? 0.6 : 1;
  state.offerTimer = randRange(state, 3, 7) * 3600 * clamp(feeIdx, 0.6, 2) * mkt * (1.4 - state.reputation / 200);
  if (state.offers.length >= 4) return;
  const pool = Object.values(AIRLINES).filter((a) => a.code !== 'VIP');
  const al = pickWeighted(state, pool, (a) => (a.types.some((t) => AC_TYPES[t].size === 'L') ? (state.upgrades.lounge ? 1.6 : 0.8) : 1));
  const type = pick(state, al.types);
  const t = AC_TYPES[type];
  const cands = t.cargo ? ['LEJ', 'HKG', 'DXB', 'ORD', 'PVG', 'JFK', 'YYZ'] : citiesFor(state, type);
  const city = pick(state, cands);
  const perDay = t.size === 'L' ? 1 : randInt(state, 1, 3);
  const days = randInt(state, 14, 50);
  const estRev = estimateRotationRevenue(state, type) * perDay;
  state.offers.push({
    id: nextId(state, 'o'),
    airline: al.code,
    type,
    city,
    perDay,
    days,
    estRev,
    expires: state.time + randRange(state, 8, 16) * 3600,
  });
  notify(state, `📨 Neues Angebot: ${al.name} → ${CITIES[city].name} (${perDay}× täglich)`, 'info');
  log(state, 'mgr', `Angebot: ${al.name} möchte ${perDay}× täglich ${CITIES[city].name} mit ${t.name} fliegen (${days} Tage).`);
}

export function acceptOffer(state, offerId) {
  const o = state.offers.find((x) => x.id === offerId);
  if (!o) return false;
  const c = makeContract(state, o.airline, o.type, o.city, o.perDay, o.days);
  c.sat = 78;
  state.contracts.push(c);
  state.offers = state.offers.filter((x) => x !== o);
  // ab morgen im Flugplan
  const tomorrow = Math.floor(state.time / 86400) + 2;
  generateDay(state, tomorrow, c);
  log(state, 'mgr', `Vertrag unterzeichnet: ${AIRLINES[o.airline].name} → ${CITIES[o.city].name}. Erste Flüge ab morgen.`);
  notify(state, `✅ Vertrag mit ${AIRLINES[o.airline].name} unterzeichnet`, 'good');
  return true;
}
export function declineOffer(state, offerId) {
  state.offers = state.offers.filter((x) => x.id !== offerId);
}
export function cancelContract(state, cid) {
  const c = state.contracts.find((x) => x.id === cid);
  if (!c) return;
  c.days = 0;
  state.contracts = state.contracts.filter((x) => x !== c);
  // geplante, noch nicht gestartete Umläufe streichen
  for (const r of Object.values(state.rots)) if (r.contract === cid && r.status === 'planned') r.status = 'cancelled';
  state.reputation = Math.max(0, state.reputation - 2);
  notify(state, `Vertrag mit ${AIRLINES[c.airline].name} gekündigt`, 'warn');
}

export function feeIndex(state) {
  const f = state.fees;
  return (f.landing / 7.5) * 0.35 + (f.pax / 14) * 0.5 + (f.parking / 90) * 0.15;
}

export function estimateRotationRevenue(state, type) {
  const t = AC_TYPES[type];
  const pax = t.pax * 0.8;
  const f = state.fees;
  const handling = { S: 900, M: 1400, L: 3200 }[t.size] + (t.cargo ? 1200 : 0);
  return f.landing * t.mtow + f.pax * pax + handling + pax * 2 * 7 + t.fuel * 0.06 + (t.cargo ? t.cargo * 0.75 * 55 : 0) + f.parking * 1.2;
}

// Nachfragebedarf in Stand-Stunden je Tag vs Kapazität
export function standDemand(state) {
  let need = { S: 0, M: 0, L: 0, cargo: 0 };
  for (const c of state.contracts) {
    const t = AC_TYPES[c.type];
    const h = c.perDay * (t.turn + 35) / 60;
    if (t.cargo) need.cargo += h;
    else need[t.size] += h;
  }
  return need;
}
