// Spielmusik (synthetisch, WebAudio): leise Klangflächen unter Funk und Klangkulisse, die sich der Lage anpassen –
// Tag (hell, Glocken), Nacht (dunkel, langsam), Hochbetrieb (dazu ein leises Arpeggio), Schnee (hohe, spärliche
// Glocken) und Spannung bei Notfällen, Treibstoffnot, Gewitter oder Windscherung (tiefer Puls, Reibung im Akkord).
// Jeder Takt wählt die Akkorde der aktuellen Stimmung; die Hüllkurven der Flächen überblenden weich.
let A = null, out = null, timer = null, playing = false, step = 0, mood = 'day', vol = 0.16;

const M = {
  // Dmaj9 – Bm9 – Gmaj7 – A6sus
  day: { bar: 8, chords: [[146.83, 220, 277.18, 329.63, 369.99], [123.47, 185, 220, 277.18, 293.66], [98, 146.83, 185, 246.94, 293.66], [110, 164.81, 185, 246.94, 293.66]], bells: 0.6, arp: false, cut: 1000 },
  busy: { bar: 6, chords: [[146.83, 220, 277.18, 329.63, 369.99], [123.47, 185, 220, 277.18, 293.66], [98, 146.83, 185, 246.94, 293.66], [110, 164.81, 220, 277.18, 329.63]], bells: 0.35, arp: true, cut: 1300 },
  // Am(add9) – Fmaj7 – Dm9 – Em7
  night: { bar: 10, chords: [[110, 164.81, 246.94, 261.63], [87.31, 130.81, 164.81, 220], [73.42, 146.83, 174.61, 220, 329.63], [82.41, 123.47, 146.83, 196]], bells: 0.25, arp: false, cut: 650 },
  // Cm mit kleiner None – Ab/C – Cm – Bdim/C
  tension: { bar: 6, chords: [[65.41, 130.81, 155.56, 196, 277.18], [65.41, 130.81, 207.65, 261.63, 311.13], [65.41, 130.81, 155.56, 196, 233.08], [65.41, 123.47, 146.83, 174.61, 207.65]], bells: 0, arp: false, pulse: true, cut: 700 },
  // Emaj9 – C#m9 – Amaj9 – B6
  snow: { bar: 9, chords: [[164.81, 246.94, 311.13, 369.99, 415.3], [138.59, 207.65, 246.94, 311.13, 329.63], [110, 164.81, 207.65, 246.94, 329.63], [123.47, 185, 207.65, 277.18, 311.13]], bells: 0.9, arp: false, cut: 1500 },
};

function init() {
  if (A) return true;
  try {
    A = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    return false;
  }
  out = A.createGain();
  out.gain.value = 0;
  const delay = A.createDelay(2);
  delay.delayTime.value = 0.55;
  const fb = A.createGain();
  fb.gain.value = 0.33;
  const lp = A.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1600;
  out.connect(A.destination);
  out.connect(delay);
  delay.connect(lp).connect(fb).connect(delay);
  lp.connect(A.destination);
  return true;
}

function pad(freq, t, dur, v, cut) {
  const o1 = A.createOscillator(), o2 = A.createOscillator();
  o1.type = 'sawtooth';
  o2.type = 'triangle';
  o1.frequency.value = freq;
  o2.frequency.value = freq * 1.0035;
  const f = A.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 0.5;
  f.frequency.setValueAtTime(cut * 0.45, t);
  f.frequency.linearRampToValueAtTime(cut * (0.9 + Math.random() * 0.4), t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(cut * 0.4, t + dur);
  const g = A.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + 2.4);
  g.gain.setValueAtTime(v, t + dur - 1.6);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.4);
  o1.connect(f);
  o2.connect(f);
  f.connect(g).connect(out);
  o1.start(t);
  o2.start(t);
  o1.stop(t + dur + 1.6);
  o2.stop(t + dur + 1.6);
}

function bell(freq, t, v = 0.04) {
  const o = A.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = A.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 2.4);
}

function pluck(freq, t, v = 0.022) {
  const o = A.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const g = A.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.5);
}

// tiefer, gedämpfter Herzschlag-Puls
function thump(t, v = 0.11) {
  const o = A.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
  const g = A.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.4);
}

function schedule() {
  if (!playing) return;
  const m = M[mood] || M.day;
  const t = A.currentTime + 0.1;
  const ch = m.chords[step % m.chords.length];
  ch.forEach((f, i) => pad(f, t, m.bar, i === 0 ? 0.045 : 0.024, m.cut));
  if (m.bells) for (let k = 0; k < 3; k++) if (Math.random() < m.bells) bell(ch[1 + Math.floor(Math.random() * (ch.length - 1))] * 4, t + 0.8 + k * (m.bar / 3.4) + Math.random() * 0.5, mood === 'snow' ? 0.035 : 0.03);
  if (m.arp) {
    const notes = [...ch.slice(1), ...ch.slice(1).map((f) => f * 2)];
    for (let k = 0; k < m.bar * 4; k++) if (k % 8 !== 7) pluck(notes[(k * 3 + step) % notes.length] * 2, t + k * 0.25);
  }
  if (m.pulse) for (let k = 0; k < m.bar / 0.8; k++) {
    thump(t + k * 0.8);
    thump(t + k * 0.8 + 0.22, 0.06);
  }
  step++;
  timer = setTimeout(schedule, m.bar * 1000);
}

// Stimmung aus der Lage im Spiel
export function moodOf(state) {
  const h = (state.time / 3600) % 24;
  if (state.acs.some((a) => a.emergency || a.fuelEmergency) || state.windshear || state.weather.kind === 'storm' || (state.fire && state.fireAlert)) return 'tension';
  if (state.weather.kind === 'snow') return 'snow';
  if (h < 5.5 || h > 21.5) return 'night';
  const busy = state.acs.filter((a) => a.mode === 'air').length + state.acs.filter((a) => a.mode === 'map' && a.phase !== 'AT_STAND').length;
  return busy >= 9 ? 'busy' : 'day';
}

export const gameMusic = {
  start(v = vol) {
    if (!init()) return;
    vol = v;
    if (A.state === 'suspended') A.resume();
    out.gain.cancelScheduledValues(A.currentTime);
    out.gain.setTargetAtTime(vol, A.currentTime, 2.5);
    if (playing) return;
    playing = true;
    schedule();
  },
  stop() {
    if (!A || !playing) return;
    out.gain.cancelScheduledValues(A.currentTime);
    out.gain.setTargetAtTime(0, A.currentTime, 0.8);
    playing = false;
    clearTimeout(timer);
  },
  // Stimmung wechselt mit dem nächsten Takt; leiser, solange pausiert
  update(state, paused) {
    if (!playing) return;
    mood = moodOf(state);
    out.gain.setTargetAtTime(paused ? vol * 0.55 : mood === 'tension' ? vol * 1.15 : vol, A.currentTime, 1.5);
  },
  get mood() {
    return mood;
  },
  get playing() {
    return playing;
  },
};
