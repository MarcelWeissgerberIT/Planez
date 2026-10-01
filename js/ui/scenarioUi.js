// Herausforderungen: Menüliste, Seitenkarte, Einsatzbesprechung, Ziel-Leiste im Spiel und Ergebnisbildschirm
import { IS_DEMO, DEMO } from '../edition.js';
import { SCENARIOS, scenarioById, scenarioLive, loadBest, unlocked, goalValue, goalNeed, totalStars, dailyKey, dailyDef, dailyInfo, dailyLabel, MUTATORS } from '../sim/scenarios.js';
import { ROLES } from '../state.js';
import { esc } from '../util.js';
import { TIME_SCALE } from '../config.js';
import { CHAPTERS, chapterOf, chapterDone, chapterOpen, campaignProgress } from '../sim/campaign.js';
import { CHAIR } from '../sim/board.js';
import { T, DEC, LOCALE } from '../i18n.js';

const DIFF = ['', T('Leicht'), T('Mittel'), T('Schwer')];
const starStr = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
const hm = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h` : `${m} min`;
};
const durText = (def) => (def.endless ? T`endlos · bis ${hm(def.dur)}` : def.dur >= 86400 ? T`${Math.round(def.dur / 86400)} Spieltage` : T`${hm(def.dur)} Spielzeit`);
// echte Minuten bei Standardtempo
const realMin = (def) => Math.round(def.dur / TIME_SCALE / (def.role === 'manager' ? 10 : 1) / 60);

// ---------- Hauptmenü ----------
export function scenarioListHtml() {
  const best = loadBest();
  let html = T`<button class="mm-back" data-mm="back">← Zurück</button><div class="scn-total">⭐ ${totalStars()} / ${SCENARIOS.length * 3} Sterne</div>`;
  // Tagesherausforderung ganz oben
  const dd = dailyDef();
  const db = best[dd.id];
  const di = dailyInfo();
  const streak = di.last === dailyKey() || di.last === dailyKey(new Date(Date.now() - 864e5)) ? di.streak || 0 : 0;
  // Kampagne: geschaffte Kapitel, das nächste offene und ein Ausblick
  const cp = campaignProgress();
  const showTo = cp.next == null ? CHAPTERS.length - 1 : Math.min(CHAPTERS.length - 1, cp.next + 1);
  html += T`<div class="mm-sub">📖 Kampagne · ${cp.done}/${cp.total} Kapitel${cp.next == null ? T(' · 🏆 abgeschlossen') : ''}</div>`;
  CHAPTERS.forEach((c, i) => {
    if (i > showTo) return;
    const d = scenarioById(c.scn);
    const open = chapterOpen(i, best), done = chapterDone(i, best);
    html += `<button class="mm-item scn-item camp ${open ? '' : 'locked'}${done ? ' done' : ''}${i === cp.next ? ' cur' : ''}" data-scn="camp-${i}" data-side="scn:camp-${i}"><span class="n"></span><span class="l"><b>${i + 1}. ${esc(c.title)}</b><small>${ROLES[d.role].icon} ${esc(ROLES[d.role].short)} · ${d.icon} ${esc(d.title)}${open ? '' : IS_DEMO && i >= DEMO.chapters ? T(' · 🔒 Vollversion') : T` · 🔒 erst Kapitel ${i}`}</small></span><span class="scn-st ${done ? 'got' : ''}">${done ? '✓' : open ? '▶' : ''}</span></button>`;
  });
  html += T`<div class="mm-sub">📅 Heute · ${dailyLabel(dd.daily)}</div><button class="mm-item scn-item daily" data-scn="${dd.id}" data-side="scn:${dd.id}"><span class="n"></span><span class="l"><b>📅 ${esc(dd.sub)} ${dd.muts.map((m) => MUTATORS[m].icon).join('')}</b><small>${ROLES[dd.role].icon} ${esc(ROLES[dd.role].short)} · jeden Tag neu${streak ? (streak > 1 ? T` · 🔥 Serie ${streak} Tage` : T` · 🔥 Serie ${streak} Tag`) : ''}</small></span><span class="scn-st ${db && db.stars ? 'got' : ''}">${starStr(db ? db.stars : 0)}</span></button>`;
  for (const role of ['tower', 'ground', 'manager']) {
    html += `<div class="mm-sub">${ROLES[role].icon} ${esc(ROLES[role].name)}</div>`;
    for (const def of SCENARIOS.filter((d) => d.role === role)) {
      const open = unlocked(def);
      const b = best[def.id];
      html += `<button class="mm-item scn-item ${open ? '' : 'locked'}" data-scn="${def.id}" data-side="scn:${def.id}"><span class="n"></span><span class="l"><b>${def.icon} ${esc(def.title)}</b><small>${DIFF[def.diff]} · ${durText(def)}${open ? '' : IS_DEMO && !DEMO.scenarios.includes(def.id) ? T(' · 🔒 Vollversion') : T(' · 🔒 gesperrt')}</small></span><span class="scn-st ${b && b.stars ? 'got' : ''}">${starStr(b ? b.stars : 0)}</span></button>`;
    }
  }
  return html;
}

export function scenarioSide(id) {
  const ch = chapterOf(id);
  if (ch != null) return chapterSide(ch);
  const def = scenarioById(id);
  if (!def) return '';
  const b = loadBest()[def.id];
  const open = unlocked(def);
  return T`<div class="ms-card scn-card"><div class="ms-img" style="background-image:url(${def.img})"></div>
    <div class="ms-body"><div class="ms-h">${def.icon} ${esc(def.title)}</div>
    <div class="ms-subt">${ROLES[def.role].icon} ${esc(ROLES[def.role].short)} · ${DIFF[def.diff]} · ${durText(def)} (ca. ${realMin(def)} min)</div>
    <p class="scn-brief">${esc(def.brief)}</p>
    ${def.daily ? T`<div class="ms-sec">Heute zusätzlich</div><div class="scn-muts">${def.muts.map((m) => `<span title="${esc(MUTATORS[m].text)}">${MUTATORS[m].icon} ${esc(MUTATORS[m].name)}</span>`).join('')}</div>` : ''}
    <div class="ms-sec">Ziele</div>
    <table class="scn-goals">${def.goals.map((g) => `<tr><td>${esc(g.text)}</td>${[0, 1, 2].map((i) => `<td><span class="st">${'★'.repeat(i + 1)}</span> ${goalNeed(g, i)}</td>`).join('')}</tr>`).join('')}</table>
    ${def.daily ? `<div class="ms-sec">${T('Serie')}</div><div class="scn-streak">${(() => { const di = dailyInfo(); const days = []; for (let i = 6; i >= 0; i--) { const k = dailyKey(new Date(Date.now() - i * 864e5)); const st = (di.days || {})[k] || 0; days.push(`<i class="${st ? 'on' : ''}" title="${dailyLabel(k)}: ${st}★">${st ? '★' : '·'}</i>`); } return days.join('') + T` <small>🔥 ${di.last === dailyKey() || di.last === dailyKey(new Date(Date.now() - 864e5)) ? di.streak || 0 : 0} Tage in Folge · Rekord ${di.best || 0}</small>`; })()}</div>` : ''}
    <div class="ms-auto">${b ? T`🏆 Bestwert: <b class="scn-gold">${starStr(b.stars)}</b>${b.mins ? T` · ⏱️ ${hm(b.mins * 60)} gehalten` : ''}${b.pts ? T` · ⭐ ${b.pts.toLocaleString(LOCALE)} Punkte` : ''}` : open ? T('▶ Klicken zum Starten') : (IS_DEMO && !DEMO.scenarios.includes(def.id) ? T('🔒 In der Vollversion – die Demo enthält „Morgenwelle“ und „Ferienstart“') : T('🔒 Gesperrt – hol erst einen Stern in der vorigen Herausforderung dieser Station'))}</div></div></div>`;
}

function storyBox(ch, text, kick) {
  return `<div class="scn-story"><span class="bd-face">👩‍💼</span><div><small>${kick || T`Kapitel ${ch + 1} · ${esc(CHAPTERS[ch].title)}`} · ${CHAIR}</small><p>„${esc(text)}“</p></div></div>`;
}
function chapterSide(ch) {
  const c = CHAPTERS[ch];
  const def = scenarioById(c.scn);
  const open = chapterOpen(ch), done = chapterDone(ch);
  const b = loadBest()[def.id];
  return T`<div class="ms-card scn-card"><div class="ms-img" style="background-image:url(${def.img})"></div>
    <div class="ms-body"><div class="ms-h">📖 Kapitel ${ch + 1}: ${esc(c.title)}</div>
    <div class="ms-subt">${ROLES[def.role].icon} ${esc(ROLES[def.role].short)} · ${def.icon} ${esc(def.title)} · ${DIFF[def.diff]} · ${durText(def)}</div>
    ${open ? storyBox(ch, c.intro) : (IS_DEMO && ch >= DEMO.chapters ? T('<p class="scn-brief">🔒 Die weiteren Kapitel der Kampagne gibt es in der Vollversion.</p>') : T('<p class="scn-brief">🔒 Dieses Kapitel öffnet sich, sobald das vorige mit mindestens einem Stern geschafft ist.</p>'))}
    <div class="ms-sec">Ziele</div>
    <table class="scn-goals">${def.goals.map((g) => `<tr><td>${esc(g.text)}</td>${[0, 1, 2].map((i) => `<td><span class="st">${'★'.repeat(i + 1)}</span> ${goalNeed(g, i)}</td>`).join('')}</tr>`).join('')}</table>
    <div class="ms-auto">${done ? T`✓ Geschafft · Bestwert <b class="scn-gold">${starStr(b.stars)}</b>` : open ? T('▶ Klicken zum Starten – ein Stern genügt für das nächste Kapitel') : (IS_DEMO && ch >= DEMO.chapters ? T('🔒 Vollversion') : T('🔒 Gesperrt'))}</div></div></div>`;
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
      else if (a === 'retry') this.api.start(this.camp != null ? `camp-${this.camp}` : this.def.id);
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
  brief(def, ch = null) {
    const s = this.game.state;
    this.def = def;
    this.camp = ch;
    this.speed = s.speed || 1;
    s.speed = 0;
    this.ov.innerHTML = T`<div class="scn-box brief"><div class="scn-hero" style="background-image:url(${def.img})"><div class="scn-k">${ch != null ? T`📖 Kampagne · Kapitel ${ch + 1}/${CHAPTERS.length}` : T('Herausforderung')} · ${ROLES[def.role].icon} ${esc(ROLES[def.role].short)} · ${DIFF[def.diff]}</div><h2>${def.icon} ${esc(def.title)}</h2></div>
      <div class="scn-in">${ch != null ? storyBox(ch, CHAPTERS[ch].intro) : ''}<p class="scn-brief">${esc(def.brief)}</p>
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
    const left = L.def.endless ? T`Welle ${Math.min(L.def.script.length, Math.floor(L.m.mins / 15)) + 1} · ⚠️ ${L.m.incidents}/3 Vorfälle` : null;
    const html = T`<div class="sb-t"><b>${L.def.icon} ${esc(L.def.title)}</b><span class="sb-left">${left || T`noch ${L.left >= 86400 ? T`${(L.left / 86400).toFixed(1).replace('.', DEC)} Tage` : hm(L.left)}`}</span><i class="sb-p"><i style="width:${Math.round(L.frac * 100)}%"></i></i></div>
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
    const canNext = !def.daily && nextDef && unlocked(nextDef);
    const ch = this.camp;
    let story = '', nextBtn = canNext && res.stars ? T`<button class="btn btn-primary" data-so="next" data-id="${nextDef.id}">Weiter: ${nextDef.icon} ${esc(nextDef.title)} ▶</button>` : '';
    if (ch != null) {
      const last = ch + 1 >= CHAPTERS.length;
      story = res.stars ? storyBox(ch, CHAPTERS[ch].outro, last ? T('🏆 Kampagne abgeschlossen') : null) : storyBox(ch, T('Das war noch nicht genug. Atmen Sie durch und versuchen Sie es noch einmal – ein Stern reicht mir.'));
      nextBtn = res.stars && !last ? T`<button class="btn btn-primary" data-so="next" data-id="camp-${ch + 1}">Kapitel ${ch + 2}: ${esc(CHAPTERS[ch + 1].title)} ▶</button>` : '';
    }
    const title = def.endless ? (res.failed ? T('Abgelöst') : T('Feierabend!')) : res.failed ? T('Abgebrochen') : res.stars === 3 ? T('Perfekt!') : res.stars === 2 ? T('Sehr gut!') : res.stars === 1 ? T('Geschafft') : T('Nicht geschafft');
    this.ov.innerHTML = T`<div class="scn-box res ${res.stars ? 'win' : 'lose'}"><div class="scn-hero sm" style="background-image:url(${def.img})"><div class="scn-k">${def.icon} ${esc(def.title)}</div><h2>${title}</h2>
      <div class="scn-big">${[0, 1, 2].map((i) => `<span class="${i < res.stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.35}s">★</span>`).join('')}</div></div>
      <div class="scn-in">${story}${def.endless ? `<p class="scn-pts">⏱️ ${res.failed ? T`${hm(res.m.mins * 60)} gehalten · ${res.waves} Wellen überstanden` : T('Alle Wellen überstanden – die Schicht ist geschafft.')}${res.best && res.best.minsNew && res.best.prev ? T(' · <b>neuer Zeit-Rekord!</b>') : res.best && res.best.prev && res.best.prev.mins ? T` · Rekordzeit ${hm(res.best.prev.mins * 60)}` : ''}</p>` : ''}${res.failed ? `<p class="scn-fail">⚠️ ${esc(res.failed)}</p>` : ''}
      <table class="scn-res">${def.goals.map((g, i) => {
        const r = res.rows[i];
        return `<tr class="s${r.stars}"><td>${esc(g.text)}</td><td class="v">${goalValue(g, r.v == null ? null : Math.round(r.v))}</td><td class="st">${starStr(r.stars)}</td><td class="nx">${r.stars < 3 ? T`nächster Stern ${goalNeed(g, r.stars)}` : T('✓ Bestwert')}</td></tr>`;
      }).join('')}</table>
      ${res.pts && def.role !== 'manager' ? T`<p class="scn-pts">⭐ ${res.pts.toLocaleString(LOCALE)} Schichtpunkte${res.best && res.best.ptsNew ? T(' · <b>neuer Punkte-Rekord!</b>') : res.best && res.best.prev && res.best.prev.pts ? T` · Rekord ${res.best.prev.pts.toLocaleString(LOCALE)}` : ''}</p>` : ''}
      ${res.daily ? T`<p class="scn-pts">📅 Tagesherausforderung ${dailyLabel(def.daily)}${res.stars ? (res.daily.streak > 1 ? T` · 🔥 Serie ${res.daily.streak} Tage` : T` · 🔥 Serie ${res.daily.streak} Tag`) : T(' · für die Serie zählt mindestens ein Stern')} · morgen gibt es eine neue</p>` : ''}
      <p class="scn-note">${[res.best && res.best.isNew && res.stars ? T('🏆 <b>Neuer Bestwert!</b>') : res.best && res.best.prev ? T`Bisheriger Bestwert: ${starStr(res.best.prev.stars)}` : '', T`Gesamt ⭐ ${totalStars()} / ${SCENARIOS.length * 3}`].filter(Boolean).join(' · ')}</p>
      <div class="scn-acts"><button class="btn" data-so="menu">Hauptmenü</button><button class="btn ${res.stars ? '' : 'btn-primary'}" data-so="retry">↻ Nochmal</button>${nextBtn}</div></div></div>`;
    this.ov.classList.remove('hidden');
  }

  hide() {
    this.ov.classList.add('hidden');
    this.bar.classList.add('hidden');
    document.getElementById('game').classList.remove('scn-on');
  }
}

