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
import { boardBadge } from './board.js';
import { isCareer, stageOf, STAGES, stageUpStatus, careerState } from '../sim/career.js';
import { T, DEC } from '../i18n.js';

export const CATS = [
  ['career', T('Aufbau'), T('Ausbaustufen, Partner und Marketing – vom Grasplatz zum Drehkreuz')],
  ['over', T('Übersicht'), T('Kennzahlen, Auslastung und Airline-Zufriedenheit')],
  ['contracts', T('Airlines & Verträge'), T('Angebote prüfen, laufende Verbindungen verwalten')],
  ['rival', T('Wettbewerb'), T('Marktanteil gegen Nordhafen, Züge der Konkurrenz')],
  ['board', T('Aufsichtsrat'), T('Wochenziele, Vertrauen und Strategie – Sitzung alle 7 Tage')],
  ['sites', T('Baustellen'), T('Laufende Bauprojekte mit Fortschritt und Restzeit')],
  ['runways', T('Pisten & Rollwege'), T('Pistenzustand, Wartung, Parallelbahn, Schnellabrollwege, ILS')],
  ['stands', T('Parkpositionen'), T('Positionen bauen und für Großraumjets ausbauen')],
  ['terminal', T('Terminal & Landseite'), T('Shops, Sicherheit, Lounge, Parkhaus, Hotel, Marketing')],
  ['ops', T('Fuhrpark & Personal'), T('Fahrzeuge kaufen, Personal, Fixkosten')],
  ['fuel', T('Kerosin'), T('Tanklager, Marktpreis, Einkauf und Marge')],
  ['fees', T('Gebühren & Nachtflug'), T('Entgelte, Nachtflugverbot, Lärm')],
  ['fin', T('Finanzen & Kredite'), T('Umsatz, Kosten, Kontostand, Kredite')],
  ['goals', T('Ziele & Rang'), T('Aufgaben, Prämien, Flughafen-Rang')],
];

// Namen und Untertitel am kleinen Platz (Aufbau-Modus: Grasplatz, Verkehrslandeplatz)
const SMALL_CAT = {
  0: {
    stands: [T('Abstellplätze'), T('Wiese für Kleinflugzeuge – wer steht wo, und wann es mehr Platz gibt')],
    runways: [T('Graspiste'), T('Zustand der Graspiste, mähen und walzen')],
    ops: [T('Helfer & Fuhrpark'), T('Platzwart, Flugleitung und Helfer – Fahrzeuge ab Verkehrslandeplatz')],
    fees: [T('Gebühren'), T('Landeentgelt und Fluggastentgelt')],
  },
  1: {
    stands: [T('Abstellplätze & Vorfeld'), T('Wiese für Kleinflugzeuge und Vorfeld für Turboprops')],
    runways: [T('Piste & Rollwege'), T('Zustand der Asphaltbahn und Pflege')],
    ops: [T('Fuhrpark & Personal'), T('Erste Fahrzeuge für die Turboprops, Personal, Fixkosten')],
  },
};
export function catInfo(s, k) {
  const c = CATS.find((x) => x[0] === k) || CATS[0];
  const o = isCareer(s) && SMALL_CAT[stageOf(s)] && SMALL_CAT[stageOf(s)][c[0]];
  return o ? [c[0], ...o] : c;
}

// Bereiche, die es am Grasplatz/Verkehrslandeplatz noch nicht gibt (Aufbau-Modus)
const SMALL_HIDE = new Set(['rival', 'board', 'terminal', 'fuel']);

export class ManagementPage {
  constructor(game) {
    this.game = game;
    this.cat = 'over';
    this.live = false;
    const el = document.createElement('div');
    el.id = 'mgmt';
    el.className = 'hidden';
    el.innerHTML = T`<div class="mg-shade"></div>
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
          const gs = this.game.state;
          const list = CATS.filter(([k]) => (k !== 'career' || isCareer(gs)) && !(isCareer(gs) && stageOf(gs) < 2 && SMALL_HIDE.has(k)));
          const i = list.findIndex(([k]) => k === this.cat);
          const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
          this.open(list[n][0]);
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
    if (this.cat === 'career' && !isCareer(s)) this.cat = 'over';
    if (isCareer(s) && stageOf(s) < 2 && SMALL_HIDE.has(this.cat)) this.cat = 'career';
    if (!cat && isCareer(s) && !this.seenCareer) (this.cat = 'career'), (this.seenCareer = true);
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
    setHTML(this.el.querySelector('#mg-time'), T`Tag ${dayOf(s.time)} · ${fmtClock(s.time)} · ${fmtMoney(s.cash)} · ${isCareer(s) ? STAGES[stageOf(s)].name : RANKS[G.rank].name}`);
    const fu = fuelState(s);
    const waiting = s.acs.filter((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand).length;
    const ps = projects(s);
    const small = isCareer(s) && stageOf(s) < 2;
    const ga = s.stands.filter((x) => x.ga && !x.closed && x.built);
    const gaFree = ga.filter((x) => !x.occ && !x.resv).length;
    const badge = {
      over: small ? T`Ansehen ${Math.round(s.reputation)} · Bekanntheit ${Math.round(careerState(s).fame)}` : T`Ansehen ${Math.round(s.reputation)} · pünktlich ${(() => { const t = s.stats.today; const d = t.onTime + t.delayed; return d ? Math.round((t.onTime / d) * 100) + ' %' : '—'; })()}`,
      contracts: s.offers.length ? (s.offers.length > 1 ? T`📨 ${s.offers.length} neue Angebote` : T`📨 ${s.offers.length} neues Angebot`) : T`${s.contracts.length} Verträge`,
      rival: T`Marktanteil ${Math.round(rivalState(s).share)} %${rivalState(s).feeCutUntil > s.time ? T(' · 💸 Preiskampf') : rivalState(s).closedUntil > s.time ? T(' · ⛔ Nordhafen zu') : ''}`,
      board: boardBadge(s),
      sites: ps.length ? T`🏗️ ${ps.length} aktiv` : T('keine Baustelle'),
      runways: T`${hasRwy2(s) ? T('2 Bahnen') : T('1 Bahn')} · Zustand ${Math.round(rwyCond(s))} %${hasRwy2(s) ? ` / ${Math.round(rwyCond(s, 'S'))} %` : ''}`,
      stands: waiting ? (waiting > 1 ? T`⚠ ${waiting} Flugzeuge ohne Position` : T`⚠ ${waiting} Flugzeug ohne Position`) : small ? T`${gaFree} von ${ga.length} Wiesenplätzen frei` : T`${s.stands.filter((x) => x.built && !x.ga).length} von ${s.stands.filter((x) => !x.ga).length} gebaut`,
      terminal: T`Shops ${s.upgrades.retail} · Sicherheit ${s.upgrades.security} · Hotel ${s.upgrades.hotel ? '✓' : '—'}`,
      ops: isCareer(s) && stageOf(s) === 0 ? T`${s.staff} Leute am Platz · keine Fahrzeuge` : T`${s.vehicles.length} Fahrzeuge · ${s.staff} Personal`,
      fuel: `${fu.stock < FUEL.cap * 0.15 ? '⚠ ' : ''}${Math.round(fu.stock)} t · ${Math.round(fu.price)} €/t`,
      fees: isCareer(s) && stageOf(s) === 0 ? T`Landeentgelt ${String(s.fees.landing).replace('.', DEC)} €/t · nur bei Tag` : s.settings.curfew ? T('🌙 Nachtflugverbot aktiv') : T`Nachtentgelt ${Math.round(s.fees.night ?? 600)} €`,
      fin: T`${s.cash < 0 ? '⚠ ' : ''}Kasse ${fmtMoney(s.cash)}${loans(s).length ? (loans(s).length > 1 ? T` · ${loans(s).length} Kredite` : T` · ${loans(s).length} Kredit`) : ''}`,
      goals: T`${G.xp} XP · ${G.done} erreicht`,
      career: (() => {
        if (!isCareer(s)) return '';
        const S = stageUpStatus(s);
        return `${STAGES[stageOf(s)].icon} ${STAGES[stageOf(s)].name}${S ? (S.building ? ` · 🏗️ ${Math.floor(S.building.prog * 100)} %` : T` · ${S.reqs.filter((r) => r.ok).length}/${S.reqs.length} Bedingungen`) : ''}`;
      })(),
    };
    const warn = { contracts: s.offers.length > 0, stands: waiting > 0, fuel: fu.stock < FUEL.cap * 0.15, fin: s.cash < 0, sites: ps.length > 0 };
    let n = 0;
    for (const b of this.el.querySelectorAll('#mg-list .mm-item')) {
      const k = b.dataset.cat;
      const hide = (k === 'career' && !isCareer(s)) || (isCareer(s) && stageOf(s) < 2 && SMALL_HIDE.has(k));
      b.classList.toggle('hidden', hide);
      if (hide) continue;
      n++;
      b.querySelector('.n').textContent = String(n).padStart(2, '0');
      b.classList.toggle('on', k === this.cat);
      b.classList.toggle('attn', !!warn[k]);
      const sm = b.querySelector('small');
      if (sm.textContent !== badge[k]) sm.textContent = badge[k];
      const nm = b.querySelector('b'), label = catInfo(s, k)[1];
      if (nm.textContent !== label) nm.textContent = label;
    }
    const live = this.el.querySelector('#mg-live');
    live.classList.toggle('on', this.live);
    live.querySelector('.switch').classList.toggle('on', this.live);
  }

  update(s, force = false) {
    if (!this.isOpen() || !s) return;
    this.renderNav(s);
    const c = catInfo(s, this.cat);
    const vis = [...this.el.querySelectorAll('#mg-list .mm-item:not(.hidden)')].map((b) => b.dataset.cat);
    const i = Math.max(0, vis.indexOf(c[0]));
    setHTML(this.el.querySelector('#mg-kick'), `${String(i + 1).padStart(2, '0')} · Management`);
    setHTML(this.el.querySelector('#mg-title'), c[1]);
    setHTML(this.el.querySelector('#mg-desc'), c[2]);
    if (force) this.body._html = null;
    // Eingaben (Schieberegler) nicht während der Bedienung neu aufbauen
    if (document.activeElement && this.body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    setHTML(this.body, `<div class="mg-flow">${this.panel.section(this.cat, s)}</div>`);
    // Streckennetz-Karte bleibt als eigenes Element erhalten und wird in den Platzhalter gehängt
    const slot = this.body.querySelector('.rm-slot');
    if (slot) {
      if (!this.routeMap) this.routeMap = new RouteMap(this.game);
      this.routeMap.attach(slot);
    }
  }
}
