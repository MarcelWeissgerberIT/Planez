// Klänge per WebAudio (keine Dateien nötig) + optionale Sprachausgabe
let ac = null;
let enabled = true;
let ttsOn = false;
let lastClick = 0;

function ctx() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      ac = null;
    }
  }
  if (ac && ac.state === 'suspended') ac.resume();
  return ac;
}
export function setSound(on) {
  enabled = on;
}
export function setTTS(on) {
  ttsOn = on;
  if (!on && window.speechSynthesis) speechSynthesis.cancel();
}
export function unlock() {
  ctx();
}

function tone(freq, dur, type = 'sine', vol = 0.08, when = 0) {
  const a = ctx();
  if (!a || !enabled) return;
  const t0 = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
function noise(dur, vol = 0.05, hp = 1200) {
  const a = ctx();
  if (!a || !enabled) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  radio() {
    const now = performance.now();
    if (now - lastClick < 250) return;
    lastClick = now;
    noise(0.06, 0.035, 1800);
  },
  request() {
    tone(880, 0.12, 'sine', 0.05);
    tone(1320, 0.16, 'sine', 0.04, 0.1);
  },
  alert() {
    tone(660, 0.18, 'square', 0.05);
    tone(440, 0.22, 'square', 0.05, 0.2);
  },
  click() {
    tone(1400, 0.04, 'triangle', 0.03);
  },
  cash() {
    tone(1046, 0.08, 'triangle', 0.05);
    tone(1568, 0.14, 'triangle', 0.05, 0.07);
  },
  // kleine Fanfare (Dur-Arpeggio mit Schlussakkord)
  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.06, i * 0.12));
    [523, 659, 784, 1046, 1318].forEach((f) => tone(f, 1.1, 'triangle', 0.035, 0.5));
    tone(262, 1.2, 'sine', 0.05, 0.5);
  },
};

// Funksprüche vorlesen (englische Phraseologie)
export function speak(text, isAtc) {
  if (!ttsOn || !window.speechSynthesis) return;
  if (speechSynthesis.pending || speechSynthesis.speaking) {
    // Rückstau vermeiden
    if (speechQueue++ > 2) return;
  } else speechQueue = 0;
  const u = new SpeechSynthesisUtterance(text.replace(/FL(\d+)/g, 'flight level $1').replace(/(\d)(\d)(\d)(\d)/g, '$1 $2 $3 $4'));
  u.lang = 'en-US';
  u.rate = 1.12;
  u.pitch = isAtc ? 0.9 : 1.1 + Math.random() * 0.2;
  u.volume = 0.9;
  const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
  if (vs.length) u.voice = isAtc ? vs[0] : vs[Math.min(vs.length - 1, 1 + Math.floor(Math.random() * Math.max(1, vs.length - 1)))];
  speechSynthesis.speak(u);
}
let speechQueue = 0;
