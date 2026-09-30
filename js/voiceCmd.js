// Sprachbefehle des Tower-Lotsen verstehen: Rufzeichen finden und Freigabe erkennen.
// Beispiel: "Aurora five four two, runway two seven, cleared to land" -> { id, cmd: 'land' }
import { AIRLINES } from './config.js';

const NUM = { zero: 0, oh: 0, o: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, tree: 3, four: 4, for: 4, fore: 4, five: 5, fife: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, niner: 9, ten: 10 };

// Zahlwörter und Ziffern zu einer Ziffernfolge, z. B. "five four two" -> "542"
function digitsIn(words) {
  return words.map((w) => (/^\d+$/.test(w) ? w : NUM[w] !== undefined ? String(NUM[w]) : '|')).join('').split('|').filter(Boolean);
}

// Ähnlichkeit zweier Wörter (Levenshtein, normiert)
function sim(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

// Befehle nach Priorität (spezifisch vor allgemein)
const RULES = [
  ['goaround', /\bgo(ing)? around\b/],
  ['land', /\bclear(ed)? (to|two|2) land\b|\bcleared land\b/],
  ['takeoff', /\bclear(ed)? (for )?(take ?off|takeoff)\b/],
  ['lineup', /\bline ?up\b|\blineup\b/],
  ['cross', /\bcross(ing)? runway\b|\bcross\b/],
  ['holdpos', /\bhold position\b|\bstop immediately\b/],
  ['cont', /\bcontinue taxi\b/],
  ['taxiOut', /\btaxi (to )?(the )?holding point\b|\btaxi (to )?(the )?runway\b/],
  ['taxiIn', /\btaxi (to )?(the )?(stand|position|gate|parking)\b/],
  ['startWait', /\bexpect start ?up\b|\bremain on stand\b|\bstand by for start ?up\b/],
  ['push', /\bpush ?back\b|\bstart ?up approved\b/],
  ['direct', /\bdirect\b/],
  ['hold', /\bhold(ing)? (at|as published|over)\b|\benter (the )?hold\b|\bproceed .* hold\b/],
  ['approach', /\bclear(ed)? (i l s|ils|for (the )?(i l s|ils)|approach)\b|\bcleared ils\b|\bdescend\b/],
];
const SPEEDS = [160, 180, 210, 250];

export function parseVoice(state, transcript) {
  const raw = transcript.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const words = raw.split(' ');
  // 1) Rufzeichen: Airline-Rufname (unscharf) + Flugnummer
  const air = state.acs.filter((a) => a.phase !== 'GONE');
  let best = null;
  for (let i = 0; i < words.length; i++) {
    for (const al of Object.values(AIRLINES)) {
      const tel = al.tel.toLowerCase();
      const parts = tel.split(' ');
      const cand = words.slice(i, i + parts.length).join(' ');
      const joined = words.slice(i, i + 2).join('');
      const sc = Math.max(sim(cand, tel), sim(joined, tel.replace(/ /g, '')));
      if (sc < 0.72) continue;
      const nums = digitsIn(words.slice(i + parts.length, i + parts.length + 6));
      for (const a of air.filter((x) => x.airline === al.code)) {
        const no = a.cs.replace(/^[A-Z]+/, '');
        const hit = nums.some((n) => n === no) ? 1 : nums.some((n) => n.startsWith(no) || no.startsWith(n)) ? 0.6 : 0;
        const score = sc + hit;
        if (!best || score > best.score) best = { ac: a, score };
      }
    }
  }
  // nur die Nummer genannt? Eindeutige Flugnummer suchen
  if (!best || best.score < 1.5) {
    const nums = digitsIn(words);
    const byNo = air.filter((a) => nums.includes(a.cs.replace(/^[A-Z]+/, '')));
    if (byNo.length === 1) best = { ac: byNo[0], score: 1.5 };
  }
  // 2) Befehl
  let cmd = null;
  for (const [k, re] of RULES) {
    if (re.test(raw)) {
      cmd = k;
      break;
    }
  }
  const sp = raw.match(/\b(speed|reduce|increase|maintain)\b.*?\b(one|two|1|2)[ ]?(six|eight|one|five|6|8|1|5)[ ]?(zero|0)\b/);
  if (!cmd && sp) {
    const v = Number(digitsIn(sp[0].split(' ').slice(1)).join('').slice(0, 3));
    if (SPEEDS.includes(v)) cmd = 'spd' + v;
  }
  return { ac: best ? best.ac : null, cmd, text: raw, sure: !!best && best.score >= 1.5 };
}
