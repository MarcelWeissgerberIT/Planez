// Planez – Airport Simulator: Start, Spielschleife, Eingabe
import { loadAssets } from './assets.js';
import { Camera } from './render/camera.js';
import { MapRenderer } from './render/map.js';
import { Radar } from './render/radar.js';
import { newGame, loadGame, saveGame, hasSave, setRole, ROLES } from './state.js';
import { run, hooks } from './sim/sim.js';
import { listeners } from './sim/messages.js';
import { SPEEDS, AC_TYPES } from './config.js';
import { TowerPanel, REQ_DE } from './ui/tower.js';
import { GroundPanel } from './ui/groundPanel.js';
import { ManagerPanel } from './ui/managerPanel.js';
import { $, toast, openModal, closeModal, modalOpen, setHTML } from './ui/dom.js';
import { renderInfo } from './ui/info.js';
import { sfx, setSound, setTTS, speak, unlock } from './audio.js';
import { command } from './sim/atc.js';
import { dispatch, assignStand, standFits, standFree } from './sim/ground.js';
import * as EC from './sim/economy.js';
import { fmtClock, fmtMoney, dayOf, esc, clamp, hourOf } from './util.js';
import { WEATHER } from './sim/events.js';
import { PH } from './sim/aircraft.js';
import * as LY from './layout.js';

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
    const strip = document.querySelector(`#panel [data-key="${id}"]`);
    if (strip && focus !== 'map') strip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
};
window.planez = game; // für Tests/Debugging

// ---------------- Start ----------------
async function boot() {
  const fill = $('#load-fill');
  await loadAssets((p) => (fill.style.width = `${Math.round(p * 100)}%`));
  game.map = new MapRenderer($('#map'), game.cam);
  game.radar = new Radar($('#radar'));
  $('#loading').classList.add('hidden');
  showMenu();
  wireMenu();
  wireGame();
  requestAnimationFrame(loop);
}

function showMenu() {
  $('#menu').classList.remove('hidden');
  $('#game').classList.add('hidden');
  const v = $('#menu-video');
  try {
    v.play().catch(() => {});
  } catch (e) {}
  const save = hasSave() ? loadGame() : null;
  const box = $('#continue-box');
  if (save) {
    box.classList.remove('hidden');
    $('#continue-info').textContent = `${save.name} · Tag ${dayOf(save.time)} ${fmtClock(save.time)} · ${ROLES[save.role]?.name || ''} · ${fmtMoney(save.cash)}`;
  } else box.classList.add('hidden');
}

function wireMenu() {
  const start = (role) => {
    unlock();
    const name = $('#inp-name').value.trim() || 'Planez International';
    const density = Number($('#inp-density').value) || 1;
    startGame(newGame({ role, name, density }));
    if (!localStorage.getItem('planez_help_seen')) {
      try {
        localStorage.setItem('planez_help_seen', '1');
      } catch (e) {}
      setTimeout(() => showHelp(true), 400);
    }
  };
  document.querySelectorAll('.role-card').forEach((b) => b.addEventListener('click', () => start(b.dataset.role)));
  document.querySelectorAll('[data-role-start]').forEach((b) => b.addEventListener('click', () => start(b.dataset.roleStart)));
  $('#btn-continue').addEventListener('click', () => {
    unlock();
    const s = loadGame();
    if (s) startGame(s);
  });
  $('#btn-help-menu').addEventListener('click', () => showHelp(false));
}

function startGame(state) {
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
  setTTS(state.settings.tts);
  resize();
  const narrow = window.innerWidth < 760;
  game.cam.x = 36;
  game.cam.y = 21;
  game.cam.zoom = narrow ? 0.4 : window.innerWidth > 1700 ? 0.62 : 0.52;
  if (narrow) {
    $('#panel').classList.add('collapsed');
    $('#panel-toggle').classList.add('collapsed');
  }
  applyRole();
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
  if (s.role === 'tower') game.panel = new TowerPanel(root, game);
  else if (s.role === 'ground') game.panel = new GroundPanel(root, game);
  else if (s.role === 'manager') game.panel = new ManagerPanel(root, game);
  else {
    game.panel = new ManagerPanel(root, game);
    root.querySelector('.p-title').innerHTML = '👁️ Beobachter <small id="mp-sub"></small>';
  }
  $('#btn-role').textContent = `${ROLES[s.role].icon} ${ROLES[s.role].short} ▾`;
  toggleRadar(s.role === 'tower');
  game.ui.labelFn = labelFn(s.role);
  $('#hud-name').textContent = s.name;
  updateHUD(true);
}

function labelFn(role) {
  return (ac) => {
    const s = game.state;
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
  game.cam.update(dt);
  keyPan(dt);
  game.map.render(s, dt, game.ui);
  if (game.ui.radarOn) game.radar.render(s, dt, game.ui);
  game.uiTimer -= dt;
  if (game.uiTimer <= 0) {
    game.uiTimer = 0.2;
    updateHUD();
    if (!game.panelHold && !(document.activeElement && document.activeElement.tagName === 'SELECT')) game.panel.update(s);
    if (!(document.activeElement && document.activeElement.tagName === 'SELECT' && document.activeElement.closest('#info'))) renderInfo($('#info'), s, game.ui);
    watchAlerts(s);
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
  const sp = SPEEDS.map((v, i) => `<button data-speed="${v}" class="${s.speed === v ? 'on' : ''}" title="${v ? v + '-fach' : 'Pause'} (Taste ${i})">${v === 0 ? '❚❚' : v + '×'}</button>`).join('');
  setHTML($('#speeds'), sp);
  const w = WEATHER[s.weather.kind];
  setHTML($('#hud-wx'), `${w.icon} ${w.name} · ${Math.round(s.wind.dir / 10) * 10}°/${Math.round(s.wind.spd)} kt`);
  setHTML($('#hud-rwy'), `RWY <b>${s.rwy}</b>${s.rwyPending ? ` <span class="pend">→ ${s.rwyPending}</span>` : ''}`);
  const cash = $('#hud-cash');
  setHTML(cash, fmtMoney(s.cash));
  cash.classList.toggle('neg', s.cash < 0);
  setHTML($('#hud-rep'), `${'★'.repeat(Math.max(1, Math.round(s.reputation / 20)))}<small style="color:var(--dim)">${'★'.repeat(5 - Math.max(1, Math.round(s.reputation / 20)))}</small>`);
  const t = s.stats.today;
  const deps = t.onTime + t.delayed;
  setHTML($('#hud-ontime'), deps ? `${Math.round((t.onTime / deps) * 100)} %` : '—');
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
  box.appendChild(d);
  while (box.children.length > 90) box.firstChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;
  if (!silent && (m.kind === 'atc' || m.kind === 'pilot')) {
    if (s.role === 'tower' || s.role === 'observer') sfx.radio();
    if (s.role === 'tower') speak(m.text, m.kind === 'atc');
  }
}
listeners.radio.push((m) => {
  if (game.running) addLog(m);
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
  if (s.role === 'manager' || s.role === 'observer') showReport(rec);
  else toast(`📊 Tag ${rec.day}: ${rec.mov} Bewegungen, ${rec.onTime} % pünktlich, Ergebnis ${fmtMoney(rec.rev - rec.cost)}`, rec.rev > rec.cost ? 'good' : 'warn', 7000);
});

function showReport(rec) {
  const prevSpeed = game.state.speed;
  openModal(
    `<h2>📊 Tagesbericht – Tag ${rec.day}</h2>
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
    </div>
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
    } else down = { x: e.offsetX, y: e.offsetY, lx: e.offsetX, ly: e.offsetY, moved: false, btn: e.button };
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
    if (down && !down.moved) clickMap(e.offsetX, e.offsetY);
    down = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => ($('#tooltip').style.display = 'none'));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    game.cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Radar
  const rc = $('#radar');
  rc.addEventListener('click', (e) => {
    const id = game.radar.pick(e.offsetX, e.offsetY);
    if (id) game.select(id, 'map');
    else game.select(null);
  });
  $('#radar-big').addEventListener('click', () => {
    game.ui.radarBig = !game.ui.radarBig;
    $('#radar-wrap').classList.toggle('big', game.ui.radarBig);
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
  if (e.key === 'Escape') return game.select(null);
  if (s.role === 'tower' && game.panel.key && !e.ctrlKey && !e.metaKey && game.panel.key(e, s)) return;
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
    const h = game.ui.radarBig ? Math.min(w, window.innerHeight - 140) : w;
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
  const prev = s.speed;
  s.speed = 0;
  openModal(
    `<h2>☰ Menü</h2>
    <div class="toggle-row"><span>Sound-Effekte</span><button class="switch ${s.settings.sound ? 'on' : ''}" data-set="sound"></button></div>
    <div class="toggle-row"><span>Funksprüche vorlesen (Englisch, Tower-Rolle)</span><button class="switch ${s.settings.tts ? 'on' : ''}" data-set="tts"></button></div>
    <div class="toggle-row"><span>Beschriftungen auf der Karte</span><button class="switch ${game.ui.labels ? 'on' : ''}" data-set="labels"></button></div>
    <div class="modal-acts">
      <button class="btn" data-m="help">❓ Anleitung</button>
      <button class="btn" data-m="role">🔁 Station wechseln</button>
      <button class="btn" data-m="save">💾 Speichern</button>
      <button class="btn" data-m="quit">🏠 Hauptmenü</button>
      <button class="btn btn-primary" data-m="resume">▶ Weiter</button>
    </div>`,
    (box) => {
      box.querySelectorAll('[data-set]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = b.dataset.set;
          if (k === 'labels') {
            game.ui.labels = !game.ui.labels;
            $('#t-labels').classList.toggle('on', game.ui.labels);
            b.classList.toggle('on', game.ui.labels);
            return;
          }
          s.settings[k] = !s.settings[k];
          b.classList.toggle('on', s.settings[k]);
          setSound(s.settings.sound);
          setTTS(s.settings.tts);
        })
      );
      box.querySelector('[data-m=resume]').addEventListener('click', () => {
        closeModal();
        s.speed = prev || 1;
      });
      box.querySelector('[data-m=save]').addEventListener('click', () => {
        toast(saveGame(s) ? '💾 Gespeichert' : 'Speichern nicht möglich', 'good', 1800);
      });
      box.querySelector('[data-m=help]').addEventListener('click', () => {
        s.speed = prev || 1;
        showHelp(false);
      });
      box.querySelector('[data-m=role]').addEventListener('click', () => {
        s.speed = prev || 1;
        showRoleModal();
      });
      box.querySelector('[data-m=quit]').addEventListener('click', () => {
        s.speed = prev || 1;
        saveGame(s);
        closeModal();
        game.running = false;
        showMenu();
      });
    }
  );
}

function showHelp(first) {
  openModal(
    `<h2>${first ? 'Willkommen bei Planez!' : 'Anleitung'}</h2>
    <p>Du leitest eine Station am Flughafen – alles andere erledigen KI-Kollegen automatisch. Die Station kannst du jederzeit oben rechts wechseln.</p>
    <h3>🎧 Tower-Lotse</h3>
    <ul>
      <li><b>Anflug frei</b> <kbd>A</kbd> schickt Anflüge vom Fix (z.B. NOLTA) auf den Endanflug. Halte mindestens <b>3 NM</b> Abstand (auf dem Radar sichtbar) – nutze Geschwindigkeiten und <b>Warteschleife</b> <kbd>H</kbd>. Im Warteschleifen-Stapel zuerst den Untersten freigeben.</li>
      <li><b>Landefreigabe</b> <kbd>L</kbd> nur bei freier Piste – sonst startet der Flieger durch. Ohne Freigabe bei 1 NM: Durchstarten.</li>
      <li>Am Boden: <b>Rollen zur Position</b> <kbd>R</kbd>, <b>Pushback</b> <kbd>P</kbd>, <b>Rollen zum Rollhalt</b> <kbd>R</kbd>, <b>Line up</b> <kbd>U</kbd>, <b>Startfreigabe</b> <kbd>T</kbd>, <b>Halt</b> <kbd>X</kbd>.</li>
      <li><kbd>N</kbd> / <kbd>Tab</kbd> springt zur nächsten offenen Anfrage. <kbd>F</kbd> vergrößert das Radar. Bei Rückenwind die Betriebsrichtung wechseln.</li>
    </ul>
    <h3>🦺 Vorfeld &amp; Abfertigung</h3>
    <ul>
      <li>Ankünfte brauchen eine <b>Parkposition</b> (automatisch oder per Auswahl – oder Flugzeug anklicken, dann Position auf der Karte).</li>
      <li>Im Turnaround werden <b>gelbe Aufgaben</b> fällig: anklicken = nächstes freies Fahrzeug losschicken. Reihenfolge: Aussteigen → Reinigung/Catering → Einsteigen, Entladen → Beladen, Betankung, zum Schluss der Pushback-Schlepper.</li>
      <li>Fahrzeugtypen kannst du einzeln auf <b>Auto</b> schalten. Verspätungen kosten Vertragsstrafen.</li>
    </ul>
    <h3>💼 Manager</h3>
    <ul>
      <li>Verträge annehmen, Gebühren festlegen, Parkpositionen und Terminal ausbauen, Fahrzeuge kaufen, Personal einstellen.</li>
      <li>Zu hohe Gebühren verärgern Airlines, zu wenig Kapazität verursacht Wartezeiten und Verspätungen.</li>
    </ul>
    <h3>Steuerung</h3>
    <p>Karte ziehen = verschieben · Mausrad/Pinch = Zoom · Klick = auswählen · <kbd>Leertaste</kbd> Pause · <kbd>1</kbd>–<kbd>5</kbd> Tempo · <kbd>B</kbd> Beschriftungen · Pfeiltasten scrollen.</p>
    <div class="modal-acts"><button class="btn btn-primary" data-x>Los geht's</button></div>`,
    (box) => box.querySelector('[data-x]').addEventListener('click', closeModal)
  );
}

boot();
