// Wetterumflüge: Kreuzt der Kurs eines Anflugs eine Gewitterzelle, bittet die Besatzung um einen Ausweichkurs
// („request deviation 20 degrees left due weather“). Der Lotse genehmigt – das Flugzeug fliegt über einen
// Umweg-Wegpunkt „WX“ und danach weiter nach Plan – oder lehnt wegen Verkehr ab: dann geht es mitten durch,
// mit Turbulenz und durchgeschüttelten Fluggästen. Ohne Antwort weicht der Pilot nach einer Weile selbst aus.
// Abflüge sind dann schon bei Langen Radar und umfliegen Zellen selbstständig.
import { TIME_SCALE } from '../config.js';
import * as AS from './airspace.js';
import { PH, tel } from './aircraft.js';
import { radio, log, notify, fx } from './messages.js';
import { penalize } from './economy.js';
import { scoreWx } from './score.js';
import { degDiff } from '../util.js';
import { diff } from './difficulty.js';

export const WX_WINDOW = 14; // Echtzeit-Sekunden, bis der Pilot ohne Antwort selbst ausweicht (oder 5 NM vor der Zelle)
const BUF = 1.5; // Sicherheitsabstand zur Zelle (NM)
const LOOKAHEAD = 20; // Zellen bis so weit voraus melden (NM)
const humanTower = (s) => s.role === 'tower' && !s.auto.atc;

// nächster Punkt der Strecke a→b zum Zellmittelpunkt c
function segHit(a, b, c) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1e-6;
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / L2));
  const p = { x: a.x + t * dx, y: a.y + t * dy };
  return { p, t, d: Math.hypot(c.x - p.x, c.y - p.y), len: Math.sqrt(L2) };
}
const inCell = (pt, c, m = 0) => Math.hypot(pt.x - c.x, pt.y - c.y) < c.r + m;

export function cellsOf(state) {
  const cells = (state.weather && state.weather.cells) || [];
  for (const c of cells) if (c.id == null) c.id = state.wxCellSeq = (state.wxCellSeq || 0) + 1;
  return cells;
}

// erster Abschnitt der Route (höchstens die nächsten zwei), der eine Zelle schneidet
function findConflict(state, ac, only = null) {
  const cells = cellsOf(state);
  if (!cells.length || !ac.route || !ac.route.length) return null;
  let from = ac.pos, along = 0;
  for (let i = 0; i < Math.min(ac.route.length, 2); i++) {
    const w = ac.route[i];
    if (w.thr || w.wx) return null; // Endanflug oder schon auf dem Umweg
    for (const c of cells) {
      if (only != null && c.id !== only) continue;
      const h = segHit(from, w, c);
      if (h.d >= c.r + BUF) continue;
      if (along + h.t * h.len > LOOKAHEAD) continue;
      if (inCell(w, c, 0.5) || inCell(ac.pos, c)) continue; // Ziel oder Flugzeug selbst in der Zelle: kein Umweg möglich
      return { c, i, from, w, h };
    }
    along += Math.hypot(w.x - from.x, w.y - from.y);
    from = w;
  }
  return null;
}

// Umweg-Punkt seitlich neben der Zelle (auf der Seite, an der die Strecke ohnehin näher vorbeiführt)
function detour(k) {
  const { c, h, from, w } = k;
  let vx = h.p.x - c.x, vy = h.p.y - c.y;
  let m = Math.hypot(vx, vy);
  if (m < 0.05) {
    const dx = w.x - from.x, dy = w.y - from.y, L = Math.hypot(dx, dy) || 1;
    vx = -dy / L;
    vy = dx / L;
    m = 1;
  }
  const R = c.r + 3.5;
  return { x: c.x + (vx / m) * R, y: c.y + (vy / m) * R };
}

function describe(ac, k, D) {
  const base = AS.crsTo(ac.pos, k.i === 0 ? k.w : ac.route[0]);
  const dd = degDiff(base, AS.crsTo(k.from, D));
  const side = dd < 0 ? 'left' : 'right';
  const deg = Math.max(10, Math.min(60, Math.round(Math.abs(dd) / 5) * 5));
  return { side, deg };
}

const nextName = (ac, i) => {
  const w = ac.route[i];
  return w && w.name && w.name !== 'WX' ? w.name : null;
};

function insertDetour(state, ac, k) {
  // Sicherung: höchstens 6 Umweg-Punkte je Flugzeug (keine Endlosschleifen um wandernde Zellen)
  ac.wxN = (ac.wxN || 0) + 1;
  if (ac.wxN > 6) return null;
  const D = detour(k);
  ac.route.splice(k.i, 0, { x: D.x, y: D.y, name: 'WX', wx: true, cell: k.c.id });
  return D;
}

function request(state, ac, k) {
  const D = detour(k);
  const { side, deg } = describe(ac, k, D);
  const W = ac.wxDone || (ac.wxDone = {});
  // Zelle schon ganz nah (zieht heran): keine Zeit zum Fragen – der Kommandant weicht sofort aus und meldet es
  if (Math.hypot(ac.pos.x - k.c.x, ac.pos.y - k.c.y) - k.c.r < 3) {
    insertDetour(state, ac, k);
    W[k.c.id] = 'ok';
    radio(state, ac.cs, `${tel(ac)}, deviating ${deg} degrees ${side} due weather.`);
    return;
  }
  ac.wxReq = { cell: k.c.id, side, deg, age: 0, t: state.time };
  W[k.c.id] = 'asked';
  radio(state, ac.cs, `${tel(ac)}, request deviation ${deg} degrees ${side} due weather.`);
}

// Lotse genehmigt (auch Auto-Lotse und Pilot auf eigene Verantwortung: own)
export function approveWx(state, ac, own = false) {
  const q = ac && ac.wxReq;
  if (!q) return { ok: false, msg: 'Keine Ausweich-Anfrage offen' };
  ac.wxReq = null;
  const W = ac.wxDone || (ac.wxDone = {});
  const k = findConflict(state, ac, q.cell);
  if (!k) {
    W[q.cell] = 'ok';
    if (!own) {
      radio(state, 'TWR', `${tel(ac)}, deviation approved.`, 'atc');
      radio(state, ac.cs, `No longer required, clear of weather, ${tel(ac)}.`);
    }
    return { ok: true };
  }
  insertDetour(state, ac, k);
  W[q.cell] = 'ok';
  const nx = nextName(ac, k.i + 1);
  if (own) {
    radio(state, ac.cs, `${tel(ac)}, no reply, deviating ${q.deg} degrees ${q.side} due weather.`);
    log(state, 'sys', `⛈️ ${ac.cs} weicht ohne Freigabe der Gewitterzelle aus – Anfrage blieb unbeantwortet.`);
    if (diff(state).events <= 1) scoreWx(state, ac, 'late'); // auf „Entspannt“ ohne Punktabzug
  } else {
    radio(state, 'TWR', `${tel(ac)}, deviation ${q.deg} degrees ${q.side} approved${nx ? `, when clear of weather proceed direct ${nx}` : ', report clear of weather'}.`, 'atc');
    radio(state, ac.cs, `Deviating ${q.side}${nx ? `, then direct ${nx}` : ''}, ${tel(ac)}.`);
    if (humanTower(state)) {
      scoreWx(state, ac, 'ok');
      const L = state.life || (state.life = {});
      L.wxOk = (L.wxOk || 0) + 1;
    }
  }
  return { ok: true };
}

// Lotse lehnt ab (Verkehr): das Flugzeug bleibt auf Kurs und fliegt durch die Zelle
export function denyWx(state, ac) {
  const q = ac && ac.wxReq;
  if (!q) return { ok: false, msg: 'Keine Ausweich-Anfrage offen' };
  ac.wxReq = null;
  (ac.wxDone || (ac.wxDone = {}))[q.cell] = 'no';
  radio(state, 'TWR', `${tel(ac)}, unable due traffic, continue present routing, expect moderate turbulence.`, 'atc');
  radio(state, ac.cs, `Roger, continuing, seat belt signs on, ${tel(ac)}.`);
  return { ok: true };
}

// Wer darf fragen: Anflüge vor dem Endanflug (nicht in der Warteschleife, nicht bei Funkausfall)
const ASKS = (ac) => ac.arr && ac.mode === 'air' && (ac.phase === PH.INBOUND || ac.phase === PH.APPROACH) && !ac.holdFix && !ac.nordo;

export function updateWxDev(state, dt) {
  // Zeitfenster der offenen Anfragen (Echtzeit wie beim Readback)
  const real = dt / (TIME_SCALE * Math.max(1, state.speed || 1));
  for (const ac of state.acs) {
    const q = ac.wxReq;
    if (!q) continue;
    q.age += real;
    if (!ASKS(ac) || !cellsOf(state).some((c) => c.id === q.cell)) {
      ac.wxReq = null;
      continue;
    }
    const c = cellsOf(state).find((x) => x.id === q.cell);
    q.near = Math.hypot(ac.pos.x - c.x, ac.pos.y - c.y) - c.r;
    if (!humanTower(state)) {
      if (state.time - q.t > 8) approveWx(state, ac);
    } else if (q.age > WX_WINDOW * Math.min(1.5, diff(state).events) || q.near < 5) approveWx(state, ac, true);
  }
  state.wxTimer = (state.wxTimer || 0) - dt;
  if (state.wxTimer > 0) return;
  state.wxTimer = 4;
  const cells = cellsOf(state);
  if (!cells.length) return;
  for (const ac of state.acs) {
    if (ac.mode !== 'air' || ac.phase === PH.GONE) continue;
    turbulence(state, ac, cells);
    recheckDetour(state, ac, cells);
    skipCorners(ac, cells);
    if (ac.wxReq) continue;
    if (ASKS(ac)) {
      const k = findConflict(state, ac);
      if (!k) continue;
      const st = (ac.wxDone || {})[k.c.id];
      if (st === 'no') continue; // abgelehnt: bleibt auf Kurs
      if (st === 'ok') insertDetour(state, ac, k); // schon genehmigt (Route wurde neu gesetzt): weiter ausweichen
      else if (!st) request(state, ac, k);
    } else if (ac.phase === PH.DEPART && ac.alt > 1500) {
      // Abflug mit Langen Radar: umfliegt selbstständig
      const k = findConflict(state, ac);
      if (k) {
        insertDetour(state, ac, k);
        (ac.wxDone || (ac.wxDone = {}))[k.c.id] = 'ok';
      }
    }
  }
}

// unbenannte Eckpunkte (Abflugkurve, Einflugkorridor) unter einer Zelle: direkt zum nächsten Punkt
function skipCorners(ac, cells) {
  if (!ac.route || ac.route.length < 2 || (ac.phase !== PH.DEPART && ac.phase !== PH.INBOUND)) return;
  for (let i = 0; i < Math.min(2, ac.route.length - 1); i++) {
    const w = ac.route[i];
    if (w.name || w.exit || w.iaf || w.faf || w.thr || w.wx) continue;
    if (cells.some((c) => inCell(w, c, 1.5))) {
      ac.route.splice(i, 1);
      i--;
    }
  }
}

// Zellen ziehen mit dem Wind: liegt der Umweg nicht mehr frei, neu planen (Zelle weg: Umweg entfällt)
function recheckDetour(state, ac, cells) {
  if (!ac.route) return;
  const wi = ac.route.findIndex((w) => w.wx);
  if (wi < 0 || wi > 1) return;
  const w = ac.route[wi];
  const c = cells.find((x) => x.id === w.cell);
  if (!c) {
    ac.route.splice(wi, 1);
    return;
  }
  const prev = wi === 0 ? ac.pos : ac.route[wi - 1];
  const nxt = ac.route[wi + 1];
  const bad = inCell(w, c, 1.5) || segHit(prev, w, c).d < c.r + 0.3 || (nxt && !nxt.thr && segHit(w, nxt, c).d < c.r + 0.3);
  if (!bad) return;
  ac.route.splice(wi, 1);
  const k = findConflict(state, ac, c.id);
  if (k) insertDetour(state, ac, k);
}

// mitten durch die Zelle: Turbulenz (abgelehnter Umweg kostet Ansehen und Punkte)
function turbulence(state, ac, cells) {
  if (ac.alt < 800) return;
  for (const c of cells) {
    const d = Math.hypot(ac.pos.x - c.x, ac.pos.y - c.y);
    if (d > c.r * 0.85) continue;
    const T = ac.turb || (ac.turb = {});
    if (T[c.id]) continue;
    T[c.id] = true;
    const severe = d < c.r * 0.45;
    radio(state, ac.cs, `${tel(ac)}, encountering ${severe ? 'severe' : 'moderate'} turbulence.`);
    const denied = (ac.wxDone || {})[c.id] === 'no';
    log(state, 'sys', `⛈️ ${ac.cs} fliegt durch eine Gewitterzelle – ${severe ? 'starke' : 'mäßige'} Turbulenz, Fluggäste durchgeschüttelt${denied ? ' (Umweg war abgelehnt)' : ''}.`);
    if (denied) {
      penalize(state, 'turbulence', ac);
      scoreWx(state, ac, 'turb');
      notify(state, `⛈️ ${ac.cs}: ${severe ? 'starke' : 'mäßige'} Turbulenz nach abgelehntem Umweg – Ansehen sinkt`, 'warn');
    }
    if (ac.mode === 'map') fx(state, ac.x, ac.y - 0.8, '⛈️ Turbulenz', 'bad');
  }
}
