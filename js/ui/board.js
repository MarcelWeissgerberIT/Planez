// Aufsichtsrat: Sitzungsprotokoll mit Strategiewahl (Modal) und Seite in der Management-Zentrale
import { STRATEGIES, BOARD_DELTA, BOARD_BONUS, CHAIR, boardState, weekProgress, goalRows, chairQuote, strategy } from '../sim/board.js';
import { fmtMoney } from '../util.js';
import { AIRLINES } from '../config.js';
import { T, LOCALE } from '../i18n.js';

const fmtV = (r, v) => (r.fmt === 'money' ? fmtMoney(v) : r.fmt === '%' ? `${Math.round(v)} %` : Math.round(v).toLocaleString(LOCALE));
const confCls = (c) => (c >= 75 ? 'hi' : c >= 40 ? 'mid' : 'lo');
const confWord = (c) => (c >= 80 ? T('volle Rückendeckung') : c >= 60 ? T('Vertrauen') : c >= 40 ? T('abwartend') : c >= 25 ? T('skeptisch') : T('Misstrauen'));

export function confMeter(conf, before = null) {
  return T`<div class="bd-conf ${confCls(conf)}"><div class="bd-conf-l"><span>Vertrauen des Aufsichtsrats</span><b>${conf}${before !== null && before !== conf ? ` <em class="${conf > before ? 'up' : 'down'}">${conf > before ? '▲' : '▼'} ${Math.abs(conf - before)}</em>` : ''}</b><small>${confWord(conf)}</small></div><div class="bd-bar"><i style="width:${conf}%"></i><u style="left:25%" title="darunter: Sonderprüfung"></u><u style="left:80%" title="ab hier: Zuschuss +50 %"></u></div></div>`;
}

function rowsTable(rows, live = false) {
  return T`<table class="bd-tab"><thead><tr><th>Wochenziel</th><th>${live ? T('bisher') : T('Ist')}</th><th>Ziel</th><th></th></tr></thead><tbody>${rows
    .map((r) => `<tr class="${r.ok ? 'ok' : live ? '' : 'no'}"><td>${r.icon} ${r.label}</td><td>${fmtV(r, r.v)}</td><td>${r.max ? '≤ ' : '≥ '}${fmtV(r, r.t)}</td><td>${r.ok ? '✓' : live ? '…' : '✗'}</td></tr>`)
    .join('')}</tbody></table>`;
}

function stratCards(cur) {
  return `<div class="bd-strats">${Object.entries(STRATEGIES)
    .map(([k, st]) => T`<button class="bd-strat${k === cur ? ' on' : ''}" data-strat="${k}"><span class="i">${st.icon}</span><b>${st.name}</b><small>${st.desc}</small><em>${st.fx}</em><small class="t">Ziele: Passagiere ${st.pax >= 1 ? '+' : ''}${Math.round((st.pax - 1) * 100)} %, Ergebnis ${st.profit >= 1 ? '+' : ''}${Math.round((st.profit - 1) * 100)} %, pünktlich ≥ ${st.punct} %${st.rep ? T`, Ansehen +${st.rep}` : ''}</small></button>`)
    .join('')}</div>`;
}

// Sitzungsprotokoll (nach dem Tagesbericht am Wochenende)
export function boardMeetingHtml(state, res) {
  const met = res.met;
  return T`<div class="bd"><h2>🏛️ Aufsichtsratssitzung – Woche ${res.week}</h2>
    <div class="bd-chair"><span class="bd-face">👩‍💼</span><div><b>${CHAIR}</b><small>Vorsitzende des Aufsichtsrats</small><p>„${chairQuote(met, res.conf)}“</p></div><div class="bd-score ${met >= 4 ? 'good' : met >= 3 ? 'mid' : 'bad'}"><b>${met}/5</b><small>Ziele erreicht</small></div></div>
    ${rowsTable(res.rows)}
    ${confMeter(res.conf, res.before)}
    <div class="bd-money">${res.bonus ? T`<span class="good">💶 Investitionszuschuss: <b>${fmtMoney(res.bonus)}</b>${res.conf >= 80 && res.bonus > BOARD_BONUS[met] ? T(' (inkl. +50 % für volles Vertrauen)') : ''}</span>` : T('<span>Kein Zuschuss – ab 3 erreichten Zielen gibt es Geld für Investitionen.</span>')}${res.audit ? T`<span class="bad">🔎 Sonderprüfung: <b>−${fmtMoney(res.audit)}</b>, Ansehen −2</span>` : ''}${res.hub ? T`<span class="${res.hub.ok ? 'good' : 'bad'}">🌐 Basis-Partner ${AIRLINES[res.hub.airline]?.name || ''}: ${res.hub.ok ? T('Pünktlichkeitszusage eingehalten ✓') : res.hub.left ? T('Zusage zweimal verfehlt – die Airline zieht ab') : T('Zusage verfehlt – Verwarnung 1/2')}</span>` : ''}</div>
    <div class="p-sec"><span>Strategie für die nächste Woche</span></div>
    ${stratCards(state.board.strategy)}
    <div class="modal-acts"><button class="btn btn-primary" data-close-modal>Strategie beschließen</button></div></div>`;
}

// Seite „Aufsichtsrat“ in der Management-Zentrale
export function boardPageHtml(state) {
  const B = boardState(state);
  if (!B.targets) return T`<div class="empty">Der Aufsichtsrat legt nach dem ersten Betriebstag die Wochenziele fest. Danach tagt er alle 7 Tage.</div>`;
  const prog = weekProgress(state);
  const rows = goalRows(state, prog);
  const st = strategy(state);
  const left = B.startDay + B.targets.days - (prog.daysDone + B.startDay);
  let h = T`<div class="bd bd-page"><div class="bd-head"><div><span>Woche ${B.week}</span><b>${left <= 0 ? T('Sitzung heute Abend') : left > 1 ? T`nächste Sitzung in ${left} Tagen` : T`nächste Sitzung in ${left} Tag`}</b><small>Ist-Werte inklusive des laufenden Tages</small></div>
    <div class="bd-st"><span>Strategie</span><b>${st.icon} ${st.name}</b><small>${st.fx}</small></div></div>`;
  h += rowsTable(rows, true);
  h += confMeter(B.conf);
  if (state.hub) h += T`<div class="bd-money"><span class="${state.hub.strikes ? 'bad' : 'good'}">🌐 Basis-Partner <b>${AIRLINES[state.hub.airline]?.name || ''}</b>: Zusage ≥ ${state.hub.min} % Pünktlichkeit je Woche (jetzt ${prog.punct} %) · Verwarnungen ${state.hub.strikes}/2 · Entgelte −${Math.round((1 - state.hub.mult) * 100)} %</span></div>`;
  h += T`<div class="bd-rules"><div class="s">🏛️ Je erreichtem Ziel steigt das Vertrauen: ${BOARD_DELTA.map((d, i) => `${i}: ${d > 0 ? '+' : ''}${d}`).join(' · ')}.</div>
    <div class="s">💶 Zuschuss ab 3 Zielen (${BOARD_BONUS.slice(3).map((b) => fmtMoney(b)).join(' / ')}), ab 80 Vertrauen +50 %. Unter 25 Vertrauen: Sonderprüfung (120 Tsd €, Ansehen −2).</div>
    <div class="s">📋 Ziele kommen aus der Vorwoche: Passagiere und Ergebnis sollen wachsen, Pünktlichkeit und Ansehen halten, höchstens 2 Vorfälle. Die Strategie wählst du in der Sitzung.</div></div>`;
  if (B.hist.length) h += T`<div class="p-sec"><span>Bisherige Sitzungen</span></div><div class="bd-hist">${B.hist.slice(-8).reverse().map((x) => T`<div><b>Woche ${x.week}</b><span class="${x.met >= 4 ? 'good' : x.met >= 3 ? '' : 'bad'}">${x.met}/5</span><small>${STRATEGIES[x.strategy]?.icon || ''} · Vertrauen ${x.conf}</small></div>`).join('')}</div>`;
  return h + '</div>';
}

export function boardBadge(state) {
  const B = state.board;
  if (!B || !B.targets) return T('tagt ab Woche 1');
  const rows = goalRows(state, weekProgress(state));
  return T`Vertrauen ${B.conf} · ${rows.filter((r) => r.ok).length}/5 auf Kurs`;
}
