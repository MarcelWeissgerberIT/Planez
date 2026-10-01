// 3D-Szene der kleinen Ausbaustufen (Aufbau-Modus): gemähte Graspiste mit weißen Randtafeln, Rollspuren im Gras,
// Abstellwiese, Vereinsheim mit Funkkabine und Terrasse, Flugzeughalle, AvGas-Tankstelle; als Verkehrslandeplatz
// zusätzlich Asphaltbahn, kleines Vorfeld, Abfertigungsgebäude und Flugleitungsturm. Die Methoden hängen an View3D
// (this.flat/box/static/mat) – sie werden in build() aufgerufen.
import * as THREE from '../vendor/three.module.min.js';
import * as LY from '../layout.js';

const MOWN = 0x7fae4e, TRACK = 0x8fb85a, PATH = 0xb7a98a;

// Satteldach als Prisma (First entlang x oder z)
function gable(v, x0, x1, z0, z1, h0, h1, color, alongX = true) {
  const w = x1 - x0, d = z1 - z0;
  const shape = new THREE.Shape();
  const half = (alongX ? d : w) / 2;
  shape.moveTo(-half - 0.04, 0);
  shape.lineTo(half + 0.04, 0);
  shape.lineTo(0, h1 - h0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: (alongX ? w : d) + 0.08, bevelEnabled: false });
  geo.translate(0, 0, -((alongX ? w : d) + 0.08) / 2);
  const m = new THREE.Mesh(geo, typeof color === 'object' ? color : v.mat(color));
  if (alongX) m.rotation.y = Math.PI / 2;
  m.position.set((x0 + x1) / 2, h0, (z0 + z1) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  v.static.add(m);
  return m;
}

function cyl(v, x, z, r, h, color, y0 = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), typeof color === 'object' ? color : v.mat(color));
  m.position.set(x, y0 + h / 2, z);
  m.castShadow = true;
  v.static.add(m);
  return m;
}

// Graspiste: gemähter Streifen in zwei Grüntönen, weiße Randtafeln (Ecken rot), Schwellen aus Tafeln
export function grassRunway3d(v) {
  const R = LY.RWY;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const y0 = R.y - R.hw - 0.3 + (i * (2 * R.hw + 0.6)) / n;
    v.flat(R.x0 - 0.6, R.x1 + 0.6, y0, y0 + (2 * R.hw + 0.6) / n, i % 2 ? 0x86b356 : 0x79a64a, 0.0075);
  }
  const white = v.mat(0xf8fafc), red = v.mat(0xef4444);
  const tab = new THREE.BoxGeometry(0.42, 0.06, 0.1);
  const pts = [];
  for (let x = R.x0; x <= R.x1 + 0.01; x += 2) for (const s of [-1, 1]) pts.push([x, R.y + s * R.hw, x === R.x0 || x >= R.x1 - 0.1]);
  for (const x of [R.thr['09'], R.thr['27']]) for (let y = R.y - R.hw + 0.15; y <= R.y + R.hw - 0.1; y += 0.32) pts.push([x, y, false, true]);
  for (const [x, y, corner, thr] of pts) {
    const m = new THREE.Mesh(tab, corner ? red : white);
    m.position.set(x, 0.03, y);
    if (thr) m.rotation.y = Math.PI / 2;
    v.static.add(m);
  }
}

// Rollspur im Gras (leicht heller, etwas angehoben gegen Z-Fighting)
function track(v, x0, x1, y0, y1) {
  v.flat(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), TRACK, 0.0068);
}

export function smallField3d(v, state) {
  const st = LY.GEO.stage;
  const R = LY.RWY;
  const conn0 = LY.CONN[0], conn1 = LY.CONN[LY.CONN.length - 1];
  const tx0 = Math.min(conn0, R.thr['09']) - 0.6, tx1 = Math.max(conn1, R.thr['27']) + 0.6;
  if (st === 0) {
    track(v, tx0, tx1, LY.TWY_A - 0.35, LY.TWY_A + 0.35);
    for (const x of LY.EXITS) track(v, x - 0.35, x + 0.35, LY.TWY_A, R.y - R.hw - 0.3);
    for (const c of LY.CONN) track(v, c - 0.35, c + 0.35, LY.LANE, LY.TWY_A);
    track(v, conn0, 39, LY.LANE - 0.3, LY.LANE + 0.3);
    track(v, 53.4, conn1, LY.LANE - 0.3, LY.LANE + 0.3);
  } else {
    const tw = v.twyMat;
    v.flat(tx0, tx1, LY.TWY_A - 0.42, LY.TWY_A + 0.42, tw, 0.008, 3);
    for (let x = tx0; x < tx1; x += 1.4) v.flat(x, x + 0.7, LY.TWY_A - 0.03, LY.TWY_A + 0.03, 0xfacc15, 0.01);
    for (const x of LY.EXITS) v.flat(x - 0.42, x + 0.42, LY.TWY_A, R.y - R.hw, tw, 0.008, 3);
    for (const c of LY.CONN) v.flat(c - 0.42, c + 0.42, LY.LANE, LY.TWY_A, tw, 0.008, 3);
    v.flat(conn0, conn1, LY.LANE - 0.42, LY.LANE + 0.42, tw, 0.0082, 3);
    // kleines Vorfeld mit fünf Positionen
    v.flat(10.2, 41.6, 14.6, LY.LANE + 1.4, v.apronMat, 0.006, 3.2);
    for (const s of state.stands) if (s.built && !s.ga) {
      v.flat(s.x - 0.03, s.x + 0.03, LY.STAND_NOSE, LY.LANE, 0xfacc15, 0.009);
      v.flat(s.x - 0.4, s.x + 0.4, LY.STAND_NOSE - 0.05, LY.STAND_NOSE + 0.02, 0xfacc15, 0.009);
    }
    // Zufahrt und Parkplatz am Abfertigungsgebäude
    v.flat(27.2, 28, 0.7, 7.6, 0x52565c, 0.006);
    v.flat(22.6, 31, 7.6, 10.4, 0x5b6067, 0.006);
  }
  // Abstellwiese der Sportflieger
  const ga = state.stands.filter((s) => s.ga && s.built && !s.closed);
  if (ga.length) {
    const gx0 = Math.min(...ga.map((s) => s.x)) - 1.2, gx1 = Math.max(...ga.map((s) => s.x)) + 1.2;
    v.flat(gx0, gx1, LY.GA_NOSE - 0.9, LY.LANE + 0.5, MOWN, 0.0062);
    for (const s of ga) v.flat(s.x - 0.28, s.x + 0.28, LY.GA_NOSE + 0.03, LY.GA_NOSE + 0.08, 0xf1f5f9, 0.0075);
  }
  // Schotterweg und Parkplatz am Vereinsheim, Holzzaun
  v.flat(46.6, 47.4, 0.7, 10.6, PATH, 0.0062);
  v.flat(43.4, 50, 10.5, 12.5, PATH, 0.0063);
  const post = new THREE.CylinderGeometry(0.02, 0.02, 0.14, 4), wood = v.mat(0x7c5a3a);
  for (let x = st === 0 ? 38.5 : 42; x <= 57; x += 0.6) {
    const m = new THREE.Mesh(post, wood);
    m.position.set(x, 0.07, 12.9);
    v.static.add(m);
  }
  v.box(st === 0 ? 38.5 : 42, 57, 12.88, 12.92, 0.015, wood, 0.1, false);
}

// Gebäude der kleinen Stufen (gibt true zurück, wenn das Gebäude hier gebaut wurde)
export function smallBuilding3d(v, b) {
  const x0 = b.fx - b.w, x1 = b.fx, z0 = b.fy - b.d, z1 = b.fy;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (b.id === 'club') {
    // Vereinsheim: weiße Wände, rotes Satteldach, Funkkabine mit Glas, Holzterrasse mit Sonnenschirmen
    v.box(x0 + 0.1, x1 - 0.1, z0 + 0.15, z1 - 0.55, 0.2, 0xf5f1e8);
    gable(v, x0 + 0.05, x1 - 0.05, z0 + 0.1, z1 - 0.5, 0.2, 0.42, 0xb4432c, true);
    v.box(cx - 0.17, cx + 0.17, cz - 0.3, cz + 0.04, 0.13, new THREE.MeshPhongMaterial({ color: 0x223a52, shininess: 90, specular: 0x99aabb }), 0.36);
    v.box(cx - 0.2, cx + 0.2, cz - 0.33, cz + 0.07, 0.02, 0xe5e7eb, 0.49);
    v.flat(x0 + 0.1, x1 - 0.1, z1 - 0.55, z1 - 0.05, 0x8a6a48, 0.03);
    for (let i = 0; i < 3; i++) {
      const px = x0 + 0.35 + i * ((b.w - 0.7) / 2), pz = z1 - 0.3;
      cyl(v, px, pz, 0.008, 0.14, 0xe5e7eb, 0.03, 4);
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.05, 8), v.mat(0xdc2626));
      c.position.set(px, 0.19, pz);
      v.static.add(c);
    }
    v.towerPos = new THREE.Vector3(cx, 0.58, cz - 0.12);
    return true;
  }
  if (b.id === 'gahangar') {
    // Flugzeughalle: dunkelgrünes Trapezblech, graues Satteldach, offenes Tor zur Wiese
    v.box(x0 + 0.05, x1 - 0.05, z0 + 0.05, z1 - 0.05, 0.36, 0x355e3b);
    gable(v, x0, x1, z0, z1, 0.36, 0.62, 0x9ca3af, false);
    v.box(x0 + 0.35, x1 - 0.35, z1 - 0.06, z1 - 0.03, 0.3, 0x111827, 0, false);
    return true;
  }
  if (b.id === 'avgas') {
    // Tankstelle: Dach auf vier Stützen, zwei Zapfsäulen, liegender Tank
    for (const [dx, dz] of [[0.12, 0.15], [b.w - 0.12, 0.15], [0.12, b.d - 0.4], [b.w - 0.12, b.d - 0.4]]) cyl(v, x0 + dx, z0 + dz, 0.012, 0.22, 0xe5e7eb, 0, 5);
    v.box(x0, x1, z0 + 0.05, z1 - 0.3, 0.025, 0xf8fafc, 0.22);
    for (const dx of [0.3, 0.5]) v.box(x0 + dx - 0.04, x0 + dx + 0.04, cz - 0.15, cz - 0.08, 0.12, 0x15803d);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 12), v.mat(0xf1f5f9));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(cx, 0.13, z1 - 0.15);
    tank.castShadow = true;
    v.static.add(tank);
    return true;
  }
  if (b.id === 'sterm') {
    // Abfertigungsgebäude: zwei Geschosse, Glasband zum Vorfeld, Flachdach mit Technik
    const T = v.textures();
    const fac = T.facade.clone();
    fac.needsUpdate = true;
    fac.repeat.set(b.w / 2.4, 1);
    v.box(x0, x1, z0 + 0.6, z1, 0.5, new THREE.MeshPhongMaterial({ map: fac, shininess: 70, specular: 0x8899aa }));
    v.box(x0 - 0.08, x1 + 0.08, z0 + 0.5, z1 + 0.15, 0.05, 0xe5e7eb, 0.5);
    v.box(x0 + 1, x0 + 1.8, z0 + 1.2, z0 + 1.8, 0.12, 0xcbd5e1, 0.55);
    v.box(x1 - 1.2, x1 - 0.2, z1 - 0.1, z1 + 0.5, 0.03, 0xdbeafe, 0.3); // Vordach
    return true;
  }
  if (b.id === 'stower') {
    // Flugleitungsturm: schlanker Schaft, verglaste Kanzel, Dach mit Antennen
    v.box(cx - 0.18, cx + 0.18, cz - 0.18, cz + 0.18, 1.45, 0xe5e7eb);
    v.box(cx - 0.4, cx + 0.4, cz - 0.4, cz + 0.4, 0.2, 0xd1d5db);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.22, 8), new THREE.MeshPhongMaterial({ color: 0x1d3b55, shininess: 90, specular: 0x99aabb }));
    cab.position.set(cx, 1.56, cz);
    cab.castShadow = true;
    v.static.add(cab);
    cyl(v, cx, cz, 0.32, 0.04, 0xf1f5f9, 1.67, 8);
    cyl(v, cx + 0.1, cz, 0.008, 0.3, 0x9ca3af, 1.71, 4);
    v.towerPos = new THREE.Vector3(cx, 1.58, cz);
    return true;
  }
  return false;
}
