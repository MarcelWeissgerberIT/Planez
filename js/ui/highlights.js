// Tageshighlights im Tagesbericht: besondere Momente des Tages als Leiste (Butterlandungen, Platzrunden,
// Hubschrauber-Querungen, Wassertaufen, Staatsbesuch, Wetterumwege, gefundene Fremdkörper …) und die weichste Landung.
import { AC_TYPES } from '../config.js';
import { esc } from '../util.js';
import { T } from '../i18n.js';

const ITEMS = [
  ['stateVisit', '🎖️', (n) => (n > 1 ? T`${n} Staatsbesuche` : T('Staatsbesuch'))],
  ['a380landed', '🐋', (n) => `${n}× AV-38`],
  ['salutes', '💦', (n) => (n > 1 ? T`${n} Wassertaufen` : T`${n} Wassertaufe`)],
  ['emgLanded', '🚨', (n) => (n > 1 ? T`${n} Notlandungen sicher` : T`${n} Notlandung sicher`)],
  ['butter', '🧈', (n) => (n > 1 ? T`${n} Butterlandungen` : T`${n} Butterlandung`)],
  ['touchGo', '🛩️', (n) => T`${n}× Touch and Go`],
  ['heliX', '🚁', (n) => (n > 1 ? T`${n} Heli-Querungen` : T`${n} Heli-Querung`)],
  ['wxOk', '⛈️', (n) => (n > 1 ? T`${n} Wetterumwege` : T`${n} Wetterumweg`)],
  ['fodFound', '🚙', (n) => T`${n}× Fremdkörper gefunden`],
  ['openDays', '🎈', () => T('Tag der offenen Tür')],
  ['streamWishes', '💬', (n) => (n > 1 ? T`${n} Zuschauerwünsche erfüllt` : T('Zuschauerwunsch erfüllt'))],
  ['quizOk', '🔎', (n) => (n > 1 ? T`${n} Typen im Quiz erkannt` : T`${n} Typ im Quiz erkannt`)],
  ['hardLand', '⚠', (n) => (n > 1 ? T`${n} harte Landungen` : T`${n} harte Landung`)],
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
  const best = td && td.best ? T`<span class="hl-best">🛬 Weichste Landung: <b>${esc(td.best.cs)}</b> (${esc(AC_TYPES[td.best.type] ? AC_TYPES[td.best.type].name : td.best.type)}) mit <b>${td.best.fpm} ft/min</b> · Ø ${td.avg} ft/min</span>` : '';
  if (!chips.length && !best) return '';
  return T`<div class="hl"><div class="hl-h">✨ Highlights des Tages</div><div class="hl-row">${chips.join('')}</div>${best}</div>`;
}
