// Flugzeuge und Bodenfahrzeuge auf der Karte als echte 3D-Modelle: dieselben Modelle wie in der 3D-Ansicht (Rumpf,
// Flächen, Triebwerke, Lackierung; Fahrzeuge mit Lack- und Metalltexturen, Werbung, Dachnummern, Fahrgästen) werden in
// genau der Kartenprojektion gerendert und als Bild an ihrer Tiefenposition eingesetzt. Neu gerendert wird nur, wenn
// sich etwas sichtbar ändert (Kurs, Fahrwerk, Klappen, bewegliche Teile, Zoom) – sonst kommt das Bild aus dem Speicher.
// Projektion: Blickhöhe 30° von Südost ergibt das 2:1-Raster, Höhen werden wie auf der Karte (32 px je Kachel) gestaucht.
import * as THREE from '../vendor/three.module.min.js';
import { buildAircraft, buildHeli } from './model3d.js';
import { buildHeliBase, HB_CENTER } from './helibase3d.js';
import { buildVehicle, poseVehicle, carGeos } from './vehicles3d.js';
import { PH } from '../sim/aircraft.js';
import { flapStage, spoilersOut } from './windfx.js';

const EL = Math.PI / 6;
const K1 = 32 * Math.SQRT2; // Bildpunkte je Welteinheit bei Zoom 1 (Kameraraum)
const ZFIX = 32 / (K1 * Math.cos(EL));
const DIR = new THREE.Vector3(Math.cos(EL) * Math.SQRT1_2, Math.sin(EL), Math.cos(EL) * Math.SQRT1_2);
const MAX_CELL = 2400; // größtes Einzelbild (Großraumjet ganz nah auf Retina), darüber wird gestreckt
const HIDE = ['landing', 'taxi', 'gse', 'stairs', 'navL', 'navR', 'navT', 'bcnT', 'bcnB', 'strL', 'strR', 'strT', 'reverse'];
// Ein Neu-Rendering kostet: Szene zeichnen und das Bild aus der Grafikkarte in eine Bild-Canvas holen – der Browser
// wartet dabei auf die Grafikkarte, und die Kopie wächst mit der Größe der WebGL-Fläche (nicht mit dem Ausschnitt).
// Darum ist die Fläche nur so groß wie gerade nötig, je Bild gibt es nur wenige Neu-Renderings (neue Objekte zuerst,
// dann das älteste Bild), beim Zoomen wird das vorhandene Bild skaliert und erst neu gerendert, wenn der Zoom ruht,
// und Animationen (Schaukeln in Böen, Förderband, Fluggastbrücke) laufen mit höchstens etwa 15–20 Bildern je Sekunde.
const SIZES = [128, 256, 512, 1024, 2048, 2560]; // Kantenlängen der WebGL-Fläche
const SHOTS = { fresh: 6, stale: 3, ms: 4, msFresh: 12 }; // je Bild: neue / veraltete Bilder, Zeitrahmen in ms
const ZOOM_TOL = 0.08, ZOOM_SETTLE = 180; // Zoomabweichung, ab der neu gerendert wird; Ruhezeit nach dem Zoomen (ms)
const GAP = { ac: 50, veh: 70 }; // ms zwischen zwei Neu-Renderings desselben Bildes
const BAKE = { n: 16, ms: 8 }; // je Bild für vorberechnete Ebenen (Parkplatz, Parkhaus): neue Autobilder, Zeitrahmen

let R = null, scene = null, world = null, cam = null, failed = false;
const models = new Map(); // ID -> { g, key, rad, hgt, H, parts }
const cache = new Map(); // ID -> { cv, key, px, q, K, cz, seen } – fertiges Bild
let rsize = 0, frame = 0;
let shots = 0, freshShots = 0, spent = 0, need = 0, needAt = 0, lastK = 0, kAt = 0, zoomCalm = true;
let bakeShots = 0, bakeMiss = 0;
// wie viele Autos beim letzten Vorberechnen noch ohne 3D-Bild blieben (dann später nachbacken)
export function takeBakeMiss() {
  const n = bakeMiss;
  bakeMiss = 0;
  return n;
}

// darf in diesem Bild noch gerendert werden? has = es gibt schon ein (veraltetes) Bild, das solange weiter gezeigt wird
function allow(has) {
  if (!has) return freshShots < SHOTS.fresh && spent < SHOTS.msFresh && (freshShots++, true);
  return shots < SHOTS.stale && spent < SHOTS.ms && (shots++, true);
}
// Bild passt nicht mehr zum Zoom: erst neu, wenn der Zoom ruht – oder wenn es sehr weit daneben liegt
function zoomStale(c, K, tol = ZOOM_TOL) {
  const r = c.K / K;
  return Math.abs(r - 1) > tol && (zoomCalm || r > 2.5 || r < 0.4);
}
// WebGL-Fläche passend wählen: wächst sofort, schrumpft in prepare() auf das, was zuletzt gebraucht wurde
function fit(px) {
  const b = SIZES.find((x) => x >= px) || SIZES[SIZES.length - 1];
  if (b > rsize) {
    rsize = b;
    R.setSize(rsize, rsize, false);
  }
  need = Math.max(need, b);
}

function init() {
  if (R || failed) return !!R;
  try {
    R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    R.setPixelRatio(1);
    R.outputColorSpace = THREE.SRGBColorSpace;
    R.setClearColor(0x000000, 0);
    R.autoClear = false;
    scene = new THREE.Scene();
    // wie die Gebäudegrafiken: Himmel- und Bodenlicht, Sonne von Südsüdost
    scene.add(new THREE.HemisphereLight(0xeef4fb, 0x7a8060, 1.45));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(0.45, 1.0, 0.75);
    scene.add(sun);
    world = new THREE.Group();
    world.scale.y = ZFIX;
    scene.add(world);
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    return true;
  } catch (e) {
    failed = true;
    R = null;
    return false;
  }
}
export const ready = () => !!R || (!failed && init());

function modelFor(id, key, make) {
  let m = models.get(id);
  if (m && m.key === key) return m;
  if (m) world.remove(m.g);
  const g = make();
  const parts = {};
  for (const n of [...HIDE, 'gear', 'flapsDn', 'flapsTo', 'slats', 'spoilers']) parts[n] = g.getObjectByName(n);
  for (const n of ['flapsDn', 'flapsTo', 'slats', 'spoilers']) if (parts[n]) parts[n].visible = false;
  for (const n of HIDE) if (parts[n]) parts[n].visible = false;
  g.traverse((o) => {
    if (o.isSprite) o.visible = false; // Lichtpunkte zeichnet die Karte selbst
  });
  g.rotation.set(0, 0, 0);
  g.position.set(0, 0, 0);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const sz = box.getSize(new THREE.Vector3());
  m = { g, key, parts, rad: 0.5 * Math.hypot(sz.x, sz.z) + 0.02, hgt: sz.y, H: g.userData.H || 0 };
  world.add(g);
  models.set(id, m);
  return m;
}

// ein Objekt in ein Bild rendern (Bildmitte = Weltpunkt x, cz, y); gibt Kantenlänge und Verkleinerung zurück
function shoot(obj, rad, hgt, K, x, cz, y, cv) {
  let px = Math.ceil(2 * (rad + hgt * 0.5) * K) + 4;
  const q = Math.min(1, MAX_CELL / px); // sehr groß gezoomt: kleiner rendern, beim Zeichnen strecken
  px = Math.max(8, Math.ceil(px * q));
  const t0 = performance.now();
  fit(px);
  const tgt = new THREE.Vector3(x, cz * ZFIX, y);
  const half = px / 2 / (K * q);
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.position.copy(tgt).addScaledVector(DIR, 100);
  cam.lookAt(tgt);
  cam.updateProjectionMatrix();
  obj.visible = true;
  R.setViewport(0, 0, px, px);
  R.setScissor(0, 0, px, px);
  R.setScissorTest(true);
  R.clear();
  R.render(scene, cam);
  R.setScissorTest(false);
  obj.visible = false;
  if (cv.width !== px) cv.width = cv.height = px;
  const g2 = cv.getContext('2d');
  g2.clearRect(0, 0, px, px);
  g2.drawImage(R.domElement, 0, rsize - px, px, px, 0, 0, px, px); // GL-Ursprung unten links
  spent += performance.now() - t0;
  return { px, q };
}
// ein Modell in sein Bild rendern; z0 = Höhe über Grund, die beim Zeichnen ersetzt wird; sc = Maßstab des Modells
// (Großflughäfen: Flugzeuge und Fahrzeuge maßstäblich kleiner als im Hauptspiel)
function render(id, m, key, K, x, cz, y, z0, sc = 1) {
  let c = cache.get(id);
  if (!c) cache.set(id, (c = { cv: document.createElement('canvas'), seen: frame }));
  Object.assign(c, shoot(m.g, m.rad * sc, m.hgt * sc, K, x, cz, y, c.cv), { key, K, cz: cz - z0, t: performance.now() });
}

// ---------- Pkw: ein Bild je Farbe und Richtung (48 Richtungen), für Straßen, Parkplatz und Parkhaus ----------
const CAR_DIRS = 48;
const carCache = new Map(); // "Bauform|Farbe|Richtung|Maßstab" -> { cv, px, q, K, cz }
const carGroups = new Map();
function carModel(kind) {
  if (carGroups.has(kind)) return carGroups.get(kind);
  let g;
  if (kind.startsWith('bus')) {
    // Linienbus bzw. Hotel-Shuttle der Landseite: Niederflurbus mit Werbung (je Name ein anderes Motiv)
    g = buildVehicle({ type: 'bus', id: kind });
    g.traverse((o) => o.isSprite && (o.visible = false));
    const sz = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    g.userData = { len: sz.x, hgt: sz.y, fixed: true };
  } else {
    const G = carGeos(kind);
    g = new THREE.Group();
    g.add(new THREE.Mesh(G.body, G.mats[0].clone()), new THREE.Mesh(G.detail, G.mats[1]));
    if (G.glass) g.add(new THREE.Mesh(G.glass, G.glassMat), new THREE.Mesh(G.glass, G.inner));
    if (G.decal) g.add(new THREE.Mesh(G.decal, G.decalMat));
    g.userData = { len: G.len, hgt: G.hgt };
  }
  g.visible = false;
  world.add(g);
  carGroups.set(kind, g);
  return g;
}
// Pkw zeichnen (Mitte x, y; Kurs h; sc = Maßstab; zb = Bodenhöhe; kind = Bauform). force: sofort rendern (vorberechnete
// Ebenen). false = kein Bild (dann die gezeichnete Form)
export function drawCar(ctx, map, x, y, h, color, sc = 1, zb = 0, force = false, kind = 'sedan') {
  if (!ready()) return false;
  const dpr = map.dpr || 1, K = K1 * map.zoom * dpr;
  const d = ((Math.round((h / (2 * Math.PI)) * CAR_DIRS) % CAR_DIRS) + CAR_DIRS) % CAR_DIRS;
  // vorberechnete Ebenen haben feste Maßstäbe: eigene Bilder je Maßstab, damit sie sich nicht mit den fahrenden Autos
  // (Maßstab je nach Zoom) gegenseitig verdrängen
  const key = `${kind}|${color}|${d}|${sc}` + (force ? `|b${Math.round(K)}` : '');
  let c = carCache.get(key);
  if (!c || zoomStale(c, K, 0.2)) {
    const ok = force ? bakeShots < BAKE.n && spent < BAKE.ms && (bakeShots++, true) : allow(!!c);
    if (!ok) {
      if (force) bakeMiss++;
      if (!c) return false; // später; bis dahin das alte Bild passend skaliert bzw. die gezeichnete Form
    } else {
      const m = carModel(kind), { len, hgt } = m.userData;
      if (!m.userData.fixed) m.children[0].material.color.set(color);
      m.scale.setScalar(sc);
      m.position.set(0, 0, 0);
      m.rotation.set(0, (-d / CAR_DIRS) * 2 * Math.PI, 0);
      const cz = (hgt / 2) * sc;
      if (!c) carCache.set(key, (c = { cv: document.createElement('canvas') }));
      Object.assign(c, shoot(m, (len / 2 + 0.012) * sc, hgt * sc, K, 0, cz, 0, c.cv), { K, cz });
    }
  }
  const p = map.toScreen(x, y, zb + c.cz);
  const size = (c.px / c.q) * (K / c.K);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c.cv, p.x * dpr - size / 2, p.y * dpr - size / 2, size, size);
  map.setScreen(ctx);
  return true;
}

// Bilder für dieses Bild aktualisieren. acs = Flugzeuge (ggf. mit Vorhaltewinkel), vehs = Fahrzeuge
export function prepare(r, state, acs, vehs = [], dt = 0) {
  frame++;
  shots = freshShots = spent = bakeShots = 0;
  if (!R) {
    if ((!acs.length && !vehs.length) || !ready()) return;
  } else if (performance.now() - needAt >= 1500) {
    // alle 1,5 s: so klein wie das größte zuletzt gerenderte Bild (die Kopie aus der Grafikkarte wird billiger)
    const b = Math.max(SIZES[0], need);
    if (b < rsize) R.setSize((rsize = b), b, false);
    need = 0;
    needAt = performance.now();
  }
  const K = K1 * r.cam.zoom * (r.cam.dpr || 1);
  const now = performance.now();
  if (K !== lastK) (lastK = K), (kAt = now);
  zoomCalm = now - kAt > ZOOM_SETTLE;
  if (!acs.length && !vehs.length) return;
  for (const m of models.values()) m.g.visible = false;
  // was neu gerendert werden müsste – ohne Bild zuerst, dann das älteste Bild
  const todo = [];
  const want = (c, key, gap) => {
    if (c) c.seen = frame;
    if (!c) return true;
    if (zoomStale(c, K)) return true;
    return c.key !== key && now - c.t >= gap;
  };
  for (const ac of acs) {
    const m = modelFor(ac.id, `${ac.type}|${ac.airline}|${ac.special || ''}`, () => buildAircraft(ac));
    const air = ac.mode === 'air' || ac.z > 0.05;
    const gear = !air || ac.z < 1.2 || ac.phase === PH.FINAL;
    const fs = flapStage(ac), spl = spoilersOut(ac); // Klappen 0/1/2, Störklappen
    const pitch = ac.phase === PH.TAKEOFF && ac.z > 0.02 ? 0.12 : 0;
    const roll = Math.round((ac.roll || 0) * 50) / 50; // Schaukeln in Böen (Stufen von gut 1°)
    const sc = ac.sc || 1;
    const key = `${Math.round(ac.hdg * 114.6)}|${gear}|${fs}|${spl}|${pitch}|${roll}|${sc}`; // Kurs in halben Grad
    const c = cache.get(ac.id);
    if (!want(c, key, GAP.ac)) continue;
    todo.push({ c, run: () => {
      if (m.parts.gear) m.parts.gear.visible = gear;
      if (m.parts.flapsDn) m.parts.flapsDn.visible = fs === 2;
      if (m.parts.flapsTo) m.parts.flapsTo.visible = fs === 1;
      if (m.parts.slats) m.parts.slats.visible = fs > 0;
      if (m.parts.spoilers) m.parts.spoilers.visible = spl;
      const z = m.H * sc + (ac.z || 0);
      m.g.scale.setScalar(sc);
      m.g.position.set(ac.x, z, ac.y);
      m.g.rotation.set(roll, -ac.hdg, pitch, 'YXZ');
      render(ac.id, m, key, K, ac.x, z, ac.y, ac.z || 0, sc);
    } });
  }
  for (const v of vehs) {
    const m = modelFor(v.id, `v|${v.type}`, () => buildVehicle(v));
    const pose = poseVehicle(state, v, m.g, dt, r.time ?? state.time); // bewegliche Teile weiterführen, auch ohne neues Bild (Uhr: Echtzeit wie in 3D)
    const sc = v.sc || 1;
    const key = `${Math.round((v.hdg || 0) * 57.3)}|${pose}|${sc}`;
    const c = cache.get(v.id);
    if (!want(c, key, GAP.veh)) continue;
    todo.push({ c, run: () => {
      m.g.scale.setScalar(sc);
      m.g.position.set(v.x, 0, v.y);
      m.g.rotation.set(0, -(v.hdg || 0), 0);
      render(v.id, m, key, K, v.x, (m.hgt * sc) / 2, v.y, 0, sc);
    } });
  }
  todo.sort((a, b) => (a.c ? a.c.t : -1) - (b.c ? b.c.t : -1));
  for (const t of todo) if (allow(!!t.c)) t.run(); // sonst später; bis dahin das alte Bild (passend skaliert)
  // verschwundene Flugzeuge und Fahrzeuge aufräumen
  if (frame % 120 === 0) {
    for (const [id, c] of cache) if (frame - c.seen > 240) cache.delete(id);
    for (const [id, m] of models) if (!cache.has(id)) (world.remove(m.g), models.delete(id));
  }
}

// Hubschrauber (Rettung, Polizei): ein Bild je Kurs und Längsneigung, ohne Hauptrotor (den zeichnet die Karte mit
// Bewegungsunschärfe darüber). z = Höhe über Grund. false = (noch) kein Bild
export function drawHeli(r, id, kind, x, y, z, hdg, pitch = 0) {
  if (!ready()) return false;
  const K = K1 * r.cam.zoom * (r.cam.dpr || 1);
  const m = modelFor(id, `heli|${kind}`, () => {
    const g = buildHeli(kind);
    g.getObjectByName('rotor').visible = false;
    return g;
  });
  const key = `${Math.round(hdg * 120)}|${Math.round(pitch * 50)}`;
  let c = cache.get(id);
  if ((!c || zoomStale(c, K) || (c.key !== key && performance.now() - c.t >= GAP.ac)) && allow(!!c)) {
    m.g.position.set(x, m.H, y);
    m.g.rotation.set(0, -hdg, pitch, 'YXZ');
    render(id, m, key, K, x, m.H, y, 0);
    c = cache.get(id);
  }
  if (!c) return false;
  c.seen = frame;
  return draw(r, id, x, y, z);
}

// Luftrettungsstation (Hangar, Stationsgebäude, Tank): ein Bild je Zoomstufe
export function drawHeliBase(r) {
  if (!ready()) return false;
  const K = K1 * r.cam.zoom * (r.cam.dpr || 1);
  const m = modelFor('heliBase', 'heliBase', buildHeliBase);
  let c = cache.get('heliBase');
  if ((!c || zoomStale(c, K)) && allow(!!c)) {
    m.g.position.set(HB_CENTER.x, 0, HB_CENTER.y);
    render('heliBase', m, 'base', K, HB_CENTER.x, m.hgt / 2, HB_CENTER.y, 0);
    c = cache.get('heliBase');
  }
  if (!c) return false;
  c.seen = frame;
  return draw(r, 'heliBase', HB_CENTER.x, HB_CENTER.y, 0);
}

// gibt es für dieses Bild ein fertiges Bild?
export function has(id) {
  const c = cache.get(id);
  return !!c && c.seen === frame;
}

// Bild zeichnen; z = aktuelle Höhe über Grund (Flugzeuge); false = (noch) kein Bild – dann alte Darstellung
export function draw(r, id, x, y, z = 0) {
  const c = cache.get(id);
  if (!c || c.seen !== frame) return false;
  const { ctx, cam: map } = r;
  const dpr = map.dpr || 1;
  const p = map.toScreen(x, y, c.cz + z); // das Bild hängt nicht an der Höhe: aktuelle Höhe nehmen
  const size = (c.px / c.q) * ((K1 * map.zoom * dpr) / c.K);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c.cv, p.x * dpr - size / 2, p.y * dpr - size / 2, size, size);
  map.setScreen(ctx);
  return true;
}
