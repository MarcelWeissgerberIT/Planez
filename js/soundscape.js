// Klangkulisse (WebAudio, alles synthetisch): Triebwerke nach Nähe zur Kamera, Startlauf-Donnern,
// Wind, Regen, Donner, tagsüber Vögel, nachts Grillen. Lautstärke folgt Zoom und Bildausschnitt.
import { hourOf, clamp } from './util.js';
import { PH } from './sim/aircraft.js';
import { AC_TYPES } from './config.js';

let A = null;
let bus = null;
const L = {};

function noiseBuf(a, sec, brown = false) {
  const b = a.createBuffer(2, Math.floor(a.sampleRate * sec), a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
  }
  return b;
}
function loop(a, buf, filters, gain = 0) {
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  let node = src;
  for (const f of filters) {
    node.connect(f);
    node = f;
  }
  const g = a.createGain();
  g.gain.value = gain;
  const pan = a.createStereoPanner ? a.createStereoPanner() : null;
  node.connect(g);
  if (pan) {
    g.connect(pan);
    pan.connect(bus);
  } else g.connect(bus);
  src.start();
  return { src, g, pan, filters };
}
const filt = (a, type, f, q = 0.7) => {
  const x = a.createBiquadFilter();
  x.type = type;
  x.frequency.value = f;
  x.Q.value = q;
  return x;
};

function init() {
  if (A) return true;
  try {
    A = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    return false;
  }
  bus = A.createGain();
  bus.gain.value = 0;
  bus.connect(A.destination);
  const white = noiseBuf(A, 3), brown = noiseBuf(A, 4, true);
  L.rumble = loop(A, brown, [filt(A, 'lowpass', 260)]);
  L.jet = loop(A, white, [filt(A, 'bandpass', 900, 0.6), filt(A, 'lowpass', 2600)]);
  // Turbinenpfeifen
  const o = A.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 3200;
  const of = filt(A, 'bandpass', 3200, 8);
  const og = A.createGain();
  og.gain.value = 0;
  o.connect(of).connect(og).connect(bus);
  o.start();
  L.whine = { o, g: og };
  // Propellerbrummen (Turboprops): Sägezahn, mit der Blattfrequenz moduliert, tiefpassgefiltert
  const po = A.createOscillator();
  po.type = 'sawtooth';
  po.frequency.value = 88;
  const pam = A.createGain();
  pam.gain.value = 0.55;
  const plfo = A.createOscillator();
  plfo.frequency.value = 21;
  const plfoG = A.createGain();
  plfoG.gain.value = 0.45;
  plfo.connect(plfoG).connect(pam.gain);
  const pf = filt(A, 'lowpass', 460);
  const pg = A.createGain();
  pg.gain.value = 0;
  po.connect(pam).connect(pf).connect(pg).connect(bus);
  po.start();
  plfo.start();
  L.prop = { o: po, lfo: plfo, g: pg };
  L.roar = loop(A, brown, [filt(A, 'lowpass', 520), filt(A, 'peaking', 140, 1)]);
  L.wind = loop(A, white, [filt(A, 'bandpass', 480, 0.4)]);
  L.rain = loop(A, white, [filt(A, 'highpass', 1800), filt(A, 'lowpass', 9000)]);
  L.crickets = loop(A, white, [filt(A, 'bandpass', 4600, 14)]);
  // Grillen-Zirpen: Amplitudenmodulation
  const lfo = A.createOscillator();
  lfo.frequency.value = 13;
  const lg = A.createGain();
  lg.gain.value = 0;
  lfo.connect(lg).connect(L.crickets.g.gain);
  lfo.start();
  L.cricketLfo = lg;
  // Hubschrauber-Rotor: tiefes Rauschen, mit der Blattfrequenz „gehackt“ (wop-wop)
  L.rotor = loop(A, brown, [filt(A, 'lowpass', 420), filt(A, 'peaking', 95, 1.2)]);
  const rl = A.createOscillator();
  rl.frequency.value = 11;
  const rlg = A.createGain();
  rlg.gain.value = 0;
  rl.connect(rlg).connect(L.rotor.g.gain);
  rl.start();
  L.rotorLfo = rlg;
  // Martinshorn der Flughafenfeuerwehr (Quarte, „Tatü-tata“)
  const so = A.createOscillator();
  so.type = 'square';
  so.frequency.value = 466;
  const sg = A.createGain();
  sg.gain.value = 0;
  const sp = A.createStereoPanner ? A.createStereoPanner() : null;
  so.connect(filt(A, 'lowpass', 1700)).connect(sg);
  if (sp) sg.connect(sp).connect(bus);
  else sg.connect(bus);
  so.start();
  L.siren = { o: so, g: sg, pan: sp };
  // Hubschrauber: tiefes Rauschen, rhythmisch moduliert (Rotorschlag)
  L.heli = loop(A, brown, [filt(A, 'lowpass', 380)]);
  const hl = A.createOscillator();
  hl.frequency.value = 17;
  const hg = A.createGain();
  hg.gain.value = 0;
  hl.connect(hg).connect(L.heli.g.gain);
  hl.start();
  L.heliLfo = hg;
  return true;
}

function set(p, v, t = 0.35) {
  if (!p) return;
  p.setTargetAtTime(v, A.currentTime, t);
}

function chirp() {
  // Vogelruf: kurze Tonfolge mit Frequenzsprüngen
  const n = 2 + Math.floor(Math.random() * 4);
  const base = 2600 + Math.random() * 2400;
  let t = A.currentTime + 0.02;
  const pan = A.createStereoPanner ? A.createStereoPanner() : null;
  if (pan) {
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(bus);
  }
  for (let i = 0; i < n; i++) {
    const o = A.createOscillator();
    const g = A.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), t);
    o.frequency.exponentialRampToValueAtTime(base * (1.1 + Math.random() * 0.4), t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.018, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(pan || bus);
    o.start(t);
    o.stop(t + 0.12);
    t += 0.1 + Math.random() * 0.06;
  }
}

function thunder(strength = 1) {
  const src = A.createBufferSource();
  src.buffer = noiseBuf(A, 3.5, true);
  const f = filt(A, 'lowpass', 180 + Math.random() * 120);
  const g = A.createGain();
  const t = A.currentTime + 0.3 + Math.random() * 1.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.18 * strength, t + 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
  src.connect(f).connect(g).connect(bus);
  src.start(t);
}

// Reifen beim Aufsetzen: kurzes Quietschen (zwei, drei Hauptfahrwerksräder nacheinander), je härter, desto lauter
let squealBuf = null;
function squeal(strength, pan) {
  if (!squealBuf) squealBuf = noiseBuf(A, 0.6);
  const out = A.createStereoPanner ? A.createStereoPanner() : null;
  if (out) {
    out.pan.value = pan;
    out.connect(bus);
  }
  const n = strength > 0.7 ? 3 : 2;
  let t = A.currentTime + 0.02;
  for (let i = 0; i < n; i++) {
    const src = A.createBufferSource();
    src.buffer = squealBuf;
    const bp = A.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 500;
    bp.Q.value = 7;
    const g = A.createGain();
    const v = 0.05 + 0.2 * strength;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.015);
    g.gain.exponentialRampToValueAtTime(v * 0.35, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28 + strength * 0.15);
    src.connect(bp).connect(g).connect(out || bus);
    src.start(t, Math.random() * 0.2);
    src.stop(t + 0.5);
    t += 0.06 + Math.random() * 0.05;
  }
}
const prevPhase = new Map();

// dumpfer Schlag (Aufsetzen, Fahrwerk ein/aus): kurzes, tiefes Rauschen
function thud(vol, lp = 140, dur = 0.35) {
  const src = A.createBufferSource();
  src.buffer = noiseBuf(A, dur + 0.1, true);
  const f = filt(A, 'lowpass', lp);
  const g = A.createGain();
  const t = A.currentTime + 0.01;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t);
}

export const soundscape = {
  on: true,
  vol: 0.7,
  lastFlash: 0,
  nextBird: 0,
  unlock() {
    if (!init()) return;
    if (A.state === 'suspended') A.resume();
  },
  // jeden Frame (nur wenn aktiv)
  update(state, cam, map, dt, paused) {
    if (!A) return;
    const want = this.on && state ? this.vol : 0;
    set(bus.gain, paused ? want * 0.35 : want, 0.4);
    if (!want) return;
    const h = hourOf(state.time);
    const night = h < 5.5 || h > 21;
    // Mitfliegen innen (Cockpit/Fenster): der Klang des eigenen Flugzeugs statt der Umgebung – Triebwerke, Rollen,
    // Fahrtwind; beim Startlauf laufen die Triebwerke hörbar hoch
    const c = this.cabin;
    // Drohne: helles Surren der Rotoren, sonst nur Wind
    if (c && c.drone) {
      const sp = c.speed || 0;
      set(L.prop.g.gain, 0.012 + 0.012 * sp, 0.3);
      set(L.prop.o.frequency, 165 + 55 * sp, 0.4);
      for (const k of ['rumble', 'roar', 'jet', 'rotor', 'heli']) set(L[k].g.gain, 0, 0.4);
      set(L.whine.g.gain, 0, 0.4);
      set(L.rotorLfo.gain, 0, 0.4);
      set(L.heliLfo.gain, 0, 0.4);
      set(L.wind.g.gain, 0.012 + 0.02 * sp, 0.6);
      this.levels = { jet: 0, roar: 0, ctx: A.state, cabin: true };
      return;
    }
    if (c) {
      const thrust = c.phase === PH.TAKEOFF || c.phase === PH.MISSED || c.climb ? 1 : c.phase === PH.ROLLOUT ? 0.55 : c.air ? 0.42 : c.moving ? 0.3 : c.phase === PH.STAND || c.phase === PH.PUSH ? 0.08 : 0.22;
      const spd = clamp(c.kt / 160, 0, 1.5);
      set(L.rumble.g.gain, 0.04 + 0.12 * thrust + (c.ground ? 0.09 * Math.min(1, spd) : 0), 0.6);
      set(L.roar.g.gain, (c.prop ? 0.03 : 0.07) * thrust, 0.9);
      set(L.wind.g.gain, 0.008 + 0.045 * Math.min(1.3, spd), 0.8);
      set(L.jet.g.gain, c.prop ? 0.004 : 0.012 + 0.03 * thrust, 0.8);
      set(L.whine.g.gain, c.prop ? 0 : 0.0012 + 0.0028 * thrust, 0.8);
      set(L.whine.o.frequency, 2300 + 1500 * thrust, 2.2);
      set(L.prop.g.gain, c.prop ? 0.025 + 0.05 * thrust : 0, 0.6);
      set(L.prop.o.frequency, 78 + 26 * thrust, 1.2);
      for (const k of ['rotor', 'heli']) set(L[k].g.gain, 0, 0.4);
      set(L.rotorLfo.gain, 0, 0.4);
      set(L.heliLfo.gain, 0, 0.4);
      set(L.siren.g.gain, 0, 0.2);
      set(L.crickets.g.gain, 0, 0.5);
      set(L.cricketLfo.gain, 0, 0.5);
      const w = state.weather.kind;
      set(L.rain.g.gain, w === 'rain' ? 0.05 : w === 'storm' ? 0.08 : 0, 1);
      this.levels = { jet: thrust, roar: thrust, ctx: A.state, cabin: true };
      return;
    }
    // Triebwerke: Summe über Flugzeuge in Bildnähe, gewichtet mit Abstand zur Bildmitte und Zoom
    let jet = 0, roar = 0, prop = 0, panSum = 0, wsum = 0;
    const zoomF = clamp((cam.zoom - 0.3) / 1.4, 0.15, 1.2);
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      const d = Math.hypot(ac.x - cam.x, ac.y - cam.y);
      const near = clamp(1 - d / (14 / Math.max(0.4, cam.zoom)), 0, 1);
      if (near <= 0) continue;
      const big = { S: 0.6, M: 1, L: 1.5 }[AC_TYPES[ac.type].size] || 1;
      let lvl = 0;
      const isProp = AC_TYPES[ac.type].sprite === 'plane_prop';
      if (isProp && (ac.phase === PH.TAKEOFF || ac.phase === PH.MISSED)) prop += near * 1.5;
      else if (isProp && ac.phase === PH.ROLLOUT) prop += near * 0.9;
      else if (ac.phase === PH.TAKEOFF || ac.phase === PH.MISSED) roar += near * big * 1.4;
      else if (ac.phase === PH.ROLLOUT) roar += near * big * 0.8 * clamp(ac.v * 4, 0.2, 1);
      else if (ac.phase === PH.FINAL) lvl = 0.7;
      else if ([PH.TAXI_IN, PH.TAXI_OUT, PH.LINEUP, PH.LINED, PH.HOLDING, PH.STARTUP, PH.PUSH].includes(ac.phase)) lvl = ac.phase === PH.STARTUP ? 0.5 : 0.45;
      else if (ac.phase === PH.STAND && ac.engines) lvl = 0.3;
      if (lvl && isProp) prop += near * lvl * 1.2;
      if (lvl) {
        if (!isProp) jet += near * lvl * big;
        const sx = (ac.x - ac.y - (cam.x - cam.y)) * 0.08;
        panSum += clamp(sx, -1, 1) * near;
        wsum += near;
      }
    }
    // Aufsetzen: Reifenquietschen für Landungen in Bildnähe (Lautstärke nach Sinkrate)
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      const p = prevPhase.get(ac.id);
      prevPhase.set(ac.id, ac.phase);
      if (p !== PH.FINAL || ac.phase !== PH.ROLLOUT || paused) continue;
      const d = Math.hypot(ac.x - cam.x, ac.y - cam.y);
      const nr = clamp(1 - d / (16 / Math.max(0.4, cam.zoom)), 0, 1) * zoomF;
      if (nr > 0.05) squeal(clamp(nr * (0.35 + (ac.tdFpm || 200) / 700), 0.1, 1), clamp((ac.x - ac.y - (cam.x - cam.y)) * 0.06, -0.8, 0.8));
    }
    if (prevPhase.size > 300) prevPhase.clear();
    // Cessna der Platzrunden und Rettungshubschrauber
    const near = (x, y) => clamp(1 - Math.hypot(x - cam.x, y - cam.y) / (16 / Math.max(0.4, cam.zoom)), 0, 1);
    const vp = state.vfr && state.vfr.p;
    if (vp) prop += near(vp.x, vp.y) * (vp.z < 0.6 ? 1.1 : 0.7);
    const hh = state.heli && state.heli.h;
    const rotor = hh ? clamp(near(hh.x, hh.y) * 1.3 * zoomF, 0, 1) : 0;
    set(L.rotor.g.gain, 0.09 * rotor, 0.4);
    set(L.rotorLfo.gain, 0.085 * rotor, 0.4);
    if (L.rotor.pan && hh) set(L.rotor.pan.pan, clamp((hh.x - hh.y - (cam.x - cam.y)) * 0.06, -0.8, 0.8));
    jet = clamp(jet * zoomF, 0, 1.4);
    roar = clamp(roar * zoomF, 0, 1.6);
    this.levels = { jet, roar, ctx: A.state };
    set(L.jet.g.gain, 0.07 * jet);
    set(L.rumble.g.gain, 0.12 * jet + 0.02);
    set(L.whine.g.gain, 0.0035 * Math.min(1, jet));
    set(L.roar.g.gain, 0.22 * roar, 0.5);
    prop = clamp(prop * zoomF, 0, 1.5);
    set(L.prop.g.gain, 0.06 * prop, 0.4);
    // Drehzahl hörbar: beim Startlauf höher
    set(L.prop.o.frequency, 80 + 22 * Math.min(1, prop), 0.6);
    if (L.jet.pan && wsum) set(L.jet.pan.pan, clamp(panSum / wsum, -0.8, 0.8));
    // Martinshorn, solange Löschfahrzeuge ausrücken
    let siren = 0, sPan = 0;
    if (state.fire) for (const t of state.fire.trucks) {
      if (t.st !== 'out' || !t.path) continue;
      const d = Math.hypot(t.x - cam.x, t.y - cam.y);
      const near = clamp(1 - d / (26 / Math.max(0.4, cam.zoom)), 0.15, 1);
      if (near > siren) {
        siren = near;
        sPan = clamp((t.x - t.y - (cam.x - cam.y)) * 0.06, -0.8, 0.8);
      }
    }
    set(L.siren.g.gain, 0.02 * siren, 0.15);
    if (siren) {
      const hi = Math.floor(A.currentTime / 0.65) % 2;
      L.siren.o.frequency.setTargetAtTime(hi ? 622 : 466, A.currentTime, 0.01);
      if (L.siren.pan) set(L.siren.pan.pan, sPan, 0.3);
    }
    // Hubschrauber in der Nähe
    const hc = map && map.wildlife && map.wildlife.heli;
    let hv = 0;
    if (hc) {
      const d = Math.hypot(hc.x - cam.x, hc.y - cam.y);
      hv = clamp(1 - d / (30 / Math.max(0.4, cam.zoom)), 0, 1) * zoomF;
      if (L.heli.pan) set(L.heli.pan.pan, clamp((hc.x - hc.y - (cam.x - cam.y)) * 0.05, -0.8, 0.8), 0.3);
    }
    set(L.heli.g.gain, 0.05 * hv, 0.4);
    set(L.heliLfo.gain, 0.045 * hv, 0.4);
    // Wetter
    const w = state.weather.kind;
    const windSpd = state.wind ? state.wind.spd : 8;
    set(L.wind.g.gain, 0.012 + 0.0022 * windSpd + (w === 'storm' ? 0.03 : 0), 1);
    set(L.rain.g.gain, w === 'rain' ? 0.035 : w === 'storm' ? 0.06 : 0, 1.2);
    // Donner, wenn die Karte blitzt
    if (map && map.flash > 0.5 && performance.now() - this.lastFlash > 1500) {
      this.lastFlash = performance.now();
      thunder(0.8 + Math.random() * 0.4);
    }
    // Vögel tagsüber bei ruhigem Wetter, Grillen nachts im Sommerhalbjahr
    const calm = w === 'clear' || w === 'clouds';
    if (!night && calm && h > 5 && h < 20 && performance.now() > this.nextBird && jet < 0.4 && roar < 0.2) {
      this.nextBird = performance.now() + 2500 + Math.random() * 6000;
      if (cam.zoom > 0.6) chirp();
    }
    set(L.crickets.g.gain, night && calm ? 0.004 : 0, 1.5);
    set(L.cricketLfo.gain, night && calm ? 0.004 : 0, 1.5);
  },
  // Donner (3D-Ansicht: zu einem sichtbaren Blitz, nach Entfernung verzögert und leiser)
  thunder(strength = 1, delayMs = 0) {
    if (!A || !this.on) return;
    setTimeout(() => A && thunder(clamp(strength, 0.15, 1.3)), delayMs);
  },
  // Ereignisse beim Mitfliegen: Aufsetzen (Schlag + Reifen), Fahrwerk ein- bzw. ausfahren
  touchdown(strength = 0.6) {
    if (!A || !this.on) return;
    thud(0.35 + 0.4 * strength, 120, 0.45);
    squeal(clamp(strength * 0.6, 0.15, 0.7), 0);
  },
  gear() {
    if (!A || !this.on) return;
    thud(0.12, 220, 0.25);
    setTimeout(() => A && thud(0.18, 160, 0.3), 1400);
  },
  mute() {
    if (A && bus) set(bus.gain, 0, 0.2);
  },
};
