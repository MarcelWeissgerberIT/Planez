// Tageshighlights im Tagesbericht: besondere Momente des Tages als Leiste (Butterlandungen, Platzrunden,
// Hubschrauber-Querungen, Wassertaufen, Staatsbesuch, Wetterumwege, gefundene Fremdkörper …) und die weichste Landung.
import { AC_TYPES } from '../config.js';
import { esc } from '../util.js';

const ITEMS = [
  ['stateVisit', '🎖️', (n) => (n > 1 ? `${n} Staatsbesuche` : 'Staatsbesuch')],
  ['a380landed', '🐋', (n) => `${n}× A380`],
  ['salutes', '💦', (n) => `${n} Wassertaufe${n > 1 ? 'n' : ''}`],
  ['emgLanded', '🚨', (n) => `${n} Notlandung${n > 1 ? 'en' : ''} sicher`],
  ['butter', '🧈', (n) => `${n} Butterlandung${n > 1 ? 'en' : ''}`],
  ['touchGo', '🛩️', (n) => `${n}× Touch and Go`],
  ['heliX', '🚁', (n) => `${n} Heli-Querung${n > 1 ? 'en' : ''}`],
  ['wxOk', '⛈️', (n) => `${n} Wetterumweg${n > 1 ? 'e' : ''}`],
  ['fodFound', '🚙', (n) => `${n}× Fremdkörper gefunden`],
  ['openDays', '🎈', () => 'Tag der offenen Tür'],
  ['streamWishes', '💬', (n) => (n > 1 ? `${n} Zuschauerwünsche erfüllt` : 'Zuschauerwunsch erfüllt')],
  ['quizOk', '🔎', (n) => `${n} Typ${n > 1 ? 'en' : ''} im Quiz erkannt`],
  ['hardLand', '⚠', (n) => `${n} harte Landung${n > 1 ? 'en' : ''}`],
];

export function highlightsHtml(state, rec) {
  const L = state.life || {};
  const P = state.hlLife || {};
  state.hlLife = { ...L };
  const chips = [];
  for (const [k, icon, txt] of ITEMS) {
    const d = (L[k] || 0) - (P[k] || 0);
    if (d > 0) chips.push(`<span class="hl-c${k === 'hardLand' ? ' warn' : ''}">${icon} ${esc(txt(d))}</span>`);
  }
  const td = rec.td;
  const best = td && td.best ? `<span class="hl-best">🛬 Weichste Landung: <b>${esc(td.best.cs)}</b> (${esc(AC_TYPES[td.best.type] ? AC_TYPES[td.best.type].name : td.best.type)}) mit <b>${td.best.fpm} ft/min</b> · Ø ${td.avg} ft/min</span>` : '';
  if (!chips.length && !best) return '';
  return `<div class="hl"><div class="hl-h">✨ Highlights des Tages</div><div class="hl-row">${chips.join('')}</div>${best}</div>`;
}
