// Musikstücke als Audiodateien (erzeugt mit OpenArt, siehe assets/music): Menü-Thema, Tag- und Nachtmusik.
// Jedes Stück läuft endlos – kurz vor dem Ende blendet ein zweiter Abspieler den Anfang weich darüber, damit die
// Schleife nicht springt. Stückwechsel (z. B. Tag -> Nacht) blenden über. Fehlt eine Datei oder kann der Browser
// sie nicht abspielen, meldet ok() false und die synthetische WebAudio-Musik übernimmt wie bisher.
const FILES = { menu: 'assets/music/menu.mp3', day: 'assets/music/day.mp3', night: 'assets/music/night.mp3' };
const XFADE = 2.5; // Sekunden Überblendung am Schleifenende
const STEP = 0.05;

const failed = new Set();
const fails = []; // Rückrufe, wenn ein Stück nicht ladbar ist (Synth übernimmt)
const decks = {}; // je Stück zwei Abspieler im Wechsel
function fail(k) {
  if (failed.has(k)) return;
  failed.add(k);
  if (cur === k) cur = null;
  for (const f of fails) f(k);
}
let cur = null, target = 0;
let timer = null;

// iPhone/iPad (Safari) ignorieren audio.volume – die Musik liefe dort immer mit voller Lautstärke. Dann laufen die
// Stücke über einen WebAudio-Verstärker; überall sonst bleibt es bei audio.volume.
const volumeIgnored = (() => {
  try {
    const a = new Audio();
    a.volume = 0.5;
    return a.volume !== 0.5;
  } catch (e) {
    return false;
  }
})();
let AC = null;
function gainFor(el) {
  if (!volumeIgnored) return null;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const g = AC.createGain();
    g.gain.value = 0;
    AC.createMediaElementSource(el).connect(g).connect(AC.destination);
    return g;
  } catch (e) {
    return null;
  }
}
// Klangausgabe startet auf dem iPhone erst nach einer Berührung
const resume = () => AC && AC.state !== 'running' && AC.resume().catch(() => {});
if (volumeIgnored && typeof window !== 'undefined') for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, resume, { passive: true });
function setVol(el, v) {
  if (el._g) el._g.gain.value = v;
  else el.volume = v;
}

function deck(k) {
  if (!decks[k]) {
    const mk = () => {
      const a = new Audio();
      a.preload = 'auto';
      a.src = FILES[k];
      a._g = gainFor(a);
      setVol(a, 0);
      a.addEventListener('error', () => fail(k));
      return a;
    };
    decks[k] = { a: [mk(), mk()], i: 0, vol: [0, 0] };
  }
  return decks[k];
}

function tick() {
  let busy = false;
  for (const [k, d] of Object.entries(decks)) {
    const want = k === cur ? target : 0;
    const a = d.a[d.i], b = d.a[1 - d.i];
    // Schleife: kurz vor Ende den zweiten Abspieler von vorn starten und überblenden
    if (k === cur && want > 0 && a.duration && a.currentTime > a.duration - XFADE && b.paused) {
      b.currentTime = 0;
      setVol(b, 0);
      d.vol[1 - d.i] = 0;
      b.play().catch(() => {});
      d.i = 1 - d.i;
    }
    for (let j = 0; j < 2; j++) {
      const el = d.a[j];
      const goal = j === d.i ? want : 0;
      // lineare Blenden: aktiver Abspieler in 2 s ein, der alte über die Überblendzeit aus
      const v = d.vol[j];
      const dv = (Math.max(goal, v, 0.05) * STEP) / (j === d.i ? 2 : XFADE);
      const nv = v < goal ? Math.min(goal, v + dv) : Math.max(goal, v - dv);
      d.vol[j] = nv;
      setVol(el, Math.max(0, Math.min(1, nv)));
      if (nv <= 0.001 && goal === 0 && !el.paused) el.pause();
      if (nv > 0.001 || goal > 0) busy = true;
    }
  }
  if (!busy) {
    clearInterval(timer);
    timer = null;
  }
}

export const tracks = {
  ok(k) {
    return !!FILES[k] && !failed.has(k) && typeof Audio !== 'undefined';
  },
  // Stück k mit Lautstärke vol spielen (0–1); andere blenden aus. false, wenn das Stück nicht verfügbar ist
  play(k, vol) {
    if (!this.ok(k)) return false;
    const d = deck(k);
    cur = k;
    target = vol;
    const a = d.a[d.i];
    resume();
    if (a.paused) a.play().catch((e) => {
      // Autoplay-Sperre ist kein Dateifehler – beim nächsten Aufruf erneut versuchen
      if (e && e.name !== 'NotAllowedError') fail(k);
    });
    if (!timer) timer = setInterval(tick, STEP * 1000);
    return true;
  },
  onFail(f) {
    fails.push(f);
  },
  volume(vol) {
    target = vol;
  },
  stop(k = null) {
    if (k && cur !== k) return;
    cur = null;
    target = 0;
    if (!timer && Object.keys(decks).length) timer = setInterval(tick, STEP * 1000);
  },
  get current() {
    return cur;
  },
};
