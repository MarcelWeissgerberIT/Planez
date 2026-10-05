// Minikarte: bei Bedarf einblendbares Abbild des Flughafens in Dunkelgrau, isometrisch wie die Karte, oben in der
// rechten Spalte. Punkte zeigen Flugzeuge (blau an der Position, Ring in der Luft, grün beim Rollen, rot auf der Bahn)
// und Fahrzeuge (gelb); der helle Rahmen ist der aktuelle Kartenausschnitt. Klicken oder Ziehen springt dorthin.
// Genutzt im Hauptspiel (alle Rollen) und an den Großflughäfen; die Zeichnung des Flughafens kommt je Modus von außen.
import { T } from '../i18n.js';

export const MM_COL = { stand: '#3b82f6', taxi: '#22c55e', rwy: '#ef4444', veh: '#facc15', air: '#93c5fd' };
// Grautöne des Abbilds
export const MM_GRAY = { bg: '#14171c', field: '#1e2329', land: '#252a31', apron: '#39404a', twy: '#4b535e', rwy: '#8a939e', grassRwy: '#56634c', bld: '#5b6470', term: '#6b7787', mark: '#4e5662' };

const KEY = 'planez_minimap2';
// nur bei Bedarf: standardmäßig aus, der Kartenknopf blendet sie ein (die Wahl bleibt gespeichert)
export function minimapOn() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch (e) {
    return false;
  }
}
function saveOn(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch (e) {}
}

export class Minimap {
  // opts: el (Container), cam (Kamera mit toWorld, w, h), bounds() -> Weltrechteck, paint(g, k, state) zeichnet in
  // Weltkoordinaten (Transform ist gesetzt, k = Pixel je Kachel), key() -> Schlüssel fürs Neuzeichnen des Abbilds,
  // dots() -> [{ x, y, c }], jump(x, y), legend: Schlüssel aus MM_COL für die Legende
  constructor(opts) {
    this.o = opts;
    this.el = opts.el;
    this.el.classList.add('minimap');
    this.el.innerHTML = `<div class="mmap-h"><span>${T('Übersicht')}</span><button class="mmap-x" type="button" title="${T('Minikarte ausblenden (Umschalt+K)')}" aria-label="${T('Minikarte ausblenden')}">✕</button></div><canvas></canvas><div class="mmap-leg">${(opts.legend || ['stand', 'taxi', 'rwy', 'veh'])
      .map((k) => `<span><i style="background:${MM_COL[k]}"></i>${{ stand: T('Position'), taxi: T('rollt'), rwy: T('Bahn'), veh: T('Fahrzeug'), air: T('Luft') }[k]}</span>`)
      .join('')}</div>`;
    this.cv = this.el.querySelector('canvas');
    this.g = this.cv.getContext('2d');
    this.base = document.createElement('canvas');
    this.baseKey = '';
    this.t = 0;
    this.on = minimapOn();
    this.el.classList.toggle('hidden', !this.on);
    this.el.querySelector('.mmap-x').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle(false);
    });
    // Klicken und Ziehen: Kamera springt mit
    let drag = false;
    const go = (e) => {
      const r = this.cv.getBoundingClientRect();
      const w = this.fromMini(e.clientX - r.left, e.clientY - r.top);
      if (w) this.o.jump(w.x, w.y);
      this.t = 0; // sofort neu zeichnen
    };
    this.cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drag = true;
      try {
        this.cv.setPointerCapture(e.pointerId);
      } catch (err) {}
      go(e);
    });
    this.cv.addEventListener('pointermove', (e) => {
      if (drag) go(e);
    });
    const end = () => (drag = false);
    this.cv.addEventListener('pointerup', end);
    this.cv.addEventListener('pointercancel', end);
    // Mausrad und Klicks nicht an die Karte darunter weitergeben
    for (const ev of ['wheel', 'click', 'dblclick', 'contextmenu', 'mousedown', 'touchstart']) this.el.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev !== 'wheel' && ev !== 'contextmenu' });
    this.el.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  toggle(on = !this.on) {
    this.on = on;
    saveOn(on);
    this.el.classList.toggle('hidden', !on && !this.forced);
    this.t = 0;
    if (this.o.onToggle) this.o.onToggle(on);
    return on;
  }
  // zeitweise immer sichtbar (Tower-Arbeitsplatz), ohne die gespeicherte Wahl zu ändern
  force(f) {
    this.forced = f;
    this.el.classList.toggle('hidden', !this.on && !f);
    this.t = 0;
  }
  // Abbildung Welt -> Minikarte: wie die isometrische Karte (x nach rechts unten, y nach links unten)
  layout() {
    // Ausdehnung in der isometrischen Ansicht: aus den Punkten des Abbilds (eng) oder den Ecken des Weltrechtecks
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const grow = (x, y) => {
      const u = x - y, v = (x + y) / 2;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    };
    if (this.o.points) {
      if (!this.pts) this.pts = this.o.points();
      for (const p of this.pts) grow(p.x, p.y);
      const mu = (u1 - u0) * 0.05, mv = (v1 - v0) * 0.07;
      u0 -= mu;
      u1 += mu;
      v0 -= mv;
      v1 += mv;
    } else {
      const b = this.o.bounds();
      grow(b.x0, b.y0);
      grow(b.x1, b.y0);
      grow(b.x1, b.y1);
      grow(b.x0, b.y1);
    }
    const cs2 = getComputedStyle(this.el);
    const W = Math.max(80, (this.el.clientWidth || 238) - parseFloat(cs2.paddingLeft || 0) - parseFloat(cs2.paddingRight || 0));
    // Höhe begrenzen (am Handy über --mm-max-h kleiner), damit unter der Minikarte genug Spalte bleibt
    const maxH = parseFloat(cs2.getPropertyValue('--mm-max-h')) || W * 0.62;
    const k = Math.min(W / (u1 - u0), maxH / (v1 - v0));
    const w = Math.round((u1 - u0) * k), h = Math.round((v1 - v0) * k);
    return { k, u0, v0, w, h, key: `${w}x${h}|${u0}|${v0}` };
  }
  toMini(x, y) {
    const L = this.L;
    return { x: (x - y - L.u0) * L.k, y: ((x + y) / 2 - L.v0) * L.k };
  }
  fromMini(px, py) {
    const L = this.L;
    if (!L) return null;
    const u = px / L.k + L.u0, v = py / L.k + L.v0;
    return { x: v + u / 2, y: v - u / 2 };
  }
  // Weltkoordinaten-Transform für die Zeichnung (mit Geräte-Pixelverhältnis)
  setWorld(g, dpr) {
    const L = this.L;
    g.setTransform(L.k * dpr, (L.k / 2) * dpr, -L.k * dpr, (L.k / 2) * dpr, -L.u0 * L.k * dpr, -L.v0 * L.k * dpr);
  }
  update(dt) {
    if (!this.on && !this.forced) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.08; // gut 12 Bilder je Sekunde reichen für die Punkte
    // neuer Ausbau (andere Ausdehnung des Abbilds): Rahmen neu bestimmen
    const ck = this.o.key ? this.o.key() : '';
    if (ck !== this.ck) {
      this.ck = ck;
      this.pts = null;
    }
    const L = this.layout();
    this.L = L;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.cv.width !== Math.round(L.w * dpr) || this.cv.height !== Math.round(L.h * dpr)) {
      this.cv.width = Math.round(L.w * dpr);
      this.cv.height = Math.round(L.h * dpr);
      this.cv.style.width = L.w + 'px';
      this.cv.style.height = L.h + 'px';
    }
    // Abbild nur neu zeichnen, wenn sich Größe oder Ausbau ändern
    const key = L.key + '|' + dpr + '|' + ck;
    if (key !== this.baseKey) {
      this.baseKey = key;
      this.base.width = this.cv.width;
      this.base.height = this.cv.height;
      const b = this.base.getContext('2d');
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.fillStyle = MM_GRAY.bg;
      b.fillRect(0, 0, this.base.width, this.base.height);
      this.setWorld(b, dpr);
      b.lineCap = 'round';
      b.lineJoin = 'round';
      this.o.paint(b, L.k);
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Punkte: in der Luft als Ring, am Boden gefüllt; Bahn zuletzt (oben)
    const dots = this.o.dots();
    const order = { veh: 0, stand: 1, air: 2, taxi: 3, rwy: 4 };
    dots.sort((a, b) => order[a.c] - order[b.c]);
    const r = L.w < 180 ? 1.7 : L.w < 300 ? 2.2 : 2.7;
    for (const d of dots) {
      const p = this.toMini(d.x, d.y);
      if (p.x < -4 || p.y < -4 || p.x > L.w + 4 || p.y > L.h + 4) continue;
      g.globalAlpha = d.dim ? 0.45 : 1;
      if (d.c === 'air') {
        g.strokeStyle = MM_COL.air;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.stroke();
        continue;
      }
      g.fillStyle = MM_COL[d.c] || MM_COL.stand;
      if (d.c === 'veh') g.fillRect(p.x - r * 0.7, p.y - r * 0.7, r * 1.4, r * 1.4);
      else {
        g.beginPath();
        g.arc(p.x, p.y, d.c === 'stand' ? r * 0.9 : r, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    // Kartenausschnitt
    const cam = this.o.cam();
    if (cam && cam.w) {
      const a = cam.toWorld(0, 0), c = cam.toWorld(cam.w, cam.h);
      const p = this.toMini(a.x, a.y), q = this.toMini(c.x, c.y);
      const x0 = Math.max(0.5, p.x), y0 = Math.max(0.5, p.y), x1 = Math.min(L.w - 0.5, q.x), y1 = Math.min(L.h - 0.5, q.y);
      if (x1 > x0 && y1 > y0) {
        g.strokeStyle = 'rgba(255,255,255,.85)';
        g.lineWidth = 1.2;
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        g.fillStyle = 'rgba(255,255,255,.05)';
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }
}

// Linie in Weltkoordinaten mit Mindestbreite in Pixeln
export function mmLine(g, pts, wWorld, k, minPx = 1.2) {
  g.lineWidth = Math.max(wWorld, minPx / k);
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.stroke();
}
export function mmPoly(g, poly) {
  g.beginPath();
  poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fill();
}
