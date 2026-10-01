// Finanzen: Kredite, Nachtflugregelung und Lärm
import { clamp, hourOf, fmtMoney } from '../util.js';
import { log, notify } from './messages.js';
import { nextId } from './schedule.js';
import { isCareer, stageOf, LOAN_CAP } from './career.js';
import { T, DEC } from '../i18n.js';

export const LOAN_DAYS = 30;
export const NIGHT = { from: 23, to: 5 };
export const isNightHour = (h) => h >= NIGHT.from || h < NIGHT.to;
export const isNight = (state) => isNightHour(hourOf(state.time));

// Zinssatz pro Tag: besseres Ansehen = günstiger
export function loanRate(state) {
  return 0.0006 + Math.max(0, 75 - state.reputation) * 0.00003;
}
export const loans = (state) => state.loans || (state.loans = []);
export const debt = (state) => loans(state).reduce((t, l) => t + l.rest, 0);
export function loanLimit(state) {
  if (isCareer(state)) return Math.max(0, Math.round((LOAN_CAP[stageOf(state)] * (0.6 + state.reputation / 125) - debt(state)) / 10000) * 10000);
  return Math.max(0, Math.round((2e6 + state.reputation * 150000 - debt(state)) / 100000) * 100000);
}
export function annuity(amount, r, n = LOAN_DAYS) {
  return (amount * r) / (1 - Math.pow(1 + r, -n));
}

export function takeLoan(state, amount) {
  if (amount > loanLimit(state)) return notify(state, T('Kreditrahmen überschritten'), 'warn'), false;
  const r = loanRate(state);
  const l = { id: nextId(state, 'l'), amount, rest: amount, rate: r, days: LOAN_DAYS, daily: annuity(amount, r) };
  loans(state).push(l);
  state.cash += amount;
  log(state, 'mgr', T`Kredit aufgenommen: ${fmtMoney(amount)} zu ${(r * 100).toFixed(2).replace('.', DEC)} % pro Tag, Rate ${fmtMoney(l.daily)}/Tag über ${LOAN_DAYS} Tage.`);
  notify(state, T`🏦 Kredit über ${fmtMoney(amount)} ausgezahlt`, 'good');
  return true;
}

export function repayLoan(state, id) {
  const l = loans(state).find((x) => x.id === id);
  if (!l) return false;
  if (state.cash < l.rest) return notify(state, T('Nicht genug Geld für die Sondertilgung'), 'bad'), false;
  state.cash -= l.rest;
  state.ledger.repay = (state.ledger.repay || 0) + l.rest;
  state.loans = loans(state).filter((x) => x !== l);
  state.life = state.life || {};
  state.life.loansRepaid = (state.life.loansRepaid || 0) + 1;
  log(state, 'mgr', T`Kredit vorzeitig getilgt (${fmtMoney(l.rest)}).`);
  return true;
}

// täglich zum Tageswechsel: Zins (Kosten) und Tilgung
export function dailyLoans(state, spend) {
  for (const l of loans(state)) {
    const interest = l.rest * l.rate;
    const principal = Math.min(l.rest, Math.max(0, l.daily - interest));
    spend(state, 'interest', interest);
    state.cash -= principal;
    state.ledger.repay = (state.ledger.repay || 0) + principal;
    l.rest -= principal;
    l.days--;
  }
  const n0 = loans(state).length;
  state.loans = loans(state).filter((l) => l.rest > 1 && l.days > 0);
  if (state.loans.length < n0) {
    state.life = state.life || {};
    state.life.loansRepaid = (state.life.loansRepaid || 0) + (n0 - state.loans.length);
  }
}

// Nachtbewegung: Lärmentgelt oder – bei Nachtflugverbot – Bußgeld für Ausnahmen
export function onNightMovement(state, ac, earn, spend) {
  if (!isNight(state)) return;
  const w = { L: 0.5, M: 1, H: 2 }[ac.wake] || 1;
  const td = state.stats.today;
  td.nightMov = (td.nightMov || 0) + 1;
  if (state.settings.curfew) {
    spend(state, 'penalties', 5000);
    state.reputation = clamp(state.reputation - 0.15, 0, 100);
    td.curfewBreaches = (td.curfewBreaches || 0) + 1;
    return;
  }
  earn(state, 'night', (state.fees.night ?? 600) * w);
  td.complaints = (td.complaints || 0) + Math.round(w * 2);
  state.reputation = clamp(state.reputation - 0.03 * w, 0, 100);
  if (td.complaints >= 40 && !td.protest) {
    td.protest = true;
    state.reputation = clamp(state.reputation - 3, 0, 100);
    notify(state, T('📢 Bürgerinitiative protestiert gegen Nachtfluglärm – Ansehen sinkt'), 'bad');
    log(state, 'mgr', T('Zahlreiche Lärmbeschwerden: Bürgerinitiative fordert ein Nachtflugverbot.'));
  }
}
