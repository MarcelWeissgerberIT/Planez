// Bauprojekte: Aufträge mit Bauzeit, Fortschritt und sichtbarer Baustelle
import { UPGRADES, STAND_COSTS } from '../config.js';
import { log, notify } from './messages.js';
import { nextId } from './schedule.js';
import { canWorkRunway, rwyCond } from './runway.js';
import { completeStage } from './career.js';
import { T } from '../i18n.js';

// Arbeiten an der Piste: nur nachts in Verkehrspausen, Piste dann gesperrt
export const RWY_WORKS = {
  clean: { name: T('Gummiabrieb entfernen'), cost: 180000, hours: 2.5, desc: T('Hochdruck-Wasserstrahl entfernt Reifenabrieb: Zustand +35 % (max. 90 %).') },
  resurface: { name: T('Pistensanierung'), cost: 2400000, hours: 14, desc: T('Neue Deckschicht: Zustand 100 %.') },
};

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
  rwy2: [40],
  solar: [14],
  rail: [34],
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
    strip: opts.strip || null,
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
  log(state, 'mgr', T`Baubeginn: ${p.name} (${p.hours} h Bauzeit).`);
  notify(state, T`🏗️ Baustelle eröffnet: ${p.name}`, 'info');
  return p;
}

export function remainingHours(p) {
  return Math.max(0, (1 - p.prog) * p.hours);
}

export function updateConstruction(state, dt) {
  const list = projects(state);
  if (!list.length) {
    state.rwyWorking = null;
    return;
  }
  const storm = state.weather.kind === 'storm';
  let rwyWork = null;
  for (const p of list) {
    if (p.status === 'waiting') {
      const st = state.stands.find((s) => s.id === p.target);
      if (st && !st.occ && !st.resv) {
        st.closed = true;
        p.status = 'active';
        log(state, 'mgr', T`${p.name}: Position frei – Bauarbeiten beginnen.`);
      }
      continue;
    }
    if (p.kind === 'rwy') {
      if (storm || rwyWork || !canWorkRunway(state, p.strip || 'N')) continue;
      rwyWork = p.id;
    } else if (storm) continue; // Gewitter: Baustelle ruht
    p.prog = Math.min(1, p.prog + dt / (p.hours * 3600));
    if (p.prog >= 1) complete(state, p);
  }
  state.projects = list.filter((p) => !p.done);
  state.rwyWorking = rwyWork && state.projects.some((p) => p.id === rwyWork) ? rwyWork : null;
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
  } else if (p.kind === 'stage') {
    completeStage(state, p.target);
  } else if (p.kind === 'rwy') {
    const k = p.strip === 'S' ? 'rwyCondS' : 'rwyCond';
    const c = rwyCond(state, p.strip || 'N');
    state[k] = p.target === 'resurface' ? 100 : Math.max(c, Math.min(90, c + 35));
  } else if (p.kind === 'upgrade') {
    state.upgrades[p.target] = Math.max(state.upgrades[p.target] || 0, p.level);
    if (p.target === 'hotel') state.reputation = Math.min(100, state.reputation + 3);
    if (p.target === 'solar') state.reputation = Math.min(100, state.reputation + 4);
    if (p.target === 'rail') {
      state.reputation = Math.min(100, state.reputation + 5);
      notify(state, T('🚆 Der Flughafen-Bahnhof ist eröffnet – die ersten Züge rollen ein'), 'good');
    }
    if (p.target === 'rwy2') {
      state.rwyMode = 'seg';
      state.rwyCondS = 100;
      notify(state, T('🛬 Parallelbahn in Betrieb: Landungen auf der Südbahn, Starts auf der Nordbahn'), 'good');
      log(state, 'mgr', T('Neue Parallelbahn eröffnet – getrennter Betrieb: Landungen Süd, Starts Nord. Ankünfte kreuzen die Startbahn.'));
    }
  }
  state.life = state.life || {};
  state.life.built = (state.life.built || 0) + 1;
  log(state, 'mgr', T`Fertiggestellt: ${p.name}.`);
  notify(state, T`✅ Fertiggestellt: ${p.name}`, 'good');
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
  log(state, 'mgr', T`Baustelle abgebrochen: ${p.name} (Erstattung ${Math.round(refund / 1000)} Tsd €).`);
  notify(state, T`Baustelle abgebrochen: ${p.name}`, 'warn');
  return refund;
}

export const UPGRADE_NAMES = (key, level) => `${UPGRADES[key].name}${UPGRADES[key].max > 1 ? T` Stufe ${level}` : ''}`;
export { STAND_COSTS };
