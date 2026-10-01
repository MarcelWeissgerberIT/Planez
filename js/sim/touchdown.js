// Aufsetzrate: Wie hart setzt ein Flugzeug auf? Seitenwind, Böen, Regen/Schnee/Gewitter, Wirbelschleppen und eine
// späte Landefreigabe (unruhiger Endanflug) machen Landungen fester. Rückmeldung über der Bahn, Statistik und Folgen:
// Ab 600 ft/min gilt die Landung als hart – die Technik prüft das Fahrwerk an der Position (Abfertigung ruht 20 min).
// Verbraucht den Zufallsgenerator des Spiels nicht.
import { AC_TYPES } from '../config.js';
import { log } from './messages.js';
import { pushNews } from './news.js';
import { T as tr_ } from '../i18n.js';

const hash01 = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

export const HARD = 600;
export const GRADES = [
  [110, tr_('Butter'), '🧈', 'good'],
  [220, tr_('sanft'), '👌', 'good'],
  [380, tr_('solide'), '', 'info'],
  [HARD, tr_('fest'), '', 'warn'],
  [Infinity, tr_('harte Landung'), '⚠', 'bad'],
];
export const gradeOf = (fpm) => GRADES.find((g) => fpm < g[0]);

export function crosswind(state, rwy = state.rwy) {
  const hdg = rwy === '27' ? 270 : 90;
  return Math.abs(state.wind.spd * Math.sin(((state.wind.dir - hdg) * Math.PI) / 180));
}

export function touchdown(state, ac) {
  const h = hash01(`${ac.id}:${Math.floor(state.time)}`);
  const t = AC_TYPES[ac.type];
  const wk = state.weather.kind;
  let fpm = 60 + 240 * Math.pow(h, 1.7);
  fpm += crosswind(state) * 6 + Math.abs(state.wind.gust || 0) * 25;
  fpm += { rain: 30, snow: 60, storm: 130 }[wk] || 0;
  const since = ac.clr && ac.clr.landT ? state.time - ac.clr.landT : 999;
  const late = since < 30 ? 200 : since < 60 ? 110 : 0; // Freigabe erst kurz vor der Schwelle: unruhiger Endanflug
  fpm += late;
  if (ac.wakeBad) fpm += 150;
  if (t.size === 'S') fpm -= 15;
  fpm = Math.max(40, Math.round(fpm / 5) * 5);
  ac.tdFpm = fpm;
  ac.tdLate = !!late;
  const L = state.life || (state.life = {});
  const T = state.stats.today;
  T.tdN = (T.tdN || 0) + 1;
  T.tdSum = (T.tdSum || 0) + fpm;
  if (fpm < 110) L.butter = (L.butter || 0) + 1;
  if (!T.tdBest || fpm < T.tdBest.fpm) T.tdBest = { cs: ac.cs, fpm, type: ac.type };
  if (fpm >= HARD) {
    ac.hardLanding = true;
    L.hardLand = (L.hardLand || 0) + 1;
    T.hardLand = (T.hardLand || 0) + 1;
    pushNews(state, tr_`Harte Landung: ${ac.cs} setzt mit ${fpm} ft/min auf – die Technik prüft das Fahrwerk.`, 'bad', '⚠️');
    log(state, 'sys', tr_`⚠ Harte Landung: ${ac.cs} mit ${fpm} ft/min${late ? tr_(' nach später Landefreigabe') : ''} – die Technik prüft das Fahrwerk an der Position.`);
  }
  return { fpm, late: !!late };
}

// an der Position: Fahrwerkscheck nach harter Landung hält die Abfertigung an
export function hardLandingCheck(state, ac) {
  if (!ac.hardLanding || !ac.ta) return;
  ac.hardLanding = false;
  for (const tk of Object.values(ac.ta.tasks || {})) if (tk.st !== 'done') tk.pausedUntil = state.time + 20 * 60;
  log(state, 'gnd', tr_`🔧 ${ac.cs}: Fahrwerkscheck nach harter Landung – Abfertigung ruht 20 Minuten.`);
  if (state.role === 'ground') log(state, 'crew', tr_`Vorfeld, Technik an Position ${ac.stand}, wir checken das Fahrwerk von ${ac.cs} nach der harten Landung, zwanzig Minuten.`, tr_('Technik'), { prio: 2 });
}
