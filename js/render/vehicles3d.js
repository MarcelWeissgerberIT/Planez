// 3D-Bodenfahrzeuge mit Details: Schlepper mit Warnstreifen und Kanzel, Gepäckzug mit LD3-Containern und offenem
// Kofferwagen, Tankwagen mit Kessel, Laufsteg und „JET A-1“-Schild, Catering-Hubwagen (Kasten fährt an der Schere
// hoch), Reinigungstransporter, Niederflur-Vorfeldbus mit Panorama-Glasband und Doppeltüren, Enteiser mit schwenkbarem Korbarm und
// Sprühnebel, Treppenfahrzeug mit aufstellbarer Treppe, dazu Flughafenfeuerwehr (Großtanklöschfahrzeug mit Dachwerfer), Schneepflug mit Kehrwalze und das
// Follow-me-Auto. Räder mit Felgen, Scheinwerfer, Rückleuchten, Spiegel, Rundumleuchte. Alle festen Teile werden je
// Material zu einem Netz verschmolzen (wenige Draw-Calls); bewegliche Teile sind benannte Gruppen:
// 'lift'/'scis'/'plat' (Catering), 'tur'/'boom'/'bask'/'spray' (Enteiser), 'ramp'/'stp' (Treppe), 'hl'/'tl' (Licht), 'bcn' (Rundumleuchte).
// x = Fahrtrichtung (Front bei +x), y = oben, z = quer. 1 Einheit = 1 Kachel (20 m).
import * as THREE from '../vendor/three.module.min.js';
import { VEH_TYPES } from '../config.js';
import { merge, spriteMat } from './model3d.js';
import { T } from '../i18n.js';
import { busLoad } from './buspax.js';
import { toCreasedNormals, mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { carKind, carPaint, POLICE_BLUE } from './cars.js';
import { glassMat } from './glassenv.js';
import { STAIRS, stairsTop, stairsGeom, BELT, beltGeom } from '../acshape.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MX = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz));

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPH = new THREE.SphereGeometry(1, 14, 8);
const CYL = new Map();
const cylGeo = (seg) => CYL.get(seg) || (CYL.set(seg, new THREE.CylinderGeometry(1, 1, 1, seg)), CYL.get(seg));
// Radkasten: Halbscheibe über der Achse (Achse entlang z)
const ARCH = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);

// Texturkoordinaten je Fläche aus der Blickrichtung (Seite, Front, Dach) über das ganze Teil gespannt – so liegen
// Blechfugen und Schmutz der Lacktextur auch auf runden Teilen richtig
function boxUV(g) {
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const sx = max.x - min.x || 1, sy = max.y - min.y || 1, sz = max.z - min.z || 1;
  const P = g.attributes.position, N = g.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
    const x = (P.getX(i) - min.x) / sx, y = (P.getY(i) - min.y) / sy, z = (P.getZ(i) - min.z) / sz;
    if (nz >= nx && nz >= ny) (uv[i * 2] = x), (uv[i * 2 + 1] = y);
    else if (ny >= nx) (uv[i * 2] = x), (uv[i * 2 + 1] = z);
    else (uv[i * 2] = z), (uv[i * 2 + 1] = y);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Quader mit rundum gerundeten Kanten (Radius r, absolute Maße), mittig um den Ursprung
const RB = new Map();
function rboxGeo(sx, sy, sz, r) {
  const key = [sx, sy, sz, r].map((v) => v.toFixed(4)).join('|');
  if (RB.has(key)) return RB.get(key);
  r = Math.min(r, sx / 2, sy / 2, sz / 2);
  const n = 7; // ungerade: mittlere Reihe bleibt flach
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n).toNonIndexed();
  const P = g.attributes.position, N = g.attributes.normal;
  const bx = sx / 2 - r, by = sy / 2 - r, bz = sz / 2 - r, hs = 0.5 / n;
  const p = V(0, 0, 0), q = V(0, 0, 0);
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i);
    const ax = Math.sign(p.x), ay = Math.sign(p.y), az = Math.sign(p.z);
    q.set(p.x - ax * hs, p.y - ay * hs, p.z - az * hs).normalize();
    P.setXYZ(i, bx * ax + q.x * r, by * ay + q.y * r, bz * az + q.z * r);
    N.setXYZ(i, q.x, q.y, q.z);
  }
  RB.set(key, boxUV(g));
  return g;
}
// Seitenprofil [x, y, Eckenradius] quer von z0 bis z1 extrudiert; b = Rundung der Längskanten (Dach, Seiten, Front)
const PR = new Map();
function profGeo(pts, z0, z1, b) {
  const key = JSON.stringify([pts, z0, z1, b]);
  if (PR.has(key)) return PR.get(key);
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, y, r = 0] = pts[i], [px, py] = pts[(i + n - 1) % n], [nx, ny] = pts[(i + 1) % n];
    if (!r) {
      i ? s.lineTo(x, y) : s.moveTo(x, y);
      continue;
    }
    const d1 = Math.hypot(px - x, py - y), d2 = Math.hypot(nx - x, ny - y), a = Math.min(r, d1 / 2, d2 / 2);
    const ax = x + ((px - x) / d1) * a, ay = y + ((py - y) / d1) * a;
    i ? s.lineTo(ax, ay) : s.moveTo(ax, ay);
    s.quadraticCurveTo(x, y, x + ((nx - x) / d2) * a, y + ((ny - y) / d2) * a);
  }
  b = Math.min(b, (z1 - z0) / 2 - 0.0005);
  const geo = new THREE.ExtrudeGeometry(s, { depth: z1 - z0 - 2 * Math.max(0, b), curveSegments: 5, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3 });
  geo.translate(0, 0, z0 + Math.max(0, b));
  const out = boxUV(toCreasedNormals(geo, 0.75));
  PR.set(key, out);
  return out;
}

const MATS = new Map();
const cached = (k, make) => MATS.get(k) || (MATS.set(k, make()), MATS.get(k));
// Oberflächen (graustufig, werden mit der Farbe multipliziert): Lack mit Blechfugen, Nieten, Laufspuren und Schmutz
// unten; gebürstetes Metall; matter Kunststoff mit Körnung. Fest gesät, damit alle Fahrzeuge gleich aussehen.
function grayTex(key, draw) {
  return cached(`g${key}`, () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 128, 128);
    let n = 9;
    const rnd = () => ((n = (n * 16807) % 2147483647) / 2147483647);
    draw(g, rnd);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}
const wearTex = () => grayTex('wear', (g, rnd) => {
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${0.025 + rnd() * 0.04})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // Laufspuren (Regen, Staub) von oben nach unten
  for (let i = 0; i < 14; i++) {
    const x = rnd() * 128, len = 20 + rnd() * 70;
    const gr = g.createLinearGradient(0, 128 - len, 0, 128);
    gr.addColorStop(0, 'rgba(70,60,50,0)');
    gr.addColorStop(1, `rgba(70,60,50,${0.05 + rnd() * 0.07})`);
    g.fillStyle = gr;
    g.fillRect(x, 128 - len, 1 + rnd() * 2, len);
  }
  // Schmutz und Bremsstaub unten
  const gr = g.createLinearGradient(0, 84, 0, 128);
  gr.addColorStop(0, 'rgba(60,50,40,0)');
  gr.addColorStop(1, 'rgba(60,50,40,0.32)');
  g.fillStyle = gr;
  g.fillRect(0, 84, 128, 44);
  // Blechfugen am Rand, Nieten
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 1;
  g.strokeRect(3.5, 3.5, 121, 121);
  for (let x = 8; x < 124; x += 12) for (const y of [6, 122]) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, y, 2, 2);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(x, y - 1, 1, 1);
  }
});
const brushedTex = () => grayTex('brush', (g, rnd) => {
  g.fillStyle = '#e9edf1';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.2 + rnd() * 0.4})` : `rgba(0,0,0,${0.04 + rnd() * 0.08})`;
    g.fillRect(rnd() * 128 - 40, rnd() * 128, 30 + rnd() * 90, 1);
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.strokeRect(0.5, 0.5, 127, 127);
});
const grainTex = () => grayTex('grain', (g, rnd) => {
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.03 + rnd() * 0.05})` : `rgba(255,255,255,${0.04 + rnd() * 0.06})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1, 1);
  }
  const gr = g.createLinearGradient(0, 96, 0, 128);
  gr.addColorStop(0, 'rgba(50,45,40,0)');
  gr.addColorStop(1, 'rgba(50,45,40,0.2)');
  g.fillStyle = gr;
  g.fillRect(0, 96, 128, 32);
});
const paint = (c, shin = 50) => cached(`p${c}|${shin}`, () => new THREE.MeshPhongMaterial({ color: c, map: wearTex(), shininess: shin, specular: 0x3a3a3a }));
const metal = (c) => cached(`m${c}`, () => new THREE.MeshPhongMaterial({ color: c, map: brushedTex(), shininess: 95, specular: 0x9aa6b4 }));
const matte = (c) => cached(`l${c}`, () => new THREE.MeshLambertMaterial({ color: c, map: grainTex() }));
const lamp = (c) => cached(`b${c}`, () => new THREE.MeshBasicMaterial({ color: c }));
const glass = glassMat; // getönt, spiegelt Himmel und Horizont (glassenv.js)
const TIRE = 0x15171a, DARK = 0x24272c, RIM = 0xb9c0c8;

function canvasMat(key, w, h, draw, basic = false) {
  return cached(`t${key}`, () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return basic ? new THREE.MeshBasicMaterial({ map: t }) : new THREE.MeshLambertMaterial({ map: t });
  });
}
// Warnstreifen gelb/schwarz
const hazard = () => canvasMat('haz', 64, 16, (g, w, h) => {
  g.fillStyle = '#facc15';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#111111';
  for (let x = -16; x < w + 16; x += 16) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 8, 0);
    g.lineTo(x + 8 - h, h);
    g.lineTo(x - h, h);
    g.fill();
  }
});
// Reflexstreifen rot/weiß (Feuerwehr)
const redWhite = () => canvasMat('rw', 64, 8, (g, w, h) => {
  for (let x = 0; x < w; x += 8) {
    g.fillStyle = (x / 8) % 2 ? '#f8fafc' : '#dc2626';
    g.fillRect(x, 0, 8, h);
  }
});
// Schachbrett gelb/schwarz (Follow-me)
const checker = () => canvasMat('chk', 64, 16, (g, w, h) => {
  for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) {
    g.fillStyle = ((x + y) / 8) % 2 ? '#111111' : '#facc15';
    g.fillRect(x, y, 8, 8);
  }
});
const plate = (key, text, fg, bg, basic = false) => canvasMat(key, 128, 32, (g, w, h) => {
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 3;
  g.strokeRect(2, 2, w - 4, h - 4);
  g.fillStyle = fg;
  g.font = 'bold 21px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
}, basic);

// Sammler: Teile je Material, am Ende zu je einem Netz verschmolzen
class Kit {
  constructor() {
    this.by = new Map();
  }
  put(geo, m, mx) {
    if (!this.by.has(m)) this.by.set(m, []);
    this.by.get(m).push([geo, mx]);
    return this;
  }
  box(x0, x1, y0, y1, z0, z1, m, rx = 0, ry = 0, rz = 0) {
    const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0], [c, d] = y0 < y1 ? [y0, y1] : [y1, y0], [e, f] = z0 < z1 ? [z0, z1] : [z1, z0];
    return this.put(BOX, m, MX((a + b) / 2, (c + d) / 2, (e + f) / 2, b - a, d - c, f - e, rx, ry, rz));
  }
  // mittig quer (Breite w)
  bx(x0, x1, y0, y1, w, m, rx = 0, ry = 0, rz = 0) {
    return this.box(x0, x1, y0, y1, -w / 2, w / 2, m, rx, ry, rz);
  }
  // gespiegeltes Paar links und rechts (Mitte bei ±z, Dicke d)
  pair(x0, x1, y0, y1, z, d, m) {
    this.box(x0, x1, y0, y1, z - d / 2, z + d / 2, m);
    return this.box(x0, x1, y0, y1, -z - d / 2, -z + d / 2, m);
  }
  // Quader mit Mittelpunkt, Maßen und Drehung
  obox(x, y, z, sx, sy, sz, m, rx = 0, ry = 0, rz = 0) {
    return this.put(BOX, m, MX(x, y, z, sx, sy, sz, rx, ry, rz));
  }
  // Zylinder entlang 'x', 'y' oder 'z'; rq = zweiter Radius (elliptisch)
  cyl(x, y, z, r, len, axis, m, seg = 12, rq = r) {
    const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.put(cylGeo(seg), m, MX(x, y, z, r, len, rq, ...rot));
  }
  sph(x, y, z, sx, sy, sz, m) {
    return this.put(SPH, m, MX(x, y, z, sx, sy, sz));
  }
  // Quader mit gerundeten Kanten (r = Radius)
  rbox(x0, x1, y0, y1, z0, z1, m, r = 0.008) {
    const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0], [c, d] = y0 < y1 ? [y0, y1] : [y1, y0], [e, f] = z0 < z1 ? [z0, z1] : [z1, z0];
    return this.put(rboxGeo(b - a, d - c, f - e, r), m, MX((a + b) / 2, (c + d) / 2, (e + f) / 2, 1, 1, 1));
  }
  rbx(x0, x1, y0, y1, w, m, r = 0.008) {
    return this.rbox(x0, x1, y0, y1, -w / 2, w / 2, m, r);
  }
  // Seitenprofil über die Breite w (mittig) oder von z0 bis z1; b = Rundung der Längskanten
  prof(pts, w, m, b = 0.01, z0 = -w / 2, z1 = w / 2) {
    return this.put(profGeo(pts, z0, z1, b), m, new THREE.Matrix4());
  }
  // flaches Profil auf beiden Seitenwänden (Fenster, Zierleisten): d = Abstand der Außenfläche von der Mitte
  side(pts, d, m, t = 0.0016) {
    this.put(profGeo(pts, d - t, d, 0), m, new THREE.Matrix4());
    return this.put(profGeo(pts, -d, -d + t, 0), m, new THREE.Matrix4());
  }
  // schräge Platte von (xa, ya) nach (xb, yb), Dicke t, Breite wz (Frontscheibe, Haube)
  slab(xa, ya, xb, yb, t, wz, m) {
    const dx = xb - xa, dy = yb - ya;
    return this.put(BOX, m, MX((xa + xb) / 2, (ya + yb) / 2, 0, t, Math.hypot(dx, dy), wz, 0, 0, Math.atan2(-dx, dy)));
  }
  // dunkler Radkasten hinter einem Rad (Halbscheibe, etwas größer als der Reifen), quer über die Breite w
  well(x, r, w) {
    return this.put(ARCH, matte(0x0d0f12), MX(x, r, 0, r * 1.28, r * 1.28, w));
  }
  // Rad mit Reifen, Felge und Nabe
  wheel(x, z, r, w) {
    const s = Math.sign(z) || 1;
    this.cyl(x, r, z, r, w, 'z', matte(TIRE), 16);
    this.cyl(x, r, z + s * w * 0.04, r * 0.62, w * 0.98, 'z', metal(RIM), 12);
    this.cyl(x, r, z + s * w * 0.08, r * 0.22, w * 1.0, 'z', matte(DARK), 8);
    return this;
  }
  axle(x, z, r, w) {
    return this.wheel(x, z, r, w).wheel(x, -z, r, w);
  }
  // Stange zwischen zwei Punkten (Geländer, Scherenarm, Deichsel)
  rod(a, b, t, m) {
    const d = V(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
    return this.put(BOX, m, new THREE.Matrix4().compose(V((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, V(t, len, t)));
  }
  build(g = new THREE.Group()) {
    for (const [m, list] of this.by) {
      const mesh = new THREE.Mesh(merge(list), m);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      g.add(mesh);
    }
    return g;
  }
}

// Fahrerhaus (Front bei x1): gerundete Kabine mit leicht geneigter Frontscheibe, Seitenfenster mit schräger
// Vorderkante, Stoßfänger, Kühlergrill, Scheinwerfer, Spiegel; o.win = Fensterunterkante (Anteil), o.roof = Dachfarbe
function cab(k, x0, x1, y0, y1, w, body, o = {}) {
  const wy = y0 + (y1 - y0) * (o.win ?? 0.5);
  const b = Math.min(0.014, w * 0.11), rake = (y1 - wy) * 0.3;
  const A = [x1, wy - 0.006], B = [x1 - rake, y1];
  k.prof([[x0, y0], [x1, y0, 0.006], [A[0], A[1], 0.014], [B[0], B[1], 0.016], [x0, y1, 0.01]], w, body, b);
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = (B[1] - A[1]) / L, ny = (A[0] - B[0]) / L;
  const at = (f) => [A[0] + (B[0] - A[0]) * f + nx * 0.0012, A[1] + (B[1] - A[1]) * f + ny * 0.0012];
  k.slab(...at(0.12), ...at(0.88), 0.002, w - 2 * b - 0.002, glass());
  const xf = (y) => A[0] - (rake * (y - A[1])) / (B[1] - A[1]) - b - 0.002, yt = y1 - b - 0.002;
  k.side([[x0 + b + 0.004, wy], [xf(wy), wy], [xf(yt), yt], [x0 + b + 0.004, yt]], w / 2 + 0.0008, glass());
  if (o.roof) k.rbox(x0 + 0.004, B[0] - 0.006, y1 - 0.004, y1 + 0.005, -w / 2 + 0.006, w / 2 - 0.006, o.roof, 0.004);
  k.rbx(x1 - 0.008, x1 + 0.01, y0 - 0.006, y0 + 0.022, w + 0.004, matte(DARK), 0.006);
  k.bx(x1 - 0.002, x1 + 0.0025, y0 + 0.026, wy - 0.014, w * 0.46, matte(0x2f343b));
  for (let y = y0 + 0.03; y < wy - 0.016; y += 0.008) k.bx(x1 + 0.0025, x1 + 0.0035, y, y + 0.0025, w * 0.44, metal(0x9aa3ad));
  k.pair(x1 - 0.002, x1 + 0.003, y0 + 0.026, y0 + 0.037, w / 2 - 0.022, 0.02, lamp(0xfff4d6));
  k.pair(x1 - 0.004, x1 + 0.0015, y0 + 0.024, y0 + 0.03, w / 2 - 0.007, 0.006, lamp(0xff9d1a));
  k.pair(A[0] - 0.018, A[0] - 0.008, wy - 0.002, wy + 0.022, w / 2 + 0.012, 0.004, matte(0x1c1f24));
  k.pair(A[0] - 0.022, A[0] - 0.014, wy + 0.01, wy + 0.013, w / 2 + 0.005, 0.012, matte(0x1c1f24));
  return wy;
}
// Rückleuchten am Heck (x0)
function tail(k, x0, y, w) {
  k.pair(x0 - 0.003, x0 + 0.001, y, y + 0.012, w / 2 - 0.012, 0.016, lamp(0xb91c1c));
}
// Lichtpunkte für die Nacht (Scheinwerfer vorn, Rücklicht hinten) und Rundumleuchte
function lights(g, xf, xr, y, zf, color = 0xfff1c4) {
  const hl = new THREE.Group();
  hl.name = 'hl';
  const tl = new THREE.Group();
  tl.name = 'tl';
  for (const s of [-1, 1]) {
    const a = new THREE.Sprite(spriteMat(color));
    a.position.set(xf + 0.012, y, s * zf);
    a.scale.setScalar(0.07);
    hl.add(a);
    const b = new THREE.Sprite(spriteMat(0xff2a1a));
    b.position.set(xr - 0.008, y + 0.005, s * zf);
    b.scale.setScalar(0.04);
    tl.add(b);
  }
  hl.visible = tl.visible = false;
  g.add(hl, tl);
}
function beacon(g, k, x, y, z = 0, color = 0xffa31a) {
  k.cyl(x, y + 0.003, z, 0.012, 0.006, 'y', matte(DARK), 10);
  k.cyl(x, y + 0.011, z, 0.008, 0.012, 'y', paint(color, 90), 10);
  const bc = new THREE.Sprite(spriteMat(color));
  bc.name = 'bcn';
  bc.position.set(x, y + 0.016, z);
  bc.scale.setScalar(0.12);
  g.add(bc);
}

// LD3-Container (Profil mit abgeschrägter Unterkante), Einheit: Tiefe 1 in x
let _ld3 = null;
function ld3Geo() {
  if (_ld3) return _ld3;
  const s = new THREE.Shape();
  s.moveTo(-0.028, 0);
  s.lineTo(0.05, 0);
  s.lineTo(0.05, 0.08);
  s.lineTo(-0.05, 0.08);
  s.lineTo(-0.05, 0.03);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  return (_ld3 = g);
}

// ---------- Fahrzeuge ----------
// Flugzeugschlepper: flache Wanne mit schrägen Enden, Warnstreifen-Stoßfänger, Kanzel links rundum verglast
function tug(k, g, body) {
  const h = 0.21, w = 0.16, top = 0.07;
  k.bx(-h + 0.02, h - 0.02, 0.022, 0.036, w - 0.05, matte(DARK));
  k.prof([[-h, 0.03, 0.006], [h, 0.03, 0.006], [h, 0.054, 0.012], [h - 0.045, top, 0.02], [-h + 0.045, top, 0.02], [-h, 0.054, 0.012]], w, body, 0.016);
  k.rbx(h - 0.004, h + 0.013, 0.024, 0.05, w - 0.004, hazard(), 0.006);
  k.rbx(-h - 0.013, -h + 0.004, 0.024, 0.05, w - 0.004, hazard(), 0.006);
  k.cyl(h + 0.022, 0.037, 0, 0.007, 0.022, 'x', metal(0x8b9299), 8);
  k.cyl(-h - 0.022, 0.037, 0, 0.007, 0.022, 'x', metal(0x8b9299), 8);
  // Motorhaube hinten mit Lüftungsgitter, Auspuff
  k.rbx(-h + 0.05, -0.05, top - 0.004, top + 0.024, w - 0.05, body, 0.01);
  for (let x = -h + 0.07; x < -0.07; x += 0.012) k.bx(x, x + 0.006, top + 0.024, top + 0.0255, w - 0.09, matte(0x1f2328));
  k.cyl(-0.075, top + 0.05, w / 2 - 0.03, 0.005, 0.055, 'y', metal(0x6b7280), 8);
  // Kanzel links: Brüstung, Glas mit runden Ecken, Dach
  const cz0 = -w / 2 + 0.006, cz1 = -w / 2 + 0.082, cx0 = -0.03, cx1 = 0.085, cy = top + 0.064;
  k.rbox(cx0, cx1, top - 0.004, top + 0.018, cz0, cz1, body, 0.008);
  k.rbox(cx0 + 0.003, cx1 - 0.003, top + 0.012, cy, cz0 + 0.003, cz1 - 0.003, glass(), 0.01);
  k.rbox(cx0 - 0.003, cx1 + 0.003, cy - 0.003, cy + 0.008, cz0 - 0.003, cz1 + 0.003, body, 0.006);
  k.rbox(cx0 + 0.016, cx0 + 0.04, top + 0.012, top + 0.04, cz0 + 0.02, cz1 - 0.02, matte(0x1f2937), 0.006);
  // Scheinwerfer in den Schrägen
  k.pair(h - 0.006, h - 0.001, 0.056, 0.064, w / 2 - 0.024, 0.024, lamp(0xfff4d6));
  k.pair(-h + 0.001, -h + 0.006, 0.056, 0.062, w / 2 - 0.024, 0.018, lamp(0xb91c1c));
  for (const x of [h - 0.085, -h + 0.085]) {
    k.well(x, 0.026, w - 0.004);
    k.axle(x, w / 2 - 0.016, 0.026, 0.032);
  }
  beacon(g, k, (cx0 + cx1) / 2, cy + 0.008, (cz0 + cz1) / 2);
  lights(g, h, -h, 0.06, w / 2 - 0.03);
}

// Gepäckzug wie auf dem Vorfeld: gelber Gepäckschlepper mit kurzer, abgeschrägter Haube und hoher, rundum verglaster
// Kabine (Rundumleuchte auf dem Dach), dahinter zwei offene Gepäckwagen mit Koffern und Taschen und ein gelber,
// überdachter Wagen mit offenen Seiten
function baggage(k, g, body) {
  const h = 0.475, x1 = h, x0 = h - 0.15, w = 0.088, yr = 0.13;
  const yel = paint(0xf2c418, 60), black = matte(0x1b1d21), rail = metal(0xc3c9d0);
  // Fahrgestell, Unterbau mit Haube vorn
  k.rbx(x0 + 0.004, x1 - 0.004, 0.014, 0.03, w - 0.014, black, 0.004);
  k.prof([[x0, 0.026], [x1, 0.026, 0.004], [x1 + 0.002, 0.05, 0.008], [x1 - 0.042, 0.064, 0.008], [x0, 0.064, 0.006]], w, yel, 0.012);
  // Kabine: Rahmen in Gelb, Scheiben rundum (Front leicht geneigt), Dach mit Überstand
  const cf = x1 - 0.046, cr = x0 + 0.006;
  k.prof([[cr, 0.06], [cf, 0.06], [cf - 0.008, yr, 0.004], [cr, yr, 0.004]], w - 0.006, yel, 0.006);
  k.slab(cf + 0.0012, 0.068, cf - 0.0062, yr - 0.006, 0.002, w - 0.022, glass());
  k.side([[cr + 0.008, 0.07], [cf - 0.008, 0.07], [cf - 0.013, yr - 0.008], [cr + 0.008, yr - 0.008]], (w - 0.006) / 2 + 0.0008, glass());
  k.box(cr - 0.0008, cr + 0.001, 0.072, yr - 0.008, -(w - 0.022) / 2, (w - 0.022) / 2, glass());
  k.side([[(cr + cf) / 2 - 0.003, 0.07], [(cr + cf) / 2 + 0.003, 0.07], [(cr + cf) / 2 + 0.003, yr - 0.008], [(cr + cf) / 2 - 0.003, yr - 0.008]], (w - 0.006) / 2 + 0.0012, yel); // Türsäule
  k.rbox(cr - 0.006, cf - 0.002, yr - 0.002, yr + 0.006, -w / 2 - 0.003, w / 2 + 0.003, yel, 0.003);
  // Stoßfänger, Scheinwerfer, Spiegel, Anhängekupplung
  k.rbx(x1 - 0.004, x1 + 0.008, 0.016, 0.032, w + 0.002, black, 0.005);
  k.rbx(x0 - 0.008, x0 + 0.004, 0.016, 0.034, w + 0.002, black, 0.005);
  k.pair(x1 + 0.0005, x1 + 0.0035, 0.044, 0.052, w / 2 - 0.014, 0.014, lamp(0xfff4d6));
  for (const s of [-1, 1]) k.obox(cf - 0.002, 0.092, s * (w / 2 + 0.006), 0.004, 0.014, 0.008, black);
  k.rod([x0 - 0.006, 0.026, 0], [x0 - 0.03, 0.028, 0], 0.006, black);
  for (const x of [x0 + 0.03, x1 - 0.03]) {
    k.well(x, 0.017, w + 0.002);
    k.axle(x, w / 2 - 0.002, 0.017, 0.02);
  }
  tail(k, x0 - 0.008, 0.04, w);
  beacon(g, k, (cr + cf) / 2, yr + 0.006);
  lights(g, x1, x0, 0.048, w / 2 - 0.014);
  // Wagen: Plattform mit Rahmen, Deichsel, vier kleine Räder; Gepäck zufällig, aber fest je Wagen
  const BAG = [0x1f2937, 0x7f1d1d, 0x1e3a8a, 0x065f46, 0x9ca3af, 0x6b21a8, 0xb45309, 0x0f766e, 0x374151, 0xbe123c];
  let n = 3;
  const rnd = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  const luggage = (a, b, zw, top) => {
    // Koffer liegend und stehend in zwei Lagen, dazwischen Reisetaschen
    for (let x = a; x < b - 0.024; x += 0.03)
      for (const z of [-zw / 4, zw / 4]) {
        const hh = 0.012 + rnd() * 0.012, col = matte(BAG[Math.floor(rnd() * BAG.length)]);
        if (rnd() < 0.7) k.rbox(x, x + 0.026, 0.04, 0.04 + hh, z - zw / 4 + 0.003, z + zw / 4 - 0.003, col, 0.004);
        else k.cyl(x + 0.013, 0.048, z, 0.009, zw / 2 - 0.01, 'z', col, 10);
        if (rnd() < 0.55 && 0.04 + hh + 0.03 < top) {
          const c2 = matte(BAG[Math.floor(rnd() * BAG.length)]);
          if (rnd() < 0.5) k.rbox(x + 0.002, x + 0.024, 0.04 + hh, 0.04 + hh + 0.012 + rnd() * 0.012, z - zw / 4 + 0.005, z + zw / 4 - 0.005, c2, 0.004);
          else k.rbox(x + 0.006, x + 0.016, 0.04 + hh, 0.04 + hh + 0.028, z - zw / 4 + 0.004, z + zw / 4 - 0.004, c2, 0.003); // Koffer hochkant
        }
      }
  };
  for (let i = 0; i < 3; i++) {
    const c1 = x0 - 0.03 - i * 0.24, c0 = c1 - 0.21, cw = 0.1;
    if (i) k.rod([c1, 0.03, 0], [c1 + 0.03, 0.03, 0], 0.006, matte(DARK));
    k.rbx(c0, c1, 0.03, 0.04, cw, metal(0x8b9299), 0.003);
    k.bx(c0 + 0.01, c1 - 0.01, 0.018, 0.03, 0.03, matte(DARK));
    k.axle(c0 + 0.035, cw / 2 - 0.004, 0.014, 0.016);
    k.axle(c1 - 0.035, cw / 2 - 0.004, 0.014, 0.016);
    if (i < 2) {
      // offener Wagen: Eckpfosten, niedrige Reling, vorn ein Gitterrahmen
      for (const x of [c0 + 0.004, c1 - 0.004]) for (const s of [-1, 1]) k.rod([x, 0.04, s * (cw / 2 - 0.003)], [x, 0.064, s * (cw / 2 - 0.003)], 0.004, rail);
      for (const s of [-1, 1]) k.rod([c0 + 0.004, 0.064, s * (cw / 2 - 0.003)], [c1 - 0.004, 0.064, s * (cw / 2 - 0.003)], 0.003, rail);
      k.rod([c1 - 0.004, 0.064, -(cw / 2 - 0.003)], [c1 - 0.004, 0.064, cw / 2 - 0.003], 0.003, rail);
      k.box(c1 - 0.006, c1 - 0.002, 0.04, 0.095, -(cw / 2 - 0.004), cw / 2 - 0.004, rail);
      luggage(c0 + 0.012, c1 - 0.012, cw - 0.012, 0.11);
    } else {
      // überdachter Wagen: gelbes Dach und Stirnwände, Seiten offen
      for (const x of [c0 + 0.002, c1 - 0.008]) k.box(x, x + 0.006, 0.04, 0.118, -(cw / 2), cw / 2, yel);
      for (const x of [(c0 + c1) / 2 - 0.003]) for (const s of [-1, 1]) k.box(x, x + 0.006, 0.04, 0.118, s * (cw / 2 - 0.006), s * (cw / 2), yel);
      k.rbox(c0 - 0.004, c1 + 0.004, 0.116, 0.126, -cw / 2 - 0.006, cw / 2 + 0.006, yel, 0.004);
      for (const s of [-1, 1]) k.side([[c0 + 0.008, 0.104], [c1 - 0.008, 0.104], [c1 - 0.008, 0.116], [c0 + 0.008, 0.116]], cw / 2 + 0.001, matte(0x3f3f46)); // eingerollte Plane
      luggage(c0 + 0.014, c1 - 0.014, cw - 0.014, 0.105);
    }
  }
}

function fuel(k, g, body) {
  const h = 0.39, w = 0.125;
  k.bx(-h + 0.02, h - 0.02, 0.026, 0.044, 0.08, matte(DARK));
  cab(k, h - 0.15, h, 0.032, 0.158, w, body, { roof: paint(0xf8fafc) });
  // Kessel mit gewölbten Böden, rote Ringe, Laufsteg mit Geländer, Domdeckel
  const tx0 = -h + 0.075, tx1 = h - 0.17, ty = 0.106;
  const steel = metal(0xdfe4e9);
  k.cyl((tx0 + tx1) / 2, ty, 0, 0.06, tx1 - tx0, 'x', steel, 24, 0.061);
  k.sph(tx0, ty, 0, 0.026, 0.06, 0.061, steel);
  k.sph(tx1, ty, 0, 0.026, 0.06, 0.061, steel);
  for (const x of [tx0 + 0.04, (tx0 + tx1) / 2, tx1 - 0.04]) k.cyl(x, ty, 0, 0.0612, 0.014, 'x', paint(0xdc2626), 24, 0.0622);
  k.bx(tx0 + 0.01, tx1 - 0.01, ty + 0.06, ty + 0.064, 0.032, matte(0x6b7280));
  for (let x = tx0 + 0.02; x <= tx1 - 0.01; x += 0.08) for (const s of [-1, 1]) k.rod([x, ty + 0.064, s * 0.017], [x, ty + 0.086, s * 0.017], 0.003, metal(0xcbd5e1));
  for (const s of [-1, 1]) k.rod([tx0 + 0.02, ty + 0.086, s * 0.017], [tx1 - 0.01, ty + 0.086, s * 0.017], 0.003, metal(0xcbd5e1));
  for (const x of [tx0 + 0.09, tx0 + 0.24, tx0 + 0.39]) k.cyl(x, ty + 0.062, 0, 0.012, 0.008, 'y', metal(0xaeb6bf), 12);
  k.box(tx0 + 0.12, tx0 + 0.22, ty - 0.012, ty + 0.012, -0.0618, 0.0618, plate('jet', 'JET A-1', '#111111', '#f8fafc'));
  // Pumpenschrank hinten mit Schlauchtrommel, Leiter
  k.rbx(-h, -h + 0.07, 0.032, 0.14, 0.122, paint(0xe5e7eb), 0.01);
  k.side([[-h + 0.012, 0.05], [-h + 0.058, 0.05], [-h + 0.058, 0.128], [-h + 0.012, 0.128]], 0.0618, matte(0x9ca3af));
  k.cyl(-h - 0.006, 0.09, 0, 0.032, 0.09, 'z', matte(0x1f2937), 16);
  k.cyl(-h - 0.006, 0.09, 0, 0.012, 0.096, 'z', paint(0xdc2626), 10);
  for (let y = 0.05; y < 0.15; y += 0.022) k.box(-h + 0.072, -h + 0.076, y, y + 0.003, -0.02, 0.02, metal(0xcbd5e1));
  // Unterfahrschutz, runde Kotflügel, Räder (vorn eine, hinten zwei Achsen)
  k.pair(-h + 0.26, h - 0.16, 0.034, 0.042, 0.06, 0.004, metal(0xb4bcc5));
  for (const s of [-1, 1]) k.rbox(-h + 0.078, -h + 0.242, 0.056, 0.066, s * 0.041, s * 0.071, matte(DARK), 0.004);
  k.well(h - 0.075, 0.027, w + 0.001);
  k.axle(h - 0.075, 0.052, 0.027, 0.026);
  k.axle(-h + 0.12, 0.052, 0.027, 0.026);
  k.axle(-h + 0.2, 0.052, 0.027, 0.026);
  tail(k, -h, 0.05, 0.122);
  beacon(g, k, h - 0.075, 0.163);
  lights(g, h, -h, 0.064, w / 2 - 0.02);
}

function catering(k, g, body) {
  const h = 0.31, w = 0.128;
  const teal = paint(0x0f766e);
  k.bx(-h + 0.02, h - 0.02, 0.026, 0.05, 0.085, matte(DARK));
  k.rbx(-h + 0.01, h - 0.15, 0.05, 0.07, w - 0.01, matte(0x3a3f46), 0.005);
  cab(k, h - 0.135, h, 0.032, 0.15, w, paint(0xf8fafc), { roof: teal });
  k.side([[h - 0.122, 0.07], [h - 0.016, 0.07], [h - 0.016, 0.077], [h - 0.122, 0.077]], w / 2 + 0.0009, teal);
  k.axle(h - 0.07, 0.054, 0.026, 0.026);
  k.axle(-h + 0.085, 0.054, 0.026, 0.026);
  for (const s of [-1, 1]) k.rbox(-h + 0.048, -h + 0.122, 0.052, 0.062, s * 0.04, s * 0.072, matte(DARK), 0.004);
  k.well(h - 0.07, 0.026, w + 0.001);
  beacon(g, k, h - 0.07, 0.157);
  lights(g, h, -h, 0.064, w / 2 - 0.02);
  // Hubkasten (Gruppe 'lift', fährt hoch) mit Plattform ('plat', schiebt sich nach vorn) und Schere ('scis')
  const lk = new Kit();
  const bx0 = -h + 0.006, bx1 = h - 0.15;
  lk.rbx(bx0, bx1, 0, 0.13, 0.13, paint(0xf3f4f6, 30), 0.012);
  lk.side([[bx0 + 0.012, 0.03], [bx1 - 0.012, 0.03], [bx1 - 0.012, 0.05], [bx0 + 0.012, 0.05]], 0.0658, teal);
  lk.side([[bx0 + 0.02, 0.056], [bx0 + 0.09, 0.056], [bx0 + 0.09, 0.118], [bx0 + 0.02, 0.118]], 0.0658, matte(0xd1d5db));
  lk.rbx(bx0 - 0.002, bx1 + 0.002, 0.126, 0.137, 0.134, teal, 0.006);
  lk.bx(bx1, bx1 + 0.003, 0.012, 0.118, 0.1, matte(0xc7ccd2));
  tail(lk, bx0, 0.004, 0.13);
  const lift = lk.build();
  // Aufschrift des Caterers auf dem Kasten (fährt mit hoch)
  decal(g, 'cater', (bx0 + bx1) / 2 - 0.03, 0.088, 0.0662, 0.3, 0.06, logo('#f3f4f6', '#0f766e', T('KRANICH CATERING'), T('Bordverpflegung'), (c, w, h) => {
    c.strokeStyle = '#0f766e';
    c.lineWidth = h * 0.08;
    c.beginPath();
    c.moveTo(h * 0.2, h * 0.8);
    c.quadraticCurveTo(h * 0.5, h * 0.1, h * 0.95, h * 0.35);
    c.moveTo(h * 0.45, h * 0.5);
    c.lineTo(h * 0.35, h * 0.9);
    c.stroke();
  }), lift);
  lift.name = 'lift';
  lift.position.y = 0.07;
  const pk = new Kit();
  pk.bx(0, 0.09, 0, 0.008, 0.12, metal(0x9aa3ad));
  for (const s of [-1, 1]) {
    pk.rod([0.005, 0.008, s * 0.058], [0.005, 0.05, s * 0.058], 0.004, paint(0xfacc15));
    pk.rod([0.085, 0.008, s * 0.058], [0.085, 0.05, s * 0.058], 0.004, paint(0xfacc15));
    pk.rod([0.005, 0.05, s * 0.058], [0.085, 0.05, s * 0.058], 0.004, paint(0xfacc15));
  }
  const plat = pk.build();
  plat.name = 'plat';
  plat.position.set(bx1, 0.005, 0);
  plat.visible = false;
  lift.add(plat);
  const sk = new Kit();
  for (const s of [-1, 1]) {
    sk.rod([-0.13, 0, s * 0.045], [0.13, 1, s * 0.045], 0.012, matte(0x4b5563));
    sk.rod([-0.13, 1, s * 0.045], [0.13, 0, s * 0.045], 0.012, matte(0x4b5563));
  }
  const scis = sk.build();
  scis.name = 'scis';
  scis.position.set((bx0 + bx1) / 2, 0.07, 0);
  scis.scale.y = 0.001;
  scis.visible = false;
  g.add(lift, scis);
}

// Transporter (Reinigung, Standard): Karosserie aus einem Stück mit kurzer Haube, stark geneigter Frontscheibe und
// hohem, rundem Dach; Fensterband, Schiebetür, Radhäuser, Dachträger
function van(k, g, body) {
  const h = 0.18, w = 0.1, H = 0.122, b = 0.013, dark = matte(0x1c1f24);
  const ws0 = [h - 0.05, 0.078], ws1 = [h - 0.098, H];
  k.prof([[-h, 0.018, 0.006], [h, 0.018, 0.008], [h + 0.003, 0.064, 0.018], ws0.concat(0.014), ws1.concat(0.026), [-h, H, 0.016]], w, body, b);
  // Frontscheibe, Seitenfenster (Fahrertür, Fensterband hinten), Säulen, Heckscheiben
  const L = Math.hypot(ws1[0] - ws0[0], ws1[1] - ws0[1]), nx = (ws1[1] - ws0[1]) / L, ny = (ws0[0] - ws1[0]) / L;
  const at = (f) => [ws0[0] + (ws1[0] - ws0[0]) * f + nx * 0.0012, ws0[1] + (ws1[1] - ws0[1]) * f + ny * 0.0012];
  k.slab(...at(0.1), ...at(0.86), 0.002, w - 2 * b - 0.002, glass());
  const yt = H - b - 0.004;
  k.side([[h - 0.124, 0.08], [h - 0.068, 0.08], [h - 0.068 - (0.048 * (yt - 0.08)) / 0.044, yt], [h - 0.124, yt]], w / 2 + 0.0008, glass());
  k.side([[-h + b + 0.006, 0.08], [h - 0.134, 0.08], [h - 0.134, yt], [-h + b + 0.006, yt]], w / 2 + 0.0008, glass());
  for (const x of [-0.07, 0.02]) k.side([[x, 0.079], [x + 0.007, 0.079], [x + 0.007, yt + 0.001], [x, yt + 0.001]], w / 2 + 0.0013, body);
  k.side([[0.004, 0.026], [0.0055, 0.026], [0.0055, yt], [0.004, yt]], w / 2 + 0.0013, dark);
  k.side([[-h + 0.016, 0.0745], [h - 0.06, 0.0745], [h - 0.06, 0.0775], [-h + 0.016, 0.0775]], w / 2 + 0.0009, paint(0xf8fafc));
  k.bx(-h - 0.0012, -h + 0.002, 0.08, yt, w - 2 * b - 0.008, glass());
  k.bx(-h - 0.0016, -h + 0.002, 0.026, yt, 0.0018, dark);
  // Dachträger
  for (const x of [-h + 0.03, -0.03, h - 0.13]) k.rbx(x, x + 0.007, H - 0.002, H + 0.012, w - 0.016, matte(0x2a2d33), 0.002);
  k.pair(-h + 0.03, h - 0.123, H + 0.01, H + 0.014, w / 2 - 0.008, 0.004, matte(0x2a2d33));
  // Front: Stoßfänger, Grill, Scheinwerfer, Spiegel
  k.rbx(h - 0.008, h + 0.012, 0.013, 0.036, w + 0.002, matte(DARK), 0.008);
  k.bx(h - 0.001, h + 0.004, 0.038, 0.054, w * 0.42, matte(0x2f343b));
  k.pair(h - 0.002, h + 0.004, 0.044, 0.056, w / 2 - 0.016, 0.02, lamp(0xfff4d6));
  k.pair(ws0[0] - 0.008, ws0[0] + 0.002, 0.078, 0.096, w / 2 + 0.01, 0.004, dark);
  k.rbx(-h - 0.006, -h + 0.006, 0.014, 0.03, w + 0.002, matte(DARK), 0.005);
  tail(k, -h, 0.05, w);
  for (const x of [h - 0.045, -h + 0.05]) {
    k.well(x, 0.021, w + 0.002);
    k.axle(x, w / 2 - 0.006, 0.021, 0.02);
  }
  beacon(g, k, h - 0.12, H);
  lights(g, h, -h, 0.048, w / 2 - 0.012);
  decal(g, 'clean', -0.045, 0.06, w / 2 + 0.0012, 0.17, 0.03, logo('#16a34a', '#f0fdf4', T('KABINENSERVICE'), null));
}

// Glanz auf gemalten Scheiben (wie die Glastextur der übrigen Scheiben): oben Himmelsspiegelung, schräge Lichtstreifen
function sheen(g, x, y, w, h) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const top = g.createLinearGradient(0, y, 0, y + h * 0.35);
  top.addColorStop(0, 'rgba(225,238,250,0.45)');
  top.addColorStop(1, 'rgba(225,238,250,0)');
  g.fillStyle = top;
  g.fillRect(x, y, w, h * 0.35);
  for (let sx = x - h; sx < x + w; sx += 170) {
    for (const [o, bw, a] of [[0, 26, 0.22], [40, 8, 0.2]]) {
      g.fillStyle = `rgba(235,245,255,${a})`;
      g.beginPath();
      g.moveTo(sx + o, y + h);
      g.lineTo(sx + o + bw, y + h);
      g.lineTo(sx + o + bw + h * 0.8, y);
      g.lineTo(sx + o + h * 0.8, y);
      g.fill();
    }
  }
  g.restore();
}

// moderner Vorfeldbus: Niederflur, umlaufendes Glasband mit schmalen Säulen, abgerundete Ecken, je Seite drei
// Doppeltüren, blaue Schürze mit türkisem Zierstreifen, weißes Dach mit Klimaanlagen, Zielanzeige vorn
// ---------- Vorfeldbus: Seitenbild mit Werbung und Fahrgästen ----------
// Die Busse fahren in Flughafenfarben oder mit Werbung (fiktive Marken); hinter den Scheiben sieht man, ob er leer,
// halb oder voll ist (load 0/1/2). Das Seitenbild ist eine Fläche je Seite über der Karosserie.
export const BUS_ADS = 7;
const BUS = { h: 0.36, w: 0.15, rr: 0.022, y0: 0.012, y1: 0.15, g0: 0.043, g1: 0.128, roof: 0.014, wr: 0.022 };
const BUS_WHEELS = [0.125, -0.125]; // Achsen zwischen den Türen
const TW = 1024, TH = 210;
const ty = (y) => ((BUS.y1 - y) / (BUS.y1 - BUS.y0)) * TH; // Höhe -> Bildzeile
const tx = (x) => ((x + BUS.h - BUS.rr) / (2 * (BUS.h - BUS.rr))) * TW; // Länge -> Bildspalte (hinten 0, vorn TW)
const DOORS = [-0.24, 0, 0.24];
function adDesign(g, ad) {
  const big = (text, x, y, size, col, font = 'bold') => {
    g.font = `${font} ${size}px "Segoe UI", Arial, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = col;
    g.fillText(text, x, y);
  };
  const grad = (stops) => {
    const gr = g.createLinearGradient(0, 0, TW, TH);
    stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
    g.fillStyle = gr;
    g.fillRect(0, 0, TW, TH);
  };
  if (ad === 1) {
    // Aurora Airways: Polarlicht-Schwung in Rot
    grad(['#7f1d1d', '#e63946', '#f97316']);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, TH * (0.2 + i * 0.18));
      g.bezierCurveTo(TW * 0.3, TH * (0.05 + i * 0.2), TW * 0.6, TH * (0.5 + i * 0.1), TW, TH * (0.15 + i * 0.18));
      g.lineTo(TW, TH * (0.22 + i * 0.18));
      g.bezierCurveTo(TW * 0.6, TH * (0.58 + i * 0.1), TW * 0.3, TH * (0.12 + i * 0.2), 0, TH * (0.27 + i * 0.18));
      g.fill();
    }
    big('AURORA AIRWAYS', TW * 0.4, TH * 0.5, 64, '#ffffff', '900');
    big(T('ab Planez nach New York'), TW * 0.4, TH * 0.82, 26, '#fde68a', '600');
  } else if (ad === 2) {
    // Nordstern: Sonne auf Lila
    grad(['#4c1d95', '#7c3aed', '#a855f7']);
    g.fillStyle = '#fde047';
    g.beginPath();
    g.arc(TW * 0.82, TH * 0.45, 70, 0, Math.PI * 2);
    g.fill();
    big('NORDSTERN', TW * 0.38, TH * 0.45, 70, '#fde047', '900');
    big(T('Sonne ab 49 €'), TW * 0.38, TH * 0.8, 30, '#ffffff', '700');
  } else if (ad === 3) {
    // Waldbrunn Therme: Wellen in Türkis
    grad(['#0e7490', '#14b8a6', '#99f6e4']);
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 6;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      for (let x = 0; x <= TW; x += 16) g.lineTo(x, TH * (0.62 + k * 0.1) + Math.sin(x / 50 + k) * 6);
      g.stroke();
    }
    big(T('Waldbrunn Therme'), TW * 0.5, TH * 0.36, 62, '#ffffff', '800');
    big(T('Wellness am Waldrand · 15 Min. vom Flughafen'), TW * 0.5, TH * 0.6, 24, '#083344', '600');
  } else if (ad === 4) {
    // Kranich Kaffee: Tasse auf warmem Braun
    grad(['#451a03', '#92400e', '#f59e0b']);
    g.fillStyle = '#fef3c7';
    g.beginPath();
    g.ellipse(TW * 0.83, TH * 0.5, 62, 52, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#7c2d12';
    g.beginPath();
    g.ellipse(TW * 0.83, TH * 0.47, 44, 24, 0, 0, Math.PI * 2);
    g.fill();
    big(T('Kranich Kaffee'), TW * 0.4, TH * 0.42, 68, '#fef3c7', '800');
    big(T('frisch gebrüht an jedem Gate'), TW * 0.4, TH * 0.72, 28, '#fde68a', '600');
  } else if (ad === 5) {
    // Duty Free: Schwarz und Gold
    grad(['#0b0b0f', '#1f2937', '#0b0b0f']);
    g.strokeStyle = '#d4af37';
    g.lineWidth = 4;
    g.strokeRect(14, 14, TW - 28, TH - 28);
    big('DUTY FREE', TW * 0.5, TH * 0.42, 74, '#d4af37', '900');
    big(T('Planez Airport · bis zu 30 % sparen'), TW * 0.5, TH * 0.73, 26, '#f8fafc', '600');
  } else if (ad === 6) {
    // Lumen Air: Lindgrün auf Indigo
    grad(['#312e81', '#3730a3', '#4338ca']);
    g.fillStyle = '#84cc16';
    g.beginPath();
    g.moveTo(TW * 0.62, TH);
    g.lineTo(TW * 0.78, 0);
    g.lineTo(TW, 0);
    g.lineTo(TW, TH);
    g.fill();
    big('LUMEN AIR', TW * 0.33, TH * 0.44, 70, '#d9f99d', '900');
    big(T('günstig in den Süden'), TW * 0.33, TH * 0.76, 28, '#ffffff', '600');
  }
}
// Fahrgäste hinter den Scheiben: stehend, Köpfe und Schultern, fest verteilt
function riders(g, load) {
  if (!load) {
    // leer: nur gelbe Haltestangen
    g.fillStyle = 'rgba(250,204,21,0.55)';
    for (let x = 60; x < TW; x += 120) g.fillRect(x, ty(BUS.g1) + 6, 4, ty(BUS.g0) - ty(BUS.g1) - 8);
    return;
  }
  let n = 5;
  const rnd = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  const COL = ['#0f172a', '#1e293b', '#3f1d1d', '#1e3a5f', '#334155', '#422006', '#0b3b2e'];
  const step = load === 2 ? 26 : 30;
  for (let x = 20; x < TW - 10; x += step) {
    const p = rnd();
    if (p > (load === 2 ? 0.95 : 0.42)) continue;
    const head = ty(BUS.g0 + 0.072 + rnd() * 0.012);
    const col = COL[Math.floor(rnd() * COL.length)];
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(x + rnd() * 8, head + 24, 14, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x - 13, head + 24, 26, ty(BUS.g0) - head - 22);
    g.fillStyle = '#c69c7c';
    g.beginPath();
    g.arc(x + rnd() * 6, head, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b1d14';
    g.beginPath();
    g.arc(x, head - 3, 9, Math.PI, 0);
    g.fill();
  }
}
const busSideMat = (ad, load) => canvasMat(`bus${ad}|${load}`, TW, TH, (g) => {
  const W0 = ty(BUS.g1), W1 = ty(BUS.g0);
  if (ad) adDesign(g, ad);
  else {
    // Flughafenfarben: weißes Dach-Band mit Schriftzug, blaue Schürze mit türkisem Streifen
    g.fillStyle = '#f8fafc';
    g.fillRect(0, 0, TW, TH);
    g.fillStyle = '#1d4ed8';
    g.fillRect(0, ty(0.036), TW, TH);
    g.fillStyle = '#14b8a6';
    g.fillRect(0, ty(BUS.g0), TW, ty(0.036) - ty(BUS.g0));
    g.font = 'bold 22px "Segoe UI", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#1d4ed8';
    g.fillText('PLANEZ AIRPORT', 24, W0 / 2 + 1);
  }
  // Fensterband: Glas, Fahrgäste dahinter, bei Werbung darüber die gelochte Folie (Motiv halb durchsichtig)
  const ad0 = document.createElement('canvas');
  ad0.width = TW;
  ad0.height = TH;
  ad0.getContext('2d').drawImage(g.canvas, 0, 0);
  const gl = g.createLinearGradient(0, W0, 0, W1);
  gl.addColorStop(0, '#9dbad3');
  gl.addColorStop(0.3, '#4d6f8e');
  gl.addColorStop(1, '#16222f');
  g.fillStyle = gl;
  g.fillRect(0, W0, TW, W1 - W0);
  riders(g, load);
  if (ad) {
    g.globalAlpha = 0.5;
    g.drawImage(ad0, 0, W0, TW, W1 - W0, 0, W0, TW, W1 - W0);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = W0 + 2; y < W1; y += 5) for (let x = (y % 10) / 2; x < TW; x += 5) g.fillRect(x, y, 2, 2);
  }
  sheen(g, 0, W0, TW, W1 - W0);
  // Fenstersäulen
  g.fillStyle = ad ? 'rgba(255,255,255,0.18)' : '#f8fafc';
  for (let x = 0; x < TW; x += 92) g.fillRect(x, W0, 7, W1 - W0);
  // Doppeltüren: silberner Rahmen, freies Glas bis fast zum Boden, Mittelfuge
  for (const d of DOORS) {
    const a = tx(d - 0.05), b = tx(d + 0.05), top = ty(0.13), bot = ty(0.015);
    g.fillStyle = '#cbd5e1';
    g.fillRect(a, top, b - a, bot - top);
    const dg = g.createLinearGradient(0, top, 0, bot);
    dg.addColorStop(0, '#9dbad3');
    dg.addColorStop(0.35, '#3f5f7d');
    dg.addColorStop(1, '#16222f');
    g.fillStyle = dg;
    g.fillRect(a + 6, top + 5, b - a - 12, bot - top - 9);
    g.save();
    g.beginPath();
    g.rect(a + 6, top + 5, b - a - 12, bot - top - 9);
    g.clip();
    if (load) riders(g, load);
    sheen(g, a + 6, top + 5, b - a - 12, bot - top - 9);
    g.restore();
    g.fillStyle = '#cbd5e1';
    g.fillRect((a + b) / 2 - 2, top, 4, bot - top);
  }
  // Schmutz unten
  const dirt = g.createLinearGradient(0, ty(0.04), 0, TH);
  dirt.addColorStop(0, 'rgba(60,50,40,0)');
  dirt.addColorStop(1, 'rgba(60,50,40,0.35)');
  g.fillStyle = dirt;
  g.fillRect(0, ty(0.04), TW, TH - ty(0.04));
  // Radhäuser: dunkler Bogen mit hellem Rand über den Rädern
  const ax = TW / (2 * (BUS.h - BUS.rr)), ay = TH / (BUS.y1 - BUS.y0);
  for (const x of BUS_WHEELS) {
    g.beginPath();
    g.ellipse(tx(x), ty(BUS.wr), (BUS.wr + 0.005) * ax, (BUS.wr + 0.005) * ay, 0, Math.PI, 0);
    g.closePath();
    g.fillStyle = '#0d0f12';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(203,213,225,0.7)';
    g.stroke();
  }
});
// welches Motiv fährt dieser Bus? (fest je Fahrzeug; jeder dritte in Flughafenfarben)
export function busAd(v) {
  let h = 0;
  for (const c of String(v.id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 3 === 0 ? 0 : 1 + (h % (BUS_ADS - 1));
}
// Fahrgäste im Bus austauschen (0 leer, 1 halb, 2 voll)
export function setBusLoad(m, load) {
  const P = vehParts(m);
  if (P.load === load || !P.sides) return;
  P.load = load;
  for (const s of P.sides) s.material = busSideMat(P.ad, load);
}

// moderner Vorfeldbus: Niederflur, rundum gerundete Ecken und Dachkanten, weißes Dach mit Klimaanlagen, Zielanzeige
// vorn, große Räder zwischen den Türen; die Seiten tragen das Bild aus busSideMat (Fenster, Türen, Radhäuser, Werbung,
// Fahrgäste)
function bus(k, g, body, ad = 0) {
  const { h, w, rr, g1 } = BUS;
  const H = BUS.y1, R = BUS.roof;
  const white = paint(0xf8fafc, 40), blue = paint(0x1d4ed8, 60);
  const band = (y0, y1, m) => {
    k.bx(-h + rr, h - rr, y0, y1, w, m);
    k.box(-h, h, y0, y1, -w / 2 + rr, w / 2 - rr, m);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(sx * (h - rr), (y0 + y1) / 2, sz * (w / 2 - rr), rr, y1 - y0, 'y', m, 16);
  };
  band(0.012, 0.043, blue);
  band(0.043, g1, glass());
  // Dach: Ecken wie unten, Kanten oben rund
  k.rbx(-h, h, g1 - rr, H + R, w, white, rr);
  // Front: Scheibe weit herunter, Zielanzeige, Scheinwerfer; Heck: Scheibe, Rückleuchten
  k.bx(h - 0.001, h + 0.0025, 0.028, g1, w - 2 * rr, glass());
  k.bx(h - 0.001, h + 0.003, 0.131, 0.146, w * 0.5, lamp(0xf59e0b));
  k.pair(h - 0.004, h + 0.002, 0.016, 0.027, w / 2 - rr - 0.012, 0.022, lamp(0xfff4d6));
  k.bx(-h - 0.0025, -h + 0.001, 0.05, g1, w - 2 * rr, glass());
  tail(k, -h, 0.018, w - 0.02);
  // Klimaanlagen auf dem Dach
  for (const x of [-0.17, 0.15]) {
    k.rbx(x - 0.07, x + 0.07, H + R - 0.003, H + R + 0.011, 0.09, paint(0xe5e7eb, 30), 0.006);
    k.bx(x - 0.055, x + 0.055, H + R + 0.011, H + R + 0.013, 0.066, matte(0x94a3b8));
  }
  for (const x of BUS_WHEELS) k.axle(x, w / 2 + 0.003 - 0.009, BUS.wr, 0.018);
  beacon(g, k, h - 0.06, H + R);
  lights(g, h, -h, 0.022, w / 2 - rr - 0.012);
  // Seitenbilder (eigene Netze, damit sich Fahrgäste und Motiv je Bus tauschen lassen)
  const L = 2 * (h - rr), Hh = H - BUS.y0;
  for (const s of [1, -1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(L, Hh), busSideMat(ad, 0));
    pl.position.set(0, (H + BUS.y0) / 2, s * (w / 2 + 0.0015));
    if (s < 0) pl.rotation.y = Math.PI;
    pl.name = 'busSide';
    g.add(pl);
  }
}

// Treppenfahrzeug: Fahrgestell mit Warnstreifen, Fahrerkabine vorn links unter dem Podest, Treppe ('ramp') an der
// Hinterachse angelenkt – sie stellt sich an der Flugzeugtür steil, das Podest mit Wetterdach ('stp') bleibt waagerecht
export const STAIRS_3D = STAIRS; // Maße in acshape.js (die Simulation stellt das Fahrzeug danach an die Tür)
function stairsTruck(k, g) {
  const h = 0.22, w = 0.12;
  const white = paint(0xf8fafc, 40), yellow = paint(0xfacc15, 50), grey = metal(0x9ca3af);
  k.rbx(-h, h, 0.018, 0.046, w, matte(0x334155), 0.008);
  k.side([[-h + 0.01, 0.034], [h - 0.01, 0.034], [h - 0.01, 0.042], [-h + 0.01, 0.042]], w / 2 + 0.0008, hazard());
  // Fahrerkabine vorn links (runde Kanten, geneigte Scheibe)
  const z0 = -w / 2, z1 = -w / 2 + 0.058;
  k.prof([[h - 0.11, 0.044], [h, 0.044, 0.006], [h, 0.07, 0.01], [h - 0.012, 0.104, 0.014], [h - 0.11, 0.104, 0.01]], 0, white, 0.01, z0, z1);
  k.box(h - 0.0035, h - 0.008, 0.074, 0.098, z0 + 0.01, z1 - 0.01, glass(), 0, 0, 0.33);
  k.box(h - 0.1, h - 0.02, 0.072, 0.096, z0 - 0.0008, z0 + 0.001, glass());
  k.box(h - 0.1, h - 0.02, 0.072, 0.096, z1 - 0.001, z1 + 0.0008, glass());
  k.pair(h - 0.002, h + 0.003, 0.05, 0.058, w / 2 - 0.016, 0.014, lamp(0xfff4d6));
  tail(k, -h, 0.03, w);
  for (const x of [h - 0.06, -h + 0.06]) {
    k.well(x, 0.02, w + 0.002);
    k.axle(x, w / 2 - 0.006, 0.02, 0.018);
  }
  // Treppe als eigene Gruppe (Drehpunkt hinten, Länge entlang +x)
  const L = STAIRS_3D.len, hw = 0.042;
  const rk = new Kit();
  rk.box(0, L, -0.004, 0.022, -hw - 0.004, -hw + 0.004, grey).box(0, L, -0.004, 0.022, hw - 0.004, hw + 0.004, grey);
  for (let x = 0.012; x < L - 0.004; x += 0.024) rk.box(x, x + 0.016, 0.012, 0.018, -hw + 0.004, hw - 0.004, matte(0xcbd5e1));
  for (const z of [-hw, hw]) {
    rk.rod([0.01, 0.022, z], [0.01, 0.07, z], 0.004, yellow).rod([L * 0.5, 0.022, z], [L * 0.5, 0.07, z], 0.004, yellow);
    rk.rod([0.01, 0.07, z], [L, 0.07, z], 0.004, yellow);
  }
  const ramp = rk.build(new THREE.Group());
  ramp.name = 'ramp';
  ramp.position.set(STAIRS_3D.hinge, STAIRS_3D.y, 0);
  g.add(ramp);
  const pk = new Kit();
  pk.box(0, 0.06, -0.006, 0.004, -hw - 0.004, hw + 0.004, grey);
  for (const z of [-hw, hw]) pk.rod([0.002, 0.004, z], [0.002, 0.11, z], 0.004, yellow).rod([0.058, 0.004, z], [0.058, 0.11, z], 0.004, yellow).rod([0.002, 0.07, z], [0.058, 0.07, z], 0.004, yellow);
  pk.rbox(-0.006, 0.066, 0.108, 0.117, -hw - 0.01, hw + 0.01, white, 0.004);
  const stp = pk.build(new THREE.Group());
  stp.name = 'stp';
  g.add(stp);
  beacon(g, k, h - 0.05, 0.104, -w / 2 + 0.03);
  lights(g, h, -h, 0.054, w / 2 - 0.016);
}

function deice(k, g, body) {
  const h = 0.41, w = 0.124;
  k.bx(-h + 0.02, h - 0.02, 0.026, 0.044, 0.08, matte(DARK));
  cab(k, h - 0.15, h, 0.032, 0.158, w, body, { roof: paint(0xf8fafc) });
  // Flüssigkeitstank mit abgerundeten Kanten, Band, Pumpenkasten
  const tx0 = -h + 0.02, tx1 = h - 0.165, white = paint(0xf1f5f9, 40);
  k.rbx(tx0, tx1, 0.044, 0.15, 0.122, white, 0.026);
  k.side([[tx0 + 0.02, 0.07], [tx1 - 0.02, 0.07], [tx1 - 0.02, 0.085], [tx0 + 0.02, 0.085]], 0.0618, body);
  k.side([[tx0 + 0.026, 0.09], [tx0 + 0.12, 0.09], [tx0 + 0.12, 0.122], [tx0 + 0.026, 0.122]], 0.0618, matte(0x9ca3af));
  decal(g, 'deice', (tx0 + tx1) / 2 + 0.06, 0.1, 0.0625, 0.24, 0.04, logo('#f1f5f9', '#ea580c', 'DE-ICING', T('Typ I / Typ IV'), null));
  for (const s of [-1, 1]) k.rbox(-h + 0.078, -h + 0.242, 0.054, 0.064, s * 0.041, s * 0.071, matte(DARK), 0.004);
  k.well(h - 0.075, 0.027, w + 0.001);
  k.axle(h - 0.075, 0.052, 0.027, 0.026);
  k.axle(-h + 0.12, 0.052, 0.027, 0.026);
  k.axle(-h + 0.2, 0.052, 0.027, 0.026);
  tail(k, -h + 0.02, 0.05, 0.122);
  beacon(g, k, h - 0.075, 0.163);
  lights(g, h, -h + 0.02, 0.064, w / 2 - 0.02);
  // Drehkranz ('tur') mit Arm ('boom'), Korb ('bask', bleibt waagrecht) und Sprühstrahl ('spray')
  const tk = new Kit();
  tk.cyl(0, 0.01, 0, 0.034, 0.02, 'y', body, 16);
  tk.rbx(-0.02, 0.02, 0.02, 0.04, 0.03, body, 0.006);
  const tur = tk.build();
  tur.name = 'tur';
  tur.position.set(-h + 0.1, 0.15, 0);
  const bk = new Kit();
  bk.rbox(0, 0.4, -0.011, 0.011, -0.011, 0.011, paint(0xf8fafc, 40), 0.007);
  bk.obox(0.12, 0.014, 0, 0.16, 0.006, 0.018, body);
  bk.rod([0.02, -0.012, 0], [0.16, -0.004, 0], 0.012, metal(0xaeb6bf));
  const boom = bk.build();
  boom.name = 'boom';
  boom.position.y = 0.032;
  boom.rotation.z = -0.03;
  const ck = new Kit();
  ck.rbx(-0.032, 0.032, -0.03, 0.03, 0.064, glass(), 0.01);
  ck.rbx(-0.034, 0.034, 0.027, 0.037, 0.068, body, 0.005);
  ck.rbx(-0.034, 0.034, -0.037, -0.024, 0.068, body, 0.005);
  ck.cyl(0.04, -0.03, 0, 0.005, 0.03, 'x', metal(0x9ca3af), 8);
  const bask = ck.build();
  bask.name = 'bask';
  bask.position.set(0.43, 0, 0);
  const spray = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 14, 1, true), cached('spray', () => new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })));
  spray.name = 'spray';
  spray.geometry.translate(0, -0.16, 0);
  spray.rotation.z = 0.9;
  spray.position.set(0.06, -0.03, 0);
  spray.visible = false;
  bask.add(spray);
  boom.add(bask);
  tur.add(boom);
  g.add(tur);
}

// Flughafen-Löschfahrzeug (6×6, etwa 11,5 × 3 × 3,6 m): Fahrerhaus mit großer, um die Ecken gezogener Panoramascheibe
// über schwarzer Front (Scheinwerfer, Frontwerfer), Spiegel an Bügeln, hoher Aufbau mit Rollläden und Reflexstreifen,
// drei große Achsen, auf dem Dach ein Löscharm mit Durchstoßlanze, der über das Fahrerhaus nach vorn ragt
function fire(k, g, body) {
  const h = 0.29, w = 0.15, xc = 0.135, yr = 0.172, dark = matte(0x1b1d21);
  // Rahmen und schwarze Schürze unten
  k.bx(-h + 0.02, h - 0.03, 0.03, 0.056, w - 0.03, matte(DARK));
  k.rbx(-h + 0.004, xc, 0.036, 0.062, w + 0.002, dark, 0.008);
  // Fahrerhaus: Seitenprofil mit schwarzer Front unten, schräger Scheibe, Dach
  const F0 = [h, 0.04], F1 = [h - 0.002, 0.09], S1 = [h - 0.05, yr];
  k.prof([[xc - 0.004, 0.04], [F0[0], F0[1], 0.01], [F1[0], F1[1], 0.008], [S1[0], S1[1], 0.007], [xc - 0.004, yr, 0.01]], w, body, 0.016);
  k.prof([[h - 0.03, 0.036], [h + 0.006, 0.036, 0.006], [h + 0.006, 0.088, 0.006], [h - 0.03, 0.088]], w + 0.004, dark, 0.014);
  // Panoramascheibe: dünne Glasschale über Front und Ecken, seitlich bis zur Türsäule
  const gx = h - 0.075;
  k.prof([[gx, 0.094], [F1[0] + 0.0016, 0.094, 0.004], [S1[0] + 0.0012, yr - 0.003, 0.004], [gx, yr - 0.003]], w + 0.003, glass(), 0.017);
  k.prof([[gx - 0.002, 0.089], [F1[0] + 0.0022, 0.089], [F1[0] + 0.0012, 0.095], [gx - 0.002, 0.095]], w + 0.0036, dark, 0.017);
  // Türen mit Fenster, Trittstufen, Griff
  k.side([[xc + 0.006, 0.104], [gx - 0.008, 0.104], [gx - 0.008, yr - 0.01], [xc + 0.006, yr - 0.01]], w / 2 + 0.0008, glass());
  k.side([[gx - 0.006, 0.042], [gx - 0.003, 0.042], [gx - 0.003, yr - 0.004], [gx - 0.006, yr - 0.004]], w / 2 + 0.0009, dark);
  for (const y of [0.046, 0.066]) k.side([[xc + 0.01, y], [xc + 0.05, y], [xc + 0.05, y + 0.004], [xc + 0.01, y + 0.004]], w / 2 + 0.006, metal(0xb8bec6), 0.006);
  // Dach des Fahrerhauses mit Blaulichtbalken
  k.rbox(xc + 0.006, S1[0] - 0.004, yr - 0.002, yr + 0.004, -w / 2 + 0.008, w / 2 - 0.008, body, 0.004);
  k.rbx(S1[0] - 0.03, S1[0] - 0.012, yr + 0.003, yr + 0.011, w - 0.03, dark, 0.003);
  // Front: Scheinwerfer, Blinker, Blaulichter unten, Nummernschild, Frontwerfer (orange) in der Mitte
  for (const s of [-1, 1]) {
    k.cyl(h + 0.006, 0.072, s * 0.05, 0.0075, 0.004, 'x', lamp(0xfff4d6), 12);
    k.cyl(h + 0.006, 0.072, s * 0.064, 0.005, 0.004, 'x', lamp(0xff9d1a), 10);
    k.cyl(h + 0.006, 0.052, s * 0.058, 0.004, 0.004, 'x', lamp(0x2563eb), 10);
  }
  k.box(h + 0.0065, h + 0.0075, 0.06, 0.068, -0.022, 0.022, plate('ffplate', 'FW 1', '#111111', '#f8fafc'));
  k.rbx(h + 0.004, h + 0.03, 0.078, 0.09, 0.034, paint(0xf26b1d, 70), 0.005);
  k.cyl(h + 0.034, 0.084, 0, 0.004, 0.012, 'x', metal(0x9aa3ad), 8);
  k.cyl(h + 0.008, 0.062, 0, 0.007, 0.016, 'y', dark, 10);
  // Spiegel an Bügeln (wie Hörner nach vorn)
  for (const s of [-1, 1]) {
    const z0 = s * (w / 2 - 0.004), z1 = s * (w / 2 + 0.016);
    k.rod([S1[0] - 0.004, yr - 0.012, z0], [S1[0] + 0.022, yr + 0.004, z1], 0.004, dark);
    k.rod([S1[0] + 0.022, yr + 0.004, z1], [S1[0] + 0.04, yr - 0.006, z1], 0.004, dark);
    k.obox(S1[0] + 0.04, yr - 0.022, z1, 0.006, 0.03, 0.012, dark);
  }
  // Aufbau: hoch, mit runden Oberkanten; Geräteräume mit Rollläden zwischen und hinter den Achsen
  k.prof([[-h, 0.056], [xc, 0.056], [xc, yr - 0.004, 0.006], [-h + 0.006, yr - 0.004, 0.014], [-h, yr - 0.03, 0.008]], w, body, 0.018);
  const AX = [h - 0.095, -0.1, -0.178], wr = 0.034;
  for (const [a, b, y0] of [[-h + 0.012, -0.218, 0.07], [-0.06, 0.03, 0.074], [0.04, xc - 0.008, 0.074]]) {
    k.side([[a, y0], [b, y0], [b, 0.146], [a, 0.146]], w / 2 + 0.0009, metal(0xd5d9de));
    for (let y = y0 + 0.004; y < 0.144; y += 0.009) k.side([[a, y], [b, y], [b, y + 0.0018], [a, y + 0.0018]], w / 2 + 0.0016, matte(0x9ca3ab));
    k.side([[a, y0 - 0.006], [b, y0 - 0.006], [b, y0 - 0.002], [a, y0 - 0.002]], w / 2 + 0.002, metal(0xb8bec6));
  }
  // Reflexstreifen: gelb unter dem Dach und über der Schürze, rot-weiß am Heck
  k.side([[-h + 0.008, 0.151], [xc - 0.002, 0.151], [xc - 0.002, 0.158], [-h + 0.008, 0.158]], w / 2 + 0.0011, lamp(0xf5d90a));
  k.side([[-h + 0.008, 0.063], [h - 0.004, 0.063], [h - 0.004, 0.068], [-h + 0.008, 0.068]], w / 2 + 0.0024, lamp(0xf5d90a));
  k.bx(-h - 0.002, -h + 0.001, 0.07, 0.15, w - 0.02, redWhite());
  // Aufschrift an der Tür
  decal(g, 'ffw', xc + 0.034, 0.083, w / 2 + 0.0026, 0.07, 0.014, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#ffffff';
    c.font = `900 ${Math.round(H * 0.78)}px "Segoe UI", Arial, sans-serif`;
    c.textBaseline = 'middle';
    c.fillText('FEUERWEHR', 4, H * 0.54, W - 8);
  });
  // Dach: Laufsteg, Geländer, Blaulichter hinten
  k.rbox(-h + 0.02, xc - 0.02, yr - 0.004, yr - 0.001, -0.035, 0.035, metal(0xb8bec6), 0.002);
  for (const s of [-1, 1]) k.rod([-h + 0.02, yr + 0.012, s * 0.06], [xc - 0.05, yr + 0.012, s * 0.06], 0.003, metal(0xcbd5e1));
  for (let x = -h + 0.02; x <= xc - 0.05; x += 0.07) for (const s of [-1, 1]) k.rod([x, yr - 0.004, s * 0.06], [x, yr + 0.012, s * 0.06], 0.003, metal(0xcbd5e1));
  // Löscharm: Drehkranz hinter dem Fahrerhaus, zwei Rohre nach vorn bis über die Front, Lanze und Werfer an der Spitze
  k.cyl(xc - 0.02, yr + 0.008, 0, 0.02, 0.016, 'y', dark, 14);
  k.obox(xc - 0.02, yr + 0.022, 0, 0.03, 0.014, 0.024, body);
  const B0 = [xc - 0.03, yr + 0.026], B1 = [h + 0.03, yr + 0.044];
  k.rod([B0[0], B0[1], 0.006], [B1[0] - 0.08, B1[1] - 0.004, 0.006], 0.011, matte(0x2a2d33));
  k.rod([B0[0] + 0.07, B0[1] + 0.008, -0.004], [B1[0], B1[1], -0.004], 0.009, matte(0x34373d));
  k.rod([B0[0] + 0.07, B0[1] + 0.016, 0.008], [B1[0] - 0.01, B1[1] + 0.006, 0.008], 0.004, metal(0xcbd5e1));
  k.obox(B1[0] + 0.008, B1[1], -0.004, 0.024, 0.016, 0.02, matte(0x1b1d21));
  k.cyl(B1[0] + 0.03, B1[1] + 0.002, -0.004, 0.005, 0.03, 'x', metal(0x9aa3ad), 8);
  k.cyl(B1[0] + 0.012, B1[1] - 0.012, -0.004, 0.0035, 0.03, 'y', paint(0xf26b1d, 70), 8);
  // Räder: drei große Achsen mit Radkästen
  for (const x of AX) {
    k.well(x, wr, w + 0.004);
    k.axle(x, w / 2 - 0.012, wr, 0.03);
  }
  tail(k, -h, 0.062, w);
  for (const s of [-1, 1]) {
    beacon(g, k, S1[0] - 0.02, yr + 0.004, s * 0.05, 0x3b82f6);
    beacon(g, k, -h + 0.012, yr - 0.004, s * 0.055, 0x3b82f6);
  }
  lights(g, h + 0.004, -h, 0.072, 0.05);
}

function plow(k, g, body) {
  const h = 0.3, w = 0.13;
  k.bx(-h + 0.02, h - 0.02, 0.026, 0.046, 0.085, matte(DARK));
  cab(k, h - 0.13, h, 0.034, 0.16, w, body);
  k.rbx(-h, h - 0.13, 0.046, 0.13, w - 0.004, body, 0.014);
  k.side([[-h + 0.014, 0.06], [h - 0.144, 0.06], [h - 0.144, 0.07], [-h + 0.014, 0.07]], w / 2 - 0.001, hazard());
  // Schild vorn (schräg, mit Gummikante), Kehrwalze in der Mitte mit Haube, Gebläse hinten
  k.obox(h + 0.05, 0.05, 0, 0.012, 0.06, 0.32, body, 0, 0.32, 0);
  k.obox(h + 0.048, 0.018, 0, 0.014, 0.008, 0.32, matte(0x111111), 0, 0.32, 0);
  k.obox(h + 0.05, 0.081, 0, 0.014, 0.004, 0.32, hazard(), 0, 0.32, 0);
  k.rod([h, 0.04, -0.03], [h + 0.044, 0.05, -0.02], 0.008, matte(DARK));
  k.rod([h, 0.04, 0.03], [h + 0.044, 0.05, 0.02], 0.008, matte(DARK));
  k.cyl(-0.03, 0.03, 0, 0.03, 0.2, 'z', matte(0x1e3a8a), 14);
  k.rbox(-0.065, 0.005, 0.058, 0.066, -0.105, 0.105, body, 0.004);
  k.cyl(-h + 0.04, 0.16, 0, 0.022, 0.06, 'y', body, 12);
  k.rod([-h + 0.04, 0.19, 0], [-h + 0.07, 0.205, 0.04], 0.012, body);
  k.well(h - 0.07, 0.03, w + 0.002);
  k.axle(h - 0.07, 0.058, 0.03, 0.028);
  k.axle(-h + 0.1, 0.058, 0.03, 0.028);
  tail(k, -h, 0.05, w);
  beacon(g, k, h - 0.065, 0.167);
  beacon(g, k, -h + 0.02, 0.13);
  lights(g, h, -h, 0.064, w / 2 - 0.02);
}

// Follow-me-Auto: Kombi mit Haube, geneigter Frontscheibe, Glaskabine, Dach in Wagenfarbe, Schachbrettband
function followMe(k, g) {
  const h = 0.12, w = 0.092, body = paint(0xfacc15, 70);
  k.prof([[-h, 0.016, 0.006], [h, 0.016, 0.008], [h + 0.002, 0.05, 0.014], [h - 0.045, 0.06, 0.012], [-h + 0.003, 0.062, 0.01]], w, body, 0.012);
  // Kabine: Glas etwas schmaler (eingezogene Seiten), Dach, B- und C-Säule
  const gw = w - 0.01, yr = 0.088;
  k.prof([[h - 0.043, 0.058], [h - 0.078, yr, 0.01], [-h + 0.02, yr, 0.01], [-h + 0.005, 0.06]], gw, glass(), 0.007);
  k.rbox(-h + 0.018, h - 0.075, yr - 0.003, yr + 0.004, -gw / 2 - 0.001, gw / 2 + 0.001, body, 0.0035);
  k.side([[-0.006, 0.059], [0.003, 0.059], [0.001, yr - 0.002], [-0.006, yr - 0.002]], gw / 2 + 0.0004, body);
  k.side([[-h + 0.006, 0.06], [-h + 0.03, 0.06], [-h + 0.024, yr - 0.002], [-h + 0.018, yr - 0.002]], gw / 2 + 0.0004, body);
  k.side([[-h + 0.016, 0.04], [h - 0.045, 0.04], [h - 0.045, 0.05], [-h + 0.016, 0.05]], w / 2 + 0.0009, checker());
  // Stoßfänger, Scheinwerfer, Rückleuchten
  k.rbx(h - 0.006, h + 0.008, 0.012, 0.03, w + 0.002, matte(DARK), 0.006);
  k.rbx(-h - 0.008, -h + 0.006, 0.012, 0.03, w + 0.002, matte(DARK), 0.006);
  k.pair(h - 0.0015, h + 0.003, 0.036, 0.044, w / 2 - 0.014, 0.018, lamp(0xfff4d6));
  tail(k, -h, 0.04, w);
  // Dachschild „FOLLOW ME“ (leuchtet)
  k.rbx(-0.03, 0.03, yr + 0.003, yr + 0.008, 0.05, matte(DARK), 0.002);
  k.box(-0.032, 0.032, yr + 0.008, yr + 0.032, -0.003, 0.003, plate('fm', 'FOLLOW ME', '#111111', '#facc15', true), 0, Math.PI / 2, 0);
  for (const x of [h - 0.035, -h + 0.035]) {
    k.well(x, 0.017, w + 0.002);
    k.axle(x, w / 2 - 0.004, 0.017, 0.016);
  }
  for (const s of [-1, 1]) beacon(g, k, -0.01, yr + 0.032, s * 0.028);
  lights(g, h, -h, 0.04, w / 2 - 0.014);
}

// Streifenwagen der Vorfeldstreife als Fahrzeug (3D-Ansicht, Karte): Pkw-Modell in Polizeilackierung mit Blaulichtern
function policeCar(k, g) {
  const G = carGeos('police');
  const bm = cached('polbody', () => {
    const m = G.mats[0].clone();
    m.color.set(POLICE_BLUE);
    return m;
  });
  for (const m of [new THREE.Mesh(G.body, bm), new THREE.Mesh(G.detail, G.mats[1]), new THREE.Mesh(G.glass, G.glassMat), new THREE.Mesh(G.decal, G.decalMat)]) {
    m.castShadow = true;
    g.add(m);
  }
  for (const s of [-1, 1]) {
    const bc = new THREE.Sprite(spriteMat(0x3b82f6));
    bc.name = 'bcn';
    bc.position.set(0, G.hgt + 0.008, s * 0.022);
    bc.scale.setScalar(0.08);
    g.add(bc);
  }
  lights(g, G.len / 2, -G.len / 2, 0.03, 0.03);
}

// Gepäckförderband (wie die Elektroflotte auf dem Vorfeld: weiß mit grünem Streifen): flaches Fahrgestell, kleine Kabine
// hinten links, langes Band mit Geländer; am Flugzeug fährt das Band zur Frachttür hoch (Teil 'belt', siehe poseVehicle)
function beltLoader(k, g, body) {
  const h = BELT.h, w = 0.095, green = paint(0x15a34a, 60), black = matte(0x1b1d21), rail = metal(0xd5dade);
  k.rbx(-h + 0.006, h - 0.006, 0.014, 0.03, w - 0.012, black, 0.004);
  k.rbx(-h, h, 0.028, 0.046, w, body, 0.006);
  k.side([[-h + 0.006, 0.033], [h - 0.006, 0.033], [h - 0.006, 0.039], [-h + 0.006, 0.039]], w / 2 + 0.0008, green);
  k.rbx(h - 0.004, h + 0.006, 0.02, 0.034, w + 0.002, black, 0.004);
  k.rbx(-h - 0.006, -h + 0.004, 0.02, 0.034, w + 0.002, black, 0.004);
  // Kabine hinten links mit Scheiben und grünem Dach
  const cz0 = -w / 2, cz1 = -w / 2 + 0.042, cx0 = -h + 0.008, cx1 = -h + 0.07;
  k.rbox(cx0, cx1, 0.046, 0.1, cz0, cz1, body, 0.005);
  k.box(cx1 - 0.001, cx1 + 0.0008, 0.058, 0.094, cz0 + 0.005, cz1 - 0.005, glass());
  k.box(cx0 + 0.006, cx1 - 0.006, 0.058, 0.094, cz0 - 0.0008, cz0 + 0.001, glass());
  k.box(cx0 - 0.0008, cx0 + 0.001, 0.058, 0.094, cz0 + 0.005, cz1 - 0.005, glass());
  k.rbox(cx0 - 0.002, cx1 + 0.002, 0.1, 0.106, cz0 - 0.002, cz1 + 0.002, green, 0.003);
  for (const x of [h - 0.045, -h + 0.045]) {
    k.well(x, 0.015, w + 0.002);
    k.axle(x, w / 2 - 0.004, 0.015, 0.016);
  }
  // Band als eigene Gruppe, Drehpunkt hinten
  const bk = new Kit(), L = BELT.len, bw = 0.05;
  bk.rbox(0, L, -0.007, 0.004, -bw / 2 - 0.006, bw / 2 + 0.006, body, 0.003);
  bk.box(0.004, L - 0.004, 0.004, 0.0062, -bw / 2, bw / 2, matte(0x24272c));
  for (let x = 0.01; x < L - 0.01; x += 0.012) bk.box(x, x + 0.003, 0.0062, 0.0074, -bw / 2, bw / 2, matte(0x3a3f45));
  for (const s of [-1, 1]) {
    bk.box(0.002, L - 0.002, -0.004, 0.001, s * (bw / 2 + 0.0058), s * (bw / 2 + 0.0066), green);
    for (let x = 0.03; x < L - 0.01; x += 0.055) bk.rod([x, 0.004, s * (bw / 2 + 0.004)], [x, 0.034, s * (bw / 2 + 0.004)], 0.0025, rail);
    bk.rod([0.03, 0.034, s * (bw / 2 + 0.004)], [L - 0.025, 0.034, s * (bw / 2 + 0.004)], 0.0025, rail);
  }
  bk.cyl(L, -0.001, 0, 0.006, bw + 0.012, 'z', black, 10);
  const belt = bk.build();
  belt.name = 'belt';
  belt.position.set(BELT.px, BELT.y, 0.018);
  belt.rotation.z = 0.04;
  g.add(belt);
  beacon(g, k, cx0 + 0.03, 0.106, cz0 + 0.021);
  lights(g, h, -h, 0.04, w / 2 - 0.015);
}

const BUILD = { tug, baggage, fuel, catering, bus, stairs: stairsTruck, deice, cleaning: van, fire, plow, followme: followMe, police: policeCar, belt: beltLoader };
const BODY = { belt: 0xf4f5f2, fire: 0xd11f1c, plow: 0xea6a0c, followme: 0xfacc15 };

// große Nummer auf dem Dach (wie auf echten Vorfeldern, damit der Tower die Fahrzeuge erkennt): Buchstabe je Typ + Nummer
const ROOF = { tug: [-0.12, 0.0952, 0.08], baggage: [0.378, 0.1362, 0.06], fuel: [0.312, 0.1642, 0.09], catering: [0.238, 0.1562, 0.09], cleaning: [-0.03, 0.1272, 0.08], bus: [-0.01, 0.1652, 0.12], stairs: [0.165, 0.1052, 0.05, -0.031], deice: [0.332, 0.1642, 0.09] };
const LETTER = { tug: 'T', baggage: 'G', fuel: 'F', catering: 'C', cleaning: 'R', bus: 'B', stairs: 'S', deice: 'E' };
const numMat = (text) => cached(`num${text}`, () => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '900 50px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#111827';
  g.strokeText(text, 64, 34);
  g.fillStyle = '#ffffff';
  g.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.4, depthWrite: false });
});
const PLANE = new THREE.PlaneGeometry(1, 1);
function roofNumber(m, v) {
  const R = ROOF[v.type];
  const num = String(v.name || '').match(/\d+/);
  if (!R || !num) return;
  const pl = new THREE.Mesh(PLANE, numMat(LETTER[v.type] + num[0]));
  pl.scale.set(R[2], R[2] / 2, 1);
  pl.rotation.x = -Math.PI / 2;
  pl.position.set(R[0], R[1], R[3] || 0);
  m.add(pl);
}
// Firmenaufschrift als Fläche (eigene Textur), beidseitig an z = ±zs
function decal(g, key, x, y, zs, w, h, draw, parent = g) {
  const m = canvasMat(`dec${key}`, 512, Math.round((512 * h) / w), draw);
  for (const s of [1, -1]) {
    const pl = new THREE.Mesh(PLANE, m);
    pl.scale.set(w, h, 1);
    pl.position.set(x, y, s * zs);
    if (s < 0) pl.rotation.y = Math.PI;
    parent.add(pl);
  }
}
const logo = (bg, fg, text, sub, icon) => (c, w, h) => {
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  if (icon) icon(c, w, h);
  c.textBaseline = 'middle';
  c.fillStyle = fg;
  const x0 = icon ? h * 1.1 : 10, room = w - x0 - 10;
  // Schrift so groß wie möglich, aber ganz auf der Fläche
  const fit = (t, weight, size) => {
    c.font = `${weight} ${size}px "Segoe UI", Arial, sans-serif`;
    const k = Math.min(1, room / Math.max(1, c.measureText(t).width));
    c.font = `${weight} ${Math.floor(size * k)}px "Segoe UI", Arial, sans-serif`;
  };
  fit(text, 900, Math.round(h * 0.46));
  c.fillText(text, x0, sub ? h * 0.38 : h * 0.52);
  if (sub) {
    fit(sub, 600, Math.round(h * 0.22));
    c.fillText(sub, x0, h * 0.78);
  }
};

// ---------- Pkw (Parkplätze, Straßen, Karte) ----------
// Sieben Bauformen aus Seitenprofilen: low = Karosserie bis zur Gürtellinie, cab = Kabine [Scheibenfuß vorn, Scheibe oben,
// Dachende, Heckfuß] mit Eckenradien cr, pil = Säulen zwischen den Seitenfenstern, wx = Achsen, r = Radradius.
// Zwei Netze je Bauform: Karosserie (Farbe je Auto) und Details mit Eckenfarben (Scheiben, Räder, Lichter, Schürzen).
const CAR_SPEC = {
  mini: { h: 0.088, w: 0.082, r: 0.014, wx: [0.061, -0.06], low: [[-0.088, 0.014, 0.008], [0.088, 0.014, 0.008], [0.09, 0.034, 0.014], [0.05, 0.043, 0.012], [-0.085, 0.046, 0.01]], cab: [[0.054, 0.041], [0.017, 0.074], [-0.077, 0.073], [-0.086, 0.044]], cr: [0.016, 0.014], pil: [-0.018] },
  hatch: { h: 0.1, w: 0.09, r: 0.0155, wx: [0.066, -0.064], low: [[-0.1, 0.014, 0.008], [0.1, 0.014, 0.008], [0.102, 0.034, 0.014], [0.046, 0.045, 0.012], [-0.096, 0.047, 0.01]], cab: [[0.05, 0.043], [0.009, 0.072], [-0.084, 0.071], [-0.097, 0.045]], cr: [0.014, 0.012], pil: [-0.021] },
  sedan: { h: 0.11, w: 0.096, r: 0.016, wx: [0.07, -0.07], low: [[-0.11, 0.014, 0.008], [0.11, 0.014, 0.008], [0.112, 0.036, 0.014], [0.046, 0.047, 0.012], [-0.068, 0.048, 0.01], [-0.108, 0.045, 0.012]], cab: [[0.05, 0.045], [0.006, 0.074], [-0.046, 0.074], [-0.084, 0.046]], cr: [0.014, 0.014], pil: [-0.021] },
  estate: { h: 0.118, w: 0.096, r: 0.016, wx: [0.075, -0.074], low: [[-0.118, 0.014, 0.008], [0.118, 0.014, 0.008], [0.12, 0.036, 0.014], [0.05, 0.047, 0.012], [-0.115, 0.048, 0.01]], cab: [[0.054, 0.045], [0.01, 0.074], [-0.106, 0.073], [-0.116, 0.046]], cr: [0.014, 0.01], pil: [-0.02, -0.074], rails: true },
  suv: { h: 0.115, w: 0.1, r: 0.019, base: 0.02, wx: [0.074, -0.074], low: [[-0.115, 0.02, 0.008], [0.115, 0.02, 0.008], [0.117, 0.048, 0.016], [0.05, 0.057, 0.012], [-0.112, 0.059, 0.012]], cab: [[0.054, 0.055], [0.016, 0.086], [-0.1, 0.086], [-0.112, 0.057]], cr: [0.014, 0.012], pil: [-0.02, -0.07], rails: true, clad: true },
  van: { h: 0.124, w: 0.1, r: 0.017, base: 0.016, wx: [0.082, -0.08], low: [[-0.124, 0.016, 0.008], [0.124, 0.016, 0.01], [0.127, 0.05, 0.016], [0.09, 0.06, 0.014], [-0.122, 0.06, 0.01]], cab: [[0.092, 0.058], [0.056, 0.098], [-0.12, 0.098], [-0.123, 0.058]], cr: [0.02, 0.014], pil: [0.02, -0.05] },
  // Einsatzfahrzeuge: Streifenwagen (Kombi) und Polizei-Kleinbus in Blau mit Leuchtgelb, Rettungswagen (Kleinbus, roter Streifen)
  police: { h: 0.118, w: 0.096, r: 0.016, wx: [0.075, -0.074], low: [[-0.118, 0.014, 0.008], [0.118, 0.014, 0.008], [0.12, 0.036, 0.014], [0.05, 0.047, 0.012], [-0.115, 0.048, 0.01]], cab: [[0.054, 0.045], [0.01, 0.074], [-0.106, 0.073], [-0.116, 0.046]], cr: [0.014, 0.01], pil: [-0.02, -0.074], livery: 'police', bar: true },
  policevan: { h: 0.124, w: 0.1, r: 0.017, base: 0.016, wx: [0.082, -0.08], low: [[-0.124, 0.016, 0.008], [0.124, 0.016, 0.01], [0.127, 0.05, 0.016], [0.09, 0.06, 0.014], [-0.122, 0.06, 0.01]], cab: [[0.092, 0.058], [0.056, 0.098], [-0.12, 0.098], [-0.123, 0.058]], cr: [0.02, 0.014], pil: [0.02, -0.05], livery: 'police', bar: true },
  ambulance: { h: 0.124, w: 0.1, r: 0.017, base: 0.016, wx: [0.082, -0.08], low: [[-0.124, 0.016, 0.008], [0.124, 0.016, 0.01], [0.127, 0.05, 0.016], [0.09, 0.06, 0.014], [-0.122, 0.06, 0.01]], cab: [[0.092, 0.058], [0.056, 0.098], [-0.12, 0.098], [-0.123, 0.058]], cr: [0.02, 0.014], pil: [0.02, -0.05], stripe: 0xdc2626, bar: true },
  pickup: { h: 0.13, w: 0.1, r: 0.018, base: 0.02, wx: [0.086, -0.08], low: [[-0.13, 0.02, 0.006], [0.13, 0.02, 0.008], [0.132, 0.048, 0.016], [0.06, 0.056, 0.012], [-0.128, 0.058, 0.006]], cab: [[0.062, 0.054], [0.026, 0.086], [-0.03, 0.086], [-0.032, 0.056]], cr: [0.014, 0.008], pil: [-0.003], bed: true },
};
// Polygon auf den Bereich a <= x <= b zuschneiden (Seitenfenster an den Säulen trennen)
function clipX(poly, a, b) {
  const cut = (P, keep, X) => {
    const out = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], kp = keep(p[0]), kq = keep(q[0]);
      if (kp) out.push(p);
      if (kp !== kq) out.push([X, p[1] + ((q[1] - p[1]) * (X - p[0])) / (q[0] - p[0])]);
    }
    return out;
  };
  return cut(cut(poly, (x) => x >= a, a), (x) => x <= b, b);
}
// Polizei-Lackierung (Grundfarbe Blau kommt als Wagenfarbe): Leuchtgelb unten an den Seiten (um die Radhäuser herum),
// darüber eine Karoreihe Blau/Leuchtgelb, leuchtgelbe Haube vorn und Stoßfänger; gibt die Flächen für den Schriftzug zurück
const NEON = 0xd4f21e, POL_BLUE = 0x1d3f94;
function policeLivery(S, d, M, base, gw) {
  const { h, w, r, low } = S, zs = w / 2 + 0.0009;
  // Oberkante der Karosserie an der Stelle x (vorn über die Haube, hinten bis zum Heck)
  const edge = low.slice(2);
  const topAt = (x) => {
    for (let i = 0; i < edge.length - 1; i++) {
      const [x0, y0] = edge[i], [x1, y1] = edge[i + 1];
      if ((x <= x0 && x >= x1) || (x >= x0 && x <= x1)) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
    return x > 0 ? edge[0][1] : edge[edge.length - 1][1];
  };
  const arch = r * 2.28 + 0.002, yb = base + 0.006, q = 0.0065;
  const free = [[-h + 0.004, S.wx[1] - r * 1.34], [S.wx[1] + r * 1.34, S.wx[0] - r * 1.34], [S.wx[0] + r * 1.34, h - 0.004]];
  for (const [a, b] of free) d(NEON).side([[a, yb], [b, yb], [b, Math.min(arch, topAt(b) - 0.002)], [a, Math.min(arch, topAt(a) - 0.002)]], zs, M);
  // Karoreihe über den Radhäusern, so weit die Karosserie hoch genug ist
  for (let x = -h + 0.006, i = 0; x + q < h; x += q, i++) {
    if (topAt(x) < arch + q + 0.002 || topAt(x + q) < arch + q + 0.002) continue;
    d(i % 2 ? POL_BLUE : NEON).side([[x, arch], [x + q, arch], [x + q, arch + q], [x, arch + q]], zs + 0.0002, M);
  }
  // Haube vorn und Stoßfänger leuchtgelb
  const A = low[2], B = low[3], L = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = (B[1] - A[1]) / L, ny = (A[0] - B[0]) / L;
  const P = (f) => [A[0] + (B[0] - A[0]) * f + nx * 0.0012, A[1] + (B[1] - A[1]) * f + ny * 0.0012];
  d(NEON).slab(...P(0.03), ...P(0.55), 0.0016, gw - 0.004, M);
  d(NEON).rbx(h - 0.014, h + 0.0048, base - 0.002, base + 0.0072, w + 0.003, M, 0.004);
  d(NEON).rbx(-h - 0.0048, -h + 0.014, base - 0.002, base + 0.0072, w + 0.003, M, 0.004);
  // Schriftzug POLIZEI auf den Vordertüren (im gelben Feld zwischen den Radhäusern)
  const [ma, mb] = free[1], tx = (ma + mb) / 2 + (mb - ma) * 0.08, tw = (mb - ma) * 0.78, th = Math.min(0.014, arch - yb - 0.003);
  const g = [];
  for (const sd of [1, -1]) {
    const pl = new THREE.PlaneGeometry(tw, th);
    if (sd < 0) pl.rotateY(Math.PI);
    pl.translate(tx, yb + (arch - yb) / 2, sd * (zs + 0.0006));
    g.push(pl);
  }
  return mergeGeometries(g);
}
const policeText = () => cached('poltext', () => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 40;
  const g = c.getContext('2d');
  g.fillStyle = '#1d3f94';
  g.font = '900 34px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('POLIZEI', 128, 22, 250);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.35, depthWrite: false });
});
const CARS = new Map();
let CAR_MATS = null;
export const CAR_BODIES = Object.keys(CAR_SPEC);
export function carGeos(kind = 'sedan') {
  if (CARS.has(kind)) return CARS.get(kind);
  const S = CAR_SPEC[kind] || CAR_SPEC.sedan;
  const { h, w, r } = S, base = S.base || 0.014, gw = w - 0.012, M = matte(0xffffff), GL = 0x22303d;
  const body = new Kit(), det = new Map();
  const d = (hex) => det.get(hex) || (det.set(hex, new Kit()), det.get(hex));
  body.prof(S.low, w, M, 0.014);
  // Kabine in Wagenfarbe (Säulen, Dach); unten verlängert, damit die Rundung in der Karosserie verschwindet
  const [F0, F1, B1, B0] = S.cab;
  const ext = (A, B, e) => {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    return [A[0] - ((B[0] - A[0]) / L) * e, A[1] - ((B[1] - A[1]) / L) * e];
  };
  body.prof([ext(F0, F1, 0.012), F1.concat(S.cr[0]), B1.concat(S.cr[1]), ext(B0, B1, 0.012)], gw, M, 0.01);
  // Front- und Heckscheibe auf den geneigten Flächen (nach außen versetzt)
  const cx = (F0[0] + F1[0] + B0[0] + B1[0]) / 4, cy = (F0[1] + F1[1] + B0[1] + B1[1]) / 4;
  const pane = (A, B, f0, f1) => {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    let nx = (B[1] - A[1]) / L, ny = (A[0] - B[0]) / L;
    if (nx * ((A[0] + B[0]) / 2 - cx) + ny * ((A[1] + B[1]) / 2 - cy) < 0) (nx = -nx), (ny = -ny);
    const P = (f) => [A[0] + (B[0] - A[0]) * f + nx * 0.001, A[1] + (B[1] - A[1]) * f + ny * 0.001];
    d(GL).slab(...P(f0), ...P(f1), 0.0016, gw - 0.018, M);
  };
  pane(F0, F1, 0.12, 0.84);
  pane(B0, B1, 0.14, 0.84);
  // Seitenfenster: Kabinenfläche ohne Rand, an den Säulen getrennt
  const m = 0.012, yb = Math.max(F0[1], B0[1]) + 0.004, yt = Math.min(F1[1], B1[1]) - m;
  const xOn = (A, B, y) => A[0] + ((B[0] - A[0]) * (y - A[1])) / (B[1] - A[1]);
  const sin = (A, B) => Math.abs(B[1] - A[1]) / Math.hypot(B[0] - A[0], B[1] - A[1]);
  const xf = (y) => xOn(F0, F1, y) - m / sin(F0, F1), xr = (y) => xOn(B0, B1, y) + m / sin(B0, B1);
  const poly = [[xr(yb), yb], [xf(yb), yb], [xf(yt), yt], [xr(yt), yt]];
  const cuts = [-1, ...S.pil, 1];
  for (let i = 0; i < cuts.length - 1; i++) {
    const p = clipX(poly, cuts[i] + 0.003, cuts[i + 1] - 0.003);
    if (p.length >= 3) d(GL).side(p, gw / 2 + 0.0007, M);
  }
  // Schürzen, Grill, Kennzeichen, Lichter (Höhe nach Front- und Heckkante)
  const yH = S.low[2][1], yT = S.low[S.low.length - 1][1];
  d(0x16181b).rbx(h - 0.012, h + 0.004, base - 0.003, base + 0.006, w - 0.002, M, 0.004).rbx(-h - 0.004, -h + 0.012, base - 0.003, base + 0.006, w - 0.002, M, 0.004);
  d(0x2a2e33).bx(h - 0.001, h + 0.0032, base + 0.008, yH - 0.01, w * 0.42, M);
  d(0xe5e7eb).bx(h + 0.001, h + 0.0045, base, base + 0.006, 0.026, M).bx(-h - 0.0035, -h + 0.001, yT - 0.022, yT - 0.016, 0.026, M);
  d(0xfff4d6).pair(h - 0.001, h + 0.003, yH - 0.009, yH - 0.003, w / 2 - 0.015, 0.016, M);
  d(0xb91c1c).pair(-h - 0.003, -h + 0.002, yT - 0.013, yT - 0.005, w / 2 - 0.013, 0.018, M);
  for (const x of S.wx) {
    d(0x0d0f12).well(x, r, w + 0.001);
    for (const s of [-1, 1]) {
      d(0x111214).cyl(x, r, s * (w / 2 - 0.004), r, 0.012, 'z', M, 14);
      d(0xb9c0c8).cyl(x, r, s * (w / 2 - 0.0035), r * 0.6, 0.0115, 'z', M, 10);
    }
  }
  // Dachreling (Kombi, SUV), dunkle Beplankung (SUV), offene Ladefläche (Pick-up)
  if (S.rails) d(0x2a2d33).pair(B1[0] + 0.01, F1[0] - 0.012, F1[1] - 0.001, F1[1] + 0.004, gw / 2 - 0.008, 0.004, M);
  if (S.clad) d(0x2a2d33).side([[-h + 0.012, base + 0.002], [h - 0.012, base + 0.002], [h - 0.012, base + 0.01], [-h + 0.012, base + 0.01]], w / 2 + 0.0008, M);
  if (S.stripe || S.bar) {
    // Seitenstreifen (zwischen den Radhäusern) und Blaulichtbalken auf dem Dach
    const ys = base + 0.012, x0 = -h + 0.016, x1 = S.low[3][0] - 0.004;
    if (S.stripe) d(S.stripe).side([[x0, ys], [x1, ys], [x1, ys + 0.012], [x0, ys + 0.012]], w / 2 + 0.0009, M);
    // Lichtbalken quer über das Dach: blaue Kuppeln außen, Mitte weiß
    const top = Math.min(F1[1], B1[1]), bw = gw / 2 - 0.006;
    d(0x1e293b).rbox(-0.012, 0.012, top - 0.001, top + 0.004, -bw, bw, M, 0.002);
    d(0x3b82f6).rbox(-0.01, 0.01, top + 0.003, top + 0.009, -bw + 0.002, -0.009, M, 0.003);
    d(0x3b82f6).rbox(-0.01, 0.01, top + 0.003, top + 0.009, 0.009, bw - 0.002, M, 0.003);
    d(0xe5e7eb).rbox(-0.008, 0.008, top + 0.003, top + 0.007, -0.008, 0.008, M, 0.002);
  }
  let decal = null;
  if (S.livery === 'police') decal = policeLivery(S, d, M, base, gw);
  if (S.bed) d(0x2a2d33).rbox(-h + 0.008, B0[0] - 0.007, yT - 0.012, yT + 0.0004, -w / 2 + 0.007, w / 2 - 0.007, M, 0.002);
  const all = (k) => merge([...k.by.values()].flat());
  const glassGeo = det.has(GL) ? all(det.get(GL)) : null;
  det.delete(GL);
  const parts = [...det].map(([hex, k]) => {
    const g = all(k), c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  });
  if (!CAR_MATS) CAR_MATS = [new THREE.MeshPhongMaterial({ color: 0xffffff, map: wearTex(), shininess: 80, specular: 0x4a4a4a }), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x47515c })];
  const out = { body: all(body), detail: mergeGeometries(parts), glass: glassGeo, glassMat: glassMat(), mats: CAR_MATS, len: 2 * h, hgt: Math.max(F1[1], B1[1]), decal, decalMat: decal && policeText() };
  CARS.set(kind, out);
  return out;
}
// viele Pkw als Instanzen, Bauform und Farbe je Auto aus rnd: set(i, Matrix), update() nach dem Setzen
export function carInstances(n, rnd = Math.random, kinds = null) {
  const pick = [...Array(n)].map((_, i) => ({ k: kinds ? kinds[i % kinds.length] : carKind(rnd()), c: carPaint(rnd()) }));
  for (const p of pick) if (CAR_SPEC[p.k]?.livery === 'police') p.c = POLICE_BLUE;
  const by = new Map(), slot = [], group = new THREE.Group();
  for (const p of pick) by.set(p.k, (by.get(p.k) || 0) + 1);
  const M = {};
  for (const [k, cnt] of by) {
    const G = carGeos(k);
    M[k] = { body: new THREE.InstancedMesh(G.body, G.mats[0], cnt), det: new THREE.InstancedMesh(G.detail, G.mats[1], cnt), gl: G.glass ? new THREE.InstancedMesh(G.glass, G.glassMat, cnt) : null, dec: G.decal ? new THREE.InstancedMesh(G.decal, G.decalMat, cnt) : null, n: 0 };
    for (const m of [M[k].body, M[k].det, M[k].gl, M[k].dec]) if (m) (m.frustumCulled = false), group.add(m);
  }
  const col = new THREE.Color();
  pick.forEach((p, i) => {
    const X = M[p.k];
    slot[i] = [X, X.n++];
    X.body.setColorAt(slot[i][1], col.set(p.c));
  });
  return {
    group,
    set(i, mx) {
      const [X, j] = slot[i];
      X.body.setMatrixAt(j, mx);
      X.det.setMatrixAt(j, mx);
      if (X.gl) X.gl.setMatrixAt(j, mx);
      if (X.dec) X.dec.setMatrixAt(j, mx);
    },
    update() {
      for (const X of Object.values(M)) {
        X.body.instanceMatrix.needsUpdate = X.det.instanceMatrix.needsUpdate = true;
        if (X.gl) X.gl.instanceMatrix.needsUpdate = true;
        if (X.dec) X.dec.instanceMatrix.needsUpdate = true;
        if (X.body.instanceColor) X.body.instanceColor.needsUpdate = true;
      }
    },
  };
}

const VT = new Map();
function vehTemplate(type, variant) {
  const g = new THREE.Group();
  const k = new Kit();
  const vt = VEH_TYPES[type] || {};
  const body = paint(BODY[type] ?? new THREE.Color(vt.color || '#facc15').getHex(), 55);
  (BUILD[type] || van)(k, g, body, variant);
  k.build(g);
  return g;
}
export function buildVehicle(v) {
  const variant = v.type === 'bus' ? busAd(v) : 0;
  const key = `${v.type}|${variant}`;
  if (!VT.has(key)) VT.set(key, vehTemplate(v.type, variant));
  const m = VT.get(key).clone();
  const P = vehParts(m);
  P.ad = variant;
  roofNumber(m, v);
  return m;
}
// bewegliche Teile eines geklonten Fahrzeugs (einmal nachschlagen)
export function vehParts(m) {
  if (!m.__parts) {
    const n = (s) => m.getObjectByName(s) || null;
    const bcn = [];
    m.traverse((o) => o.name === 'bcn' && bcn.push(o));
    const sides = [];
    m.traverse((o) => o.name === 'busSide' && sides.push(o));
    m.__parts = { sides: sides.length ? sides : null, load: 0, bcn, hl: n('hl'), tl: n('tl'), lift: n('lift'), scis: n('scis'), plat: n('plat'), belt: n('belt'), tur: n('tur'), boom: n('boom'), bask: n('bask'), spray: n('spray'), ramp: n('ramp'), stp: n('stp'), u: 0, yaw: 0, top: 0.12 };
  }
  return m.__parts;
}

// bewegliche Teile einstellen (Hubkasten, Enteiser-Arm, Treppe) und Fahrgäste im Bus – für 3D-Ansicht und Karte.
// Gibt einen Schlüssel des Zustands zurück (die Karte rendert ein Fahrzeug nur neu, wenn er sich ändert)
export function poseVehicle(state, v, m, dt, now) {
  const P = vehParts(m);
  const ease = (tgt, rate) => (P.u += Math.sign(tgt - P.u) * Math.min(Math.abs(tgt - P.u), dt * rate));
  if (P.lift) {
    ease(v.st === 'work' ? 1 : 0, 0.45);
    const hgt = P.u * 0.11;
    P.lift.position.y = 0.07 + hgt;
    P.scis.visible = hgt > 0.004;
    P.scis.scale.y = Math.max(0.001, hgt);
    P.plat.visible = P.u > 0.6;
    P.plat.scale.x = Math.max(0.02, (P.u - 0.6) / 0.4);
  }
  if (P.boom) {
    const ac = v.st === 'work' && v.job ? state.acs.find((a) => a.id === v.job.ac) : null;
    ease(ac ? 1 : 0, 0.35);
    let yaw = 0;
    if (ac) {
      yaw = (v.hdg || 0) - Math.atan2(ac.y - v.y, ac.x - v.x);
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    }
    P.yaw += (yaw - P.yaw) * Math.min(1, dt * 1.5);
    P.tur.rotation.y = P.yaw * Math.min(1, P.u * 2);
    P.boom.rotation.z = -0.03 + P.u * 0.72;
    P.bask.rotation.z = -P.boom.rotation.z;
    P.spray.visible = !!ac && P.u > 0.97;
    if (P.spray.visible) P.spray.scale.set(1, 0.85 + 0.15 * Math.sin(now * 23 + v.x), 1);
  }
  if (P.ramp) {
    // Treppe: an der Tür bis zur Schwelle hochstellen, sonst flach zum Fahren; Podest bleibt waagerecht
    const ac = v.st === 'docked' && v.job ? state.acs.find((a) => a.id === v.job.ac) : null;
    const S = STAIRS_3D;
    const tgt = stairsTop(ac);
    P.top += clamp(tgt - P.top, -dt * 0.02, dt * 0.02);
    const { th, len } = stairsGeom(P.top);
    P.ramp.rotation.z = th;
    P.ramp.scale.x = len / S.len; // hohe Türen: Treppe fährt aus
    P.stp.position.set(S.hinge + Math.cos(th) * len, S.y + Math.sin(th) * len, 0);
  }
  if (P.belt) {
    // Förderband: an der Frachttür auf die Schwelle hochgestellt (v.lift 0 … 1), sonst flach
    const { th, len } = beltGeom(v.top ?? BELT.y);
    P.u = v.lift ?? 0;
    P.belt.rotation.z = 0.04 + (th - 0.04) * P.u;
    P.belt.scale.x = 1 + (len / BELT.len - 1) * P.u; // hohe Frachttüren: Band fährt aus
  }
  if (P.sides) setBusLoad(m, busLoad(v, state.time));
  return `${P.u.toFixed(2)}|${P.top.toFixed(3)}|${P.yaw.toFixed(2)}|${P.load}`;
}
