// Spotter-Livestream (vor allem für den Beobachter): Die Kamera ist der Stream. Was gerade im Bild passiert –
// Landungen, Starts, Durchstarten, Superjumbo, Staatsbesuch, Notfall, Gewitter, Schnee, Nachtlichter –, lockt
// Zuschauer an; ein leeres Bild vertreibt sie. Der Chat kommentiert live. Der Zuschauerrekord zählt für Erfolge.
// Reine Oberfläche: verbraucht den Zufall der Simulation nicht.
import { AC_TYPES, CITIES } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { clamp, esc, hourOf } from '../util.js';
import { listeners } from '../sim/messages.js';
import * as LY from '../layout.js';

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
      <div class="st-meter"><i></i></div><div class="st-wish"></div><div class="st-quiz"></div><div class="st-hint"></div><div class="st-chat"></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.vEl = el.querySelector('.st-v');
    this.pkEl = el.querySelector('.st-pk');
    this.mEl = el.querySelector('.st-meter i');
    this.hEl = el.querySelector('.st-hint');
    this.wEl = el.querySelector('.st-wish');
    this.wishT = 25;
    this.qEl = el.querySelector('.st-quiz');
    this.quizT = 70;
    this.qEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (b) this.answer(b.dataset.q);
    });
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

  // Zuschauerwunsch: der Chat will etwas Bestimmtes sehen – wer es rechtzeitig ins Bild holt, gewinnt Zuschauer
  pickWish(s) {
    const map = s.acs.filter((a) => a.mode === 'map');
    const W = [];
    if (s.acs.some((a) => a.arr && (a.phase === PH.APPROACH || a.phase === PH.FINAL))) W.push({ k: 'land', t: 'Zeig mal eine Landung!', ok: (a) => a.phase === PH.ROLLOUT || (a.phase === PH.FINAL && a.z < 1) });
    if (s.acs.some((a) => [PH.TAXI_OUT, PH.HOLDING, PH.LINEUP, PH.LINED].includes(a.phase))) W.push({ k: 'dep', t: 'Ich will einen Start sehen! 🛫', ok: (a) => a.phase === PH.TAKEOFF });
    if (map.some((a) => a.phase === PH.STAND && a.ta && a.ta.tasks.push)) W.push({ k: 'push', t: 'Zeigt mal einen Pushback', ok: (a) => a.phase === PH.PUSH });
    const big = map.find((a) => a.type === 'A388' || a.protocol || a.special || AC_TYPES[a.type].size === 'L');
    if (big) W.push({ k: 'ac', id: big.id, t: big.type === 'A388' ? 'Wo ist der A380?? Zeig her! 🐋' : big.protocol ? 'Kamera auf die Regierungsmaschine!' : `Zoom mal auf ${big.cs}, den ${AC_TYPES[big.type].name}!`, ok: (a) => a.id === big.id, zoom: 1.1 });
    W.push({ k: 'tower', t: 'Zeig mal den Tower von nah', pt: (() => { const b = LY.BUILDINGS.find((x) => x.id === 'tower'); return { x: b.fx - b.w / 2, y: b.fy - b.d / 2 }; })(), zoom: 1.4 });
    if (s.heli && s.heli.h) W.push({ k: 'heli', t: 'Wo ist der Heli? 🚁', obj: () => s.heli.h, zoom: 1 });
    if (s.vfr && s.vfr.p) W.push({ k: 'vfr', t: 'Zeig die kleine Cessna! 🛩️', obj: () => s.vfr.p, zoom: 1 });
    if (!W.length) return null;
    const w = W[Math.floor(Math.random() * W.length)];
    return { ...w, left: 60, user: r(USERS), hold: 0 };
  }
  wishMet(s, w) {
    const cam = this.game.cam;
    const center = (x, y, z = 0) => {
      const p = cam.toScreen(x, y, z);
      return Math.abs(p.x - cam.w / 2) < cam.w * 0.3 && Math.abs(p.y - cam.h / 2) < cam.h * 0.3;
    };
    if (w.zoom && cam.zoom < w.zoom) return false;
    if (w.pt) return center(w.pt.x, w.pt.y, 1);
    if (w.obj) {
      const o = w.obj();
      return !!o && center(o.x, o.y, o.z);
    }
    return s.acs.some((a) => a.mode === 'map' && w.ok(a) && center(a.x, a.y, a.z || 0));
  }
  updateWish(s, dt) {
    if (!this.wish) {
      this.wishT -= dt;
      if (this.wishT <= 0) {
        this.wish = this.pickWish(s);
        this.wishT = 45 + Math.random() * 45;
        if (this.wish) this.say(this.wish.t, 3, this.wish.user);
      }
      this.wEl.innerHTML = '';
      return;
    }
    const w = this.wish;
    w.left -= dt;
    w.hold = this.wishMet(s, w) ? w.hold + dt : 0;
    if (w.hold > 1.5) {
      this.viewers *= 1.18;
      const L = s.life || (s.life = {});
      L.streamWishes = (L.streamWishes || 0) + 1;
      this.post({ sub: true, text: `✅ Wunsch von ${w.user} erfüllt – die Zuschauerzahl springt hoch!` });
      this.say(r(['Danke!! 🙏', 'Genau das wollte ich sehen 😍', 'Bester Kameramann', 'Wunsch erfüllt, Abo dagelassen ⭐']), 3);
      this.wish = null;
      this.wEl.innerHTML = '';
      return;
    }
    if (w.left <= 0) {
      this.viewers *= 0.95;
      this.say(r(['Schade 😕', 'Naja, dann halt nicht', 'Hallo? Kamera?']), 2);
      this.wish = null;
      this.wEl.innerHTML = '';
      return;
    }
    this.wEl.innerHTML = `<b>💬 Zuschauerwunsch</b> ${esc(w.t)}<i style="width:${Math.round((w.left / 60) * 100)}%"></i>`;
  }

  // Spotter-Quiz: Der Chat fragt nach dem Typ eines Flugzeugs nahe der Bildmitte; drei Antworten zur Wahl.
  // Richtig = Zuschauerschub, falsch = der Chat korrigiert. Zählt für den Erfolg „Typenkenner“.
  updateQuiz(s, dt, inView) {
    if (this.quiz) {
      const q = this.quiz;
      q.left -= dt;
      if (q.left <= 0) {
        this.say(`Das ist ${q.cs}, ein ${AC_TYPES[q.type].name} – zu spät 😄`, 3);
        this.endQuiz();
        return;
      }
      const bar = this.qEl.querySelector('i');
      if (bar) bar.style.width = `${Math.round((q.left / 25) * 100)}%`;
      return;
    }
    if (this.wish) return;
    this.quizT -= dt;
    if (this.quizT > 0) return;
    const cam = this.game.cam;
    if (cam.zoom < 1) return;
    const cands = inView.filter((a) => {
      const p = cam.toScreen(a.x, a.y, a.z || 0);
      return Math.abs(p.x - cam.w / 2) < cam.w * 0.3 && Math.abs(p.y - cam.h / 2) < cam.h * 0.3 && AC_TYPES[a.type];
    });
    if (!cands.length) return;
    const a = r(cands);
    const others = Object.keys(AC_TYPES).filter((k) => k !== a.type && !['C172'].includes(k));
    const same = others.filter((k) => AC_TYPES[k].size === AC_TYPES[a.type].size);
    const pool = same.length >= 2 ? same : others;
    const opts = [a.type];
    while (opts.length < 3 && pool.length) {
      const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      if (!opts.includes(k)) opts.push(k);
    }
    opts.sort(() => Math.random() - 0.5);
    this.quiz = { id: a.id, cs: a.cs, type: a.type, opts, left: 25, user: r(USERS) };
    this.say(`Welcher Typ ist ${a.cs}? 🤔`, 3, this.quiz.user);
    this.qEl.innerHTML = `<b>🔎 Spotter-Quiz</b> Welcher Typ ist <b>${esc(a.cs)}</b>?<div class="st-qo">${opts.map((k) => `<button data-q="${k}">${esc(AC_TYPES[k].name)}</button>`).join('')}</div><i></i>`;
  }
  answer(k) {
    const q = this.quiz;
    const s = this.game.state;
    if (!q || !s) return;
    if (k === q.type) {
      this.viewers *= 1.12;
      const L = s.life || (s.life = {});
      L.quizOk = (L.quizOk || 0) + 1;
      this.post({ sub: true, text: `✅ Richtig: ${AC_TYPES[q.type].name} – der Chat ist beeindruckt` });
      this.say(r(['Profi! 👏', 'Woher weißt du das so schnell?', 'Spotter-Level: Experte', 'Stimmt, sieht man an den Triebwerken']), 3);
    } else {
      this.viewers *= 0.97;
      this.say(`Nee, das ist ein ${AC_TYPES[q.type].name} 😅`, 3);
    }
    this.endQuiz();
  }
  endQuiz() {
    this.quiz = null;
    this.quizT = 80 + Math.random() * 60;
    this.qEl.innerHTML = '';
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
    const vv = s.vfr && s.vfr.p;
    if (vv) {
      const p = cam.toScreen(vv.x, vv.y, vv.z);
      if (p.x > 0 && p.y > 0 && p.x < W && p.y < H) {
        I += vv.z < 0.5 ? 1.6 : 0.7;
        if (this.vfrSeen !== vv.cs) {
          this.vfrSeen = vv.cs;
          this.say(r(['Kleine Cessna 😍', 'Flugschüler unterwegs, viel Erfolg!', 'Touch and Go, love it', 'Die kleine zwischen den Großen 😄']), 1);
        }
      }
    }
    const hh = s.heli && s.heli.h;
    if (hh) {
      const p = cam.toScreen(hh.x, hh.y, hh.z);
      if (p.x > 0 && p.y > 0 && p.x < W && p.y < H) {
        I += 2;
        if (this.heliSeen !== s.heli.n) {
          this.heliSeen = s.heli.n;
          this.say(r(['Heli! 🚁', 'Rettungshubschrauber, gute Besserung an den Patienten 🙏', 'Der Sound vom Rotor 🚁🔊', 'Ab in die Klinik, schnell 🚑']), 2);
        }
      }
    }
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
    this.updateWish(s, dt);
    this.updateQuiz(s, dt, inView);
    // neue Szenen im Bild
    for (const ac of inView) {
      if (ac.emgKind === 'smoke' && ac.fireStop && !ac.fireDone && this.evacSeen !== ac.id) {
        this.evacSeen = ac.id;
        this.say(r(['NOTRUTSCHEN!! 😱', 'Evakuierung, alle raus 🛟', 'Hoffentlich sind alle okay 🙏', 'Die Feuerwehr ist schon da 🚒']), 3);
      }
      if ((ac.emgKind === 'medical' || ac.medical) && ac.phase === PH.STAND && this.medSeen !== ac.id) {
        this.medSeen = ac.id;
        this.say(r(['Rettungswagen am Gate 🚑', 'Gute Besserung an den Passagier 🙏', 'Sanitäter mit Trage, hoffentlich ist es nichts Schlimmes', 'Respekt an die Crew 👏🚑']), 2);
      }
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
    // Regenbogen nach dem Schauer
    const mp = this.game.map;
    if (mp && mp.rainbowOn && this.rainbowSeen !== mp.rainbowT) {
      this.rainbowSeen = mp.rainbowT;
      this.say(r(['REGENBOGEN 🌈', 'Wie schön ist das denn 🌈😍', 'Screenshot!! 🌈', 'Nach dem Regen kommt der Regenbogen 🌈']), 3);
    }
    // Wassertaufe im Bild
    const sal = s.salute;
    if (sal && sal.p && !sal.chat) {
      const p = this.game.cam.toScreen(sal.p.x, sal.p.y, 0);
      if (p.x > 0 && p.y > 0 && p.x < this.game.cam.w && p.y < this.game.cam.h) {
        sal.chat = true;
        this.say(r(['Wassertaufe!! 💦', 'Erstflug mit Wasserbogen 😍', 'Die Feuerwehr gibt alles 💦🚒', 'Gänsehaut, Erstflug!']), 3);
      }
    }
    // Hasen im Bild (nah herangezoomt)
    const wl = this.game.map && this.game.map.wildlife;
    if (wl && wl.hares && this.game.cam.zoom > 1.3 && performance.now() - (this.hareT || 0) > 60000) {
      const cam = this.game.cam;
      const seenHare = wl.hares.some((h) => {
        const p = cam.toScreen(h.x, h.y, 0);
        return p.x > 0 && p.y > 0 && p.x < cam.w && p.y < cam.h;
      });
      if (seenHare) {
        this.hareT = performance.now();
        this.say(r(['Ein Hase!! 🐇', 'Da hoppelt was 🐇', 'Der Hase ist der wahre Star hier', 'Hasen-Cam bitte 🐇🐇']), 2);
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
