// Menümusik (synthetisch, WebAudio): ruhige Flächenklänge mit langsamer Akkordfolge, Filterbewegung und Echo.
// Startet nach der ersten Nutzeraktion im Hauptmenü und blendet beim Spielstart aus.
let A = null, out = null, timer = null, playing = false, step = 0;

// Akkorde (Frequenzen in Hz): Cmaj9 – Am9 – Fmaj7#11 – G6/9
const CHORDS = [
  [130.81, 196.0, 246.94, 293.66, 329.63],
  [110.0, 164.81, 196.0, 246.94, 261.63],
  [87.31, 174.61, 220.0, 261.63, 329.63],
  [98.0, 146.83, 196.0, 246.94, 329.63],
];
const BAR = 7.5; // Sekunden je Akkord

function init() {
  if (A) return true;
  try {
    A = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    return false;
  }
  out = A.createGain();
  out.gain.value = 0;
  // weiches Echo
  const delay = A.createDelay(2);
  delay.delayTime.value = 0.62;
  const fb = A.createGain();
  fb.gain.value = 0.38;
  const lp = A.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  out.connect(A.destination);
  out.connect(delay);
  delay.connect(lp).connect(fb).connect(delay);
  lp.connect(A.destination);
  return true;
}

function pad(freq, t, dur, vol) {
  const o1 = A.createOscillator(), o2 = A.createOscillator();
  o1.type = 'sawtooth';
  o2.type = 'triangle';
  o1.frequency.value = freq;
  o2.frequency.value = freq * 1.004; // leichte Schwebung
  const f = A.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 0.6;
  f.frequency.setValueAtTime(420, t);
  f.frequency.linearRampToValueAtTime(900 + Math.random() * 500, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(380, t + dur);
  const g = A.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 2.2);
  g.gain.setValueAtTime(vol, t + dur - 1.5);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.2);
  o1.connect(f);
  o2.connect(f);
  f.connect(g).connect(out);
  o1.start(t);
  o2.start(t);
  o1.stop(t + dur + 1.4);
  o2.stop(t + dur + 1.4);
}

function bell(freq, t) {
  const o = A.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = A.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 2.6);
}

function schedule() {
  if (!playing) return;
  const t = A.currentTime + 0.1;
  const ch = CHORDS[step % CHORDS.length];
  ch.forEach((f, i) => pad(f, t, BAR, i === 0 ? 0.05 : 0.028));
  // ein paar hohe Glockentöne aus dem Akkord
  for (let k = 0; k < 3; k++) if (Math.random() < 0.75) bell(ch[1 + Math.floor(Math.random() * 4)] * 4, t + 1 + k * 2.1 + Math.random() * 0.6);
  step++;
  timer = setTimeout(schedule, BAR * 1000);
}

export const menuMusic = {
  start(vol = 0.5) {
    if (!init()) return;
    if (A.state === 'suspended') A.resume();
    out.gain.cancelScheduledValues(A.currentTime);
    out.gain.setTargetAtTime(vol, A.currentTime, 1.2);
    if (playing) return;
    playing = true;
    schedule();
  },
  stop() {
    if (!A || !playing) return;
    out.gain.cancelScheduledValues(A.currentTime);
    out.gain.setTargetAtTime(0, A.currentTime, 0.5);
    playing = false;
    clearTimeout(timer);
  },
  get playing() {
    return playing;
  },
};
