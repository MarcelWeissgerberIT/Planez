// Flugzeuge auf der Karte als echte 3D-Modelle: Je Bild werden alle sichtbaren Flugzeuge (dieselben Modelle wie in der
// 3D-Ansicht – Rumpf, gepfeilte Flächen, Triebwerke, Leitwerk, Lackierung der Airline) in genau der Kartenprojektion
// in ein Atlas-Bild gerendert; die Karte setzt jedes Flugzeug an seiner Tiefenposition aus dem Atlas ein.
// Projektion: Blickhöhe 30° von Südost ergibt das 2:1-Raster, Höhen werden wie auf der Karte (32 px je Kachel) gestaucht.
import * as THREE from '../vendor/three.module.min.js';
import { buildAircraft } from './model3d.js';
import { PH } from '../sim/aircraft.js';

const EL = Math.PI / 6;
const K1 = 32 * Math.SQRT2; // Bildpunkte je Welteinheit bei Zoom 1 (Kameraraum)
const ZFIX = 32 / (K1 * Math.cos(EL));
const DIR = new THREE.Vector3(Math.cos(EL) * Math.SQRT1_2, Math.sin(EL), Math.cos(EL) * Math.SQRT1_2);
const MAX_CELL = 900;
const HIDE = ['landing', 'taxi', 'gse', 'stairs', 'navL', 'navR', 'navT', 'bcnT', 'bcnB', 'strL', 'strR', 'strT', 'spoilers', 'reverse'];

let R = null, scene = null, world = null, cam = null, failed = false;
const models = new Map(); // Flugzeug-ID -> { g, key, rad, parts }
const cache = new Map(); // Flugzeug-ID -> { cv, key, px, q, K, H, seen } – fertiges Bild, nur bei Änderung neu gerendert
let rsize = 0, frame = 0;
const RENDERS_PER_FRAME = 10;

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

function modelFor(ac) {
  const key = `${ac.type}|${ac.airline}|${ac.special || ''}`;
  let m = models.get(ac.id);
  if (m && m.key === key) return m;
  if (m) world.remove(m.g);
  const g = buildAircraft(ac);
  const parts = {};
  for (const n of [...HIDE, 'gear', 'flapsDn']) parts[n] = g.getObjectByName(n);
  for (const n of HIDE) if (parts[n]) parts[n].visible = false;
  g.traverse((o) => {
    if (o.isSprite) o.visible = false; // Lichtpunkte zeichnet die Karte selbst
  });
  // Ausdehnung ohne Rotation: Länge, Spannweite, Höhe
  g.rotation.set(0, 0, 0);
  g.position.set(0, 0, 0);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const sz = box.getSize(new THREE.Vector3());
  m = { g, key, parts, rad: 0.5 * Math.hypot(sz.x, sz.z) + 0.02, hgt: sz.y, H: g.userData.H || 0.1 };
  world.add(g);
  models.set(ac.id, m);
  return m;
}

export const ready = () => !!R || (!failed && init());

// Bilder für dieses Bild aktualisieren: neu gerendert wird nur, was sich sichtbar ändert (Kurs, Neigung, Fahrwerk,
// Klappen, Zoom) – parkende und geradeaus rollende Flugzeuge kommen aus dem Zwischenspeicher
export function prepare(r, list) {
  frame++;
  if (!list.length || !ready()) return;
  const zoom = r.cam.zoom, dpr = r.cam.dpr || 1;
  const K = K1 * zoom * dpr;
  let budget = RENDERS_PER_FRAME;
  for (const m of models.values()) m.g.visible = false;
  for (const ac of list) {
    const m = modelFor(ac);
    const air = ac.mode === 'air' || ac.z > 0.05;
    const gear = !air || ac.z < 1.2 || ac.phase === PH.FINAL;
    const flaps = ac.phase === PH.FINAL || (ac.phase === PH.TAKEOFF && ac.z < 1);
    const pitch = ac.phase === PH.TAKEOFF && ac.z > 0.02 ? 0.12 : 0;
    const key = `${K.toFixed(2)}|${Math.round(ac.hdg * 360)}|${gear}|${flaps}|${pitch}`;
    let c = cache.get(ac.id);
    if (c) c.seen = frame;
    if (c && c.key === key) continue;
    if (c && budget <= 0) continue; // später neu rendern, bis dahin das alte Bild (passend skaliert)
    budget--;
    let px = Math.ceil(2 * (m.rad + m.hgt * 0.5) * K) + 4;
    const q = Math.min(1, MAX_CELL / px); // sehr groß gezoomt: kleiner rendern, beim Zeichnen strecken
    px = Math.max(8, Math.ceil(px * q));
    if (px > rsize) {
      rsize = Math.min(1024, Math.ceil(px / 128) * 128);
      R.setSize(rsize, rsize, false);
    }
    const g = m.g;
    g.visible = true;
    if (m.parts.gear) m.parts.gear.visible = gear;
    if (m.parts.flapsDn) m.parts.flapsDn.visible = flaps;
    g.position.set(ac.x, m.H + (ac.z || 0), ac.y);
    g.rotation.set(0, -ac.hdg, pitch, 'YXZ');
    const tgt = new THREE.Vector3(ac.x, (m.H + (ac.z || 0)) * ZFIX, ac.y);
    const half = px / 2 / (K * q);
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.position.copy(tgt).addScaledVector(DIR, 100);
    cam.lookAt(tgt);
    cam.updateProjectionMatrix();
    R.setViewport(0, 0, px, px);
    R.setScissor(0, 0, px, px);
    R.setScissorTest(true);
    R.clear();
    R.render(scene, cam);
    R.setScissorTest(false);
    g.visible = false;
    if (!c) cache.set(ac.id, (c = { cv: document.createElement('canvas'), seen: frame }));
    if (c.cv.width !== px) c.cv.width = c.cv.height = px;
    const x = c.cv.getContext('2d');
    x.clearRect(0, 0, px, px);
    x.drawImage(R.domElement, 0, rsize - px, px, px, 0, 0, px, px); // GL-Ursprung unten links
    Object.assign(c, { key, px, q, K, H: m.H });
  }
  // verschwundene Flugzeuge aufräumen
  if (frame % 120 === 0) {
    for (const [id, c] of cache) if (frame - c.seen > 240) cache.delete(id);
    for (const [id, m] of models) if (!cache.has(id)) (world.remove(m.g), models.delete(id));
  }
}

// Flugzeug zeichnen; false = (noch) kein Bild (dann alte Darstellung)
export function draw(r, ac) {
  const c = cache.get(ac.id);
  if (!c || c.seen !== frame) return false;
  const { ctx, cam: map } = r;
  const dpr = map.dpr || 1;
  const p = map.toScreen(ac.x, ac.y, c.H + (ac.z || 0)); // Bild hängt nicht an der Höhe: aktuelle Höhe nehmen
  const size = (c.px / c.q) * ((K1 * map.zoom * dpr) / c.K);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c.cv, p.x * dpr - size / 2, p.y * dpr - size / 2, size, size);
  map.setScreen(ctx);
  return true;
}
