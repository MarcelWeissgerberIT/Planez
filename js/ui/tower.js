// Tower-Arbeitsplatz: Flugstreifen & Befehle
import { CMDS, command, validCommands, tailwind, preferredRunway, requestRunwayChange, drainCount, primaryCommand, departureWait, clearanceRisk } from '../sim/atc.js';
import { correctReadback, RB_WINDOW, RB_HINT } from '../sim/readback.js';
import { SIDS } from '../sim/sid.js';
import { WX_WINDOW } from '../sim/wxdev.js';
import { inspState, inspConflict, approveInspection, deferInspection, INSP_MIN } from '../sim/inspect.js';
import { heliConflict, approveHeli, holdHeli } from '../sim/heli.js';
import { vfrConflict, clearVfr, extendVfr } from '../sim/vfr.js';
import { PH, PHASE_DE, runwayOccupants, fmtAlt } from '../sim/aircraft.js';
import * as AS from '../sim/airspace.js';
import { AC_TYPES, CITIES, AIRPORT } from '../config.js';
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

const WAKE_KEY = { L: 'Light', M: 'Medium', H: 'Heavy' };
export const wakeTag = (w) => glTag(WAKE_KEY[w] || 'WTC', w);

// Treibstoffreserve eines Anflugs (Minuten)
export function fuelChip(ac) {
  if (!ac.arr || ac.fuelMin === undefined || ac.mode !== 'air' || ac.phase === PH.DEPART) return '';
  const m = Math.max(0, Math.round(ac.fuelMin));
  const cls = ac.fuelEmergency || m <= 5 ? 'bad' : ac.minFuel || m <= 12 ? 'warn' : '';
  return ` <span class="fuelc ${cls}" title="Treibstoffreserve">⛽ ${m}′${ac.fuelEmergency ? ' MAYDAY FUEL' : ac.minFuel ? ' MINFUEL' : ''}</span>`;
}

// Statusblock der Pisten (Betriebsrichtung, Belegung, Zustand, Sperrung, Betriebsart)
export function runwayStatusHtml(state) {
  const tw = tailwind(state, state.rwy);
  const pref = preferredRunway(state);
  const other = state.rwy === '27' ? '09' : '27';
  let h = `<div>Betriebsrichtung <b style="font-family:var(--mono)">${state.rwy}</b> · Wind ${Math.round(state.wind.dir / 10) * 10}°/${Math.round(state.wind.spd)} kt <small style="color:var(--muted)">(${tw > 0 ? 'Rückenwind' : 'Gegenwind'} ${Math.abs(tw).toFixed(0)} kt)</small></div>`;
  if (state.rwyPending) h += `<button class="cmd" data-rwy="${state.rwy}">Abbrechen</button><div style="color:var(--warn)">Wechsel auf ${state.rwyPending} ausstehend – ${drainCount(state)} Bewegungen laufen noch</div><div></div>`;
  else h += `<button class="cmd ${pref !== state.rwy ? 'big' : ''}" data-rwy="${other}" title="${pref !== state.rwy ? 'Rückenwind – Wechsel empfohlen' : 'Betriebsrichtung wechseln'}">→ ${other}</button>`;
  for (const strip of hasRwy2(state) ? ['N', 'S'] : ['N']) {
    const occ = runwayOccupants(state, strip);
    const ba = brakingAction(state, strip);
    const closed = runwayClosed(state, strip);
    const cond = Math.round(rwyCond(state, strip));
    const role = !hasRwy2(state) ? '' : segregated(state) ? (strip === 'N' ? ' · Starts' : ' · Landungen') : strip === 'N' ? ' · Starts & Landungen' : ' · Reserve';
    h += `<div class="rwy-line"><b class="rwy-id">${rwyName(state, strip)}</b>${role} · ${closed ? `<span class="state busy">⛔ ${esc(closed)}</span>` : occ.length ? `<span class="state busy">belegt · ${occ.map((a) => esc(a.cs)).join(', ')}</span>` : '<span class="state free">frei</span>'}<div class="rwy-cond">Zustand <b>${cond} %</b> · Bremswirkung <b class="ba-${ba}">${BRAKE_DE[ba]}</b>${isWet(state) ? ' (nass)' : ''}${state.rwySnow && state.rwySnow[strip] > 0.04 ? ` · ❄️ Schnee <b>${Math.round(state.rwySnow[strip] * 100)} %</b>${state.plow && state.plow.strip === strip ? ' – Räumdienst' : state.rwySnow[strip] > 0.25 ? ' – Räumung bald' : ''}` : ''}</div></div><div></div>`;
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
    h += `<div class="emg-cl"><b>🚨 Notfall ${esc(em.cs)}${em.fuelEmergency ? ' · Treibstoff' : em.emgKind === 'medical' ? ' · medizinisch' : ''}</b><ul>
      ${it(fire || em.emgKind === 'medical' || em.fuelEmergency, em.emgKind === 'medical' ? 'Rettungsdienst bestellt' : 'Feuerwehr alarmiert')}
      ${it(app, 'Direktanflug freigeben <kbd>D</kbd>')}
      ${it(near && !depClr, depClr ? `Startfreigabe ${esc(depClr.cs)} zurückhalten` : 'Keine Starts vor der Notlandung', !!depClr)}
      ${it(em.clr.land, 'Landefreigabe <kbd>L</kbd>')}
      ${it(landed, em.emgKind === 'medical' ? 'Gelandet – Rettungswagen am Flugzeug' : 'Gelandet – Feuerwehr am Flugzeug')}
    </ul></div><div></div>`;
  }
  // Pistenkontrolle: Anfrage mit Lücken-Check, laufende Kontrolle
  const I = state.insp;
  if (I && I.req && !state.auto.atc && !state.settings.inspAuto) {
    const c = inspConflict(state);
    const wait = Math.max(0, Math.round((state.time - I.req.t) / 60));
    h += `<div class="insp-rq${c ? (c.hard ? ' hard' : ' soft') : ' ok'}">🚙 <b>Pistenkontrolle</b> bittet, Bahn ${rwyName(state, 'N')} abzufahren (${INSP_MIN} min)${wait ? ` · wartet seit ${wait} min` : ''}<small>${c ? `⚠ ${esc(c.ac.cs)} ${esc(c.why)}` : '✓ Lücke – jetzt freigeben'}</small></div><div class="insp-b"><button class="cmd ${c ? '' : 'big'}" data-insp="ok">Freigeben</button><button class="cmd" data-insp="later">Später</button></div>`;
  } else if (I && I.active) {
    const left = Math.max(0, I.active.until - state.time);
    h += `<div class="insp-rq act">🚙 Pistenkontrolle auf Bahn ${rwyName(state, 'N')} – noch ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}</div><div></div>`;
  }
  // Rettungshubschrauber: Querungsanfrage mit Lücken-Check
  const HH = state.heli && state.heli.h;
  if (HH && HH.st === 'req' && !state.auto.atc && !state.settings.inspAuto) {
    const c = heliConflict(state);
    const wait = Math.max(0, Math.round((state.time - HH.t) / 60));
    h += `<div class="insp-rq heli${c ? (c.hard ? ' hard' : ' soft') : ' ok'}">🚁 <b>Rescue 7</b> bittet, die Bahnen in der Mitte zu queren${wait ? ` · wartet seit ${wait} min` : ''}<small>${c ? `⚠ ${esc(c.ac.cs)} ${esc(c.why)}` : '✓ frei – jetzt queren lassen'}</small></div><div class="insp-b"><button class="cmd ${c && c.hard ? '' : 'big'}" data-heli="ok" title="Taste Y">Querung frei</button>${HH.told ? '' : '<button class="cmd" data-heli="hold">Warten</button>'}</div>`;
  } else if (HH && HH.st === 'cross' && HH.y > 26) h += `<div class="insp-rq act heli">🚁 Rescue 7 quert die Bahnen</div><div></div>`;
  // Platzrunden: Touch-and-Go-Anfrage mit Lücken-Check
  const VP = state.vfr && state.vfr.p;
  if (VP && VP.req && !VP.clr && !state.auto.atc && !state.settings.inspAuto) {
    const c = vfrConflict(state);
    h += `<div class="insp-rq vfr${c ? (c.hard ? ' hard' : ' soft') : ' ok'}">🛩️ <b>${esc(VP.cs)}</b> (Cessna, Platzrunde) bittet um Touch and Go${VP.mode === 'orbit' ? ' · fliegt Vollkreis' : ''}<small>${c ? `⚠ ${esc(c.ac.cs)} ${esc(c.why)}` : '✓ Lücke – jetzt freigeben'}</small></div><div class="insp-b"><button class="cmd ${c && c.hard ? '' : 'big'}" data-vfr="ok" title="Taste Y">Touch & Go</button>${VP.told || VP.mode === 'orbit' ? '' : '<button class="cmd" data-vfr="ext">Vollkreis</button>'}</div>`;
  }
  // Assistenz: Wetterumwege und Pistenkontrollen dem Kollegen überlassen
  if (!state.auto.atc) h += `<div class="rwy-assist"><span>Assistenz</span><button class="rl-tg" data-assist="wxAuto" title="Umweg-Anfragen bei Gewitter automatisch genehmigen (ohne Punkte)"><span class="switch ${state.settings.wxAuto ? 'on' : ''}"></span>Umwege auto</button><button class="rl-tg" data-assist="inspAuto" title="Pistenkontrollen, Hubschrauber-Querungen und Touch-and-Go der Platzrunden in ruhigen Phasen automatisch freigeben (ohne Punkte)"><span class="switch ${state.settings.inspAuto ? 'on' : ''}"></span>Nebenverkehr auto</button></div>`;
  if (hasRwy2(state)) h += `<div class="rwy-cond">Betriebsart: <b>${segregated(state) ? 'getrennt (Landungen Süd, Starts Nord)' : 'eine Bahn (alles auf der Nordbahn)'}</b></div><button class="cmd" data-rwymode="${segregated(state) ? 'single' : 'seg'}">${segregated(state) ? '→ eine Bahn' : '→ getrennt'}</button>`;
  h += `<div class="rwy-cond">${temperature(state).toFixed(0)} °C · ${state.weather.kind === 'fog' ? `RVR <b>${state.weather.rvr ?? '—'} m</b> · LVP · ` : ''}${isNight(state) ? `${icon('moon')} Nacht${state.settings.curfew ? 'flugverbot' : ''}` : `${icon('sun')} Tagbetrieb`}</div>${qm('rwy')}`;
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

// Farben der Pistenfolge (auch Radar/Karte)
export const SEQ_COL = { land: '#22d3ee', landClr: '#a5f3fc', dep: '#f59e0b', depClr: '#e879f9' };
export function seqColor(ac) {
  if (isSeqArrival(ac)) return ac.clr.land ? SEQ_COL.landClr : SEQ_COL.land;
  return ac.clr.takeoff ? SEQ_COL.depClr : SEQ_COL.dep;
}

export const REQ_DE = {
  approach: 'wartet auf Anflugfreigabe',
  land: 'bittet um Landefreigabe',
  taxi_in: 'bittet um Rollfreigabe',
  push: 'bittet um Pushback',
  taxi_out: 'bittet um Rollfreigabe',
  takeoff: 'startbereit',
  cross: 'bittet um Kreuzen der Startbahn',
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

export function acRoute(state, ac) {
  const rot = state.rots[ac.rot];
  if (!rot) return '';
  const city = CITIES[rot.city]?.name || rot.city;
  return ac.arr && ac.phase !== PH.STAND && !['PUSHBACK', 'STARTUP', 'TAXI_OUT', 'HOLDING', 'LINEUP', 'LINED_UP', 'TAKEOFF', 'DEPARTURE'].includes(ac.phase) ? `${city} → ${AIRPORT.code}` : `${AIRPORT.code} → ${city}`;
}

// Hauptbefehl je Anfrage (für die kleinen Karten)
const Q_PH = new Set([PH.INBOUND, PH.HOLD, PH.GOAROUND, PH.MISSED]);
const ARR_GND = new Set([PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN]);
const DEP_APRON = new Set([PH.PUSH]);
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
      toast(`⚠ ${ac.cs}: ${risk}. Nochmal drücken, um trotzdem freizugeben.`, 'bad', 4000);
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
  return w.sec > 0 && w.why.startsWith('Landung') ? `⚠ ${ac.cs}: ${w.why} – die Landung muss womöglich durchstarten` : null;
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
    toast('👂 Kein falscher Readback offen – alle Rücklesungen stimmen', 'info', 2200);
    return false;
  }
  const r = correctReadback(s, target);
  if (r.ok) {
    sfx.click();
    toast(r.quick ? `👂 Gut aufgepasst! ${target.cs} korrigiert` : `✔ ${target.cs}: Readback korrigiert`, 'good', 2400);
  }
  return r.ok;
}

export class TowerPanel {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    root.classList.add('tw-side');
    root.innerHTML = `
      <div class="p-head">
        <div class="p-title">${icon('headset')} Tower <small>${AIRPORT.tower} ${AIRPORT.freq}</small></div>
        <button class="mini" id="tw-rwy-t" title="Pistenstatus ein-/ausklappen">Pisten ▾</button>
      </div>
      <div class="tw-radar-slot" id="tw-radar-slot"></div>
      <div class="rwy-box tw-rwy" id="tw-rwy"></div>
      <div class="tw-log-slot" id="tw-log-slot"></div>`;
    // Radar und Funk in das Fenster holen (beim Rollenwechsel zurück)
    this.moved = [];
    this.dock($('#radar-wrap'), root.querySelector('#tw-radar-slot'));
    this.dock($('#log-wrap'), root.querySelector('#tw-log-slot'));
    $('#log-wrap').classList.remove('min');
    $('#log-toggle').textContent = '–';
    root.querySelector('#tw-rwy-t').addEventListener('click', () => {
      const r = root.querySelector('#tw-rwy');
      r.classList.toggle('closed');
      root.querySelector('#tw-rwy-t').textContent = r.classList.contains('closed') ? 'Pisten ▸' : 'Pisten ▾';
    });
    root.addEventListener('click', (e) => this.onClick(e));

    // Flugstreifen-Leiste unten
    const rail = document.createElement('section');
    rail.id = 'rail';
    rail.innerHTML = `
      <div class="rail-head">
        <div class="rail-title">${icon('plane')} Flugstreifen${qm('seq')}</div>
        <div class="seg" id="rl-filter" title="Filter: nur Landungen, beide oder nur Starts"><button data-f="arr">${icon('land')} An</button><button data-f="both">Beide</button><button data-f="dep">${icon('takeoff')} Ab</button></div>
        <button class="rl-tg" id="rl-spacing" title="Reihenfolge per Drag &amp; Drop – Anflugfreigaben, Geschwindigkeit und Lücken für Starts passen sich automatisch an"><span class="switch"></span>Auto-Staffelung</button>
        <button class="rl-tg" id="rl-gauto" title="Rollverkehr (Pushback, Rollen, Kreuzen) automatisch – du kümmerst dich nur um Luftraum und Piste"><span class="switch"></span>Rollverkehr auto</button>
        <span id="rl-sort"></span>
        <span class="rl-legend"><span><i style="background:${SEQ_COL.land}"></i>Landung</span><span><i style="background:${SEQ_COL.landClr}"></i>frei</span><span><i style="background:${SEQ_COL.dep}"></i>Start</span><span><i style="background:${SEQ_COL.depClr}"></i>frei</span></span>
        <button class="mini" id="rl-min" title="Leiste verkleinern">▾</button>
      </div>
      <div class="rail-lanes" id="rl-lanes">
        <div class="lane" data-lane="arr"><div class="lane-h"><span>${icon('land')} Landungen</span><span class="cnt" id="rl-c-arr">0</span><small>links = zuerst · ziehen zum Umsortieren</small></div><div class="lane-cards" id="rl-arr"></div></div>
        <div class="lane" data-lane="dep"><div class="lane-h"><span>${icon('takeoff')} Starts</span><span class="cnt" id="rl-c-dep">0</span><small>links = zuerst</small></div><div class="lane-cards" id="rl-dep"></div></div>
      </div>`;
    $('#game').appendChild(rail);
    this.rail = rail;
    this.el = { rwy: root.querySelector('#tw-rwy'), arr: rail.querySelector('#rl-arr'), dep: rail.querySelector('#rl-dep'), lanes: rail.querySelector('#rl-lanes') };
    rail.addEventListener('click', (e) => this.onClick(e));
    rail.addEventListener('pointerdown', () => (this.game.panelHold = true));
    rail.addEventListener('wheel', (e) => {
      // Mausrad scrollt die Kartenreihe waagerecht
      const lane = e.target.closest('.lane-cards');
      if (lane && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        lane.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    this.wireDrag(this.el.arr, 'arr');
    this.wireDrag(this.el.dep, 'dep');
    document.getElementById('game').classList.add('tw-layout');
    this.game.resize && this.game.resize();
  }

  dock(el, slot) {
    if (!el || !slot) return;
    this.moved.push([el, el.parentNode, el.nextSibling]);
    slot.appendChild(el);
  }

  // Rollenwechsel: Radar/Funk zurück, Leiste entfernen
  destroy() {
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
      toast(k === 'wxAuto' ? (s.settings[k] ? '⛈️ Umweg-Anfragen genehmigt jetzt der Kollege' : '⛈️ Umweg-Anfragen wieder selbst beantworten') : s.settings[k] ? '🚙🚁🛩️ Pistenkontrollen, Heli-Querungen und Platzrunden übernimmt jetzt der Kollege' : '🚙🚁🛩️ Nebenverkehr wieder selbst freigeben', 'info', 2600);
      this.update(s);
      return;
    }
    const vb = e.target.closest('[data-vfr]');
    if (vb) {
      const r = vb.dataset.vfr === 'ok' ? clearVfr(s) : extendVfr(s);
      if (r.ok) sfx.click();
      if (r.bad) toast(`⚠ Touch and Go in den Linienverkehr – ${r.c.ac.cs} ${r.c.why}`, 'bad', 3200);
      else if (vb.dataset.vfr === 'ok' && r.ok) toast(r.soft ? `🛩️ Freigegeben – ${r.soft.ac.cs} ist ${r.soft.why}, das wird knapp` : '🛩️ Touch and Go freigegeben', r.soft ? 'warn' : 'good', 2200);
      this.update(s);
      return;
    }
    const hb = e.target.closest('[data-heli]');
    if (hb) {
      const r = hb.dataset.heli === 'ok' ? approveHeli(s) : holdHeli(s);
      if (r.ok) sfx.click();
      if (r.bad) toast('⚠ Verkehrskonflikt – Hubschrauber quert vor Verkehr!', 'bad', 3500);
      else if (hb.dataset.heli === 'ok' && r.ok) toast(r.soft ? `🚁 Querung frei – ${r.soft.ac.cs} ist ${r.soft.why}, der Heli muss sich beeilen` : '🚁 Rescue 7 quert', r.soft ? 'warn' : 'good', 2400);
      this.update(s);
      return;
    }
    const ib = e.target.closest('[data-insp]');
    if (ib) {
      const r = ib.dataset.insp === 'ok' ? approveInspection(s) : deferInspection(s);
      if (r.ok) sfx.click();
      if (r.bad) toast('⚠ Pistenbetretung – Verkehr auf/vor der Bahn!', 'bad', 3500);
      else if (r.soft) toast(`🚙 Kontrolle auf der Bahn – ${r.soft.ac.cs} wird durchstarten müssen`, 'warn', 3000);
      else if (ib.dataset.insp === 'ok' && r.ok) toast('🚙 Pistenkontrolle freigegeben', 'good', 2000);
      this.update(s);
      return;
    }
    const rm = e.target.closest('[data-rwymode]');
    if (rm) {
      s.rwyMode = rm.dataset.rwymode;
      toast(s.rwyMode === 'seg' ? 'Getrennter Betrieb: neue Anflüge auf die Südbahn' : 'Alle Bewegungen auf der Nordbahn', 'info');
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
      toast('Reihenfolge wird wieder automatisch geplant', 'info', 2200);
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
      toast(s.settings.autoSpacing ? 'Auto-Staffelung an: Reihenfolge per Drag & Drop, Tempo und Anflugfreigaben laufen automatisch' : 'Auto-Staffelung aus: Anflugfreigaben und Geschwindigkeiten gibst du selbst', 'info', 3200);
      this.update(s);
      return;
    }
    if (e.target.closest('#rl-gauto')) {
      s.settings.towerGroundAuto = !s.settings.towerGroundAuto;
      toast(s.settings.towerGroundAuto ? 'Rollverkehr läuft automatisch' : 'Rollverkehr wieder manuell', 'info');
      this.update(s);
      return;
    }
    if (e.target.closest('#rl-min')) {
      this.rail.classList.toggle('min');
      document.getElementById('game').classList.toggle('rail-min', this.rail.classList.contains('min'));
      e.target.closest('#rl-min').textContent = this.rail.classList.contains('min') ? '▴' : '▾';
      return;
    }
    const card = e.target.closest('.fcard');
    if (card) this.game.select(card.dataset.key, true);
  }

  // Drag & Drop: Reihenfolge der Landungen bzw. Starts
  wireDrag(box, lane) {
    let drag = null;
    const clear = () => box.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
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
      const c = e.target.closest('.fcard');
      if (!c || !['seq', 'q'].includes(c.dataset.g)) return;
      e.preventDefault();
      clear();
      const r = c.getBoundingClientRect();
      c.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
    });
    box.addEventListener('drop', (e) => {
      if (!drag) return;
      const c = e.target.closest('.fcard');
      if (!c) return;
      e.preventDefault();
      this.drop(lane, drag, c.dataset.key, c.dataset.g, c.classList.contains('drop-after'));
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
      if (!after) return target;
      const i = s.seq.indexOf(target);
      const rest = s.seq.slice(i + 1).filter((x) => x !== drag.id);
      return rest[0] || null;
    };
    const qBefore = () => {
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
      msg = `${ac.cs} bekommt die Anflugfreigabe in dieser Reihenfolge`;
    } else if (lane === 'arr' && drag.g === 'q' && tg === 'seq') {
      // aus der Warteliste direkt in die Folge: Anflug freigeben und einsortieren
      const r = command(s, ac, 'approach');
      if (!r.ok) return toast(r.msg, 'warn');
      updateSequence(s);
      ok = seqMoveTo(s, drag.id, seqBefore()) || true;
      msg = `${ac.cs}: Anflug frei und in die Folge eingereiht`;
    } else if (lane === 'arr' && drag.g === 'seq' && tg === 'q') {
      if (!CMDS.hold.valid(s, ac)) return toast(`${ac.cs} ist schon im Endanflug – nicht mehr in die Warteschleife`, 'warn');
      command(s, ac, 'hold');
      updateArrQueue(s);
      arrQMoveTo(s, drag.id, qBefore());
      ok = true;
      msg = `${ac.cs} zurück in die Warteschleife`;
    }
    if (!ok) return;
    sfx.click();
    const auto = s.settings.autoSpacing !== false;
    toast(msg || (auto ? 'Reihenfolge geändert – Auto-Staffelung passt Tempo und Lücken an' : 'Reihenfolge geändert'), 'info', 2400);
  }

  // Eine Flugkarte (klein) bzw. die aktive Karte (groß mit allen Befehlen)
  card(state, ac, g, num, lane) {
    const t = AC_TYPES[ac.type];
    const sel = this.game.ui.selected === ac.id;
    const inSeq = g === 'seq';
    const land = lane === 'arr';
    const col = inSeq ? seqColor(ac) : land ? '#64748b' : '#64748b';
    const plan = state.spacing && state.spacing[ac.id];
    const slot = seqSlot(state, ac.id);
    // Kopfzeile
    let eta = '';
    if (inSeq && slot != null) eta = slot <= 30 ? 'jetzt' : `~${Math.round(slot / 60)} min`;
    else if (land && ac.mode === 'air') eta = `${distToLand(ac).toFixed(0)} NM`;
    else if (ac.stand) eta = `P${ac.stand}`;
    const numB = num ? `<span class="c-num" style="background:${col}">${num}</span>` : `<span class="c-num off">${g === 'q' ? '·' : g === 'gnd' || g === 'apron' ? '⌂' : '↗'}</span>`;
    const sidTag = lane === 'dep' && ac.sid ? ` <span class="sid sid-${ac.sid}" title="Abflugroute ${ac.sid} (${SIDS[ac.sid]}) – gleiche Route braucht 100 s Abstand statt 75 s">↗${ac.sid}</span>` : '';
    const top = `${numB}<span class="c-cs">${flagButton(ac)}${esc(ac.cs)}</span><small class="c-t">${ac.type}/${wakeTag(t.wake)}${ac.emergency ? ' · <b class="bad">7700</b>' : ''}${ac.nordo ? ' · <b class="bad" title="Funkausfall – nur Lichtsignale">7600</b>' : ''}${ac.protocol ? ' · <b class="proto" title="Staatsbesuch – Protokoll: ohne Warteschleife landen, pünktlich abfliegen">🎖️ STATE</b>' : ''}</small><span class="c-eta">${eta}</span>`;
    // Lage
    let where = '';
    if (ac.mode === 'air') where = `${String(Math.round(ac.alt / 100)).padStart(3, '0')}${ac.tAlt > ac.alt + 150 ? '↑' : ac.tAlt < ac.alt - 150 ? '↓' : ''} · ${Math.round(ac.spd)} kt`;
    else where = PHASE_DE[ac.phase] || ac.phase;
    if (ac.phase === PH.HOLD && ac.holdFix) where = `Schleife ${ac.holdFix.name} · ${fmtAlt(ac.tAlt)}`;
    const mid = `${esc(acRoute(state, ac))} · ${esc(where)}`;
    // Status + Staffelung
    let st = '';
    let stIco = '';
    if (inSeq) {
      st = land ? (ac.clr.land ? 'Landung frei' : 'Landung') : ac.clr.takeoff ? 'Start frei' : ac.clr.lineup ? 'Line up' : 'Start';
      stIco = icon(land ? 'land' : 'takeoff') + ' ';
    }
    else st = PHASE_DE[ac.phase] || '';
    if (ac.holdPos) st += ' · HALT';
    const rq = ac.wxReq ? `<span class="rq wx">⛈️ bittet um Umweg ${ac.wxReq.deg}° ${ac.wxReq.side === 'left' ? 'links' : 'rechts'} (Gewitter)</span>` : ac.nordo ? `<span class="rq nordo">📻✖ Funkausfall – ${ac.clr.land ? 'Landung per Licht frei' : ac.mode === 'air' ? 'grünes Licht zum Landen' : 'Lichtsignal zum Rollen'}</span>` : ac.req ? `<span class="rq">${REQ_DE[ac.req] || ac.req}</span>` : '';
    let sp = '';
    if (plan && inSeq) {
      if (land && ac.mode === 'air' && ac.autoSpd && ac.spdOverride) sp = `<span class="spc">Staffelung ${ac.spdOverride} kt${plan.delay > 20 ? ` · +${mmss(plan.delay)}` : ''}</span>`;
      else if (!land && plan.slot > 20 && ![PH.LINED, PH.TAKEOFF].includes(ac.phase)) sp = `<span class="spc">Startfenster in ${mmss(plan.slot)}</span>`;
      else if (!land && [PH.HOLDING, PH.LINED, PH.LINEUP].includes(ac.phase)) sp = '<span class="spc ok">Startfenster offen</span>';
    }
    if (ac.spacingHold && ac.phase === PH.HOLD) sp = '<span class="spc">Schleife für die Reihenfolge</span>';
    const state2 = `<b style="color:${inSeq ? col : '#cbd5e1'}">${stIco}${esc(st)}</b>${sidTag}${rq}${sp}${fuelChip(ac)}`;
    // Befehle: aktive Karte alle, sonst nur der passende Hauptbefehl
    let btns = '';
    if (sel) {
      btns = cmdButtons(state, ac, false, true);
      if (inSeq) btns += `<span class="c-mv"><button class="mini" data-seqmv="-1" data-ac="${ac.id}" title="in der Pistenfolge früher (W)">◀ früher</button><button class="mini" data-seqmv="1" data-ac="${ac.id}" title="in der Pistenfolge später (S)">später ▶</button></span>`;
    } else if (ac.req) {
      const k = primaryCommand(state, ac);
      if (k) btns = `<button class="cmd big" data-cmd="${k}" data-ac="${ac.id}">${CMDS[k].label}${CMDS[k].key ? ` <kbd>${CMDS[k].key}</kbd>` : ''}</button>`;
      else if ((ac.req === 'taxi_in' || ac.req === 'cross') && !ac.stand) btns = `<span class="cmd big wait" title="Das Vorfeld hat noch keine Parkposition zugewiesen">${icon('hourglass')} wartet auf Parkposition</span>`;
      else if (ac.req === 'approach') btns = `<span class="cmd big wait" title="Die Auto-Staffelung gibt Anflüge in der Reihenfolge der Warteliste frei. Vorziehen: Karte in die Pistenfolge ziehen.">🕒 Auto-Staffelung gibt frei</span>`;
      else if (ac.req === 'takeoff') {
        const w = departureWait(state, ac);
        btns = `<span class="cmd big wait" title="Startfreigabe erst, wenn die Piste sicher frei bleibt – über die aktive Karte oder T geht es trotzdem">${icon('hourglass')} ${esc(w.why)} · ~${mmss(w.sec)}</span>`;
      }
    }
    // Wetter-Umweg: genehmigen (Y) oder wegen Verkehr ablehnen – ohne Antwort weicht der Pilot selbst aus
    if (ac.wxReq) {
      const left = Math.max(0, 1 - ac.wxReq.age / WX_WINDOW);
      btns = `<button class="cmd big wxok" data-cmd="wxOk" data-ac="${ac.id}" title="Ausweichkurs um die Gewitterzelle genehmigen">⛈️ Umweg ${ac.wxReq.deg}° ${ac.wxReq.side === 'left' ? 'links' : 'rechts'} genehmigen <kbd>Y</kbd><i style="--p:${left}"></i></button><button class="cmd wxno" data-cmd="wxNo" data-ac="${ac.id}" title="Ablehnen (Verkehr): das Flugzeug fliegt durch die Zelle – Turbulenz">Ablehnen</button>` + (sel ? btns : '');
    }
    // falscher Readback: nach kurzer Zeit (Zeit zum Hinhören) Hinweis mit Korrektur-Knopf
    if (ac.rbErr && ac.rbErr.age >= rbHintDelay(state)) btns = `<button class="cmd big rbfix" data-rbfix="${ac.id}" title="Pilot hat falsch zurückgelesen: „${esc(ac.rbErr.wrong)}“">⚠ Readback falsch – korrigieren <kbd>Q</kbd><i style="--p:${Math.max(0, ac.rbErr.left / RB_WINDOW)}"></i></button>` + (sel ? btns : '');
    let extra = '';
    if (sel) {
      const rot = state.rots[ac.rot];
      const parts = [];
      if (rot && land && ac.mode === 'air') parts.push(`STA ${fmtClock(rot.sta)}`);
      if (rot && !land) parts.push(`STD ${fmtClock(rot.std)}`);
      if (ac.stand) parts.push(`Position ${ac.stand}`);
      if (land && ac.mode === 'air') parts.push(`${distToLand(ac).toFixed(1)} NM bis zur Schwelle`);
      if (ac.strip && hasRwy2(state)) parts.push(`Bahn ${rwyName(state, ac.strip)}`);
      extra = `<div class="c-x">${parts.join(' · ')}</div>${land ? '' : acdmLine(state, ac)}`;
    }
    const kind = inSeq ? (land ? (ac.clr.land ? 'k-landclr' : 'k-land') : ac.clr.takeoff ? 'k-depclr' : 'k-dep') : `k-${g}`;
    return {
      cls: `fcard ${kind}${sel ? ' active' : ''}${ac.req || ac.wxReq ? ' req' : ''}${ac.wxReq ? ' wxreq' : ''}${ac.emergency || ac.nordo ? ' emg' : ''}${ac.conflict ? ' conf' : ''}${ac.wakeWarn ? ' conf' : ''}${ac.rbErr && ac.rbErr.age >= rbHintDelay(state) ? ' rberr' : ''}`,
      wrap: (inner) => `<div class="c-bar"></div><div class="c-body">${inner}</div>`,
      parts: { 'c-top': top, 'c-mid': mid, 'c-st': state2, 'c-extra': extra, 'c-btns': btns },
    };
  }

  // Trenner zwischen Gruppen in einer Reihe
  sep(key, label, n) {
    return { key, r: { cls: 'fsep', html: `<span>${label}</span>${n ? `<b>${n}</b>` : ''}` } };
  }

  update(state) {
    setHTML(this.el.rwy, runwayStatusHtml(state));
    updateSequence(state);
    updateArrQueue(state);
    const byId = new Map(state.acs.map((a) => [a.id, a]));
    const seq = state.seq.map((id) => byId.get(id)).filter(Boolean);
    const num = new Map(seq.map((a, i) => [a.id, i + 1]));
    // Landungen: Folge · Warteliste · am Boden
    const arrSeq = seq.filter((a) => isSeqArrival(a));
    const queue = [...state.acs.filter((a) => a.arr && a.mode === 'air' && [PH.GOAROUND, PH.MISSED].includes(a.phase)), ...state.arrQ.map((id) => byId.get(id)).filter(Boolean)];
    const arrGnd = state.acs.filter((a) => a.arr && a.mode === 'map' && ARR_GND.has(a.phase) && !num.has(a.id)).sort((a, b) => (b.req ? 1 : 0) - (a.req ? 1 : 0));
    // Starts: Folge · Vorfeld (Pushback-Anfragen) · in der Luft
    const depSeq = seq.filter((a) => !isSeqArrival(a));
    const apron = state.acs.filter((a) => !num.has(a.id) && ((a.phase === PH.STAND && a.req === 'push') || DEP_APRON.has(a.phase))).sort((a, b) => (a.reqT || 0) - (b.reqT || 0));
    const air = state.acs.filter((a) => !num.has(a.id) && ((a.phase === PH.DEPART && Math.hypot(a.pos.x, a.pos.y) < 10) || (a.phase === PH.TAKEOFF && a.z > 0.5)));
    const build = (lane, groups) => {
      const items = [];
      for (const [g, list, label] of groups) {
        if (!list.length) continue;
        items.push(this.sep(`s-${g}`, label, list.length));
        for (const a of list) items.push({ key: a.id, a, g });
      }
      return items;
    };
    const arrItems = build('arr', [['seq', arrSeq, 'Pistenfolge'], ['q', queue, state.settings.autoSpacing !== false ? 'Warteliste · Freigabe automatisch' : 'ohne Anflugfreigabe'], ['gnd', arrGnd, 'gelandet']]);
    const depItems = build('dep', [['seq', depSeq, 'Pistenfolge'], ['apron', apron, 'Vorfeld'], ['air', air, 'in der Luft']]);
    const render = (lane) => (it) => {
      if (it.r) return it.r;
      const r = this.card(state, it.a, it.g, it.g === 'seq' ? num.get(it.a.id) : 0, lane);
      return r;
    };
    syncList(this.el.arr, arrItems, (it) => it.key, render('arr'));
    syncList(this.el.dep, depItems, (it) => it.key, render('dep'));
    for (const [box, items] of [[this.el.arr, arrItems], [this.el.dep, depItems]]) {
      const g = new Map(items.filter((i) => i.a).map((i) => [i.key, i.g]));
      for (const el of box.children) {
        const gg = g.get(el.dataset.key);
        if (!gg) continue;
        if (el.dataset.g !== gg) el.dataset.g = gg;
        const dr = gg === 'seq' || gg === 'q';
        if (el.draggable !== dr) el.draggable = dr;
      }
    }
    if (!arrItems.length && !this.el.arr.querySelector('.empty')) this.el.arr.innerHTML = '<div class="empty">Kein Anflugverkehr.</div>';
    if (!depItems.length && !this.el.dep.querySelector('.empty')) this.el.dep.innerHTML = '<div class="empty">Keine Starts.</div>';
    const reqs = (l) => l.filter((a) => a.req).length;
    const ra = reqs([...arrSeq, ...queue, ...arrGnd]), rd = reqs([...depSeq, ...apron]);
    setHTML(this.rail.querySelector('#rl-c-arr'), `${arrSeq.length + queue.length + arrGnd.length}${ra ? ` · ${ra} Anfrage${ra > 1 ? 'n' : ''}` : ''}`);
    setHTML(this.rail.querySelector('#rl-c-dep'), `${depSeq.length + apron.length + air.length}${rd ? ` · ${rd} Anfrage${rd > 1 ? 'n' : ''}` : ''}`);
    this.rail.querySelector('#rl-c-arr').classList.toggle('warn', ra > 0);
    this.rail.querySelector('#rl-c-dep').classList.toggle('warn', rd > 0);
    // Kopf: Filter, Schalter, Sortiermodus
    const f = this.filter;
    if (this.el.lanes.dataset.f !== f) this.el.lanes.dataset.f = f;
    // Aufteilung nach Inhalt: wer mehr Karten hat, bekommt mehr Platz (mindestens ein Viertel)
    if (f === 'both') {
      const sel = this.game.ui.selected;
      const weight = (items) => items.filter((i) => i.a).length + (items.some((i) => i.a && i.a.id === sel) ? 1 : 0) + 0.6;
      let wa = weight(arrItems), wd = weight(depItems);
      const share = Math.min(0.75, Math.max(0.25, wa / (wa + wd)));
      const cols = `${share.toFixed(3)}fr ${(1 - share).toFixed(3)}fr`;
      if (this.el.lanes.style.gridTemplateColumns !== cols) this.el.lanes.style.gridTemplateColumns = cols;
    } else if (this.el.lanes.style.gridTemplateColumns) this.el.lanes.style.gridTemplateColumns = '';
    for (const b of this.rail.querySelectorAll('#rl-filter [data-f]')) b.classList.toggle('on', b.dataset.f === f);
    this.rail.querySelector('#rl-spacing .switch').classList.toggle('on', state.settings.autoSpacing !== false);
    this.rail.querySelector('#rl-gauto .switch').classList.toggle('on', !!state.settings.towerGroundAuto);
    setHTML(this.rail.querySelector('#rl-sort'), state.seqManual || state.arrQManual ? '<button class="mini" data-seqsort title="Reihenfolge wieder automatisch planen">⇅ manuell sortiert – zurücksetzen</button>' : '<small class="rl-auto">Reihenfolge automatisch</small>');
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
