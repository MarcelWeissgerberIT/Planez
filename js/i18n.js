// Sprache des Spiels (Deutsch/Englisch). Deutsch ist die Quellsprache im Code; T() schlägt für Englisch im Wörterbuch
// js/i18n/en.js nach (Schlüssel = deutscher Originaltext, bei Template-Texten mit Platzhaltern {0}, {1} …).
// Gewählt wird in den Einstellungen (wirkt nach Neuladen); ohne Wahl entscheidet die Browsersprache.
const PREF = 'planez_lang';
function detect() {
  // ohne Browser (Tests, Werkzeuge): Deutsch, außer PLANEZ_LANG ist gesetzt
  if (typeof window === 'undefined') return (typeof process !== 'undefined' && process.env && process.env.PLANEZ_LANG) || 'de';
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
    if (q === 'de' || q === 'en') return q;
    const p = typeof localStorage !== 'undefined' && localStorage.getItem(PREF);
    if (p === 'de' || p === 'en') return p;
    const n = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase();
    if (n) return n.startsWith('de') ? 'de' : 'en';
  } catch (e) {}
  return 'de';
}
export const LANG = detect();
export const EN = LANG === 'en';
export const LOCALE = EN ? 'en-GB' : 'de-DE';
export const DEC = EN ? '.' : ',';
export function setLang(l) {
  try {
    localStorage.setItem(PREF, l);
  } catch (e) {}
}

// Wörterbuch nur laden, wenn es gebraucht wird
const DICT = EN ? (await import('./i18n/en.js')).default : null;
const KEYS = new WeakMap();

// T('Text') oder T`Text ${x}` – liefert den Text in der aktiven Sprache
export function T(s, ...vals) {
  if (typeof s === 'string') {
    if (!DICT) return s;
    const r = DICT[s];
    return r === undefined ? s : r;
  }
  if (!DICT) {
    let out = s[0];
    for (let i = 0; i < vals.length; i++) out += vals[i] + s[i + 1];
    return out;
  }
  let key = KEYS.get(s);
  if (key === undefined) {
    key = '';
    for (let i = 0; i < s.length; i++) key += i < s.length - 1 ? s[i] + '{' + i + '}' : s[i];
    KEYS.set(s, key);
  }
  const tr = DICT[key];
  if (tr === undefined) {
    let out = s[0];
    for (let i = 0; i < vals.length; i++) out += vals[i] + s[i + 1];
    return out;
  }
  return tr.replace(/\{(\d+)\}/g, (m, i) => (vals[+i] === undefined ? '' : String(vals[+i])));
}

// mehrdeutige kurze Wörter mit Kontext: TC('radar', 'frei') sucht zuerst „radar|frei“ (z. B. „cleared“ statt „free“)
export function TC(ctx, s) {
  if (!DICT) return s;
  const r = DICT[ctx + '|' + s];
  return r === undefined ? T(s) : r;
}

// statischen Text der Seite (index.html) übersetzen: Textknoten und title/placeholder/aria-label
export function translateDom(root = document.body) {
  if (!DICT) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const todo = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.nodeValue.trim();
    if (t && DICT[t] !== undefined) todo.push([n, t]);
  }
  for (const [n, t] of todo) n.nodeValue = n.nodeValue.replace(t, DICT[t]);
  for (const el of root.querySelectorAll('[title],[placeholder],[aria-label],[data-tip]')) {
    for (const a of ['title', 'placeholder', 'aria-label', 'data-tip']) {
      const v = el.getAttribute(a);
      if (v && DICT[v.trim()] !== undefined) el.setAttribute(a, DICT[v.trim()]);
    }
  }
  document.documentElement.lang = LANG;
}
