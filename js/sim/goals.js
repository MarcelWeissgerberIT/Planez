// Ziele je Station, Erfahrungspunkte (XP) und Flughafen-Rang
import { fmtMoney, clamp, randInt } from '../util.js';
import { log, notify, listeners } from './messages.js';
import { nextId } from './schedule.js';
import { isCareer, stageOf } from './career.js';

// Karriere: Prämien und Geld-/Passagierziele passen zur Größe des Platzes
const MONEY_F = [0.06, 0.25, 0.6, 1, 1];
const moneyF = (state) => (isCareer(state) ? MONEY_F[Math.min(4, stageOf(state))] : 1);

export const RANKS = [
  { name: 'Regionalflughafen', xp: 0 },
  { name: 'Verkehrsflughafen', xp: 500 },
  { name: 'Internationaler Flughafen', xp: 1400 },
  { name: 'Luftfahrt-Drehkreuz', xp: 3000 },
  { name: 'Weltflughafen', xp: 5500 },
];

const n0 = (v) => Math.round(v).toLocaleString('de-DE');
// type: sum = Zuwachs seit Zielvergabe, streak = aktuelle Serie, level = aktueller Wert
export const GOAL_DEFS = {
  landStreak: { role: 'tower', type: 'streak', t: [10, 15, 22, 30], text: (n) => `${n} Landungen in Folge ohne Durchstarten` },
  slotsOk: { role: 'tower', type: 'sum', t: [5, 8, 12, 16], text: (n) => `${n} Starts innerhalb ihres Slot-Fensters (CTOT −5/+10 min)` },
  lowWaitDeps: { role: 'tower', type: 'sum', t: [12, 18, 25, 35], text: (n) => `${n} Starts mit weniger als 2 min Wartezeit am Rollhalt` },
  safeStreak: { role: 'tower', type: 'streak', t: [40, 70, 100, 150], text: (n) => `${n} Bewegungen in Folge ohne Vorfall` },
  wakeStreak: { role: 'tower', type: 'sum', t: [3, 5, 8, 12], text: (n) => `${n} Anflüge hinter Heavy/Medium mit korrekter Wirbelschleppen-Staffelung` },
  depPunctual: { role: 'ground', type: 'sum', t: [12, 20, 30, 40], text: (n) => `${n} Abflüge pünktlich (höchstens 5 min verspätet)` },
  quickTurns: { role: 'ground', type: 'sum', t: [6, 10, 15, 20], text: (n) => `${n} Turnarounds in der Mindestbodenzeit (+5 min)` },
  fuelT: { role: 'ground', type: 'sum', t: [250, 450, 700, 1000], text: (n) => `${n0(n)} t Kerosin vertanken` },
  tobtKept: { role: 'ground', type: 'sum', t: [12, 20, 30, 40], text: (n) => `${n} Flüge ohne TOBT-Verschiebung abfertigen` },
  noStandWait: { role: 'ground', type: 'sum', t: [12, 20, 30, 40], text: (n) => `${n} Ankünfte ohne Warten direkt zur Parkposition` },
  contracts: { role: 'manager', type: 'sum', t: [1, 2, 2, 3], text: (n) => `${n} neue Airline-Verträge abschließen` },
  fuelMargin: { role: 'manager', type: 'sum', t: [25000, 50000, 90000, 150000], text: (n) => `${fmtMoney(n)} Kerosin-Marge erwirtschaften` },
  pax: { role: 'manager', type: 'sum', t: [10000, 18000, 30000, 45000], text: (n) => `${n0(n)} Passagiere abfertigen` },
  profitDays: { role: 'manager', type: 'streak', t: [1, 2, 3, 5], text: (n) => `${n} Tag${n > 1 ? 'e' : ''} in Folge mit positivem Betriebsergebnis` },
  rep: { role: 'manager', type: 'level', t: [68, 72, 78, 85], text: (n) => `Ansehen auf ${n}/100 steigern` },
  cash: { role: 'manager', type: 'level', t: [7e6, 10e6, 15e6, 25e6], text: (n) => `Kasse auf über ${fmtMoney(n)} bringen` },
  landings: { role: 'observer', type: 'sum', t: [25, 40, 60, 90], text: (n) => `${n} Landungen` },
};
const REWARD = { cash: [25000, 40000, 60000, 90000], xp: [40, 60, 80, 110] };

export const life = (state) => state.life || (state.life = {});
export function bump(state, key, v = 1) {
  const L = life(state);
  L[key] = (L[key] || 0) + v;
}
export function resetStreak(state, key) {
  life(state)[key] = 0;
}

export function goalsState(state) {
  if (!state.goals) state.goals = { xp: 0, rank: 0, byRole: {}, done: 0 };
  return state.goals;
}
export const rankOf = (xp) => RANKS.reduce((r, x, i) => (xp >= x.xp ? i : r), 0);
export const tierOf = (state) => clamp(goalsState(state).rank, 0, 3);

function valueOf(state, key) {
  if (key === 'rep') return state.reputation;
  if (key === 'cash') return state.cash;
  return life(state)[key] || 0;
}
export function goalProgress(state, g) {
  const d = GOAL_DEFS[g.key];
  if (!d) return 0;
  if (d.type === 'level' || d.type === 'streak') return valueOf(state, g.key);
  return valueOf(state, g.key) - g.base;
}
export const goalText = (g) => GOAL_DEFS[g.key].text(g.target);
// Fortschritt 0..1 (Level-Ziele: vom Startwert bis zum Zielwert)
export function goalFraction(state, g) {
  const d = GOAL_DEFS[g.key];
  if (!d) return 0;
  if (d.type === 'level') return Math.max(0, Math.min(1, (valueOf(state, g.key) - g.base) / Math.max(1e-9, g.target - g.base)));
  return Math.max(0, Math.min(1, goalProgress(state, g) / g.target));
}

// Aufbau-Modus: am Grasplatz gibt es weder Passagierabfertigung noch Kerosin oder schwere Flugzeuge
const NOT_AT_GRASS = ['pax', 'fuelMargin', 'fuelT', 'wakeStreak', 'slotsOk'];
function newGoal(state, role, exclude) {
  const skip = isCareer(state) && stageOf(state) < 1 ? NOT_AT_GRASS : [];
  const keys = Object.keys(GOAL_DEFS).filter((k) => (GOAL_DEFS[k].role === role || (role === 'observer' && ['landings', 'pax', 'depPunctual', 'safeStreak'].includes(k))) && !exclude.includes(k) && !skip.includes(k));
  const key = keys[randInt(state, 0, keys.length - 1)];
  const d = GOAL_DEFS[key];
  const tier = tierOf(state);
  let target = d.t[tier];
  const mf = moneyF(state);
  if (mf < 1 && ['fuelMargin', 'pax', 'fuelT'].includes(key)) target = Math.max(1, Math.round((target * mf) / 10) * 10);
  if (d.type === 'level') target = key === 'rep' ? Math.max(target, Math.ceil(state.reputation) + 4) : mf < 1 ? Math.ceil((Math.max(0, state.cash) * 1.4 + 250000 * mf) / 1e4) * 1e4 : Math.max(target, Math.ceil((state.cash * 1.3) / 1e6) * 1e6);
  return { id: nextId(state, 'g'), key, target, base: d.type === 'streak' ? 0 : valueOf(state, key), tier, created: state.time };
}

export function activeGoals(state) {
  const G = goalsState(state);
  const role = state.role;
  const list = G.byRole[role] || (G.byRole[role] = []);
  while (list.length < 3) list.push(newGoal(state, role, list.map((g) => g.key)));
  return list;
}

export function addXp(state, xp) {
  const G = goalsState(state);
  const before = G.rank;
  G.xp += xp;
  G.rank = rankOf(G.xp);
  if (G.rank > before) {
    state.reputation = clamp(state.reputation + 3, 0, 100);
    for (const fn of listeners.rank) fn(state, G.rank);
    notify(state, `🏅 Aufstieg: ${state.name} ist jetzt „${RANKS[G.rank].name}“!`, 'good');
    log(state, 'mgr', `Neuer Flughafen-Rang: ${RANKS[G.rank].name} (${G.xp} XP). Mehr Airlines interessieren sich für den Standort.`);
  }
}

export function updateGoals(state, dt) {
  state.goalTimer = (state.goalTimer || 0) - dt;
  if (state.goalTimer > 0) return;
  state.goalTimer = 5;
  const list = activeGoals(state);
  for (const g of [...list]) {
    if (goalProgress(state, g) < g.target) continue;
    const cash = Math.round(((REWARD.cash[g.tier] ?? REWARD.cash[0]) * moneyF(state)) / 100) * 100;
    const xp = REWARD.xp[g.tier] ?? REWARD.xp[0];
    state.cash += cash;
    state.ledger.rev.other = (state.ledger.rev.other || 0) + cash;
    goalsState(state).done++;
    notify(state, `🎯 Ziel erreicht: ${goalText(g)} (+${fmtMoney(cash)}, +${xp} XP)`, 'good');
    log(state, 'mgr', `Ziel erreicht: ${goalText(g)} – Prämie ${fmtMoney(cash)}, ${xp} XP.`);
    list.splice(list.indexOf(g), 1);
    addXp(state, xp);
  }
  activeGoals(state);
}

// Tagesabschluss: Serie „positives Ergebnis“ und Tages-XP
export function onDayEnd(state, rec) {
  if (rec.rev - rec.cost > 0) bump(state, 'profitDays');
  else resetStreak(state, 'profitDays');
  const xp = 20 + (rec.incidents === 0 ? 20 : 0) + (rec.onTime >= 90 ? 20 : 0) + (rec.rev > rec.cost ? 20 : 0);
  rec.xp = xp;
  addXp(state, xp);
}
