// Fotomodus: Oberfläche aus, freie Kamera, Filter, Bild speichern (PNG)
import { dayOf, fmtClock } from '../util.js';
import { toast } from './dom.js';

const FILTERS = [
  ['none', 'Natur', 'none'],
  ['warm', 'Golden', 'sepia(0.25) saturate(1.35) brightness(1.05) contrast(1.05)'],
  ['cool', 'Kühl', 'hue-rotate(-12deg) saturate(1.1) brightness(1.03)'],
  ['bw', 'Schwarzweiß', 'grayscale(1) contrast(1.15)'],
  ['film', 'Film', 'sepia(0.35) contrast(1.2) saturate(0.85) brightness(0.95)'],
  ['vivid', 'Lebendig', 'saturate(1.6) contrast(1.1)'],
];

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.f = 'none';
    const el = document.createElement('div');
    el.id = 'photo';
    el.className = 'hidden';
    el.innerHTML = `<div class="ph-frame"></div>
      <div class="ph-bar">
        <span class="ph-k">📷 Fotomodus</span>
        <div class="ph-f">${FILTERS.map(([k, n]) => `<button data-pf="${k}">${n}</button>`).join('')}</div>
        <button class="ph-t" data-pt="freeze" title="Zeit anhalten">⏸ Zeit anhalten</button>
        <button class="ph-t" data-pt="labels" title="Beschriftungen">🏷️ Beschriftungen</button>
        <button class="ph-shot" data-pt="shot">● Aufnehmen</button>
        <button class="ph-x" data-pt="close" title="Beenden (Esc)">✕</button>
      </div>
      <div class="ph-flash"></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => {
      const f = e.target.closest('[data-pf]');
      if (f) return this.setFilter(f.dataset.pf);
      const t = e.target.closest('[data-pt]');
      if (!t) return;
      const k = t.dataset.pt;
      if (k === 'close') this.stop();
      else if (k === 'shot') this.shot();
      else if (k === 'freeze') {
        const s = this.game.state;
        if (s.speed) {
          this.resumeSpeed = s.speed;
          s.speed = 0;
        } else s.speed = this.resumeSpeed || 1;
        this.sync();
      } else if (k === 'labels') {
        this.game.ui.labels = !this.game.ui.labels;
        this.sync();
      }
    });
  }
  toggle() {
    this.on ? this.stop() : this.start();
  }
  start() {
    if (!this.game.state) return;
    this.on = true;
    this.prevLabels = this.game.ui.labels;
    this.game.ui.labels = false;
    document.getElementById('game').classList.add('photo');
    this.el.classList.remove('hidden');
    this.setFilter(this.f);
    this.sync();
  }
  stop() {
    if (!this.on) return;
    this.on = false;
    this.game.ui.labels = this.prevLabels !== false;
    document.getElementById('game').classList.remove('photo');
    this.el.classList.add('hidden');
    document.getElementById('map').style.filter = '';
    const s = this.game.state;
    if (s && !s.speed && this.resumeSpeed) s.speed = this.resumeSpeed;
    this.resumeSpeed = 0;
  }
  setFilter(k) {
    this.f = k;
    const f = FILTERS.find((x) => x[0] === k) || FILTERS[0];
    document.getElementById('map').style.filter = f[2] === 'none' ? '' : f[2];
    for (const b of this.el.querySelectorAll('[data-pf]')) b.classList.toggle('on', b.dataset.pf === k);
  }
  sync() {
    const s = this.game.state;
    this.el.querySelector('[data-pt=freeze]').classList.toggle('on', !!s && !s.speed);
    this.el.querySelector('[data-pt=labels]').classList.toggle('on', !!this.game.ui.labels);
  }
  shot() {
    const src = document.getElementById('map');
    const s = this.game.state;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    const f = FILTERS.find((x) => x[0] === this.f) || FILTERS[0];
    if (f[2] !== 'none') g.filter = f[2];
    g.drawImage(src, 0, 0);
    g.filter = 'none';
    // Wasserzeichen
    const sc = c.width / 1600;
    g.font = `800 ${Math.round(22 * sc)}px Orbitron, sans-serif`;
    g.textAlign = 'right';
    g.fillStyle = 'rgba(0,0,0,0.45)';
    const txt = `PLANEZ · ${s.name} · Tag ${dayOf(s.time)} · ${fmtClock(s.time)}`;
    g.fillText(txt, c.width - 22 * sc + 2, c.height - 22 * sc + 2);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(txt, c.width - 22 * sc, c.height - 22 * sc);
    const a = document.createElement('a');
    a.download = `planez-${s.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-tag${dayOf(s.time)}-${fmtClock(s.time).replace(':', '')}.png`;
    try {
      a.href = c.toDataURL('image/png');
      a.click();
    } catch (e) {
      toast('Bild konnte nicht gespeichert werden', 'warn');
      return;
    }
    const fl = this.el.querySelector('.ph-flash');
    fl.classList.remove('go');
    void fl.offsetWidth;
    fl.classList.add('go');
    toast('📷 Foto gespeichert', 'good', 1800);
  }
}
