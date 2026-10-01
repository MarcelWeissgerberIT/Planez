// 3D-Umland: dieselben Felder wie auf der Karte (mit Furchen), das Dorf mit Satteldachhäusern und Kirche, Bauernhöfe,
// Laubbäume zwischen den Nadelbäumen und Hügelketten am Horizont. Methoden hängen an View3D (this.static, this.mat).
import * as THREE from '../vendor/three.module.min.js';
import * as LY from '../layout.js';
import { terrainLayout } from './terrain.js';
import { season as seasonOf } from '../sim/winter.js';

const CROP3D = {
  spring: [0xc9cf3c, 0xe9d83c, 0x6f9a3a, 0x8a6c4a, 0x7fae4b],
  summer: [0xd8b54c, 0x93ad42, 0x4f7f2b, 0xd2b65a, 0x86a94a],
  autumn: [0xa6865a, 0xc7a95c, 0x6e8a3a, 0x8b6b47, 0x9aa24f],
  winter: [0x9c8f78, 0x7d8a5a, 0x8f7c62, 0xa8a088, 0x7c8b58],
};

let furrowTex = null;
function furrows() {
  if (furrowTex) return furrowTex;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 8, 64);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 8, 3);
  furrowTex = new THREE.CanvasTexture(c);
  furrowTex.wrapS = furrowTex.wrapT = THREE.RepeatWrapping;
  furrowTex.colorSpace = THREE.SRGBColorSpace;
  return furrowTex;
}

// Satteldach-Prisma (Einheit: 1 × 1 × 1, First entlang x)
function roofGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
}

export function countryside3d(v, state) {
  const T = terrainLayout(LY.GEO.stage);
  const sid = seasonOf(state).id;
  const pal = CROP3D[sid] || CROP3D.autumn;
  // Felder: Grundfarbe × Furchen-Textur, Richtung je Feld
  const tex = furrows();
  const mats = new Map();
  for (const f of T.fields) {
    const col = pal[Math.floor(f.k * pal.length)];
    const key = col + (f.dir ? 'a' : 'b');
    if (!mats.has(key)) {
      const t = tex.clone();
      t.needsUpdate = true;
      if (f.dir) t.rotation = Math.PI / 2;
      mats.set(key, new THREE.MeshLambertMaterial({ color: col, map: t, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    }
    const m = v.flat(f.x0 + 0.08, f.x1 - 0.08, f.y0 + 0.08, f.y1 - 0.08, mats.get(key), 0.0055);
    const uv = m.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (f.x1 - f.x0) * 0.6, uv.getY(i) * (f.y1 - f.y0) * 0.6);
  }
  // Teich
  const p = T.pond;
  const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshPhongMaterial({ color: sid === 'winter' ? 0xbcd3e0 : 0x2f5f7e, shininess: 120, specular: 0x88aacc }));
  pond.rotation.x = -Math.PI / 2;
  pond.scale.set(p.rx, p.ry, 1);
  pond.rotation.z = -0.3;
  pond.position.set(p.x, 0.007, p.y);
  v.static.add(pond);
  // Häuser, Höfe, Kirche
  const houses = T.objs.filter((o) => o.sprite === 'house' || o.sprite === 'farm');
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), houses.length * 2);
  const roof = new THREE.InstancedMesh(roofGeo(), new THREE.MeshLambertMaterial({ color: 0xffffff }), houses.length * 2);
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const WALL = [0xf5efe0, 0xe8dcc4, 0xf1e6d2, 0xdcd6c8, 0xefe9df];
  const ROOF = [0xa63d2a, 0x8f3324, 0x6b4a3a, 0x5b6470, 0xb4532f];
  let n = 0;
  houses.forEach((o, i) => {
    const farm = o.sprite === 'farm';
    const parts = farm ? [[0, 0, o.w * 0.5, o.d * 0.8, 0.32], [o.w * 0.45, 0, o.w * 0.45, o.d * 0.9, 0.4]] : [[0, 0, o.w * 0.8, o.d * 0.7, 0.36]];
    for (const [dx, dz, w, d, h] of parts) {
      const cx = o.fx - o.w / 2 - o.w * 0.2 + dx, cz = o.fy - o.d / 2 + dz;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i % 2) * Math.PI / 2);
      mx.compose(new THREE.Vector3(cx, h / 2, cz), q, new THREE.Vector3(w, h, d));
      body.setMatrixAt(n, mx);
      body.setColorAt(n, col.setHex(farm && dx ? 0x7a5a3c : WALL[i % WALL.length]));
      mx.compose(new THREE.Vector3(cx, h, cz), q, new THREE.Vector3(w * 1.08, h * 0.75, d * 1.1));
      roof.setMatrixAt(n, mx);
      roof.setColorAt(n, col.setHex(ROOF[(i * 3) % ROOF.length]));
      n++;
    }
  });
  body.count = roof.count = n;
  body.castShadow = roof.castShadow = true;
  v.static.add(body, roof);
  const ch = T.objs.find((o) => o.sprite === 'church');
  if (ch) {
    const cx = ch.fx - ch.w / 2, cz = ch.fy - ch.d / 2;
    v.box(cx - 0.45, cx + 0.45, cz - 0.22, cz + 0.22, 0.4, 0xf3efe6);
    const r = new THREE.Mesh(roofGeo(), v.mat(0x9b3b2a));
    r.scale.set(0.95, 0.3, 0.5);
    r.position.set(cx, 0.4, cz);
    v.static.add(r);
    v.box(cx - 0.62, cx - 0.4, cz - 0.11, cz + 0.11, 0.85, 0xf3efe6);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), v.mat(0x3f4652));
    spire.rotation.y = Math.PI / 4;
    spire.position.set(cx - 0.51, 1.1, cz);
    spire.castShadow = true;
    v.static.add(spire);
  }
  // Laubbäume (runde Kronen) an Feldrändern und im Dorf
  const R = mulberry(77);
  const crowns = [];
  for (const f of T.fields) if (f.k < 0.3) for (let x = f.x0 + 0.8; x < f.x1; x += 1.6 + R() * 1.4) crowns.push([x, f.y1 + (R() - 0.5) * 0.2, 0.35 + R() * 0.25]);
  for (const o of T.objs) if (o.sprite !== 'bush' && R() < 0.7) crowns.push([o.fx + 0.4 + R() * 0.6, o.fy - R() * o.d, 0.4 + R() * 0.3]);
  const leafCols = { spring: [0x6fa83f, 0x86b84a], summer: [0x3f7a2c, 0x4f8a33], autumn: [0xc2652a, 0xd99a2b, 0x9c4a22, 0x6f8a35], winter: [0x6b5a48, 0x7a6a56] }[sid] || [0x4f8a33];
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), crowns.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 1, 5), v.mat(0x5a4632), crowns.length);
  crowns.forEach(([x, z, s], i) => {
    mx.compose(new THREE.Vector3(x, s * 1.35, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.9, s));
    crown.setMatrixAt(i, mx);
    crown.setColorAt(i, col.setHex(leafCols[i % leafCols.length]));
    mx.compose(new THREE.Vector3(x, s * 0.45, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.9, s));
    trunk.setMatrixAt(i, mx);
  });
  crown.castShadow = true;
  v.static.add(crown, trunk);
  // Hügelketten am Horizont (im Dunst bläulich)
  const hills = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 90);
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + R() * 0.05;
    const far = i % 3 === 0;
    const d = (far ? 5200 : 2600) + R() * 1400;
    const rad = (far ? 900 : 450) + R() * 500;
    mx.compose(new THREE.Vector3(LY.W / 2 + Math.cos(a) * d, -20, LY.H / 2 + Math.sin(a) * d), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 3), new THREE.Vector3(rad, (far ? 70 : 25) + R() * (far ? 90 : 45), rad * (0.6 + R() * 0.5)));
    hills.setMatrixAt(i, mx);
    hills.setColorAt(i, col.setHex(far ? 0x5f7184 : sid === 'winter' ? 0xd7dde4 : 0x58764a));
  }
  v.static.add(hills);
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
