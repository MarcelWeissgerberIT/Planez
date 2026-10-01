// Echte 3D-Ansicht (WebGL, three.js) für das Mitfliegen: Der Flughafen als 3D-Szene – Gras, Start- und Landebahnen
// mit Markierungen, Rollwege, Vorfeld, Terminal, Tower und die übrigen Gebäude, Bäume –, darauf alle Flugzeuge als
// Modelle in Airline-Farben und die Bodenfahrzeuge. Die Kamera hängt am gewählten Flugzeug: Cockpit (Blick voraus),
// Fensterplatz (Blick über die rechte Tragfläche) oder außen (frei um das Flugzeug kreisen). Blickrichtung, Neigung
// und Abstand kommen aus der Mitflug-Steuerung (Ziehen, Mausrad). 1 Einheit = 1 Kachel (20 m), y = Höhe.
import * as THREE from '../vendor/three.module.min.js';
import * as LY from '../layout.js';
import { AC_TYPES, AIRLINES, VEH_TYPES } from '../config.js';
import { PH } from '../sim/aircraft.js';

const ALT = 7.6; // Spielhöhe z -> Kacheln (z 1 ≈ 500 ft ≈ 152 m)
const FT = 0.3048 / 20; // Fuß -> Kacheln
const DEG = Math.PI / 180;

export class View3D {
  static supported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) {
      return false;
    }
  }

  constructor(game) {
    this.game = game;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.domElement.id = 'view3d';
    r.domElement.className = 'hidden';
    document.getElementById('game').appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.02, 9000);
    this.scene.fog = new THREE.Fog(0xcfdbe2, 60, 420);
    this.hemi = new THREE.HemisphereLight(0xdbeafe, 0x4d5d2a, 1.1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-60, 90, -40);
    this.scene.add(this.hemi, this.sun);
    this.mats = new Map();
    this.acs = new Map();
    this.vehs = new Map();
    this.built = false;
    this.rwy2 = false;
    window.addEventListener('resize', () => this.resize());
  }

  mat(color, opts = {}) {
    const k = color + JSON.stringify(opts);
    if (!this.mats.has(k)) this.mats.set(k, new THREE.MeshLambertMaterial({ color, ...opts }));
    return this.mats.get(k);
  }

  show() {
    this.renderer.domElement.classList.remove('hidden');
    this.resize();
  }
  hide() {
    this.renderer.domElement.classList.add('hidden');
  }
  resize() {
    const el = document.getElementById('game');
    const w = el.clientWidth, h = el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ---------- statische Szene ----------
  box(x0, x1, y0, y1, h, color, yBase = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, y1 - y0), this.mat(color));
    m.position.set((x0 + x1) / 2, yBase + h / 2, (y0 + y1) / 2);
    this.static.add(m);
    return m;
  }
  flat(x0, x1, y0, y1, color, lift = 0.005) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), this.mat(color));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, lift, (y0 + y1) / 2);
    this.static.add(m);
    return m;
  }

  runway(R, rwyNames) {
    this.flat(R.x0, R.x1, R.y - R.hw, R.y + R.hw, 0x3a3d42, 0.01);
    // Mittellinie und Randmarkierung
    for (let x = R.x0 + 4; x < R.x1 - 4; x += 1.6) this.flat(x, x + 0.8, R.y - 0.04, R.y + 0.04, 0xf1f5f9, 0.012);
    this.flat(R.x0, R.x1, R.y - R.hw + 0.06, R.y - R.hw + 0.12, 0xe5e7eb, 0.012);
    this.flat(R.x0, R.x1, R.y + R.hw - 0.12, R.y + R.hw - 0.06, 0xe5e7eb, 0.012);
    // Schwellen („Klaviertasten“) und Aufsetzzonen
    for (const xs of [R.x0 + 0.4, R.x1 - 1.6]) for (let k = -4; k <= 4; k++) if (k) this.flat(xs, xs + 1.2, R.y + k * 0.24 - 0.07, R.y + k * 0.24 + 0.07, 0xf8fafc, 0.012);
    for (const xs of [R.x0 + 4, R.x1 - 5.2]) for (const s of [-1, 1]) this.flat(xs, xs + 1.2, R.y + s * 0.5 - 0.1, R.y + s * 0.5 + 0.1, 0xf8fafc, 0.012);
    // Randbefeuerung (nachts sichtbar)
    const pts = [];
    for (let x = R.x0; x <= R.x1; x += 1.5) pts.push(x, 0.06, R.y - R.hw, x, 0.06, R.y + R.hw);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lights = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff2c4, size: 0.22, sizeAttenuation: true, fog: true }));
    this.static.add(lights);
    this.nightLights.push(lights);
  }

  build(state) {
    if (this.static) this.scene.remove(this.static);
    this.static = new THREE.Group();
    this.nightLights = [];
    this.scene.add(this.static);
    // Gras weit bis zum Horizont
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), this.mat(0x6f8f3c));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(LY.W / 2, 0, LY.H / 2);
    this.static.add(ground);
    this.landscape();
    // Vorfeld und Rollwege
    this.flat(LY.TERMINAL.x0 - 2, 77, LY.TERMINAL.y1, LY.LANE + 0.6, 0xb9bcbf, 0.006);
    this.flat(LY.TERMINAL.x0 - 2, 77, LY.SERVICE - 0.5, LY.TERMINAL.y1, 0x9fa3a7, 0.007);
    this.flat(LY.RWY.x0, LY.RWY.x1, LY.TWY_A - 0.45, LY.TWY_A + 0.45, 0x4b4f55, 0.008);
    for (let x = LY.RWY.x0; x < LY.RWY.x1; x += 1.4) this.flat(x, x + 0.7, LY.TWY_A - 0.03, LY.TWY_A + 0.03, 0xfacc15, 0.01);
    for (const x of LY.EXITS) this.flat(x - 0.45, x + 0.45, LY.TWY_A, LY.RWY.y - LY.RWY.hw, 0x4b4f55, 0.008);
    for (const x of LY.CONN) this.flat(x - 0.45, x + 0.45, LY.LANE, LY.TWY_A, 0x4b4f55, 0.008);
    // Parkpositionen: gelbe Leitlinien
    for (const st of state.stands) if (st.built) this.flat(st.x - 0.03, st.x + 0.03, LY.STAND_NOSE, LY.LANE, 0xfacc15, 0.009);
    this.runway(LY.RWY);
    this.rwy2 = !!(state.upgrades && state.upgrades.rwy2);
    if (this.rwy2) {
      this.runway(LY.RWY_S);
      this.flat(LY.RWY_S.x0, LY.RWY_S.x1, LY.TWY_B - 0.45, LY.TWY_B + 0.45, 0x4b4f55, 0.008);
    }
    // Terminal: Glasfassade, helles Dach
    const T = LY.TERMINAL;
    this.box(T.x0, T.x1, T.y0, T.y1, 1.0, 0x5b87b0);
    this.box(T.x0 - 0.1, T.x1 + 0.1, T.y0 - 0.1, T.y1 + 0.1, 0.08, 0xd9dee4, 1.0);
    for (let x = T.x0 + 0.5; x < T.x1; x += 1.2) this.box(x, x + 0.06, T.y1, T.y1 + 0.02, 1.0, 0xcbd5e1);
    // Fluggastbrücken an Kontaktpositionen
    for (const st of state.stands) if (st.built && st.kind === 'contact') this.box(st.x - 1.55, st.x - 1.2, T.y1, LY.STAND_NOSE + 0.3, 0.16, 0xc7ccd1, 0.25);
    // übrige Gebäude
    const H = { hall: 1.4, hangar: 1.4, cargo: 0.9, depot: 0.6, fire: 0.55, fuel: 0.5, parking: 0.8, hotel: 2.2, radar: 0.2 };
    const C = { hall: 0xd6dde5, hangar: 0xaab3bc, cargo: 0x8d9aa7, depot: 0x9ca3af, fire: 0xb91c1c, fuel: 0xe5e7eb, parking: 0x9aa0a6, hotel: 0xe2e8f0, radar: 0x94a3b8 };
    for (const b of LY.BUILDINGS) {
      if (b.requires && !(state.upgrades && state.upgrades[b.requires])) continue;
      const cx = b.fx - b.w / 2, cy = b.fy - b.d / 2;
      if (b.id === 'tower') {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.2, 12), this.mat(0xe5e7eb));
        shaft.position.set(cx, 1.6, cy);
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.65, 0.45, 12), this.mat(0x24425c));
        cab.position.set(cx, 3.42, cy);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 12), this.mat(0xf1f5f9));
        roof.position.set(cx, 3.68, cy);
        this.static.add(shaft, cab, roof);
        continue;
      }
      if (b.id === 'fuel') {
        for (const [dx, dy] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 14), this.mat(0xe5e7eb));
          t.position.set(cx + dx, 0.25, cy + dy);
          this.static.add(t);
        }
        continue;
      }
      this.box(cx - b.w / 2, cx + b.w / 2, cy - b.d / 2, cy + b.d / 2, H[b.id] || 0.6, C[b.id] || 0xa1a1aa);
    }
    // Bäume (wie auf der Karte)
    const trees = (this.game.map && this.game.map.trees) || LY.makeTrees();
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 1.1, 7), this.mat(0x2f5d2a), trees.length);
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => {
      const s = t.s || 1;
      m.makeScale(s, s, s);
      m.setPosition(t.x, 0.55 * s, t.y);
      crown.setMatrixAt(i, m);
    });
    this.static.add(crown);
    this.built = true;
  }

  // Umland: Felder in Grün-, Gelb- und Brauntönen, Waldstücke, eine Stadt im Norden, Straßen – fest gesät,
  // damit es bei jedem Besuch gleich aussieht
  landscape() {
    let seed = 987654;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const COLS = [0x7a9a45, 0x8fae4f, 0xa8a24a, 0x6d8a3a, 0x9c8a55, 0x5f7f34, 0xb5ad62];
    const fields = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 900; i++) {
      const ang = r() * Math.PI * 2, dist = 70 + Math.pow(r(), 0.7) * 2600;
      const x = LY.W / 2 + Math.cos(ang) * dist, y = LY.H / 2 + Math.sin(ang) * dist;
      // Anflugschneise und Flughafengelände frei lassen
      if (Math.abs(y - LY.RWY.y) < 12 && Math.abs(x - LY.W / 2) < 160) continue;
      const w = 8 + r() * 40, h = 8 + r() * 30;
      const m = new THREE.Mesh(geo, this.mat(COLS[Math.floor(r() * COLS.length)]));
      m.scale.set(w, h, 1);
      m.rotation.set(-Math.PI / 2, 0, Math.floor(r() * 4) * 0.1);
      m.position.set(x, 0.002, y);
      fields.add(m);
    }
    this.static.add(fields);
    // Wälder
    const n = 2500;
    const forest = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 3.2, 6), this.mat(0x2d5427), n);
    const mx = new THREE.Matrix4();
    let k = 0;
    for (let c = 0; c < 40 && k < n; c++) {
      const ang = r() * Math.PI * 2, dist = 140 + r() * 1800;
      const cx = LY.W / 2 + Math.cos(ang) * dist, cy = LY.H / 2 + Math.sin(ang) * dist;
      if (Math.abs(cy - LY.RWY.y) < 20 && Math.abs(cx - LY.W / 2) < 260) continue;
      for (let i = 0; i < 60 && k < n; i++) {
        const s = 0.7 + r() * 0.8;
        mx.makeScale(s, s, s);
        mx.setPosition(cx + (r() - 0.5) * 50, 1.6 * s, cy + (r() - 0.5) * 35);
        forest.setMatrixAt(k++, mx);
      }
    }
    forest.count = k;
    this.static.add(forest);
    // Stadt im Norden: Häuserblocks, in der Mitte höher
    const town = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mat(0xd4cfc6), 700);
    const roofs = [0xb45309, 0x9ca3af, 0x7c2d12];
    let t = 0;
    const TX = LY.W / 2 - 40, TY = -160;
    for (let i = 0; i < 700; i++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * 90;
      const x = TX + Math.cos(a) * d, y = TY + Math.sin(a) * d * 0.7;
      const h = (1 + r() * 2) * (d < 25 ? 3 + r() * 5 : 1);
      mx.makeScale(2 + r() * 3, h, 2 + r() * 3);
      mx.setPosition(x, h / 2, y);
      town.setMatrixAt(t++, mx);
    }
    this.static.add(town);
    // Straßen zur Stadt und um den Platz
    this.flat(LY.W / 2 - 41, LY.W / 2 - 39, TY, 0, 0x55595e, 0.004);
    this.flat(-400, 480, -6, -4.5, 0x55595e, 0.004);
    void roofs;
  }

  // Wolken (bei Bewölkung, Regen, Gewitter): weiche Haufen in 1.200–2.400 m Höhe
  clouds(kind) {
    if (this.cloudKind === kind) return;
    this.cloudKind = kind;
    if (this.cloudGroup) this.scene.remove(this.cloudGroup);
    const n = { clouds: 70, rain: 110, storm: 130, snow: 100 }[kind] || (kind === 'clear' ? 14 : 0);
    if (!n) return;
    let seed = 4242;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: kind === 'storm' ? 0x8a929c : kind === 'rain' ? 0xc5ccd3 : 0xf8fafc, transparent: true, opacity: 0.88 });
    const sph = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < n; i++) {
      const cx = LY.W / 2 + (r() - 0.5) * 2400, cy = LY.H / 2 + (r() - 0.5) * 2400, alt = 60 + r() * 60;
      for (let j = 0; j < 5; j++) {
        const m = new THREE.Mesh(sph, mat);
        const s = 10 + r() * 14;
        m.scale.set(s * 1.6, s * 0.6, s);
        m.position.set(cx + (r() - 0.5) * 30, alt + r() * 6, cy + (r() - 0.5) * 20);
        g.add(m);
      }
    }
    this.cloudGroup = g;
    this.scene.add(g);
  }

  // ---------- Flugzeugmodell ----------
  aircraft(ac) {
    const t = AC_TYPES[ac.type] || AC_TYPES.A320;
    const al = AIRLINES[ac.airline] || {};
    const L = t.len;
    const R = L * 0.055;
    const g = new THREE.Group();
    const body = this.mat(0xf1f5f9);
    const tail = this.mat(al.color || '#1d4ed8');
    const dark = this.mat(0x475569);
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L * 0.78, 14), body);
    fus.rotation.z = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(R, 14, 10), body);
    nose.scale.set(1.7, 1, 1);
    nose.position.x = L * 0.39;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(R, L * 0.2, 14), body);
    cone.rotation.z = Math.PI / 2;
    cone.position.x = -L * 0.49;
    // Cockpitfenster und Fensterband
    const wind = new THREE.Mesh(new THREE.BoxGeometry(R * 0.6, R * 0.35, R * 1.3), this.mat(0x0f172a));
    wind.position.set(L * 0.43, R * 0.45, 0);
    const band = new THREE.Mesh(new THREE.BoxGeometry(L * 0.62, R * 0.16, R * 2.04), this.mat(0x1e293b));
    band.position.set(0, R * 0.25, 0);
    // Tragflächen mit Pfeilung
    const high = t.sprite === 'plane_prop';
    const wy = high ? R * 0.85 : -R * 0.35;
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(L * 0.17, R * 0.18, L * 0.5), body);
      w.position.set(-L * 0.04 - (high ? 0 : L * 0.05), wy, s * L * 0.25);
      w.rotation.y = s * (high ? 0.04 : 0.42);
      const hs = new THREE.Mesh(new THREE.BoxGeometry(L * 0.09, R * 0.12, L * 0.17), body);
      hs.position.set(-L * 0.45, R * 0.3, s * L * 0.085);
      hs.rotation.y = s * 0.45;
      g.add(w, hs);
      // Triebwerke
      const n = t.sprite === 'plane_super' || ac.type === 'B748F' ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const off = n === 2 ? (k ? 0.36 : 0.18) : high ? 0.17 : 0.19;
        const e = new THREE.Mesh(high ? new THREE.CylinderGeometry(R * 0.32, R * 0.32, L * 0.12, 10) : new THREE.CylinderGeometry(R * 0.48, R * 0.42, L * 0.13, 12), dark);
        e.rotation.z = Math.PI / 2;
        e.position.set(L * 0.06 - (n === 2 && k ? L * 0.05 : 0), high ? wy + R * 0.05 : wy - R * 0.55, s * L * off);
        g.add(e);
        if (high) {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.09, L * 0.09, 0.005, 16), this.mat(0x94a3b8, { transparent: true, opacity: 0.35 }));
          p.rotation.z = Math.PI / 2;
          p.position.set(L * 0.13, wy + R * 0.05, s * L * off);
          g.add(p);
        }
      }
    }
    // Seitenleitwerk in Airline-Farbe
    const fin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.16, L * 0.17, R * 0.22), tail);
    fin.position.set(-L * 0.43, R + L * 0.075, 0);
    fin.rotation.z = 0.35;
    g.add(fus, nose, cone, wind, band, fin);
    // Fahrwerk
    const gear = new THREE.Group();
    for (const [x, z] of [[L * 0.33, 0], [-L * 0.03, R * 1.1], [-L * 0.03, -R * 1.1]]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(R * 0.5, R * 0.6, R * 0.35), this.mat(0x111827));
      w.position.set(x, -R - R * 0.4, z);
      gear.add(w);
    }
    g.add(gear);
    g.userData = { R, L, gear, h: R + R * 0.7 };
    // Positionslichter (nachts sichtbar)
    const lt = (c, x, y, z) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(R * 0.18, 6, 4), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    lt(0xff2020, -L * 0.1, wy, -L * 0.5);
    lt(0x20ff60, -L * 0.1, wy, L * 0.5);
    g.userData.beacon = lt(0xff3b30, 0, R * 1.05, 0);
    this.scene.add(g);
    return g;
  }

  vehicle(v) {
    const vt = VEH_TYPES[v.type] || {};
    const L = vt.len || 0.4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, 0.13, 0.17), this.mat(vt.color || '#facc15'));
    this.scene.add(m);
    return m;
  }

  // Position eines Flugzeugs in der Szene (auch im Anflug außerhalb der Karte)
  pose(ac) {
    if (ac.mode === 'map') return { x: ac.x, y: (ac.z || 0) * ALT, z: ac.y, hdg: ac.hdg };
    const p = LY.nmToTile(ac.pos.x, ac.pos.y);
    // Kurs (Grad, Nord = 0) -> Kartenwinkel
    return { x: p.x, y: (ac.alt || 0) * FT, z: p.y, hdg: ((ac.crs || 0) - 90) * DEG };
  }

  // ---------- jeden Frame ----------
  render(state, ride, follow) {
    if (!this.built || this.rwy2 !== !!(state.upgrades && state.upgrades.rwy2)) this.build(state);
    const now = performance.now() / 1000;
    // Tageszeit: Himmel, Licht, Nebel
    const hr = ((state.time / 3600) % 24 + 24) % 24;
    const day = hr < 5 || hr > 22 ? 0 : hr < 7 ? (hr - 5) / 2 : hr > 20 ? (22 - hr) / 2 : 1;
    const wx = state.weather.kind;
    const murk = wx === 'fog' ? 0.75 : wx === 'storm' ? 0.5 : wx === 'rain' || wx === 'snow' ? 0.35 : wx === 'clouds' ? 0.15 : 0;
    const sky = new THREE.Color().setHSL(0.58, 0.55 * (1 - murk), 0.08 + 0.62 * day * (1 - murk * 0.4));
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    // Sichtweite wächst mit der Flughöhe (aus 10.000 ft sieht man weit)
    const camY = Math.max(0, this.camera.position.y);
    this.scene.fog.near = (wx === 'fog' ? 4 : 60 - murk * 40) + camY * 2;
    this.scene.fog.far = (wx === 'fog' ? 40 : 520 - murk * 300) + camY * (wx === 'fog' ? 2 : 14);
    this.hemi.intensity = 0.25 + 0.95 * day;
    this.sun.intensity = 0.1 + 1.6 * day * (1 - murk * 0.7);
    for (const p of this.nightLights) p.visible = day < 0.6 || wx === 'fog';
    this.clouds(wx);
    // Flugzeuge
    const seen = new Set();
    for (const ac of state.acs) {
      const vis = ac.mode === 'map' || (ac.id === ride.id && ac.mode === 'air');
      if (!vis) continue;
      seen.add(ac.id);
      let g = this.acs.get(ac.id);
      if (!g) this.acs.set(ac.id, (g = this.aircraft(ac)));
      const p = this.pose(ac);
      const u = g.userData;
      g.position.set(p.x, p.y + u.h, p.z);
      // Nase hoch beim Abheben und Steigen, leicht hoch im Abfangbogen
      const pitch = ac.phase === PH.TAKEOFF && (ac.z || 0) > 0.01 ? 0.16 : ac.phase === PH.MISSED || ac.phase === PH.DEPART ? 0.12 : ac.phase === PH.FINAL ? ((ac.z || 0) < 0.12 ? 0.08 : 0.03) : 0;
      g.rotation.set(0, -p.hdg, pitch, 'YXZ');
      u.gear.visible = (ac.z || 0) < 1.2 || ac.mode === 'map';
      u.beacon.visible = Math.floor(now * 1.3 + ac.id.length) % 2 === 0;
      g.visible = !(ride.mode === 'cockpit' && ac.id === ride.id);
    }
    for (const [id, g] of this.acs) if (!seen.has(id)) (this.scene.remove(g), this.acs.delete(id));
    // Fahrzeuge
    const vs = new Set();
    for (const v of state.vehicles) {
      vs.add(v.id);
      let m = this.vehs.get(v.id);
      if (!m) this.vehs.set(v.id, (m = this.vehicle(v)));
      m.position.set(v.x, 0.08, v.y);
      m.rotation.y = -(v.hdg || 0);
    }
    for (const [id, m] of this.vehs) if (!vs.has(id)) (this.scene.remove(m), this.vehs.delete(id));
    // Kamera am Flugzeug
    const ac = follow;
    if (ac) {
      const p = this.pose(ac);
      const g = this.acs.get(ac.id);
      const u = g ? g.userData : { L: 2.4, R: 0.13, h: 0.2 };
      const fx = Math.cos(p.hdg), fz = Math.sin(p.hdg), rx = -fz, rz = fx;
      const base = p.y + u.h;
      const cam = this.camera;
      const yaw = (ride.yaw || 0) * DEG, pit = (ride.pitch || 0) * DEG;
      if (ride.mode === 'cockpit') {
        cam.position.set(p.x + fx * u.L * 0.4, base + u.R * 0.55, p.z + fz * u.L * 0.4);
        const dir = p.hdg + yaw;
        cam.lookAt(cam.position.x + Math.cos(dir) * 10, cam.position.y - Math.tan(pit) * 10, cam.position.z + Math.sin(dir) * 10);
        cam.fov = 64;
      } else if (ride.mode === 'window') {
        // Fensterplatz hinter der Tragfläche, knapp an der Bordwand: Flügel unten im Bild, darüber Boden und Horizont
        cam.position.set(p.x + rx * u.R * 1.12 - fx * u.L * 0.2, base + u.R * 0.55, p.z + rz * u.R * 1.12 - fz * u.L * 0.2);
        const dir = p.hdg + yaw;
        cam.lookAt(cam.position.x + Math.cos(dir) * 10, cam.position.y - Math.tan(pit) * 10, cam.position.z + Math.sin(dir) * 10);
        cam.fov = 58;
      } else {
        const d = (u.L * 2.6) / (ride.zoomK || 1);
        const dir = p.hdg + Math.PI + yaw;
        const el = Math.max(2, ride.pitch || 16) * DEG;
        cam.position.set(p.x + Math.cos(dir) * Math.cos(el) * d, Math.max(0.15, base + Math.sin(el) * d), p.z + Math.sin(dir) * Math.cos(el) * d);
        cam.lookAt(p.x, base, p.z);
        cam.fov = 55;
      }
      cam.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
