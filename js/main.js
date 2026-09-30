// Planez – Airport Simulator: Start, Spielschleife, Eingabe
import { loadAssets } from './assets.js';
import { Camera } from './render/camera.js';
import { MapRenderer } from './render/map.js';
import { Radar, seqChips } from './render/radar.js';
import { newGame, loadGame, saveGame, hasSave, setRole, ROLES } from './state.js';
import { run, hooks } from './sim/sim.js';
import { listeners } from './sim/messages.js';
import { SPEEDS, AC_TYPES, dayMinutes } from './config.js';
import { TowerPanel, REQ_DE } from './ui/tower.js';
import { GroundPanel } from './ui/groundPanel.js';
import { ManagerPanel } from './ui/managerPanel.js';
import { $, toast, openModal, closeModal, modalOpen, setHTML } from './ui/dom.js';
import { renderInfo } from './ui/info.js';
import { currentHint } from './ui/hints.js';
import { initMarkMenu, openMarkMenu, closeMarkMenu, markMenuOpen, cycleMark, clearMark, setMark, MARKS } from './ui/marks.js';
import { sfx, setSound, setTTS, unlock } from './audio.js';
import { voice } from './voice.js';
import { initPTT } from './ui/ptt.js';
import { DecisionCard } from './ui/decision.js';
import { NewsTicker } from './ui/ticker.js';
import { Cinema } from './ui/cinema.js';
import { Tutorial } from './ui/tutorial.js';
import { showAchievement, achievementsHtml } from './ui/achUi.js';
import { soundscape } from './soundscape.js';
import { season, temperature } from './sim/winter.js';
import { makeVehicle, freeBay } from './sim/ground.js';
import { command } from './sim/atc.js';
import { dispatch, assignStand, standFits, standFree } from './sim/ground.js';
import * as EC from './sim/economy.js';
import { fmtClock, fmtMoney, dayOf, esc, clamp, hourOf } from './util.js';
import { WEATHER } from './sim/events.js';
import { PH } from './sim/aircraft.js';
import * as LY from './layout.js';
import { seqColor } from './ui/tower.js';
import { siteGeom } from './render/sites.js';
import { initGlossary, setGlossaryEnabled, glossify, glossaryHtml } from './ui/glossary.js';
import { goalsState, activeGoals, goalProgress, goalText, goalFraction, RANKS, GOAL_DEFS } from './sim/goals.js';
import { fuelState } from './sim/fuel.js';
import { initMainMenu, refreshMainMenu, showPauseMenu, loadPrefs, savePrefs } from './ui/menus.js';
import { ManagementPage } from './ui/mgmtPage.js';
import { ManagerDock } from './ui/managerDock.js';
import { projects, cancelProject } from './sim/construction.js';

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
async function boot() {
  const fill = $('#load-fill');
  await loadAssets((p) => (fill.style.width = `${Math.round(p * 100)}%`));
  game.map = new MapRenderer($('#map'), game.cam);
  game.radar = new Radar($('#radar'));
  initGlossary();
  initMainMenu({
    gloss: () => showHelp(false, 'gloss'),
    prefsChanged: (p) => {
      setGlossaryEnabled(p.glossary);
      setSound(p.sound);
    },
  });
  $('#loading').classList.add('hidden');
  showMenu();
  wireMenu();
  wireGame();
  requestAnimationFrame(loop);
}

function showMenu() {
  $('#menu').classList.remove('hidden');
  $('#game').classList.add('hidden');
  setGlossaryEnabled(loadPrefs().glossary);
  refreshMainMenu(hasSave() ? loadGame() : null);
}

function wireMenu() {
  const start = (role) => {
    unlock();
    const name = $('#inp-name').value.trim() || 'Planez International';
    const density = Number($('#inp-density').value) || 1;
    const st = newGame({ role, name, density });
    const pr = loadPrefs();
    Object.assign(st.settings, { sound: pr.sound, ambience: pr.ambience, tts: pr.tts, glossary: pr.glossary, hints: pr.hints });
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
  const on = !!(s && s.settings.tts && (s.role === 'tower' || s.role === 'observer'));
  voice.set({ on, vol: loadPrefs().voiceVol ?? 0.9 });
  const b = $('#voice-t');
  if (b) {
    b.textContent = s && s.settings.tts ? '🔊' : '🔇';
    b.classList.toggle('on', !!(s && s.settings.tts));
  }
  const p = $('#ptt-btn');
  if (p) p.classList.toggle('hidden', !(s && s.role === 'tower'));
}
game.syncVoice = syncVoice;

function startGame(state) {
  soundscape.unlock();
  game.state = state;
  game.ui.sel = null;
  game.ui.selected = null;
  game.seenReq = new Set();
  $('#menu').classList.add('hidden');
  $('#menu-video').pause();
  $('#game').classList.remove('hidden');
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
  applyRole();
  syncVoice();
  if (!game.tutorial) game.tutorial = new Tutorial(game);
  game.tutorial.maybeStart();
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
  $('#btn-role').textContent = `${ROLES[s.role].icon} ${ROLES[s.role].short} ▾`;
  toggleRadar(s.role === 'tower');
  if (game.syncVoice) game.syncVoice();
  if (game.tutorial && game.tutorial.on) game.tutorial.stop();
  if (game.tutorial) game.tutorial.maybeStart();
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
    return ac.type;
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
  if (game.cinema && game.cinema.on) game.cinema.update(dt);
  else game.cam.update(dt);
  keyPan(dt);
  game.map.render(s, dt, game.ui);
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
    watchAlerts(s);
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

// ---------------- HUD ----------------
function updateHUD(force) {
  const s = game.state;
  setHTML($('#hud-day'), `Tag ${dayOf(s.time)}`);
  setHTML($('#hud-time'), fmtClock(s.time));
  const sp = SPEEDS.map((v, i) => `<button data-speed="${v}" class="${s.speed === v ? 'on' : ''}" title="${v ? `${v}-fach – ein Tag dauert ca. ${Math.round(dayMinutes(v))} Minuten` : 'Pause'} (Taste ${i})">${v === 0 ? '❚❚' : v + '×'}</button>`).join('');
  setHTML($('#speeds'), sp);
  const w = WEATHER[s.weather.kind];
  const se = season(s);
  setHTML($('#hud-wx'), `<span title="${se.name}">${se.icon}</span> ${w.icon} ${w.name} · ${temperature(s).toFixed(0)} °C · ${Math.round(s.wind.dir / 10) * 10}°/${Math.round(s.wind.spd)} kt`);
  setHTML($('#hud-rwy'), `RWY <b>${s.rwy}</b>${s.rwyPending ? ` <span class="pend">→ ${s.rwyPending}</span>` : ''}`);
  const cash = $('#hud-cash');
  setHTML(cash, fmtMoney(s.cash));
  cash.classList.toggle('neg', s.cash < 0);
  setHTML($('#hud-rep'), `${'★'.repeat(Math.max(1, Math.round(s.reputation / 20)))}<small style="color:var(--dim)">${'★'.repeat(5 - Math.max(1, Math.round(s.reputation / 20)))}</small>`);
  const t = s.stats.today;
  const deps = t.onTime + t.delayed;
  setHTML($('#hud-ontime'), deps ? `${Math.round((t.onTime / deps) * 100)} %` : '—');
  const G = goalsState(s);
  const next = RANKS[G.rank + 1];
  const pct = next ? Math.round(((G.xp - RANKS[G.rank].xp) / (next.xp - RANKS[G.rank].xp)) * 100) : 100;
  setHTML($('#btn-rank'), `<span class="rk-i">🏅</span><span class="rk-t"><b>${RANKS[G.rank].name}</b><i style="--p:${pct}%"></i></span>`);
}

// Anfragen / Konflikte akustisch melden
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
  ground: ['gnd', 'sys', 'mgr'],
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
    ${rec.xp ? `<p style="margin:10px 0 0;color:var(--muted)">🏅 +${rec.xp} XP für den Tag · ${RANKS[goalsState(game.state).rank].name} (${goalsState(game.state).xp} XP)</p>` : ''}
    <div class="modal-acts"><button class="btn btn-primary" data-close-modal>Weiter</button></div>`,
    (box) => box.querySelector('[data-close-modal]').addEventListener('click', () => {
      closeModal();
      game.state.speed = prevSpeed;
    })
  );
}

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
      if (down.moved) game.cam.panBy(dx, dy);
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
  $('#t-labels').addEventListener('click', () => {
    game.ui.labels = !game.ui.labels;
    $('#t-labels').classList.toggle('on', game.ui.labels);
  });
  $('#t-labels').classList.add('on');
  $('#t-radar').addEventListener('click', () => toggleRadar(!game.ui.radarOn));
  $('#t-help').addEventListener('click', () => showHelp(false));
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
    toast(s.settings.tts ? '🔊 Echter Funk an – Lotse und Piloten sprechen' : '🔇 Funk stumm', 'info', 2200);
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
  info.addEventListener('click', (e) => {
    const s = game.state;
    if (e.target.closest('[data-close]')) return game.select(null);
    const c = e.target.closest('[data-cmd]');
    if (c) {
      const ac = s.acs.find((a) => a.id === c.dataset.ac);
      const r = ac ? command(s, ac, c.dataset.cmd) : { ok: false, msg: '' };
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
    if (e.key === 'Escape') closeModal();
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
  if (e.key === '+' || e.key === '=') return game.cam.zoomAt(1.2, game.cam.w / 2, game.cam.h / 2);
  if (e.key === '-') return game.cam.zoomAt(0.83, game.cam.w / 2, game.cam.h / 2);
  if (e.key === 'Escape') {
    if (markMenuOpen()) return closeMarkMenu();
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
  const list = s.acs.filter((a) => a.req || a.emergency).sort((a, b) => (a.reqT || 0) - (b.reqT || 0));
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
  const dpr = Math.min(2, window.devicePixelRatio || 1);
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
    settings: () => ({ sound: !!s.settings.sound, ambience: s.settings.ambience !== false, tts: !!s.settings.tts, glossary: s.settings.glossary !== false, hints: s.settings.hints !== false, labels: game.ui.labels }),
    toggle: (k) => {
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
    quit: () => {
      saveGame(s);
      if (game.mgmt) game.mgmt.close();
      game.running = false;
      showMenu();
    },
  });
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
      <li><b>Echter Funk:</b> Lotse und Piloten sprechen (🔊 im Funkfenster, jedes Flugzeug mit eigener Stimme, Funkrauschen, eine Frequenz – niemand spricht gleichzeitig). <b>Sprechtaste:</b> <kbd>V</kbd> gedrückt halten (oder 🎙) und auf Englisch funken, z.&nbsp;B. „Aurora five four two, runway two seven, cleared to land“, „Rheinjet four one two, line up and wait“, „… cleared for take-off“, „… cleared ILS approach“, „… hold as published“, „… reduce speed one six zero“, „… taxi to stand“, „… pushback approved“. Funktioniert in Chrome und Edge (Mikrofon erlauben).</li>
      <li><b>Arbeitsplatz:</b> rechts Radar, Pistenstatus und Funk in einem Fenster (⤢ bzw. <kbd>F</kbd> macht das Radar groß), unten die <b>Flugstreifen</b>: links Landungen, rechts Starts, Filter <b>An / Beide / Ab</b>. Die ausgewählte Karte wird groß und zeigt alle Befehle; kleine Karten zeigen nur den gerade fälligen Befehl.</li>
      <li><b>Reihenfolge &amp; Auto-Staffelung:</b> Karten <b>ziehen</b> (oder ◀ ▶, <kbd>W</kbd>/<kbd>S</kbd>) – die Staffelung passt sich an: Anflugfreigaben kommen in deiner Reihenfolge, Anflüge werden auf 180/160 kt gebremst, Vorgezogene bekommen „Direkt FAF“, notfalls geht einer in die Warteschleife; vor eine Landung gezogene Starts bekommen eine Lücke („Startfenster in …“). Aus der Warteliste in die Pistenfolge ziehen = Anflug frei. Du gibst weiter Lande- und Startfreigaben. „⇅ zurücksetzen“ plant wieder automatisch. Farben auf Karte und Radar: <span style="color:#22d3ee">■ Landung</span> <span style="color:#a5f3fc">■ Landung frei</span> <span style="color:#f59e0b">■ Start</span> <span style="color:#e879f9">■ Startfreigabe</span>.</li>
      <li><b>Wetter & Piste:</b> Bremswirkung (gut/mittel/schlecht) hängt vom Gummiabrieb und von Nässe ab. Bei Nebel gelten LVP (mehr Abstand); unter 550 m RVR geht es nur mit ILS CAT III. Bei mehr als 5 kt Rückenwind die Betriebsrichtung wechseln.</li>
      <li><b>Markieren:</b> ⚑ auf dem Streifen, Rechtsklick/langes Drücken auf ein Flugzeug oder <kbd>M</kbd>. <kbd>N</kbd>/<kbd>Tab</kbd> springt zur nächsten Anfrage, <kbd>F</kbd> vergrößert das Radar, ⓘ im Radar erklärt die Anzeige.</li>
    </ul>
    <h3>🦺 Vorfeld &amp; Abfertigung</h3>
    <ul>
      <li><b>Alles bedienen</b> <kbd>D</kbd>: schickt für alle gelben Aufgaben freie Fahrzeuge los – die dringendste Abfertigung zuerst. Die Tafel ist nach <b>Puffer</b> sortiert: Balken = verstrichene Zeit bis zur TOBT, ▼ = voraussichtlich fertig (grün Puffer, gelb knapp, rot zu spät).</li>
      <li>Ankünfte brauchen eine <b>Parkposition</b> (automatisch oder per Auswahl – oder Flugzeug anklicken, dann Position auf der Karte).</li>
      <li>Im Turnaround werden <b>gelbe Aufgaben</b> fällig: anklicken = nächstes freies Fahrzeug losschicken. Reihenfolge: Aussteigen → Reinigung/Catering → Einsteigen, Entladen → Beladen, Betankung, zum Schluss der Pushback-Schlepper.</li>
      <li><b>TOBT</b> zeigt, wann ein Flug voraussichtlich fertig ist. Liegt sie nach der STD, wird er verspätet – und ein Slot (CTOT) kann verfallen.</li>
      <li><b>Tankwagen</b> fassen 36 t. Großraumflugzeuge brauchen 2–3 Ladungen; leere Tankwagen fahren selbst zum Tanklager. Ist das Tanklager leer, stockt die Betankung.</li>
    </ul>
    <h3>💼 Manager</h3>
    <ul>
      <li>Verträge annehmen, Gebühren festlegen, Parkpositionen und Terminal ausbauen, Fahrzeuge kaufen, Personal einstellen.</li>
      <li><b>Kerosin:</b> einkaufen, wenn der Marktpreis günstig ist, Marge festlegen, Lagerbestand im Blick behalten (Tab <i>Kerosin</i>). Die Automatik hält den Bestand, kauft aber nicht immer günstig.</li>
      <li><b>Piste:</b> Landungen hinterlassen Gummiabrieb – der Zustand sinkt. Reinigung oder Sanierung laufen nachts in Verkehrspausen und sperren die Piste solange.</li>
      <li><b>Baustellen:</b> jeder Ausbau braucht Bauzeit und ist mit Zaun, Kran, Bagger und Betonmischer zu sehen. „📍 Zeigen“ springt hin, „Abbrechen“ erstattet 50 % der noch nicht verbauten Kosten.</li>
      <li><b>Kredite</b> überbrücken Engpässe (30 Tagesraten). <b>Nachtflüge</b> bringen Nachtentgelte, aber Lärmbeschwerden; ein Nachtflugverbot verärgert Frachtairlines.</li>
    </ul>
    <h3>🎯 Ziele &amp; Rang</h3>
    <p>Jede Station hat drei Ziele (🏅 oben rechts). Erreichte Ziele bringen Prämie und XP; der Flughafen steigt vom Regionalflughafen bis zum Weltflughafen auf – höhere Ränge ziehen mehr Airlines an.</p>
    <h3>Steuerung</h3>
    <p><b>🎬 Kino-Modus</b> (<kbd>K</kbd> oder 🎬): Die Kamera fährt selbst zu Landungen, Starts, Durchstarts, Abfertigungen, Baustellen und zur Landseite – mit Letterbox und Bildunterschrift. ← → nächste Szene, <kbd>K</kbd>/<kbd>Esc</kbd> beendet.</p>
    <p><b>Entscheidungen:</b> Ab und zu kommt eine Ereigniskarte (links) – Gepäckband kaputt, fehlender Passagier, medizinischer Notfall, Vogelschwarm, Airline will Rabatt, Gewerkschaft, Festival-Charter … Jede Option hat echte Folgen. Ohne Antwort gilt nach Ablauf die erste Option. Auf der Karte zeigen aufsteigende Texte, was gerade passiert (✓ pünktlich, +Erlös, Verspätung).</p>
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
