// Flughafen-Nachrichten und Passagierstimmen: kurze Meldungen aus dem, was gerade passiert.
// Für den Nachrichten-Ticker (Manager/Beobachter) und die Übersicht der Management-Zentrale.
import { CITIES, AIRLINES } from '../config.js';
import { rand, pick, hourOf } from '../util.js';
import { PH } from './aircraft.js';
import { fuelState } from './fuel.js';
import { rwyCond } from './runway.js';

const H = 3600;
const FIRST = ['Anna', 'Jonas', 'Mia', 'Luca', 'Lea', 'Ben', 'Sofia', 'Emil', 'Hanna', 'Noah', 'Clara', 'Felix', 'Ida', 'Paul', 'Mila', 'Elias', 'Aylin', 'Mehmet', 'Olga', 'Piotr'];

export function newsState(state) {
  if (!state.news) state.news = { items: [], quotes: [], next: state.time + 20 * 60, nextQ: state.time + 30 * 60, rec: {} };
  return state.news;
}

function push(state, text, tone = 'info', icon = '📰') {
  const N = newsState(state);
  N.items.unshift({ t: state.time, text, tone, icon });
  if (N.items.length > 30) N.items.pop();
}
function quote(state, text, stars, who) {
  const N = newsState(state);
  N.quotes.unshift({ t: state.time, text, stars, who });
  if (N.quotes.length > 12) N.quotes.pop();
}

// Rekorde und Meilensteine am Tagesende (von economy.closeDay aufgerufen)
export function newsDayEnd(state, rec) {
  const N = newsState(state);
  const R = N.rec;
  if (rec.pax > (R.pax || 0) && rec.day > 1) {
    push(state, `Rekordtag: ${rec.pax.toLocaleString('de-DE')} Passagiere an einem Tag – so viele wie nie zuvor.`, 'good', '🏆');
  }
  R.pax = Math.max(R.pax || 0, rec.pax);
  if (rec.mov > (R.mov || 0) && rec.day > 1) push(state, `Neuer Bestwert: ${rec.mov} Flugbewegungen an einem Tag.`, 'good', '📈');
  R.mov = Math.max(R.mov || 0, rec.mov);
  const deps = rec.depN || rec.mov / 2;
  const pct = rec.onTime;
  if (deps > 10 && pct >= 92) push(state, `Pünktlichkeits-Ranking: ${state.name} mit ${pct} % unter den besten Regionalflughäfen.`, 'good', '⏱️');
  else if (deps > 10 && pct < 70) push(state, `Chaos am Flughafen? Nur ${pct} % der Abflüge pünktlich – Reisende beschweren sich.`, 'bad', '⚠️');
  if (rec.incidents > 2) push(state, `Luftaufsicht prüft ${rec.incidents} Zwischenfälle vom Vortag.`, 'bad', '🔎');
  if (rec.diversions > 0) push(state, `${rec.diversions} Maschine${rec.diversions > 1 ? 'n' : ''} musste${rec.diversions > 1 ? 'n' : ''} gestern ausweichen – Passagiere mit Bussen zurückgebracht.`, 'bad', '🚌');
}

// laufend: je nach Lage Meldungen und Passagierstimmen
export function updateNews(state, dt) {
  const N = newsState(state);
  if (state.time >= N.next) {
    N.next = state.time + (1.5 + rand(state) * 2) * H;
    headline(state);
  }
  if (state.time >= N.nextQ) {
    N.nextQ = state.time + (0.6 + rand(state) * 0.9) * H;
    passenger(state);
  }
}

function headline(state) {
  const opts = [];
  const f = fuelState(state);
  const t = state.stats.today;
  const deps = t.onTime + t.delayed;
  const pct = deps ? t.onTime / deps : 1;
  const w = state.weather.kind;
  if (w === 'storm') opts.push(['Unwetter über der Region – Abfertigung zeitweise eingestellt.', 'bad', '⛈️']);
  if (w === 'fog') opts.push([`Dichter Nebel: Sichtweite unter ${state.weather.rvr ?? 600} m, Anflüge nur mit Instrumenten.`, 'warn', '🌫️']);
  if (w === 'clear' && hourOf(state.time) > 9 && hourOf(state.time) < 18) opts.push(['Bestes Flugwetter – Spotter säumen den Zaun an der Piste.', 'good', '📷']);
  if (f.price > 900) opts.push([`Kerosin teuer wie lange nicht: ${Math.round(f.price)} €/t. Airlines denken über Zuschläge nach.`, 'warn', '⛽']);
  if (f.price < 700) opts.push([`Kerosinpreis im Keller (${Math.round(f.price)} €/t) – gute Zeit zum Einkaufen.`, 'good', '⛽']);
  if (rwyCond(state) < 45) opts.push(['Piloten klagen über rutschige Piste – Gummiabrieb muss weg.', 'bad', '🛬']);
  if (pct > 0.9 && deps > 8) opts.push([`${state.name} läuft wie ein Uhrwerk: ${Math.round(pct * 100)} % pünktlich heute.`, 'good', '⏱️']);
  if (pct < 0.7 && deps > 8) opts.push([`Warteschlangen und Verspätungen: nur ${Math.round(pct * 100)} % der Flüge pünktlich.`, 'bad', '⏳']);
  if ((t.complaints || 0) > 10) opts.push([`${t.complaints} Lärmbeschwerden heute – Anwohner fordern Nachtruhe.`, 'warn', '📢']);
  if (state.projects && state.projects.length) {
    const p = pick(state, state.projects);
    opts.push([`Baustelle „${p.name}“ zu ${Math.floor(p.prog * 100)} % fertig.`, 'info', '🏗️']);
  }
  if (state.upgrades.rwy2) opts.push(['Mit der Parallelbahn gehört der Flughafen zu den leistungsfähigsten der Region.', 'good', '🛫']);
  const c = state.contracts.length ? pick(state, state.contracts) : null;
  if (c) {
    const al = AIRLINES[c.airline];
    const city = CITIES[c.city]?.name || c.city;
    if (c.sat > 80) opts.push([`${al.name} lobt die Abfertigung und prüft mehr Flüge nach ${city}.`, 'good', '✈️']);
    else if (c.sat < 40) opts.push([`${al.name} unzufrieden – Verbindung nach ${city} auf dem Prüfstand.`, 'bad', '✈️']);
    else opts.push([`Beliebt diese Woche: ${city} mit ${al.name}.`, 'info', '🧳']);
  }
  opts.push([pick(state, ['Rund um den Tower: Lotsen trainieren neue Anflugverfahren.', 'Flughafenfeuerwehr übt den Ernstfall – alles im grünen Bereich.', 'Neue Lounge-Umfrage: Kaffee ist das meistbestellte Getränk.', 'Fundbüro meldet: 14 Regenschirme und ein Saxophon diese Woche.', 'Vorfeld-Team sucht Verstärkung – Bewerbungen willkommen.']), 'info', '📰']);
  const recent = new Set(newsState(state).items.slice(0, 6).map((i) => i.text));
  const fresh = opts.filter((o) => !recent.has(o[0]));
  if (!fresh.length) return;
  const [text, tone, icon] = pick(state, fresh);
  push(state, text, tone, icon);
}

function passenger(state) {
  const t = state.stats.today;
  const deps = t.onTime + t.delayed;
  const pct = deps ? t.onTime / deps : 1;
  const sec = state.upgrades.security || 0;
  const retail = state.upgrades.retail || 0;
  const pool = [];
  const dep = state.acs.filter((a) => a.phase === PH.STAND || a.phase === PH.TAXI_OUT);
  const city = dep.length ? CITIES[state.rots[pick(state, dep).rot]?.city]?.name : null;
  if (pct > 0.88) pool.push(['Pünktlich los, pünktlich an – so muss Fliegen sein.', 5]);
  if (pct < 0.7) pool.push(['Schon wieder Verspätung. Und keiner sagt einem was.', 1]);
  if (sec >= 2) pool.push(['Sicherheitskontrolle in fünf Minuten durch – Wahnsinn!', 5]);
  else pool.push(['Die Schlange an der Sicherheitskontrolle war endlos.', 2]);
  if (retail >= 2) pool.push(['Tolle Shops und richtig guter Kaffee im Terminal.', 5]);
  else if (retail === 0) pool.push(['Außer einem Automaten gab es nichts zu essen.', 2]);
  if (state.upgrades.lounge) pool.push(['Die Lounge ist ein Traum, ich wäre fast sitzen geblieben.', 5]);
  if (state.upgrades.parking >= 1) pool.push(['Parken direkt am Terminal, super bequem.', 4]);
  else pool.push(['Parkplatz voll, bin zehn Minuten im Kreis gefahren.', 2]);
  if (state.weather.kind === 'storm') pool.push(['Gewitter – aber das Personal hat uns gut informiert.', 3]);
  if (state.reputation > 75) pool.push(['Mein Lieblingsflughafen. Klein, schnell, freundlich.', 5]);
  if (state.reputation < 45) pool.push(['Nie wieder über diesen Flughafen.', 1]);
  if (hourOf(state.time) < 7) pool.push(['Frühflug … aber immerhin war der Bäcker schon offen.', 4]);
  const recentQ = new Set(newsState(state).quotes.slice(0, 3).map((q) => q.text));
  const freshQ = pool.filter((p) => !recentQ.has(p[0]));
  if (!freshQ.length) return;
  const [text, stars] = pick(state, freshQ);
  const who = `${pick(state, FIRST)}${city ? `, fliegt nach ${city}` : ''}`;
  quote(state, text, stars, who);
}

// Durchschnitt der letzten Stimmen (Sterne)
export function paxRating(state) {
  const q = newsState(state).quotes;
  if (!q.length) return null;
  return q.reduce((a, b) => a + b.stars, 0) / q.length;
}
