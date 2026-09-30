// Info-Karte zum ausgewählten Objekt
import { AC_TYPES, AIRLINES, CITIES, VEH_TYPES, UPGRADES, STAND_COSTS } from '../config.js';
import { PH, PHASE_DE, fmtAlt } from '../sim/aircraft.js';
import { fmtClock, fmtMoney, esc } from '../util.js';
import { setHTML } from './dom.js';
import { cmdButtons, acRoute, REQ_DE, distToLand, fuelChip, wakeTag } from './tower.js';
import { slotInfo, exot } from '../sim/acdm.js';
import { WAKE_DE } from '../sim/wake.js';
import { fuelState, FUEL, pending } from '../sim/fuel.js';
import { taskChips, standOptions } from './groundPanel.js';
import { standBuildCost } from '../sim/economy.js';
import { BUILDINGS } from '../layout.js';
import { MARKS, MARK_KEYS, flagHtml } from './marks.js';
import { projects, standProject, projectFor, standBuildHours, upgradeHours, STAND_HOURS, remainingHours } from '../sim/construction.js';
import { progressBar, projectStatus, projectRefund, fmtHours } from './projects.js';

const SITE_DESC = {
  stand: 'Neue Parkposition: Aushub, Betonplatte, Markierungen und Befeuerung.',
  standL: 'Umbau auf Großraumjets (Klasse L) – die Position ist während der Arbeiten gesperrt.',
  hotel: 'Rohbau des Flughafenhotels – Stockwerk für Stockwerk.',
  parking: 'Erweiterung der Parkfläche an der Landseite.',
  retail: 'Terminal-Anbau für Shops & Gastronomie.',
  security: 'Terminal-Anbau mit zusätzlichen Kontrollspuren.',
  lounge: 'Terminal-Anbau für die Premium-Lounge.',
  ils3: 'Neue Landekurs- und Gleitweg-Antennen für CAT III.',
  rapidExit: 'Schnellabrollwege werden asphaltiert – Rollwege mit Pylonen abgesperrt.',
  apronLights: 'Kabelgraben und LED-Masten entlang des Vorfelds.',
};

const BDESC = {
  hall: 'Hauptterminal mit Check-in, Sicherheitskontrolle und Gepäcksortierung.',
  tower: 'Kontrollturm – Sitz der Flugsicherung (Tower & Vorfeldkontrolle).',
  hangar: 'Wartungshangar für Linienwartung und Checks.',
  cargo: 'Frachtterminal – Umschlag für Frachtflüge.',
  depot: 'Fahrzeugdepot – hier warten Schlepper, Tankwagen, Busse & Co.',
  fire: 'Flughafenfeuerwehr – rückt bei Notfällen aus.',
  fuel: 'Tanklager – versorgt die Tankwagen mit Kerosin.',
  parking: 'Parkhaus – Erlöse aus Parkgebühren.',
  hotel: 'Flughafenhotel – zusätzliche Einnahmen und Ansehen.',
  radar: 'Flughafen-Rundsichtradar (ASR).',
};
const BUP = { parking: 'parking', hall: 'retail', hotel: 'hotel' };
const VST = { idle: 'bereit', drive: 'fährt zum Einsatz', work: 'im Einsatz', return: 'fährt zurück ins Depot', attached: 'schiebt zurück', refill: 'fährt zum Tanklager', filling: 'wird am Tanklager befüllt' };

export function renderInfo(el, state, ui) {
  const sel = ui.sel;
  if (!sel) {
    el.classList.remove('show');
    return;
  }
  let h = '';
  if (sel.type === 'ac') {
    const ac = state.acs.find((a) => a.id === sel.id);
    if (!ac) {
      ui.sel = null;
      ui.selected = null;
      el.classList.remove('show');
      return;
    }
    const t = AC_TYPES[ac.type];
    const al = AIRLINES[ac.airline];
    const rot = state.rots[ac.rot];
    const dep = !ac.arr || [PH.STAND, PH.PUSH, PH.STARTUP, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED, PH.TAKEOFF, PH.DEPART].includes(ac.phase);
    let delay = '';
    if (rot) {
      const d = dep ? Math.round(((rot.offBlock || state.time) - rot.std) / 60) : rot.arrDelay;
      delay = d > 0 ? `+${d} min` : 'pünktlich';
    }
    h += `<div class="i-head"><div><div class="i-cs"><i class="al-dot" style="background:${al.color}"></i>${esc(ac.cs)}${ac.emergency ? ' 🚨' : ''}</div><div class="i-sub">${al.name} · ${t.name} · Wirbelschleppe ${wakeTag(t.wake)} ${WAKE_DE[t.wake]}</div></div><button class="icon-btn i-close" data-close>✕</button></div>`;
    h += `<div class="i-grid">`;
    h += `<div><span>Status</span><b>${PHASE_DE[ac.phase] || ac.phase}</b></div>`;
    h += `<div><span>Strecke</span><b>${esc(acRoute(state, ac))}</b></div>`;
    if (rot) h += `<div><span>${dep ? 'Abflug (STD)' : 'Ankunft (STA)'}</span><b>${fmtClock(dep ? rot.std : rot.sta)}</b></div><div><span>Verspätung</span><b>${delay}</b></div>`;
    if (ac.mode === 'air') h += `<div><span>Höhe</span><b>${fmtAlt(ac.alt)}</b></div><div><span>Geschw.</span><b>${Math.round(ac.spd)} kt</b></div><div><span>Kurs</span><b>${String(Math.round(ac.crs)).padStart(3, '0')}°</b></div><div><span>Squawk</span><b>${ac.squawk}</b></div>`;
    else h += `<div><span>Position</span><b>${ac.stand ? 'P' + ac.stand : '—'}</b></div><div><span>Passagiere</span><b>${rot ? (dep ? rot.paxOut : rot.paxIn) : '—'}</b></div>`;
    if (ac.arr && ac.mode === 'air' && [PH.INBOUND, PH.HOLD, PH.APPROACH].includes(ac.phase)) h += `<div><span>Bis Landung</span><b>${distToLand(ac).toFixed(1)} NM</b></div><div><span>Treibstoff-Reserve</span><b>${fuelChip(ac) || '—'}</b></div>`;
    // A-CDM-Zeiten für den Abflug
    if (rot && rot.tobt && !rot.atd && dep) {
      const si = slotInfo(state, rot);
      h += `<div><span>TOBT</span><b>${fmtClock(rot.tobt)}${rot.tobt > rot.std ? ` <small style="color:var(--warn)">+${Math.round((rot.tobt - rot.std) / 60)}</small>` : ''}</b></div><div><span>TSAT</span><b>${rot.tsat ? fmtClock(rot.tsat) : '—'}</b></div><div><span>CTOT</span><b>${rot.ctot ? fmtClock(rot.ctot) : 'kein Slot'}</b></div><div><span>EXOT</span><b>${Math.round(exot(state, ac) / 60)} min</b></div>`;
      if (si) h += `</div><div class="i-slot"><span class="slot ${si.cls}">${si.txt}</span>${rot.ctotReason ? ` · Grund: ${esc(rot.ctotReason)}` : ''}</div><div class="i-grid">`;
    }
    h += `</div>`;
    if (ac.req) h += `<div style="margin-top:6px;color:var(--warn);font-size:12px;font-weight:700">● ${REQ_DE[ac.req] || ac.req}</div>`;
    h += `<div class="i-marks"><span>⚑ Markieren</span>${MARK_KEYS.map((k) => `<button data-imark="${k}" data-ac="${ac.id}" class="${ac.mark && ac.mark.c === k ? 'cur' : ''}" style="--m:${MARKS[k].hex}" title="${MARKS[k].name}" aria-label="${MARKS[k].name}"></button>`).join('')}<button class="mini" data-imarkmenu="${ac.id}">Notiz…</button>${ac.mark ? `<button class="mini" data-imark="x" data-ac="${ac.id}">✕</button>` : ''}${flagHtml(ac)}</div>`;
    const role = state.role;
    if (role === 'tower') {
      const b = cmdButtons(state, ac, true);
      if (b) h += `<div class="i-acts" data-part="cmds">${b}</div>`;
    }
    if (role === 'ground' || role === 'observer' || role === 'manager') {
      if (ac.ta) h += `<div class="tasks" style="margin-top:8px">${taskChips(state, ac, role === 'ground')}</div>`;
      if (role === 'ground' && ac.arr && !ac.ta && ac.phase !== PH.TAXI_IN) h += `<div class="i-acts"><select data-assign="${ac.id}">${standOptions(state, ac)}</select></div>`;
    }
    if (role === 'manager' && rot) {
      const est = state.fees.landing * t.mtow + rot.paxOut * state.fees.pax;
      h += `<div class="i-sub" style="margin-top:6px">Entgelte dieses Umlaufs ≈ ${fmtMoney(est)} · Vertrag ${rot.contract ? 'regulär' : 'Sonderflug'}</div>`;
    }
  } else if (sel.type === 'stand') {
    const st = state.stands.find((s) => s.id === sel.id);
    if (!st) return;
    const occ = st.occ ? state.acs.find((a) => a.id === st.occ) : null;
    const resv = st.resv ? state.acs.find((a) => a.id === st.resv) : null;
    const kind = { contact: 'Gebäudeposition mit Fluggastbrücke', remote: 'Vorfeldposition (Busse)', cargo: 'Frachtposition' }[st.kind];
    h += `<div class="i-head"><div><div class="i-cs">Parkposition ${st.id}</div><div class="i-sub">${kind} · Klasse ${st.size}${st.size === 'L' ? ' (Großraum)' : ''}</div></div><button class="icon-btn i-close" data-close>✕</button></div>`;
    h += `<div class="i-grid"><div><span>Status</span><b>${!st.built ? (standProject(state, st.id) ? 'im Bau' : 'nicht gebaut') : st.closed ? 'gesperrt (Umbau)' : occ ? 'belegt' : resv ? 'reserviert' : 'frei'}</b></div><div><span>Flugzeug</span><b>${occ ? esc(occ.cs) : resv ? esc(resv.cs) : '—'}</b></div></div>`;
    const pj = standProject(state, st.id);
    if (pj) h += `<div class="i-site">🏗️ ${esc(pj.name)} ${progressBar(pj)}<small>${projectStatus(state, pj)}</small><button class="mini" data-act="pshow" data-v="${pj.id}">Baustelle</button></div>`;
    else if (state.role === 'manager') {
      if (!st.built) h += `<div class="i-acts"><button class="btn btn-good" data-act="stand" data-v="${st.id}">Bauen · ${fmtMoney(standBuildCost(st))} · ${standBuildHours(st)} h</button></div>`;
      else if (st.size !== 'L' && st.kind !== 'cargo') h += `<div class="i-acts"><button class="btn" data-act="standL" data-v="${st.id}">Für Großraumjets ausbauen · ${fmtMoney(STAND_COSTS.upgradeL)} · ${STAND_HOURS.upgradeL} h</button></div>`;
    }
  } else if (sel.type === 'veh') {
    const v = state.vehicles.find((x) => x.id === sel.id);
    if (!v) return;
    const job = v.job ? state.acs.find((a) => a.id === v.job.ac) : null;
    h += `<div class="i-head"><div><div class="i-cs">${esc(v.name)}</div><div class="i-sub">${VEH_TYPES[v.type].name}</div></div><button class="icon-btn i-close" data-close>✕</button></div>`;
    h += `<div class="i-grid"><div><span>Status</span><b>${v.brokenUntil > state.time ? 'defekt – in Reparatur' : VST[v.st] || v.st}</b></div><div><span>Einsatz</span><b>${job ? esc(job.cs) + (job.stand ? ' · P' + job.stand : '') : '—'}</b></div>${v.type === 'fuel' ? `<div><span>Ladung</span><b>${Math.round(v.load || 0)} / ${FUEL.truckCap} t</b></div>` : ''}</div>`;
  } else if (sel.type === 'building') {
    const b = BUILDINGS.find((x) => x.id === sel.id);
    if (!b) return;
    h += `<div class="i-head"><div><div class="i-cs">${b.name}</div><div class="i-sub">${BDESC[b.id] || ''}</div></div><button class="icon-btn i-close" data-close>✕</button></div>`;
    if (b.id === 'fuel') {
      const f = fuelState(state);
      h += `<div class="i-grid"><div><span>Bestand</span><b>${Math.round(f.stock)} / ${FUEL.cap} t</b></div><div><span>Bestellt</span><b>${Math.round(pending(state))} t</b></div><div><span>Marktpreis</span><b>${Math.round(f.price)} €/t</b></div><div><span>Marge</span><b>${Math.round(f.margin * 100)} %</b></div></div>`;
    }
    const up = BUP[b.id];
    const pj = up && projectFor(state, 'upgrade', up);
    if (pj) h += `<div class="i-site">🏗️ ${esc(pj.name)} ${progressBar(pj)}<small>${projectStatus(state, pj)}</small><button class="mini" data-act="pshow" data-v="${pj.id}">Baustelle</button></div>`;
    else if (up && state.role === 'manager') {
      const u = UPGRADES[up];
      const lvl = state.upgrades[up] || 0;
      if (lvl < u.max) h += `<div class="i-acts"><button class="btn btn-good" data-act="up" data-v="${up}">${u.name} Stufe ${lvl + 1} · ${fmtMoney(u.cost[lvl])} · ${upgradeHours(up, lvl + 1)} h</button></div>`;
    }
  } else if (sel.type === 'site') {
    const p = projects(state).find((x) => x.id === sel.id);
    if (!p) {
      ui.sel = null;
      el.classList.remove('show');
      return;
    }
    const rem = remainingHours(p);
    const key = p.kind === 'upgrade' ? p.target : p.kind;
    h += `<div class="i-head"><div><div class="i-cs">🏗️ ${esc(p.name)}</div><div class="i-sub">${SITE_DESC[key] || 'Baustelle'}</div></div><button class="icon-btn i-close" data-close>✕</button></div>`;
    h += progressBar(p);
    h += `<div class="i-grid"><div><span>Status</span><b>${p.status === 'waiting' ? 'wartet' : state.weather.kind === 'storm' ? 'Pause (Gewitter)' : 'in Arbeit'}</b></div><div><span>Restzeit</span><b>${p.status === 'waiting' ? '—' : fmtHours(rem)}</b></div><div><span>Baubeginn</span><b>${fmtClock(p.start)}</b></div><div><span>Bauzeit</span><b>${p.hours} h</b></div><div><span>Investition</span><b>${fmtMoney(p.cost)}</b></div><div><span>Fertig</span><b>${p.status === 'waiting' ? '—' : fmtClock(state.time + rem * 3600)}</b></div></div>`;
    if (state.role === 'manager') {
      const armed = ui.armP === p.id && performance.now() - ui.armT < 5000;
      h += `<div class="i-acts"><button class="btn${armed ? ' btn-bad' : ''}" data-act="pcancel" data-v="${p.id}">${armed ? `Wirklich abbrechen? +${fmtMoney(projectRefund(p))}` : `Abbrechen (Erstattung ${fmtMoney(projectRefund(p))})`}</button></div>`;
    }
  }
  el.classList.add('show');
  setHTML(el, h);
}
