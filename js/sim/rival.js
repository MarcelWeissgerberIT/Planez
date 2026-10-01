// Wettbewerb: der Nachbarflughafen „Nordhafen“ kämpft um Airlines und Passagiere.
// Marktanteil aus Ansehen, Pünktlichkeit, Entgelten und Kapazität beider Flughäfen.
// Nordhafen senkt Gebühren, baut aus, wirbt Verbindungen ab – und fällt manchmal aus (dann kommen Umleitungen zu uns).
import { AIRLINES, CITIES } from '../config.js';
import { rand, randRange, randInt, pick, clamp } from '../util.js';
import { log, notify } from './messages.js';
import { feeIndex } from './schedule.js';
import { pushDecision } from './decisions.js';
import { pushNews } from './news.js';
import { isCareer, stageOf } from './career.js';

const H = 3600, D = 86400;
export const RIVAL_NAME = 'Nordhafen';

export function rivalState(state) {
  if (!state.rival) {
    state.rival = { rep: 62, fees: 1.0, cap: 1.0, punct: 0.84, share: 50, hist: [], news: [], next: state.time + randRange(state, 20, 36) * H, feeCutUntil: 0, closedUntil: 0, poached: 0, won: 0 };
  }
  return state.rival;
}

// eigene Stärke (0..1) – dieselben Größen wie beim Rivalen
export function ourScore(state) {
  const y = (state.history || []).slice(-1)[0];
  const punct = y && y.onTime ? y.onTime / 100 : 0.85;
  const built = state.stands.filter((s) => s.built).length;
  const cap = clamp(built / 9 + (state.upgrades.rwy2 ? 0.25 : 0) + ((state.goals && state.goals.rank) || 0) * 0.05, 0.4, 1.6);
  return { rep: state.reputation / 100, punct, fees: feeIndex(state), cap };
}
export function rivalScore(state) {
  const R = rivalState(state);
  return { rep: R.rep / 100, punct: R.punct, fees: R.fees * (R.feeCutUntil > state.time ? 0.88 : 1), cap: R.cap };
}
const attract = (x) => 0.45 * x.rep + 0.25 * x.punct + 0.2 * clamp(1.25 - x.fees, 0, 1) + 0.1 * clamp(x.cap / 1.6, 0, 1);
export function shareTarget(state) {
  const a = attract(ourScore(state)), b = attract(rivalScore(state));
  return clamp(50 + (a - b) * 170, 12, 88);
}

function news(state, text, tone = 'info', icon = '🏢') {
  const R = rivalState(state);
  R.news.unshift({ t: state.time, text, tone, icon });
  if (R.news.length > 8) R.news.pop();
  pushNews(state, text, tone, icon);
  log(state, 'mgr', `${icon} ${text}`);
}

// Einflüsse auf den Rest der Simulation
export const offerFactor = (state) => clamp(50 / Math.max(10, rivalState(state).share), 0.65, 1.7); // Angebots-Wartezeit
export const renewBonus = (state) => (rivalState(state).share - 50) / 250; // Verlängerungs-Chance

// ---------- Züge des Rivalen ----------
const MOVES = {
  feeCut: {
    w: 1.2,
    ok: (s, R) => R.feeCutUntil < s.time,
    run: (s, R) => {
      R.feeCutUntil = s.time + randRange(s, 4, 7) * D;
      news(s, `${RIVAL_NAME} senkt die Landeentgelte um 12 % – Kampfansage an ${s.name}.`, 'bad', '💸');
      if (s.role === 'manager') notify(s, `💸 ${RIVAL_NAME} senkt die Entgelte – prüfe deine Gebühren`, 'warn');
    },
  },
  expand: {
    w: 0.7,
    ok: (s, R) => R.cap < 1.5,
    run: (s, R) => {
      R.cap = Math.min(1.6, R.cap + 0.12);
      news(s, `${RIVAL_NAME} eröffnet einen neuen Flugsteig mit ${randInt(s, 4, 8)} Positionen.`, 'bad', '🏗️');
    },
  },
  marketing: {
    w: 0.8,
    ok: () => true,
    run: (s, R) => {
      R.rep = Math.min(92, R.rep + randRange(s, 2, 4));
      news(s, `${RIVAL_NAME} startet eine große Werbekampagne („Näher. Schneller. ${RIVAL_NAME}.“).`, 'bad', '📣');
    },
  },
  scandal: {
    w: 0.8,
    ok: () => true,
    run: (s, R) => {
      const what = pick(s, ['Gepäckchaos', 'stundenlange Sicherheitskontrollen', 'ein Computerausfall beim Check-in', 'ein Streit mit der Gewerkschaft']);
      R.rep = Math.max(30, R.rep - randRange(s, 3, 6));
      R.punct = Math.max(0.6, R.punct - 0.05);
      news(s, `Ärger in ${RIVAL_NAME}: ${what} – Reisende weichen auf ${s.name} aus.`, 'good', '📰');
    },
  },
  poach: {
    w: 1.1,
    ok: (s) => s.contracts.some((c) => c.days > 6 && !c.cargo),
    run: (s, R) => {
      // bevorzugt unzufriedene Airlines
      const list = s.contracts.filter((c) => c.days > 6 && !c.cargo).sort((a, b) => (a.sat || 50) - (b.sat || 50));
      const c = list[Math.min(list.length - 1, randInt(s, 0, 1))];
      pushDecision(s, 'rivalPoach', { c: c.id });
    },
  },
  closure: {
    w: 0.6,
    ok: (s, R) => R.closedUntil < s.time,
    run: (s, R) => {
      const why = pick(s, ['Pistenschaden', 'Streik der Fluglotsen', 'Stromausfall im Tower', 'Schneechaos']);
      R.closedUntil = s.time + randRange(s, 2, 4) * H;
      R.punct = Math.max(0.6, R.punct - 0.04);
      news(s, `${RIVAL_NAME} gesperrt: ${why}. Airlines suchen Ausweichflughäfen.`, 'good', '⛔');
      pushDecision(s, 'rivalDivert', { n: randInt(s, 3, 5), why });
    },
  },
};

export function updateRival(state, dt) {
  if (isCareer(state) && stageOf(state) < 2) return; // Nordhafen nimmt den kleinen Platz (noch) nicht ernst
  const R = rivalState(state);
  // Marktanteil gleitet zur Zielgröße (etwa ein Drittel pro Tag)
  const tgt = shareTarget(state);
  R.share += (tgt - R.share) * clamp(dt / (2.5 * D), 0, 1);
  // für Angebote und Verlängerungen (schedule.js liest nur den Zustand – kein Import-Zyklus)
  R.offerF = offerFactor(state);
  R.renew = renewBonus(state);
  // Rivale erholt sich langsam – und strengt sich mehr an, wenn er zurückliegt
  R.rep += (64 + clamp((50 - R.share) * -0.12, -3, 5) - R.rep) * clamp(dt / (12 * D), 0, 1);
  R.punct += (0.84 - R.punct) * clamp(dt / (6 * D), 0, 1);
  if (state.time < R.next) return;
  R.next = state.time + randRange(state, 26, 50) * H;
  if (state.scenario) return;
  // führen wir, greift Nordhafen öfter an (Gebühren, Abwerben, Werbung); liegen wir hinten, patzt er eher
  const lead = clamp((R.share - 50) / 25, -1, 1);
  const AGG = { feeCut: 1, poach: 1, marketing: 1, expand: 0.5 };
  const wOf = (k, m) => m.w * (AGG[k] ? 1 + AGG[k] * lead * 0.7 : 1 - lead * 0.5);
  const cands = Object.entries(MOVES).filter(([, m]) => m.ok(state, R));
  let sum = cands.reduce((t, [k, m]) => t + wOf(k, m), 0);
  let x = rand(state) * sum;
  for (const [k, m] of cands) {
    x -= wOf(k, m);
    if (x <= 0) {
      m.run(state, R);
      break;
    }
  }
}

// Tagesabschluss: Verlauf
export function rivalDayEnd(state) {
  if (isCareer(state) && stageOf(state) < 2) return;
  const R = rivalState(state);
  R.hist.push(Math.round(R.share * 10) / 10);
  if (R.hist.length > 30) R.hist.shift();
  const y = R.hist.length > 1 ? R.hist[R.hist.length - 2] : null;
  if (y !== null && R.share >= 60 && y < 60) news(state, `${state.name} überholt ${RIVAL_NAME} deutlich: ${Math.round(R.share)} % Marktanteil in der Region.`, 'good', '🏆');
  if (y !== null && R.share <= 40 && y > 40) news(state, `${RIVAL_NAME} zieht davon – ${state.name} fällt auf ${Math.round(R.share)} % Marktanteil.`, 'bad', '📉');
}

// Umleitungen annehmen: Zusatzflüge in der nächsten Stunde
export function acceptDiversions(state, n) {
  const R = rivalState(state);
  const pool = ['AUR', 'RHJ', 'NST', 'SKB', 'ALP', 'BWG'];
  const cities = Object.keys(CITIES).filter((k) => CITIES[k].cat !== 'long');
  for (let i = 0; i < n; i++) {
    const al = pick(state, pool);
    const no = randInt(state, 700, 789) * 2;
    (state.pendingSpecials = state.pendingSpecials || []).push({
      at: state.time + (5 + i * randRange(state, 9, 16)) * 60,
      opts: { airline: al, type: pick(state, AIRLINES[al].types.filter((t) => t !== 'A388')), arrNo: `${al}${no}`, depNo: `${al}${no + 1}`, city: pick(state, cities), special: 'diversion', feeMult: 1.4 },
    });
  }
  R.won += n;
  state.reputation = clamp(state.reputation + 1, 0, 100);
  R.share = Math.min(88, R.share + 1.5);
  notify(state, `🛬 ${n} Umleitungen von ${RIVAL_NAME} angenommen – sie kommen in der nächsten Stunde`, 'info');
}
