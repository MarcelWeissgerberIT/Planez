// Bauprojekte: Aufträge mit Bauzeit, Fortschritt und sichtbarer Baustelle
import { UPGRADES, STAND_COSTS } from '../config.js';
import { log, notify } from './messages.js';
import { nextId } from './schedule.js';

// Bauzeiten in Spielstunden
export const STAND_HOURS = { remote: 6, cargo: 12, contactM: 14, contactL: 18, upgradeL: 8 };
export const UPGRADE_HOURS = {
  retail: [10, 14, 18],
  security: [6, 8, 10],
  lounge: [12],
  parking: [16, 20],
  hotel: [30],
  ils3: [20],
  rapidExit: [16],
  apronLights: [6],
};

export function standBuildHours(st) {
  if (st.kind === 'remote') return STAND_HOURS.remote;
  if (st.kind === 'cargo') return STAND_HOURS.cargo;
  return st.size === 'L' ? STAND_HOURS.contactL : STAND_HOURS.contactM;
}
export function upgradeHours(key, level) {
  const h = UPGRADE_HOURS[key] || [8];
  return h[Math.min(h.length - 1, level - 1)];
}

export const projects = (state) => state.projects || (state.projects = []);
export function projectFor(state, kind, target) {
  return projects(state).find((p) => p.kind === kind && p.target === target) || null;
}
export function standProject(state, standId) {
  return projects(state).find((p) => (p.kind === 'stand' || p.kind === 'standL') && p.target === standId) || null;
}

// Neues Projekt (Kosten werden vom Aufrufer als Investition gebucht)
export function startProject(state, kind, target, opts) {
  const p = {
    id: nextId(state, 'p'),
    kind,
    target,
    level: opts.level || 1,
    name: opts.name,
    cost: opts.cost,
    hours: opts.hours,
    prog: 0,
    start: state.time,
    status: opts.waiting ? 'waiting' : 'active',
  };
  projects(state).push(p);
  if (kind === 'standL') {
    const st = state.stands.find((s) => s.id === target);
    if (st) {
      st.closing = true;
      if (!st.occ && !st.resv) {
        st.closed = true;
        p.status = 'active';
      } else p.status = 'waiting';
    }
  }
  log(state, 'mgr', `Baubeginn: ${p.name} (${p.hours} h Bauzeit).`);
  notify(state, `🏗️ Baustelle eröffnet: ${p.name}`, 'info');
  return p;
}

export function remainingHours(p) {
  return Math.max(0, (1 - p.prog) * p.hours);
}

export function updateConstruction(state, dt) {
  const list = projects(state);
  if (!list.length) return;
  const storm = state.weather.kind === 'storm';
  for (const p of list) {
    if (p.status === 'waiting') {
      const st = state.stands.find((s) => s.id === p.target);
      if (st && !st.occ && !st.resv) {
        st.closed = true;
        p.status = 'active';
        log(state, 'mgr', `${p.name}: Position frei – Bauarbeiten beginnen.`);
      }
      continue;
    }
    if (storm) continue; // Gewitter: Baustelle ruht
    p.prog = Math.min(1, p.prog + dt / (p.hours * 3600));
    if (p.prog >= 1) complete(state, p);
  }
  state.projects = list.filter((p) => !p.done);
}

function complete(state, p) {
  p.done = true;
  if (p.kind === 'stand') {
    const st = state.stands.find((s) => s.id === p.target);
    if (st) st.built = true;
  } else if (p.kind === 'standL') {
    const st = state.stands.find((s) => s.id === p.target);
    if (st) {
      st.size = 'L';
      st.closed = false;
      st.closing = false;
    }
  } else if (p.kind === 'upgrade') {
    state.upgrades[p.target] = Math.max(state.upgrades[p.target] || 0, p.level);
    if (p.target === 'hotel') state.reputation = Math.min(100, state.reputation + 3);
  }
  log(state, 'mgr', `Fertiggestellt: ${p.name}.`);
  notify(state, `✅ Fertiggestellt: ${p.name}`, 'good');
}

// Abbruch: 50 % der noch nicht verbauten Kosten zurück
export function cancelProject(state, id) {
  const p = projects(state).find((x) => x.id === id);
  if (!p) return 0;
  const refund = Math.round(p.cost * 0.5 * (1 - p.prog));
  state.cash += refund;
  state.ledger.capex -= refund;
  if (p.kind === 'standL') {
    const st = state.stands.find((s) => s.id === p.target);
    if (st) st.closed = st.closing = false;
  }
  state.projects = projects(state).filter((x) => x !== p);
  log(state, 'mgr', `Baustelle abgebrochen: ${p.name} (Erstattung ${Math.round(refund / 1000)} Tsd €).`);
  notify(state, `Baustelle abgebrochen: ${p.name}`, 'warn');
  return refund;
}

export const UPGRADE_NAMES = (key, level) => `${UPGRADES[key].name}${UPGRADES[key].max > 1 ? ` Stufe ${level}` : ''}`;
export { STAND_COSTS };
