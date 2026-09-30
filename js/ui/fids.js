// Anzeigetafel (FIDS) im Fallblatt-Stil: Abflüge und Ankünfte mit Zeit, Flug, Ziel/Herkunft, Position und Status
import { CITIES, AIRLINES } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { fmtClock, esc } from '../util.js';
import { sfx } from '../audio.js';

const W = { time: 5, flight: 7, city: 13, gate: 3, status: 16 };
const pad = (s, n) => String(s || '').toUpperCase().slice(0, n).padEnd(n, ' ');

function depStatus(state, r, ac) {
  if (r.status === 'departed') return ['GESTARTET', 'ok'];
  if (r.status === 'cancelled') return ['ANNULLIERT', 'bad'];
  if (ac) {
    if (ac.phase === PH.TAKEOFF || ac.phase === PH.DEPART) return ['GESTARTET', 'ok'];
    if ([PH.PUSH, PH.STARTUP, PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED].includes(ac.phase)) return ['ABGEFERTIGT', 'ok'];
    if (ac.ta) {
      const b = ac.ta.tasks.board;
      if (b && b.st === 'done') return ['GATE GESCHLOSSEN', 'warn'];
      if (b && b.st === 'active') return ['BOARDING', 'go'];
    }
  }
  const est = r.tobt || r.std;
  if (est > r.std + 5 * 60) return [`NEUE ZEIT ${fmtClock(est)}`, 'bad'];
  if (r.std - state.time < 50 * 60) return ['ZUM GATE', 'go'];
  return ['PLANMÄSSIG', ''];
}
function arrStatus(state, r, ac) {
  if (r.status === 'diverted') return ['UMGELEITET', 'bad'];
  if (r.status === 'cancelled') return ['ANNULLIERT', 'bad'];
  if (ac && ac.phase === PH.STAND) return ['AN POSITION', 'ok'];
  if (r.status === 'landed' || (ac && [PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN].includes(ac.phase))) return ['GELANDET', 'ok'];
  if (ac && (ac.phase === PH.FINAL || ac.phase === PH.APPROACH)) return ['IM ANFLUG', 'go'];
  const eta = r.sta + Math.max(0, r.arrDelay || 0) * 60;
  if ((r.arrDelay || 0) > 10) return [`ERWARTET ${fmtClock(eta)}`, 'bad'];
  if (ac) return ['IM ANFLUG', 'go'];
  return ['PLANMÄSSIG', ''];
}

export class Fids {
  constructor(game) {
    this.game = game;
    this.tab = 'dep';
    this.prev = {};
    const el = document.createElement('div');
    el.id = 'fids';
    el.className = 'hidden';
    el.innerHTML = `<div class="fd-box"><div class="fd-head"><div class="fd-tabs"><button data-fd="dep" class="on">🛫 Abflug <small>Departures</small></button><button data-fd="arr">🛬 Ankunft <small>Arrivals</small></button></div><div class="fd-clock"></div><button class="icon-btn" data-fd-close aria-label="Schließen">✕</button></div>
      <div class="fd-cols"><span>Zeit</span><span>Flug</span><span class="c">Nach</span><span>Pos.</span><span>Status</span></div><div class="fd-rows"></div></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.rowsEl = el.querySelector('.fd-rows');
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-fd-close]') || e.target === el) return this.toggle(false);
      const t = e.target.closest('[data-fd]');
      if (t) {
        this.tab = t.dataset.fd;
        for (const b of el.querySelectorAll('[data-fd]')) b.classList.toggle('on', b.dataset.fd === this.tab);
        el.querySelector('.fd-cols .c').textContent = this.tab === 'dep' ? 'Nach' : 'Von';
        this.prev = {};
        this.update(true);
      }
      const row = e.target.closest('[data-fdac]');
      if (row && row.dataset.fdac) this.game.select(row.dataset.fdac, true);
    });
  }
  isOpen() {
    return !this.el.classList.contains('hidden');
  }
  toggle(on = !this.isOpen()) {
    this.el.classList.toggle('hidden', !on);
    if (on) {
      this.prev = {};
      this.update(true);
    }
  }

  rows() {
    const s = this.game.state;
    const byRot = new Map(s.acs.map((a) => [a.rot, a]));
    const list = [];
    for (const r of Object.values(s.rots)) {
      const ac = byRot.get(r.id);
      if (this.tab === 'dep') {
        if (r.std < s.time - 25 * 60 || r.std > s.time + 5 * 3600) continue;
        if (r.status === 'departed' && r.atd && r.atd < s.time - 20 * 60) continue;
        const [st, cls] = depStatus(s, r, ac);
        list.push({ t: r.std, key: r.id, ac: ac ? ac.id : '', time: fmtClock(r.std), flight: r.depNo, city: CITIES[r.city]?.name || r.city, gate: ac && ac.stand ? `P${ac.stand}` : '', st, cls, al: r.airline });
      } else {
        if (r.sta < s.time - 40 * 60 || r.sta > s.time + 5 * 3600) continue;
        if (ac && ac.phase === PH.STAND && r.onBlock && r.onBlock < s.time - 20 * 60) continue;
        if (!ac && r.status !== 'planned' && r.status !== 'diverted') continue;
        const [st, cls] = arrStatus(s, r, ac);
        list.push({ t: r.sta, key: r.id, ac: ac ? ac.id : '', time: fmtClock(r.sta), flight: r.arrNo, city: CITIES[r.city]?.name || r.city, gate: ac && ac.stand ? `P${ac.stand}` : '', st, cls, al: r.airline });
      }
    }
    return list.sort((a, b) => a.t - b.t).slice(0, 14);
  }

  update(force = false) {
    if (!this.isOpen() || !this.game.state) return;
    const s = this.game.state;
    const clk = fmtClock(s.time);
    const ce = this.el.querySelector('.fd-clock');
    if (ce.textContent !== clk) ce.textContent = clk;
    const now = performance.now();
    if (!force && now - (this.last || 0) < 1200) return;
    this.last = now;
    const rows = this.rows();
    let flips = 0;
    const cell = (key, name, text, n, extra = '') => {
      const v = pad(text, n);
      const k = key + name;
      const changed = this.prev[k] !== undefined && this.prev[k] !== v;
      if (changed) flips++;
      this.prev[k] = v;
      return `<span class="fd-c ${name}${changed ? ' flip' : ''} ${extra}">${[...v].map((ch) => `<i>${ch === ' ' ? '&nbsp;' : esc(ch)}</i>`).join('')}</span>`;
    };
    let h = '';
    for (const r of rows) {
      const col = (AIRLINES[r.al] || {}).color || '#94a3b8';
      h += `<div class="fd-row" data-fdac="${r.ac}"><b class="fd-al" style="background:${col}"></b>${cell(r.key, 'time', r.time, W.time)}${cell(r.key, 'flight', r.flight, W.flight)}${cell(r.key, 'city', r.city, W.city)}${cell(r.key, 'gate', r.gate, W.gate)}${cell(r.key, 'status', r.st, W.status, r.cls)}</div>`;
    }
    if (!rows.length) h = '<div class="fd-empty">Keine Flüge in den nächsten Stunden.</div>';
    this.rowsEl.innerHTML = h;
    if (flips && !force && s.settings.sound !== false) sfx.flap && sfx.flap(Math.min(flips, 6));
  }
}
