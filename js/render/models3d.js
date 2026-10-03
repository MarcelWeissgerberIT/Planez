// Gebäudemodelle für die 3D-Ansicht: texturierte GLB-Modelle (assets/models), passend zu den Gebäudegrafiken der Karte.
// Sie werden beim ersten Aufbau der 3D-Szene nachgeladen; bis dahin stehen die einfachen Formen aus view3d/field3d da.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

// Gebäude-ID → Modelldatei, Drehung um die Hochachse (Grad; die Modelle stehen schräg wie die Kartengrafik, so stehen sie
// achsparallel – für jedes Modell aus seiner kleinsten Grundfläche ermittelt) und Höhe in Kacheln. Die Höhe ist gegenüber
// den Proportionen der Kartengrafik gestaucht, damit Gebäude neben den Flugzeugen nicht wie Hochhäuser wirken.
const MODEL = {
  club: ['clubhouse', -40, 0.85],
  gahangar: ['ga_hangar', -46.5, 0.8],
  avgas: ['avgas', -51.25, 0.5],
  sterm: ['small_terminal', -51.75, 1.0],
  stower: ['small_tower', -36.25, 1.75],
  hall: ['terminal_hall', -49.25, 1.8],
  hangar: ['hangar', -40.75, 1.9],
  cargo: ['cargo', 68.25, 1.1],
  depot: ['gse_depot', -40, 1.0],
  fire: ['fire_station', -54.25, 1.6],
  fuel: ['fuel_farm', -41.75, 1.3],
  parking: ['parking', -44.5, 1.5],
  hotel: ['hotel', -34.5, 2.8],
};

const loader = new GLTFLoader();
const cache = new Map(); // Datei -> { obj, size } | 'loading' | 'failed'
const mats = [];
let pending = 0;
let onLoaded = null;

// wird aufgerufen, sobald nach einem Ladeschub alle angeforderten Modelle da sind (einmal, nicht pro Modell)
export function whenModelsLoaded(fn) {
  onLoaded = fn;
}

function load(id) {
  const [name, yaw] = MODEL[id];
  cache.set(name, 'loading');
  pending++;
  loader.load(
    `assets/models/${name}.glb`,
    (gltf) => {
      // im Spiel einheitlich beleuchtet wie die übrigen Flächen: Lambert mit der Modelltextur
      const root = new THREE.Group();
      const obj = gltf.scene;
      obj.traverse((o) => {
        if (!o.isMesh) return;
        const src = o.material;
        // nachts leicht angestrahlt (warmes Licht aus Fenstern und Außenleuchten), damit die Gebäude nicht schwarz werden
        o.material = new THREE.MeshLambertMaterial({ map: src.map || null, color: src.map ? 0xffffff : src.color, emissiveMap: src.map || null, emissive: 0xffd8a0, emissiveIntensity: 0 });
        mats.push(o.material);
        src.dispose();
        o.castShadow = true;
        o.receiveShadow = true;
      });
      obj.rotation.y = (yaw * Math.PI) / 180;
      root.add(obj);
      const box = new THREE.Box3().setFromObject(root, true); // genau (über die Eckpunkte), sonst wird das gedrehte Modell zu groß geschätzt
      const c = box.getCenter(new THREE.Vector3());
      obj.position.set(-c.x, -box.min.y, -c.z);
      cache.set(name, { obj: root, size: box.getSize(new THREE.Vector3()) });
      done();
    },
    undefined,
    () => {
      cache.set(name, 'failed');
      done();
    },
  );
}

function done() {
  pending--;
  if (pending === 0 && onLoaded) onLoaded();
}

// im Leerlauf schon laden, damit die 3D-Ansicht gleich mit den Modellen startet
export function preloadModels(ids) {
  for (const id of ids) if (MODEL[id] && !cache.has(MODEL[id][0])) load(id);
}

// Nachtbeleuchtung 0 … 1
export function modelsNight(k) {
  for (const m of mats) m.emissiveIntensity = k * 0.32;
}

// Platziert das Modell auf der Grundfläche [x0,x1]×[z0,z1] (Spielkoordinaten) und gibt es zurück –
// oder null, solange es noch lädt bzw. nicht vorhanden ist
export function placeModel(group, id, x0, x1, z0, z1) {
  const M = MODEL[id];
  if (!M) return null;
  const e = cache.get(M[0]);
  if (!e) load(id);
  if (!e || typeof e === 'string') return null;
  const m = e.obj.clone();
  m.scale.set((x1 - x0) / e.size.x, M[2] / e.size.y, (z1 - z0) / e.size.z);
  m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  m.userData.height = M[2];
  group.add(m);
  return m;
}
