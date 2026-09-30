// Tower-Arbeitsplatz: Flugstreifen & Befehle
import { CMDS, command, validCommands, tailwind, preferredRunway, requestRunwayChange, drainCount } from '../sim/atc.js';
import { PH, PHASE_DE, runwayOccupants, fmtAlt } from '../sim/aircraft.js';
import * as AS from '../sim/airspace.js';
import { AC_TYPES, CITIES, AIRPORT } from '../config.js';
import { fmtClock, esc } from '../util.js';
import { syncList, setHTML, toast } from './dom.js';
import { sfx } from '../audio.js';
import { flagButton, flagHtml, openMarkMenu } from './marks.js';
import { updateSequence, isSeqArrival, seqEta, seqSlot, seqMove, seqMoveTo, seqSortByEta, seqIndex } from '../sim/sequence.js';
import { qm, glTag } from './glossary.js';
import { slotInfo } from '../sim/acdm.js';
import { rwyCond, brakingAction, BRAKE_DE, runwayClosed, isWet, hasRwy2, rwyName, segregated } from '../sim/runway.js';
import { isNight } from '../sim/finance.js';

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
    h += `<div class="rwy-line"><b class="rwy-id">${rwyName(state, strip)}</b>${role} · ${closed ? `<span class="state busy">⛔ ${esc(closed)}</span>` : occ.length ? `<span class="state busy">belegt · ${occ.map((a) => esc(a.cs)).join(', ')}</span>` : '<span class="state free">frei</span>'}<div class="rwy-cond">Zustand <b>${cond} %</b> · Bremswirkung <b class="ba-${ba}">${BRAKE_DE[ba]}</b>${isWet(state) ? ' (nass)' : ''}</div></div><div></div>`;
  }
  if (hasRwy2(state)) h += `<div class="rwy-cond">Betriebsart: <b>${segregated(state) ? 'getrennt (Landungen Süd, Starts Nord)' : 'eine Bahn (alles auf der Nordbahn)'}</b></div><button class="cmd" data-rwymode="${segregated(state) ? 'single' : 'seg'}">${segregated(state) ? '→ eine Bahn' : '→ getrennt'}</button>`;
  h += `<div class="rwy-cond">${state.weather.kind === 'fog' ? `RVR <b>${state.weather.rvr ?? '—'} m</b> · LVP · ` : ''}${isNight(state) ? `🌙 Nacht${state.settings.curfew ? 'flugverbot' : ''}` : '☀️ Tagbetrieb'}</div>${qm('rwy')}`;
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
const ARR_PH = [PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND, PH.FINAL, PH.MISSED];
const GND_PH = [PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN, PH.PUSH, PH.STARTUP, PH.TAXI_OUT];
const DEP_PH = [PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF];

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
      return `<button class="cmd ${cls}" data-cmd="${k}" data-ac="${ac.id}">${c.label}${c.key && !compact ? ` <kbd>${c.key}</kbd>` : ''}</button>`;
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

export class TowerPanel {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    root.innerHTML = `
      <div class="p-head">
        <div class="p-title">🎧 Tower <small>${AIRPORT.tower} ${AIRPORT.freq}</small></div>
      </div>
      <div class="p-body">
        <div class="rwy-box" id="tw-rwy"></div>
        <div class="toggle-row"><span>Rollverkehr automatisch (nur Luftraum &amp; Piste selbst)</span><button class="switch" id="tw-gauto"></button></div>
        <div class="p-sec seq-head" id="tw-seq-head"></div>
        <div class="seq-legend"><span><i style="background:${SEQ_COL.land}"></i>Landung</span><span><i style="background:${SEQ_COL.landClr}"></i>Landung frei</span><span><i style="background:${SEQ_COL.dep}"></i>Start</span><span><i style="background:${SEQ_COL.depClr}"></i>Startfreigabe</span></div>
        <div id="tw-seq"></div>
        <div class="p-sec"><span>Anflug · noch ohne Freigabe${qm('arr')}</span><span class="cnt" id="tw-c-arr">0</span></div>
        <div id="tw-arr"></div>
        <div class="p-sec"><span>Rollverkehr${qm('gnd')}</span><span class="cnt" id="tw-c-gnd">0</span></div>
        <div id="tw-gnd"></div>
        <div class="p-sec"><span>Abflug · in der Luft${qm('dep')}</span><span class="cnt" id="tw-c-dep">0</span></div>
        <div id="tw-dep"></div>
        <div class="p-sec"><span>An Parkpositionen</span><span class="cnt" id="tw-c-stand">0</span></div>
        <div class="empty" id="tw-stand-hint">Abfertigung läuft automatisch. Sobald ein Flug fertig ist, meldet er sich für den Pushback.</div>
      </div>`;
    this.el = {
      rwy: root.querySelector('#tw-rwy'),
      arr: root.querySelector('#tw-arr'),
      gnd: root.querySelector('#tw-gnd'),
      dep: root.querySelector('#tw-dep'),
      seq: root.querySelector('#tw-seq'),
      seqHead: root.querySelector('#tw-seq-head'),
      gauto: root.querySelector('#tw-gauto'),
    };
    root.addEventListener('click', (e) => this.onClick(e));
    this.wireDrag();
    this.el.gauto.addEventListener('click', () => {
      const s = this.game.state;
      s.settings.towerGroundAuto = !s.settings.towerGroundAuto;
      toast(s.settings.towerGroundAuto ? 'Rollverkehr läuft automatisch' : 'Rollverkehr wieder manuell', 'info');
    });
  }

  onClick(e) {
    const s = this.game.state;
    const b = e.target.closest('[data-cmd]');
    if (b) {
      const ac = s.acs.find((a) => a.id === b.dataset.ac);
      if (!ac) return;
      const r = command(s, ac, b.dataset.cmd);
      if (!r.ok) toast(r.msg, 'warn');
      else sfx.click();
      this.game.select(ac.id, false);
      return;
    }
    const rw = e.target.closest('[data-rwy]');
    if (rw) {
      requestRunwayChange(s, rw.dataset.rwy);
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
      this.update(s);
      return;
    }
    if (e.target.closest('[data-seqsort]')) {
      seqSortByEta(s);
      sfx.click();
      toast('Pistenfolge wird wieder automatisch geplant', 'info', 2200);
      this.update(s);
      return;
    }
    const strip = e.target.closest('.strip');
    if (strip) this.game.select(strip.dataset.key, true);
  }

  wireDrag() {
    const box = this.el.seq;
    let dragId = null;
    const clear = () => box.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    box.addEventListener('dragstart', (e) => {
      const st = e.target.closest('.strip');
      if (!st) return;
      dragId = st.dataset.key;
      st.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      this.game.panelHold = true;
    });
    box.addEventListener('dragover', (e) => {
      const st = e.target.closest('.strip');
      if (!dragId || !st) return;
      e.preventDefault();
      clear();
      const r = st.getBoundingClientRect();
      st.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    box.addEventListener('drop', (e) => {
      const st = e.target.closest('.strip');
      if (!dragId || !st) return;
      e.preventDefault();
      const s = this.game.state;
      const after = st.classList.contains('drop-after');
      let before = st.dataset.key;
      if (after) {
        const i = s.seq.indexOf(before);
        before = s.seq[i + 1] === dragId ? s.seq[i + 2] : s.seq[i + 1];
      }
      if (before !== dragId && seqMoveTo(s, dragId, before || null)) sfx.click();
      clear();
    });
    box.addEventListener('dragend', () => {
      box.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
      clear();
      dragId = null;
      this.game.panelHold = false;
      this.update(this.game.state);
    });
  }

  seqStrip(state, ac, idx, gapNm) {
    const t = AC_TYPES[ac.type];
    const sel = this.game.ui.selected === ac.id;
    const land = isSeqArrival(ac);
    const col = seqColor(ac);
    const raw = seqEta(state, ac);
    const slot = seqSlot(state, ac.id) ?? raw;
    const eta = Math.max(0, Math.round(slot / 60));
    const shift = Math.round((slot - raw) / 60); // Wartezeit durch die Folge
    let where = '';
    if (land) {
      if (ac.mode === 'air') where = `${distToLand(ac).toFixed(1)} NM · ${String(Math.round(ac.alt / 100)).padStart(3, '0')} · ${Math.round(ac.spd)} kt`;
      else where = ac.phase === PH.ROLLOUT ? 'auf der Piste' : 'kurzer Endanflug';
    } else where = { STARTUP: 'Triebwerksstart', TAXI_OUT: 'rollt zum Rollhalt', HOLDING: `Rollhalt ${ac.rwy}`, LINEUP: 'rollt auf die Piste', LINED_UP: 'aufgestellt', TAKEOFF: 'Startlauf' }[ac.phase] || PHASE_DE[ac.phase];
    let gap = '';
    if (gapNm != null) {
      const req = ac.wakeReq > 3 ? ac.wakeReq : 3;
      const c = gapNm < 3 || ac.wakeWarn ? 'var(--bad)' : gapNm < req + 0.5 ? 'var(--warn)' : 'var(--muted)';
      gap = ` · <span style="color:${c}">Abstand ${gapNm.toFixed(1)} NM${req > 3 ? ` / Soll ${req}${ac.wakeWarn ? ' 🌀' : ''}` : ''}</span>`;
    }
    let st = land ? (ac.clr.land ? '🛬 Landung frei' : '🛬 Landung') : ac.clr.takeoff ? '🛫 Startfreigabe erteilt' : ac.clr.lineup ? '🛫 Line up & wait' : '🛫 Start';
    if (ac.holdPos) st += ' · HALT';
    if (ac.blockedBy && ac.mode === 'map' && ac.v === 0) {
      const b = state.acs.find((o) => o.id === ac.blockedBy);
      if (b) st += ` · wartet auf ${esc(b.cs)}`;
    }
    const rq = ac.req ? ` · <span class="rq">${REQ_DE[ac.req] || ac.req}</span>` : '';
    const info = `<div class="s-info"><div class="s-cs">${flagButton(ac)}${esc(ac.cs)}<small>${ac.type}/${wakeTag(t.wake)}${ac.emergency ? ' · 7700' : ''}</small>${flagHtml(ac)}</div><div class="s-alt" title="geplante Pistenzeit laut Folge">${eta <= 0 ? 'jetzt' : '~' + eta + ' min'}${shift >= 1 ? ` <small style="color:var(--warn)">+${shift}</small>` : ''}</div><div class="s-sub">${esc(acRoute(state, ac))} · ${esc(where)}${gap}</div><div class="s-state"><b style="color:${col}">${st}</b>${rq}${fuelChip(ac)}</div>${land ? '' : acdmLine(state, ac)}</div>`;
    const ctl = `<button class="mini" data-seqmv="-1" data-ac="${ac.id}" title="früher (W)">▲</button><span class="grip" title="Ziehen zum Umsortieren">⠿</span><button class="mini" data-seqmv="1" data-ac="${ac.id}" title="später (S)">▼</button>`;
    return {
      cls: `strip seqs ${land ? (ac.clr.land ? 'k-landclr' : 'k-land') : ac.clr.takeoff ? 'k-depclr' : 'k-dep'}${sel ? ' sel' : ''}${ac.req ? ' req' : ''}${ac.emergency ? ' emg' : ''}${ac.conflict ? ' conf' : ''}`,
      wrap: () => `<div class="s-bar"></div><div class="s-num"></div><div class="s-main"><div class="s-infobox"></div><div class="s-btns"></div></div><div class="s-ctl"></div>`,
      parts: { 's-num': `<span style="background:${col}">${idx}</span>`, 's-infobox': info, 's-btns': cmdButtons(state, ac, false, sel), 's-ctl': ctl },
    };
  }

  strip(state, ac, kind) {
    const t = AC_TYPES[ac.type];
    const rot = state.rots[ac.rot];
    const sel = this.game.ui.selected === ac.id;
    let alt = '';
    if (ac.mode === 'air') alt = `${String(Math.round(ac.alt / 100)).padStart(3, '0')}${ac.tAlt > ac.alt + 150 ? '↑' : ac.tAlt < ac.alt - 150 ? '↓' : ''} ${Math.round(ac.spd)}kt`;
    else if (ac.stand) alt = `Pos ${ac.stand}`;
    else if (ac.arr && [PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT].includes(ac.phase)) alt = 'keine Pos.';
    let sub = acRoute(state, ac);
    if (rot) {
      if (ac.arr && ARR_PH.includes(ac.phase)) {
        const d = distToLand(ac);
        sub += ` · ${d.toFixed(0)} NM · STA ${fmtClock(rot.sta)}`;
      } else if (!ac.arr || [PH.PUSH, PH.STARTUP, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF].includes(ac.phase)) {
        const late = Math.round((state.time - rot.std) / 60);
        sub += ` · STD ${fmtClock(rot.std)}${late > 0 ? ` (+${late})` : ''}`;
      }
    }
    let st = PHASE_DE[ac.phase] || ac.phase;
    if (ac.phase === PH.HOLD && ac.holdFix) st += ` ${ac.holdFix.name} ${fmtAlt(ac.tAlt)}`;
    if (ac.phase === PH.APPROACH) st += ac.clr.land ? ' · Landung frei' : '';
    if (ac.holdPos) st += ' · HALT';
    if (ac.blockedBy && ac.mode === 'map' && ac.v === 0) {
      const b = state.acs.find((o) => o.id === ac.blockedBy);
      if (b) st += ` · wartet auf ${b.cs}`;
    }
    const rq = ac.req ? ` · <span class="rq">${REQ_DE[ac.req] || ac.req}</span>` : '';
    const depSide = !ac.arr || [PH.STAND, PH.PUSH, PH.STARTUP, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED].includes(ac.phase);
    const info = `<div class="s-info"><div class="s-cs">${flagButton(ac)}${esc(ac.cs)}<small>${ac.type}/${wakeTag(t.wake)}${ac.emergency ? ' · 7700' : ''}</small>${flagHtml(ac)}</div><div class="s-alt">${alt}</div><div class="s-sub">${esc(sub)}</div><div class="s-state">${esc(st)}${rq}${fuelChip(ac)}</div>${depSide ? acdmLine(state, ac) : ''}</div>`;
    const cls = `strip ${kind}${sel ? ' sel' : ''}${ac.req ? ' req' : ''}${ac.emergency ? ' emg' : ''}${ac.conflict ? ' conf' : ''}`;
    return {
      cls,
      wrap: (inner) => `<div class="s-bar"></div><div class="s-main">${inner}</div>`,
      parts: { 's-infobox': info, 's-btns': cmdButtons(state, ac, false, sel) },
    };
  }

  update(state) {
    // Piste
    const h = runwayStatusHtml(state);
    setHTML(this.el.rwy, h);
    this.el.gauto.classList.toggle('on', !!state.settings.towerGroundAuto);

    // Pistenfolge (Landungen + Starts gemeinsam)
    updateSequence(state);
    const byId = new Map(state.acs.map((a) => [a.id, a]));
    const seq = state.seq.map((id) => byId.get(id)).filter(Boolean);
    const inSeq = new Set(state.seq);
    setHTML(this.el.seqHead, `<span>Pistenfolge RWY ${state.rwy}${qm('seq')} <small style="text-transform:none;letter-spacing:0">${state.seqManual ? '· manuell sortiert' : '· automatisch geplant'}</small></span><span>${state.seqManual ? '<button class="mini" data-seqsort title="wieder automatisch planen">⇅ automatisch</button> ' : ''}<span class="cnt">${seq.length}</span></span>`);
    let lastArr = null;
    const gaps = new Map();
    for (const a of seq) {
      if (!isSeqArrival(a)) continue;
      if (lastArr && a.mode === 'air') gaps.set(a.id, lastArr.mode === 'air' ? Math.hypot(a.pos.x - lastArr.pos.x, a.pos.y - lastArr.pos.y) : distToLand(a));
      lastArr = a;
    }
    syncList(this.el.seq, seq, (a) => a.id, (a) => this.seqStrip(state, a, seq.indexOf(a) + 1, gaps.get(a.id)));
    for (const el of this.el.seq.children) if (el.classList.contains('strip')) el.draggable = true;
    if (!seq.length && !this.el.seq.querySelector('.empty')) this.el.seq.innerHTML = '<div class="empty">Noch keine Landungen mit Anflugfreigabe oder rollbereite Starts.</div>';

    const arr = state.acs.filter((a) => ARR_PH.includes(a.phase) && !inSeq.has(a.id)).map((a) => ({ a, d: distToLand(a) })).sort((x, y) => x.d - y.d).map((x) => x.a);
    const gnd = state.acs.filter((a) => !inSeq.has(a.id) && (GND_PH.includes(a.phase) || (a.phase === PH.STAND && a.req === 'push'))).sort((a, b) => (b.req ? 1 : 0) - (a.req ? 1 : 0) || (a.reqT || 0) - (b.reqT || 0));
    const dep = state.acs.filter((a) => !inSeq.has(a.id) && (DEP_PH.includes(a.phase) || (a.phase === PH.DEPART && Math.hypot(a.pos.x, a.pos.y) < 10)));
    syncList(this.el.arr, arr, (a) => a.id, (a) => this.strip(state, a, 'arr'));
    syncList(this.el.gnd, gnd, (a) => a.id, (a) => this.strip(state, a, 'gnd'));
    syncList(this.el.dep, dep, (a) => a.id, (a) => this.strip(state, a, 'dep'));
    const cnt = (id, n) => setHTML(this.root.querySelector(id), String(n));
    cnt('#tw-c-arr', arr.length);
    cnt('#tw-c-gnd', gnd.length);
    cnt('#tw-c-dep', dep.length);
    cnt('#tw-c-stand', state.acs.filter((a) => a.phase === PH.STAND).length);
    for (const [el, list, txt] of [[this.el.arr, arr, 'Kein Anflugverkehr.'], [this.el.gnd, gnd, 'Kein Rollverkehr.'], [this.el.dep, dep, 'Keine Abflüge in der Luft.']]) {
      if (!list.length && !el.querySelector('.empty')) el.innerHTML = `<div class="empty">${txt}</div>`;
    }
  }

  // Tastenkürzel für das ausgewählte Flugzeug
  key(e, state) {
    const id = this.game.ui.selected;
    const ac = id && state.acs.find((a) => a.id === id);
    if (!ac) return false;
    const k = e.key.toUpperCase();
    if ((k === 'W' || k === 'S') && seqIndex(state, ac.id)) {
      if (seqMove(state, ac.id, k === 'W' ? -1 : 1)) sfx.click();
      this.update(state);
      return true;
    }
    for (const key of validCommands(state, ac)) {
      if (CMDS[key].key === k) {
        const r = command(state, ac, key);
        if (!r.ok) toast(r.msg, 'warn');
        else sfx.click();
        return true;
      }
    }
    return false;
  }
}
