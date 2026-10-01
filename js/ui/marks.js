// Markierungen von Flügen: auf Streifen, Karte und Radar setzen und anzeigen
import { esc } from '../util.js';
import { T } from '../i18n.js';

// Ring/Fahne als eigene Form – unabhängig von den Farben der Pistenfolge
export const MARKS = {
  gelb: { name: T('Gelb'), hex: '#fde047' },
  gruen: { name: T('Grün'), hex: '#4ade80' },
  blau: { name: T('Blau'), hex: '#3b82f6' },
  violett: { name: T('Violett'), hex: '#a78bfa' },
  weiss: { name: T('Weiß'), hex: '#f8fafc' },
  rot: { name: T('Rot'), hex: '#f87171' },
};
export const MARK_KEYS = Object.keys(MARKS);
export const NOTE_PRESETS = [T('Vorrang'), T('Beobachten'), 'VIP', T('Funk prüfen'), T('Verspätet'), T('Wirbel')];

export const markHex = (ac) => (ac && ac.mark && MARKS[ac.mark.c] ? MARKS[ac.mark.c].hex : null);

export function setMark(ac, c, note) {
  if (!ac) return;
  const n = note !== undefined ? String(note).trim().slice(0, 14) : ac.mark ? ac.mark.note : '';
  ac.mark = { c: MARKS[c] ? c : 'gelb', note: n };
}
export function clearMark(ac) {
  if (ac) delete ac.mark;
}
// Farbe weiterschalten; nach der letzten Farbe: Markierung entfernen
export function cycleMark(ac) {
  if (!ac) return;
  if (!ac.mark) return setMark(ac, MARK_KEYS[0], '');
  const i = MARK_KEYS.indexOf(ac.mark.c);
  if (i >= MARK_KEYS.length - 1) clearMark(ac);
  else setMark(ac, MARK_KEYS[i + 1]);
}

// kleines Kennzeichen für Streifen/Listen
export function flagHtml(ac) {
  const hex = markHex(ac);
  if (!hex) return '';
  return `<span class="mflag" style="--m:${hex}">⚑${ac.mark.note ? ' ' + esc(ac.mark.note) : ''}</span>`;
}
export function flagButton(ac) {
  const hex = markHex(ac);
  return `<button class="flag-btn${hex ? ' on' : ''}" data-mark="${ac.id}" style="--m:${hex || 'transparent'}" title="${T('Markieren (M) – auch per Rechtsklick auf Karte/Radar')}">⚑</button>`;
}

// ---------- Popup ----------
let pop = null;
let popAc = null;
let onChange = () => {};

export function initMarkMenu(game) {
  pop = document.createElement('div');
  pop.id = 'markpop';
  pop.className = 'markpop hidden';
  pop.setAttribute('role', 'dialog');
  document.getElementById('game').appendChild(pop);
  onChange = () => game.refreshUi && game.refreshUi();
  pop.addEventListener('click', (e) => {
    const s = game.state;
    const ac = s && s.acs.find((a) => a.id === popAc);
    if (!ac) return closeMarkMenu();
    const sw = e.target.closest('[data-mc]');
    const pr = e.target.closest('[data-mn]');
    const inp = pop.querySelector('input');
    if (sw) {
      setMark(ac, sw.dataset.mc, inp.value);
      closeMarkMenu();
    } else if (pr) {
      setMark(ac, ac.mark ? ac.mark.c : 'gelb', pr.dataset.mn);
      closeMarkMenu();
    } else if (e.target.closest('[data-mok]')) {
      setMark(ac, ac.mark ? ac.mark.c : 'gelb', inp.value);
      closeMarkMenu();
    } else if (e.target.closest('[data-mdel]')) {
      clearMark(ac);
      closeMarkMenu();
    }
    onChange();
  });
  pop.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') pop.querySelector('[data-mok]').click();
    if (e.key === 'Escape') closeMarkMenu();
  });
  document.addEventListener('pointerdown', (e) => {
    if (pop && !pop.classList.contains('hidden') && !pop.contains(e.target) && !e.target.closest('[data-mark],[data-imarkmenu]')) closeMarkMenu();
  });
}

export function openMarkMenu(game, acId, x, y) {
  const ac = game.state.acs.find((a) => a.id === acId);
  if (!ac || !pop) return;
  popAc = acId;
  const cur = ac.mark || {};
  pop.innerHTML = `
    <div class="mp-head">${T`⚑ <b>${esc(ac.cs)}</b> markieren`}</div>
    <div class="mp-sw">${MARK_KEYS.map((k) => `<button data-mc="${k}" class="${cur.c === k ? 'cur' : ''}" style="--m:${MARKS[k].hex}" title="${MARKS[k].name}" aria-label="${MARKS[k].name}"></button>`).join('')}</div>
    <div class="mp-pre">${NOTE_PRESETS.map((n) => `<button data-mn="${n}" class="${cur.note === n ? 'cur' : ''}">${n}</button>`).join('')}</div>
    <div class="mp-in"><input maxlength="14" placeholder="${T('eigene Notiz…')}" value="${esc(cur.note || '')}" /><button class="mini" data-mok>OK</button></div>
    ${ac.mark ? T('<button class="mini mp-del" data-mdel>Markierung entfernen</button>') : ''}`;
  pop.classList.remove('hidden');
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 8)) + 'px';
}

export function closeMarkMenu() {
  if (pop) pop.classList.add('hidden');
  popAc = null;
}
export const markMenuOpen = () => pop && !pop.classList.contains('hidden');
