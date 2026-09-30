// DOM-Helfer: Listen-Synchronisation, Toasts, Modals
import { glossify } from './glossary.js';
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Kinder eines Containers anhand eines Schlüssels abgleichen; parts: { name: html } pro Element
export function syncList(container, items, keyFn, renderFn, tag = 'div') {
  const existing = new Map();
  for (const el of container.children) if (el.dataset && el.dataset.key) existing.set(el.dataset.key, el);
  let prev = null;
  for (const it of items) {
    const key = String(keyFn(it));
    let el = existing.get(key);
    const r = renderFn(it);
    if (!el) {
      el = document.createElement(tag);
      el.dataset.key = key;
      el._parts = {};
    }
    if (r.cls !== undefined && el.className !== r.cls) el.className = r.cls;
    if (r.html !== undefined) {
      if (el._html !== r.html) {
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
          if (box) {
            box.innerHTML = html;
            glossify(box);
          }
          el._parts[p] = html;
        }
      }
    }
    const next = prev ? prev.nextSibling : container.firstChild;
    if (el !== next) container.insertBefore(el, next);
    existing.delete(key);
    prev = el;
  }
  for (const el of existing.values()) el.remove();
  // nicht verschlüsselte Elemente (z.B. Leer-Hinweis) entfernen
  for (const el of [...container.children]) if (!el.dataset || !el.dataset.key) el.remove();
}

export function setHTML(el, html) {
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
  const t = document.createElement('div');
  t.className = `toast ${level}`;
  t.textContent = text;
  glossify(t);
  toastHost.appendChild(t);
  while (toastHost.children.length > 5) toastHost.firstChild.remove();
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
