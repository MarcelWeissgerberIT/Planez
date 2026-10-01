// Mitfliegen (Beobachter): In ein Flugzeug einsteigen – mit perspektivischer 3D-Kamera, die am Flugzeug hängt und sich
// frei drehen lässt (Ziehen = um das Flugzeug drehen und neigen, Mausrad = Abstand). Dazu – am Fensterplatz (Blick durchs ovale Kabinenfenster auf
// Tragfläche und Boden, Anschnallzeichen, Kapitänsdurchsage) oder im Cockpit (Kamera schaut voraus, Instrumente
// mit Geschwindigkeit, Höhe, Kurs, Steig-/Sinkrate und Höhenansagen im Endanflug). Die Kamera fährt mit, bis das
// Flugzeug an der Position steht oder die Karte verlässt. Esc oder ✕ beendet. Nur Darstellung.
import { AC_TYPES, AIRLINES, CITIES, typeCode, typeName } from '../config.js';
import { PH, PHASE_DE } from '../sim/aircraft.js';
import { clamp, esc } from '../util.js';
import { voice } from '../voice.js';
import { icon } from './icons.js';
import { toast } from './dom.js';
import { sfx } from '../audio.js';
import { soundscape } from '../soundscape.js';
import { SpotterUi } from './spotter.js';
import { listeners } from '../sim/messages.js';
import * as AS from '../sim/airspace.js';
import * as LY from '../layout.js';
import { T } from '../i18n.js';

const KT = 323; // Kacheln je Spielsekunde -> Knoten (wie Info-Karte und Kino)
// Drohnensteuerung: Tasten -> Richtung
const DRONE_KEYS = { w: 'up', arrowup: 'up', ArrowUp: 'up', s: 'down', ArrowDown: 'down', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right', e: 'rise', ' ': 'rise', q: 'sink', c: 'sink' };
const FT = 500; // z -> Fuß
const CALLS = [500, 100, 50, 40, 30, 20, 10];
// Phasen eines ankommenden Flugs (ac.arr bleibt über den ganzen Umlauf gesetzt)
const ARR_PH = new Set([PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND, PH.FINAL, PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN]);

// 3D-Modul (three.js ≈ 0,7 MB) nur einmal laden – auch schon vorab im Hintergrund (Hover, Leerlauf)
let v3dMod = null;
export function preload3d() {
  if (!v3dMod) v3dMod = import('../render/view3d.js').catch((e) => {
    v3dMod = null;
    throw e;
  });
  return v3dMod;
}

export class Ride {
  constructor(game) {
    this.game = game;
    this.on = false;
    const el = document.createElement('div');
    el.id = 'ride';
    el.className = 'hidden';
    el.innerHTML = T`<div class="rd-drag"></div><div class="rd-haze"></div><div class="rd-win"><div class="rd-shade"></div></div>
      <div class="rd-cockpit"><canvas class="rd-rain"></canvas><div class="rd-pillar l"></div><div class="rd-pillar r"></div><div class="rd-pillar c"></div>
        <div class="rd-glare"><div class="rd-pfd"><div class="rd-tape spd"><small>KT</small><b data-r="spd">0</b></div><div class="rd-ai"><div class="rd-hor"></div><i></i><span data-r="fma">TAXI</span></div><div class="rd-tape alt"><small>FT</small><b data-r="alt">0</b><em data-r="vs"></em></div></div>
        <div class="rd-nd"><div class="rd-rose" data-r="rose"></div><b data-r="hdg">000</b><small data-r="nd"></small></div></div></div>
      <div class="rd-bar"><span class="rd-belt" title="Anschnallzeichen">${icon('vest')}</span><span class="rd-t"></span><span class="rd-modes"><button data-rd="cockpit">${icon('plane')} Cockpit</button><button data-rd="window">${icon('eye')} Fenster</button><button data-rd="chase">${icon('follow')} 3D außen</button></span><span class="rd-tw"><button data-rd="track" title="Kamera folgt dem ausgewählten Flugzeug (Fernglas zoomt mit)">${icon('follow')} Verfolgen</button><button data-rd="cine" title="Kino 3D: automatische Kamerafahrten – Landungen, Starts, Überflüge, Rollverkehr">${icon('cinema')} Kino</button><button data-rd="drone" title="Drohne: frei über den Flughafen fliegen (WASD, Q/E, Umschalt = schnell)">${icon('drone')} Drohne</button></span><span class="rd-dr"><button data-rd="tower" title="Zurück in den Turmblick">${icon('tower')} Turmblick</button></span><span class="rd-cn"><button data-rd="nextshot" title="Nächste Szene (Leertaste)">${icon('cinema')} Nächste Szene</button><button data-rd="tower" title="Zurück in den Turmblick">${icon('tower')} Turmblick</button></span><button class="rd-photo" data-rd="photo" title="Foto fürs Spotterbuch (F) – fotografiert das Flugzeug in der Bildmitte">${icon('photo')}</button><button class="rd-x" data-rd="x" title="Beenden (Esc)">✕</button></div><div class="rd-help">Ziehen = drehen und neigen · Mausrad = Abstand · Doppelklick = zurücksetzen</div><div class="rd-load"><i></i><span>3D-Ansicht wird geladen …</span></div><div class="rd-bino"></div><div class="rd-sub"></div><div class="rd-labels"></div><div class="rd-cap"></div><div class="rd-pad"><button data-k="up" title="vor">▲</button><button data-k="left" title="links">◀</button><button data-k="down" title="zurück">▼</button><button data-k="right" title="rechts">▶</button><button data-k="rise" title="steigen">⤒</button><button data-k="sink" title="sinken">⤓</button></div><div class="rd-marshal"><div class="rd-wand l"></div><div class="rd-wand r"></div><div class="rd-mres"></div><button class="rd-stop" data-rd="mstop">STOPP <small>Leertaste</small></button></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.tEl = el.querySelector('.rd-t');
    this.R = Object.fromEntries([...el.querySelectorAll('[data-r]')].map((x) => [x.dataset.r, x]));
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rd]');
      if (!b) return;
      if (b.dataset.rd === 'x') this.stop();
      else if (b.dataset.rd === 'track') this.setTrack(!this.track);
      else if (b.dataset.rd === 'cine') this.startCine3d();
      else if (b.dataset.rd === 'drone') this.startDrone();
      else if (b.dataset.rd === 'tower') this.startTower();
      else if (b.dataset.rd === 'nextshot') this.shot = null;
      else if (b.dataset.rd === 'photo') this.photo();
      else if (b.dataset.rd === 'mstop') this.marshalStop();
      else this.setMode(b.dataset.rd);
    });
    // frei drehbare Kamera: Ziehen dreht (Gier) und neigt, Mausrad ändert den Abstand
    const drag = el.querySelector('.rd-drag');
    let last = null;
    const touches = new Map(); // für Pinch-Zoom mit zwei Fingern
    let pinch = 0;
    let down = null;
    drag.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY };
      down = { x: e.clientX, y: e.clientY };
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag.setPointerCapture && drag.setPointerCapture(e.pointerId);
    });
    drag.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch && this.mode === 'tower') (this.fov = clamp((this.fov || 55) * (pinch / d), 5, 70)), (this.autoZoom = false);
        else if (pinch) this.zoomK = clamp(this.zoomK * (d / pinch), 0.45, 2.4);
        pinch = d;
        return;
      }
      if (!last || this.mode === 'cine3d') return;
      if (this.mode === 'drone') {
        this.yaw += (last.x - e.clientX) * 0.22;
        this.pitch = clamp(this.pitch + (last.y - e.clientY) * -0.18, -80, 70);
      } else if (this.mode === 'tower') {
        const k = (this.fov || 55) / 55;
        this.yaw += (last.x - e.clientX) * 0.18 * k;
        this.pitch = clamp(this.pitch + (last.y - e.clientY) * -0.15 * k, -25, 60);
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) this.setTrack(false);
      } else if (this.use3d) {
        this.yaw += (e.clientX - last.x) * 0.3;
        this.pitch = this.mode === 'chase' ? clamp(this.pitch + (e.clientY - last.y) * 0.25, 2, 85) : clamp(this.pitch + (e.clientY - last.y) * 0.2, -25, 70);
      } else {
        this.yaw += (e.clientX - last.x) * 0.35;
        this.pitch = clamp(this.pitch - (e.clientY - last.y) * 0.25, 30, 80);
      }
      last = { x: e.clientX, y: e.clientY };
    });
    const up = (e) => {
      if (this.mode === 'tower' && down && e && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && this.v3d) {
        const id = this.v3d.pick(e.clientX, e.clientY);
        if (id) this.game.select(id, false);
      }
      down = null;
      last = null;
      if (e && e.pointerId !== undefined) touches.delete(e.pointerId);
      if (touches.size < 2) pinch = 0;
    };
    drag.addEventListener('pointerup', up);
    drag.addEventListener('pointercancel', up);
    drag.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === 'drone') {
        this.droneMove(e.deltaY > 0 ? -1.5 : 1.5);
        return;
      }
      if (this.mode === 'tower') {
        this.fov = clamp((this.fov || 55) * (e.deltaY > 0 ? 1.12 : 0.89), 5, 70);
        this.autoZoom = false;
        return;
      }
      this.zoomK = clamp(this.zoomK * (e.deltaY > 0 ? 0.9 : 1.1), 0.45, 2.4);
    }, { passive: false });
    drag.addEventListener('dblclick', () => (this.mode === 'tower' ? this.resetTower() : this.setMode(this.mode)));
    window.addEventListener('keydown', (e) => {
      if (this.on && this.use3d && (e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target && e.target.tagName) || '')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.photo();
        return;
      }
      if (this.on && this.mode === 'drone' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target && e.target.tagName) || '')) {
        const k = DRONE_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
        if (k || e.key === 'Shift') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (k) this.keys.add(k);
          if (e.key === 'Shift') this.keys.add('fast');
          return;
        }
      }
      if (this.on && this.mode === 'marshal' && e.key === ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.marshalStop();
        return;
      }
      if (this.on && this.mode === 'cine3d' && (e.key === ' ' || e.key === 'ArrowRight')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.shot = null;
        return;
      }
      if (this.on && e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stop();
      }
    }, true);
    window.addEventListener('keyup', (e) => {
      if (!this.keys) return;
      const k = DRONE_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (k) this.keys.delete(k);
      if (e.key === 'Shift') this.keys.delete('fast');
    }, true);
    window.addEventListener('blur', () => this.keys && this.keys.clear());
    // Funk-Untertitel: im Cockpit die Funksprüche zum eigenen Flug, im Kino 3D den laufenden Funkverkehr
    listeners.radio.push((m) => this.onRadio(m));
    // Steuerkreuz für Touch (gedrückt halten)
    const pad = el.querySelector('.rd-pad');
    const press = (e, on) => {
      const b = e.target.closest('[data-k]');
      if (!b || !this.keys) return;
      e.preventDefault();
      if (on) this.keys.add(b.dataset.k);
      else this.keys.delete(b.dataset.k);
    };
    pad.addEventListener('pointerdown', (e) => press(e, true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) pad.addEventListener(ev, (e) => press(e, false));
  }

  start(acId, mode = 'window') {
    const s = this.game.state;
    const ac = s && s.acs.find((a) => a.id === acId);
    const inbound = ac && ac.mode === 'air' && ac.arr && ARR_PH.has(ac.phase);
    if (!ac || (ac.mode !== 'map' && !inbound)) return toast(T('Einsteigen geht im Anflug oder am Flughafen'), 'info', 2400);
    if (this.on && this.mode === 'tower') this.stop();
    this.on = true;
    this.id = acId;
    this.called = new Set();
    this.lastZ = ac.z || 0;
    this.endT = 0;
    this.game.ui.follow = null;
    this.labels = this.game.ui.labels;
    this.game.ui.labels = false;
    this.game.ui.selected = null;
    this.el.classList.remove('hidden');
    document.getElementById('game').classList.add('riding');
    this.setMode(mode);
    this.load3d();
    // Begrüßung durch den Kapitän (Terminal-/Kabinenstimme, nur mit Echter Funk)
    this.greet(s, ac, mode);
  }

  // echte 3D-Ansicht (WebGL) nachladen; bis dahin bzw. ohne WebGL die gekippte Karte
  load3d(onFail) {
    // bis die 3D-Ansicht bereit ist: Ladeanzeige, die 2D-Karte bleibt sichtbar
    if (!this.v3d) {
      this.el.classList.add('loading3d');
      clearTimeout(this.loadT);
      this.loadT = setTimeout(() => this.on && !this.use3d && toast(T('3D-Ansicht lädt noch (≈ 0,7 MB beim ersten Mal) …'), 'info', 4000), 6000);
    }
    const fail = (e) => {
      this.el.classList.remove('loading3d');
      clearTimeout(this.loadT);
      if (e) console.error('3D-Ansicht', e);
      if (e && this.on) toast(T`3D-Ansicht konnte nicht starten (${e.message || e}) – bitte die Seite neu laden (Strg+Umschalt+R)`, 'bad', 8000);
      else if (onFail) onFail();
      if (this.on) this.stop();
    };
    preload3d().then((m) => {
      if (!this.on) return;
      if (!m.View3D.supported()) return fail(null);
      try {
        this.v3d = this.v3d || new m.View3D(this.game);
      } catch (e) {
        return fail(e);
      }
      this.el.classList.remove('loading3d');
      clearTimeout(this.loadT);
      this.use3d = true;
      this.v3d.show();
      this.el.classList.add('v3d');
      if (this.mode === 'tower') document.getElementById('game').classList.add('towerview');
      const map = document.getElementById('map');
      map.style.transform = '';
      // nur die Mitflug-Kameras neu einstellen (Turm, Kino, Drohne, Einwinken behalten ihre Blickrichtung)
      if (['cockpit', 'window', 'chase'].includes(this.mode)) this.setMode(this.mode);
    }).catch((e) => fail(e));
  }

  greet(s, ac, mode) {
    const rot = s.rots[ac.rot];
    const city = rot && CITIES[rot.city] ? CITIES[rot.city].name : '';
    const al = AIRLINES[ac.airline];
    const dep = !ARR_PH.has(ac.phase);
    this.arriving = !dep;
    if (mode === 'window' && s.settings.tts && voice.on && voice.announce) {
      voice.announce(dep ? T`Meine Damen und Herren, hier spricht Ihr Kapitän. Willkommen an Bord von ${al ? al.name : ''}${city ? T` nach ${city}` : ''}. Bitte schnallen Sie sich an, wir starten in Kürze.` : T`Meine Damen und Herren, wir befinden uns im Landeanflug auf Planez. Bitte bleiben Sie angeschnallt, bis wir die Parkposition erreicht haben.`);
    }
  }

  setMode(mode) {
    this.mode = mode;
    // Grundeinstellung je Ansicht: Blickrichtung (relativ zur Flugrichtung), Neigung, Abstand
    this.yaw = mode === 'window' ? (this.use3d ? 95 : 90) : 0; // am Fenster leicht nach vorn auf die Tragfläche
    this.pitch = this.use3d ? (mode === 'cockpit' ? 5 : mode === 'window' ? 3 : 16) : mode === 'cockpit' ? 70 : mode === 'window' ? 66 : 56;
    this.zoomK = 1;
    for (const b of this.el.querySelectorAll('.rd-modes [data-rd]')) b.classList.toggle('on', b.dataset.rd === mode);
    // im Cockpit sitzt man im Flugzeug – es selbst wird nicht gezeichnet
    if (this.game.map) this.game.map.hideAc = mode === 'cockpit' ? this.id : null;
    this.el.classList.toggle('cockpit', mode === 'cockpit');
    this.el.classList.toggle('window', mode === 'window');
    this.el.classList.toggle('chase', mode === 'chase');
    this.el.classList.toggle('tower', false);
  }

  // Turmblick: echte 3D-Sicht aus der Tower-Kanzel. Ziehen = umsehen, Mausrad = Fernglas, Klick = Flugzeug wählen,
  // „Verfolgen“ schwenkt (und zoomt) auf das ausgewählte Flugzeug. Panel, Funk, Radar und Streifen bleiben bedienbar.
  startTower() {
    if (this.on) this.stop();
    this.on = true;
    this.cam0 = { x: this.game.cam.x, y: this.game.cam.y, zoom: this.game.cam.zoom };
    this.id = null;
    this.mode = 'tower';
    this.resetTower();
    this.track = false;
    this.lbl = new Map();
    this.el.classList.remove('hidden', 'cockpit', 'window', 'chase', 'cine3d', 'drone');
    this.el.classList.add('tower');
    this.el.querySelector('.rd-help').textContent = T('Ziehen = umsehen · Mausrad = Fernglas · Klick auf ein Flugzeug = auswählen · Doppelklick = zurücksetzen');
    this.tEl.textContent = T('Turmblick');
    clearTimeout(this.helpT);
    this.el.classList.remove('nohelp');
    this.helpT = setTimeout(() => this.el.classList.add('nohelp'), 7000);
    document.getElementById('t-tower3d')?.classList.add('on');
    this.setTrack(!!this.game.ui.selected);
    this.load3d(() => {
      toast(T('Der Turmblick braucht WebGL – dein Browser bietet es gerade nicht an'), 'warn', 3200);
      this.stop();
    });
  }

  resetTower() {
    // Blick vom Turm auf die Bahnmitte (großer Tower im Nordosten; im Aufbau-Modus Vereinsheim bzw. Flugleitung)
    const id = LY.GEO.stage === 0 ? 'club' : LY.GEO.stage === 1 ? 'stower' : 'tower';
    const b = LY.BUILDINGS.find((q) => q.id === id) || LY.BUILDINGS.find((q) => q.id === 'tower');
    const ex = b.fx - b.w / 2, ez = b.fy - b.d / 2, eh = id === 'club' ? 0.56 : id === 'stower' ? 1.6 : 6.1;
    const tx = (LY.RWY.x0 + LY.RWY.x1) / 2, tz = LY.RWY.y;
    this.yaw = (Math.atan2(tz - ez, tx - ex) * 180) / Math.PI;
    this.pitch = Math.max(2, (Math.atan2(eh, Math.hypot(tx - ex, tz - ez)) * 180) / Math.PI);
    this.fov = id === 'tower' ? 50 : 62;
    this.autoZoom = true;
  }

  setTrack(on) {
    this.track = !!on;
    this.autoZoom = this.track;
    const b = this.el.querySelector('[data-rd=track]');
    if (b) b.classList.toggle('on', this.track);
  }

  updateTower(dt) {
    const s = this.game.state;
    if (!this.use3d) return;
    const sel = this.game.ui.selected;
    const ac = sel && s.acs.find((a) => a.id === sel);
    // Verfolgen: Blick und Fernglas sanft auf das ausgewählte Flugzeug
    if (this.track && ac) {
      const p = this.v3d.acPos(ac.id), c = this.v3d.towerEye();
      if (p) {
        const dx = p.x - c.x, dz = p.z - c.z, dist = Math.hypot(dx, dz);
        let dy = ((Math.atan2(dz, dx) * 180) / Math.PI - this.yaw) % 360;
        if (dy > 180) dy -= 360;
        if (dy < -180) dy += 360;
        const k = 1 - Math.exp(-dt * 4);
        this.yaw += dy * k;
        this.pitch += ((Math.atan2(c.y - p.y, dist) * 180) / Math.PI - this.pitch) * k;
        if (this.autoZoom) this.fov += (clamp((2 * Math.atan((ac.len || 2.4) * 3.2 / Math.max(1, dist)) * 180) / Math.PI, 6, 55) - this.fov) * k;
      }
    }
    this.v3d.render(s, this, null);
    this.hearAt(Math.max(0.6, Math.min(3, 55 / (this.fov || 55) * 0.8)));
    // Fernglas: ab etwa 3× Vergrößerung runder Sehrand
    const bino = clamp((22 - (this.fov || 55)) / 8, 0, 1);
    if (this.binoK !== bino) (this.binoK = bino), this.el.style.setProperty('--bino', bino.toFixed(2));
    this.drawLabels(s, sel);
    const wx = s.weather;
    const txt = T`Turmblick${ac ? ` · ${ac.cs}` : ''} · ${Math.round(55 / (this.fov || 55) * 10) / 10}×`;
    if (this.tEl.textContent !== txt) this.tEl.textContent = txt;
    void wx;
  }

  // Rufzeichen-Schilder über den Flugzeugen (anklickbar)
  drawLabels(s, sel) {
    const box = this.el.querySelector('.rd-labels');
    const seen = new Set();
    for (const ac of s.acs) {
      const p = this.v3d.screenOf(ac.id);
      if (!p) continue;
      seen.add(ac.id);
      let d = this.lbl.get(ac.id);
      if (!d) {
        d = document.createElement('div');
        d.className = 'rl';
        d.dataset.id = ac.id;
        d.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.game.select(ac.id, false);
        });
        box.appendChild(d);
        this.lbl.set(ac.id, d);
      }
      const alt = ac.mode === 'air' ? Math.round((ac.alt || 0) / 100) * 100 : Math.round((ac.z || 0) * 500 / 10) * 10;
      const html = `<b>${esc(ac.cs)}</b><small>${esc(typeCode(ac.type))}${alt > 0 ? ` · ${alt} ft` : ''}</small>`;
      if (d._h !== html) (d.innerHTML = html, (d._h = html));
      d.classList.toggle('sel', ac.id === sel);
      d.classList.toggle('emg', !!(ac.emergency || ac.fuelEmergency));
      d.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      d.style.opacity = p.far ? 0.75 : 1;
    }
    // Rettungshubschrauber und Cessna in der Platzrunde
    for (const [key, obj, name] of [['heli', s.heli && s.heli.h, 'Rescue 7'], ['vfr', s.vfr && s.vfr.p, s.vfr && s.vfr.p && s.vfr.p.cs]]) {
      const p = obj && this.v3d.screenOfGA(key);
      if (!p) continue;
      const id = '#' + key;
      seen.add(id);
      let d = this.lbl.get(id);
      if (!d) {
        d = document.createElement('div');
        d.className = 'rl ga';
        d.title = key === 'heli' ? T('Im Rettungshubschrauber mitfliegen') : T('Rundflug: in der Alcedo mitfliegen');
        d.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.startGA(key === 'heli' ? 'heli' : 'vfr');
        });
        box.appendChild(d);
        this.lbl.set(id, d);
      }
      const html = T`<b>${esc(name || '')}</b><small>${key === 'heli' ? T('Hubschrauber') : 'C172'} · mitfliegen</small>`;
      if (d._h !== html) (d.innerHTML = html, (d._h = html));
      d.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
    for (const [id, d] of this.lbl) if (!seen.has(id)) (d.remove(), this.lbl.delete(id));
  }

  // Kabinenklang (nur Cockpit/Fenster): Daten des eigenen Flugzeugs an die Klangkulisse
  cabinSound(ac, kt, air, climb) {
    const inside = this.mode === 'cockpit' || this.mode === 'window';
    soundscape.cabin = inside && ac ? { phase: ac.phase, kt: kt || 0, air, climb, ground: !air, moving: (ac.v || 0) > 0.02, prop: AC_TYPES[ac.type].sprite === 'plane_prop' } : null;
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.el.querySelector('.rd-sub').innerHTML = '';
    this.el.classList.remove('loading3d');
    clearTimeout(this.loadT);
    soundscape.cabin = null;
    this.ga = null;
    if (this.cam0) {
      Object.assign(this.game.cam, this.cam0);
      this.cam0 = null;
    }
    if (this.mode === 'drone') {
      this.el.classList.remove('drone');
      this.keys && this.keys.clear();
      this.mode = null;
    }
    if (this.mode === 'marshal') {
      this.el.classList.remove('marshal');
      this.el.querySelector('.rd-mres').innerHTML = '';
      if (this.spd0 !== undefined && this.game.state) this.game.state.speed = this.spd0;
      this.spd0 = undefined;
      this.mode = null;
    }
    if (this.mode === 'cine3d') {
      this.el.classList.remove('cine3d');
      this.el.querySelector('.rd-cap').innerHTML = '';
      this.id = null;
      this.cineChase = false;
    }
    if (this.mode === 'tower') {
      document.getElementById('game').classList.remove('towerview');
      document.getElementById('t-tower3d')?.classList.remove('on');
      this.el.classList.remove('tower');
      this.el.style.removeProperty('--bino');
      this.binoK = 0;
      this.el.querySelector('.rd-labels').innerHTML = '';
      this.el.querySelector('.rd-help').textContent = T('Ziehen = drehen und neigen · Mausrad = Abstand · Doppelklick = zurücksetzen');
      this.lbl = new Map();
      this.mode = null;
    }
    if (this.game.map) this.game.map.hideAc = null;
    if (this.v3d) this.v3d.hide();
    this.use3d = false;
    this.el.classList.remove('v3d');
    this.el.classList.add('hidden');
    document.getElementById('game').classList.remove('riding');
    if (this.labels !== undefined) this.game.ui.labels = this.labels !== false;
    this.labels = undefined;
    this.game.cam.tx = null;
    const map = document.getElementById('map');
    map.style.transform = '';
    map.style.transformOrigin = '';
    document.getElementById('game').style.removeProperty('--rd-sky');
  }

  // Karte perspektivisch kippen und so drehen, dass die Blickrichtung (Flugrichtung + freie Drehung) nach vorn zeigt;
  // Himmel mit Horizont und Dunst dahinter, damit der Kartenrand im Dunst verschwindet
  perspective(ac) {
    const cam = this.game.cam;
    const map = document.getElementById('map');
    const W = cam.w, H = cam.h;
    const a = cam.toScreen(ac.x, ac.y, ac.z || 0), b = cam.toScreen(ac.x + Math.cos(ac.hdg), ac.y + Math.sin(ac.hdg), ac.z || 0);
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; // Flugrichtung auf dem Bild
    const rz = -90 - ang - this.yaw;
    const P = 620;
    const th = this.pitch;
    const lift = this.mode === 'cockpit' ? 0.3 : this.mode === 'window' ? 0.24 : 0.2;
    map.style.transformOrigin = '50% 50%';
    map.style.transform = `translateY(${Math.round(H * lift)}px) perspective(${P}px) rotateX(${th}deg) rotateZ(${rz.toFixed(2)}deg)`;
    // Horizont (unendlich ferne Bodenlinie) und nächster möglicher Kartenrand auf dem Bildschirm
    const rad = (th * Math.PI) / 180;
    const oy = H / 2 + H * lift;
    const hz = oy - P / Math.tan(rad);
    const d = Math.min(W, H) * 0.48;
    const edge = oy - (d * Math.cos(rad) * P) / (P + d * Math.sin(rad));
    const hr = ((this.game.state.time / 3600) % 24 + 24) % 24;
    const night = hr < 5.5 || hr > 21 ? 1 : hr < 7 ? (7 - hr) / 1.5 : hr > 19.5 ? (hr - 19.5) / 1.5 : 0;
    const sky = night > 0.5 ? ['#0b1324', '#1e2a44', '#2a3550'] : ['#4f86c6', '#9cc3e6', '#dce8f0'];
    const haze = night > 0.5 ? '#26304a' : '#cfdbe2';
    const g = document.getElementById('game');
    g.style.setProperty('--rd-sky', `linear-gradient(to bottom, ${sky[0]} 0px, ${sky[1]} ${Math.max(0, hz - 60)}px, ${sky[2]} ${hz}px, ${haze} ${hz + 2}px, ${haze} 100%)`);
    const hzEl = this.el.querySelector('.rd-haze');
    hzEl.style.top = `${Math.round(hz - 40)}px`;
    hzEl.style.height = `${Math.max(60, Math.round(edge - hz + 110))}px`;
    hzEl.style.background = `linear-gradient(to bottom, ${sky[2]}00 0%, ${haze} 30%, ${haze} ${Math.max(35, Math.min(80, ((edge - hz + 40) / (edge - hz + 110)) * 100))}%, ${haze}00 100%)`;
  }

  // Höhenansage im Endanflug (englisch, kurz)
  callout(n) {
    if (!window.speechSynthesis || !this.game.state.settings.tts) return;
    const u = new SpeechSynthesisUtterance(typeof n === 'string' ? n : n === 500 ? 'five hundred' : n === 100 ? 'one hundred' : String(n));
    u.lang = 'en-US';
    u.rate = 1.25;
    u.pitch = 0.9;
    u.volume = voice.vol ?? 0.9;
    speechSynthesis.speak(u);
  }

  update(dt) {
    if (!this.on) return;
    try {
      this.update0(dt);
    } catch (e) {
      console.error('3D-Ansicht', e);
      this.errN = (this.errN || 0) + 1;
      if (this.errN >= 3) {
        this.errN = 0;
        toast(T`3D-Ansicht: Fehler „${e.message}“ – bitte die Seite neu laden (Strg+Umschalt+R)`, 'bad', 8000);
        this.stop();
      }
    }
  }

  update0(dt) {
    const g = this.game, s = g.state, cam = g.cam;
    if (g.cinema && g.cinema.on) return this.stop();
    if (this.ga) return this.updateGA(dt);
    if (this.mode === 'marshal') return this.updateMarshal(dt);
    if (this.mode === 'drone') return this.updateDrone(dt);
    if (this.mode === 'tower') return this.updateTower(dt);
    if (this.mode === 'cine3d') return this.updateCine3d(dt);
    const ac = s && s.acs.find((a) => a.id === this.id);
    // noch im Anflug außerhalb der Karte: Kamera wartet am Anfang des Endanflugs, Instrumente mit echten Luftdaten
    if (ac && ac.mode === 'air' && ac.arr && ARR_PH.has(ac.phase)) return this.updateAir(s, ac, dt);
    // nach dem Start: im Steigflug mitfliegen, bis die Maschine hoch und weit genug weg ist
    if (ac && ac.mode === 'air' && !this.arriving && this.use3d && (ac.alt || 0) < 9000 && Math.hypot(ac.pos.x, ac.pos.y) < 22) return this.updateAirDep(s, ac, dt);
    if (!ac || ac.mode !== 'map' || ac.phase === PH.GONE) {
      toast(ac && !this.arriving ? T('✈️ Gute Reise! Das Flugzeug hat den Flughafen verlassen.') : T('Ausgestiegen'), 'info', 2600);
      return this.stop();
    }
    // an der Position angekommen: kurz stehen bleiben, dann aussteigen
    if (ARR_PH.has(ac.phase)) this.arriving = true;
    if (this.arriving && ac.phase === PH.STAND) {
      this.endT += dt;
      if (this.endT > 5) {
        toast(T`Willkommen in ${s.name}! Ausgestiegen.`, 'good', 2600);
        return this.stop();
      }
    }
    const L = ac.len, fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
    const z = ac.z || 0;
    // Standpunkt: Cockpit an der Nase, Fenster über der rechten Tragfläche, außen in der Flugzeugmitte
    const seat = this.mode === 'cockpit' ? L * 0.45 : this.mode === 'window' ? -L * 0.05 : 0;
    const side = this.mode === 'window' ? L * 0.18 : 0;
    const tx = ac.x + fx * seat + rx * side, ty = ac.y + fy * seat + ry * side - z * 0.4;
    // je höher, desto weiter fällt der Boden ab
    const tz = ({ cockpit: 1.7, window: 2.1, chase: 1.9 }[this.mode] * this.zoomK) / (1 + z * 0.35);
    const k = 1 - Math.pow(0.0001, dt);
    // Rütteln auf der Bahn: Startlauf und Ausrollen, je schneller, desto stärker
    const rumble = (ac.phase === PH.TAKEOFF && z < 0.05) || (ac.phase === PH.ROLLOUT && (ac.v || 0) > 0.15) ? Math.min(0.05, (ac.v || 0) * 0.08) : 0;
    const jx = rumble ? (Math.random() - 0.5) * rumble : 0, jy = rumble ? (Math.random() - 0.5) * rumble : 0;
    cam.x += (tx - cam.x) * k + jx;
    cam.y += (ty - cam.y) * k + jy;
    cam.zoom += (tz - cam.zoom) * Math.min(1, dt * 3);
    cam.tx = null;
    if (this.use3d) this.v3d.render(s, this, ac);
    else this.perspective(ac);
    this.windshield(dt, s.weather.kind, (ac.v || 0) * KT);
    // Klang: innen der Kabinenmix des eigenen Flugzeugs; Aufsetzen und Fahrwerk als Ereignis
    this.cabinSound(ac, ac.v * KT, z > 0.02, ac.phase === PH.TAKEOFF && z > 0.02);
    if (this.lastPh === PH.FINAL && ac.phase === PH.ROLLOUT) soundscape.touchdown(clamp((ac.tdFpm || 250) / 600, 0.2, 1));
    if (ac.phase === PH.TAKEOFF && z > 0.3 && !this.called.has('gearUp')) (this.called.add('gearUp'), soundscape.gear());
    this.lastPh = ac.phase;
    // Instrumente und Anzeige
    const kt = Math.round((ac.v || 0) * KT), alt = Math.round((z * FT) / 10) * 10;
    const vs = dt > 0 ? ((z - this.lastZ) * FT * 60) / Math.max(dt * (s.speed || 1) * 15, 1e-3) : 0;
    this.lastZ = z;
    const hdg = Math.round(((ac.hdg * 180) / Math.PI + 90 + 360) % 360);
    const rot = s.rots[ac.rot];
    const city = rot && CITIES[rot.city] ? CITIES[rot.city].name : '';
    const arrNow = ARR_PH.has(ac.phase);
    const belt = ac.phase !== PH.STAND;
    if (this.belt !== undefined && this.belt !== belt) sfx.chime && sfx.chime();
    this.belt = belt;
    this.el.querySelector('.rd-belt').classList.toggle('on', !!belt);
    const where = `${esc(ac.cs)} · ${esc(AC_TYPES[ac.type].name)}${city ? ` · ${arrNow ? T`aus ${esc(city)}` : T`nach ${esc(city)}`}` : ''}`;
    const txt = this.mode === 'window' ? T`Platz ${12 + (ac.id.length * 7) % 18}F · ${where} · ${PHASE_DE[ac.phase] || ''}${alt > 0 ? ` · ${alt} ft` : ''}` : `${this.mode === 'chase' ? T('Außenkamera') : T('Cockpit')} · ${where} · ${PHASE_DE[ac.phase] || ''}${alt > 0 ? ` · ${alt} ft` : ''}`;
    if (this.tEl.innerHTML !== txt) this.tEl.innerHTML = txt;
    if (this.mode === 'cockpit') {
      this.R.spd.textContent = kt;
      this.R.alt.textContent = alt;
      this.R.vs.textContent = Math.abs(vs) > 50 ? `${vs > 0 ? '↑' : '↓'}${Math.round(Math.abs(vs) / 50) * 50}` : '';
      this.R.hdg.textContent = String(hdg).padStart(3, '0');
      this.R.rose.style.transform = `rotate(${-hdg}deg)`;
      const fma = { [PH.FINAL]: z < 0.12 ? 'FLARE' : 'LAND', [PH.ROLLOUT]: 'ROLLOUT', [PH.TAKEOFF]: z > 0.05 ? 'SRS · CLB' : 'TOGA', [PH.MISSED]: 'GA · TOGA', [PH.LINED]: 'LINED UP', [PH.LINEUP]: 'LINE UP', [PH.HOLDING]: 'HOLD SHORT', [PH.TAXI_OUT]: 'TAXI', [PH.TAXI_IN]: 'TAXI', [PH.PUSH]: 'PUSH', [PH.STARTUP]: T('ENG START'), [PH.STAND]: 'PARK' }[ac.phase] || '';
      this.R.fma.textContent = fma;
      const pitch = ac.phase === PH.TAKEOFF && z > 0.02 ? 12 : ac.phase === PH.MISSED ? 10 : ac.phase === PH.FINAL ? (z < 0.12 ? 4 : -2.5) : 0;
      this.el.querySelector('.rd-hor').style.transform = `translateY(${pitch * 2.2}px)`;
      this.R.nd.textContent = ac.phase === PH.FINAL ? `RWY ${s.rwy} · ${((distLeft(ac)) * 20 / 1852).toFixed(1)} NM` : arrNow ? (ac.stand ? `→ P${ac.stand}` : '') : rot && rot.sid ? rot.sid : '';
      // Startlauf: V1, Rotate, Positive rate
      if (ac.phase === PH.TAKEOFF) {
        if (kt >= 120 && !this.called.has('v1')) (this.called.add('v1'), this.callout('V one'));
        if (z > 0.01 && !this.called.has('rot')) (this.called.add('rot'), this.callout('Rotate'));
        if (z > 0.25 && !this.called.has('pos')) (this.called.add('pos'), this.callout(T('Positive rate. Gear up.')));
      }
      // Höhenansagen im Endanflug
      if (ac.phase === PH.FINAL) for (const n of CALLS) if (alt <= n && alt > 0 && !this.called.has(n)) {
        this.called.add(n);
        if (n === 500 || n === 100 || n <= 50) this.callout(n);
      }
    }
  }
}

Ride.prototype.updateAir = function (s, ac, dt) {
  const cam = this.game.cam;
  this.windshield(dt, s.weather.kind, ac.spd || 0);
  this.cabinSound(ac, ac.spd || 0, true, false);
  if (!this.called.has('gearDn') && (ac.alt || 0) < 1800 && ac.phase === PH.APPROACH) (this.called.add('gearDn'), soundscape.gear());
  const dir = s.rwy === '27' ? 1 : -1; // Anflug auf die 27 kommt von Osten
  const tx = (dir > 0 ? LY.RWY.x1 + 8 : LY.RWY.x0 - 8), ty = LY.RWY.y - 1.5;
  const k = 1 - Math.pow(0.02, dt);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.zoom += ((this.mode === 'cockpit' ? 1.4 : 1.8) - cam.zoom) * Math.min(1, dt * 2);
  cam.tx = null;
  if (this.use3d) this.v3d.render(s, this, ac);
  else this.perspective({ x: cam.x, y: cam.y, z: 0, hdg: dir > 0 ? Math.PI : 0 });
  const d = AS.routeDistance(ac.pos, ac.route.length && ac.phase === PH.APPROACH ? ac.route : AS.approachRoute(ac.pos, ac.rwy));
  const rot = s.rots[ac.rot];
  const city = rot && CITIES[rot.city] ? CITIES[rot.city].name : '';
  const where = `${esc(ac.cs)} · ${esc(AC_TYPES[ac.type].name)}${city ? T` · aus ${esc(city)}` : ''}`;
  const txt = T`${this.mode === 'window' ? T`Platz ${12 + (ac.id.length * 7) % 18}F` : this.mode === 'chase' ? T('Außenkamera') : T('Cockpit')} · ${where} · ${PHASE_DE[ac.phase] || ''} · noch ${d.toFixed(1)} NM`;
  if (this.tEl.innerHTML !== txt) this.tEl.innerHTML = txt;
  this.arriving = true;
  this.el.querySelector('.rd-belt').classList.add('on');
  if (this.mode === 'cockpit') {
    this.R.spd.textContent = Math.round(ac.spd || 0);
    this.R.alt.textContent = Math.round((ac.alt || 0) / 10) * 10;
    this.R.vs.textContent = ac.tAlt < ac.alt - 150 ? '↓' : ac.tAlt > ac.alt + 150 ? '↑' : '';
    const hdg = Math.round(((ac.crs || 0) + 360) % 360);
    this.R.hdg.textContent = String(hdg).padStart(3, '0');
    this.R.rose.style.transform = `rotate(${-hdg}deg)`;
    this.R.fma.textContent = { [PH.HOLD]: 'HOLD', [PH.APPROACH]: ac.clr && ac.clr.land ? 'G/S · LOC' : 'APP', [PH.INBOUND]: 'NAV', [PH.GOAROUND]: 'GA' }[ac.phase] || 'NAV';
    this.el.querySelector('.rd-hor').style.transform = `translateY(${ac.tAlt < ac.alt - 150 ? -5 : 0}px)`;
    this.R.nd.textContent = `RWY ${s.rwy} · ${d.toFixed(1)} NM`;
  }
};

// Klangkulisse hört dort, wohin die 3D-Kamera schaut (Bodenpunkt in Blickrichtung), Fernglas = näher dran
Ride.prototype.hearAt = function (zoom) {
  const c = this.v3d && this.v3d.camera;
  if (!c) return;
  const d = { x: 0, y: 0, z: 0 };
  const e = c.matrixWorld.elements;
  d.x = -e[8];
  d.y = -e[9];
  d.z = -e[10];
  const t = d.y < -0.03 ? Math.min(60, c.position.y / -d.y) : 25;
  this.game.cam.x = c.position.x + d.x * t;
  this.game.cam.y = c.position.z + d.z * t;
  this.game.cam.zoom = zoom;
  this.game.cam.tx = null;
};

// Steigflug nach dem Start (3D): Instrumente mit den echten Luftdaten, SID im Navigationsdisplay
Ride.prototype.updateAirDep = function (s, ac, dt) {
  this.v3d.render(s, this, ac);
  this.windshield(dt, s.weather.kind, ac.spd || 0);
  this.cabinSound(ac, ac.spd || 0, true, (ac.tAlt || 0) > (ac.alt || 0) + 150);
  // die 2D-Kamera (Klangkulisse) folgt dem Flugzeug auch außerhalb der Karte
  const p = LY.nmToTile(ac.pos.x, ac.pos.y);
  this.game.cam.x = p.x;
  this.game.cam.y = p.y;
  const rot = s.rots[ac.rot];
  const city = rot && CITIES[rot.city] ? CITIES[rot.city].name : '';
  const alt = Math.round((ac.alt || 0) / 10) * 10;
  const where = `${esc(ac.cs)} · ${esc(AC_TYPES[ac.type].name)}${city ? T` · nach ${esc(city)}` : ''}`;
  const txt = T`${this.mode === 'window' ? T`Platz ${12 + (ac.id.length * 7) % 18}F` : this.mode === 'chase' ? T('Außenkamera') : T('Cockpit')} · ${where} · Steigflug · ${alt} ft`;
  if (this.tEl.innerHTML !== txt) this.tEl.innerHTML = txt;
  // Anschnallzeichen aus ab 3.000 ft
  const belt = alt < 3000;
  if (this.belt !== undefined && this.belt !== belt) sfx.chime && sfx.chime();
  this.belt = belt;
  this.el.querySelector('.rd-belt').classList.toggle('on', belt);
  if (this.mode === 'cockpit') {
    this.R.spd.textContent = Math.round(ac.spd || 0);
    this.R.alt.textContent = alt;
    this.R.vs.textContent = ac.tAlt > ac.alt + 150 ? '↑' : '';
    const hdg = Math.round(((ac.crs || 0) + 360) % 360);
    this.R.hdg.textContent = String(hdg).padStart(3, '0');
    this.R.rose.style.transform = `rotate(${-hdg}deg)`;
    this.R.fma.textContent = 'CLB · NAV';
    this.el.querySelector('.rd-hor').style.transform = 'translateY(14px)';
    this.R.nd.textContent = rot && rot.sid ? rot.sid : '';
  }
  void dt;
};

// grobe Restdistanz zur Schwelle im Endanflug (Kacheln), aus der Höhe abgeleitet (3°-Gleitpfad ≈ 1 Kachel je 0,05 z)
function distLeft(ac) {
  return Math.max(0, (ac.z || 0) / 0.05);
}

// ---------- Kino 3D: automatische Kamerafahrten in der WebGL-Ansicht ----------
// Szenen: Landung von der Bahnseite, Start, Überflug am Bahnende, Anflug von hinten, Rollverkehr, Pushback,
// Rettungshubschrauber, Cessna, Kranfahrt über das Vorfeld und der Blick vom Tower. Jede Szene läuft 9–16 s;
// ist das Motiv weg (gelandet, abgeflogen), kommt die nächste. Breitbild-Balken und Einblendung unten links.
const CINE_SUB = { land: T('Landung'), takeoff: T('Start'), climb: T('Steigflug'), app: T('Im Anflug'), taxi: T('Rollt'), push: T('Pushback'), heli: T('Rettungshubschrauber'), vfr: T('Platzrunde'), orbit: T('Vorfeld'), tower: T('Blick vom Tower') };

Ride.prototype.startCine3d = function () {
  if (this.on) this.stop();
  this.on = true;
  this.cam0 = { x: this.game.cam.x, y: this.game.cam.y, zoom: this.game.cam.zoom };
  this.id = null;
  this.mode = 'cine3d';
  this.shot = null;
  this.recent = [];
  this.labels = this.game.ui.labels;
  this.el.classList.remove('hidden', 'cockpit', 'window', 'chase', 'tower');
  this.el.classList.add('cine3d');
  document.getElementById('game').classList.add('riding');
  this.tEl.textContent = T('Kino 3D');
  this.load3d(() => {
    toast(T('Kino 3D braucht WebGL – dein Browser bietet es gerade nicht an'), 'warn', 3200);
    this.stop();
  });
};

Ride.prototype.cineShots = function (s) {
  const out = [];
  const seen = (id) => this.recent.includes(id);
  const R = (ac) => (ac.strip === 'S' ? LY.RWY_S : LY.RWY);
  for (const a of s.acs) {
    if (a.mode === 'map') {
      if (a.phase === PH.FINAL) {
        const d = LY.rwyDir(a.rwy);
        const rem = (R(a).thr[a.rwy] + d * R(a).td - a.x) * d;
        if (rem > 6 && rem < 34) out.push({ kind: 'land', id: a.id, w: seen(a.id) ? 0.3 : 7 });
      } else if (a.phase === PH.LINED || a.phase === PH.LINEUP || (a.phase === PH.TAKEOFF && (a.z || 0) < 0.05)) out.push({ kind: 'takeoff', id: a.id, w: seen(a.id) ? 0.3 : 6 });
      else if (a.phase === PH.TAKEOFF && (a.z || 0) < 1.2) out.push({ kind: 'climb', id: a.id, w: seen(a.id) ? 0.3 : 3 });
      else if (a.phase === PH.TAXI_IN || a.phase === PH.TAXI_OUT) out.push({ kind: 'taxi', id: a.id, w: seen(a.id) ? 0.2 : 1.6 });
      else if (a.phase === PH.PUSH) out.push({ kind: 'push', id: a.id, w: seen(a.id) ? 0.2 : 2 });
    } else if (a.arr && a.pos && (a.phase === PH.APPROACH || a.phase === PH.FINAL) && Math.hypot(a.pos.x, a.pos.y) < 6) out.push({ kind: 'app', id: a.id, w: seen(a.id) ? 0.3 : 3 });
  }
  if (s.heli && s.heli.h) out.push({ kind: 'heli', id: 'heli' + s.heli.n, w: seen('heli' + s.heli.n) ? 0.3 : 3 });
  if (s.vfr && s.vfr.p) out.push({ kind: 'vfr', id: 'vfr' + s.vfr.n, w: seen('vfr' + s.vfr.n) ? 0.3 : 1.6 });
  out.push({ kind: 'orbit', id: 'orbit', w: seen('orbit') ? 0.3 : 1 });
  out.push({ kind: 'tower', id: 'tower', w: seen('tower') ? 0.3 : 0.8 });
  return out;
};

Ride.prototype.pickShot = function (s) {
  const c = this.cineShots(s);
  const tot = c.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * tot;
  let sh = c[c.length - 1];
  for (const x of c) {
    r -= x.w;
    if (r <= 0) {
      sh = x;
      break;
    }
  }
  sh = { ...sh, t: 0, dur: { land: 15, takeoff: 16, climb: 10, app: 12, taxi: 10, push: 9, heli: 12, vfr: 12, orbit: 14, tower: 12 }[sh.kind], side: Math.random() < 0.5 ? -1 : 1, a0: Math.random() * Math.PI * 2 };
  this.recent = [sh.id, ...this.recent].slice(0, 6);
  // feste Kamerapunkte je Szene
  const ac = s.acs.find((a) => a.id === sh.id);
  if (ac && ac.mode === 'map') {
    const RW = ac.strip === 'S' ? LY.RWY_S : LY.RWY;
    const d = LY.rwyDir(ac.rwy || s.rwy);
    const thr = RW.thr[ac.rwy || s.rwy];
    if (sh.kind === 'land') sh.cam = { x: thr + d * (RW.td + 7), y: 0.22, z: RW.y + sh.side * 4.2 };
    else if (sh.kind === 'takeoff') sh.cam = { x: thr + d * 26, y: 0.18, z: RW.y + sh.side * 3.6 };
    else if (sh.kind === 'climb') sh.cam = { x: (d > 0 ? RW.x1 : RW.x0) + d * 5, y: 0.12, z: RW.y + sh.side * 1.6 };
    else if (sh.kind === 'taxi' || sh.kind === 'push') {
      // Rollen: Kamera wartet vorn seitlich; Pushback: seitlich hinter dem Flugzeug (es rollt rückwärts darauf zu)
      const h = ac.hdg || 0, ahead = sh.kind === 'taxi' ? 7 : -2.5, side = sh.kind === 'taxi' ? 2.2 : 3.8;
      sh.cam = { x: ac.x + Math.cos(h) * ahead - Math.sin(h) * side * sh.side, y: sh.kind === 'taxi' ? 0.3 : 0.4, z: ac.y + Math.sin(h) * ahead + Math.cos(h) * side * sh.side };
      sh.cam.z = Math.max(sh.cam.z, LY.TERMINAL.y1 + 0.8); // nie im Terminal
    }
  }
  return sh;
};

Ride.prototype.updateCine3d = function (dt) {
  const s = this.game.state;
  if (!this.use3d) return;
  let sh = this.shot;
  const subj = (x) => x && s.acs.find((a) => a.id === x.id);
  const ok = (x) => {
    if (!x || x.t > x.dur) return false;
    if (x.kind === 'heli') return !!(s.heli && s.heli.h);
    if (x.kind === 'vfr') return !!(s.vfr && s.vfr.p);
    if (x.kind === 'orbit' || x.kind === 'tower') return true;
    const a = subj(x);
    if (!a) return false;
    if (x.kind === 'app') return a.mode === 'air' || a.phase === PH.FINAL;
    if (x.kind === 'land') return a.mode === 'map' && (a.phase === PH.FINAL || (a.phase === PH.ROLLOUT && (a.v || 0) > 0.08));
    return a.mode === 'map';
  };
  if (!ok(sh)) sh = this.shot = this.pickShot(s);
  sh.t += dt;
  const v = this.v3d;
  const ac = subj(sh);
  this.cineChase = false;
  this.id = null;
  let target = null, fovTarget = 45;
  if (sh.kind === 'app' && ac) {
    // von hinten seitlich mitfliegen
    this.cineChase = true;
    this.id = ac.id;
    this.yaw = 28 * sh.side;
    this.pitch = 7;
    this.zoomK = 0.85;
    v.render(s, this, ac);
  } else {
    if (sh.kind === 'orbit') {
      const a = sh.a0 + sh.t * 0.045;
      this.camPos = { x: 40 + Math.cos(a) * 34, y: 7.5, z: 19 + Math.sin(a) * 26 };
      target = { x: 40, y: 0.5, z: 20 };
      fovTarget = 50;
    } else if (sh.kind === 'tower') {
      this.camPos = v.towerEye();
      const busy = s.acs.filter((a) => a.mode === 'map' && a.phase !== PH.STAND);
      const pick = busy.length ? busy[Math.floor((sh.a0 / (Math.PI * 2)) * busy.length)] : null;
      const p = pick && v.acPos(pick.id);
      target = p ? { x: p.x, y: p.y, z: p.z } : { x: 40, y: 0, z: 30 };
      const dist = Math.hypot(target.x - this.camPos.x, target.z - this.camPos.z);
      fovTarget = p ? clamp((2 * Math.atan(((pick.len || 2.4) * 3) / Math.max(1, dist)) * 180) / Math.PI, 7, 45) : 45;
    } else if (sh.kind === 'heli' || sh.kind === 'vfr') {
      const o = sh.kind === 'heli' ? s.heli.h : s.vfr.p;
      const g = sh.kind === 'heli' ? v.heli : v.cessna;
      const p = g ? g.position : { x: o.x, y: 1, z: o.y };
      if (!sh.cam) sh.cam = { x: p.x + 9 * sh.side, y: 0.6, z: p.z + 7 };
      this.camPos = sh.cam;
      target = { x: p.x, y: p.y, z: p.z };
      fovTarget = clamp((2 * Math.atan(1.6 / Math.max(1, Math.hypot(p.x - sh.cam.x, p.z - sh.cam.z))) * 180) / Math.PI, 5, 40);
    } else if (ac) {
      const p = v.acPos(ac.id);
      this.camPos = sh.cam || { x: ac.x + 6, y: 0.4, z: ac.y + 6 };
      target = p ? { x: p.x, y: p.y, z: p.z } : { x: ac.x, y: 0, z: ac.y };
      const dist = Math.hypot(target.x - this.camPos.x, target.y - this.camPos.y, target.z - this.camPos.z);
      fovTarget = clamp((2 * Math.atan(((ac.len || 2.4) * 1.5) / Math.max(0.5, dist)) * 180) / Math.PI, 5, 55);
    }
    // weich nachführen (Blick und Brennweite)
    const k = 1 - Math.exp(-dt * 5);
    if (!this.camLook || sh !== this.lastShot) (this.camLook = { ...target }, (this.fov = fovTarget));
    else for (const c of ['x', 'y', 'z']) this.camLook[c] += (target[c] - this.camLook[c]) * k;
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-dt * 2));
    v.render(s, this, null);
  }
  this.lastShot = sh;
  this.hearAt(1.4);
  // Einblendung unten links
  const cap = this.el.querySelector('.rd-cap');
  let html = '';
  if (ac) {
    const t = AC_TYPES[ac.type], al = AIRLINES[ac.airline];
    const rwy = ac.rwy || s.rwy;
    const sub = sh.kind === 'land' ? T`Landung auf der ${rwy}` : sh.kind === 'takeoff' || sh.kind === 'climb' ? T`Start von der ${rwy}` : CINE_SUB[sh.kind];
    html = `<b>${esc(ac.cs)}</b><span>${esc(typeName(ac.type))}${al ? ` · ${esc(al.name)}` : ''}</span><small>${esc(sub)} · ${esc(s.name)}</small>`;
  } else html = `<b>${esc(sh.kind === 'heli' ? 'Rescue 7' : sh.kind === 'vfr' ? (s.vfr.p && s.vfr.p.cs) || '' : s.name)}</b><small>${esc(CINE_SUB[sh.kind] || '')}</small>`;
  if (cap._h !== html) (cap.innerHTML = html, (cap._h = html), cap.classList.remove('in'), void cap.offsetWidth, cap.classList.add('in'));
  const txt = T`Kino 3D · ${CINE_SUB[sh.kind] || ''}`;
  if (this.tEl.textContent !== txt) this.tEl.textContent = txt;
};

// Regen (und Schnee) auf der Cockpitscheibe: Tropfen sammeln sich, bei Fahrt laufen sie nach oben und zur Seite weg,
// zwei Scheibenwischer wischen im Takt – nur im Cockpit und nur bei Niederschlag
Ride.prototype.windshield = function (dt, wx, kt) {
  const c = this.el.querySelector('.rd-rain');
  const on = this.mode === 'cockpit' && (wx === 'rain' || wx === 'storm' || wx === 'snow');
  if (!on) {
    if (this.drops && this.drops.length) {
      this.drops.length = 0;
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }
    return;
  }
  const W = c.clientWidth, H = c.clientHeight;
  if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
  const g = c.getContext('2d');
  this.drops = this.drops || [];
  this.wipeT = (this.wipeT || 0) + dt;
  const snow = wx === 'snow';
  const rate = (wx === 'storm' ? 70 : snow ? 22 : 40) * (1 + Math.min(1.5, kt / 120));
  for (let n = rate * dt; n > 0; n--) if (n >= 1 || Math.random() < n) this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.95, r: (snow ? 1.6 : 1.2) + Math.random() * (snow ? 2.6 : 3.2), a: 0.9 });
  // Fahrtwind treibt die Tropfen nach oben außen
  const push = Math.max(0, kt - 40) * 0.9;
  for (const d of this.drops) {
    if (push) {
      d.y -= push * dt * (0.6 + d.r * 0.15);
      d.x += (d.x < W / 2 ? -1 : 1) * push * dt * 0.25;
    } else if (!snow && d.r > 3) d.y += dt * 6;
    d.a -= dt * (snow ? 0.12 : 0.05);
  }
  // Wischer: zwei Arme schwenken um Drehpunkte unten an der Scheibe
  const ang = Math.sin(this.wipeT * (wx === 'storm' ? 3.4 : 2.2)) * 0.95; // −55°…+55° um die Senkrechte
  const len = H * 0.82;
  const piv = [[W * 0.3, H], [W * 0.72, H]];
  this.drops = this.drops.filter((d) => {
    if (d.a <= 0 || d.y < -10 || d.x < -10 || d.x > W + 10) return false;
    for (const [px, py] of piv) {
      const dx = d.x - px, dy = py - d.y, dist = Math.hypot(dx, dy);
      if (dist < len && Math.abs(Math.atan2(dx, dy) - ang) < 0.06) return false;
    }
    return true;
  });
  if (this.drops.length > 700) this.drops.splice(0, this.drops.length - 700);
  g.clearRect(0, 0, W, H);
  for (const d of this.drops) {
    g.globalAlpha = Math.min(1, d.a);
    if (snow) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    g.fillStyle = 'rgba(190,210,235,0.22)';
    g.beginPath();
    if (push > 40) g.ellipse(d.x, d.y, d.r * 0.7, d.r * (1 + push / 120), 0, 0, Math.PI * 2);
    else g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.arc(d.x - d.r * 0.3, d.y - d.r * 0.35, d.r * 0.32, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#0b0d11';
  g.lineCap = 'round';
  for (const [px, py] of piv) {
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.sin(ang) * len, py - Math.cos(ang) * len);
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = '#2b3038';
    g.stroke();
    g.strokeStyle = '#0b0d11';
  }
};

// ---------- Rundflug: in der Cessna (Platzrunden) oder im Rettungshubschrauber mitfliegen ----------
Ride.prototype.startGA = function (kind) {
  const s = this.game.state;
  const o = kind === 'heli' ? s.heli && s.heli.h : s.vfr && s.vfr.p;
  if (!o) return toast(T('Gerade ist niemand unterwegs'), 'info', 2000);
  const back = this.mode === 'tower' ? 'tower' : null;
  const cam0 = this.cam0;
  if (this.on) this.stop();
  this.on = true;
  this.ga = kind;
  this.gaBack = back;
  this.cam0 = cam0 || { x: this.game.cam.x, y: this.game.cam.y, zoom: this.game.cam.zoom };
  this.id = null;
  this.called = new Set();
  this.el.classList.remove('hidden', 'tower', 'cine3d');
  document.getElementById('game').classList.add('riding');
  this.setMode('cockpit');
  this.load3d(() => {
    toast(T('Mitfliegen in 3D braucht WebGL'), 'warn', 2600);
    this.stop();
  });
  toast(kind === 'heli' ? T('Willkommen an Bord von Rescue 7 – es geht zur Klinik') : T`Rundflug mit ${o.cs}: Platzrunden über ${s.name}`, 'good', 2600);
};

Ride.prototype.updateGA = function (dt) {
  const s = this.game.state;
  const heli = this.ga === 'heli';
  const o = heli ? s.heli && s.heli.h : s.vfr && s.vfr.p;
  if (!o) {
    toast(heli ? T('Rescue 7 ist außer Sicht – danke fürs Mitfliegen') : T('Gelandet und abgestellt – danke für den Rundflug'), 'good', 2600);
    const back = this.gaBack;
    this.stop();
    if (back === 'tower') this.startTower();
    return;
  }
  if (!this.use3d) return;
  // Klangkulisse und 2D-Kamera fliegen mit
  this.game.cam.x = o.x;
  this.game.cam.y = o.y;
  this.game.cam.tx = null;
  const alt = Math.round(((o.z || 0) * 500) / 10) * 10;
  const kt = heli ? (o.st === 'hold' ? 0 : 110) : (o.z || 0) > 0.05 ? 90 : 45;
  const air = (o.z || 0) > 0.03;
  const phase = !air ? PH.TAXI_OUT : (this.lastAlt ?? alt) < alt - 1 ? PH.TAKEOFF : PH.FINAL;
  this.lastAlt = alt;
  const inside = this.mode === 'cockpit' || this.mode === 'window';
  soundscape.cabin = inside ? { phase, kt, air, climb: phase === PH.TAKEOFF, ground: !air, moving: true, prop: true } : null;
  this.v3d.render(s, this, null);
  this.windshield(dt, s.weather.kind, kt);
  const hdg = Math.round((((o.hdg || 0) * 180) / Math.PI + 90 + 360) % 360);
  const what = heli ? T`Rescue 7 · Rettungshubschrauber${o.st === 'hold' ? T(' · wartet auf Querungsfreigabe') : o.st === 'cross' ? T(' · quert die Bahnen') : ''}` : `${esc(o.cs)} · Alcedo AL-4 · ${{ join: T('Einflug in die Platzrunde'), circuit: T('Platzrunde'), ga: T('Durchstarten'), orbit: T('Warteschleife'), leave: T('Abflug aus der Kontrollzone') }[o.mode] || T('Platzrunde')}`;
  const txt = `${this.mode === 'chase' ? T('Außenkamera') : heli ? T('Rettungsflug') : T('Rundflug')} · ${what}${alt > 0 ? ` · ${alt} ft` : ''}`;
  if (this.tEl.innerHTML !== txt) this.tEl.innerHTML = txt;
  this.el.querySelector('.rd-belt').classList.toggle('on', true);
  if (this.mode === 'cockpit') {
    this.R.spd.textContent = kt;
    this.R.alt.textContent = alt;
    this.R.vs.textContent = phase === PH.TAKEOFF ? '↑' : '';
    this.R.hdg.textContent = String(hdg).padStart(3, '0');
    this.R.rose.style.transform = `rotate(${-hdg}deg)`;
    this.R.fma.textContent = heli ? 'HOVER · NAV' : air ? 'VFR' : 'TAXI';
    this.R.nd.textContent = heli ? 'Klinik Nord' : `RWY ${o.rwy || s.rwy}`;
  }
};

// Foto aus der 3D-Ansicht fürs Spotterbuch: Außenkamera = das eigene Flugzeug, Kino = das Motiv der Szene,
// sonst (Turmblick, Fenster, Cockpit) das Flugzeug, das der Bildmitte am nächsten ist
Ride.prototype.photo = function () {
  const g = this.game, s = g.state;
  if (!s || !this.v3d || !this.use3d) return;
  let id = null;
  if (this.mode === 'chase' && this.id) id = this.id;
  else if (this.mode === 'cine3d' && this.shot && s.acs.some((a) => a.id === this.shot.id)) id = this.shot.id;
  else id = this.v3d.pickCenter(this.mode === 'cockpit' || this.mode === 'window' ? this.id : null);
  const ac = id && s.acs.find((a) => a.id === id);
  if (!g.spot) g.spot = new SpotterUi(g);
  if (!ac) {
    if (s.settings.sound !== false) sfx.shutter && sfx.shutter();
    return toast(T('📷 Kein Flugzeug in der Bildmitte – Fernglas drauf und nochmal'), 'info', 2400);
  }
  g.spot.shoot(ac);
};

// ---------- Einwinken: als Einwinker an der Parkposition das Flugzeug auf die Haltemarke bringen ----------
// Man steht seitlich vor der Position und gibt mit den Kellen „Geradeaus“; STOPP (Leertaste) genau dann, wenn die
// Bugnase die gelbe Haltemarke erreicht. Bewertet wird der Abstand zur Marke im Moment des Signals. Nur Darstellung:
// die Simulation stellt das Flugzeug ohnehin auf die Position – das Spiel bringt Punkte und einen Erfolg.
function remainingPath(ac) {
  const p = ac.path;
  if (!p || !p.length) return 0;
  let i = ac.pi || 0;
  if (i >= p.length - 1) return Math.hypot(p[p.length - 1].x - ac.x, p[p.length - 1].y - ac.y);
  let L = Math.hypot(p[i + 1].x - ac.x, p[i + 1].y - ac.y);
  for (let k = i + 1; k < p.length - 1; k++) L += Math.hypot(p[k + 1].x - p[k].x, p[k + 1].y - p[k].y);
  return L;
}

Ride.prototype.startMarshal = function (acId) {
  const s = this.game.state;
  const ac = s.acs.find((a) => a.id === acId);
  if (!ac || ac.phase !== PH.TAXI_IN || !ac.stand) return toast(T('Einwinken geht, wenn ein Flugzeug zur Position rollt'), 'info', 2400);
  if (this.on) this.stop();
  const st = s.stands.find((x) => x.id === ac.stand);
  if (!st) return;
  this.on = true;
  this.mode = 'marshal';
  this.id = ac.id;
  this.mst = { st, judged: null, endT: 0, side: st.x > 40 ? -1 : 1 };
  this.cam0 = { x: this.game.cam.x, y: this.game.cam.y, zoom: this.game.cam.zoom };
  this.spd0 = s.speed;
  this.labels = this.game.ui.labels;
  this.el.classList.remove('hidden', 'cockpit', 'window', 'chase', 'tower', 'cine3d');
  this.el.classList.add('marshal');
  this.el.querySelector('.rd-mres').innerHTML = '';
  document.getElementById('game').classList.add('riding');
  this.tEl.textContent = T`Einwinken · ${ac.cs} · Position ${st.id}`;
  this.load3d(() => {
    toast(T('Einwinken braucht WebGL'), 'warn', 2400);
    this.stop();
  });
  toast(T`🦺 ${ac.cs} rollt zu Position ${st.id} – STOPP, wenn die Bugnase die gelbe Haltemarke erreicht`, 'info', 4200);
};

Ride.prototype.marshalStop = function () {
  const m = this.mst, s = this.game.state;
  if (!m || m.judged) return;
  const ac = s.acs.find((a) => a.id === this.id);
  if (!ac) return;
  const meters = remainingPath(ac) * 20;
  const [label, pts, perfect] = meters <= 1.5 ? [T('Punktgenau!'), 60, true] : meters <= 4 ? [T('Gut eingewunken'), 30, false] : meters <= 10 ? [T('Etwas zu früh'), 10, false] : [T('Viel zu früh – der Pilot rollt bis zur Marke weiter'), 0, false];
  this.marshalResult(label, pts, perfect, meters);
};

Ride.prototype.marshalResult = function (label, pts, perfect, meters) {
  const m = this.mst, s = this.game.state;
  m.judged = { label, pts };
  const L = s.life || (s.life = {});
  L.marshals = (L.marshals || 0) + 1;
  if (perfect) L.marshalPerfect = (L.marshalPerfect || 0) + 1;
  L.marshalPts = (L.marshalPts || 0) + pts;
  this.el.querySelector('.rd-mres').innerHTML = T`<b class="${perfect ? 'ok' : pts ? 'mid' : 'bad'}">${esc(label)}</b><span>${meters === null ? T('Bugnase über der Haltemarke') : T`${meters.toFixed(1)} m vor der Marke`} · +${pts} Punkte</span>`;
  this.el.classList.add('mstop');
  if (s.settings.sound !== false) (perfect ? sfx.fanfare : sfx.click) && (perfect ? sfx.fanfare() : sfx.click());
};

Ride.prototype.updateMarshal = function (dt) {
  const s = this.game.state, m = this.mst;
  const ac = s.acs.find((a) => a.id === this.id);
  if (!ac || (ac.phase !== PH.TAXI_IN && ac.phase !== PH.STAND)) return this.stop();
  if (ac.phase === PH.STAND) {
    if (!m.judged) this.marshalResult(T('Zu spät – die Nase steht schon über der Marke'), 0, false, null);
    m.endT += dt;
    if (m.endT > 3.5) {
      this.stop();
      return;
    }
  }
  if (!m.judged) this.el.classList.remove('mstop');
  // Zeitlupe: halbe Geschwindigkeit beim Heranrollen, auf den letzten 30 m fünffach langsamer
  if (!m.judged && ac.phase === PH.TAXI_IN && s.speed > 0) {
    const rem = remainingPath(ac);
    s.speed = rem < 1.5 ? 0.2 : rem < 4 ? 0.5 : Math.min(5, Math.max(1, this.spd0 || 1));
  } else if (m.judged && s.speed > 0 && s.speed < 1) s.speed = 1;
  if (!this.use3d) return;
  // Kamera: seitlich vor der Haltemarke in Augenhöhe, Blick auf die Bugnase
  const st = m.st;
  this.camPos = { x: st.x + m.side * 2.4, y: 0.11, z: LY.STAND_NOSE - 0.9 };
  const h = ac.hdg || 0, nose = { x: ac.x + Math.cos(h) * ac.len * 0.5, z: ac.y + Math.sin(h) * ac.len * 0.5 };
  const target = { x: (nose.x + st.x) / 2, y: 0.18, z: Math.max(LY.STAND_NOSE, nose.z - 0.4) };
  const k = 1 - Math.exp(-dt * 4);
  if (!this.camLook) this.camLook = { ...target };
  for (const c of ['x', 'y', 'z']) this.camLook[c] += (target[c] - this.camLook[c]) * k;
  this.fov = 52;
  this.cineChase = false;
  this.v3d.render(s, this, null);
  this.hearAt(1.6);
};

// ---------- Drohne: frei über den Flughafen fliegen ----------
// WASD/Pfeile = fliegen (in Blickrichtung), Q/E = sinken/steigen, Umschalt = schnell, Ziehen = umsehen, Mausrad =
// ein Stück vor/zurück. Auf dem Handy ein Steuerkreuz. Höhe mindestens 3 m, Reichweite ein paar Kilometer.
Ride.prototype.startDrone = function () {
  const back = this.v3d && this.v3d.camera ? this.v3d.camera.position.clone() : null;
  const yaw = this.yaw, pitch = this.pitch;
  const cam0 = this.cam0;
  if (this.on) this.stop();
  this.on = true;
  this.mode = 'drone';
  this.id = null;
  this.keys = this.keys || new Set();
  this.keys.clear();
  this.cam0 = cam0 || { x: this.game.cam.x, y: this.game.cam.y, zoom: this.game.cam.zoom };
  this.drone = back ? { x: back.x, y: Math.max(1, back.y), z: back.z, v: 0 } : { x: 70, y: 6, z: 10, v: 0 };
  this.yaw = Number.isFinite(yaw) ? yaw : 146;
  this.pitch = Number.isFinite(pitch) ? pitch : 10;
  this.fov = 60;
  this.el.classList.remove('hidden', 'cockpit', 'window', 'chase', 'tower', 'cine3d');
  this.el.classList.add('drone');
  document.getElementById('game').classList.add('riding');
  this.el.querySelector('.rd-help').textContent = T('WASD/Pfeile = fliegen · Q/E = sinken/steigen · Umschalt = schnell · Ziehen = umsehen · F = Foto');
  clearTimeout(this.helpT);
  this.el.classList.remove('nohelp');
  this.helpT = setTimeout(() => this.el.classList.add('nohelp'), 8000);
  this.load3d(() => {
    toast(T('Die Drohne braucht WebGL'), 'warn', 2400);
    this.stop();
  });
};

Ride.prototype.droneMove = function (dist) {
  const d = this.drone;
  if (!d) return;
  const yw = (this.yaw * Math.PI) / 180, pt = (this.pitch * Math.PI) / 180;
  d.x += Math.cos(yw) * Math.cos(pt) * dist;
  d.z += Math.sin(yw) * Math.cos(pt) * dist;
  d.y = clamp(d.y - Math.sin(pt) * dist, 0.15, 150);
};

Ride.prototype.updateDrone = function (dt) {
  const s = this.game.state, d = this.drone, K = this.keys;
  if (!this.use3d || !d) return;
  const fast = K.has('fast') ? 4 : 1;
  const sp = (2.2 + d.y * 0.25) * fast; // Kacheln je Sekunde, in der Höhe schneller
  const yw = (this.yaw * Math.PI) / 180;
  let fx = 0, fz = 0;
  if (K.has('up')) (fx += Math.cos(yw)), (fz += Math.sin(yw));
  if (K.has('down')) (fx -= Math.cos(yw)), (fz -= Math.sin(yw));
  if (K.has('left')) (fx += Math.sin(yw)), (fz -= Math.cos(yw));
  if (K.has('right')) (fx -= Math.sin(yw)), (fz += Math.cos(yw));
  const n = Math.hypot(fx, fz) || 1;
  // weich beschleunigen und abbremsen
  const tvx = (fx / n) * sp * (fx || fz ? 1 : 0), tvz = (fz / n) * sp * (fx || fz ? 1 : 0);
  const tvy = (K.has('rise') ? 1 : 0) - (K.has('sink') ? 1 : 0);
  const k = 1 - Math.exp(-dt * 5);
  d.vx = (d.vx || 0) + (tvx - (d.vx || 0)) * k;
  d.vz = (d.vz || 0) + (tvz - (d.vz || 0)) * k;
  d.vy = (d.vy || 0) + (tvy * (1.5 + d.y * 0.3) * fast - (d.vy || 0)) * k;
  d.x = clamp(d.x + d.vx * dt, -600, 680);
  d.z = clamp(d.z + d.vz * dt, -600, 650);
  d.y = clamp(d.y + d.vy * dt, 0.15, 150);
  const pt = (this.pitch * Math.PI) / 180;
  this.camPos = { x: d.x, y: d.y, z: d.z };
  this.camLook = { x: d.x + Math.cos(yw) * Math.cos(pt) * 10, y: d.y - Math.sin(pt) * 10, z: d.z + Math.sin(yw) * Math.cos(pt) * 10 };
  this.cineChase = false;
  soundscape.cabin = { drone: true, speed: Math.min(1.5, Math.hypot(d.vx || 0, d.vz || 0, d.vy || 0) / 8) };
  this.v3d.render(s, this, null);
  this.hearAt(Math.max(0.5, 2.2 - d.y * 0.08));
  const txt = T`Drohne · Höhe ${Math.round(d.y * 20)} m${K.has('fast') ? T(' · schnell') : ''}`;
  if (this.tEl.textContent !== txt) this.tEl.textContent = txt;
};

Ride.prototype.onRadio = function (m) {
  if (!this.on || !m || !m.text || (m.kind !== 'atc' && m.kind !== 'pilot')) return;
  const s = this.game.state;
  let show = false;
  if (this.mode === 'cine3d') show = true;
  else if (this.mode === 'cockpit' && this.id) {
    const ac = s && s.acs.find((a) => a.id === this.id);
    if (ac) {
      const al = AIRLINES[ac.airline];
      const tel = al ? `${al.tel} ${ac.cs.replace(/^[A-Z]+/, '')}` : ac.cs;
      show = m.from === ac.cs || m.text.includes(ac.cs) || m.text.toLowerCase().includes(tel.toLowerCase());
    }
  }
  if (!show) return;
  const box = this.el.querySelector('.rd-sub');
  const line = document.createElement('div');
  line.className = `rs ${m.kind}`;
  const who = document.createElement('b');
  who.textContent = m.kind === 'atc' ? 'TOWER' : m.from || '';
  const txt = document.createElement('span');
  txt.textContent = m.text;
  line.append(who, txt);
  box.appendChild(line);
  while (box.children.length > 2) box.firstChild.remove();
  setTimeout(() => {
    line.classList.add('out');
    setTimeout(() => line.remove(), 500);
  }, 5500);
};
