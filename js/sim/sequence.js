// Pistenfolge: gemeinsame Reihenfolge von Landungen und Starts (vom Lotsen änderbar)
import { PH } from './aircraft.js';
import * as AS from './airspace.js';
import { pathLength } from '../util.js';

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

// geschätzte Sekunden bis zur Pistenbenutzung
export function seqEta(state, ac) {
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

// Mindestabstände auf der Piste in Spielsekunden (vorher -> nachher)
const SEP = { AA: 80, DD: 90, AD: 45, DA: 100 };

// Geplante Zeiten entlang einer Reihenfolge
function slotsAlong(state, order, byId) {
  const slots = {};
  let prev = null;
  let t = -Infinity;
  for (const id of order) {
    const ac = byId.get(id);
    if (!ac) continue;
    const arr = isSeqArrival(ac);
    let slot = seqEta(state, ac);
    if (prev !== null) slot = Math.max(slot, t + SEP[(prev ? 'A' : 'D') + (arr ? 'A' : 'D')]);
    slots[id] = slot;
    prev = arr;
    t = slot;
  }
  return slots;
}

// Automatische Planung: Landungen sind zeitlich gesetzt, Starts füllen die Lücken
function autoOrder(state, ids, byId) {
  const raw = (id) => seqEta(state, byId.get(id));
  const arrs = ids.filter((id) => isSeqArrival(byId.get(id))).sort((a, b) => raw(a) - raw(b));
  const deps = ids.filter((id) => !isSeqArrival(byId.get(id))).sort((a, b) => raw(a) - raw(b));
  const ev = [];
  let t = -Infinity;
  for (const id of arrs) {
    t = Math.max(raw(id), t + SEP.AA);
    ev.push({ id, t, arr: true });
  }
  let last = -Infinity;
  for (const id of deps) {
    let c = Math.max(raw(id), last + SEP.DD);
    for (const e of ev) if (e.arr && c < e.t + SEP.AD && c + SEP.DA > e.t) c = e.t + SEP.AD;
    ev.push({ id, t: c, arr: false });
    last = c;
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

export function seqMove(state, id, delta) {
  const i = state.seq.indexOf(id);
  if (i < 0) return false;
  const j = Math.max(0, Math.min(state.seq.length - 1, i + delta));
  if (i === j) return false;
  state.seq.splice(i, 1);
  state.seq.splice(j, 0, id);
  state.seqManual = true;
  return true;
}

export function seqMoveTo(state, id, beforeId) {
  const i = state.seq.indexOf(id);
  if (i < 0 || id === beforeId) return false;
  state.seq.splice(i, 1);
  let j = beforeId ? state.seq.indexOf(beforeId) : state.seq.length;
  if (j < 0) j = state.seq.length;
  state.seq.splice(j, 0, id);
  state.seqManual = true;
  return true;
}

export function seqSortByEta(state) {
  state.seqManual = false;
  updateSequence(state);
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
