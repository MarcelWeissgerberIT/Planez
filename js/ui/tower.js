// Tower-Arbeitsplatz: Flugstreifen & Befehle
import { CMDS, command, validCommands, tailwind, preferredRunway, requestRunwayChange, drainCount, primaryCommand, departureWait, clearanceRisk } from '../sim/atc.js';
import { correctReadback, RB_WINDOW, RB_HINT } from '../sim/readback.js';
import { SIDS } from '../sim/sid.js';
import { WX_WINDOW } from '../sim/wxdev.js';
import { inspState, inspConflict, approveInspection, deferInspection, INSP_MIN } from '../sim/inspect.js';
import { heliConflict, approveHeli, holdHeli, heliOverRunways } from '../sim/heli.js';
import { vfrConflict, clearVfr, extendVfr } from '../sim/vfr.js';
import { PH, PHASE_DE, runwayOccupants, fmtAlt } from '../sim/aircraft.js';
import * as AS from '../sim/airspace.js';
import { AC_TYPES, CITIES, AIRPORT, typeCode } from '../config.js';
import { fmtClock, esc } from '../util.js';
import { syncList, setHTML, toast, $ } from './dom.js';
import { sfx } from '../audio.js';
import { icon } from './icons.js';
import { flagButton, flagHtml, openMarkMenu } from './marks.js';
import { updateSequence, isSeqArrival, seqSlot, seqMove, seqMoveTo, seqSortByEta, seqIndex, updateArrQueue, arrQMoveTo } from '../sim/sequence.js';
import { qm, glTag } from './glossary.js';
import { slotInfo } from '../sim/acdm.js';
import { rwyCond, brakingAction, BRAKE_DE, runwayClosed, isWet, hasRwy2, rwyName, segregated } from '../sim/runway.js';
import { isNight } from '../sim/finance.js';
import { temperature } from '../sim/winter.js';
import { T, TC } from '../i18n.js';
import { windShort, gustXw } from '../sim/gusts.js';

const WAKE_KEY = { L: 'Light', M: 'Medium', H: 'Heavy' };
export const wakeTag = (w) => glTag(WAKE_KEY[w] || 'WTC', w);

// Treibstoffreserve eines Anflugs (Minuten)
export function fuelChip(ac) {
  if (!ac.arr || ac.fuelMin === undefined || ac.mode !== 'air' || ac.phase === PH.DEPART) return '';
  const m = Math.max(0, Math.round(ac.fuelMin));
  const cls = ac.fuelEmergency || m <= 5 ? 'bad' : ac.minFuel || m <= 12 ? 'warn' : '';
  return ` <span class="fuelc ${cls}" title="${T('Treibstoffreserve')}">⛽ ${m}′${ac.fuelEmergency ? ' MAYDAY FUEL' : ac.minFuel ? ' MINFUEL' : ''}</span>`;
}

// Statusblock der Pisten (Betriebsrichtung, Belegung, Zustand, Sperrung, Betriebsart)
export function runwayStatusHtml(state) {
  const tw = tailwind(state, state.rwy);
  const pref = preferredRunway(state);
  const other = state.rwy === '27' ? '09' : '27';
  const xw = Math.round(gustXw(state));
  let h = T`<div>Betriebsrichtung <b style="font-family:var(--mono)">${state.rwy}</b> · Wind ${windShort(state)} <small style="color:var(--muted)">(${tw > 0 ? T('Rückenwind') : T('Gegenwind')} ${Math.abs(tw).toFixed(0)} kt${xw >= 15 ? T` · Seitenwind in Böen <b style="color:${xw > 32 ? 'var(--bad)' : xw > 24 ? 'var(--warn)' : 'inherit'}">${xw} kt</b>` : ''})</small></div>`;
  if (state.gustFront) h += T`<div class="rwy-cond" style="color:var(--bad)">⛈️ <b>Böenfront</b> – Starts warten, Anflüge können durchstarten (Seitenwindlimits mit Böen: Turboprop 32 kt, Mittelstrecke 38 kt, Großraum 40 kt)</div>`;
  if (state.rwyPending) h += T`<button class="cmd" data-rwy="${state.rwy}">Abbrechen</button><div style="color:var(--warn)">Wechsel auf ${state.rwyPending} ausstehend – ${drainCount(state)} Bewegungen laufen noch</div><div></div>`;
  else h += `<button class="cmd ${pref !== state.rwy ? 'big' : ''}" data-rwy="${other}" title="${pref !== state.rwy ? T('Rückenwind – Wechsel empfohlen') : T('Betriebsrichtung wechseln')}">→ ${other}</button>`;
  for (const strip of hasRwy2(state) ? ['N', 'S'] : ['N']) {
    const occ = runwayOccupants(state, strip);
    const ba = brakingAction(state, strip);
    const closed = runwayClosed(state, strip);
    const cond = Math.round(rwyCond(state, strip));
    const role = !hasRwy2(state) ? '' : segregated(state) ? (strip === 'N' ? T(' · Starts') : T(' · Landungen')) : strip === 'N' ? T(' · Starts & Landungen') : T(' · Reserve');
    h += T`<div class="rwy-line"><b class="rwy-id">${rwyName(state, strip)}</b>${role} · ${closed ? `<span class="state busy">⛔ ${esc(closed)}</span>` : occ.length ? T`<span class="state busy">belegt · ${occ.map((a) => esc(a.cs)).join(', ')}</span>` : T('<span class="state free">frei</span>')}<div class="rwy-cond">Zustand <b>${cond} %</b> · Bremswirkung <b class="ba-${ba}">${BRAKE_DE[ba]}</b>${isWet(state) ? T(' (nass)') : ''}${state.rwySnow && state.rwySnow[strip] > 0.04 ? T` · ❄️ Schnee <b>${Math.round(state.rwySnow[strip] * 100)} %</b>${state.plow && state.plow.strip === strip ? T(' – Räumdienst') : state.rwySnow[strip] > 0.25 ? T(' – Räumung bald') : ''}` : ''}</div></div><div></div>`;
  }
  // Notfall-Checkliste (hakt sich selbst ab)
  const em = !state.auto.atc && state.acs.find((a) => (a.emergency || a.fuelEmergency) && (a.mode === 'air' || [PH.FINAL, PH.ROLLOUT].includes(a.phase)));
  if (em) {
    const fire = state.fireAlert && state.fireAlert.ac === em.id;
    const app = em.mode === 'map' || em.phase === PH.APPROACH;
    const near = em.mode === 'map' || (em.phase === PH.APPROACH && distToLand(em) < 10);
    const depClr = state.acs.find((a) => !a.arr && a.clr.takeoff && [PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAXI_OUT].includes(a.phase));
    const landed = em.mode === 'map' && em.phase === PH.ROLLOUT;
    const it = (ok, txt, warn) => `<li class="${ok ? 'ok' : warn ? 'warn' : ''}">${ok ? '✔' : warn ? '⚠' : '○'} ${txt}</li>`;
    h += T`<div class="emg-cl"><b>🚨 Notfall ${esc(em.cs)}${em.fuelEmergency ? T(' · Treibstoff') : em.emgKind === 'medical' ? T(' · medizinisch') : ''}</b><ul>
      ${it(fire || em.emgKind === 'medical' || em.fuelEmergency, em.emgKind === 'medical' ? T('Rettungsdienst bestellt') : T('Feuerwehr alarmiert'))}
      ${it(app, T('Direktanflug freigeben <kbd>D</kbd>'))}
      ${it(near && !depClr, depClr ? T`Startfreigabe ${esc(depClr.cs)} zurückhalten` : T('Keine Starts vor der Notlandung'), !!depClr)}
      ${it(em.clr.land, T('Landefreigabe <kbd>L</kbd>'))}
      ${it(landed, em.emgKind === 'medical' ? T('Gelandet – Rettungswagen am Flugzeug') : T('Gelandet – Feuerwehr am Flugzeug'))}
    </ul></div><div></div>`;
  }
  // Pistenkontrolle: Anfrage mit Lücken-Check, laufende Kontrolle
  const I = state.insp;
  if (I && I.req && !state.auto.atc && !state.settings.inspAuto) {
    const c = inspConflict(state);
    const wait = Math.max(0, Math.round((state.time - I.req.t) / 60));
    h += T`<div class="insp-rq${c ? (c.hard ? ' hard' : ' soft') : ' ok'}">🚙 <b>Pistenkontrolle</b> bittet, Bahn ${rwyName(state, 'N')} abzufahren (${INSP_MIN} min)${wait ? T` · wartet seit ${wait} min` : ''}<small>${c ? `⚠ ${esc(c.ac.cs)} ${esc(c.why)}` : T('✓ Lücke – jetzt freigeben')}</small></div><div class="insp-b"><button class="cmd ${c ? '' : 'big'}" data-insp="ok">Freigeben</button><button class="cmd" data-insp="later">Später</button></div>`;
  } else if (I && I.active) {
    const left = Math.max(0, I.active.until - state.time);
    h += T`<div class="insp-rq act">🚙 Pistenkontrolle auf Bahn ${rwyName(state, 'N')} – noch ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}</div><div></div>`;
  }
  // Rettungshubschrauber: Querungsanfrage mit Lücken-Check
  const HH = state.heli && state.heli.h;
  if (HH && HH.st === 'req' && !state.auto.atc && !state.settings.inspAuto) {
    const c = heliConflict(state);
    const wait = Math.max(0, Math.round((state.time - HH.t) / 60));
    h += T`<div class="insp-rq heli${c ? (c.hard ? ' hard' : ' soft') : ' ok'}">🚁 <b>Rescue 7</b> bittet, die Bahnen in der Mitte zu queren${wait ? T` · wartet seit ${wait} min` : ''}<small>${c ? `⚠ ${esc(c.ac.cs)} ${esc(c.why)}` : T('✓ frei – jetzt queren lassen')}</small></div><div class="insp-b"><button class="cmd ${c && c.hard ? '' : 'big'}" data-heli="ok" title="Taste Y">Querung frei</button>${HH.told ? '' : T('<button class="cmd" data-heli="hold">Warten</button>')}</div>`;
  } else if (heliOverRunways(state)) h += T`<div class="insp-rq act heli">🚁 Rescue 7 quert die Bahnen</div><div></div>`;
  // Platzrunden: Touch-and-Go-Anfrage mit Lücken-Check
  const VP = state.vfr && state.vfr.p;
  if (VP && VP.req && !VP.clr && !state.auto.atc && !state.settings.inspAuto) {
    const c = vfrConflict(state);
    h += T`<div class="insp-rq vfr${c ? (c.hard ? ' hard' : ' soft') : ' ok'}">🛩️ <b>${esc(VP.cs)}</b> (Alcedo, Platzrunde) bittet um Touch and Go${VP.mode === 'orbit' ? T(' · fliegt Vollkreis') : ''}<small>${c ? `⚠ ${esc(c.ac.cs)} ${esc(c.why)}` : T('✓ Lücke – jetzt freigeben')}</small></div><div class="insp-b"><button class="cmd ${c && c.hard ? '' : 'big'}" data-vfr="ok" title="Taste Y">Touch & Go</button>${VP.told || VP.mode === 'orbit' ? '' : T('<button class="cmd" data-vfr="ext">Vollkreis</button>')}</div>`;
  }
  // Assistenz: Wetterumwege und Pistenkontrollen dem Kollegen überlassen
  if (!state.auto.atc) h += T`<div class="rwy-assist"><span>Assistenz</span><button class="rl-tg" data-assist="wxAuto" title="Umweg-Anfragen bei Gewitter automatisch genehmigen (ohne Punkte)"><span class="switch ${state.settings.wxAuto ? 'on' : ''}"></span>Umwege auto</button><button class="rl-tg" data-assist="inspAuto" title="Pistenkontrollen, Hubschrauber-Querungen und Touch-and-Go der Platzrunden in ruhigen Phasen automatisch freigeben (ohne Punkte)"><span class="switch ${state.settings.inspAuto ? 'on' : ''}"></span>Nebenverkehr auto</button></div>`;
  if (hasRwy2(state)) h += T`<div class="rwy-cond">Betriebsart: <b>${segregated(state) ? T('getrennt (Landungen Süd, Starts Nord)') : T('eine Bahn (alles auf der Nordbahn)')}</b></div><button class="cmd" data-rwymode="${segregated(state) ? 'single' : 'seg'}">${segregated(state) ? T('→ eine Bahn') : T('→ getrennt')}</button>`;
  h += `<div class="rwy-cond">${temperature(state).toFixed(0)} °C · ${state.weather.kind === 'fog' ? `RVR <b>${state.weather.rvr ?? '—'} m</b> · LVP · ` : ''}${isNight(state) ? (state.settings.curfew ? T`${icon('moon')} Nachtflugverbot` : T`${icon('moon')} Nacht`) : T`${icon('sun')} Tagbetrieb`}</div>${qm('rwy')}`;
  return h;
}

// A-CDM-Zeiten eines Abflugs
export function acdmLine(state, ac) {
  const rot = state.rots[ac.rot];
  if (!rot || !rot.tobt || rot.atd) return '';
  const late = rot.tobt > rot.std ? ' late' : '';
  let h = `<span class="acdm${late}">TOBT ${fmtClock(rot.tobt)}</span>`;
  if (rot.tsat && (rot.ctot || rot.tsat !== rot.tobt) && [PH.STAND, PH.PUSH].includes(ac.phase)) h += ` <span class="acdm">TSAT ${fmtClock(rot.tsat)}</span>`;
  const si = slotInfo(state, rot);
  if (si) h += ` <span class="slot ${si.cls}">CTOT ${fmtClock(rot.ctot)} · ${si.txt}</span>`;
  return `<div class="s-acdm">${h}</div>`;
}

// Farben der Pistenfolge (auch Radar/Karte) – wie die Kontrollstreifen: Anflug orange, Abflug blau, hell = Freigabe erteilt
export const SEQ_COL = { land: '#fb923c', landClr: '#fed7aa', dep: '#38bdf8', depClr: '#bae6fd' };
export function seqColor(ac) {
  if (isSeqArrival(ac)) return ac.clr.land ? SEQ_COL.landClr : SEQ_COL.land;
  return ac.clr.takeoff ? SEQ_COL.depClr : SEQ_COL.dep;
}

export const REQ_DE = {
  approach: T('wartet auf Anflugfreigabe'),
  land: T('bittet um Landefreigabe'),
  taxi_in: T('bittet um Rollfreigabe'),
  push: T('bittet um Pushback'),
  taxi_out: T('bittet um Rollfreigabe'),
  takeoff: T('startbereit'),
  cross: T('bittet um Kreuzen der Startbahn'),
};

export function distToLand(ac) {
  if (ac.mode === 'map') return ac.phase === PH.FINAL ? 0.2 : 0;
  return AS.routeDistance(ac.pos, ac.route.length && ac.phase === PH.APPROACH ? ac.route : AS.approachRoute(ac.pos, ac.rwy));
}

export function cmdButtons(state, ac, compact = false, showSpd = true) {
  const keys = validCommands(state, ac);
  const main = keys.filter((k) => !CMDS[k].spd);
  const spd = keys.filter((k) => CMDS[k].spd);
  let h = main
    .map((k) => {
      const c = CMDS[k];
      const cls = c.big ? 'big' : c.danger ? 'danger' : '';
      // gefährliche Freigabe schon vorher sichtbar machen
      const risk = state.role === 'tower' && (k === 'land' || k === 'takeoff' || k === 'lineup') ? clearanceRisk(state, ac, k) : null;
      return `<button class="cmd ${cls}${risk ? ' risk' : ''}" data-cmd="${k}" data-ac="${ac.id}"${risk ? ` title="⚠ ${esc(risk)}"` : ''}>${risk ? '⚠ ' : ''}${c.label}${c.key && !compact ? ` <kbd>${c.key}</kbd>` : ''}</button>`;
    })
    .join('');
  if (spd.length && showSpd) h += spd.map((k) => `<button class="cmd spd ${ac.spdOverride === CMDS[k].spd ? 'on' : ''}" data-cmd="${k}" data-ac="${ac.id}">${CMDS[k].label}</button>`).join('');
  return h;
}

// Strecke: kurz mit dem Kürzel des Heimatflughafens (Streifen), lang mit dem Stadtnamen (Info-Karte)
export function acRoute(state, ac, long = false) {
  const rot = state.rots[ac.rot];
  if (!rot) return '';
  const city = CITIES[rot.city]?.name || rot.city;
  const home = long ? AIRPORT.city : AIRPORT.code;
  return ac.arr && ac.phase !== PH.STAND && !['PUSHBACK', 'STARTUP', 'TAXI_OUT', 'HOLDING', 'LINEUP', 'LINED_UP', 'TAKEOFF', 'DEPARTURE'].includes(ac.phase) ? `${city} → ${home}` : `${home} → ${city}`;
}

// Hauptbefehl je Anfrage (für die kleinen Karten)
const Q_PH = new Set([PH.INBOUND, PH.HOLD, PH.GOAROUND, PH.MISSED]);
const ARR_GND = new Set([PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN]);
const DEP_APRON = new Set([PH.PUSH]);
// Streifentafel: Buchten, Abflug oder Anflug, Freigabe-Kästchen
const BAYS = ['air', 'rwy', 'taxi', 'apron'];
const DEP_PH = new Set([PH.STAND, PH.PUSH, PH.STARTUP, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF, PH.DEPART]);
const isDepStrip = (ac) => !ac.arr || DEP_PH.has(ac.phase);
const EMPTY = { air: () => T('Kein Verkehr in der Luft.'), rwy: () => T('Pistenfolge leer.'), taxi: () => T('Niemand rollt herein.'), apron: () => T('Keine Pushback-Anfragen.') };
const TICK_TITLE = { APP: T('Anflug frei'), LND: T('Landefreigabe'), TX: T('Rollfreigabe'), PB: T('Pushback frei'), LU: T('Line up'), TO: T('Startfreigabe') };
// [Kürzel, erteilt, jetzt fällig]
function ticks(ac, land) {
  const c = ac.clr || {};
  if (land) return [['APP', !!c.app || [PH.FINAL, PH.ROLLOUT].includes(ac.phase) || ac.mode === 'map', ac.req === 'approach'], ['LND', !!c.land || (ac.mode === 'map' && ac.phase !== PH.ROLLOUT ? true : false), ac.req === 'land'], ['TX', !!c.taxi, ac.req === 'taxi_in' || ac.req === 'cross']];
  const pushed = ac.phase !== PH.STAND;
  const lined = !!c.lineup || [PH.LINEUP, PH.LINED, PH.TAKEOFF, PH.DEPART].includes(ac.phase);
  return [['PB', pushed, ac.req === 'push'], ['TX', !!c.taxiOut || [PH.TAXI_OUT, PH.HOLDING].includes(ac.phase) || lined, ac.req === 'taxi_out'], ['LU', lined, false], ['TO', !!c.takeoff || [PH.TAKEOFF, PH.DEPART].includes(ac.phase), ac.req === 'takeoff']];
}
// Sicherheitsabfrage: Eine gefährliche Freigabe (Landung auf belegte Bahn, Start/Line-up mit Verkehr im kurzen
// Endanflug) wird erst beim zweiten Druck innerhalb von vier Sekunden erteilt – vorher Warnton und Hinweis.
// In den Einstellungen abschaltbar (settings.safetyNet === false).
let pendingRisk = null;
export function guardedCommand(state, ac, key) {
  if (state.role === 'tower' && state.settings.safetyNet !== false) {
    const risk = clearanceRisk(state, ac, key);
    const again = pendingRisk && pendingRisk.id === ac.id && pendingRisk.key === key && performance.now() - pendingRisk.t < 4000;
    if (risk && !again) {
      pendingRisk = { id: ac.id, key, t: performance.now() };
      sfx.alert();
      toast(T`⚠ ${ac.cs}: ${risk}. Nochmal drücken, um trotzdem freizugeben.`, 'bad', 4000);
      return { ok: false, held: true };
    }
  }
  pendingRisk = null;
  return command(state, ac, key);
}

// Start/Line-up vor dem Startfenster: erlaubt, aber mit Warnung (der nächste Anflug muss evtl. durchstarten)
function earlyWarning(state, ac, key) {
  if ((key !== 'takeoff' && key !== 'lineup') || ac.phase === PH.LINED) return null;
  const w = departureWait(state, ac);
  return w.sec > 0 && w.land ? T`⚠ ${ac.cs}: ${w.why} – die Landung muss womöglich durchstarten` : null;
}
const mmss = (sec) => {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// Tower-Arbeitsplatz: rechts Radar + Pistenstatus + Funk in einem Fenster, unten die Flugstreifen-Leiste
// Readback-Hinweis: mit Tipps nach kurzer Zeit, ohne Tipps später (dann heißt es: hinhören)
export const rbHintDelay = (state) => (state.settings.hints === false ? 7 : RB_HINT);
export function fixReadback(game, ac) {
  const s = game.state;
  const target = ac && ac.rbErr ? ac : s.acs.find((a) => a.rbErr);
  if (!target) {
    toast(T('👂 Kein falscher Readback offen – alle Rücklesungen stimmen'), 'info', 2200);
    return false;
  }
  const r = correctReadback(s, target);
  if (r.ok) {
    sfx.click();
    toast(r.quick ? T`👂 Gut aufgepasst! ${target.cs} korrigiert` : T`✔ ${target.cs}: Readback korrigiert`, 'good', 2400);
  }
  return r.ok;
}

export class TowerPanel {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    root.classList.add('tw-side');
    root.innerHTML = T`
      <div class="p-head">
        <div class="p-title">${icon('headset')} Tower <small>${AIRPORT.tower} ${AIRPORT.freq}</small></div>
        <button class="mini" id="tw-rwy-t" title="Pistenstatus ein-/ausklappen">Pisten ▾</button>
      </div>
      <div class="tw-radar-slot" id="tw-radar-slot"></div>
      <div class="rwy-box tw-rwy" id="tw-rwy"></div>
      <div class="tw-mm-slot" id="tw-mm-slot"></div>
      <div class="tw-log-slot" id="tw-log-slot"></div>`;
    // Radar und Funk in das Fenster holen (beim Rollenwechsel zurück)
    this.moved = [];
    this.dock($('#radar-wrap'), root.querySelector('#tw-radar-slot'));
    this.dock($('#log-wrap'), root.querySelector('#tw-log-slot'));
    // Minikarte unter Radar und Pistenstatus statt über dem Panel: das Radar behält seine Größe, der Funk wird kürzer
    this.dock($('#minimap'), root.querySelector('#tw-mm-slot'));
    $('#log-wrap').classList.remove('min');
    $('#log-toggle').textContent = '–';
    root.querySelector('#tw-rwy-t').addEventListener('click', () => {
      const r = root.querySelector('#tw-rwy');
      r.classList.toggle('closed');
      root.querySelector('#tw-rwy-t').textContent = r.classList.contains('closed') ? T('Pisten ▸') : T('Pisten ▾');
    });
    root.addEventListener('click', (e) => this.onClick(e));

    // Streifentafel unten – wie im echten Tower: Buchten nach dem Zustand des Flugs (Luft · Pistenfolge · Rollen ·
    // Vorfeld), Anflüge orange, Abflüge blau, die nächste Aktion steht oben; erteilte Freigaben werden abgehakt
    const rail = document.createElement('section');
    rail.id = 'rail';
    const bay = (id, name, hint) => `<div class="bay" data-bay="${id}"><div class="bay-h"><span>${name}</span><span class="cnt" id="rl-c-${id}">0</span>${hint ? `<small>${hint}</small>` : ''}</div><div class="bay-list" id="rl-${id}" data-bay="${id}"></div></div>`;
    rail.innerHTML = `
      <div class="rail-head">
        <div class="rail-title">${icon('plane')} ${T('Streifentafel')}${qm('seq')}</div>
        <div class="seg" id="rl-filter" title="${T('Filter: nur Anflüge, beide oder nur Abflüge')}"><button data-f="arr">${icon('land')} ${TC('rail', 'An')}</button><button data-f="both">${T('Beide')}</button><button data-f="dep">${icon('takeoff')} ${TC('rail', 'Ab')}</button></div>
        <button class="rl-tg" id="rl-spacing" title="${T('Reihenfolge per Drag & Drop – Anflugfreigaben, Geschwindigkeit und Lücken für Starts passen sich automatisch an')}"><span class="switch"></span>${T('Auto-Staffelung')}</button>
        <button class="rl-tg" id="rl-gauto" title="${T('Rollverkehr (Pushback, Rollen, Kreuzen) automatisch – du kümmerst dich nur um Luftraum und Piste')}"><span class="switch"></span>${T('Rollverkehr auto')}</button>
        <span id="rl-sort"></span>
        <span class="rl-legend"><span><i class="lg-arr"></i>${T('Anflug')}</span><span><i class="lg-dep"></i>${T('Abflug')}</span><span><i class="lg-tick">✓</i>${T('Freigabe erteilt')}</span><span><i class="lg-due">!</i>${T('fällig')}</span></span>
        <button class="mini" id="rl-min" title="${T('Leiste verkleinern')}">▾</button>
      </div>
      <div class="rail-bays" id="rl-bays">
        ${bay('air', T('Luft'), T('oben = als Nächstes'))}${bay('rwy', T('Pistenfolge'), T('ziehen = umsortieren'))}${bay('taxi', T('Rollen'))}${bay('apron', T('Vorfeld'))}
      </div>`;
    $('#game').appendChild(rail);
    this.rail = rail;
    this.el = { rwy: root.querySelector('#tw-rwy'), bays: rail.querySelector('#rl-bays') };
    this.bay = {};
    for (const b of BAYS) this.bay[b] = rail.querySelector(`#rl-${b}`);
    rail.addEventListener('click', (e) => this.onClick(e));
    rail.addEventListener('pointerdown', () => (this.game.panelHold = true));
    this.wireDrag(this.el.bays);
    document.getElementById('game').classList.add('tw-layout');
    this.game.resize && this.game.resize();
  }

  dock(el, slot) {
    if (!el || !slot) return;
    this.moved.push([el, el.parentNode, el.nextSibling]);
    slot.appendChild(el);
  }

  // Arbeitsplatz („Radar groß“): großes Radar, rechts Übersicht (Minikarte), Pistenstatus und Funk, darunter die
  // Streifentafel – wie eine Lotsenkonsole. Schließen stellt alles an seinen Platz zurück.
  cwp(on) {
    const g = $('#game');
    if (!!on === !!this.cw) return;
    if (on) {
      const box = document.createElement('section');
      box.id = 'cwp';
      box.innerHTML = `<div class="cwp-radar"></div><div class="cwp-side"><div class="cwp-head"><span>${icon('headset')} ${T('Arbeitsplatz')}</span><small>${AIRPORT.tower}</small><button class="mini cwp-x" title="${T('Arbeitsplatz schließen (F oder Esc)')}">✕</button></div><div class="cwp-mm"></div><div class="cwp-rwy"></div><div class="cwp-log"></div></div><div class="cwp-rail"></div>`;
      g.appendChild(box);
      this.cw = { box, moved: [] };
      const mv = (el, sel) => {
        if (!el) return;
        this.cw.moved.push([el, el.parentNode, el.nextSibling]);
        box.querySelector(sel).appendChild(el);
      };
      mv($('#radar-wrap'), '.cwp-radar');
      mv($('#minimap'), '.cwp-mm');
      mv(this.el.rwy, '.cwp-rwy');
      mv($('#log-wrap'), '.cwp-log');
      mv(this.rail, '.cwp-rail');
      if (this.game.minimap) this.game.minimap.force(true);
      box.querySelector('.cwp-x').addEventListener('click', () => $('#radar-big').click());
      box.addEventListener('click', (e) => {
        if (e.target.closest('#tw-rwy')) this.onClick(e);
      });
      // Mausrad und Ziehen nicht an die Karte darunter weitergeben
      for (const ev of ['wheel', 'mousedown', 'touchstart', 'dblclick']) box.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    } else {
      for (const [el, parent, next] of this.cw.moved.reverse()) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
      this.cw.box.remove();
      this.cw = null;
      if (this.game.minimap) this.game.minimap.force(false);
    }
    g.classList.toggle('cwp-on', !!on);
  }

  // Rollenwechsel: Radar/Funk zurück, Leiste entfernen
  destroy() {
    this.cwp(false);
    for (const [el, parent, next] of this.moved.reverse()) parent.insertBefore(el, next);
    this.moved = [];
    this.rail.remove();
    this.root.classList.remove('tw-side');
    document.getElementById('game').classList.remove('tw-layout');
  }

  get filter() {
    return this.game.state.settings.railFilter || 'both';
  }

  onClick(e) {
    const s = this.game.state;
    const rb = e.target.closest('[data-rbfix]');
    if (rb) return fixReadback(this.game, s.acs.find((a) => a.id === rb.dataset.rbfix));
    const b = e.target.closest('[data-cmd]');
    if (b) {
      const ac = s.acs.find((a) => a.id === b.dataset.ac);
      if (!ac) return;
      const early = earlyWarning(s, ac, b.dataset.cmd);
      const r = guardedCommand(s, ac, b.dataset.cmd);
      if (r.held) return;
      if (!r.ok) toast(r.msg, 'warn');
      else {
        sfx.click();
        if (early) toast(early, 'warn', 3500);
      }
      this.game.select(ac.id, false);
      return;
    }
    const rw = e.target.closest('[data-rwy]');
    if (rw) return requestRunwayChange(s, rw.dataset.rwy);
    const ab = e.target.closest('[data-assist]');
    if (ab) {
      const k = ab.dataset.assist;
      s.settings[k] = !s.settings[k];
      toast(k === 'wxAuto' ? (s.settings[k] ? T('⛈️ Umweg-Anfragen genehmigt jetzt der Kollege') : T('⛈️ Umweg-Anfragen wieder selbst beantworten')) : s.settings[k] ? T('🚙🚁🛩️ Pistenkontrollen, Heli-Querungen und Platzrunden übernimmt jetzt der Kollege') : T('🚙🚁🛩️ Nebenverkehr wieder selbst freigeben'), 'info', 2600);
      this.update(s);
      return;
    }
    const vb = e.target.closest('[data-vfr]');
    if (vb) {
      const r = vb.dataset.vfr === 'ok' ? clearVfr(s) : extendVfr(s);
      if (r.ok) sfx.click();
      if (r.bad) toast(T`⚠ Touch and Go in den Linienverkehr – ${r.c.ac.cs} ${r.c.why}`, 'bad', 3200);
      else if (vb.dataset.vfr === 'ok' && r.ok) toast(r.soft ? T`🛩️ Freigegeben – ${r.soft.ac.cs} ist ${r.soft.why}, das wird knapp` : T('🛩️ Touch and Go freigegeben'), r.soft ? 'warn' : 'good', 2200);
      this.update(s);
      return;
    }
    const hb = e.target.closest('[data-heli]');
    if (hb) {
      const r = hb.dataset.heli === 'ok' ? approveHeli(s) : holdHeli(s);
      if (r.ok) sfx.click();
      if (r.bad) toast(T('⚠ Verkehrskonflikt – Hubschrauber quert vor Verkehr!'), 'bad', 3500);
      else if (hb.dataset.heli === 'ok' && r.ok) toast(r.soft ? T`🚁 Querung frei – ${r.soft.ac.cs} ist ${r.soft.why}, der Heli muss sich beeilen` : T('🚁 Rescue 7 quert'), r.soft ? 'warn' : 'good', 2400);
      this.update(s);
      return;
    }
    const ib = e.target.closest('[data-insp]');
    if (ib) {
      const r = ib.dataset.insp === 'ok' ? approveInspection(s) : deferInspection(s);
      if (r.ok) sfx.click();
      if (r.bad) toast(T('⚠ Pistenbetretung – Verkehr auf/vor der Bahn!'), 'bad', 3500);
      else if (r.soft) toast(T`🚙 Kontrolle auf der Bahn – ${r.soft.ac.cs} wird durchstarten müssen`, 'warn', 3000);
      else if (ib.dataset.insp === 'ok' && r.ok) toast(T('🚙 Pistenkontrolle freigegeben'), 'good', 2000);
      this.update(s);
      return;
    }
    const rm = e.target.closest('[data-rwymode]');
    if (rm) {
      s.rwyMode = rm.dataset.rwymode;
      toast(s.rwyMode === 'seg' ? T('Getrennter Betrieb: neue Anflüge auf die Südbahn') : T('Alle Bewegungen auf der Nordbahn'), 'info');
      return;
    }
    const fb = e.target.closest('[data-mark]');
    if (fb) {
      this.game.select(fb.dataset.mark, false);
      openMarkMenu(this.game, fb.dataset.mark, e.clientX, e.clientY);
      return;
    }
    const mv = e.target.closest('[data-seqmv]');
    if (mv) {
      if (seqMove(s, mv.dataset.ac, Number(mv.dataset.seqmv))) sfx.click();
      else if (s.seqErr) toast(s.seqErr, 'warn', 2600);
      this.update(s);
      return;
    }
    if (e.target.closest('[data-seqsort]')) {
      seqSortByEta(s);
      sfx.click();
      toast(T('Reihenfolge wird wieder automatisch geplant'), 'info', 2200);
      this.update(s);
      return;
    }
    const f = e.target.closest('#rl-filter [data-f]');
    if (f) {
      s.settings.railFilter = f.dataset.f;
      this.update(s);
      return;
    }
    if (e.target.closest('#rl-spacing')) {
      s.settings.autoSpacing = s.settings.autoSpacing === false;
      toast(s.settings.autoSpacing ? T('Auto-Staffelung an: Reihenfolge per Drag & Drop, Tempo und Anflugfreigaben laufen automatisch') : T('Auto-Staffelung aus: Anflugfreigaben und Geschwindigkeiten gibst du selbst'), 'info', 3200);
      this.update(s);
      return;
    }
    if (e.target.closest('#rl-gauto')) {
      s.settings.towerGroundAuto = !s.settings.towerGroundAuto;
      toast(s.settings.towerGroundAuto ? T('Rollverkehr läuft automatisch') : T('Rollverkehr wieder manuell'), 'info');
      this.update(s);
      return;
    }
    if (e.target.closest('#rl-min')) {
      this.rail.classList.toggle('min');
      document.getElementById('game').classList.toggle('rail-min', this.rail.classList.contains('min'));
      e.target.closest('#rl-min').textContent = this.rail.classList.contains('min') ? '▴' : '▾';
      if (this.cw && this.game.resize) requestAnimationFrame(() => this.game.resize());
      return;
    }
    const card = e.target.closest('.fcard');
    if (card) this.game.select(card.dataset.key, true);
  }

  // Drag & Drop wie auf der Streifentafel: in der Pistenfolge und in der Bucht „Luft“ umsortieren, aus „Luft“ in die
  // Pistenfolge ziehen (= Anflug frei) oder zurück (= Warteschleife). Oben = als Nächstes.
  wireDrag(box) {
    let drag = null;
    const clear = () => box.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    const targetOf = (e) => {
      const c = e.target.closest('.fcard');
      const list = e.target.closest('.bay-list');
      const bay = list && list.dataset.bay;
      if (!bay || !['air', 'rwy'].includes(bay)) return null;
      if (c && ['seq', 'q'].includes(c.dataset.g)) return { c, bay, g: c.dataset.g };
      return { c: null, bay, g: bay === 'rwy' ? 'seq' : 'q', list };
    };
    box.addEventListener('dragstart', (e) => {
      const c = e.target.closest('.fcard');
      if (!c || !c.draggable) return;
      drag = { id: c.dataset.key, g: c.dataset.g };
      c.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', drag.id);
      this.game.panelHold = true;
    });
    box.addEventListener('dragover', (e) => {
      if (!drag) return;
      const t = targetOf(e);
      if (!t) return;
      e.preventDefault();
      clear();
      if (t.c) {
        const r = t.c.getBoundingClientRect();
        t.c.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
      } else t.list.classList.add('drop-into');
    });
    box.addEventListener('drop', (e) => {
      if (!drag) return;
      const t = targetOf(e);
      if (!t) return;
      e.preventDefault();
      const ac = this.game.state.acs.find((a) => a.id === drag.id);
      this.drop(ac && ac.arr && !DEP_PH.has(ac.phase) ? 'arr' : 'dep', drag, t.c ? t.c.dataset.key : null, t.g, t.c ? t.c.classList.contains('drop-after') : true);
      clear();
    });
    box.addEventListener('dragend', () => {
      box.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
      clear();
      drag = null;
      this.game.panelHold = false;
      this.update(this.game.state);
    });
  }

  drop(lane, drag, target, tg, after) {
    const s = this.game.state;
    if (drag.id === target) return;
    const ac = s.acs.find((a) => a.id === drag.id);
    if (!ac) return;
    const seqBefore = () => {
      if (!target) return null;
      if (!after) return target;
      const i = s.seq.indexOf(target);
      const rest = s.seq.slice(i + 1).filter((x) => x !== drag.id);
      return rest[0] || null;
    };
    const qBefore = () => {
      if (!target) return null;
      if (!after) return target;
      const i = s.arrQ.indexOf(target);
      const rest = s.arrQ.slice(i + 1).filter((x) => x !== drag.id);
      return rest[0] || null;
    };
    let ok = false;
    let msg = '';
    if (drag.g === 'seq' && tg === 'seq') {
      ok = seqMoveTo(s, drag.id, seqBefore());
      if (!ok && s.seqErr) return toast(s.seqErr, 'warn', 2600);
    }
    else if (lane === 'arr' && drag.g === 'q' && tg === 'q') {
      ok = arrQMoveTo(s, drag.id, qBefore());
      msg = T`${ac.cs} bekommt die Anflugfreigabe in dieser Reihenfolge`;
    } else if (lane === 'arr' && drag.g === 'q' && tg === 'seq') {
      // aus der Bucht „Luft“ in die Pistenfolge: Anflug freigeben und einsortieren
      const r = command(s, ac, 'approach');
      if (!r.ok) return toast(r.msg, 'warn');
      updateSequence(s);
      ok = seqMoveTo(s, drag.id, seqBefore()) || true;
      msg = T`${ac.cs}: Anflug frei und in die Folge eingereiht`;
    } else if (lane === 'arr' && drag.g === 'seq' && tg === 'q') {
      if (!CMDS.hold.valid(s, ac)) return toast(T`${ac.cs} ist schon im Endanflug – nicht mehr in die Warteschleife`, 'warn');
      command(s, ac, 'hold');
      updateArrQueue(s);
      arrQMoveTo(s, drag.id, qBefore());
      ok = true;
      msg = T`${ac.cs} zurück in die Warteschleife`;
    }
    if (!ok) return;
    sfx.click();
    const auto = s.settings.autoSpacing !== false;
    toast(msg || (auto ? T('Reihenfolge geändert – Auto-Staffelung passt Tempo und Lücken an') : T('Reihenfolge geändert')), 'info', 2400);
  }

  // Ein Kontrollstreifen: Farbkante (Anflug orange, Abflug blau), Folgenummer, Rufzeichen mit Muster/Wirbelschleppen-
  // Kategorie, Strecke und Lage, Piste und Zeit, Freigabe-Kästchen (abgehakt = erteilt, gelb = jetzt fällig). Darunter
  // die fällige Anfrage mit Knopf; der ausgewählte Streifen klappt alle Daten und Befehle auf.
  card(state, ac, g, num) {
    const t = AC_TYPES[ac.type];
    const sel = this.game.ui.selected === ac.id;
    const inSeq = g === 'seq';
    const dep = isDepStrip(ac);
    const land = !dep;
    const col = inSeq ? seqColor(ac) : '#64748b';
    const plan = state.spacing && state.spacing[ac.id];
    const slot = seqSlot(state, ac.id);
    const rot = state.rots[ac.rot];
    // Folgenummer bzw. Symbol der Bucht
    const numB = num ? `<span class="c-num" style="background:${col}">${num}</span>` : `<span class="c-num off">${g === 'q' ? '·' : g === 'air' ? '↗' : '⌂'}</span>`;
    // Rufzeichen, darunter Muster/Kategorie und Sondercodes
    const tags = `${ac.emergency ? ' <b class="bad">7700</b>' : ''}${ac.nordo ? T(' <b class="bad" title="Funkausfall – nur Lichtsignale">7600</b>') : ''}${ac.protocol ? T(' <b class="proto" title="Staatsbesuch – Protokoll: ohne Warteschleife landen, pünktlich abfliegen">🎖️</b>') : ''}`;
    const cs = `<b class="fs-l1">${flagButton(ac)}${esc(ac.cs)}</b><small class="fs-l2">${typeCode(ac.type)}/${wakeTag(t.wake)}${tags}</small>`;
    // Strecke und Lage
    const city = rot ? rot.city : '';
    const route = land ? `${esc(city)}→${AIRPORT.code}` : `${AIRPORT.code}→${esc(city)}`;
    const sidTag = dep && ac.sid ? T` <span class="sid sid-${ac.sid}" title="Abflugroute ${ac.sid} (${SIDS[ac.sid]}) – gleiche Route braucht 100 s Abstand statt 75 s">${ac.sid}</span>` : '';
    let where = '';
    if (ac.mode === 'air' && land) where = `${String(Math.round(ac.alt / 100)).padStart(3, '0')}${ac.tAlt > ac.alt + 150 ? '↑' : ac.tAlt < ac.alt - 150 ? '↓' : ''} ${Math.round(ac.spd)}kt`;
    else where = PHASE_DE[ac.phase] || ac.phase;
    if (ac.phase === PH.HOLD && ac.holdFix) where = T`Schleife ${ac.holdFix.name} ${fmtAlt(ac.tAlt)}`;
    if (ac.holdPos) where += T(' · HALT');
    const mid = `<span class="fs-l1">${route}${sidTag}</span><small class="fs-l2">${esc(where)}</small>`;
    // Piste und Zeit (Anflug: Platz in der Folge bzw. Entfernung, Abflug: Startfenster bzw. TOBT, Boden: Position)
    const rwy = rwyName(state, land ? ac.strip || 'N' : 'N');
    let time = '';
    if (inSeq && slot != null && land) time = slot <= 30 ? T('jetzt') : `${Math.round(slot / 60)}′`;
    else if (land && ac.mode === 'air') time = `${distToLand(ac).toFixed(0)}NM`;
    else if (dep && inSeq && plan && plan.slot > 20 && ![PH.LINED, PH.TAKEOFF].includes(ac.phase)) time = `+${mmss(plan.slot)}`;
    else if (dep && rot && rot.tobt && [PH.STAND, PH.PUSH].includes(ac.phase)) time = fmtClock(rot.ctot || rot.tsat || rot.tobt);
    else if (ac.stand) time = `P${ac.stand}`;
    const rt = `<b class="fs-l1">${rwy}</b><small class="fs-l2">${time}</small>`;
    // Freigabe-Kästchen
    const tk = ticks(ac, land).map(([k, on, due]) => `<i class="${on ? 'on' : due ? 'due' : ''}" title="${TICK_TITLE[k]}">${on ? '✓' : k}</i>`).join('');
    // Anfrage, Staffelungshinweis und Hauptbefehl
    const rq = ac.wxReq ? T`<span class="rq wx">⛈️ Umweg ${ac.wxReq.deg}° ${ac.wxReq.side === 'left' ? T('links') : T('rechts')}</span>` : ac.nordo ? T`<span class="rq nordo">📻✖ ${ac.clr.land ? T('Landung per Licht frei') : ac.mode === 'air' ? T('grünes Licht zum Landen') : T('Lichtsignal zum Rollen')}</span>` : ac.req ? `<span class="rq">${REQ_DE[ac.req] || ac.req}</span>` : '';
    // Staffelungshinweis nur, wenn eine Anfrage ansteht oder der Streifen ausgewählt ist (sonst steht die Zeit rechts)
    let sp = '';
    if (plan && inSeq && (ac.req || sel)) {
      if (land && ac.mode === 'air' && ac.autoSpd && ac.spdOverride) sp = T`<span class="spc">Staffelung ${ac.spdOverride} kt${plan.delay > 20 ? ` · +${mmss(plan.delay)}` : ''}</span>`;
      else if (dep && plan.slot > 20 && ![PH.LINED, PH.TAKEOFF].includes(ac.phase)) sp = T`<span class="spc">Startfenster in ${mmss(plan.slot)}</span>`;
      else if (dep && [PH.HOLDING, PH.LINED, PH.LINEUP].includes(ac.phase)) sp = T('<span class="spc ok">Startfenster offen</span>');
    }
    if (ac.spacingHold && ac.phase === PH.HOLD) sp = T('<span class="spc">Schleife für die Reihenfolge</span>');
    let btns = '';
    if (!sel && ac.req) {
      const k = primaryCommand(state, ac);
      if (k) btns = `<button class="cmd big" data-cmd="${k}" data-ac="${ac.id}">${CMDS[k].label}${CMDS[k].key ? ` <kbd>${CMDS[k].key}</kbd>` : ''}</button>`;
      else if ((ac.req === 'taxi_in' || ac.req === 'cross') && !ac.stand) btns = T`<span class="cmd big wait" title="Das Vorfeld hat noch keine Parkposition zugewiesen">${icon('hourglass')} wartet auf Parkposition</span>`;
      else if (ac.req === 'approach') btns = T`<span class="cmd big wait" title="Die Auto-Staffelung gibt Anflüge in der Reihenfolge der Warteliste frei. Vorziehen: Streifen in die Pistenfolge ziehen.">🕒 Auto-Staffelung gibt frei</span>`;
      else if (ac.req === 'takeoff') {
        const w = departureWait(state, ac);
        btns = T`<span class="cmd big wait" title="Startfreigabe erst, wenn die Piste sicher frei bleibt – über den ausgewählten Streifen oder T geht es trotzdem">${icon('hourglass')} ${esc(w.why)} · ~${mmss(w.sec)}</span>`;
      }
    }
    if (ac.wxReq) {
      const left = Math.max(0, 1 - ac.wxReq.age / WX_WINDOW);
      btns = T`<button class="cmd big wxok" data-cmd="wxOk" data-ac="${ac.id}" title="Ausweichkurs um die Gewitterzelle genehmigen">⛈️ Umweg genehmigen <kbd>Y</kbd><i style="--p:${left}"></i></button><button class="cmd wxno" data-cmd="wxNo" data-ac="${ac.id}" title="Ablehnen (Verkehr): das Flugzeug fliegt durch die Zelle – Turbulenz">Ablehnen</button>`;
    }
    if (ac.rbErr && ac.rbErr.age >= rbHintDelay(state)) btns = T`<button class="cmd big rbfix" data-rbfix="${ac.id}" title="Pilot hat falsch zurückgelesen: „${esc(ac.rbErr.wrong)}“">⚠ Readback falsch – korrigieren <kbd>Q</kbd><i style="--p:${Math.max(0, ac.rbErr.left / RB_WINDOW)}"></i></button>`;
    const act = rq || btns || sp ? `${rq}${sp}${fuelChip(ac)}${btns}` : fuelChip(ac) && land && ac.mode === 'air' ? fuelChip(ac) : '';
    // ausgewählt: alle Daten und Befehle
    let ext = '';
    if (sel) {
      const parts = [];
      if (rot && land && ac.mode === 'air') parts.push(`STA ${fmtClock(rot.sta)}`);
      if (rot && dep) parts.push(`STD ${fmtClock(rot.std)}`);
      if (ac.squawk) parts.push(`SSR ${ac.squawk}`);
      if (rot) parts.push(esc(acRoute(state, ac, true)));
      if (ac.stand) parts.push(T`Position ${ac.stand}`);
      if (land && ac.mode === 'air') parts.push(T`${distToLand(ac).toFixed(1)} NM bis zur Schwelle`);
      let b = cmdButtons(state, ac, false, true);
      if (inSeq) b += T`<span class="c-mv"><button class="mini" data-seqmv="-1" data-ac="${ac.id}" title="in der Pistenfolge früher (W)">▲ früher</button><button class="mini" data-seqmv="1" data-ac="${ac.id}" title="in der Pistenfolge später (S)">später ▼</button></span>`;
      ext = `<div class="c-x">${parts.join(' · ')}</div>${dep ? acdmLine(state, ac) : ''}<div class="c-btns">${b}</div>`;
    }
    const kind = dep ? 'k-dep' : 'k-arr';
    const clr = inSeq && (land ? ac.clr.land : ac.clr.takeoff) ? ' k-clr' : '';
    return {
      cls: `fcard ${kind}${clr} g-${g}${sel ? ' active' : ''}${ac.req || ac.wxReq ? ' req' : ''}${ac.wxReq ? ' wxreq' : ''}${ac.emergency || ac.nordo ? ' emg' : ''}${ac.conflict ? ' conf' : ''}${ac.wakeWarn ? ' conf' : ''}${ac.rbErr && ac.rbErr.age >= rbHintDelay(state) ? ' rberr' : ''}`,
      wrap: (inner) => `<div class="c-bar"></div>${inner}`,
      parts: { 'fs-num': numB, 'fs-cs': cs, 'fs-mid': mid, 'fs-rt': rt, 'fs-tk': tk, 'fs-act': act, 'fs-ext': ext },
    };
  }

  // Trenner innerhalb einer Bucht
  sep(key, label, n) {
    return { key, r: { cls: 'fsep', html: `<span>${label}</span>${n ? `<b>${n}</b>` : ''}` } };
  }

  update(state) {
    setHTML(this.el.rwy, runwayStatusHtml(state));
    // Minikarte im Panel so hoch, dass unter ihr noch der Funk Platz hat (das Radar bleibt unverändert)
    const mmSlot = this.root.querySelector('#tw-mm-slot');
    if (mmSlot && mmSlot.offsetParent) {
      const room = Math.round(Math.max(80, Math.min(170, this.root.clientHeight - mmSlot.offsetTop - 120 - 46)));
      if (mmSlot.dataset.h !== String(room)) {
        mmSlot.dataset.h = room;
        mmSlot.style.setProperty('--mm-max-h', room + 'px');
      }
    }
    updateSequence(state);
    updateArrQueue(state);
    const byId = new Map(state.acs.map((a) => [a.id, a]));
    const seq = state.seq.map((id) => byId.get(id)).filter(Boolean);
    const num = new Map(seq.map((a, i) => [a.id, i + 1]));
    const f = this.filter;
    const show = (a) => f === 'both' || (f === 'dep') === isDepStrip(a);
    // Buchten: Luft (Anflüge vor der Freigabe, oben die nächste; darunter gerade gestartete), Pistenfolge,
    // Rollen (gelandete Anflüge), Vorfeld (Pushback-Anfragen und Pushback)
    const queue = [...state.acs.filter((a) => a.arr && a.mode === 'air' && [PH.GOAROUND, PH.MISSED].includes(a.phase)), ...state.arrQ.map((id) => byId.get(id)).filter(Boolean)];
    const air = state.acs.filter((a) => !num.has(a.id) && ((a.phase === PH.DEPART && Math.hypot(a.pos.x, a.pos.y) < 10) || (a.phase === PH.TAKEOFF && a.z > 0.5)));
    const arrGnd = state.acs.filter((a) => a.arr && a.mode === 'map' && ARR_GND.has(a.phase) && !num.has(a.id)).sort((a, b) => (b.req ? 1 : 0) - (a.req ? 1 : 0));
    const apron = state.acs.filter((a) => !num.has(a.id) && ((a.phase === PH.STAND && a.req === 'push') || DEP_APRON.has(a.phase))).sort((a, b) => (a.reqT || 0) - (b.reqT || 0));
    const groups = {
      air: [['q', queue.filter(show), state.settings.autoSpacing !== false ? T('Warteliste · Freigabe automatisch') : T('ohne Anflugfreigabe')], ['air', air.filter(show), T('gestartet')]],
      rwy: [['seq', seq.filter(show), '']],
      taxi: [['gnd', arrGnd.filter(show), '']],
      apron: [['apron', apron.filter(show), '']],
    };
    const items = {};
    for (const b of BAYS) {
      const list = [];
      const gs = groups[b];
      for (const [g, arr, label] of gs) {
        if (!arr.length) continue;
        if (label && gs.length > 1) list.push(this.sep(`s-${g}`, label, arr.length));
        for (const a of arr) list.push({ key: a.id, a, g });
      }
      items[b] = list;
      syncList(this.bay[b], list, (it) => it.key, (it) => it.r || this.card(state, it.a, it.g, it.g === 'seq' ? num.get(it.a.id) : 0));
      for (const el of this.bay[b].children) {
        const it = list.find((x) => x.key === el.dataset.key);
        if (!it || !it.a) continue;
        if (el.dataset.g !== it.g) el.dataset.g = it.g;
        const dr = it.g === 'seq' || it.g === 'q';
        if (el.draggable !== dr) el.draggable = dr;
      }
      const strips = list.filter((x) => x.a);
      if (!strips.length && !this.bay[b].querySelector('.empty')) this.bay[b].innerHTML = `<div class="empty">${EMPTY[b]()}</div>`;
      const rq = strips.filter((x) => x.a.req || x.a.wxReq).length;
      const c = this.rail.querySelector(`#rl-c-${b}`);
      setHTML(c, `${strips.length}${rq ? ` · ${rq}!` : ''}`);
      c.classList.toggle('warn', rq > 0);
    }
    // Breite der Buchten nach Inhalt: die Pistenfolge bekommt etwas mehr, leere Buchten werden schmal
    const sel = this.game.ui.selected;
    const w = BAYS.map((b) => {
      const n = items[b].filter((i) => i.a).length;
      return Math.max(0.55, Math.min(2.2, (n ? 0.8 + n * 0.12 : 0.55) + (b === 'rwy' ? 0.35 : 0) + (items[b].some((i) => i.a && i.a.id === sel) ? 0.35 : 0)));
    });
    const cols = w.map((x) => `minmax(0, ${x.toFixed(2)}fr)`).join(' ');
    if (this.el.bays.style.gridTemplateColumns !== cols) this.el.bays.style.gridTemplateColumns = cols;
    for (const b of this.rail.querySelectorAll('#rl-filter [data-f]')) b.classList.toggle('on', b.dataset.f === f);
    this.rail.querySelector('#rl-spacing .switch').classList.toggle('on', state.settings.autoSpacing !== false);
    this.rail.querySelector('#rl-gauto .switch').classList.toggle('on', !!state.settings.towerGroundAuto);
    setHTML(this.rail.querySelector('#rl-sort'), state.seqManual || state.arrQManual ? T('<button class="mini" data-seqsort title="Reihenfolge wieder automatisch planen">⇅ manuell sortiert – zurücksetzen</button>') : T('<small class="rl-auto">Reihenfolge automatisch</small>'));
  }

  // Tastenkürzel für das ausgewählte Flugzeug
  key(e, state) {
    const id = this.game.ui.selected;
    const ac = id && state.acs.find((a) => a.id === id);
    if (!ac) return false;
    const k = e.key.toUpperCase();
    if ((k === 'W' || k === 'S') && seqIndex(state, ac.id)) {
      if (seqMove(state, ac.id, k === 'W' ? -1 : 1)) sfx.click();
      else if (state.seqErr) toast(state.seqErr, 'warn', 2600);
      this.update(state);
      return true;
    }
    for (const key of validCommands(state, ac)) {
      if (CMDS[key].key === k) {
        const early = earlyWarning(state, ac, key);
        const r = guardedCommand(state, ac, key);
        if (r.held) return true;
        if (!r.ok) toast(r.msg, 'warn');
        else {
          sfx.click();
          if (early) toast(early, 'warn', 3500);
        }
        return true;
      }
    }
    return false;
  }
}
