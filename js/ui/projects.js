// Darstellung von Bauprojekten (Manager-Panel & Info-Karte)
import { fmtMoney, fmtClock, esc } from '../util.js';
import { remainingHours } from '../sim/construction.js';
import { TIME_SCALE } from '../config.js';
import { T } from '../i18n.js';

export function fmtHours(h) {
  if (h >= 1) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return mm && hh < 10 ? `${hh} h ${mm} min` : `${Math.round(h)} h`;
  }
  return `${Math.max(1, Math.ceil(h * 60))} min`;
}
// Restzeit in echten Minuten beim aktuellen Tempo (pausiert: bei 10×)
export function realMinutes(state, h) {
  const v = state.speed || 10;
  const m = (h * 3600) / (TIME_SCALE * v) / 60;
  return m < 1 ? T('< 1 Min.') : T`≈ ${Math.round(m)} Min.`;
}
export const projectRefund = (p) => Math.round(p.cost * 0.5 * (1 - p.prog));

export function projectStatus(state, p) {
  if (p.status === 'waiting') return T('wartet, bis die Position frei ist');
  if (state.weather.kind === 'storm') return T('Gewitter – Arbeiten ruhen');
  const h = remainingHours(p);
  return T`fertig ca. ${fmtClock(state.time + h * 3600)} (Tag ${Math.floor((state.time + h * 3600) / 86400) + 1}) · in echt ${realMinutes(state, h)}`;
}

export function progressBar(p) {
  const pct = Math.floor(p.prog * 100);
  return `<div class="pbar${p.status === 'waiting' ? ' wait' : ''}"><i style="width:${pct}%"></i><span>${pct} %</span></div>`;
}

// Karte für eine Baustelle; armed = Abbruch-Bestätigung aktiv
export function projectCard(state, p, armed = false, withShow = true) {
  const rem = remainingHours(p);
  const cancel = armed
    ? T`<button class="mini warn" data-act="pcancel" data-v="${p.id}">Wirklich abbrechen? (+${fmtMoney(projectRefund(p))})</button>`
    : T`<button class="mini" data-act="pcancel" data-v="${p.id}">Abbrechen</button>`;
  return T`<div class="card site"><div class="row"><span class="t">🏗️ ${esc(p.name)}</span><span class="rem">${p.status === 'waiting' ? '⏳' : T`noch ${fmtHours(rem)}`}</span></div>
    ${progressBar(p)}
    <div class="s">${projectStatus(state, p)} · Bauzeit ${p.hours} h · ${fmtMoney(p.cost)}</div>
    <div class="acts">${withShow ? T`<button class="mini" data-act="pshow" data-v="${p.id}">📍 Zeigen</button>` : ''}${cancel}</div></div>`;
}

// Kompakte Inline-Anzeige (statt Bau-Button)
export function projectInline(p) {
  const pct = Math.floor(p.prog * 100);
  return `<span class="p-inline" data-act="pshow" data-v="${p.id}" title="${T('Baustelle zeigen')}">🏗️ ${p.status === 'waiting' ? T('wartet') : `${pct} % · ${fmtHours(remainingHours(p))}`}</span>`;
}
