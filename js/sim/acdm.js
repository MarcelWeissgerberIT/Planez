// A-CDM (Airport Collaborative Decision Making): Zielzeiten für Abflüge
// TOBT = Target Off-Block Time (Abfertigung meldet „fertig“), TSAT = Target Start-up Approval Time (Tower),
// CTOT = Calculated Take-Off Time (Slot der Verkehrsflusssteuerung, Fenster −5/+10 min), EXOT = geschätzte Rollzeit
import * as LY from '../layout.js';
import { rand, randInt, pick, clamp, fmtClock } from '../util.js';
import { log, notify, radio } from './messages.js';
import { PH, tel } from './aircraft.js';
import { T } from '../i18n.js';

export const SLOT_EARLY = 300;
export const SLOT_LATE = 600;
const REASONS = [T('ATC-Kapazität im Zielgebiet'), T('Wetter am Zielflughafen'), T('Luftraumbeschränkung (Militär)'), T('Streik bei der Flugsicherung'), T('Verkehrsspitze im oberen Luftraum'), T('Personalmangel Kontrollzentrale')];

const rotOf = (state, ac) => state.rots[ac.rot];
const contractOf = (state, rot) => (rot && rot.contract ? state.contracts.find((c) => c.id === rot.contract) : null);
const ceilMin = (t, m = 60) => Math.ceil(t / m) * m;

// geschätzte Rollzeit von der Position bis zum Abheben (inkl. Pushback und Triebwerksstart)
export function exot(state, ac) {
  const st = state.stands.find((s) => s.id === ac.stand);
  const x = st ? st.x : 40;
  const thr = LY.RWY.thr[state.rwy];
  const tiles = Math.abs(x - thr) + (LY.HOLD_Y - LY.LANE) + 3;
  return Math.round(55 + 100 + tiles / 0.12 + 40);
}

// Abfertigung: frühester Zeitpunkt „fertig“ entlang des kritischen Pfads
export function estimateReady(state, ac) {
  if (!ac.ta) return state.time;
  const eff = Math.max(0.3, state.groundEff || 1);
  const tasks = ac.ta.tasks;
  const fin = {};
  const finish = (k) => {
    if (fin[k] !== undefined) return fin[k];
    const t = tasks[k];
    if (!t || k === 'push' || t.st === 'done') return (fin[k] = 0);
    let start = 0;
    for (const d of t.after) start = Math.max(start, finish(d));
    const rem = ((1 - t.prog) * Math.max(30, t.dur)) / eff;
    const lead = t.st === 'active' ? 0 : t.need ? 240 : 40; // Anfahrt Fahrzeug / Brücke
    return (fin[k] = start + lead + rem);
  };
  let m = 0;
  for (const k of Object.keys(tasks)) m = Math.max(m, finish(k));
  return state.time + m + 90; // Türen zu, Brücke weg
}

export const slotOpen = (state, ac, lead = 0) => {
  const rot = rotOf(state, ac);
  return !rot || !rot.ctot || state.time >= rot.ctot - SLOT_EARLY - lead;
};

// Status für Anzeigen
export function slotInfo(state, rot) {
  if (!rot || !rot.ctot) return null;
  const t = state.time;
  if (rot.atd) {
    const ok = rot.atd >= rot.ctot - SLOT_EARLY && rot.atd <= rot.ctot + SLOT_LATE;
    return { cls: ok ? 'ok' : 'late', txt: ok ? T('Slot eingehalten') : T('Slot verfehlt') };
  }
  if (t < rot.ctot - SLOT_EARLY) return { cls: 'wait', txt: T`Fenster ab ${fmtClock(rot.ctot - SLOT_EARLY)}` };
  if (t <= rot.ctot + SLOT_LATE) return { cls: t > rot.ctot + SLOT_LATE - 180 ? 'soon' : 'ok', txt: T`im Fenster bis ${fmtClock(rot.ctot + SLOT_LATE)}` };
  return { cls: 'late', txt: T('Slot verpasst') };
}

// beim Erreichen der Parkposition: TOBT setzen, evtl. Slot zuteilen
export function acdmOnBlock(state, ac) {
  const rot = rotOf(state, ac);
  if (!rot) return;
  rot.tobt = Math.max(rot.std, ceilMin(estimateReady(state, ac), 300));
  rot.ctot = null;
  rot.atfm = 0;
  rot.slotMissed = 0;
  if (rot.special) {
    rot.tsat = rot.tobt;
    return;
  }
  const wx = state.weather.kind;
  let p = 0.24 + (wx === 'storm' ? 0.25 : wx === 'rain' || wx === 'fog' ? 0.1 : 0);
  if (state.strikeUntil > state.time) p += 0.1;
  if (rand(state) < p) {
    const r = rand(state);
    const delay = 3 + Math.round(r * r * 32);
    rot.ctot = ceilMin(rot.tobt + exot(state, ac) + delay * 60);
    rot.ctotReason = pick(state, REASONS);
    // Verspätung durch die Verkehrsflusssteuerung (ATFM) geht nicht aufs Konto des Flughafens
    rot.atfm = Math.max(0, rot.ctot - exot(state, ac) - rot.std);
    log(state, 'sys', T`Slot (CTOT) für ${ac.cs}: ${fmtClock(rot.ctot)} – ${rot.ctotReason}.`);
  }
  rot.tsat = tsatFor(state, ac, rot);
}

function tsatFor(state, ac, rot) {
  const tobt = rot.tobt || rot.std;
  if (rot.ctot) return Math.max(tobt, ceilMin(rot.ctot - exot(state, ac)));
  // Vorabflug-Sequenz: bei vollem Rollhalt später starten lassen
  const queue = state.acs.filter((a) => a !== ac && [PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED].includes(a.phase)).length;
  return ceilMin(tobt + Math.max(0, queue - 2) * 75);
}

function reslot(state, ac, rot, why, gnd) {
  rot.slotMissed = (rot.slotMissed || 0) + 1;
  const old = rot.ctot;
  const earliest = ac.phase === PH.STAND ? Math.max(state.time, rot.tobt || 0) + exot(state, ac) : state.time + 120;
  rot.ctot = ceilMin(earliest + randInt(state, 10, 30) * 60);
  // Gewitter: höhere Gewalt – neuer Slot ohne Strafe, Verspätung zählt als ATFM
  if (state.weather.kind === 'storm') {
    rot.atfm = Math.max(rot.atfm || 0, rot.ctot - exot(state, ac) - rot.std);
    log(state, 'sys', T`${ac.cs}: neuer Slot wegen Gewitter – CTOT ${fmtClock(rot.ctot)}.`);
    return;
  }
  // weitere Revisionen desselben Flugs: nur neuer Slot, keine zweite Strafe/Meldung
  if (rot.slotMissed > 1) {
    log(state, 'sys', T`${ac.cs}: Slot erneut angepasst – CTOT ${fmtClock(rot.ctot)}.`);
    return;
  }
  state.stats.today.slotMiss = (state.stats.today.slotMiss || 0) + 1;
  if (gnd) state.stats.today.slotMissGnd = (state.stats.today.slotMissGnd || 0) + 1;
  const c = contractOf(state, rot);
  if (c) c.sat = clamp(c.sat - 3, 0, 100);
  state.reputation = clamp(state.reputation - 0.4, 0, 100);
  log(state, 'sys', T`${ac.cs}: Slot ${fmtClock(old)} verpasst (${why}) – neuer CTOT ${fmtClock(rot.ctot)}.`);
  notify(state, T`⏱️ ${ac.cs} hat den Slot verpasst – neuer CTOT ${fmtClock(rot.ctot)}`, 'warn');
  if (ac.mode === 'map' && ac.phase !== PH.STAND) radio(state, ac.cs, `${tel(ac)}, we missed our slot, new CTOT ${fmtClock(rot.ctot).replace(':', '')}.`);
}

export function updateAcdm(state, dt) {
  state.acdmTimer = (state.acdmTimer || 0) - dt;
  const tick = state.acdmTimer <= 0;
  if (tick) state.acdmTimer = 10;
  for (const ac of state.acs) {
    const rot = rotOf(state, ac);
    if (!rot || ac.mode !== 'map') continue;
    // Wartezeit mit laufenden Triebwerken am Rollhalt
    if ((ac.phase === PH.HOLDING || ac.phase === PH.LINED) && ac.v === 0) {
      ac.waitT = (ac.waitT || 0) + dt;
      if (ac.waitT > 60) {
        rot.taxiWait = (rot.taxiWait || 0) + dt;
        state.stats.today.taxiWait = (state.stats.today.taxiWait || 0) + dt;
        const c = contractOf(state, rot);
        if (c) c.sat = clamp(c.sat - dt * 0.0012, 0, 100);
      }
    }
    if (!tick) continue;
    if (ac.phase === PH.STAND && ac.ta) {
      const est = estimateReady(state, ac);
      const want = Math.max(rot.std, ceilMin(est, 300));
      if (!rot.tobt) rot.tobt = rot.std;
      if (Math.abs(want - rot.tobt) >= 300 && !ac.ta.ready) {
        if (want >= (rot.tobtLogged || rot.std) + 600) {
          log(state, 'gnd', T`TOBT ${ac.cs} verschoben auf ${fmtClock(want)} (STD ${fmtClock(rot.std)}).`);
          rot.tobtLogged = want;
        }
        rot.tobt = want;
      }
      rot.tsat = tsatFor(state, ac, rot);
      // Slot mit neuer TOBT nicht mehr erreichbar -> Slot wird angepasst (Abfertigung verschuldet)
      if (rot.ctot && rot.tobt + exot(state, ac) > rot.ctot + SLOT_LATE) {
        reslot(state, ac, rot, T('Abfertigung verspätet'), true);
        rot.tsat = tsatFor(state, ac, rot);
      }
    }
    // bereits auf der Piste: Slot-Toleranz, sonst neuer Slot (Freigaben erlöschen)
    if (rot.ctot && !rot.atd && [PH.PUSH, PH.STARTUP, PH.TAXI_OUT, PH.HOLDING].includes(ac.phase) && state.time > rot.ctot + SLOT_LATE) {
      reslot(state, ac, rot, T('nicht rechtzeitig gestartet'), false);
      if (ac.phase === PH.HOLDING || ac.phase === PH.TAXI_OUT) {
        ac.clr.takeoff = false;
        ac.clr.lineup = false;
      }
      ac.slotCall = false;
    }
  }
}

// beim Abheben
export function acdmOnTakeoff(state, ac, rot) {
  const t = state.stats.today;
  t.depN = (t.depN || 0) + 1;
  if (!rot || !rot.ctot) return;
  if (state.time < rot.ctot - SLOT_EARLY) t.slotEarly = (t.slotEarly || 0) + 1;
  else if (state.time <= rot.ctot + SLOT_LATE) {
    t.slotOk = (t.slotOk || 0) + 1;
    state.life && (state.life.slotsOk = (state.life.slotsOk || 0) + 1);
  }
}

export function fmtSlot(rot) {
  return rot && rot.ctot ? `${fmtClock(rot.ctot)} (−5/+10)` : '—';
}
