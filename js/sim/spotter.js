// Spotterbuch: Kennzeichen und seltene Sonderlackierungen je Flugzeug, besondere Momente und Punkte.
// Die Sammlung gilt über alle Spielstände hinweg (localStorage), Fotos als kleine Vorschaubilder.
import { AC_TYPES, AIRLINES } from '../config.js';
import { PH } from './aircraft.js';
import { hourOf } from '../util.js';
import { T } from '../i18n.js';

// Sonderlackierungen (selten): Leitwerk, Zierstreifen, Akzent
export const SPECIALS = {
  retro: { name: T('Retro-Lackierung'), icon: '🕰️', fin: '#7c2d12', band: '#c2410c', accent: '#fef3c7' },
  rainbow: { name: T('Regenbogen'), icon: '🌈', fin: '#e11d48', band: '#7c3aed', accent: '#ffffff', stripes: ['#e11d48', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6'] },
  silver: { name: T('Allianz-Silber'), icon: '🥈', fin: '#475569', band: '#94a3b8', accent: '#e2e8f0' },
  anniv: { name: T('50 Jahre'), icon: '🥂', fin: '#1f2937', band: '#d4af37', accent: '#d4af37' },
  football: { name: T('Fußball-Sonderbemalung'), icon: '⚽', fin: '#15803d', band: '#16a34a', accent: '#ffffff' },
  stars: { name: T('Sternenhimmel'), icon: '🌌', fin: '#0f172a', band: '#1e3a8a', accent: '#fde047' },
};
export const SPECIAL_KEYS = Object.keys(SPECIALS);

// Seltenheit je Typ (Punkte)
export const RARITY = {
  A320: 1, B738: 1, E190: 1, A321: 1,
  AT76: 2, B789: 2, A359: 2, A223: 2, CRJ9: 2, DH8D: 2, A333: 2,
  B77W: 3, B748F: 3, B77F: 3, C68A: 3,
  A388: 4,
};
export const RARITY_DE = ['', T('häufig'), T('gelegentlich'), T('selten'), T('legendär')];
const RARITY_PTS = [0, 10, 20, 40, 100];

// Motiv des Tages: je Spieltag eine Fotoaufgabe (aus dem Tag abgeleitet, ohne Spielzufall), +150 Punkte
export const MOTIF_PTS = 150;
const MOTIFS = [
  { type: 'DH8D', t: T('eine Borealis BR-40') }, { type: 'A223', t: T('eine Aviora AV-23') }, { type: 'AT76', t: T('eine Ventis VT-70') }, { type: 'CRJ9', t: T('eine Corvin KR-90') },
  { type: 'B789', t: T('eine Halvard H-89') }, { type: 'A359', t: T('eine Aviora AV-35') }, { type: 'B77W', t: T('eine Halvard H-77X') }, { type: 'A333', t: T('eine Aviora AV-33') },
  { airline: 'FJW', t: T('eine Maschine von Fjordwing') }, { airline: 'LUM', t: T('eine Maschine von Lumen Air') }, { airline: 'OPL', t: T('eine Maschine von Orient Pearl') }, { airline: 'BWG', t: T('eine Maschine von Balticwings') }, { airline: 'ALP', t: T('eine Maschine von Alpina Air') },
  { moment: 'landing', t: T('eine Landung') }, { moment: 'takeoff', t: T('einen Start') }, { moment: 'push', t: T('einen Pushback') }, { moment: 'night', t: T('eine Nachtaufnahme') }, { moment: 'golden', t: T('ein Flugzeug in der goldenen Stunde') },
  { size: 'L', moment: 'landing', t: T('einen Großraumjet bei der Landung') }, { size: 'L', moment: 'takeoff', t: T('einen Großraumjet beim Start') }, { size: 'S', moment: 'takeoff', t: T('einen Turboprop oder Regionaljet beim Start') },
];
export function motifOf(state) {
  const day = Math.floor(state.time / 86400);
  return { ...MOTIFS[hashStr('motif' + day) % MOTIFS.length], day };
}
function motifHit(m, ac, moments) {
  if (m.type && ac.type !== m.type) return false;
  if (m.airline && ac.airline !== m.airline) return false;
  if (m.size && AC_TYPES[ac.type].size !== m.size) return false;
  if (m.moment && !moments.includes(m.moment)) return false;
  return true;
}
export const motifDone = (state) => state.motifDone === Math.floor(state.time / 86400);

// Momente: Bedingungen im Bild
export const MOMENTS = {
  landing: { icon: '🛬', name: T('Landung') },
  takeoff: { icon: '🛫', name: T('Start') },
  push: { icon: '🚜', name: T('Pushback') },
  night: { icon: '🌙', name: T('Nachtaufnahme') },
  golden: { icon: '🌅', name: T('Goldene Stunde') },
  rain: { icon: '🌧️', name: T('Im Regen') },
  storm: { icon: '⛈️', name: T('Gewitter') },
  snow: { icon: '🌨️', name: T('Schneetreiben') },
  fog: { icon: '🌫️', name: T('Im Nebel') },
  deice: { icon: '🧊', name: T('Enteisung') },
  goaround: { icon: '↗️', name: T('Durchstarten') },
  emergency: { icon: '🚨', name: T('Notfall') },
};

// Länderkennung je Airline
const PREFIX = { AUR: ['D-A', 3], RHJ: ['D-A', 3], ALP: ['HB-J', 2], NST: ['SE-R', 2], SKB: ['EI-F', 2], OPL: ['B-L', 3], TGC: ['N', 0], BWG: ['YL-', 3], VIP: ['D-C', 3], GOV: ['D-AG', 2], LUM: ['9H-L', 2], FJW: ['LN-F', 2] };
const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Kennzeichen und Lackierung für ein neues Flugzeug (deterministisch, ohne den Sim-Zufall zu verbrauchen)
export function assignLook(ac, rot) {
  const h = hashStr(`${rot.id}|${rot.airline}|${rot.type}|${rot.arrNo}`);
  const [pre, n] = PREFIX[rot.airline] || ['D-A', 3];
  if (!n) ac.reg = `${pre}${100 + (h % 900)}TG`;
  else {
    let s = '';
    for (let i = 0; i < n; i++) s += LET[(h >>> (i * 5)) % 26];
    ac.reg = pre + s;
  }
  // etwa jede 18. Linienmaschine trägt eine Sonderlackierung
  if (rot.airline !== 'VIP' && rot.airline !== 'GOV' && (h >>> 20) % 18 === 0) ac.special = SPECIAL_KEYS[(h >>> 8) % SPECIAL_KEYS.length];
}

// Farben fürs Zeichnen
export function lookOf(ac) {
  const al = AIRLINES[ac.airline] || AIRLINES.AUR;
  const sp = ac.special && SPECIALS[ac.special];
  if (!sp) return { fin: al.color, band: al.color, accent: al.color2, stripes: null };
  return { fin: sp.fin, band: sp.band, accent: sp.accent, stripes: sp.stripes || null };
}

// Welche Momente sind gerade im Bild?
export function momentsOf(state, ac) {
  const m = [];
  const ph = ac.phase;
  if (ph === PH.FINAL || ph === PH.ROLLOUT) m.push('landing');
  if (ph === PH.TAKEOFF || (ph === PH.DEPART && ac.mode === 'map')) m.push('takeoff');
  if (ph === PH.PUSH) m.push('push');
  if (ph === PH.GOAROUND || ph === PH.MISSED) m.push('goaround');
  if (ac.emergency || ac.fireStop) m.push('emergency');
  if (ac.ta && ac.ta.tasks.deice && ac.ta.tasks.deice.st === 'active') m.push('deice');
  const h = hourOf(state.time);
  if (h < 5.6 || h > 21.2) m.push('night');
  else if (Math.abs(h - 7.1) < 1.1 || Math.abs(h - 18.5) < 1.1) {
    if (state.weather.kind === 'clear' || state.weather.kind === 'clouds') m.push('golden');
  }
  const wk = state.weather.kind;
  if (wk === 'rain' || wk === 'storm' || wk === 'snow' || wk === 'fog') m.push(wk);
  return m;
}

// ---------- Sammlung ----------
const KEY = 'planez_spotter';
const MAX_ALBUM = 16;
let book = null;
export function spotBook() {
  if (book) return book;
  try {
    book = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) {}
  if (!book || typeof book !== 'object') book = {};
  book = { pts: 0, shots: 0, types: {}, airlines: {}, specials: {}, moments: {}, regs: 0, album: [], covers: {}, ...book };
  return book;
}
function persist() {
  const b = spotBook();
  for (let tries = 0; tries < 6; tries++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(b));
      return;
    } catch (e) {
      // Speicher voll: älteste Fotos zuerst weglassen
      if (b.album.length > 4) b.album.splice(0, 4);
      else b.covers = {};
    }
  }
}
export function resetSpotBook() {
  book = null;
  try {
    localStorage.removeItem(KEY);
  } catch (e) {}
}

// Foto werten und eintragen. img = Vorschaubild (dataURL) oder null
export function spotAircraft(state, ac, img) {
  const b = spotBook();
  const seen = ac.spotted || (ac.spotted = []);
  const moments = momentsOf(state, ac);
  const fresh = moments.filter((k) => !seen.includes(k));
  const first = !seen.includes('_');
  if (!first && !fresh.length) return { dup: true, pts: 0, lines: [] };
  const lines = [];
  let pts = 0;
  const r = RARITY[ac.type] || 1;
  if (first) {
    seen.push('_');
    pts += RARITY_PTS[r];
    lines.push([`${AC_TYPES[ac.type].name} · ${RARITY_DE[r]}`, RARITY_PTS[r]]);
    if (!b.types[ac.type]) {
      pts += RARITY_PTS[r] * 2;
      lines.push([T`Neuer Typ im Spotterbuch`, RARITY_PTS[r] * 2]);
    }
    if (!b.airlines[ac.airline]) {
      pts += 30;
      lines.push([T`Neue Airline: ${AIRLINES[ac.airline].name}`, 30]);
    }
    if (ac.special) {
      const nw = !b.specials[ac.special];
      pts += nw ? 200 : 80;
      lines.push([T`${SPECIALS[ac.special].icon} Sonderlackierung ${SPECIALS[ac.special].name}${nw ? T(' – neu!') : ''}`, nw ? 200 : 80]);
    }
    b.types[ac.type] = (b.types[ac.type] || 0) + 1;
    b.airlines[ac.airline] = (b.airlines[ac.airline] || 0) + 1;
    if (ac.special) b.specials[ac.special] = (b.specials[ac.special] || 0) + 1;
    b.regs++;
  }
  for (const k of fresh) {
    seen.push(k);
    const nw = !b.moments[k];
    pts += nw ? 50 : 15;
    lines.push([`${MOMENTS[k].icon} ${MOMENTS[k].name}${nw ? T(' – neu!') : ''}`, nw ? 50 : 15]);
    b.moments[k] = (b.moments[k] || 0) + 1;
  }
  // Motiv des Tages
  const mo = motifOf(state);
  if (!motifDone(state) && motifHit(mo, ac, moments)) {
    state.motifDone = mo.day;
    pts += MOTIF_PTS;
    lines.push([T`🎯 Motiv des Tages: ${mo.t}`, MOTIF_PTS]);
    const L0 = state.life || (state.life = {});
    L0.motifs = (L0.motifs || 0) + 1;
  }
  b.pts += pts;
  b.shots++;
  const entry = { t: Date.now(), cs: ac.cs, reg: ac.reg || '', type: ac.type, al: ac.airline, sp: ac.special || null, m: moments, pts, img: img || null, clock: state.time };
  if (img) {
    b.album.push(entry);
    if (b.album.length > MAX_ALBUM) b.album.splice(0, b.album.length - MAX_ALBUM);
    // Titelbild je Typ: das mit den meisten Momenten
    const cov = b.covers[ac.type];
    if (!cov || (cov.m || []).length <= moments.length) b.covers[ac.type] = { img, m: moments, reg: entry.reg, al: ac.airline, sp: entry.sp };
  }
  persist();
  // für Erfolge im Spielstand mitzählen
  const L = state.life || (state.life = {});
  L.spotShots = (L.spotShots || 0) + 1;
  L.spotTypes = Object.keys(b.types).length;
  L.spotSpecials = Object.keys(b.specials).length;
  return { dup: false, pts, lines, entry };
}

export function spotStats() {
  const b = spotBook();
  return {
    pts: b.pts,
    shots: b.shots,
    types: Object.keys(b.types).length,
    typesAll: Object.keys(RARITY).length,
    airlines: Object.keys(b.airlines).length,
    airlinesAll: Object.keys(AIRLINES).length,
    specials: Object.keys(b.specials).length,
    specialsAll: SPECIAL_KEYS.length,
    moments: Object.keys(b.moments).length,
    momentsAll: Object.keys(MOMENTS).length,
  };
}

// Lohnt sich ein Foto? (für Hinweise: seltene Maschine, neue Lackierung, neuer Typ)
export function spotWorth(ac) {
  const b = spotBook();
  if (ac.spotted && ac.spotted.includes('_')) return null;
  if (ac.special && !b.specials[ac.special]) return T`${SPECIALS[ac.special].icon} Sonderlackierung „${SPECIALS[ac.special].name}“`;
  if (!b.types[ac.type]) return T`neuer Typ ${AC_TYPES[ac.type].name}`;
  if ((RARITY[ac.type] || 1) >= 3) return T`seltene ${AC_TYPES[ac.type].name}`;
  if (ac.special) return T`${SPECIALS[ac.special].icon} Sonderlackierung „${SPECIALS[ac.special].name}“`;
  return null;
}

// Zusatzpunkte (z. B. für ein gut getroffenes 3D-Foto)
export function spotBonus(state, pts) {
  const b = spotBook();
  b.pts += pts;
  persist();
}
