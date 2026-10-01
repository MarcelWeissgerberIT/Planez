// 3D-Modelle für die WebGL-Ansicht: Flugzeuge je Bauart (Schmal- und Großraum, A380, 747-Frachter, Turboprop mit
// Propellern, Regionaljet und Businessjet mit Hecktriebwerken und T-Leitwerk) – Rumpf mit Bug- und Heckform, gepfeilte
// Tragflächen mit Winglets, Triebwerksgondeln mit Einlauf, Fahrwerk, Leitwerk mit Airline-Logo. Die Lackierung (Fenster,
// Türen, Zierstreifen, Bauch, Schriftzug, Cockpitscheiben) wird auf eine Canvas-Textur gemalt. Je Typ und Airline wird ein
// Modell einmal gebaut (Teile je Material zu einem Netz verschmolzen) und dann geklont. Dazu Positions-, Blitz-,
// Kollisionswarn- und Landelichter, die die Ansicht je nach Phase und Tageszeit schaltet. 1 Einheit = 1 Kachel (20 m).
import * as THREE from '../vendor/three.module.min.js';
import { AC_TYPES, AIRLINES } from '../config.js';

const DEG = Math.PI / 180;

// Bauarten: Rumpfradius r und Höhenfaktor kh (je Länge L), Spannweite, Pfeilung, Flügeltiefe innen/außen, Lage
// der Fläche, V-Stellung, Triebwerke (Anteil der Halbspannweite), Gondelradius/-länge, Winglet, Höhenleitwerk, Bodenfreiheit
const KIND = {
  narrow: { r: 0.053, kh: 1.06, span: 0.95, sweep: 25, cr: 0.21, ct: 0.065, wx: 0.1, dih: 5, eng: [0.34], er: 0.032, el: 0.15, winglet: 0.05, stab: 0.17, h: 1.95, gearZ: 0.1, wheel: 0.016 },
  wide: { r: 0.048, kh: 1.06, span: 0.97, sweep: 31, cr: 0.22, ct: 0.05, wx: 0.08, dih: 6, eng: [0.33], er: 0.03, el: 0.14, winglet: 0, stab: 0.16, h: 2.05, gearZ: 0.085, wheel: 0.012, bogie: true },
  super: { r: 0.05, kh: 1.28, span: 1.08, sweep: 33, cr: 0.27, ct: 0.055, wx: 0.08, dih: 5, eng: [0.3, 0.56], er: 0.021, el: 0.12, winglet: 0.03, stab: 0.2, h: 2.0, gearZ: 0.08, wheel: 0.011, bogie: true },
  jumbo: { r: 0.045, kh: 1.06, span: 0.9, sweep: 37, cr: 0.22, ct: 0.05, wx: 0.08, dih: 6, eng: [0.31, 0.57], er: 0.021, el: 0.12, winglet: 0, stab: 0.15, h: 2.1, gearZ: 0.075, wheel: 0.011, bogie: true, hump: true },
  prop: { r: 0.05, kh: 1.05, span: 1.0, sweep: 2, cr: 0.11, ct: 0.065, wx: 0.07, dih: 0, high: true, eng: [0.3], er: 0.026, el: 0.22, prop: true, stab: 0.13, tTail: true, h: 1.5, gearZ: 0.075, wheel: 0.018 },
  rear: { r: 0.042, kh: 1.05, span: 0.69, sweep: 26, cr: 0.17, ct: 0.05, wx: 0.0, dih: 4, rearEng: true, er: 0.024, el: 0.13, winglet: 0.05, stab: 0.13, tTail: true, h: 1.45, gearZ: 0.08, wheel: 0.016 },
  biz: { r: 0.052, kh: 1.05, span: 1.05, sweep: 28, cr: 0.2, ct: 0.07, wx: -0.02, dih: 3, rearEng: true, er: 0.034, el: 0.17, winglet: 0.06, stab: 0.17, tTail: true, h: 1.5, gearZ: 0.1, wheel: 0.02 },
};
const KIND_OF = { AT76: 'prop', DH8D: 'prop', CRJ9: 'rear', C68A: 'biz', A388: 'super', B748F: 'jumbo', B789: 'wide', A359: 'wide', B77W: 'wide', B77F: 'wide', A333: 'wide' };
const R_OF = { E190: 0.045, A223: 0.048, B77W: 0.044, B77F: 0.046 };

export function specOf(type) {
  const k = KIND[KIND_OF[type] || 'narrow'];
  return R_OF[type] ? { ...k, r: R_OF[type] } : k;
}

// ---------- Geometrie-Helfer ----------
// Röhre aus Ringen [x, Mitte y, Radius y, Radius z]; UV: u entlang (0 = hinten), v rundherum (0 = oben, 0,25 = rechts)
function tube(rings, seg = 20) {
  const pos = [], uv = [], idx = [];
  const x0 = rings[0][0], x1 = rings[rings.length - 1][0];
  for (const [x, yc, ry, rz] of rings) {
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(x, yc + Math.cos(a) * ry, Math.sin(a) * rz);
      uv.push((x - x0) / (x1 - x0 || 1), j / seg);
    }
  }
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Naht schließen: Normalen am ersten und letzten Punkt jedes Rings mitteln
  const n = g.attributes.normal;
  for (let i = 0; i < rings.length; i++) {
    const a = i * (seg + 1), b = a + seg;
    const v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
  return g;
}

// Platte aus vier Eckpunkten (Wurzel-Vorderkante, Spitze-Vorderkante, Spitze-Hinterkante, Wurzel-Hinterkante) mit
// Dicke t0 an der Wurzel und t1 an der Spitze entlang der Achse ax ('y' für Flügel, 'z' für das Seitenleitwerk)
function slab(c, t0, t1, ax = 'y') {
  const off = (p, t, s) => (ax === 'y' ? [p[0], p[1] + (s * t) / 2, p[2]] : [p[0], p[1], p[2] + (s * t) / 2]);
  const th = [t0, t1, t1 * 0.5, t0 * 0.5]; // Hinterkante dünner
  const T = c.map((p, i) => off(p, th[i], 1)), B = c.map((p, i) => off(p, th[i], -1));
  const q = [];
  const quad = (a, b, cc, d) => q.push(a, b, cc, a, cc, d);
  quad(T[0], T[1], T[2], T[3]);
  quad(B[3], B[2], B[1], B[0]);
  quad(B[0], B[1], T[1], T[0]);
  quad(T[3], T[2], B[2], B[3]);
  quad(B[1], B[2], T[2], T[1]);
  quad(B[3], B[0], T[0], T[3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(q.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((q.length) * 2).fill(0), 2));
  g.computeVertexNormals();
  return g;
}

// Teile mit gleichem Material zu einem Netz verschmelzen (weniger Draw-Calls bei vielen Flugzeugen)
export function merge(parts) {
  const geos = parts.map(([geo, m]) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g;
  });
  const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3), U = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    U.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.computeBoundingSphere();
  return out;
}

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));

// ---------- Texturen ----------
let _glow = null;
export function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return (_glow = new THREE.CanvasTexture(c));
}

let _beam = null;
function beamTex() {
  if (_beam) return _beam;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 128;
  const g = c.getContext('2d');
  const r = g.createLinearGradient(0, 0, 0, 128);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 8, 128);
  return (_beam = new THREE.CanvasTexture(c));
}

// Lackierung: u = entlang des Rumpfs (links Heck, rechts Bug), v = rundherum (oben 0, rechts 64, Bauch 128, links 192)
function livery(type, al, L, k) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  const col = al.color || '#1d4ed8', col2 = al.color2 || '#ffffff';
  const cargo = !(AC_TYPES[type] || {}).pax;
  g.fillStyle = '#f5f7f9';
  g.fillRect(0, 0, 1024, 256);
  // Bauch hellgrau
  g.fillStyle = '#cfd5dc';
  g.fillRect(0, 100, 1024, 56);
  // Zierstreifen unter den Fenstern (rechts und links), hinten breiter in Airline-Farbe
  g.fillStyle = col;
  g.fillRect(150, 66, 760, 7);
  g.fillRect(150, 183, 760, 7);
  g.fillStyle = col2 === '#ffffff' || col2 === '#f8fafc' ? '#94a3b8' : col2;
  g.fillRect(150, 75, 760, 3);
  g.fillRect(150, 178, 760, 3);
  // Heck: Airline-Farbe zieht sich über den Rücken bis zum Leitwerk
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(150, 0);
  g.lineTo(70, 60);
  g.lineTo(0, 70);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(150, 256);
  g.lineTo(70, 196);
  g.lineTo(0, 186);
  g.closePath();
  g.fill();
  // Kabinenfenster (Abstand ≈ 0,5 m), Frachter ohne; nachts leuchten sie warm (eigene Leuchttextur, manche Blenden zu)
  const ratio = (8 * Math.PI * k.r * k.kh) / 1; // Streckung der Textur entlang/rundherum
  const pitch = (1024 * 0.026) / L;
  const ww = Math.max(2, 4.2 / ratio * 1.4), wh = 5;
  const ec = document.createElement('canvas');
  ec.width = 1024;
  ec.height = 256;
  const e = ec.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, 1024, 256);
  let n = 7;
  const lit = () => ((n = (n * 16807) % 2147483647) / 2147483647) > 0.18;
  const win = (x, y, w, h) => {
    g.fillRect(x, y, w, h);
    if (lit()) (e.fillStyle = '#ffd59a', e.fillRect(x, y, w, h));
  };
  g.fillStyle = '#1e293b';
  if (!cargo) {
    for (let x = 200; x < 850; x += pitch) {
      if (Math.abs(x - 470) < pitch * 1.2 && k.wx > 0) continue; // Notausgang über der Fläche
      win(x, 53, ww, wh);
      win(x, 198, ww, wh);
    }
    if (k.hump || k.kh > 1.2) for (let x = 600; x < (k.hump ? 860 : 830); x += pitch) {
      win(x, 30, ww, wh - 1);
      win(x, 222, ww, wh - 1);
    }
  }
  // Cockpit nachts schwach beleuchtet
  e.fillStyle = '#3b4a66';
  for (const [v0, v1] of [[0, 21], [24, 44], [212, 232], [235, 256]]) e.fillRect(926, v0, 20, v1 - v0);
  // Türen
  g.strokeStyle = '#94a3b8';
  g.lineWidth = 1.5;
  const door = (x) => {
    g.strokeRect(x, 40, 10 / ratio * 2.2, 26);
    g.strokeRect(x, 190, 10 / ratio * 2.2, 26);
  };
  door(870);
  door(185);
  if (!cargo && L > 3) door(560);
  if (cargo) door(860), g.strokeRect(300, 36, 60, 34), g.strokeRect(300, 186, 60, 34);
  // Cockpitscheiben
  g.fillStyle = '#0b1220';
  for (const [v0, v1] of [[0, 21], [24, 44], [212, 232], [235, 256]]) g.fillRect(926, v0, 20, v1 - v0);
  g.fillRect(926, 0, 20, 3);
  // Schriftzug über den Fenstern
  const name = al.name || '';
  g.fillStyle = col;
  g.font = `bold ${k.kh > 1.2 ? 22 : 19}px "Segoe UI", Arial, sans-serif`;
  g.textBaseline = 'middle';
  g.save();
  g.translate(520, 34);
  g.scale(Math.min(2.2, ratio * 1.05), 1);
  g.fillText(name, 0, 0);
  g.restore();
  g.save();
  g.translate(520 + g.measureText(name).width * Math.min(2.2, ratio * 1.05), 222);
  g.rotate(Math.PI);
  g.scale(Math.min(2.2, ratio * 1.05), 1);
  g.fillText(name, 0, 0);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const et = new THREE.CanvasTexture(ec);
  et.flipY = false;
  et.colorSpace = THREE.SRGBColorSpace;
  return { map: t, glow: et };
}

// Nachtbeleuchtung aller Modelle: Kabinenfenster und angestrahlte Leitwerke (0 = Tag, 1 = Nacht)
const NIGHT = { fus: [], tail: [] };
export function setNight(k) {
  for (const m of NIGHT.fus) m.emissiveIntensity = k * 1.1;
  for (const m of NIGHT.tail) m.emissiveIntensity = k * 0.35;
}

// Logo fürs Seitenleitwerk: Kreis in der Zweitfarbe mit dem Airline-Kürzel
function logoTex(al) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = al.color2 || '#ffffff';
  g.beginPath();
  g.arc(64, 64, 46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = al.color || '#1d4ed8';
  g.font = 'bold 40px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText((al.code || '').slice(0, 3), 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAT = new Map();
function mat(key, make) {
  if (!MAT.has(key)) MAT.set(key, make());
  return MAT.get(key);
}
const phong = (color, shin = 40) => mat(`p${color}|${shin}`, () => new THREE.MeshPhongMaterial({ color, shininess: shin, specular: 0x555555, side: THREE.DoubleSide }));
const lamb = (color) => mat(`l${color}`, () => new THREE.MeshLambertMaterial({ color }));
export function spriteMat(color) {
  return mat(`s${color}`, () => new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
}

// ---------- Flugzeug ----------
const TEMPL = new Map();

export function buildAircraft(ac) {
  const key = `${ac.type}|${ac.airline}`;
  const tt = AC_TYPES[ac.type];
  if (!TEMPL.has(key)) TEMPL.set(key, tt && (tt.light || ac.type === 'PC12') ? lightTemplate(ac.type, ac.airline) : template(ac.type, ac.airline));
  const g = TEMPL.get(key).clone();
  return g;
}

function template(type, airline) {
  const t = AC_TYPES[type] || AC_TYPES.A320;
  const al = AIRLINES[airline] || {};
  const k = specOf(type);
  const L = t.len;
  const rz = k.r * L, ry = rz * k.kh;
  const H = k.h * ry; // Rumpfachse über dem Boden
  const root = new THREE.Group();
  const white = [], gray = [], dark = [], tailc = [], metal = [], flaps = [], flapsDn = [], spoil = [], rev = [];

  // Rumpf: Heck hochgezogen und verjüngt, zylindrische Mitte, runder Bug
  const rings = [];
  const tailPts = [[-0.5, 0.62, 0.08], [-0.47, 0.55, 0.22], [-0.42, 0.44, 0.42], [-0.36, 0.3, 0.64], [-0.3, 0.16, 0.82], [-0.24, 0.05, 0.95], [-0.19, 0, 1]];
  for (const [x, yc, r] of tailPts) rings.push([x * L, yc * ry, r * ry, r * rz]);
  rings.push([0.3 * L, 0, ry, rz]);
  const noseL = (k.prop ? 0.16 : 0.19) * L;
  for (const s of [0.2, 0.42, 0.6, 0.75, 0.86, 0.94, 0.985, 1]) {
    const r = Math.sqrt(Math.max(0, 1 - s * s));
    rings.push([0.3 * L + s * noseL, -0.18 * ry * s * s, Math.max(0.001, r * ry), Math.max(0.001, r * rz)]);
  }
  const lv = livery(type, al, L, k);
  const fusMat = new THREE.MeshPhongMaterial({ map: lv.map, emissiveMap: lv.glow, emissive: 0xffffff, emissiveIntensity: 0, shininess: 55, specular: 0x666666 });
  NIGHT.fus.push(fusMat);
  const fus = new THREE.Mesh(tube(rings, 24), fusMat);
  fus.castShadow = true;
  fus.receiveShadow = true;
  root.add(fus);
  // Buckel (747-Oberdeck)
  if (k.hump) {
    const hr = [];
    for (const [x, r] of [[0.02, 0.05], [0.08, 0.42], [0.16, 0.6], [0.26, 0.62], [0.33, 0.52], [0.38, 0.3], [0.41, 0.05]]) hr.push([x * L, ry * 0.55, r * ry, r * rz * 1.1]);
    white.push([tube(hr, 16), M4()]);
  }

  // Tragflächen
  const b = (k.span * L) / 2, z0 = rz * 0.6;
  const wy = k.high ? ry * 0.86 : -ry * 0.55;
  const rLE = k.wx * L, tLE = rLE - (b - z0) * Math.tan(k.sweep * DEG);
  const rTE = rLE - k.cr * L, tTE = tLE - k.ct * L;
  const ty = wy + (b - z0) * Math.tan(k.dih * DEG);
  const wingAt = (z) => {
    const f = (z - z0) / (b - z0);
    return { le: rLE + (tLE - rLE) * f, te: rTE + (tTE - rTE) * f, y: wy + (ty - wy) * f };
  };
  for (const s of [-1, 1]) {
    gray.push([slab([[rLE, wy, s * z0], [tLE, ty, s * b], [tTE, ty, s * b], [rTE, wy, s * z0]], k.cr * L * 0.11, k.ct * L * 0.09), M4()]);
    // Landeklappen (innen) und Querruder (außen) als dunklere Flächen auf der Hinterkante – gibt der Fläche Struktur
    const at = (f) => ({ le: rLE + (tLE - rLE) * f, te: rTE + (tTE - rTE) * f, y: wy + (ty - wy) * f, z: z0 + (b - z0) * f });
    const flap = (f0, f1, depth) => {
      const a = at(f0), c = at(f1);
      const lift = k.cr * L * 0.05;
      return slab([[a.te + (a.le - a.te) * depth, a.y + lift, s * a.z], [c.te + (c.le - c.te) * depth, c.y + lift * 0.7, s * c.z], [c.te, c.y + lift * 0.5, s * c.z], [a.te, a.y + lift * 0.6, s * a.z]], k.cr * L * 0.012, k.ct * L * 0.01);
    };
    flaps.push([flap(0.04, 0.68, 0.28), M4()], [flap(0.7, 0.94, 0.24), M4()]);
    // ausgefahrene Landeklappen (Start/Landung): nach hinten unten aus der Hinterkante; Störklappen (nach dem Aufsetzen)
    {
      const a = at(0.04), c = at(0.68);
      const ca = a.le - a.te, cc = c.le - c.te;
      flapsDn.push([slab([[a.te + ca * 0.06, a.y - ca * 0.03, s * a.z], [c.te + cc * 0.06, c.y - cc * 0.03, s * c.z], [c.te - cc * 0.26, c.y - cc * 0.16, s * c.z], [a.te - ca * 0.26, a.y - ca * 0.16, s * a.z]], ca * 0.03, cc * 0.03), M4()]);
      const p = at(0.14), q = at(0.66);
      const cp = p.le - p.te, cq = q.le - q.te;
      const top = k.cr * L * 0.055;
      spoil.push([slab([[p.te + cp * 0.48, p.y + top, s * p.z], [q.te + cq * 0.48, q.y + top * 0.7, s * q.z], [q.te + cq * 0.3, q.y + top * 0.7 + cq * 0.13, s * q.z], [p.te + cp * 0.3, p.y + top + cp * 0.13, s * p.z]], cp * 0.012, cq * 0.012), M4()]);
    }
    // Vorflügel an der Vorderkante (metallisch)
    {
      const a = at(0.06), c = at(0.97);
      const lift = k.cr * L * 0.058;
      metal.push([slab([[a.le, a.y + lift, s * a.z], [c.le, c.y + lift * 0.7, s * c.z], [c.le - (c.le - c.te) * 0.13, c.y + lift * 0.7, s * c.z], [a.le - (a.le - a.te) * 0.12, a.y + lift, s * a.z]], k.cr * L * 0.01, k.ct * L * 0.008), M4()]);
    }
    // Klappenführungen unter der Hinterkante
    // (schlanke „Kanus“ in Flügelfarbe, hinten über die Hinterkante hinaus)
    if (!k.high) for (const f of [0.25, 0.45, 0.62]) {
      const a = at(f), fl = k.cr * L * (0.42 - f * 0.25), fr = k.cr * L * 0.028;
      gray.push([tube([[-fl * 0.5, 0, fr * 0.15, fr * 0.15], [-fl * 0.3, 0, fr * 0.8, fr * 0.7], [0, 0, fr, fr * 0.8], [fl * 0.35, 0, fr * 0.7, fr * 0.6], [fl * 0.5, 0, fr * 0.1, fr * 0.1]], 8), M4(a.te + fl * 0.1, a.y - fr * 0.7, s * a.z)]);
    }
    // Flügelwurzel-Verkleidung
    if (!k.high) white.push([slab([[rLE + 0.02 * L, wy + ry * 0.12, s * rz * 0.75], [rLE - 0.04 * L, wy, s * (z0 + rz * 0.5)], [rTE - 0.03 * L, wy, s * (z0 + rz * 0.4)], [rTE - 0.05 * L, wy + ry * 0.1, s * rz * 0.75]], ry * 0.3, ry * 0.1), M4()]);
    if (k.winglet) white.push([slab([[tLE, ty, s * b], [tLE - k.winglet * L * 0.7, ty + k.winglet * L, s * (b + 0.004 * L)], [tLE - k.winglet * L * 0.7 - k.ct * L * 0.4, ty + k.winglet * L, s * (b + 0.004 * L)], [tTE, ty, s * b]], 0.006 * L, 0.003 * L, 'z'), M4()]);
  }

  // Triebwerke
  const er = k.er * L, el = k.el * L;
  const nacelle = (x, y, z, prop) => {
    const rr = prop
      ? [[-el, 0, 0.35, 0.35], [-el * 0.6, 0, 0.9, 0.8], [-el * 0.2, 0, 1, 0.85], [0, 0, 0.75, 0.7], [el * 0.06, 0, 0.3, 0.3]]
      : [[-el, 0, 0.45, 0.45], [-el * 0.78, 0, 0.82, 0.82], [-el * 0.4, 0, 1, 1], [-el * 0.08, 0, 1, 1], [0, 0, 0.93, 0.93]];
    white.push([tube(rr.map(([a, yy, s1, s2]) => [a, yy, s1 * er, s2 * er]), 28), M4(x, y, z)]);
    if (!prop) {
      dark.push([new THREE.CircleGeometry(er * 0.86, 28), M4(x - el * 0.02, y, z, 0, Math.PI / 2, 0)]);
      metal.push([new THREE.ConeGeometry(er * 0.26, er * 0.5, 10), M4(x - el * 0.02 + er * 0.2, y, z, 0, 0, -Math.PI / 2)]);
      dark.push([new THREE.CircleGeometry(er * 0.42, 12), M4(x - el + 0.001, y, z, 0, -Math.PI / 2, 0)]);
      // Schubumkehr: geöffneter Spalt in der Gondel (nur beim Ausrollen sichtbar)
      rev.push([tube([[-el * 0.62, 0, er * 1.03, er * 1.03], [-el * 0.5, 0, er * 1.08, er * 1.08]], 14), M4(x, y, z)]);
    }
  };
  const props = [];
  if (k.rearEng) {
    const x = -0.3 * L, y = ry * 0.38;
    for (const s of [-1, 1]) {
      const z = s * (rz + er * 1.25);
      nacelle(x + el * 0.5, y, z, false);
      gray.push([slab([[x + el * 0.1, y, s * rz * 0.7], [x + el * 0.05, y, z], [x - el * 0.3, y, z], [x - el * 0.35, y, s * rz * 0.7]], er * 0.35, er * 0.3), M4()]);
    }
  } else {
    for (const s of [-1, 1])
      for (const f of k.eng) {
        const z = s * b * f;
        const w = wingAt(Math.abs(z));
        if (k.prop) {
          const fx = w.le + el * 0.42, y = w.y - er * 0.35;
          nacelle(fx, y, z, true);
          // Propeller: Nabe und sechs Blätter, dreht sich im Betrieb
          const pg = new THREE.Group();
          pg.name = 'prop';
          pg.position.set(fx + el * 0.07, y, z);
          const hub = new THREE.Mesh(new THREE.ConeGeometry(er * 0.38, er * 0.9, 12), phong(0x334155));
          hub.rotation.z = -Math.PI / 2;
          pg.add(hub);
          const blade = new THREE.BoxGeometry(0.004 * L, 0.072 * L, 0.012 * L);
          blade.translate(0, 0.036 * L, 0);
          for (let i = 0; i < 6; i++) {
            const m = new THREE.Mesh(blade, phong(0x1f2937, 10));
            m.rotation.x = (i / 6) * Math.PI * 2;
            pg.add(m);
          }
          const disc = new THREE.Mesh(new THREE.CircleGeometry(0.072 * L, 24), mat('pdisc', () => new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })));
          disc.rotation.y = Math.PI / 2;
          disc.name = 'disc';
          disc.visible = false;
          pg.add(disc);
          props.push(pg);
        } else {
          const fx = w.le + el * 0.55, y = w.y - er * 1.3;
          nacelle(fx, y, z, false);
          // Pylon zur Fläche
          gray.push([slab([[fx - el * 0.25, y + er * 0.6, z], [fx - el * 0.25, w.y, z], [fx - el * 1.0, w.y, z], [fx - el * 0.95, y + er * 0.6, z]], er * 0.25, er * 0.22, 'z'), M4()]);
        }
      }
  }

  // Seitenleitwerk in Airline-Farbe, Höhenleitwerk
  const hF = (t.finH || 0.45) * 0.8;
  const fLE = -0.27 * L, fy = ry * 0.85;
  const fSweep = k.tTail ? 42 : 38;
  const ftLE = fLE - hF * Math.tan(fSweep * DEG), fc = (k.tTail ? 0.22 : 0.2) * L, ftc = (k.tTail ? 0.13 : 0.09) * L;
  tailc.push([slab([[fLE, fy, 0], [ftLE, fy + hF, 0], [ftLE - ftc, fy + hF, 0], [fLE - fc, fy, 0]], 0.014 * L, 0.008 * L, 'z'), M4()]);
  const sb = k.stab * L;
  const sy = k.tTail ? fy + hF : ry * 0.35;
  const sLE = k.tTail ? ftLE + 0.01 * L : -0.36 * L;
  const sc = (k.tTail ? 0.1 : 0.12) * L;
  for (const s of [-1, 1]) gray.push([slab([[sLE, sy, s * (k.tTail ? 0 : rz * 0.25)], [sLE - sb * Math.tan(30 * DEG), sy + sb * Math.tan((k.tTail ? 2 : 6) * DEG), s * sb], [sLE - sb * Math.tan(30 * DEG) - sc * 0.4, sy + sb * Math.tan((k.tTail ? 2 : 6) * DEG), s * sb], [sLE - sc, sy, s * (k.tTail ? 0 : rz * 0.25)]], sc * 0.1, sc * 0.05), M4()]);
  // Logo auf beiden Seiten des Leitwerks
  const lt = logoTex(al);
  const ls = Math.min(hF * 0.55, (fc + ftc) * 0.42);
  const lx = (fLE + ftLE) / 2 - (fc + ftc) / 4, ly = fy + hF * 0.5;
  for (const s of [-1, 1]) {
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(ls, ls), new THREE.MeshPhongMaterial({ map: lt, transparent: true, shininess: 30, depthWrite: false }));
    lm.position.set(lx, ly, s * (0.006 * L));
    lm.rotation.y = s > 0 ? 0 : Math.PI;
    root.add(lm);
  }

  // Netze je Material
  const add = (arr, m) => {
    if (!arr.length) return;
    const mesh = new THREE.Mesh(merge(arr), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  add(white, phong(0xf3f5f7, 50));
  add(gray, phong(0xd3dae1, 45));
  add(flaps, phong(0xaeb7c1, 30));
  // bewegliche Teile als eigene Netze, die die Ansicht je Phase zeigt
  const part = (arr, m, name) => {
    if (!arr.length) return;
    const mesh = new THREE.Mesh(merge(arr), m);
    mesh.name = name;
    mesh.visible = false;
    mesh.castShadow = true;
    root.add(mesh);
  };
  part(flapsDn, phong(0xb8c0c9, 30), 'flapsDn');
  part(spoil, phong(0xc7ced6, 30), 'spoilers');
  part(rev, lamb(0x0b0f17), 'reverse');
  add(dark, lamb(0x111827));
  add(metal, phong(0xc0c7cf, 90));
  // Leitwerk: eigenes Material, nachts vom Logo-Scheinwerfer angestrahlt
  const tm = new THREE.MeshPhongMaterial({ color: al.color || '#1d4ed8', shininess: 45, specular: 0x555555, side: THREE.DoubleSide, emissive: al.color || '#1d4ed8', emissiveIntensity: 0 });
  NIGHT.tail.push(tm);
  add(tailc, tm);
  for (const p of props) root.add(p);

  // Fahrwerk: helle Federbeine mit Gelenkstreben, Reifen mit Felgen, Fahrwerksklappen (Gruppe 'gear')
  const gear = [], tires = [], hubs = [], doors = [], wr = k.wheel * L * 1.1;
  const strut = (x, z, top) => {
    const len = top - (-H + wr);
    gear.push([new THREE.CylinderGeometry(wr * 0.22, wr * 0.26, len, 8), M4(x, -H + wr + len / 2, z)]);
    gear.push([new THREE.CylinderGeometry(wr * 0.1, wr * 0.1, len * 0.75, 6), M4(x - wr * 0.9, -H + wr + len * 0.55, z, 0, 0, 0.5)]);
    return len;
  };
  const wheel = (x, z) => {
    tires.push([new THREE.CylinderGeometry(wr, wr, wr * 0.8, 16), M4(x, -H + wr, z, Math.PI / 2, 0, 0)]);
    hubs.push([new THREE.CylinderGeometry(wr * 0.55, wr * 0.55, wr * 0.84, 10), M4(x, -H + wr, z, Math.PI / 2, 0, 0)]);
  };
  const nx = 0.36 * L;
  const nl = strut(nx, 0, -ry * 0.7);
  wheel(nx, wr * 0.45);
  wheel(nx, -wr * 0.45);
  for (const s of [-1, 1]) doors.push([new THREE.BoxGeometry(wr * 3.2, nl * 0.55, wr * 0.08), M4(nx - wr * 0.6, -ry * 0.7 - nl * 0.25, s * wr * 1.25)]);
  const mx = k.high ? rTE + k.cr * L * 0.25 : rTE + k.cr * L * 0.3;
  const gz = k.gearZ * L;
  for (const s of [-1, 1]) {
    const ml = strut(mx, s * gz, k.high ? -ry * 0.6 : wy);
    if (k.bogie) {
      // 777: Drehgestell mit drei Achsen, sonst zwei
      const ax = type.startsWith('B77') ? [-wr * 2.25, 0, wr * 2.25] : [-wr * 1.15, wr * 1.15];
      for (const dx of ax) (wheel(mx + dx, s * gz + wr * 0.5), wheel(mx + dx, s * gz - wr * 0.5));
      gear.push([new THREE.BoxGeometry(wr * (ax.length > 2 ? 5.6 : 3.4), wr * 0.3, wr * 0.3), M4(mx, -H + wr, s * gz)]);
    } else (wheel(mx, s * gz + wr * 0.5), wheel(mx, s * gz - wr * 0.5));
    doors.push([new THREE.BoxGeometry(wr * 2.6, ml * 0.7, wr * 0.08), M4(mx, -H + wr * 2 + ml * 0.4, s * (gz + wr * 1.15), 0.08 * s, 0, 0)]);
  }
  const gm = new THREE.Group();
  gm.name = 'gear';
  for (const [arr, m] of [[gear, phong(0xc3c9d0, 60)], [tires, lamb(0x15171a)], [hubs, phong(0xd9dee4, 90)], [doors, phong(0xe9edf1, 45)]]) {
    const mesh = new THREE.Mesh(merge(arr), m);
    mesh.castShadow = true;
    gm.add(mesh);
  }
  root.add(gm);

  // Lichter (Sprites, additiv) – die Ansicht schaltet sie
  const sprite = (name, color, x, y, z) => {
    const sp = new THREE.Sprite(spriteMat(color));
    sp.name = name;
    sp.position.set(x, y, z);
    sp.scale.setScalar(0.1);
    root.add(sp);
    return sp;
  };
  sprite('navL', 0xff2a2a, tLE - k.ct * L * 0.3, ty, -b - 0.01);
  sprite('navR', 0x2aff6a, tLE - k.ct * L * 0.3, ty, b + 0.01);
  sprite('navT', 0xffffff, -0.5 * L - 0.01, 0.62 * ry, 0);
  sprite('bcnT', 0xff3020, 0, ry + 0.01, 0);
  sprite('bcnB', 0xff3020, 0.05 * L, -ry - 0.01, 0);
  sprite('strL', 0xffffff, tLE - k.ct * L * 0.5, ty, -b - 0.012);
  sprite('strR', 0xffffff, tLE - k.ct * L * 0.5, ty, b + 0.012);
  sprite('strT', 0xffffff, -0.5 * L - 0.012, 0.62 * ry, 0);
  // Landescheinwerfer mit Lichtkegel, Rollscheinwerfer am Bugfahrwerk
  const beamMat = mat('beam', () => new THREE.MeshBasicMaterial({ color: 0xfff3d6, map: beamTex(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const lights = new THREE.Group();
  lights.name = 'landing';
  const beamLen = 9;
  for (const s of [-1, 1]) {
    const z = s * (rz + (k.high ? 0.06 : 0.03) * L);
    const w = wingAt(Math.abs(z));
    const p = new THREE.Vector3(w.le + 0.01, w.y - 0.005, z);
    const sp = new THREE.Sprite(spriteMat(0xfff4dc));
    sp.position.copy(p);
    sp.scale.setScalar(0.35);
    sp.name = 'lglare';
    lights.add(sp);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.25, beamLen, 18, 1, true), beamMat);
    cone.rotation.z = Math.PI / 2;
    cone.position.set(beamLen / 2, 0, 0);
    const bg = new THREE.Group();
    bg.position.copy(p);
    bg.rotation.set(0, -s * 2 * DEG, -4 * DEG);
    bg.add(cone);
    lights.add(bg);
  }
  lights.visible = false;
  root.add(lights);
  const taxi = new THREE.Group();
  taxi.name = 'taxi';
  const tsp = new THREE.Sprite(spriteMat(0xfff4dc));
  tsp.position.set(nx + 0.01, -ry * 0.75, 0);
  tsp.scale.setScalar(0.22);
  taxi.add(tsp);
  const tcone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 14, 1, true), beamMat);
  tcone.rotation.z = Math.PI / 2;
  tcone.position.set(2, 0, 0);
  const tg = new THREE.Group();
  tg.position.set(nx + 0.01, -ry * 0.75, 0);
  tg.rotation.z = -9 * DEG;
  tg.add(tcone);
  taxi.add(tg);
  taxi.visible = false;
  root.add(taxi);

  // Bodengeräte an der Parkposition (nur sichtbar, solange abgefertigt wird): Pylonen an Bug, Flügelspitzen und Heck,
  // Bodenstromaggregat, Gepäckband an der vorderen Frachttür und Treppe an der vorderen Tür (nur an Außenpositionen)
  const gse = new THREE.Group();
  gse.name = 'gse';
  const cone = new THREE.ConeGeometry(0.018, 0.05, 8).translate(0, 0.025, 0);
  const coneM = lamb(0xf97316);
  for (const [x, z] of [[0.5 * L + 0.12, 0], [tLE - k.ct * L, -b - 0.06], [tLE - k.ct * L, b + 0.06], [-0.5 * L - 0.12, 0]]) {
    const c = new THREE.Mesh(cone, coneM);
    c.position.set(x, -H, z);
    gse.add(c);
  }
  const gpu = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), lamb(0xe5e7eb));
  gpu.position.set(0.32 * L, -H + 0.04, rz * 1.9);
  gpu.castShadow = true;
  gse.add(gpu);
  if (!k.prop || L > 1.5) {
    const belt = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.07), lamb(0x334155));
    base.position.set(0, 0.03, 0);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.05), lamb(0x111827));
    ramp.rotation.z = Math.atan2(Math.max(0.05, H - ry * 0.6), 0.3);
    ramp.position.set(0.02, 0.06 + (H - ry * 0.6) / 2, 0);
    belt.add(base, ramp);
    belt.position.set(0.2 * L - 0.12, -H, -rz * 1.25);
    gse.add(belt);
  }
  const stairs = new THREE.Group();
  stairs.name = 'stairs';
  const sh = H + ry * 0.1;
  const stp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, sh * 1.25), lamb(0xf8fafc));
  stp.rotation.x = Math.atan2(sh, sh * 0.9);
  stp.position.set(0, sh / 2, -sh * 0.45);
  const truck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, sh * 1.1), lamb(0x1d4ed8));
  truck.position.set(0, 0.03, -sh * 0.5);
  stairs.add(stp, truck);
  stairs.position.set(0.33 * L, -H, -rz * 1.02);
  gse.add(stairs);
  gse.visible = false;
  root.add(gse);

  root.userData = { L, R: rz, ry, H, span: b * 2, gearX: mx, gearZ: gz, noseX: nx, wy, eye: { cockpitX: 0.3 * L + noseL * 0.45, cockpitY: ry * 0.35, winX: rLE - 0.07 * L, winZ: rz * 1.02, winY: ry * 0.42 } };
  return root;
}

// ---------- Kleinverkehr: Cessna (Platzrunden) und Rettungshubschrauber ----------
export function buildCessna() {
  const L = 0.42, R = 0.028;
  const g = new THREE.Group();
  const white = [], red = [], dark = [];
  white.push([tube([[-L / 2, R * 0.7, R * 0.15, R * 0.15], [-L * 0.3, R * 0.5, R * 0.45, R * 0.4], [-L * 0.05, R * 0.15, R * 0.95, R * 0.8], [L * 0.2, 0, R, R * 0.85], [L * 0.38, -R * 0.1, R * 0.8, R * 0.7], [L * 0.47, -R * 0.15, R * 0.4, R * 0.4], [L * 0.5, -R * 0.15, 0.001, 0.001]], 14), M4()]);
  // Hochdecker mit Streben
  const wy = R * 1.05, b = L * 0.62;
  white.push([slab([[L * 0.16, wy, -b], [L * 0.16, wy, b], [L * 0.0, wy, b], [L * 0.0, wy, -b]], 0.012, 0.012), M4()]);
  for (const s of [-1, 1]) dark.push([new THREE.CylinderGeometry(0.003, 0.003, b * 0.6, 4), M4(L * 0.08, wy * 0.1, s * b * 0.3, s * 1.2, 0, 0)]);
  // Leitwerk
  red.push([slab([[-L * 0.32, R * 0.5, 0], [-L * 0.46, R * 0.5 + 0.075, 0], [-L * 0.52, R * 0.5 + 0.075, 0], [-L * 0.5, R * 0.5, 0]], 0.006, 0.004, 'z'), M4()]);
  for (const s of [-1, 1]) white.push([slab([[-L * 0.4, R * 0.55, 0], [-L * 0.42, R * 0.55, s * L * 0.19], [-L * 0.5, R * 0.55, s * L * 0.19], [-L * 0.5, R * 0.55, 0]], 0.006, 0.004), M4()]);
  // Zierstreifen und Fenster
  red.push([tube([[-L * 0.3, R * 0.3, R * 0.62, R * 0.56], [L * 0.3, -R * 0.02, R * 1.0, R * 0.88]], 14).scale(1, 0.22, 1).translate(0, -R * 0.15, 0), M4()]);
  dark.push([tube([[-L * 0.02, R * 0.55, R * 0.5, R * 0.86], [L * 0.16, R * 0.45, R * 0.55, R * 0.88]], 14), M4()]);
  // Fahrwerk
  for (const [x, z] of [[L * 0.36, 0], [-L * 0.02, R * 1.6], [-L * 0.02, -R * 1.6]]) dark.push([new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), M4(x, -R * 1.6, z, Math.PI / 2, 0, 0)]);
  const add = (arr, m) => {
    const mesh = new THREE.Mesh(merge(arr), m);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(white, phong(0xf8fafc, 50));
  add(red, phong(0xc81e1e, 40));
  add(dark, lamb(0x1f2937));
  // Propeller an der Nase
  const pg = new THREE.Group();
  pg.name = 'prop';
  pg.position.set(L * 0.5, -R * 0.15, 0);
  const blade = new THREE.BoxGeometry(0.002, 0.085, 0.008);
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(blade, phong(0x1f2937, 10));
    m.rotation.x = i * Math.PI;
    m.position.y = 0;
    pg.add(m);
  }
  g.add(pg);
  const nav = (c, z) => {
    const sp = new THREE.Sprite(spriteMat(c));
    sp.position.set(L * 0.08, wy, z);
    sp.scale.setScalar(0.08);
    g.add(sp);
  };
  nav(0xff2a2a, -b - 0.005);
  nav(0x2aff6a, b + 0.005);
  const bc = new THREE.Sprite(spriteMat(0xffffff));
  bc.name = 'strobe';
  bc.position.set(-L * 0.5, R * 0.5 + 0.075, 0);
  bc.scale.setScalar(0.14);
  g.add(bc);
  g.userData = { H: R * 1.6 + 0.012, L, R, ry: R, eye: { cockpitX: L * 0.12, cockpitY: R * 0.75, winX: L * 0.06, winY: R * 0.6, winZ: R * 1.05 } };
  return g;
}

export function buildHeli() {
  const g = new THREE.Group();
  const L = 0.6, R = 0.07;
  const body = [], dark = [], glass = [];
  body.push([tube([[-L * 0.12, R * 0.3, R * 0.55, R * 0.45], [L * 0.05, R * 0.1, R, R * 0.8], [L * 0.22, 0, R, R * 0.8], [L * 0.32, -R * 0.15, R * 0.7, R * 0.6], [L * 0.37, -R * 0.2, 0.001, 0.001]], 14), M4()]);
  // Heckausleger und Seitenleitwerk
  body.push([tube([[-L * 0.62, R * 0.6, R * 0.12, R * 0.12], [-L * 0.12, R * 0.35, R * 0.28, R * 0.24]], 10), M4()]);
  body.push([slab([[-L * 0.55, R * 0.6, 0], [-L * 0.62, R * 1.8, 0], [-L * 0.68, R * 1.8, 0], [-L * 0.64, R * 0.6, 0]], 0.01, 0.006, 'z'), M4()]);
  glass.push([tube([[L * 0.18, R * 0.35, R * 0.62, R * 0.78], [L * 0.33, R * 0.05, R * 0.5, R * 0.62]], 12), M4()]);
  // Kufen
  for (const s of [-1, 1]) {
    dark.push([new THREE.CylinderGeometry(0.006, 0.006, L * 0.6, 6), M4(L * 0.05, -R * 1.3, s * R * 0.9, 0, 0, Math.PI / 2)]);
    for (const x of [-L * 0.05, L * 0.18]) dark.push([new THREE.CylinderGeometry(0.004, 0.004, R * 0.6, 4), M4(x, -R * 1.0, s * R * 0.85)]);
  }
  const add = (arr, m) => {
    const mesh = new THREE.Mesh(merge(arr), m);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(body, phong(0xe11d48, 50));
  add(dark, lamb(0x1f2937));
  add(glass, phong(0x1e293b, 90));
  // Hauptrotor (zwei Blätter + Unschärfe-Scheibe) und Heckrotor
  const rot = new THREE.Group();
  rot.name = 'rotor';
  rot.position.set(L * 0.05, R * 1.25, 0);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(L * 0.95, 0.003, 0.025), phong(0x1f2937, 10));
    m.rotation.y = (i / 4) * Math.PI;
    rot.add(m);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(L * 0.48, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  rot.add(disc);
  g.add(rot);
  const tr = new THREE.Group();
  tr.name = 'tail';
  tr.position.set(-L * 0.64, R * 1.5, R * 0.12);
  tr.add(new THREE.Mesh(new THREE.BoxGeometry(0.004, L * 0.18, 0.012), phong(0x1f2937, 10)));
  g.add(tr);
  const bc = new THREE.Sprite(spriteMat(0xff3020));
  bc.name = 'bcn';
  bc.position.set(0, R * 1.05, 0);
  bc.scale.setScalar(0.18);
  g.add(bc);
  g.userData = { H: R * 1.3 + 0.006, L, R, ry: R, eye: { cockpitX: L * 0.22, cockpitY: R * 0.45, winX: L * 0.12, winY: R * 0.4, winZ: R * 0.85 } };
  return g;
}


// ---------- Sportflugzeuge und Lufttaxi (Aufbau-Modus) ----------
// Hochdecker (Cessna 172) bzw. Tiefdecker (PA-28, DR400, PC-12) mit festem Fahrwerk, Propeller an der Nase und
// Zierstreifen in der Farbe des Betreibers; benannte Teile wie bei den großen Flugzeugen (Lichter, Fahrwerk, GSE).
const GA_TRIM = { C172: 0x1d4ed8, PA28: 0xb91c1c, DR40: 0x7f1d1d, PC12: 0x334155 };
function lightTemplate(type, airline) {
  const t = AC_TYPES[type];
  const al = AIRLINES[airline] || {};
  const L = t.len;
  const high = type === 'C172';
  const turbo = type === 'PC12';
  const R = L * (turbo ? 0.06 : 0.067);
  const span = L * (type === 'C172' ? 1.32 : type === 'PC12' ? 1.13 : 1.42);
  const b = span / 2;
  const g = new THREE.Group();
  const white = [], trim = [], dark = [], glass = [];
  const trimCol = airline === 'GAV' || !al.color ? GA_TRIM[type] || 0x1d4ed8 : new THREE.Color(al.color).getHex();
  // Rumpf: spitz zulaufendes Heck, runde Motorhaube
  white.push([tube([[-L / 2, R * 0.75, R * 0.14, R * 0.14], [-L * 0.32, R * 0.5, R * 0.42, R * 0.38], [-L * 0.06, R * 0.15, R * 0.95, R * 0.82], [L * 0.2, 0, R, R * 0.86], [L * 0.38, -R * 0.08, R * 0.82, R * 0.72], [L * 0.47, -R * 0.12, R * 0.42, R * 0.42], [L * 0.5, -R * 0.12, 0.001, 0.001]], 16), M4()]);
  // Kabinenfenster bzw. Kanzel
  if (high) glass.push([tube([[-L * 0.04, R * 0.5, R * 0.52, R * 0.9], [L * 0.18, R * 0.45, R * 0.56, R * 0.9]], 14), M4()]);
  else glass.push([tube([[-L * 0.08, R * 0.6, R * 0.25, R * 0.55], [L * 0.04, R * 0.85, R * 0.5, R * 0.75], [L * 0.17, R * 0.7, R * 0.45, R * 0.72], [L * 0.24, R * 0.4, R * 0.2, R * 0.5]], 14), M4()]);
  // Tragfläche
  const wy = high ? R * 1.05 : -R * 0.55;
  const cr = L * (turbo ? 0.2 : 0.17), ct = cr * (high ? 1 : 0.75);
  const wx = L * (high ? 0.16 : 0.12);
  for (const sd of [-1, 1]) white.push([slab([[wx, wy, 0], [wx, wy, sd * b], [wx - ct, wy, sd * b], [wx - cr, wy, 0]], 0.012, 0.01), M4()]);
  if (high) for (const sd of [-1, 1]) dark.push([new THREE.CylinderGeometry(0.003, 0.003, b * 0.62, 4), M4(wx - cr * 0.4, wy * 0.1, sd * b * 0.3, sd * 1.2, 0, 0)]);
  for (const sd of [-1, 1]) trim.push([slab([[wx, wy + 0.001, sd * b * 0.86], [wx, wy + 0.001, sd * b], [wx - ct, wy + 0.001, sd * b], [wx - ct, wy + 0.001, sd * b * 0.86]], 0.013, 0.011), M4()]);
  if (turbo) for (const sd of [-1, 1]) white.push([slab([[wx - ct * 0.2, wy, sd * b], [wx - ct * 0.6, wy + 0.04, sd * (b + 0.01)], [wx - ct, wy + 0.04, sd * (b + 0.01)], [wx - ct, wy, sd * b]], 0.004, 0.003, 'z'), M4()]);
  // Leitwerk (PC-12 mit T-Leitwerk)
  const fin = turbo ? 0.11 : 0.075;
  trim.push([slab([[-L * 0.3, R * 0.55, 0], [-L * 0.45, R * 0.55 + fin, 0], [-L * 0.53, R * 0.55 + fin, 0], [-L * 0.5, R * 0.55, 0]], 0.006, 0.004, 'z'), M4()]);
  const sy = turbo ? R * 0.55 + fin : R * 0.6;
  for (const sd of [-1, 1]) white.push([slab([[-L * 0.4, sy, 0], [-L * 0.42, sy, sd * L * 0.2], [-L * 0.5, sy, sd * L * 0.2], [-L * 0.5, sy, 0]], 0.006, 0.004), M4()]);
  // Zierstreifen am Rumpf
  trim.push([tube([[-L * 0.34, R * 0.32, R * 0.6, R * 0.55], [L * 0.32, -R * 0.02, R * 1.0, R * 0.88]], 14).scale(1, 0.2, 1).translate(0, -R * 0.12, 0), M4()]);
  // festes Fahrwerk mit Radverkleidungen
  const gear = new THREE.Group();
  gear.name = 'gear';
  const gy = -R * 1.55;
  for (const [x, z, k] of [[L * 0.36, 0, 0.85], [-L * 0.02, R * 1.7, 1], [-L * 0.02, -R * 1.7, 1]]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.014 * k, 10, 6), lamb(trimCol));
    w.scale.set(1.6, 1, 0.7);
    w.position.set(x, gy, z);
    gear.add(w);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, Math.abs(gy) * 0.8, 4), lamb(0x374151));
    leg.position.set(x, gy * 0.55, z * 0.8);
    leg.rotation.x = z ? Math.sign(z) * 0.5 : 0;
    gear.add(leg);
  }
  g.add(gear);
  const add = (arr, m) => {
    if (!arr.length) return;
    const mesh = new THREE.Mesh(merge(arr), m);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(white, phong(0xf8fafc, 60));
  add(trim, phong(trimCol, 40));
  add(dark, lamb(0x1f2937));
  add(glass, phong(0x1e293b, 95));
  // Propeller (dreht sich bei laufendem Motor)
  const pg = new THREE.Group();
  pg.name = 'prop';
  pg.position.set(L * 0.5, -R * 0.12, 0);
  const nb = turbo ? 4 : 2;
  for (let i = 0; i < nb; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.002, turbo ? 0.1 : 0.085, 0.008), phong(0x111827, 10));
    m.rotation.x = (i / nb) * Math.PI;
    pg.add(m);
  }
  const spin = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.025, 10), phong(trimCol, 50));
  spin.rotation.z = -Math.PI / 2;
  spin.position.x = 0.008;
  pg.add(spin);
  g.add(pg);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(turbo ? 0.05 : 0.043, 20), new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  disc.name = 'disc';
  disc.rotation.y = Math.PI / 2;
  disc.position.set(L * 0.505, -R * 0.12, 0);
  g.add(disc);
  // Lichter
  const light = (name, c, x, y, z, sc = 0.08) => {
    const sp = new THREE.Sprite(spriteMat(c));
    sp.name = name;
    sp.position.set(x, y, z);
    sp.scale.setScalar(sc);
    g.add(sp);
    return sp;
  };
  light('navL', 0xff2a2a, wx - ct * 0.5, wy, -b - 0.004);
  light('navR', 0x2aff6a, wx - ct * 0.5, wy, b + 0.004);
  light('navT', 0xffffff, -L * 0.53, R * 0.55 + fin * 0.5, 0);
  light('bcnT', 0xff3020, -L * 0.48, R * 0.55 + fin, 0);
  light('strL', 0xffffff, wx - ct * 0.5, wy, -b - 0.006, 0.12);
  light('strR', 0xffffff, wx - ct * 0.5, wy, b + 0.006, 0.12);
  const landing = new THREE.Group();
  landing.name = 'landing';
  landing.add(light('landingSp', 0xfff7d6, L * 0.5, -R * 0.4, 0, 0.12));
  g.add(landing);
  const taxi = new THREE.Group();
  taxi.name = 'taxi';
  g.add(taxi);
  const gse = new THREE.Group();
  gse.name = 'gse';
  const stairs = new THREE.Group();
  stairs.name = 'stairs';
  gse.add(stairs);
  // Unterlegkeile vor den Rädern, wenn das Flugzeug steht
  for (const z of [R * 1.7, -R * 1.7]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.01), lamb(0xfacc15));
    c.position.set(-L * 0.02 + 0.03, gy - 0.006, z);
    gse.add(c);
  }
  g.add(gse);
  const H = R * 1.55 + 0.014;
  g.userData = { L, R, ry: R, H, span, gearX: -L * 0.02, gearZ: R * 1.7, noseX: L * 0.36, wy, eye: { cockpitX: L * 0.12, cockpitY: R * 0.75, winX: L * 0.06, winY: R * 0.6, winZ: R * 1.05 } };
  return g;
}
