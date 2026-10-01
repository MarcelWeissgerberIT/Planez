// Planez – Airport Simulator: Start, Spielschleife, Eingabe
import { Ride } from './ui/ride.js';
import { icon, hydrateIcons } from './ui/icons.js';
import { loadAssets } from './assets.js';
import { Camera } from './render/camera.js';
import { MapRenderer } from './render/map.js';
import { Radar, seqChips } from './render/radar.js';
import { newGame, loadGame, saveGame, hasSave, setRole, ROLES } from './state.js';
import { run, hooks } from './sim/sim.js';
import { listeners } from './sim/messages.js';
import { SPEEDS, AC_TYPES, dayMinutes } from './config.js';
import { TowerPanel, REQ_DE, fixReadback, guardedCommand } from './ui/tower.js';
import { boardMeetingHtml } from './ui/board.js';
import { playIntro } from './ui/intro.js';
import { isNight } from './sim/finance.js';
import { newspaperHtml } from './ui/newspaper.js';
import { chooseStrategy, STRATEGIES } from './sim/board.js';
import { CHAPTERS, chapterOf } from './sim/campaign.js';
import { GroundPanel } from './ui/groundPanel.js';
import { ManagerPanel } from './ui/managerPanel.js';
import { $, toast, openModal, closeModal, modalOpen, setHTML } from './ui/dom.js';
import { renderInfo } from './ui/info.js';
import { currentHint } from './ui/hints.js';
import { initMarkMenu, openMarkMenu, closeMarkMenu, markMenuOpen, cycleMark, clearMark, setMark, MARKS } from './ui/marks.js';
import { sfx, setSound, setTTS, unlock } from './audio.js';
import { menuMusic } from './menuMusic.js';
import { gameMusic } from './gameMusic.js';
import { voice } from './voice.js';
import { initPTT } from './ui/ptt.js';
import { DecisionCard } from './ui/decision.js';
import { NewsTicker } from './ui/ticker.js';
import { Cinema } from './ui/cinema.js';
import { paTick } from './ui/pa.js';
import { approveHeli } from './sim/heli.js';
import { clearVfr } from './sim/vfr.js';
import { approveInspection } from './sim/inspect.js';
import { Replay } from './ui/replay.js';
import { highlightsHtml } from './ui/highlights.js';
import { Stream } from './ui/stream.js';
import { PhotoMode } from './ui/photo.js';
import { Tutorial } from './ui/tutorial.js';
import { showAchievement, achievementsHtml } from './ui/achUi.js';
import { soundscape } from './soundscape.js';
import { Q } from './render/quality.js';
import { season, temperature } from './sim/winter.js';
import { makeVehicle, freeBay } from './sim/ground.js';
import { command } from './sim/atc.js';
import { dispatch, assignStand, standFits, standFree } from './sim/ground.js';
import * as EC from './sim/economy.js';
import { fmtClock, fmtMoney, dayOf, esc, clamp, hourOf } from './util.js';
import { WEATHER, forecastInfo } from './sim/events.js';
import { PH } from './sim/aircraft.js';
import * as LY from './layout.js';
import { seqColor } from './ui/tower.js';
import { siteGeom } from './render/sites.js';
import { initGlossary, setGlossaryEnabled, glossify, glossaryHtml } from './ui/glossary.js';
import { goalsState, activeGoals, goalProgress, goalText, goalFraction, RANKS, GOAL_DEFS } from './sim/goals.js';
import { fuelState } from './sim/fuel.js';
import { initMainMenu, refreshMainMenu, showPauseMenu, loadPrefs, savePrefs, applyA11y } from './ui/menus.js';
import { ManagementPage } from './ui/mgmtPage.js';
import { ManagerDock } from './ui/managerDock.js';
import { projects, cancelProject } from './sim/construction.js';
import { scenarioById, applyScenario, scenarioListeners } from './sim/scenarios.js';
import { ScenarioUi } from './ui/scenarioUi.js';
import { StandPlan } from './ui/standPlan.js';
import { scoreState } from './sim/score.js';
import { keysHtml } from './ui/keys.js';
import { Fids } from './ui/fids.js';
import { SpotterUi } from './ui/spotter.js';
import { briefingHtml } from './ui/briefing.js';
import { careerDayEnd, careerAch, careerTick, careerRank } from './career.js';
import { RankUp } from './ui/rankUp.js';

// eigene SVG-Icons in die statischen Knöpfe (Kartenleiste, Menü, Radar/Funk-Köpfe) einsetzen
hydrateIcons(document);

const game = {
  state: null,
  cam: new Camera(),
  map: null,
  radar: null,
  panel: null,
  ui: { sel: null, selected: null, labels: true, hoverStand: null, labelFn: null, radarBig: false, radarOn: false },
  running: false,
  lastTs: 0,
  uiTimer: 0,
  saveTimer: 0,
  panelHold: false,
  seenReq: new Set(),
  lastAlert: 0,
  select(id, focus = false) {
    const s = this.state;
    if (!id) {
      this.ui.sel = null;
      this.ui.selected = null;
      this.ui.follow = null;
      return;
    }
    const ac = s.acs.find((a) => a.id === id);
    if (!ac) return;
    this.ui.sel = { type: 'ac', id };
    this.ui.selected = id;
    if (focus) {
      if (ac.mode === 'map') this.cam.focus(clamp(ac.x, 0, LY.W), clamp(ac.y, 0, LY.H));
      else if (s.role === 'tower' && !this.ui.radarOn) toggleRadar(true);
    }
    const strip = document.querySelector(`#panel [data-key="${id}"], #rail [data-key="${id}"]`);
    if (strip && focus !== 'map') strip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  },
};
game.showGoals = () => showGoals();
game.resize = () => resize();
// Baustelle auf der Karte zeigen und auswählen
game.showSite = (id) => {
  const s = game.state;
  const p = projects(s).find((x) => x.id === id);
  const g = p && siteGeom(s, p);
  if (!g) return;
  game.ui.sel = { type: 'site', id };
  game.ui.selected = null;
  game.cam.focus((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2);
  if (game.ui.radarBig) toggleRadar(false);
  game.refreshUi();
};
game.refreshUi = () => {
  game.uiTimer = 0;
  const info = document.getElementById('info');
  if (info) info._html = null;
};
window.planez = game; // für Tests/Debugging

// ---------------- Start ----------------
// Tipps auf dem Ladebildschirm
const LOAD_TIPS = [
  'Tipp: Mit <kbd>K</kbd> startet der Kino-Modus – die Kamera sucht sich selbst die besten Szenen.',
  'Tipp: Im Tower zeigt die Karte „⏳ Landung zuerst“, wenn ein Start noch warten sollte.',
  'Tipp: Der Positionsplan (<kbd>G</kbd>) im Vorfeld zeigt, welche Position wann frei wird.',
  'Tipp: Bei Angeboten kannst du verhandeln – die Erfolgschance steht direkt auf dem Knopf.',
  'Tipp: Die Wettervorhersage im Kopfbereich kündigt Gewitter 30 Minuten vorher an.',
  'Tipp: Unter „Herausforderungen“ warten zehn Szenarien mit Sternen – von der Morgenwelle bis zum Großen Flugtag.',
  'Tipp: „🎥 Folgen“ auf der Info-Karte lässt die Kamera ein Flugzeug durch den ganzen Umlauf begleiten.',
  'Wusstest du? Hinter einem Heavy braucht ein leichtes Flugzeug bis zu 6 NM Abstand – Wirbelschleppen.',
  'Wusstest du? Unter 550 m Pistensichtweite reicht ILS CAT I nicht mehr – dann hilft nur CAT III.',
  'Wusstest du? Das Martinshorn der deutschen Feuerwehr spielt eine Quarte – „Tatü-tata“.',
  'Tipp: Mit <kbd>V</kbd> (gedrückt halten) funkst du im Tower selbst – auf Englisch, wie echte Lotsen.',
  'Tipp: 📷 bzw. <kbd>Umschalt</kbd>+<kbd>P</kbd> öffnet den Fotomodus mit Filtern, Miniatur-Effekt, Lichtspuren (Langzeitbelichtung, nachts am schönsten) und PNG-Export.',
  'Tipp: <kbd>?</kbd> zeigt im Spiel alle Tastenkürzel deiner Station.',
  'Tipp: Unter Wettbewerb siehst du deinen Marktanteil gegen Nordhafen – Ansehen und Pünktlichkeit zählen am meisten.',
  'Tipp: Im Tower lohnt sich Hinhören – ein falscher Readback lässt sich mit Q korrigieren.',
  'Tipp: Bittet ein Pilot bei Gewitter um einen Umweg, genehmige ihn mit Y – sonst geht es durch die Turbulenz.',
  'Tipp: Der Aufsichtsrat tagt alle 7 Tage – mit der Strategie „Wachstum“ melden sich mehr Airlines.',
  'Tipp: Gib der Pistenkontrolle eine Lücke – ohne Kontrollen steigt das Risiko für Fremdkörper auf der Bahn.',
  'Tipp: Etwa jede 18. Maschine trägt eine Sonderlackierung – fotografiere sie fürs 📒 Spotterbuch.',
  'Tipp: Eine Landung im Gewitter oder ein Nachtstart bringt im Spotterbuch Extrapunkte für den Moment.',
];

async function boot() {
  applyA11y();
  const tip = $('#load-tip');
  if (tip) tip.innerHTML = LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)];
  const fill = $('#load-fill');
  await loadAssets((p) => (fill.style.width = `${Math.round(p * 100)}%`));
  game.map = new MapRenderer($('#map'), game.cam);
  game.radar = new Radar($('#radar'));
  initGlossary();
  initMainMenu({
    gloss: () => showHelp(false, 'gloss'),
    scenario: (id) => startScenario(id),
    loadSlot: (n) => {
      unlock();
      const st = loadGame(n);
      if (!st) return toast('Spielstand konnte nicht geladen werden', 'bad');
      st.settings.tts = loadPrefs().tts;
      startGame(st);
    },
    prefsChanged: (p) => {
      setGlossaryEnabled(p.glossary);
      setSound(p.sound);
      syncMenuMusic();
    },
  });
  $('#loading').classList.add('hidden');
  showMenu();
  wireMenu();
  wireGame();
  requestAnimationFrame(loop);
}

// Menümusik: erst nach einer Nutzeraktion (Autoplay-Regeln), nur solange das Hauptmenü offen ist
let menuGesture = false;
// Spielmusik: passt sich der Lage an (alle 2 s), leiser bei Pause oder offenem Fenster
function syncGameMusic() {
  const p = loadPrefs();
  const s = game.state;
  const inGame = !!s && $('#menu').classList.contains('hidden');
  if (inGame && p.gameMusic !== false && s.settings.sound !== false) gameMusic.start(0.16);
  else gameMusic.stop();
}
setInterval(() => {
  if (game.state && game.running && !modalOpen() && !(game.cinema && game.cinema.on)) paTick(game.state);
  if (game.state && gameMusic.playing) gameMusic.update(game.state, !game.state.speed || modalOpen());
}, 2000);
function syncMenuMusic() {
  const p = loadPrefs();
  const inMenu = !$('#menu').classList.contains('hidden');
  if (inMenu && menuGesture && p.sound !== false && p.music !== false) menuMusic.start(0.45);
  else menuMusic.stop();
  if (inMenu) gameMusic.stop();
}
for (const ev of ['pointerdown', 'keydown'])
  window.addEventListener(ev, () => {
    if (menuGesture) return;
    menuGesture = true;
    syncMenuMusic();
  }, { capture: true });

function showMenu() {
  $('#menu').classList.remove('hidden');
  $('#game').classList.add('hidden');
  const R = careerRank();
  const ci = $('#career-info');
  if (ci) ci.textContent = `${R.cur.icon} ${R.cur.name} · ${R.pts.toLocaleString('de-DE')} Punkte`;
  syncMenuMusic();
  setGlossaryEnabled(loadPrefs().glossary);
  const sv = hasSave() ? loadGame() : null;
  // Erfolge bestehender Spielstände in die Karriere übernehmen
  if (sv && sv.ach) for (const id of Object.keys(sv.ach)) careerAch(id);
  refreshMainMenu(sv);
}

// Einstellungen aus den Voreinstellungen übernehmen
function applyPrefs(st) {
  const pr = loadPrefs();
  Object.assign(st.settings, { sound: pr.sound, ambience: pr.ambience, tts: pr.tts, glossary: pr.glossary, hints: pr.hints });
  return st;
}

// Herausforderung starten: frischer Flughafen mit Szenario-Vorgaben, dann Einsatzbesprechung
function startScenario(id) {
  const ch = chapterOf(id);
  const def = scenarioById(ch != null ? CHAPTERS[ch].scn : id);
  if (!def) return;
  unlock();
  closeModal();
  const st = applyPrefs(newGame({ role: def.role, name: 'Planez International', density: def.density, hour: def.hour, seed: def.seed }));
  applyScenario(st, def);
  startGame(st);
  game.scn.brief(def, ch);
}
scenarioListeners.push((s, def, res) => {
  if (game.state === s && game.scn) {
    if (game.cinema && game.cinema.on) game.cinema.stop && game.cinema.stop();
    closeModal();
    game.scn.result(def, res);
  }
});

function wireMenu() {
  const start = (role) => {
    unlock();
    const name = $('#inp-name').value.trim() || 'Planez International';
    const density = Number($('#inp-density').value) || 1;
    const slot = Number(($('#inp-slot') || {}).value) || 1;
    const difficulty = ($('#inp-diff') || {}).value || 'normal';
    const seasonOffset = Number(($('#inp-season') || {}).value) || 0;
    const cash = Number(($('#inp-cash') || {}).value) || 5000000;
    const events = (($('#inp-events') || {}).value || '1') !== '0';
    const st = applyPrefs(newGame({ role, name, density, slot, difficulty, seasonOffset, cash, events }));
    game.introNext = !loadPrefs().calm; // Kino-Intro für neue Spiele (nicht bei „Bewegung reduzieren“)
    startGame(st);
    try {
      localStorage.setItem('planez_help_seen', '1');
    } catch (e) {}
  };
  document.querySelectorAll('.role-card').forEach((b) => b.addEventListener('click', () => start(b.dataset.role)));
  document.querySelectorAll('[data-role-start]').forEach((b) => b.addEventListener('click', () => start(b.dataset.roleStart)));
  $('#btn-continue').addEventListener('click', () => {
    unlock();
    const s = loadGame();
    if (s) {
      s.settings.tts = loadPrefs().tts;
      startGame(s);
    }
  });
  $('#btn-help-menu').addEventListener('click', () => showHelp(false));
}

// Echter Funk: nur für Tower und Beobachter, Einstellung aus den Voreinstellungen
function syncVoice() {
  const s = game.state;
  const on = !!(s && s.settings.tts && (s.role === 'tower' || s.role === 'observer' || s.role === 'ground'));
  voice.set({ on, vol: loadPrefs().voiceVol ?? 0.9 });
  const b = $('#voice-t');
  if (b) {
    b.innerHTML = icon(s && s.settings.tts ? 'speaker' : 'mute');
    b.classList.toggle('on', !!(s && s.settings.tts));
  }
  const p = $('#ptt-btn');
  if (p) p.classList.toggle('hidden', !(s && s.role === 'tower'));
}
game.syncVoice = syncVoice;

// Spotterbuch (einmal anlegen)
function spotter() {
  if (!game.spot) game.spot = new SpotterUi(game);
  return game.spot;
}

function startGame(state) {
  soundscape.unlock();
  Q.perf = !!loadPrefs().perf;
  game.fpsProbe = { t: 0, n: 0, sum: 0 };
  game.state = state;
  game.ui.sel = null;
  game.ui.selected = null;
  game.seenReq = new Set();
  $('#menu').classList.add('hidden');
  $('#menu-video').pause();
  menuMusic.stop();
  $('#game').classList.remove('hidden');
  setTimeout(syncGameMusic, 50);
  $('#log').innerHTML = '';
  for (const m of state.log.slice(-40)) addLog(m, true);
  setSound(state.settings.sound);
  setTTS(false);
  // ältere Spielstände ergänzen
  if (state.settings.glossary === undefined) state.settings.glossary = true;
  if (state.settings.curfew === undefined) state.settings.curfew = false;
  if (state.fees.night === undefined) state.fees.night = 600;
  if (!state.loans) state.loans = [];
  if (!state.life) state.life = {};
  // Winter: ältere Spielstände bekommen zwei Enteisungsfahrzeuge
  if (!state.vehicles.some((v) => v.type === 'deice')) for (let i = 0; i < 2; i++) state.vehicles.push(makeVehicle(state, 'deice', freeBay(state)));
  if (state.settings.vehAuto && state.settings.vehAuto.deice === undefined) state.settings.vehAuto.deice = false;
  fuelState(state);
  goalsState(state);
  spotter().ensureLooks(state);
  spotter().hinted = new Set();
  setGlossaryEnabled(state.settings.glossary !== false);
  resize();
  const narrow = window.innerWidth < 760;
  game.cam.x = 36;
  game.cam.y = 21;
  game.cam.zoom = narrow ? 0.4 : window.innerWidth > 1700 ? 0.62 : 0.52;
  if (narrow) {
    $('#panel').classList.add('collapsed');
    $('#panel-toggle').classList.add('collapsed');
    $('#panel-toggle').textContent = '⟨';
    $('#map-ctrls').classList.add('full');
    $('#log-wrap').classList.add('min');
    $('#log-toggle').textContent = '+';
  }
  if (!game.scn) game.scn = new ScenarioUi(game, { start: (id) => startScenario(id), menu: () => quitToMenu() });
  game.scn.hide();
  applyRole();
  syncVoice();
  if (!game.tutorial) game.tutorial = new Tutorial(game);
  const afterIntro = () => {
    if (!state.scenario) game.tutorial.maybeStart();
    // neues Spiel (ohne Einführung): gleich mit dem Schichtbriefing beginnen
    if (!state.scenario && state.time < 7 * 3600 && tutSeen(state.role)) setTimeout(() => game.state === state && !modalOpen() && showBriefing(state.speed || 1), 600);
  };
  if (game.introNext && !state.scenario) playIntro(game, afterIntro);
  else afterIntro();
  game.introNext = false;
  lastSpeed = state.speed || lastSpeed;
  game.running = true;
  game.lastTs = performance.now();
}

function applyRole() {
  const s = game.state;
  const g = $('#game');
  g.classList.remove('role-tower', 'role-ground', 'role-manager', 'role-observer');
  g.classList.add(`role-${s.role}`);
  const root = $('#panel');
  root.innerHTML = '';
  root.classList.remove('dock');
  if (!game.mgmt) game.mgmt = new ManagementPage(game);
  game.mgmt.close();
  if (game.splan) game.splan.toggle(false);
  if (game.panel && game.panel.destroy) game.panel.destroy();
  if (game.ui.radarBig) {
    game.ui.radarBig = false;
    $('#radar-wrap').classList.remove('big');
  }
  if (s.role === 'tower') game.panel = new TowerPanel(root, game);
  else if (s.role === 'ground') game.panel = new GroundPanel(root, game);
  else game.panel = new ManagerDock(root, game, s.role === 'observer');
  const head = root.querySelector('.p-head');
  if (head) {
    const h = document.createElement('div');
    h.id = 'hint';
    h.className = 'hint hidden';
    h.innerHTML = '<span class="hint-i">💡</span><span class="hint-t"></span><button class="mini" title="Tipps ausblenden">✕</button>';
    h.querySelector('button').addEventListener('click', () => {
      s.settings.hints = false;
      h.classList.add('hidden');
      toast('Tipps ausgeblendet – im Menü wieder einschaltbar', 'info', 2500);
    });
    head.after(h);
  }
  $('#btn-role').innerHTML = `${icon({ tower: 'headset', ground: 'vest', manager: 'briefcase', observer: 'eye' }[s.role] || 'eye')} ${ROLES[s.role].short} ▾`;
  toggleRadar(s.role === 'tower');
  if (game.syncVoice) game.syncVoice();
  if (game.tutorial && game.tutorial.on) game.tutorial.stop();
  if (game.tutorial && !s.scenario) game.tutorial.maybeStart();
  game.ui.labelFn = labelFn(s.role);
  game.ui.seqCol = (ac) => (s.seq && s.seq.includes(ac.id) ? seqColor(ac) : null);
  $('#hud-name').textContent = s.name;
  updateHUD(true);
}

function labelFn(role) {
  return (ac) => {
    const s = game.state;
    const n = s.seq ? s.seq.indexOf(ac.id) + 1 : 0;
    if (role === 'tower' && n) {
      const what = ac.clr.takeoff ? 'Start frei' : ac.clr.land ? 'Landung frei' : ac.req ? REQ_DE[ac.req].replace('bittet um ', '').replace('wartet auf ', '') : ac.arr && !['STARTUP', 'TAXI_OUT', 'HOLDING', 'LINEUP', 'LINED_UP', 'TAKEOFF'].includes(ac.phase) ? 'Landung' : 'Start';
      return `#${n} · ${what}`;
    }
    if (role === 'tower') {
      if (ac.req) return REQ_DE[ac.req].replace('bittet um ', '').replace('wartet auf ', '');
      if (ac.phase === PH.FINAL) return ac.clr.land ? 'Landung frei' : 'keine Freigabe!';
      if (ac.holdPos) return 'HALT';
      return ac.stand && ac.arr ? `→ P${ac.stand}` : '';
    }
    if (role === 'ground') {
      if (ac.ta) {
        const ts = Object.values(ac.ta.tasks);
        const done = ts.filter((t) => t.st === 'done').length;
        return `P${ac.stand} · ${done}/${ts.length}`;
      }
      if (ac.arr && !ac.stand) return 'keine Position';
      return ac.stand ? `→ P${ac.stand}` : '';
    }
    // während des Spotter-Quiz im Livestream den Typ nicht verraten
    return game.stream && game.stream.quiz && game.stream.quiz.id === ac.id ? '???' : ac.type;
  };
}

// ---------------- Schleife ----------------
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (ts - game.lastTs) / 1000 || 0.016);
  game.lastTs = ts;
  if (!game.running || !game.state) return;
  const s = game.state;
  if (!modalOpen() || s.speed === 0) run(s, dt);
  // Leistung prüfen: nach dem Start 8 s messen, bei unter ~22 fps einmalig den Leistungsmodus einschalten
  const fp = game.fpsProbe;
  if (fp && !fp.done && !document.hidden) {
    fp.t += dt;
    if (fp.t > 2) {
      fp.n++;
      fp.sum += dt;
    }
    if (fp.t > 10) {
      fp.done = true;
      const avg = fp.sum / Math.max(1, fp.n);
      let asked = false;
      try {
        asked = !!localStorage.getItem('planez_perf_auto');
        localStorage.setItem('planez_perf_auto', '1');
      } catch (e) {}
      if (avg > 0.045 && !Q.perf && !asked) {
        Q.perf = true;
        savePrefs({ perf: true });
        resize();
        toast('⚙️ Leistungsmodus eingeschaltet, damit das Spiel flüssig läuft – abschaltbar unter Menü › Einstellungen', 'info', 6000);
      }
    }
  }
  if (game.stream && game.stream.on) game.stream.update(dt);
  if (game.ride && game.ride.on) game.ride.update(dt);
  else if (game.cinema && game.cinema.on) game.cinema.update(dt);
  else {
    followCam(s, dt);
    game.cam.update(dt);
  }
  keyPan(dt);
  if (s.speed && !document.hidden) careerTick(dt);
  if (!game.replay) game.replay = new Replay(game);
  game.replay.record(s, dt);
  // beim Mitfliegen in 3D zeichnet WebGL die Szene – die 2D-Karte darunter muss nicht mitlaufen
  if (!(game.ride && game.ride.on && game.ride.use3d)) game.map.render(game.replay.on ? game.replay.view(s, dt) : s, dt, game.ui);
  soundscape.on = !!s.settings.sound && s.settings.ambience !== false && !document.hidden;
  soundscape.update(s, game.cam, game.map, dt, !s.speed || modalOpen());
  if (game.ui.radarOn) game.radar.render(s, dt, game.ui);
  game.uiTimer -= dt;
  if (game.uiTimer <= 0) {
    game.uiTimer = 0.2;
    updateHUD();
    if (game.ui.radarOn) setHTML($('#radar-seq'), seqChips(s));
    if (!game.panelHold && !(document.activeElement && document.activeElement.tagName === 'SELECT')) game.panel.update(s);
    if (!(document.activeElement && document.activeElement.tagName === 'SELECT' && document.activeElement.closest('#info'))) renderInfo($('#info'), s, game.ui);
    if (game.mgmt && game.mgmt.isOpen()) game.mgmt.update(s);
    if (!game.decision) game.decision = new DecisionCard(game);
    game.decision.update(s);
    if (!game.ticker) game.ticker = new NewsTicker(game);
    game.ticker.update(s);
    if (game.tutorial) game.tutorial.update();
    if (game.scn) game.scn.update();
    if (game.splan) game.splan.update(s);
    if (game.fids) game.fids.update();
    spotter().update(s);
    watchAlerts(s);
    watchMoments(s);
    game.hintT = (game.hintT || 0) + 0.2;
    if (game.hintT >= 1.2) {
      game.hintT = 0;
      const el = $('#hint');
      if (el) {
        const txt = s.settings.hints === false ? null : currentHint(s);
        el.classList.toggle('hidden', !txt);
        if (txt) setHTML(el.querySelector('.hint-t'), txt);
      }
    }
  }
  game.saveTimer += dt;
  if (game.saveTimer > 45) {
    game.saveTimer = 0;
    saveGame(s);
  }
}

// Kamera folgt einem Flugzeug oder Fahrzeug (weich, ohne Ruckeln)
function followCam(s, dt) {
  const f = game.ui.follow;
  if (!f) return;
  const o = f.type === 'veh' ? s.vehicles.find((v) => v.id === f.id) : s.acs.find((a) => a.id === f.id);
  if (!o) {
    game.ui.follow = null;
    return;
  }
  if (f.type === 'ac' && o.mode !== 'map') return;
  const cam = game.cam;
  const k = 1 - Math.pow(0.02, dt);
  cam.x += (o.x - cam.x) * k;
  cam.y += (o.y - cam.y) * k;
  cam.tx = null;
}

// ---------------- HUD ----------------
function updateHUD(force) {
  const s = game.state;
  setHTML($('#hud-day'), `Tag ${dayOf(s.time)}`);
  setHTML($('#hud-time'), fmtClock(s.time));
  const sp = SPEEDS.map((v, i) => `<button data-speed="${v}" class="${s.speed === v ? 'on' : ''}" title="${v ? `${v}-fach – ein Tag dauert ca. ${Math.round(dayMinutes(v))} Minuten` : 'Pause'} (Taste ${i})">${v === 0 ? '❚❚' : v + '×'}</button>`).join('');
  setHTML($('#speeds'), sp);
  const w = WEATHER[s.weather.kind];
  const se = season(s);
  const fc = forecastInfo(s);
  const soon = fc.change && fc.at - s.time < 2 * 3600;
  const WX_ICO = { clear: 'sun', clouds: 'clouds', rain: 'rain', fog: 'fog', storm: 'storm', snow: 'snow' };
  const SE_ICO = { autumn: 'leaf', winter: 'snow', spring: 'sprout', summer: 'sun' };
  setHTML($('#hud-wx'), `<span title="${se.name}">${icon(SE_ICO[se.id] || 'leaf', 'se')}</span> ${icon(WX_ICO[s.weather.kind] || 'sun')} ${w.name} · ${temperature(s).toFixed(0)} °C · ${Math.round(s.wind.dir / 10) * 10}°/${Math.round(s.wind.spd)} kt${soon ? ` <span class="wx-next ${['storm', 'fog', 'snow'].includes(fc.kind) ? 'warn' : ''}" title="Vorhersage: ab ${fmtClock(fc.at)} ${fc.name} (bis etwa ${fmtClock(fc.until)})">→ ${icon(WX_ICO[fc.kind] || 'clouds')} ${fmtClock(fc.at)}</span>` : ''}`);
  setHTML($('#hud-rwy'), `RWY <b>${s.rwy}</b>${s.rwyPending ? ` <span class="pend">→ ${s.rwyPending}</span>` : ''}`);
  const cash = $('#hud-cash');
  setHTML(cash, fmtMoney(s.cash));
  cash.classList.toggle('neg', s.cash < 0);
  setHTML($('#hud-rep'), `${'★'.repeat(Math.max(1, Math.round(s.reputation / 20)))}<small style="color:var(--dim)">${'★'.repeat(5 - Math.max(1, Math.round(s.reputation / 20)))}</small>`);
  const t = s.stats.today;
  const deps = t.onTime + t.delayed;
  setHTML($('#hud-ontime'), deps ? `${Math.round((t.onTime / deps) * 100)} %` : '—');
  const sc = $('#hud-score');
  const showSc = (s.role === 'tower' || s.role === 'ground') && !s.auto[s.role === 'tower' ? 'atc' : 'ground'];
  sc.classList.toggle('hidden', !showSc);
  if (showSc) {
    const S = scoreState(s);
    const hot = S.combo >= 2 ? 'hot' : S.combo > 1 ? 'warm' : '';
    setHTML(sc, `<span class="sc-p">${icon('star')} ${S.today.toLocaleString('de-DE')}</span><span class="sc-c ${hot}">×${S.combo.toFixed(1)}</span>`);
  }
  const G = goalsState(s);
  const next = RANKS[G.rank + 1];
  const pct = next ? Math.round(((G.xp - RANKS[G.rank].xp) / (next.xp - RANKS[G.rank].xp)) * 100) : 100;
  setHTML($('#btn-rank'), `<span class="rk-i">${icon('medal')}</span><span class="rk-t"><b>${RANKS[G.rank].name}</b><i style="--p:${pct}%"></i></span>`);
}

// Anfragen / Konflikte akustisch melden
// Momente des Tages: besondere Szenen automatisch fotografieren (für den Tagesbericht)
const MOMENT_PRIO = { salute: 5, evac: 5, state: 5, a380: 5, emergency: 5, nordo: 4, special: 3, storm: 2, golden: 1, night: 1 };
function watchMoments(s) {
  if (!game.map || s.scenario || (game.photo && game.photo.on) || (game.cinema && game.cinema.on)) return;
  const M = game.moments || (game.moments = []);
  if (M.length >= 8) return;
  const h = hourOf(s.time);
  // Wassertaufe und Evakuierung als Momente des Tages (je Ereignis ein Foto)
  const sal = s.salute;
  if (sal && sal.p && !sal.done && !sal.photo) {
    const ac = s.acs.find((a) => a.id === sal.ac);
    if (ac && Math.hypot(ac.x - sal.p.x, ac.y - sal.p.y) < 1.2) {
      sal.photo = true;
      const img = spotter().capture(ac);
      if (img) return M.push({ kind: 'salute', text: `💦 Wassertaufe für den Erstflug ${ac.cs}`, img, t: s.time, prio: MOMENT_PRIO.salute });
    }
  }
  const ev = s.acs.find((a) => a.emgKind === 'smoke' && a.fireStop && !a.fireDone && s.time - a.fireStop > 70 && !(a.moments && a.moments.includes('evac')));
  if (ev) {
    (ev.moments = ev.moments || []).push('evac');
    const img = spotter().capture(ev);
    if (img) return M.push({ kind: 'evac', text: `🛟 Evakuierung von ${ev.cs} über die Notrutschen`, img, t: s.time, prio: MOMENT_PRIO.evac });
  }
  for (const ac of s.acs) {
    if (ac.mode !== 'map') continue;
    const landing = ac.phase === PH.ROLLOUT && ac.v > 0.12;
    const takeoff = ac.phase === PH.TAKEOFF && ac.z > 0.05 && ac.z < 0.9;
    if (!landing && !takeoff) continue;
    let kind = null, text = '';
    const what = landing ? 'Landung' : 'Start';
    if (ac.protocol) [kind, text] = ['state', `🎖️ ${what} der Regierungsmaschine ${ac.cs}`];
    else if (ac.type === 'A388') [kind, text] = ['a380', `🐋 ${what} des Superjumbos ${ac.cs}`];
    else if (ac.emergency && landing) [kind, text] = ['emergency', `🚨 Notlandung ${ac.cs} – sicher unten`];
    else if (ac.nordo && landing) [kind, text] = ['nordo', `💡 ${ac.cs} landet per Lichtsignal`];
    else if (ac.special) [kind, text] = ['special', `🎨 ${what} in Sonderlackierung – ${ac.cs}`];
    else if (['storm', 'snow', 'fog'].includes(s.weather.kind) && !M.some((m) => m.kind === 'storm')) [kind, text] = ['storm', `${s.weather.kind === 'storm' ? '⛈️' : s.weather.kind === 'snow' ? '🌨️' : '🌫️'} ${what} ${ac.cs} bei ${s.weather.kind === 'storm' ? 'Gewitter' : s.weather.kind === 'snow' ? 'Schneetreiben' : 'Nebel'}`];
    else if ((Math.abs(h - 7.1) < 0.8 || Math.abs(h - 18.5) < 0.8) && s.weather.kind === 'clear' && !M.some((m) => m.kind === 'golden')) [kind, text] = ['golden', `🌅 ${what} ${ac.cs} in der goldenen Stunde`];
    else if ((h < 5.5 || h > 21.5) && !M.some((m) => m.kind === 'night')) [kind, text] = ['night', `🌙 Nacht-${what.toLowerCase()} ${ac.cs}`];
    if (!kind || (ac.moments && ac.moments.includes(kind))) continue;
    (ac.moments = ac.moments || []).push(kind);
    const img = spotter().capture(ac);
    if (img) M.push({ kind, text, img, t: s.time, prio: MOMENT_PRIO[kind] || 1 });
    return; // höchstens ein Foto je Takt
  }
}

function watchAlerts(s) {
  const now = performance.now();
  if (s.role === 'tower') {
    for (const ac of s.acs) {
      if (!ac.req) continue;
      const k = ac.id + ac.req;
      if (!game.seenReq.has(k)) {
        game.seenReq.add(k);
        sfx.request();
      }
    }
    if (game.seenReq.size > 400) game.seenReq = new Set();
  }
  const alarm = s.acs.some((a) => a.conflict || (a.emergency && a.mode === 'air'));
  if (alarm && now - game.lastAlert > 4000 && s.speed > 0) {
    game.lastAlert = now;
    if (s.role === 'tower' || s.acs.some((a) => a.conflict)) sfx.alert();
  }
}

// ---------------- Log & Toasts ----------------
const LOG_FILTER = {
  tower: null,
  ground: ['gnd', 'crew', 'sys', 'mgr'],
  manager: ['mgr', 'sys', 'gnd'],
  observer: null,
};
function addLog(m, silent = false) {
  const s = game.state;
  if (!s) return;
  const f = LOG_FILTER[s.role];
  if (f && !f.includes(m.kind)) return;
  const box = $('#log');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  const d = document.createElement('div');
  d.className = `lg ${m.kind}`;
  d.innerHTML = `<span class="t">${fmtClock(m.t)}</span>${m.from ? `<span class="fr">${esc(m.from)}</span>` : ''}${esc(m.text)}`;
  glossify(d);
  box.appendChild(d);
  while (box.children.length > 90) box.firstChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;
  m._el = d;
  if (!silent && m.kind === 'crew' && s.role === 'ground') {
    if (voice.on) voice.say(m, s.speed);
    else if ((m.prio || 1) >= 2) sfx.radio();
  }
  if (!silent && (m.kind === 'atc' || m.kind === 'pilot')) {
    if (s.role === 'tower' || s.role === 'observer') {
      if (voice.on) voice.say(m, s.speed);
      else sfx.radio();
    }
  }
}
listeners.radio.push((m) => {
  if (game.running) addLog(m);
});
listeners.ach.push((a) => {
  if (game.running) showAchievement(a);
  if (a && a.id) careerAch(a.id);
});
listeners.rank.push((s, rank) => {
  if (!game.running || game.state !== s || s.role === 'observer' || s.scenario) return;
  if (!game.rankUp) game.rankUp = new RankUp(game);
  game.rankUp.show(s, rank);
});
listeners.fx.push((f) => {
  if (game.running && game.map) game.map.addFx(f);
});
listeners.toast.push((t) => {
  if (!game.running) return;
  toast(t.text, t.level);
  if (t.level === 'bad') sfx.alert();
});
hooks.dayEnd.push((rec) => {
  const s = game.state;
  if (!s) return;
  saveGame(s);
  careerDayEnd(s, rec, rateDay(rec));
  showReport(rec);
});

// Tagesbewertung (0–5 Sterne)
function rateDay(rec) {
  let p = rec.onTime >= 95 ? 2 : rec.onTime >= 85 ? 1.5 : rec.onTime >= 75 ? 1 : rec.onTime >= 60 ? 0.5 : 0;
  let safe = rec.incidents === 0 ? 1.5 : rec.incidents === 1 ? 1 : rec.incidents === 2 ? 0.5 : 0;
  safe = Math.max(0, safe - Math.max(0, rec.goArounds - 2) * 0.25 - rec.diversions * 0.5);
  const profit = rec.rev - rec.cost;
  const eco = profit > 200000 ? 1.5 : profit > 0 ? 1 : 0;
  return Math.round((p + safe + eco) * 2) / 2;
}
const GOALS = {
  tower: 'Ziel Tower: keine Staffelungsverstöße, wenige Durchstarts, keine Ausweichlandungen.',
  ground: 'Ziel Vorfeld: mindestens 90 % pünktliche Abflüge.',
  manager: 'Ziel Management: positives Betriebsergebnis, zufriedene Airlines, wachsendes Ansehen.',
  observer: 'Der Flughafen lief heute vollautomatisch.',
};

// rollenspezifische Kennzahlen im Tagesbericht
function reportExtras(rec) {
  const role = game.state.role;
  const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const slots = (rec.slotOk || 0) + (rec.slotMiss || 0);
  const tw = [cell('Slots eingehalten', slots ? `${rec.slotOk}/${slots}` : '—'), cell('Ø Wartezeit Rollhalt', rec.depN ? `${(rec.taxiWait / rec.depN).toFixed(1).replace('.', ',')} min` : '—'), cell('Wirbelschleppen-Verstöße', rec.wakeInf || 0), cell('Minimum Fuel', rec.minFuel || 0)];
  const gd = [cell('Slots verpasst (Abfertigung)', rec.slotMissGnd || 0), cell('Kerosin vertankt', `${(rec.fuelSold || 0).toLocaleString('de-DE')} t`), cell('Durchstarts', rec.goArounds)];
  const mg = [cell('Kerosin-Marge', fmtMoney((rec.revBy && rec.revBy.fuel) || 0)), cell('Kerosineinkauf', fmtMoney(rec.fuelBuy || 0)), cell('Nachtbewegungen', `${rec.nightMov || 0} (${rec.complaints || 0} Beschwerden)`), cell('Pistenzustand', `${rec.rwyCond ?? '—'} %`)];
  const list = role === 'tower' ? tw : role === 'ground' ? gd : role === 'manager' ? mg : [...tw.slice(0, 2), ...mg.slice(0, 2)];
  return list.join('');
}

// Tagesdiagramm: Landungen und Starts je Stunde, dazu Höhepunkte des Tages
function dayChart(rec) {
  if (!rec.arrH && !rec.depH) return '';
  const A = rec.arrH || new Array(24).fill(0), D = rec.depH || new Array(24).fill(0);
  const tot = A.map((a, i) => a + D[i]);
  const max = Math.max(1, ...tot);
  const W = 480, H = 90, bw = W / 24;
  let bars = '';
  for (let i = 0; i < 24; i++) {
    const ha = (A[i] / max) * (H - 14), hd = (D[i] / max) * (H - 14);
    bars += `<rect x="${i * bw + 2}" y="${H - 12 - ha}" width="${bw - 4}" height="${ha}" rx="2" fill="#2dd4bf"><title>${String(i).padStart(2, '0')}:00 · ${A[i]} Landungen, ${D[i]} Starts</title></rect>`;
    bars += `<rect x="${i * bw + 2}" y="${H - 12 - ha - hd}" width="${bw - 4}" height="${hd}" rx="2" fill="#fbbf24"><title>${String(i).padStart(2, '0')}:00 · ${A[i]} Landungen, ${D[i]} Starts</title></rect>`;
    if (i % 3 === 0) bars += `<text x="${i * bw + bw / 2}" y="${H - 1}" text-anchor="middle" font-size="9" fill="#94a3b8">${String(i).padStart(2, '0')}</text>`;
  }
  const peak = tot.indexOf(Math.max(...tot));
  const hi = [];
  if (tot[peak]) hi.push(`🕗 Spitzenstunde ${String(peak).padStart(2, '0')}:00 mit ${tot[peak]} Bewegungen`);
  if (rec.peakDelay) hi.push(`⏱️ Größte Verspätung: ${esc(rec.peakDelay.cs)} +${rec.peakDelay.min} min`);
  if (rec.incidents === 0 && rec.mov > 20) hi.push('🛡️ Kein einziger Vorfall');
  const best = (game.state.history || []).slice(0, -1).reduce((m, r) => Math.max(m, r.mov || 0), 0);
  if (rec.mov > best && best > 0) hi.push(`🏆 Neuer Rekord: ${rec.mov} Bewegungen an einem Tag`);
  return `<div class="day-chart"><div class="dc-h">Verkehr über den Tag <span><i style="background:#2dd4bf"></i>Landungen <i style="background:#fbbf24"></i>Starts</span></div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>${hi.length ? `<div class="dc-hi">${hi.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}</div>`;
}

// die drei besten Momente des Tages als Fotostreifen, danach neu sammeln
function momentsHtml() {
  const M = (game.moments || []).slice().sort((a, b) => b.prio - a.prio || a.t - b.t).slice(0, 3);
  game.moments = [];
  if (!M.length) return '';
  return `<div class="moments"><div class="dc-h">📸 Momente des Tages</div><div class="mo-row">${M.map((m) => `<figure><img src="${m.img}" alt=""><figcaption>${esc(m.text)}<small>${fmtClock(m.t)}</small></figcaption></figure>`).join('')}</div></div>`;
}

function showReport(rec) {
  const prevSpeed = game.state.speed;
  const stars = rateDay(rec);
  const starHtml = Array.from({ length: 5 }, (_, i) => (stars >= i + 1 ? '★' : stars >= i + 0.5 ? '⯪' : '☆')).join('');
  openModal(
    `<h2>📊 Tagesbericht – Tag ${rec.day}</h2>
    <div style="font-size:30px;color:var(--manager);letter-spacing:4px;margin:4px 0 2px" aria-label="${stars} von 5 Sternen">${starHtml}</div>
    <p style="margin:0 0 10px;color:var(--muted)">${GOALS[game.state.role] || ''} · Durchstarts ${rec.goArounds} · Ausweichlandungen ${rec.diversions}</p>
    <div class="report-grid">
      <div><span>Umsatz</span><b>${fmtMoney(rec.rev)}</b></div>
      <div><span>Betriebskosten</span><b>${fmtMoney(rec.cost)}</b></div>
      <div><span>Ergebnis</span><b style="color:${rec.rev - rec.cost >= 0 ? 'var(--good)' : 'var(--bad)'}">${fmtMoney(rec.rev - rec.cost)}</b></div>
      <div><span>Bewegungen</span><b>${rec.mov}</b></div>
      <div><span>Passagiere</span><b>${rec.pax.toLocaleString('de-DE')}</b></div>
      <div><span>Pünktlichkeit</span><b>${rec.onTime} %</b></div>
      <div><span>Investitionen</span><b>${fmtMoney(rec.capex)}</b></div>
      <div><span>Vorfälle</span><b>${rec.incidents}</b></div>
      <div><span>Ansehen</span><b>${rec.rep}/100</b></div>
      ${reportExtras(rec)}
    </div>
    ${dayChart(rec)}
    ${highlightsHtml(game.state, rec)}
    ${newspaperHtml(game.state, rec)}
    ${momentsHtml()}
    ${rec.score && (game.state.role === 'tower' || game.state.role === 'ground') ? `<p class="rep-score">⭐ Schichtpunkte heute: <b>${rec.score.toLocaleString('de-DE')}</b>${rec.score >= rec.scoreBest ? ' · <span>neuer Tagesbestwert!</span>' : ` · Bestwert ${rec.scoreBest.toLocaleString('de-DE')}`}</p>` : ''}
    ${rec.xp ? `<p style="margin:10px 0 0;color:var(--muted)">🏅 +${rec.xp} XP für den Tag · ${RANKS[goalsState(game.state).rank].name} (${goalsState(game.state).xp} XP)</p>` : ''}
    <div class="modal-acts"><button class="btn btn-primary" data-close-modal>Weiter</button></div>`,
    (box) => box.querySelector('[data-close-modal]').addEventListener('click', () => {
      closeModal();
      game.state.speed = prevSpeed;
      if (game.state.board && game.state.board.pending) return showBoard(prevSpeed);
      showBriefing(prevSpeed);
    })
  );
}

// Aufsichtsratssitzung (Manager, alle 7 Tage): Ergebnis, Vertrauen, Strategie für die nächste Woche
function showBoard(resume) {
  const s = game.state;
  const res = s.board && s.board.pending;
  if (!res) return showBriefing(resume);
  s.speed = 0;
  let pick = s.board.strategy;
  openModal(boardMeetingHtml(s, res), (box) => {
    box.querySelectorAll('[data-strat]').forEach((b) =>
      b.addEventListener('click', () => {
        pick = b.dataset.strat;
        box.querySelectorAll('[data-strat]').forEach((x) => x.classList.toggle('on', x === b));
        sfx.click();
      })
    );
    box.querySelector('[data-close-modal]').addEventListener('click', () => {
      chooseStrategy(s, pick);
      closeModal();
      s.speed = resume;
      if (res.bonus) sfx.cash && sfx.cash();
      toast(`🏛️ Strategie „${STRATEGIES[pick].name}“ beschlossen – neue Wochenziele in der Management-Zentrale`, 'info', 3200);
      showBriefing(resume);
    });
  });
}

// Schichtbriefing (Tower, Vorfeld, Management) – pausiert, bis die Schicht beginnt
const tutSeen = (role) => {
  try {
    return !!localStorage.getItem('planez_tut_' + role);
  } catch (e) {
    return true;
  }
};
function showBriefing(resume) {
  const s = game.state;
  if (!s || s.scenario || !['tower', 'ground', 'manager'].includes(s.role) || loadPrefs().briefing === false) return;
  if (game.tutorial && game.tutorial.on) return;
  s.speed = 0;
  openModal(briefingHtml(s), (box) => {
    box.querySelector('[data-close-modal]').addEventListener('click', () => {
      if (box.querySelector('[data-brief-off]')?.checked) {
        savePrefs({ briefing: false });
        toast('Schichtbriefing ausgeschaltet – im Hauptmenü unter Einstellungen wieder einschaltbar', 'info', 3500);
      }
      closeModal();
      s.speed = resume || 1;
      if (s.settings.sound !== false) sfx.select && sfx.select();
    });
  });
}
game.showBriefing = () => showBriefing(game.state && (game.state.speed || lastSpeed || 1));

// ---------------- Eingabe ----------------
function wireGame() {
  window.addEventListener('resize', resize);
  const canvas = $('#map');
  const pointers = new Map();
  let down = null;
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    unlock();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: game.cam.zoom };
      down = null;
    } else {
      down = { x: e.offsetX, y: e.offsetY, lx: e.offsetX, ly: e.offsetY, moved: false, btn: e.button, cx: e.clientX, cy: e.clientY };
      // langes Drücken (Touch) = Markieren
      if (e.pointerType === 'touch') {
        const d0 = down;
        d0.lp = setTimeout(() => {
          if (down !== d0 || d0.moved) return;
          const p = game.map.pick(d0.x, d0.y, ['ac']);
          if (!p) return;
          d0.longpress = true;
          game.select(p.id, 'map');
          openMarkMenu(game, p.id, d0.cx, d0.cy);
        }, 550);
      }
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (p) {
      p.x = e.offsetX;
      p.y = e.offsetY;
    }
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const f = (pinch.z * (d / pinch.d)) / game.cam.zoom;
      game.cam.zoomAt(f, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (down) {
      const dx = e.offsetX - down.lx, dy = e.offsetY - down.ly;
      if (Math.hypot(e.offsetX - down.x, e.offsetY - down.y) > 5) {
        down.moved = true;
        canvas.classList.add('dragging');
      }
      if (down.moved) {
        game.cam.panBy(dx, dy);
        game.ui.follow = null;
      }
      down.lx = e.offsetX;
      down.ly = e.offsetY;
      return;
    }
    hover(e.offsetX, e.offsetY);
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (pointers.size < 2) pinch = null;
    if (down) clearTimeout(down.lp);
    if (down && !down.moved && !down.longpress && down.btn !== 2) clickMap(e.offsetX, e.offsetY);
    down = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => ($('#tooltip').style.display = 'none'));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    game.cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = game.map.pick(e.offsetX, e.offsetY, ['ac']);
    if (!p) return;
    game.select(p.id, 'map');
    openMarkMenu(game, p.id, e.clientX, e.clientY);
  });
  initMarkMenu(game);

  // Radar
  const rc = $('#radar');
  rc.addEventListener('click', (e) => {
    const id = game.radar.pick(e.offsetX, e.offsetY);
    if (id) game.select(id, 'map');
    else game.select(null);
  });
  rc.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const id = game.radar.pick(e.offsetX, e.offsetY);
    if (!id) return;
    game.select(id, 'map');
    openMarkMenu(game, id, e.clientX, e.clientY);
  });
  $('#radar-leg').addEventListener('click', () => $('#radar-legend').classList.toggle('hidden'));
  $('#radar-legend .rl-x').addEventListener('click', () => $('#radar-legend').classList.add('hidden'));
  glossify($('#radar-legend'));
  $('#radar-mf').addEventListener('click', () => {
    game.ui.markFilter = !game.ui.markFilter;
    $('#radar-mf').classList.toggle('on', game.ui.markFilter);
    toast(game.ui.markFilter ? 'Radar: nur markierte Flüge hervorgehoben' : 'Radar: alle Flüge normal', 'info', 1800);
  });
  $('#radar-seq').addEventListener('click', (e) => {
    const c = e.target.closest('[data-id]');
    if (c) game.select(c.dataset.id, true);
  });
  $('#radar-big').addEventListener('click', () => {
    game.ui.radarBig = !game.ui.radarBig;
    const w = $('#radar-wrap');
    w.classList.toggle('big', game.ui.radarBig);
    // Tower-Fenster: groß als Overlay über der Karte, klein zurück ins Fenster
    const slot = $('#tw-radar-slot');
    if (slot) (game.ui.radarBig ? $('#game') : slot).appendChild(w);
    $('#game').classList.toggle('radar-big', game.ui.radarBig);
    resize();
  });
  $('#radar-rng').addEventListener('click', () => {
    const r = game.radar;
    r.range = r.range === 48 ? 25 : r.range === 25 ? 15 : 48;
  });

  // HUD
  $('#speeds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (b) setSpeed(Number(b.dataset.speed));
  });
  $('#btn-role').addEventListener('click', showRoleModal);
  $('#btn-menu').addEventListener('click', showGameMenu);
  $('#panel-toggle').addEventListener('click', togglePanel);
  $('#z-in').addEventListener('click', () => game.cam.zoomAt(1.25, game.cam.w / 2, game.cam.h / 2));
  $('#z-out').addEventListener('click', () => game.cam.zoomAt(0.8, game.cam.w / 2, game.cam.h / 2));
  $('#t-noise').addEventListener('click', () => {
    game.ui.noise = !game.ui.noise;
    $('#t-noise').classList.toggle('on', game.ui.noise);
    const s = game.state;
    if (game.ui.noise && s) {
      const night = isNight(s);
      toast(`🔉 Lärmkarte: rot ≥ 65 dB, orange ≥ 60 dB, gelb ≥ 55 dB – ${s.stats.today.complaints || 0} Beschwerden heute${night ? ' · nachts sind die Zonen größer' : ''}${s.settings.curfew ? ' · Nachtflugverbot aktiv' : ''}`, 'info', 4200);
    }
  });
  $('#t-labels').addEventListener('click', () => {
    game.ui.labels = !game.ui.labels;
    $('#t-labels').classList.toggle('on', game.ui.labels);
  });
  $('#t-labels').classList.add('on');
  $('#t-radar').addEventListener('click', () => toggleRadar(!game.ui.radarOn));
  $('#t-help').addEventListener('click', () => showHelp(false));
  $('#t-spot').addEventListener('click', () => spotter().toggle());
  $('#t-fids').addEventListener('click', () => {
    if (!game.fids) game.fids = new Fids(game);
    game.fids.toggle();
  });
  $('#t-photo').addEventListener('click', () => {
    if (!game.photo) game.photo = new PhotoMode(game);
    game.photo.toggle();
  });
  $('#t-tower3d').addEventListener('click', () => {
    if (!game.state) return;
    if (!game.ride) game.ride = new Ride(game);
    if (game.cinema && game.cinema.on) game.cinema.stop();
    if (game.ride.on && game.ride.mode === 'tower') game.ride.stop();
    else game.ride.startTower();
  });
  $('#t-cine').addEventListener('click', () => {
    if (!game.cinema) game.cinema = new Cinema(game);
    game.cinema.toggle();
  });
  $('#t-gloss').addEventListener('click', () => showHelp(false, 'gloss'));
  $('#btn-rank').addEventListener('click', showGoals);
  // Echter Funk: Lautsprecher-Schalter, Sendelampe, hervorgehobene Zeile, Sprechtaste
  $('#voice-t').addEventListener('click', () => {
    const s = game.state;
    if (!s) return;
    s.settings.tts = !s.settings.tts;
    savePrefs({ tts: s.settings.tts });
    syncVoice();
    toast(s.settings.tts ? (s.role === 'ground' ? '🔊 Betriebsfunk an – die Bodencrews melden sich' : '🔊 Echter Funk an – Lotse und Piloten sprechen') : '🔇 Funk stumm', 'info', 2200);
  });
  let spokenEl = null;
  voice.listeners.push((cur) => {
    const rx = $('#rx');
    if (spokenEl) spokenEl.classList.remove('speaking');
    spokenEl = null;
    if (cur) {
      rx.className = `rx on ${cur.kind}`;
      rx.textContent = cur.kind === 'atc' ? 'TWR' : cur.from || '';
      if (cur._el) {
        spokenEl = cur._el;
        spokenEl.classList.add('speaking');
      }
    } else {
      rx.className = 'rx';
      rx.textContent = '';
    }
  });
  initPTT(game);
  $('#log-toggle').addEventListener('click', () => {
    const w = $('#log-wrap');
    w.classList.toggle('min');
    $('#log-toggle').textContent = w.classList.contains('min') ? '+' : '–';
  });

  // Panel: während Klicks nicht neu zeichnen
  const panel = $('#panel');
  panel.addEventListener('pointerdown', () => (game.panelHold = true));
  window.addEventListener('pointerup', () => setTimeout(() => (game.panelHold = false), 60));

  // Info-Karte
  const info = $('#info');
  // Mitfliegen schon beim Drücken auslösen: im Anflug wird die Karte laufend neu gezeichnet, ein Klick ginge sonst verloren
  info.addEventListener('pointerdown', (e) => {
    const rd = e.target.closest('[data-ride]');
    if (!rd || !game.state) return;
    e.preventDefault();
    const [mode, id] = rd.dataset.ride.split(':');
    if (!game.ride) game.ride = new Ride(game);
    if (game.cinema && game.cinema.on) game.cinema.stop();
    game.ride.start(id, mode);
    info._html = null;
  });
  info.addEventListener('click', (e) => {
    const s = game.state;
    if (e.target.closest('[data-close]')) return game.select(null);
    const fo = e.target.closest('[data-follow]');
    if (fo) {
      const [type, id] = fo.dataset.follow.split(':');
      game.ui.follow = game.ui.follow && game.ui.follow.id === id ? null : { type, id };
      if (game.ui.follow) toast('🎥 Kamera folgt – Karte ziehen oder erneut klicken beendet', 'info', 2200);
      info._html = null;
      return;
    }
    const rbf = e.target.closest('[data-rbfix]');
    if (rbf) {
      fixReadback(game, s.acs.find((a) => a.id === rbf.dataset.rbfix));
      info._html = null;
      return;
    }
    if (e.target.closest('[data-ride]')) return; // schon bei pointerdown erledigt
    const sp = e.target.closest('[data-spot]');
    if (sp) {
      spotter().shoot(s.acs.find((a) => a.id === sp.dataset.spot));
      info._html = null;
      return;
    }
    const c = e.target.closest('[data-cmd]');
    if (c) {
      const ac = s.acs.find((a) => a.id === c.dataset.ac);
      const r = ac ? guardedCommand(s, ac, c.dataset.cmd) : { ok: false, msg: '' };
      if (r.held) return;
      if (!r.ok && r.msg) toast(r.msg, 'warn');
      else sfx.click();
      info._html = null;
      return;
    }
    const im = e.target.closest('[data-imark]');
    if (im) {
      const ac = s.acs.find((a) => a.id === im.dataset.ac);
      if (ac) im.dataset.imark === 'x' ? clearMark(ac) : setMark(ac, im.dataset.imark);
      info._html = null;
      game.refreshUi();
      return;
    }
    const imm = e.target.closest('[data-imarkmenu]');
    if (imm) {
      openMarkMenu(game, imm.dataset.imarkmenu, e.clientX, e.clientY - 180);
      return;
    }
    const d = e.target.closest('[data-disp]');
    if (d) {
      const ac = s.acs.find((a) => a.id === d.dataset.ac);
      const r = ac ? dispatch(s, ac, d.dataset.disp) : { ok: false };
      if (!r.ok && r.msg) toast(r.msg, 'warn');
      else sfx.click();
      return;
    }
    const a = e.target.closest('[data-act]');
    if (a) {
      const v = a.dataset.v;
      if (a.dataset.act === 'pshow') return game.showSite(v);
      if (a.dataset.act === 'pcancel') {
        const u = game.ui;
        if (u.armP !== v || performance.now() - u.armT > 5000) {
          u.armP = v;
          u.armT = performance.now();
        } else {
          u.armP = null;
          if (cancelProject(s, v) > 0) sfx.click();
          u.sel = null;
        }
        info._html = null;
        return;
      }
      const fn = { stand: () => EC.buildStand(s, Number(v)), standL: () => EC.upgradeStand(s, Number(v)), up: () => EC.buyUpgrade(s, v) }[a.dataset.act];
      if (fn && fn()) sfx.cash();
      info._html = null;
    }
  });
  info.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-assign]');
    if (!sel) return;
    const s = game.state;
    const ac = s.acs.find((x) => x.id === sel.dataset.assign);
    if (ac && sel.value) assignStand(s, ac, Number(sel.value)) ? sfx.click() : toast('Position nicht verfügbar', 'warn');
    sel.blur();
  });

  // Tooltips für [data-tip]
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    const tip = $('#tooltip');
    if (t) {
      tip.textContent = t.getAttribute('data-tip');
      tip.style.display = 'block';
    } else if (e.target.id !== 'map') tip.style.display = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    const tip = $('#tooltip');
    if (tip.style.display === 'block') {
      tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 14) + 'px';
      tip.style.top = e.clientY + 16 + 'px';
    }
  });

  // Tastatur
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', () => soundscape.unlock(), { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state && game.running) saveGame(game.state);
  });
}

const keys = new Set();
window.addEventListener('keyup', (e) => keys.delete(e.key));
function keyPan(dt) {
  const v = 520 * dt;
  if (keys.has('ArrowLeft')) game.cam.panBy(v, 0);
  if (keys.has('ArrowRight')) game.cam.panBy(-v, 0);
  if (keys.has('ArrowUp')) game.cam.panBy(0, v);
  if (keys.has('ArrowDown')) game.cam.panBy(0, -v);
}

let lastSpeed = 1;
function setSpeed(v) {
  const s = game.state;
  if (v > 0) lastSpeed = v;
  s.speed = v;
  updateHUD();
}

function onKey(e) {
  if (game.replay && game.replay.on && (e.key === 'Escape' || e.key === ' ')) {
    e.preventDefault();
    return game.replay.stop();
  }
  if (e.key === 'R' && e.shiftKey && game.state && game.running && !modalOpen() && !(game.cinema && game.cinema.on)) {
    e.preventDefault();
    if (!game.replay) game.replay = new Replay(game);
    if (game.replay.on) return game.replay.stop();
    return game.replay.play(game.replay.offerUntil ? game.replay.offerAc : null, game.replay.offerUntil ? game.replay.offerText : '');
  }
  if (game.photo && game.photo.on && e.key === 'Escape') {
    e.preventDefault();
    return game.photo.stop();
  }
  if (e.key === 'P' && e.shiftKey && game.state && game.running && !modalOpen()) {
    e.preventDefault();
    if (!game.photo) game.photo = new PhotoMode(game);
    return game.photo.toggle();
  }
  if (game.cinema && game.cinema.on) {
    if (e.key === 'Escape' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      return game.cinema.stop();
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      return game.cinema.next(true);
    }
    if (e.key === ' ') {
      e.preventDefault();
      return;
    }
  }
  if ((e.key === 'k' || e.key === 'K') && game.state && game.running && !modalOpen() && !(e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName))) {
    if (!game.cinema) game.cinema = new Cinema(game);
    return game.cinema.toggle();
  }
  if (!game.running || !game.state) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
  const s = game.state;
  if (modalOpen()) {
    // Briefing/Tagesbericht mit Esc schließen = wie „Weiter“ (Tempo zurück, Briefing folgt)
    if (e.key === 'Escape' || (e.key === 'Enter' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName) && document.querySelector('#modal-box [data-close-modal]'))) {
      const b = document.querySelector('#modal-box .modal-acts [data-close-modal]');
      if (b) b.click();
      else closeModal();
    }
    return;
  }
  if (e.key.startsWith('Arrow')) {
    keys.add(e.key);
    e.preventDefault();
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    setSpeed(s.speed ? 0 : lastSpeed);
    return;
  }
  if (/^[0-5]$/.test(e.key)) {
    setSpeed(SPEEDS[Number(e.key)]);
    return;
  }
  if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey) {
    if (!game.fids) game.fids = new Fids(game);
    return game.fids.toggle();
  }
  if ((e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey) return spotter().toggle();
  if ((e.key === 'l' || e.key === 'L') && s.role !== 'tower' && !e.ctrlKey && !e.metaKey) return toggleStream();
  if ((e.key === 'f' || e.key === 'F') && s.role !== 'tower' && !e.ctrlKey && !e.metaKey) {
    const ac = game.ui.selected && s.acs.find((a) => a.id === game.ui.selected);
    if (!ac) return toast('📷 Erst ein Flugzeug anklicken, dann F zum Spotten', 'info', 1800);
    return spotter().shoot(ac);
  }
  if (e.key === '?') {
    return openModal(keysHtml(s.role), (box) => box.querySelector('[data-close-modal]').addEventListener('click', closeModal));
  }
  if (e.key === '+' || e.key === '=') return game.cam.zoomAt(1.2, game.cam.w / 2, game.cam.h / 2);
  if (e.key === '-') return game.cam.zoomAt(0.83, game.cam.w / 2, game.cam.h / 2);
  if (e.key === 'Escape') {
    if (markMenuOpen()) return closeMarkMenu();
    if (game.spot && game.spot.isOpen()) return game.spot.toggle(false);
    if (game.fids && game.fids.isOpen()) return game.fids.toggle(false);
    if (game.ui.sel) return game.select(null);
    return showGameMenu();
  }
  if ((e.key === 'o' || e.key === 'O') && (s.role === 'manager' || s.role === 'observer')) return game.mgmt && game.mgmt.toggle();
  if (e.key === 'm' || e.key === 'M') {
    const ac = game.ui.selected && s.acs.find((a) => a.id === game.ui.selected);
    if (!ac) return toast('Erst ein Flugzeug auswählen, dann M zum Markieren', 'info', 1800);
    if (e.shiftKey) clearMark(ac);
    else cycleMark(ac);
    toast(ac.mark ? `⚑ ${ac.cs} markiert: ${MARKS[ac.mark.c].name}` : `${ac.cs}: Markierung entfernt`, 'info', 1400);
    game.refreshUi();
    return;
  }
  if ((e.key === 'g' || e.key === 'G') && s.role === 'ground' && !e.ctrlKey && !e.metaKey) {
    if (!game.splan) game.splan = new StandPlan(game);
    return game.splan.toggle();
  }
  // Y: offenen Wetter-Umweg genehmigen (ausgewähltes Flugzeug zuerst, sonst die älteste Anfrage)
  if ((e.key === 'y' || e.key === 'Y') && s.role === 'tower' && !s.auto.atc && !e.ctrlKey && !e.metaKey) {
    const selAc = game.ui.selected && s.acs.find((a) => a.id === game.ui.selected);
    const t = selAc && selAc.wxReq ? selAc : s.acs.filter((a) => a.wxReq).sort((a, b) => a.wxReq.t - b.wxReq.t)[0];
    if (!t) {
      // sonst: Nebenverkehr freigeben – Hubschrauber vor Cessna vor Pistenkontrolle
      const side = s.heli && s.heli.h && s.heli.h.st === 'req' ? 'heli' : s.vfr && s.vfr.p && s.vfr.p.req && !s.vfr.p.clr ? 'vfr' : s.insp && s.insp.req ? 'insp' : null;
      if (!side) return toast('Keine Anfrage offen (Umweg, Heli, Touch and Go, Pistenkontrolle)', 'info', 1800);
      const r = side === 'heli' ? approveHeli(s) : side === 'vfr' ? clearVfr(s) : approveInspection(s);
      if (r.ok) sfx.click();
      const what = { heli: '🚁 Rescue 7 quert', vfr: `🛩️ ${s.vfr.p ? s.vfr.p.cs : 'Cessna'}: Touch and Go frei`, insp: '🚙 Pistenkontrolle frei' }[side];
      toast(r.bad ? `⚠ ${what} – Konflikt mit dem Linienverkehr!` : r.soft ? `${what} – knapp, ${r.soft.ac.cs} ist ${r.soft.why}` : what, r.bad ? 'bad' : r.soft ? 'warn' : 'good', 2400);
      game.refreshUi && game.refreshUi();
      return;
    }
    const r = command(s, t, 'wxOk');
    if (r.ok) {
      sfx.click();
      toast(`⛈️ ${t.cs}: Umweg genehmigt`, 'good', 2000);
    }
    game.refreshUi && game.refreshUi();
    return;
  }
  if ((e.key === 'q' || e.key === 'Q') && s.role === 'tower' && !e.ctrlKey && !e.metaKey) {
    fixReadback(game, game.ui.selected && s.acs.find((a) => a.id === game.ui.selected));
    game.refreshUi && game.refreshUi();
    return;
  }
  if ((s.role === 'tower' || s.role === 'ground') && game.panel.key && !e.ctrlKey && !e.metaKey && game.panel.key(e, s)) return;
  const k = e.key.toLowerCase();
  if (k === 'b') {
    game.ui.labels = !game.ui.labels;
    $('#t-labels').classList.toggle('on', game.ui.labels);
  } else if (k === 'f') {
    if (!game.ui.radarOn) toggleRadar(true);
    else $('#radar-big').click();
  } else if (k === 'n' || e.key === 'Tab') {
    e.preventDefault();
    nextRequest();
  }
}

// Nächstes Flugzeug mit offener Anfrage auswählen
function nextRequest() {
  const s = game.state;
  const list = s.acs.filter((a) => a.req || a.wxReq || a.emergency).sort((a, b) => (a.reqT || 0) - (b.reqT || 0));
  if (!list.length) return toast('Keine offenen Anfragen', 'info', 1500);
  const i = list.findIndex((a) => a.id === game.ui.selected);
  game.select(list[(i + 1) % list.length].id, true);
}

function hover(x, y) {
  const p = game.map.pick(x, y);
  const tip = $('#tooltip');
  game.ui.hoverStand = p && p.type === 'stand' ? p.id : null;
  if (!p) {
    tip.style.display = 'none';
    return;
  }
  const s = game.state;
  let txt = '';
  if (p.type === 'ac') {
    const ac = s.acs.find((a) => a.id === p.id);
    if (ac) txt = `${ac.cs} · ${AC_TYPES[ac.type].name}`;
  } else if (p.type === 'veh') {
    const v = s.vehicles.find((a) => a.id === p.id);
    if (v) txt = v.name;
  } else if (p.type === 'stand') {
    const sel = game.ui.sel && game.ui.sel.type === 'ac' ? s.acs.find((a) => a.id === game.ui.sel.id) : null;
    const st = s.stands.find((q) => q.id === p.id);
    txt = `Position ${p.id}`;
    if (sel && s.role === 'ground' && sel.arr && !sel.ta && st) txt += standFits(st, sel) && (standFree(st) || sel.stand === st.id) ? ` · Klick: ${sel.cs} zuweisen` : ' · passt nicht / belegt';
  } else if (p.type === 'building') {
    const b = LY.BUILDINGS.find((q) => q.id === p.id);
    if (b) txt = b.name;
  } else if (p.type === 'site') {
    const q = projects(s).find((x) => x.id === p.id);
    if (q) txt = `🏗️ ${q.name} · ${q.status === 'waiting' ? 'wartet' : Math.floor(q.prog * 100) + ' %'}`;
  }
  if (!txt) return;
  tip.textContent = txt;
  tip.style.display = 'block';
  const r = $('#map').getBoundingClientRect();
  tip.style.left = r.left + x + 14 + 'px';
  tip.style.top = r.top + y + 16 + 'px';
}

function clickMap(x, y) {
  const s = game.state;
  const p = game.map.pick(x, y);
  if (!p) return game.select(null);
  if (p.type === 'ac') return game.select(p.id, 'map');
  if (p.type === 'stand') {
    // Vorfeld: ausgewähltes Flugzeug dieser Position zuweisen
    const selAc = game.ui.sel && game.ui.sel.type === 'ac' ? s.acs.find((a) => a.id === game.ui.sel.id) : null;
    if (selAc && s.role === 'ground' && selAc.arr && !selAc.ta && selAc.phase !== PH.TAXI_IN) {
      if (assignStand(s, selAc, p.id)) {
        sfx.click();
        toast(`${selAc.cs} → Position ${p.id}`, 'good', 1800);
      } else toast('Position passt nicht oder ist belegt', 'warn');
      return;
    }
    game.ui.sel = { type: 'stand', id: p.id };
    game.ui.selected = null;
    return;
  }
  game.ui.sel = { type: p.type, id: p.id };
  game.ui.selected = null;
}

// ---------------- Layout ----------------
function resize() {
  const dpr = Math.min(Q.dprCap, window.devicePixelRatio || 1);
  if (game.map) game.map.resize(window.innerWidth, window.innerHeight, dpr);
  if (game.radar) {
    const wrap = $('#radar-wrap');
    const w = wrap.clientWidth || 360;
    const docked = !game.ui.radarBig && wrap.closest('#tw-radar-slot');
    const h = game.ui.radarBig ? Math.min(w, window.innerHeight - 140) : docked ? Math.round(Math.min(w, Math.max(200, window.innerHeight - 480))) : w;
    game.radar.resize(w, h, dpr);
  }
}
function toggleRadar(on) {
  game.ui.radarOn = on;
  $('#radar-wrap').classList.toggle('hidden', !on);
  $('#t-radar').classList.toggle('on', on);
  resize();
}
function togglePanel() {
  const p = $('#panel');
  p.classList.toggle('collapsed');
  const c = p.classList.contains('collapsed');
  $('#panel-toggle').classList.toggle('collapsed', c);
  $('#panel-toggle').textContent = c ? '⟨' : '⟩';
  $('#map-ctrls').classList.toggle('full', c);
}

// ---------------- Modals ----------------
function showRoleModal() {
  const s = game.state;
  if (s.scenario && !s.scenario.done) return toast('In einer Herausforderung bleibt die Station fest', 'info', 2500);
  const img = { tower: 'role_tower.jpg', ground: 'role_ground.jpg', manager: 'role_manager.jpg', observer: 'title.jpg' };
  openModal(
    `<h2>Station wechseln</h2><p>Deine Station übernimmst du selbst – alle anderen Bereiche laufen automatisch weiter.</p>
    <div class="role-pick">${Object.entries(ROLES)
      .map(([k, r]) => `<button data-r="${k}" class="${k === s.role ? 'cur' : ''}"><img src="assets/ui/${img[k]}" alt="" /><div><div class="rp-t">${r.icon} ${r.name}</div><div class="rp-d">${r.desc}</div></div></button>`)
      .join('')}</div>
    <div class="modal-acts"><button class="btn" data-x>Abbrechen</button></div>`,
    (box) => {
      box.querySelector('[data-x]').addEventListener('click', closeModal);
      box.querySelectorAll('[data-r]').forEach((b) =>
        b.addEventListener('click', () => {
          setRole(s, b.dataset.r);
          closeModal();
          applyRole();
          toast(`Du bist jetzt: ${ROLES[s.role].name}`, 'good');
        })
      );
    }
  );
}

function showGameMenu() {
  const s = game.state;
  const prefsSync = () => savePrefs({ sound: !!s.settings.sound, ambience: s.settings.ambience !== false, tts: !!s.settings.tts, glossary: s.settings.glossary !== false, hints: s.settings.hints !== false });
  showPauseMenu(game, {
    settings: () => ({ perf: Q.perf, gameMusic: loadPrefs().gameMusic !== false, bigText: !!loadPrefs().bigText, cbMode: !!loadPrefs().cbMode, calm: !!loadPrefs().calm, sound: !!s.settings.sound, ambience: s.settings.ambience !== false, tts: !!s.settings.tts, glossary: s.settings.glossary !== false, hints: s.settings.hints !== false, labels: game.ui.labels }),
    toggle: (k) => {
      if (k === 'perf') {
        Q.perf = !Q.perf;
        savePrefs({ perf: Q.perf });
        resize();
        return;
      }
      if (k === 'gameMusic') {
        savePrefs({ gameMusic: loadPrefs().gameMusic === false });
        syncGameMusic();
        return;
      }
      if (k === 'bigText' || k === 'cbMode' || k === 'calm') {
        savePrefs({ [k]: !loadPrefs()[k] });
        applyA11y();
        resize();
        return;
      }
      if (k === 'labels') {
        game.ui.labels = !game.ui.labels;
        $('#t-labels').classList.toggle('on', game.ui.labels);
        return;
      }
      s.settings[k] = k === 'hints' || k === 'glossary' || k === 'ambience' ? s.settings[k] === false : !s.settings[k];
      setSound(s.settings.sound);
      syncVoice();
      setGlossaryEnabled(s.settings.glossary !== false);
      prefsSync();
      syncGameMusic();
    },
    save: () => {
      saveGame(s);
      toast('💾 Gespeichert', 'good', 1500);
    },
    role: () => showRoleModal(),
    goals: () => showGoals(),
    help: () => showHelp(false),
    tutorial: () => {
      if (!game.tutorial) game.tutorial = new Tutorial(game);
      game.tutorial.start();
    },
    gloss: () => showHelp(false, 'gloss'),
    quit: () => quitToMenu(),
  });
}

function toggleStream() {
  if (!game.stream) game.stream = new Stream(game);
  game.stream.toggle();
}

function quitToMenu() {
  if (game.state) saveGame(game.state);
  if (game.mgmt) game.mgmt.close();
  if (game.scn) game.scn.hide();
  if (game.cinema && game.cinema.on && game.cinema.stop) game.cinema.stop();
  if (game.stream && game.stream.on) game.stream.stop();
  if (game.replay && game.replay.on) game.replay.stop();
  closeModal();
  game.running = false;
  showMenu();
}

function helpGuide(first) {
  return `<p>Du leitest eine Station am Flughafen – alles andere erledigen KI-Kollegen automatisch. Die Station kannst du jederzeit oben rechts wechseln. <b>Unterstrichene Abkürzungen</b> erklären sich beim Überfahren (Handy: antippen), <b>?</b> neben Abschnitten erklärt den Abschnitt, 📖 öffnet das Glossar.</p>
    <h3>🎧 Tower-Lotse</h3>
    <ul>
      <li><b>Anflug frei</b> <kbd>A</kbd> schickt Anflüge vom Fix (z.B. NOLTA) auf den Endanflug. Halte mindestens <b>3 NM</b> Abstand (auf dem Radar sichtbar) – nutze Geschwindigkeiten und <b>Warteschleife</b> <kbd>H</kbd>. Im Warteschleifen-Stapel zuerst den Untersten freigeben.</li>
      <li><b>Wirbelschleppen:</b> hinter schweren Flugzeugen (H) mehr Abstand: H→H 4 NM, H→M 5 NM, H→L 6 NM, M→L 5 NM. Die Pistenfolge zeigt „Soll“ und warnt 🌀. Bei Starts warten Piloten hinter einem Heavy bis zu 2 Minuten – plane Heavys möglichst hintereinander.</li>
      <li><b>Treibstoff:</b> jeder Anflug hat nur begrenzt Reserve (⛽ Minuten auf dem Streifen). Unter 12 min meldet er MINIMUM FUEL, unter 5 min MAYDAY FUEL (Notfall), bei 0 weicht er aus. Lange Warteschleifen kosten also Treibstoff.</li>
      <li><b>Landefreigabe</b> <kbd>L</kbd> nur bei freier Piste – sonst startet der Flieger durch. Ohne Freigabe bei 1 NM: Durchstarten. Bei Sperrung (FOD-Kontrolle, Bauarbeiten) gibt es keine Freigaben.</li>
      <li><b>Slots (A-CDM):</b> manche Abflüge haben einen <b>CTOT</b> – Start nur im Fenster −5/+10 min. Meldet sich so ein Flug zu früh zum Pushback, sag <b>Warten bis TSAT</b> <kbd>E</kbd>: dann schiebt er erst zur TSAT und wartet nicht mit laufenden Triebwerken am Rollhalt. Verpasste Slots kosten Ansehen und Airline-Zufriedenheit.</li>
      <li>Am Boden: <b>Rollen zur Position</b> <kbd>R</kbd>, <b>Pushback</b> <kbd>P</kbd>, <b>Rollen zum Rollhalt</b> <kbd>R</kbd>, <b>Line up</b> <kbd>U</kbd>, <b>Startfreigabe</b> <kbd>T</kbd>, <b>Halt</b> <kbd>X</kbd>.</li>
      <li><b>🛡️ Sicherheitsnetz:</b> Wäre eine Freigabe gerade gefährlich – Landung auf eine belegte Bahn, Start oder Line-up, während jemand im kurzen Endanflug ist oder mit Landefreigabe kurz davor –, ist der Knopf rot mit ⚠ markiert (Grund im Tooltip). Der erste Druck gibt nur einen Warnton und Hinweis; erst ein zweiter Druck innerhalb von vier Sekunden erteilt die Freigabe trotzdem. Per Sprechtaste fragt der Pilot zurück („confirm cleared for take-off? We have traffic on short final.“) – erst die wiederholte Freigabe gilt.</li>
      <li><b>Echter Funk:</b> Lotse und Piloten sprechen (🔊 im Funkfenster, jedes Flugzeug mit eigener Stimme, Funkrauschen, eine Frequenz – niemand spricht gleichzeitig). <b>Sprechtaste:</b> <kbd>V</kbd> gedrückt halten (oder 🎙) und auf Englisch funken, z.&nbsp;B. „Aurora five four two, runway two seven, cleared to land“, „Rheinjet four one two, line up and wait“, „… cleared for take-off“, „… cleared ILS approach“, „… hold as published“, „… reduce speed one six zero“, „… taxi to stand“, „… pushback approved“. Auch der Nebenverkehr hört aufs Wort: „Rescue seven, cross runways“ / „… hold south“, die Cessna mit ihrem abgekürzten Rufzeichen („Delta Lima Mike, cleared touch and go“ / „… extend downwind“) und die Pistenkontrolle („Check one, enter runway“ / „… hold short“). Funktioniert in Chrome und Edge (Mikrofon erlauben).</li>
      <li><b>Arbeitsplatz:</b> rechts Radar, Pistenstatus und Funk in einem Fenster (⤢ bzw. <kbd>F</kbd> macht das Radar groß), unten die <b>Flugstreifen</b>: links Landungen, rechts Starts, Filter <b>An / Beide / Ab</b>. Die ausgewählte Karte wird groß und zeigt alle Befehle; kleine Karten zeigen nur den gerade fälligen Befehl.</li>
      <li><b>Reihenfolge &amp; Auto-Staffelung:</b> Karten <b>ziehen</b> (oder ◀ ▶, <kbd>W</kbd>/<kbd>S</kbd>) – die Staffelung passt sich an: Anflugfreigaben kommen in deiner Reihenfolge, Anflüge werden auf 180/160 kt gebremst, Vorgezogene bekommen „Direkt FAF“, notfalls geht einer in die Warteschleife; vor eine Landung gezogene Starts bekommen eine Lücke („Startfenster in …“). Aus der Warteliste in die Pistenfolge ziehen = Anflug frei. Du gibst weiter Lande- und Startfreigaben. „⇅ zurücksetzen“ plant wieder automatisch. Farben auf Karte und Radar: <span style="color:#22d3ee">■ Landung</span> <span style="color:#a5f3fc">■ Landung frei</span> <span style="color:#f59e0b">■ Start</span> <span style="color:#e879f9">■ Startfreigabe</span>.</li>
      <li><b>Wetter & Piste:</b> Bremswirkung (gut/mittel/schlecht) hängt vom Gummiabrieb und von Nässe ab. Bei Nebel gelten LVP (mehr Abstand); unter 550 m RVR geht es nur mit ILS CAT III. Bei mehr als 5 kt Rückenwind die Betriebsrichtung wechseln.</li>
      <li><b>Markieren:</b> ⚑ auf dem Streifen, Rechtsklick/langes Drücken auf ein Flugzeug oder <kbd>M</kbd>. <kbd>N</kbd>/<kbd>Tab</kbd> springt zur nächsten Anfrage, <kbd>F</kbd> vergrößert das Radar, ⓘ im Radar erklärt die Anzeige.</li>
      <li><b>↗ Abflugrouten (SID):</b> Jeder Start fliegt je nach Ziel über NOLTA, SUDEN, RIMOS oder WELDA (farbig auf dem Streifen). Zwei Starts auf <b>derselben</b> Route brauchen 100 s statt 75 s Abstand – wechsle die Routen in der Pistenfolge ab, dann gehen die Starts schneller raus.</li>
      <li><b>📻✖ Funkausfall (7600, NORDO):</b> Manchmal fällt an Bord der Funk aus. Das Flugzeug fliegt den Anflug nach Flugplan und reagiert nur auf <b>Lichtsignale</b> aus dem Tower: grünes Dauerlicht (<kbd>L</kbd>) = Landung frei, rotes Dauerlicht (<kbd>G</kbd>) = nicht landen, grünes Blinklicht (<kbd>R</kbd>) am Boden = Rollen frei. Ohne grünes Licht startet es bei 1 NM durch und setzt erneut an. Auf der Karte siehst du den Lichtstrahl aus der Kanzel.</li>
      <li><b>🚨 Notfall-Checkliste:</b> Meldet ein Flugzeug MAYDAY, zeigt der Pistenblock rechts eine Checkliste, die sich selbst abhakt: Feuerwehr/Rettungsdienst alarmiert, Direktanflug (D), keine Starts vor der Notlandung, Landefreigabe (L), gelandet. Ein ⚠ zeigt, wenn noch ein Start freigegeben ist.</li>
      <li><b>🚙 Pistenkontrolle:</b> Etwa alle 3 Stunden (6–22 Uhr; auf „Entspannt“ seltener, auf „Profi“ öfter) meldet sich „Runway Check 1“ am Rollhalt und möchte die Bahn abfahren (3 Minuten). Die Anfrage steht im Pistenblock rechts – grün „Lücke“, gelb ein Anflug, der durchstarten müsste, rot Verkehr auf der Bahn oder mit Landefreigabe im kurzen Endanflug (Freigabe = Pistenbetretung!). <b>Freigeben</b> sperrt die Bahn, <b>Später</b> vertröstet um 5 Minuten. In einer echten Lücke gibt es Punkte; bleibt die Kontrolle lange aus, steigt das Risiko für Fremdkörper (FOD-Sperrungen). Manchmal findet die Kontrolle Fremdkörper, bevor etwas passiert.</li>
      <li><b>⛈️ Wetterumflüge:</b> Bei Gewitter (und manchmal bei Regenschauern) ziehen Zellen über das Radar. Führt der Kurs eines Anflugs durch eine Zelle, fragt die Besatzung: „request deviation 20 degrees left due weather“. Der Streifen leuchtet gelb – <b>Umweg genehmigen</b> mit dem Knopf oder <kbd>Y</kbd>: Das Flugzeug fliegt über einen Umweg-Punkt (gestrichelt, „WX“ im Radar) und danach weiter nach Plan. <b>Ablehnen</b> (wenn der Umweg in anderen Verkehr führen würde) heißt: mitten durch – Turbulenz, durchgeschüttelte Fluggäste, Ansehen und Kombo weg. Ohne Antwort weicht der Pilot nach ein paar Sekunden selbst aus (Kombo weg). Die Zellen ziehen mit dem Wind, Umwege werden laufend angepasst. Abflüge sind dann schon bei Langen Radar und umfliegen selbstständig.</li>
      <li><b>👂 Readback-Fehler:</b> Hör auf die Rücklesungen! Ab und zu versteht ein Pilot „cleared for take-off“ statt „line up and wait“ oder nennt die falsche Landebahn. Korrigiere mit <kbd>Q</kbd>, dem roten Knopf auf dem Streifen oder per Sprechtaste („negative …“). Wer es sofort hört, bekommt mehr Punkte; nach ein paar Sekunden blendet der Streifen einen Hinweis ein. Unkorrigiert rollt der Pilot ohne Freigabe los bzw. fliegt die falsche Bahn an und startet durch.</li>
    </ul>
    <h3>🦺 Vorfeld &amp; Abfertigung</h3>
    <ul>
      <li><b>Alles bedienen</b> <kbd>D</kbd>: schickt für alle gelben Aufgaben freie Fahrzeuge los – die dringendste Abfertigung zuerst. Die Tafel ist nach <b>Puffer</b> sortiert: Balken = verstrichene Zeit bis zur TOBT, ▼ = voraussichtlich fertig (grün Puffer, gelb knapp, rot zu spät).</li>
      <li>Ankünfte brauchen eine <b>Parkposition</b> (automatisch oder per Auswahl – oder Flugzeug anklicken, dann Position auf der Karte).</li>
      <li><b>📊 Positionsplan</b> <kbd>G</kbd>: Zeitstrahl aller Positionen über die nächsten 3 Stunden – orange = belegt bis TOBT, gestrichelt = reservierte Ankunft, rot = Überschneidung (die Ankunft muss warten). Ankünfte ohne Position aus der rechten Liste auf eine grün leuchtende Zeile ziehen; reservierte Balken lassen sich umlegen. Unten rechts siehst du, was später noch kommt (Größe beachten: L nur auf L-Positionen, Fracht nur auf die Frachtposition).</li>
      <li>Im Turnaround werden <b>gelbe Aufgaben</b> fällig: anklicken = nächstes freies Fahrzeug losschicken. Reihenfolge: Aussteigen → Reinigung/Catering → Einsteigen, Entladen → Beladen, Betankung, zum Schluss der Pushback-Schlepper.</li>
      <li><b>TOBT</b> zeigt, wann ein Flug voraussichtlich fertig ist. Liegt sie nach der STD, wird er verspätet – und ein Slot (CTOT) kann verfallen.</li>
      <li><b>Tankwagen</b> fassen 36 t. Großraumflugzeuge brauchen 2–3 Ladungen; leere Tankwagen fahren selbst zum Tanklager. Ist das Tanklager leer, stockt die Betankung.</li>
          <li><b>🔁 Anschlussflüge:</b> Kommt eine Maschine verspätet, warten manchmal Umsteiger auf einen Abflug derselben Airline. Du entscheidest: warten (Boarding länger, Airline zufrieden), auf Kosten umbuchen oder ohne sie abfliegen (Ansehen und Airline leiden).</li>
      <li><b>📻 Betriebsfunk:</b> Die Bodencrews melden sich auf Deutsch – „Tank 2: verstanden, rolle zu Position 5“, „Laderaum zu“, „Push läuft“, „Einweiser 6: Keile liegen“, „leer – brauche Ablösung!“. Mit <i>Echter Funk</i> (🔊 oder Einstellungen) sprechen sie mit Funkrauschen; Wichtiges (Pushback, Boarding fertig, Pannen, leerer Tankwagen) immer, Routine nur bei ruhigem Kanal und 1×.</li>
</ul>
    <h3>💼 Manager</h3>
    <ul>
      <li><b>🚶 Sicherheitskontrolle:</b> Zu Stoßzeiten stauen sich die Reisenden (Wartezeit im Leitstand, Schlange vor dem Terminal). Ab ~12 Minuten dauert das Boarding länger, ab 20 Minuten leidet das Ansehen. Mehr Sicherheitsspuren schaffen Abhilfe – wachsender Verkehr braucht mehr Spuren.</li>
      <li><b>🤝 Verhandeln:</b> Bei neuen Angeboten kannst du +10 % oder +20 % Entgelte verlangen. Die Erfolgschance steht auf dem Knopf – sie steigt mit Ansehen, Rang und dem Interesse der Airline. Klappt es nicht, bleibt das Angebot oft zum Originalpreis stehen, manchmal springt die Airline aber ab.</li>
      <li>Verträge annehmen, Gebühren festlegen, Parkpositionen und Terminal ausbauen, Fahrzeuge kaufen, Personal einstellen.</li>
      <li><b>Kerosin:</b> einkaufen, wenn der Marktpreis günstig ist, Marge festlegen, Lagerbestand im Blick behalten (Tab <i>Kerosin</i>). Die Automatik hält den Bestand, kauft aber nicht immer günstig.</li>
      <li><b>Piste:</b> Landungen hinterlassen Gummiabrieb – der Zustand sinkt. Reinigung oder Sanierung laufen nachts in Verkehrspausen und sperren die Piste solange.</li>
      <li><b>Baustellen:</b> jeder Ausbau braucht Bauzeit und ist mit Zaun, Kran, Bagger und Betonmischer zu sehen. „📍 Zeigen“ springt hin, „Abbrechen“ erstattet 50 % der noch nicht verbauten Kosten.</li>
      <li><b>Kredite</b> überbrücken Engpässe (30 Tagesraten). <b>Nachtflüge</b> bringen Nachtentgelte, aber Lärmbeschwerden; ein Nachtflugverbot verärgert Frachtairlines.</li>
      <li><b>🔉 Lärmkarte:</b> Der Kartenknopf 🔉 blendet die Lärmzonen um die Bahn ein. Sie wachsen mit dem Verkehr der letzten Stunde, mit schweren Flugzeugen und nachts – genau dann kommen die Beschwerden. Nachtentgelt und Nachtflugverbot findest du unter Gebühren &amp; Nachtflug.</li>
      <li><b>🌐 Basis-Angebot:</b> Bei gutem Ansehen kann eine Partner-Airline anbieten, eine Basis zu eröffnen: vier neue Verbindungen auf einmal, dafür Rabatt auf die Entgelte und die Zusage von mindestens 85 % Pünktlichkeit pro Woche. Die Aufsichtsratssitzung prüft das; wird die Zusage zweimal verfehlt, zieht die Airline wieder ab.</li>
      <li><b>🏛️ Aufsichtsrat:</b> Alle 7 Tage tagt der Aufsichtsrat (nach dem Tagesbericht) und prüft fünf <b>Wochenziele</b>: Passagiere, Betriebsergebnis, Pünktlichkeit, Ansehen und Sicherheit (höchstens 2 Vorfälle). Die Ziele leiten sich aus der Vorwoche ab – Passagiere und Ergebnis sollen wachsen. Je erreichtem Ziel steigt oder sinkt das <b>Vertrauen</b>; ab 3 Zielen gibt es einen <b>Investitionszuschuss</b> (bis 500 Tsd €, ab 80 Vertrauen +50 %), unter 25 Vertrauen eine teure Sonderprüfung. In der Sitzung wählst du die <b>Strategie</b> für die nächste Woche: Ausgewogen, Wachstum (mehr Airline-Angebote), Effizienz (Fixkosten −6 %) oder Qualität (Ansehen +0,4/Tag) – jeweils mit passenden Zielen. Stand jederzeit in der Management-Zentrale › Aufsichtsrat.</li>
      <li><b>😊 Fluggast-Zufriedenheit:</b> In der Management-Zentrale › Übersicht zeigt eine Karte, wie Reisende deinen Flughafen erleben – getrennt nach Pünktlichkeit, Sicherheitskontrolle (Spuren und aktuelle Wartezeit), Shopping & Lounge, Anreise (Parkhaus, Bahnhof, Hotel) und Sicherheitsgefühl (Zwischenfälle heute). Die schwächste Stelle steht darunter mit einem Tipp, was hilft.</li>
      <li><b>🏢 Wettbewerb:</b> Der Nachbarflughafen <b>Nordhafen</b> kämpft um dieselben Airlines. Der <b>Marktanteil</b> (Management-Zentrale › Wettbewerb) ergibt sich aus Ansehen, Pünktlichkeit, Entgelten und Kapazität beider Flughäfen – mehr Anteil bringt häufiger Angebote und bessere Verlängerungschancen. Nordhafen senkt Entgelte, baut aus, macht Werbung und <b>wirbt Verbindungen ab</b> (Gegenangebot, Service-Paket oder ziehen lassen). Ist Nordhafen gesperrt, kannst du <b>Umleitungen</b> annehmen – Zusatzentgelte, Ansehen und im Tower spürbar mehr Verkehr. Liegst du vorn, greift Nordhafen öfter an.</li>
    </ul>
    <h3>🎯 Ziele &amp; Rang</h3>
    <p>Jede Station hat drei Ziele (🏅 oben rechts). Erreichte Ziele bringen Prämie und XP; der Flughafen steigt vom Regionalflughafen bis zum Weltflughafen auf – höhere Ränge ziehen mehr Airlines an.</p>
    <h3>⭐ Schichtpunkte</h3>
    <p>Im Tower und im Vorfeld gibt es Punkte für gute Arbeit – saubere Landungen, Starts in der Lücke vor der nächsten Landung, kurze Wartezeiten am Rollhalt, Pushbacks auf die Minute und schnelle Turnarounds. Jeder Erfolg erhöht den Kombo-Multiplikator (bis ×3, oben neben dem Rang); ein Durchstarten, ein Vorfall oder eine große Verspätung setzt ihn zurück. Windscherung zählt nicht gegen dich.</p>
    <h3>⭐ Herausforderungen</h3>
    <p><b>📅 Tagesherausforderung:</b> ganz oben in der Liste – jeden Kalendertag eine neue Mischung aus einem Tower- oder Vorfeld-Szenario und zwei Zusatzregeln (z.B. Funkausfall, Hochbetrieb, Superjumbo, Winddrehung, Tankwagen-Panne). Für alle gleich gewürfelt; mindestens ein Stern an aufeinanderfolgenden Tagen ergibt eine 🔥 Serie.</p>
    <p>Im Hauptmenü unter <b>Herausforderungen</b>: kurze Einsätze mit festem Start – Morgenwelle, Nebelsuppe, Gewitterfront, Notfall-Schicht, Großer Flugtag (Tower), Ferienstart, Streiktag, Winterchaos (Vorfeld), Sanierungsfall und Wachstumskurs (Manager). Oben zeigt eine Leiste Restzeit und Ziele; jedes Ziel bringt 1–3 Sterne, die Gesamtwertung ist der Durchschnitt (ein verfehltes Ziel = nicht geschafft). Ein Stern schaltet die nächste Herausforderung der Station frei. Herausforderungen überschreiben deinen Spielstand nicht.</p>
    <h3>🛩️ Platzrunden</h3>
    <p>Tagsüber bei gutem Wetter übt manchmal eine <b>Cessna 172</b> Platzrunden mit Touch and Go. Im Gegenanflug (nördlich der Bahn) bittet sie um Freigabe: <b>Touch &amp; Go</b> gibt die Bahn frei, <b>Vollkreis</b> schickt sie eine Runde drehen. Gib frei, wenn kein Linienflug im Endanflug, auf der Bahn oder im Startlauf ist. Während sie aufsetzt, ist die Bahn belegt; Abflüge wartet der Auto-Lotse ab. Bleibt die Freigabe aus, kreist sie – nach drei Vollkreisen bricht sie ab.</p>
    <h3>🚁 Rettungshubschrauber</h3>
    <p>Ein paar Mal am Tag meldet sich <b>Rescue 7</b> südlich des Platzes und will auf dem Weg zur Klinik die Bahnen in der Mitte queren. Er schwebt, bis du im Pistenblock <b>Querung frei</b> gibst. Gib frei, wenn niemand im kurzen Endanflug, im Startlauf oder auf der Bahn ist – sonst ist es ein Verkehrskonflikt. Lässt du ihn über sieben Minuten warten, verzögert sich der Patiententransport; nach 15 Minuten fliegt er um die Kontrollzone herum. Mit „Nebenverkehr auto“ übernimmt der Kollege.</p>
    <h3>💦 Erstflug mit Wassertaufe</h3>
    <p>Wenn eine neu unterschriebene Strecke zum ersten Mal landet, stellt die Flughafenfeuerwehr zwei Löschfahrzeuge an die Rollgasse und schießt einen Wasserbogen, durch den das Flugzeug zur Position rollt – eine schöne Szene für Kino-Modus, Livestream und Spotter, dazu etwas Ansehen und eine Schlagzeile im Kurier.</p>
    <h3>⏪ Wiederholung</h3>
    <p>Das Spiel schneidet die letzten Sekunden am Platz mit. Nach einem besonderen Moment – Durchstarten, Notlandung, harte oder butterweiche Landung, A380 oder Regierungsmaschine – erscheint unten ein Knopf <b>Wiederholung</b>; <kbd>Umschalt</kbd>+<kbd>R</kbd> spielt sie jederzeit ab. In Zeitlupe, ohne Oberfläche, die Kamera folgt dem Flugzeug; die Simulation wartet so lange. Esc oder ein Klick beendet die Wiederholung.</p>
    <h3>🛬 Aufsetzrate</h3>
    <p>Jede Landung zeigt ihre Sinkrate beim Aufsetzen (ft/min): unter 110 ist 🧈 Butter, ab 600 eine harte Landung. Seitenwind, Böen, Regen, Schnee, Gewitter und Wirbelschleppen machen Landungen fester – und eine <b>späte Landefreigabe</b>: Kommt sie weniger als eine Minute vor dem Aufsetzen, ist der Endanflug unruhig. Nach einer harten Landung prüft die Technik das Fahrwerk an der Position (Abfertigung ruht 20 Minuten).</p>
    <h3>🗼 Turmblick 3D</h3>
    <p>Der Tower-Knopf rechts an der Karte schaltet in die echte 3D-Sicht aus der Tower-Kanzel – in jeder Rolle, das Spiel läuft weiter und Panel, Funk, Radar und Flugstreifen bleiben bedienbar. <b>Ziehen</b> schaut dich um, das <b>Mausrad</b> ist das Fernglas, Doppelklick blickt wieder auf die Bahnmitte. Über jedem Flugzeug hängt ein Schild mit Rufzeichen, Typ und Höhe; ein Klick auf Flugzeug oder Schild wählt es aus. Mit <b>Verfolgen</b> schwenkt der Blick auf das ausgewählte Flugzeug und das Fernglas zoomt automatisch mit – so siehst du den Start vom Aufrollen bis zum Abheben. Flugzeuge im nahen Anflug erscheinen schon in der Luft, Rettungshubschrauber und Cessna in der Platzrunde ebenfalls mit Schild. Nochmal auf den Tower-Knopf, ✕ oder <kbd>Esc</kbd> zurück zur Karte.</p>
    <p>🎬 <b>Kino 3D</b>: Im Turmblick startet „Kino“ automatische Kamerafahrten durch die 3D-Welt – Landungen von der Bahnseite, Starts und Überflüge am Bahnende, Anflüge von hinten, Rollverkehr, Pushback, Rettungshubschrauber, Cessna, Kranfahrten über das Vorfeld und den Blick vom Tower, mit Breitbild-Balken und Einblendung. <kbd>Leertaste</kbd> oder → springt zur nächsten Szene, „Turmblick“ zurück, <kbd>Esc</kbd> beendet.</p>
    <h3>🪟 Mitfliegen in 3D</h3>
    <p>Flugzeug anklicken und in der Info-Karte <b>Fenster</b> oder <b>Cockpit</b> wählen – die Ansicht wechselt in echtes 3D (WebGL). Oben gibt es drei Kameras: <b>Cockpit</b>, <b>Fenster</b> und <b>3D außen</b>; <b>Ziehen</b> dreht und neigt den Blick frei, das <b>Mausrad</b> ändert den Abstand, Doppelklick setzt zurück. Am <b>Fensterplatz</b> schaust du durchs Kabinenfenster auf Tragfläche und Boden (Anschnallzeichen, mit Echter Funk eine Kapitänsdurchsage). Im <b>Cockpit</b> blickst du voraus und hast die Instrumente vor dir: Geschwindigkeit, Höhe, Steigrate, künstlicher Horizont, Flugmodus und Kurs; im Endanflug kommen die Höhenansagen. Einsteigen geht schon im Anflug – dann zeigen die Instrumente die echten Luftdaten, bis die Maschine landet –, oder an der Position vor dem Abflug – nach dem Start fliegst du im Steigflug weiter, bis die Maschine etwa 9.000 ft erreicht. Oben lässt sich umschalten, <kbd>Esc</kbd> steigt aus.</p>
    <p>Die 3D-Welt: Flugzeuge je Bauart (Schmal- und Großraum, A380, 747, Turboprops mit drehenden Propellern, Regional- und Businessjets mit Hecktriebwerken) in Airline-Lackierung mit Fenstern, Türen und Logo; Schatten; Himmel mit echtem Sonnenstand, Morgen- und Abendrot, Mond und Sternen. Nachts leuchten Rand-, Mittellinien-, Schwellen- und Rollwegfeuer, die Anflugbefeuerung mit Lauffeuer, Flutlicht auf dem Vorfeld, das Drehfeuer am Tower und die Fenster der Stadt. Die <b>PAPI</b> links der Bahn zeigt im Endanflug zwei rote und zwei weiße Lichter, wenn der Gleitpfad stimmt. Flugzeuge haben Positions-, Blitz- und Landelichter; beim Aufsetzen qualmen die Reifen, auf nasser Bahn spritzt Gischt. Regen, Schnee, Nebel und Gewitterblitze, der Windsack zeigt den Wind. Neigung und Querlage folgen dem Flug; im Cockpit und am Fenster neigt sich die Sicht mit.</p>
    <h3>📡 Spotter-Livestream</h3>
    <p>Mit <kbd>L</kbd> (oder 📡 Livestream im Leitstand des Beobachters) geht deine Kamera auf Sendung. Die <b>Zuschauerzahl</b> folgt dem, was im Bild ist: Landungen, Starts und Durchstarter ziehen, ein A380, die Regierungsmaschine, ein Notfall oder eine Sonderlackierung erst recht; Gewitter, Schnee und Nachtlichter helfen. Ein leeres Bild lässt die Zahl fallen – der Balken unter der Anzeige zeigt, wie spannend die Szene gerade ist. Der <b>Live-Chat</b> kommentiert alles – und äußert <b>Wünsche</b> (eine Landung, ein bestimmtes Flugzeug, den Tower von nah …): Holst du das binnen 60 Sekunden ins Bild, springt die Zuschauerzahl hoch. Im Kino-Modus läuft der Stream als TV-Übertragung weiter. <b>Spotter-Quiz:</b> Ab und zu fragt der Chat nach dem Typ eines Flugzeugs nahe der Bildmitte (das Kartenlabel zeigt dann „???“) – wähle aus drei Antworten; richtig gibt einen Zuschauerschub, zehn richtige den Erfolg „Typenkenner“.</p>
    <h3>🎖️ Staatsbesuch</h3>
    <p>Ab und zu (ab Tag 2) kündigt sich die <b>Regierungsmaschine</b> an (Rufzeichen „State“, Datenblock <b>STATE</b>, Flugstreifen 🎖️). Protokoll im <b>Tower</b>: landen lassen, ohne dass sie länger als vier Minuten kreist oder durchstarten muss. Im <b>Vorfeld</b>: eine Großraum-Kontaktposition bereithalten und die Maschine pünktlich (höchstens 5 min nach Plan) off-block bringen. Am Boden warten roter Teppich, Ehrenformation, Fahnen und eine Kolonne. Gelingt beides, gibt es Ansehen, Schichtpunkte und eine Protokollgebühr von 60.000 €.</p>
    <h3>📸 Momente des Tages</h3>
    <p>Besondere Szenen – ein A380, die Regierungsmaschine, eine Notlandung, eine Landung per Lichtsignal, eine Sonderlackierung, ein Start im Gewitter oder in der goldenen Stunde – fotografiert das Spiel automatisch. Die drei besten zeigt der Tagesbericht als Fotostreifen.</p>
    <h3>📋 Schichtbriefing</h3>
    <p>Zu Beginn jedes Tages (Tower, Vorfeld, Manager) fasst ein Briefing die Schicht zusammen: Wetter und Vorhersage, geplanter Verkehr je Stunde mit Spitzenstunde, besondere Flüge (A380, VIP), die Lage deiner Station (Betriebsrichtung und Heavys, Positionen und Tanklager, Kasse, auslaufende Verträge und Marktanteil) und die Ziele der Schicht. <kbd>Enter</kbd> beginnt die Schicht; abschaltbar im Briefing oder unter Einstellungen.</p>
    <h3>📖 Kampagne</h3>
    <p>Unter „Kampagne &amp; Szenarien“ führt eine Geschichte in zehn Kapiteln durch alle Stationen – vom ersten Arbeitstag im Tower über Vorfeld und Geschäftsführung bis zum Drehkreuz und zum Großen Flugtag als Epilog. Vor jedem Kapitel erklärt die Aufsichtsratsvorsitzende Dr. Helene Brandt die Lage, danach kommentiert sie dein Ergebnis. Ein Stern genügt, um das nächste Kapitel zu öffnen; die Sterne zählen auch für die Herausforderungen.</p>
    <h3>♿ Barrierefreiheit</h3>
    <p>Unter Einstellungen (Hauptmenü oder Pause): <b>Große Schrift</b> vergrößert Seitenleiste, Info-Karte, Funk, Fenster und Meldungen, ohne dass die Karte schrumpft. Der <b>Farbsehschwäche-Modus</b> nutzt Blau für gut/frei und Orange für schlecht/Konflikt statt Grün/Rot – in Leisten, Karten, Effekten und im Radar. <b>Bewegung reduzieren</b> schaltet pulsierende Hinweise, Übergänge und das Menü-Video ab.</p>
    <h3>🎵 Musik im Spiel</h3>
    <p>Unter Funk und Klangkulisse läuft Musik, die zur Lage passt: tagsüber (auch im Hochbetrieb) ein lockeres, freundliches Stück, nachts ein ruhiges, verträumtes – beide laufen endlos und blenden beim Wechsel weich über. Bei Notfällen, Treibstoffnot, Gewitter oder Windscherung übernimmt eine angespannte Klangfläche mit tiefem Puls, bei Schnee eine mit hohen Glocken. Im Hauptmenü spielt das Planez-Thema. Bei Pause und offenen Fenstern wird es leiser. Ein- und ausschalten unter Einstellungen › Musik im Spiel bzw. Menümusik.</p>
    <h3>📒 Spotterbuch</h3>
    <p>Klicke ein Flugzeug auf der Karte an und drücke <b>📷 Spotten</b> (außerhalb des Towers auch <kbd>F</kbd>): Das Foto landet im Spotterbuch (<kbd>J</kbd> oder 📒). Punkte gibt es nach Seltenheit des Typs (häufig bis legendär – der A380), für neue Typen und Airlines, für seltene <b>Sonderlackierungen</b> (Regenbogen, Retro, 50 Jahre … – etwa jede 18. Maschine) und für <b>Momente</b> im Bild: Landung, Start, Pushback, Nacht, goldene Stunde, Regen, Gewitter, Schnee, Nebel, Enteisung, Durchstarten, Notfall. Dasselbe Flugzeug zählt erneut, sobald ein neuer Moment dazukommt. Jedes Flugzeug trägt ein eigenes Kennzeichen (z.B. D-AXYZ). Insgesamt gibt es 16 Typen – vom Turboprop (ATR 72, Dash 8-400) über Regionaljets (CRJ900, E190, A220) bis zu A330, 777, Frachtern, dem Geschäftsreisejet und dem A380. Jeden Spieltag gibt es außerdem ein 🎯 <b>Motiv des Tages</b> (z. B. eine Dash 8, eine Nachtaufnahme oder einen Großraumjet bei der Landung) für 150 Extrapunkte. Das Spotterbuch gilt für alle Spielstände.</p>
    <h3>Steuerung</h3>
    <p><b>🎥 Folgen:</b> Auf der Info-Karte eines Flugzeugs oder Fahrzeugs lässt „Folgen“ die Kamera mitfahren – vom Endanflug über die Abfertigung bis zum Start. Karte ziehen beendet das Folgen.</p>
    <p><b>🎬 Kino-Modus</b> (<kbd>K</kbd> oder 🎬): Die Kamera fährt selbst zu Landungen, Starts, Durchstarts, Rundgängen um Tower, Feuerwache, Terminal und Co., Abfertigungen, Baustellen und zur Landseite – mit Letterbox und Bildunterschrift. ← → nächste Szene, <kbd>K</kbd>/<kbd>Esc</kbd> beendet.</p>
    <p><b>Entscheidungen:</b> Ab und zu kommt eine Ereigniskarte (links) – Gepäckband kaputt, fehlender Passagier, technischer Defekt, Koffer im falschen Flugzeug, keine freie Position, medizinischer Notfall, Vogelschwarm, Drohne im Anflugsektor, Laserblendung, Airline will Rabatt, Gewerkschaft, Festival-Charter, Tag der offenen Tür (Besucher, Wimpel und Ballons auf der Terminal-Terrasse) … Jede Option hat echte Folgen. Ohne Antwort gilt nach Ablauf die erste Option. Auf der Karte zeigen aufsteigende Texte, was gerade passiert (✓ pünktlich, +Erlös, Verspätung).</p>
    <p>Karte ziehen = verschieben · Mausrad/Pinch = Zoom · Klick = auswählen · <kbd>Leertaste</kbd> Pause · <kbd>1</kbd>–<kbd>5</kbd> Tempo (1×, 2×, 5×, 10×, 20× – bei <b>10×</b> dauert ein Tag etwa <b>10 Minuten</b>; Manager und Beobachter starten mit 10×) · <kbd>B</kbd> Beschriftungen · Pfeiltasten scrollen.</p>`;
}

function showHelp(first, tab = 'guide') {
  let cur = tab;
  let q = '';
  const body = () => (cur === 'gloss' ? `<input class="gl-search no-gl" type="search" placeholder="Suchen: z. B. TOBT, Heavy, RVR …" value="${esc(q)}" /><div class="help-scroll no-gl" id="gl-list">${glossaryHtml(q)}</div>` : `<div class="help-scroll">${helpGuide(first)}</div>`);
  openModal(
    `<h2>${first ? 'Willkommen bei Planez!' : cur === 'gloss' ? '📖 Glossar' : 'Anleitung'}</h2>
    <div class="help-tabs"><button data-ht="guide" class="${cur === 'guide' ? 'on' : ''}">❓ Anleitung</button><button data-ht="gloss" class="${cur === 'gloss' ? 'on' : ''}">📖 Glossar &amp; Abkürzungen</button></div>
    <div id="help-body">${body()}</div>
    <div class="modal-acts"><button class="btn btn-primary" data-x>${first ? "Los geht's" : 'Schließen'}</button></div>`,
    (box) => {
      box.querySelector('[data-x]').addEventListener('click', closeModal);
      const wire = () => {
        const inp = box.querySelector('.gl-search');
        if (inp) {
          inp.addEventListener('input', () => {
            q = inp.value;
            box.querySelector('#gl-list').innerHTML = glossaryHtml(q);
          });
          if (window.innerWidth > 760) inp.focus();
        } else glossify(box.querySelector('#help-body'));
      };
      box.querySelectorAll('[data-ht]').forEach((b) =>
        b.addEventListener('click', () => {
          cur = b.dataset.ht;
          box.querySelectorAll('[data-ht]').forEach((x) => x.classList.toggle('on', x === b));
          box.querySelector('h2').textContent = cur === 'gloss' ? '📖 Glossar' : 'Anleitung';
          box.querySelector('#help-body').innerHTML = body();
          wire();
        })
      );
      wire();
    }
  );
}

// Ziele & Rang
function showGoals() {
  const s = game.state;
  const G = goalsState(s);
  const list = activeGoals(s);
  const next = RANKS[G.rank + 1];
  const pct = next ? Math.round(((G.xp - RANKS[G.rank].xp) / (next.xp - RANKS[G.rank].xp)) * 100) : 100;
  const goals = list
    .map((g) => {
      const p = Math.max(0, goalProgress(s, g));
      const f = goalFraction(s, g);
      const d = GOAL_DEFS[g.key];
      const val = d.type === 'level' ? '' : ` · ${Math.floor(Math.min(p, g.target)).toLocaleString('de-DE')} / ${g.target.toLocaleString('de-DE')}`;
      return `<div class="card goal"><div class="row"><span class="t">🎯 ${esc(goalText(g))}</span><span class="rem">${Math.round(f * 100)} %</span></div><div class="bar"><i style="width:${f * 100}%;background:var(--manager)"></i></div><div class="s">${d.type === 'streak' ? 'Serie – ein Fehler setzt sie zurück' : d.type === 'level' ? 'Wert erreichen' : 'seit Zielvergabe'}${val}</div></div>`;
    })
    .join('');
  openModal(
    `<h2>🏅 ${esc(s.name)} – ${RANKS[G.rank].name}</h2>
    <p style="margin:0 0 6px;color:var(--muted)">${G.xp} XP${next ? ` · nächster Rang „${next.name}“ ab ${next.xp} XP` : ' · höchster Rang erreicht'} · ${G.done} Ziele erreicht</p>
    <div class="bar" style="height:9px"><i style="width:${pct}%;background:linear-gradient(90deg,#f59e0b,#fde047)"></i></div>
    <div class="rank-steps">${RANKS.map((r, i) => `<span class="${i <= G.rank ? 'on' : ''}" title="${r.xp} XP">${i + 1}. ${r.name}</span>`).join('')}</div>
    <div class="p-sec"><span>Ziele · ${ROLES[s.role].name}</span></div>
    ${goals}
    ${achievementsHtml(s)}
    <p style="font-size:12px;color:var(--muted)">Prämie und XP gibt es sofort beim Erreichen; danach folgt ein neues Ziel. Jeder Tag bringt zusätzlich XP für Sicherheit, Pünktlichkeit und Gewinn. Höhere Ränge: mehr Vertragsangebote und Ansehen.</p>
    <div class="modal-acts"><button class="btn btn-primary" data-x>Weiter</button></div>`,
    (box) => box.querySelector('[data-x]').addEventListener('click', closeModal)
  );
}

boot();
