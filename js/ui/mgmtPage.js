// Management-Zentrale: Vollbild-Seite im Menü-Stil mit Kategorien links und breitem Detailbereich
import { ManagerPanel } from './managerPanel.js';
import { setHTML } from './dom.js';
import { esc, fmtMoney, fmtClock, dayOf } from '../util.js';
import { projects } from '../sim/construction.js';
import { fuelState, FUEL } from '../sim/fuel.js';
import { rwyCond, hasRwy2 } from '../sim/runway.js';
import { loans } from '../sim/finance.js';
import { goalsState, RANKS } from '../sim/goals.js';
import { PH } from '../sim/aircraft.js';
import { RouteMap } from './routeMap.js';
import { rivalState } from '../sim/rival.js';

export const CATS = [
  ['over', 'Übersicht', 'Kennzahlen, Auslastung und Airline-Zufriedenheit'],
  ['contracts', 'Airlines & Verträge', 'Angebote prüfen, laufende Verbindungen verwalten'],
  ['rival', 'Wettbewerb', 'Marktanteil gegen Nordhafen, Züge der Konkurrenz'],
  ['sites', 'Baustellen', 'Laufende Bauprojekte mit Fortschritt und Restzeit'],
  ['runways', 'Pisten & Rollwege', 'Pistenzustand, Wartung, Parallelbahn, Schnellabrollwege, ILS'],
  ['stands', 'Parkpositionen', 'Positionen bauen und für Großraumjets ausbauen'],
  ['terminal', 'Terminal & Landseite', 'Shops, Sicherheit, Lounge, Parkhaus, Hotel, Marketing'],
  ['ops', 'Fuhrpark & Personal', 'Fahrzeuge kaufen, Personal, Fixkosten'],
  ['fuel', 'Kerosin', 'Tanklager, Marktpreis, Einkauf und Marge'],
  ['fees', 'Gebühren & Nachtflug', 'Entgelte, Nachtflugverbot, Lärm'],
  ['fin', 'Finanzen & Kredite', 'Umsatz, Kosten, Kontostand, Kredite'],
  ['goals', 'Ziele & Rang', 'Aufgaben, Prämien, Flughafen-Rang'],
];

export class ManagementPage {
  constructor(game) {
    this.game = game;
    this.cat = 'over';
    this.live = false;
    const el = document.createElement('div');
    el.id = 'mgmt';
    el.className = 'hidden';
    el.innerHTML = `<div class="mg-shade"></div>
      <aside class="mg-nav">
        <div class="mg-label">💼 Management-Zentrale</div>
        <div class="mg-name" id="mg-name"></div>
        <div class="mg-time" id="mg-time"></div>
        <nav class="mm-list" id="mg-list">${CATS.map(([k, n]) => `<button class="mm-item" data-cat="${k}"><span class="n"></span><span class="l"><b>${n}</b><small data-badge="${k}"></small></span></button>`).join('')}</nav>
        <div class="mg-foot">
          <button class="mm-toggle" id="mg-live"><span class="l"><b>Zeit läuft weiter</b><small>sonst ist das Spiel pausiert, solange die Zentrale offen ist</small></span><span class="switch"></span></button>
          <button class="mm-link" data-mg-close>← Zurück zum Flughafen (Esc)</button>
        </div>
      </aside>
      <section class="mg-main">
        <header class="mg-head"><div><div class="mg-kick" id="mg-kick"></div><h2 id="mg-title"></h2><p id="mg-desc"></p></div><button class="icon-btn" data-mg-close aria-label="Schließen">✕</button></header>
        <div class="mg-body" id="mg-body"></div>
      </section>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.body = el.querySelector('#mg-body');
    this.panel = new ManagerPanel(this.body, game, { page: this });
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cat]');
      if (c) return this.open(c.dataset.cat);
      if (e.target.closest('[data-mg-close]')) return this.close();
      if (e.target.closest('#mg-live')) {
        this.live = !this.live;
        const s = this.game.state;
        if (this.live) s.speed = this.prevSpeed || 1;
        else s.speed = 0;
        this.renderNav(s);
      }
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen()) return;
        if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.key !== 'Escape') return;
        if (document.getElementById('modal') && !document.getElementById('modal').classList.contains('hidden')) return;
        if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopImmediatePropagation();
          const i = CATS.findIndex(([k]) => k === this.cat);
          const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + CATS.length) % CATS.length;
          this.open(CATS[n][0]);
        } else e.stopImmediatePropagation();
      },
      true
    );
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  open(cat) {
    const s = this.game.state;
    if (!s) return;
    if (!this.isOpen()) {
      this.prevSpeed = s.speed || this.game.lastSpeed || 1;
      if (!this.live) s.speed = 0;
      this.el.classList.remove('hidden');
    }
    if (cat) this.cat = cat;
    this.body._html = null;
    this.body.scrollTop = 0;
    this.update(s, true);
  }

  close() {
    if (!this.isOpen()) return;
    this.el.classList.add('hidden');
    const s = this.game.state;
    if (s && !this.live) s.speed = this.prevSpeed || 1;
  }

  toggle(cat) {
    if (this.isOpen()) this.close();
    else this.open(cat);
  }

  renderNav(s) {
    const G = goalsState(s);
    setHTML(this.el.querySelector('#mg-name'), esc(s.name));
    setHTML(this.el.querySelector('#mg-time'), `Tag ${dayOf(s.time)} · ${fmtClock(s.time)} · ${fmtMoney(s.cash)} · ${RANKS[G.rank].name}`);
    const fu = fuelState(s);
    const waiting = s.acs.filter((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand).length;
    const ps = projects(s);
    const badge = {
      over: `Ansehen ${Math.round(s.reputation)} · pünktlich ${(() => { const t = s.stats.today; const d = t.onTime + t.delayed; return d ? Math.round((t.onTime / d) * 100) + ' %' : '—'; })()}`,
      contracts: s.offers.length ? `📨 ${s.offers.length} neue${s.offers.length > 1 ? '' : 's'} Angebot${s.offers.length > 1 ? 'e' : ''}` : `${s.contracts.length} Verträge`,
      rival: `Marktanteil ${Math.round(rivalState(s).share)} %${rivalState(s).feeCutUntil > s.time ? ' · 💸 Preiskampf' : rivalState(s).closedUntil > s.time ? ' · ⛔ Nordhafen zu' : ''}`,
      sites: ps.length ? `🏗️ ${ps.length} aktiv` : 'keine Baustelle',
      runways: `${hasRwy2(s) ? '2 Bahnen' : '1 Bahn'} · Zustand ${Math.round(rwyCond(s))} %${hasRwy2(s) ? ` / ${Math.round(rwyCond(s, 'S'))} %` : ''}`,
      stands: waiting ? `⚠ ${waiting} Flugzeug${waiting > 1 ? 'e' : ''} ohne Position` : `${s.stands.filter((x) => x.built).length} von ${s.stands.length} gebaut`,
      terminal: `Shops ${s.upgrades.retail} · Sicherheit ${s.upgrades.security} · Hotel ${s.upgrades.hotel ? '✓' : '—'}`,
      ops: `${s.vehicles.length} Fahrzeuge · ${s.staff} Personal`,
      fuel: `${fu.stock < FUEL.cap * 0.15 ? '⚠ ' : ''}${Math.round(fu.stock)} t · ${Math.round(fu.price)} €/t`,
      fees: s.settings.curfew ? '🌙 Nachtflugverbot aktiv' : `Nachtentgelt ${Math.round(s.fees.night ?? 600)} €`,
      fin: `${s.cash < 0 ? '⚠ ' : ''}Kasse ${fmtMoney(s.cash)}${loans(s).length ? ` · ${loans(s).length} Kredit${loans(s).length > 1 ? 'e' : ''}` : ''}`,
      goals: `${G.xp} XP · ${G.done} erreicht`,
    };
    const warn = { contracts: s.offers.length > 0, stands: waiting > 0, fuel: fu.stock < FUEL.cap * 0.15, fin: s.cash < 0, sites: ps.length > 0 };
    let n = 0;
    for (const b of this.el.querySelectorAll('#mg-list .mm-item')) {
      const k = b.dataset.cat;
      n++;
      b.querySelector('.n').textContent = String(n).padStart(2, '0');
      b.classList.toggle('on', k === this.cat);
      b.classList.toggle('attn', !!warn[k]);
      const sm = b.querySelector('small');
      if (sm.textContent !== badge[k]) sm.textContent = badge[k];
    }
    const live = this.el.querySelector('#mg-live');
    live.classList.toggle('on', this.live);
    live.querySelector('.switch').classList.toggle('on', this.live);
  }

  update(s, force = false) {
    if (!this.isOpen() || !s) return;
    this.renderNav(s);
    const c = CATS.find(([k]) => k === this.cat) || CATS[0];
    const i = CATS.indexOf(c);
    setHTML(this.el.querySelector('#mg-kick'), `${String(i + 1).padStart(2, '0')} · Management`);
    setHTML(this.el.querySelector('#mg-title'), c[1]);
    setHTML(this.el.querySelector('#mg-desc'), c[2]);
    if (force) this.body._html = null;
    // Eingaben (Schieberegler) nicht während der Bedienung neu aufbauen
    if (document.activeElement && this.body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    setHTML(this.body, this.panel.section(this.cat, s));
    // Streckennetz-Karte bleibt als eigenes Element erhalten und wird in den Platzhalter gehängt
    const slot = this.body.querySelector('.rm-slot');
    if (slot) {
      if (!this.routeMap) this.routeMap = new RouteMap(this.game);
      this.routeMap.attach(slot);
    }
  }
}
