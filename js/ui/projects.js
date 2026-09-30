// Darstellung von Bauprojekten (Manager-Panel & Info-Karte)
import { fmtMoney, fmtClock, esc } from '../util.js';
import { remainingHours } from '../sim/construction.js';

export function fmtHours(h) {
  if (h >= 1) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return mm && hh < 10 ? `${hh} h ${mm} min` : `${Math.round(h)} h`;
  }
  return `${Math.max(1, Math.ceil(h * 60))} min`;
}
export const projectRefund = (p) => Math.round(p.cost * 0.5 * (1 - p.prog));

export function projectStatus(state, p) {
  if (p.status === 'waiting') return 'wartet, bis die Position frei ist';
  if (state.weather.kind === 'storm') return 'Gewitter – Arbeiten ruhen';
  return `fertig ca. ${fmtClock(state.time + remainingHours(p) * 3600)}`;
}

export function progressBar(p) {
  const pct = Math.floor(p.prog * 100);
  return `<div class="pbar${p.status === 'waiting' ? ' wait' : ''}"><i style="width:${pct}%"></i><span>${pct} %</span></div>`;
}

// Karte für eine Baustelle; armed = Abbruch-Bestätigung aktiv
export function projectCard(state, p, armed = false, withShow = true) {
  const rem = remainingHours(p);
  const cancel = armed
    ? `<button class="mini warn" data-act="pcancel" data-v="${p.id}">Wirklich abbrechen? (+${fmtMoney(projectRefund(p))})</button>`
    : `<button class="mini" data-act="pcancel" data-v="${p.id}">Abbrechen</button>`;
  return `<div class="card site"><div class="row"><span class="t">🏗️ ${esc(p.name)}</span><span class="rem">${p.status === 'waiting' ? '⏳' : 'noch ' + fmtHours(rem)}</span></div>
    ${progressBar(p)}
    <div class="s">${projectStatus(state, p)} · Bauzeit ${p.hours} h · ${fmtMoney(p.cost)}</div>
    <div class="acts">${withShow ? `<button class="mini" data-act="pshow" data-v="${p.id}">📍 Zeigen</button>` : ''}${cancel}</div></div>`;
}

// Kompakte Inline-Anzeige (statt Bau-Button)
export function projectInline(p) {
  const pct = Math.floor(p.prog * 100);
  return `<span class="p-inline" data-act="pshow" data-v="${p.id}" title="Baustelle zeigen">🏗️ ${p.status === 'waiting' ? 'wartet' : `${pct} % · ${fmtHours(remainingHours(p))}`}</span>`;
}
