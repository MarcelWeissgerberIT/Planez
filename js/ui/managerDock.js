// Kompakter Leitstand (Manager/Beobachter): das Wichtigste auf einen Blick, Details in der Management-Zentrale
import { setHTML } from './dom.js';
import { esc, fmtMoney, fmtClock } from '../util.js';
import { projects, remainingHours } from '../sim/construction.js';
import { fuelState, FUEL } from '../sim/fuel.js';
import { rwyCond, brakingAction, BRAKE_DE, hasRwy2 } from '../sim/runway.js';
import { goalsState, activeGoals, goalText, goalFraction, RANKS } from '../sim/goals.js';
import { PH } from '../sim/aircraft.js';
import { fmtHours, realMinutes } from './projects.js';

export class ManagerDock {
  constructor(root, game, observer = false) {
    this.root = root;
    this.game = game;
    root.innerHTML = `
      <div class="p-head"><div class="p-title">${observer ? '👁️ Beobachter' : '💼 Leitstand'} <small id="mp-sub"></small></div></div>
      <div class="p-body dock-body">
        <button class="dock-open" data-open="over"><span>💼</span><b>Management-Zentrale</b><kbd>O</kbd></button>
        ${observer ? '<button class="dock-open cine" data-cine><span>🎬</span><b>Kino-Modus</b><kbd>K</kbd></button>' : ''}
        <div id="dk-kpi"></div>
        <div class="p-sec"><span>Jetzt wichtig</span></div>
        <div id="dk-todo"></div>
        <div class="p-sec"><span>Baustellen</span><span class="cnt" id="dk-cnt">0</span></div>
        <div id="dk-sites"></div>
        <div class="p-sec"><span>Ziele</span></div>
        <div id="dk-goals"></div>
      </div>`;
    root.classList.add('dock');
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-cine]')) return window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
      const o = e.target.closest('[data-open]');
      if (o) return this.game.mgmt && this.game.mgmt.open(o.dataset.open);
      const sh = e.target.closest('[data-site]');
      if (sh) this.game.showSite && this.game.showSite(sh.dataset.site);
    });
  }

  update(s) {
    const t = s.stats.today;
    const L = s.ledger;
    const rev = Object.values(L.rev).reduce((a, b) => a + b, 0);
    const cost = Object.values(L.cost).reduce((a, b) => a + b, 0);
    const deps = t.onTime + t.delayed;
    const fu = fuelState(s);
    const cond = Math.round(rwyCond(s));
    const tile = (k, v, cls = '', open = '') => `<div class="k${open ? ' link' : ''}" ${open ? `data-open="${open}"` : ''}><span>${k}</span><b class="${cls}">${v}</b></div>`;
    setHTML(
      this.root.querySelector('#dk-kpi'),
      `<div class="kpis dock-kpis">${tile('Ergebnis heute', fmtMoney(rev - cost), rev - cost >= 0 ? 'pos' : 'neg', 'fin')}${tile('Ansehen', `${Math.round(s.reputation)}/100`, '', 'over')}${tile('Pünktlich', deps ? Math.round((t.onTime / deps) * 100) + ' %' : '—', '', 'over')}${tile('Bewegungen', t.mov, '', 'over')}${tile('Tanklager', `${Math.round(fu.stock)} t`, fu.stock < FUEL.cap * 0.15 ? 'neg' : '', 'fuel')}${tile('Piste', `${cond} % · ${BRAKE_DE[brakingAction(s)]}`, cond < 45 ? 'neg' : '', 'runways')}</div>`
    );
    // Aufgaben
    const todo = [];
    if (s.offers.length) todo.push(['contracts', '📨', `${s.offers.length} Vertragsangebot${s.offers.length > 1 ? 'e' : ''} prüfen`, 'warn']);
    const waiting = s.acs.filter((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand).length;
    if (waiting) todo.push(['stands', '🅿️', `${waiting} Flugzeug${waiting > 1 ? 'e warten' : ' wartet'} auf eine Position`, 'bad']);
    if (fu.stock < FUEL.cap * 0.25) todo.push(['fuel', '⛽', `Tanklager bei ${Math.round((fu.stock / FUEL.cap) * 100)} % – Kerosin kaufen`, fu.stock < FUEL.cap * 0.12 ? 'bad' : 'warn']);
    if (s.cash < 0) todo.push(['fin', '🏦', 'Kasse im Minus – Kredit oder Kosten senken', 'bad']);
    if (cond < 55 && !projects(s).some((p) => p.kind === 'rwy')) todo.push(['runways', '🛬', `Pistenzustand ${cond} % – Wartung beauftragen`, 'warn']);
    if (!hasRwy2(s) && s.cash > 9500000 && !projects(s).some((p) => p.target === 'rwy2')) todo.push(['runways', '🛫', 'Genug Geld für die Parallelbahn', 'info']);
    if ((t.complaints || 0) > 25 && !s.settings.curfew) todo.push(['fees', '📢', `${t.complaints} Lärmbeschwerden heute`, 'warn']);
    if (!todo.length) todo.push(['over', '✅', 'Alles im grünen Bereich', 'good']);
    setHTML(this.root.querySelector('#dk-todo'), todo.map(([k, i, txt, cls]) => `<button class="dock-todo ${cls}" data-open="${k}"><span>${i}</span><span>${esc(txt)}</span><i>›</i></button>`).join(''));
    // Baustellen
    const ps = projects(s);
    setHTML(this.root.querySelector('#dk-cnt'), String(ps.length));
    setHTML(
      this.root.querySelector('#dk-sites'),
      ps.length
        ? ps.map((p) => `<div class="dock-site" data-site="${p.id}" title="Baustelle zeigen"><div class="row"><span>🏗️ ${esc(p.name)}</span><small>${p.status === 'waiting' ? 'wartet' : Math.floor(p.prog * 100) + ' % · ' + fmtHours(remainingHours(p)) + ' · ' + realMinutes(s, remainingHours(p))}</small></div><div class="bar"><i style="width:${p.prog * 100}%;background:#fbbf24"></i></div></div>`).join('')
        : '<div class="empty">Keine Baustelle – Ausbau in der Zentrale starten.</div>'
    );
    const G = goalsState(s);
    setHTML(
      this.root.querySelector('#dk-goals'),
      `<div class="dock-rank" data-open="goals">🏅 ${RANKS[G.rank].name} · ${G.xp} XP</div>` + activeGoals(s).map((g) => `<div class="dock-goal"><small>${esc(goalText(g))}</small><div class="bar"><i style="width:${goalFraction(s, g) * 100}%;background:var(--manager)"></i></div></div>`).join('')
    );
    setHTML(this.root.querySelector('#mp-sub'), `${fmtClock(s.time)} · ${fmtMoney(s.cash)}`);
  }
}
