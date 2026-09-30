// Management: Verträge, Ausbau, Fuhrpark, Gebühren, Finanzen
import { AC_TYPES, AIRLINES, CITIES, VEH_TYPES, UPGRADES, FEE_LIMITS, DEFAULT_FEES, MARKETING, STAND_COSTS } from '../config.js';
import { fmtMoney, fmtInt, esc, clamp, fmtClock } from '../util.js';
import { setHTML, toast } from './dom.js';
import * as EC from '../sim/economy.js';
import { acceptOffer, declineOffer, cancelContract, feeIndex, standDemand } from '../sim/schedule.js';
import { fleetSummary, efficiency } from '../sim/ground.js';
import { PH } from '../sim/aircraft.js';
import { sfx } from '../audio.js';

const TABS = [
  ['over', 'Übersicht'],
  ['contracts', 'Verträge'],
  ['build', 'Ausbau'],
  ['ops', 'Betrieb'],
  ['fees', 'Gebühren'],
  ['fin', 'Finanzen'],
];
const KIND_DE = { contact: 'mit Fluggastbrücke', remote: 'Vorfeldposition (Bus)', cargo: 'Fracht / Vorfeld' };
const C1 = '#3987e5'; // Umsatz (Kategorie 1)
const C2 = '#d95926'; // Kosten (Kategorie 2)

export class ManagerPanel {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.tab = 'over';
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
    if (tb) return this.setTab(tb.dataset.tab);
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
      case 'feereset':
        s.fees = { ...DEFAULT_FEES };
        break;
    }
    if (ok) sfx.cash();
    this.body._html = null;
    this.update(s);
  }

  onInput(e) {
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
    const fn = { over: this.over, contracts: this.contracts, build: this.build, ops: this.ops, fees: this.fees, fin: this.fin }[this.tab];
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
    if (s.offers.length) h += `<div class="card offer"><div class="row"><span class="t">📨 ${s.offers.length} Vertragsangebot${s.offers.length > 1 ? 'e' : ''} warten</span><button class="btn" data-tab="contracts">Ansehen</button></div></div>`;
    if (waiting) h += `<div class="card" style="border-color:var(--bad)">🅿️ ${waiting} Flugzeug${waiting > 1 ? 'e warten' : ' wartet'} auf eine freie Parkposition – Ausbau prüfen.</div>`;
    h += `<div class="p-sec"><span>Auslastung Parkpositionen (Plan)</span></div>`;
    h += meter('Passagierpositionen', paxUse) + meter('Großraum (Klasse L)', lUse) + meter('Fracht', cUse);
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
    let h = `<div class="p-sec"><span>Angebote</span><span class="cnt">${s.offers.length}</span></div>`;
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

  // ---------- Ausbau ----------
  build(s) {
    let h = `<div class="p-sec"><span>Parkpositionen</span></div>`;
    for (const st of s.stands) {
      const occ = st.occ ? s.acs.find((a) => a.id === st.occ) : null;
      if (!st.built) {
        const cost = EC.standBuildCost(st);
        h += `<div class="card"><div class="row"><span class="t">P${st.id} · ${KIND_DE[st.kind]} · Klasse ${st.size}</span><button class="btn btn-good" data-act="stand" data-v="${st.id}" ${s.cash < cost ? 'disabled' : ''}>Bauen ${fmtMoney(cost)}</button></div></div>`;
      } else {
        const up = st.size !== 'L' && st.kind !== 'cargo' ? `<button class="mini" data-act="standL" data-v="${st.id}" ${s.cash < STAND_COSTS.upgradeL ? 'disabled' : ''}>→ Klasse L (${fmtMoney(STAND_COSTS.upgradeL)})</button>` : '';
        h += `<div class="card"><div class="row"><span class="t">P${st.id} · ${KIND_DE[st.kind]} · ${st.size}</span><span style="font-size:12px;color:var(--muted)">${occ ? esc(occ.cs) : st.resv ? 'reserviert' : 'frei'}</span></div>${up ? `<div class="acts">${up}</div>` : ''}</div>`;
      }
    }
    const cats = {};
    for (const [k, u] of Object.entries(UPGRADES)) (cats[u.cat] = cats[u.cat] || []).push([k, u]);
    for (const [cat, list] of Object.entries(cats)) {
      h += `<div class="p-sec"><span>${cat}</span></div>`;
      for (const [k, u] of list) {
        const lvl = s.upgrades[k] || 0;
        const maxed = lvl >= u.max;
        const cost = maxed ? 0 : u.cost[lvl];
        const dots = Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        h += `<div class="card"><div class="row"><span class="t">${u.name}<span class="lvl">${dots}</span></span>${maxed ? '<span style="color:var(--good);font-size:12px">✓ voll ausgebaut</span>' : `<button class="btn btn-good" data-act="up" data-v="${k}" ${s.cash < cost ? 'disabled' : ''}>${fmtMoney(cost)}</button>`}</div><div class="s">${u.desc}</div></div>`;
      }
    }
    const mk = s.marketingUntil > s.time;
    h += `<div class="p-sec"><span>Marketing</span></div><div class="card"><div class="row"><span class="t">📣 Kampagne „Fly ${esc(s.name.split(' ')[0])}“</span><button class="btn" data-act="mkt" ${s.cash < MARKETING.cost || mk ? 'disabled' : ''}>${mk ? 'läuft' : fmtMoney(MARKETING.cost)}</button></div><div class="s">Mehr Angebote und Ansehen für ${MARKETING.days} Tage.</div></div>`;
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
      h += `<div class="card"><div class="row"><span class="t">${vt.name}</span><span style="font-family:var(--mono)">${f.total}× <small style="color:var(--muted)">(${f.busy} im Einsatz${f.broken ? `, ${f.broken} defekt` : ''})</small></span></div>
        <div class="s">Wartezeit auf Fahrzeug zuletzt: ${w} min ${w > 30 ? '<span style="color:var(--warn)">– Engpass!</span>' : ''} · Unterhalt ${fmtMoney(vt.upkeep)}/Tag</div>
        <div class="acts"><button class="btn btn-good" data-act="buy" data-v="${k}" ${s.cash < vt.price ? 'disabled' : ''}>+ Kaufen ${fmtMoney(vt.price)}</button><button class="btn" data-act="sell" data-v="${k}">− Verkaufen</button></div></div>`;
    }
    h += `<div class="p-sec"><span>Bodenpersonal</span></div>
      <div class="card"><div class="row"><span class="t">${s.staff} Mitarbeitende</span><span>Effizienz <b style="font-family:var(--mono);color:${eff < 0.9 ? 'var(--warn)' : 'var(--good)'}">${Math.round(eff * 100)} %</b></span></div>
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
    if (L.capex) h += `<tr><td>Investitionen</td><td>−${fmtMoney(L.capex, false)}</td></tr>`;
    h += `<tr class="sum"><td>Betriebsergebnis</td><td>${fmtMoney(rev - cost, false)}</td></tr></table>`;
    if (hist.length) {
      h += `<div class="p-sec"><span>Tabelle</span></div><table class="ledger"><tr><td><b>Tag</b></td><td><b>Umsatz · Kosten · Bew. · pünktl.</b></td></tr>`;
      for (const r of [...hist].reverse()) h += `<tr><td>Tag ${r.day}</td><td>${fmtMoney(r.rev)} · ${fmtMoney(r.cost)} · ${r.mov} · ${r.onTime}%</td></tr>`;
      h += `</table>`;
    }
    return h;
  }
}

function feeLabel(k, v) {
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
