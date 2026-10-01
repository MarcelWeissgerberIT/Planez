// Mitfliegen (Beobachter): In ein Flugzeug einsteigen – am Fensterplatz (Blick durchs ovale Kabinenfenster auf
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
    el.innerHTML = `<div class="rd-win"><div class="rd-shade"></div></div>
      <div class="rd-cockpit"><div class="rd-pillar l"></div><div class="rd-pillar r"></div><div class="rd-pillar c"></div>
        <div class="rd-glare"><div class="rd-pfd"><div class="rd-tape spd"><small>KT</small><b data-r="spd">0</b></div><div class="rd-ai"><div class="rd-hor"></div><i></i><span data-r="fma">TAXI</span></div><div class="rd-tape alt"><small>FT</small><b data-r="alt">0</b><em data-r="vs"></em></div></div>
        <div class="rd-nd"><div class="rd-rose" data-r="rose"></div><b data-r="hdg">000</b><small data-r="nd"></small></div></div></div>
      <div class="rd-bar"><span class="rd-belt" title="Anschnallzeichen">${icon('vest')}</span><span class="rd-t"></span><button class="rd-sw" data-rd="swap"></button><button class="rd-x" data-rd="x" title="Aussteigen (Esc)">✕</button></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.tEl = el.querySelector('.rd-t');
    this.R = Object.fromEntries([...el.querySelectorAll('[data-r]')].map((x) => [x.dataset.r, x]));
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rd]');
      if (!b) return;
      if (b.dataset.rd === 'x') this.stop();
      else this.setMode(this.mode === 'window' ? 'cockpit' : 'window');
    });
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
    // Begrüßung durch den Kapitän (Terminal-/Kabinenstimme, nur mit Echter Funk)
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
    // im Cockpit sitzt man im Flugzeug – es selbst wird nicht gezeichnet
    if (this.game.map) this.game.map.hideAc = mode === 'cockpit' ? this.id : null;
    this.el.classList.toggle('cockpit', mode === 'cockpit');
    this.el.classList.toggle('window', mode === 'window');
    this.el.querySelector('.rd-sw').innerHTML = mode === 'window' ? `${icon('plane')} Ins Cockpit` : `${icon('eye')} Zum Fensterplatz`;
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    if (this.game.map) this.game.map.hideAc = null;
    this.el.classList.add('hidden');
    document.getElementById('game').classList.remove('riding');
    this.game.ui.labels = this.labels !== false;
    this.game.cam.tx = null;
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
    const ac = s && s.acs.find((a) => a.id === this.id);
    // noch im Anflug außerhalb der Karte: Kamera wartet am Anfang des Endanflugs, Instrumente mit echten Luftdaten
    if (ac && ac.mode === 'air' && ac.arr && ARR_PH.has(ac.phase)) return this.updateAir(s, ac, dt);
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
    let tx, ty, tz;
    if (this.mode === 'window') {
      // rechter Fensterplatz kurz hinter der Tragfläche: Blick auf Flügel und Boden
      const bob = Math.sin(performance.now() / 700) * 0.03 * (z > 0.05 ? 1 : 0.3);
      tx = ac.x + rx * L * 0.42 - fx * L * 0.1;
      ty = ac.y + ry * L * 0.42 - fy * L * 0.1 - z * 0.4 + bob;
      tz = 2.6;
    } else {
      // Cockpit: weit voraus schauen
      const lead = 1.2 + clamp((ac.v || 0) * 9, 0, 3.2);
      tx = ac.x + fx * (L * 0.5 + lead);
      ty = ac.y + fy * (L * 0.5 + lead) - z * 0.4;
      tz = 2.2;
    }
    const k = 1 - Math.pow(this.mode === 'cockpit' ? 0.0001 : 0.001, dt);
    // Rütteln auf der Bahn: Startlauf und Ausrollen, je schneller, desto stärker
    const rumble = (ac.phase === PH.TAKEOFF && z < 0.05) || (ac.phase === PH.ROLLOUT && (ac.v || 0) > 0.15) ? Math.min(0.05, (ac.v || 0) * 0.08) : 0;
    const jx = rumble ? (Math.random() - 0.5) * rumble : 0, jy = rumble ? (Math.random() - 0.5) * rumble : 0;
    cam.x += (tx - cam.x) * k + jx;
    cam.y += (ty - cam.y) * k + jy;
    cam.zoom += (tz - cam.zoom) * Math.min(1, dt * 2);
    cam.tx = null;
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
    const txt = this.mode === 'window' ? `Platz ${12 + (ac.id.length * 7) % 18}F · ${where} · ${PHASE_DE[ac.phase] || ''}${alt > 0 ? ` · ${alt} ft` : ''}` : `Cockpit · ${where}`;
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
  const d = AS.routeDistance(ac.pos, ac.route.length && ac.phase === PH.APPROACH ? ac.route : AS.approachRoute(ac.pos, ac.rwy));
  const rot = s.rots[ac.rot];
  const city = rot && CITIES[rot.city] ? CITIES[rot.city].name : '';
  const where = `${esc(ac.cs)} · ${esc(AC_TYPES[ac.type].name)}${city ? ` · aus ${esc(city)}` : ''}`;
  const txt = `${this.mode === 'window' ? `Platz ${12 + (ac.id.length * 7) % 18}F` : 'Cockpit'} · ${where} · ${PHASE_DE[ac.phase] || ''} · noch ${d.toFixed(1)} NM`;
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

// grobe Restdistanz zur Schwelle im Endanflug (Kacheln), aus der Höhe abgeleitet (3°-Gleitpfad ≈ 1 Kachel je 0,05 z)
function distLeft(ac) {
  return Math.max(0, (ac.z || 0) / 0.05);
}
