// Luftrettungsstation als 3D-Modell (Karte über acimp, 3D-Ansicht direkt): Hangar mit Sektionaltor zum Landeplatz,
// gelbem Band und Schild, zweigeschossiges Stationsgebäude der Crew mit Fensterbändern und Dachantenne, liegender
// Kerosintank auf Sätteln mit Zapfsäule. Ursprung in der Mitte (HB_CENTER), 1 Einheit = 1 Kachel; dazu der Boden als
// Textur für die 3D-Ansicht (dieselbe Zeichnung wie auf der Karte).
import * as THREE from '../vendor/three.module.min.js';
import { HELIBASE } from '../layout.js';
import { paintHeliBase } from './helibase.js';

const B = HELIBASE;
export const HB_CENTER = { x: (B.station.x0 + B.hangar.x1) / 2, y: (B.hangar.y0 + 47.1) / 2 };

const MAT = {};
const phong = (c, sh = 30) => (MAT['p' + c + sh] ||= new THREE.MeshPhongMaterial({ color: c, shininess: sh, specular: 0x333333 }));
const lamb = (c) => (MAT['l' + c] ||= new THREE.MeshLambertMaterial({ color: c }));

// Schild bzw. Torfläche als Textur
function tex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
let T = null;
function textures() {
  if (T) return T;
  T = {
    sign: tex(512, 64, (g, w, h) => {
      g.fillStyle = '#f3c316';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#16181c';
      g.font = '900 40px Arial, Helvetica, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('LUFTRETTUNGSSTATION', w / 2, h / 2 + 2);
    }),
    door: tex(256, 128, (g, w, h) => {
      g.fillStyle = '#c7ccd2';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(70,78,88,0.45)';
      for (let y = 10; y < h; y += 14) g.fillRect(0, y, w, 2);
      g.fillStyle = 'rgba(40,46,54,0.6)';
      for (const x of [w / 3, (2 * w) / 3]) g.fillRect(x - 1, 0, 2, h);
      g.fillStyle = 'rgba(160,200,230,0.55)';
      for (let x = 8; x < w - 8; x += 20) g.fillRect(x, 40, 14, 8); // Fensterreihe im Tor
    }),
    windows: tex(256, 128, (g, w, h) => {
      g.fillStyle = '#eef0f2';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f3c316';
      g.fillRect(0, h * 0.44, w, h * 0.08);
      for (const y0 of [h * 0.14, h * 0.6]) {
        g.fillStyle = '#2b3a4c';
        g.fillRect(6, y0, w - 12, h * 0.22);
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.fillRect(6, y0, w - 12, h * 0.05);
        g.fillStyle = '#d7dbe0';
        for (let x = 6; x < w; x += 32) g.fillRect(x, y0, 3, h * 0.22);
      }
    }),
  };
  return T;
}

const box = (sx, sy, sz, x, y, z, m) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  b.position.set(x, y, z);
  b.castShadow = b.receiveShadow = true;
  return b;
};

export function buildHeliBase() {
  const g = new THREE.Group();
  const t = textures();
  const ox = HB_CENTER.x, oy = HB_CENTER.y;
  // Hangar
  const H = B.hangar, hw = H.x1 - H.x0, hd = H.y1 - H.y0, hx = (H.x0 + H.x1) / 2 - ox, hz = (H.y0 + H.y1) / 2 - oy;
  g.add(box(hw, H.h, hd, hx, H.h / 2, hz, phong(0xd2d7dd, 20)));
  // flaches Tonnendach mit Überstand (Bogen quer zur Halle, über die ganze Breite gezogen)
  const half = hd / 2 + 0.04, rise = 0.085;
  const sh = new THREE.Shape();
  sh.moveTo(-half, 0);
  sh.quadraticCurveTo(0, rise * 2, half, 0);
  sh.closePath();
  const rg = new THREE.ExtrudeGeometry(sh, { depth: hw + 0.06, bevelEnabled: false, curveSegments: 18 });
  rg.translate(0, 0, -(hw + 0.06) / 2);
  const roof = new THREE.Mesh(rg, phong(0x8b939c, 40));
  roof.rotation.y = Math.PI / 2;
  roof.position.set(hx, H.h, hz);
  roof.castShadow = true;
  g.add(roof);
  g.add(box(hw + 0.004, 0.035, hd + 0.004, hx, H.h - 0.04, hz, phong(0xf3c316, 40))); // gelbes Band
  // Tor zum Landeplatz (Süden = +z) und Schild darüber
  const door = new THREE.Mesh(new THREE.PlaneGeometry(hw * 0.86, H.h * 0.74), new THREE.MeshLambertMaterial({ map: t.door }));
  door.position.set(hx, H.h * 0.37, hz + hd / 2 + 0.003);
  g.add(door);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(hw * 0.7, 0.07), new THREE.MeshBasicMaterial({ map: t.sign }));
  sign.position.set(hx, H.h * 0.86, hz + hd / 2 + 0.004);
  g.add(sign);
  // Stationsgebäude: zwei Geschosse mit Fensterbändern, Attika, Dachantenne
  const S = B.station, sw = S.x1 - S.x0, sd = S.y1 - S.y0, sx = (S.x0 + S.x1) / 2 - ox, sz = (S.y0 + S.y1) / 2 - oy;
  const wm = new THREE.MeshLambertMaterial({ map: t.windows });
  const plain = phong(0xeef0f2, 10);
  const st = new THREE.Mesh(new THREE.BoxGeometry(sw, S.h, sd), [wm, wm, plain, plain, wm, wm]);
  st.position.set(sx, S.h / 2, sz);
  st.castShadow = st.receiveShadow = true;
  g.add(st);
  g.add(box(sw + 0.03, 0.03, sd + 0.03, sx, S.h + 0.015, sz, phong(0x9aa1a9, 10)));
  g.add(box(sw - 0.06, 0.012, sd - 0.06, sx, S.h + 0.026, sz, lamb(0x6b7178)));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.32, 6), phong(0xb0b6bd));
  mast.position.set(sx + sw * 0.32, S.h + 0.17, sz - sd * 0.2);
  g.add(mast);
  g.add(box(0.12, 0.06, 0.1, sx - sw * 0.25, S.h + 0.06, sz, phong(0xc3c8ce))); // Klimagerät
  // Kerosintank auf Sätteln mit Zapfsäule
  const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.52, 18), phong(0xe8eaec, 60));
  tk.rotation.z = Math.PI / 2;
  tk.position.set(B.tank.x - ox, 0.15, B.tank.y - oy);
  tk.castShadow = true;
  g.add(tk);
  for (const dx of [-0.17, 0.17]) g.add(box(0.05, 0.06, 0.18, B.tank.x - ox + dx, 0.03, B.tank.y - oy, lamb(0x5b6168)));
  g.add(box(0.08, 0.14, 0.06, B.tank.x - ox + 0.36, 0.07, B.tank.y - oy, phong(0xc0392b, 30)));
  g.userData = { H: 0 };
  return g;
}

// Boden der Station für die 3D-Ansicht: ein flaches Rechteck über dem Gras mit der Kartenzeichnung als Textur
export function buildHeliBaseGround() {
  const A = B.apron, x0 = B.road.x0, x1 = A.x1 + 0.4, y0 = A.y0 - 0.4, y1 = A.y1 + 0.1;
  const K = 96;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0) * K);
  c.height = Math.ceil((y1 - y0) * K);
  const g = c.getContext('2d');
  g.scale(K, K);
  g.translate(-x0, -y0);
  paintHeliBase(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), new THREE.MeshLambertMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, 0.012, (y0 + y1) / 2);
  m.receiveShadow = true;
  return m;
}
