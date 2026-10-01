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
  mute() {
    if (A && bus) set(bus.gain, 0, 0.2);
  },
};
