// Hauptmenü und Pausenmenü: großer Titel, nummerierte Einträge, Status-Panel, Szenen-Video im Hintergrund
import { VERSION } from '../version.js';
import { IS_DEMO, DESKTOP } from '../edition.js';
import { ROLES, slotInfo, loadGame, deleteSave, freeSlot, exportSave, importSave } from '../state.js';
import { toast } from './dom.js';
import { esc, fmtMoney, fmtClock, dayOf } from '../util.js';
import { RANKS, goalsState, activeGoals, goalText, goalFraction, rankName } from '../sim/goals.js';
import { glossify } from './glossary.js';
import { sfx } from '../audio.js';
import { scenarioListHtml, scenarioSide } from './scenarioUi.js';
import { careerSummary, careerRank } from '../career.js';
import { SCENARIOS, totalStars } from '../sim/scenarios.js';
import { campaignProgress } from '../sim/campaign.js';
import { T, LOCALE, LANG, setLang } from '../i18n.js';

// Szenen des Hintergrund-Loops (je ~9,6 s, nahtlos ineinander übergehend)
const SCENES = [T('Anflug im Morgengrauen'), T('Tower zur blauen Stunde'), T('Vorfeld bei Nacht'), T('Frachtverladung im Regen'), T('Start in den Sonnenuntergang')];
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
  ['sound', T('Sound-Effekte'), T('Funk, Warnungen, Kasse')],
  ['perf', T('Leistungsmodus'), T('weniger Details und Belebung, geringere Auflösung – flüssiger auf langsamen Rechnern')],
  ['ambience', T('Klangkulisse'), T('Triebwerke, Wind, Regen, Donner, Vögel und Grillen')],
  ['gameMusic', T('Musik im Spiel'), T('Musikstücke für Tag und Nacht, bei Notfall, Gewitter und Schnee passende Klangflächen')],
  ['tts', T('Echter Funk (Sprachausgabe)'), T('Tower: Lotse und Piloten sprechen – Vorfeld: Betriebsfunk der Bodencrews auf Deutsch')],
  ['glossary', T('Abkürzungen erklären'), T('Tooltips für ILS, TOBT, CTOT, RVR …')],
  ['hints', T('Tipps anzeigen'), T('Hinweise zur nächsten sinnvollen Aktion')],
  ['bigText', T('Große Schrift'), T('Barrierefreiheit: Seitenleiste, Info-Karte, Funk, Fenster und Meldungen größer')],
  ['cbMode', T('Farbsehschwäche-Modus'), T('Barrierefreiheit: Blau/Orange statt Grün/Rot für gut/schlecht, Konflikte und Status')],
  ['calm', T('Bewegung reduzieren'), T('Barrierefreiheit: keine pulsierenden Hinweise, kein Menü-Video, ruhigere Effekte')],
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
  tower: { img: 'assets/ui/role_tower.jpg', you: [T('Anflüge vom Fix auf den Endanflug schicken'), T('Lande- und Startfreigaben, Durchstarten'), T('Pistenfolge mit Wirbelschleppen-Abständen'), T('Slots (CTOT) einhalten, Treibstoffreserven im Blick')], auto: T('Vorfeld, Abfertigung und Management laufen automatisch.') },
  ground: { img: 'assets/ui/role_ground.jpg', you: [T('Parkpositionen passend zu Typ und Größe vergeben'), T('Turnaround: Fahrzeuge rechtzeitig losschicken'), T('Tankwagen-Logistik und TOBT halten'), T('Pünktlich zum Pushback fertig werden')], auto: T('Tower und Management laufen automatisch.') },
  manager: { img: 'assets/ui/role_manager.jpg', you: [T('Airline-Verträge und Gebühren'), T('Ausbau mit Baustellen, Pistenwartung'), T('Kerosin einkaufen und verkaufen'), T('Fuhrpark, Personal, Kredite, Nachtflugregeln')], auto: T('Tower und Vorfeld laufen automatisch.') },
  observer: { img: 'assets/ui/menu_poster.jpg', you: [T('Zurücklehnen und den Betrieb beobachten'), T('Jederzeit eine Station übernehmen')], auto: T('Alles läuft automatisch.') },
};

function sideRole(key) {
  const r = ROLES[key];
  const info = ROLE_INFO[key];
  return T`<div class="ms-card ms-role r-${key}"><div class="ms-img" style="background-image:url(${info.img})"></div>
    <div class="ms-body"><div class="ms-h">${r.icon} ${esc(r.name)}</div>
    <div class="ms-sec">Deine Aufgaben</div><ul>${info.you.map((x) => `<li>${x}</li>`).join('')}</ul>
    <div class="ms-auto">⚙️ ${info.auto}</div></div></div>`;
}

export function statusPanel(s, title = T('Status')) {
  const G = s.goals || { xp: 0, rank: 0, done: 0 };
  const t = (s.stats && s.stats.today) || {};
  const deps = (t.onTime || 0) + (t.delayed || 0);
  const tile = (k, v, cls = '') => `<div class="ms-tile ${cls}"><span>${k}</span><b>${v}</b></div>`;
  const row = (icon, v, k) => `<div class="ms-row"><i>${icon}</i><b>${v}</b><small>${k}</small></div>`;
  // Aufbau-Modus: Rang nach der Person (Neu am Platz …), sonst nach dem Flughafen
  const rank = { ...RANKS[G.rank || 0], name: rankName(s, G.rank || 0) };
  let goals = '';
  try {
    if (s.goals) goals = activeGoals(s).map((g) => `<div class="ms-goal"><small>${esc(goalText(g))}</small><span class="ms-bar"><i style="width:${Math.round(goalFraction(s, g) * 100)}%"></i></span></div>`).join('');
  } catch (e) {}
  return T`<div class="ms-card ms-status"><div class="ms-body">
    <div class="ms-h">${esc(title)}</div><div class="ms-subt">${esc(s.name)} · ${esc(ROLES[s.role]?.name || '')}</div>
    <div class="ms-tiles">${tile(T('Spielzeit'), T`Tag ${dayOf(s.time)} · ${fmtClock(s.time)}`)}${tile(T('Kasse'), fmtMoney(s.cash), s.cash < 0 ? 'neg' : '')}${tile(T('Ansehen'), `${Math.round(s.reputation)}/100`)}${tile(T('Rang'), `${esc(rank.name)}<small>${G.xp || 0} XP</small>`, 'rank')}</div>
    <div class="ms-sec">Heute</div>
    <div class="ms-rows">${row('✈️', t.mov || 0, T('Bewegungen'))}${row('🧳', (t.pax || 0).toLocaleString(LOCALE), T('Passagiere'))}${row('⏱️', deps ? Math.round((t.onTime / deps) * 100) + ' %' : '—', T('pünktlich'))}${row('🎯', t.slotOk || 0, T('Slots eingehalten'))}${row('⛽', `${Math.round(t.fuelSold || 0)} t`, T('Kerosin vertankt'))}${row('⚠️', t.incidents || 0, T('Vorfälle'))}</div>
    ${goals ? T`<div class="ms-sec">Ziele</div>${goals}` : ''}
    <div class="ms-foot">${(s.contracts || []).length} Verträge · ${(s.stands || []).filter((x) => x.built).length} Parkpositionen · ${(s.vehicles || []).length} Fahrzeuge · ${G.done || 0} Ziele erreicht</div>
  </div></div>`;
}

const SIDE = {
  new: () => T`<div class="ms-card"><div class="ms-body"><div class="ms-h">Neuer Flughafen</div><div class="ms-subt">Wähle eine Station – alles andere erledigen KI-Kollegen.</div>
    <div class="ms-trio">${['tower', 'ground', 'manager'].map((k) => `<div style="background-image:url(${ROLE_INFO[k].img})"><span>${ROLES[k].icon} ${ROLES[k].short}</span></div>`).join('')}</div>
    <div class="ms-sec">Start</div><ul><li>6 Uhr morgens, erste Maschinen sind schon im Anflug</li><li>5 Mio € Startkapital, 20 Airline-Verträge</li><li>Station jederzeit im Spiel wechselbar</li><li>Schwierigkeit: <b>Entspannt</b> verzeiht Fehler, <b>Profi</b> ist knallhart</li></ul></div></div>`,
  help: () => T`<div class="ms-card"><div class="ms-body"><div class="ms-h">So funktioniert es</div><ul><li>Jede Station spielt sich anders: Lotse, Abfertigung oder Management.</li><li>💡 Tipps oben im Panel zeigen die nächste sinnvolle Aktion.</li><li>Unterstrichene Abkürzungen erklären sich beim Überfahren.</li><li>🏅 Ziele bringen Prämien und heben den Flughafen-Rang.</li></ul></div></div>`,
  gloss: () => T`<div class="ms-card"><div class="ms-body"><div class="ms-h">Glossar</div><div class="ms-subt">Über 100 Begriffe – ein paar Beispiele:</div><dl class="ms-dl"><dt>ILS</dt><dd>Instrumentenlandesystem</dd><dt>TOBT</dt><dd>Zielzeit „Abfertigung fertig“</dd><dt>CTOT</dt><dd>Startslot, Fenster −5/+10 min</dd><dt>RVR</dt><dd>Pistensichtweite</dd><dt>STCA</dt><dd>Konfliktwarnung im Radar</dd><dt>FL</dt><dd>Flugfläche in 100 ft</dd></dl></div></div>`,
  slots: () => T`<div class="ms-card"><div class="ms-body"><div class="ms-h">Spielstände</div><div class="ms-subt">Drei Speicherplätze – jeder Flughafen speichert automatisch alle 45 Sekunden und zum Tagesende.</div><ul><li>„Weiterspielen“ lädt den zuletzt gespielten Platz</li><li>Beim neuen Spiel wählst du den Platz</li><li>Herausforderungen belegen keinen Platz</li></ul></div></div>`,
  slotEmpty: (n) => T`<div class="ms-card"><div class="ms-body"><div class="ms-h">Platz ${n}</div><div class="ms-subt">Noch leer – über „Neues Spiel“ einen Flughafen auf diesem Platz gründen.</div></div></div>`,
  settings: () => T`<div class="ms-card"><div class="ms-body"><div class="ms-h">Einstellungen</div><div class="ms-subt">Gelten für neue Spiele und lassen sich im Pausenmenü jederzeit ändern.</div></div></div>`,
  scnall: () => T`<div class="ms-card"><div class="ms-img" style="background-image:url(assets/scn/storm.webp)"></div><div class="ms-body"><div class="ms-h">Herausforderungen</div><div class="ms-subt">${SCENARIOS.length} Szenarien · ⭐ ${totalStars()} / ${SCENARIOS.length * 3} Sterne</div>
    <ul><li>Kurze Einsätze mit festem Start: Morgenwelle, Nebel, Gewitterfront, Notfälle, Streik, Winterchaos, Sanierungsfall …</li><li>Jedes Ziel bringt 1–3 Sterne – der Bestwert bleibt gespeichert</li><li>Mit einem Stern schaltest du die nächste Stufe deiner Station frei</li></ul></div></div>`,
  whatsnew: () => T`<div class="ms-card wn"><div class="ms-body"><div class="ms-h">Neu</div><div class="ms-subt">Die wichtigsten Neuerungen – Details unter „So funktioniert es“.</div>
    <div class="ms-sec">Ganz frisch</div><ul>
      <li>🌾 <b>Aufbau-Modus: vom Grasplatz zum Drehkreuz</b> – neues Spiel mit 560-m-Graspiste, Vereinsheim, ein paar Sportfliegern und 40.000 € in der Kasse. Partner (Flugschule, Rundflüge, Fallschirmclub, Lufttaxi), Flugplatzfest, Anzeigen und Fly-Ins machen den Platz bekannt; erfüllst du die Bedingungen, bauen Land und Investoren aus: Verkehrslandeplatz → Regionalflughafen → International → Drehkreuz</li>
      <li>🎟️ <b>Demo-Version</b> zum Anspielen (Aufbau bis Verkehrslandeplatz, freies Spiel 3 Tage, zwei Herausforderungen) und Build-Skript für Vollversion und Demo</li>
      <li>✈️ <b>Eigene Flugzeugwelt</b>: alle Hersteller und Typen sind jetzt frei erfunden – Aviora AV-32 bis zum Superjumbo AV-38, Halvard H-38 bis H-48F, Ventis VT-70, Borealis BR-40, Alcedo AL-4 und mehr – mit eigenen Typkürzeln auf Karte, Radar und Streifen</li>
      <li>🔒 <b>Datenschutz & offline</b>: Schriften sind jetzt lokal eingebunden – keine Verbindung zu Google Fonts mehr; Versionsnummer und Lizenzhinweise unter „Über das Spiel“; Esc schließt Fenster auch aus dem Suchfeld</li>
      <li>🔴 <b>Live am Platz</b> im Leitstand: Fotokarte zum aktuellen Verkehr (nächste Landung mit Countdown, Abfertigung mit Fortschritt, Start – weich überblendet, anklickbar), Mini-Radar „Luftlage“ mit umlaufendem Strahl und Spuren, Kennzahlen mit Verlaufslinie, Aufgaben und Baustellen mit Bildern</li>
      <li>🌾 <b>Zentrale passend zum Platz</b>: am Grasplatz Abstellwiese statt Fluggastbrücken, Graspflege statt Gummiabrieb, Platzwart statt Fuhrpark, Kredite in passender Größe; Gesperrtes zeigt, ab welcher Stufe es kommt – mit neuen Bildern</li>
      <li>🚛 <b>Detaillierte 3D-Fahrzeuge</b>: Schlepper, Gepäckzug mit Containern, Tankwagen, Catering-Hubwagen (fährt zur Tür hoch), Vorfeldbus, Enteiser mit schwenkbarem Korbarm, dazu Feuerwehr, Räumdienst und Follow-me in 3D</li>
      <li>🛬 <b>Flüssigerer Verkehr am kleinen Platz</b>: „Landung hinter rollendem Verkehr“, kürzere Staffelung zwischen Sportfliegern, wer lange wartet, kommt zuerst – und ein Fehler behoben, bei dem nach einem Pistenwechsel keine Starts mehr freigegeben wurden</li>
      <li>🌻 <b>Schöneres Umland</b>: Felder im Flickenteppich (je Jahreszeit Raps, Weizen, Mais, Acker) mit Furchen und Hecken, ein Dorf mit Kirche, Bauernhöfe, ein Teich und Laubbäume – auf der Karte und in 3D, dazu Hügelketten am Horizont und eine ruhigere Kleinstadt</li>
      <li>🖼️ <b>Leitstand mit Bildern</b>: bewegtes Luftbild der Ausbaustufe, nächste Stufe mit Bedingungen, Aktionen und Partner als Bildkarten – und die neue Seite „Aufbau“ in der Management-Zentrale</li>
      <li>🛩️ <b>Sportflugzeuge</b> (Alcedo AL-4, Pember PB-3, Merle ME-4) und Lufttaxis (Alpenwerk AW-10, Regent RG-26) – mit eigenen Grafiken, 3D-Modellen und Kennzeichen-Funk („Delta Lima Mike“)</li>
      <li>🤖 <b>KI-Pilot</b> für Tower, Vorfeld und Management: zusehen, was sie tut – und jederzeit selbst eingreifen (Taste Z)</li>
      <li>⛈️ <b>Gewittertürme in 3D</b>: die Zellen der Wettersimulation ziehen sichtbar heran, mit Blitzen und Donner</li>
      <li>✨ <b>Neue Oberfläche im Spiel</b>: aufgeräumte Kopfleiste, einheitliche Glas-Panels, Kartensteuerung als Dock, Meldungen ohne Überlappung, übersichtlichere Info-Karte</li>
      <li>🗼 <b>Turmblick 3D</b>: echte Sicht aus der Tower-Kanzel mit Fernglas, Rufzeichen-Schildern und Verfolgen – Funk, Radar und Streifen bleiben bedienbar · 🎬 <b>Kino 3D</b> mit automatischen Kamerafahrten · 🚁 <b>Drohne</b> zum freien Fliegen · 🛩️ <b>Rundflug</b> in der Alcedo oder Rettungshubschrauber · 📷 <b>Fotos in 3D</b> fürs Spotterbuch · 🦺 <b>Einwink-Minispiel</b></li>
      <li>✈️ <b>3D in neuer Qualität</b>: detaillierte Flugzeuge mit Airline-Lackierung, Schatten, Himmel mit Sonnenstand und Sternen, Pisten- und Anflugbefeuerung mit <b>PAPI</b>, Landelichter, Regen, Schnee, Gewitterblitze, Reifenrauch</li>
      <li>🎵 <b>Neue Musik</b>: Menü-Thema sowie Tag- und Nachtmusik als echte Musikstücke, nahtlos geloopt und weich überblendet</li>
      <li>🧊 <b>Mitfliegen in echtem 3D</b> (WebGL): Cockpit, Fenster oder Außenkamera, frei drehbar – mit Instrumenten und Höhenansagen</li>
      <li>🛡️ <b>Sicherheitsnetz</b> gegen gefährliche Freigaben · 🎙️ natürlichere <b>englische Funkstimmen</b> mit Akzent je Airline</li>
      <li>🎨 <b>Eigene Icons</b> im Spiel-Look · 🦺 <b>Einwinker</b>, Andockanzeige, Wing Walker · 🚑 <b>Rettungswagen</b></li>
      <li>🌌 <b>Lichtspuren</b> im Fotomodus · 📸 <b>Spotterhügel</b> · 🔎 <b>Spotter-Quiz</b> · 🎈 <b>Tag der offenen Tür</b></li>
      <li>🌬️ <b>Seitenwind-Anflüge</b> · 💨 Kondensfahnen · 🌈 Regenbogen · 🛞 Reifenquietschen · 😊 <b>Fluggast-Zufriedenheit</b></li>
    </ul><div class="ms-sec">Davor</div><ul>
      <li>🎙️ <b>Sprechtaste</b> auch für Heli, Alcedo und Pistenkontrolle · 🎤 <b>Pressekonferenz</b> · 📋 <b>Loadsheet</b> und 🌡️ <b>Hitze</b> im Vorfeld · 📻 Crews melden Ereignisse per Funk</li>
      <li>⏪ <b>Wiederholung</b> in Zeitlupe (<kbd>⇧R</kbd>) · 🛩️ <b>Platzrunden</b> · 🚁 <b>Rettungshubschrauber</b> · 🛩️ <b>Großer Flugtag</b></li>
      <li>💦 <b>Wassertaufe</b> für jeden Erstflug · 🛬 <b>Aufsetzrate</b> von 🧈 Butter bis hart · ✨ <b>Highlights</b> im Tagesbericht</li>
      <li>🎖️ <b>Staatsbesuch</b> mit rotem Teppich und Kolonne · 📡 <b>Livestream</b> mit Live-Chat (<kbd>L</kbd>)</li>
      <li>🎞️ <b>Kino-Look</b> mit Tilt-Shift und Regen auf der Linse · 🔍 <b>Miniatur-Fotos</b> · 🔔 <b>Terminal-Durchsagen</b></li>
      <li>📖 <b>Kampagne</b>: 10 Kapitel mit Story · 🏛️ <b>Aufsichtsrat</b> · ⛈️ <b>Wetterumflüge</b> · 🚙 <b>Pistenkontrolle</b></li>
      <li>🎵 Musik im Spiel · ♿ Barrierefreiheit · 🎞️ Kino-Intro · 📰 Planezer Kurier · 🌐 Basis-Angebote</li>
      <li>✈️ AV-23, KR-90, BR-40, AV-33 · Lumen Air, Fjordwing · 📅 Tagesherausforderung · 🎖️ Karriere</li>
      <li>👂 Readback-Fehler · 📻✖ Funkausfall · 🏢 Nordhafen · 📒 Spotterbuch · 📋 Schichtbriefing</li>
    </ul><div class="ms-sec">Spielen</div><ul>
      <li>⭐ <b>Herausforderungen</b>: 10 Szenarien mit Sternen und Punkte-Rekorden – neu: 🛩️ Großer Flugtag</li>
      <li>⭐ <b>Schichtpunkte</b> mit Kombo für Tower und Vorfeld</li>
      <li>🎚️ <b>Schwierigkeit</b> Entspannt / Normal / Profi · 💾 <b>3 Speicherplätze</b></li>
      <li>🦺 <b>Positionsplan</b> (G) mit Drag &amp; Drop im Vorfeld</li>
      <li>🤝 <b>Verhandeln</b> bei Airline-Angeboten · 🌍 <b>Streckennetz-Karte</b></li>
      <li>🚶 <b>Sicherheitskontrolle</b> mit Schlangen · 🌦️ <b>Wettervorhersage</b> (TAF)</li>
      <li>🌪️ <b>Windscherung</b> · 🚒 <b>Feuerwehreinsatz</b> auf der Piste · 🐋 <b>AV-38-Besuch</b></li>
    </ul><div class="ms-sec">Sehen &amp; Hören</div><ul>
      <li>🌅 Goldene Stunde, 🍂 Jahreszeiten, 🌧️ nasser Asphalt mit Spiegelungen</li>
      <li>🐦 Vogelschwärme, 🚁 Rettungshubschrauber, 🚨 Martinshorn</li>
      <li>🎥 <b>Folgen</b>-Kamera · 🎬 Kino-Modus als Live-Übertragung · <kbd>?</kbd> Tastenkürzel</li>
      <li>🪧 <b>Anzeigetafel</b> im Fallblatt-Stil (<kbd>I</kbd>)</li>
    </ul></div></div>`.replace('<ul>', `<ul>${T('<li>🛄 <b>Gepäckförderband</b>: Zum Gepäckzug gehört jetzt ein Förderbandwagen (weiß mit grünem Streifen wie eine Elektroflotte, kleine Kabine, Band mit Geländer). Er fährt hinter dem Zug her, stellt sich am Flugzeug schräg an die hintere Frachttür, fährt das Band bis zur Türschwelle hoch und danach wieder herunter</li>')}${T('<li>🚒 <b>Feuerwache im richtigen Maßstab</b>: Die Wache ist jetzt so groß wie in echt (etwa 30 × 17 m, Tore rund 6 m) statt riesig, die Tore zeigen zum Betrachter, und die drei Löschfahrzeuge stehen direkt davor. Bei Alarm fahren sie nacheinander aus und kommen mit Abstand zurück</li>')}${T('<li>🧳 <b>Neuer Gepäckzug</b>: ein gelber Gepäckschlepper mit kurzer Haube und hoher, rundum verglaster Kabine samt Rundumleuchte, dahinter zwei offene Gepäckwagen voller Koffer und Reisetaschen und ein gelber, überdachter Wagen – wie auf echten Vorfeldern</li>')}${T('<li>🪟 <b>Echtes Glas</b>: Scheiben spiegeln jetzt Himmel, Wolken und Horizont – je nach Blickwinkel heller oder dunkler. Fahrzeug- und Autoscheiben haben getöntes Glas mit Lichtreflexen und schwarzem Siebdruckrand, Cockpit- und Kabinenfenster der Flugzeuge spiegeln, der Lack glänzt leicht; nachts wird die Spiegelung schwach</li>')}${T('<li>🚒 <b>Feuerwehr und Polizei wie echt</b>: Das Flughafen-Löschfahrzeug ist jetzt ein großes 6×6 mit Panoramascheibe, schwarzer Front mit Frontwerfer, Löscharm auf dem Dach und Rollläden – auf der Karte und in 3D. Streifenwagen tragen das Polizei-Design in Blau und Leuchtgelb mit Karoreihe und Schriftzug POLIZEI (auch als Kleinbus), und ab dem Regionalflughafen fährt eine Polizeistreife über das Vorfeld: vom Posten am Terminal über die Servicestraße, mit Halt zwischen den Fluggastbrücken – manchmal mit Blaulicht. Die H-48F hat ihr Cockpit jetzt oben im Buckel wie ein echter Jumbo</li>')}${T('<li>🛩️ <b>Richtig verdeckt</b>: Busse und Fahrzeuge hinter oder unter einem Flugzeug verschwinden jetzt korrekt unter Tragfläche, Triebwerk und Rumpf, statt darüber gezeichnet zu werden – Fahrzeuge davor bleiben vorn</li>')}${T('<li>👮 <b>Flughafenpolizei</b>: Streifenwagen fahren auf der Zufahrtsstraße Streife und halten am Parkplatz – manchmal mit Blaulicht. Rettungswagen sind jetzt echte Kleinbusse mit rotem Streifen</li>')}${T('<li>🚦 <b>Ordentlicher Verkehr auf dem Vorfeld</b>: Die Servicestraße hat jetzt zwei Fahrspuren. Fahrzeuge halten Abstand, fahren an und bremsen, fahren am Flugzeug Schritt und nutzen Gassen statt durch andere hindurchzufahren. Jeder Fahrzeugtyp ist unterschiedlich schnell. Außerdem: weiter hineinzoomen bei voller Schärfe, dezentere Schilder, Cockpitscheiben wie beim echten Vorbild und die Treppe genau an der Tür</li>')}${T('<li>🚐 <b>Lebendigere Fahrzeuge</b>: Fahrzeuge und Autos sind jetzt rund statt kantig – abgerundete Karosserien, geneigte Frontscheiben, Radhäuser und echte Pkw mit Scheiben, Säulen und Kennzeichen. Sieben Bauformen (Kleinwagen, Kompakt, Limousine, Kombi, SUV, Kleinbus, Pick-up) in Farben wie auf echten Parkplätzen – viel Weiß, Schwarz, Grau und Silber, dazwischen Blau, Rot, Grün und Beige. Vorfeld- und Linienbusse tragen Werbung (Aurora Airways, Nordstern, Kranich Kaffee, Duty Free …), und man sieht, ob sie voll oder leer sind; dazu Lack mit Gebrauchsspuren, gebürstetes Metall, Firmenaufschriften und große Dachnummern wie auf echten Vorfeldern – auf der Karte und in 3D</li>')}${T('<li>✈️ <b>Echte Flugzeuge auf der Karte</b>: Die Flugzeuge auf der Karte sind jetzt dieselben 3D-Modelle wie in der 3D-Ansicht – runder Rumpf, gepfeilte Flächen, Triebwerke, Fahrwerk und Leitwerk in Airline-Farbe, genau in der Kartenperspektive. Sonderlackierungen sieht man jetzt auch in 3D</li>')}${T('<li>🪜 <b>Treppenfahrzeuge und neue Busse</b>: An Außenpositionen fährt jetzt ein Treppenfahrzeug an die vordere Tür – es steht schon bereit, wenn das Flugzeug einrollt, und fährt vor dem Pushback wieder weg. Im Fuhrpark kaufbar; Turboprops haben eine eigene Bordtreppe. Die Vorfeldbusse sind jetzt moderne Niederflurbusse mit Panoramafenstern und Doppeltüren – auf der Karte und in 3D</li>')}${T('<li>🚌 <b>Vorfeldbusse pendeln</b>: An Außenpositionen ohne Fluggastbrücke fährt der Bus jetzt zwischen Flugzeug und Haltestelle am Terminal hin und her – so oft, wie Fluggäste da sind. Fluggäste laufen über die Treppe in den Bus und vom Bus ins Terminal; Businessjets brauchen keinen Bus mehr</li>')}${T('<li>🏠 <b>Neue Gebäude</b>: Vereinsheim, Flugzeughalle, Tankstelle, Abfertigungsgebäude, Turm, Terminalhalle, Parkhaus, Fracht, Depot, Feuerwache, Tanklager, Hangar und Hotel stehen in der 3D-Ansicht jetzt als detaillierte Modelle mit Terrasse, Toren, Laderampen und Autos im Parkhaus – und auf der Karte gerade auf dem Raster, aus denselben Modellen gezeichnet</li>')}${T('<li>👨‍✈️ <b>Leben am Grasplatz</b>: Piloten gehen ins Vereinsheim und sitzen auf der Terrasse, machen vor dem Abflug den Außencheck, der Platzwart tankt mit dem Quad, Ausflügler essen Kuchen, Zuschauer winken am Zaun, Fallschirmspringer schweben ein – und das Flugplatzfest hat Festzelt, Würstchenbude und Hüpfburg. Außerdem fahren Vorfeldfahrzeuge nicht mehr durch Gebäude</li>')}${T('<li>🌾 <b>Alltag am kleinen Platz</b>: neue Entscheidungen am Grasplatz und Verkehrslandeplatz – Oldtimer-Besuch, Nachbar-Beschwerde, Fotoshooting, Segelflug-Wettbewerb, kaputter Rasenmäher, Feuerwehrübung, Hallenmieter, Heißluftballon im Anflug und mehr</li>')}${T('<li>⏱️ <b>Stoßzeit (endlos)</b>: neue Tower-Herausforderung ohne Zeitlimit – alle 15 Minuten eine größere Welle Anflüge, nach jeder vollen Stunde ein Schichtbonus nach Wahl (1 aus 3), beim dritten Vorfall ist Schluss. Wie lange hältst du durch? Die längste Schicht bleibt als Rekordzeit stehen</li>')}${T('<li>🌐 <b>English version</b> – das ganze Spiel jetzt auch auf Englisch: Menüs, Hilfe, Glossar, Zeitung, Livestream, Betriebsfunk und Kommentator; umschaltbar unter Einstellungen › Sprache</li>')}${T('<li>🎁 <b>Ausbau-Bonus</b>: nach jeder neuen Stufe im Aufbau-Modus einen von drei Vorteilen wählen – Fördermittel, Werbepartner, Stammkunden, Sicherheitskultur und mehr</li>')}${T('<li>💾 <b>Spielstände sicher</b>: automatische Sicherungskopie je Platz (springt ein, wenn ein Stand beschädigt ist), Export als Datei und Import – der Flughafen überlebt das Löschen der Browserdaten und zieht mit auf einen anderen Rechner</li>')}${T('<li>🌨️ <b>Sichtflug-Wetter</b>: Sportflieger bleiben bei Schnee, Nebel und Gewitter am Boden – keine Kette von Treibstoff-Notlagen mehr am kleinen Platz; Partner melden ihren ersten Flug in der Lokalzeitung</li>')}${T('<li>🖼️ <b>Shop-Material</b>: Titelbild und Grafiken in allen Steam- und itch.io-Formaten (Deutsch und Englisch), erzeugt mit <code>node tools/capsules.mjs</code></li>')}`),
  career: () => {
    const S = careerSummary();
    const R = careerRank();
    const c = S.c;
    const h = Math.floor(c.playSec / 3600), m = Math.floor((c.playSec % 3600) / 60);
    const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    const role = (r) => {
      const x = c.byRole[r] || { days: 0, bestScore: 0, perfect: 0, bestPunct: 0 };
      return `<tr><td>${ROLES[r].icon} ${esc(ROLES[r].short)}</td><td>${x.days}</td><td>${x.bestScore ? x.bestScore.toLocaleString(LOCALE) : '—'}</td><td>${x.bestPunct ? x.bestPunct + ' %' : '—'}</td><td>${x.perfect || 0}</td></tr>`;
    };
    return T`<div class="ms-card career"><div class="ms-body">
      <div class="cr-id"><div class="cr-badge">${R.cur.icon}</div><div><div class="cr-k">Dienstausweis · Planez</div><div class="cr-rank">${esc(R.cur.name)}</div><div class="cr-pts">${R.pts.toLocaleString(LOCALE)} Karrierepunkte</div></div></div>
      <div class="cr-bar"><i style="width:${Math.round(R.frac * 100)}%"></i></div>
      <div class="cr-next">${R.next ? T`Nächster Rang: ${R.next.icon} <b>${esc(R.next.name)}</b> ab ${R.next.pts.toLocaleString(LOCALE)}` : T('Höchster Rang erreicht')}</div>
      <div class="cr-grid">${cell(T('Schichten (Tage)'), c.days)}${cell(T('Spielzeit'), `${h} h ${m} min`)}${cell(T('Bewegungen'), c.mov.toLocaleString(LOCALE))}${cell(T('Passagiere'), c.pax.toLocaleString(LOCALE))}${cell(T('Perfekte Tage ★★★★★'), c.perfect)}${cell(T('Erfolge'), `${c.ach.length} / ${S.achAll}`)}${cell(T('Kampagne'), (() => { const cp = campaignProgress(); return cp.next == null ? `🏆 ${cp.total}/${cp.total}` : T`📖 ${cp.done}/${cp.total} Kapitel`; })())}${cell(T('Herausforderungen'), `⭐ ${S.stars}`)}${cell(T('Tagesserie'), T`🔥 ${S.daily.streak || 0} · Rekord ${S.daily.best || 0}`)}${cell(T('Spotterpunkte'), S.spot.pts.toLocaleString(LOCALE))}</div>
      <div class="ms-sec">Rekorde</div>
      <div class="cr-grid">${cell(T('🛬 Weichste Landung'), c.rec && c.rec.td ? `${c.rec.td.fpm} ft/min · ${esc(c.rec.td.cs)}` : '—')}${cell(T('📈 Meiste Bewegungen'), c.rec && c.rec.mov ? T`${c.rec.mov} an einem Tag` : '—')}${cell(T('📡 Zuschauerrekord'), c.rec && c.rec.viewers ? c.rec.viewers.toLocaleString(LOCALE) : '—')}</div>
      <div class="ms-sec">Je Station</div>
      <table class="cr-tab"><tr><th></th><th>Tage</th><th>Bestwert ⭐</th><th>Pünktl.</th><th>Perfekt</th></tr>${['tower', 'ground', 'manager', 'observer'].map(role).join('')}</table>
      <div class="ms-auto">Punkte gibt es für gespielte Tage, Verkehr, Sterne, Erfolge, Tagesherausforderungen, perfekte Tage und das Spotterbuch.</div></div></div>`;
  },
  about: () => T`<div class="ms-card"><div class="ms-body"><div class="ms-h">Über Planez</div><div class="ms-subt">Version ${VERSION}${IS_DEMO ? T(' · Demo-Version') : ''}</div><ul><li>Airport-Simulation mit isometrischer Karte, 3D-Ansicht, Radar, Funk und Wirtschaft – vom Grasplatz zum Drehkreuz</li><li>Grafiken, Fotos und Hintergrundvideos: Higgsfield AI (GPT Image, Kling) · Musik: OpenArt</li><li>3D: three.js (MIT-Lizenz) · Schriften: Inter, JetBrains Mono, Chakra Petch, Orbitron (SIL Open Font License, lokal eingebunden)</li><li>Alle Airlines, Flugzeughersteller und -typen, Rufzeichen, Personen und Flüge sind frei erfunden</li><li>Spielstände bleiben auf diesem Gerät (Browser-Speicher); es werden keine Daten an Server gesendet</li><li>Lizenztexte: <a href="LIZENZEN.md" target="_blank" rel="noopener">LIZENZEN.md</a></li></ul></div></div>`,
};

// ---------- Speicherplätze ----------
const fmtSaved = (t) => {
  if (!t) return '';
  const d = new Date(t);
  const today = new Date();
  const hm = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? T`heute ${hm}` : `${d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' })} ${hm}`;
};
function slotListHtml() {
  return T`<button class="mm-back" data-mm="back">← Zurück</button>` + slotInfo().map((x) => x.empty
    ? T`<button class="mm-item slot-item locked" data-slot-load="${x.n}" data-side="slot:${x.n}"><span class="n"></span><span class="l"><b>Platz ${x.n} · leer</b><small>Über „Neues Spiel“ belegen</small></span></button>`
    : T`<div class="slot-row"><button class="mm-item slot-item" data-slot-load="${x.n}" data-side="slot:${x.n}"><span class="n"></span><span class="l"><b>${esc(x.name)}</b><small>Platz ${x.n} · Tag ${dayOf(x.time)} · ${fmtClock(x.time)} · ${esc(ROLES[x.role]?.short || '')} · ${fmtMoney(x.cash)}${x.saved ? T` · gespeichert ${fmtSaved(x.saved)}` : ''}${x.last ? T(' · zuletzt gespielt') : ''}</small></span></button><button class="mini slot-exp" data-slot-exp="${x.n}" title="Als Datei sichern (Export)">⬇</button><button class="mini slot-del" data-slot-del="${x.n}" title="Spielstand löschen">🗑</button></div>`).join('') +
    T`<button class="mm-item slot-imp" data-slot-imp><span class="n"></span><span class="l"><b>⬆ Spielstand importieren</b><small>Gesicherte Datei (.json) auf einen freien Platz laden</small></span></button><input type="file" id="slot-file" accept=".json,application/json" hidden>`;
}
function renderSlotSelect(root) {
  const sel = root.querySelector('#inp-slot');
  if (!sel) return;
  const info = slotInfo();
  const pick = freeSlot();
  sel.innerHTML = info.map((x) => T`<option value="${x.n}" ${x.n === pick ? 'selected' : ''}>Platz ${x.n} – ${x.empty ? T('frei') : T`überschreibt „${esc(x.name)}“ (Tag ${dayOf(x.time)})`}</option>`).join('');
}
function refreshContinue() {
  if (!mm) return;
  const any = slotInfo().some((x) => !x.empty);
  mm.save = any ? loadGame() : null;
  const box = mm.root.querySelector('#continue-box');
  box.classList.toggle('hidden', !mm.save);
  if (mm.save) mm.root.querySelector('#continue-info').textContent = T`${mm.save.name} · Tag ${dayOf(mm.save.time)} · ${fmtClock(mm.save.time)} · ${ROLES[mm.save.role]?.name || ''}`;
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
  root.querySelector('#btn-quit').classList.toggle('hidden', !DESKTOP); // nur die Desktop-Version lässt sich beenden

  const showSide = (key) => {
    let html = '';
    if (key === 'save' && mm.save) html = statusPanel(mm.save, T('Letzter Spielstand'));
    else if (key.startsWith('scn:')) html = scenarioSide(key.slice(4));
    else if (key.startsWith('slot:')) {
      const n = Number(key.slice(5));
      mm.slotCache = mm.slotCache || {};
      if (!(n in mm.slotCache)) mm.slotCache[n] = loadGame(n);
      html = mm.slotCache[n] ? statusPanel(mm.slotCache[n], T`Speicherplatz ${n}`) : SIDE.slotEmpty(n);
    }
    else if (ROLE_INFO[key]) html = sideRole(key);
    else if (SIDE[key]) html = SIDE[key]();
    else html = mm.save ? statusPanel(mm.save, T('Letzter Spielstand')) : SIDE.new();
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
    showSide(key === 'new' ? 'new' : key === 'settings' ? 'settings' : f && f.dataset.side ? f.dataset.side : mm.save ? 'save' : 'new'); // Import-Eintrag hat keine Seitenkarte
  };
  mm.openList = openList;

  const renderPrefs = () => {
    const p = loadPrefs();
    // Sprache: Umschalten lädt die Seite neu (Wörterbuch wird beim Start geladen)
    root.querySelector('#mm-prefs').innerHTML = langRow(T('Umschalten lädt das Spiel neu')) + [...PREF_ROWS.slice(0, 1), ['music', T('Menümusik'), T('das Planez-Thema im Hauptmenü')], ...PREF_ROWS.slice(1), ['briefing', T('Schichtbriefing'), T('zu Tagesbeginn: Wetter, Verkehrsspitzen, Lage und Ziele der Schicht')]].map(([k, n, sub]) => switchRow(k, n, sub, !!p[k])).join('');
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
      else if (a === 'quit') window.close();
      return;
    }
    const ex = e.target.closest('[data-slot-exp]');
    if (ex) {
      const f = exportSave(Number(ex.dataset.slotExp));
      if (!f) return toast(T('Export nicht möglich – der Spielstand ist leer oder beschädigt'), 'bad');
      const url = URL.createObjectURL(new Blob([f.text], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: f.file });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(T`💾 Gesichert als ${f.file}`, 'good');
      return;
    }
    if (e.target.closest('[data-slot-imp]')) {
      const free = slotInfo().find((x) => x.empty);
      if (!free) return toast(T('Alle drei Plätze sind belegt – erst einen Spielstand löschen'), 'warn');
      const inp = root.querySelector('#slot-file');
      inp.onchange = () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        file.text().then((text) => {
          const r = importSave(text, free.n);
          inp.value = '';
          if (!r.ok) return toast(r.why === 'full' ? T('Import fehlgeschlagen – der Browser-Speicher ist voll') : T('Diese Datei ist kein gültiger Planez-Spielstand'), 'bad');
          mm.slotCache = {};
          lists.slots.innerHTML = slotListHtml();
          renumber(lists.slots);
          showSide(`slot:${free.n}`);
          refreshContinue();
          toast(T`✅ „${r.name}“ auf Platz ${free.n} importiert`, 'good');
        });
      };
      inp.click();
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
        del.textContent = T('Wirklich löschen?');
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
    const lg = e.target.closest('[data-lang]');
    if (lg) {
      switchLang(lg.dataset.lang);
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
  if (save) mm.root.querySelector('#continue-info').textContent = T`${save.name} · Tag ${dayOf(save.time)} · ${fmtClock(save.time)} · ${ROLES[save.role]?.name || ''}`;
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
      const lg = e.target.closest('[data-lang]');
      if (lg) {
        // vorher speichern, damit nach dem Neuladen „Weiterspielen“ genau hier weitermacht
        if (lg.dataset.lang !== LANG && !pz.game.state.scenario) pz.api.save();
        switchLang(lg.dataset.lang);
        return;
      }
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
        b.querySelector('small').textContent = T`Gespeichert um ${fmtClock(pz.game.state.time)} ✓`;
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

// Sprache · Language: Deutsch/English (Hauptmenü und Pausenmenü)
function langRow(sub) {
  return `<div class="mm-toggle mm-lang"><span class="l"><b>Sprache · Language</b><small>${sub}</small></span><span class="mm-lseg">${[['de', 'Deutsch'], ['en', 'English']].map(([l, n]) => `<button data-lang="${l}" class="${LANG === l ? 'on' : ''}" aria-pressed="${LANG === l}">${n}</button>`).join('')}</span></div>`;
}
// Sprache wechseln: merken und neu laden (das Wörterbuch wird beim Start geladen)
function switchLang(l) {
  if (l === LANG) return;
  setLang(l);
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  location.href = u.toString();
}

function renderPause() {
  const s = pz.game.state;
  const set = pz.api.settings();
  const item = (a, title, sub = '', cls = '') => `<button class="mm-item ${cls}" data-pm="${a}"><span class="n"></span><span class="l"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  const prefs = pz.showSettings ? `<div class="pm-prefs">${langRow(s.scenario ? T('Umschalten lädt neu – die Herausforderung beginnt von vorn') : T('Umschalten speichert und lädt das Spiel neu'))}${[...PREF_ROWS, ['labels', T('Beschriftungen auf der Karte'), T('Rufzeichen und Status an Flugzeugen')]].map(([k, n, sub]) => switchRow(k, n, sub, !!set[k])).join('')}</div>` : '';
  pz.el.innerHTML = T`<div class="pm-shade"></div><i class="mm-corner tl"></i><i class="mm-corner bl"></i>
    <div class="mm-left pm-left">
      <div class="pm-paused"><i></i><i></i>Pausiert</div>
      <h1 class="mm-title sm"><span class="t1">PLANEZ</span><span class="t2">AIRPORT</span></h1>
      <div class="mm-tag"><span>${esc(s.name.toUpperCase())} · TAG ${dayOf(s.time)}</span><i></i></div>
      <nav class="mm-list">
        ${item('resume', T('Weiter'), T('Der Flughafen läuft da weiter, wo er stand.'))}
        ${s.scenario ? '' : item('save', T('Jetzt speichern'), T`Platz ${s.slot || 1} · automatisch alle 45 Sekunden und zum Tagesende`)}
        ${item('settings', T('Einstellungen'), pz.showSettings ? '' : T('Sprache, Sound, Sprachausgabe, Tooltips, Tipps'))}
        ${prefs}
        ${item('role', T('Station wechseln'), T`aktuell: ${esc(ROLES[s.role].name)}`)}
        ${item('goals', T('Ziele & Rang'))}
        ${item('tutorial', T('Einführung starten'), T('Schritt für Schritt durch deine Station'))}
        ${item('help', T('So funktioniert es'))}
        ${item('gloss', T('Glossar'))}
        ${item('quit', T('Zurück ins Hauptmenü'), '', 'gold')}
      </nav>
      <div class="mm-foot"><span class="mm-credit">Esc = weiter · ↑↓ + Enter zum Auswählen</span></div>
    </div>
    <aside class="mm-side pm-side in">${statusPanel(s, T('Status'))}</aside>`;
  renumber(pz.el.querySelector('.mm-list'));
  glossify(pz.el.querySelector('.pm-side'));
}

export function closePause() {
  if (!pz) return;
  pz.el.classList.add('hidden');
  if (pz.game && pz.game.state) pz.game.state.speed = pz.prevSpeed || 1;
}
