// Spielstand anlegen, Rollen, Speichern/Laden
import { AIRPORT, DEFAULT_FEES, VEH_TYPES, DEFAULT_SPEED } from './config.js';
import { STAND_DEFS } from './layout.js';
import { initialContracts, generateDay } from './sim/schedule.js';
import { makeVehicle, freeBay } from './sim/ground.js';
import { freshToday } from './sim/economy.js';
import { placeAtStand } from './sim/aircraft.js';
import { nextId, uniqueFn } from './sim/schedule.js';
import { AC_TYPES, SIZE_RANK } from './config.js';
import { FUEL, fuelState } from './sim/fuel.js';
import { applyStage, setupStands, careerState, STAGES } from './sim/career.js';
import { T } from './i18n.js';

export const SAVE_KEY = 'planez_save_v1';
export const ROLES = {
  tower: { name: T('Tower-Lotse'), short: T('Tower'), icon: '🎧', desc: T('Radar, Anflugsequenz, Lande- und Startfreigaben, Rollverkehr.') },
  ground: { name: T('Vorfeld & Abfertigung'), short: T('Vorfeld'), icon: '🦺', desc: T('Parkpositionen, Turnaround, Fahrzeuge disponieren.') },
  manager: { name: T('Flughafen-Manager'), short: T('Manager'), icon: '💼', desc: T('Verträge, Gebühren, Ausbau, Fuhrpark & Finanzen.') },
  observer: { name: T('Beobachter'), short: T('Beobachter'), icon: '👁️', desc: T('Alles läuft automatisch – zurücklehnen und zuschauen.') },
};

export function autoFor(role) {
  return { atc: role !== 'tower', ground: role !== 'ground', manager: role !== 'manager' };
}

export function newGame(opts = {}) {
  const role = opts.role || 'tower';
  const career = !!opts.career;
  const state = {
    version: 1,
    seed: opts.seed ?? (Date.now() & 0x7fffffff),
    name: (opts.name || AIRPORT.name).slice(0, 40),
    city: opts.city || undefined, // Heimatstadt (sim/city.js); fehlt sie, gilt Planez
    role,
    time: (opts.hour ?? 6) * 3600,
    slot: opts.slot || 1,
    speed: DEFAULT_SPEED[role] || 1,
    rwy: '27',
    rwyPending: null,
    wind: { dir: 255, spd: 9, tDir: 255, tSpd: 9, nextChange: 7 * 3600 },
    weather: { kind: 'clear', until: 9 * 3600, cells: [] },
    cash: opts.cash || 5000000,
    seasonOffset: opts.seasonOffset || 0,
    reputation: 62,
    fees: { ...DEFAULT_FEES, night: 600 },
    upgrades: { retail: 0, security: 0, lounge: 0, parking: 0, hotel: 0, ils3: 0, rapidExit: 0, apronLights: 0, rwy2: 0, solar: 0, rail: 0 },
    rwyMode: 'single',
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
      difficulty: opts.difficulty || 'normal',
      events: opts.events === false ? false : true,
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
  if (career) return newCareer(state, opts);
  applyStage(state);
  const fleet = { tug: 3, baggage: 4, fuel: 2, catering: 2, cleaning: 2, bus: 2, stairs: 4, deice: 2 };
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

// Karriere: Grasplatz mit Vereinsheim, drei Abstellplätzen auf der Wiese, ohne Fahrzeuge und Airlines.
// Wenig Geld, wenig Personal – der Verkehr kommt erst, wenn sich der Platz einen Namen macht.
function newCareer(state, opts) {
  state.career = { fame: 8, log: [] };
  state.stage = 0;
  state.name = (opts.name || T('Flugplatz Planez')).slice(0, 40);
  state.cash = 40000;
  state.reputation = 52;
  state.staff = STAGES[0].staff;
  state.fees = { landing: 9, pax: 14, parking: 90, night: 600 };
  state.rwyCond = 92;
  state.offerTimer = 1.5 * 3600;
  state.eventTimer = 30 * 3600;
  careerState(state);
  setupStands(state, 0);
  applyStage(state);
  fuelState(state);
  state.contracts = [];
  generateDay(state, 1);
  generateDay(state, 2);
  for (const [id, r] of Object.entries(state.rots)) {
    if (r.spawnAt < state.time - 12 * 60) delete state.rots[id];
    else if (r.spawnAt < state.time) r.spawnAt = state.time + 5;
  }
  // die ersten Gäste sind schon unterwegs
  const early = Object.values(state.rots).filter((r) => r.status === 'planned').sort((a, b) => a.spawnAt - b.spawnAt).slice(0, 2);
  early.forEach((r, i) => {
    const shift = r.spawnAt - (state.time + 30 + i * 400);
    if (shift > 0) (r.spawnAt -= shift), (r.sta -= shift), (r.std -= shift);
  });
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
  state.aiPlay = false;
}

// Speicherplätze: Platz 1 ist der bisherige Spielstand, dazu Platz 2 und 3
export const SLOTS = [1, 2, 3];
const slotKey = (n) => (n === 1 ? SAVE_KEY : `planez_save_slot${n}`);
const META_KEY = 'planez_slots_meta';
function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '{}');
  } catch (e) {
    return {};
  }
}
// Sicherungskopie je Platz: höchstens alle 10 Minuten wird der vorige Stand weggesichert. Ist ein Stand später
// beschädigt (oder passt nicht mehr zur Spielversion), lädt loadGame die Sicherung.
const bakKey = (n) => slotKey(n) + '_bak';
const BAK_EVERY = 10 * 60 * 1000;
function writeSlot(n, text, meta) {
  localStorage.setItem(slotKey(n), text);
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}
export function saveGame(state) {
  if (state.scenario) return false; // Herausforderungen werden nicht als Spielstand gespeichert
  const n = state.slot || 1;
  try {
    const text = JSON.stringify(state, saveReplacer);
    const meta = readMeta();
    const bak = (meta.bak = meta.bak || {});
    // vorigen Stand als Sicherung behalten (nur wenn er sich laden lässt)
    if (!bak[n] || Date.now() - bak[n] > BAK_EVERY) {
      const old = localStorage.getItem(slotKey(n));
      if (old && parseSave(old)) {
        try {
          localStorage.setItem(bakKey(n), old);
          bak[n] = Date.now();
        } catch (e) {}
      }
    }
    meta[n] = { name: state.name, role: state.role, time: state.time, cash: state.cash, rep: state.reputation, rank: state.goals ? state.goals.rank : 0, stage: state.career ? state.stage : null, saved: Date.now() };
    meta.last = n;
    try {
      writeSlot(n, text, meta);
    } catch (e) {
      // Speicher voll: zuerst die Sicherungen der anderen Plätze opfern, dann noch einmal versuchen
      for (const k of SLOTS) if (k !== n) {
        localStorage.removeItem(bakKey(k));
        delete bak[k];
      }
      writeSlot(n, text, meta);
    }
    return true;
  } catch (e) {
    console.warn(T('Speichern fehlgeschlagen'), e);
    return false;
  }
}
// Text eines Spielstands prüfen und einlesen (null, wenn er beschädigt ist oder nicht passt)
function parseSave(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || s.version !== 1 || !Array.isArray(s.acs) || typeof s.time !== 'number') return null;
    return s;
  } catch (e) {
    return null;
  }
}
// Fahrzeugwege kürzen: bereits gefahrene Wegpunkte (und die Wege geparkter Fahrzeuge) nicht mitspeichern
const trimVeh = (v) => (v && v.path ? { ...v, path: v.st === 'idle' ? [] : v.path.slice(v.pi || 0), pi: 0 } : v);
function saveReplacer(k, v) {
  return k === 'vehicles' && Array.isArray(v) ? v.map(trimVeh) : v;
}

// zuletzt gespeicherter Platz (für „Weiterspielen“)
export function lastSlot() {
  const meta = readMeta();
  if (meta.last && hasSave(meta.last)) return meta.last;
  return SLOTS.find((n) => hasSave(n)) || 1;
}
export function loadGame(n = lastSlot()) {
  const open = (raw) => {
    const s = raw && parseSave(raw);
    if (!s) return null;
    try {
      s.slot = n;
      applyStage(s);
      return s;
    } catch (e) {
      return null;
    }
  };
  try {
    const s = open(localStorage.getItem(slotKey(n)));
    if (s) return s;
    // beschädigt: Sicherungskopie versuchen
    const b = open(localStorage.getItem(bakKey(n)));
    if (b) b.restoredFrom = readMeta().bak?.[n] || 1;
    return b;
  } catch (e) {
    return null;
  }
}
// Spielstand als Datei (Export) und aus einer Datei (Import)
export function exportSave(n) {
  try {
    const raw = localStorage.getItem(slotKey(n));
    const s = raw && parseSave(raw);
    if (!s) return null;
    const day = new Date().toISOString().slice(0, 10);
    const name = String(s.name || 'Planez').replace(/[^\w\-]+/g, '_').slice(0, 40);
    return { file: `planez_${name}_${day}.json`, text: raw };
  } catch (e) {
    return null;
  }
}
export function importSave(text, n) {
  const s = parseSave(text);
  if (!s) return { ok: false, why: 'invalid' };
  if (s.scenario) return { ok: false, why: 'scenario' };
  try {
    s.slot = n;
    const meta = readMeta();
    meta[n] = { name: s.name, role: s.role, time: s.time, cash: s.cash, rep: s.reputation, rank: s.goals ? s.goals.rank : 0, stage: s.career ? s.stage : null, saved: Date.now() };
    writeSlot(n, JSON.stringify(s), meta);
    return { ok: true, name: s.name };
  } catch (e) {
    return { ok: false, why: 'full' };
  }
}
export function hasSave(n) {
  try {
    if (n) return !!localStorage.getItem(slotKey(n));
    return SLOTS.some((k) => !!localStorage.getItem(slotKey(k)));
  } catch (e) {
    return false;
  }
}
export function deleteSave(n = 1) {
  try {
    localStorage.removeItem(slotKey(n));
    localStorage.removeItem(bakKey(n));
    const meta = readMeta();
    delete meta[n];
    if (meta.bak) delete meta.bak[n];
    if (meta.last === n) delete meta.last;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch (e) {}
}
// Übersicht für das Menü (ohne alle Stände zu parsen, wenn Metadaten vorhanden sind)
export function slotInfo() {
  const meta = readMeta();
  return SLOTS.map((n) => {
    if (!hasSave(n)) return { n, empty: true };
    let m = meta[n];
    if (!m) {
      const s = loadGame(n);
      m = s ? { name: s.name, role: s.role, time: s.time, cash: s.cash, rep: s.reputation, rank: s.goals ? s.goals.rank : 0, saved: 0 } : null;
    }
    return m ? { n, ...m, last: meta.last === n } : { n, empty: true };
  });
}
// erster freier Platz (sonst der älteste)
export function freeSlot() {
  const info = slotInfo();
  const free = info.find((x) => x.empty);
  if (free) return free.n;
  return info.slice().sort((a, b) => (a.saved || 0) - (b.saved || 0))[0].n;
}
