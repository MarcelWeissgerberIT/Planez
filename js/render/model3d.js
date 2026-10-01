// 3D-Modelle für die WebGL-Ansicht: Flugzeuge je Bauart (Schmal- und Großraum, A380, 747-Frachter, Turboprop mit
// Propellern, Regionaljet und Businessjet mit Hecktriebwerken und T-Leitwerk) – Rumpf mit Bug- und Heckform, gepfeilte
// Tragflächen mit Winglets, Triebwerksgondeln mit Einlauf, Fahrwerk, Leitwerk mit Airline-Logo. Die Lackierung (Fenster,
// Türen, Zierstreifen, Bauch, Schriftzug, Cockpitscheiben) wird auf eine Canvas-Textur gemalt. Je Typ und Airline wird ein
// Modell einmal gebaut (Teile je Material zu einem Netz verschmolzen) und dann geklont. Dazu Positions-, Blitz-,
// Kollisionswarn- und Landelichter, die die Ansicht je nach Phase und Tageszeit schaltet. 1 Einheit = 1 Kachel (20 m).
import * as THREE from '../vendor/three.module.min.js';
import { AC_TYPES, AIRLINES, VEH_TYPES } from '../config.js';

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
function merge(parts) {
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
  // Kabinenfenster (Abstand ≈ 0,5 m), Frachter ohne
  const ratio = (8 * Math.PI * k.r * k.kh) / 1; // Streckung der Textur entlang/rundherum
  const pitch = (1024 * 0.026) / L;
  const ww = Math.max(2, 4.2 / ratio * 1.4), wh = 5;
  g.fillStyle = '#1e293b';
  if (!cargo) {
    for (let x = 200; x < 850; x += pitch) {
      if (Math.abs(x - 470) < pitch * 1.2 && k.wx > 0) continue; // Notausgang über der Fläche
      g.fillRect(x, 53, ww, wh);
      g.fillRect(x, 198, ww, wh);
    }
    if (k.hump || k.kh > 1.2) for (let x = 600; x < (k.hump ? 860 : 830); x += pitch) {
      g.fillRect(x, 30, ww, wh - 1);
      g.fillRect(x, 222, ww, wh - 1);
    }
  }
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
  return t;
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
  if (!TEMPL.has(key)) TEMPL.set(key, template(ac.type, ac.airline));
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
  const white = [], gray = [], dark = [], tailc = [], metal = [], flaps = [];

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
  const fus = new THREE.Mesh(tube(rings, 24), new THREE.MeshPhongMaterial({ map: livery(type, al, L, k), shininess: 55, specular: 0x666666 }));
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
    // Vorflügel an der Vorderkante (metallisch)
    {
      const a = at(0.06), c = at(0.97);
      const lift = k.cr * L * 0.058;
      metal.push([slab([[a.le, a.y + lift, s * a.z], [c.le, c.y + lift * 0.7, s * c.z], [c.le - (c.le - c.te) * 0.13, c.y + lift * 0.7, s * c.z], [a.le - (a.le - a.te) * 0.12, a.y + lift, s * a.z]], k.cr * L * 0.01, k.ct * L * 0.008), M4()]);
    }
    // Klappenführungen unter der Hinterkante
    if (!k.high) for (const f of [0.25, 0.45, 0.62]) {
      const a = at(f);
      dark.push([new THREE.ConeGeometry(k.cr * L * 0.035, k.cr * L * 0.3, 6).rotateZ(Math.PI / 2), M4(a.te - k.cr * L * 0.05, a.y - k.cr * L * 0.03, s * a.z)]);
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
    white.push([tube(rr.map(([a, yy, s1, s2]) => [a, yy, s1 * er, s2 * er]), 16), M4(x, y, z)]);
    if (!prop) {
      dark.push([new THREE.CircleGeometry(er * 0.86, 16), M4(x - el * 0.02, y, z, 0, Math.PI / 2, 0)]);
      metal.push([new THREE.ConeGeometry(er * 0.26, er * 0.5, 10), M4(x - el * 0.02 + er * 0.2, y, z, 0, 0, -Math.PI / 2)]);
      dark.push([new THREE.CircleGeometry(er * 0.42, 12), M4(x - el + 0.001, y, z, 0, -Math.PI / 2, 0)]);
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
  add(dark, lamb(0x111827));
  add(metal, phong(0xc0c7cf, 90));
  add(tailc, phong(new THREE.Color(al.color || '#1d4ed8').getHex(), 45));
  for (const p of props) root.add(p);

  // Fahrwerk
  const gear = [], wr = k.wheel * L * 1.1;
  const strut = (x, z, top) => {
    const len = top - (-H + wr);
    gear.push([new THREE.CylinderGeometry(wr * 0.22, wr * 0.22, len, 6), M4(x, -H + wr + len / 2, z)]);
  };
  const wheel = (x, z) => gear.push([new THREE.CylinderGeometry(wr, wr, wr * 0.8, 12), M4(x, -H + wr, z, Math.PI / 2, 0, 0)]);
  const nx = 0.36 * L;
  strut(nx, 0, -ry * 0.7);
  wheel(nx, wr * 0.45);
  wheel(nx, -wr * 0.45);
  const mx = k.high ? rTE + k.cr * L * 0.25 : rTE + k.cr * L * 0.3;
  const gz = k.gearZ * L;
  for (const s of [-1, 1]) {
    strut(mx, s * gz, k.high ? -ry * 0.6 : wy);
    if (k.bogie) for (const dx of [-wr * 1.15, wr * 1.15]) (wheel(mx + dx, s * gz + wr * 0.5), wheel(mx + dx, s * gz - wr * 0.5));
    else (wheel(mx, s * gz + wr * 0.5), wheel(mx, s * gz - wr * 0.5));
  }
  const gm = new THREE.Mesh(merge(gear), lamb(0x1f2937));
  gm.name = 'gear';
  gm.castShadow = true;
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

  root.userData = { L, R: rz, ry, H, span: b * 2, gearX: mx, gearZ: gz, noseX: nx, wy, eye: { cockpitX: 0.3 * L + noseL * 0.45, cockpitY: ry * 0.35, winX: rLE - 0.07 * L, winZ: rz * 1.02, winY: ry * 0.42 } };
  return root;
}

// ---------- Bodenfahrzeuge ----------
const VT = new Map();
export function buildVehicle(v) {
  if (!VT.has(v.type)) VT.set(v.type, vehTemplate(v.type));
  return VT.get(v.type).clone();
}

function vehTemplate(type) {
  const vt = VEH_TYPES[type] || {};
  const L = vt.len || 0.4;
  const W = 0.13;
  const g = new THREE.Group();
  const body = phong(new THREE.Color(vt.color || '#facc15').getHex(), 30);
  const glass = phong(0x1e293b, 80);
  const box = (x0, x1, y0, y1, w, m) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, w), m);
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  const h = L / 2;
  const wheelGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 10);
  const wheels = (xs, wz = W / 2) => {
    for (const x of xs) for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, lamb(0x111827));
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.025, s * wz);
      g.add(w);
    }
  };
  if (type === 'tug') {
    box(-h, h, 0.02, 0.07, 0.17, body);
    box(-h * 0.2, h * 0.5, 0.07, 0.12, 0.12, glass);
    wheels([-h * 0.6, h * 0.6], 0.085);
  } else if (type === 'baggage') {
    box(h - 0.18, h, 0.02, 0.08, 0.1, body);
    box(h - 0.12, h - 0.04, 0.08, 0.13, 0.09, glass);
    for (let i = 0; i < 3; i++) {
      const x0 = h - 0.22 - (i + 1) * 0.24;
      box(x0, x0 + 0.2, 0.03, 0.05, 0.11, lamb(0x6b7280));
      box(x0 + 0.02, x0 + 0.18, 0.05, 0.1, 0.09, lamb([0x1d4ed8, 0x7c2d12, 0x065f46][i]));
      wheels([x0 + 0.04, x0 + 0.16], 0.05);
    }
    wheels([h - 0.15, h - 0.03], 0.05);
  } else if (type === 'fuel') {
    box(h - 0.16, h, 0.02, 0.13, W, body);
    box(h - 0.06, h, 0.08, 0.12, W * 0.9, glass);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, L - 0.2, 14), phong(0xe5e7eb, 70));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(-0.1, 0.1, 0);
    tank.castShadow = true;
    g.add(tank);
    box(-h, -h + 0.03, 0.03, 0.06, W, lamb(0x374151));
    wheels([h - 0.08, -h + 0.12, -h + 0.22]);
  } else if (type === 'catering') {
    box(h - 0.14, h, 0.02, 0.12, W, phong(0x334155, 30));
    box(h - 0.05, h, 0.07, 0.11, W * 0.9, glass);
    box(-h, h - 0.16, 0.06, 0.2, W * 1.05, body);
    box(-h, h - 0.16, 0.02, 0.06, W * 0.3, lamb(0x6b7280));
    wheels([h - 0.07, -h + 0.08]);
  } else if (type === 'bus') {
    box(-h, h, 0.03, 0.15, W * 1.15, body);
    box(-h + 0.03, h - 0.02, 0.08, 0.13, W * 1.17, glass);
    box(-h, h, 0.15, 0.16, W * 1.1, phong(0xf1f5f9, 20));
    wheels([-h * 0.7, h * 0.7], W * 0.58);
  } else if (type === 'deice') {
    box(h - 0.16, h, 0.02, 0.12, W, body);
    box(h - 0.06, h, 0.07, 0.11, W * 0.9, glass);
    box(-h, h - 0.17, 0.02, 0.1, W, phong(0xe5e7eb, 40));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.025, 0.025), body);
    arm.position.set(-0.05, 0.22, 0);
    arm.rotation.z = 0.6;
    g.add(arm);
    box(0.08, 0.16, 0.32, 0.38, 0.08, body);
    wheels([h - 0.08, -h + 0.1]);
  } else {
    box(-h, h, 0.02, 0.1, W, body);
    box(h * 0.2, h * 0.9, 0.06, 0.09, W * 1.01, glass);
    wheels([-h * 0.6, h * 0.6]);
  }
  // Rundumleuchte (orange), nachts und beim Fahren
  const bc = new THREE.Sprite(spriteMat(0xffa31a));
  bc.name = 'bcn';
  bc.position.set(0, 0.17, 0);
  bc.scale.setScalar(0.12);
  g.add(bc);
  return g;
}
