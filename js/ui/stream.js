// Spotter-Livestream (vor allem für den Beobachter): Die Kamera ist der Stream. Was gerade im Bild passiert –
// Landungen, Starts, Durchstarten, Superjumbo, Staatsbesuch, Notfall, Gewitter, Schnee, Nachtlichter –, lockt
// Zuschauer an; ein leeres Bild vertreibt sie. Der Chat kommentiert live. Der Zuschauerrekord zählt für Erfolge.
// Reine Oberfläche: verbraucht den Zufall der Simulation nicht.
import { AC_TYPES, CITIES } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { clamp, esc, hourOf } from '../util.js';
import { listeners } from '../sim/messages.js';

const USERS = ['spotter_kai', 'A380fan', 'ILS_Ina', 'Rollweg_Rudi', 'flugfeldfoto', 'PlaneSpotterHH', 'reverse_thrust', 'Maike_fliegt', 'TowerTom', 'jetlag_jonas',
  'Nordhafenhasser', 'kerosinkeks', 'MetarMia', 'butterlandung', 'Fensterplatz_Fred', 'Squawk7000', 'gate_gabi', 'propeller_paul', 'Heavy_Hanna', 'Taxiway_Tim'];
const COLORS = ['#38bdf8', '#a3e635', '#fbbf24', '#c084fc', '#fb7185', '#34d399', '#f97316', '#60a5fa', '#2dd4bf', '#f472b6'];
const r = (a) => a[Math.floor(Math.random() * a.length)];

const L = {
  land: ['Butterweich 🧈', 'Schöner Flare!', 'Landung 10/10', 'Hört ihr den Umkehrschub? 🔊', 'Sauber aufgesetzt 👏', 'Und unten ist er', 'Smooth!', 'Die Reifen qualmen 😍'],
  landWet: ['Die Gischt bei Regen 😍', 'Nasse Bahn, trotzdem sauber', 'Wischer an, Landung top'],
  dep: ['Rotate! 🛫', 'Und weg ist er', 'Die Triebwerke 🔊🔊', 'Steigt wie ne Eins', 'Gute Reise! 👋', 'Abheben ist immer wieder geil'],
  depCity: (c) => [`Gute Reise nach ${c}! 👋`, `${c}, wir kommen`, `Nimmt mich wer mit nach ${c}?`],
  ga: ['DURCHSTARTEN 😱', 'Go-around! Spannend', 'Nochmal ne Ehrenrunde', 'Puh, gute Entscheidung vom Piloten', 'Clip das!! 🎬'],
  push: ['Pushback läuft', 'Schlepper-Fahrer heute in Topform', 'Gleich geht\'s los', 'Beacon an, Triebwerke kommen'],
  taxi: ['Rollt schön', 'Follow the greens', 'Wohin geht\'s?'],
  a380: ['A380!!! 🐋', 'DER WAL IST DA 🐋🐋', 'Clip das!!', 'Vier Triebwerke, Gänsehaut', 'Endlich mal ein A380'],
  state: ['Staatsbesuch 🎖️ roter Teppich!', 'Wer ist da drin??', 'Polizeikolonne 🚓🚓', 'Ehrenformation, wie im Fernsehen', 'Protokoll on point'],
  emg: ['Feuerwehr steht bereit 🚒', 'Daumen drücken 🙏', 'Hoffentlich geht alles gut', 'Notfall, alle ruhig bleiben'],
  emgDone: ['Alle sicher unten ❤️', 'Puh. Respekt an die Crew 👏', 'Applaus für den Tower 👏👏'],
  special: ['Die Sonderlackierung 😍', 'Was für ein Lack!', 'Muss ich fürs Spotterbuch haben'],
  big: ['Großraumjet, schön', 'Heavy im Anflug', 'So ein Brummer'],
  bored: ['Langweilig hier 😴', 'Kamera auf die Bahn bitte', 'Zeig mal was', 'Wann kommt der nächste?', 'Leeres Vorfeld… 🦗', 'Schwenk mal zur Bahn!'],
  chat: ['Grüße aus Leipzig 👋', 'Erster!', 'Bester Stream', 'Läuft heute', 'Wer ist auch am Zaun?', 'Das Wetter heute 👌', 'Wie heißt das Kennzeichen?', 'Tower macht heute einen guten Job', 'Mehr A380 bitte', 'Nordhafen könnte das nicht'],
  night: ['Die Lichter nachts 😍', 'Anflugbefeuerung 🔥', 'Nachtschicht-Gang hier?', 'Blaue Rollwegbefeuerung ist so schön'],
  storm: ['Blitz!! ⚡', 'Gewitterlandung, mutig', 'Lieber nicht am Zaun stehen jetzt'],
  snow: ['Enteisung ist so satisfying', 'Schneepflüge im Konvoi ❄️', 'Winter-Spotting ❄️'],
  fog: ['Ich sehe nix 🌫️', 'CAT III, Respekt', 'Nebelsuppe'],
};

export class Stream {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.viewers = 0;
    this.peak = 0;
    this.seen = new Map();
    this.next = 2;
    this.queue = [];
    this.gap = 0;
    this.subs = 0;
    const el = document.createElement('div');
    el.id = 'stream';
    el.className = 'hidden';
    el.innerHTML = `<div class="st-head"><span class="st-live">LIVE</span><b class="st-v">0</b><small>Zuschauer</small><span class="st-pk"></span><button class="st-x" title="Livestream beenden (L)">✕</button></div>
      <div class="st-meter"><i></i></div><div class="st-hint"></div><div class="st-chat"></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.vEl = el.querySelector('.st-v');
    this.pkEl = el.querySelector('.st-pk');
    this.mEl = el.querySelector('.st-meter i');
    this.hEl = el.querySelector('.st-hint');
    this.chatEl = el.querySelector('.st-chat');
    el.querySelector('.st-x').addEventListener('click', () => this.stop());
    // Ereignisse aus dem Funk/Log, die nicht im Bild sein müssen
    listeners.radio.push((m) => {
      if (!this.on) return;
      if (/Staatsbesuch angekündigt/.test(m.text)) this.say(r(['Staatsbesuch angekündigt!! 🎖️', 'Gleich kommt die Regierungsmaschine', 'Kamera zum Vorfeld, schnell']), 3);
      else if (/MAYDAY/.test(m.text)) this.say(r(['MAYDAY gehört?! 😳', 'Notfall im Anflug!', 'Kamera auf die Bahn!!']), 3);
      else if (/Superjumbo .* angekündigt/.test(m.text)) this.say(r(['A380 kommt!!! 🐋', 'Leute, der Wal ist angekündigt']), 3);
    });
  }

  toggle() {
    return this.on ? this.stop() : this.start();
  }
  start() {
    this.on = true;
    this.el.classList.remove('hidden');
    const s = this.game.state;
    this.viewers = Math.round(60 + (s ? s.reputation : 50) * 2);
    this.chatEl.innerHTML = '';
    this.say('Stream läuft! 🔴 Willkommen am Zaun', 1, 'Planez TV');
    this.peak = Math.max(this.peak, (s && s.life && s.life.streamPeak) || 0);
  }
  stop() {
    this.on = false;
    this.el.classList.add('hidden');
  }

  say(text, prio = 1, user = null) {
    // gleiche Zeile nicht kurz hintereinander
    this.recent = this.recent || [];
    if (this.recent.includes(text) || this.queue.some((q) => q.text === text)) return;
    this.recent.push(text);
    if (this.recent.length > 10) this.recent.shift();
    this.queue.push({ text, prio, user: user || r(USERS) });
    this.queue.sort((a, b) => b.prio - a.prio);
    if (this.queue.length > 6) this.queue.length = 6;
  }
  post(m) {
    const d = document.createElement('div');
    const col = m.sub ? '' : m.user === 'Planez TV' ? '#ef4444' : COLORS[[...m.user].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) % COLORS.length];
    d.className = 'st-m' + (m.sub ? ' sub' : '');
    d.innerHTML = m.sub ? esc(m.text) : `<b style="color:${col}">${esc(m.user)}</b> ${esc(m.text)}`;
    this.chatEl.appendChild(d);
    while (this.chatEl.children.length > 7) this.chatEl.firstChild.remove();
  }

  // Wie spannend ist das Bild gerade? Flugzeuge im Bild nach Phase, Seltenheit und Nähe zur Bildmitte
  interest(s) {
    const cam = this.game.cam;
    const W = cam.w, H = cam.h;
    let I = 0;
    const inView = [];
    for (const ac of s.acs) {
      if (ac.mode !== 'map') continue;
      const p = cam.toScreen(ac.x, ac.y, ac.z || 0);
      if (p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40) continue;
      const c = 1 - Math.min(1, Math.hypot(p.x - W / 2, p.y - H / 2) / (Math.hypot(W, H) * 0.5)) * 0.6;
      let w = { [PH.FINAL]: 3, [PH.ROLLOUT]: 3, [PH.TAKEOFF]: 3.2, [PH.LINED]: 1.6, [PH.LINEUP]: 1.4, [PH.MISSED]: 4, [PH.PUSH]: 1.3, [PH.TAXI_IN]: 0.8, [PH.TAXI_OUT]: 0.8, [PH.STAND]: 0.35 }[ac.phase] || 0.3;
      if (ac.type === 'A388') w *= 3;
      if (ac.protocol) w *= 3;
      if (ac.emergency) w *= 3;
      if (ac.special) w *= 2;
      if (AC_TYPES[ac.type].size === 'L') w *= 1.3;
      I += w * c;
      inView.push(ac);
    }
    const zoomF = clamp(cam.zoom / 0.8, 0.6, 1.5);
    I *= zoomF;
    if (inView.length) {
      const wk = s.weather.kind;
      if (wk === 'storm') I += 2;
      else if (wk === 'snow') I += 1.4;
      else if (wk === 'fog') I += 0.6;
      const h = hourOf(s.time);
      if (h < 5.5 || h > 21) I += 0.8;
    }
    if (s.fire) I += 3;
    if (s.salute && s.salute.p) {
      const p = cam.toScreen(s.salute.p.x, s.salute.p.y, 0);
      if (p.x > 0 && p.y > 0 && p.x < W && p.y < H) I += 3;
    }
    return { I: Math.min(14, I), inView };
  }

  update(dt) {
    if (!this.on) return;
    const s = this.game.state;
    if (!s) return;
    const paused = !s.speed;
    const { I, inView } = this.interest(s);
    // Grundpublikum wächst mit dem Ansehen; Großereignisse ziehen zusätzlich Leute in den Stream
    const hype = s.acs.some((a) => a.type === 'A388' || a.protocol || a.emergency) ? 1.6 : 1;
    const rank = (s.goals && s.goals.rank) || 0;
    const base = (120 + s.reputation * 9) * (1 + 0.25 * rank) * hype;
    const target = paused ? this.viewers * 0.995 : base * (0.25 + 0.42 * Math.sqrt(I));
    const k = target > this.viewers ? 0.22 : 0.08;
    this.viewers += (target - this.viewers) * Math.min(1, k * dt);
    const v = Math.max(1, Math.round(this.viewers * (1 + Math.sin(performance.now() / 900) * 0.01)));
    this.vEl.textContent = v.toLocaleString('de-DE');
    this.mEl.style.width = `${Math.round(clamp(I / 9, 0, 1) * 100)}%`;
    this.mEl.className = I > 6 ? 'hot' : I > 2 ? 'ok' : 'cold';
    this.hEl.textContent = I < 1 ? '📉 Nichts los im Bild – schwenk zur Bahn oder zu einem besonderen Flugzeug' : I > 6 ? '🔥 Topszene!' : '';
    if (v > this.peak) {
      const step = Math.floor(v / 1000);
      if (step > Math.floor(this.peak / 1000) && this.peak > 0) this.post({ sub: true, text: `🎉 Neuer Rekord: ${(step * 1000).toLocaleString('de-DE')} Zuschauer!` });
      this.peak = v;
      const Lf = s.life || (s.life = {});
      Lf.streamPeak = Math.max(Lf.streamPeak || 0, v);
    }
    this.pkEl.textContent = `Rekord ${this.peak.toLocaleString('de-DE')}`;
    if (paused) return;
    // neue Szenen im Bild
    for (const ac of inView) {
      const prev = this.seen.get(ac.id);
      if (prev === ac.phase) continue;
      this.seen.set(ac.id, ac.phase);
      if (prev === undefined) {
        if (ac.type === 'A388') this.say(r(L.a380), 3);
        else if (ac.protocol) this.say(r(L.state), 3);
        else if (ac.emergency) this.say(r(L.emg), 3);
        else if (ac.special) this.say(r(L.special), 2);
        continue;
      }
      const wet = ['rain', 'storm', 'snow'].includes(s.weather.kind);
      if (ac.phase === PH.ROLLOUT) {
        const f = ac.tdFpm;
        if (ac.emergency) this.say(r(L.emgDone), 3);
        else if (f && f < 110) this.say(r([`Butter!! 🧈 ${f} ft/min`, `${f} fpm, Wahnsinn 🧈`, 'Die hat er gestreichelt 🧈']), 3);
        else if (f && f >= 600) this.say(r([`Autsch, ${f} ft/min 😬`, 'Flugzeugträger-Style 😅', 'Fahrwerk hat\'s überlebt?', 'Rums! 😬']), 3);
        else this.say(wet && Math.random() < 0.5 ? r(L.landWet) : r(L.land), 2);
      }
      else if (ac.phase === PH.TAKEOFF) {
        const rot = s.rots[ac.rot];
        const c = rot && CITIES[rot.city];
        this.say(c && Math.random() < 0.5 ? r(L.depCity(c.name)) : r(L.dep), 2);
      } else if (ac.phase === PH.MISSED) this.say(r(L.ga), 3);
      else if (ac.phase === PH.PUSH && Math.random() < 0.5) this.say(r(L.push), 1);
      else if (ac.phase === PH.FINAL && AC_TYPES[ac.type].size === 'L' && Math.random() < 0.5) this.say(r(L.big), 1);
    }
    if (this.seen.size > 300) this.seen.clear();
    // Wassertaufe im Bild
    const sal = s.salute;
    if (sal && sal.p && !sal.chat) {
      const p = this.game.cam.toScreen(sal.p.x, sal.p.y, 0);
      if (p.x > 0 && p.y > 0 && p.x < this.game.cam.w && p.y < this.game.cam.h) {
        sal.chat = true;
        this.say(r(['Wassertaufe!! 💦', 'Erstflug mit Wasserbogen 😍', 'Die Feuerwehr gibt alles 💦🚒', 'Gänsehaut, Erstflug!']), 3);
      }
    }
    // Plaudern zwischendurch
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 3 + Math.random() * 5 * (1.5 - Math.min(1, I / 6));
      const wk = s.weather.kind, h = hourOf(s.time);
      let pool = L.chat;
      if (I < 1) pool = L.bored;
      else if (wk === 'storm' && Math.random() < 0.4) pool = L.storm;
      else if (wk === 'snow' && Math.random() < 0.4) pool = L.snow;
      else if (wk === 'fog' && Math.random() < 0.4) pool = L.fog;
      else if ((h < 5.5 || h > 21) && Math.random() < 0.4) pool = L.night;
      this.say(r(pool), 0);
      if (Math.random() < 0.08 + I * 0.01) this.post({ sub: true, text: `⭐ ${r(USERS)} hat den Kanal abonniert` });
    }
    // Chat-Tempo begrenzen
    this.gap -= dt;
    if (this.gap <= 0 && this.queue.length) {
      this.post(this.queue.shift());
      this.gap = 0.9 + Math.random() * 0.8;
    }
  }
}
