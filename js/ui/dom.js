// DOM-Helfer: Listen-Synchronisation, Toasts, Modals
import { glossify } from './glossary.js';
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Kinder eines Containers anhand eines Schlüssels abgleichen; parts: { name: html } pro Element
// Zielhilfe: solange der Spieler in einem Bereich zielt (Maus über einem Streifen, gerade getippt), dort nichts
// umsortieren – sonst springt der Streifen weg, bevor der Klick ankommt
let aim = { el: null, until: 0 };
export function holdAim(el, ms) {
  aim = el ? { el, until: performance.now() + ms } : { el: null, until: 0 };
}
export const aiming = (el) => !!(aim.el && aim.el.contains(el) && performance.now() < aim.until);

export function syncList(container, items, keyFn, renderFn, tag = 'div') {
  // wird gerade ein Knopf in der Liste gedrückt oder zielt der Spieler hinein, nichts umsortieren oder entfernen –
  // sonst geht der Klick verloren
  const held = aiming(container);
  const frozen = held || !!(pressed && container.contains(pressed) && pressed.closest && pressed.closest('button, [data-cmd], [data-rbfix], [data-mark]'));
  const existing = new Map();
  for (const el of container.children) if (el.dataset && el.dataset.key) existing.set(el.dataset.key, el);
  let prev = null;
  for (const it of items) {
    const key = String(keyFn(it));
    let el = existing.get(key);
    // beim Zielen keinen zweiten Streifen desselben Flugzeugs in einer anderen Bucht anlegen – er wechselt danach
    if (!el && held && aim.el.querySelector(`[data-key="${CSS.escape(key)}"]`)) continue;
    const r = renderFn(it);
    if (!el) {
      el = document.createElement(tag);
      el.dataset.key = key;
      el._parts = {};
    }
    if (r.cls !== undefined && el.className !== r.cls) el.className = r.cls;
    if (r.html !== undefined) {
      if (el._html !== r.html && !busy(el)) {
        el.innerHTML = r.html;
        el._html = r.html;
        glossify(el);
      }
    } else if (r.parts) {
      // Teilbereiche einzeln aktualisieren (Buttons bleiben stabil)
      if (!el._built) {
        el.innerHTML = Object.keys(r.parts).map((p) => `<div class="${p}"></div>`).join('');
        if (r.wrap) el.innerHTML = r.wrap(el.innerHTML);
        el._built = true;
      }
      for (const [p, html] of Object.entries(r.parts)) {
        // Teil fehlt (z.B. neue Vorlage)? -> neu aufbauen
        if (!el.querySelector('.' + p.split(' ')[0])) {
          el._built = false;
          el._parts = {};
        }
      }
      if (!el._built) {
        el.innerHTML = Object.keys(r.parts).map((p) => `<div class="${p}"></div>`).join('');
        if (r.wrap) el.innerHTML = r.wrap(el.innerHTML);
        el._built = true;
      }
      for (const [p, html] of Object.entries(r.parts)) {
        if (el._parts[p] !== html) {
          const box = el.querySelector('.' + p.split(' ')[0]);
          if (box && busy(box)) continue; // Knopf darin gedrückt: später aktualisieren
          if (box) {
            box.innerHTML = html;
            glossify(box);
          }
          el._parts[p] = html;
        }
      }
    }
    const next = prev ? prev.nextSibling : container.firstChild;
    if (!frozen && el !== next) container.insertBefore(el, next);
    else if (frozen && !el.parentNode) container.appendChild(el);
    existing.delete(key);
    prev = el;
  }
  if (frozen) return;
  for (const el of existing.values()) el.remove();
  // nicht verschlüsselte Elemente (z.B. Leer-Hinweis) entfernen
  for (const el of [...container.children]) if (!el.dataset || !el.dataset.key) el.remove();
}

// Während ein Knopf gedrückt gehalten wird, seinen Container nicht neu zeichnen – sonst verschwindet das Element
// zwischen Drücken und Loslassen und der Klick geht verloren (z. B. Info-Karte eines Flugzeugs im Anflug)
let pressed = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (pressed = e.target), true);
  const release = () => setTimeout(() => (pressed = null), 150);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
}
const busy = (el) => pressed && pressed !== el && el.contains(pressed) && pressed.closest && pressed.closest('button, [data-cmd], [data-ride], [data-follow], [data-spot], a');

export function setHTML(el, html) {
  if (el._html !== html && busy(el)) return;
  if (el._html !== html) {
    el.innerHTML = html;
    el._html = html;
    glossify(el);
  }
}

let toastHost = null;
export function toast(text, level = 'info', ms = 4200) {
  toastHost = toastHost || document.getElementById('toasts');
  if (!toastHost) return;
  // gleiche Meldung schon sichtbar: nicht doppelt stapeln, nur kurz aufleuchten lassen
  for (const old of toastHost.children) if (old._txt === text && !old.classList.contains('out')) {
    old.classList.remove('bump');
    void old.offsetWidth;
    old.classList.add('bump');
    return;
  }
  const t = document.createElement('div');
  t._txt = text;
  t.className = `toast ${level}`;
  // führendes Emoji als Symbol links absetzen, sonst ein Symbol je Stufe
  const m = /^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)\s*/u.exec(text);
  const ico = document.createElement('span');
  ico.className = 'tst-i';
  ico.textContent = m ? m[1] : { good: '✓', warn: '!', bad: '!!', info: 'i' }[level] || 'i';
  if (!m) ico.classList.add('sym');
  const body = document.createElement('span');
  body.className = 'tst-t';
  body.textContent = m ? text.slice(m[0].length) : text;
  t.append(ico, body);
  glossify(body);
  toastHost.appendChild(t);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 450);
  }, ms);
}

export function openModal(html, onMount) {
  const m = document.getElementById('modal');
  const box = document.getElementById('modal-box');
  box.innerHTML = html;
  glossify(box);
  m.classList.remove('hidden');
  if (onMount) onMount(box);
  return box;
}
export function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}
export const modalOpen = () => !document.getElementById('modal').classList.contains('hidden');
