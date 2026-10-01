// Aufsichtsrat: Jede Woche (alle 7 Tage) prüft der Aufsichtsrat fünf Wochenziele – Passagiere, Betriebsergebnis,
// Pünktlichkeit, Ansehen, Sicherheit. Erreichte Ziele bringen Vertrauen und einen Investitionszuschuss,
// verfehlte kosten Vertrauen; bei sehr geringem Vertrauen gibt es eine teure Sonderprüfung.
// Für die nächste Woche wählt die Geschäftsführung eine Strategie mit spürbarer Wirkung und passenden Zielen.
// Die Ziele leiten sich aus der Vorwoche ab (erste Woche: aus Tag 1), damit sie zum Ausbaustand passen.
import { pushNews } from './news.js';
import { log, notify } from './messages.js';

export const STRATEGIES = {
  balanced: { name: 'Ausgewogen', icon: '⚖️', desc: 'Keine Schwerpunkte – moderate Ziele in allen Bereichen.', fx: 'keine Zusatzwirkung', pax: 1.03, profit: 1.03, punct: 85, rep: 0 },
  growth: { name: 'Wachstum', icon: '📈', desc: 'Vertrieb und Streckenentwicklung: Airlines melden sich deutlich öfter.', fx: 'Airline-Angebote 35 % häufiger', pax: 1.1, profit: 0.95, punct: 83, rep: 0, offerF: 0.74 },
  efficiency: { name: 'Effizienz', icon: '⚙️', desc: 'Kostenprogramm in Verwaltung, Technik und Energie.', fx: 'laufende Fixkosten −6 %', pax: 1.0, profit: 1.12, punct: 85, rep: 0, costF: 0.94 },
  quality: { name: 'Qualität', icon: '⭐', desc: 'Service-Offensive: Beschilderung, Sauberkeit, Freundlichkeit.', fx: 'Ansehen +0,4 pro Tag', pax: 1.02, profit: 0.97, punct: 90, rep: 3, repDay: 0.4 },
};
export const BOARD_DELTA = [-15, -10, -4, 3, 8, 14]; // Vertrauen je Zahl erreichter Ziele (0–5)
export const BOARD_BONUS = [0, 0, 0, 100000, 250000, 500000];
export const CHAIR = 'Dr. Helene Brandt';

export function boardState(state) {
  if (!state.board) {
    state.board = { conf: 60, week: 0, strategy: 'balanced', targets: null, hist: [], pending: null };
    applyFx(state.board);
  }
  return state.board;
}
export const strategy = (state) => STRATEGIES[boardState(state).strategy] || STRATEGIES.balanced;
// Wirkung für andere Systeme (als Zahl im Spielstand, damit Wirtschaft und Flugplan nichts importieren müssen)
function applyFx(B) {
  const st = STRATEGIES[B.strategy] || STRATEGIES.balanced;
  B.costF = st.costF || 1;
  B.offerF = st.offerF || 1;
}

// Ziele für die kommende Woche aus dem Schnitt der Bezugstage
function makeTargets(state, base, days, ramp = 1) {
  const st = strategy(state);
  const n = Math.max(1, base.length);
  const pax = base.reduce((a, r) => a + r.pax, 0) / n;
  const profit = base.reduce((a, r) => a + (r.rev - r.cost), 0) / n;
  const pT = profit >= 0 ? profit * days * st.profit * ramp : profit * days * 0.5; // Verluste halbieren
  return {
    days,
    pax: Math.round((pax * days * st.pax * ramp) / 100) * 100,
    profit: Math.round(pT / 10000) * 10000,
    punct: st.punct,
    rep: Math.min(97, Math.round(Math.min(state.reputation, 95) - 1 + st.rep)), // Ansehen halten (Qualität: steigern)
    inc: 2,
  };
}

// laufender Stand der Woche (abgeschlossene Tage der Woche + heute)
export function weekProgress(state) {
  const B = boardState(state);
  if (!B.targets) return null;
  const recs = state.history.filter((r) => r.day > B.startDay && r.day <= B.startDay + B.targets.days);
  const t = state.stats.today;
  const deps = recs.reduce((a, r) => a + (r.depN || 0), 0);
  const onT = recs.reduce((a, r) => a + (r.onTime * (r.depN || 0)) / 100, 0);
  const L = state.ledger;
  const todayProfit = Object.values(L.rev).reduce((a, b) => a + b, 0) - Object.values(L.cost).reduce((a, b) => a + b, 0);
  const tDeps = t.onTime + t.delayed;
  return {
    pax: recs.reduce((a, r) => a + r.pax, 0) + (t.pax || 0),
    profit: recs.reduce((a, r) => a + (r.rev - r.cost), 0) + todayProfit,
    punct: deps + tDeps ? Math.round(((onT + t.onTime) / (deps + tDeps)) * 100) : 100,
    rep: Math.round(state.reputation),
    inc: recs.reduce((a, r) => a + (r.incidents || 0), 0) + (t.incidents || 0),
    daysDone: recs.length,
  };
}
export function goalRows(state, prog) {
  const T = boardState(state).targets;
  if (!T || !prog) return [];
  return [
    { k: 'pax', label: 'Passagiere', icon: '🧳', v: prog.pax, t: T.pax, ok: prog.pax >= T.pax, fmt: 'n' },
    { k: 'profit', label: 'Betriebsergebnis', icon: '💶', v: prog.profit, t: T.profit, ok: prog.profit >= T.profit, fmt: 'money' },
    { k: 'punct', label: 'Pünktlichkeit', icon: '⏱️', v: prog.punct, t: T.punct, ok: prog.punct >= T.punct, fmt: '%' },
    { k: 'rep', label: 'Ansehen', icon: '⭐', v: prog.rep, t: T.rep, ok: prog.rep >= T.rep, fmt: 'n' },
    { k: 'inc', label: 'Sicherheit (Vorfälle höchstens)', icon: '🛡️', v: prog.inc, t: T.inc, ok: prog.inc <= T.inc, fmt: 'n', max: true },
  ];
}

// Tagesabschluss: Qualitäts-Strategie wirkt täglich; alle 7 Tage tagt der Aufsichtsrat
export function boardDayEnd(state, rec) {
  if (state.scenario) return null; // Herausforderungen haben eigene Ziele
  const B = boardState(state);
  const st = strategy(state);
  if (st.repDay) state.reputation = Math.min(100, state.reputation + st.repDay);
  if (!B.targets) {
    // erster Tag: Ziele für die restliche Woche festlegen
    B.startDay = rec.day;
    B.week = 1;
    // Antrittswoche: in den ersten Tagen wächst der Verkehr noch stark (neue Verträge)
    const d = 7 - (rec.day % 7 || 7);
    B.targets = makeTargets(state, [rec], d > 0 ? d : 7, 1.15);
    return null;
  }
  if (rec.day < B.startDay + B.targets.days) return null;
  // Sitzung
  const prog = weekProgress(state);
  const rows = goalRows(state, prog);
  const met = rows.filter((r) => r.ok).length;
  const before = B.conf;
  B.conf = Math.max(0, Math.min(100, B.conf + BOARD_DELTA[met]));
  let bonus = BOARD_BONUS[met];
  if (bonus && B.conf >= 80) bonus = Math.round(bonus * 1.5);
  if (bonus) state.cash += bonus;
  let audit = 0;
  if (B.conf < 25) {
    audit = 120000;
    state.cash -= audit;
    state.reputation = Math.max(0, state.reputation - 2);
  }
  // Basis-Partner: Pünktlichkeitszusage prüfen (zweimal verfehlt = Abzug)
  let hub = null;
  if (state.hub) {
    const H = state.hub;
    const ok = prog.punct >= H.min;
    H.strikes = ok ? 0 : H.strikes + 1;
    hub = { airline: H.airline, ok, strikes: H.strikes, left: H.strikes >= 2 };
    for (const c of state.contracts) if (c.hub) c.sat = Math.max(0, Math.min(100, (c.sat ?? 70) + (ok ? 4 : -8)));
    if (H.strikes >= 2) {
      for (const c of state.contracts) if (c.hub) {
        c.days = Math.min(c.days, 2);
        c.hub = false;
      }
      state.hub = null;
      state.reputation = Math.max(0, state.reputation - 3);
      notify(state, '🌐 Der Basis-Partner zieht ab – Pünktlichkeitszusage zweimal verfehlt', 'bad');
    } else if (!ok) notify(state, `🌐 Basis-Partner verwarnt: nur ${prog.punct} % pünktlich (Zusage ${H.min} %) – beim nächsten Mal zieht er ab`, 'warn');
  }
  const res = { week: B.week, day: rec.day, met, rows, conf: B.conf, before, bonus, audit, strategy: B.strategy, hub };
  B.hist.push({ week: B.week, met, conf: B.conf, strategy: B.strategy });
  if (B.hist.length > 20) B.hist.shift();
  const L = state.life || (state.life = {});
  if (met === 5) L.boardPerfect = (L.boardPerfect || 0) + 1;
  // nächste Woche (Ziele werden mit der gewählten Strategie neu berechnet)
  B.week++;
  B.startDay = rec.day;
  const base = state.history.slice(-7);
  B.base = base.map((r) => ({ pax: r.pax, rev: r.rev, cost: r.cost }));
  B.targets = makeTargets(state, B.base, 7);
  B.pending = state.role === 'manager' && !state.auto.manager ? res : null; // sonst bleibt die Strategie
  pushNews(state, met >= 4 ? `Aufsichtsrat zufrieden: ${met} von 5 Wochenzielen erreicht${bonus ? `, Zuschuss ${Math.round(bonus / 1000)} Tsd €` : ''}.` : met >= 3 ? `Aufsichtsrat: ${met} von 5 Wochenzielen – „solide, aber da geht mehr“.` : `Aufsichtsrat unzufrieden: nur ${met} von 5 Wochenzielen erreicht.`, met >= 4 ? 'good' : met >= 3 ? 'info' : 'bad', '🏛️');
  log(state, 'mgr', `🏛️ Aufsichtsratssitzung Woche ${res.week}: ${met}/5 Ziele, Vertrauen ${before} → ${B.conf}${bonus ? `, Zuschuss ${Math.round(bonus / 1000)} Tsd €` : ''}${audit ? `, Sonderprüfung ${Math.round(audit / 1000)} Tsd €` : ''}.`);
  if (audit) notify(state, `🏛️ Sonderprüfung durch den Aufsichtsrat – ${Math.round(audit / 1000)} Tsd € und Ansehen −2. Vertrauen zurückgewinnen!`, 'bad');
  return res;
}

// Strategie für die laufende Woche wählen (Ziele werden dazu passend neu berechnet)
export function chooseStrategy(state, key) {
  const B = boardState(state);
  if (!STRATEGIES[key]) return;
  B.strategy = key;
  applyFx(B);
  if (B.base && B.targets) B.targets = makeTargets(state, B.base, B.targets.days);
  B.pending = null;
}

// Zitat der Aufsichtsratsvorsitzenden zum Ergebnis
export function chairQuote(met, conf) {
  if (met === 5) return 'Hervorragend. Genau so stellen wir uns die Führung dieses Flughafens vor.';
  if (met === 4) return 'Eine starke Woche. Bleiben Sie dran – der Markt schläft nicht.';
  if (met === 3) return 'Solide. Aber die Gesellschafter erwarten mehr als Mittelmaß.';
  if (conf < 25) return 'Das Vertrauen des Gremiums ist erschöpft. Wir ordnen eine Sonderprüfung an.';
  return 'Das ist zu wenig. Ich erwarte in der nächsten Sitzung deutliche Verbesserungen.';
}
