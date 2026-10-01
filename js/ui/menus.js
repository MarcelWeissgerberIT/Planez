// Hauptmenü und Pausenmenü: großer Titel, nummerierte Einträge, Status-Panel, Szenen-Video im Hintergrund
import { ROLES, slotInfo, loadGame, deleteSave, freeSlot } from '../state.js';
import { esc, fmtMoney, fmtClock, dayOf } from '../util.js';
import { RANKS, goalsState, activeGoals, goalText, goalFraction } from '../sim/goals.js';
import { glossify } from './glossary.js';
import { sfx } from '../audio.js';
import { scenarioListHtml, scenarioSide } from './scenarioUi.js';
import { careerSummary, careerRank } from '../career.js';
import { SCENARIOS, totalStars } from '../sim/scenarios.js';
import { campaignProgress } from '../sim/campaign.js';

// Szenen des Hintergrund-Loops (je ~9,6 s, nahtlos ineinander übergehend)
const SCENES = ['Anflug im Morgengrauen', 'Tower zur blauen Stunde', 'Vorfeld bei Nacht', 'Frachtverladung im Regen', 'Start in den Sonnenuntergang'];
const SEG = 9.6;

// ---------- Voreinstellungen (auch ohne laufendes Spiel) ----------
const PREFS_KEY = 'planez_prefs';
const PREF_DEF = { sound: true, music: true, gameMusic: true, bigText: false, cbMode: false, calm: false, briefing: true, perf: false, ambience: true, tts: true, glossary: true, hints: true, voiceVol: 0.9 };
export function loadPrefs() {
  try {
    const p = { ...PREF_DEF, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
    // Echter Funk ist neu und standardmäßig an (einmalig auch für ältere Einstellungen)
    if (!p.voice2) {
      p.tts = true;
      p.voice2 = true;
    }
    return p;
  } catch (e) {
    return { ...PREF_DEF };
  }
}
export function savePrefs(p) {
  try {
    const old = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...old, ...p, voice2: true }));
  } catch (e) {}
}
export const PREF_ROWS = [
  ['sound', 'Sound-Effekte', 'Funk, Warnungen, Kasse'],
  ['perf', 'Leistungsmodus', 'weniger Details und Belebung, geringere Auflösung – flüssiger auf langsamen Rechnern'],
  ['ambience', 'Klangkulisse', 'Triebwerke, Wind, Regen, Donner, Vögel und Grillen'],
  ['gameMusic', 'Musik im Spiel', 'leise Klangflächen – passend zu Tageszeit, Wetter und Lage (Hochbetrieb, Notfall, Gewitter)'],
  ['tts', 'Echter Funk (Sprachausgabe)', 'Tower: Lotse und Piloten sprechen – Vorfeld: Betriebsfunk der Bodencrews auf Deutsch'],
  ['glossary', 'Abkürzungen erklären', 'Tooltips für ILS, TOBT, CTOT, RVR …'],
  ['hints', 'Tipps anzeigen', 'Hinweise zur nächsten sinnvollen Aktion'],
  ['bigText', 'Große Schrift', 'Barrierefreiheit: Seitenleiste, Info-Karte, Funk, Fenster und Meldungen größer'],
  ['cbMode', 'Farbsehschwäche-Modus', 'Barrierefreiheit: Blau/Orange statt Grün/Rot für gut/schlecht, Konflikte und Status'],
  ['calm', 'Bewegung reduzieren', 'Barrierefreiheit: keine pulsierenden Hinweise, kein Menü-Video, ruhigere Effekte'],
];
// Barrierefreiheit: Klassen am Dokument (wirken sofort, im Menü wie im Spiel)
export function applyA11y(p = loadPrefs()) {
  const r = document.documentElement.classList;
  r.toggle('a11y-big', !!p.bigText);
  r.toggle('a11y-cb', !!p.cbMode);
  r.toggle('a11y-calm', !!p.calm);
}
const switchRow = (k, name, sub, on) => `<button class="mm-toggle" data-pref="${k}" aria-pressed="${on}"><span class="l"><b>${name}</b><small>${sub}</small></span><span class="switch ${on ? 'on' : ''}"></span></button>`;

// ---------- Seitenpanel-Inhalte ----------
const ROLE_INFO = {
  tower: { img: 'assets/ui/role_tower.jpg', you: ['Anflüge vom Fix auf den Endanflug schicken', 'Lande- und Startfreigaben, Durchstarten', 'Pistenfolge mit Wirbelschleppen-Abständen', 'Slots (CTOT) einhalten, Treibstoffreserven im Blick'], auto: 'Vorfeld, Abfertigung und Management laufen automatisch.' },
  ground: { img: 'assets/ui/role_ground.jpg', you: ['Parkpositionen passend zu Typ und Größe vergeben', 'Turnaround: Fahrzeuge rechtzeitig losschicken', 'Tankwagen-Logistik und TOBT halten', 'Pünktlich zum Pushback fertig werden'], auto: 'Tower und Management laufen automatisch.' },
  manager: { img: 'assets/ui/role_manager.jpg', you: ['Airline-Verträge und Gebühren', 'Ausbau mit Baustellen, Pistenwartung', 'Kerosin einkaufen und verkaufen', 'Fuhrpark, Personal, Kredite, Nachtflugregeln'], auto: 'Tower und Vorfeld laufen automatisch.' },
  observer: { img: 'assets/ui/menu_poster.jpg', you: ['Zurücklehnen und den Betrieb beobachten', 'Jederzeit eine Station übernehmen'], auto: 'Alles läuft automatisch.' },
};

function sideRole(key) {
  const r = ROLES[key];
  const info = ROLE_INFO[key];
  return `<div class="ms-card ms-role r-${key}"><div class="ms-img" style="background-image:url(${info.img})"></div>
    <div class="ms-body"><div class="ms-h">${r.icon} ${esc(r.name)}</div>
    <div class="ms-sec">Deine Aufgaben</div><ul>${info.you.map((x) => `<li>${x}</li>`).join('')}</ul>
    <div class="ms-auto">⚙️ ${info.auto}</div></div></div>`;
}

export function statusPanel(s, title = 'Status') {
  const G = s.goals || { xp: 0, rank: 0, done: 0 };
  const t = (s.stats && s.stats.today) || {};
  const deps = (t.onTime || 0) + (t.delayed || 0);
  const tile = (k, v, cls = '') => `<div class="ms-tile ${cls}"><span>${k}</span><b>${v}</b></div>`;
  const row = (icon, v, k) => `<div class="ms-row"><i>${icon}</i><b>${v}</b><small>${k}</small></div>`;
  const rank = RANKS[G.rank || 0];
  let goals = '';
  try {
    if (s.goals) goals = activeGoals(s).map((g) => `<div class="ms-goal"><small>${esc(goalText(g))}</small><span class="ms-bar"><i style="width:${Math.round(goalFraction(s, g) * 100)}%"></i></span></div>`).join('');
  } catch (e) {}
  return `<div class="ms-card ms-status"><div class="ms-body">
    <div class="ms-h">${esc(title)}</div><div class="ms-subt">${esc(s.name)} · ${esc(ROLES[s.role]?.name || '')}</div>
    <div class="ms-tiles">${tile('Spielzeit', `Tag ${dayOf(s.time)} · ${fmtClock(s.time)}`)}${tile('Kasse', fmtMoney(s.cash), s.cash < 0 ? 'neg' : '')}${tile('Ansehen', `${Math.round(s.reputation)}/100`)}${tile('Rang', `${esc(rank.name)}<small>${G.xp || 0} XP</small>`, 'rank')}</div>
    <div class="ms-sec">Heute</div>
    <div class="ms-rows">${row('✈️', t.mov || 0, 'Bewegungen')}${row('🧳', (t.pax || 0).toLocaleString('de-DE'), 'Passagiere')}${row('⏱️', deps ? Math.round((t.onTime / deps) * 100) + ' %' : '—', 'pünktlich')}${row('🎯', t.slotOk || 0, 'Slots eingehalten')}${row('⛽', `${Math.round(t.fuelSold || 0)} t`, 'Kerosin vertankt')}${row('⚠️', t.incidents || 0, 'Vorfälle')}</div>
    ${goals ? `<div class="ms-sec">Ziele</div>${goals}` : ''}
    <div class="ms-foot">${(s.contracts || []).length} Verträge · ${(s.stands || []).filter((x) => x.built).length} Parkpositionen · ${(s.vehicles || []).length} Fahrzeuge · ${G.done || 0} Ziele erreicht</div>
  </div></div>`;
}

const SIDE = {
  new: () => `<div class="ms-card"><div class="ms-body"><div class="ms-h">Neuer Flughafen</div><div class="ms-subt">Wähle eine Station – alles andere erledigen KI-Kollegen.</div>
    <div class="ms-trio">${['tower', 'ground', 'manager'].map((k) => `<div style="background-image:url(${ROLE_INFO[k].img})"><span>${ROLES[k].icon} ${ROLES[k].short}</span></div>`).join('')}</div>
    <div class="ms-sec">Start</div><ul><li>6 Uhr morgens, erste Maschinen sind schon im Anflug</li><li>5 Mio € Startkapital, 20 Airline-Verträge</li><li>Station jederzeit im Spiel wechselbar</li><li>Schwierigkeit: <b>Entspannt</b> verzeiht Fehler, <b>Profi</b> ist knallhart</li></ul></div></div>`,
  help: () => `<div class="ms-card"><div class="ms-body"><div class="ms-h">So funktioniert es</div><ul><li>Jede Station spielt sich anders: Lotse, Abfertigung oder Management.</li><li>💡 Tipps oben im Panel zeigen die nächste sinnvolle Aktion.</li><li>Unterstrichene Abkürzungen erklären sich beim Überfahren.</li><li>🏅 Ziele bringen Prämien und heben den Flughafen-Rang.</li></ul></div></div>`,
  gloss: () => `<div class="ms-card"><div class="ms-body"><div class="ms-h">Glossar</div><div class="ms-subt">Über 100 Begriffe – ein paar Beispiele:</div><dl class="ms-dl"><dt>ILS</dt><dd>Instrumentenlandesystem</dd><dt>TOBT</dt><dd>Zielzeit „Abfertigung fertig“</dd><dt>CTOT</dt><dd>Startslot, Fenster −5/+10 min</dd><dt>RVR</dt><dd>Pistensichtweite</dd><dt>STCA</dt><dd>Konfliktwarnung im Radar</dd><dt>FL</dt><dd>Flugfläche in 100 ft</dd></dl></div></div>`,
  slots: () => `<div class="ms-card"><div class="ms-body"><div class="ms-h">Spielstände</div><div class="ms-subt">Drei Speicherplätze – jeder Flughafen speichert automatisch alle 45 Sekunden und zum Tagesende.</div><ul><li>„Weiterspielen“ lädt den zuletzt gespielten Platz</li><li>Beim neuen Spiel wählst du den Platz</li><li>Herausforderungen belegen keinen Platz</li></ul></div></div>`,
  slotEmpty: (n) => `<div class="ms-card"><div class="ms-body"><div class="ms-h">Platz ${n}</div><div class="ms-subt">Noch leer – über „Neues Spiel“ einen Flughafen auf diesem Platz gründen.</div></div></div>`,
  settings: () => `<div class="ms-card"><div class="ms-body"><div class="ms-h">Einstellungen</div><div class="ms-subt">Gelten für neue Spiele und lassen sich im Pausenmenü jederzeit ändern.</div></div></div>`,
  scnall: () => `<div class="ms-card"><div class="ms-img" style="background-image:url(assets/scn/storm.webp)"></div><div class="ms-body"><div class="ms-h">Herausforderungen</div><div class="ms-subt">${SCENARIOS.length} Szenarien · ⭐ ${totalStars()} / ${SCENARIOS.length * 3} Sterne</div>
    <ul><li>Kurze Einsätze mit festem Start: Morgenwelle, Nebel, Gewitterfront, Notfälle, Streik, Winterchaos, Sanierungsfall …</li><li>Jedes Ziel bringt 1–3 Sterne – der Bestwert bleibt gespeichert</li><li>Mit einem Stern schaltest du die nächste Stufe deiner Station frei</li></ul></div></div>`,
  whatsnew: () => `<div class="ms-card wn"><div class="ms-body"><div class="ms-h">Neu</div><div class="ms-subt">Die wichtigsten Neuerungen – Details unter „So funktioniert es“.</div>
    <div class="ms-sec">Ganz frisch</div><ul>
      <li>⏪ <b>Wiederholung</b> in Zeitlupe (<kbd>⇧R</kbd>) · 🛩️ <b>Platzrunden</b> · 🚁 <b>Rettungshubschrauber</b> · 🛩️ <b>Großer Flugtag</b></li>
      <li>💦 <b>Wassertaufe</b> für jeden Erstflug · 🛬 <b>Aufsetzrate</b> von 🧈 Butter bis hart · ✨ <b>Highlights</b> im Tagesbericht</li>
      <li>🎖️ <b>Staatsbesuch</b> mit rotem Teppich und Kolonne · 📡 <b>Livestream</b> mit Live-Chat (<kbd>L</kbd>)</li>
      <li>🎞️ <b>Kino-Look</b> mit Tilt-Shift und Regen auf der Linse · 🔍 <b>Miniatur-Fotos</b> · 🔔 <b>Terminal-Durchsagen</b></li>
      <li>🚑 <b>Rettungswagen</b> bei medizinischen Notfällen · 🦺 <b>Einwinker</b> mit Leuchtkellen · 💨 Kondensfahnen · 🛞 Reifenquietschen · 🌬️ <b>Seitenwind-Anflüge</b> mit Vorhaltewinkel · 🎙️ <b>Sprechtaste</b> auch für Heli, Cessna und Pistenkontrolle · 😊 <b>Fluggast-Zufriedenheit</b> in der Management-Zentrale · 🎤 <b>Pressekonferenz</b> · 📋 <b>Loadsheet</b> und 🌡️ <b>Hitze</b> im Vorfeld · 📻 Crews melden Ereignisse per Funk</li>
      <li>📖 <b>Kampagne</b>: 10 Kapitel mit Story · 🏛️ <b>Aufsichtsrat</b> · ⛈️ <b>Wetterumflüge</b> · 🚙 <b>Pistenkontrolle</b></li>
    </ul><div class="ms-sec">Davor</div><ul>
      <li>🎵 Musik im Spiel · ♿ Barrierefreiheit · 🎞️ Kino-Intro · 📰 Planezer Kurier · 🌐 Basis-Angebote</li>
      <li>✈️ A220, CRJ900, Dash 8-400, A330 · Lumen Air, Fjordwing · 📅 Tagesherausforderung · 🎖️ Karriere</li>
      <li>👂 Readback-Fehler · 📻✖ Funkausfall · 🏢 Nordhafen · 📒 Spotterbuch · 📋 Schichtbriefing</li>
    </ul><div class="ms-sec">Spielen</div><ul>
      <li>⭐ <b>Herausforderungen</b>: 10 Szenarien mit Sternen und Punkte-Rekorden – neu: 🛩️ Großer Flugtag</li>
      <li>⭐ <b>Schichtpunkte</b> mit Kombo für Tower und Vorfeld</li>
      <li>🎚️ <b>Schwierigkeit</b> Entspannt / Normal / Profi · 💾 <b>3 Speicherplätze</b></li>
      <li>🦺 <b>Positionsplan</b> (G) mit Drag &amp; Drop im Vorfeld</li>
      <li>🤝 <b>Verhandeln</b> bei Airline-Angeboten · 🌍 <b>Streckennetz-Karte</b></li>
      <li>🚶 <b>Sicherheitskontrolle</b> mit Schlangen · 🌦️ <b>Wettervorhersage</b> (TAF)</li>
      <li>🌪️ <b>Windscherung</b> · 🚒 <b>Feuerwehreinsatz</b> auf der Piste · 🐋 <b>A380-Besuch</b></li>
    </ul><div class="ms-sec">Sehen &amp; Hören</div><ul>
      <li>🌅 Goldene Stunde, 🍂 Jahreszeiten, 🌧️ nasser Asphalt mit Spiegelungen</li>
      <li>🐦 Vogelschwärme, 🚁 Rettungshubschrauber, 🚨 Martinshorn</li>
      <li>🎥 <b>Folgen</b>-Kamera · 🎬 Kino-Modus als Live-Übertragung · <kbd>?</kbd> Tastenkürzel</li>
      <li>🪧 <b>Anzeigetafel</b> im Fallblatt-Stil (<kbd>I</kbd>)</li>
    </ul></div></div>`,
  career: () => {
    const S = careerSummary();
    const R = careerRank();
    const c = S.c;
    const h = Math.floor(c.playSec / 3600), m = Math.floor((c.playSec % 3600) / 60);
    const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    const role = (r) => {
      const x = c.byRole[r] || { days: 0, bestScore: 0, perfect: 0, bestPunct: 0 };
      return `<tr><td>${ROLES[r].icon} ${esc(ROLES[r].short)}</td><td>${x.days}</td><td>${x.bestScore ? x.bestScore.toLocaleString('de-DE') : '—'}</td><td>${x.bestPunct ? x.bestPunct + ' %' : '—'}</td><td>${x.perfect || 0}</td></tr>`;
    };
    return `<div class="ms-card career"><div class="ms-body">
      <div class="cr-id"><div class="cr-badge">${R.cur.icon}</div><div><div class="cr-k">Dienstausweis · Planez</div><div class="cr-rank">${esc(R.cur.name)}</div><div class="cr-pts">${R.pts.toLocaleString('de-DE')} Karrierepunkte</div></div></div>
      <div class="cr-bar"><i style="width:${Math.round(R.frac * 100)}%"></i></div>
      <div class="cr-next">${R.next ? `Nächster Rang: ${R.next.icon} <b>${esc(R.next.name)}</b> ab ${R.next.pts.toLocaleString('de-DE')}` : 'Höchster Rang erreicht'}</div>
      <div class="cr-grid">${cell('Schichten (Tage)', c.days)}${cell('Spielzeit', `${h} h ${m} min`)}${cell('Bewegungen', c.mov.toLocaleString('de-DE'))}${cell('Passagiere', c.pax.toLocaleString('de-DE'))}${cell('Perfekte Tage ★★★★★', c.perfect)}${cell('Erfolge', `${c.ach.length} / ${S.achAll}`)}${cell('Kampagne', (() => { const cp = campaignProgress(); return cp.next == null ? `🏆 ${cp.total}/${cp.total}` : `📖 ${cp.done}/${cp.total} Kapitel`; })())}${cell('Herausforderungen', `⭐ ${S.stars}`)}${cell('Tagesserie', `🔥 ${S.daily.streak || 0} · Rekord ${S.daily.best || 0}`)}${cell('Spotterpunkte', S.spot.pts.toLocaleString('de-DE'))}</div>
      <div class="ms-sec">Rekorde</div>
      <div class="cr-grid">${cell('🛬 Weichste Landung', c.rec && c.rec.td ? `${c.rec.td.fpm} ft/min · ${esc(c.rec.td.cs)}` : '—')}${cell('📈 Meiste Bewegungen', c.rec && c.rec.mov ? `${c.rec.mov} an einem Tag` : '—')}${cell('📡 Zuschauerrekord', c.rec && c.rec.viewers ? c.rec.viewers.toLocaleString('de-DE') : '—')}</div>
      <div class="ms-sec">Je Station</div>
      <table class="cr-tab"><tr><th></th><th>Tage</th><th>Bestwert ⭐</th><th>Pünktl.</th><th>Perfekt</th></tr>${['tower', 'ground', 'manager', 'observer'].map(role).join('')}</table>
      <div class="ms-auto">Punkte gibt es für gespielte Tage, Verkehr, Sterne, Erfolge, Tagesherausforderungen, perfekte Tage und das Spotterbuch.</div></div></div>`;
  },
  about: () => `<div class="ms-card"><div class="ms-body"><div class="ms-h">Über Planez</div><ul><li>Airport-Simulation mit isometrischer Karte, Radar und Wirtschaft</li><li>Grafiken, Porträts und Hintergrundvideos: Higgsfield AI (GPT Image, Kling)</li><li>Alle Airlines, Rufzeichen und Flüge sind fiktiv</li><li>Reines HTML/JavaScript – läuft direkt im Browser</li></ul></div></div>`,
};

// ---------- Speicherplätze ----------
const fmtSaved = (t) => {
  if (!t) return '';
  const d = new Date(t);
  const today = new Date();
  const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `heute ${hm}` : `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${hm}`;
};
function slotListHtml() {
  return `<button class="mm-back" data-mm="back">← Zurück</button>` + slotInfo().map((x) => x.empty
    ? `<button class="mm-item slot-item locked" data-slot-load="${x.n}" data-side="slot:${x.n}"><span class="n"></span><span class="l"><b>Platz ${x.n} · leer</b><small>Über „Neues Spiel“ belegen</small></span></button>`
    : `<div class="slot-row"><button class="mm-item slot-item" data-slot-load="${x.n}" data-side="slot:${x.n}"><span class="n"></span><span class="l"><b>${esc(x.name)}</b><small>Platz ${x.n} · Tag ${dayOf(x.time)} · ${fmtClock(x.time)} · ${esc(ROLES[x.role]?.short || '')} · ${fmtMoney(x.cash)}${x.saved ? ` · gespeichert ${fmtSaved(x.saved)}` : ''}${x.last ? ' · zuletzt gespielt' : ''}</small></span></button><button class="mini slot-del" data-slot-del="${x.n}" title="Spielstand löschen">🗑</button></div>`).join('');
}
function renderSlotSelect(root) {
  const sel = root.querySelector('#inp-slot');
  if (!sel) return;
  const info = slotInfo();
  const pick = freeSlot();
  sel.innerHTML = info.map((x) => `<option value="${x.n}" ${x.n === pick ? 'selected' : ''}>Platz ${x.n} – ${x.empty ? 'frei' : `überschreibt „${esc(x.name)}“ (Tag ${dayOf(x.time)})`}</option>`).join('');
}
function refreshContinue() {
  if (!mm) return;
  const any = slotInfo().some((x) => !x.empty);
  mm.save = any ? loadGame() : null;
  const box = mm.root.querySelector('#continue-box');
  box.classList.toggle('hidden', !mm.save);
  if (mm.save) mm.root.querySelector('#continue-info').textContent = `${mm.save.name} · Tag ${dayOf(mm.save.time)} · ${fmtClock(mm.save.time)} · ${ROLES[mm.save.role]?.name || ''}`;
}

// ---------- Tastatur-/Maus-Navigation einer Liste ----------
function renumber(list) {
  let n = 0;
  for (const b of list.querySelectorAll('.mm-item')) {
    if (b.offsetParent === null) continue;
    n++;
    const el = b.querySelector('.n');
    if (el) el.textContent = String(n).padStart(2, '0');
  }
}
function setActive(list, btn) {
  if (btn && btn.classList.contains('on')) return;
  for (const b of list.querySelectorAll('.mm-item.on, .mm-toggle.on')) b.classList.remove('on');
  if (btn) {
    btn.classList.add('on');
    if (loadPrefs().sound !== false) sfx.hover();
  }
}
// Auswahlklang für alle Menüknöpfe
document.addEventListener('click', (e) => {
  if (e.target.closest('.mm-item, .mm-toggle, .mm-back, [data-so], [data-ru]') && loadPrefs().sound !== false) sfx.select();
}, true);
function moveActive(list, d) {
  const items = [...list.querySelectorAll('.mm-item, .mm-toggle')].filter((b) => b.offsetParent !== null);
  if (!items.length) return null;
  let i = items.findIndex((b) => b.classList.contains('on'));
  i = (i + d + items.length) % items.length;
  for (const b of items) b.classList.remove('on');
  items[i].classList.add('on');
  items[i].focus({ preventScroll: false });
  return items[i];
}

// ---------- Hauptmenü ----------
let mm = null;
export function initMainMenu(api) {
  const root = document.getElementById('menu');
  const lists = { main: root.querySelector('#mm-main'), new: root.querySelector('#mm-new'), scn: root.querySelector('#mm-scn'), slots: root.querySelector('#mm-slots'), settings: root.querySelector('#mm-settings') };
  const side = root.querySelector('#mm-side');
  const scene = root.querySelector('#mm-scene');
  const video = root.querySelector('#menu-video');
  mm = { root, lists, side, cur: 'main', save: null, api };

  const showSide = (key) => {
    let html = '';
    if (key === 'save' && mm.save) html = statusPanel(mm.save, 'Letzter Spielstand');
    else if (key.startsWith('scn:')) html = scenarioSide(key.slice(4));
    else if (key.startsWith('slot:')) {
      const n = Number(key.slice(5));
      mm.slotCache = mm.slotCache || {};
      if (!(n in mm.slotCache)) mm.slotCache[n] = loadGame(n);
      html = mm.slotCache[n] ? statusPanel(mm.slotCache[n], `Speicherplatz ${n}`) : SIDE.slotEmpty(n);
    }
    else if (ROLE_INFO[key]) html = sideRole(key);
    else if (SIDE[key]) html = SIDE[key]();
    else html = mm.save ? statusPanel(mm.save, 'Letzter Spielstand') : SIDE.new();
    if (side._html !== html) {
      side.innerHTML = html;
      side._html = html;
      side.classList.remove('in');
      void side.offsetWidth;
      side.classList.add('in');
      glossify(side);
    }
  };
  mm.showSide = showSide;

  const openList = (key) => {
    for (const [k, el] of Object.entries(lists)) el.classList.toggle('hidden', k !== key);
    mm.cur = key;
    root.classList.toggle('scn-open', key === 'scn');
    if (key === 'settings') renderPrefs();
    if (key === 'scn') lists.scn.innerHTML = scenarioListHtml();
    if (key === 'slots') {
      mm.slotCache = {};
      mm.delArm = null;
      lists.slots.innerHTML = slotListHtml();
    }
    if (key === 'new') renderSlotSelect(root);
    renumber(lists[key]);
    const first = lists[key].querySelector('.mm-item, .mm-toggle');
    setActive(lists[key], first);
    const f = (key === 'scn' || key === 'slots') && lists[key].querySelector('.mm-item:not(.locked)');
    if (f) setActive(lists[key], f);
    showSide(key === 'new' ? 'new' : key === 'settings' ? 'settings' : f ? f.dataset.side : mm.save ? 'save' : 'new');
  };
  mm.openList = openList;

  const renderPrefs = () => {
    const p = loadPrefs();
    root.querySelector('#mm-prefs').innerHTML = [...PREF_ROWS.slice(0, 1), ['music', 'Menümusik', 'ruhige Klangflächen im Hauptmenü'], ...PREF_ROWS.slice(1), ['briefing', 'Schichtbriefing', 'zu Tagesbeginn: Wetter, Verkehrsspitzen, Lage und Ziele der Schicht']].map(([k, n, sub]) => switchRow(k, n, sub, !!p[k])).join('');
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mm]');
    if (t) {
      const a = t.dataset.mm;
      if (a === 'new') openList('new');
      else if (a === 'scn') openList('scn');
      else if (a === 'slots') openList('slots');
      else if (a === 'settings') openList('settings');
      else if (a === 'back') openList('main');
      else if (a === 'gloss') api.gloss();
      else if (a === 'about') showSide('about');
      else if (a === 'whatsnew') showSide('whatsnew');
      else if (a === 'career') showSide('career');
      return;
    }
    const del = e.target.closest('[data-slot-del]');
    if (del) {
      const n = Number(del.dataset.slotDel);
      if (mm.delArm === n) {
        deleteSave(n);
        mm.delArm = null;
        mm.slotCache = {};
        lists.slots.innerHTML = slotListHtml();
        renumber(lists.slots);
        showSide(`slot:${n}`);
        refreshContinue();
      } else {
        mm.delArm = n;
        del.textContent = 'Wirklich löschen?';
        del.classList.add('armed');
      }
      return;
    }
    const sl = e.target.closest('[data-slot-load]');
    if (sl) {
      if (!sl.classList.contains('locked')) api.loadSlot && api.loadSlot(Number(sl.dataset.slotLoad));
      return;
    }
    const sc = e.target.closest('[data-scn]');
    if (sc) {
      if (sc.classList.contains('locked')) {
        sc.classList.remove('shake');
        void sc.offsetWidth;
        sc.classList.add('shake');
      } else api.scenario && api.scenario(sc.dataset.scn);
      return;
    }
    const pr = e.target.closest('[data-pref]');
    if (pr) {
      const p = loadPrefs();
      p[pr.dataset.pref] = !p[pr.dataset.pref];
      savePrefs(p);
      renderPrefs();
      applyA11y(p);
      api.prefsChanged && api.prefsChanged(p);
    }
  });
  root.addEventListener('mouseover', (e) => {
    const b = e.target.closest('.mm-item');
    if (!b) return;
    setActive(lists[mm.cur], b);
    if (b.dataset.side) showSide(b.dataset.side);
  });
  root.addEventListener('focusin', (e) => {
    const b = e.target.closest('.mm-item');
    if (b && b.dataset.side) showSide(b.dataset.side);
  });
  window.addEventListener('keydown', (e) => {
    if (root.classList.contains('hidden') || document.getElementById('modal').classList.contains('hidden') === false) return;
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const list = lists[mm.cur];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const b = moveActive(list, e.key === 'ArrowDown' ? 1 : -1);
      if (b && b.dataset.side) showSide(b.dataset.side);
    } else if (e.key === 'Enter') {
      const b = list.querySelector('.mm-item.on, .mm-toggle.on');
      if (b && document.activeElement !== b) {
        e.preventDefault();
        b.click();
      }
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      if (mm.cur !== 'main') {
        e.preventDefault();
        openList('main');
      }
    }
  });

  // Hintergrundvideo: kleinere Datei auf schmalen Bildschirmen; Szenenname unten rechts
  const small = window.matchMedia('(max-width: 900px)').matches ? '_sm' : '';
  const webm = video.canPlayType('video/webm; codecs="vp9"');
  const mp4 = video.canPlayType('video/mp4; codecs="avc1.640028"');
  video.src = `assets/ui/menu_loop${small}.${webm && (webm === 'probably' || !mp4) ? 'webm' : 'mp4'}`;
  scene.querySelector('.dots').innerHTML = SCENES.map(() => '<i></i>').join('');
  let lastSeg = -1;
  video.addEventListener('timeupdate', () => {
    const seg = Math.min(SCENES.length - 1, Math.floor(video.currentTime / SEG));
    if (seg === lastSeg) return;
    lastSeg = seg;
    scene.querySelector('b').textContent = SCENES[seg];
    scene.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i === seg));
    scene.classList.remove('in');
    void scene.offsetWidth;
    scene.classList.add('in');
  });
  scene.querySelector('b').textContent = SCENES[0];
}

// beim Öffnen des Hauptmenüs: Spielstand-Infos, Nummern, Seitenpanel
export function refreshMainMenu(save) {
  if (!mm) return;
  mm.save = save;
  const box = mm.root.querySelector('#continue-box');
  box.classList.toggle('hidden', !save);
  if (save) mm.root.querySelector('#continue-info').textContent = `${save.name} · Tag ${dayOf(save.time)} · ${fmtClock(save.time)} · ${ROLES[save.role]?.name || ''}`;
  mm.openList('main');
  const v = mm.root.querySelector('#menu-video');
  try {
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}

// ---------- Pausenmenü ----------
let pz = null;
export function pauseOpen() {
  return !!(pz && !pz.el.classList.contains('hidden'));
}
export function showPauseMenu(game, api) {
  const s = game.state;
  if (!pz) {
    const el = document.createElement('div');
    el.id = 'pause';
    el.className = 'hidden';
    document.getElementById('game').appendChild(el);
    pz = { el };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pm]');
      const pr = e.target.closest('[data-pref]');
      if (pr) {
        const k = pr.dataset.pref;
        pz.api.toggle(k);
        renderPause();
        return;
      }
      if (!b) return;
      const a = b.dataset.pm;
      if (a === 'settings') {
        pz.showSettings = !pz.showSettings;
        renderPause();
        return;
      }
      if (a === 'save') {
        pz.api.save();
        b.querySelector('small').textContent = `Gespeichert um ${fmtClock(pz.game.state.time)} ✓`;
        return;
      }
      closePause();
      if (a !== 'resume' && pz.api[a]) pz.api[a]();
    });
    el.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.mm-item, .mm-toggle');
      if (b) setActive(el.querySelector('.mm-list'), b);
    });
    window.addEventListener('keydown', (e) => {
      if (!pauseOpen()) return;
      const list = pz.el.querySelector('.mm-list');
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closePause();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveActive(list, e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        const b = list.querySelector('.mm-item.on, .mm-toggle.on');
        if (b && document.activeElement !== b) {
          e.preventDefault();
          b.click();
        }
      }
      e.stopImmediatePropagation();
    }, true);
  }
  pz.game = game;
  pz.api = api;
  pz.prevSpeed = s.speed;
  pz.showSettings = false;
  s.speed = 0;
  pz.el.classList.remove('hidden');
  renderPause();
  const first = pz.el.querySelector('.mm-item');
  setActive(pz.el.querySelector('.mm-list'), first);
  if (first) first.focus({ preventScroll: true });
}

function renderPause() {
  const s = pz.game.state;
  const set = pz.api.settings();
  const item = (a, title, sub = '', cls = '') => `<button class="mm-item ${cls}" data-pm="${a}"><span class="n"></span><span class="l"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  const prefs = pz.showSettings ? `<div class="pm-prefs">${[...PREF_ROWS, ['labels', 'Beschriftungen auf der Karte', 'Rufzeichen und Status an Flugzeugen']].map(([k, n, sub]) => switchRow(k, n, sub, !!set[k])).join('')}</div>` : '';
  pz.el.innerHTML = `<div class="pm-shade"></div><i class="mm-corner tl"></i><i class="mm-corner bl"></i>
    <div class="mm-left pm-left">
      <div class="pm-paused"><i></i><i></i>Pausiert</div>
      <h1 class="mm-title sm"><span class="t1">PLANEZ</span><span class="t2">AIRPORT</span></h1>
      <div class="mm-tag"><span>${esc(s.name.toUpperCase())} · TAG ${dayOf(s.time)}</span><i></i></div>
      <nav class="mm-list">
        ${item('resume', 'Weiter', 'Der Flughafen läuft da weiter, wo er stand.')}
        ${s.scenario ? '' : item('save', 'Jetzt speichern', `Platz ${s.slot || 1} · automatisch alle 45 Sekunden und zum Tagesende`)}
        ${item('settings', 'Einstellungen', pz.showSettings ? '' : 'Sound, Sprachausgabe, Tooltips, Tipps')}
        ${prefs}
        ${item('role', 'Station wechseln', `aktuell: ${esc(ROLES[s.role].name)}`)}
        ${item('goals', 'Ziele & Rang')}
        ${item('tutorial', 'Einführung starten', 'Schritt für Schritt durch deine Station')}
        ${item('help', 'So funktioniert es')}
        ${item('gloss', 'Glossar')}
        ${item('quit', 'Zurück ins Hauptmenü', '', 'gold')}
      </nav>
      <div class="mm-foot"><span class="mm-credit">Esc = weiter · ↑↓ + Enter zum Auswählen</span></div>
    </div>
    <aside class="mm-side pm-side in">${statusPanel(s, 'Status')}</aside>`;
  renumber(pz.el.querySelector('.mm-list'));
  glossify(pz.el.querySelector('.pm-side'));
}

export function closePause() {
  if (!pz) return;
  pz.el.classList.add('hidden');
  if (pz.game && pz.game.state) pz.game.state.speed = pz.prevSpeed || 1;
}
