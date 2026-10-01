// Echte 3D-Ansicht (WebGL, three.js) für das Mitfliegen: Der Flughafen als 3D-Szene – Gras, Start- und Landebahnen
// mit Markierungen, Kennziffern und Befeuerung (Rand-, Mittellinien-, Schwellen- und Endfeuer, Anflugbefeuerung mit
// Lauffeuer, PAPI-Gleitwinkelanzeige, die je nach Höhe der Kamera rot/weiß zeigt), Rollwege mit blauen Randfeuern,
// Vorfeld mit Flutlichtmasten, Terminal, Tower mit Flughafen-Drehfeuer, Windsack, Umland mit Stadt und Straßenverkehr –,
// darauf alle Flugzeuge als detaillierte Modelle in Airline-Lackierung (siehe model3d.js) mit Positions-, Blitz- und
// Landelichtern und die Bodenfahrzeuge. Himmel und Sonne folgen der Tageszeit (Morgen- und Abendrot, Sterne nachts),
// Schatten, Wetter mit Regen, Schnee, Gewitterblitzen und Nebel, Reifenrauch beim Aufsetzen und Gischt auf nasser Bahn.
// Die Kamera hängt am gewählten Flugzeug: Cockpit, Fensterplatz (beide neigen sich mit dem Flugzeug) oder außen (frei
// um das Flugzeug kreisen). 1 Einheit = 1 Kachel (20 m), y = Höhe. Nur Darstellung – kein Einfluss auf die Simulation.
import * as THREE from '../vendor/three.module.min.js';
import * as LY from '../layout.js';
import { PH } from '../sim/aircraft.js';
import { NM_PER_TILE } from '../config.js';
import { Q } from './quality.js';
import { buildAircraft, buildVehicle, buildCessna, buildHeli, glowTex, spriteMat, setNight } from './model3d.js';

const ALT_CLIMB = 2.0; // Spielhöhe z -> Kacheln für Steigflug/Durchstarten auf der Karte (≈ 12° statt 40° Bahnneigung)
const FT = 0.3048 / 20; // Fuß -> Kacheln
const DEG = Math.PI / 180;
const FT_PER_TILE = 318 * NM_PER_TILE; // 3°-Gleitpfad: Fuß Höhe je Kachel Abstand
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ON_RWY = new Set([PH.TAKEOFF, PH.ROLLOUT, PH.LINED, PH.LINEUP, PH.FINAL, PH.MISSED]);

// Himmelskuppel: Verlauf Zenit -> Horizont, Sonnenscheibe und Lichthof
const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `uniform vec3 top; uniform vec3 hor; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunK; uniform float glowK;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = h > 0.0 ? mix(hor, top, pow(min(1.0, h * 1.6), 0.55)) : mix(hor, bot, min(1.0, -h * 5.0));
  float s = max(0.0, dot(d, sunDir));
  c += sunCol * (pow(s, 900.0) * 3.0 * sunK + pow(s, 12.0) * 0.45 * glowK + pow(s, 3.0) * 0.18 * glowK);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const C = (h) => new THREE.Color(h);
const SKY = {
  day: { top: C(0x2f6fc0), hor: C(0xbcd4e8) },
  dusk: { top: C(0x34497f), hor: C(0xf0a066) },
  night: { top: C(0x03060f), hor: C(0x0f182b) },
  murkDay: C(0x9aa3ad),
  murkNight: C(0x151a22),
};

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// fest gesäter Zufall (nur Darstellung, nicht der Spiel-Zufall)
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export class View3D {
  static supported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) {
      return false;
    }
  }

  constructor(game) {
    this.game = game;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(Q.perf ? 1 : 2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = !Q.perf;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.id = 'view3d';
    r.domElement.className = 'hidden';
    document.getElementById('game').appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.03, 9000);
    this.scene.fog = new THREE.Fog(0xcfdbe2, 60, 420);
    this.hemi = new THREE.HemisphereLight(0xdbeafe, 0x4d5d2a, 1.1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    const sh = this.sun.shadow;
    sh.mapSize.set(2048, 2048);
    Object.assign(sh.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 420 });
    sh.bias = -0.0004;
    sh.normalBias = 0.02;
    this.sun.castShadow = !Q.perf;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    // Scheinwerferkegel des eigenen Flugzeugs auf dem Boden (nachts)
    this.spot = new THREE.SpotLight(0xfff1d6, 0, 26, 0.32, 0.6, 1.2);
    this.scene.add(this.spot, this.spot.target);
    this.sky();
    this.mats = new Map();
    this.acs = new Map();
    this.vehs = new Map();
    this.vis = new Map(); // je Flugzeug: geglättete Höhe, Neigung, Querlage, letzte Phase
    this.refs = new WeakMap(); // je Flugzeugmodell: Verweise auf Fahrwerk, Lichter, Propeller …
    this.puffs = [];
    this.built = false;
    this.rwy2 = false;
    this.flash = 0;
    this.lastT = performance.now() / 1000;
    window.addEventListener('resize', () => this.resize());
  }

  mat(color, opts = {}) {
    const k = color + JSON.stringify(opts);
    if (!this.mats.has(k)) this.mats.set(k, new THREE.MeshLambertMaterial({ color, ...opts }));
    return this.mats.get(k);
  }

  show() {
    this.renderer.domElement.classList.remove('hidden');
    this.resize();
  }
  hide() {
    this.renderer.domElement.classList.add('hidden');
  }
  resize() {
    const el = document.getElementById('game');
    const w = el.clientWidth, h = el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ---------- Himmel ----------
  sky() {
    this.skyU = {
      top: { value: SKY.day.top.clone() }, hor: { value: SKY.day.hor.clone() }, bot: { value: C(0x55603f) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: C(0xfff1d0) }, sunK: { value: 1 }, glowK: { value: 1 },
    };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4800, 32, 16), new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false }));
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.dome = dome;
    // Sterne
    const r = rng(777);
    const pts = [];
    for (let i = 0; i < 1600; i++) {
      const a = r() * Math.PI * 2, h = Math.pow(r(), 0.7) * 0.98 + 0.02;
      const rr = Math.sqrt(1 - h * h);
      pts.push(Math.cos(a) * rr * 4500, h * 4500, Math.sin(a) * rr * 4500);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    // Mond
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xe8eefc, fog: false, depthWrite: false, transparent: true }));
    this.moon.scale.setScalar(160);
    this.moon.renderOrder = -8;
    this.scene.add(dome, this.stars, this.moon);
  }

  // ---------- statische Szene ----------
  box(x0, x1, y0, y1, h, color, yBase = 0, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, y1 - y0), typeof color === 'object' ? color : this.mat(color));
    m.position.set((x0 + x1) / 2, yBase + h / 2, (y0 + y1) / 2);
    m.castShadow = cast;
    m.receiveShadow = true;
    this.static.add(m);
    return m;
  }
  // Gebäude mit Fassade: Textur je Seite auf die Wandmaße skaliert (eine Kachel Textur = 2 × 1 Kacheln), Dach extra;
  // die Leuchttextur lässt nachts Fenster leuchten
  bldg(x0, x1, y0, y1, h, kind, roofColor) {
    const T = this.textures().F;
    const geo = new THREE.BoxGeometry(x1 - x0, h, y1 - y0);
    const uv = geo.attributes.uv;
    const W = x1 - x0, D = y1 - y0;
    for (let f = 0; f < 6; f++) {
      const fw = f < 2 ? D : W, fh = f === 2 || f === 3 ? D : h;
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, (uv.getX(k) * fw) / 2, uv.getY(k) * (f === 2 || f === 3 ? fh / 2 : fh));
      }
    }
    if (!this.bmats) this.bmats = new Map();
    const key = kind;
    if (!this.bmats.has(key)) {
      const lit = T[kind + 'Lit'];
      const m = new THREE.MeshLambertMaterial({ map: T[kind], emissiveMap: lit || null, emissive: lit ? 0xffffff : 0x000000, emissiveIntensity: 0 });
      this.bmats.set(key, m);
    }
    const roof = new THREE.MeshLambertMaterial({ map: T.roof, color: roofColor || 0xffffff });
    const side = this.bmats.get(key);
    const m = new THREE.Mesh(geo, [side, side, roof, roof, side, side]);
    m.position.set((x0 + x1) / 2, h / 2, (y0 + y1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    this.static.add(m);
    return m;
  }

  // flache Fläche; mit uvK wird die Textur je uvK Kacheln wiederholt
  flat(x0, x1, y0, y1, color, lift = 0.005, uvK = 0) {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    if (uvK) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / uvK, (uv.getY(i) * (y1 - y0)) / uvK);
    }
    const m = new THREE.Mesh(g, typeof color === 'object' ? color : this.mat(color));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, lift, (y0 + y1) / 2);
    m.receiveShadow = true;
    this.static.add(m);
    return m;
  }
  // Lichterkette als Punkte (nachts sichtbar)
  lights(pts, color, size = 0.32) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.static.add(p);
    this.nightLights.push(p);
    return p;
  }

  textures() {
    if (this.tex) return this.tex;
    const noise = (g, w, h, base, spread, n, a = 0.18) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      const r = rng(n);
      for (let i = 0; i < w * h * 0.25; i++) {
        const v = Math.floor((r() - 0.5) * spread);
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255 * a * 4})`;
        g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1 + Math.floor(r() * 2), 1);
      }
    };
    const grass = canvasTex(256, 256, (g, w, h) => {
      noise(g, w, h, '#6f8f3c', 90, 11, 0.22);
      const r = rng(5);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(${r() > 0.5 ? '90,120,45' : '125,150,70'},0.25)`;
        g.beginPath();
        g.ellipse(r() * w, r() * h, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    });
    const asphalt = canvasTex(256, 256, (g, w, h) => noise(g, w, h, '#3b3e43', 70, 21, 0.25));
    const apron = canvasTex(256, 256, (g, w, h) => {
      noise(g, w, h, '#b4b8bb', 50, 31, 0.15);
      g.strokeStyle = 'rgba(80,80,80,0.25)';
      g.lineWidth = 1;
      for (let i = 0; i <= 256; i += 64) (g.beginPath(), g.moveTo(i, 0), g.lineTo(i, 256), g.stroke(), g.beginPath(), g.moveTo(0, i), g.lineTo(256, i), g.stroke());
    });
    // Reifenabrieb in den Aufsetzzonen
    const skid = canvasTex(256, 64, (g, w, h) => {
      const r = rng(41);
      for (let i = 0; i < 120; i++) {
        const y = h / 2 + (r() - 0.5) * h * 0.7, x = r() * w * 0.7;
        g.strokeStyle = `rgba(20,20,22,${0.05 + r() * 0.12})`;
        g.lineWidth = 1 + r() * 2.5;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 30 + r() * 120, y + (r() - 0.5) * 6);
        g.stroke();
      }
    }, false);
    const facade = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#4f7da6';
      g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.25)');
      gr.addColorStop(1, 'rgba(0,20,40,0.25)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#cbd5e1';
      for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
      g.fillRect(0, 30, w, 2);
    });
    const town = canvasTex(64, 64, (g) => {
      g.fillStyle = '#d6d0c6';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#4b5563';
      for (let y = 6; y < 60; y += 12) for (let x = 5; x < 60; x += 11) g.fillRect(x, y, 6, 6);
    });
    const townLit = canvasTex(64, 64, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 64, 64);
      const r = rng(9);
      for (let y = 6; y < 60; y += 12) for (let x = 5; x < 60; x += 11) if (r() < 0.45) (g.fillStyle = r() < 0.7 ? '#ffcf7a' : '#fff1c9', g.fillRect(x, y, 6, 6));
    });
    // Fassaden je Gebäudeart: eine Textur deckt 2 Kacheln Breite × 1 Kachel Höhe; Leuchttextur für Fenster bei Nacht
    const fac = (base, draw) => canvasTex(128, 64, (g, w, h) => ((g.fillStyle = base), g.fillRect(0, 0, w, h), draw(g, w, h)));
    const winGrid = (g, col, fw, fh, gx, gy, x0 = 4, y0 = 4) => {
      g.fillStyle = col;
      for (let y = y0; y < 64 - fh; y += gy) for (let x = x0; x < 128 - fw; x += gx) g.fillRect(x, y, fw, fh);
    };
    const lit = (fw, fh, gx, gy, p, seed, x0 = 4, y0 = 4) => canvasTex(128, 64, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 128, 64);
      const r = rng(seed);
      for (let y = y0; y < 64 - fh; y += gy) for (let x = x0; x < 128 - fw; x += gx) if (r() < p) (g.fillStyle = r() < 0.75 ? '#ffd28a' : '#fff4d6', g.fillRect(x, y, fw, fh));
    });
    const F = {
      hotel: fac('#e7e1d6', (g) => winGrid(g, '#3b4b5f', 6, 6, 10, 11)),
      hotelLit: lit(6, 6, 10, 11, 0.55, 3),
      parking: fac('#b9b6b0', (g) => {
        for (let y = 6; y < 64; y += 16) (g.fillStyle = '#2b2f36', g.fillRect(0, y, 128, 7));
        g.fillStyle = '#9b978f';
        for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 2, 64);
      }),
      parkingLit: canvasTex(128, 64, (g) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, 128, 64);
        for (let y = 6; y < 64; y += 16) (g.fillStyle = '#6b6450', g.fillRect(0, y, 128, 7));
      }),
      metal: fac('#a7b0ba', (g) => {
        for (let x = 0; x < 128; x += 4) (g.fillStyle = x % 8 ? '#9aa3ad' : '#b4bcc5', g.fillRect(x, 0, 2, 64));
        g.fillStyle = '#7b848e';
        g.fillRect(0, 56, 128, 8);
      }),
      hall: fac('#4f7da6', (g) => {
        const gr = g.createLinearGradient(0, 0, 0, 64);
        gr.addColorStop(0, 'rgba(255,255,255,.28)');
        gr.addColorStop(1, 'rgba(0,20,40,.25)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 128, 64);
        g.fillStyle = '#d1d9e2';
        for (let x = 0; x < 128; x += 12) g.fillRect(x, 0, 2, 64);
        g.fillRect(0, 30, 128, 2);
        g.fillRect(0, 0, 128, 3);
      }),
      hallLit: canvasTex(128, 64, (g) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, 128, 64);
        g.fillStyle = '#ffdca3';
        for (let x = 2; x < 128; x += 12) (g.fillRect(x, 4, 9, 25), g.fillRect(x, 33, 9, 24));
      }),
      fire: fac('#b91c1c', (g) => winGrid(g, '#fca5a5', 8, 5, 14, 30, 4, 6)),
      roof: canvasTex(64, 64, (g) => noise(g, 64, 64, '#6b7280', 40, 77, 0.2)),
    };
    return (this.tex = { grass, asphalt, apron, skid, facade, town, townLit, F });
  }

  // Kennziffer auf der Bahn (liegt flach, Oberkante zeigt in Landerichtung)
  number(txt, x, y, dir) {
    const t = canvasTex(128, 192, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#f8fafc';
      g.font = 'bold 150px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.save();
      g.scale(0.6, 1);
      g.fillText(txt, w / 2 / 0.6, h / 2 + 8);
      g.restore();
    }, false);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    const grp = new THREE.Group();
    grp.add(m);
    grp.position.set(x, 0.014, y);
    grp.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.static.add(grp);
  }

  runway(R, south) {
    const T = this.textures();
    const asph = new THREE.MeshLambertMaterial({ map: T.asphalt });
    this.flat(R.x0, R.x1, R.y - R.hw, R.y + R.hw, asph, 0.01, 3);
    const W = 0xf1f5f9;
    // Mittellinie und Randmarkierung
    for (let x = R.thr['09'] + 2; x < R.thr['27'] - 2; x += 1.6) this.flat(x, x + 0.8, R.y - 0.04, R.y + 0.04, W, 0.012);
    this.flat(R.x0, R.x1, R.y - R.hw + 0.06, R.y - R.hw + 0.12, 0xe5e7eb, 0.012);
    this.flat(R.x0, R.x1, R.y + R.hw - 0.12, R.y + R.hw - 0.06, 0xe5e7eb, 0.012);
    const skidMat = new THREE.MeshBasicMaterial({ map: T.skid, transparent: true, depthWrite: false });
    for (const [rwy, d] of [['09', 1], ['27', -1]]) {
      const thr = R.thr[rwy];
      // Schwellenbalken („Klaviertasten“), Kennziffer, Aufsetzpunkt-Markierung, Aufsetzzonen
      for (let k = -4; k <= 4; k++) if (k) this.flat(Math.min(thr - d * 1.4, thr - d * 0.2), Math.max(thr - d * 1.4, thr - d * 0.2), R.y + k * 0.24 - 0.07, R.y + k * 0.24 + 0.07, W, 0.012);
      this.flat(Math.min(thr, thr - d * 0.08), Math.max(thr, thr - d * 0.08), R.y - R.hw + 0.12, R.y + R.hw - 0.12, W, 0.012);
      this.number(rwy, thr + d * 1.15, R.y, d);
      const aim = thr + d * R.td;
      for (const s of [-1, 1]) this.flat(Math.min(aim - d * 0.4, aim + d * 1.6), Math.max(aim - d * 0.4, aim + d * 1.6), R.y + s * 0.5 - 0.13, R.y + s * 0.5 + 0.13, W, 0.012);
      for (const off of [5, 8, 11]) for (const s of [-1, 1]) this.flat(Math.min(thr + d * off, thr + d * (off + 0.9)), Math.max(thr + d * off, thr + d * (off + 0.9)), R.y + s * 0.55 - 0.06, R.y + s * 0.55 + 0.06, W, 0.012);
      // Gummiabrieb, wo die Flugzeuge aufsetzen
      const sk = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), skidMat);
      sk.rotation.set(-Math.PI / 2, 0, d > 0 ? 0 : Math.PI);
      sk.position.set(aim + d * 3.6, 0.0125, R.y);
      this.static.add(sk);
      // Vorfeld vor der Schwelle (gelbe Pfeile)
      const [p0, p1] = d > 0 ? [R.x0 + 0.3, thr - 1.7] : [thr + 1.7, R.x1 - 0.3];
      for (let x = p0; x < p1 - 0.3; x += 0.9) this.flat(x, x + 0.45, R.y - 0.05, R.y + 0.05, 0xfacc15, 0.012);
      // Anflugbefeuerung: Mittellinie mit Querbalken bis 900 m vor der Schwelle
      const als = [];
      for (let k = 1; k <= 30; k++) {
        const x = thr - d * k * 1.5;
        for (let j = -2; j <= 2; j++) als.push(x, 0.08 + k * 0.004, R.y + j * 0.13);
        if (k === 10) for (let j = -9; j <= 9; j++) if (Math.abs(j) > 2) als.push(x, 0.1, R.y + j * 0.15);
      }
      this.lights(als, 0xfff4d0, 0.3);
      // Lauffeuer („Rabbit“) – leuchten nacheinander zur Schwelle hin
      const flash = [];
      for (let k = 10; k <= 30; k++) {
        const sp = new THREE.Sprite(spriteMat(0xffffff));
        sp.position.set(thr - d * k * 1.5, 0.2, R.y);
        sp.scale.setScalar(0.01);
        this.static.add(sp);
        flash.push(sp);
      }
      this.rabbits[(south ? 'S' : 'N') + rwy] = flash;
      // PAPI links der Bahn am Aufsetzpunkt (09: Norden, 27: Süden)
      const side = d > 0 ? -1 : 1;
      const papi = [];
      for (let i = 0; i < 4; i++) {
        const y = R.y + side * (R.hw + 0.5 + i * 0.32);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.18), this.mat(0x6b7280));
        box.position.set(aim, 0.05, y);
        this.static.add(box);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        sp.position.set(aim - d * 0.07, 0.07, y);
        sp.scale.setScalar(0.5);
        this.static.add(sp);
        // innen (an der Bahn) der steilste Winkel
        papi.push({ sp, ang: [3.5, 3.17, 2.83, 2.5][i] * DEG });
      }
      this.papis.push({ papi, rwy, south, x: aim, y: R.y });
    }
    // Rand-, Mittellinien-, Schwellen- und Endfeuer
    const edge = [], cl = [], grn = [], red = [];
    for (let x = R.x0; x <= R.x1 + 0.01; x += 1.5) edge.push(x, 0.06, R.y - R.hw - 0.05, x, 0.06, R.y + R.hw + 0.05);
    for (let x = R.thr['09']; x <= R.thr['27']; x += 0.75) cl.push(x, 0.02, R.y);
    for (let j = -5; j <= 5; j++) {
      grn.push(R.thr['09'] - 0.05, 0.05, R.y + j * 0.24, R.thr['27'] + 0.05, 0.05, R.y + j * 0.24);
      red.push(R.x0 + 0.05, 0.05, R.y + j * 0.24, R.x1 - 0.05, 0.05, R.y + j * 0.24);
    }
    this.lights(edge, 0xfff2c4, 0.26);
    this.lights(cl, 0xf8fafc, 0.15);
    this.lights(grn, 0x4ade80, 0.24);
    this.lights(red, 0xff4040, 0.24);
  }

  build(state) {
    if (this.static) this.scene.remove(this.static);
    this.static = new THREE.Group();
    this.nightLights = [];
    this.rabbits = {};
    this.papis = [];
    this.pools = [];
    this.scene.add(this.static);
    const T = this.textures();
    // Gras bis zum Horizont: um den Flughafen ein fein unterteiltes Stück, weit draußen eine große Fläche etwas tiefer.
    // Riesige Dreiecke verlieren Tiefengenauigkeit – darum unterteilt und per Polygon-Offset nach hinten geschoben,
    // damit Vorfeld, Rollwege und Bahnen immer darüber liegen
    const gm = new THREE.MeshLambertMaterial({ map: T.grass, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    const near = new THREE.PlaneGeometry(1600, 1600, 40, 40);
    const nuv = near.attributes.uv;
    for (let i = 0; i < nuv.count; i++) nuv.setXY(i, (nuv.getX(i) * 1600) / 6, (nuv.getY(i) * 1600) / 6);
    const ground = new THREE.Mesh(near, gm);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(LY.W / 2, 0, LY.H / 2);
    ground.receiveShadow = true;
    this.static.add(ground);
    const farMat = new THREE.MeshLambertMaterial({ map: T.grass, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 8 });
    const far = this.flat(LY.W / 2 - 20000, LY.W / 2 + 20000, LY.H / 2 - 20000, LY.H / 2 + 20000, farMat, -0.15, 6);
    far.receiveShadow = false;
    this.landscape();
    this.snowMat = new THREE.MeshLambertMaterial({ color: 0xf4f7fb, transparent: true, opacity: 0, depthWrite: false });
    this.snowPlane = this.flat(LY.W / 2 - 3000, LY.W / 2 + 3000, LY.H / 2 - 3000, LY.H / 2 + 3000, this.snowMat, 0.0045);
    // Vorfeld und Rollwege
    const apron = new THREE.MeshLambertMaterial({ map: T.apron });
    const twy = new THREE.MeshLambertMaterial({ map: T.asphalt, color: 0xc9cdd2 });
    this.flat(LY.TERMINAL.x0 - 2, 77, LY.TERMINAL.y1, LY.LANE + 0.6, apron, 0.006, 3.2);
    this.flat(LY.TERMINAL.x0 - 2, 77, LY.SERVICE - 0.5, LY.TERMINAL.y1, 0x9fa3a7, 0.007);
    this.flat(LY.RWY.x0, LY.RWY.x1, LY.TWY_A - 0.45, LY.TWY_A + 0.45, twy, 0.008, 3);
    for (let x = LY.RWY.x0; x < LY.RWY.x1; x += 1.4) this.flat(x, x + 0.7, LY.TWY_A - 0.03, LY.TWY_A + 0.03, 0xfacc15, 0.01);
    const blue = [], green = [];
    for (let x = LY.RWY.x0; x <= LY.RWY.x1; x += 1.2) {
      if (!LY.EXITS.some((e) => Math.abs(e - x) < 0.6) && !LY.CONN.some((e) => Math.abs(e - x) < 0.6)) blue.push(x, 0.04, LY.TWY_A - 0.5, x, 0.04, LY.TWY_A + 0.5);
      green.push(x, 0.02, LY.TWY_A);
    }
    for (const x of LY.EXITS) {
      this.flat(x - 0.45, x + 0.45, LY.TWY_A, LY.RWY.y - LY.RWY.hw, twy, 0.008, 3);
      this.flat(x - 0.03, x + 0.03, LY.TWY_A, LY.RWY.y - LY.RWY.hw, 0xfacc15, 0.01);
      // Haltebalken vor der Piste
      this.flat(x - 0.45, x + 0.45, LY.RWY.y - LY.RWY.hw - 0.9, LY.RWY.y - LY.RWY.hw - 0.78, 0xfacc15, 0.011);
      for (let y = LY.TWY_A + 0.6; y < LY.RWY.y - LY.RWY.hw; y += 0.8) blue.push(x - 0.5, 0.04, y, x + 0.5, 0.04, y), green.push(x, 0.02, y);
    }
    for (const x of LY.CONN) this.flat(x - 0.45, x + 0.45, LY.LANE, LY.TWY_A, twy, 0.008, 3);
    this.lights(blue, 0x3b82f6, 0.2);
    this.lights(green, 0x22c55e, 0.12);
    // Parkpositionen: gelbe Leitlinien und Haltebalken
    for (const st of state.stands) if (st.built) {
      this.flat(st.x - 0.03, st.x + 0.03, LY.STAND_NOSE, LY.LANE, 0xfacc15, 0.009);
      this.flat(st.x - 0.4, st.x + 0.4, LY.STAND_NOSE - 0.05, LY.STAND_NOSE + 0.02, 0xfacc15, 0.009);
    }
    this.runway(LY.RWY, false);
    this.rwy2 = !!(state.upgrades && state.upgrades.rwy2);
    if (this.rwy2) {
      this.runway(LY.RWY_S, true);
      this.flat(LY.RWY_S.x0, LY.RWY_S.x1, LY.TWY_B - 0.45, LY.TWY_B + 0.45, twy, 0.008, 3);
    }
    // Terminal: Glasfassade mit Pfosten, helles Dach mit Überstand
    const TE = LY.TERMINAL;
    const fac = T.facade.clone();
    fac.needsUpdate = true;
    fac.repeat.set((TE.x1 - TE.x0) / 2.4, 1);
    this.box(TE.x0, TE.x1, TE.y0, TE.y1, 1.0, new THREE.MeshPhongMaterial({ map: fac, shininess: 80, specular: 0x8899aa }));
    this.box(TE.x0 - 0.15, TE.x1 + 0.15, TE.y0 - 0.15, TE.y1 + 0.35, 0.08, 0xd9dee4, 1.0);
    for (let x = TE.x0 + 3; x < TE.x1 - 1; x += 6) this.box(x, x + 1.6, TE.y0 + 0.6, TE.y1 - 0.6, 0.3, 0xcbd5e1, 1.08);
    // Fensterband, das nachts warm leuchtet
    this.termGlow = new THREE.Mesh(new THREE.PlaneGeometry(TE.x1 - TE.x0 - 0.4, 0.62), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.termGlow.position.set((TE.x0 + TE.x1) / 2, 0.5, TE.y1 + 0.02);
    this.static.add(this.termGlow);
    // Fluggastbrücken an Kontaktpositionen: Rotunde, Tunnel, Kabine
    for (const st of state.stands) if (st.built && st.kind === 'contact') {
      const x = st.x - 1.35;
      const rot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.42, 12), this.mat(0xd1d5db));
      rot.position.set(x, 0.38, TE.y1 + 0.35);
      rot.castShadow = true;
      this.static.add(rot);
      this.box(x - 0.12, x + 0.12, TE.y1 + 0.35, LY.STAND_NOSE + 0.1, 0.2, 0xc7ccd1, 0.32);
      this.box(x - 0.18, x + 0.18, LY.STAND_NOSE - 0.05, LY.STAND_NOSE + 0.3, 0.26, 0x9ca3af, 0.3);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 6), this.mat(0x4b5563));
      leg.position.set(x, 0.16, LY.STAND_NOSE + 0.1);
      this.static.add(leg);
    }
    // Flutlichtmasten am Vorfeldrand: nachts Lichtkegel auf dem Beton
    const poolTex = canvasTex(64, 64, (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,236,190,0.9)');
      r.addColorStop(0.6, 'rgba(255,226,170,0.35)');
      r.addColorStop(1, 'rgba(255,220,160,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    }, false);
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.poolMat = poolMat;
    for (let x = TE.x0 + 2; x < 76; x += 8.5) {
      const y = LY.LANE + 1.0;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.6, 6), this.mat(0x9ca3af));
      pole.position.set(x, 0.8, y);
      pole.castShadow = true;
      this.static.add(pole);
      this.box(x - 0.18, x + 0.18, y - 0.1, y + 0.1, 0.08, 0x4b5563, 1.6);
      const sp = new THREE.Sprite(spriteMat(0xffeec8));
      sp.position.set(x, 1.58, y - 0.12);
      sp.scale.setScalar(0.9);
      this.static.add(sp);
      this.pools.push(sp);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.02, y - 3.4);
      this.static.add(pool);
    }
    // übrige Gebäude
    const H = { hall: 1.4, hangar: 1.4, cargo: 0.9, depot: 0.6, fire: 0.55, fuel: 0.5, parking: 0.8, hotel: 2.2, radar: 0.2 };
    const CO = { hall: 0xd6dde5, hangar: 0xaab3bc, cargo: 0x8d9aa7, depot: 0x9ca3af, fire: 0xb91c1c, fuel: 0xe5e7eb, parking: 0x9aa0a6, hotel: 0xe2e8f0, radar: 0x94a3b8 };
    for (const b of LY.BUILDINGS) {
      if (b.requires && !(state.upgrades && state.upgrades[b.requires])) continue;
      const cx = b.fx - b.w / 2, cy = b.fy - b.d / 2;
      if (b.id === 'tower') {
        // Kanzel in ≈ 120 m Höhe (wie an großen Drehkreuzen) – von dort überblickt man Vorfeld und Bahnen
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.5, 5.8, 14), this.mat(0xe5e7eb));
        shaft.position.set(cx, 2.9, cy);
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.62, 0.48, 14), new THREE.MeshPhongMaterial({ color: 0x1d3b55, shininess: 90, specular: 0x99aabb }));
        cab.position.set(cx, 6.04, cy);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.08, 14), this.mat(0xf1f5f9));
        roof.position.set(cx, 6.32, cy);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5), this.mat(0x9ca3af));
        mast.position.set(cx, 6.65, cy);
        for (const m of [shaft, cab, roof]) (m.castShadow = true, m.receiveShadow = true);
        this.static.add(shaft, cab, roof, mast);
        this.towerRoof = [roof, mast];
        this.towerPos = new THREE.Vector3(cx, 6.1, cy);
        // Flughafen-Drehfeuer (grün/weiß im Wechsel)
        this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        this.beacon.position.set(cx, 6.98, cy);
        this.static.add(this.beacon);
        continue;
      }
      if (b.id === 'fuel') {
        for (const [dx, dy] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 16), this.mat(0xe5e7eb));
          t.position.set(cx + dx, 0.25, cy + dy);
          t.castShadow = true;
          this.static.add(t);
        }
        continue;
      }
      if (b.id === 'hangar') {
        // Halle mit Tonnendach
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(b.d / 2, b.d / 2, b.w, 18, 1, false, 0, Math.PI), this.mat(0xaab3bc));
        roof.rotation.z = Math.PI / 2;
        roof.scale.x = 0.45;
        roof.position.set(cx, 0.7, cy);
        roof.castShadow = true;
        this.static.add(roof);
        this.box(cx - b.w / 2, cx + b.w / 2, cy - b.d / 2, cy + b.d / 2, 0.7, 0x9aa4ae);
        continue;
      }
      const x0 = cx - b.w / 2, x1 = cx + b.w / 2, y0 = cy - b.d / 2, y1 = cy + b.d / 2;
      if (b.id === 'radar') {
        // Radarturm mit drehender Antenne
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 1.2, 8), this.mat(0xd1d5db));
        pole.position.set(cx, 0.6, cy);
        pole.castShadow = true;
        const ant = new THREE.Group();
        ant.position.set(cx, 1.28, cy);
        const dish = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.05), this.mat(0xf1f5f9));
        dish.position.z = 0.08;
        dish.rotation.x = -0.25;
        ant.add(dish);
        this.radarAnt = ant;
        this.static.add(pole, ant);
        continue;
      }
      if (b.id === 'hall') this.bldg(x0, x1, y0, y1, 1.4, 'hall', 0xd6dde5);
      else if (b.id === 'hotel') this.bldg(x0, x1, y0, y1, 2.2, 'hotel', 0xcbd5e1);
      else if (b.id === 'parking') {
        this.bldg(x0, x1, y0, y1, 0.8, 'parking', 0x9aa0a6);
        // Autos auf dem Parkdeck
        const r = rng(55);
        const cars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.08, 0.11), new THREE.MeshLambertMaterial({ color: 0xffffff }), 40);
        const mx = new THREE.Matrix4(), col = new THREE.Color();
        const CC = [0xe5e7eb, 0x1f2937, 0x991b1b, 0x1d4ed8, 0x9ca3af, 0x065f46, 0xf59e0b];
        for (let i = 0; i < 40; i++) {
          mx.makeTranslation(x0 + 0.3 + (i % 8) * ((b.w - 0.6) / 8), 0.84, y0 + 0.4 + Math.floor(i / 8) * ((b.d - 0.8) / 5));
          cars.setMatrixAt(i, mx);
          cars.setColorAt(i, col.setHex(r() < 0.3 ? 0x6b7280 : CC[Math.floor(r() * CC.length)]));
        }
        this.static.add(cars);
      } else if (b.id === 'cargo' || b.id === 'depot') {
        this.bldg(x0, x1, y0, y1, H[b.id], 'metal', 0x94a3b8);
        // große Tore zur Vorfeldseite
        for (let x = x0 + 0.6; x < x1 - 1; x += 2.2) this.box(x, x + 1.4, y1, y1 + 0.03, H[b.id] * 0.7, 0x475569, 0, false);
      } else if (b.id === 'fire') {
        this.bldg(x0, x1, y0, y1, 0.55, 'fire', 0x9ca3af);
        // Fahrzeughallentore Richtung Bahn
        for (let x = x0 + 0.4; x < x1 - 0.6; x += 1.05) this.box(x, x + 0.8, y0 - 0.03, y0, 0.42, 0xf1f5f9, 0, false);
      } else this.box(x0, x1, y0, y1, H[b.id] || 0.6, CO[b.id] || 0xa1a1aa);
    }
    // Windsack an beiden Bahnenden
    this.socks = [];
    for (const x of [LY.RWY.thr['09'] + 4, LY.RWY.thr['27'] - 4]) {
      const y = LY.RWY.y - LY.RWY.hw - 2.2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), this.mat(0xe5e7eb));
      pole.position.set(x, 0.25, y);
      this.static.add(pole);
      const sock = new THREE.Group();
      sock.position.set(x, 0.48, y);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.32, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0xf97316, side: THREE.DoubleSide }));
      cone.rotation.z = Math.PI / 2;
      cone.position.x = 0.17;
      sock.add(cone);
      this.static.add(sock);
      this.socks.push(sock);
    }
    // Bäume (wie auf der Karte)
    const trees = (this.game.map && this.game.map.trees) || LY.makeTrees();
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 1.1, 7), this.mat(0x2f5d2a), trees.length);
    crown.castShadow = true;
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => {
      const s = t.s || 1;
      m.makeScale(s, s, s);
      m.setPosition(t.x, 0.55 * s, t.y);
      crown.setMatrixAt(i, m);
    });
    this.static.add(crown);
    this.built = true;
  }

  // Umland: Felder, Waldstücke, eine Stadt im Norden mit nachts erleuchteten Fenstern, Straßen mit Verkehr – fest gesät
  landscape() {
    const r = rng(987654);
    const T = this.textures();
    const COLS = [0x7a9a45, 0x8fae4f, 0xa8a24a, 0x6d8a3a, 0x9c8a55, 0x5f7f34, 0xb5ad62];
    const fields = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), 900);
    const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    let n = 0;
    for (let i = 0; i < 900; i++) {
      const ang = r() * Math.PI * 2, dist = 70 + Math.pow(r(), 0.7) * 2600;
      const x = LY.W / 2 + Math.cos(ang) * dist, y = LY.H / 2 + Math.sin(ang) * dist;
      const w = 8 + r() * 40, h = 8 + r() * 30, c = COLS[Math.floor(r() * COLS.length)], rot = Math.floor(r() * 4) * 0.1;
      if (Math.abs(y - LY.RWY.y) < 12 && Math.abs(x - LY.W / 2) < 160) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      mx.compose(new THREE.Vector3(x, 0.003, y), q, new THREE.Vector3(w, 1, h));
      fields.setMatrixAt(n, mx);
      fields.setColorAt(n++, col.setHex(c));
    }
    fields.count = n;
    fields.receiveShadow = true;
    this.static.add(fields);
    // Wälder
    const N = 2500;
    const forest = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 3.2, 6), this.mat(0x2d5427), N);
    let k = 0;
    for (let c = 0; c < 40 && k < N; c++) {
      const ang = r() * Math.PI * 2, dist = 140 + r() * 1800;
      const cx = LY.W / 2 + Math.cos(ang) * dist, cy = LY.H / 2 + Math.sin(ang) * dist;
      if (Math.abs(cy - LY.RWY.y) < 20 && Math.abs(cx - LY.W / 2) < 260) continue;
      for (let i = 0; i < 60 && k < N; i++) {
        const s = 0.7 + r() * 0.8;
        mx.makeScale(s, s, s);
        mx.setPosition(cx + (r() - 0.5) * 50, 1.6 * s, cy + (r() - 0.5) * 35);
        forest.setMatrixAt(k++, mx);
      }
    }
    forest.count = k;
    this.static.add(forest);
    // Stadt im Norden: Häuserblocks, in der Mitte höher; nachts leuchten Fenster
    this.townMat = new THREE.MeshLambertMaterial({ map: T.town, emissiveMap: T.townLit, emissive: 0xffffff, emissiveIntensity: 0 });
    const town = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.townMat, 700);
    const TX = LY.W / 2 - 40, TY = -160;
    for (let i = 0; i < 700; i++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * 90;
      const x = TX + Math.cos(a) * d, y = TY + Math.sin(a) * d * 0.7;
      const h = (1 + r() * 2) * (d < 25 ? 3 + r() * 5 : 1);
      mx.makeScale(2 + r() * 3, h, 2 + r() * 3);
      mx.setPosition(x, h / 2, y);
      town.setMatrixAt(i, mx);
    }
    this.static.add(town);
    // Straßen zur Stadt und um den Platz, darauf Autos (nachts Scheinwerfer und Rücklichter)
    const road = 0x55595e;
    this.flat(LY.W / 2 - 41, LY.W / 2 - 39, TY, 0, road, 0.004);
    this.flat(-400, 480, -6, -4.5, road, 0.004);
    const NC = 60;
    this.cars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0xffffff }), NC);
    this.carData = [];
    const CC = [0xe5e7eb, 0x1f2937, 0x991b1b, 0x1d4ed8, 0x9ca3af, 0x065f46];
    for (let i = 0; i < NC; i++) {
      const ns = i % 3 === 0;
      this.carData.push({ ns, dir: r() < 0.5 ? 1 : -1, p: r(), v: 0.012 + r() * 0.01 });
      this.cars.setColorAt(i, col.setHex(CC[i % CC.length]));
    }
    this.static.add(this.cars);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(NC * 3), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(NC * 3), 3));
    this.carLights = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.carLights.frustumCulled = false;
    this.static.add(this.carLights);
    this.TY = TY;
  }

  traffic(dt, night) {
    const m = new THREE.Matrix4(), pos = this.carLights.geometry.attributes.position, colA = this.carLights.geometry.attributes.color;
    this.carData.forEach((c, i) => {
      c.p = (c.p + c.v * dt * (c.ns ? 0.25 : 0.05) + 1) % 1;
      let x, y, rot;
      if (c.ns) (x = LY.W / 2 - 40 + c.dir * 0.45, y = this.TY + (c.dir > 0 ? c.p : 1 - c.p) * -this.TY, rot = Math.PI / 2);
      else (x = -400 + (c.dir > 0 ? c.p : 1 - c.p) * 880, y = -5.25 + c.dir * 0.35, rot = 0);
      m.makeRotationY(rot);
      m.setPosition(x, 0.05, y);
      this.cars.setMatrixAt(i, m);
      pos.setXYZ(i, x + (c.ns ? 0 : c.dir * 0.12), 0.07, y + (c.ns ? c.dir * 0.12 : 0));
      // zur Kamera fahrend weiß (Scheinwerfer), sonst rot – vereinfacht: Richtung entscheidet
      if (c.dir > 0) colA.setXYZ(i, 1, 0.95, 0.8);
      else colA.setXYZ(i, 1, 0.15, 0.1);
    });
    this.cars.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
    colA.needsUpdate = true;
    this.carLights.visible = night;
  }

  // Wolken (bei Bewölkung, Regen, Gewitter): weiche Haufen in 1.200–2.400 m Höhe
  clouds(kind) {
    if (this.cloudKind === kind) return;
    this.cloudKind = kind;
    if (this.cloudGroup) this.scene.remove(this.cloudGroup);
    const n = { clouds: 70, rain: 110, storm: 130, snow: 100 }[kind] || (kind === 'clear' ? 14 : 0);
    if (!n) return;
    const r = rng(4242);
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: kind === 'storm' ? 0x8a929c : kind === 'rain' ? 0xc5ccd3 : 0xf8fafc, transparent: true, opacity: 0.9 });
    this.cloudMat = mat;
    const sph = new THREE.SphereGeometry(1, 12, 8);
    for (let i = 0; i < n; i++) {
      const cx = LY.W / 2 + (r() - 0.5) * 2400, cy = LY.H / 2 + (r() - 0.5) * 2400, alt = 60 + r() * 60;
      for (let j = 0; j < 6; j++) {
        const m = new THREE.Mesh(sph, mat);
        const s = 10 + r() * 14;
        m.scale.set(s * 1.6, s * 0.6, s);
        m.position.set(cx + (r() - 0.5) * 34, alt + r() * 7, cy + (r() - 0.5) * 22);
        g.add(m);
      }
    }
    this.cloudGroup = g;
    this.scene.add(g);
  }

  // Regen (Striche) und Schnee (Flocken) in einem Würfel um die Kamera
  precip(kind, dt) {
    const want = kind === 'rain' || kind === 'storm' ? 'rain' : kind === 'snow' ? 'snow' : null;
    if (this.precipKind !== want) {
      if (this.precipObj) this.scene.remove(this.precipObj);
      this.precipObj = null;
      this.precipKind = want;
      if (want === 'rain') {
        const n = kind === 'storm' ? 2600 : 1600;
        const p = new Float32Array(n * 6);
        const r = rng(13);
        for (let i = 0; i < n; i++) {
          const x = (r() - 0.5) * 40, y = r() * 24, z = (r() - 0.5) * 40;
          p.set([x, y, z, x + 0.03, y + 0.55, z], i * 6);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p, 3));
        this.precipObj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.38, depthWrite: false }));
      } else if (want === 'snow') {
        const n = 2400;
        const p = new Float32Array(n * 3);
        const r = rng(17);
        for (let i = 0; i < n; i++) p.set([(r() - 0.5) * 40, r() * 24, (r() - 0.5) * 40], i * 3);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p, 3));
        this.precipObj = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, map: glowTex(), transparent: true, depthWrite: false }));
      }
      if (this.precipObj) {
        this.precipObj.frustumCulled = false;
        this.scene.add(this.precipObj);
      }
    }
    if (!this.precipObj) return;
    const c = this.camera.position;
    const a = this.precipObj.geometry.attributes.position;
    const fall = (want === 'rain' ? 26 : 1.6) * dt;
    const stride = want === 'rain' ? 2 : 1;
    const now = performance.now() / 1000;
    for (let i = 0; i < a.count; i += stride) {
      let y = a.getY(i) - fall;
      let dx = 0;
      if (want === 'snow') dx = Math.sin(now + i) * 0.004;
      if (y < -12) y += 24;
      a.setY(i, y);
      if (dx) a.setX(i, a.getX(i) + dx);
      if (stride === 2) (a.setY(i + 1, y + 0.55), dx && a.setX(i + 1, a.getX(i + 1) + dx));
    }
    a.needsUpdate = true;
    this.precipObj.position.set(c.x, c.y, c.z);
  }

  // Rauch- und Gischtwolken (Sprites, verblassen und wachsen)
  puff(x, y, z, kind) {
    let p = this.puffs.find((q) => !q.alive);
    if (!p) {
      if (this.puffs.length > 140) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xe5e7eb, transparent: true, depthWrite: false, opacity: 0 }));
      this.scene.add(sp);
      p = { sp };
      this.puffs.push(p);
    }
    Object.assign(p, { alive: true, t: 0, life: kind === 'smoke' ? 2.4 : 1.1, s0: kind === 'smoke' ? 0.35 : 0.25, grow: kind === 'smoke' ? 1.6 : 1.1, a0: kind === 'smoke' ? 0.75 : 0.45 });
    p.sp.material.color.setHex(kind === 'smoke' ? 0xd6d9dd : 0xdbe4ec);
    p.sp.position.set(x, y, z);
    p.sp.visible = true;
  }
  stepPuffs(dt) {
    for (const p of this.puffs) {
      if (!p.alive) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        p.alive = false;
        p.sp.visible = false;
        continue;
      }
      p.sp.scale.setScalar(p.s0 + p.grow * k);
      p.sp.material.opacity = p.a0 * (1 - k) * (1 - k);
      p.sp.position.y += dt * 0.08;
    }
  }

  // ---------- Flugzeuge ----------
  // Sichtbare Höhe: im Endanflug ein echter 3°-Gleitpfad (die Karte staucht ihn), sonst Spielhöhe
  targetY(ac) {
    if (ac.mode !== 'map') return Math.max(0, ac.alt || 0) * FT;
    if (ac.phase === PH.FINAL) {
      const R = ac.strip === 'S' ? LY.RWY_S : LY.RWY;
      const d = LY.rwyDir(ac.rwy);
      const rem = (R.thr[ac.rwy] + d * R.td - ac.x) * d;
      return Math.max(0, rem) * FT_PER_TILE * FT;
    }
    // Steigflug auf der Karte gestaucht (die Simulation steigt sehr steil, damit der Abflug auf die Karte passt)
    return (ac.z || 0) * ALT_CLIMB;
  }

  pose(ac) {
    if (ac.mode === 'map') return { x: ac.x, z: ac.y, hdg: ac.hdg };
    const p = LY.nmToTile(ac.pos.x, ac.pos.y);
    // Kurs (Grad, Nord = 0) -> Kartenwinkel
    return { x: p.x, z: p.y, hdg: ((ac.crs || 0) - 90) * DEG };
  }

  updateAircraft(state, ride, dt, now, lightsOn, wet) {
    const seen = new Set();
    for (const ac of state.acs) {
      // im Turmblick auch die Flugzeuge im nahen Luftraum (Anflug, Abflug) – sonst nur das eigene im Anflug
      const vis = ac.mode === 'map' || (ac.id === ride.id && ac.mode === 'air') || ((ride.mode === 'tower' || ride.mode === 'cine3d') && ac.mode === 'air' && ac.pos && Math.hypot(ac.pos.x, ac.pos.y) < 9);
      if (!vis) continue;
      seen.add(ac.id);
      let g = this.acs.get(ac.id);
      if (!g) {
        g = buildAircraft(ac);
        this.scene.add(g);
        this.acs.set(ac.id, g);
        // Teile einmal nachschlagen statt jeden Frame zu suchen
        const R = {};
        for (const n of ['gear', 'landing', 'taxi', 'gse', 'stairs', 'navL', 'navR', 'navT', 'bcnT', 'bcnB', 'strL', 'strR', 'strT']) R[n] = g.getObjectByName(n);
        R.props = [];
        R.discs = [];
        g.traverse((o) => (o.name === 'prop' ? R.props.push(o) : o.name === 'disc' ? R.discs.push(o) : null));
        this.refs.set(g, R);
      }
      const u = g.userData;
      const R = this.refs.get(g);
      const p = this.pose(ac);
      let v = this.vis.get(ac.id);
      const ty = this.targetY(ac);
      if (!v) this.vis.set(ac.id, (v = { y: ty, pitch: 0, bank: 0, x: p.x, z: p.z, hdg: p.hdg, ph: ac.phase, sp: 0 }));
      // Höhe glätten (Übergänge Luftraum -> Karte, Durchstarten)
      const dy = ty - v.y;
      v.y += dy * (1 - Math.exp(-dt / (Math.abs(dy) > 0.4 ? 0.8 : 0.12)));
      if (ty === 0 && !ON_RWY.has(ac.phase)) v.y = 0;
      v.y = Math.max(0, v.y);
      // Bahnneigung aus Steig-/Sinkflug, Anstellwinkel je Phase, Abfangbogen kurz vor dem Aufsetzen
      const hs = Math.hypot(p.x - v.x, p.z - v.z) / Math.max(dt, 1e-3);
      const vs = (v.y - (v.lastY ?? v.y)) / Math.max(dt, 1e-3);
      v.lastY = v.y;
      let pt = 0;
      if (v.y > 0.01 && hs > 0.05) {
        const fpa = Math.atan2(vs, hs);
        const aoa = ac.phase === PH.FINAL ? (v.y < 0.25 ? 6.5 : 5) : 4;
        pt = clamp(fpa + aoa * DEG, -6 * DEG, 17 * DEG);
      } else if (ac.phase === PH.TAKEOFF && (ac.z || 0) > 0) pt = 10 * DEG;
      v.pitch += (pt - v.pitch) * (1 - Math.exp(-dt / 0.45));
      // Querlage in Kurven (Luftraum)
      let bk = 0;
      if (ac.mode === 'air') {
        let dh = p.hdg - v.hdg;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        bk = clamp((dh / Math.max(dt, 1e-3)) / Math.max(1, state.speed || 1) * 7, -0.45, 0.45);
      }
      v.bank += (bk - v.bank) * (1 - Math.exp(-dt / 0.6));
      v.x = p.x;
      v.z = p.z;
      v.hdg = p.hdg;
      g.position.set(p.x, v.y + u.H, p.z);
      g.rotation.set(-v.bank, -p.hdg, v.pitch, 'YXZ');
      // Aufsetzen: Reifenrauch an beiden Hauptfahrwerken
      if (v.ph === PH.FINAL && ac.phase === PH.ROLLOUT) this.touch(g, u);
      v.ph = ac.phase;
      // Gischt auf nasser Bahn bei schneller Fahrt
      v.sp += dt;
      if (wet && ac.mode === 'map' && v.y < 0.05 && (ac.v || 0) > 0.18 && v.sp > 0.07) {
        v.sp = 0;
        const w = new THREE.Vector3(u.gearX - 0.1, -u.H + 0.05, 0).applyMatrix4(g.matrixWorld);
        this.puff(w.x, w.y, w.z, 'spray');
      }
      // Fahrwerk, Propeller, Lichter
      const gear = R.gear;
      gear.visible = ac.mode === 'map' ? v.y < 2.5 || ac.phase === PH.FINAL : (ac.alt || 0) < 2000;
      const running = ac.phase !== PH.STAND && ac.phase !== PH.PUSH;
      if (running) for (const o of R.props) o.rotation.x += dt * 40;
      for (const o of R.discs) o.visible = running;
      const air = ac.mode === 'air' || v.y > 0.05;
      const onRwy = ON_RWY.has(ac.phase) || air;
      const glow = lightsOn ? 1 : 0.35;
      const set = (n, on, s) => {
        const o = R[n];
        if (o) (o.visible = on, o.scale.setScalar(s));
      };
      const navOn = ac.phase !== PH.STAND;
      set('navL', navOn, 0.22 * glow + 0.04);
      set('navR', navOn, 0.22 * glow + 0.04);
      set('navT', navOn, 0.18 * glow + 0.03);
      const bcn = running && Math.floor(now * 1.25 + ac.id.length * 0.37) % 2 === 0;
      set('bcnT', bcn, 0.3 * glow + 0.06);
      set('bcnB', bcn, 0.3 * glow + 0.06);
      const ph = (now + ac.id.length * 0.21) % 1.2;
      const strobe = onRwy && (ph < 0.05 || (ph > 0.12 && ph < 0.16));
      for (const n of ['strL', 'strR', 'strT']) set(n, strobe, 0.6 * glow + 0.15);
      const land = R.landing;
      land.visible = (onRwy && (ac.mode === 'map' || (ac.alt || 0) < 10000)) && (lightsOn || ac.phase === PH.FINAL || ac.phase === PH.TAKEOFF);
      for (const o of land.children) if (o.isGroup) o.visible = lightsOn && v.y < 3;
      R.taxi.visible = lightsOn && !onRwy && ac.mode === 'map' && (ac.phase === PH.TAXI_IN || ac.phase === PH.TAXI_OUT || ac.phase === PH.TAXI_WAIT || ac.phase === PH.VACATED || ac.phase === PH.HOLDING);
      g.visible = !(ride.mode === 'cockpit' && ac.id === ride.id);
      g.name = ac.id;
      // Bodengeräte während der Abfertigung, Treppe nur an Außenpositionen
      const gse = R.gse;
      const atStand = ac.mode === 'map' && ac.phase === PH.STAND;
      gse.visible = atStand;
      if (atStand) {
        const st = ac.stand && state.stands.find((x) => x.id === ac.stand || x.n === ac.stand);
        R.stairs.visible = !(st && st.kind === 'contact');
      }
    }
    for (const [id, g] of this.acs) if (!seen.has(id)) (this.scene.remove(g), this.acs.delete(id), this.vis.delete(id));
  }

  // Cessna in der Platzrunde und Rettungshubschrauber (Höhe wie der übrige Verkehr auf der Karte gestaucht)
  updateGA(state, dt, now, lightsOn) {
    const p = state.vfr && state.vfr.p;
    if (p) {
      if (!this.cessna) this.scene.add((this.cessna = buildCessna()));
      const c = this.cessna;
      c.visible = true;
      const y = (p.z || 0) * ALT_CLIMB;
      c.position.set(p.x, y + c.userData.H, p.y);
      c.rotation.set(0, -(p.hdg || 0), y > 0.05 ? 0.05 : 0, 'YXZ');
      c.getObjectByName('prop').rotation.x += dt * 45;
      c.getObjectByName('strobe').visible = Math.floor(now * 1.1) % 2 === 0 && (now % 1) < 0.08;
    } else if (this.cessna) this.cessna.visible = false;
    const h = state.heli && state.heli.h;
    if (h) {
      if (!this.heli) this.scene.add((this.heli = buildHeli()));
      const c = this.heli;
      c.visible = true;
      const y = (h.z || 0) * ALT_CLIMB;
      c.position.set(h.x, y + c.userData.H, h.y);
      c.rotation.set(0, -(h.hdg || 0), 0, 'YXZ');
      c.getObjectByName('rotor').rotation.y += dt * 30;
      c.getObjectByName('tail').rotation.z += dt * 50;
      c.getObjectByName('bcn').visible = Math.floor(now * 1.4) % 2 === 0;
    } else if (this.heli) this.heli.visible = false;
    void lightsOn;
  }

  touch(g, u) {
    g.updateMatrixWorld();
    for (const s of [-1, 1]) {
      const w = new THREE.Vector3(u.gearX, -u.H + 0.04, s * u.gearZ).applyMatrix4(g.matrixWorld);
      this.puff(w.x, w.y, w.z, 'smoke');
      this.puff(w.x - 0.1, w.y + 0.03, w.z, 'smoke');
    }
    this.bump = 0.35;
  }

  // Ruckelt die 3D-Ansicht (schwaches Gerät), erst die Schatten, dann die Auflösung herunterfahren
  autoQuality(raw) {
    if (window.__noAutoQ || raw <= 0 || raw > 1) return;
    this.ft = this.ft === undefined ? raw : this.ft * 0.95 + raw * 0.05;
    this.ftN = (this.ftN || 0) + 1;
    if (this.ftN < 90 || this.ft < 0.045) return;
    this.ftN = 0;
    if (!this.noShadow) {
      this.noShadow = true;
      this.sun.castShadow = false;
    } else if (!this.lowRes) {
      this.lowRes = true;
      this.renderer.setPixelRatio(1);
      this.resize();
    }
  }

  // ---------- jeden Frame ----------
  render(state, ride, follow) {
    if (!this.built || this.rwy2 !== !!(state.upgrades && state.upgrades.rwy2)) this.build(state);
    const now = performance.now() / 1000;
    const raw = now - this.lastT;
    const dt = clamp(raw, 0, 0.1);
    this.lastT = now;
    this.autoQuality(raw);
    // Tageszeit: Sonnenstand (Aufgang im Osten, mittags im Süden), Himmel, Licht, Nebel
    const hr = ((state.time / 3600) % 24 + 24) % 24;
    // wie die Karte: hell von 6 bis 21 Uhr (Dämmerung bis 22 Uhr), nachts unter dem Horizont im Norden
    const night = hr >= 21 || hr < 6;
    const u = night ? (((hr - 21) % 24) + 24) % 24 / 9 : 0;
    const th = night ? Math.PI + u * Math.PI : ((hr - 6) / 15) * Math.PI;
    const elev = night ? -Math.sin(u * Math.PI) * 35 : Math.sin(th) * 55; // Grad
    const hx = Math.cos(th), hz = 0.55 + 0.25 * Math.sin(th);
    const hl = Math.hypot(hx, hz);
    const sunDir = new THREE.Vector3((hx / hl) * Math.cos(elev * DEG), Math.sin(elev * DEG), (hz / hl) * Math.cos(elev * DEG)).normalize();
    const dayK = clamp((elev + 4) / 14, 0, 1);
    const wx = state.weather.kind;
    const murk = wx === 'fog' ? 0.8 : wx === 'storm' ? 0.55 : wx === 'rain' || wx === 'snow' ? 0.4 : wx === 'clouds' ? 0.18 : 0;
    const t1 = clamp((elev + 8) / 8, 0, 1), t2 = clamp((elev - 2) / 14, 0, 1);
    const top = SKY.night.top.clone().lerp(SKY.dusk.top, t1).lerp(SKY.day.top, t2);
    const hor = SKY.night.hor.clone().lerp(SKY.dusk.hor, t1).lerp(SKY.day.hor, t2);
    const mk = SKY.murkNight.clone().lerp(SKY.murkDay, dayK);
    top.lerp(mk, murk * 0.85);
    hor.lerp(mk, murk * 0.8);
    // Blitz bei Gewitter
    if (wx === 'storm' && Math.random() < dt * 0.12) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 5);
    const fl = this.flash > 0.5 || (this.flash > 0.2 && this.flash < 0.3) ? 1 : 0;
    if (fl) (top.lerp(C(0xe0e7ff), 0.7), hor.lerp(C(0xe0e7ff), 0.6));
    const U = this.skyU;
    U.top.value.copy(top);
    U.hor.value.copy(hor);
    U.bot.value.copy(hor).multiplyScalar(0.6);
    U.sunDir.value.copy(sunDir);
    U.sunCol.value.copy(C(0xffb066).lerp(C(0xfff4dc), clamp(elev / 25, 0, 1)));
    U.sunK.value = elev > -2 ? 1 - murk : 0;
    U.glowK.value = clamp((elev + 6) / 10, 0, 1) * (1 - murk * 0.8);
    this.scene.fog.color.copy(hor);
    this.dome.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.stars.material.opacity = clamp((-elev - 2) / 8, 0, 1) * (1 - murk);
    const moonDir = sunDir.clone().negate();
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.15;
    moonDir.normalize();
    this.moon.position.copy(this.camera.position).addScaledVector(moonDir, 4000);
    this.moon.visible = elev < 0 && murk < 0.5;
    // Sichtweite wächst mit der Flughöhe (aus 10.000 ft sieht man weit)
    const camY = Math.max(0, this.camera.position.y);
    this.scene.fog.near = (wx === 'fog' ? 3 : 60 - murk * 40) + camY * 2;
    this.scene.fog.far = (wx === 'fog' ? 36 : 520 - murk * 300) + camY * (wx === 'fog' ? 2 : 14);
    this.hemi.color.copy(top).lerp(C(0xffffff), 0.5);
    this.hemi.groundColor.setHex(0x4d5d2a);
    this.hemi.intensity = 0.18 + 0.9 * dayK + fl * 1.5;
    const sunUp = elev > -1;
    const ld = sunUp ? sunDir : moonDir;
    this.sun.color.copy(sunUp ? U.sunCol.value : C(0x9fb4e6));
    this.sun.intensity = sunUp ? (0.15 + 1.6 * dayK) * (1 - murk * 0.75) : 0.22 * (1 - murk);
    this.sun.castShadow = !Q.perf && !this.noShadow && (sunUp ? dayK > 0.15 && murk < 0.7 : false);
    const lightsOn = dayK < 0.7 || murk >= 0.4;
    for (const p of this.nightLights) p.visible = lightsOn;
    this.clouds(wx);
    this.precip(wx, dt);
    if (this.termGlow) this.termGlow.material.opacity = clamp(0.8 - dayK * 1.1, 0, 0.8);
    if (this.townMat) this.townMat.emissiveIntensity = clamp(0.9 - dayK * 1.2, 0, 0.9);
    setNight(clamp(1 - dayK * 1.4, 0, 1));
    if (this.bmats) for (const m of this.bmats.values()) m.emissiveIntensity = clamp(0.95 - dayK * 1.2, 0, 0.95);
    if (this.radarAnt) this.radarAnt.rotation.y += dt * 1.6;
    if (this.poolMat) this.poolMat.opacity = lightsOn ? clamp(0.55 - dayK * 0.6, 0.08, 0.55) : 0;
    for (const p of this.pools) p.visible = lightsOn;
    this.traffic(dt, dayK < 0.6);
    // Flughafen-Drehfeuer: grün und weiß im Wechsel
    if (this.beacon) {
      const ph = (now * 0.75) % 1;
      this.beacon.visible = lightsOn && (ph < 0.12 || (ph > 0.5 && ph < 0.62));
      this.beacon.material.color.setHex(ph < 0.5 ? 0x4ade80 : 0xffffff);
      this.beacon.scale.setScalar(1.4);
    }
    // Windsack zeigt mit dem Wind, schlaff bei Flaute
    const wind = state.wind || { dir: 270, spd: 5 };
    const to = ((wind.dir + 180) % 360) * DEG;
    for (const s of this.socks) {
      s.rotation.set(0, -(Math.atan2(-Math.cos(to), Math.sin(to))), -(1 - clamp(wind.spd / 15, 0.05, 1)) * 1.2, 'YXZ');
    }
    // Lauffeuer der aktiven Landebahn und PAPI
    for (const [k, list] of Object.entries(this.rabbits)) {
      const act = lightsOn && k.slice(1) === state.rwy && (k[0] === 'N' || this.rwy2);
      const pos = (now * 2) % 1;
      list.forEach((sp, i) => {
        const idx = list.length - 1 - Math.floor(pos * list.length);
        sp.visible = act && i === idx;
        sp.scale.setScalar(1.2);
      });
    }
    const fv = follow && this.vis.get(follow.id), fg = follow && this.acs.get(follow.id);
    const cp = fv && fg ? new THREE.Vector3(fg.position.x, fv.y + 0.02, fg.position.z) : this.camera.position;
    for (const P of this.papis) {
      for (const L of P.papi) {
        const dx = Math.hypot(cp.x - L.sp.position.x, cp.z - L.sp.position.z);
        const ang = Math.atan2(cp.y - L.sp.position.y, Math.max(0.01, dx));
        L.sp.material.color.setHex(ang > L.ang ? 0xffffff : 0xff2a2a);
        L.sp.scale.setScalar(lightsOn ? 0.5 : 0.24);
      }
    }
    // Flugzeuge
    const wet = wx === 'rain' || wx === 'storm' || wx === 'snow';
    this.updateAircraft(state, ride, dt, now, lightsOn, wet);
    // Fahrzeuge
    const vs = new Set();
    for (const v of state.vehicles) {
      vs.add(v.id);
      let m = this.vehs.get(v.id);
      if (!m) {
        m = buildVehicle(v);
        this.scene.add(m);
        this.vehs.set(v.id, m);
      }
      m.position.set(v.x, 0, v.y);
      m.rotation.y = -(v.hdg || 0);
      const b = m.getObjectByName('bcn');
      if (b) b.visible = (lightsOn || v.state !== 'idle') && Math.floor(now * 2.2 + (v.id.length || 0)) % 2 === 0;
    }
    for (const [id, m] of this.vehs) if (!vs.has(id)) (this.scene.remove(m), this.vehs.delete(id));
    this.updateGA(state, dt, now, lightsOn);
    // Schneedecke auf Gras und Feldern (Bahnen und Vorfeld sind geräumt)
    const snow = state.snow || 0;
    this.snowMat.opacity = snow * 0.85;
    this.snowPlane.visible = snow > 0.02;
    this.stepPuffs(dt);
    // Kamera am Flugzeug bzw. im Tower
    this.camera3d(state, ride, follow, dt, lightsOn);
    // Schatten folgen der Kamera (im Turmblick dem Punkt, auf den man schaut); Scheinwerfer des eigenen Flugzeugs
    const tg = follow && this.acs.get(follow.id);
    let center = tg ? tg.position : this.camera.position;
    const wide = ride.mode === 'tower' || (ride.mode === 'cine3d' && !ride.cineChase);
    if (wide) {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const t = dir.y < -0.02 ? Math.min(60, this.camera.position.y / -dir.y) : 40;
      center = this.camera.position.clone().addScaledVector(dir, t);
    }
    const sc = this.sun.shadow.camera, ext = wide ? 48 : 28;
    if (sc.right !== ext) {
      Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext });
      sc.updateProjectionMatrix();
    }
    this.sun.target.position.set(center.x, 0, center.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(ld, 160);
    this.sun.target.updateMatrixWorld();
    const land = tg && tg.getObjectByName('landing');
    if (land && land.visible && lightsOn) {
      const u = tg.userData;
      this.spot.intensity = 30;
      this.spot.position.copy(new THREE.Vector3(u.L * 0.15, -u.ry * 0.6, 0).applyMatrix4(tg.matrixWorld));
      this.spot.target.position.copy(new THREE.Vector3(u.L * 0.15 + 12, -u.H - 3, 0).applyMatrix4(tg.matrixWorld));
      this.spot.target.updateMatrixWorld();
    } else this.spot.intensity = 0;
    this.renderer.render(this.scene, this.camera);
  }

  // Augenpunkt in der Tower-Kanzel
  towerEye() {
    const p = this.towerPos || new THREE.Vector3(76.4, 6.1, 7.45);
    return new THREE.Vector3(p.x, p.y + 0.06, p.z);
  }
  // Schild-Position für Kleinverkehr (Hubschrauber, Cessna)
  screenOfGA(kind) {
    const g = kind === 'heli' ? this.heli : this.cessna;
    if (!g || !g.visible) return null;
    const v = g.position.clone();
    v.y += 0.18;
    v.project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    const r = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * r.clientWidth, y: ((1 - v.y) / 2) * r.clientHeight };
  }
  acPos(id) {
    const g = this.acs.get(id);
    return g ? g.position : null;
  }
  // Bildschirmposition über einem Flugzeug (für Rufzeichen-Schilder); null, wenn nicht im Bild
  screenOf(id) {
    const g = this.acs.get(id);
    if (!g || !g.visible) return null;
    const v = g.position.clone();
    v.y += g.userData.ry * 2.2;
    const d = v.distanceTo(this.camera.position);
    v.project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    const r = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * r.clientWidth, y: ((1 - v.y) / 2) * r.clientHeight, far: d > 120 };
  }
  // Flugzeug unter dem Mauszeiger: nächstes zum Sichtstrahl, großzügig auch bei kleinen Flugzeugen in der Ferne
  pick(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray = this.ray || new THREE.Raycaster();
    this.ray.setFromCamera(v, this.camera);
    let best = null, bd = Infinity;
    for (const [id, g] of this.acs) {
      if (!g.visible) continue;
      const dist = g.position.distanceTo(this.camera.position);
      const tol = Math.max(g.userData.L * 0.6, dist * Math.tan((this.camera.fov * DEG) / 40));
      if (this.ray.ray.distanceToPoint(g.position) < tol && dist < bd) (bd = dist, (best = id));
    }
    return best;
  }

  camera3d(state, ride, ac, dt) {
    const cam = this.camera;
    // in der Kanzel: Dach und Mast nicht von innen zeichnen
    if (this.towerRoof) for (const m of this.towerRoof) m.visible = ride.mode !== 'tower';
    if (ride.mode === 'cine3d' && !ride.cineChase && ride.camPos) {
      const c = ride.camPos, l = ride.camLook || { x: 40, y: 0, z: 30 };
      cam.position.set(c.x, c.y, c.z);
      cam.up.set(0, 1, 0);
      cam.lookAt(l.x, l.y, l.z);
      cam.fov = ride.fov || 45;
      cam.updateProjectionMatrix();
      return;
    }
    if (ride.mode === 'tower') {
      const p = this.towerEye();
      const yw = (ride.yaw || 0) * DEG, pt = (ride.pitch || 0) * DEG;
      cam.position.copy(p);
      cam.up.set(0, 1, 0);
      cam.lookAt(p.x + Math.cos(yw) * Math.cos(pt) * 10, p.y - Math.sin(pt) * 10, p.z + Math.sin(yw) * Math.cos(pt) * 10);
      cam.fov = ride.fov || 55;
      cam.updateProjectionMatrix();
      return;
    }
    if (!ac) return;
    const g = this.acs.get(ac.id);
    const yaw = (ride.yaw || 0) * DEG, pit = (ride.pitch || 0) * DEG;
    if (!g) return;
    g.updateMatrixWorld();
    const u = g.userData;
    if (ride.mode === 'cockpit' || ride.mode === 'window') {
      const e = u.eye;
      const local = ride.mode === 'cockpit' ? new THREE.Vector3(e.cockpitX, e.cockpitY, 0) : new THREE.Vector3(e.winX, e.winY, e.winZ);
      cam.position.copy(local.applyMatrix4(g.matrixWorld));
      // Blick: Flugzeuglage (Neigung, Querlage) und freie Drehung; -z der Kamera zeigt nach vorn (+x des Flugzeugs)
      const q = g.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2 - yaw, 0))).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-pit, 0, 0)));
      cam.quaternion.copy(q);
      cam.fov = ride.mode === 'cockpit' ? 64 : 58;
      // Rütteln auf der Bahn und beim Aufsetzen
      const v = this.vis.get(ac.id);
      const ground = v && v.y < 0.02 && ac.mode === 'map';
      const sh = (ground ? Math.min(0.006, (ac.v || 0) * 0.008) : 0) + (this.bump || 0) * 0.02;
      this.bump = Math.max(0, (this.bump || 0) - dt * 1.4);
      if (sh) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    } else {
      const d = (u.L * 2.6) / (ride.zoomK || 1);
      const hdg = Math.atan2(-g.matrixWorld.elements[2], g.matrixWorld.elements[0]) * -1;
      const dir = hdg + Math.PI + yaw;
      const el = Math.max(2, ride.pitch || 16) * DEG;
      const p = g.position;
      cam.position.set(p.x + Math.cos(dir) * Math.cos(el) * d, Math.max(0.15, p.y + Math.sin(el) * d), p.z + Math.sin(dir) * Math.cos(el) * d);
      cam.up.set(0, 1, 0);
      cam.lookAt(p.x, p.y, p.z);
      cam.fov = 55;
    }
    cam.updateProjectionMatrix();
  }
}
