// Vorfeld-Leitstand: Parkpositionen, Turnaround, Fahrzeuge
import { AC_TYPES, TASKS, TASK_ORDER, VEH_TYPES, CITIES } from '../config.js';
import { PH, PHASE_DE } from '../sim/aircraft.js';
import { dispatch, assignStand, releaseReservation, standFits, standFree, fleetSummary, efficiency } from '../sim/ground.js';
import { fmtClock, esc } from '../util.js';
import { syncList, setHTML, toast } from './dom.js';
import { sfx } from '../audio.js';

const KIND_DE = { contact: 'Gebäude', remote: 'Vorfeld', cargo: 'Fracht' };

export function taskChips(state, ac, interactive = true) {
  if (!ac.ta) return '';
  const auto = state.auto.ground;
  return TASK_ORDER.filter((k) => ac.ta.tasks[k])
    .map((k) => {
      const t = ac.ta.tasks[k];
      const def = TASKS[k];
      let st = t.st;
      let lbl = def.short;
      const isAuto = auto || (t.need && state.settings.vehAuto[t.need]) || !t.need;
      if (st === 'active' && k !== 'push') lbl = `${Math.round(t.prog * 100)}%`;
      if (st === 'active' && k === 'push') lbl = 'bereit';
      if (st === 'assigned') lbl = 'unterwegs';
      if (st === 'ready' && !t.need) lbl = 'Brücke';
      const title = `${def.name}${t.need ? ' · ' + VEH_TYPES[t.need].name : ' · Fluggastbrücke'}`;
      const clickable = interactive && st === 'ready' && t.need && !isAuto;
      return `<div class="task ${st}${isAuto ? ' auto' : ''}" title="${title}" ${clickable ? `data-disp="${k}" data-ac="${ac.id}"` : ''}><span class="ti">${def.icon}</span><span class="tl">${lbl}</span>${st === 'active' && k !== 'push' ? `<i class="pb" style="width:${Math.round(t.prog * 100)}%"></i>` : ''}</div>`;
    })
    .join('');
}

export function standOptions(state, ac) {
  const opts = state.stands.filter((s) => standFits(s, ac) && (standFree(s) || s.id === ac.stand));
  return `<option value="">– Position –</option>` + opts.map((s) => `<option value="${s.id}" ${s.id === ac.stand ? 'selected' : ''}>P${s.id} · ${KIND_DE[s.kind]} ${s.size}</option>`).join('');
}

export class GroundPanel {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    root.innerHTML = `
      <div class="p-head">
        <div class="p-title">🦺 Vorfeld-Leitstand <small id="gp-eff"></small></div>
      </div>
      <div class="p-body">
        <div id="gp-alert"></div>
        <div class="p-sec"><span>Ankünfte · Parkpositionen</span><span class="cnt" id="gp-c-inb">0</span></div>
        <div class="toggle-row"><span>Positionen automatisch vergeben</span><button class="switch" id="gp-sauto"></button></div>
        <div id="gp-inb"></div>
        <div class="p-sec"><span>Abfertigung (Turnaround)</span><span class="cnt" id="gp-c-ta">0</span></div>
        <div class="empty" style="padding-top:0">Gelbe Felder anklicken = nächstes freies Fahrzeug losschicken.</div>
        <div id="gp-ta"></div>
        <div class="p-sec"><span>Fuhrpark · Auto-Disposition</span></div>
        <div class="fleet" id="gp-fleet"></div>
      </div>`;
    this.el = {
      inb: root.querySelector('#gp-inb'),
      ta: root.querySelector('#gp-ta'),
      fleet: root.querySelector('#gp-fleet'),
      sauto: root.querySelector('#gp-sauto'),
      eff: root.querySelector('#gp-eff'),
      alert: root.querySelector('#gp-alert'),
    };
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
    this.el.sauto.addEventListener('click', () => {
      const s = this.game.state;
      s.settings.standAuto = !s.settings.standAuto;
    });
  }

  onClick(e) {
    const s = this.game.state;
    const d = e.target.closest('[data-disp]');
    if (d) {
      const ac = s.acs.find((a) => a.id === d.dataset.ac);
      if (!ac) return;
      const r = dispatch(s, ac, d.dataset.disp);
      if (!r.ok) toast(r.msg, 'warn');
      else sfx.click();
      return;
    }
    const va = e.target.closest('[data-vauto]');
    if (va) {
      const k = va.dataset.vauto;
      s.settings.vehAuto[k] = !s.settings.vehAuto[k];
      return;
    }
    const row = e.target.closest('[data-sel]');
    if (row && !e.target.closest('select')) this.game.select(row.dataset.sel, true);
  }

  onChange(e) {
    const s = this.game.state;
    const sel = e.target.closest('select[data-assign]');
    if (!sel) return;
    const ac = s.acs.find((a) => a.id === sel.dataset.assign);
    if (!ac) return;
    if (!sel.value) {
      releaseReservation(s, ac);
      return;
    }
    if (!assignStand(s, ac, Number(sel.value))) toast('Position nicht verfügbar', 'warn');
    else sfx.click();
  }

  update(state) {
    const eff = efficiency(state);
    setHTML(this.el.eff, `Personal ${state.staff} · Effizienz ${Math.round(eff * 100)}%`);
    this.el.sauto.classList.toggle('on', !!state.settings.standAuto);
    let alert = '';
    if (state.weather.kind === 'storm') alert += `<div class="card" style="border-color:var(--bad)">⛈️ Gewitter: Vorfeld gesperrt, Abfertigung pausiert.</div>`;
    if (state.strikeUntil > state.time) alert += `<div class="card" style="border-color:var(--warn)">✊ Warnstreik bis ${fmtClock(state.strikeUntil)} – weniger Personal.</div>`;
    setHTML(this.el.alert, alert);

    // Ankünfte
    const inb = state.acs
      .filter((a) => a.arr && [PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND, PH.FINAL, PH.MISSED, PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN].includes(a.phase))
      .sort((a, b) => (state.rots[a.rot]?.sta || 0) - (state.rots[b.rot]?.sta || 0));
    syncList(this.el.inb, inb, (a) => a.id, (a) => {
      const rot = state.rots[a.rot];
      const need = !a.stand && [PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT].includes(a.phase);
      const eta = rot ? fmtClock(rot.sta + Math.max(0, rot.arrDelay) * 60) : '';
      const locked = a.phase === PH.TAXI_IN;
      return {
        cls: `inb-row${need ? ' need' : ''}`,
        parts: {
          'inb-t': `<span class="cs" data-sel="${a.id}">${esc(a.cs)}</span> <small style="color:var(--muted)">${a.type} · ${AC_TYPES[a.type].size}</small>`,
          'inb-e': `<span class="eta">${need ? '⚠ wartet' : PHASE_DE[a.phase].split(' ')[0]} · ${eta}</span>`,
          'inb-s': locked ? `<b>P${a.stand}</b>` : `<select data-assign="${a.id}">${standOptions(state, a)}</select>`,
        },
      };
    });
    if (!inb.length && !this.el.inb.querySelector('.empty')) this.el.inb.innerHTML = '<div class="empty">Keine Ankünfte unterwegs.</div>';
    setHTML(this.root.querySelector('#gp-c-inb'), String(inb.length));

    // Turnaround-Tafel
    const at = state.acs.filter((a) => (a.phase === PH.STAND || a.phase === PH.PUSH) && a.ta).sort((a, b) => (state.rots[a.rot]?.std || 0) - (state.rots[b.rot]?.std || 0));
    syncList(this.el.ta, at, (a) => a.id, (a) => {
      const rot = state.rots[a.rot];
      const st = state.stands.find((s) => s.id === a.stand);
      const left = rot ? Math.round((rot.std - state.time) / 60) : 0;
      const cls = left < 0 ? 'late' : left < 10 ? 'tight' : '';
      const sel = this.game.ui.selected === a.id;
      return {
        cls: `stand-row${sel ? ' sel' : ''}${left < 0 ? ' late' : ''}`,
        parts: {
          'sr-head': `<span class="sr-id">P${st ? st.id : '?'}</span><span class="sr-ac" data-sel="${a.id}">${esc(a.cs)} <small>${a.type} → ${CITIES[rot?.city]?.name || ''} · <span class="sr-kind">${st ? KIND_DE[st.kind] : ''}</span></small></span><span class="sr-std ${cls}">${rot ? fmtClock(rot.std) : ''} ${left >= 0 ? `(${left}′)` : `(+${-left}′)`}</span>`,
          tasks: taskChips(state, a),
        },
      };
    });
    if (!at.length && !this.el.ta.querySelector('.empty')) this.el.ta.innerHTML = '<div class="empty">Keine Flugzeuge in Abfertigung.</div>';
    setHTML(this.root.querySelector('#gp-c-ta'), String(at.length));

    // Fuhrpark
    const fs = fleetSummary(state);
    const fleetItems = Object.keys(VEH_TYPES).map((k) => ({ k, ...fs[k] }));
    syncList(this.el.fleet, fleetItems, (x) => x.k, (x) => {
      const vt = VEH_TYPES[x.k];
      const auto = state.auto.ground || state.settings.vehAuto[x.k];
      const vs = state.vehicles.filter((v) => v.type === x.k);
      const dots = vs.map((v) => `<i class="dot ${v.brokenUntil > state.time ? 'broken' : v.st === 'idle' || v.st === 'return' ? '' : 'busy'}" title="${v.name}"></i>`).join('');
      return {
        cls: 'fleet-item',
        html: `<span class="fn">${vt.name}</span><button class="switch ${auto ? 'on' : ''}" data-vauto="${x.k}" title="Automatisch disponieren"></button><span class="fc">${x.total - x.busy - x.broken} frei / ${x.total}</span><span></span><div class="dots">${dots}</div>`,
      };
    });
  }
}
