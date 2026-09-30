// Management: Verträge, Ausbau, Fuhrpark, Gebühren, Finanzen
import { AC_TYPES, AIRLINES, CITIES, VEH_TYPES, UPGRADES, FEE_LIMITS, DEFAULT_FEES, MARKETING, STAND_COSTS } from '../config.js';
import { fmtMoney, fmtInt, esc, clamp, fmtClock } from '../util.js';
import { setHTML, toast } from './dom.js';
import * as EC from '../sim/economy.js';
import { acceptOffer, declineOffer, cancelContract, feeIndex, standDemand } from '../sim/schedule.js';
import { fleetSummary, efficiency } from '../sim/ground.js';
import { newsState, paxRating } from '../sim/news.js';
import { achievementsHtml } from './achUi.js';
import { PH } from '../sim/aircraft.js';
import { sfx } from '../audio.js';
import { projects, standProject, projectFor, cancelProject, standBuildHours, upgradeHours, STAND_HOURS, remainingHours } from '../sim/construction.js';
import { projectCard, projectInline, fmtHours } from './projects.js';
import { qm } from './glossary.js';
import { RWY_WORKS } from '../sim/construction.js';
import { rwyCond, brakingAction, BRAKE_DE, runwayStrips } from '../sim/runway.js';
import { fuelState, FUEL, orderFuel, maxOrder, avgCost, sellPrice, pending, burnRate, inventory } from '../sim/fuel.js';
import { loans, loanLimit, loanRate, takeLoan, repayLoan, annuity, LOAN_DAYS, debt } from '../sim/finance.js';
import { goalsState, activeGoals, goalFraction, goalText, RANKS } from '../sim/goals.js';

const TABS = [
  ['over', 'Übersicht'],
  ['contracts', 'Verträge'],
  ['build', 'Ausbau'],
  ['ops', 'Betrieb'],
  ['fuel', 'Kerosin'],
  ['fees', 'Gebühren'],
  ['fin', 'Finanzen'],
];
const KIND_DE = { contact: 'mit Fluggastbrücke', remote: 'Vorfeldposition (Bus)', cargo: 'Fracht / Vorfeld' };
const C1 = '#3987e5'; // Umsatz (Kategorie 1)
const C2 = '#d95926'; // Kosten (Kategorie 2)


// Bilder zu Ausbauten, Fahrzeugen & Co. (Management-Zentrale), damit man sieht, was man kauft
const PICS = new Set(['retail', 'security', 'lounge', 'parking', 'hotel', 'rwy2', 'ils3', 'rapidExit', 'apronLights', 'marketing', 'stand_contact', 'stand_remote', 'stand_heavy', 'veh_tug', 'veh_baggage', 'veh_fuel', 'veh_catering', 'veh_cleaning', 'veh_bus', 'veh_deice', 'staff', 'fuel_farm', 'rwy_maint', 'solar', 'rail']);
const pic = (k, tag = '') => (PICS.has(k) ? `<div class="card-pic" style="background-image:url(assets/menu/${k}.webp)">${tag ? `<span class="pic-tag">${tag}</span>` : ''}</div>` : '');

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
          a.textContent = 'Trotzdem annehmen?';
          return;
        }
        ok = acceptOffer(s, v);
        break;
      }
      case 'decline':
        declineOffer(s, v);
        break;
      case 'cancel':
        if (!a.dataset.force) {
          a.dataset.force = '1';
          a.textContent = 'Wirklich kündigen?';
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
        toast(s.settings.curfew ? '🌙 Nachtflugverbot 23–5 Uhr ab dem nächsten Flugplan' : 'Nachtflüge wieder erlaubt', 'info');
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
    const fn = { over: this.over, contracts: this.contracts, sites: this.sitesHtml, runways: this.runwaysHtml, stands: this.standsHtml, terminal: this.terminalHtml, ops: this.ops, fuel: this.fuel, fees: this.fees, fin: this.fin, goals: this.goalsHtml }[key] || this.over;
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
    setHTML(this.root.querySelector('#mp-sub'), offers ? `${offers} neue${offers > 1 ? '' : 's'} Angebot${offers > 1 ? 'e' : ''}` : '');
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
      const tag = v > 0.9 ? '⚠ voll' : v > 0.7 ? '▲ hoch' : '✓ ok';
      return `<div style="margin:6px 2px"><div class="row" style="display:flex;justify-content:space-between;font-size:12px"><span>${label}</span><span>${Math.round(v * 100)} % · ${tag}</span></div><div class="bar"><i style="width:${Math.min(100, v * 100)}%;background:${col}"></i></div></div>`;
    };
    const waiting = s.acs.filter((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand).length;
    let h = `<div class="kpis">
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
    h += `<div class="kpis kpis2">
      <div class="k" title="Starts im Slot-Fenster (CTOT) heute"><span>Slots eingehalten</span><b class="${slotTot && t.slotMiss ? 'neg' : ''}">${slotTot ? Math.round(((t.slotOk || 0) / slotTot) * 100) + ' %' : '—'}</b></div>
      <div class="k" title="Mittlere Wartezeit mit laufenden Triebwerken am Rollhalt"><span>Ø Wartezeit Rollhalt</span><b>${dN ? (((t.taxiWait || 0) / 60) / dN).toFixed(1).replace('.', ',') + ' min' : '—'}</b></div>
      <div class="k"><span>Piste</span><b class="${cond < 45 ? 'neg' : ''}">${cond} % · ${BRAKE_DE[ba]}</b></div>
      <div class="k"><span>Tanklager</span><b class="${fu.stock < FUEL.cap * 0.15 ? 'neg' : ''}">${Math.round(fu.stock)} t</b></div>
      <div class="k"><span>Kerosin</span><b>${Math.round(fu.price)} €/t</b></div>
      <div class="k" title="Nachtbewegungen / Lärmbeschwerden heute"><span>Nacht · Beschwerden</span><b>${t.nightMov || 0} · ${t.complaints || 0}</b></div>
    </div>`;
    const G = goalsState(s);
    const gl = activeGoals(s);
    h += `<div class="card goalcard"><div class="row"><span class="t">🏅 ${RANKS[G.rank].name} · ${G.xp} XP</span><button class="btn" data-act="goals">Ziele</button></div>${gl.map((g) => {
      const f = goalFraction(s, g);
      return `<div class="s">🎯 ${esc(goalText(g))}</div><div class="bar"><i style="width:${f * 100}%;background:var(--manager)"></i></div>`;
    }).join('')}</div>`;
    h += trendsHtml(s);
    h += voicesHtml(s);
    if (s.offers.length) h += `<div class="card offer"><div class="row"><span class="t">📨 ${s.offers.length} Vertragsangebot${s.offers.length > 1 ? 'e' : ''} warten</span><button class="btn" data-tab="contracts">Ansehen</button></div></div>`;
    const ps = projects(s);
    if (ps.length) {
      const next = [...ps].filter((p) => p.status !== 'waiting').sort((a, b) => remainingHours(a) - remainingHours(b))[0];
      h += `<div class="card site"><div class="row"><span class="t">🏗️ ${ps.length} Baustelle${ps.length > 1 ? 'n' : ''} aktiv</span><button class="btn" data-tab="build">Ansehen</button></div><div class="s">${next ? `Als Nächstes fertig: ${esc(next.name)} in ${fmtHours(remainingHours(next))}` : 'wartet auf freie Position'}</div></div>`;
    }
    if (waiting) h += `<div class="card" style="border-color:var(--bad)">🅿️ ${waiting} Flugzeug${waiting > 1 ? 'e warten' : ' wartet'} auf eine freie Parkposition – Ausbau prüfen.</div>`;
    h += `<div class="p-sec"><span>Auslastung (Plan)</span></div>`;
    h += meter(`Piste (${EC.plannedMovements(s)} von ~${EC.runwayCapacity(s)} Bewegungen/Tag)`, rUse) + meter('Passagierpositionen', paxUse) + meter('Großraum (Klasse L)', lUse) + meter('Fracht', cUse);
    if (rUse > 0.9) h += `<div class="card" style="border-color:var(--bad)">🛬 Die Piste ist ausgelastet – weitere Verträge führen zu langen Warteschleifen, Treibstoffnot und Vorfällen. Schnellabrollwege oder die Parallelbahn schaffen Kapazität.</div>`;
    h += `<div class="p-sec"><span>Airline-Zufriedenheit</span></div>`;
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
        return `<div style="margin:6px 2px"><div style="display:flex;justify-content:space-between;font-size:12px"><span><i class="al-dot" style="background:${al.color}"></i>${al.name} · ${v.fl} Flüge/Tag</span><span>${Math.round(sat)} %</span></div><div class="bar"><i style="width:${sat}%;background:${col}"></i></div></div>`;
      })
      .join('');
    return h;
  }

  // ---------- Verträge ----------
  contracts(s) {
    let h = this.page ? `<div class="rm-wrap"><div class="p-sec"><span>🌍 Streckennetz</span><span class="cnt">${new Set(s.contracts.map((c) => c.city)).size} Ziele</span></div><div class="rm-slot"></div></div>` : '';
    h += `<div class="p-sec"><span>Angebote${qm('contracts')}</span><span class="cnt">${s.offers.length}</span></div>`;
    if (!s.offers.length) h += `<div class="empty">Keine offenen Angebote. Gutes Ansehen, faire Gebühren und Marketing bringen neue Airlines.</div>`;
    for (const o of s.offers) {
      const al = AIRLINES[o.airline];
      const t = AC_TYPES[o.type];
      const fits = EC.offerFits(s, o);
      h += `<div class="card offer"><div class="row"><span class="t"><i class="al-dot" style="background:${al.color}"></i>${al.name}</span><span style="color:var(--muted);font-size:12px">läuft ab ${fmtClock(o.expires)}</span></div>
        <div class="s">${o.perDay}× täglich ${CITIES[o.city].name} · ${t.name} · ${o.days} Tage</div>
        <div class="s">Erwarteter Umsatz ≈ <b style="color:var(--txt)">${fmtMoney(o.estRev)}</b> pro Tag ${fits ? '<span style="color:var(--good)">✓ Kapazität vorhanden</span>' : '<span style="color:var(--warn)">⚠ Positionen knapp</span>'}</div>
        <div class="acts"><button class="btn btn-good" data-act="accept" data-v="${o.id}">Annehmen</button><button class="btn" data-act="decline" data-v="${o.id}">Ablehnen</button></div></div>`;
    }
    h += `<div class="p-sec"><span>Laufende Verträge</span><span class="cnt">${s.contracts.length}</span></div>`;
    const sorted = [...s.contracts].sort((a, b) => a.days - b.days);
    for (const c of sorted) {
      const al = AIRLINES[c.airline];
      const col = c.sat < 45 ? 'var(--bad)' : c.sat < 65 ? 'var(--warn)' : 'var(--good)';
      h += `<div class="card"><div class="row"><span class="t"><i class="al-dot" style="background:${al.color}"></i>${al.name} → ${CITIES[c.city].name}</span><span style="font-size:12px;color:${c.days <= 3 ? 'var(--warn)' : 'var(--muted)'}">${c.days} Tage</span></div>
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
    let h = `<div class="p-sec"><span>🏗️ Baustellen${qm('build')}</span><span class="cnt">${ps.length}</span></div>`;
    if (!ps.length) h += `<div class="empty">Keine laufenden Bauprojekte. Aufträge unter Pisten, Parkpositionen oder Terminal starten – jedes Projekt braucht Bauzeit und ist auf der Karte als Baustelle zu sehen.</div>`;
    for (const p of ps) h += projectCard(s, p, this.armP === p.id);
    return h;
  }

  runwaysHtml(s) {
    const ps = projects(s);
    const rwyBusy = ps.some((p) => p.kind === 'rwy');
    let h = `<div class="p-sec"><span>🛬 Pisten${qm('rwy')}</span></div><div class="card has-pic pic-only">${pic('rwy_maint', 'Pistenwartung: Gummiabrieb entfernen oder neu asphaltieren')}</div>`;
    for (const strip of runwayStrips(s)) {
      const cond = Math.round(rwyCond(s, strip.id));
      const ba = brakingAction(s, strip.id);
      h += `<div class="card"><div class="row"><span class="t">${strip.icon} ${esc(strip.label)} · ${esc(strip.role)}</span><span style="font-size:12px">Bremswirkung <b class="ba-${ba}">${BRAKE_DE[ba]}</b></span></div>
        <div class="row" style="font-size:12px;color:var(--muted);margin-top:3px"><span>Zustand ${cond} %</span><span>${strip.len}</span></div><div class="bar"><i style="width:${cond}%;background:${cond < 35 ? 'var(--bad)' : cond < 60 ? 'var(--warn)' : 'var(--good)'}"></i></div>
        <div class="acts">${Object.entries(RWY_WORKS).map(([k, w]) => `<button class="btn${k === 'clean' ? ' btn-good' : ''}" data-act="rwy" data-v="${k}:${strip.id}" ${rwyBusy || s.cash < w.cost ? 'disabled' : ''} title="${esc(w.desc)}">${w.name} · ${fmtMoney(w.cost)} · ${w.hours} h</button>`).join('')}</div></div>`;
    }
    h += `<div class="s" style="font-size:12px;color:var(--muted);margin:2px 4px 8px">Jede Landung hinterlässt Gummiabrieb (schwere Flugzeuge mehr). Unter 60 % wird die Bremswirkung bei Nässe schlecht. Arbeiten laufen nachts (22:30–5:30) in Verkehrspausen und sperren die jeweilige Piste.${rwyBusy ? ' 🏗️ Arbeiten beauftragt.' : ''}</div>`;
    h += this.upgradesHtml(s, ['Pisten'], false) + this.upgradesHtml(s, ['Betrieb'], true, 'Rollwege, Befeuerung & Navigation');
    return h;
  }

  standsHtml(s) {
    let h = `<div class="p-sec"><span>🅿️ Parkpositionen</span><span class="cnt">${s.stands.filter((x) => x.built).length} / ${s.stands.length}</span></div>`;
    for (const st of s.stands) {
      const occ = st.occ ? s.acs.find((a) => a.id === st.occ) : null;
      const pj = standProject(s, st.id);
      if (!st.built) {
        const cost = EC.standBuildCost(st);
        const right = pj ? projectInline(pj) : `<button class="btn btn-good" data-act="stand" data-v="${st.id}" ${s.cash < cost ? 'disabled' : ''}>Bauen ${fmtMoney(cost)}</button>`;
        const sp = st.kind === 'remote' ? 'stand_remote' : st.size === 'L' ? 'stand_heavy' : 'stand_contact';
        h += `<div class="card has-pic${pj ? ' site' : ''}">${pic(sp)}<div class="row"><span class="t">P${st.id} · ${KIND_DE[st.kind]} · Klasse ${st.size}</span>${right}</div>${pj ? '' : `<div class="s">Bauzeit ${standBuildHours(st)} h · noch nicht gebaut</div>`}</div>`;
      } else {
        const up = pj ? projectInline(pj) : st.size !== 'L' && st.kind !== 'cargo' ? `<button class="mini" data-act="standL" data-v="${st.id}" ${s.cash < STAND_COSTS.upgradeL ? 'disabled' : ''}>→ Klasse L (${fmtMoney(STAND_COSTS.upgradeL)} · ${STAND_HOURS.upgradeL} h, Position gesperrt)</button>` : '';
        const rot = occ ? s.rots[occ.rot] : null;
        const detail = occ ? `${esc(occ.cs)} · ${occ.type}${rot ? ` · STD ${fmtClock(rot.std)}` : ''}` : st.resv ? 'reserviert' : 'frei';
        h += `<div class="card${pj ? ' site' : ''}"><div class="row"><span class="t">P${st.id} · ${KIND_DE[st.kind]} · ${st.size}</span><span style="font-size:12px;color:var(--muted)">${st.closed ? 'gesperrt (Bau)' : detail}</span></div>${up ? `<div class="acts">${up}</div>` : ''}</div>`;
      }
    }
    return h;
  }

  upgradesHtml(s, catList, withHead = true, title = null) {
    let h = '';
    for (const cat of catList) {
      const list = Object.entries(UPGRADES).filter(([, u]) => u.cat === cat);
      if (!list.length) continue;
      if (withHead) h += `<div class="p-sec"><span>${title || cat}</span></div>`;
      for (const [k, u] of list) {
        const lvl = s.upgrades[k] || 0;
        const maxed = lvl >= u.max;
        const cost = maxed ? 0 : u.cost[lvl];
        const pj = projectFor(s, 'upgrade', k);
        const dots = Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : pj && i === lvl ? 'bld' : ''}"></i>`).join('');
        const locked = u.requires && !s.upgrades[u.requires];
        const right = pj ? projectInline(pj) : maxed ? '<span style="color:var(--good);font-size:12px">✓ voll ausgebaut</span>' : locked ? `<span style="font-size:12px;color:var(--muted)">erst ${esc(UPGRADES[u.requires].name)}</span>` : `<button class="btn btn-good" data-act="up" data-v="${k}" ${s.cash < cost ? 'disabled' : ''}>${fmtMoney(cost)}</button>`;
        h += `<div class="card has-pic${pj ? ' site' : ''}${u.big ? ' bigcard' : ''}">${pic(k, maxed ? '✓ fertig' : lvl ? `Stufe ${lvl}/${u.max}` : '')}<div class="row"><span class="t">${u.icon ? u.icon + ' ' : ''}${u.name}<span class="lvl">${dots}</span></span>${right}</div><div class="s">${u.desc}${!pj && !maxed ? ` · Bauzeit ${upgradeHours(k, lvl + 1)} h` : ''}</div>${u.more ? `<div class="s">${u.more}</div>` : ''}</div>`;
      }
    }
    return h;
  }

  marketingHtml(s) {
    const mk = s.marketingUntil > s.time;
    return `<div class="p-sec"><span>Marketing</span></div><div class="card has-pic">${pic('marketing', mk ? 'läuft' : '')}<div class="row"><span class="t">📣 Kampagne „Fly ${esc(s.name.split(' ')[0])}“</span><button class="btn" data-act="mkt" ${s.cash < MARKETING.cost || mk ? 'disabled' : ''}>${mk ? 'läuft' : fmtMoney(MARKETING.cost)}</button></div><div class="s">Mehr Angebote und Ansehen für ${MARKETING.days} Tage.</div></div>`;
  }

  terminalHtml(s) {
    return this.upgradesHtml(s, ['Terminal', 'Landseite']) + this.marketingHtml(s);
  }

  goalsHtml(s) {
    const G = goalsState(s);
    const next = RANKS[G.rank + 1];
    const pct = next ? Math.round(((G.xp - RANKS[G.rank].xp) / (next.xp - RANKS[G.rank].xp)) * 100) : 100;
    let h = `<div class="p-sec"><span>🏅 Flughafen-Rang${qm('goals')}</span></div><div class="card"><div class="row"><span class="t">${RANKS[G.rank].name}</span><span style="font-family:var(--mono);font-size:12px">${G.xp} XP</span></div><div class="bar"><i style="width:${pct}%;background:linear-gradient(90deg,#f59e0b,#fde047)"></i></div><div class="s">${next ? `Nächster Rang „${next.name}“ ab ${next.xp} XP` : 'Höchster Rang erreicht'} · ${G.done} Ziele erreicht</div><div class="rank-steps">${RANKS.map((r, i) => `<span class="${i <= G.rank ? 'on' : ''}">${i + 1}. ${r.name}</span>`).join('')}</div></div>`;
    h += achievementsHtml(s);
    h += `<div class="p-sec"><span>🎯 Ziele</span></div>`;
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
    let h = `<div class="p-sec"><span>Fuhrpark</span><span class="cnt">${s.vehicles.length} / 24</span></div>`;
    for (const [k, vt] of Object.entries(VEH_TYPES)) {
      const f = fs[k];
      const w = Math.round((wait[k] || 0) / 60);
      h += `<div class="card has-pic">${pic('veh_' + k, `${f.total}× im Fuhrpark`)}<div class="row"><span class="t">${vt.name}</span><span style="font-family:var(--mono)">${f.total}× <small style="color:var(--muted)">(${f.busy} im Einsatz${f.broken ? `, ${f.broken} defekt` : ''})</small></span></div>
        <div class="s">Wartezeit auf Fahrzeug zuletzt: ${w} min ${w > 30 ? '<span style="color:var(--warn)">– Engpass!</span>' : ''} · Unterhalt ${fmtMoney(vt.upkeep)}/Tag</div>
        <div class="acts"><button class="btn btn-good" data-act="buy" data-v="${k}" ${s.cash < vt.price ? 'disabled' : ''}>+ Kaufen ${fmtMoney(vt.price)}</button><button class="btn" data-act="sell" data-v="${k}">− Verkaufen</button></div></div>`;
    }
    h += `<div class="p-sec"><span>Bodenpersonal</span></div>
      <div class="card has-pic">${pic('staff')}<div class="row"><span class="t">${s.staff} Mitarbeitende</span><span>Effizienz <b style="font-family:var(--mono);color:${eff < 0.9 ? 'var(--warn)' : 'var(--good)'}">${Math.round(eff * 100)} %</b></span></div>
      <div class="s">Bedarf ≈ ${Math.round(10 + 2.2 * s.vehicles.length)} · Kosten ${fmtMoney(260)} je Person/Tag</div>
      <div class="acts"><button class="btn btn-good" data-act="hire" data-v="5">+5 einstellen</button><button class="btn" data-act="hire" data-v="-5">−5 abbauen</button></div></div>`;
    const fc = EC.dailyFixedCosts(s);
    h += `<div class="p-sec"><span>Fixkosten pro Tag</span></div><table class="ledger">`;
    let sum = 0;
    for (const [k, v] of Object.entries(fc)) {
      sum += v;
      h += `<tr><td>${EC.COST_CATS[k]}</td><td>${fmtMoney(v, false)}</td></tr>`;
    }
    h += `<tr class="sum"><td>Summe</td><td>${fmtMoney(sum, false)}</td></tr></table>`;
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
    let h = `<div class="kpis">
      <div class="k"><span>Marktpreis</span><b>${Math.round(f.price)} €/t</b></div>
      <div class="k" title="Durchschnittlicher Einstandspreis des Lagerbestands"><span>Ø Einkauf</span><b>${Math.round(avg)} €/t</b></div>
      <div class="k"><span>Verkauf</span><b>${Math.round(sp)} €/t</b></div>
      <div class="k"><span>Bestand</span><b class="${lvl < 0.15 ? 'neg' : ''}">${Math.round(f.stock)} t</b></div>
      <div class="k" title="Bestand plus Bestellungen geteilt durch den Verbrauch der letzten 24 h"><span>Reichweite</span><b>${reach ? reach.toFixed(1).replace('.', ',') + ' Tage' : '—'}</b></div>
      <div class="k"><span>Heute vertankt</span><b>${Math.round(s.stats.today.fuelSold || 0)} t</b></div>
    </div>`;
    h += `<div class="p-sec"><span>Tanklager${qm('fuel')}</span><span class="cnt">${Math.round(lvl * 100)} %</span></div><div class="card has-pic pic-only">${pic('fuel_farm', `${Math.round(f.stock)} t auf Lager`)}</div><div class="bar" style="height:10px"><i style="width:${lvl * 100}%;background:${lvl < 0.15 ? 'var(--bad)' : lvl < 0.3 ? 'var(--warn)' : 'var(--good)'}"></i></div>`;
    h += `<div class="s" style="font-size:12px;color:var(--muted);margin:4px 2px">${Math.round(f.stock)} von ${FUEL.cap} t · in Tankwagen ${Math.round(inventory(s) - f.stock)} t · Lagerwert ${fmtMoney(f.value)}</div>`;
    if (hist.length > 1) {
      h += `<div class="p-sec"><span>Marktpreis letzte ${hist.length} h (€/t)</span></div>`;
      h += priceSvg(hist, avg);
    }
    h += `<div class="p-sec"><span>Einkaufen</span></div><div class="card"><div class="row"><span class="t">Spotkauf zu ${Math.round(f.price * 1.02)} €/t</span><span style="font-size:12px;color:var(--muted)">inkl. 2 % Transport · Lieferung in 2–3,5 h</span></div><div class="acts">${[100, 250, 500].map((q) => `<button class="btn btn-good" data-act="fbuy" data-v="${q}" ${q > maxOrder(s) || s.cash < q * f.price * 1.02 ? 'disabled' : ''}>+${q} t · ${fmtMoney(q * f.price * 1.02)}</button>`).join('')}<button class="btn" data-act="fbuy" data-v="fill" ${maxOrder(s) < 10 ? 'disabled' : ''}>Auffüllen (${maxOrder(s)} t)</button></div>
      <div class="toggle-row" style="margin-top:8px"><span>Automatisch nachbestellen (unter 45 %, bei günstigem Preis mehr)</span><button class="switch ${f.auto ? 'on' : ''}" data-act="fauto"></button></div></div>`;
    for (const o of f.orders) h += `<div class="card"><div class="row"><span class="t">🚚 ${o.qty} t unterwegs</span><span style="font-family:var(--mono);font-size:12px">ca. ${fmtClock(o.eta)}</span></div><div class="s">${Math.round(o.unit)} €/t · ${fmtMoney(o.qty * o.unit)}</div></div>`;
    const m = Math.round(f.margin * 100);
    h += `<div class="p-sec"><span>Verkaufsmarge</span></div><div class="fee-row"><div class="row"><span>Aufschlag auf den Marktpreis</span><b data-fuelmval style="font-family:var(--mono)">${m} %</b></div><input type="range" min="${FUEL.marginRange[0] * 100}" max="${FUEL.marginRange[1] * 100}" step="1" value="${m}" data-fuelm /><div class="hint">Über 10 % tanken Airlines woanders vor (Tankering) – weniger Absatz. Gewinn je Tonne = Verkaufspreis − Ø Einkauf.</div></div>`;
    return h;
  }

  // ---------- Gebühren ----------
  fees(s) {
    const fi = feeIndex(s);
    const mood = fi > 1.25 ? ['var(--bad)', 'Airlines verärgert – weniger Angebote, Kündigungen drohen'] : fi > 1.05 ? ['var(--warn)', 'Airlines skeptisch'] : fi < 0.85 ? ['var(--good)', 'Sehr attraktiv – aber weniger Erlös je Flug'] : ['var(--good)', 'Marktüblich'];
    let h = `<div class="card"><div class="row"><span class="t">Preisniveau ${Math.round(fi * 100)} %</span><span style="color:${mood[0]};font-size:12px">${mood[1]}</span></div><div class="s">100 % = Marktdurchschnitt. Änderungen wirken sofort auf neue Flüge und langsam auf die Zufriedenheit.</div></div>`;
    const rows = [
      ['landing', 'Landeentgelt', 'je Tonne Höchstabfluggewicht'],
      ['pax', 'Passagierentgelt', 'je abfliegendem Passagier'],
      ['parking', 'Positionsentgelt', 'je Stunde an der Parkposition'],
    ];
    for (const [k, name, hint] of rows) {
      const [a, b] = FEE_LIMITS[k];
      h += `<div class="fee-row"><div class="row"><span>${name}</span><b data-feeval="${k}" style="font-family:var(--mono)">${feeLabel(k, s.fees[k])}</b></div><input type="range" min="${a}" max="${b}" step="0.5" value="${s.fees[k]}" data-fee="${k}" /><div class="hint">${hint} · Standard ${feeLabel(k, DEFAULT_FEES[k])}</div></div>`;
    }
    h += `<div class="p-sec"><span>Nachtflüge (23–5 Uhr)${qm('fees')}</span></div>`;
    const [na, nb] = FEE_LIMITS.night;
    h += `<div class="toggle-row"><span>🌙 Nachtflugverbot – keine planmäßigen Nachtflüge, Ausnahmen kosten Bußgeld</span><button class="switch ${s.settings.curfew ? 'on' : ''}" data-act="curfew"></button></div>`;
    h += `<div class="fee-row"><div class="row"><span>Nacht-/Lärmentgelt je Bewegung</span><b data-feeval="night" style="font-family:var(--mono)">${feeLabel('night', s.fees.night ?? 600)}</b></div><input type="range" min="${na}" max="${nb}" step="50" value="${s.fees.night ?? 600}" data-fee="night" ${s.settings.curfew ? 'disabled' : ''} /><div class="hint">Heavy zahlt 2×, Light 0,5×. Hohe Entgelte ärgern Frachtairlines. Heute: ${s.stats.today.nightMov || 0} Nachtbewegungen, ${s.stats.today.complaints || 0} Lärmbeschwerden (ab 40 protestiert die Bürgerinitiative).</div></div>`;
    h += `<button class="btn" data-act="feereset">Auf Standard zurücksetzen</button>`;
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
      h += `<div class="p-sec"><span>Umsatz und Kosten je Tag</span></div>`;
      h += `<div class="legend"><span><i style="background:${C1}"></i>Umsatz</span><span><i style="background:${C2}"></i>Betriebskosten</span></div>`;
      h += barsSvg(hist);
      h += `<div class="p-sec"><span>Kontostand am Tagesende</span></div>`;
      h += lineSvg(hist);
    } else h += `<div class="empty">Diagramme erscheinen nach dem ersten Tagesabschluss (Mitternacht).</div>`;
    h += `<div class="p-sec"><span>Heute bisher</span></div><table class="ledger">`;
    for (const [k, v] of Object.entries(L.rev).sort((a, b) => b[1] - a[1])) h += `<tr><td>${EC.REV_CATS[k] || k}</td><td style="color:var(--good)">+${fmtMoney(v, false)}</td></tr>`;
    h += `<tr class="sum"><td>Umsatz</td><td>${fmtMoney(rev, false)}</td></tr>`;
    for (const [k, v] of Object.entries(L.cost).sort((a, b) => b[1] - a[1])) h += `<tr><td>${EC.COST_CATS[k] || k}</td><td style="color:#fca5a5">−${fmtMoney(v, false)}</td></tr>`;
    h += `<tr class="sum"><td>Kosten</td><td>${fmtMoney(cost, false)}</td></tr>`;
    h += `<tr class="sum"><td>Betriebsergebnis</td><td>${fmtMoney(rev - cost, false)}</td></tr>`;
    if (L.capex) h += `<tr><td>Investitionen (Bau, Fahrzeuge)</td><td>−${fmtMoney(L.capex, false)}</td></tr>`;
    if (L.fuelBuy) h += `<tr><td>Kerosineinkauf (Lager)</td><td>−${fmtMoney(L.fuelBuy, false)}</td></tr>`;
    if (L.repay) h += `<tr><td>Kredittilgung</td><td>−${fmtMoney(L.repay, false)}</td></tr>`;
    h += `</table>`;
    // Kredite
    const lim = loanLimit(s);
    const r = loanRate(s);
    h += `<div class="p-sec"><span>🏦 Kredite${qm('loans')}</span><span class="cnt">${fmtMoney(debt(s))}</span></div>`;
    h += `<div class="card"><div class="row"><span class="t">Kreditrahmen ${fmtMoney(lim)}</span><span style="font-size:12px;color:var(--muted)">Zins ${(r * 100).toFixed(2).replace('.', ',')} % pro Tag</span></div><div class="s">Laufzeit ${LOAN_DAYS} Tage, gleiche Tagesraten. Besseres Ansehen = günstigerer Zins und höherer Rahmen.</div><div class="acts">${[1e6, 2e6, 5e6].map((a) => `<button class="btn" data-act="loan" data-v="${a}" ${a > lim ? 'disabled' : ''}>+${fmtMoney(a)} <small>(${fmtMoney(annuity(a, r))}/Tag)</small></button>`).join('')}</div></div>`;
    for (const l of loans(s)) h += `<div class="card"><div class="row"><span class="t">Kredit ${fmtMoney(l.amount)}</span><span style="font-family:var(--mono);font-size:12px">Rest ${fmtMoney(l.rest)}</span></div><div class="bar"><i style="width:${(1 - l.rest / l.amount) * 100}%"></i></div><div class="s">Rate ${fmtMoney(l.daily)}/Tag · noch ${l.days} Tage · ${(l.rate * 100).toFixed(2).replace('.', ',')} %/Tag</div><div class="acts"><button class="mini" data-act="repay" data-v="${l.id}" ${s.cash < l.rest ? 'disabled' : ''}>Sondertilgung ${fmtMoney(l.rest)}</button></div></div>`;
    if (hist.length) {
      h += `<div class="p-sec"><span>Tabelle</span></div><table class="ledger"><tr><td><b>Tag</b></td><td><b>Umsatz · Kosten · Bew. · pünktl.</b></td></tr>`;
      for (const r of [...hist].reverse()) h += `<tr><td>Tag ${r.day}</td><td>${fmtMoney(r.rev)} · ${fmtMoney(r.cost)} · ${r.mov} · ${r.onTime}%</td></tr>`;
      h += `</table>`;
    }
    return h;
  }
}

function feeLabel(k, v) {
  if (k === 'night') return `${Math.round(v)} €`;
  if (k === 'landing') return `${v.toFixed(1).replace('.', ',')} €/t`;
  if (k === 'pax') return `${v.toFixed(1).replace('.', ',')} €`;
  return `${Math.round(v)} €/h`;
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const kTick = (v) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio` : v >= 1e3 ? `${Math.round(v / 1e3)} Tsd` : String(Math.round(v)));

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
    g += bar(cx - bw - 1, r.rev, C1, `Tag ${r.day} · Umsatz ${fmtMoney(r.rev)}`);
    g += bar(cx + 1, r.cost, C2, `Tag ${r.day} · Kosten ${fmtMoney(r.cost)}`);
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
  g += `<line x1="${pl}" x2="${W - pr}" y1="${y(avg)}" y2="${y(avg)}" stroke="${C2}" stroke-dasharray="4 3" stroke-width="1.5"/><text x="${W - pr + 4}" y="${y(avg) + 3}" font-size="9" fill="${C2}">Ø Einkauf</text>`;
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  g += `<path d="${d}" fill="none" stroke="${C1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  hist.forEach((hh, i) => {
    g += `<circle cx="${x(i)}" cy="${y(hh.p)}" r="6" fill="transparent" data-tip="${fmtClock(hh.t)} · ${hh.p} €/t · Bestand ${hh.s} t"/>`;
    if (i % 12 === 0) g += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#94a3b8">${fmtClock(hh.t)}</text>`;
  });
  const last = vals[n - 1];
  g += `<circle cx="${x(n - 1)}" cy="${y(last)}" r="4" fill="${C1}" stroke="#161e2e" stroke-width="2"/><text x="${x(n - 1) + 6}" y="${y(last) - 6}" font-size="10" fill="#e5edf7">${last}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kerosinpreis">${g}</svg>`;
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
  if (hist.length < 2) return `<div class="p-sec"><span>📈 Entwicklung</span></div><div class="empty">Trends erscheinen ab dem zweiten Tagesabschluss.</div>`;
  const last = hist[hist.length - 1], prev = hist[hist.length - 2];
  const card = (label, key, col, fmt, good = 1) => {
    const val = (r) => (key === 'profit' ? r.profit ?? (r.rev || 0) - (r.cost || 0) : r[key] ?? 0);
    const vals = hist.map(val);
    const d = val(last) - val(prev);
    const cls = d === 0 ? '' : d * good > 0 ? 'up' : 'down';
    return `<div class="trend"><div class="tr-h"><span>${label}</span><b class="${cls}">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${fmt(val(last))}</b></div>${spark(vals, col)}</div>`;
  };
  return `<div class="p-sec"><span>📈 Entwicklung (${hist.length} Tage)</span></div><div class="trends">${card('Ergebnis', 'profit', '#4ade80', (v) => fmtMoney(v))}${card('Passagiere', 'pax', '#38bdf8', (v) => fmtInt(v))}${card('Pünktlich', 'onTime', '#fbbf24', (v) => v + ' %')}${card('Ansehen', 'rep', '#c084fc', (v) => v)}${card('Bewegungen', 'mov', '#f472b6', (v) => v)}${card('Kasse', 'cash', '#2dd4bf', (v) => fmtMoney(v))}</div>`;
}
function voicesHtml(s) {
  const N = newsState(s);
  const r = paxRating(s);
  let h = `<div class="p-sec"><span>💬 Passagierstimmen</span>${r ? `<span class="cnt">${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))} ${r.toFixed(1).replace('.', ',')}</span>` : ''}</div>`;
  if (!N.quotes.length) return h + '<div class="empty">Noch keine Stimmen – die ersten Reisenden sind unterwegs.</div>';
  h += N.quotes.slice(0, 4).map((q) => `<div class="card voice"><div class="v-st">${'★'.repeat(q.stars)}<span>${'★'.repeat(5 - q.stars)}</span></div><div class="v-t">„${esc(q.text)}“</div><div class="s">${esc(q.who)} · ${fmtClock(q.t)}</div></div>`).join('');
  h += `<div class="p-sec"><span>📰 Nachrichten</span></div>` + N.items.slice(0, 5).map((i) => `<div class="card news ${i.tone}"><span>${i.icon}</span><div><div class="v-t">${esc(i.text)}</div><div class="s">${fmtClock(i.t)}</div></div></div>`).join('');
  return h;
}
