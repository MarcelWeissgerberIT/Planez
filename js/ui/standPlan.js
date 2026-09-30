// Positionsplan (Gantt) für das Vorfeld: je Parkposition ein Zeitstrahl über die nächsten Stunden –
// Belegung bis TOBT, reservierte Ankünfte, Überschneidungen; Ankünfte per Ziehen auf eine Position legen
import { AC_TYPES, AIRLINES } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { standFits, standFree, assignStand, releaseReservation } from '../sim/ground.js';
import { fmtClock, esc, clamp } from '../util.js';
import { distToLand } from './tower.js';
import { toast } from './dom.js';
import { sfx } from '../audio.js';

const BEFORE = 15 * 60, SPAN = 3 * 3600;
const INB = new Set([PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND, PH.FINAL, PH.MISSED, PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN]);
const KIND = { contact: 'Gebäude', remote: 'Vorfeld', cargo: 'Fracht' };

// geschätzte Ankunft an der Position (Spielsekunden)
function etaStand(state, ac) {
  if (ac.mode === 'air') {
    const d = distToLand(ac);
    const spd = Math.max(140, ac.spd || 200);
    return state.time + (d / spd) * 3600 + (ac.phase === PH.HOLD ? 6 * 60 : 0) + 7 * 60;
  }
  return state.time + (ac.phase === PH.TAXI_IN ? 3 : 6) * 60;
}
// geplantes Ende der Standzeit
function endOf(state, ac, start) {
  const rot = state.rots[ac.rot];
  const turn = (AC_TYPES[ac.type].turn || 40) * 60;
  if (!rot) return start + turn;
  return Math.max(rot.tobt || rot.std, start + turn);
}

export class StandPlan {
  constructor(game) {
    this.game = game;
    const el = document.createElement('div');
    el.id = 'splan';
    el.className = 'hidden';
    el.innerHTML = `<div class="sp-head"><b>📊 Positionsplan</b><small>nächste 3 Stunden · Ankünfte ohne Position auf eine freie, passende Zeile ziehen</small><span class="sp-legend"><i class="occ"></i>belegt bis TOBT <i class="res"></i>reserviert <i class="late"></i>Überschneidung</span><button class="icon-btn" data-sp-close aria-label="Schließen">✕</button></div>
      <div class="sp-body"><div class="sp-grid"></div><aside class="sp-side"><div class="sp-sh">Ohne Position</div><div class="sp-queue"></div><div class="sp-sh">Später erwartet</div><div class="sp-later"></div></aside></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.grid = el.querySelector('.sp-grid');
    this.queue = el.querySelector('.sp-queue');
    this.later = el.querySelector('.sp-later');
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-sp-close]')) this.toggle(false);
      const sel = e.target.closest('[data-spsel]');
      if (sel && !this.drag) this.game.select(sel.dataset.spsel, true);
    });
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }
  toggle(on = !this.isOpen()) {
    this.el.classList.toggle('hidden', !on);
    document.getElementById('game').classList.toggle('splan-on', on);
    if (on) this.update(this.game.state, true);
  }

  rows(state) {
    const t0 = state.time - BEFORE;
    const x = (t) => clamp(((t - t0) / (SPAN + BEFORE)) * 100, 0, 100);
    const stands = state.stands.filter((s) => s.built);
    const bars = new Map(stands.map((s) => [s.id, []]));
    for (const ac of state.acs) {
      if (!ac.stand || !bars.has(ac.stand)) continue;
      const rot = state.rots[ac.rot];
      const al = AIRLINES[ac.airline] || AIRLINES.AUR;
      if (ac.phase === PH.STAND || ac.phase === PH.PUSH) {
        const start = rot && rot.onBlock ? rot.onBlock : state.time - 600;
        const end = ac.phase === PH.PUSH ? state.time + 180 : rot ? rot.tobt || rot.std : state.time + 1800;
        bars.get(ac.stand).push({ ac, kind: 'occ', start, end, col: al.color });
      } else if (INB.has(ac.phase)) {
        const start = etaStand(state, ac);
        bars.get(ac.stand).push({ ac, kind: 'res', start, end: endOf(state, ac, start), col: al.color });
      }
    }
    // Überschneidungen markieren
    for (const list of bars.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) if (list[i].start < list[i - 1].end) list[i].late = Math.round((list[i - 1].end - list[i].start) / 60);
    }
    // Zeitachse
    let axis = '';
    const step = window.innerWidth < 760 ? 3600 : 1800;
    const first = Math.ceil(t0 / step) * step;
    for (let t = first; t < t0 + SPAN + BEFORE; t += step) axis += `<span style="left:${x(t)}%">${fmtClock(t)}</span>`;
    let h = `<div class="sp-row sp-axis"><div class="sp-lab"></div><div class="sp-track">${axis}<i class="sp-now" style="left:${x(state.time)}%"></i></div></div>`;
    for (const st of stands) {
      const list = bars.get(st.id);
      const free = standFree(st);
      const lastEnd = list.reduce((m, b) => Math.max(m, b.end), 0);
      const hint = free ? 'frei' : lastEnd > state.time ? `frei ab ${fmtClock(lastEnd)}` : '';
      h += `<div class="sp-row" data-sprow="${st.id}"><div class="sp-lab"><span><b>P${st.id}</b> <small>${KIND[st.kind]} ${st.size}${st.closed ? ' · gesperrt' : ''}</small></span><em class="${free ? 'free' : ''}">${hint}</em></div><div class="sp-track">`;
      for (let t = first; t < t0 + SPAN + BEFORE; t += step) h += `<i class="sp-tick" style="left:${x(t)}%"></i>`;
      h += `<i class="sp-now" style="left:${x(state.time)}%"></i>`;
      for (const b of list) {
        const l = x(b.start), r = x(b.end);
        if (r <= 0 || l >= 100) continue;
        h += `<div class="sp-bar ${b.kind}${b.late ? ' late' : ''}" data-spsel="${b.ac.id}" ${b.kind === 'res' && b.ac.phase !== PH.TAXI_IN ? `data-spdrag="${b.ac.id}"` : ''} style="left:${l}%;width:${Math.max(2.5, r - l)}%;--c:${b.col}" title="${esc(b.ac.cs)} · ${AC_TYPES[b.ac.type].name} · ${fmtClock(b.start)}–${fmtClock(b.end)}${b.late ? ` · ${b.late} min Überschneidung – muss warten` : ''}"><span>${esc(b.ac.cs)}</span><small>${b.ac.type}</small>${b.late ? '<b>!</b>' : ''}</div>`;
      }
      h += `</div></div>`;
    }
    return h;
  }

  update(state, force = false) {
    if (!this.isOpen() || !state) return;
    if (this.drag && !force) return; // während des Ziehens nicht neu aufbauen
    // nur alle 1,5 s neu aufbauen (Zeitachse wandert), damit Klicks und Hover ruhig bleiben
    const now = performance.now();
    if (!force && now - (this.built || 0) < 1500) return;
    this.built = now;
    const h = this.rows(state);
    if (this.grid._h !== h) {
      this.grid.innerHTML = h;
      this.grid._h = h;
    }
    const q = state.acs.filter((a) => a.arr && !a.stand && INB.has(a.phase)).sort((a, b) => etaStand(state, a) - etaStand(state, b));
    const qh = q.length
      ? q.map((a) => `<div class="sp-chip ${a.phase === PH.TAXI_WAIT || a.phase === PH.VACATED ? 'wait' : ''}" data-spdrag="${a.id}" data-spsel="${a.id}"><i style="background:${(AIRLINES[a.airline] || AIRLINES.AUR).color}"></i><b>${esc(a.cs)}</b><small>${a.type} · ${AC_TYPES[a.type].size}${AC_TYPES[a.type].cargo ? ' · Fracht' : ''} · ${a.phase === PH.TAXI_WAIT || a.phase === PH.VACATED ? 'wartet!' : `~${fmtClock(etaStand(state, a))}`}</small></div>`).join('')
      : '<div class="sp-empty">Alle Ankünfte haben eine Position.</div>';
    if (this.queue._h !== qh) {
      this.queue.innerHTML = qh;
      this.queue._h = qh;
    }
    const later = Object.values(state.rots)
      .filter((r) => r.status === 'planned' && r.sta > state.time && r.sta < state.time + SPAN)
      .sort((a, b) => a.sta - b.sta)
      .slice(0, 14);
    const lh = later.length ? later.map((r) => `<div class="sp-chip ghost"><i style="background:${(AIRLINES[r.airline] || AIRLINES.AUR).color}"></i><b>${esc(r.arrNo)}</b><small>${r.type} · ${AC_TYPES[r.type].size} · STA ${fmtClock(r.sta)}</small></div>`).join('') : '<div class="sp-empty">Keine weiteren Ankünfte.</div>';
    if (this.later._h !== lh) {
      this.later.innerHTML = lh;
      this.later._h = lh;
    }
  }

  // ---------- Ziehen ----------
  down(e) {
    const d = e.target.closest('[data-spdrag]');
    if (!d || e.button > 0) return;
    const ac = this.game.state.acs.find((a) => a.id === d.dataset.spdrag);
    if (!ac) return;
    this.drag = { id: ac.id, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
    this.game.panelHold = true;
  }
  move(e) {
    const dr = this.drag;
    if (!dr) return;
    if (!dr.moved && Math.hypot(e.clientX - dr.x0, e.clientY - dr.y0) < 6) return;
    const s = this.game.state;
    const ac = s.acs.find((a) => a.id === dr.id);
    if (!ac) return;
    if (!dr.moved) {
      dr.moved = true;
      dr.ghost = document.createElement('div');
      dr.ghost.className = 'sp-ghost';
      dr.ghost.textContent = `${ac.cs} · ${ac.type}`;
      document.body.appendChild(dr.ghost);
      // passende Zeilen hervorheben
      for (const row of this.grid.querySelectorAll('[data-sprow]')) {
        const st = s.stands.find((x) => x.id === Number(row.dataset.sprow));
        const ok = st && standFits(st, ac) && (standFree(st) || st.resv === ac.id);
        row.classList.add(ok ? 'drop-ok' : 'drop-no');
      }
    }
    dr.ghost.style.left = `${e.clientX + 12}px`;
    dr.ghost.style.top = `${e.clientY + 8}px`;
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sprow]');
    for (const r of this.grid.querySelectorAll('.drop-hover')) r.classList.remove('drop-hover');
    if (row) row.classList.add('drop-hover');
  }
  up(e) {
    const dr = this.drag;
    if (!dr) return;
    this.drag = null;
    setTimeout(() => (this.game.panelHold = false), 60);
    if (dr.ghost) dr.ghost.remove();
    for (const r of this.grid.querySelectorAll('.drop-ok, .drop-no, .drop-hover')) r.classList.remove('drop-ok', 'drop-no', 'drop-hover');
    if (!dr.moved) return;
    const s = this.game.state;
    const ac = s.acs.find((a) => a.id === dr.id);
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sprow]');
    if (!ac || !row) return;
    const id = Number(row.dataset.sprow);
    if (ac.stand === id) return;
    const st = s.stands.find((x) => x.id === id);
    if (!st || !standFits(st, ac)) return toast(`${ac.cs} (${AC_TYPES[ac.type].size}${AC_TYPES[ac.type].cargo ? ', Fracht' : ''}) passt nicht auf P${id}`, 'warn');
    if (!standFree(st)) return toast(`P${id} ist ${st.occ ? 'belegt' : 'schon reserviert'}`, 'warn');
    if (ac.phase === PH.TAXI_IN) return toast(`${ac.cs} rollt schon zur Position`, 'warn');
    releaseReservation(s, ac);
    if (assignStand(s, ac, id)) {
      sfx.click();
      toast(`${ac.cs} → P${id}`, 'good', 1800);
      this.update(s, true);
    }
  }
}
