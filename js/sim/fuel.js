// Kerosin: Tanklager, Marktpreis, Einkauf mit Lieferzeit, Verkauf an Airlines, Tankwagen-Logistik
import { AC_TYPES } from '../config.js';
import { clamp, rand, randRange, fmtClock, fmtMoney } from '../util.js';
import { log, notify } from './messages.js';
import { nextId } from './schedule.js';
import { isCareer, stageOf } from './career.js';
import { T } from '../i18n.js';

export const FUEL = {
  cap: 1500, // t Tanklager
  truckCap: 36, // t je Tankwagen
  fillRate: 36 / 240, // t/s an der Füllstelle
  basePrice: 780, // €/t langfristiger Mittelwert
  fill: { x: 75.3, y: 15.3 }, // Füllstelle am Tanklager
  marginRange: [0.02, 0.3],
};

export function fuelState(state) {
  if (!state.fuel) {
    let loads = 0;
    for (const v of state.vehicles || []) {
      if (v.type !== 'fuel') continue;
      if (v.load === undefined) v.load = FUEL.truckCap * 0.8;
      loads += v.load;
    }
    state.fuel = { stock: 900, value: (900 + loads) * 765, price: FUEL.basePrice, margin: 0.08, orders: [], hist: [], auto: true, lastHour: Math.floor(state.time / 3600), warned: 0 };
  }
  return state.fuel;
}

// Bestand inklusive Ladung der Tankwagen
export function inventory(state) {
  const f = fuelState(state);
  return f.stock + state.vehicles.reduce((t, v) => t + (v.type === 'fuel' ? v.load || 0 : 0), 0);
}
export function avgCost(state) {
  const f = fuelState(state);
  const inv = inventory(state);
  return inv > 0.5 ? f.value / inv : f.price;
}
export const sellPrice = (state) => fuelState(state).price * (1 + fuelState(state).margin);
export const pending = (state) => fuelState(state).orders.reduce((t, o) => t + o.qty, 0);

// Betankungsmenge: hoher Aufschlag -> Airlines tanken woanders („Tankering“)
export function upliftFor(state, ac) {
  const t = AC_TYPES[ac.type];
  const f = fuelState(state);
  const tanker = 1 - clamp((f.margin - 0.1) * 2.2, 0, 0.45);
  return Math.round((t.fuel / 1000) * 0.75 * tanker * 10) / 10;
}

// Verkauf der tatsächlich getankten Menge
export function sellFuel(state, qty, earn) {
  if (qty <= 0) return;
  const f = fuelState(state);
  const avg = avgCost(state);
  f.value = Math.max(0, f.value - qty * avg);
  state.cash += qty * avg; // Wareneinsatz fließt zurück, Marge als Umsatz
  earn(state, 'fuel', qty * (sellPrice(state) - avg));
  const td = state.stats.today;
  td.fuelSold = (td.fuelSold || 0) + qty;
  const L = state.life || (state.life = {});
  L.fuelT = (L.fuelT || 0) + qty;
  L.fuelMargin = (L.fuelMargin || 0) + qty * (sellPrice(state) - avg);
}

export function maxOrder(state) {
  const f = fuelState(state);
  return Math.max(0, Math.floor(FUEL.cap - f.stock - pending(state)));
}
export function orderFuel(state, qty, auto = false) {
  const f = fuelState(state);
  qty = Math.min(Math.round(qty), maxOrder(state));
  if (qty < 10) return notify(state, T('Tanklager voll – keine Bestellung möglich'), 'warn'), false;
  const unit = f.price * 1.02; // inkl. Transport
  const cost = qty * unit;
  if (state.cash < cost) return notify(state, T('Nicht genug Geld für Kerosin'), 'bad'), false;
  state.cash -= cost;
  state.ledger.fuelBuy = (state.ledger.fuelBuy || 0) + cost;
  const eta = state.time + randRange(state, 2, 3.5) * 3600;
  f.orders.push({ id: nextId(state, 'k'), qty, unit, eta });
  log(state, 'mgr', auto ? T`Automatische Kerosinbestellung: ${qty} t zu ${Math.round(unit)} €/t (${fmtMoney(cost)}), Lieferung ca. ${fmtClock(eta)}.` : T`Kerosinbestellung: ${qty} t zu ${Math.round(unit)} €/t (${fmtMoney(cost)}), Lieferung ca. ${fmtClock(eta)}.`);
  return true;
}

// Normalverteilte Zufallszahl
function randn(state) {
  const u = Math.max(1e-9, rand(state)), v = rand(state);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Tagesverbrauch der letzten Stunden (t/Tag)
export function burnRate(state) {
  const f = fuelState(state);
  const h = f.hist.slice(-24);
  const sold = h.reduce((t, x) => t + (x.sold || 0), 0);
  return h.length ? (sold / h.length) * 24 : 800;
}

export function updateFuel(state, dt) {
  const f = fuelState(state);
  // Lieferungen
  for (const o of [...f.orders]) {
    if (o.eta > state.time) continue;
    const add = Math.min(o.qty, FUEL.cap - f.stock);
    f.stock += add;
    f.value += o.qty * o.unit;
    f.orders = f.orders.filter((x) => x !== o);
    log(state, 'gnd', T`Kerosinlieferung eingetroffen: ${Math.round(add)} t (Tanklager ${Math.round(f.stock)} t).`);
  }
  // stündlich: Marktpreis, Statistik, Automatik
  const hour = Math.floor(state.time / 3600);
  if (f.lastHour === undefined) f.lastHour = hour;
  while (f.lastHour < hour) {
    f.lastHour++;
    const sold = (state.stats.today.fuelSold || 0) - (f.soldMark || 0);
    f.soldMark = state.stats.today.fuelSold || 0;
    f.price = clamp(f.price * Math.exp(randn(state) * 0.018) + (FUEL.basePrice - f.price) * 0.03, 520, 1300);
    if (rand(state) < 0.01) {
      const up = rand(state) < 0.5;
      f.price = clamp(f.price * (up ? 1.14 : 0.88), 520, 1300);
      notify(state, up ? T('🛢️ Ölpreis steigt sprunghaft – Kerosin teurer') : T('🛢️ Ölpreis fällt – günstige Gelegenheit zum Einkauf'), up ? 'warn' : 'good');
    }
    f.hist.push({ t: f.lastHour * 3600, p: Math.round(f.price), s: Math.round(f.stock), sold: Math.max(0, sold) });
    if (f.hist.length > 96) f.hist.shift();
    // Aufbau-Modus: vor dem Regionalflughafen gibt es kein Tanklager (Sportflieger tanken AvGas an der Zapfsäule)
    if ((f.auto || state.auto.manager) && !(isCareer(state) && stageOf(state) < 2)) autoBuy(state);
  }
  // Warnung bei knappem Bestand
  if (!(isCareer(state) && stageOf(state) < 2) && f.stock < FUEL.cap * 0.12 && state.time - (f.warned || 0) > 3 * 3600) {
    f.warned = state.time;
    notify(state, T`⛽ Tanklager fast leer (${Math.round(f.stock)} t) – Kerosin bestellen!`, 'bad');
  }
}

// Einkaufsautomatik: Bestand halten, bei günstigem Preis mehr kaufen
function autoBuy(state) {
  const f = fuelState(state);
  const level = (f.stock + pending(state)) / FUEL.cap;
  const cheap = f.price < FUEL.basePrice * 0.94;
  if (level < 0.45 || (cheap && level < 0.75)) {
    const target = cheap ? 0.9 : 0.8;
    orderFuel(state, (target - level) * FUEL.cap, true);
  }
}

// ---------- Tankwagen ----------
export function truckTakeFuel(state, v, dt) {
  const f = fuelState(state);
  const room = FUEL.truckCap - (v.load || 0);
  const add = Math.min(FUEL.fillRate * dt, room, f.stock);
  if (add > 0) {
    f.stock -= add;
    v.load = (v.load || 0) + add;
  }
  return v.load >= FUEL.truckCap - 0.05 || (f.stock <= 0.01 && v.load > FUEL.truckCap * 0.5);
}
