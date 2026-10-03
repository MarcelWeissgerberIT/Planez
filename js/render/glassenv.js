// Glas: eine gemeinsame Spiegelungs-Umgebung (Panorama: Himmel mit Wolken und Sonne, Baumreihe und Hallen am Horizont,
// Vorfeld darunter). Scheiben spiegeln sie je nach Blickwinkel – schräge Frontscheiben den hellen Himmel, Seitenfenster
// Horizont und Boden. three.js wandelt das Panorama für Phong/Lambert selbst in eine Würfeltextur um.
import * as THREE from '../vendor/three.module.min.js';

let ENV = null;
export function glassEnv() {
  if (ENV) return ENV;
  const W = 512, H = 256, c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const hz = H / 2; // Horizont
  // Himmel: Zenit kräftig blau, zum Horizont dunstig hell
  let gr = g.createLinearGradient(0, 0, 0, hz);
  gr.addColorStop(0, '#5f8cc4');
  gr.addColorStop(0.55, '#9dbddd');
  gr.addColorStop(1, '#e3edf5');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, hz);
  // Wolken: weiche helle Flecken im mittleren Himmel
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = hz * (0.25 + r() * 0.55), rx = 14 + r() * 36, ry = 5 + r() * 9;
    const cg = g.createRadialGradient(x, y, 0, x, y, rx);
    cg.addColorStop(0, 'rgba(255,255,255,0.75)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg;
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.translate(-x, -y);
    g.fillRect(x - rx, y - rx, rx * 2, rx * 2);
    g.restore();
  }
  // Sonne (sorgt für Glanzpunkte)
  const sx = W * 0.32, sy = hz * 0.42, sg = g.createRadialGradient(sx, sy, 0, sx, sy, 26);
  sg.addColorStop(0, 'rgba(255,253,240,1)');
  sg.addColorStop(0.25, 'rgba(255,248,225,0.85)');
  sg.addColorStop(1, 'rgba(255,248,225,0)');
  g.fillStyle = sg;
  g.fillRect(sx - 26, sy - 26, 52, 52);
  // Horizont: Baumreihe und flache Hallen als dunkle Silhouette
  g.fillStyle = '#56645a';
  for (let x = 0; x < W; x += 3) {
    const h = 3 + Math.abs(Math.sin(x * 0.07) * 4) + (r() < 0.1 ? 3 : 0);
    g.fillRect(x, hz - h, 3, h);
  }
  g.fillStyle = '#7b8590';
  for (let i = 0; i < 7; i++) {
    const x = r() * W, w = 20 + r() * 40, h = 4 + r() * 5;
    g.fillRect(x, hz - h, w, h);
  }
  // Boden: Vorfeld grau, zum Nadir dunkler
  gr = g.createLinearGradient(0, hz, 0, H);
  gr.addColorStop(0, '#9a9c9a');
  gr.addColorStop(0.3, '#6c6f71');
  gr.addColorStop(1, '#2f3236');
  g.fillStyle = gr;
  g.fillRect(0, hz, W, H - hz);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return (ENV = t);
}

// spiegelnde Materialien mit ihrer Tagesstärke; nachts spiegeln sie kaum (sonst leuchtet der Taghimmel in der Scheibe)
const REFL = [];
export function reflective(m) {
  m.userData.refl = m.reflectivity;
  REFL.push(m);
  return m;
}
export function setReflNight(k) {
  for (const m of REFL) m.reflectivity = m.userData.refl * (1 - 0.85 * k);
}

// Glastextur je Scheibe (UV 0..1 über die Scheibe): Tönung oben heller, unten dunkler, zwei schräge Lichtstreifen und
// der schwarze Siebdruckrand an den Kanten wie bei echten Fahrzeugscheiben
let GTEX = null;
export function glassTex() {
  if (GTEX) return GTEX;
  const N = 128, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  // Tönung: oben spiegelt der Himmel (hell, bläulich), zur Mitte dunkler, unten fast schwarz
  const gr = g.createLinearGradient(0, 0, 0, N);
  gr.addColorStop(0, '#7f9fbd');
  gr.addColorStop(0.16, '#42607c');
  gr.addColorStop(0.5, '#1a2938');
  gr.addColorStop(1, '#060a0f');
  g.fillStyle = gr;
  g.fillRect(0, 0, N, N);
  // Lichtstreifen von links unten nach rechts oben: ein breiter, ein schmaler, deutlich sichtbar
  for (const [o, w, a] of [[0.36, 0.11, 0.55], [0.55, 0.035, 0.45], [0.62, 0.02, 0.25]]) {
    const lg = g.createLinearGradient(0, N, N, 0);
    lg.addColorStop(Math.max(0, o - w), 'rgba(235,245,255,0)');
    lg.addColorStop(o, `rgba(235,245,255,${a})`);
    lg.addColorStop(Math.min(1, o + w), 'rgba(235,245,255,0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, N, N);
  }
  // Siebdruckrand: schwarz, nach innen in Punkten auslaufend
  const b = 5;
  g.fillStyle = '#05080b';
  g.fillRect(0, 0, N, b);
  g.fillRect(0, N - b, N, b);
  g.fillRect(0, 0, b, N);
  g.fillRect(N - b, 0, b, N);
  for (let i = b + 1; i < N - b; i += 3)
    for (const [x, y] of [[i, b + 1], [i, N - b - 2], [b + 1, i], [N - b - 2, i]]) g.fillRect(x, y, 1.4, 1.4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (GTEX = t);
}

// getöntes Fahrzeug- und Autoglas: Glastextur, darüber die Spiegelung der Umgebung; plain = ohne Textur (gewölbte
// Kanzeln von Kleinflugzeugen und Hubschrauber, deren Texturkoordinaten rundherum laufen)
const GLASS = {};
export function glassMat(plain = false) {
  return (GLASS[plain] ||= reflective(new THREE.MeshPhongMaterial({ ...(plain ? { color: 0x101a24, side: THREE.DoubleSide } : { map: glassTex() }), specular: 0x7d91a8, shininess: 160, envMap: glassEnv(), combine: THREE.MixOperation, reflectivity: plain ? 0.34 : 0.28 })));
}
