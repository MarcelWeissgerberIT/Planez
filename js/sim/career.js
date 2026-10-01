// Karriere „Vom Grasplatz zum Drehkreuz“: Man beginnt mit einer 560-m-Graspiste, einem Vereinsheim mit Flugleitung
// und einer Zapfsäule. Anfangs landen nur ein paar Privatflieger – wenig Verkehr, wenig Geld. Partner (Flugschule,
// Fallschirmclub, Rundflüge), Marketing (Flugplatzfest, Anzeige, Fly-In) und guter Betrieb machen den Platz bekannter;
// sind die Bedingungen einer Ausbaustufe erfüllt, bauen Land, Kreis und Investoren – man trägt nur den Eigenanteil.
// Stufen: 0 Grasplatz · 1 Verkehrslandeplatz · 2 Regionalflughafen · 3 Internationaler Flughafen · 4 Drehkreuz.
// Die Geometrie (Pistenlänge, Abrollwege, Rollwege) folgt der Stufe über LY.setGeometry; Gebäude über buildingOn.
import { IS_DEMO, DEMO } from '../edition.js';
import * as LY from '../layout.js';
import { syncThr } from './airspace.js';
import { AC_TYPES, AIRLINES, CITIES, VEH_TYPES } from '../config.js';
import { clamp, rand, randInt, randRange, pick, pickWeighted, fmtMoney, dayOf, hourOf } from '../util.js';
import { log, notify, fx } from './messages.js';
import { pushNews } from './news.js';
import { nextId, makeContract, generateDay } from './schedule.js';
import { earn, spend, capex } from './economy.js';
import { startProject, projects } from './construction.js';
import { makeVehicle, freeBay } from './ground.js';
import { loanLimit as loanLimitFn, takeLoan as takeLoanFn } from './finance.js';
import { T, LOCALE } from '../i18n.js';

const H = 3600;
export const STAGES = [
  {
    name: T('Grasplatz'), icon: '🌾', img: 'assets/sprites/clubhouse.webp',
    desc: T('Graspiste 560 m, Vereinsheim mit Flugleitung, Zapfsäule – nur Sportflugzeuge.'),
    geo: { x0: 26, x1: 54, hw: 0.85, td: 1.6, thr09: 27, thr27: 53, grass: true, exits: [32, 44], conn: [38.5, 56] },
    staff: 3,
  },
  {
    name: T('Verkehrslandeplatz'), icon: '🛩️', img: 'assets/sprites/small_terminal.webp',
    desc: T('Asphaltbahn 960 m, Vorfeld mit fünf Positionen, Abfertigungsgebäude, Flugleitung – Turboprops, Lufttaxis, Geschäftsflieger.'),
    geo: { x0: 16, x1: 64, hw: 1.0, td: 2.2, thr09: 18, thr27: 62, exits: [20, 32, 44, 56], conn: [12, 38.5, 56] },
    staff: 18,
  },
  {
    name: T('Regionalflughafen'), icon: '🛫', img: 'assets/sprites/terminal_hall.webp',
    desc: T('Piste 1.400 m mit ILS, Terminal mit Fluggastbrücken, Tower, Tanklager, Parkhaus – Regionaljets und Mittelstrecke.'),
    geo: {},
    staff: 30,
  },
  {
    name: T('Internationaler Flughafen'), icon: '🌍', img: 'assets/sprites/cargo.webp',
    desc: T('Langstrecke und Fracht: Großraumflugzeuge, Frachtterminal, Radar.'),
    geo: {},
    staff: 44,
  },
  {
    name: T('Drehkreuz'), icon: '🌐', img: 'assets/sprites/tower.webp',
    desc: T('Parallelbahn, Superjumbo-tauglich – das Ziel der Karriere.'),
    geo: {},
    staff: 60,
  },
];
export const MAX_STAGE = STAGES.length - 1;

export const isCareer = (s) => !!(s && s.career);
// Ausbaustufe (freies Spiel: 9 = alles vorhanden)
export const stageOf = (s) => (s && s.career ? s.stage || 0 : 9);
export const stageName = (s) => (s && s.career ? STAGES[stageOf(s)].name : null);
export const careerState = (s) => s.career || (s.career = { fame: 8, festCd: 0, log: [] });

// Geometrie der Stufe setzen (bei Spielstart, Laden und nach jedem Ausbau)
export function applyStage(state) {
  const st = stageOf(state);
  LY.setGeometry(st <= MAX_STAGE ? { ...STAGES[st].geo, stage: st } : {});
  syncThr();
}

// ---------- Flugzeuge je Stufe ----------
const REGIONAL_TP = new Set(['AT76', 'DH8D']);
export function typeAllowed(state, type) {
  const st = stageOf(state);
  const t = AC_TYPES[type];
  if (!t) return false;
  if (st >= 9) return !t.light && type !== 'PC12' && type !== 'BE20';
  if (t.light) return true;
  if (st === 0) return false;
  if (type === 'PC12' || type === 'BE20' || type === 'C68A' || REGIONAL_TP.has(type)) return true;
  if (st === 1) return false;
  if (type === 'A388') return st >= 4;
  if (t.size === 'L' || t.cargo) return st >= 3;
  return true;
}

// ---------- Parkpositionen je Stufe ----------
// Grasplatz: drei Abstellplätze auf der Wiese (6–8) vor Vereinsheim und Halle. Verkehrslandeplatz: dazu Vorfeld mit
// Positionen 1–5 (ohne Brücken, Fluggäste gehen zu Fuß bzw. fahren Bus). Ab Regionalflughafen das normale Vorfeld.
// Wiesenplätze für Kleinflugzeuge (Karriere): eine Reihe vor Tankstelle, Vereinsheim und Halle
export const GA_SLOTS = Array.from({ length: 10 }, (_, i) => ({ id: 11 + i, x: 40 + i * 1.35 }));
export function setupStands(state, stage) {
  for (const g of GA_SLOTS) if (!state.stands.some((s) => s.id === g.id)) state.stands.push({ id: g.id, x: g.x, kind: 'remote', size: 'S', built: false, occ: null, resv: null, bridge: 0, ga: true, grass: true });
  const DEF = LY.STAND_DEFS;
  for (const st of state.stands) {
    if (st.ga) {
      st.built = stage <= 1 || !!st.occ;
      st.closed = stage > 1; // ab Regionalflughafen weicht die Wiese dem Vorfeld
      continue;
    }
    const d = DEF.find((x) => x.id === st.id) || st;
    if (stage === 0) {
      st.built = false;
    } else if (stage === 1) {
      st.built = st.id <= 5;
      st.kind = 'remote';
      st.size = 'M';
    } else {
      // ab Regionalflughafen: Grundriss wie im freien Spiel; selbst gebaute Positionen bleiben
      const was1 = st.kind === 'remote' && d.kind !== 'remote';
      st.kind = d.kind;
      if (st.id <= 6 || st.id === 8) st.built = true;
      if (st.id === 9 && stage >= 3) st.built = true;
      // Großraum-Positionen erst als Internationaler Flughafen (selbst umgebaute bleiben L)
      if (st.size !== 'L' || was1) st.size = d.size === 'L' ? (stage >= 3 ? 'L' : 'M') : d.size;
    }
    if (!st.built) st.bridge = 0;
  }
}
// Linien-Umläufe pro Tag, die Vorfeld und Abfertigung der Stufe verkraften (Karriere)
export const ROT_CAP = [0, 9, 34, 70];
export const airlineRotations = (state) => state.contracts.filter((c) => !partnerOf(c)).reduce((t, c) => t + c.perDay, 0);
export function rotCap(state) {
  const st = stageOf(state);
  if (st >= 9 || st >= ROT_CAP.length) return Infinity;
  const extra = st >= 2 ? state.stands.filter((s) => s.built && !s.ga && s.id > 6 && s.kind !== 'cargo').length * 5 : 0;
  return ROT_CAP[st] + extra;
}

// Ausbauten aus dem Katalog je Stufe (die Parallelbahn ist in der Karriere die Stufe „Drehkreuz“)
export function upgradeAllowed(state, key) {
  const st = stageOf(state);
  if (st >= 9) return true;
  if (key === 'rwy2') return false;
  if (st < 2) return false;
  if (key === 'lounge' || key === 'rail') return st >= 3;
  return true;
}
// ab welcher Stufe ein Ausbau aus dem Katalog möglich ist (Karriere)
export const upgradeStage = (key) => (key === 'rwy2' ? 4 : key === 'lounge' || key === 'rail' ? 3 : 2);
// kleiner Platz (Grasplatz oder Verkehrslandeplatz): Zentrale zeigt Wiese, AvGas und Vereinsheim statt Terminal & Co.
export const smallField = (state) => isCareer(state) && stageOf(state) < 2;
// Fahrzeuge gibt es erst ab dem Verkehrslandeplatz – am Grasplatz schieben Piloten selbst und tanken an der Säule
export const vehicleAllowed = (state, type) => !isCareer(state) || stageOf(state) >= 1 || !type;

// Kreditrahmen und Pistenarbeiten passen zur Größe des Platzes
export const LOAN_CAP = [60000, 600000, 6000000, 14000000, 22000000];
export const RWY_WORK_F = [0.02, 0.12, 0.6, 1, 1];
export function rwyWorkCost(state, w) {
  const st = stageOf(state);
  return st >= 9 ? w.cost : Math.round((w.cost * RWY_WORK_F[st]) / 500) * 500;
}
export const staffBase = (state) => (isCareer(state) ? [2, 4, 10, 10, 10][stageOf(state)] : 10);

// darf der Spieler diese Position selbst bauen?
export function standBuildable(state, st) {
  const sg = stageOf(state);
  if (sg >= 9) return true;
  if (sg < 2) return false;
  return st.kind !== 'cargo' || sg >= 3;
}

// ---------- Kennzeichen ----------
const LET = 'ABCDEFGHIKLMNOPRSTUWXYZ';
export function makeReg(state, prefix = 'E') {
  const used = new Set(Object.values(state.rots).map((r) => r.arrNo));
  for (let i = 0; i < 40; i++) {
    const r = `D-${prefix}${LET[randInt(state, 0, LET.length - 1)]}${LET[randInt(state, 0, LET.length - 1)]}${LET[randInt(state, 0, LET.length - 1)]}`;
    if (!used.has(r)) return r;
  }
  return `D-${prefix}${String(nextId(state)).slice(-3)}`;
}
export const isReg = (cs) => /^D-[A-Z]{4}$/.test(cs || '');

// ---------- Besucherverkehr (Privatflieger) ----------
const weekend = (day) => [6, 0].includes(day % 7); // Tag 1 = Montag
export function visitorsFor(state, day) {
  const st = stageOf(state);
  if (st >= 3) return 0;
  const C = careerState(state);
  let n = 4.5 + C.fame * 0.22 + (state.reputation - 55) * 0.12;
  if (weekend(day)) n *= 1.6;
  if (C.adUntil && C.adUntil > (day - 1) * 86400) n *= 1.3;
  n *= [1, 1.3, 0.45][st] ?? 0;
  // mehr Gäste, als die Bahn (Sichtflug, eine Piste, 8–18 Uhr) neben Partnern und Linie verkraftet, kommen nicht
  const planned = state.contracts.reduce((t, c) => t + c.perDay * 2, 0);
  const room = Math.max(2, (RWY_DAY[st] - planned) / 2);
  return Math.max(1, Math.round(Math.min(n, room)));
}
// Bewegungen pro Tag, die Graspiste, Verkehrslandeplatz und Regionalflughafen im Aufbau sicher abwickeln
export const RWY_DAY = [60, 96, 150];

// GA-Umlauf: kommt an, bleibt eine Weile (Café, Tanken), fliegt weiter
export function makeGaRot(state, o) {
  const t = AC_TYPES[o.type];
  const reg = o.reg || makeReg(state, t.light ? 'E' : 'F');
  const arrDelay = Math.round(randRange(state, -6, 8));
  const rot = {
    id: nextId(state, 'r'),
    contract: o.contract || null,
    airline: o.airline,
    type: o.type,
    arrNo: reg,
    depNo: reg,
    city: o.city,
    sta: o.sta,
    std: o.std,
    arrDelay,
    paxIn: o.paxIn ?? randInt(state, 1, Math.min(3, t.pax)),
    paxOut: o.paxOut ?? randInt(state, 1, Math.min(3, t.pax)),
    cargoIn: 0,
    cargoOut: 0,
    status: 'planned',
    feeMult: 1,
    ga: true,
    partner: o.partner || null,
    spawnAt: o.sta + arrDelay * 60 - 24 * 60,
    ac: null,
  };
  state.rots[rot.id] = rot;
  return rot;
}

export function generateVisitors(state, day, extra = 0, window = [8.2, 17.6]) {
  const n = extra || visitorsFor(state, day);
  const dayStart = (day - 1) * 86400;
  const cities = Object.keys(CITIES).filter((c) => CITIES[c].cat === 'ga');
  const types = ['C172', 'C172', 'PA28', 'PA28', 'DR40'];
  if (stageOf(state) >= 1) types.push('PC12', 'C68A', 'BE20');
  const out = [];
  for (let i = 0; i < n; i++) {
    const type = pick(state, types);
    const sta = dayStart + Math.round((randRange(state, window[0], window[1]) * H) / 300) * 300;
    if (sta - 24 * 60 < state.time + 120) continue;
    const stay = randInt(state, 9, 30) * 300 * (AC_TYPES[type].light ? 1 : 0.7);
    out.push(makeGaRot(state, { airline: 'GAV', type, city: pick(state, cities), sta, std: sta + Math.max(AC_TYPES[type].turn * 60, stay) }));
  }
  return out;
}

// ---------- Partner (Verträge mit Flugschule, Fallschirmclub, Rundflügen, Lufttaxi) ----------
export const PARTNERS = {
  school: { al: 'FSH', name: T('Flugschule'), icon: '🎓', perDay: 4, rent: 220, perFlight: 35, city: 'PLR', fame: 0, stage: 0, desc: T('Schulungsflüge mit Platzrunden, zahlt Pacht für Halle und Schulungsraum.') },
  scenic: { al: 'RFS', name: T('Rundflüge'), icon: '🏞️', perDay: 3, rent: 120, perFlight: 80, city: 'RND', fame: 14, stage: 0, desc: T('Rundflüge über die Gegend – Provision je Flug, zieht Besucher ans Vereinsheim.') },
  skydive: { al: 'SKD', name: T('Fallschirmsprung'), icon: '🪂', perDay: 5, rent: 300, perFlight: 150, city: 'JMP', fame: 24, stage: 0, desc: T('Absetzflüge mit Springern – viele Bewegungen, gute Provision, beliebt bei Zuschauern.') },
  taxi: { al: 'ATX', name: T('Lufttaxi'), icon: '💼', perDay: 2, rent: 450, perFlight: 260, city: null, fame: 0, stage: 1, desc: T('Geschäftsreisende mit Turboprops – zahlt gut, will pünktliche Abfertigung.') },
};
export const partnerOf = (c) => (c && AIRLINES[c.airline] ? AIRLINES[c.airline].partner : null);
export const partnerContracts = (state) => state.contracts.filter((c) => partnerOf(c));

// Partner-Umläufe des Tages (gleichmäßig über den Tag)
export function generatePartnerDay(state, c, day) {
  const P = PARTNERS[partnerOf(c)];
  const dayStart = (day - 1) * 86400;
  const out = [];
  const n = c.perDay;
  for (let k = 0; k < n; k++) {
    const sta = dayStart + Math.round(((9 + (k + randRange(state, 0.1, 0.8)) * (8.5 / n)) * H) / 300) * 300;
    if (sta - 24 * 60 < state.time + 120) continue; // schon vorbei (Vertrag am laufenden Tag)
    const type = pick(state, AIRLINES[c.airline].types);
    const city = P.city || pick(state, Object.keys(CITIES).filter((x) => CITIES[x].cat === 'short'));
    const rot = makeGaRot(state, { airline: c.airline, type, city, sta, std: sta + AC_TYPES[type].turn * 60 + randInt(state, 1, 4) * 300, contract: c.id, partner: partnerOf(c), reg: c.regs ? c.regs[k % c.regs.length] : null, paxIn: P.city === 'JMP' ? 0 : undefined, paxOut: P.city === 'JMP' ? Math.min(8, AC_TYPES[type].pax) : undefined });
    if (P.al === 'ATX') rot.arrNo = rot.depNo = `ATX${c.base + k * 2}`;
    out.push(rot);
  }
  return out;
}

// Angebote in der Karriere: Partner am kleinen Platz, ab Verkehrslandeplatz auch Regionalairlines
export function careerOffer(state) {
  const st = stageOf(state);
  const C = careerState(state);
  const have = new Set(state.contracts.map((c) => c.airline));
  const open = new Set(state.offers.map((o) => o.airline));
  const cands = Object.entries(PARTNERS).filter(([k, P]) => P.stage <= st && C.fame >= P.fame && !have.has(P.al) && !open.has(P.al));
  if (cands.length && (st <= 1 || rand(state) < 0.25)) {
    const [k, P] = pick(state, cands);
    const al = AIRLINES[P.al];
    return { airline: P.al, type: al.types[0], city: P.city || 'PLR', perDay: P.perDay, days: randInt(state, 30, 60), partner: k, rent: P.rent };
  }
  if (st === 0) return null;
  return 'airline';
}

// ---------- Marketing ----------
export const ACTIONS = {
  fest: {
    name: (st) => (st <= 1 ? T('Flugplatzfest') : T('Flughafenfest')), icon: '🎪',
    cost: [4500, 15000, 80000, 160000, 250000], cd: 6,
    desc: T('Morgen von 10 bis 18 Uhr: Besucher, Essen, Musik, Gastflieger. Bringt Eintritt und Ansehen, macht den Platz bekannt – bei Regen kommen weniger.'),
    run(state) {
      const day = dayOf(state.time) + (hourOf(state.time) < 8 ? 0 : 1);
      const C = careerState(state);
      C.fest = { from: (day - 1) * 86400 + 10 * H, until: (day - 1) * 86400 + 18 * H, paid: 0, visitors: 0 };
      state.openDay = { from: C.fest.from, until: C.fest.until, big: stageOf(state) >= 2, fest: true };
      generateVisitors(state, day, 6 + Math.round(C.fame / 8), [10, 15.5]);
      return day === dayOf(state.time) ? T('Fest für heute angekündigt – Plakate hängen, der Grill ist bestellt.') : T('Fest für morgen angekündigt – Plakate hängen, der Grill ist bestellt.');
    },
  },
  ad: {
    name: (st) => (st <= 1 ? T('Anzeige im Fliegermagazin') : T('Werbekampagne')), icon: '📰',
    cost: [1200, 6000, 40000, 120000, 200000], cd: 4,
    desc: T('4 Tage lang mehr Gastflieger und Interesse von Partnern; Bekanntheit steigt.'),
    run(state) {
      const C = careerState(state);
      C.adUntil = state.time + 4 * 86400;
      C.fame = clamp(C.fame + 5, 0, 100);
      state.offerTimer = Math.min(state.offerTimer ?? 0, 3 * H);
      return T('Anzeige geschaltet – Piloten in der Gegend werden aufmerksam.');
    },
  },
  flyin: {
    name: () => T('Fly-In (Pilotentreffen)'), icon: '🛩️', maxStage: 1,
    cost: [2000, 5000], cd: 5,
    desc: T('Morgen kommen viele Gastflieger auf einmal: Landegebühren, Sprit und volles Vereinsheim – die Flugleitung hat zu tun.'),
    run(state) {
      const day = dayOf(state.time) + 1;
      const C = careerState(state);
      generateVisitors(state, day, 10 + Math.round(C.fame / 10), [9, 13]);
      C.fame = clamp(C.fame + 3, 0, 100);
      return T('Einladung verschickt – morgen Vormittag wird es voll in der Platzrunde.');
    },
  },
};
export function actionCost(state, k) {
  const a = ACTIONS[k];
  return a.cost[Math.min(stageOf(state), a.cost.length - 1)];
}
export function actionReady(state, k) {
  const a = ACTIONS[k];
  const C = careerState(state);
  const st = stageOf(state);
  if (a.maxStage !== undefined && st > a.maxStage) return { ok: false, why: T('nicht mehr in dieser Ausbaustufe') };
  const left = (C['cd_' + k] || 0) - state.time;
  if (left > 0) return { ok: false, days: Math.ceil(left / 86400), why: left > 86400 ? T`wieder in ${Math.ceil(left / 86400)} Tagen` : T`wieder in ${Math.ceil(left / 86400)} Tag` };
  if (k === 'fest' && C.fest && C.fest.until > state.time) return { ok: false, why: T('Fest läuft schon') };
  if (state.cash < actionCost(state, k)) return { ok: false, why: T('zu wenig Geld') };
  return { ok: true };
}
export function runAction(state, k) {
  const r = actionReady(state, k);
  if (!r.ok) return notify(state, `${ACTIONS[k].name(stageOf(state))}: ${r.why}`, 'warn'), false;
  const cost = actionCost(state, k);
  spend(state, 'marketing', cost);
  const C = careerState(state);
  C['cd_' + k] = state.time + ACTIONS[k].cd * 86400;
  const msg = ACTIONS[k].run(state);
  state.life = state.life || {};
  state.life['act_' + k] = (state.life['act_' + k] || 0) + 1;
  log(state, 'mgr', `${ACTIONS[k].icon} ${ACTIONS[k].name(stageOf(state))} (${fmtMoney(cost)}): ${msg}`);
  notify(state, `${ACTIONS[k].icon} ${msg}`, 'good');
  return true;
}

// ---------- Ausbaustufen ----------
const lastDays = (state, n = 2) => (state.history || []).slice(-n);
const best = (state, key) => Math.max(0, ...lastDays(state).map((r) => r[key] || 0));
const airlineContracts = (state) => state.contracts.filter((c) => !partnerOf(c) && !AIRLINES[c.airline].ga).length;
export const STAGE_UP = {
  1: {
    total: 3200000, own: 60000, hours: 30,
    what: T('Asphaltbahn 960 m mit Befeuerung, Vorfeld mit fünf Positionen, Abfertigungsgebäude, Flugleitung, Feuerwehr und Grundausstattung an Fahrzeugen'),
    reqs: [
      { label: T('Ansehen ≥ 56'), ok: (s) => s.reputation >= 56, have: (s) => `${Math.round(s.reputation)}` },
      { label: T('≥ 24 Bewegungen an einem der letzten 2 Tage'), ok: (s) => best(s, 'mov') >= 24, have: (s) => `${best(s, 'mov')}` },
      { label: T('≥ 2 Partner (Flugschule, Rundflüge, Fallschirm)'), ok: (s) => partnerContracts(s).length >= 2, have: (s) => `${partnerContracts(s).length}` },
    ],
  },
  2: {
    total: 46000000, own: 450000, hours: 54,
    what: T('Piste auf 1.400 m mit ILS, Terminal mit Fluggastbrücken, Tower, Tanklager, Parkhaus und Wartungshalle'),
    reqs: [
      { label: T('Ansehen ≥ 60'), ok: (s) => s.reputation >= 60, have: (s) => `${Math.round(s.reputation)}` },
      { label: T('≥ 3 Linien-Verträge mit Airlines'), ok: (s) => airlineContracts(s) >= 3, have: (s) => `${airlineContracts(s)}` },
      { label: T('≥ 500 Passagiere an einem der letzten 2 Tage'), ok: (s) => best(s, 'pax') >= 500, have: (s) => `${best(s, 'pax')}` },
    ],
  },
  3: {
    total: 180000000, own: 1600000, hours: 66,
    what: T('Großraum-Positionen, Frachtterminal mit Frachtposition, Radar und Lounge-Bereich'),
    reqs: [
      { label: T('Ansehen ≥ 64'), ok: (s) => s.reputation >= 64, have: (s) => `${Math.round(s.reputation)}` },
      { label: T('≥ 9 Linien-Verträge'), ok: (s) => airlineContracts(s) >= 9, have: (s) => `${airlineContracts(s)}` },
      { label: T('≥ 3.500 Passagiere an einem der letzten 2 Tage'), ok: (s) => best(s, 'pax') >= 3500, have: (s) => `${best(s, 'pax')}` },
    ],
  },
  4: {
    total: 420000000, own: 4000000, hours: 60,
    what: T('Parallelbahn Süd mit Rollweg B – getrennter Betrieb für Landungen und Starts, Superjumbo-tauglich'),
    reqs: [
      { label: T('Ansehen ≥ 64'), ok: (s) => s.reputation >= 64, have: (s) => `${Math.round(s.reputation)}` },
      { label: T('≥ 14 Linien-Verträge'), ok: (s) => airlineContracts(s) >= 14, have: (s) => `${airlineContracts(s)}` },
      { label: T('≥ 8.000 Passagiere an einem der letzten 2 Tage'), ok: (s) => best(s, 'pax') >= 8000, have: (s) => `${best(s, 'pax')}` },
    ],
  },
};
export const stageProject = (state) => projects(state).find((p) => p.kind === 'stage') || null;
export function stageUpStatus(state) {
  const st = stageOf(state);
  const next = STAGE_UP[st + 1];
  if (!next) return null;
  const reqs = next.reqs.map((r) => ({ label: r.label, ok: !!r.ok(state), have: r.have(state) }));
  const cash = state.cash >= next.own;
  const building = stageProject(state);
  return { to: st + 1, def: next, reqs, cash, building, ready: !building && cash && reqs.every((r) => r.ok) };
}
// Demo: höhere Ausbaustufen gesperrt
export const demoLocked = (to) => IS_DEMO && to > DEMO.careerMaxStage;
export function startStageUp(state) {
  const S = stageUpStatus(state);
  if (!S) return false;
  if (demoLocked(S.to)) return notify(state, T`🔒 Der Ausbau zum ${STAGES[S.to].name} ist Teil der Vollversion`, 'info'), false;
  if (!S.ready) return notify(state, S.building ? T('Der Ausbau läuft bereits') : T('Bedingungen für den Ausbau noch nicht erfüllt'), 'warn'), false;
  capex(state, S.def.own, T`Eigenanteil Ausbau zum ${STAGES[S.to].name}`);
  startProject(state, 'stage', S.to, { name: T`Ausbau zum ${STAGES[S.to].name}`, cost: S.def.own, hours: S.def.hours });
  pushNews(state, T`Spatenstich in ${state.name}: Land, Kreis und Investoren bauen den Platz zum ${STAGES[S.to].name} aus (${fmtMoney(S.def.total)}).`, 'good', '🏗️');
  return true;
}

// Fahrzeug-Grundausstattung je Stufe (Mindestbestand)
const FLEET = {
  1: { tug: 2, baggage: 2, fuel: 2, catering: 1, cleaning: 1, bus: 2, deice: 1 },
  2: { tug: 3, baggage: 3, fuel: 2, catering: 2, cleaning: 2, bus: 2, deice: 1 },
  3: { tug: 4, baggage: 5, fuel: 3, catering: 3, cleaning: 2, bus: 2, deice: 2 },
  4: { tug: 5, baggage: 6, fuel: 3, catering: 3, cleaning: 3, bus: 3, deice: 2 },
};
export function completeStage(state, to) {
  const C = careerState(state);
  state.stage = to;
  applyStage(state);
  setupStands(state, to);
  const fleet = FLEET[to] || {};
  for (const [type, n] of Object.entries(fleet)) {
    const have = state.vehicles.filter((v) => v.type === type).length;
    for (let i = have; i < n && state.vehicles.length < 24; i++) state.vehicles.push(makeVehicle(state, type, freeBay(state)));
  }
  state.staff = Math.max(state.staff, STAGES[to].staff);
  if (to === 2) state.upgrades.ils3 = state.upgrades.ils3 || 0;
  if (to === 4) {
    state.upgrades.rwy2 = 1;
    state.rwyMode = 'seg';
    state.rwyCondS = 100;
  }
  state.reputation = clamp(state.reputation + 4, 0, 100);
  C.fame = clamp(C.fame + 10, 0, 100);
  C.log.push({ stage: to, t: state.time });
  state.life = state.life || {};
  state.life.stageMax = Math.max(state.life.stageMax || 0, to);
  log(state, 'mgr', T`🎉 ${state.name} ist jetzt ${STAGES[to].name}: ${STAGES[to].desc}`);
  notify(state, T`🎉 Neue Ausbaustufe: ${STAGES[to].name}!`, 'good');
  pushNews(state, T`Eröffnung: ${state.name} ist jetzt ${STAGES[to].name}. ${STAGES[to].desc}`, 'good', STAGES[to].icon);
  fx(state, 40, 26, `${STAGES[to].icon} ${STAGES[to].name}`, 'good');
  state.stageUpT = state.time; // für das Eröffnungs-Banner
}

// ---------- laufende Kosten und Erlöse ----------
// Fixkosten der kleinen Stufen (pro Tag): Mähen und Pistenpflege, Versicherung, Strom, Flugleitung
const FIX = [
  { atc: 0, infra: 240, admin: 260, utilities: 110 },
  { atc: 2400, infra: 3600, admin: 2800, utilities: 1300 },
  { atc: 8000, infra: null, admin: 9000, utilities: 4500, f: 0.55 },
  { atc: null, infra: null, admin: null, utilities: null, f: 0.85 },
];
export function careerFixedCosts(state, fc) {
  const st = stageOf(state);
  const k = FIX[st];
  if (!k) return fc;
  for (const key of ['atc', 'infra', 'admin', 'utilities']) {
    if (k[key] !== null && k[key] !== undefined) fc[key] = k[key];
    else if (k.f) fc[key] *= k.f;
  }
  // Partner zahlen Pacht (als negative Kosten verbucht wäre unschön – siehe hourlyCareer)
  return fc;
}
// Erlöse eines Kleinflugzeugs/Partnerflugs beim Start
export function gaTakeoffRevenue(state, ac, rot, earnF) {
  const t = AC_TYPES[ac.type];
  const C = careerState(state);
  // Sprit an der Zapfsäule (AvGas) bzw. Jet A-1 für Turboprops: Marge je Liter
  const litres = t.light ? randRange(state, 35, 110) : randRange(state, 250, 700);
  earnF('fuel', litres * (t.light ? 0.85 : 0.45));
  // Vereinsheim/Café: Piloten und Gäste kehren ein
  const guests = (rot.paxIn || 0) + 1;
  if (rot.partner !== 'skydive') earnF('retail', guests * (stageOf(state) === 0 ? 11 : 14));
  // Partner: Provision je Flug
  if (rot.partner) {
    const P = PARTNERS[rot.partner];
    earnF('other', P.perFlight);
  }
  // Abstellgebühr
  const hours = rot.onBlock && rot.offBlock ? Math.max(0, (rot.offBlock - rot.onBlock) / H - 0.5) : 0;
  earnF('parking', hours * (t.light ? 6 : 25));
  C.fame = clamp(C.fame + (rot.partner ? 0.04 : 0.08), 0, 100);
}

export function hourlyCareer(state) {
  if (!isCareer(state)) return;
  const C = careerState(state);
  // Pacht der Partner
  for (const c of partnerContracts(state)) earn(state, 'other', (PARTNERS[partnerOf(c)].rent || 0) / 24);
  // Flugplatzfest: Besucher zahlen Eintritt, essen, trinken
  const F = C.fest;
  if (F && state.time >= F.from && state.time < F.until) {
    const wx = state.weather.kind;
    const wxF = wx === 'clear' ? 1 : wx === 'clouds' ? 0.8 : wx === 'fog' ? 0.5 : 0.35;
    const st = stageOf(state);
    const base = [130, 260, 900, 1800, 2600][Math.min(st, 4)];
    const v = Math.round(base * wxF * (0.7 + C.fame / 100) * randRange(state, 0.85, 1.15));
    const per = [7.5, 9, 11, 12, 12][Math.min(st, 4)];
    earn(state, 'other', v * per);
    F.visitors += v;
    F.paid += v * per;
    C.fame = clamp(C.fame + 0.9 * wxF, 0, 100);
    state.reputation = clamp(state.reputation + 0.25 * wxF, 0, 100);
    if (state.time + H >= F.until && !F.done) {
      F.done = true;
      state.life = state.life || {};
      state.life.fests = (state.life.fests || 0) + 1;
      log(state, 'mgr', T`🎪 Fest vorbei: ${F.visitors.toLocaleString(LOCALE)} Besucher, Einnahmen ${fmtMoney(F.paid)}.`);
      pushNews(state, T`${F.visitors.toLocaleString(LOCALE)} Besucher beim Fest in ${state.name}${wx === 'clear' ? T(' – bei bestem Flugwetter') : ''}.`, 'good', '🎪');
    }
  }
}

export function dailyCareer(state, rec) {
  if (!isCareer(state)) return;
  const C = careerState(state);
  // Bekanntheit verblasst ohne Pflege langsam
  C.fame = clamp(C.fame - Math.max(0.3, (C.fame - 8) * 0.04), 5, 100);
  // ehrlich: rote Zahlen haben Folgen
  if (state.cash < 0) {
    C.redDays = (C.redDays || 0) + 1;
    state.reputation = clamp(state.reputation - 1.5 * C.redDays, 0, 100);
    notify(state, C.redDays >= 3 ? T('🏦 Die Bank wird ungeduldig – Kosten senken oder Kredit aufnehmen!') : T('⚠️ Konto im Minus – Partner und Gäste merken das'), 'bad');
  } else C.redDays = 0;
}

// Tagesverkehr in der Karriere (Besucher und Partner) – Aufruf aus generateDay
export function generateCareerDay(state, day) {
  if (!isCareer(state)) return;
  generateVisitors(state, day);
  for (const c of partnerContracts(state)) generatePartnerDay(state, c, day);
}

// Entscheidungskarten, die zu einem kleinen Platz passen (Linienbetrieb-Karten erst ab Regionalflughafen)
const SMALL_CARDS = new Set(['drone', 'birds']);
export const careerCardOk = (state, key) => !isCareer(state) || stageOf(state) >= 2 || SMALL_CARDS.has(key);

// KI: Geld zurücklegen, sobald nur noch der Eigenanteil für die nächste Stufe fehlt
export function careerReserve(state) {
  if (!isCareer(state)) return 0;
  const S = stageUpStatus(state);
  return S && !S.building && S.reqs.filter((r) => !r.ok).length <= 1 ? S.def.own : 0;
}

// ---------- Management-KI für die Karriere ----------
export function autoCareer(state) {
  if (!isCareer(state)) return;
  const st = stageOf(state);
  const S = stageUpStatus(state);
  if (S && S.ready) startStageUp(state);
  const C = careerState(state);
  const reserve = [8000, 60000, 600000, 1500000, 2500000][Math.min(st, 4)];
  const keep = S && !S.building && S.reqs.every((r) => r.ok) ? S.def.own : 0; // fürs Ausbauen sparen
  const can = (k) => actionReady(state, k).ok && state.cash - actionCost(state, k) > reserve + keep;
  // knappe Kasse: Kredit im Rahmen der Stufe
  if (state.cash < reserve * 0.3 && state.hourTick % 6 === 0) {
    const amt = [20000, 150000, 1500000, 3000000, 4000000][Math.min(st, 4)];
    if (loanLimitFn && loanLimitFn(state) >= amt) takeLoanFn(state, amt);
  }
  const h = hourOf(state.time);
  if (h > 8 && h < 17) {
    if (can('fest') && (st <= 1 || state.hourTick % 24 === 9)) runAction(state, 'fest');
    else if (st <= 1 && can('flyin')) runAction(state, 'flyin');
    else if (can('ad') && C.fame < 60) runAction(state, 'ad');
  }
}
