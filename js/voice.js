// Echter Funk: Sprachausgabe mit Funk-Charakter (Sendetasten-Klick, Rauschen), eine Frequenz mit
// Warteschlange, feste Lotsenstimme, eigene Stimme je Flugzeug, ICAO-Aussprache von Zahlen.
import { AIRLINES } from './config.js';
import { T, EN } from './i18n.js';

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const digits = (s) => String(s).split('').map((c) => (/\d/.test(c) ? DIGIT[+c] : c === '.' ? 'decimal' : c)).join(' ');
const SIDE = { L: 'left', R: 'right', C: 'center' };
const PHONETIC = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
// Namen, die englische Stimmen sonst falsch aussprechen
const SAY = [[/\bPlanez\b/g, 'Planes'], [/\bRheinjet\b/g, 'Rhine jet'], [/\bFjordwing\b/g, 'Fyord wing'], [/\bNordstern\b/g, 'Nord-stern'], [/\bNM\b/g, 'miles'], [/\bkts?\b/g, 'knots']];

// Zahlen so sprechen, wie es Lotsen und Piloten tun
export function spoken(text) {
  let t = ' ' + text + ' ';
  t = t.replace(/MAYDAY MAYDAY MAYDAY/g, 'Mayday, Mayday, Mayday');
  for (const [re, w] of SAY) t = t.replace(re, w);
  // Rollwege und ATIS-Kennung im ICAO-Alphabet („via A and L“ -> „via Alpha and Lima“, „information K“)
  t = t.replace(/\b(via|and|taxiway|then|information) ([A-Z])\b(?!-)/g, (_, w, l) => `${w} ${PHONETIC[l]}`);
  t = t.replace(/\bFL\s?(\d{2,3})\b/g, (_, n) => `flight level ${digits(n)}`);
  t = t.replace(/\b(runway|rwy|RWY)\s+(\d{2})([LRC])?\b/gi, (_, w, n, sd) => `runway ${digits(n)}${sd ? ' ' + SIDE[sd.toUpperCase()] : ''}`);
  t = t.replace(/\b(\d{1,2})(\d{3}) (feet|ft)\b/g, (_, th, rest, u) => `${spokenThousands(+(th + rest))} feet`);
  t = t.replace(/\b(\d{4}) (feet|ft)\b/g, (_, n) => `${spokenThousands(+n)} feet`);
  t = t.replace(/\b(\d{3})\.(\d{1,3})\b/g, (_, a, b) => `${digits(a)} decimal ${digits(b)}`);
  t = t.replace(/\bwind (\d{3}) degrees (\d{1,2}) knots\b/g, (_, d, k) => T`wind ${digits(d)} degrees, ${digits(k)} knots`);
  t = t.replace(/\bQNH (\d{3,4})\b/g, (_, n) => `Q N H ${digits(n)}`);
  t = t.replace(/\b(ILS|CTOT|TSAT|TOBT|ATIS|VOR|RVR|LVP)\b/g, (m) => m.split('').join(' '));
  t = t.replace(/\bnumber (\d)\b/g, (_, n) => `number ${DIGIT[+n] === 'niner' ? 'nine' : DIGIT[+n]}`);
  // übrige Zahlen: Ziffer für Ziffer (Rufzeichen, Kurse, Geschwindigkeiten, Uhrzeiten)
  t = t.replace(/\b\d+\b/g, (n) => digits(n));
  return t.replace(/\s+/g, ' ').trim();
}
function spokenThousands(n) {
  const th = Math.floor(n / 1000), h = Math.round((n % 1000) / 100);
  const w = (x) => (x === 9 ? 'niner' : DIGIT[x]);
  let s = th ? `${th >= 10 ? digits(th) : w(th)} thousand` : '';
  if (h) s += `${s ? ' ' : ''}${w(h)} hundred`;
  return s || 'zero';
}

// ---------------- Funk-Klangeffekte (WebAudio) ----------------
let actx = null;
let hiss = null;
function audio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return null;
    }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function noiseBuffer(a, sec) {
  const b = a.createBuffer(1, Math.floor(a.sampleRate * sec), a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function band(a, f = 1800, q = 0.9) {
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = q;
  return bp;
}
// kurzer Sendetasten-Klick mit Rauschfahne
function squelch(vol) {
  const a = audio();
  if (!a || vol <= 0) return;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a, 0.14);
  const g = a.createGain();
  const t0 = a.currentTime;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.09 * vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
  src.connect(band(a, 2200, 0.7)).connect(g).connect(a.destination);
  src.start();
  const o = a.createOscillator();
  const og = a.createGain();
  o.type = 'square';
  o.frequency.value = 1150;
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.exponentialRampToValueAtTime(0.012 * vol, t0 + 0.003);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
  o.connect(og).connect(a.destination);
  o.start(t0);
  o.stop(t0 + 0.04);
}
function startHiss(vol) {
  const a = audio();
  if (!a || vol <= 0 || hiss) return;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a, 2);
  src.loop = true;
  const g = a.createGain();
  g.gain.value = 0.011 * vol;
  src.connect(band(a, 1600, 0.6)).connect(g).connect(a.destination);
  src.start();
  hiss = { src, g };
}
function stopHiss() {
  if (!hiss) return;
  try {
    hiss.src.stop();
  } catch (e) {}
  hiss = null;
}

// Klick beim Drücken der eigenen Sprechtaste
export function micClick(vol = 0.9) {
  squelch(vol);
}

// ---------------- Stimmen ----------------
let voices = [];
// Stimmen in der Spielsprache (Bodencrew, Durchsagen, Kommentar): Deutsch oder im englischen Spiel Englisch
let deVoices = [];
const LOC = EN ? 'en' : 'de';
const LOC_TAG = EN ? 'en-GB' : 'de-DE';
// Spaß- und Effektstimmen (v. a. macOS) taugen nicht für den Funk
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|wobble|zarvox|trinoids|whisper|jester|organ|superstar|good news|deranged|hysterical|junior|ralph|\bfred\b|kathy|princess|grandma|grandpa|\beddy\b|\bflo\b|\breed\b|rocko|\bsandy\b|shelley|novelty/i;
// natürlich klingende Stimmen zuerst (Edge „Online (Natural)“, Google, Siri/Premium/Enhanced)
const quality = (v) => (/natural|neural|online|premium|enhanced|siri/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 3 : 0) + (/microsoft/i.test(v.name) ? 1 : 0) + (v.localService === false ? 1 : 0) + (/daniel|samantha|karen|moira|tessa|serena|arthur|oliver/i.test(v.name) ? 2 : 0);
function loadVoices() {
  if (!window.speechSynthesis) return;
  const all = speechSynthesis.getVoices();
  const en = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
  const good = en.filter((v) => !NOVELTY.test(v.name));
  voices = (good.length ? good : en).slice().sort((a, b) => quality(b) - quality(a));
  deVoices = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith(LOC) && !NOVELTY.test(v.name)).sort((a, b) => quality(b) - quality(a));
}
// Bodencrew (Betriebsfunk, Deutsch): feste Stimme je Fahrzeug
function crewVoice(from) {
  if (deVoices.length) return deVoices[hash(from) % deVoices.length];
  return null;
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
};
// Lotse: ruhige, gut verständliche Stimme (bevorzugt britisch, männlich, natürlich klingend); einmal gewählt, bleibt sie
let atcCache = null;
function atcVoice() {
  if (atcCache && voices.includes(atcCache)) return atcCache;
  const male = /\bmale\b|daniel|ryan|george|guy|david|arthur|oliver|thomas|christopher|eric|brian|william|aaron/i;
  for (const p of [/en-GB/i, /en-US/i, /en-/i]) {
    const v = voices.find((x) => p.test(x.lang) && male.test(x.name) && !/female/i.test(x.name));
    if (v) return (atcCache = v);
  }
  return (atcCache = voices.find((x) => /en-GB/i.test(x.lang)) || voices[0] || null);
}
// Pilotenstimme: nach Rufzeichen fest, andere als die des Lotsen; die Airline prägt den Akzent
const ACCENT = { AUR: ['en-US'], RHJ: ['en-GB', 'en-IE'], ALP: ['en-GB', 'en-IE'], NST: ['en-GB', 'en-ZA'], SKB: ['en-IE', 'en-GB'], OPL: ['en-IN', 'en-GB'], TGC: ['en-US', 'en-CA'], BWG: ['en-GB', 'en-AU'], LUM: ['en-AU', 'en-NZ'], FJW: ['en-GB', 'en-IE'], VIP: ['en-US', 'en-GB'], GOV: ['en-GB'] };
function pilotVoice(from) {
  if (!voices.length) return null;
  const atc = atcVoice();
  const pool = voices.filter((v) => v !== atc);
  const list = pool.length ? pool : voices;
  const al = String(from).replace(/[^A-Z].*$/, '');
  const acc = ACCENT[al];
  const byAccent = acc ? list.filter((v) => acc.some((a) => v.lang.replace('_', '-').toLowerCase().startsWith(a.toLowerCase()))) : [];
  // die besseren Stimmen bevorzugen: aus der oberen Hälfte der Liste wählen, sofern vorhanden
  const cand = byAccent.length ? byAccent : list.slice(0, Math.max(2, Math.ceil(list.length / 2)));
  return cand[hash(from) % cand.length];
}

// ---------------- Sender / Warteschlange ----------------
export const voice = {
  on: false,
  vol: 0.9,
  rate: 1,
  queue: [],
  current: null,
  busyUntil: 0,
  muteAtcUntil: 0, // nach eigenem Sprachbefehl die Lotsen-Ansage nicht noch einmal vorlesen
  listeners: [],
  set(opts) {
    Object.assign(this, opts);
    if (!this.on) this.stop();
  },
  stop() {
    this.queue = [];
    if (window.speechSynthesis) speechSynthesis.cancel();
    stopHiss();
    this.current = null;
    this.emit();
  },
  emit() {
    for (const fn of this.listeners) fn(this.current);
  },
  // m: Logeintrag { kind: 'atc'|'pilot', from, text }; speed: Spieltempo
  say(m, speed = 1) {
    if (!this.on || !window.speechSynthesis) return;
    // Betriebsfunk im Vorfeld: Wichtiges immer, Routine nur bei ruhigem Kanal und normalem Tempo
    if (m.kind === 'crew') {
      const prio = m.prio || 1;
      if (prio < 2 && (speed > 1 || this.current || this.queue.length)) return;
      if (prio < 3 && speed > 5) return;
      if (prio >= 3) this.queue.unshift(m);
      else this.queue.push(m);
      while (this.queue.length > 3) this.queue.pop();
      return this.pump();
    }
    if (m.kind !== 'atc' && m.kind !== 'pilot') return;
    if (m.kind === 'atc' && performance.now() < this.muteAtcUntil) return;
    // ATIS läuft eigentlich auf eigener Frequenz: nur vorlesen, wenn sonst niemand funkt
    if (m.from === 'ATIS' && (this.current || this.queue.length || speed > 2)) return;
    const urgent = /MAYDAY|PAN PAN|go around|going around|fuel emergency/i.test(m.text);
    // bei hohem Tempo nur Wichtiges, sonst läuft der Funk hinterher
    if (speed > 2 && !urgent && !/request|ready|cleared to land|cleared for take-off/i.test(m.text)) return;
    if (urgent) this.queue.unshift(m);
    else this.queue.push(m);
    // Rückstau begrenzen: älteste unwichtige Meldungen verwerfen
    while (this.queue.length > 4) {
      const i = this.queue.findIndex((q) => !/MAYDAY|PAN/i.test(q.text));
      this.queue.splice(i < 0 ? this.queue.length - 1 : i, 1);
    }
    this.pump();
  },
  pump() {
    if (this.current || !this.queue.length || !window.speechSynthesis) return;
    const m = this.queue.shift();
    const isAtc = m.kind === 'atc';
    const isCrew = m.kind === 'crew';
    // Crew: Rufname vorweg wie im echten Betriebsfunk („Tank 2: …“), Text bleibt deutsch
    const u = new SpeechSynthesisUtterance(isCrew ? `${m.from}. ${m.text}` : spoken(m.text));
    const v = isCrew ? crewVoice(m.from || 'C') : isAtc ? atcVoice() : pilotVoice(m.from || 'X');
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = isCrew ? LOC_TAG : 'en-US';
    const h = hash(m.from || 'TWR');
    // natürliche Stimmen klingen bei starker Tonhöhenverschiebung künstlich: nur leicht variieren
    u.rate = (isCrew ? 1.02 : isAtc ? 1.08 : 1.03 + (h % 5) * 0.025) * this.rate;
    u.pitch = isCrew ? 1 : isAtc ? 0.97 : 0.9 + (h % 5) * 0.05;
    u.volume = this.vol;
    this.current = m;
    const done = () => {
      if (this.current !== m) return;
      stopHiss();
      squelch(this.vol);
      this.current = null;
      this.emit();
      // kurze Pause auf der Frequenz, Rücklesung folgt dicht
      setTimeout(() => this.pump(), isAtc ? 260 : 520);
    };
    u.onstart = () => {
      startHiss(this.vol);
      this.emit();
    };
    // lange Durchsagen (ATIS) satzweise sprechen – manche Online-Stimmen brechen sonst nach etwa 15 Sekunden ab
    const parts = u.text.length > 150 ? u.text.split(/(?<=[.!?])\s+/).filter(Boolean) : [u.text];
    const utts = parts.map((txt, i) => {
      if (parts.length === 1) return u;
      const x = new SpeechSynthesisUtterance(txt);
      for (const k of ['voice', 'lang', 'rate', 'pitch', 'volume']) x[k] = u[k];
      if (i === 0) x.onstart = u.onstart;
      return x;
    });
    utts[utts.length - 1].onend = done;
    for (const x of utts) x.onerror = done;
    squelch(this.vol);
    setTimeout(() => {
      if (this.current === m) for (const x of utts) speechSynthesis.speak(x);
    }, 90);
    // Sicherheitsnetz, falls ein Browser onend verschluckt
    setTimeout(done, 1500 + u.text.length * 95);
    this.emit();
  },
  // Terminal-Durchsage: ruhige deutsche Stimme mit Hall-Gefühl (langsamer, etwas tiefer), nur bei freiem Funk
  announce(text) {
    if (!this.on || !window.speechSynthesis || this.current || this.queue.length) return false;
    const u = new SpeechSynthesisUtterance(text);
    const de = deVoices.filter((x) => x.lang.toLowerCase().startsWith(LOC));
    const v = de[1] || de[0] || deVoices[0];
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = LOC_TAG;
    u.rate = 0.92 * this.rate;
    u.pitch = 1.05;
    u.volume = this.vol * 0.75;
    const m = { kind: 'pa', from: T('Durchsage'), text };
    this.current = m;
    const done = () => {
      if (this.current !== m) return;
      this.current = null;
      this.emit();
      setTimeout(() => this.pump(), 400);
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
    setTimeout(done, 2000 + text.length * 110);
    this.emit();
    return true;
  },
  // Kommentator (Kino-Modus): deutsche Studiostimme ohne Funkrauschen, nur wenn der Funk gerade frei ist
  narrate(text) {
    if (!this.on || !window.speechSynthesis || this.current || this.queue.length) return false;
    const u = new SpeechSynthesisUtterance(text);
    const v = deVoices.find((x) => x.lang.replace('_', '-').toLowerCase() === LOC_TAG.toLowerCase()) || deVoices[0];
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = LOC_TAG;
    u.rate = 1.04 * this.rate;
    u.pitch = 1;
    u.volume = this.vol * 0.9;
    const m = { kind: 'narr', from: T('Kommentar'), text };
    this.current = m;
    const done = () => {
      if (this.current !== m) return;
      this.current = null;
      this.emit();
      setTimeout(() => this.pump(), 400);
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
    setTimeout(done, 1500 + text.length * 90);
    return true;
  },
  supported: () => typeof window !== 'undefined' && !!window.speechSynthesis,
};

// Airline-Rufnamen für die Spracherkennung
export const TELEPHONY = Object.values(AIRLINES).map((a) => ({ code: a.code, tel: a.tel.toLowerCase() }));
