// Großflughäfen: Mitfliegen in 3D (three.js). Aus dem Layout des Drehkreuzes entsteht eine 3D-Szene – Umland mit
// Feldern, Gras, Bahnen mit Markierungen und Kennungen, Rollwege mit gelber Mittellinie, Vorfeld mit Positionen,
// Straßen, Terminals und Piers mit Glasfassaden, Tower mit Kanzel, Bäume –, darauf alle Flugzeuge als dieselben
// Modelle wie im Hauptspiel (maßstäblich wie auf der Karte) und die Vorfeldfahrzeuge. Die Kamera sitzt im Cockpit, am
// Fensterplatz oder kreist außen um das gewählte Flugzeug; ziehen dreht den Blick, das Mausrad ändert den Abstand.
// Das Spiel läuft weiter: Seitenleiste mit Streifen, Funk und Radar bleibt bedienbar. Nur Darstellung.
import * as THREE from '../vendor/three.module.min.js';
import { buildAircraft, setNight } from '../render/model3d.js';
import { buildVehicle, poseVehicle } from '../render/vehicles3d.js';
import { flapStage, spoilersOut } from '../render/windfx.js';
import { AC_TYPES } from '../config.js';
import { IMG } from '../assets.js';
import { PHASE as P, SIZE } from './sim.js';
import { polyCenter } from './geom.js';
import { T } from '../i18n.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;
const FT = 65.6; // Kacheln Höhe -> Fuß
const KT = 20 / 0.5144; // Kacheln je Sekunde -> Knoten
const NEAR_AC = 140; // Flugzeuge bis zu diesem Abstand von der Kamera als Modell
const NEAR_VEH = 45;

const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `uniform vec3 top; uniform vec3 hor; uniform vec3 bot; uniform vec3 sunDir; uniform float sunK;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = h > 0.0 ? mix(hor, top, pow(min(1.0, h * 1.6), 0.55)) : mix(hor, bot, min(1.0, -h * 5.0));
  float s = max(0.0, dot(d, sunDir));
  c += vec3(1.0, 0.93, 0.8) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.4 + pow(s, 3.0) * 0.15) * sunK;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

// Bauart -> Farben (wie die Karte)
const BLD = {
  terminal: { roof: 0xc4cad0, wall: 0x6082a0, glass: true },
  pier: { roof: 0xced2d6, wall: 0x6e8ca8, glass: true },
  hotel: { roof: 0x969698, wall: 0xd6cebe, win: true },
  hangar: { roof: 0xa0a8b0, wall: 0xc4c8cc },
  cargo: { roof: 0xb0aa9c, wall: 0xd0c4aa },
  garage: { roof: 0x80848a, wall: 0xacaeb2, win: true },
  fire: { roof: 0x963c36, wall: 0xd6cec4 },
  tank: { roof: 0xe4e6e8, wall: 0xd2d6da },
  tower: { roof: 0x5a6068, wall: 0xd6d8da },
};

function canvasTex(w, h, draw, rep = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function imgTex(name) {
  const im = IMG[name];
  if (!im) return null;
  const t = new THREE.Texture(im);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
const rng = (seed) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};

// flache Geometrie in der Bodenebene (x, Höhe y, Karten-y = z), UV in Weltkacheln / k; Dreiecke werden so gedreht,
// dass sie nach oben zeigen
function flatGeo(tris, k = 1) {
  const n = tris.length;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    let a = tris[i], b = tris[i + 1], c = tris[i + 2];
    // Normale nach oben: (b - a) × (c - a) hat dann eine positive y-Komponente
    if ((b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y) < 0) [b, c] = [c, b];
    [a, b, c].forEach((p, j) => {
      const q = i + j;
      pos[q * 3] = p.x;
      pos[q * 3 + 1] = p.h || 0;
      pos[q * 3 + 2] = p.y;
      nor[q * 3 + 1] = 1;
      uv[q * 2] = p.x / k;
      uv[q * 2 + 1] = p.y / k;
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Rechteck (Mitte, Richtung, Länge, Breite) als zwei Dreiecke
function quad(out, cx, cy, ux, uy, len, wid, h) {
  const vx = -uy, vy = ux, a = len / 2, b = wid / 2;
  const P = (s, l) => ({ x: cx + ux * s + vx * l, y: cy + uy * s + vy * l, h });
  const p0 = P(-a, -b), p1 = P(a, -b), p2 = P(a, b), p3 = P(-a, b);
  out.push(p0, p1, p2, p0, p2, p3);
}
// Linienzug als Band (mit runden Gelenken)
function ribbon(out, pts, w, h) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-4) continue;
    quad(out, (a.x + b.x) / 2, (a.y + b.y) / 2, (b.x - a.x) / L, (b.y - a.y) / L, L, w, h);
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i], n = 10;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      out.push({ x: c.x, y: c.y, h }, { x: c.x + (Math.cos(a0) * w) / 2, y: c.y + (Math.sin(a0) * w) / 2, h }, { x: c.x + (Math.cos(a1) * w) / 2, y: c.y + (Math.sin(a1) * w) / 2, h });
    }
  }
}
// Polygon (konvex oder einfach) per Fächer bzw. Ohrenschneiden
function polyTris(out, poly, h) {
  const pts2 = poly.map((p) => new THREE.Vector2(p.x, p.y));
  const idx = THREE.ShapeUtils.triangulateShape(pts2, []);
  for (const t of idx) for (const i of t) out.push({ x: poly[i].x, y: poly[i].y, h });
}

export class HubView3D {
  static supported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) {
      return false;
    }
  }
  constructor(host, ap) {
    this.ap = ap;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = 'hb-3d';
    host.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.02, 12000);
    this.scene.fog = new THREE.Fog(0xcfdbe2, 80, 900);
    this.hemi = new THREE.HemisphereLight(0xdbeafe, 0x4d5d2a, 1.1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    const sh = this.sun.shadow;
    sh.mapSize.set(2048, 2048);
    Object.assign(sh.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 400 });
    sh.bias = -0.0004;
    sh.normalBias = 0.02;
    this.sun.castShadow = true;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.skyU = { top: { value: new THREE.Color(0x2f6fc0) }, hor: { value: new THREE.Color(0xbcd4e8) }, bot: { value: new THREE.Color(0x55603f) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunK: { value: 1 } };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.scene.add(this.dome);
    this.acs = new Map(); // Flugzeug-ID -> { g, parts, vis }
    this.vehs = new Map();
    this.glassMats = [];
    this.build();
    this.lastT = performance.now() / 1000;
  }
  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
  dispose() {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
  lamb(color, opts = {}) {
    return new THREE.MeshLambertMaterial({ color, ...opts });
  }
  mesh(tris, mat, k = 1, shadow = true) {
    if (!tris.length) return null;
    const m = new THREE.Mesh(flatGeo(tris, k), mat);
    m.receiveShadow = shadow;
    this.scene.add(m);
    return m;
  }

  // ---------- statische Szene ----------
  build() {
    const ap = this.ap, b = ap.bounds;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    this.center = { x: cx, y: cy };
    // Umland: Feldermuster auf einer großen Fläche (2 Kacheln je Bildpunkt), darin das Flughafengelände in Gras
    const S = 4096, R = rng(ap.code.charCodeAt(0) * 97 + ap.code.charCodeAt(1));
    const land = canvasTex(2048, 2048, (g, w) => {
      g.fillStyle = '#6c8a4c';
      g.fillRect(0, 0, w, w);
      const cols = ['#7d9a52', '#8fa45a', '#a7a86a', '#c2b77a', '#6f8f47', '#5f7f43', '#94a866', '#b7ae74', '#7b8a4a', '#58763e'];
      for (let i = 0; i < 2600; i++) {
        const x = R() * w, y = R() * w, fw = 6 + R() * 26, fh = 6 + R() * 26;
        g.save();
        g.translate(x, y);
        g.rotate((R() - 0.5) * 0.5);
        g.fillStyle = cols[Math.floor(R() * cols.length)];
        g.fillRect(-fw / 2, -fh / 2, fw, fh);
        g.restore();
      }
      // Waldstücke
      for (let i = 0; i < 160; i++) {
        g.fillStyle = R() < 0.5 ? '#3f5f33' : '#46683a';
        g.beginPath();
        g.ellipse(R() * w, R() * w, 6 + R() * 24, 5 + R() * 18, R() * 3, 0, Math.PI * 2);
        g.fill();
      }
      // Orte: graue Flecken mit Straßen
      for (let i = 0; i < 26; i++) {
        const x = R() * w, y = R() * w, r = 8 + R() * 22;
        g.fillStyle = '#9a9a92';
        g.beginPath();
        g.ellipse(x, y, r, r * (0.6 + R() * 0.4), R() * 3, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#b8b2a6';
        for (let j = 0; j < 40; j++) g.fillRect(x + (R() - 0.5) * r * 1.6, y + (R() - 0.5) * r * 1.2, 2, 2);
      }
      g.strokeStyle = '#8c8c86';
      g.lineWidth = 1.5;
      for (let i = 0; i < 40; i++) {
        g.beginPath();
        g.moveTo(R() * w, R() * w);
        g.bezierCurveTo(R() * w, R() * w, R() * w, R() * w, R() * w, R() * w);
        g.stroke();
      }
    }, false);
    const landM = new THREE.Mesh(new THREE.PlaneGeometry(S, S), this.lamb(0xffffff, { map: land }));
    landM.rotation.x = -Math.PI / 2;
    landM.position.set(cx, -0.02, cy);
    landM.receiveShadow = true;
    this.scene.add(landM);
    // Flughafengelände: Gras
    const grassT = imgTex('tex_grass');
    if (grassT) grassT.repeat.set(1, 1);
    const gr = [];
    quad(gr, cx, cy, 1, 0, b.x1 - b.x0 + 20, b.y1 - b.y0 + 20, 0);
    this.mesh(gr, this.lamb(grassT ? 0xb8c4a8 : 0x5f7f47, grassT ? { map: grassT } : {}), 7);
    // Straßen
    const roads = [];
    for (const r of ap.roads) ribbon(roads, r.pts, r.w, 0.004);
    this.mesh(roads, this.lamb(0x596068), 1);
    // Vorfeld
    const conc = imgTex('tex_concrete');
    const apr = [];
    for (const a of ap.aprons) polyTris(apr, a, 0.006);
    this.mesh(apr, this.lamb(conc ? 0xc2c6cb : 0x9da2a8, conc ? { map: conc } : {}), 6);
    // Rollwege (Rand, Fläche), Gassen auf dem Vorfeld nur als Linie
    const twyE = [], twy = [], yel = [], white = [];
    for (const l of ap.lines) {
      if (l.kind === 'rwy' || l.kind === 'lane') continue;
      ribbon(twyE, l.pts, (l.w || 1.25) + 0.45, 0.008);
      ribbon(twy, l.pts, l.w || 1.25, 0.01);
    }
    for (const l of ap.lines) if (l.kind !== 'rwy') ribbon(yel, l.pts, 0.07, 0.016);
    this.mesh(twyE, this.lamb(0x5b6168), 1);
    const asp = imgTex('tex_asphalt');
    this.mesh(twy, this.lamb(asp ? 0x8c9096 : 0x454a51, asp ? { map: asp } : {}), 5);
    // Bahnen
    const rw = [], sho = [];
    for (const r of ap.runways) {
      const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
      const mx = (r.a.x + r.b.x) / 2, my = (r.a.y + r.b.y) / 2, w = r.w;
      quad(sho, mx, my, ux, uy, L + 3, w + 1, 0.011);
      quad(rw, mx, my, ux, uy, L + 2, w, 0.013);
      const at = (s, l, len, wid) => quad(white, r.a.x + ux * s - uy * l, r.a.y + uy * s + ux * l, ux, uy, len, wid, 0.018);
      at(L / 2, -w / 2 + 0.155, L, 0.07);
      at(L / 2, w / 2 - 0.155, L, 0.07);
      for (let s = 13; s < L - 13; s += 2.5) at(s + 0.75, 0, 1.5, 0.07);
      for (const k of [0, 1]) {
        const S0 = (s) => (k ? L - s : s);
        const n = 14, sw = (w - 0.7) / (n * 2 - 1);
        for (let i = 0; i < n; i++) at(S0(1.1), -w / 2 + 0.35 + i * 2 * sw + sw / 2, 1.6, sw);
        at(S0(0.1), 0, 0.1, w - 0.2);
        at(S0(21.3), -w / 2 + 0.65, 2.6, 0.4);
        at(S0(21.3), w / 2 - 0.65, 2.6, 0.4);
        for (const s of [7.5, 15, 30, 37.5, 45]) {
          const m = s < 20 ? 3 : s < 40 ? 2 : 1;
          for (let j = 0; j < m; j++) {
            at(S0(s + 0.55), -w / 2 + 0.51 + j * 0.22, 1.1, 0.12);
            at(S0(s + 0.55), w / 2 - 0.51 - j * 0.22, 1.1, 0.12);
          }
        }
      }
      // Kennungen
      for (const endId of r.ends) {
        const end = ap.ends[endId];
        if (!end) continue;
        const tex = canvasTex(256, 256, (g) => {
          g.fillStyle = '#ffffff';
          g.font = '900 150px "Chakra Petch", Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(endId, 128, 132);
        }, false);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
        pl.rotation.order = 'YXZ';
        pl.rotation.x = -Math.PI / 2;
        pl.rotation.y = -Math.atan2(end.dir.y, end.dir.x) - Math.PI / 2;
        pl.position.set(end.thr.x + end.dir.x * 3.6, 0.02, end.thr.y + end.dir.y * 3.6);
        this.scene.add(pl);
      }
    }
    this.mesh(sho, this.lamb(0x4c5158), 1);
    this.mesh(rw, this.lamb(asp ? 0x7a7f86 : 0x34383e, asp ? { map: asp } : {}), 5);
    // Positionen: Einfahrlinie und Stoppbalken
    for (const st of ap.stands) {
      const a = st.anchor, ex = st.x + Math.cos(st.hdg) * 1.6, ey = st.y + Math.sin(st.hdg) * 1.6;
      ribbon(yel, [a, { x: ex, y: ey }], 0.06, 0.016);
      const k = st.size === 'L' ? 2.3 : 1.6;
      quad(yel, st.x + Math.cos(st.hdg) * k, st.y + Math.sin(st.hdg) * k, -Math.sin(st.hdg), Math.cos(st.hdg), 0.9, 0.1, 0.016);
    }
    // Rollhalte: zwei durchgezogene Linien quer zum Rollweg
    for (const n of ap.nodes) {
      if (n.kind !== 'hold') continue;
      const e = ap.edges[n.edges[0]];
      if (!e) continue;
      const kk = e.a === n.id ? 1 : e.pts.length - 2;
      const q = e.pts[clamp(kk, 0, e.pts.length - 1)];
      const h = Math.atan2(q.y - n.y, q.x - n.x);
      for (let i = 0; i < 4; i++) {
        const o = (i - 1.5) * 0.14;
        quad(yel, n.x + Math.cos(h) * o, n.y + Math.sin(h) * o, -Math.sin(h), Math.cos(h), 1.6, 0.06, 0.017);
      }
    }
    this.mesh(white, this.lamb(0xf2f4f6), 1);
    this.mesh(yel, this.lamb(0xf2c230), 1);
    // Gebäude
    const win = canvasTex(64, 64, (g, w) => {
      g.fillStyle = '#2b3b4c';
      g.fillRect(0, 0, w, w);
      for (let r = 0; r < 3; r++) {
        const y0 = (r / 3) * w + 4;
        const gr = g.createLinearGradient(0, y0, 0, y0 + w / 3 - 8);
        gr.addColorStop(0, '#9ccbe8');
        gr.addColorStop(1, '#5f8fb0');
        g.fillStyle = gr;
        g.fillRect(0, y0, w, w / 3 - 8);
      }
      g.fillStyle = '#26323e';
      for (let c = 0; c < 8; c++) g.fillRect((c / 8) * w, 0, 2, w);
    });
    const winE = canvasTex(64, 64, (g, w) => {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, w);
      g.fillStyle = '#ffd9a0';
      for (let r = 0; r < 3; r++) g.fillRect(0, (r / 3) * w + 4, w, w / 3 - 8);
    });
    const hot = canvasTex(64, 64, (g, w) => {
      g.fillStyle = '#d6cebe';
      g.fillRect(0, 0, w, w);
      g.fillStyle = '#5a6a7a';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) g.fillRect(c * 16 + 4, r * 10.6 + 3, 8, 5);
    });
    for (const bd of ap.buildings) {
      const st = BLD[bd.kind] || BLD.hangar;
      const h = bd.h || 0.6;
      const shape = new THREE.Shape(bd.poly.map((p) => new THREE.Vector2(p.x, -p.y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const roof = this.lamb(st.roof);
      let wall;
      if (st.glass) {
        wall = this.lamb(0xffffff, { map: win, emissiveMap: winE, emissive: 0xffffff, emissiveIntensity: 0 });
        this.glassMats.push(wall);
      } else if (st.win) {
        wall = this.lamb(0xffffff, { map: hot, emissiveMap: winE, emissive: 0xffffff, emissiveIntensity: 0 });
        this.glassMats.push(wall);
      } else wall = this.lamb(st.wall);
      const m = new THREE.Mesh(geo, [roof, wall]);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
      if (bd.kind === 'tower') {
        const c = polyCenter(bd.poly);
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.6, 0.55, 8), this.lamb(0x5f9cb4, { emissive: 0x2a5a50, emissiveIntensity: 0 }));
        cab.position.set(c.x, h + 0.275, c.y);
        this.glassMats.push(cab.material);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 1.95, 0.2, 8), this.lamb(0x464c54));
        top.position.set(c.x, h + 0.65, c.y);
        cab.castShadow = top.castShadow = true;
        this.scene.add(cab, top);
      }
    }
    // Bäume
    const trees = ap.trees || [];
    if (trees.length) {
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 0), this.lamb(0x3f6a34, { flatShading: true }), trees.length);
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 5), this.lamb(0x5a4632), trees.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3();
      trees.forEach((t, i) => {
        const s = t.s || 1;
        M.compose(V.set(t.x, 0.85 * s, t.y), Q, new THREE.Vector3(s, s * 1.1, s));
        crown.setMatrixAt(i, M);
        M.compose(V.set(t.x, 0.25 * s, t.y), Q, new THREE.Vector3(s, s, s));
        trunk.setMatrixAt(i, M);
      });
      crown.castShadow = true;
      this.scene.add(crown, trunk);
    }
  }

  // ---------- Flugzeuge ----------
  partsOf(g) {
    const n = (s) => g.getObjectByName(s);
    const p = { gear: n('gear'), flapsDn: n('flapsDn'), flapsTo: n('flapsTo'), slats: n('slats'), spoilers: n('spoilers'), landing: n('landing'), taxi: n('taxi'), reverse: n('reverse'), gse: n('gse'), stairs: n('stairs'), nav: ['navL', 'navR', 'navT'].map(n).filter(Boolean), bcn: ['bcnT', 'bcnB'].map(n).filter(Boolean), str: ['strL', 'strR', 'strT'].map(n).filter(Boolean) };
    for (const k of ['gse', 'stairs', 'reverse']) if (p[k]) p[k].visible = false;
    return p;
  }
  updateAircraft(sim, adapt, focusId, camPos, dt, now, lightsOn, inside) {
    const seen = new Set();
    for (const ac of sim.acs) {
      if (ac.phase === P.GONE) continue;
      const d = Math.hypot(ac.x - camPos.x, ac.y - camPos.z);
      if (ac.id !== focusId && d > NEAR_AC + ac.z * 2) continue;
      seen.add(ac.id);
      const o = adapt(ac);
      let rec = this.acs.get(ac.id);
      if (!rec || rec.key !== `${ac.type}|${ac.airline}`) {
        if (rec) this.scene.remove(rec.g);
        const g = buildAircraft(o);
        g.scale.setScalar(SIZE);
        g.traverse((m) => {
          if (m.isMesh) m.castShadow = true;
        });
        this.scene.add(g);
        rec = { g, key: `${ac.type}|${ac.airline}`, parts: this.partsOf(g), pitch: 0, H: g.userData.H || 0 };
        this.acs.set(ac.id, rec);
      }
      const p = rec.parts, air = ac.z > 0.05;
      // Neigung je Phase (geglättet): Startrotation, Steigflug, Anflug, Abfangen
      const tgtPitch = ac.phase === P.TKOF && ac.z > 0.01 ? 0.16 : ac.phase === P.CLIMB || ac.phase === P.GA ? 0.13 : ac.phase === P.FIN || ac.phase === P.APP ? (ac.z < 0.6 ? 0.07 : 0.035) : 0;
      rec.pitch += (tgtPitch - rec.pitch) * Math.min(1, dt * 2);
      rec.g.position.set(ac.x, rec.H * SIZE + ac.z, ac.y);
      rec.g.rotation.set(0, -ac.hdg, rec.pitch, 'YXZ');
      if (p.gear) p.gear.visible = !air || ac.z < 30 || ac.phase === P.FIN;
      const fs = flapStage(o), spl = spoilersOut(o);
      if (p.flapsDn) p.flapsDn.visible = fs === 2;
      if (p.flapsTo) p.flapsTo.visible = fs === 1;
      if (p.slats) p.slats.visible = fs > 0;
      if (p.spoilers) p.spoilers.visible = spl;
      if (p.reverse) p.reverse.visible = ac.phase === P.ROLL && ac.spd > 0.6;
      // Lichter: Positionslichter immer, Drehlicht bei laufenden Triebwerken, Blitzer und Landescheinwerfer auf der Bahn
      // und in der Luft
      const engines = ac.phase !== P.STAND && ac.phase !== P.PUSH;
      const onRwy = air || ac.phase === P.TKOF || ac.phase === P.ROLL || ac.phase === P.LINED || ac.phase === P.LINEUP;
      for (const s of p.nav) (s.visible = true), s.scale.setScalar(lightsOn ? 0.16 : 0.08);
      const bk = (now * 1.1 + ac.id * 0.13) % 1;
      for (const s of p.bcn) (s.visible = engines && bk < 0.12), s.scale.setScalar(0.16);
      const sk = (now * 1.2 + ac.id * 0.07) % 1;
      for (const s of p.str) (s.visible = onRwy && (sk < 0.05 || (sk > 0.12 && sk < 0.17))), s.scale.setScalar(0.22);
      // Landescheinwerfer (mit Lichtkegel) nur bei Dämmerung und Nacht; im eigenen Flugzeug sieht man sie nicht
      if (p.landing) p.landing.visible = onRwy && lightsOn && !(inside && ac.id === focusId) && !(ac.phase === P.CLIMB && ac.z > 50);
      if (p.taxi) p.taxi.visible = lightsOn && (ac.phase === P.TAXI_IN || ac.phase === P.TAXI_OUT);
    }
    for (const [id, rec] of this.acs) if (!seen.has(id)) (this.scene.remove(rec.g), this.acs.delete(id));
  }
  updateVehicles(list, pState, camPos, dt, now) {
    const seen = new Set();
    for (const v of list) {
      if (Math.hypot(v.x - camPos.x, v.y - camPos.z) > NEAR_VEH) continue;
      seen.add(v.id);
      let m = this.vehs.get(v.id);
      if (!m) {
        m = buildVehicle(v);
        m.scale.setScalar(SIZE);
        m.traverse((x) => {
          if (x.isMesh) x.castShadow = true;
          if (x.isSprite) x.visible = false;
        });
        this.scene.add(m);
        this.vehs.set(v.id, m);
      }
      m.position.set(v.x, 0, v.y);
      m.rotation.y = -(v.hdg || 0);
      m.visible = (v.fade ?? 1) > 0.5;
      try {
        poseVehicle(pState, v, m, dt, now);
      } catch (e) {
        /* bewegliche Teile sind Zierde */
      }
    }
    for (const [id, m] of this.vehs) if (!seen.has(id)) (this.scene.remove(m), this.vehs.delete(id));
  }

  // ---------- Bild ----------
  render(sim, ride, adapt, gseList, pState) {
    const now = performance.now() / 1000;
    const dt = clamp(now - this.lastT, 0, 0.1);
    this.lastT = now;
    // Tageszeit (wie die Karte: hell von etwa 6:30 bis 19:30)
    const hr = ((sim.t / 3600) % 24 + 24) % 24;
    const th = ((hr - 6) / 14) * Math.PI;
    const elev = hr > 5 && hr < 21 ? Math.sin(th) * 55 : -20;
    const sunDir = new THREE.Vector3(Math.cos(th) * Math.cos(elev * DEG), Math.sin(elev * DEG), 0.55 * Math.cos(elev * DEG)).normalize();
    const dayK = clamp((elev + 4) / 14, 0, 1);
    const t1 = clamp((elev + 8) / 8, 0, 1), t2 = clamp((elev - 2) / 14, 0, 1);
    const top = new THREE.Color(0x03060f).lerp(new THREE.Color(0x34497f), t1).lerp(new THREE.Color(0x2f6fc0), t2);
    const hor = new THREE.Color(0x0f182b).lerp(new THREE.Color(0xf0a066), t1).lerp(new THREE.Color(0xbcd4e8), t2);
    const U = this.skyU;
    U.top.value.copy(top);
    U.hor.value.copy(hor);
    U.bot.value.copy(hor).multiplyScalar(0.6);
    U.sunDir.value.copy(sunDir);
    U.sunK.value = elev > -2 ? 1 : 0;
    this.scene.fog.color.copy(hor);
    this.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.5);
    this.hemi.intensity = 0.2 + 0.9 * dayK;
    this.sun.intensity = elev > -1 ? 0.15 + 1.6 * dayK : 0.2;
    const lightsOn = dayK < 0.7;
    for (const m of this.glassMats) m.emissiveIntensity = clamp(0.9 - dayK * 1.2, 0, 0.9);
    setNight(clamp(1 - dayK * 1.4, 0, 1));
    const ac = sim.acs.find((a) => a.id === ride.id);
    const camPos = this.camera.position;
    this.updateAircraft(sim, adapt, ride.id, camPos, dt, now, lightsOn, ride.mode !== 'chase');
    this.updateVehicles(gseList, pState, camPos, dt, now);
    // Kamera am Flugzeug
    const rec = ac && this.acs.get(ac.id);
    const cam = this.camera;
    if (rec) {
      const g = rec.g;
      g.updateMatrixWorld();
      const u = g.userData;
      const yaw = (ride.yaw || 0) * DEG, pit = (ride.pitch || 0) * DEG;
      if (ride.mode === 'cockpit' || ride.mode === 'window') {
        const e = u.eye;
        const local = ride.mode === 'cockpit' ? new THREE.Vector3(e.cockpitX, e.cockpitY, 0) : new THREE.Vector3(e.winX, e.winY, e.winZ);
        cam.position.copy(local.applyMatrix4(g.matrixWorld));
        const q = g.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2 - yaw - (ride.mode === 'window' ? Math.PI / 2 : 0), 0))).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-pit - (ride.mode === 'window' ? 0.18 : 0), 0, 0)));
        cam.quaternion.copy(q);
        cam.fov = ride.mode === 'cockpit' ? 64 : 58;
        // Rütteln auf der Bahn
        if (ac.z < 0.03 && (ac.phase === P.TKOF || ac.phase === P.ROLL)) {
          const sh = Math.min(0.004, ac.spd * 0.0015);
          cam.position.add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
        }
      } else {
        const d = (u.L * SIZE * 2.4) / (ride.zoomK || 1);
        const dir = ac.hdg + Math.PI + yaw;
        const el = Math.max(2, ride.pitch || 14) * DEG;
        const p = g.position;
        cam.position.set(p.x + Math.cos(dir) * Math.cos(el) * d, Math.max(0.15, p.y + Math.sin(el) * d), p.z + Math.sin(dir) * Math.cos(el) * d);
        cam.up.set(0, 1, 0);
        cam.lookAt(p.x, p.y, p.z);
        cam.fov = 55;
      }
      cam.updateProjectionMatrix();
    }
    // Sicht wächst mit der Höhe
    const camY = Math.max(0, cam.position.y);
    this.scene.fog.near = 90 + camY * 2;
    this.scene.fog.far = 900 + camY * 14;
    this.dome.position.copy(cam.position);
    // Schatten folgen dem Flugzeug
    const c = rec ? rec.g.position : cam.position;
    this.sun.target.position.set(c.x, 0, c.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(elev > -1 ? sunDir : new THREE.Vector3(0.3, 1, 0.2).normalize(), 160);
    this.sun.target.updateMatrixWorld();
    this.sun.castShadow = elev > 2 && camY < 60;
    this.renderer.render(this.scene, cam);
    return ac;
  }
}

// Bedienoberfläche: Leiste mit Modus, Anzeige, Cockpitrahmen mit Instrumenten; Ziehen dreht, Mausrad zoomt
export class HubRide {
  constructor(ui) {
    this.ui = ui;
    this.on = false;
    this.yaw = 0;
    this.pitch = 0;
    this.zoomK = 1;
    const el = (this.el = document.createElement('div'));
    el.className = 'hb-ride hidden';
    el.innerHTML = `<div class="hr-drag"></div><div class="hr-winbox"><div class="hr-win"></div></div>
      <div class="hr-cockpit"><i class="hr-pl l"></i><i class="hr-pl r"></i><div class="hr-glare"><div class="hr-pfd"><span><small>KT</small><b data-r="spd">0</b></span><span class="hr-fma" data-r="fma"></span><span><small>FT</small><b data-r="alt">0</b></span><span><small>HDG</small><b data-r="hdg">000</b></span></div></div></div>
      <div class="hr-bar"><span class="hr-modes"><button data-hr="cockpit">✈️ ${T('Cockpit')}</button><button data-hr="window">🪟 ${T('Fenster')}</button><button data-hr="chase">🎥 ${T('3D außen')}</button></span><span class="hr-t"></span><button class="hr-x" data-hr="x" title="${T('Aussteigen (Esc)')}">✕</button></div>
      <div class="hr-load">${T('3D-Ansicht wird geladen …')}</div>`;
    ui.el.appendChild(el);
    this.tEl = el.querySelector('.hr-t');
    this.R = Object.fromEntries([...el.querySelectorAll('[data-r]')].map((x) => [x.dataset.r, x]));
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-hr]');
      if (!b) return;
      if (b.dataset.hr === 'x') this.stop();
      else this.setMode(b.dataset.hr);
    });
    const drag = el.querySelector('.hr-drag');
    let last = null;
    drag.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY };
      drag.setPointerCapture && drag.setPointerCapture(e.pointerId);
    });
    drag.addEventListener('pointermove', (e) => {
      if (!last) return;
      this.yaw += (e.clientX - last.x) * (this.mode === 'chase' ? 0.3 : 0.2);
      this.pitch = this.mode === 'chase' ? clamp(this.pitch + (e.clientY - last.y) * 0.25, 2, 85) : clamp(this.pitch + (e.clientY - last.y) * 0.15, -30, 50);
      last = { x: e.clientX, y: e.clientY };
    });
    const up = () => (last = null);
    drag.addEventListener('pointerup', up);
    drag.addEventListener('pointercancel', up);
    drag.addEventListener('dblclick', () => this.setMode(this.mode));
    drag.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomK = clamp(this.zoomK * Math.exp(-e.deltaY * 0.0012), 0.35, 3);
    }, { passive: false });
  }
  setMode(m) {
    this.mode = m;
    this.yaw = 0;
    this.pitch = m === 'chase' ? 14 : 0;
    this.zoomK = 1;
    this.el.classList.toggle('cockpit', m === 'cockpit');
    this.el.classList.toggle('window', m === 'window');
    for (const b of this.el.querySelectorAll('[data-hr]')) b.classList.toggle('on', b.dataset.hr === m);
  }
  async start(id, mode) {
    const ac = this.ui.sim.acs.find((a) => a.id === id);
    if (!ac) return;
    this.id = id;
    this.arrived = 0;
    this.wasArr = ac.kind === 'arr';
    this.on = true;
    this.setMode(mode);
    this.el.classList.remove('hidden');
    this.ui.el.classList.add('hb-riding');
    if (!this.v3d) {
      this.el.classList.add('loading');
      try {
        if (!HubView3D.supported()) throw new Error('WebGL');
        this.v3d = new HubView3D(this.el, this.ui.ap);
      } catch (e) {
        console.error('3D', e);
        this.ui.toast(T('3D-Ansicht konnte nicht starten – bitte die Seite neu laden (Strg+Umschalt+R)'), 'bad', 6000);
        this.stop();
        return;
      }
      this.el.classList.remove('loading');
    }
    this.resize();
  }
  resize() {
    if (!this.v3d) return;
    const r = this.ui.el.getBoundingClientRect();
    const side = r.width < 761 || this.ui.el.classList.contains('noside') ? 0 : this.ui.el.querySelector('.hb-side').getBoundingClientRect().width + 8;
    this.v3d.resize(r.width - side, r.height);
  }
  stop() {
    this.on = false;
    this.el.classList.add('hidden');
    this.ui.el.classList.remove('hb-riding');
  }
  frame() {
    if (!this.on || !this.v3d) return;
    const ui = this.ui, sim = ui.sim, rd = ui.renderer;
    const list = rd.gse.list();
    const ps = rd.pState;
    ps.time = sim.t;
    ps.acs.length = 0;
    for (const v of list) {
      const a = v.job && v.type === 'tug' && sim.byId && sim.byId.get(v.job.ac);
      if (a) ps.acs.push({ id: a.id, type: a.type, len: (AC_TYPES[a.type] || AC_TYPES.A320).len });
    }
    const ac = this.v3d.render(sim, this, (a) => rd.adapter(a), list, ps);
    if (!ac) {
      ui.toast(this.wasArr ? T('Ausgestiegen') : T('✈️ Gute Reise! Das Flugzeug hat den Flughafen verlassen.'), 'info', 2600);
      return this.stop();
    }
    // angekommen: kurz an der Position stehen, dann aussteigen
    if (this.wasArr && ac.phase === P.STAND) {
      this.arrived += 1 / 60;
      if (this.arrived > 5) {
        ui.toast(T`Willkommen in ${ui.ap.name}! Ausgestiegen.`, 'good', 2600);
        return this.stop();
      }
    }
    const kt = Math.round(ac.spd * KT), alt = Math.round((ac.z * FT) / 10) * 10;
    const hdg = Math.round(((ac.hdg * 180) / Math.PI + 90 + 360) % 360);
    const phase = ui.phaseText(ac);
    const where = `<b>${ac.cs}</b> · ${ac.tt ? ac.tt.name : ac.type}`;
    const seat = this.mode === 'window' ? T`Platz ${12 + (ac.id * 7) % 18}F` : this.mode === 'chase' ? T('Außenkamera') : T('Cockpit');
    const txt = `${seat} · ${where} · ${phase}${alt > 0 ? ` · ${alt.toLocaleString()} ft` : ''} · ${kt} kt`;
    if (this.tEl.innerHTML !== txt) this.tEl.innerHTML = txt;
    if (this.mode === 'cockpit') {
      this.R.spd.textContent = kt;
      this.R.alt.textContent = alt;
      this.R.hdg.textContent = String(hdg).padStart(3, '0');
      this.R.fma.textContent = { [P.FIN]: ac.z < 0.25 ? 'FLARE' : 'LAND', [P.APP]: 'APP', [P.ROLL]: 'ROLLOUT', [P.TKOF]: ac.z > 0.05 ? 'SRS' : 'TOGA', [P.CLIMB]: 'CLB', [P.GA]: 'GA', [P.LINED]: 'LINED UP', [P.LINEUP]: 'LINE UP', [P.HOLD]: 'HOLD SHORT', [P.TAXI_IN]: 'TAXI', [P.TAXI_OUT]: 'TAXI', [P.PUSH]: 'PUSH', [P.START]: 'ENG START', [P.STAND]: 'PARK' }[ac.phase] || '';
    }
  }
}
