// Mitfliegen (Beobachter): In ein Flugzeug einsteigen – mit perspektivischer 3D-Kamera, die am Flugzeug hängt und sich
// frei drehen lässt (Ziehen = um das Flugzeug drehen und neigen, Mausrad = Abstand). Dazu – am Fensterplatz (Blick durchs ovale Kabinenfenster auf
// Tragfläche und Boden, Anschnallzeichen, Kapitänsdurchsage) oder im Cockpit (Kamera schaut voraus, Instrumente
// mit Geschwindigkeit, Höhe, Kurs, Steig-/Sinkrate und Höhenansagen im Endanflug). Die Kamera fährt mit, bis das
// Flugzeug an der Position steht oder die Karte verlässt. Esc oder ✕ beendet. Nur Darstellung.
import { AC_TYPES, AIRLINES, CITIES } from '../config.js';
import { PH, PHASE_DE } from '../sim/aircraft.js';
import { clamp, esc } from '../util.js';
import { voice } from '../voice.js';
import { icon } from './icons.js';
import { toast } from './dom.js';
import { sfx } from '../audio.js';
import * as AS from '../sim/airspace.js';
import * as LY from '../layout.js';

const KT = 323; // Kacheln je Spielsekunde -> Knoten (wie Info-Karte und Kino)
const FT = 500; // z -> Fuß
const CALLS = [500, 100, 50, 40, 30, 20, 10];
// Phasen eines ankommenden Flugs (ac.arr bleibt über den ganzen Umlauf gesetzt)
const ARR_PH = new Set([PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND, PH.FINAL, PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN]);

export class Ride {
  constructor(game) {
    this.game = game;
    this.on = false;
    const el = document.createElement('div');
    el.id = 'ride';
    el.className = 'hidden';
    el.innerHTML = `<div class="rd-drag"></div><div class="rd-haze"></div><div class="rd-win"><div class="rd-shade"></div></div>
      <div class="rd-cockpit"><div class="rd-pillar l"></div><div class="rd-pillar r"></div><div class="rd-pillar c"></div>
        <div class="rd-glare"><div class="rd-pfd"><div class="rd-tape spd"><small>KT</small><b data-r="spd">0</b></div><div class="rd-ai"><div class="rd-hor"></div><i></i><span data-r="fma">TAXI</span></div><div class="rd-tape alt"><small>FT</small><b data-r="alt">0</b><em data-r="vs"></em></div></div>
        <div class="rd-nd"><div class="rd-rose" data-r="rose"></div><b data-r="hdg">000</b><small data-r="nd"></small></div></div></div>
      <div class="rd-bar"><span class="rd-belt" title="Anschnallzeichen">${icon('vest')}</span><span class="rd-t"></span><span class="rd-modes"><button data-rd="cockpit">${icon('plane')} Cockpit</button><button data-rd="window">${icon('eye')} Fenster</button><button data-rd="chase">${icon('follow')} 3D außen</button></span><span class="rd-tw"><button data-rd="track" title="Kamera folgt dem ausgewählten Flugzeug (Fernglas zoomt mit)">${icon('follow')} Verfolgen</button></span><button class="rd-x" data-rd="x" title="Beenden (Esc)">✕</button></div><div class="rd-help">Ziehen = drehen und neigen · Mausrad = Abstand · Doppelklick = zurücksetzen</div><div class="rd-labels"></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.tEl = el.querySelector('.rd-t');
    this.R = Object.fromEntries([...el.querySelectorAll('[data-r]')].map((x) => [x.dataset.r, x]));
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rd]');
      if (!b) return;
      if (b.dataset.rd === 'x') this.stop();
      else if (b.dataset.rd === 'track') this.setTrack(!this.track);
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
        if (pinch) this.zoomK = clamp(this.zoomK * (d / pinch), 0.45, 2.4);
        pinch = d;
        return;
      }
      if (!last) return;
      if (this.mode === 'tower') {
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
      if (this.mode === 'tower') {
        this.fov = clamp((this.fov || 55) * (e.deltaY > 0 ? 1.12 : 0.89), 5, 70);
        this.autoZoom = false;
        return;
      }
      this.zoomK = clamp(this.zoomK * (e.deltaY > 0 ? 0.9 : 1.1), 0.45, 2.4);
    }, { passive: false });
    drag.addEventListener('dblclick', () => (this.mode === 'tower' ? this.resetTower() : this.setMode(this.mode)));
    window.addEventListener('keydown', (e) => {
      if (this.on && e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stop();
      }
    }, true);
  }

  start(acId, mode = 'window') {
    const s = this.game.state;
    const ac = s && s.acs.find((a) => a.id === acId);
    const inbound = ac && ac.mode === 'air' && ac.arr && ARR_PH.has(ac.phase);
    if (!ac || (ac.mode !== 'map' && !inbound)) return toast('Einsteigen geht im Anflug oder am Flughafen', 'info', 2400);
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
    import('../render/view3d.js').then((m) => {
      if (!this.on) return;
      if (!m.View3D.supported()) return onFail && onFail();
      try {
        this.v3d = this.v3d || new m.View3D(this.game);
      } catch (e) {
        return onFail && onFail();
      }
      this.use3d = true;
      this.v3d.show();
      this.el.classList.add('v3d');
      const map = document.getElementById('map');
      map.style.transform = '';
      if (this.mode !== 'tower') this.setMode(this.mode);
    }).catch(() => onFail && onFail());
  }

  greet(s, ac, mode) {
    const rot = s.rots[ac.rot];
    const city = rot && CITIES[rot.city] ? CITIES[rot.city].name : '';
    const al = AIRLINES[ac.airline];
    const dep = !ARR_PH.has(ac.phase);
    this.arriving = !dep;
    if (mode === 'window' && s.settings.tts && voice.on && voice.announce) {
      voice.announce(dep ? `Meine Damen und Herren, hier spricht Ihr Kapitän. Willkommen an Bord von ${al ? al.name : ''}${city ? ` nach ${city}` : ''}. Bitte schnallen Sie sich an, wir starten in Kürze.` : `Meine Damen und Herren, wir befinden uns im Landeanflug auf Planez. Bitte bleiben Sie angeschnallt, bis wir die Parkposition erreicht haben.`);
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
    this.id = null;
    this.mode = 'tower';
    this.resetTower();
    this.track = false;
    this.lbl = new Map();
    this.el.classList.remove('hidden', 'cockpit', 'window', 'chase');
    this.el.classList.add('tower');
    this.el.querySelector('.rd-help').textContent = 'Ziehen = umsehen · Mausrad = Fernglas · Klick auf ein Flugzeug = auswählen · Doppelklick = zurücksetzen';
    this.tEl.textContent = 'Turmblick';
    clearTimeout(this.helpT);
    this.el.classList.remove('nohelp');
    this.helpT = setTimeout(() => this.el.classList.add('nohelp'), 7000);
    document.getElementById('game').classList.add('towerview');
    document.getElementById('t-tower3d')?.classList.add('on');
    this.setTrack(!!this.game.ui.selected);
    this.load3d(() => {
      toast('Der Turmblick braucht WebGL – dein Browser bietet es gerade nicht an', 'warn', 3200);
      this.stop();
    });
  }

  resetTower() {
    this.yaw = 146; // Blick vom Tower (Nordosten) auf die Bahnmitte
    this.pitch = 8;
    this.fov = 50;
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
    this.drawLabels(s, sel);
    const wx = s.weather;
    const txt = `Turmblick · ${s.name} · RWY ${s.rwy}${ac ? ` · ${ac.cs}` : ''} · Fernglas ${Math.round(55 / (this.fov || 55) * 10) / 10}×`;
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
      const html = `<b>${esc(ac.cs)}</b><small>${esc(ac.type)}${alt > 0 ? ` · ${alt} ft` : ''}</small>`;
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
        box.appendChild(d);
        this.lbl.set(id, d);
      }
      const html = `<b>${esc(name || '')}</b><small>${key === 'heli' ? 'Hubschrauber' : 'C172'}</small>`;
      if (d._h !== html) (d.innerHTML = html, (d._h = html));
      d.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
    for (const [id, d] of this.lbl) if (!seen.has(id)) (d.remove(), this.lbl.delete(id));
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    if (this.mode === 'tower') {
      document.getElementById('game').classList.remove('towerview');
      document.getElementById('t-tower3d')?.classList.remove('on');
      this.el.classList.remove('tower');
      this.el.querySelector('.rd-labels').innerHTML = '';
      this.el.querySelector('.rd-help').textContent = 'Ziehen = drehen und neigen · Mausrad = Abstand · Doppelklick = zurücksetzen';
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
    const g = this.game, s = g.state, cam = g.cam;
    if (g.cinema && g.cinema.on) return this.stop();
    if (this.mode === 'tower') return this.updateTower(dt);
    const ac = s && s.acs.find((a) => a.id === this.id);
    // noch im Anflug außerhalb der Karte: Kamera wartet am Anfang des Endanflugs, Instrumente mit echten Luftdaten
    if (ac && ac.mode === 'air' && ac.arr && ARR_PH.has(ac.phase)) return this.updateAir(s, ac, dt);
    // nach dem Start: im Steigflug mitfliegen, bis die Maschine hoch und weit genug weg ist
    if (ac && ac.mode === 'air' && !this.arriving && this.use3d && (ac.alt || 0) < 9000 && Math.hypot(ac.pos.x, ac.pos.y) < 22) return this.updateAirDep(s, ac, dt);
    if (!ac || ac.mode !== 'map' || ac.phase === PH.GONE) {
      toast(ac && !this.arriving ? '✈️ Gute Reise! Das Flugzeug hat den Flughafen verlassen.' : 'Ausgestiegen', 'info', 2600);
      return this.stop();
    }
    // an der Position angekommen: kurz stehen bleiben, dann aussteigen
    if (ARR_PH.has(ac.phase)) this.arriving = true;
    if (this.arriving && ac.phase === PH.STAND) {
      this.endT += dt;
      if (this.endT > 5) {
        toast(`Willkommen in ${s.name}! Ausgestiegen.`, 'good', 2600);
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
    const where = `${esc(ac.cs)} · ${esc(AC_TYPES[ac.type].name)}${city ? ` · ${arrNow ? 'aus' : 'nach'} ${esc(city)}` : ''}`;
    const txt = this.mode === 'window' ? `Platz ${12 + (ac.id.length * 7) % 18}F · ${where} · ${PHASE_DE[ac.phase] || ''}${alt > 0 ? ` · ${alt} ft` : ''}` : `${this.mode === 'chase' ? 'Außenkamera' : 'Cockpit'} · ${where} · ${PHASE_DE[ac.phase] || ''}${alt > 0 ? ` · ${alt} ft` : ''}`;
    if (this.tEl.innerHTML !== txt) this.tEl.innerHTML = txt;
    if (this.mode === 'cockpit') {
      this.R.spd.textContent = kt;
      this.R.alt.textContent = alt;
      this.R.vs.textContent = Math.abs(vs) > 50 ? `${vs > 0 ? '↑' : '↓'}${Math.round(Math.abs(vs) / 50) * 50}` : '';
      this.R.hdg.textContent = String(hdg).padStart(3, '0');
      this.R.rose.style.transform = `rotate(${-hdg}deg)`;
      const fma = { [PH.FINAL]: z < 0.12 ? 'FLARE' : 'LAND', [PH.ROLLOUT]: 'ROLLOUT', [PH.TAKEOFF]: z > 0.05 ? 'SRS · CLB' : 'TOGA', [PH.MISSED]: 'GA · TOGA', [PH.LINED]: 'LINED UP', [PH.LINEUP]: 'LINE UP', [PH.HOLDING]: 'HOLD SHORT', [PH.TAXI_OUT]: 'TAXI', [PH.TAXI_IN]: 'TAXI', [PH.PUSH]: 'PUSH', [PH.STARTUP]: 'ENG START', [PH.STAND]: 'PARK' }[ac.phase] || '';
      this.R.fma.textContent = fma;
      const pitch = ac.phase === PH.TAKEOFF && z > 0.02 ? 12 : ac.phase === PH.MISSED ? 10 : ac.phase === PH.FINAL ? (z < 0.12 ? 4 : -2.5) : 0;
      this.el.querySelector('.rd-hor').style.transform = `translateY(${pitch * 2.2}px)`;
      this.R.nd.textContent = ac.phase === PH.FINAL ? `RWY ${s.rwy} · ${((distLeft(ac)) * 20 / 1852).toFixed(1)} NM` : arrNow ? (ac.stand ? `→ P${ac.stand}` : '') : rot && rot.sid ? rot.sid : '';
      // Startlauf: V1, Rotate, Positive rate
      if (ac.phase === PH.TAKEOFF) {
        if (kt >= 120 && !this.called.has('v1')) (this.called.add('v1'), this.callout('V one'));
        if (z > 0.01 && !this.called.has('rot')) (this.called.add('rot'), this.callout('Rotate'));
        if (z > 0.25 && !this.called.has('pos')) (this.called.add('pos'), this.callout('Positive rate. Gear up.'));
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
  const where = `${esc(ac.cs)} · ${esc(AC_TYPES[ac.type].name)}${city ? ` · aus ${esc(city)}` : ''}`;
  const txt = `${this.mode === 'window' ? `Platz ${12 + (ac.id.length * 7) % 18}F` : this.mode === 'chase' ? 'Außenkamera' : 'Cockpit'} · ${where} · ${PHASE_DE[ac.phase] || ''} · noch ${d.toFixed(1)} NM`;
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

// Steigflug nach dem Start (3D): Instrumente mit den echten Luftdaten, SID im Navigationsdisplay
Ride.prototype.updateAirDep = function (s, ac, dt) {
  this.v3d.render(s, this, ac);
  const rot = s.rots[ac.rot];
  const city = rot && CITIES[rot.city] ? CITIES[rot.city].name : '';
  const alt = Math.round((ac.alt || 0) / 10) * 10;
  const where = `${esc(ac.cs)} · ${esc(AC_TYPES[ac.type].name)}${city ? ` · nach ${esc(city)}` : ''}`;
  const txt = `${this.mode === 'window' ? `Platz ${12 + (ac.id.length * 7) % 18}F` : this.mode === 'chase' ? 'Außenkamera' : 'Cockpit'} · ${where} · Steigflug · ${alt} ft`;
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
