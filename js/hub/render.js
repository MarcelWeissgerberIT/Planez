// Großflughäfen: isometrische Karte. Boden (Gras, Straßen, Vorfeld, Rollwege, Bahnen mit Markierungen) herausgezoomt
// aus einem vorberechneten Bild, nah heran als Vektorgrafik; Gebäude als Quader mit Fassaden, Flugzeuge als dieselben
// 3D-Modelle wie im Hauptspiel (render/acimp.js), dazu Beschriftungen, Haltebalken, aktive Bahnen und Nachtlichter.
import { Camera, HALF_W, HALF_H } from '../render/camera.js';
import { ZS, AIRLINES } from '../config.js';
import { IMG, glowTinted } from '../assets.js';
import { PH } from '../sim/aircraft.js';
import { PHASE as P } from './sim.js';
import { dist, polyCenter } from './geom.js';
import { T } from '../i18n.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const VEC_Z = 0.36; // ab diesem Zoom wird der Boden als Vektorgrafik gezeichnet

export class HubCam extends Camera {
  constructor(bounds) {
    super();
    this.b = bounds;
    this.minZoom = 0.045;
    this.maxZoom = 3.2;
  }
  zoomAt(f, sx, sy) {
    const before = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * f, this.minZoom, this.maxZoom);
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampPos();
  }
  clampPos() {
    const b = this.b, m = 260;
    this.x = clamp(this.x, b.x0 - m, b.x1 + m);
    this.y = clamp(this.y, b.y0 - m, b.y1 + m);
  }
  // ganzen Flughafen einpassen
  fit() {
    const b = this.b;
    const wIso = (b.x1 - b.x0 + b.y1 - b.y0) * HALF_W;
    const hIso = (b.x1 - b.x0 + b.y1 - b.y0) * HALF_H;
    this.zoom = clamp(Math.min(((this.w - (this.pad || 0)) * 0.96) / wIso, (this.h * 0.96) / hIso) * 1.25, this.minZoom, 1);
    this.x = (b.x0 + b.x1) / 2;
    this.y = (b.y0 + b.y1) / 2;
    if (this.pad) this.panBy(-this.pad / 2, 0);
  }
}

// Phase für die 3D-Modelle (Fahrwerk, Klappen, Störklappen) auf die Phasen des Hauptspiels abbilden
const PH_OF = {
  [P.APP]: PH.FINAL, [P.FIN]: PH.FINAL, [P.ROLL]: PH.ROLLOUT, [P.TAXI_IN]: PH.TAXI_IN, [P.STAND]: PH.STAND, [P.GA]: PH.MISSED,
  [P.PUSH]: PH.PUSH, [P.START]: PH.STARTUP, [P.TAXI_OUT]: PH.TAXI_OUT, [P.HOLD]: PH.HOLDING, [P.LINEUP]: PH.LINEUP, [P.LINED]: PH.LINED,
  [P.TKOF]: PH.TAKEOFF, [P.CLIMB]: PH.DEPART,
};

// Farben
const C = {
  grass: '#5f7f47',
  asphalt: '#3d4248',
  rwy: '#34383e',
  twy: '#454a51',
  twyEdge: '#5b6168',
  apron: '#9da2a8',
  road: '#596068',
  yellow: '#f2c230',
  white: '#eef2f5',
};
const BLD = {
  terminal: { roof: [196, 202, 208], wallA: [96, 130, 160], wallB: [70, 100, 130], glass: true },
  pier: { roof: [206, 210, 214], wallA: [110, 140, 168], wallB: [84, 112, 140], glass: true },
  hotel: { roof: [150, 150, 152], wallA: [214, 206, 190], wallB: [180, 172, 158], windows: true },
  hangar: { roof: [160, 168, 176], wallA: [196, 200, 204], wallB: [158, 164, 170] },
  cargo: { roof: [176, 170, 156], wallA: [208, 196, 170], wallB: [176, 164, 140] },
  garage: { roof: [128, 132, 138], wallA: [172, 174, 178], wallB: [142, 144, 150], stripes: true },
  fire: { roof: [150, 60, 54], wallA: [214, 206, 196], wallB: [182, 172, 160] },
  tank: { roof: [228, 230, 232], wallA: [210, 214, 218], wallB: [180, 186, 190], round: true },
  tower: { roof: [90, 96, 104], wallA: [214, 216, 218], wallB: [180, 184, 188], tower: true },
};
const rgb = (c, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;

let IMP = null, impLoad = null;
function loadImp() {
  if (!impLoad) impLoad = import('../render/acimp.js').then((m) => (IMP = m.ready() ? m : null)).catch(() => (IMP = null));
}

export class HubRenderer {
  constructor(canvas, ap, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ap = ap;
    this.sim = sim;
    this.cam = new HubCam(ap.bounds);
    this.time = 0;
    this.sel = null;
    this.view = null;
    this.items = [];
    this.adapt = new Map(); // Flugzeug-ID -> Objekt für die 3D-Modelle
    this.grassPat = null;
    this.lights = this.makeLights();
    loadImp();
  }
  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cam.w = w;
    this.cam.h = h;
    this.cam.dpr = dpr;
    this.dpr = dpr;
  }
  get zoom() {
    return this.cam.zoom;
  }
  // sichtbarer Weltausschnitt (achsenparallel, mit Rand)
  viewRect(m = 8) {
    const c = this.cam;
    const pts = [c.toWorld(0, 0), c.toWorld(c.w, 0), c.toWorld(c.w, c.h), c.toWorld(0, c.h)];
    return { x0: Math.min(...pts.map((p) => p.x)) - m, x1: Math.max(...pts.map((p) => p.x)) + m, y0: Math.min(...pts.map((p) => p.y)) - m, y1: Math.max(...pts.map((p) => p.y)) + m };
  }
  inView(x, y, m = 0) {
    const v = this.view;
    return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
  }

  // ------------------------------------------------------------ Boden
  pattern(g, img, tiles) {
    if (!img) return null;
    const p = g.createPattern(img, 'repeat');
    if (p && p.setTransform) p.setTransform(new DOMMatrix().scale(tiles / img.width));
    return p;
  }
  // Boden in Weltkoordinaten zeichnen (g hat die Iso-Transformation); detail: Markierungen fein; cull: Ausschnitt
  drawGround(g, detail, cull) {
    const ap = this.ap;
    const vis = (pts, m = 4) => {
      if (!cull) return true;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      return x1 > cull.x0 - m && x0 < cull.x1 + m && y1 > cull.y0 - m && y0 < cull.y1 + m;
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // Straßen
    for (const r of ap.roads) {
      if (!vis(r.pts)) continue;
      g.strokeStyle = C.road;
      g.lineWidth = r.w;
      g.beginPath();
      r.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      if (detail) {
        g.strokeStyle = 'rgba(240,240,230,.55)';
        g.lineWidth = 0.05;
        g.setLineDash([0.8, 0.8]);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // Vorfeld
    const conc = this.concPat || (this.concPat = this.pattern(g, IMG.tex_concrete, 6));
    for (const a of ap.aprons) {
      if (!vis(a)) continue;
      g.fillStyle = C.apron;
      g.beginPath();
      a.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fill();
      if (conc && detail) {
        g.globalAlpha = 0.35;
        g.fillStyle = conc;
        g.fill();
        g.globalAlpha = 1;
      }
    }
    // Rollwege: Rand, Fläche
    const lines = ap.lines.filter((l) => l.kind !== 'rwy' && l.kind !== 'lane' && vis(l.pts));
    g.strokeStyle = C.twyEdge;
    for (const l of lines) {
      g.lineWidth = (l.w || 1.25) + 0.45;
      g.beginPath();
      l.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    }
    g.strokeStyle = C.twy;
    for (const l of lines) {
      g.lineWidth = l.w || 1.25;
      g.beginPath();
      l.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    }
    // Bahnen
    for (const r of ap.runways) {
      if (!vis([r.a, r.b], 10)) continue;
      this.drawRunway(g, r, detail);
    }
    // Mittellinien gelb (Rollwege und Gassen)
    g.strokeStyle = C.yellow;
    g.lineWidth = detail ? 0.07 : 0.16;
    for (const l of ap.lines) {
      if (l.kind === 'rwy' || !vis(l.pts)) continue;
      g.globalAlpha = l.kind === 'lane' ? 0.8 : 0.95;
      g.beginPath();
      l.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    }
    g.globalAlpha = 1;
    // Positionen: Einfahrlinie, Stoppbalken, Nummer
    if (detail) {
      for (const st of ap.stands) {
        if (!vis([st], 6)) continue;
        const a = st.anchor;
        g.strokeStyle = C.yellow;
        g.lineWidth = 0.06;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(st.x + Math.cos(st.hdg) * 1.6, st.y + Math.sin(st.hdg) * 1.6);
        g.stroke();
        const nx = st.x + Math.cos(st.hdg) * (st.size === 'L' ? 2.3 : 1.6), ny = st.y + Math.sin(st.hdg) * (st.size === 'L' ? 2.3 : 1.6);
        g.lineWidth = 0.1;
        g.beginPath();
        g.moveTo(nx - Math.sin(st.hdg) * 0.45, ny + Math.cos(st.hdg) * 0.45);
        g.lineTo(nx + Math.sin(st.hdg) * 0.45, ny - Math.cos(st.hdg) * 0.45);
        g.stroke();
        this.groundText(g, st.name, a.x + (st.x - a.x) * 0.35, a.y + (st.y - a.y) * 0.35, st.hdg + Math.PI / 2, 0.75, 'rgba(255,255,255,.85)');
      }
      // Rollhalte (Bahnhaltepunkt-Markierung: zwei durchgezogene, zwei gestrichelte Linien)
      for (const n of ap.nodes) {
        if (n.kind !== 'hold' || !vis([n], 3)) continue;
        const e = ap.edges[n.edges[0]];
        if (!e) continue;
        const k = e.a === n.id ? 1 : e.pts.length - 2;
        const q = e.pts[clamp(k, 0, e.pts.length - 1)];
        const h = Math.atan2(q.y - n.y, q.x - n.x);
        const px = -Math.sin(h), py = Math.cos(h);
        g.strokeStyle = C.yellow;
        g.lineWidth = 0.06;
        for (let i = 0; i < 4; i++) {
          const o = (i - 1.5) * 0.14;
          g.setLineDash(i < 2 ? [] : [0.25, 0.18]);
          g.beginPath();
          g.moveTo(n.x + Math.cos(h) * o - px * 0.8, n.y + Math.sin(h) * o - py * 0.8);
          g.lineTo(n.x + Math.cos(h) * o + px * 0.8, n.y + Math.sin(h) * o + py * 0.8);
          g.stroke();
        }
        g.setLineDash([]);
      }
    }
  }
  // Text flach auf dem Boden (Welt: Mitte x,y; Winkel a = Richtung der Schriftzeile)
  groundText(g, txt, x, y, a, h, color, font = '700') {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    const k = h / 20;
    g.scale(k, k);
    g.fillStyle = color;
    g.font = `${font} 20px 'Chakra Petch', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 0, 0);
    g.restore();
  }
  drawRunway(g, r, detail) {
    const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y;
    const L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx), w = r.w;
    g.save();
    g.translate(r.a.x, r.a.y);
    g.rotate(ang);
    // Fläche mit Schulter
    g.fillStyle = '#4c5158';
    g.fillRect(-1.5, -w / 2 - 0.5, L + 3, w + 1);
    g.fillStyle = C.rwy;
    g.fillRect(-1, -w / 2, L + 2, w);
    const asp = this.aspPat || (this.aspPat = this.pattern(g, IMG.tex_asphalt, 5));
    if (asp && detail) {
      g.globalAlpha = 0.3;
      g.fillStyle = asp;
      g.fillRect(-1, -w / 2, L + 2, w);
      g.globalAlpha = 1;
    }
    g.fillStyle = C.white;
    // Randlinien
    g.fillRect(0, -w / 2 + 0.12, L, 0.07);
    g.fillRect(0, w / 2 - 0.19, L, 0.07);
    // Mittellinie (gestrichelt)
    if (detail) for (let s = 13; s < L - 13; s += 2.5) g.fillRect(s, -0.035, 1.5, 0.07);
    else for (let s = 13; s < L - 13; s += 5) g.fillRect(s, -0.07, 3, 0.14);
    // beide Enden: Schwellenbalken, Kennung, Aufsetzzone, Zielpunkt
    for (const k of [0, 1]) {
      g.save();
      if (k) {
        g.translate(L, 0);
        g.rotate(Math.PI);
      }
      const n = detail ? 14 : 8;
      const sw = (w - 0.7) / (n * 2 - 1);
      for (let i = 0; i < n; i++) g.fillRect(0.3, -w / 2 + 0.35 + i * 2 * sw, 1.6, sw);
      if (detail) {
        g.fillRect(0.05, -w / 2 + 0.1, 0.1, w - 0.2);
        // Zielpunkt bei 400 m, Aufsetzzone alle 150 m
        g.fillRect(20, -w / 2 + 0.45, 2.6, 0.4);
        g.fillRect(20, w / 2 - 0.85, 2.6, 0.4);
        for (const s of [7.5, 15, 30, 37.5, 45]) {
          const m = s < 20 ? 3 : s < 40 ? 2 : 1;
          for (let j = 0; j < m; j++) {
            g.fillRect(s, -w / 2 + 0.45 + j * 0.22, 1.1, 0.12);
            g.fillRect(s, w / 2 - 0.57 - j * 0.22, 1.1, 0.12);
          }
        }
      }
      g.restore();
    }
    g.restore();
    // Kennungen (lesbar für den Landenden)
    for (const [k, endId] of r.ends.entries()) {
      const end = this.ap.ends[endId];
      const p = { x: end.thr.x + end.dir.x * 3.4, y: end.thr.y + end.dir.y * 3.4 };
      const a = Math.atan2(end.dir.x, -end.dir.y);
      if (detail || this.cache) this.groundText(g, endId, p.x, p.y, a, detail ? 1.5 : 2.6, C.white);
      void k;
    }
  }
  buildCache() {
    const b = this.ap.bounds;
    const span = b.x1 - b.x0 + b.y1 - b.y0;
    const cs = Math.min(0.26, 4096 / (span * HALF_W));
    const offX = (b.y1 - b.x0) * HALF_W * cs;
    const offY = -(b.x0 + b.y0) * HALF_H * cs;
    const c = document.createElement('canvas');
    c.width = Math.ceil(span * HALF_W * cs);
    c.height = Math.ceil(span * HALF_H * cs);
    const g = c.getContext('2d');
    g.setTransform(HALF_W * cs, HALF_H * cs, -HALF_W * cs, HALF_H * cs, offX, offY);
    // Gras
    const gp = this.pattern(g, IMG.tex_grass, 7);
    g.fillStyle = gp || C.grass;
    g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    this.cache = { c, cs, offX, offY };
    this.drawGround(g, false, null);
    // Bäume als Tupfen
    for (const t of this.ap.trees) {
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath();
      g.ellipse(t.x + 0.3, t.y + 0.3, 0.7 * t.s, 0.7 * t.s, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3f6a35';
      g.beginPath();
      g.ellipse(t.x, t.y, 0.75 * t.s, 0.75 * t.s, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ------------------------------------------------------------ Gebäude
  drawBuilding(ctx, bd, night) {
    const cam = this.cam;
    const st = BLD[bd.kind] || BLD.hangar;
    const poly = bd.poly;
    const h = bd.h;
    const base = poly.map((p) => cam.toScreen(p.x, p.y, 0));
    const top = poly.map((p) => cam.toScreen(p.x, p.y, h));
    // Umlaufsinn (Fläche) bestimmen: Außennormale der Kanten
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a.x * b.y - b.x * a.y;
    }
    const sgn = area > 0 ? 1 : -1;
    const dk = 1 - night * 0.55;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      // Außennormale (y nach unten): für positiven Umlauf (b-a) um -90°
      const nx = sgn * (b.y - a.y), ny = -sgn * (b.x - a.x);
      if (nx + ny <= 0) continue; // vom Betrachter (Südost) abgewandt
      const east = nx > ny;
      const col = east ? st.wallA : st.wallB;
      ctx.fillStyle = rgb(col, dk);
      ctx.beginPath();
      ctx.moveTo(base[i].x, base[i].y);
      ctx.lineTo(base[(i + 1) % poly.length].x, base[(i + 1) % poly.length].y);
      ctx.lineTo(top[(i + 1) % poly.length].x, top[(i + 1) % poly.length].y);
      ctx.lineTo(top[i].x, top[i].y);
      ctx.closePath();
      ctx.fill();
      // Fassade: Fensterbänder / Glas / Streifen
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (cam.zoom > 0.12 && (st.glass || st.windows || st.stripes)) {
        const rows = st.glass ? Math.max(1, Math.round(h * 3)) : Math.max(2, Math.round(h * 6));
        ctx.strokeStyle = st.glass ? `rgba(${night > 0.4 ? '255,214,140' : '170,214,240'},${night > 0.4 ? 0.75 : 0.55})` : st.stripes ? 'rgba(60,64,70,.6)' : night > 0.4 ? 'rgba(255,214,140,.7)' : 'rgba(70,90,110,.55)';
        ctx.lineWidth = Math.max(0.6, cam.zoom * (st.glass ? 5 : 2.6));
        for (let r = 1; r <= rows; r++) {
          const t = r / (rows + 1);
          const p0 = cam.toScreen(a.x, a.y, h * t), p1 = cam.toScreen(b.x, b.y, h * t);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        if (st.windows && cam.zoom > 0.3) {
          ctx.lineWidth = Math.max(0.5, cam.zoom * 1.2);
          for (let s = 1; s < segLen; s += 1) {
            const f = s / segLen;
            const p0 = cam.toScreen(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, 0.05);
            const p1 = cam.toScreen(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, h - 0.05);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
        }
      }
    }
    // Dach
    ctx.fillStyle = rgb(st.roof, dk);
    ctx.beginPath();
    top.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Tower: Kanzel mit Glas
    if (st.tower) {
      const c = polyCenter(poly);
      const r = 1.9;
      const cab = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: c.x + Math.cos((i * Math.PI) / 4) * r, y: c.y + Math.sin((i * Math.PI) / 4) * r }));
      const b0 = cab.map((p) => cam.toScreen(p.x, p.y, h)), b1 = cab.map((p) => cam.toScreen(p.x, p.y, h + 0.55)), b2 = cab.map((p) => cam.toScreen(p.x, p.y, h + 0.75));
      ctx.fillStyle = night > 0.4 ? 'rgba(120,190,170,.95)' : 'rgba(80,140,170,.95)';
      ctx.beginPath();
      [0, 1, 2, 3, 4, 5, 6, 7].forEach((i) => (i ? ctx.lineTo(b0[i].x, b0[i].y) : ctx.moveTo(b0[i].x, b0[i].y)));
      [7, 6, 5, 4, 3, 2, 1, 0].forEach((i) => ctx.lineTo(b1[i].x, b1[i].y));
      ctx.fill();
      ctx.fillStyle = rgb([70, 76, 84], dk);
      ctx.beginPath();
      b2.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.fill();
    }
    if (bd.name && cam.zoom > 0.16 && cam.zoom < 1.2) {
      const c = polyCenter(poly);
      const p = cam.toScreen(c.x, c.y, h);
      ctx.font = `600 ${Math.round(clamp(cam.zoom * 22, 10, 14))}px 'Chakra Petch', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(15,23,42,.6)';
      ctx.fillText(T(bd.name), p.x + 1, p.y + 1);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillText(T(bd.name), p.x, p.y);
    }
  }
  drawTree(ctx, t) {
    const cam = this.cam;
    const p = cam.toScreen(t.x, t.y, 0);
    const z = cam.zoom;
    const r = 0.75 * t.s * HALF_W * z;
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath();
    ctx.ellipse(p.x + r * 0.5, p.y + r * 0.1, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const q = cam.toScreen(t.x, t.y, 0.6 * t.s);
    ctx.fillStyle = '#3a6431';
    ctx.beginPath();
    ctx.arc(q.x, q.y, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4d7d3f';
    ctx.beginPath();
    ctx.arc(q.x - r * 0.25, q.y - r * 0.25, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  // ------------------------------------------------------------ Flugzeuge
  adapter(ac) {
    let o = this.adapt.get(ac.id);
    if (!o) {
      o = { id: 'h' + ac.id, type: ac.type, airline: ac.airline, mode: 'map', arr: ac.kind === 'arr' };
      this.adapt.set(ac.id, o);
    }
    o.type = ac.type;
    o.airline = ac.airline;
    o.x = ac.x;
    o.y = ac.y;
    o.z = ac.z;
    o.hdg = ac.hdg;
    o.phase = PH_OF[ac.phase] || PH.TAXI_IN;
    o.vacated = ac.vacated || ac.phase === P.TAXI_IN;
    o.v = ac.spd;
    o.alt = ac.z * 65;
    o.roll = 0;
    return o;
  }
  // vereinfachte Silhouette (falls die 3D-Modelle nicht verfügbar sind)
  drawSimple(ctx, ac) {
    const cam = this.cam;
    const L = ac.len, Wd = ac.span;
    const c = Math.cos(ac.hdg), s = Math.sin(ac.hdg);
    const P2 = (f, l) => cam.toScreen(ac.x + c * f - s * l, ac.y + s * f + c * l, ac.z + 0.2);
    const al = AIRLINES[ac.airline] || {};
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = Math.max(1.5, cam.zoom * 9 * (ac.size === 'L' ? 1.3 : 1));
    let a = P2(-L / 2, 0), b = P2(L / 2, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = '#d6dde6';
    ctx.lineWidth = Math.max(1, cam.zoom * 6);
    a = P2(0.05 * L, -Wd / 2);
    b = P2(0.05 * L, Wd / 2);
    const m = P2(0.12 * L, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(m.x, m.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = al.color || '#e63946';
    ctx.lineWidth = Math.max(1, cam.zoom * 5);
    a = P2(-L * 0.45, -Wd * 0.18);
    b = P2(-L * 0.45, Wd * 0.18);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  drawShadow(ctx, ac) {
    const cam = this.cam;
    const off = Math.min(ac.z * 0.6, 40);
    const p = cam.toScreen(ac.x + off * 0.6, ac.y + off * 0.3, 0);
    const k = Math.max(0.15, 1 - ac.z / 40);
    const r = ac.len * 0.5 * HALF_W * cam.zoom;
    ctx.fillStyle = `rgba(0,0,0,${0.22 * k})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawAircraft(ctx, ac) {
    if (this.useImp && IMP.has('h' + ac.id) && IMP.draw(this, 'h' + ac.id, ac.x, ac.y, ac.z)) return;
    this.drawSimple(ctx, ac);
  }

  // ------------------------------------------------------------ Lichter
  makeLights() {
    const L = [];
    for (const r of this.ap.runways) {
      const n = Math.floor(r.len / 3);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = r.a.x + (r.b.x - r.a.x) * t, y = r.a.y + (r.b.y - r.a.y) * t;
        const px = -r.dir?.y || 0, py = r.dir?.x || 0;
        L.push({ x: x + px * r.w * 0.5, y: y + py * r.w * 0.5, c: '#fff6dc', s: 4 }, { x: x - px * r.w * 0.5, y: y - py * r.w * 0.5, c: '#fff6dc', s: 4 });
      }
    }
    for (const b of this.ap.buildings) {
      if (b.kind !== 'terminal' && b.kind !== 'pier' && b.kind !== 'cargo') continue;
      const c = polyCenter(b.poly);
      L.push({ x: c.x, y: c.y, c: '#ffd9a0', s: 60, flat: true });
    }
    return L;
  }

  // ------------------------------------------------------------ Hauptzeichnen
  render(dt) {
    const ctx = this.ctx, cam = this.cam, sim = this.sim, ap = this.ap;
    this.time += dt;
    if (!this.cache && IMG.tex_grass) this.buildCache();
    // Bahnrichtung (für Lichter) nachtragen
    for (const r of ap.runways) if (!r.dir) r.dir = { x: (r.b.x - r.a.x) / r.len, y: (r.b.y - r.a.y) / r.len };
    this.view = this.viewRect(12);
    const hr = (sim.t / 3600) % 24;
    const night = clamp(hr < 12 ? (6.4 - hr) / 1.4 : (hr - 19.6) / 1.4, 0, 1);
    this.night = night;
    // Gras
    cam.setScreen(ctx);
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, cam.w, cam.h);
    cam.setIso(ctx);
    if (!this.grassPat && IMG.tex_grass) this.grassPat = this.pattern(ctx, IMG.tex_grass, 7);
    if (this.grassPat) {
      const v = this.view;
      ctx.fillStyle = this.grassPat;
      ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    }
    // Boden
    if (cam.zoom < VEC_Z && this.cache) {
      const k = this.cache;
      const sc = cam.zoom / k.cs;
      cam.setScreen(ctx);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(k.c, cam.ox - k.offX * sc, cam.oy - k.offY * sc, k.c.width * sc, k.c.height * sc);
    } else {
      cam.setIso(ctx);
      this.drawGround(ctx, true, this.view);
    }
    cam.setIso(ctx);
    this.drawOverlayGround(ctx);
    cam.setScreen(ctx);
    // 3D-Modelle vorbereiten
    this.useImp = !!IMP && cam.zoom >= 0.065;
    const list = sim.acs.filter((a) => a.phase !== P.GONE && (this.inView(a.x, a.y, 20 + a.z * 2) || a.z > 1));
    if (IMP) IMP.prepare(this, null, this.useImp ? list.filter((a) => this.inView(a.x, a.y, 20 + a.z * 2)).map((a) => this.adapter(a)) : [], [], dt);
    // Tiefensortierte Objekte am Boden
    const items = [];
    for (const b of ap.buildings) {
      let d = -Infinity, vis = false;
      for (const p of b.poly) {
        d = Math.max(d, p.x + p.y);
        if (this.inView(p.x, p.y, 4)) vis = true;
      }
      if (!vis) continue;
      items.push({ d: d - 0.5, f: () => this.drawBuilding(ctx, b, night) });
    }
    if (cam.zoom >= VEC_Z) for (const t of ap.trees) if (this.inView(t.x, t.y, 2)) items.push({ d: t.x + t.y, f: () => this.drawTree(ctx, t) });
    const air = [];
    for (const ac of list) {
      if (ac.z > 0.4) air.push(ac);
      else if (this.inView(ac.x, ac.y, 6)) items.push({ d: ac.x + ac.y + 0.4, f: () => (this.drawShadow(ctx, ac), this.drawAircraft(ctx, ac)) });
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.f();
    // in der Luft: Schatten, dann Flugzeug, tiefe zuerst
    air.sort((a, b) => b.z - a.z);
    for (const ac of air) if (ac.z < 30 && this.inView(ac.x, ac.y, 8)) this.drawShadow(ctx, ac);
    for (const ac of air) {
      const p = cam.toScreen(ac.x, ac.y, ac.z);
      if (p.x < -60 || p.y < -60 || p.x > cam.w + 60 || p.y > cam.h + 60) continue;
      this.drawAircraft(ctx, ac);
    }
    // Nacht
    if (night > 0.02) this.drawNight(ctx, night, list);
    // Beschriftungen
    this.drawLabels(ctx, list);
  }
  // aktive Bahnen, Haltebalken, gewählte Route, verlängerte Anfluglinie
  drawOverlayGround(ctx) {
    const sim = this.sim, ap = this.ap, cam = this.cam;
    const lw = (px) => px / (HALF_W * cam.zoom);
    // aktive Bahnen markieren
    for (const r of ap.runways) {
      const arr = r.ends.find((e) => sim.cfg.arr.includes(e));
      const dep = r.ends.find((e) => sim.cfg.dep.includes(e));
      if (!arr && !dep) continue;
      const occ = sim.occupants(r.id).length > 0;
      ctx.strokeStyle = occ ? 'rgba(239,68,68,.75)' : arr && dep ? 'rgba(250,204,21,.7)' : arr ? 'rgba(52,211,153,.7)' : 'rgba(56,189,248,.7)';
      ctx.lineWidth = lw(2.2);
      const n = { x: -(r.b.y - r.a.y) / r.len, y: (r.b.x - r.a.x) / r.len };
      for (const sd of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r.a.x + n.x * sd * (r.w / 2 + 0.7), r.a.y + n.y * sd * (r.w / 2 + 0.7));
        ctx.lineTo(r.b.x + n.x * sd * (r.w / 2 + 0.7), r.b.y + n.y * sd * (r.w / 2 + 0.7));
        ctx.stroke();
      }
      // verlängerte Anfluglinie
      if (arr) {
        const end = ap.ends[arr];
        ctx.setLineDash([lw(10), lw(10)]);
        ctx.strokeStyle = 'rgba(52,211,153,.35)';
        ctx.lineWidth = lw(1.5);
        ctx.beginPath();
        ctx.moveTo(end.thr.x, end.thr.y);
        ctx.lineTo(end.thr.x - end.dir.x * 12 * 92.6, end.thr.y - end.dir.y * 12 * 92.6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Haltebalken an aktiven Bahnen: rot, grün bei Freigabe
    if (cam.zoom > 0.09) {
      for (const ac of sim.acs) {
        if (ac.req === 'cross' && ac.reqStop) {
          const p = ap.nodes[ac.reqStop.seg.from];
          this.stopBar(ctx, p, ac.reqStop.seg, 'rgba(239,68,68,.95)');
        }
        if (ac.crossRwy && ac.reqStop && !ac.reqStop.passed) {
          const p = ap.nodes[ac.reqStop.seg.from];
          this.stopBar(ctx, p, ac.reqStop.seg, 'rgba(52,211,153,.95)');
        }
      }
    }
    // gewähltes Flugzeug: Route
    const s = this.sel && sim.acs.find((a) => a.id === this.sel);
    if (s && s.path && s.s < s.path.total) {
      ctx.strokeStyle = 'rgba(56,214,245,.9)';
      ctx.lineWidth = lw(2.5);
      ctx.setLineDash([lw(6), lw(5)]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      const pts = s.path.pts, cum = s.path.cum;
      for (let i = 1; i < pts.length; i++) if (cum[i] > s.s) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  stopBar(ctx, p, seg, color) {
    const e = this.ap.edges[seg.e];
    const q = seg.dir === 1 ? e.pts[1] : e.pts[e.pts.length - 2];
    const h = Math.atan2(q.y - p.y, q.x - p.x);
    const px = -Math.sin(h), py = Math.cos(h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(p.x - px * 1.1, p.y - py * 1.1);
    ctx.lineTo(p.x + px * 1.1, p.y + py * 1.1);
    ctx.stroke();
  }
  drawNight(ctx, night, list) {
    const cam = this.cam;
    cam.setScreen(ctx);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${Math.round(255 - 200 * night)},${Math.round(255 - 185 * night)},${Math.round(255 - 140 * night)})`;
    ctx.fillRect(0, 0, cam.w, cam.h);
    ctx.globalCompositeOperation = 'lighter';
    const z = cam.zoom;
    for (const L of this.lights) {
      if (!this.inView(L.x, L.y, 2)) continue;
      const p = cam.toScreen(L.x, L.y, 0);
      const s = L.flat ? L.s * z * 1.4 : Math.max(2, L.s * Math.sqrt(z) * 1.4);
      ctx.globalAlpha = night * (L.flat ? 0.35 : 0.9);
      const img = glowTinted(L.c, L.flat);
      if (L.flat) ctx.drawImage(img, p.x - s, p.y - s * 0.5, s * 2, s);
      else ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
    }
    // Flugzeuglichter: Scheinwerfer, Blitzer
    for (const ac of list) {
      const p = cam.toScreen(ac.x, ac.y, ac.z + 0.3);
      if (p.x < -30 || p.y < -30 || p.x > cam.w + 30 || p.y > cam.h + 30) continue;
      const moving = ac.phase !== P.STAND;
      if (!moving) continue;
      const land = ac.z > 0.1 || ac.phase === P.ROLL || ac.phase === P.TKOF;
      const s = land ? Math.max(8, 26 * Math.sqrt(z)) : Math.max(4, 9 * Math.sqrt(z));
      ctx.globalAlpha = night * (land ? 0.95 : 0.6);
      ctx.drawImage(glowTinted('#fff7e0', false), p.x - s / 2, p.y - s / 2, s, s);
      if (Math.sin(this.time * 6 + ac.id) > 0.7) {
        ctx.globalAlpha = night;
        ctx.drawImage(glowTinted('#ff3b30', false), p.x - 4, p.y - 6, 8, 8);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  drawLabels(ctx, list) {
    const cam = this.cam, sim = this.sim;
    cam.setScreen(ctx);
    const z = cam.zoom;
    const fs = Math.round(clamp(10 + z * 3, 10, 13));
    ctx.font = `600 ${fs}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    this.labelBoxes = [];
    for (const ac of list) {
      const p = cam.toScreen(ac.x, ac.y, ac.z + 0.6);
      if (p.x < -80 || p.y < -40 || p.x > cam.w + 80 || p.y > cam.h + 40) continue;
      const sel = this.sel === ac.id;
      const talk = !!(this.talk && this.talk.id === ac.id);
      const parked = ac.phase === P.STAND && !ac.req;
      if (parked && !sel && !talk && z < 0.75) continue;
      let col = 'rgba(15,23,42,.78)', fg = '#e2e8f0', bd = 'rgba(148,163,184,.5)';
      if (ac.req) (bd = '#f5a623'), (fg = '#fde68a');
      if (ac.landClr || ac.tkClr || ac.crossRwy) bd = 'rgba(52,211,153,.9)';
      if (sel) (bd = '#38d6f5'), (col = 'rgba(8,47,73,.9)');
      if (talk) {
        // aktiver Funkkontakt: türkiser Ring (pulsiert, solange er spricht) und Schild
        (bd = '#67e8f9'), (col = 'rgba(8,47,60,.92)');
        const ph = this.talk.live ? (performance.now() / 700) % 1 : 0;
        ctx.strokeStyle = `rgba(103,232,249,${this.talk.live ? 1 - ph : 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y + 4, 12 + ph * 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      const t2 = z > 0.22 || sel ? ` ${ac.tt.code}` : '';
      const txt = ac.cs + t2;
      const w = ctx.measureText(txt).width + 10, h = fs + 7;
      const off = ac.z > 0.4 ? 14 : Math.max(10, ac.len * HALF_W * z * 0.35);
      const x = p.x + 6, y = p.y - off - h;
      ctx.strokeStyle = 'rgba(148,163,184,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 2);
      ctx.lineTo(x, y + h);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.strokeStyle = bd;
      ctx.lineWidth = talk ? 2.2 : sel || ac.req ? 1.6 : 1;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.fillText(txt, x + 5, y + h / 2 + 0.5);
      this.labelBoxes.push({ id: ac.id, x, y, w, h, px: p.x, py: p.y });
    }
    void sim;
  }
  // Flugzeug an Bildschirmposition (Beschriftung oder Rumpf)
  pick(sx, sy) {
    for (const b of [...(this.labelBoxes || [])].reverse()) if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b.id;
    let best = null;
    for (const ac of this.sim.acs) {
      const p = this.cam.toScreen(ac.x, ac.y, ac.z + 0.3);
      const d = Math.hypot(p.x - sx, p.y - sy);
      const r = Math.max(14, ac.len * HALF_W * this.cam.zoom * 0.6);
      if (d < r && (!best || d < best.d)) best = { id: ac.id, d };
    }
    return best ? best.id : null;
  }
}
void dist;
void ZS;
