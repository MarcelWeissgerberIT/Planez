// Karriere über alle Spielstände: Schichten, Verkehr, Bestwerte je Station, Spielzeit, Erfolge –
// dazu Sterne aus Herausforderungen, Tagesserie und Spotterbuch. Ergibt Karrierepunkte und einen Rang.
import { loadBest, totalStars, dailyInfo } from './sim/scenarios.js';
import { spotStats } from './sim/spotter.js';
import { ACHIEVEMENTS } from './sim/achievements.js';
import { T } from './i18n.js';

const KEY = 'planez_career';
export const CAREER_RANKS = [
  { pts: 0, name: T('Neuling'), icon: '🔰' },
  { pts: 1500, name: 'Junior', icon: '🥉' },
  { pts: 4000, name: T('Profi'), icon: '🥈' },
  { pts: 9000, name: 'Senior', icon: '🥇' },
  { pts: 18000, name: 'Supervisor', icon: '🎖️' },
  { pts: 35000, name: T('Direktion'), icon: '🏆' },
  { pts: 70000, name: T('Legende'), icon: '👑' },
];

let data = null;
export function career() {
  if (data) return data;
  try {
    data = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) {}
  if (!data || typeof data !== 'object') data = {};
  data = { days: 0, mov: 0, pax: 0, landings: 0, deps: 0, incidents: 0, perfect: 0, playSec: 0, ach: [], byRole: {}, rec: {}, first: Date.now(), ...data };
  if (!data.rec) data.rec = {};
  return data;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(career()));
  } catch (e) {}
}
const roleRec = (role) => {
  const c = career();
  return c.byRole[role] || (c.byRole[role] = { days: 0, bestScore: 0, perfect: 0, bestPunct: 0 });
};

// Tagesabschluss eines Spielstands (auch in Herausforderungen)
export function careerDayEnd(state, rec, stars) {
  const c = career();
  c.days++;
  c.mov += rec.mov || 0;
  c.pax += rec.pax || 0;
  c.landings += (rec.arrH || []).reduce((a, b) => a + b, 0);
  c.deps += rec.depN || 0;
  c.incidents += rec.incidents || 0;
  const r = roleRec(state.role);
  r.days++;
  if (stars >= 5) {
    c.perfect++;
    r.perfect++;
  }
  if (rec.score) r.bestScore = Math.max(r.bestScore, rec.score);
  if ((rec.depN || 0) >= 20) r.bestPunct = Math.max(r.bestPunct, rec.onTime || 0);
  // Rekorde über alle Spielstände
  const R = c.rec;
  const b = rec.td && rec.td.best;
  if (b && (!R.td || b.fpm < R.td.fpm)) R.td = { fpm: b.fpm, cs: b.cs, type: b.type };
  if ((rec.mov || 0) > (R.mov || 0)) R.mov = rec.mov;
  const L = state.life || {};
  if ((L.streamPeak || 0) > (R.viewers || 0)) R.viewers = L.streamPeak;
  if ((rec.pax || 0) > (R.pax || 0)) R.pax = rec.pax;
  save();
}
export function careerAch(id) {
  const c = career();
  if (!c.ach.includes(id)) {
    c.ach.push(id);
    save();
  }
}
let acc = 0;
export function careerTick(sec) {
  const c = career();
  c.playSec += sec;
  acc += sec;
  if (acc > 30) {
    acc = 0;
    save();
  }
}

export function careerPoints() {
  const c = career();
  const sp = spotStats();
  const di = dailyInfo();
  return Math.round(c.days * 40 + c.mov / 5 + totalStars() * 120 + c.ach.length * 60 + sp.pts / 25 + (di.best || 0) * 50 + c.perfect * 100 + Object.keys(di.days || {}).length * 30);
}
export function careerRank(pts = careerPoints()) {
  let i = 0;
  while (i + 1 < CAREER_RANKS.length && pts >= CAREER_RANKS[i + 1].pts) i++;
  const cur = CAREER_RANKS[i], next = CAREER_RANKS[i + 1] || null;
  return { i, cur, next, frac: next ? (pts - cur.pts) / (next.pts - cur.pts) : 1, pts };
}
export function careerSummary() {
  const c = career();
  const best = loadBest();
  return {
    c,
    stars: totalStars(),
    scnPlayed: Object.keys(best).filter((k) => !k.startsWith('daily-')).length,
    dailyDays: Object.keys(dailyInfo().days || {}).length,
    daily: dailyInfo(),
    spot: spotStats(),
    achAll: ACHIEVEMENTS.length,
  };
}
