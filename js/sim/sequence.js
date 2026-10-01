// Pistenfolge: gemeinsame Reihenfolge von Landungen und Starts (vom Lotsen änderbar)
import { PH } from './aircraft.js';
import * as AS from './airspace.js';
import { pathLength } from '../util.js';
import { wakeArrSec, wakeDepSec } from './wake.js';
import { depSepSec } from './sid.js';
import { T } from '../i18n.js';

const ARR_SEQ = new Set([PH.APPROACH, PH.FINAL, PH.ROLLOUT]);
const DEP_SEQ = new Set([PH.STARTUP, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF]);

export function isSeqArrival(ac) {
  return ARR_SEQ.has(ac.phase) && !(ac.phase === PH.ROLLOUT && ac.vacated);
}
export function isSeqDeparture(ac) {
  return DEP_SEQ.has(ac.phase) && !(ac.phase === PH.TAKEOFF && ac.z > 0.5);
}
export function inSeqPhase(state, ac) {
  return isSeqArrival(ac) || isSeqDeparture(ac);
}

// geschätzte Sekunden bis zur Pistenbenutzung (Starts frühestens im Slot-Fenster)
export function seqEta(state, ac) {
  const base = rawEta(state, ac);
  if (isSeqArrival(ac)) return base;
  const rot = state.rots && state.rots[ac.rot];
  return rot && rot.ctot && !rot.atd ? Math.max(base, rot.ctot - 300 - state.time) : base;
}
function rawEta(state, ac) {
  if (isSeqArrival(ac)) {
    if (ac.mode === 'map') return ac.phase === PH.ROLLOUT ? -60 : 20;
    const d = AS.routeDistance(ac.pos, ac.route.length ? ac.route : [AS.THR[ac.rwy]]);
    return (d / Math.max(120, ac.spd)) * 3600 + 60;
  }
  switch (ac.phase) {
    case PH.TAKEOFF:
      return -30;
    case PH.LINED:
      return 0;
    case PH.LINEUP:
      return 15;
    case PH.HOLDING:
      return 40;
    case PH.TAXI_OUT: {
      const rem = ac.path ? pathLength(ac.path, ac.pi) : 20;
      return rem / 0.12 + 60;
    }
    case PH.STARTUP:
      return 300;
  }
  return 999;
}

// Mindestabstände auf der Piste in Spielsekunden (vorher -> nachher), Wirbelschleppen berücksichtigt
const SEP = { AD: 45, DA: 100 };
export function sepSec(lead, foll, leadArr, follArr) {
  if (leadArr && follArr) return wakeArrSec(lead.wake, foll.wake);
  if (!leadArr && !follArr) return depSepSec(lead.wake, lead.sid, foll.wake, foll.sid) + 15;
  return leadArr ? SEP.AD : SEP.DA;
}

// Bahn in der Pistenfolge: Landungen auf ihrer Bahn, Starts immer Nord
export const seqStrip = (ac) => (isSeqArrival(ac) ? ac.strip || 'N' : 'N');

// Geplante Zeiten entlang einer Reihenfolge (je Bahn getrennt)
function slotsAlong(state, order, byId) {
  const slots = {};
  const prev = {};
  const t = {};
  for (const id of order) {
    const ac = byId.get(id);
    if (!ac) continue;
    const arr = isSeqArrival(ac);
    const st = seqStrip(ac);
    let slot = seqEta(state, ac);
    if (prev[st]) slot = Math.max(slot, t[st] + sepSec(prev[st], ac, isSeqArrival(prev[st]), arr));
    slots[id] = slot;
    prev[st] = ac;
    t[st] = slot;
  }
  return slots;
}

// Automatische Planung: Landungen sind zeitlich gesetzt, Starts füllen die Lücken
function autoOrder(state, ids, byId) {
  const raw = (id) => seqEta(state, byId.get(id));
  const arrs = ids.filter((id) => isSeqArrival(byId.get(id))).sort((a, b) => raw(a) - raw(b));
  const deps = ids.filter((id) => !isSeqArrival(byId.get(id))).sort((a, b) => raw(a) - raw(b));
  const ev = [];
  const tS = {};
  const pa = {};
  for (const id of arrs) {
    const ac = byId.get(id);
    const st = seqStrip(ac);
    const t = Math.max(raw(id), pa[st] ? tS[st] + sepSec(pa[st], ac, true, true) : -Infinity);
    tS[st] = t;
    ev.push({ id, t, arr: true, st });
    pa[st] = ac;
  }
  let last = -Infinity;
  let pd = null;
  for (const id of deps) {
    const ac = byId.get(id);
    let c = Math.max(raw(id), pd ? last + sepSec(pd, ac, false, false) : -Infinity);
    for (const e of ev) if (e.arr && e.st === 'N' && c < e.t + SEP.AD && c + SEP.DA > e.t) c = e.t + SEP.AD;
    ev.push({ id, t: c, arr: false });
    last = c;
    pd = ac;
  }
  ev.sort((a, b) => a.t - b.t);
  return ev.map((e) => e.id);
}

export function updateSequence(state) {
  if (!state.seq) state.seq = [];
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  // Fertige entfernen
  state.seq = state.seq.filter((id) => {
    const ac = byId.get(id);
    return ac && inSeqPhase(state, ac);
  });
  // Neue einsortieren (nach geschätzter Zeit, bestehende Reihenfolge bleibt)
  const inSeq = new Set(state.seq);
  const fresh = state.acs.filter((a) => !inSeq.has(a.id) && inSeqPhase(state, a)).sort((a, b) => seqEta(state, a) - seqEta(state, b));
  for (const ac of fresh) {
    const eta = seqEta(state, ac);
    let idx = state.seq.findIndex((id) => seqEta(state, byId.get(id)) > eta);
    if (idx < 0) idx = state.seq.length;
    state.seq.splice(idx, 0, ac.id);
  }
  // ohne manuelle Eingriffe des Lotsen: laufend automatisch planen
  if (!(state.role === 'tower' && state.seqManual)) state.seq = autoOrder(state, state.seq, byId);
  state.seqSlots = slotsAlong(state, state.seq, byId);
}

export function seqIndex(state, id) {
  if (!state.seq) return 0;
  return state.seq.indexOf(id) + 1;
}

// Nicht mehr verschiebbar: Landung im Endanflug/mit Landefreigabe, Start auf der Piste
export function seqFixed(ac) {
  if (!ac) return false;
  if (isSeqArrival(ac)) return !!(ac.clr.land || ac.phase === PH.FINAL || ac.phase === PH.ROLLOUT || (ac.mode === 'air' && ac.route && ac.route[0] && ac.route[0].thr));
  return [PH.LINEUP, PH.LINED, PH.TAKEOFF].includes(ac.phase);
}
// Neue Reihenfolge zulässig? Feste Flugzeuge müssen je Art (und Bahn) vorn und in ihrer Reihenfolge bleiben
function orderOk(state, next) {
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  const groups = {};
  for (const id of next) {
    const a = byId.get(id);
    if (!a) continue;
    const k = isSeqArrival(a) ? 'A' + seqStrip(a) : 'D';
    (groups[k] = groups[k] || []).push(a);
  }
  const oldPos = new Map(state.seq.map((id, i) => [id, i]));
  for (const list of Object.values(groups)) {
    let open = false;
    let lastFixed = -1;
    for (const a of list) {
      if (!seqFixed(a)) open = true;
      else {
        if (open) return a;
        if (oldPos.get(a.id) < lastFixed) return a;
        lastFixed = oldPos.get(a.id);
      }
    }
  }
  return null;
}
function tryOrder(state, next) {
  const bad = orderOk(state, next);
  if (bad) {
    state.seqErr = T`${bad.cs} ist ${isSeqArrival(bad) ? T('schon im Endanflug') : T('schon auf der Piste')} – davor geht nichts mehr`;
    return false;
  }
  state.seq = next;
  state.seqErr = null;
  return true;
}

export function seqMove(state, id, delta) {
  const i = state.seq.indexOf(id);
  if (i < 0) return false;
  const j = Math.max(0, Math.min(state.seq.length - 1, i + delta));
  if (i === j) return false;
  const next = state.seq.slice();
  next.splice(i, 1);
  next.splice(j, 0, id);
  if (!tryOrder(state, next)) return false;
  state.seqManual = true;
  pin(state, id);
  return true;
}

export function seqMoveTo(state, id, beforeId) {
  const i = state.seq.indexOf(id);
  if (i < 0 || id === beforeId) return false;
  const next = state.seq.slice();
  next.splice(i, 1);
  let j = beforeId ? next.indexOf(beforeId) : next.length;
  if (j < 0) j = next.length;
  next.splice(j, 0, id);
  if (!tryOrder(state, next)) return false;
  state.seqManual = true;
  pin(state, id);
  return true;
}

// vom Lotsen bewusst verschoben: zählt für die Staffelung auch gegenüber Starts
function pin(state, id) {
  const ac = state.acs.find((a) => a.id === id);
  if (ac) ac.seqPin = true;
}

export function seqSortByEta(state) {
  state.seqManual = false;
  for (const a of state.acs) a.seqPin = false;
  state.arrQManual = false;
  updateSequence(state);
  updateArrQueue(state);
}

// ---------- Warteliste der Anflüge ohne Freigabe (Reihenfolge der Anflugfreigaben) ----------
const QUEUE = new Set([PH.INBOUND, PH.HOLD]);
const queueDist = (state, a) => AS.routeDistance(a.pos, AS.approachRoute(a.pos, state.rwy));
export function updateArrQueue(state) {
  if (!state.arrQ) state.arrQ = [];
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  state.arrQ = state.arrQ.filter((id) => {
    const a = byId.get(id);
    return a && a.arr && a.mode === 'air' && QUEUE.has(a.phase);
  });
  const inQ = new Set(state.arrQ);
  const fresh = state.acs.filter((a) => a.arr && a.mode === 'air' && QUEUE.has(a.phase) && !inQ.has(a.id));
  if (!fresh.length && state.arrQManual) return state.arrQ;
  const dist = new Map();
  const d = (a) => {
    if (!dist.has(a.id)) dist.set(a.id, queueDist(state, a) - (a.emergency ? 500 : a.protocol ? 300 : a.minFuel ? 200 : 0));
    return dist.get(a.id);
  };
  if (!state.arrQManual) {
    // automatisch: nach Entfernung (Notfälle und Treibstoffmangel vorn)
    state.arrQ = [...state.arrQ, ...fresh.map((a) => a.id)].sort((x, y) => d(byId.get(x)) - d(byId.get(y)));
    return state.arrQ;
  }
  for (const a of fresh.sort((x, y) => d(x) - d(y))) {
    let idx = state.arrQ.findIndex((id) => d(byId.get(id)) > d(a));
    if (idx < 0) idx = state.arrQ.length;
    state.arrQ.splice(idx, 0, a.id);
  }
  return state.arrQ;
}
export function arrQMoveTo(state, id, beforeId) {
  updateArrQueue(state);
  const i = state.arrQ.indexOf(id);
  if (i < 0 || id === beforeId) return false;
  state.arrQ.splice(i, 1);
  let j = beforeId ? state.arrQ.indexOf(beforeId) : state.arrQ.length;
  if (j < 0) j = state.arrQ.length;
  state.arrQ.splice(j, 0, id);
  state.arrQManual = true;
  return true;
}

// geplante Pistenzeit (Sekunden ab jetzt) laut aktueller Folge
export function seqSlot(state, id) {
  return state.seqSlots && state.seqSlots[id] !== undefined ? state.seqSlots[id] : null;
}

// „number 2“: Position unter den Landungen bzw. Starts
export function seqNumber(state, ac) {
  if (!state.seq) return 0;
  const byId = new Map(state.acs.map((a) => [a.id, a]));
  const arr = isSeqArrival(ac);
  let n = 0;
  for (const id of state.seq) {
    const o = byId.get(id);
    if (!o || isSeqArrival(o) !== arr) continue;
    n++;
    if (id === ac.id) return n;
  }
  return 0;
}
