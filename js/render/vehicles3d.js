// 3D-Bodenfahrzeuge mit Details: Schlepper mit Warnstreifen und Kanzel, Gepäckzug mit LD3-Containern und offenem
// Kofferwagen, Tankwagen mit Kessel, Laufsteg und „JET A-1“-Schild, Catering-Hubwagen (Kasten fährt an der Schere
// hoch), Reinigungstransporter, Vorfeldbus mit Glasband und Doppeltüren, Enteiser mit schwenkbarem Korbarm und
// Sprühnebel, dazu Flughafenfeuerwehr (Großtanklöschfahrzeug mit Dachwerfer), Schneepflug mit Kehrwalze und das
// Follow-me-Auto. Räder mit Felgen, Scheinwerfer, Rückleuchten, Spiegel, Rundumleuchte. Alle festen Teile werden je
// Material zu einem Netz verschmolzen (wenige Draw-Calls); bewegliche Teile sind benannte Gruppen:
// 'lift'/'scis'/'plat' (Catering), 'tur'/'boom'/'bask'/'spray' (Enteiser), 'hl'/'tl' (Licht), 'bcn' (Rundumleuchte).
// x = Fahrtrichtung (Front bei +x), y = oben, z = quer. 1 Einheit = 1 Kachel (20 m).
import * as THREE from '../vendor/three.module.min.js';
import { VEH_TYPES } from '../config.js';
import { merge, spriteMat } from './model3d.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MX = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz));

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPH = new THREE.SphereGeometry(1, 14, 8);
const CYL = new Map();
const cylGeo = (seg) => CYL.get(seg) || (CYL.set(seg, new THREE.CylinderGeometry(1, 1, 1, seg)), CYL.get(seg));

const MATS = new Map();
const cached = (k, make) => MATS.get(k) || (MATS.set(k, make()), MATS.get(k));
const paint = (c, shin = 50) => cached(`p${c}|${shin}`, () => new THREE.MeshPhongMaterial({ color: c, shininess: shin, specular: 0x3a3a3a }));
const metal = (c) => cached(`m${c}`, () => new THREE.MeshPhongMaterial({ color: c, shininess: 95, specular: 0x9aa6b4 }));
const matte = (c) => cached(`l${c}`, () => new THREE.MeshLambertMaterial({ color: c }));
const lamp = (c) => cached(`b${c}`, () => new THREE.MeshBasicMaterial({ color: c }));
const glass = () => cached('glass', () => new THREE.MeshPhongMaterial({ color: 0x1a2735, shininess: 130, specular: 0xc4d6ea }));
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

// Fahrerhaus (Front bei x1): Kasten, Frontscheibe, Seitenfenster, Dach, Stoßfänger, Grill, Scheinwerfer, Spiegel
function cab(k, x0, x1, y0, y1, w, body, o = {}) {
  const wy = y0 + (y1 - y0) * (o.win ?? 0.5);
  k.bx(x0, x1, y0, y1, w, body);
  k.bx(x1 - 0.004, x1 + 0.0022, wy, y1 - 0.009, w - 0.016, glass());
  k.pair(x0 + 0.012, x1 - 0.012, wy, y1 - 0.011, w / 2, 0.004, glass());
  k.bx(x0 - 0.002, x1 + 0.003, y1, y1 + 0.007, w + 0.004, o.roof || body);
  k.bx(x1, x1 + 0.01, y0 - 0.006, y0 + 0.02, w + 0.004, matte(DARK));
  k.bx(x1 + 0.0005, x1 + 0.0035, y0 + 0.022, wy - 0.008, w * 0.5, matte(0x2f343b));
  k.pair(x1 + 0.0005, x1 + 0.004, y0 + 0.024, y0 + 0.036, w / 2 - 0.02, 0.022, lamp(0xfff4d6));
  k.pair(x1 - 0.004, x1 + 0.002, y0 + 0.024, y0 + 0.03, w / 2 - 0.004, 0.006, lamp(0xff9d1a));
  k.pair(x1 - 0.016, x1 - 0.006, wy - 0.002, wy + 0.022, w / 2 + 0.012, 0.004, matte(0x1c1f24));
  k.pair(x1 - 0.02, x1 - 0.012, wy + 0.01, wy + 0.013, w / 2 + 0.005, 0.012, matte(0x1c1f24));
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
function tug(k, g, body) {
  const h = 0.21, w = 0.16, top = 0.07;
  k.bx(-h + 0.02, h - 0.02, 0.022, 0.046, w - 0.05, matte(DARK));
  k.bx(-h, h, 0.046, top, w, body);
  k.bx(h - 0.05, h, 0.03, 0.046, w, body);
  k.bx(-h, -h + 0.05, 0.03, 0.046, w, body);
  k.bx(-h + 0.012, h - 0.06, top, top + 0.006, w - 0.016, matte(0x2c3036));
  k.bx(h, h + 0.012, 0.026, 0.058, w + 0.002, hazard());
  k.bx(-h - 0.012, -h, 0.026, 0.058, w + 0.002, hazard());
  k.cyl(h + 0.022, 0.038, 0, 0.007, 0.022, 'x', matte(0x111111), 8);
  k.cyl(-h - 0.022, 0.038, 0, 0.007, 0.022, 'x', matte(0x111111), 8);
  // Motorhaube hinten, Auspuff
  k.bx(-h + 0.02, -0.06, top, top + 0.024, w - 0.05, body);
  k.box(-h + 0.03, -0.07, top + 0.024, top + 0.026, -w / 2 + 0.04, w / 2 - 0.04, matte(0x1f2328));
  k.cyl(-0.08, top + 0.05, w / 2 - 0.03, 0.005, 0.055, 'y', matte(0x3a3d42), 8);
  // Kanzel links, ganz verglast
  const cz0 = -w / 2 + 0.004, cz1 = -w / 2 + 0.08, cx0 = -0.03, cx1 = 0.085, cy = top + 0.062;
  k.box(cx0 + 0.003, cx1 - 0.003, top, cy, cz0 + 0.003, cz1 - 0.003, glass());
  for (const x of [cx0, cx1 - 0.006]) for (const z of [cz0, cz1 - 0.006]) k.box(x, x + 0.006, top, cy, z, z + 0.006, body);
  k.box(cx0 - 0.004, cx1 + 0.004, cy, cy + 0.008, cz0 - 0.004, cz1 + 0.004, body);
  k.box(cx0 + 0.01, cx1 - 0.01, top, top + 0.02, cz0 + 0.01, cz1 - 0.01, matte(0x1f2937));
  // Scheinwerfer in der Front
  k.pair(h + 0.0005, h + 0.004, 0.06, 0.068, w / 2 - 0.02, 0.022, lamp(0xfff4d6));
  k.pair(-h - 0.004, -h - 0.0005, 0.06, 0.066, w / 2 - 0.02, 0.016, lamp(0xb91c1c));
  k.axle(h - 0.085, w / 2 - 0.016, 0.026, 0.032);
  k.axle(-h + 0.085, w / 2 - 0.016, 0.026, 0.032);
  beacon(g, k, (cx0 + cx1) / 2, cy + 0.008, (cz0 + cz1) / 2);
  lights(g, h, -h, 0.064, w / 2 - 0.03);
}

function baggage(k, g, body) {
  const h = 0.475, x1 = h, x0 = h - 0.17, w = 0.1;
  // Schlepper: Rahmen, Motorhaube, Sitz, Überrollbügel mit Dach, Windschutzscheibe
  k.bx(x0, x1, 0.02, 0.048, w, body);
  k.bx(x1 - 0.06, x1, 0.048, 0.076, w - 0.012, body);
  k.bx(x1 - 0.002, x1 + 0.008, 0.016, 0.034, w + 0.004, hazard());
  k.bx(x0 + 0.02, x0 + 0.05, 0.048, 0.07, 0.05, matte(0x1f2937));
  k.bx(x0 + 0.012, x0 + 0.02, 0.048, 0.1, 0.05, matte(0x1f2937));
  for (const x of [x0 + 0.004, x1 - 0.066]) for (const s of [-1, 1]) k.box(x, x + 0.005, 0.048, 0.122, s * (w / 2 - 0.006), s * (w / 2 - 0.001), matte(0x2a2d33));
  k.bx(x0, x1 - 0.058, 0.122, 0.129, w + 0.006, body);
  k.bx(x1 - 0.066, x1 - 0.062, 0.078, 0.118, w - 0.014, glass());
  k.pair(x1 + 0.0005, x1 + 0.004, 0.056, 0.064, w / 2 - 0.016, 0.016, lamp(0xfff4d6));
  k.axle(x0 + 0.032, w / 2, 0.019, 0.022);
  k.axle(x1 - 0.034, w / 2, 0.019, 0.022);
  beacon(g, k, x0 + 0.05, 0.129);
  lights(g, x1, x0, 0.06, w / 2 - 0.016);
  // drei Anhänger: zwei mit LD3-Containern, einer offen mit Koffern und Plane
  const CUR = [0x1d4ed8, 0x7c2d12, 0x065f46, 0x9a3412, 0x334155];
  const BAG = [0x1f2937, 0x7f1d1d, 0x1e3a8a, 0x065f46, 0x9ca3af, 0x6b21a8, 0xb45309];
  for (let i = 0; i < 3; i++) {
    const c1 = x0 - 0.03 - i * 0.24, c0 = c1 - 0.21;
    k.rod([c1, 0.03, 0], [c1 + 0.03, 0.03, 0], 0.006, matte(DARK));
    k.bx(c0, c1, 0.03, 0.04, 0.11, metal(0x8b9299));
    k.bx(c0 + 0.01, c1 - 0.01, 0.018, 0.03, 0.03, matte(DARK));
    k.axle(c0 + 0.035, 0.046, 0.014, 0.016);
    k.axle(c1 - 0.035, 0.046, 0.014, 0.016);
    if (i < 2) {
      for (const [j, cx] of [[0, c0 + 0.052], [1, c1 - 0.052]]) {
        k.put(ld3Geo(), metal(0xc6ccd2), MX(cx, 0.04, 0, 0.078, 1, 1));
        k.box(cx - 0.034, cx + 0.034, 0.046, 0.114, 0.0502, 0.0512, matte(CUR[(i * 2 + j) % CUR.length]));
        k.box(cx - 0.04, cx + 0.04, 0.119, 0.121, -0.05, 0.05, metal(0xaab1b9));
      }
    } else {
      for (const x of [c0 + 0.006, c1 - 0.012]) for (const s of [-1, 1]) k.box(x, x + 0.006, 0.04, 0.115, s * 0.049, s * 0.054, matte(0x52575e));
      k.bx(c0, c1, 0.115, 0.122, 0.116, paint(0x1e40af, 20));
      let n = 0;
      for (let x = c0 + 0.015; x < c1 - 0.03; x += 0.036)
        for (const z of [-0.026, 0.022]) {
          const hh = 0.025 + ((n * 7) % 5) * 0.004;
          k.box(x, x + 0.03, 0.04, 0.04 + hh, z - 0.018, z + 0.018, matte(BAG[n++ % BAG.length]));
          if (n % 3 === 0) k.box(x + 0.004, x + 0.026, 0.04 + hh, 0.06 + hh, z - 0.014, z + 0.014, matte(BAG[(n * 3) % BAG.length]));
        }
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
  k.cyl((tx0 + tx1) / 2, ty, 0, 0.06, tx1 - tx0, 'x', steel, 20, 0.061);
  k.sph(tx0, ty, 0, 0.026, 0.06, 0.061, steel);
  k.sph(tx1, ty, 0, 0.026, 0.06, 0.061, steel);
  for (const x of [tx0 + 0.04, (tx0 + tx1) / 2, tx1 - 0.04]) k.cyl(x, ty, 0, 0.0612, 0.014, 'x', paint(0xdc2626), 20, 0.0622);
  k.bx(tx0 + 0.01, tx1 - 0.01, ty + 0.06, ty + 0.064, 0.032, matte(0x6b7280));
  for (let x = tx0 + 0.02; x <= tx1 - 0.01; x += 0.08) for (const s of [-1, 1]) k.rod([x, ty + 0.064, s * 0.017], [x, ty + 0.086, s * 0.017], 0.003, metal(0xcbd5e1));
  for (const s of [-1, 1]) k.rod([tx0 + 0.02, ty + 0.086, s * 0.017], [tx1 - 0.01, ty + 0.086, s * 0.017], 0.003, metal(0xcbd5e1));
  for (const x of [tx0 + 0.09, tx0 + 0.24, tx0 + 0.39]) k.cyl(x, ty + 0.062, 0, 0.012, 0.008, 'y', metal(0xaeb6bf), 12);
  k.box(tx0 + 0.12, tx0 + 0.22, ty - 0.012, ty + 0.012, -0.0618, 0.0618, plate('jet', 'JET A-1', '#111111', '#f8fafc'));
  // Pumpenschrank hinten mit Schlauchtrommel, Leiter
  k.bx(-h, -h + 0.07, 0.032, 0.14, 0.122, paint(0xe5e7eb));
  k.pair(-h + 0.006, -h + 0.064, 0.05, 0.13, 0.0615, 0.002, matte(0x9ca3af));
  k.cyl(-h - 0.006, 0.09, 0, 0.032, 0.09, 'z', matte(0x1f2937), 14);
  k.cyl(-h - 0.006, 0.09, 0, 0.012, 0.096, 'z', paint(0xdc2626), 10);
  for (let y = 0.05; y < 0.15; y += 0.022) k.box(-h + 0.072, -h + 0.076, y, y + 0.003, -0.02, 0.02, metal(0xcbd5e1));
  // Unterfahrschutz, Kotflügel, Räder (vorn eine, hinten zwei Achsen)
  k.pair(-h + 0.26, h - 0.16, 0.034, 0.042, 0.06, 0.004, metal(0xb4bcc5));
  k.pair(-h + 0.08, -h + 0.24, 0.058, 0.064, 0.056, 0.03, matte(DARK));
  k.axle(h - 0.075, 0.052, 0.027, 0.026);
  k.axle(-h + 0.12, 0.052, 0.027, 0.026);
  k.axle(-h + 0.2, 0.052, 0.027, 0.026);
  tail(k, -h, 0.05, 0.122);
  beacon(g, k, h - 0.075, 0.165);
  lights(g, h, -h, 0.064, w / 2 - 0.02);
}

function catering(k, g, body) {
  const h = 0.31, w = 0.128;
  const teal = paint(0x0f766e);
  k.bx(-h + 0.02, h - 0.02, 0.026, 0.05, 0.085, matte(DARK));
  k.bx(-h + 0.01, h - 0.15, 0.05, 0.07, w - 0.01, matte(0x3a3f46));
  cab(k, h - 0.135, h, 0.032, 0.15, w, paint(0xf8fafc), { roof: teal });
  k.pair(h - 0.135, h - 0.002, 0.07, 0.078, w / 2 + 0.0005, 0.003, teal);
  k.axle(h - 0.07, 0.054, 0.026, 0.026);
  k.axle(-h + 0.085, 0.054, 0.026, 0.026);
  k.pair(-h + 0.05, -h + 0.12, 0.054, 0.06, 0.056, 0.032, matte(DARK));
  beacon(g, k, h - 0.07, 0.157);
  lights(g, h, -h, 0.064, w / 2 - 0.02);
  // Hubkasten (Gruppe 'lift', fährt hoch) mit Plattform ('plat', schiebt sich nach vorn) und Schere ('scis')
  const lk = new Kit();
  const bx0 = -h + 0.006, bx1 = h - 0.15;
  lk.bx(bx0, bx1, 0, 0.13, 0.13, paint(0xf3f4f6, 30));
  lk.pair(bx0, bx1, 0.03, 0.05, 0.0652, 0.002, teal);
  lk.pair(bx0 + 0.02, bx0 + 0.09, 0.056, 0.12, 0.0652, 0.0024, matte(0xd1d5db));
  lk.bx(bx0 - 0.002, bx1 + 0.002, 0.13, 0.136, 0.134, teal);
  lk.bx(bx1, bx1 + 0.003, 0.012, 0.118, 0.1, matte(0xc7ccd2));
  tail(lk, bx0, 0.004, 0.13);
  const lift = lk.build();
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

function van(k, g, body, h = 0.18, w = 0.1) {
  const H = 0.122, xh = h - 0.068;
  k.bx(-h, xh, 0.022, H, w, body);
  k.bx(xh, h, 0.022, 0.066, w, body);
  // Frontscheibe schräg mit Füllkeil dahinter
  const a = Math.atan2(0.04, 0.056), len = Math.hypot(0.04, 0.056);
  k.obox(xh + 0.02 - Math.cos(a) * 0.012, 0.094 - Math.sin(a) * 0.012, 0, 0.024, len, w, body, 0, 0, a);
  k.obox(xh + 0.021, 0.0945, 0, 0.003, len - 0.006, w - 0.012, glass(), 0, 0, a);
  k.pair(-h + 0.03, xh - 0.004, 0.078, H - 0.01, w / 2, 0.004, glass());
  k.box(0.0, 0.004, 0.026, H - 0.01, w / 2 - 0.001, w / 2 + 0.002, matte(0x14532d));
  k.bx(-h - 0.002, -h + 0.002, 0.03, H - 0.012, 0.004, matte(0x14532d));
  k.bx(-h - 0.003, -h + 0.0005, 0.07, H - 0.012, w - 0.03, glass());
  k.bx(-h + 0.01, xh - 0.01, H, H + 0.004, w - 0.01, paint(0xf8fafc));
  for (const x of [-h + 0.03, -0.02, xh - 0.03]) k.bx(x, x + 0.006, H + 0.004, H + 0.014, w - 0.012, matte(0x2a2d33));
  k.pair(-h + 0.03, xh - 0.03, H + 0.012, H + 0.016, w / 2 - 0.006, 0.004, matte(0x2a2d33));
  k.bx(h, h + 0.008, 0.016, 0.034, w + 0.004, matte(DARK));
  k.bx(h + 0.0005, h + 0.003, 0.036, 0.056, w * 0.5, matte(0x2f343b));
  k.pair(h - 0.003, h + 0.003, 0.044, 0.054, w / 2 - 0.012, 0.02, lamp(0xfff4d6));
  k.pair(xh - 0.006, xh + 0.004, 0.07, 0.088, w / 2 + 0.01, 0.004, matte(0x1c1f24));
  k.pair(-h + 0.01, xh - 0.01, 0.034, 0.042, w / 2 + 0.0005, 0.002, paint(0xf8fafc));
  tail(k, -h, 0.05, w);
  k.axle(h - 0.045, w / 2 - 0.006, 0.021, 0.02);
  k.axle(-h + 0.05, w / 2 - 0.006, 0.021, 0.02);
  beacon(g, k, xh - 0.02, H + 0.004);
  lights(g, h, -h, 0.048, w / 2 - 0.012);
}

function bus(k, g, body) {
  const h = 0.4, w = 0.15, roof = 0.128;
  const white = paint(0xf8fafc, 30);
  k.bx(-h, h, 0.012, 0.048, w, body);
  k.bx(-h + 0.006, h - 0.006, 0.048, roof, w + 0.0015, glass());
  k.bx(-h, h, roof, 0.146, w, white);
  k.bx(-h + 0.012, h - 0.012, 0.146, 0.15, w - 0.02, paint(0xe2e8f0, 30));
  for (const x of [-0.25, 0.12]) k.bx(x, x + 0.11, 0.146, 0.164, 0.09, paint(0xe5e7eb, 30));
  // Fenstersäulen
  for (let x = -h + 0.006; x < h; x += 0.064) k.bx(x, x + 0.006, 0.048, roof, w + 0.003, white);
  // Doppeltüren beidseitig (dunkles Glas mit Rahmen und Mittelfuge)
  for (const x of [-0.27, -0.02, 0.23]) {
    k.pair(x - 0.034, x + 0.034, 0.014, roof - 0.004, w / 2 + 0.0012, 0.002, matte(0x182230));
    k.pair(x - 0.036, x + 0.036, roof - 0.006, roof, w / 2 + 0.0016, 0.002, matte(0x94a3b8));
    k.pair(x - 0.0012, x + 0.0012, 0.014, roof - 0.004, w / 2 + 0.0022, 0.002, matte(0x94a3b8));
  }
  // Front und Heck: große Scheiben, Zielanzeige, Lichter
  k.bx(h - 0.002, h + 0.003, 0.05, roof - 0.004, w - 0.014, glass());
  k.bx(-h - 0.003, -h + 0.002, 0.06, roof - 0.006, w - 0.02, glass());
  k.bx(h + 0.001, h + 0.004, roof - 0.002, 0.142, w * 0.6, lamp(0xffb020));
  k.bx(h, h + 0.008, 0.008, 0.026, w + 0.002, matte(DARK));
  k.bx(-h - 0.008, -h, 0.008, 0.026, w + 0.002, matte(DARK));
  k.pair(h + 0.001, h + 0.005, 0.03, 0.04, w / 2 - 0.016, 0.022, lamp(0xfff4d6));
  k.pair(h - 0.008, h - 0.002, 0.07, 0.1, w / 2 + 0.008, 0.004, matte(0x1c1f24));
  tail(k, -h, 0.03, w);
  k.axle(h - 0.1, w / 2 - 0.012, 0.022, 0.022);
  k.axle(-h + 0.1, w / 2 - 0.012, 0.022, 0.022);
  beacon(g, k, h - 0.05, 0.15);
  lights(g, h, -h, 0.035, w / 2 - 0.02);
}

function deice(k, g, body) {
  const h = 0.41, w = 0.124;
  k.bx(-h + 0.02, h - 0.02, 0.026, 0.044, 0.08, matte(DARK));
  cab(k, h - 0.15, h, 0.032, 0.158, w, body, { roof: paint(0xf8fafc) });
  // Flüssigkeitstank mit abgerundeten Kanten, Band, Pumpenkasten
  const tx0 = -h + 0.02, tx1 = h - 0.165, white = paint(0xf1f5f9, 40);
  k.bx(tx0, tx1, 0.044, 0.13, 0.122, white);
  k.bx(tx0, tx1, 0.13, 0.15, 0.08, white);
  for (const s of [-1, 1]) k.cyl((tx0 + tx1) / 2, 0.13, s * 0.04, 0.02, tx1 - tx0, 'x', white, 12);
  k.pair(tx0, tx1, 0.07, 0.085, 0.0612, 0.002, body);
  k.pair(tx0 + 0.02, tx0 + 0.12, 0.09, 0.12, 0.0615, 0.002, matte(0x9ca3af));
  k.pair(-h + 0.08, -h + 0.24, 0.056, 0.062, 0.056, 0.03, matte(DARK));
  k.axle(h - 0.075, 0.052, 0.027, 0.026);
  k.axle(-h + 0.12, 0.052, 0.027, 0.026);
  k.axle(-h + 0.2, 0.052, 0.027, 0.026);
  tail(k, -h + 0.02, 0.05, 0.122);
  beacon(g, k, h - 0.075, 0.165);
  lights(g, h, -h + 0.02, 0.064, w / 2 - 0.02);
  // Drehkranz ('tur') mit Arm ('boom'), Korb ('bask', bleibt waagrecht) und Sprühstrahl ('spray')
  const tk = new Kit();
  tk.cyl(0, 0.01, 0, 0.034, 0.02, 'y', body, 16);
  tk.bx(-0.02, 0.02, 0.02, 0.04, 0.03, body);
  const tur = tk.build();
  tur.name = 'tur';
  tur.position.set(-h + 0.1, 0.15, 0);
  const bk = new Kit();
  bk.obox(0.2, 0, 0, 0.4, 0.022, 0.022, paint(0xf8fafc, 40));
  bk.obox(0.12, 0.014, 0, 0.16, 0.006, 0.018, body);
  bk.rod([0.02, -0.012, 0], [0.16, -0.004, 0], 0.012, metal(0xaeb6bf));
  const boom = bk.build();
  boom.name = 'boom';
  boom.position.y = 0.032;
  boom.rotation.z = -0.03;
  const ck = new Kit();
  ck.bx(-0.032, 0.032, -0.03, 0.03, 0.064, glass());
  ck.bx(-0.034, 0.034, 0.03, 0.036, 0.068, body);
  ck.bx(-0.034, 0.034, -0.036, -0.028, 0.068, body);
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

function fire(k, g, body) {
  const h = 0.3, w = 0.15;
  k.bx(-h + 0.02, h - 0.02, 0.03, 0.05, 0.1, matte(DARK));
  cab(k, h - 0.13, h, 0.04, 0.165, w, body, { win: 0.4, roof: paint(0xf8fafc) });
  k.bx(-h, h - 0.132, 0.04, 0.17, w, body);
  // Geräteräume mit Rollläden, Reflexstreifen, Dachgeländer, Dachwerfer und Frontwerfer
  for (const [a, b] of [[-h + 0.012, -h + 0.1], [-h + 0.11, -0.03], [-0.02, h - 0.145]]) {
    k.pair(a, b, 0.066, 0.158, w / 2 + 0.0008, 0.002, metal(0xd1d5db));
    for (let y = 0.07; y < 0.156; y += 0.012) k.pair(a, b, y, y + 0.002, w / 2 + 0.0018, 0.001, matte(0xa1a7ae));
  }
  k.pair(-h, h - 0.002, 0.048, 0.06, w / 2 + 0.0012, 0.002, redWhite());
  for (const s of [-1, 1]) k.rod([-h + 0.02, 0.188, s * 0.06], [h - 0.15, 0.188, s * 0.06], 0.004, metal(0xcbd5e1));
  for (let x = -h + 0.02; x <= h - 0.15; x += 0.07) for (const s of [-1, 1]) k.rod([x, 0.17, s * 0.06], [x, 0.188, s * 0.06], 0.004, metal(0xcbd5e1));
  k.cyl(h - 0.055, 0.18, 0, 0.016, 0.018, 'y', metal(0xb8bec6), 12);
  k.cyl(h - 0.02, 0.188, 0, 0.007, 0.07, 'x', metal(0xd1d5db), 10);
  k.cyl(h + 0.022, 0.03, 0, 0.006, 0.03, 'x', metal(0xd1d5db), 8);
  k.bx(h - 0.11, h - 0.09, 0.172, 0.18, 0.11, lamp(0x60a5fa));
  for (const x of [h - 0.075, -h + 0.13, -h + 0.21]) {
    k.axle(x, 0.064, 0.034, 0.032);
    k.pair(x - 0.04, x + 0.04, 0.072, 0.078, 0.068, 0.022, matte(DARK));
  }
  tail(k, -h, 0.06, w);
  beacon(g, k, h - 0.1, 0.18, 0, 0x3b82f6);
  lights(g, h, -h, 0.068, w / 2 - 0.022);
}

function plow(k, g, body) {
  const h = 0.3, w = 0.13;
  k.bx(-h + 0.02, h - 0.02, 0.026, 0.046, 0.085, matte(DARK));
  cab(k, h - 0.13, h, 0.034, 0.16, w, body);
  k.bx(-h, h - 0.135, 0.046, 0.13, w - 0.004, body);
  k.pair(-h, h - 0.135, 0.06, 0.07, w / 2, 0.002, hazard());
  // Schild vorn (schräg, mit Gummikante), Kehrwalze in der Mitte mit Haube, Gebläse hinten
  k.obox(h + 0.05, 0.05, 0, 0.012, 0.06, 0.32, body, 0, 0.32, 0);
  k.obox(h + 0.048, 0.018, 0, 0.014, 0.008, 0.32, matte(0x111111), 0, 0.32, 0);
  k.obox(h + 0.05, 0.081, 0, 0.014, 0.004, 0.32, hazard(), 0, 0.32, 0);
  k.rod([h, 0.04, -0.03], [h + 0.044, 0.05, -0.02], 0.008, matte(DARK));
  k.rod([h, 0.04, 0.03], [h + 0.044, 0.05, 0.02], 0.008, matte(DARK));
  k.cyl(-0.03, 0.03, 0, 0.03, 0.2, 'z', matte(0x1e3a8a), 14);
  k.obox(-0.03, 0.062, 0, 0.07, 0.008, 0.21, body, 0, 0, 0);
  k.cyl(-h + 0.04, 0.16, 0, 0.022, 0.06, 'y', body, 12);
  k.rod([-h + 0.04, 0.19, 0], [-h + 0.07, 0.205, 0.04], 0.012, body);
  k.axle(h - 0.07, 0.058, 0.03, 0.028);
  k.axle(-h + 0.1, 0.058, 0.03, 0.028);
  tail(k, -h, 0.05, w);
  beacon(g, k, h - 0.065, 0.167);
  beacon(g, k, -h + 0.02, 0.13);
  lights(g, h, -h, 0.064, w / 2 - 0.02);
}

function followMe(k, g) {
  const h = 0.12, w = 0.092, body = paint(0xfacc15, 70);
  k.bx(-h, h, 0.018, 0.05, w, body);
  k.bx(-h + 0.035, h - 0.06, 0.05, 0.084, w - 0.008, glass());
  k.bx(-h + 0.03, h - 0.055, 0.084, 0.09, w - 0.004, body);
  for (const x of [-h + 0.035, -0.005, h - 0.066]) k.bx(x, x + 0.006, 0.05, 0.084, w - 0.004, body);
  k.pair(-h + 0.004, h - 0.004, 0.03, 0.042, w / 2 + 0.0008, 0.002, checker());
  k.bx(h, h + 0.006, 0.014, 0.03, w, matte(DARK));
  k.bx(-h - 0.006, -h, 0.014, 0.03, w, matte(DARK));
  k.pair(h - 0.001, h + 0.002, 0.036, 0.044, w / 2 - 0.012, 0.018, lamp(0xfff4d6));
  tail(k, -h, 0.036, w);
  // Dachschild „FOLLOW ME“ (leuchtet)
  k.bx(-0.03, 0.03, 0.09, 0.094, 0.05, matte(DARK));
  k.box(-0.032, 0.032, 0.094, 0.118, -0.003, 0.003, plate('fm', 'FOLLOW ME', '#111111', '#facc15', true), 0, Math.PI / 2, 0);
  k.axle(h - 0.035, w / 2 - 0.004, 0.017, 0.016);
  k.axle(-h + 0.035, w / 2 - 0.004, 0.017, 0.016);
  for (const s of [-1, 1]) beacon(g, k, -0.01, 0.118, s * 0.028);
  lights(g, h, -h, 0.04, w / 2 - 0.014);
}

const BUILD = { tug, baggage, fuel, catering, bus, deice, cleaning: van, fire, plow, followme: followMe };
const BODY = { fire: 0xc81e1e, plow: 0xea6a0c, followme: 0xfacc15 };

const VT = new Map();
function vehTemplate(type) {
  const g = new THREE.Group();
  const k = new Kit();
  const vt = VEH_TYPES[type] || {};
  const body = paint(BODY[type] ?? new THREE.Color(vt.color || '#facc15').getHex(), 55);
  (BUILD[type] || van)(k, g, body);
  k.build(g);
  return g;
}
export function buildVehicle(v) {
  if (!VT.has(v.type)) VT.set(v.type, vehTemplate(v.type));
  return VT.get(v.type).clone();
}
// bewegliche Teile eines geklonten Fahrzeugs (einmal nachschlagen)
export function vehParts(m) {
  if (!m.__parts) {
    const n = (s) => m.getObjectByName(s) || null;
    const bcn = [];
    m.traverse((o) => o.name === 'bcn' && bcn.push(o));
    m.__parts = { bcn, hl: n('hl'), tl: n('tl'), lift: n('lift'), scis: n('scis'), plat: n('plat'), tur: n('tur'), boom: n('boom'), bask: n('bask'), spray: n('spray'), u: 0, yaw: 0 };
  }
  return m.__parts;
}
