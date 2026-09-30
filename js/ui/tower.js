// Tower-Arbeitsplatz: Flugstreifen & Befehle
import { CMDS, command, validCommands, tailwind, preferredRunway, requestRunwayChange, drainCount } from '../sim/atc.js';
import { PH, PHASE_DE, runwayOccupants, fmtAlt } from '../sim/aircraft.js';
import * as AS from '../sim/airspace.js';
import { AC_TYPES, CITIES, AIRPORT } from '../config.js';
import { fmtClock, esc } from '../util.js';
import { syncList, setHTML, toast } from './dom.js';
import { sfx } from '../audio.js';

export const REQ_DE = {
  approach: 'wartet auf Anflugfreigabe',
  land: 'bittet um Landefreigabe',
  taxi_in: 'bittet um Rollfreigabe',
  push: 'bittet um Pushback',
  taxi_out: 'bittet um Rollfreigabe',
  takeoff: 'startbereit',
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
        <div class="p-sec"><span>Anflug</span><span class="cnt" id="tw-c-arr">0</span></div>
        <div id="tw-arr"></div>
        <div class="p-sec"><span>Rollverkehr</span><span class="cnt" id="tw-c-gnd">0</span></div>
        <div id="tw-gnd"></div>
        <div class="p-sec"><span>Abflug</span><span class="cnt" id="tw-c-dep">0</span></div>
        <div id="tw-dep"></div>
        <div class="p-sec"><span>An Parkpositionen</span><span class="cnt" id="tw-c-stand">0</span></div>
        <div class="empty" id="tw-stand-hint">Abfertigung läuft automatisch. Sobald ein Flug fertig ist, meldet er sich für den Pushback.</div>
      </div>`;
    this.el = {
      rwy: root.querySelector('#tw-rwy'),
      arr: root.querySelector('#tw-arr'),
      gnd: root.querySelector('#tw-gnd'),
      dep: root.querySelector('#tw-dep'),
      gauto: root.querySelector('#tw-gauto'),
    };
    root.addEventListener('click', (e) => this.onClick(e));
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
    const strip = e.target.closest('.strip');
    if (strip) this.game.select(strip.dataset.key, true);
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
    const info = `<div class="s-info"><div class="s-cs">${esc(ac.cs)}<small>${ac.type}/${t.wake}${ac.emergency ? ' · 7700' : ''}</small></div><div class="s-alt">${alt}</div><div class="s-sub">${esc(sub)}</div><div class="s-state">${esc(st)}${rq}</div></div>`;
    const cls = `strip ${kind}${sel ? ' sel' : ''}${ac.req ? ' req' : ''}${ac.emergency ? ' emg' : ''}${ac.conflict ? ' conf' : ''}`;
    return {
      cls,
      wrap: (inner) => `<div class="s-bar"></div><div class="s-main">${inner}</div>`,
      parts: { 's-infobox': info, 's-btns': cmdButtons(state, ac, false, sel) },
    };
  }

  update(state) {
    // Piste
    const occ = runwayOccupants(state);
    const tw = tailwind(state, state.rwy);
    const pref = preferredRunway(state);
    const other = state.rwy === '27' ? '09' : '27';
    let h = `<div>Piste <b style="font-family:var(--mono)">${state.rwy}</b> · Wind ${Math.round(state.wind.dir / 10) * 10}°/${Math.round(state.wind.spd)} kt <small style="color:var(--muted)">(${tw > 0 ? 'Rückenwind' : 'Gegenwind'} ${Math.abs(tw).toFixed(0)} kt)</small></div><div></div>`;
    h += `<div>Status: ${occ.length ? `<span class="state busy">belegt · ${occ.map((a) => esc(a.cs)).join(', ')}</span>` : '<span class="state free">frei</span>'}</div><div></div>`;
    if (state.rwyPending) h += `<div style="color:var(--warn)">Wechsel auf ${state.rwyPending} ausstehend – ${drainCount(state)} Bewegungen laufen noch</div><button class="cmd" data-rwy="${state.rwy}">Abbrechen</button>`;
    else h += `<div>${pref !== state.rwy ? '<span style="color:var(--warn)">⚠ Rückenwind – Wechsel empfohlen</span>' : '<span style="color:var(--muted)">Betriebsrichtung passt</span>'}</div><button class="cmd ${pref !== state.rwy ? 'big' : ''}" data-rwy="${other}">→ ${other}</button>`;
    setHTML(this.el.rwy, h);
    this.el.gauto.classList.toggle('on', !!state.settings.towerGroundAuto);

    const arr = state.acs.filter((a) => ARR_PH.includes(a.phase)).map((a) => ({ a, d: distToLand(a) })).sort((x, y) => x.d - y.d).map((x) => x.a);
    const gnd = state.acs.filter((a) => GND_PH.includes(a.phase) || (a.phase === PH.STAND && a.req === 'push')).sort((a, b) => (b.req ? 1 : 0) - (a.req ? 1 : 0) || (a.reqT || 0) - (b.reqT || 0));
    const dep = state.acs.filter((a) => DEP_PH.includes(a.phase) || (a.phase === PH.DEPART && Math.hypot(a.pos.x, a.pos.y) < 10));
    syncList(this.el.arr, arr, (a) => a.id, (a) => this.strip(state, a, 'arr'));
    syncList(this.el.gnd, gnd, (a) => a.id, (a) => this.strip(state, a, 'gnd'));
    syncList(this.el.dep, dep, (a) => a.id, (a) => this.strip(state, a, 'dep'));
    const cnt = (id, n) => setHTML(this.root.querySelector(id), String(n));
    cnt('#tw-c-arr', arr.length);
    cnt('#tw-c-gnd', gnd.length);
    cnt('#tw-c-dep', dep.length);
    cnt('#tw-c-stand', state.acs.filter((a) => a.phase === PH.STAND).length);
    for (const [el, list, txt] of [[this.el.arr, arr, 'Kein Anflugverkehr.'], [this.el.gnd, gnd, 'Kein Rollverkehr.'], [this.el.dep, dep, 'Keine Abflüge am Rollhalt.']]) {
      if (!list.length && !el.querySelector('.empty')) el.innerHTML = `<div class="empty">${txt}</div>`;
    }
  }

  // Tastenkürzel für das ausgewählte Flugzeug
  key(e, state) {
    const id = this.game.ui.selected;
    const ac = id && state.acs.find((a) => a.id === id);
    if (!ac) return false;
    const k = e.key.toUpperCase();
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
