// Großflughäfen: Spielmodus – Tower an einem Drehkreuz nach realem Vorbild. Karte, Anflugradar, Flugstreifen mit
// Freigaben, Funk mit Sprachausgabe, Auswahl per Klick, Tastenkürzel, Pausenmenü, Ergebnis mit Sternen.
import { AIRPORTS } from './airports.js';
import { getAirport } from './store.js';
import { HubSim, PHASE as P, NM } from './sim.js';
import { HubRenderer } from './render.js';
import { HubRadar } from './radar.js';
import { createHubMinimap } from './minimap.js';
import { hubScenarioById, hubStars, saveHubBest, loadHubBest, scenariosOf } from './scenarios.js';
import { AIRLINES, CITIES } from '../config.js';
import { T } from '../i18n.js';
import { voice } from '../voice.js';
import { sfx } from '../audio.js';
import { tracks } from '../trackMusic.js';
import { openModal, closeModal, modalOpen, syncList } from '../ui/dom.js';
import { loadPrefs } from '../ui/menus.js';
import { esc } from '../util.js';


const SPEEDS = [0, 1, 2, 4, 8];
const PHASE_TXT = {
  [P.APP]: T('Im Anflug'), [P.FIN]: T('Endanflug'), [P.ROLL]: T('Landung'), [P.TAXI_IN]: T('Rollt zur Position'), [P.STAND]: T('An der Position'),
  [P.GA]: T('Durchstarten'), [P.PUSH]: T('Pushback'), [P.START]: T('Triebwerksstart'), [P.TAXI_OUT]: T('Rollt zum Rollhalt'), [P.HOLD]: T('Am Rollhalt'),
  [P.LINEUP]: T('Rollt auf die Bahn'), [P.LINED]: T('Aufgestellt'), [P.TKOF]: T('Startlauf'), [P.CLIMB]: T('Steigflug'),
};
const clock = (t) => {
  const m = Math.floor(t / 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const nm = (tiles) => (tiles / NM).toFixed(1);

let current = null;
export function hubActive() {
  return !!current;
}

export function startHub(scnId, api = {}) {
  if (current) current.destroy();
  current = new HubMode(scnId, api);
  return current;
}

class HubMode {
  constructor(scnId, api) {
    this.api = api;
    this.scn = hubScenarioById(scnId);
    this.ap = getAirport(this.scn.ap);
    const prefs = loadPrefs();
    this.prefs = prefs;
    this.sim = new HubSim(this.ap, {
      hour: this.scn.hour,
      minutes: this.scn.minutes || 0,
      intensity: this.scn.intensity,
      config: this.scn.config,
      wind: this.scn.wind,
      seed: (Date.now() & 0xffff) + 1,
      manualGround: !!prefs.hubGround,
      auto: { land: false, dep: false, cross: false },
    });
    this.speed = 1;
    this.lastSpeed = 1;
    this.sel = null;
    this.follow = false;
    this.uiT = 0;
    this.reqSeen = new Set();
    this.mount();
    this.renderer = new HubRenderer(this.el.querySelector('#hb-map'), this.ap, this.sim);
    this.radar = new HubRadar(this.el.querySelector('#hb-radar'), this.ap, this.sim);
    const mmBtn = this.el.querySelector('[data-hb="minimap"]');
    this.minimap = createHubMinimap(this, this.el.querySelector('#hb-minimap'), mmBtn);
    mmBtn.classList.toggle('on', this.minimap.on);
    this.resize();
    this.renderer.cam.fit();
    this.wire();
    // Funk
    voice.set({ on: prefs.tts !== false && prefs.sound !== false, vol: prefs.voiceVol ?? 0.9 });
    this.sim.onRadio = (m) => {
      this.radioLine(m);
      if (this.speed && this.speed <= 4) voice.say(m, this.speed);
    };
    this.sim.onEvent = (e) => this.onEvent(e);
    for (const m of this.sim.radioLog) this.radioLine(m);
    // Musik
    if (prefs.gameMusic !== false && prefs.sound !== false) tracks.play(this.renderer.night > 0.5 ? 'night' : 'day', 0.14);
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
    this.toast(`${this.scn.icon} ${this.scn.title}`, 'info', 5000);
    if (!this.scn.minutes) this.toast(T('Freier Betrieb – Esc für Menü, Betriebsrichtung und KI-Hilfe'), 'info', 6000);
  }

  // ------------------------------------------------------------ Aufbau
  mount() {
    let el = document.getElementById('hub');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hub';
      document.body.appendChild(el);
    }
    this.el = el;
    const ap = this.ap;
    el.className = '';
    el.innerHTML = `
      <canvas id="hb-map"></canvas>
      <header class="hb-top">
        <button class="hb-btn" data-hb="menu" title="${T('Menü (Esc)')}">☰</button>
        <div class="hb-title"><b>${esc(ap.name)}</b><small>${esc(ap.code)} · ${T('Vorbild')}: ${esc(ap.vorbild)}</small></div>
        <div class="hb-clock"><b id="hb-time"></b><small id="hb-left"></small></div>
        <div class="hb-speeds" id="hb-speeds">${SPEEDS.map((v) => `<button data-speed="${v}">${v ? v + '×' : '❚❚'}</button>`).join('')}</div>
        <button class="hb-chip" data-hb="cfg" id="hb-cfg" title="${T('Betriebsrichtung wechseln')}"></button>
        <div class="hb-chip" id="hb-wind"></div>
        <div class="hb-score" id="hb-score"></div>
        <button class="hb-chip" data-hb="ai" id="hb-ai" title="${T('KI übernimmt Freigaben')}"></button>
      </header>
      <aside class="hb-side">
        <div class="hb-radarbox"><canvas id="hb-radar"></canvas><span class="hb-rlabel">${T('Anflugradar')}</span></div>
        <div class="hb-strips" id="hb-strips">
          <div class="hs-sec"><div class="hs-h">🛬 ${T('Anflüge')}<span id="hs-n-arr"></span></div><div class="hs-list" id="hs-arr"></div></div>
          <div class="hs-sec"><div class="hs-h">🛫 ${T('Abflüge')}<span id="hs-n-dep"></span></div><div class="hs-list" id="hs-dep"></div></div>
          <div class="hs-sec"><div class="hs-h">↔️ ${T('Bahn kreuzen')}<span id="hs-n-x"></span></div><div class="hs-list" id="hs-x"></div></div>
          <div class="hs-sec" id="hs-gsec"><div class="hs-h">🚜 ${T('Boden')}<span id="hs-n-g"></span></div><div class="hs-list" id="hs-g"></div></div>
          <div class="hs-foot" id="hs-foot"></div>
        </div>
        <div class="hb-radio" id="hb-radio"></div>
      </aside>
      <div class="hb-goal" id="hb-goal"></div>
      <div class="hb-info" id="hb-info"></div>
      <div class="hb-ctrls">
        <button class="hb-btn" data-hb="zin" title="${T('Hineinzoomen (+)')}">＋</button>
        <button class="hb-btn" data-hb="zout" title="${T('Herauszoomen (−)')}">－</button>
        <button class="hb-btn" data-hb="fit" title="${T('Ganzer Flughafen (0)')}">⤢</button>
        <button class="hb-btn" data-hb="side" title="${T('Seitenleiste ein/aus')}">⇥</button>
        <button class="hb-btn" data-hb="minimap" title="${T('Minikarte ein/aus (Umschalt+K)')}">🗺</button>
      </div>
      <div class="hb-toasts" id="hb-toasts"></div>
      <div id="hb-minimap"></div>`;
    el.classList.remove('hidden');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('game').classList.add('hidden');
  }
  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(r.width, r.height, dpr);
    const side = this.el.querySelector('.hb-side');
    this.renderer.cam.pad = this.el.classList.contains('noside') || r.width < 761 ? 0 : side.getBoundingClientRect().width + 8;
    this.radar.resize();
  }
  wire() {
    const el = this.el;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-hb]');
      if (b) return this.cmd(b.dataset.hb);
      const sp = e.target.closest('[data-speed]');
      if (sp) return this.setSpeed(Number(sp.dataset.speed));
      const act = e.target.closest('[data-act]');
      if (act) return this.act(act.dataset.act, Number(act.dataset.id));
      const row = e.target.closest('[data-sel]');
      if (row) return this.select(Number(row.dataset.sel), true);
    });
    // Karte: ziehen, zoomen, auswählen
    const cv = el.querySelector('#hb-map');
    const pts = new Map();
    let drag = null, pinch = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
        drag = null;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = cv.getBoundingClientRect();
        this.renderer.cam.zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        pinch.d = d;
        return;
      }
      if (drag) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 4) {
          this.renderer.cam.panBy(dx, dy);
          this.follow = false;
        }
      }
    });
    const up = (e) => {
      if (drag && drag.moved <= 4 && pts.size === 1) {
        const r = cv.getBoundingClientRect();
        const id = this.renderer.pick(e.clientX - r.left, e.clientY - r.top);
        this.select(id, false);
      }
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', () => {
      if (this.sel) this.follow = true;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.renderer.cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    const rc = el.querySelector('#hb-radar');
    rc.addEventListener('click', (e) => {
      const r = rc.getBoundingClientRect();
      const id = this.radar.pick(e.clientX - r.left, e.clientY - r.top);
      if (id) this.select(id, true);
    });
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
  }

  // ------------------------------------------------------------ Bedienung
  key(e) {
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (modalOpen()) {
      if (e.key === 'Escape' && this.pausedByMenu) this.resumeFromMenu();
      return;
    }
    const k = e.key.toLowerCase();
    const cam = this.renderer.cam;
    if (k === 'escape') return this.cmd('menu');
    if (k === ' ') {
      e.preventDefault();
      return this.setSpeed(this.speed ? 0 : this.lastSpeed || 1);
    }
    if (/^[1-4]$/.test(k)) return this.setSpeed(SPEEDS[Number(k)]);
    if (k === '+' || k === '=') return cam.zoomAt(1.25, cam.w / 2, cam.h / 2);
    if (k === '-') return cam.zoomAt(0.8, cam.w / 2, cam.h / 2);
    if (k === '0') return this.cmd('fit');
    if (k === 'f') return (this.follow = !!this.sel && !this.follow);
    if (e.key === 'K' && e.shiftKey) return this.minimap.toggle();
    if (k === 'tab') {
      e.preventDefault();
      const reqs = this.sim.requests();
      if (!reqs.length) return;
      const i = reqs.findIndex((a) => a.id === this.sel);
      return this.select(reqs[(i + 1) % reqs.length].id, true);
    }
    const map = { l: 'land', g: 'ga', u: 'lineup', t: 'takeoff', c: 'cross', p: 'push', r: 'taxi' };
    if (map[k]) {
      const kind = map[k];
      // gewähltes Flugzeug oder die älteste passende Anfrage
      const s = this.sim.acs.find((a) => a.id === this.sel);
      const ok = (a) => this.canAct(kind, a);
      const target = s && ok(s) ? s : this.sim.requests().find(ok) || this.sim.acs.find(ok);
      if (target) this.act(kind, target.id);
    }
  }
  canAct(kind, a) {
    if (!a) return false;
    switch (kind) {
      case 'land':
        return a.phase === P.FIN && !a.landClr;
      case 'ga':
        return (a.phase === P.FIN || a.phase === P.APP) && a.dfin < 8 * NM;
      case 'lineup':
        return a.phase === P.HOLD;
      case 'takeoff':
        return a.phase === P.HOLD || a.phase === P.LINED || (a.phase === P.LINEUP && !a.tkClr);
      case 'cross':
        return a.req === 'cross';
      case 'push':
        return a.req === 'push';
      case 'taxi':
        return a.req === 'taxi';
    }
    return false;
  }
  act(kind, id) {
    const a = this.sim.acs.find((x) => x.id === id);
    if (!a || !this.canAct(kind, a)) return;
    const s = this.sim;
    const ok = { land: () => s.clearLand(a), ga: () => s.orderGoAround(a), lineup: () => s.clearLineup(a), takeoff: () => s.clearTakeoff(a), cross: () => s.clearCross(a), push: () => s.approvePush(a), taxi: () => s.approveTaxi(a) }[kind]();
    if (ok && this.prefs.sound !== false) sfx.click && sfx.click();
    this.uiT = 0;
  }
  select(id, focus) {
    this.sel = id || null;
    this.renderer.sel = this.sel;
    this.radar.sel = this.sel;
    if (!id) this.follow = false;
    if (focus && id) {
      const a = this.sim.acs.find((x) => x.id === id);
      if (a) this.renderer.cam.focus(a.x, a.y);
    }
    this.uiT = 0;
  }
  setSpeed(v) {
    if (v) this.lastSpeed = v;
    this.speed = v;
    if (v > 4) voice.stop && voice.stop();
    this.uiT = 0;
  }
  cmd(c) {
    const cam = this.renderer.cam;
    if (c === 'zin') return cam.zoomAt(1.3, cam.w / 2, cam.h / 2);
    if (c === 'zout') return cam.zoomAt(1 / 1.3, cam.w / 2, cam.h / 2);
    if (c === 'fit') return cam.fit();
    if (c === 'side') {
      this.el.classList.toggle('noside');
      return setTimeout(() => this.resize(), 260);
    }
    if (c === 'minimap') return this.minimap.toggle();
    if (c === 'menu') return this.pauseMenu();
    if (c === 'cfg') return this.cfgMenu();
    if (c === 'ai') return this.aiMenu();
  }

  // ------------------------------------------------------------ Fenster
  pauseFor(fn) {
    this.pausedByMenu = true;
    this.speedBefore = this.speed;
    this.speed = 0;
    fn();
  }
  resumeFromMenu() {
    closeModal();
    this.pausedByMenu = false;
    this.speed = this.speedBefore ?? 1;
  }
  pauseMenu() {
    this.pauseFor(() =>
      openModal(
        `<div class="hb-modal"><h2>⏸ ${T('Pause')}</h2><p class="hb-msub">${esc(this.ap.name)} · ${esc(this.scn.title)}</p>
        ${this.goalHtml(true)}
        <div class="hb-mbtns">
          <button class="btn btn-primary" data-m="resume">▶ ${T('Weiter')}</button>
          <button class="btn" data-m="cfg">🧭 ${T('Betriebsrichtung')}</button>
          <button class="btn" data-m="ai">🤖 ${T('KI-Hilfe')}</button>
          <button class="btn" data-m="help">❔ ${T('So geht’s')}</button>
          <button class="btn" data-m="restart">↻ ${T('Neu starten')}</button>
          <button class="btn" data-m="exit">🏠 ${T('Zum Hauptmenü')}</button>
        </div></div>`,
        (box) => box.addEventListener('click', (e) => {
          const b = e.target.closest('[data-m]');
          if (!b) return;
          const m = b.dataset.m;
          if (m === 'resume') this.resumeFromMenu();
          else if (m === 'cfg') this.cfgMenu(true);
          else if (m === 'ai') this.aiMenu(true);
          else if (m === 'help') this.helpMenu();
          else if (m === 'restart') {
            closeModal();
            startHub(this.scn.id, this.api);
          } else if (m === 'exit') this.exit();
        })
      )
    );
  }
  helpMenu() {
    openModal(
      `<div class="hb-modal"><h2>❔ ${T('Tower am Drehkreuz')}</h2>
      <ul class="hb-help">
        <li>${T('<b>Anflug:</b> Die Anflugkontrolle staffelt die Landungen. Melden sie sich beim Tower (gelb), gib die <b>Landefreigabe</b> (<kbd>L</kbd>) – aber nur, wenn die Bahn frei ist, wenn sie die Schwelle erreichen. Ohne Freigabe starten sie bei 1 NM durch.')}</li>
        <li>${T('<b>Abflug:</b> Am Rollhalt meldet sich jeder Abflug. <b>Aufrollen</b> (<kbd>U</kbd>) stellt ihn auf die Bahn, <b>Start</b> (<kbd>T</kbd>) gibt den Start frei. Hinter einem Heavy 2 Minuten warten (Wirbelschleppen), hinter mittleren Flugzeugen 1 Minute.')}</li>
        <li>${T('<b>Gemischter Betrieb:</b> Wo eine Bahn landet und startet, passt ein Start in die Lücke zwischen zwei Landungen – die nächste Landung sollte noch gut 4 NM entfernt sein.')}</li>
        <li>${T('<b>Kreuzen:</b> Wer eine aktive Bahn queren muss, wartet am Haltebalken. <b>Kreuzen</b> (<kbd>C</kbd>) nur, wenn keine Landung in der nächsten Minute kommt und kein Start rollt.')}</li>
        <li>${T('<b>Konflikt:</b> Landung auf eine belegte Bahn, Start oder Kreuzung vor einer rollenden Maschine – das kostet Sterne.')}</li>
        <li>${T('<b>Steuerung:</b> Ziehen = verschieben, Mausrad/zwei Finger = zoomen, Klick = auswählen, Doppelklick oder <kbd>F</kbd> = folgen, <kbd>Tab</kbd> = nächste Anfrage, <kbd>Leertaste</kbd> = Pause, <kbd>1</kbd>–<kbd>4</kbd> = Tempo.')}</li>
      </ul>
      <div class="hb-mbtns"><button class="btn btn-primary" data-m="back">${T('Zurück')}</button></div></div>`,
      (box) => box.addEventListener('click', (e) => e.target.closest('[data-m]') && this.pauseMenu())
    );
  }
  cfgMenu(fromPause = false) {
    const s = this.sim;
    const rows = this.ap.configs
      .map((c) => {
        const w = s.windOn(c.arr[0]);
        const tail = w.head < -5 ? `<span class="bad">${T`Rückenwind ${Math.round(-w.head)} kt`}</span>` : `<span class="good">${T`Gegenwind ${Math.round(Math.max(0, w.head))} kt`}</span>`;
        return `<button class="hb-cfgrow ${c.id === s.cfg.id ? 'on' : ''}" data-cfg="${c.id}"><b>${esc(T(c.name))}</b><small>🛬 ${c.arr.join(', ')} · 🛫 ${c.dep.join(', ')} · ${tail}</small></button>`;
      })
      .join('');
    const go = () =>
      openModal(
        `<div class="hb-modal"><h2>🧭 ${T('Betriebsrichtung')}</h2><p class="hb-msub">${T`Wind ${Math.round(s.wind.dir)}° / ${Math.round(s.wind.spd)} kt – gelandet und gestartet wird gegen den Wind.`}</p>${rows}
        <div class="hb-mbtns"><button class="btn btn-primary" data-m="back">${T('Zurück')}</button></div></div>`,
        (box) => box.addEventListener('click', (e) => {
          const c = e.target.closest('[data-cfg]');
          if (c) {
            s.setConfig(c.dataset.cfg);
            return fromPause ? this.pauseMenu() : this.resumeFromMenu();
          }
          if (e.target.closest('[data-m]')) fromPause ? this.pauseMenu() : this.resumeFromMenu();
        })
      );
    if (fromPause) go();
    else this.pauseFor(go);
  }
  aiMenu(fromPause = false) {
    const s = this.sim;
    const row = (k, name, sub) => `<button class="mm-toggle" data-ai="${k}" aria-pressed="${!!s.auto[k]}"><span class="l"><b>${name}</b><small>${sub}</small></span><span class="switch ${s.auto[k] ? 'on' : ''}"></span></button>`;
    const render = () =>
      `<div class="hb-modal"><h2>🤖 ${T('KI-Hilfe')}</h2><p class="hb-msub">${T('Die KI gibt Freigaben sicher, aber vorsichtig – für Sterne lieber selbst. Jederzeit umschaltbar.')}</p>
      ${row('land', T('Landefreigaben'), T('sobald die Bahn rechtzeitig frei ist'))}${row('dep', T('Aufrollen und Starts'), T('mit Wirbelschleppen-Abstand und Lücken im Anflug'))}${row('cross', T('Bahnkreuzungen'), T('nur bei freier Bahn und genug Abstand zur nächsten Landung'))}
      <div class="hb-mbtns"><button class="btn btn-primary" data-m="back">${T('Fertig')}</button></div></div>`;
    const go = () =>
      openModal(render(), (box) =>
        box.addEventListener('click', (e) => {
          const t = e.target.closest('[data-ai]');
          if (t) {
            s.auto[t.dataset.ai] = !s.auto[t.dataset.ai];
            box.innerHTML = render();
            return;
          }
          if (e.target.closest('[data-m]')) fromPause ? this.pauseMenu() : this.resumeFromMenu();
        })
      );
    if (fromPause) go();
    else this.pauseFor(go);
  }
  goalHtml(full = false) {
    const st = this.sim.stats, scn = this.scn;
    const mov = st.arr + st.dep;
    const delay = (st.arrDelay + st.depDelay) / Math.max(1, mov) / 60;
    if (!scn.goal) return `<div class="hb-goals"><div>✈️ ${T`${mov} Bewegungen`} · ↻ ${st.ga} · ⚠️ ${st.conf}</div></div>`;
    const g = scn.goal;
    const line = (ok, txt) => `<div class="${ok ? 'ok' : ''}">${ok ? '✔' : '○'} ${txt}</div>`;
    return `<div class="hb-goals">
      ${line(mov >= g.mov * 0.92, T`Bewegungen: ${mov} / ${g.mov}`)}
      ${line(st.conf === 0, T`Konflikte: ${st.conf} (für ★★★ keiner)`)}
      ${line(st.ga <= 2, T`Durchstarts: ${st.ga} (für ★★★ höchstens 2)`)}
      ${full ? line(delay <= 9, T`Ø Verspätung: ${delay.toFixed(1)} min (für ★★★ höchstens 9)`) : ''}
    </div>`;
  }
  showEnd() {
    const st = this.sim.stats, scn = this.scn;
    const mov = st.arr + st.dep;
    const stars = hubStars(scn, st);
    const prev = loadHubBest()[scn.id];
    const best = saveHubBest(scn.id, { stars, mov, conf: st.conf, ga: st.ga, at: Date.now() });
    const delay = (st.arrDelay + st.depDelay) / Math.max(1, mov) / 60;
    if (this.prefs.sound !== false) (stars >= 2 ? sfx.fanfare : sfx.chime) && (stars >= 2 ? sfx.fanfare() : sfx.chime());
    const others = scenariosOf(this.ap.id).filter((x) => x.id !== scn.id && x.goal);
    this.pauseFor(() =>
      openModal(
        `<div class="hb-modal hb-end"><h2>${T('Schicht beendet')}</h2><p class="hb-msub">${esc(this.ap.name)} · ${esc(scn.title)}</p>
        <div class="hb-stars">${[1, 2, 3].map((i) => `<span class="${i <= stars ? 'on' : ''}">★</span>`).join('')}</div>
        <div class="hb-stats">
          <div><b>${mov}</b><small>${T('Bewegungen')} (${T('Ziel')} ${scn.goal.mov})</small></div>
          <div><b>${st.arr}</b><small>${T('Landungen')}</small></div>
          <div><b>${st.dep}</b><small>${T('Starts')}</small></div>
          <div><b>${st.ga}</b><small>${T('Durchstarts')}</small></div>
          <div><b class="${st.conf ? 'bad' : ''}">${st.conf}</b><small>${T('Konflikte')}</small></div>
          <div><b>${delay.toFixed(1)}</b><small>${T('Ø Verspätung (min)')}</small></div>
        </div>
        ${prev && best.stars > prev.stars ? `<p class="hb-new">🏆 ${T('Neuer Bestwert!')}</p>` : ''}
        <div class="hb-mbtns">
          <button class="btn btn-primary" data-m="again">↻ ${T('Nochmal')}</button>
          ${others.length ? `<button class="btn" data-m="next">➜ ${esc(others[0].title)}</button>` : ''}
          <button class="btn" data-m="free">♾️ ${T('Weiter im freien Betrieb')}</button>
          <button class="btn" data-m="exit">🏠 ${T('Zum Hauptmenü')}</button>
        </div></div>`,
        (box) => box.addEventListener('click', (e) => {
          const b = e.target.closest('[data-m]');
          if (!b) return;
          const m = b.dataset.m;
          if (m === 'again') {
            closeModal();
            startHub(scn.id, this.api);
          } else if (m === 'next') {
            closeModal();
            startHub(others[0].id, this.api);
          } else if (m === 'free') {
            this.sim.done = false;
            this.sim.tEnd = Infinity;
            this.scn = { ...scn, goal: null, minutes: 0 };
            this.resumeFromMenu();
          } else if (m === 'exit') this.exit();
        })
      )
    );
  }

  // ------------------------------------------------------------ Ereignisse, Funk, Meldungen
  onEvent(e) {
    const ac = e.ac ? this.sim.acs.find((a) => a.id === e.ac) : null;
    const cs = ac ? ac.cs : '';
    const snd = this.prefs.sound !== false;
    if (e.kind === 'conflict') {
      const what = { land: T('Landung auf belegte Bahn'), roll: T('Hindernis auf der Bahn'), ground: T('zu dicht am Boden') }[e.text] || T('Konflikt');
      this.toast(`⚠️ ${T('Konflikt')}: ${cs} – ${what}`, 'bad', 6000);
      if (snd) sfx.alert && sfx.alert();
      if (ac) this.select(ac.id, true);
    } else if (e.kind === 'ga') {
      const why = { noclr: T('ohne Landefreigabe'), occupied: T('Bahn belegt'), atc: T('auf Anweisung'), tailwind: T('Rückenwind, instabiler Anflug') }[e.text] || '';
      this.toast(`↻ ${cs} ${T('startet durch')} – ${why}`, e.text === 'atc' ? 'info' : 'warn', 4500);
    } else if (e.kind === 'wake') {
      const [had, need] = e.text.split('|');
      this.toast(T`🌀 Wirbelschleppen-Abstand unterschritten: ${cs} nach ${had} s statt ${need} s`, 'warn', 5000);
    } else if (e.kind === 'config') {
      const c = this.sim.cfg;
      this.toast(e.text === 'alternate' ? T`🔁 15 Uhr – Bahnwechsel: jetzt ${T(c.name)}` : T`🧭 Betriebsrichtung: ${T(c.name)}`, 'info', 6000);
    } else if (e.kind === 'end') {
      setTimeout(() => this.showEnd(), 300);
    }
  }
  toast(text, level = 'info', ms = 4000) {
    const host = this.el.querySelector('#hb-toasts');
    if (!host) return;
    const t = document.createElement('div');
    t.className = `hb-toast ${level}`;
    t.textContent = text;
    host.appendChild(t);
    while (host.children.length > 4) host.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, ms);
  }
  radioLine(m) {
    const box = this.el.querySelector('#hb-radio');
    if (!box) return;
    const d = document.createElement('div');
    d.className = `hr-l ${m.kind}`;
    d.innerHTML = `<span class="hr-t">${clock(m.t)}</span><b>${esc(m.from)}</b> ${esc(m.text)}`;
    if (m.ac) d.dataset.sel = m.ac;
    box.appendChild(d);
    while (box.children.length > 40) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------ Flugstreifen
  btn(kind, a, label, key, cls = '') {
    return `<button class="hs-b ${cls}" data-act="${kind}" data-id="${a.id}">${label}${key ? ` <kbd>${key}</kbd>` : ''}</button>`;
  }
  rwyInfo(rw, ac) {
    const s = this.sim;
    const occ = s.occupants(rw, ac);
    if (!occ.length) return `<span class="good">${T('Bahn frei')}</span>`;
    const o = occ[0];
    const t = s.clearTime(o);
    return `<span class="bad">${T`belegt: ${o.cs}`}${isFinite(t) ? T` (frei in ~${Math.round(t)} s)` : ''}</span>`;
  }
  wakeInfo(ac) {
    const s = this.sim;
    const rw = this.ap.ends[ac.depEnd].rwy;
    const lt = s.lastTk[rw];
    if (!lt) return '';
    const need = { J: { J: 120, H: 180, M: 180, L: 180 }, H: { J: 90, H: 90, M: 120, L: 120 }, M: { J: 60, H: 60, M: 60, L: 90 }, L: { J: 60, H: 60, M: 60, L: 60 } }[lt.wake][ac.wake];
    const left = need - (s.t - lt.t);
    return left > 0 ? `<span class="warn">🌀 ${T`noch ${Math.ceil(left)} s`}</span>` : '';
  }
  arrInfo(rw) {
    const na = this.sim.nextArrival(rw);
    if (!na) return '';
    const sec = na.dfin / Math.max(1, na.spd);
    return `<span class="${sec < 60 ? 'bad' : sec < 100 ? 'warn' : ''}">🛬 ${nm(na.dfin)} NM (${Math.round(sec)} s)</span>`;
  }
  updateStrips() {
    const s = this.sim, ap = this.ap;
    const sel = this.sel;
    const row = (a, main, sub, btns, cls) => ({ cls: `hs-row ${cls} ${a.id === sel ? 'sel' : ''} ${a.req ? 'req' : ''}`, html: `<div class="hs-main" data-sel="${a.id}"><b>${a.cs}</b><span class="hs-ty">${a.tt.code} ${a.wake}</span>${main}</div><div class="hs-sub">${sub}</div>${btns ? `<div class="hs-btns">${btns}</div>` : ''}` });
    // Anflug
    const arr = s.acs.filter((a) => a.phase === P.APP || a.phase === P.FIN || a.phase === P.GA).sort((a, b) => (a.phase === P.GA) - (b.phase === P.GA) || a.dfin - b.dfin);
    syncList(this.el.querySelector('#hs-arr'), arr.slice(0, 9), (a) => a.id, (a) => {
      if (a.phase === P.GA) return row(a, `<span class="hs-rw">${a.end0 || a.end}</span>`, `<span class="warn">↻ ${T('Durchstarten')}</span>`, '', 'ga');
      const rw = ap.ends[a.end].rwy;
      const btns = a.phase === P.FIN ? (a.landClr ? `<span class="hs-ok">✓ ${T('frei zur Landung')}</span>` + this.btn('ga', a, T('Durchstarten'), 'G', 'ghost') : this.btn('land', a, T('Landefreigabe'), 'L', 'go')) : '';
      return row(a, `<span class="hs-rw">${a.end}</span><span class="hs-d">${nm(a.dfin)} NM</span>`, a.phase === P.FIN ? this.rwyInfo(rw, a) : `<span class="dim">${T('bei der Anflugkontrolle')}</span>`, btns, 'arr');
    });
    this.el.querySelector('#hs-n-arr').textContent = ` ${arr.length}${s.backlog.length ? ` (+${Math.min(99, s.backlog.filter((b) => b.eta < s.t + 1800).length)})` : ''}`;
    // Abflug
    const ord = { [P.LINED]: 0, [P.LINEUP]: 1, [P.HOLD]: 2, [P.TKOF]: 3 };
    const dep = s.acs.filter((a) => a.phase in ord && !(a.phase === P.TKOF && a.z > 0.3)).sort((a, b) => ord[a.phase] - ord[b.phase] || (a.tReq || 0) - (b.tReq || 0));
    syncList(this.el.querySelector('#hs-dep'), dep.slice(0, 9), (a) => a.id, (a) => {
      const rw = ap.ends[a.depEnd].rwy;
      let btns = '';
      if (a.phase === P.HOLD) btns = this.btn('lineup', a, T('Aufrollen'), 'U') + this.btn('takeoff', a, T('Start'), 'T', 'go');
      else if (a.phase === P.LINED) btns = this.btn('takeoff', a, T('Startfreigabe'), 'T', 'go');
      else if (a.phase === P.LINEUP) btns = a.tkClr ? `<span class="hs-ok">✓ ${T('Start frei')}</span>` : this.btn('takeoff', a, T('Startfreigabe'), 'T', 'go');
      else btns = `<span class="hs-ok">🛫 ${T('rollt')}</span>`;
      const info = [this.wakeInfo(a), s.cfg.arr.some((e) => ap.ends[e].rwy === rw) ? this.arrInfo(rw) : '', a.phase !== P.TKOF ? this.rwyInfo(rw, a) : ''].filter(Boolean).join(' · ');
      return row(a, `<span class="hs-rw">${a.depEnd}</span><span class="hs-d">${esc(PHASE_TXT[a.phase])}</span>`, info, btns, 'dep');
    });
    const taxiing = s.acs.filter((a) => a.phase === P.TAXI_OUT || a.phase === P.PUSH || a.phase === P.START).length;
    const waiting = s.acs.filter((a) => a.phase === P.STAND && a.tsatHold).length;
    this.el.querySelector('#hs-n-dep').textContent = ` ${dep.length}`;
    // Kreuzen
    const xs = s.acs.filter((a) => a.req === 'cross' || (a.crossRwy && a.reqStop && !a.reqStop.passed));
    syncList(this.el.querySelector('#hs-x'), xs, (a) => a.id, (a) => {
      const rwId = a.reqRwy || a.crossRwy;
      const rw = ap.rwyById[rwId];
      const btns = a.req === 'cross' ? this.btn('cross', a, T('Kreuzen'), 'C', 'go') : `<span class="hs-ok">✓ ${T('kreuzt')}</span>`;
      const busy = s.acs.find((o) => o.phase === P.TKOF && o.z < 0.3 && ap.ends[o.depEnd].rwy === rwId);
      return row(a, `<span class="hs-rw">${rw.ends.join('/')}</span>`, [this.arrInfo(rwId), busy ? `<span class="bad">🛫 ${T`${busy.cs} rollt`}</span>` : ''].filter(Boolean).join(' · ') || `<span class="good">${T('keine Landung in Sicht')}</span>`, btns, 'x');
    });
    this.el.querySelector('#hs-n-x').textContent = xs.length ? ` ${xs.length}` : '';
    // Boden (wenn selbst gelenkt)
    const gsec = this.el.querySelector('#hs-gsec');
    gsec.classList.toggle('hidden', !s.manualGround);
    if (s.manualGround) {
      const gs = s.acs.filter((a) => a.req === 'push' || a.req === 'taxi');
      syncList(this.el.querySelector('#hs-g'), gs.slice(0, 8), (a) => a.id, (a) => row(a, `<span class="hs-rw">${a.stand ? a.stand.name : ''}</span>`, a.req === 'push' ? T('bittet um Pushback') : T('bereit zum Rollen'), a.req === 'push' ? this.btn('push', a, T('Pushback'), 'P', 'go') : this.btn('taxi', a, T('Rollen'), 'R', 'go'), 'g'));
      this.el.querySelector('#hs-n-g').textContent = gs.length ? ` ${gs.length}` : '';
    }
    this.el.querySelector('#hs-foot').innerHTML = `${T`${taxiing} rollen zum Start`}${waiting ? ` · ${T`${waiting} warten an der Position (Startschlange voll)`}` : ''}`;
  }
  updateInfo() {
    const box = this.el.querySelector('#hb-info');
    const a = this.sel && this.sim.acs.find((x) => x.id === this.sel);
    if (!a) {
      box.classList.remove('show');
      return;
    }
    const al = AIRLINES[a.airline] || {};
    const city = CITIES[a.city] ? CITIES[a.city].name : a.city;
    const route = a.kind === 'arr' ? `${esc(city)} → ${esc(this.ap.code)}` : `${esc(this.ap.code)} → ${esc(city)}`;
    const rw = a.end || a.depEnd || '';
    const btns = ['land', 'ga', 'lineup', 'takeoff', 'cross', 'push', 'taxi'].filter((k) => this.canAct(k, a)).map((k) => this.btn(k, a, { land: T('Landefreigabe'), ga: T('Durchstarten'), lineup: T('Aufrollen'), takeoff: T('Startfreigabe'), cross: T('Kreuzen'), push: T('Pushback'), taxi: T('Rollen') }[k], { land: 'L', ga: 'G', lineup: 'U', takeoff: 'T', cross: 'C', push: 'P', taxi: 'R' }[k], k === 'ga' ? 'ghost' : 'go')).join('');
    const alt = a.z > 0.3 ? ` · ${Math.round((a.z * 65.6) / 100) * 100} ft` : '';
    const kt = Math.round(a.spd / (0.5144 / 20));
    const html = `<div class="hi-h"><b>${a.cs}</b><span>${esc(al.name || '')} · ${esc(a.tt.name)} (${a.wake})</span><button class="hb-x" data-hb="desel">✕</button></div>
      <div class="hi-r">${route}${rw ? ` · ${T('Bahn')} ${rw}` : ''}${a.stand ? ` · ${T('Position')} ${a.stand.name}` : ''}</div>
      <div class="hi-r"><b>${esc(PHASE_TXT[a.phase] || '')}</b> · ${kt} kt${alt}${a.phase === P.FIN || a.phase === P.APP ? ` · ${nm(a.dfin)} NM` : ''}</div>
      <div class="hs-btns">${btns}<button class="hs-b ghost" data-hb="follow">${this.follow ? T('Folgen aus') : T('Folgen')} <kbd>F</kbd></button></div>`;
    if (box._html !== html) {
      box.innerHTML = html;
      box._html = html;
    }
    box.classList.add('show');
  }
  updateTop() {
    const s = this.sim, el = this.el;
    el.querySelector('#hb-time').textContent = clock(s.t);
    el.querySelector('#hb-left').textContent = s.tEnd < Infinity ? T`noch ${Math.max(0, Math.ceil((s.tEnd - s.t) / 60))} min` : T('frei');
    for (const b of el.querySelectorAll('#hb-speeds button')) b.classList.toggle('on', Number(b.dataset.speed) === this.speed);
    el.querySelector('#hb-cfg').textContent = `🛬 ${s.cfg.arr.join(' ')} · 🛫 ${s.cfg.dep.join(' ')}`;
    const w = s.windOn(s.cfg.arr[0]);
    const wind = el.querySelector('#hb-wind');
    wind.textContent = `🧭 ${String(Math.round(s.wind.dir)).padStart(3, '0')}° / ${Math.round(s.wind.spd)} kt`;
    wind.classList.toggle('bad', w.head < -5);
    wind.title = w.head < -5 ? T('Rückenwind auf der Landebahn – Betriebsrichtung wechseln!') : T('Wind');
    const st = s.stats;
    el.querySelector('#hb-score').innerHTML = `<span title="${T('Bewegungen')}">✈️ ${st.arr + st.dep}${this.scn.goal ? `/${this.scn.goal.mov}` : ''}</span><span title="${T('Durchstarts')}">↻ ${st.ga}</span><span title="${T('Konflikte')}" class="${st.conf ? 'bad' : ''}">⚠️ ${st.conf}</span>`;
    const ai = Object.values(s.auto).filter(Boolean).length;
    el.querySelector('#hb-ai').textContent = ai ? `🤖 ${T('KI')} ${ai}/3` : `🤖 ${T('KI aus')}`;
    el.querySelector('#hb-goal').innerHTML = `<b>${this.scn.icon} ${esc(this.scn.title)}</b>${this.goalHtml(false)}`;
  }

  // ------------------------------------------------------------ Takt
  loop(ts) {
    if (this.dead) return;
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, Math.max(0, (ts - this.last) / 1000));
    this.last = ts;
    if (this.speed && !modalOpen()) this.sim.update(dt * this.speed);
    // Kamera folgt
    const cam = this.renderer.cam;
    if (this.follow && this.sel) {
      const a = this.sim.acs.find((x) => x.id === this.sel);
      if (a) {
        const k = 1 - Math.pow(0.03, dt);
        cam.x += (a.x - cam.x) * k;
        cam.y += (a.y - cam.y) * k;
        cam.tx = null;
      } else this.follow = false;
    }
    cam.update(dt);
    this.renderer.render(dt);
    if (!this.el.classList.contains('noside')) this.radar.render(dt);
    this.minimap.update(dt);
    // neue Anfragen: kurzer Ton
    for (const a of this.sim.acs) {
      if (a.req && !this.reqSeen.has(a.id + a.req)) {
        this.reqSeen.add(a.id + a.req);
        if (this.prefs.sound !== false && this.speed) sfx.request && sfx.request();
      }
    }
    if (this.reqSeen.size > 2000) this.reqSeen.clear();
    this.uiT -= dt;
    if (this.uiT <= 0) {
      this.uiT = 0.25;
      this.updateTop();
      this.updateStrips();
      this.updateInfo();
    }
  }
  exit() {
    closeModal();
    this.destroy();
    if (this.api.onExit) this.api.onExit();
  }
  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    voice.stop && voice.stop();
    tracks.stop && tracks.stop();
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    if (current === this) current = null;
  }
}

// Info-Klicks in der Info-Karte (Abwählen, Folgen)
document.addEventListener('click', (e) => {
  if (!current) return;
  const b = e.target.closest('#hub [data-hb="desel"], #hub [data-hb="follow"]');
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.hb === 'desel') current.select(null);
  else current.follow = !current.follow;
}, true);

export { AIRPORTS, getAirport };
