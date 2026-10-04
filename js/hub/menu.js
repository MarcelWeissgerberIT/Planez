// Großflughäfen im Hauptmenü: Liste der Einsätze je Platz und Seitenkarte mit Lageplan-Skizze (aus den Layoutdaten)
import { AIRPORTS } from './airports.js';
import { HUB_SCENARIOS, scenariosOf, hubScenarioById, loadHubBest, hubTotalStars } from './scenarios.js';
import { getAirport } from './store.js';
import { T } from '../i18n.js';
import { esc } from '../util.js';

const stars = (n) => [1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('');

// Kurzbeschreibung je Platz (Seitenkarte der Flughafenauswahl)
const DESC = {
  kgm: () => T('Zwei Parallelbahnen im getrennten Betrieb: eine landet, eine startet – um 15 Uhr tauschen sie. Terminals zwischen den Bahnen, Terminal 4 und Fracht jenseits der Südbahn.'),
  ism: () => T('Zwei weit auseinanderliegende Parallelbahnen im gemischten Betrieb: Auf jeder Bahn wird im Wechsel gelandet und gestartet – Starts müssen in die Lücken der Anflugkette passen.'),
  sby: () => T('Vier Parallelbahnen in zwei Paaren: außen landen, innen starten. Jede Landung kreuzt auf dem Weg zum Terminal die Startbahn – Kreuzungsfreigaben im Minutentakt.'),
  mhf: () => T('Center- und Südbahn eng nebeneinander, dazu die Nordwestbahn nur für Landungen und die Startbahn West nur für Starts nach Süden. Landungen auf der Südbahn kreuzen die startende Centerbahn.'),
  lby: () => T('Zwei Paare paralleler Bahnen im rechten Winkel, die sich an den Enden kreuzen; in der Mitte das Terminalgebiet mit zwei gegenläufigen Ringrollwegen. Je nach Wind in vier Richtungen.'),
};
const apStars = (apId) => {
  const best = loadHubBest();
  const list = scenariosOf(apId).filter((s) => s.goal);
  return { got: list.reduce((a, s) => a + (best[s.id]?.stars || 0), 0), max: list.length * 3 };
};

// Liste: ohne apId die Flughäfen, mit apId die Einsätze dieses Platzes
export function hubListHtml(apId = null) {
  const best = loadHubBest();
  const ap = apId && AIRPORTS.find((a) => a.id === apId);
  if (!ap) {
    let html = T`<button class="mm-back" data-mm="back">← Zurück</button><div class="scn-total">⭐ ${hubTotalStars()} / ${HUB_SCENARIOS.filter((s) => s.goal).length * 3} Sterne</div>`;
    for (const a of AIRPORTS) {
      const st = apStars(a.id);
      html += `<button class="mm-item scn-item hub-ap" data-hubap="${a.id}" data-side="hubap:${a.id}"><span class="n"></span><span class="l"><b>${esc(a.name)}</b><small>${T('Vorbild')}: ${esc(a.vorbild)} · ${T`${scenariosOf(a.id).length} Einsätze`} · <span class="hub-st">⭐ ${st.got}/${st.max}</span></small></span></button>`;
    }
    return html;
  }
  const st = apStars(ap.id);
  let html = T`<button class="mm-back" data-hubback="1">← Alle Großflughäfen</button>`;
  html += `<div class="scn-total">${esc(ap.name)} · ⭐ ${st.got} / ${st.max}</div><div class="mm-sub">${T('Vorbild')}: ${esc(ap.vorbild)}</div>`;
  for (const s of scenariosOf(ap.id)) {
    const b = best[s.id];
    const dur = s.minutes ? T`${s.minutes} min` : T('endlos');
    html += `<button class="mm-item scn-item hub-item" data-hub="${s.id}" data-side="hub:${s.id}"><span class="n"></span><span class="l"><b>${s.icon} ${esc(s.title)}</b><small>${String(Math.floor(s.hour)).padStart(2, '0')}:${String(Math.round((s.hour % 1) * 60)).padStart(2, '0')} · ${dur}${s.goal ? ` · <span class="hub-st">${stars(b ? b.stars : 0)}</span>` : ''}</small></span></button>`;
  }
  return html;
}

// Seitenkarte eines Flughafens in der Auswahl
export function hubApSide(apId) {
  const def = AIRPORTS.find((a) => a.id === apId);
  if (!def) return '';
  const ap = getAirport(apId);
  const st = apStars(apId);
  const cfgs = ap.configs.map((c) => `<li>${esc(T(c.name))}</li>`).join('');
  return `<div class="ms-card hub-card"><div class="hub-map">${airportSvg(apId)}</div><div class="ms-body">
    <div class="ms-h">${esc(ap.name)} (${esc(ap.code)})</div><div class="ms-subt">${T('Vorbild')}: ${esc(ap.vorbild)} · ⭐ ${st.got} / ${st.max}</div>
    <p class="hub-sub">${DESC[apId] ? DESC[apId]() : ''}</p>
    <ul><li>${T`${ap.runways.length} Bahnen · ${ap.stands.length} Positionen · ${ap.configs.length} Betriebsrichtungen`}</li>${cfgs}</ul>
  </div></div>`;
}

// Lageplan als SVG: Bahnen, Rollwege, Vorfeld, Gebäude (Norden oben)
export function airportSvg(apId, w = 340, h = 200) {
  const ap = getAirport(apId);
  const b = ap.bounds;
  const k = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
  const ox = (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, oy = (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
  const P = (p) => `${(p.x * k + ox).toFixed(1)},${(p.y * k + oy).toFixed(1)}`;
  let s = `<svg viewBox="0 0 ${w} ${h}" class="hub-svg" role="img" aria-label="${esc(ap.name)}">`;
  for (const a of ap.aprons) s += `<polygon points="${a.map(P).join(' ')}" fill="#56606c"/>`;
  for (const l of ap.lines) if (l.kind === 'twy') s += `<polyline points="${l.pts.map(P).join(' ')}" fill="none" stroke="#7a8592" stroke-width="${Math.max(0.6, 1.2 * k)}"/>`;
  for (const bd of ap.buildings) if (bd.kind !== 'tank') s += `<polygon points="${bd.poly.map(P).join(' ')}" fill="${bd.kind === 'terminal' || bd.kind === 'pier' ? '#7dd3fc' : '#94a3b8'}" opacity=".85"/>`;
  for (const r of ap.runways) s += `<line x1="${(r.a.x * k + ox).toFixed(1)}" y1="${(r.a.y * k + oy).toFixed(1)}" x2="${(r.b.x * k + ox).toFixed(1)}" y2="${(r.b.y * k + oy).toFixed(1)}" stroke="#e2e8f0" stroke-width="${Math.max(2, r.w * k)}" stroke-linecap="butt"/>`;
  for (const [id, e] of Object.entries(ap.ends)) {
    const p = { x: e.thr.x - e.dir.x * 9, y: e.thr.y - e.dir.y * 9 };
    s += `<text x="${(p.x * k + ox).toFixed(1)}" y="${(p.y * k + oy + 3).toFixed(1)}" fill="#fde68a" font-size="9" text-anchor="middle" font-family="JetBrains Mono, monospace">${id}</text>`;
  }
  s += `<text x="${w - 6}" y="12" fill="#94a3b8" font-size="10" text-anchor="end">N ↑</text></svg>`;
  return s;
}

export function hubSide(id) {
  const s = hubScenarioById(id);
  if (!s) return '';
  const ap = getAirport(s.ap);
  const b = loadHubBest()[s.id];
  const goal = s.goal ? T`<li>Ziel: <b>${s.goal.mov} Bewegungen</b>, keine Konflikte, höchstens 2 Durchstarts</li>` : '';
  return `<div class="ms-card hub-card"><div class="hub-map">${airportSvg(s.ap)}</div><div class="ms-body">
    <div class="ms-h">${s.icon} ${esc(s.title)}</div><div class="ms-subt">${esc(ap.name)} (${esc(ap.code)}) · ${T('Vorbild')}: ${esc(ap.vorbild)}</div>
    <p class="hub-sub">${esc(s.sub)}</p>
    <ul>${goal}<li>${T`${ap.runways.length} Bahnen · ${ap.stands.length} Positionen · ${ap.configs.length} Betriebsrichtungen`}</li><li>${T('Du bist Tower: Lande-, Start- und Kreuzungsfreigaben. Anflug und Bodenverkehr steuern KI-Kollegen.')}</li></ul>
    ${b ? `<div class="ms-auto">🏆 ${T('Bestwert')}: ${stars(b.stars)} · ${T`${b.mov} Bewegungen`}</div>` : ''}
  </div></div>`;
}

export function hubsSideAll() {
  return `<div class="ms-card hub-card"><div class="hub-map">${airportSvg(AIRPORTS[0].id)}</div><div class="ms-body"><div class="ms-h">${T('Großflughäfen')}</div>
    <div class="ms-subt">${T`${AIRPORTS.length} Drehkreuze nach echtem Vorbild · ⭐ ${hubTotalStars()} Sterne`}</div>
    <ul><li>${T('Echtes Bahnsystem, Lage der Terminals und Betriebsrichtungen wie beim Vorbild – mit fiktiven Namen')}</li><li>${T('Verkehr wie zur Spitzenzeit: bis zu 100 Bewegungen pro Stunde, Langstrecke und Superjumbo')}</li><li>${T('Getrennter und gemischter Betrieb, Bahnwechsel, Bahnkreuzungen, Wirbelschleppen')}</li></ul></div></div>`;
}
