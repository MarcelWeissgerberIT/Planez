// Wiederholung: Die letzten Sekunden am Boden und im Endanflug werden laufend mitgeschnitten (Flugzeuge und
// Fahrzeuge, 20 Bilder pro Sekunde). Umschalt+R oder der Knopf nach einem besonderen Moment (Durchstarten,
// Notlandung, harte Landung, Butterlandung) spielt sie in Zeitlupe ab – mit Letterbox und „Wiederholung“-Einblendung.
// Während der Wiederholung ruht die Simulation; Esc oder ein Klick beendet sie.
import { PH } from '../sim/aircraft.js';
import { esc } from '../util.js';

const HZ = 20, KEEP = 14; // Sekunden
const SLOW = 0.55;

export class Replay {
  constructor(game) {
    this.game = game;
    this.buf = [];
    this.acc = 0;
    this.on = false;
    this.prev = new Map();
    const el = document.createElement('div');
    el.id = 'replay';
    el.className = 'hidden';
    el.innerHTML = `<div class="rp-bar top"></div><div class="rp-bar bot"></div><div class="rp-badge"><b>⏪ WIEDERHOLUNG</b><span></span></div><div class="rp-prog"><i></i></div><div class="rp-help">Esc oder Klick beendet</div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.sub = el.querySelector('.rp-badge span');
    this.progEl = el.querySelector('.rp-prog i');
    el.addEventListener('click', () => this.stop());
    const offer = document.createElement('button');
    offer.id = 'replay-offer';
    offer.className = 'hidden';
    document.getElementById('game').appendChild(offer);
    offer.addEventListener('click', () => this.play(this.offerAc, this.offerText));
    this.offerEl = offer;
  }

  // jeden Frame: mitschneiden und besondere Momente erkennen
  record(s, dt) {
    if (this.on || !s.speed) return;
    this.acc += dt;
    if (this.acc >= 1 / HZ) {
      this.acc = 0;
      this.buf.push({ t: s.time, acs: s.acs.filter((a) => a.mode === 'map').map((a) => ({ ...a })), veh: s.vehicles.map((v) => ({ ...v })) });
      if (this.buf.length > HZ * KEEP) this.buf.shift();
    }
    for (const ac of s.acs) {
      if (ac.mode !== 'map') continue;
      const p = this.prev.get(ac.id);
      this.prev.set(ac.id, ac.phase);
      if (!p || p === ac.phase) continue;
      if (ac.phase === PH.MISSED) this.offer(ac, `Durchstarten ${ac.cs}`);
      else if (p === PH.FINAL && ac.phase === PH.ROLLOUT) {
        if (ac.emergency) this.offer(ac, `Notlandung ${ac.cs}`);
        else if (ac.tdFpm >= 600) this.offer(ac, `Harte Landung ${ac.cs} · ${ac.tdFpm} ft/min`);
        else if (ac.tdFpm && ac.tdFpm < 90) this.offer(ac, `Butterlandung ${ac.cs} · ${ac.tdFpm} ft/min`);
        else if (ac.type === 'A388' || ac.protocol) this.offer(ac, `Landung ${ac.cs}`);
      }
    }
    if (this.prev.size > 300) this.prev.clear();
    if (this.offerUntil && performance.now() > this.offerUntil) {
      this.offerUntil = 0;
      this.offerEl.classList.add('hidden');
    }
  }

  offer(ac, text) {
    const g = this.game;
    if ((g.cinema && g.cinema.on) || (g.photo && g.photo.on)) return;
    this.offerAc = ac.id;
    this.offerText = text;
    this.offerEl.innerHTML = `⏪ <b>Wiederholung</b> ${esc(text)} <kbd>⇧R</kbd>`;
    this.offerEl.classList.remove('hidden');
    this.offerUntil = performance.now() + 9000;
  }

  play(acId = null, text = '') {
    const s = this.game.state;
    if (!s || this.buf.length < HZ * 2 || this.on) return;
    this.on = true;
    this.frames = this.buf.slice();
    this.i = 0;
    this.follow = acId;
    // beim verfolgten Flugzeug dort einsetzen, wo es ins Bild kommt (eine Sekunde vorher)
    if (acId) {
      const first = this.frames.findIndex((f) => f.acs.some((a) => a.id === acId));
      if (first > 0) this.i = Math.max(0, first - HZ);
      const f = this.frames[Math.max(0, first)];
      const a = f && f.acs.find((x) => x.id === acId);
      if (a) Object.assign(this.game.cam, { x: a.x, y: a.y - a.z * 0.4, tx: null });
    }
    this.speedBefore = s.speed;
    s.speed = 0;
    this.labels = this.game.ui.labels;
    this.game.ui.labels = false;
    this.sub.textContent = text || 'Die letzten Sekunden';
    this.el.classList.remove('hidden');
    this.offerEl.classList.add('hidden');
    this.offerUntil = 0;
    document.getElementById('game').classList.add('replaying');
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    const s = this.game.state;
    if (s) s.speed = this.speedBefore || 1;
    this.game.ui.labels = this.labels !== false;
    this.el.classList.add('hidden');
    document.getElementById('game').classList.remove('replaying');
    this.frames = null;
  }

  // Zustand für das aktuelle Wiedergabebild (nur fürs Zeichnen; die Simulation bleibt unberührt)
  view(s, dt) {
    if (!this.on) return s;
    this.i += dt * HZ * SLOW;
    const f = this.frames[Math.min(this.frames.length - 1, Math.floor(this.i))];
    this.progEl.style.width = `${Math.min(100, (this.i / this.frames.length) * 100)}%`;
    if (this.i >= this.frames.length) {
      this.stop();
      return s;
    }
    if (this.follow) {
      const a = f.acs.find((x) => x.id === this.follow);
      const cam = this.game.cam;
      if (a) {
        const k = Math.min(1, dt * 2.5);
        cam.x += (a.x + Math.cos(a.hdg) * 1.2 - cam.x) * k;
        cam.y += (a.y + Math.sin(a.hdg) * 1.2 - a.z * 0.4 - cam.y) * k;
        cam.zoom += (1.7 - cam.zoom) * Math.min(1, dt);
        cam.tx = null;
      }
    }
    return { ...s, acs: f.acs, vehicles: f.veh, time: f.t };
  }
}
