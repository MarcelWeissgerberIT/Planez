// Vorfeld-Leitstand: Parkpositionen, Turnaround, Fahrzeuge
import { icon } from './icons.js';
import { StandPlan } from './standPlan.js';
import { AC_TYPES, TASKS, TASK_ORDER, VEH_TYPES, CITIES } from '../config.js';
import { PH, PHASE_DE } from '../sim/aircraft.js';
import { dispatch, assignStand, releaseReservation, standFits, standFree, fleetSummary, efficiency } from '../sim/ground.js';
import { fmtClock, esc, clamp } from '../util.js';
import { syncList, setHTML, toast } from './dom.js';
import { sfx } from '../audio.js';
import { flagHtml } from './marks.js';
import { qm } from './glossary.js';
import { acdmLine } from './tower.js';
import { estimateReady } from '../sim/acdm.js';
import { TASK_ORDER as ORDER } from '../config.js';
import { fuelState, FUEL, pending } from '../sim/fuel.js';

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
      if (k === 'fuel' && t.uplift && (st === 'active' || t.delivered > 0.5) && st !== 'done') lbl = `${Math.round(t.delivered)}/${Math.round(t.uplift)} t`;
      if (st === 'active' && k === 'push') lbl = 'bereit';
      if (st === 'assigned') lbl = 'unterwegs';
      if (st === 'ready' && !t.need) lbl = 'Brücke';
      const title = `${def.name}${t.need ? ' · ' + VEH_TYPES[t.need].name : ' · Fluggastbrücke'}${k === 'fuel' && t.uplift ? ` · ${Math.round(t.uplift)} t Kerosin` : ''}`;
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
        <div class="p-title">${icon('vest')} Vorfeld-Leitstand <small id="gp-eff"></small></div>
      </div>
      <div class="p-body">
        <div id="gp-alert"></div>
        <div class="p-sec"><span>Ankünfte · Parkpositionen${qm('inb')}</span><span class="cnt" id="gp-c-inb">0</span></div>
        <div class="toggle-row"><span>Positionen automatisch vergeben</span><button class="switch" id="gp-sauto"></button></div>
        <button class="btn gp-plan" id="gp-plan" title="Zeitstrahl aller Positionen – Ankünfte per Ziehen zuweisen (Taste G)">📊 Positionsplan <kbd>G</kbd></button>
        <div id="gp-inb"></div>
        <div class="p-sec"><span>Abfertigung (Turnaround)${qm('ta')}</span><span class="cnt" id="gp-c-ta">0</span></div>
        <div class="gp-bar"><button class="btn btn-good" id="gp-all" title="Alle gelben Aufgaben mit freien Fahrzeugen bedienen (Taste D)">⚡ Alles bedienen <kbd>D</kbd></button><small>Dringendste oben · Balken = Zeit bis TOBT, ▼ = voraussichtlich fertig</small></div>
        <div id="gp-ta"></div>
        <div class="p-sec"><span>Fuhrpark · Auto-Disposition${qm('fleet')}</span></div>
        <div class="fleet" id="gp-fleet"></div>
        <div class="p-sec"><span>Tanklager &amp; Tankwagen${qm('fuel')}</span></div>
        <div id="gp-fuel"></div>
      </div>`;
    this.el = {
      inb: root.querySelector('#gp-inb'),
      ta: root.querySelector('#gp-ta'),
      fleet: root.querySelector('#gp-fleet'),
      sauto: root.querySelector('#gp-sauto'),
      eff: root.querySelector('#gp-eff'),
      alert: root.querySelector('#gp-alert'),
      fuel: root.querySelector('#gp-fuel'),
    };
    // solange die Maus über der Tafel ist, nicht umsortieren (sonst springt die Zeile unter dem Zeiger weg)
    this.el.ta.addEventListener('pointerenter', () => (this.hoverTa = true));
    this.el.ta.addEventListener('pointerleave', () => (this.hoverTa = false));
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
    this.el.sauto.addEventListener('click', () => {
      const s = this.game.state;
      s.settings.standAuto = !s.settings.standAuto;
    });
  }

  // alle bereiten Aufgaben mit freien Fahrzeugen bedienen (dringendste Abfertigung zuerst)
  dispatchAll(s) {
    let n = 0, miss = 0;
    const list = s.acs.filter((a) => (a.phase === PH.STAND || a.phase === PH.PUSH) && a.ta).sort((a, b) => this.slack(s, a) - this.slack(s, b));
    for (const ac of list) {
      for (const k of ORDER) {
        const t = ac.ta.tasks[k];
        if (!t || t.st !== 'ready' || !t.need) continue;
        const r = dispatch(s, ac, k);
        if (r.ok) n++;
        else miss++;
      }
    }
    if (n) sfx.click();
    toast(n ? `⚡ ${n} Fahrzeug${n > 1 ? 'e' : ''} losgeschickt${miss ? ` · ${miss} Aufgabe${miss > 1 ? 'n warten' : ' wartet'} auf freie Fahrzeuge` : ''}` : miss ? `Keine freien Fahrzeuge für ${miss} Aufgabe${miss > 1 ? 'n' : ''}` : 'Nichts zu tun', n ? 'good' : 'info', 2600);
  }

  // Puffer bis TOBT (Sekunden, negativ = wird zu spät)
  slack(s, ac) {
    const rot = s.rots[ac.rot];
    if (!rot) return 1e9;
    return (rot.tobt || rot.std) - estimateReady(s, ac);
  }

  key(e, s) {
    if (e.key === 'd' || e.key === 'D') {
      this.dispatchAll(s);
      return true;
    }
    return false;
  }

  onClick(e) {
    const s = this.game.state;
    if (e.target.closest('#gp-all')) return this.dispatchAll(s);
    if (e.target.closest('#gp-plan')) {
      if (!this.game.splan) this.game.splan = new StandPlan(this.game);
      return this.game.splan.toggle();
    }
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
    const vs = e.target.closest('[data-vsel]');
    if (vs) {
      const v = s.vehicles.find((x) => x.id === vs.dataset.vsel);
      if (v) {
        this.game.ui.sel = { type: 'veh', id: v.id };
        this.game.ui.selected = null;
        this.game.cam.focus(v.x, v.y);
      }
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
    const fu = fuelState(state);
    if (fu.stock < FUEL.cap * 0.12) alert += `<div class="card" style="border-color:var(--bad)">⛽ Tanklager fast leer (${Math.round(fu.stock)} t)${fu.orders.length ? ` – Lieferung ${fmtClock(Math.min(...fu.orders.map((o) => o.eta)))}` : ' – der Manager muss Kerosin bestellen'}. Tankwagen können kaum nachfüllen.</div>`;
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
          'inb-t': `<span class="cs" data-sel="${a.id}">${esc(a.cs)}${a.protocol ? ' 🎖️' : ''}</span> <small style="color:var(--muted)">${a.type} · ${AC_TYPES[a.type].size}</small>${flagHtml(a)}`,
          'inb-e': `<span class="eta">${need ? '⚠ wartet' : PHASE_DE[a.phase].split(' ')[0]} · ${eta}</span>`,
          'inb-s': locked ? `<b>P${a.stand}</b>` : `<select data-assign="${a.id}">${standOptions(state, a)}</select>`,
        },
      };
    });
    if (!inb.length && !this.el.inb.querySelector('.empty')) this.el.inb.innerHTML = '<div class="empty">Keine Ankünfte unterwegs.</div>';
    setHTML(this.root.querySelector('#gp-c-inb'), String(inb.length));

    // Turnaround-Tafel
    const slack = new Map();
    const at = state.acs.filter((a) => (a.phase === PH.STAND || a.phase === PH.PUSH) && a.ta);
    for (const a of at) slack.set(a.id, this.slack(state, a));
    at.sort((a, b) => slack.get(a.id) - slack.get(b.id));
    if (this.hoverTa && this.taOrder) {
      const pos = new Map(this.taOrder.map((id, i) => [id, i]));
      at.sort((a, b) => (pos.get(a.id) ?? 1e3) - (pos.get(b.id) ?? 1e3));
    }
    this.taOrder = at.map((a) => a.id);
    syncList(this.el.ta, at, (a) => a.id, (a) => {
      const rot = state.rots[a.rot];
      const st = state.stands.find((s) => s.id === a.stand);
      const left = rot ? Math.round((rot.std - state.time) / 60) : 0;
      const cls = left < 0 ? 'late' : left < 10 ? 'tight' : '';
      const sel = this.game.ui.selected === a.id;
      return {
        cls: `stand-row${sel ? ' sel' : ''}${left < 0 ? ' late' : ''}`,
        parts: {
          'sr-head': `<span class="sr-id">P${st ? st.id : '?'}</span><span class="sr-ac" data-sel="${a.id}">${esc(a.cs)}${a.protocol ? ' <span title="Staatsbesuch – pünktlich abfertigen">🎖️</span>' : ''}${flagHtml(a)} <small>${a.type} → ${CITIES[rot?.city]?.name || ''} · <span class="sr-kind">${st ? KIND_DE[st.kind] : ''}</span></small></span><span class="sr-std ${cls}">STD ${rot ? fmtClock(rot.std) : ''} ${left >= 0 ? `(${left}′)` : `(+${-left}′)`}</span>${acdmLine(state, a)}`,
          'sr-time': (() => {
            if (!rot) return '';
            const t0 = rot.onBlock || state.time, t1 = rot.tobt || rot.std;
            const span = Math.max(60, t1 - t0);
            const ready = estimateReady(state, a);
            const el = clamp((state.time - t0) / span, 0, 1), rd = clamp((ready - t0) / span, 0, 1.15);
            const sl = Math.round(slack.get(a.id) / 60);
            const c = sl < 0 ? 'bad' : sl < 5 ? 'warn' : 'good';
            return `<div class="sr-bar"><i style="width:${el * 100}%"></i><b class="${c}" style="left:${Math.min(100, rd * 100)}%"></b></div><span class="sr-slack ${c}">${a.phase === PH.PUSH ? 'Pushback' : sl >= 0 ? `Puffer ${sl}′` : `${-sl}′ zu spät`}</span>`;
          })(),
          tasks: taskChips(state, a),
        },
      };
    });
    if (!at.length && !this.el.ta.querySelector('.empty')) this.el.ta.innerHTML = '<div class="empty">Keine Flugzeuge in Abfertigung.</div>';
    setHTML(this.root.querySelector('#gp-c-ta'), String(at.length));

    // Fuhrpark
    const fs = fleetSummary(state);
    const fleetItems = Object.keys(VEH_TYPES).map((k) => ({ k, ...fs[k] }));
    // Tanklager & Tankwagen
    const fu2 = fuelState(state);
    const lvl = fu2.stock / FUEL.cap;
    const trucks = state.vehicles.filter((v) => v.type === 'fuel');
    const TST = { idle: 'bereit', drive: 'fährt zum Flugzeug', work: 'betankt', return: 'zurück', refill: 'fährt zum Tanklager', filling: 'wird befüllt', attached: '' };
    setHTML(this.el.fuel, `<div class="card"><div class="row"><span class="t">🛢️ Tanklager ${Math.round(fu2.stock)} t</span><span style="font-size:12px;color:var(--muted)">${Math.round(lvl * 100)} % von ${FUEL.cap} t${pending(state) ? ` · +${Math.round(pending(state))} t bestellt` : ''}</span></div><div class="bar"><i style="width:${lvl * 100}%;background:${lvl < 0.15 ? 'var(--bad)' : lvl < 0.3 ? 'var(--warn)' : 'var(--good)'}"></i></div>
      <div class="trucks">${trucks.map((v) => `<div class="truck" data-vsel="${v.id}" title="${esc(v.name)}"><span>${esc(v.name)}</span><span class="tl"><i style="width:${((v.load || 0) / FUEL.truckCap) * 100}%"></i></span><small>${Math.round(v.load || 0)} t · ${v.brokenUntil > state.time ? 'defekt' : TST[v.st] || v.st}</small></div>`).join('')}</div></div>`);
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
