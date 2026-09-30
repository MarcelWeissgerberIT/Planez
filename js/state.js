// Spielstand anlegen, Rollen, Speichern/Laden
import { AIRPORT, DEFAULT_FEES, VEH_TYPES } from './config.js';
import { STAND_DEFS } from './layout.js';
import { initialContracts, generateDay } from './sim/schedule.js';
import { makeVehicle, freeBay } from './sim/ground.js';
import { freshToday } from './sim/economy.js';
import { placeAtStand } from './sim/aircraft.js';
import { nextId, uniqueFn } from './sim/schedule.js';
import { AC_TYPES, SIZE_RANK } from './config.js';
import { FUEL, fuelState } from './sim/fuel.js';

export const SAVE_KEY = 'planez_save_v1';
export const ROLES = {
  tower: { name: 'Tower-Lotse', short: 'Tower', icon: '🎧', desc: 'Radar, Anflugsequenz, Lande- und Startfreigaben, Rollverkehr.' },
  ground: { name: 'Vorfeld & Abfertigung', short: 'Vorfeld', icon: '🦺', desc: 'Parkpositionen, Turnaround, Fahrzeuge disponieren.' },
  manager: { name: 'Flughafen-Manager', short: 'Manager', icon: '💼', desc: 'Verträge, Gebühren, Ausbau, Fuhrpark & Finanzen.' },
  observer: { name: 'Beobachter', short: 'Beobachter', icon: '👁️', desc: 'Alles läuft automatisch – zurücklehnen und zuschauen.' },
};

export function autoFor(role) {
  return { atc: role !== 'tower', ground: role !== 'ground', manager: role !== 'manager' };
}

export function newGame(opts = {}) {
  const role = opts.role || 'tower';
  const state = {
    version: 1,
    seed: opts.seed ?? (Date.now() & 0x7fffffff),
    name: (opts.name || AIRPORT.name).slice(0, 40),
    role,
    time: 6 * 3600,
    speed: 1,
    rwy: '27',
    rwyPending: null,
    wind: { dir: 255, spd: 9, tDir: 255, tSpd: 9, nextChange: 7 * 3600 },
    weather: { kind: 'clear', until: 9 * 3600, cells: [] },
    cash: 5000000,
    reputation: 62,
    fees: { ...DEFAULT_FEES, night: 600 },
    upgrades: { retail: 0, security: 0, lounge: 0, parking: 0, hotel: 0, ils3: 0, rapidExit: 0, apronLights: 0 },
    staff: 44,
    stands: STAND_DEFS.map((s) => ({ ...s, built: s.built || s.id === 6, occ: null, resv: null, bridge: 0 })),
    vehicles: [],
    contracts: [],
    offers: [],
    rots: {},
    acs: [],
    log: [],
    ledger: { rev: {}, cost: {}, capex: 0 },
    history: [],
    projects: [],
    stats: { today: freshToday(), vehWait: {} },
    settings: {
      standAuto: true,
      vehAuto: Object.fromEntries(Object.keys(VEH_TYPES).map((k) => [k, false])),
      towerGroundAuto: false,
      density: opts.density || 1,
      labels: true,
      tts: false,
      sound: true,
      curfew: false,
      glossary: true,
    },
    rwyCond: 86,
    loans: [],
    life: {},
    auto: autoFor(role),
    nextId: 1,
    marketingUntil: 0,
    strikeUntil: 0,
    offerTimer: 2 * 3600,
    eventTimer: 4 * 3600,
  };
  const fleet = { tug: 3, baggage: 4, fuel: 2, catering: 2, cleaning: 2, bus: 2 };
  for (const [type, n] of Object.entries(fleet)) for (let i = 0; i < n; i++) state.vehicles.push(makeVehicle(state, type, freeBay(state)));
  for (const v of state.vehicles) if (v.type === 'fuel') v.load = FUEL.truckCap * (0.7 + 0.25 * (v.bay % 2));
  fuelState(state);
  state.contracts = initialContracts(state, state.settings.density);
  generateDay(state, 1);
  generateDay(state, 2);
  // Umläufe, die lange vor Spielbeginn hätten starten müssen, entfallen; knapp davor: sofort im Anflug
  for (const [id, r] of Object.entries(state.rots)) {
    if (r.spawnAt < state.time - 12 * 60) delete state.rots[id];
    else if (r.spawnAt < state.time) r.spawnAt = state.time + 5;
  }
  warmStart(state);
  return state;
}

// Morgenwelle: einige Flugzeuge haben über Nacht an Positionen geparkt
function warmStart(state) {
  const stands = state.stands.filter((s) => s.built && s.kind !== 'cargo');
  const cons = state.contracts.filter((c) => !c.cargo);
  const used = new Set();
  let k = 0;
  for (const st of stands) {
    if (k >= 5) break;
    const c = cons.find((x) => !used.has(x.airline) && SIZE_RANK[AC_TYPES[x.type].size] <= SIZE_RANK[st.size] && AC_TYPES[x.type].size !== 'L') || cons.find((x) => SIZE_RANK[AC_TYPES[x.type].size] <= SIZE_RANK[st.size]);
    if (!c) continue;
    used.add(c.airline);
    const t = AC_TYPES[c.type];
    const fn = uniqueFn(state, c.airline, c.base + 90 + k * 2, Math.floor((state.time - 9 * 3600) / 86400) + 1);
    const rot = {
      id: nextId(state, 'r'), contract: c.id, airline: c.airline, type: c.type,
      arrNo: `${c.airline}${fn}`, depNo: `${c.airline}${fn + 1}`, city: c.city,
      sta: state.time - 9 * 3600, std: state.time + (24 + k * 12) * 60, arrDelay: 0,
      paxIn: 0, paxOut: Math.round(t.pax * 0.85), cargoIn: 0, cargoOut: Math.round(t.pax * 0.01),
      status: 'onblock', spawnAt: 0, ac: null,
    };
    state.rots[rot.id] = rot;
    const ac = placeAtStand(state, rot, st);
    // über Nacht erledigt
    for (const key of ['deboard', 'unload', 'clean', 'cater']) if (ac.ta.tasks[key]) {
      ac.ta.tasks[key].st = 'done';
      ac.ta.tasks[key].prog = 1;
    }
    if (k % 2 === 0 && ac.ta.tasks.fuel) {
      ac.ta.tasks.fuel.st = 'done';
      ac.ta.tasks.fuel.prog = 1;
    }
    k++;
  }
  // die ersten Ankünfte sind schon im Anflug
  const early = Object.values(state.rots).filter((r) => r.status === 'planned' && !AC_TYPES[r.type].cargo).sort((a, b) => a.spawnAt - b.spawnAt).slice(0, 3);
  early.forEach((r, i) => {
    const shift = r.spawnAt - (state.time + 5 + i * 150);
    if (shift > 0) {
      r.spawnAt -= shift;
      r.sta -= shift;
      r.std -= shift;
    }
  });
}

export function setRole(state, role) {
  state.role = role;
  state.auto = autoFor(role);
}

export function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', e);
    return false;
  }
}
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.version !== 1) return null;
    return s;
  } catch (e) {
    return null;
  }
}
export function hasSave() {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch (e) {
    return false;
  }
}
export function deleteSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {}
}
