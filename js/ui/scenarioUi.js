// Herausforderungen: Menüliste, Seitenkarte, Einsatzbesprechung, Ziel-Leiste im Spiel und Ergebnisbildschirm
import { SCENARIOS, scenarioById, scenarioLive, loadBest, unlocked, goalValue, goalNeed, totalStars } from '../sim/scenarios.js';
import { ROLES } from '../state.js';
import { esc } from '../util.js';
import { TIME_SCALE } from '../config.js';

const DIFF = ['', 'Leicht', 'Mittel', 'Schwer'];
const starStr = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
const hm = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h` : `${m} min`;
};
const durText = (def) => (def.dur >= 86400 ? `${Math.round(def.dur / 86400)} Spieltage` : `${hm(def.dur)} Spielzeit`);
// echte Minuten bei Standardtempo
const realMin = (def) => Math.round(def.dur / TIME_SCALE / (def.role === 'manager' ? 10 : 1) / 60);

// ---------- Hauptmenü ----------
export function scenarioListHtml() {
  const best = loadBest();
  let html = `<button class="mm-back" data-mm="back">← Zurück</button><div class="scn-total">⭐ ${totalStars()} / ${SCENARIOS.length * 3} Sterne</div>`;
  for (const role of ['tower', 'ground', 'manager']) {
    html += `<div class="mm-sub">${ROLES[role].icon} ${esc(ROLES[role].name)}</div>`;
    for (const def of SCENARIOS.filter((d) => d.role === role)) {
      const open = unlocked(def);
      const b = best[def.id];
      html += `<button class="mm-item scn-item ${open ? '' : 'locked'}" data-scn="${def.id}" data-side="scn:${def.id}"><span class="n"></span><span class="l"><b>${def.icon} ${esc(def.title)}</b><small>${DIFF[def.diff]} · ${durText(def)}${open ? '' : ' · 🔒 gesperrt'}</small></span><span class="scn-st ${b && b.stars ? 'got' : ''}">${starStr(b ? b.stars : 0)}</span></button>`;
    }
  }
  return html;
}

export function scenarioSide(id) {
  const def = scenarioById(id);
  if (!def) return '';
  const b = loadBest()[def.id];
  const open = unlocked(def);
  return `<div class="ms-card scn-card"><div class="ms-img" style="background-image:url(${def.img})"></div>
    <div class="ms-body"><div class="ms-h">${def.icon} ${esc(def.title)}</div>
    <div class="ms-subt">${ROLES[def.role].icon} ${esc(ROLES[def.role].short)} · ${DIFF[def.diff]} · ${durText(def)} (ca. ${realMin(def)} min)</div>
    <p class="scn-brief">${esc(def.brief)}</p>
    <div class="ms-sec">Ziele</div>
    <table class="scn-goals">${def.goals.map((g) => `<tr><td>${esc(g.text)}</td>${[0, 1, 2].map((i) => `<td><span class="st">${'★'.repeat(i + 1)}</span> ${goalNeed(g, i)}</td>`).join('')}</tr>`).join('')}</table>
    <div class="ms-auto">${b ? `🏆 Bestwert: <b class="scn-gold">${starStr(b.stars)}</b>${b.pts ? ` · ⭐ ${b.pts.toLocaleString('de-DE')} Punkte` : ''}` : open ? '▶ Klicken zum Starten' : '🔒 Gesperrt – hol erst einen Stern in der vorigen Herausforderung dieser Station'}</div></div></div>`;
}

// ---------- Im Spiel ----------
export class ScenarioUi {
  constructor(game, api) {
    this.game = game;
    this.api = api;
    const bar = document.createElement('div');
    bar.id = 'scn-bar';
    bar.className = 'hidden';
    document.getElementById('game').appendChild(bar);
    this.bar = bar;
    const ov = document.createElement('div');
    ov.id = 'scn-ov';
    ov.className = 'hidden';
    document.getElementById('game').appendChild(ov);
    this.ov = ov;
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-so]');
      if (!b) return;
      const a = b.dataset.so;
      if (a === 'go') this.go();
      else if (a === 'retry') this.api.start(this.def.id);
      else if (a === 'next') this.api.start(b.dataset.id);
      else if (a === 'menu') this.api.menu();
    });
    window.addEventListener('keydown', (e) => {
      if (this.ov.classList.contains('hidden')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        const b = this.ov.querySelector('.btn-primary');
        if (b) {
          e.preventDefault();
          e.stopImmediatePropagation();
          b.click();
        }
      } else if (e.key !== 'Escape') e.stopImmediatePropagation();
    }, true);
  }

  isOpen() {
    return !this.ov.classList.contains('hidden');
  }

  // Einsatzbesprechung vor dem Start (Spiel pausiert)
  brief(def) {
    const s = this.game.state;
    this.def = def;
    this.speed = s.speed || 1;
    s.speed = 0;
    this.ov.innerHTML = `<div class="scn-box brief"><div class="scn-hero" style="background-image:url(${def.img})"><div class="scn-k">Herausforderung · ${ROLES[def.role].icon} ${esc(ROLES[def.role].short)} · ${DIFF[def.diff]}</div><h2>${def.icon} ${esc(def.title)}</h2></div>
      <div class="scn-in"><p class="scn-brief">${esc(def.brief)}</p>
      <div class="scn-cols"><div><div class="scn-h">Ziele</div><table class="scn-goals">${def.goals.map((g) => `<tr><td>${esc(g.text)}</td>${[0, 1, 2].map((i) => `<td><span class="st">${'★'.repeat(i + 1)}</span> ${goalNeed(g, i)}</td>`).join('')}</tr>`).join('')}</table>
      <p class="scn-note">⏱️ ${durText(def)} – bei normalem Tempo etwa ${realMin(def)} Minuten. Alle anderen Stationen laufen automatisch.</p></div>
      <div><div class="scn-h">Tipps</div><ul>${(def.tips || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></div>
      <div class="scn-acts"><button class="btn" data-so="menu">Zurück</button><button class="btn btn-primary" data-so="go">Los geht’s ▶</button></div></div></div>`;
    this.ov.classList.remove('hidden');
  }

  go() {
    this.ov.classList.add('hidden');
    this.game.state.speed = this.speed;
  }

  // Ziel-Leiste oben
  update() {
    const s = this.game.state;
    const L = s && scenarioLive(s);
    this.bar.classList.toggle('hidden', !L || !!(this.game.cinema && this.game.cinema.on));
    document.getElementById('game').classList.toggle('scn-on', !!L);
    if (!L) return;
    const html = `<div class="sb-t"><b>${L.def.icon} ${esc(L.def.title)}</b><span class="sb-left">noch ${L.left >= 86400 ? `${(L.left / 86400).toFixed(1).replace('.', ',')} Tage` : hm(L.left)}</span><i class="sb-p"><i style="width:${Math.round(L.frac * 100)}%"></i></i></div>
      <div class="sb-g">${L.rows.map((r) => `<span class="sb-c s${r.stars}" title="${esc(r.g.text)}: 1★ ${goalNeed(r.g, 0)} · 2★ ${goalNeed(r.g, 1)} · 3★ ${goalNeed(r.g, 2)}"><small>${esc(r.g.text)}</small><b>${goalValue(r.g, r.v == null ? null : Math.round(r.v))}</b><em>${starStr(r.stars)}</em></span>`).join('')}</div>`;
    if (this.bar._h !== html) {
      this.bar.innerHTML = html;
      this.bar._h = html;
    }
  }

  // Ergebnis
  result(def, res) {
    this.def = def;
    const nextDef = SCENARIOS.filter((d) => d.role === def.role)[SCENARIOS.filter((d) => d.role === def.role).indexOf(def) + 1] || SCENARIOS[(SCENARIOS.indexOf(def) + 1) % SCENARIOS.length];
    const canNext = nextDef && unlocked(nextDef);
    const title = res.failed ? 'Abgebrochen' : res.stars === 3 ? 'Perfekt!' : res.stars === 2 ? 'Sehr gut!' : res.stars === 1 ? 'Geschafft' : 'Nicht geschafft';
    this.ov.innerHTML = `<div class="scn-box res ${res.stars ? 'win' : 'lose'}"><div class="scn-hero sm" style="background-image:url(${def.img})"><div class="scn-k">${def.icon} ${esc(def.title)}</div><h2>${title}</h2>
      <div class="scn-big">${[0, 1, 2].map((i) => `<span class="${i < res.stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.35}s">★</span>`).join('')}</div></div>
      <div class="scn-in">${res.failed ? `<p class="scn-fail">⚠️ ${esc(res.failed)}</p>` : ''}
      <table class="scn-res">${def.goals.map((g, i) => {
        const r = res.rows[i];
        return `<tr class="s${r.stars}"><td>${esc(g.text)}</td><td class="v">${goalValue(g, r.v == null ? null : Math.round(r.v))}</td><td class="st">${starStr(r.stars)}</td><td class="nx">${r.stars < 3 ? `nächster Stern ${goalNeed(g, r.stars)}` : '✓ Bestwert'}</td></tr>`;
      }).join('')}</table>
      ${res.pts && def.role !== 'manager' ? `<p class="scn-pts">⭐ ${res.pts.toLocaleString('de-DE')} Schichtpunkte${res.best && res.best.ptsNew ? ' · <b>neuer Punkte-Rekord!</b>' : res.best && res.best.prev && res.best.prev.pts ? ` · Rekord ${res.best.prev.pts.toLocaleString('de-DE')}` : ''}</p>` : ''}
      <p class="scn-note">${[res.best && res.best.isNew && res.stars ? '🏆 <b>Neuer Bestwert!</b>' : res.best && res.best.prev ? `Bisheriger Bestwert: ${starStr(res.best.prev.stars)}` : '', `Gesamt ⭐ ${totalStars()} / ${SCENARIOS.length * 3}`].filter(Boolean).join(' · ')}</p>
      <div class="scn-acts"><button class="btn" data-so="menu">Hauptmenü</button><button class="btn ${res.stars ? '' : 'btn-primary'}" data-so="retry">↻ Nochmal</button>${canNext && res.stars ? `<button class="btn btn-primary" data-so="next" data-id="${nextDef.id}">Weiter: ${nextDef.icon} ${esc(nextDef.title)} ▶</button>` : ''}</div></div></div>`;
    this.ov.classList.remove('hidden');
  }

  hide() {
    this.ov.classList.add('hidden');
    this.bar.classList.add('hidden');
    document.getElementById('game').classList.remove('scn-on');
  }
}

