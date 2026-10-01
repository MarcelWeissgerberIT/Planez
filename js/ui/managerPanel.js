// Management: Verträge, Ausbau, Fuhrpark, Gebühren, Finanzen
import { AC_TYPES, AIRLINES, CITIES, VEH_TYPES, UPGRADES, FEE_LIMITS, DEFAULT_FEES, MARKETING, STAND_COSTS, typeCode } from '../config.js';
import { rivalState, shareTarget, ourScore, rivalScore, offerFactor, renewBonus, RIVAL_NAME } from '../sim/rival.js';
import { fmtMoney, fmtInt, esc, clamp, fmtClock, dayOf } from '../util.js';
import { setHTML, toast } from './dom.js';
import * as EC from '../sim/economy.js';
import * as LY from '../layout.js';
import { acceptOffer, declineOffer, cancelContract, feeIndex, standDemand, negotiateOffer, negotiateChance, interestLabel } from '../sim/schedule.js';
import { fleetSummary, efficiency } from '../sim/ground.js';
import { newsState, paxRating } from '../sim/news.js';
import { achievementsHtml } from './achUi.js';
import { PH } from '../sim/aircraft.js';
import { sfx } from '../audio.js';
import { secState, secCapacity, secLanes } from '../sim/security.js';
import { projects, standProject, projectFor, cancelProject, standBuildHours, upgradeHours, STAND_HOURS, remainingHours } from '../sim/construction.js';
import { projectCard, projectInline, fmtHours } from './projects.js';
import { qm } from './glossary.js';
import { RWY_WORKS } from '../sim/construction.js';
import { rwyCond, brakingAction, BRAKE_DE, runwayStrips } from '../sim/runway.js';
import { fuelState, FUEL, orderFuel, maxOrder, avgCost, sellPrice, pending, burnRate, inventory } from '../sim/fuel.js';
import { loans, loanLimit, loanRate, takeLoan, repayLoan, annuity, LOAN_DAYS, debt } from '../sim/finance.js';
import { goalsState, activeGoals, goalFraction, goalText, RANKS, rankName } from '../sim/goals.js';
import { smallField, stageOf, STAGES, upgradeAllowed, upgradeStage, isCareer, careerState, stageUpStatus, partnerContracts, rwyWorkCost, staffBase, vehicleAllowed, standBuildable } from '../sim/career.js';
import { boardPageHtml } from './board.js';
import { careerPageHtml, careerClick, stagePic } from './careerUi.js';
import { T, DEC, LOCALE } from '../i18n.js';

const TABS = [
  ['over', T('Übersicht')],
  ['contracts', T('Verträge')],
  ['build', T('Ausbau')],
  ['ops', T('Betrieb')],
  ['fuel', T('Kerosin')],
  ['fees', T('Gebühren')],
  ['fin', T('Finanzen')],
];
const KIND_DE = { contact: T('mit Fluggastbrücke'), remote: T('Vorfeldposition (Bus)'), cargo: T('Fracht / Vorfeld') };
const C1 = '#3987e5'; // Umsatz (Kategorie 1)
const C2 = '#d95926'; // Kosten (Kategorie 2)


// Bilder zu Ausbauten, Fahrzeugen & Co. (Management-Zentrale), damit man sieht, was man kauft
const PICS = new Set(['retail', 'security', 'lounge', 'parking', 'hotel', 'rwy2', 'ils3', 'rapidExit', 'apronLights', 'marketing', 'stand_contact', 'stand_remote', 'stand_heavy', 'veh_tug', 'veh_baggage', 'veh_fuel', 'veh_catering', 'veh_cleaning', 'veh_bus', 'veh_deice', 'staff', 'fuel_farm', 'rwy_maint', 'solar', 'rail']);
const pic = (k, tag = '') => (PICS.has(k) ? `<div class="card-pic" style="background-image:url(assets/menu/${k}.webp)">${tag ? `<span class="pic-tag">${tag}</span>` : ''}</div>` : '');
// Bilder für den kleinen Platz (Aufbau-Modus)
const cpic = (url, tag = '') => `<div class="card-pic kb-slow" style="background-image:url(${url})">${tag ? `<span class="pic-tag">${tag}</span>` : ''}</div>`;
const CPIC = { meadow: 'assets/career/meadow.webp', grass: 'assets/career/grass_mow.webp', apron: 'assets/career/apron_small.webp', crew: 'assets/career/crew.webp' };
// Wiesenplätze und Vorfeld des kleinen Platzes
const gaSlots = (s) => s.stands.filter((x) => x.ga && !x.closed && x.built);

// Fluggast-Zufriedenheit: was Reisende heute am Flughafen erleben – aus Pünktlichkeit, Wartezeit an der
// Sicherheitskontrolle, Shopping/Lounge, Anreise (Parkhaus, Bahnhof) und Vorfällen; mit Tipp zur schwächsten Stelle
function satisfactionHtml(s) {
  const t = s.stats.today, u = s.upgrades;
  const deps = t.onTime + t.delayed;
  const wait = secState(s).wait || 0;
  // kleiner Platz: Piloten und Ausflugsgäste statt Fluggäste – Piste, Abstellplätze, Vereinsheim, Sicherheit
  const small = smallField(s);
  const ga = small ? gaSlots(s) : [];
  const rows = small ? [
    ['🛬', LY.RWY.grass ? T('Zustand der Graspiste') : T('Zustand der Piste'), Math.round(rwyCond(s)), LY.RWY.grass ? T('Graspiste mähen und walzen (Pisten & Rollwege)') : T('Piste pflegen (Pisten & Rollwege)')],
    ['🌾', T('Platz zum Abstellen'), ga.length ? Math.round(100 - (ga.filter((x) => x.occ || x.resv).length / ga.length) * 60) : 60, T('nicht zu viele Gäste auf einmal – volle Wiese heißt Abdrehen')],
    ['☕', T('Vereinsheim & Service'), clamp(Math.round(55 + careerState(s).fame * 0.4), 0, 100), T('Flugplatzfest oder Fly-In machen den Platz lebendiger')],
    ['⏱️', T('Pünktlichkeit'), deps ? Math.round((t.onTime / deps) * 100) : 90, T('Abfertigung beschleunigen')],
    ['🛡️', T('Sicherheitsgefühl'), clamp(100 - (t.incidents || 0) * 20, 0, 100), T('Zwischenfälle vermeiden')],
  ] : [
    ['⏱️', T('Pünktlichkeit'), deps ? Math.round((t.onTime / deps) * 100) : 90, T('Abfertigung beschleunigen, mehr Fahrzeuge oder Personal')],
    ['🛂', T('Sicherheitskontrolle'), clamp(Math.round(70 + (u.security || 0) * 10 - wait * 3), 0, 100), T('weitere Sicherheitsspuren bauen')],
    ['🛍️', T('Shopping & Lounge'), clamp(45 + (u.retail || 0) * 15 + (u.lounge ? 10 : 0), 0, 100), T('Shopping & Gastronomie ausbauen')],
    ['🚆', T('Anreise'), clamp(50 + (u.parking || 0) * 10 + (u.rail ? 25 : 0) + (u.hotel ? 5 : 0), 0, 100), T('Parkhaus ausbauen oder einen Bahnhof bauen')],
    ['🛡️', T('Sicherheitsgefühl'), clamp(100 - (t.incidents || 0) * 20, 0, 100), T('Zwischenfälle vermeiden')],
  ];
  const avg = rows.reduce((a, r) => a + r[2], 0) / rows.length;
  const stars = Math.round(avg / 10) / 2;
  const starStr = '★'.repeat(Math.floor(stars)) + (stars % 1 ? '⯪' : '') + '☆'.repeat(5 - Math.ceil(stars));
  const low = rows.slice().sort((a, b) => a[2] - b[2])[0];
  const bar = (v) => `<div class="bar"><i style="width:${v}%;background:${v < 45 ? 'var(--bad)' : v < 70 ? 'var(--warn)' : 'var(--good)'}"></i></div>`;
  return `<div class="card sat"><div class="row"><span class="t">😊 ${small ? T('Zufriedenheit der Piloten & Gäste') : T('Fluggast-Zufriedenheit')}</span><span class="sat-st" title="${T`${Math.round(avg)} von 100`}">${starStr}</span></div>
    ${rows.map(([i, n, v]) => `<div class="sat-r"><span>${i} ${n}</span><b>${v}</b></div>${bar(v)}`).join('')}
    ${low[2] < 70 ? T`<div class="s">💡 Schwächste Stelle: ${low[1]} – ${low[3]}.</div>` : ''}</div>`;
}

export class ManagerPanel {
  constructor(root, game, opts = {}) {
    this.root = root;
    this.game = game;
    this.tab = 'over';
    this.page = opts.page || null;
    if (this.page) {
      // eingebettet in die Management-Zentrale: nur Inhaltsbereich
      this.body = root;
      root.addEventListener('click', (e) => this.onClick(e));
      root.addEventListener('input', (e) => this.onInput(e));
      return;
    }
    root.innerHTML = `
      <div class="p-head"><div class="p-title">💼 Management <small id="mp-sub"></small></div></div>
      <div class="tabs" id="mp-tabs">${TABS.map(([k, n]) => `<button data-tab="${k}">${n}</button>`).join('')}</div>
      <div class="p-body" id="mp-body"></div>`;
    this.body = root.querySelector('#mp-body');
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e));
  }

  setTab(t) {
    this.tab = t;
    this.body._html = null;
    this.update(this.game.state);
  }

  onClick(e) {
    const s = this.game.state;
    if (careerClick(this.game, e)) {
      this.body._html = null;
      if (this.page) this.page.update(s, true);
      else this.update(s);
      return;
    }
    const tb = e.target.closest('[data-tab]');
    if (tb) {
      if (this.page) return this.page.open({ contracts: 'contracts', build: 'sites' }[tb.dataset.tab] || tb.dataset.tab);
      return this.setTab(tb.dataset.tab);
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const v = a.dataset.v;
    let ok = true;
    switch (a.dataset.act) {
      case 'accept': {
        const o = s.offers.find((x) => x.id === v);
        if (o && !EC.offerFits(s, o) && !a.dataset.force) {
          a.dataset.force = '1';
          a.textContent = T('Trotzdem annehmen?');
          return;
        }
        ok = acceptOffer(s, v);
        break;
      }
      case 'decline':
        declineOffer(s, v);
        break;
      case 'nego': {
        const r = negotiateOffer(s, v, Number(a.dataset.pct));
        ok = !!(r && r.won);
        if (r && !r.won) sfx.alert && sfx.alert();
        break;
      }
      case 'cancel':
        if (!a.dataset.force) {
          a.dataset.force = '1';
          a.textContent = T('Wirklich kündigen?');
          return;
        }
        cancelContract(s, v);
        break;
      case 'stand':
        ok = EC.buildStand(s, Number(v));
        break;
      case 'standL':
        ok = EC.upgradeStand(s, Number(v));
        break;
      case 'up':
        ok = EC.buyUpgrade(s, v);
        break;
      case 'buy':
        ok = EC.buyVehicle(s, v);
        break;
      case 'sell':
        ok = EC.sellVehicle(s, v);
        break;
      case 'hire':
        EC.hire(s, Number(v));
        break;
      case 'mkt':
        ok = EC.marketing(s);
        break;
      case 'pcancel':
        if (this.armP !== v || performance.now() - this.armT > 5000) {
          this.armP = v;
          this.armT = performance.now();
          this.body._html = null;
          this.update(s);
          return;
        }
        this.armP = null;
        ok = cancelProject(s, v) > 0;
        break;
      case 'pshow':
        if (this.page) this.page.close();
        this.game.showSite && this.game.showSite(v);
        return;
      case 'feereset':
        s.fees = { ...DEFAULT_FEES, night: 600 };
        break;
      case 'rwy':
        ok = EC.orderRunwayWork(s, v);
        break;
      case 'fbuy':
        ok = orderFuel(s, v === 'fill' ? maxOrder(s) * 0.95 : Number(v));
        break;
      case 'fauto':
        fuelState(s).auto = !fuelState(s).auto;
        ok = false;
        break;
      case 'curfew':
        s.settings.curfew = !s.settings.curfew;
        toast(s.settings.curfew ? T('🌙 Nachtflugverbot 23–5 Uhr ab dem nächsten Flugplan') : T('Nachtflüge wieder erlaubt'), 'info');
        ok = false;
        break;
      case 'loan':
        ok = takeLoan(s, Number(v));
        break;
      case 'repay':
        ok = repayLoan(s, v);
        break;
      case 'goals':
        if (this.page) return this.page.open('goals');
        this.game.showGoals && this.game.showGoals();
        return;
    }
    if (ok) sfx.cash();
    this.body._html = null;
    if (this.page) this.page.update(s, true);
    else this.update(s);
  }

  // Inhalt eines Bereichs (für die Management-Zentrale)
  section(key, s) {
    const fn = { career: careerPageHtml, rival: rivalHtml, board: boardPageHtml, over: this.over, contracts: this.contracts, sites: this.sitesHtml, runways: this.runwaysHtml, stands: this.standsHtml, terminal: this.terminalHtml, ops: this.ops, fuel: this.fuel, fees: this.fees, fin: this.fin, goals: this.goalsHtml }[key] || this.over;
    return fn.call(this, s);
  }

  onInput(e) {
    const fm = e.target.closest('input[data-fuelm]');
    if (fm) {
      fuelState(this.game.state).margin = Number(fm.value) / 100;
      const lab = this.root.querySelector('[data-fuelmval]');
      if (lab) lab.textContent = `${fm.value} %`;
      return;
    }
    const r = e.target.closest('input[data-fee]');
    if (!r) return;
    EC.setFee(this.game.state, r.dataset.fee, Number(r.value));
    const lab = this.root.querySelector(`[data-feeval="${r.dataset.fee}"]`);
    if (lab) lab.textContent = feeLabel(r.dataset.fee, this.game.state.fees[r.dataset.fee]);
  }

  update(state) {
    for (const b of this.root.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const offers = state.offers.length;
    setHTML(this.root.querySelector('#mp-sub'), offers ? (offers > 1 ? T`${offers} neue Angebote` : T`${offers} neues Angebot`) : '');
    const fn = { over: this.over, contracts: this.contracts, build: this.build, ops: this.ops, fuel: this.fuel, fees: this.fees, fin: this.fin }[this.tab];
    setHTML(this.body, fn.call(this, state));
  }

  // ---------- Übersicht ----------
  over(s) {
    const L = s.ledger;
    const rev = Object.values(L.rev).reduce((a, b) => a + b, 0);
    const cost = Object.values(L.cost).reduce((a, b) => a + b, 0);
    const t = s.stats.today;
    const deps = t.onTime + t.delayed;
    const cap = EC.capacity(s);
    const need = standDemand(s);
    const paxUse = clamp((need.S + need.M + need.L) / Math.max(1, cap.pax), 0, 1.5);
    const lUse = clamp(need.L / Math.max(1, cap.L), 0, 1.5);
    const cUse = clamp(need.cargo / Math.max(1, cap.cargo), 0, 1.5);
    const rUse = clamp(EC.plannedMovements(s) / Math.max(1, EC.runwayCapacity(s)), 0, 1.5);
    const meter = (label, v) => {
      const col = v > 0.9 ? 'var(--bad)' : v > 0.7 ? 'var(--warn)' : 'var(--good)';
      const tag = v > 0.9 ? T('⚠ voll') : v > 0.7 ? T('▲ hoch') : '✓ ok';
      return `<div style="margin:6px 2px"><div class="row" style="display:flex;justify-content:space-between;font-size:12px"><span>${label}</span><span>${Math.round(v * 100)} % · ${tag}</span></div><div class="bar"><i style="width:${Math.min(100, v * 100)}%;background:${col}"></i></div></div>`;
    };
    const waiting = s.acs.filter((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand).length;
    let h = T`<div class="kpis">
      <div class="k"><span>Kasse</span><b class="${s.cash < 0 ? 'neg' : ''}">${fmtMoney(s.cash)}</b></div>
      <div class="k"><span>Ergebnis heute</span><b class="${rev - cost >= 0 ? 'pos' : 'neg'}">${fmtMoney(rev - cost)}</b></div>
      <div class="k"><span>Ansehen</span><b>${Math.round(s.reputation)}/100</b></div>
      <div class="k"><span>Bewegungen</span><b>${t.mov}</b></div>
      <div class="k"><span>Passagiere</span><b>${fmtInt(t.pax)}</b></div>
      <div class="k"><span>Pünktlich</span><b>${deps ? Math.round((t.onTime / deps) * 100) : 100} %</b></div>
    </div>`;
    const dN = t.depN || 0;
    const slotTot = (t.slotOk || 0) + (t.slotMiss || 0);
    const fu = fuelState(s);
    const cond = Math.round(rwyCond(s));
    const ba = brakingAction(s);
    if (smallField(s)) {
      const ga = gaSlots(s);
      const C = careerState(s), S = stageUpStatus(s);
      h += T`<div class="kpis kpis2">
      <div class="k"><span>${LY.RWY.grass ? T('Graspiste') : T('Piste')}</span><b class="${cond < 45 ? 'neg' : ''}">${cond} % · ${BRAKE_DE[ba]}</b></div>
      <div class="k"><span>Bekanntheit</span><b>${Math.round(C.fame)}/100</b></div>
      <div class="k"><span>Partner</span><b>${partnerContracts(s).length}</b></div>
      <div class="k"><span>Wiese frei</span><b class="${ga.every((x) => x.occ || x.resv) ? 'neg' : ''}">${ga.filter((x) => !x.occ && !x.resv).length} / ${ga.length}</b></div>
      <div class="k"><span>Sprit heute</span><b>${fmtMoney(L.rev.fuel || 0)}</b></div>
      <div class="k"><span>Nächste Stufe</span><b>${S ? T`${S.reqs.filter((r) => r.ok).length}/${S.reqs.length} erfüllt` : '—'}</b></div>
    </div>`;
    } else h += T`<div class="kpis kpis2">
      <div class="k" title="Starts im Slot-Fenster (CTOT) heute"><span>Slots eingehalten</span><b class="${slotTot && t.slotMiss ? 'neg' : ''}">${slotTot ? Math.round(((t.slotOk || 0) / slotTot) * 100) + ' %' : '—'}</b></div>
      <div class="k" title="Mittlere Wartezeit mit laufenden Triebwerken am Rollhalt"><span>Ø Wartezeit Rollhalt</span><b>${dN ? (((t.taxiWait || 0) / 60) / dN).toFixed(1).replace('.', DEC) + ' min' : '—'}</b></div>
      <div class="k"><span>Piste</span><b class="${cond < 45 ? 'neg' : ''}">${cond} % · ${BRAKE_DE[ba]}</b></div>
      <div class="k"><span>Tanklager</span><b class="${fu.stock < FUEL.cap * 0.15 ? 'neg' : ''}">${Math.round(fu.stock)} t</b></div>
      <div class="k"><span>Kerosin</span><b>${Math.round(fu.price)} €/t</b></div>
      <div class="k" title="Nachtbewegungen / Lärmbeschwerden heute"><span>Nacht · Beschwerden</span><b>${t.nightMov || 0} · ${t.complaints || 0}</b></div>
    </div>`;
    h += satisfactionHtml(s);
    const G = goalsState(s);
    const gl = activeGoals(s);
    h += T`<div class="card goalcard"><div class="row"><span class="t">🏅 ${rankName(s, G.rank)} · ${G.xp} XP</span><button class="btn" data-act="goals">Ziele</button></div>${gl.map((g) => {
      const f = goalFraction(s, g);
      return `<div class="s">🎯 ${esc(goalText(g))}</div><div class="bar"><i style="width:${f * 100}%;background:var(--manager)"></i></div>`;
    }).join('')}</div>`;
    h += trendsHtml(s);
    h += voicesHtml(s);
    if (s.offers.length) h += T`<div class="card offer"><div class="row"><span class="t">📨 ${s.offers.length > 1 ? T`${s.offers.length} Vertragsangebote warten` : T`${s.offers.length} Vertragsangebot wartet`}</span><button class="btn" data-tab="contracts">Ansehen</button></div></div>`;
    const ps = projects(s);
    if (ps.length) {
      const next = [...ps].filter((p) => p.status !== 'waiting').sort((a, b) => remainingHours(a) - remainingHours(b))[0];
      h += T`<div class="card site"><div class="row"><span class="t">🏗️ ${ps.length > 1 ? T`${ps.length} Baustellen aktiv` : T`${ps.length} Baustelle aktiv`}</span><button class="btn" data-tab="build">Ansehen</button></div><div class="s">${next ? T`Als Nächstes fertig: ${esc(next.name)} in ${fmtHours(remainingHours(next))}` : T('wartet auf freie Position')}</div></div>`;
    }
    if (waiting) h += T`<div class="card" style="border-color:var(--bad)">🅿️ ${waiting} Flugzeug${waiting > 1 ? T('e warten') : T(' wartet')} auf eine freie Parkposition – Ausbau prüfen.</div>`;
    h += T`<div class="p-sec"><span>Auslastung (Plan)</span></div>`;
    if (smallField(s)) {
      const ga = gaSlots(s);
      h += meter(T`Piste (${EC.plannedMovements(s)} von ~${EC.runwayCapacity(s)} Bewegungen/Tag)`, rUse) + meter(T('Abstellplätze auf der Wiese (jetzt)'), ga.filter((x) => x.occ || x.resv).length / Math.max(1, ga.length));
      if (stageOf(s) === 1) h += meter(T('Vorfeld-Positionen (Plan)'), paxUse);
    } else h += meter(T`Piste (${EC.plannedMovements(s)} von ~${EC.runwayCapacity(s)} Bewegungen/Tag)`, rUse) + meter(T('Passagierpositionen'), paxUse) + meter(T('Großraum (Klasse L)'), lUse) + meter(T('Fracht'), cUse);
    if (rUse > 0.9) h += T`<div class="card" style="border-color:var(--bad)">🛬 Die Piste ist ausgelastet – weitere Verträge führen zu langen Warteschleifen, Treibstoffnot und Vorfällen. Schnellabrollwege oder die Parallelbahn schaffen Kapazität.</div>`;
    h += `<div class="p-sec"><span>${smallField(s) ? T('Zufriedenheit der Partner & Airlines') : T('Airline-Zufriedenheit')}</span></div>`;
    const byAl = {};
    for (const c of s.contracts) {
      byAl[c.airline] = byAl[c.airline] || { sat: 0, n: 0, fl: 0 };
      byAl[c.airline].sat += c.sat;
      byAl[c.airline].n++;
      byAl[c.airline].fl += c.perDay;
    }
    h += Object.entries(byAl)
      .sort((a, b) => b[1].fl - a[1].fl)
      .map(([code, v]) => {
        const al = AIRLINES[code];
        const sat = v.sat / v.n;
        const col = sat < 45 ? 'var(--bad)' : sat < 65 ? 'var(--warn)' : 'var(--good)';
        return T`<div style="margin:6px 2px"><div style="display:flex;justify-content:space-between;font-size:12px"><span><i class="al-dot" style="background:${al.color}"></i>${al.name} · ${v.fl} Flüge/Tag</span><span>${Math.round(sat)} %</span></div><div class="bar"><i style="width:${sat}%;background:${col}"></i></div></div>`;
      })
      .join('');
    return h;
  }

  // ---------- Verträge ----------
  contracts(s) {
    let h = this.page ? T`<div class="rm-wrap"><div class="p-sec"><span>🌍 Streckennetz</span><span class="cnt">${new Set(s.contracts.map((c) => c.city)).size} Ziele</span></div><div class="rm-slot"></div></div>` : '';
    h += T`<div class="p-sec"><span>Angebote${qm('contracts')}</span><span class="cnt">${s.offers.length}</span></div>`;
    if (!s.offers.length) h += T`<div class="empty">Keine offenen Angebote. Gutes Ansehen, faire Gebühren und Marketing bringen neue Airlines.</div>`;
    for (const o of s.offers) {
      const al = AIRLINES[o.airline];
      const t = AC_TYPES[o.type];
      const fits = EC.offerFits(s, o);
      h += T`<div class="card offer"><div class="row"><span class="t"><i class="al-dot" style="background:${al.color}"></i>${al.name}</span><span style="color:var(--muted);font-size:12px">läuft ab ${fmtClock(o.expires)}</span></div>
        <div class="s">${o.perDay}× täglich ${CITIES[o.city].name} · ${t.name} · ${o.days} Tage</div>
        <div class="s">Erwarteter Umsatz ≈ <b style="color:var(--txt)">${fmtMoney(o.estRev)}</b> pro Tag ${fits ? T('<span style="color:var(--good)">✓ Kapazität vorhanden</span>') : T('<span style="color:var(--warn)">⚠ Positionen knapp</span>')}</div>
        <div class="s">Interesse der Airline: <b style="color:var(--txt)">${interestLabel(o)}</b>${o.negotiated ? T(' · Aufschlag abgelehnt – nur noch zum Originalpreis') : ''}</div>
        <div class="acts"><button class="btn btn-good" data-act="accept" data-v="${o.id}">Annehmen</button>${o.negotiated ? '' : [0.1, 0.2].map((p) => `<button class="btn nego" data-act="nego" data-v="${o.id}" data-pct="${p}" title="Höhere Entgelte verlangen – bei Ablehnung kann die Airline abspringen">🤝 +${p * 100} % <small>${Math.round(negotiateChance(s, o, p) * 100)} %</small></button>`).join('')}<button class="btn" data-act="decline" data-v="${o.id}">Ablehnen</button></div></div>`;
    }
    h += T`<div class="p-sec"><span>Laufende Verträge</span><span class="cnt">${s.contracts.length}</span></div>`;
    const sorted = [...s.contracts].sort((a, b) => a.days - b.days);
    for (const c of sorted) {
      const al = AIRLINES[c.airline];
      const col = c.sat < 45 ? 'var(--bad)' : c.sat < 65 ? 'var(--warn)' : 'var(--good)';
      h += T`<div class="card"><div class="row"><span class="t"><i class="al-dot" style="background:${al.color}"></i>${al.name} → ${CITIES[c.city].name}${c.feeMult > 1 ? ` <small class="prem">+${Math.round((c.feeMult - 1) * 100)} %</small>` : ''}</span><span style="font-size:12px;color:${c.days <= 3 ? 'var(--warn)' : 'var(--muted)'}">${c.days} Tage</span></div>
        <div class="s">${c.perDay}× täglich · ${AC_TYPES[c.type].name} · Zufriedenheit ${Math.round(c.sat)} %</div>
        <div class="bar"><i style="width:${c.sat}%;background:${col}"></i></div>
        <div class="acts"><button class="mini" data-act="cancel" data-v="${c.id}">Kündigen</button></div></div>`;
    }
    return h;
  }

  // ---------- Ausbau (aufgeteilt in Bereiche) ----------
  build(s) {
    return this.sitesHtml(s) + this.runwaysHtml(s) + this.standsHtml(s) + this.upgradesHtml(s, ['Terminal', 'Landseite']) + this.marketingHtml(s);
  }

  sitesHtml(s) {
    if (this.armP && performance.now() - this.armT > 5000) this.armP = null;
    const ps = projects(s);
    let h = T`<div class="p-sec"><span>🏗️ Baustellen${qm('build')}</span><span class="cnt">${ps.length}</span></div>`;
    if (!ps.length) h += T`<div class="empty">Keine laufenden Bauprojekte. Aufträge unter Pisten, Parkpositionen oder Terminal starten – jedes Projekt braucht Bauzeit und ist auf der Karte als Baustelle zu sehen.</div>`;
    for (const p of ps) h += projectCard(s, p, this.armP === p.id);
    return h;
  }

  runwaysHtml(s) {
    const ps = projects(s);
    const rwyBusy = ps.some((p) => p.kind === 'rwy');
    const grass = !!LY.RWY.grass;
    let h = T`<div class="p-sec"><span>🛬 Pisten${qm('rwy')}</span></div><div class="card has-pic pic-only">${grass ? cpic(CPIC.grass, T('Pflege der Graspiste: mähen, walzen, neue Grasnarbe')) : pic('rwy_maint', T('Pistenwartung: Gummiabrieb entfernen oder neu asphaltieren'))}</div>`;
    for (const strip of runwayStrips(s)) {
      const cond = Math.round(rwyCond(s, strip.id));
      const ba = brakingAction(s, strip.id);
      h += T`<div class="card"><div class="row"><span class="t">${strip.icon} ${esc(strip.label)} · ${esc(strip.role)}</span><span style="font-size:12px">Bremswirkung <b class="ba-${ba}">${BRAKE_DE[ba]}</b></span></div>
        <div class="row" style="font-size:12px;color:var(--muted);margin-top:3px"><span>Zustand ${cond} %</span><span>${strip.len}</span></div><div class="bar"><i style="width:${cond}%;background:${cond < 35 ? 'var(--bad)' : cond < 60 ? 'var(--warn)' : 'var(--good)'}"></i></div>
        <div class="acts">${Object.entries(RWY_WORKS).map(([k, w]) => {
          const c = rwyWorkCost(s, w);
          return `<button class="btn${k === 'clean' ? ' btn-good' : ''}" data-act="rwy" data-v="${k}:${strip.id}" ${rwyBusy || s.cash < c ? 'disabled' : ''} title="${esc(EC.rwyWorkDesc(s, k))}">${esc(EC.rwyWorkName(s, k, strip.id).replace(/ \([^)]*\)$/, ''))} · ${fmtMoney(c)} · ${w.hours} h</button>`;
        }).join('')}</div></div>`;
    }
    h += `<div class="s" style="font-size:12px;color:var(--muted);margin:2px 4px 8px">${grass ? T('Jede Landung drückt Spuren in die Grasnarbe, Regen weicht sie auf. Unter 60 % bremst die Bahn bei Nässe schlecht. Gepflegt wird nach Betriebsschluss.') : T('Jede Landung hinterlässt Gummiabrieb (schwere Flugzeuge mehr). Unter 60 % wird die Bremswirkung bei Nässe schlecht. Arbeiten laufen nachts (22:30–5:30) in Verkehrspausen und sperren die jeweilige Piste.')}${rwyBusy ? T(' 🏗️ Arbeiten beauftragt.') : ''}</div>`;
    h += this.upgradesHtml(s, ['Pisten'], false) + this.upgradesHtml(s, ['Betrieb'], true, T('Rollwege, Befeuerung & Navigation'));
    return h;
  }

  // kleiner Platz: Wiese (und ab Verkehrslandeplatz das kleine Vorfeld), Ausblick auf die nächste Stufe
  smallStandsHtml(s) {
    const st = stageOf(s);
    const ga = gaSlots(s);
    const who = (x) => {
      const a = x.occ ? s.acs.find((q) => q.id === x.occ) : null;
      return a ? `${esc(a.cs)} · ${typeCode(a.type)}` : x.resv ? T('reserviert') : T('frei');
    };
    const used = ga.filter((x) => x.occ || x.resv).length;
    let h = T`<div class="p-sec"><span>🌾 Abstellplätze auf der Wiese</span><span class="cnt">${ga.length - used} frei / ${ga.length}</span></div>`;
    h += `<div class="card has-pic pic-only">${cpic(CPIC.meadow, T`${used} von ${ga.length} belegt`)}</div>`;
    h += `<div class="ga-grid">${ga.map((x, i) => `<div class="ga-slot${x.occ ? ' on' : x.resv ? ' resv' : ''}"><b>W${i + 1}</b><small>${who(x)}</small></div>`).join('')}</div>`;
    h += T`<div class="s" style="font-size:12px;color:var(--muted);margin:4px 4px 10px">Kleinflugzeuge rollen selbst auf die Wiese und werden von Hand festgezurrt. Parkgebühren gibt es hier nicht – verdient wird an Landeentgelt, AvGas und am Vereinsheim. Ist die Wiese voll, drehen Gäste wieder ab.</div>`;
    if (st >= 1) {
      const ap = s.stands.filter((x) => !x.ga && x.built);
      h += T`<div class="p-sec"><span>🛩️ Vorfeld</span><span class="cnt">${ap.filter((x) => !x.occ).length} frei / ${ap.length}</span></div>`;
      h += `<div class="card has-pic pic-only">${cpic(CPIC.apron, T('Turboprops ohne Fluggastbrücke – zu Fuß oder mit dem Vorfeldbus'))}</div>`;
      for (const x of ap) h += T`<div class="card"><div class="row"><span class="t">P${x.id} · Vorfeld · Turboprop</span><span style="font-size:12px;color:var(--muted)">${who(x)}</span></div></div>`;
    }
    const next = st === 0 ? [T('Verkehrslandeplatz'), T('Mit dem Verkehrslandeplatz kommt ein asphaltiertes Vorfeld mit fünf Positionen für Turboprops und Geschäftsreiseflugzeuge.')] : [T('Regionalflughafen'), T('Positionen mit Fluggastbrücke, Busvorfeld und später Großraum-Positionen baust du ab dem Regionalflughafen selbst.')];
    h += T`<div class="card lockcard"><div class="row"><span class="t">🔒 ${next[1]}</span><button class="mini" data-tab="career">ab ${next[0]}</button></div></div>`;
    return h;
  }

  standsHtml(s) {
    if (smallField(s)) return this.smallStandsHtml(s);
    const list = s.stands.filter((x) => !(x.ga && x.closed));
    let h = T`<div class="p-sec"><span>🅿️ Parkpositionen</span><span class="cnt">${list.filter((x) => x.built).length} / ${list.length}</span></div>`;
    for (const st of s.stands) {
      if (st.ga && st.closed) continue;
      const occ = st.occ ? s.acs.find((a) => a.id === st.occ) : null;
      const pj = standProject(s, st.id);
      if (!st.built) {
        const cost = EC.standBuildCost(st);
        const ok = standBuildable(s, st);
        const right = pj ? projectInline(pj) : ok ? T`<button class="btn btn-good" data-act="stand" data-v="${st.id}" ${s.cash < cost ? 'disabled' : ''}>Bauen ${fmtMoney(cost)}</button>` : T`<button class="mini" data-tab="career">🔒 ab ${esc(STAGES[3].name)}</button>`;
        const sp = st.kind === 'remote' ? 'stand_remote' : st.size === 'L' ? 'stand_heavy' : 'stand_contact';
        h += T`<div class="card has-pic${pj ? ' site' : ''}">${pic(sp)}<div class="row"><span class="t">P${st.id} · ${KIND_DE[st.kind]} · Klasse ${st.size}</span>${right}</div>${pj ? '' : T`<div class="s">Bauzeit ${standBuildHours(st)} h · noch nicht gebaut</div>`}</div>`;
      } else {
        const up = pj ? projectInline(pj) : st.size !== 'L' && st.kind !== 'cargo' ? T`<button class="mini" data-act="standL" data-v="${st.id}" ${s.cash < STAND_COSTS.upgradeL ? 'disabled' : ''}>→ Klasse L (${fmtMoney(STAND_COSTS.upgradeL)} · ${STAND_HOURS.upgradeL} h, Position gesperrt)</button>` : '';
        const rot = occ ? s.rots[occ.rot] : null;
        const detail = occ ? `${esc(occ.cs)} · ${typeCode(occ.type)}${rot ? ` · STD ${fmtClock(rot.std)}` : ''}` : st.resv ? T('reserviert') : T('frei');
        h += `<div class="card${pj ? ' site' : ''}"><div class="row"><span class="t">P${st.id} · ${KIND_DE[st.kind]} · ${st.size}</span><span style="font-size:12px;color:var(--muted)">${st.closed ? T('gesperrt (Bau)') : detail}</span></div>${up ? `<div class="acts">${up}</div>` : ''}</div>`;
      }
    }
    return h;
  }

  upgradesHtml(s, catList, withHead = true, title = null) {
    let h = '';
    for (const cat of catList) {
      const all = Object.entries(UPGRADES).filter(([, u]) => u.cat === cat);
      const list = all.filter(([k]) => upgradeAllowed(s, k) || (s.upgrades[k] || 0) > 0);
      const locked = all.filter(([k]) => !list.some(([x]) => x === k));
      if (!all.length) continue;
      if (withHead) h += `<div class="p-sec"><span>${title || T(cat)}</span></div>`;
      if (locked.length && isCareer(s)) {
        const byStage = {};
        for (const [k, u] of locked) (byStage[upgradeStage(k)] = byStage[upgradeStage(k)] || []).push(u.name);
        h += Object.entries(byStage).map(([st, names]) => T`<div class="card lockcard"><div class="row"><span class="t">🔒 ${esc(names.join(' · '))}</span><button class="mini" data-tab="career">ab ${esc(STAGES[st].name)}</button></div></div>`).join('');
      }
      for (const [k, u] of list) {
        const lvl = s.upgrades[k] || 0;
        const maxed = lvl >= u.max;
        const cost = maxed ? 0 : u.cost[lvl];
        const pj = projectFor(s, 'upgrade', k);
        const dots = Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : pj && i === lvl ? 'bld' : ''}"></i>`).join('');
        const locked = u.requires && !s.upgrades[u.requires];
        const right = pj ? projectInline(pj) : maxed ? T('<span style="color:var(--good);font-size:12px">✓ voll ausgebaut</span>') : locked ? T`<span style="font-size:12px;color:var(--muted)">erst ${esc(UPGRADES[u.requires].name)}</span>` : `<button class="btn btn-good" data-act="up" data-v="${k}" ${s.cash < cost ? 'disabled' : ''}>${fmtMoney(cost)}</button>`;
        h += `<div class="card has-pic${pj ? ' site' : ''}${u.big ? ' bigcard' : ''}">${pic(k, maxed ? T('✓ fertig') : lvl ? T`Stufe ${lvl}/${u.max}` : '')}<div class="row"><span class="t">${u.icon ? u.icon + ' ' : ''}${u.name}<span class="lvl">${dots}</span></span>${right}</div><div class="s">${u.desc}${!pj && !maxed ? T` · Bauzeit ${upgradeHours(k, lvl + 1)} h` : ''}</div>${u.more ? `<div class="s">${u.more}</div>` : ''}</div>`;
      }
    }
    return h;
  }

  marketingHtml(s) {
    const mk = s.marketingUntil > s.time;
    return T`<div class="p-sec"><span>Marketing</span></div><div class="card has-pic">${pic('marketing', mk ? T('läuft') : '')}<div class="row"><span class="t">📣 Kampagne „Fly ${esc(s.name.split(' ')[0])}“</span><button class="btn" data-act="mkt" ${s.cash < MARKETING.cost || mk ? 'disabled' : ''}>${mk ? T('läuft') : fmtMoney(MARKETING.cost)}</button></div><div class="s">Mehr Angebote und Ansehen für ${MARKETING.days} Tage.</div></div>`;
  }

  terminalHtml(s) {
    const S = secState(s), cap = secCapacity(s);
    const load = S.demand / cap;
    const col = S.wait > 15 ? 'var(--bad)' : load > 0.9 ? 'var(--warn)' : 'var(--good)';
    const sec = T`<div class="p-sec"><span>🚶 Sicherheitskontrolle</span><span class="cnt">${secLanes(s)} Spuren</span></div>
      <div class="card"><div class="row"><span class="t">Wartezeit jetzt: <b style="color:${col}">${Math.round(S.wait)} min</b></span><span style="font-size:12px;color:var(--muted)">heute max. ${Math.round(S.peak || 0)} min</span></div>
      <div class="s">Andrang ${Math.round(S.demand)} Reisende/h · Kapazität ${cap}/h (${secLanes(s)} Spuren à 120)</div>
      <div class="bar"><i style="width:${Math.min(100, load * 100)}%;background:${col}"></i></div>
      <div class="s">Ab etwa 12 Minuten Wartezeit dauert das Boarding länger (Nachzügler), ab 20 Minuten sinkt das Ansehen. Jede Ausbaustufe „Sicherheitsspuren“ bringt zwei Spuren mehr.</div></div>`;
    return sec + this.upgradesHtml(s, ['Terminal', 'Landseite']) + this.marketingHtml(s);
  }

  goalsHtml(s) {
    const G = goalsState(s);
    const next = RANKS[G.rank + 1];
    const pct = next ? Math.round(((G.xp - RANKS[G.rank].xp) / (next.xp - RANKS[G.rank].xp)) * 100) : 100;
    let h = T`<div class="p-sec"><span>🏅 ${isCareer(s) ? T('Dein Rang') : T('Flughafen-Rang')}${qm('goals')}</span></div><div class="card"><div class="row"><span class="t">${rankName(s, G.rank)}</span><span style="font-family:var(--mono);font-size:12px">${G.xp} XP</span></div><div class="bar"><i style="width:${pct}%;background:linear-gradient(90deg,#f59e0b,#fde047)"></i></div><div class="s">${next ? T`Nächster Rang „${rankName(s, G.rank + 1)}“ ab ${next.xp} XP` : T('Höchster Rang erreicht')} · ${G.done} Ziele erreicht</div><div class="rank-steps">${RANKS.map((r, i) => `<span class="${i <= G.rank ? 'on' : ''}">${i + 1}. ${rankName(s, i)}</span>`).join('')}</div></div>`;
    h += achievementsHtml(s);
    h += T`<div class="p-sec"><span>🎯 Ziele</span></div>`;
    for (const g of activeGoals(s)) {
      const f = goalFraction(s, g);
      h += `<div class="card goal"><div class="row"><span class="t">${esc(goalText(g))}</span><span class="rem">${Math.round(f * 100)} %</span></div><div class="bar"><i style="width:${f * 100}%;background:var(--manager)"></i></div></div>`;
    }
    return h;
  }

  // ---------- Betrieb ----------
  ops(s) {
    const fs = fleetSummary(s);
    const eff = efficiency(s);
    const wait = s.stats.vehWait || {};
    const small = smallField(s);
    let h = T`<div class="p-sec"><span>Fuhrpark</span><span class="cnt">${s.vehicles.length} / 24</span></div>`;
    if (!vehicleAllowed(s, 'tug')) h += T`<div class="card has-pic">${cpic(CPIC.grass, T('Einziges Fahrzeug: der Traktor des Platzwarts'))}<div class="row"><span class="t">🤝 Kein Fuhrpark nötig</span><button class="mini" data-tab="career">ab Verkehrslandeplatz</button></div><div class="s">Piloten schieben ihre Maschinen selbst auf die Wiese und tanken an der AvGas-Säule. Schlepper, Tankwagen, Gepäckzug und Enteiser kommen mit dem Verkehrslandeplatz.</div></div>`;
    else for (const [k, vt] of Object.entries(VEH_TYPES)) {
      const f = fs[k];
      const w = Math.round((wait[k] || 0) / 60);
      h += T`<div class="card has-pic">${pic('veh_' + k, T`${f.total}× im Fuhrpark`)}<div class="row"><span class="t">${vt.name}</span><span style="font-family:var(--mono)">${f.total}× <small style="color:var(--muted)">(${f.busy} im Einsatz${f.broken ? T`, ${f.broken} defekt` : ''})</small></span></div>
        <div class="s">Wartezeit auf Fahrzeug zuletzt: ${w} min ${w > 30 ? T('<span style="color:var(--warn)">– Engpass!</span>') : ''} · Unterhalt ${fmtMoney(vt.upkeep)}/Tag</div>
        <div class="acts"><button class="btn btn-good" data-act="buy" data-v="${k}" ${s.cash < vt.price ? 'disabled' : ''}>+ Kaufen ${fmtMoney(vt.price)}</button><button class="btn" data-act="sell" data-v="${k}">− Verkaufen</button></div></div>`;
    }
    const step = small ? 1 : 5;
    h += T`<div class="p-sec"><span>${small ? T('Platzwart, Flugleitung & Helfer') : T('Bodenpersonal')}</span></div>
      <div class="card has-pic">${small ? cpic(CPIC.crew) : pic('staff')}<div class="row"><span class="t">${s.staff} Mitarbeitende</span><span>Effizienz <b style="font-family:var(--mono);color:${eff < 0.9 ? 'var(--warn)' : 'var(--good)'}">${Math.round(eff * 100)} %</b></span></div>
      <div class="s">Bedarf ≈ ${Math.round(staffBase(s) + 2.2 * s.vehicles.length)} · Kosten ${fmtMoney(260)} je Person/Tag</div>
      <div class="acts"><button class="btn btn-good" data-act="hire" data-v="${step}">+${step} einstellen</button><button class="btn" data-act="hire" data-v="-${step}">−${step} abbauen</button></div></div>`;
    const fc = EC.dailyFixedCosts(s);
    h += T`<div class="p-sec"><span>Fixkosten pro Tag</span></div><table class="ledger">`;
    let sum = 0;
    for (const [k, v] of Object.entries(fc)) {
      sum += v;
      h += `<tr><td>${EC.COST_CATS[k]}</td><td>${fmtMoney(v, false)}</td></tr>`;
    }
    h += T`<tr class="sum"><td>Summe</td><td>${fmtMoney(sum, false)}</td></tr></table>`;
    return h;
  }

  // ---------- Kerosin ----------
  fuel(s) {
    const f = fuelState(s);
    const lvl = f.stock / FUEL.cap;
    const avg = avgCost(s);
    const sp = sellPrice(s);
    const burn = burnRate(s);
    const reach = burn > 1 ? (f.stock + pending(s)) / burn : 0;
    const hist = f.hist.slice(-72);
    let h = T`<div class="kpis">
      <div class="k"><span>Marktpreis</span><b>${Math.round(f.price)} €/t</b></div>
      <div class="k" title="Durchschnittlicher Einstandspreis des Lagerbestands"><span>Ø Einkauf</span><b>${Math.round(avg)} €/t</b></div>
      <div class="k"><span>Verkauf</span><b>${Math.round(sp)} €/t</b></div>
      <div class="k"><span>Bestand</span><b class="${lvl < 0.15 ? 'neg' : ''}">${Math.round(f.stock)} t</b></div>
      <div class="k" title="Bestand plus Bestellungen geteilt durch den Verbrauch der letzten 24 h"><span>Reichweite</span><b>${reach ? T`${reach.toFixed(1).replace('.', DEC)} Tage` : '—'}</b></div>
      <div class="k"><span>Heute vertankt</span><b>${Math.round(s.stats.today.fuelSold || 0)} t</b></div>
    </div>`;
    h += T`<div class="p-sec"><span>Tanklager${qm('fuel')}</span><span class="cnt">${Math.round(lvl * 100)} %</span></div><div class="card has-pic pic-only">${pic('fuel_farm', T`${Math.round(f.stock)} t auf Lager`)}</div><div class="bar" style="height:10px"><i style="width:${lvl * 100}%;background:${lvl < 0.15 ? 'var(--bad)' : lvl < 0.3 ? 'var(--warn)' : 'var(--good)'}"></i></div>`;
    h += T`<div class="s" style="font-size:12px;color:var(--muted);margin:4px 2px">${Math.round(f.stock)} von ${FUEL.cap} t · in Tankwagen ${Math.round(inventory(s) - f.stock)} t · Lagerwert ${fmtMoney(f.value)}</div>`;
    if (hist.length > 1) {
      h += T`<div class="p-sec"><span>Marktpreis letzte ${hist.length} h (€/t)</span></div>`;
      h += priceSvg(hist, avg);
    }
    h += T`<div class="p-sec"><span>Einkaufen</span></div><div class="card"><div class="row"><span class="t">Spotkauf zu ${Math.round(f.price * 1.02)} €/t</span><span style="font-size:12px;color:var(--muted)">inkl. 2 % Transport · Lieferung in 2–3,5 h</span></div><div class="acts">${[100, 250, 500].map((q) => `<button class="btn btn-good" data-act="fbuy" data-v="${q}" ${q > maxOrder(s) || s.cash < q * f.price * 1.02 ? 'disabled' : ''}>+${q} t · ${fmtMoney(q * f.price * 1.02)}</button>`).join('')}<button class="btn" data-act="fbuy" data-v="fill" ${maxOrder(s) < 10 ? 'disabled' : ''}>Auffüllen (${maxOrder(s)} t)</button></div>
      <div class="toggle-row" style="margin-top:8px"><span>Automatisch nachbestellen (unter 45 %, bei günstigem Preis mehr)</span><button class="switch ${f.auto ? 'on' : ''}" data-act="fauto"></button></div></div>`;
    for (const o of f.orders) h += T`<div class="card"><div class="row"><span class="t">🚚 ${o.qty} t unterwegs</span><span style="font-family:var(--mono);font-size:12px">ca. ${fmtClock(o.eta)}</span></div><div class="s">${Math.round(o.unit)} €/t · ${fmtMoney(o.qty * o.unit)}</div></div>`;
    const m = Math.round(f.margin * 100);
    h += T`<div class="p-sec"><span>Verkaufsmarge</span></div><div class="fee-row"><div class="row"><span>Aufschlag auf den Marktpreis</span><b data-fuelmval style="font-family:var(--mono)">${m} %</b></div><input type="range" min="${FUEL.marginRange[0] * 100}" max="${FUEL.marginRange[1] * 100}" step="1" value="${m}" data-fuelm /><div class="hint">Über 10 % tanken Airlines woanders vor (Tankering) – weniger Absatz. Gewinn je Tonne = Verkaufspreis − Ø Einkauf.</div></div>`;
    return h;
  }

  // ---------- Gebühren ----------
  fees(s) {
    const fi = feeIndex(s);
    const who = isCareer(s) && stageOf(s) === 0 ? T('Gäste') : T('Airlines');
    const mood = fi > 1.25 ? ['var(--bad)', T`${who} verärgert – weniger ${who === T('Gäste') ? T('Besuch') : T('Angebote, Kündigungen drohen')}`] : fi > 1.05 ? ['var(--warn)', T`${who} skeptisch`] : fi < 0.85 ? ['var(--good)', T('Sehr attraktiv – aber weniger Erlös je Flug')] : ['var(--good)', T('Marktüblich')];
    let h = T`<div class="card"><div class="row"><span class="t">Preisniveau ${Math.round(fi * 100)} %</span><span style="color:${mood[0]};font-size:12px">${mood[1]}</span></div><div class="s">100 % = Marktdurchschnitt. Änderungen wirken sofort auf neue Flüge und langsam auf die Zufriedenheit.</div></div>`;
    const grass = isCareer(s) && stageOf(s) === 0;
    const rows = [
      ['landing', T('Landeentgelt'), grass ? T('je Tonne Höchstabfluggewicht, Kleinflugzeuge zahlen mindestens 1,5 t') : T('je Tonne Höchstabfluggewicht')],
      ['pax', T('Passagierentgelt'), grass ? T('je abfliegendem Fluggast (Rundflug, Lufttaxi)') : T('je abfliegendem Passagier')],
      ['parking', T('Positionsentgelt'), T('je Stunde an der Parkposition')],
    ].filter((r) => !(grass && r[0] === 'parking'));
    for (const [k, name, hint] of rows) {
      const [a, b] = FEE_LIMITS[k];
      h += `<div class="fee-row"><div class="row"><span>${name}</span><b data-feeval="${k}" style="font-family:var(--mono)">${feeLabel(k, s.fees[k])}</b></div><input type="range" min="${a}" max="${b}" step="0.5" value="${s.fees[k]}" data-fee="${k}" /><div class="hint">${hint}${T` · Standard ${feeLabel(k, DEFAULT_FEES[k])}`}</div></div>`;
    }
    if (grass) {
      h += T`<div class="p-sec"><span>Betriebszeiten</span></div><div class="card"><div class="row"><span class="t">☀️ Nur bei Tag, nach Sichtflugregeln</span><button class="mini" data-tab="career">Nachtflug ab Verkehrslandeplatz</button></div><div class="s">Eine Graspiste ohne Befeuerung wird nur zwischen Sonnenauf- und -untergang angeflogen – Nachtentgelte und Nachtflugverbot gibt es hier noch nicht.</div></div>`;
      return h + T`<button class="btn" data-act="feereset">Auf Standard zurücksetzen</button>`;
    }
    h += T`<div class="p-sec"><span>Nachtflüge (23–5 Uhr)${qm('fees')}</span></div>`;
    const [na, nb] = FEE_LIMITS.night;
    h += T`<div class="toggle-row"><span>🌙 Nachtflugverbot – keine planmäßigen Nachtflüge, Ausnahmen kosten Bußgeld</span><button class="switch ${s.settings.curfew ? 'on' : ''}" data-act="curfew"></button></div>`;
    h += T`<div class="fee-row"><div class="row"><span>Nacht-/Lärmentgelt je Bewegung</span><b data-feeval="night" style="font-family:var(--mono)">${feeLabel('night', s.fees.night ?? 600)}</b></div><input type="range" min="${na}" max="${nb}" step="50" value="${s.fees.night ?? 600}" data-fee="night" ${s.settings.curfew ? 'disabled' : ''} /><div class="hint">Heavy zahlt 2×, Light 0,5×. Hohe Entgelte ärgern Frachtairlines. Heute: ${s.stats.today.nightMov || 0} Nachtbewegungen, ${s.stats.today.complaints || 0} Lärmbeschwerden (ab 40 protestiert die Bürgerinitiative).</div></div>`;
    h += T`<button class="btn" data-act="feereset">Auf Standard zurücksetzen</button>`;
    return h;
  }

  // ---------- Finanzen ----------
  fin(s) {
    const L = s.ledger;
    const rev = Object.values(L.rev).reduce((a, b) => a + b, 0);
    const cost = Object.values(L.cost).reduce((a, b) => a + b, 0);
    let h = '';
    const hist = s.history.slice(-10);
    if (hist.length) {
      h += T`<div class="p-sec"><span>Umsatz und Kosten je Tag</span></div>`;
      h += T`<div class="legend"><span><i style="background:${C1}"></i>Umsatz</span><span><i style="background:${C2}"></i>Betriebskosten</span></div>`;
      h += barsSvg(hist);
      h += T`<div class="p-sec"><span>Kontostand am Tagesende</span></div>`;
      h += lineSvg(hist);
    } else h += T`<div class="empty">Diagramme erscheinen nach dem ersten Tagesabschluss (Mitternacht).</div>`;
    h += T`<div class="p-sec"><span>Heute bisher</span></div><table class="ledger">`;
    const SMALL_REV = { fuel: T('Spritverkauf (AvGas)'), retail: T('Vereinsheim (Kaffee & Kuchen)'), parking: T('Abstellen') };
    const revName = (k) => (smallField(s) && SMALL_REV[k] ? SMALL_REV[k] : EC.REV_CATS[k] || k);
    for (const [k, v] of Object.entries(L.rev).sort((a, b) => b[1] - a[1])) h += `<tr><td>${revName(k)}</td><td style="color:var(--good)">+${fmtMoney(v, false)}</td></tr>`;
    h += T`<tr class="sum"><td>Umsatz</td><td>${fmtMoney(rev, false)}</td></tr>`;
    for (const [k, v] of Object.entries(L.cost).sort((a, b) => b[1] - a[1])) h += `<tr><td>${EC.COST_CATS[k] || k}</td><td style="color:#fca5a5">−${fmtMoney(v, false)}</td></tr>`;
    h += T`<tr class="sum"><td>Kosten</td><td>${fmtMoney(cost, false)}</td></tr>`;
    h += T`<tr class="sum"><td>Betriebsergebnis</td><td>${fmtMoney(rev - cost, false)}</td></tr>`;
    if (L.capex) h += T`<tr><td>Investitionen (Bau, Fahrzeuge)</td><td>−${fmtMoney(L.capex, false)}</td></tr>`;
    if (L.fuelBuy) h += T`<tr><td>Kerosineinkauf (Lager)</td><td>−${fmtMoney(L.fuelBuy, false)}</td></tr>`;
    if (L.repay) h += T`<tr><td>Kredittilgung</td><td>−${fmtMoney(L.repay, false)}</td></tr>`;
    h += `</table>`;
    // Kredite
    const lim = loanLimit(s);
    const r = loanRate(s);
    h += T`<div class="p-sec"><span>🏦 Kredite${qm('loans')}</span><span class="cnt">${fmtMoney(debt(s))}</span></div>`;
    h += T`<div class="card"><div class="row"><span class="t">Kreditrahmen ${fmtMoney(lim)}</span><span style="font-size:12px;color:var(--muted)">Zins ${(r * 100).toFixed(2).replace('.', DEC)} % pro Tag</span></div><div class="s">Laufzeit ${LOAN_DAYS} Tage, gleiche Tagesraten. Besseres Ansehen = günstigerer Zins und höherer Rahmen.</div><div class="acts">${loanSteps(lim).map((a) => T`<button class="btn" data-act="loan" data-v="${a}" ${a > lim ? 'disabled' : ''}>+${fmtMoney(a)} <small>(${fmtMoney(annuity(a, r))}/Tag)</small></button>`).join('')}</div></div>`;
    for (const l of loans(s)) h += T`<div class="card"><div class="row"><span class="t">Kredit ${fmtMoney(l.amount)}</span><span style="font-family:var(--mono);font-size:12px">Rest ${fmtMoney(l.rest)}</span></div><div class="bar"><i style="width:${(1 - l.rest / l.amount) * 100}%"></i></div><div class="s">Rate ${fmtMoney(l.daily)}/Tag · noch ${l.days} Tage · ${(l.rate * 100).toFixed(2).replace('.', DEC)} %/Tag</div><div class="acts"><button class="mini" data-act="repay" data-v="${l.id}" ${s.cash < l.rest ? 'disabled' : ''}>Sondertilgung ${fmtMoney(l.rest)}</button></div></div>`;
    if (hist.length) {
      h += T`<div class="p-sec"><span>Tabelle</span></div><table class="ledger"><tr><td><b>Tag</b></td><td><b>Umsatz · Kosten · Bew. · pünktl.</b></td></tr>`;
      for (const r of [...hist].reverse()) h += T`<tr><td>Tag ${r.day}</td><td>${fmtMoney(r.rev)} · ${fmtMoney(r.cost)} · ${r.mov} · ${r.onTime}%</td></tr>`;
      h += `</table>`;
    }
    return h;
  }
}

// Kreditbeträge passend zum Rahmen (am Grasplatz 15/30/60 Tsd € statt Millionen)
function loanSteps(lim) {
  if (lim >= 5e6) return [1e6, 2e6, 5e6];
  const nice = (v) => {
    const u = v >= 1e6 ? 1e5 : v >= 1e5 ? 1e4 : 5e3;
    return Math.max(u, Math.floor(v / u) * u);
  };
  return [...new Set([0.25, 0.5, 1].map((f) => nice(lim * f)))];
}

function feeLabel(k, v) {
  if (k === 'night') return `${Math.round(v)} €`;
  if (k === 'landing') return `${v.toFixed(1).replace('.', DEC)} €/t`;
  if (k === 'pax') return `${v.toFixed(1).replace('.', DEC)} €`;
  return `${Math.round(v)} €/h`;
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const kTick = (v) => (v >= 1e6 ? T`${(v / 1e6).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} Mio` : v >= 1e3 ? T`${Math.round(v / 1e3)} Tsd` : String(Math.round(v)));

// Säulen: Umsatz vs. Kosten (gleiche Einheit, eine Achse)
function barsSvg(hist) {
  const W = 360, H = 160, pl = 46, pr = 6, pt = 8, pb = 20;
  const max = niceMax(Math.max(...hist.map((r) => Math.max(r.rev, r.cost))) * 1.05);
  const n = hist.length;
  const band = (W - pl - pr) / n;
  const bw = Math.min(14, (band - 8) / 2);
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(148,163,184,.16)" stroke-width="1"/><text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#94a3b8">${kTick(v)}</text>`;
  }
  const bar = (x, v, col, tip) => {
    const h = Math.max(0, y(0) - y(v));
    const r = Math.min(4, h, bw / 2);
    const top = y(v);
    return `<path d="M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z" fill="${col}" data-tip="${tip}"/><rect x="${x - 2}" y="${pt}" width="${bw + 4}" height="${H - pt - pb}" fill="transparent" data-tip="${tip}"/>`;
  };
  hist.forEach((r, i) => {
    const cx = pl + band * i + band / 2;
    g += bar(cx - bw - 1, r.rev, C1, T`Tag ${r.day} · Umsatz ${fmtMoney(r.rev)}`);
    g += bar(cx + 1, r.cost, C2, T`Tag ${r.day} · Kosten ${fmtMoney(r.cost)}`);
    g += `<text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#94a3b8">T${r.day}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Umsatz und Kosten der letzten Tage">${g}</svg>`;
}

// Linie: Kontostand (eine Serie, kein Legendenkasten nötig)
function lineSvg(hist) {
  const W = 360, H = 130, pl = 46, pr = 40, pt = 10, pb = 18;
  const vals = hist.map((r) => r.cash);
  const lo = Math.min(0, ...vals), hi = niceMax(Math.max(...vals) * 1.05);
  const n = hist.length;
  const x = (i) => pl + (n === 1 ? (W - pl - pr) / 2 : ((W - pl - pr) * i) / (n - 1));
  const y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo || 1));
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) / 3) * i;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(148,163,184,.16)"/><text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#94a3b8">${kTick(v)}</text>`;
  }
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  g += `<path d="${d} L${x(n - 1)},${y(lo)} L${x(0)},${y(lo)} Z" fill="${C1}" opacity="0.1"/>`;
  g += `<path d="${d}" fill="none" stroke="${C1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  hist.forEach((r, i) => {
    g += `<circle cx="${x(i)}" cy="${y(r.cash)}" r="9" fill="transparent" data-tip="Tag ${r.day} · ${fmtMoney(r.cash)}"/>`;
    g += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#94a3b8">T${r.day}</text>`;
  });
  const last = vals[n - 1];
  g += `<circle cx="${x(n - 1)}" cy="${y(last)}" r="4.5" fill="${C1}" stroke="#161e2e" stroke-width="2"/>`;
  g += `<text x="${x(n - 1) + 7}" y="${y(last) + 3}" font-size="10" fill="#e5edf7">${kTick(last)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kontostand">${g}</svg>`;
}

// Linie: Kerosinpreis mit Ø-Einkauf als Referenz
function priceSvg(hist, avg) {
  const W = 360, H = 120, pl = 40, pr = 44, pt = 8, pb = 18;
  const vals = hist.map((x) => x.p);
  const lo = Math.floor((Math.min(...vals, avg) * 0.97) / 10) * 10, hi = Math.ceil((Math.max(...vals, avg) * 1.03) / 10) * 10;
  const n = vals.length;
  const x = (i) => pl + ((W - pl - pr) * i) / Math.max(1, n - 1);
  const y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo || 1));
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) / 3) * i;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(148,163,184,.16)"/><text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#94a3b8">${Math.round(v)}</text>`;
  }
  g += T`<line x1="${pl}" x2="${W - pr}" y1="${y(avg)}" y2="${y(avg)}" stroke="${C2}" stroke-dasharray="4 3" stroke-width="1.5"/><text x="${W - pr + 4}" y="${y(avg) + 3}" font-size="9" fill="${C2}">Ø Einkauf</text>`;
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  g += `<path d="${d}" fill="none" stroke="${C1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  hist.forEach((hh, i) => {
    g += `<circle cx="${x(i)}" cy="${y(hh.p)}" r="6" fill="transparent" data-tip="${fmtClock(hh.t)} · ${hh.p} €/t · Bestand ${hh.s} t"/>`;
    if (i % 12 === 0) g += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#94a3b8">${fmtClock(hh.t)}</text>`;
  });
  const last = vals[n - 1];
  g += `<circle cx="${x(n - 1)}" cy="${y(last)}" r="4" fill="${C1}" stroke="#161e2e" stroke-width="2"/><text x="${x(n - 1) + 6}" y="${y(last) - 6}" font-size="10" fill="#e5edf7">${last}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T('Kerosinpreis')}">${g}</svg>`;
}

// Trends der letzten Tage als kleine Verlaufskurven
function spark(vals, col, fmt) {
  const W = 120, H = 34;
  if (vals.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}"></svg>`;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i) => 2 + ((W - 4) * i) / (vals.length - 1);
  const y = (v) => H - 3 - ((H - 6) * (v - lo)) / (hi - lo || 1);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(vals.length - 1)},${H} L${x(0)},${H} Z`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${area}" fill="${col}" opacity=".14"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/><circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="2.8" fill="${col}"/></svg>`;
}
function trendsHtml(s) {
  const hist = s.history.slice(-14);
  if (hist.length < 2) return T`<div class="p-sec"><span>📈 Entwicklung</span></div><div class="empty">Trends erscheinen ab dem zweiten Tagesabschluss.</div>`;
  const last = hist[hist.length - 1], prev = hist[hist.length - 2];
  const card = (label, key, col, fmt, good = 1) => {
    const val = (r) => (key === 'profit' ? r.profit ?? (r.rev || 0) - (r.cost || 0) : r[key] ?? 0);
    const vals = hist.map(val);
    const d = val(last) - val(prev);
    const cls = d === 0 ? '' : d * good > 0 ? 'up' : 'down';
    return `<div class="trend"><div class="tr-h"><span>${label}</span><b class="${cls}">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${fmt(val(last))}</b></div>${spark(vals, col)}</div>`;
  };
  return T`<div class="p-sec"><span>📈 Entwicklung (${hist.length} Tage)</span></div><div class="trends">${card(T('Ergebnis'), 'profit', '#4ade80', (v) => fmtMoney(v))}${card(T('Passagiere'), 'pax', '#38bdf8', (v) => fmtInt(v))}${card(T('Pünktlich'), 'onTime', '#fbbf24', (v) => v + ' %')}${card(T('Ansehen'), 'rep', '#c084fc', (v) => v)}${card(T('Bewegungen'), 'mov', '#f472b6', (v) => v)}${card(T('Kasse'), 'cash', '#2dd4bf', (v) => fmtMoney(v))}</div>`;
}
function voicesHtml(s) {
  const N = newsState(s);
  const r = paxRating(s);
  let h = `<div class="p-sec"><span>💬 ${smallField(s) ? T('Stimmen am Platz') : T('Passagierstimmen')}</span>${r ? `<span class="cnt">${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))} ${r.toFixed(1).replace('.', DEC)}</span>` : ''}</div>`;
  if (!N.quotes.length) return h + T('<div class="empty">Noch keine Stimmen – die ersten Reisenden sind unterwegs.</div>');
  h += N.quotes.slice(0, 4).map((q) => `<div class="card voice"><div class="v-st">${'★'.repeat(q.stars)}<span>${'★'.repeat(5 - q.stars)}</span></div><div class="v-t">„${esc(q.text)}“</div><div class="s">${esc(q.who)} · ${fmtClock(q.t)}</div></div>`).join('');
  h += T`<div class="p-sec"><span>📰 Nachrichten</span></div>` + N.items.slice(0, 5).map((i) => `<div class="card news ${i.tone}"><span>${i.icon}</span><div><div class="v-t">${esc(i.text)}</div><div class="s">${fmtClock(i.t)}</div></div></div>`).join('');
  return h;
}

// Wettbewerb gegen Nordhafen: Marktanteil, Vergleich, Züge der Konkurrenz
function rivalHtml(s) {
  const R = rivalState(s);
  const sh = Math.round(R.share);
  const tgt = shareTarget(s);
  const trend = tgt > R.share + 1 ? T('▲ steigt') : tgt < R.share - 1 ? T('▼ sinkt') : T('• stabil');
  const tcls = tgt > R.share + 1 ? 'up' : tgt < R.share - 1 ? 'down' : '';
  const o = ourScore(s), r = rivalScore(s);
  const row = (label, a, b, fmt, higher = true, tip = '') => {
    const win = higher ? a > b + 1e-6 : a < b - 1e-6;
    const lose = higher ? a < b - 1e-6 : a > b + 1e-6;
    return `<tr title="${tip}"><td>${label}</td><td class="${win ? 'w' : lose ? 'l' : ''}">${fmt(a)}</td><td class="${lose ? 'w' : win ? 'l' : ''}">${fmt(b)}</td></tr>`;
  };
  const pct = (v) => Math.round(v * 100) + ' %';
  const offerF = offerFactor(s);
  let h = T`<div class="rv-wrap"><div class="rv-hero"><div class="rv-big"><span>Marktanteil in der Region</span><b>${sh} %</b><em class="${tcls}">${trend}</em></div>
    <div class="rv-mid"><div class="rv-lab"><span class="a">✈️ ${esc(s.name)}</span><span class="b">${RIVAL_NAME} 🏢</span></div><div class="rv-bar"><i style="width:${R.share}%"></i><span class="a">${sh} %</span><span class="b">${100 - sh} %</span></div></div>
    <div class="rv-spark">${R.hist.length > 1 ? spark([...R.hist, R.share], '#38bdf8') : T('<small>Verlauf ab dem zweiten Tag</small>')}</div></div>`;
  h += T`<div class="rv-grid"><table class="rv-tab"><thead><tr><th></th><th>${esc(s.name)}</th><th>${RIVAL_NAME}</th></tr></thead><tbody>
    ${row(T('Ansehen'), o.rep, r.rep, (v) => Math.round(v * 100), true, T('wichtigster Faktor'))}
    ${row(T('Pünktlichkeit'), o.punct, r.punct, pct, true, T('gestern'))}
    ${row(T('Entgelte (Index)'), o.fees, r.fees, (v) => v.toFixed(2).replace('.', DEC), false, T('niedriger ist attraktiver für Airlines'))}
    ${row(T('Kapazität'), o.cap, r.cap, (v) => v.toFixed(2).replace('.', DEC), true, T('Positionen, Parallelbahn, Rang'))}
    </tbody></table>
    <div class="rv-fx"><div class="p-sec"><span>Auswirkungen</span></div>
      <div class="s">📨 Neue Airline-Angebote kommen <b>${offerF < 1 ? T`${Math.round((1 / offerF - 1) * 100)} % öfter` : offerF > 1 ? T`${Math.round((1 - 1 / offerF) * 100)} % seltener` : T('normal oft')}</b></div>
      <div class="s">✍️ Vertragsverlängerungen <b>${renewBonus(s) >= 0 ? '+' : ''}${Math.round(renewBonus(s) * 100)} %</b></div>
      <div class="s">🏢 Abgeworbene Verbindungen: <b>${R.poached}</b> · 🛬 übernommene Umleitungen: <b>${R.won}</b></div>
      ${R.feeCutUntil > s.time ? T`<div class="s warn">💸 ${RIVAL_NAME} lockt mit −12 % Entgelten bis ${fmtClock(R.feeCutUntil)} (Tag ${dayOf(R.feeCutUntil)})</div>` : ''}
      ${R.closedUntil > s.time ? T`<div class="s good">⛔ ${RIVAL_NAME} ist gesperrt bis ${fmtClock(R.closedUntil)}</div>` : ''}
      <div class="p-sec"><span>So gewinnst du Anteile</span></div>
      <div class="s">Ansehen und Pünktlichkeit hochhalten, Entgelte nicht über ${RIVAL_NAME} setzen, Positionen und Parallelbahn ausbauen. Abwerbeversuche mit Gegenangebot oder Service-Paket abwehren, Umleitungen bei Sperrungen annehmen.</div>
    </div></div>`;
  h += T`<div class="p-sec"><span>📰 Aus ${RIVAL_NAME}</span></div>`;
  h += R.news.length ? `<div class="rv-news">${R.news.map((i) => T`<div class="card news ${i.tone}"><span>${i.icon}</span><div><div class="v-t">${esc(i.text)}</div><div class="s">Tag ${dayOf(i.t)} · ${fmtClock(i.t)}</div></div></div>`).join('')}</div>` : T('<div class="empty">Noch ruhig in Nordhafen – die Konkurrenz beobachtet dich.</div>');
  return h + '</div>';
}
