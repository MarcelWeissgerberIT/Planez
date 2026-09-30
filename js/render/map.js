// Isometrische Flughafenansicht
import { IMG, shadowOf, glowTinted } from '../assets.js';
import { drawAircraftBody, drawVehicleBody, drawCarBody } from './volume.js';
import { Ambient } from './ambient.js';
import { HALF_W, HALF_H } from './camera.js';
import * as LY from '../layout.js';
import { AC_TYPES, AIRLINES, VEH_TYPES, ZS } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { hourOf, roundedPath, clamp, lerp } from '../util.js';
import { MARKS } from '../ui/marks.js';
import { siteGeom, drawSiteGround, siteItems, permanentItems, drawSiteLabel } from './sites.js';
import { runwayClosed, stripGeom } from '../sim/runway.js';
const markOf = (ac) => (ac.mark && MARKS[ac.mark.c] ? MARKS[ac.mark.c] : null);

const BH = { hall: 1.3, tower: 5, hangar: 1.8, cargo: 0.9, depot: 0.7, fire: 0.8, fuel: 0.9, parking: 1.1, hotel: 3.2, radar: 2.6 };
const MARGIN = 8;
const RX0 = -MARGIN, RY0 = -MARGIN, RX1 = LY.W + MARGIN, RY1 = LY.H + MARGIN;

function pat(ctx, img, tiles) {
  if (!img) return '#6a8f4e';
  const p = ctx.createPattern(img, 'repeat');
  if (p.setTransform) p.setTransform(new DOMMatrix().scale(tiles / img.width));
  return p;
}
// Parkplatz: Stellplatzreihen und vorgerenderte 3D-Autos (maßstabsgerecht)
const LOT_ROWS = [2.1, 2.48, 3.56, 3.94, 5.02, 5.4, 6.16];
function bakeLot(level) {
  const Z = 2.4, pw = 12.5 + level * 2;
  const x0 = 56, y0 = 2.0, x1 = 56 + pw, y1 = 6.6, top = 0.2, pad = 6;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0 + y1 - y0) * HALF_W * Z) + pad * 2;
  c.height = Math.ceil((x1 - x0 + y1 - y0) * HALF_H * Z + top * ZS * Z) + pad * 2;
  const g = c.getContext('2d');
  const ox = pad - (x0 - y1) * HALF_W * Z, oy = pad - (x0 + y0) * HALF_H * Z + top * ZS * Z;
  const cam = {
    zoom: Z,
    dpr: 1,
    toScreen: (wx, wy, wz = 0) => ({ x: (wx - wy) * HALF_W * Z + ox, y: (wx + wy) * HALF_H * Z - wz * ZS * Z + oy }),
    setScreen: (ctx) => ctx.setTransform(1, 0, 0, 1, 0, 0),
    setIso: (ctx, wz = 0) => ctx.setTransform(HALF_W * Z, HALF_H * Z, -HALF_W * Z, HALF_H * Z, ox, oy - wz * ZS * Z),
  };
  let seed = 777 + level;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // von hinten nach vorn zeichnen (Tiefe)
  for (const yy of LOT_ROWS) {
    for (let x = 56.15; x < x1 - 0.35; x += 0.2) {
      if (rnd() < 0.3) continue;
      const cx = x + 0.1, cy = yy + 0.17;
      cam.setIso(g, 0);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(cx - 0.05, cy - 0.13, 0.13, 0.3);
      drawCarBody(g, cam, cx, cy, Math.PI / 2 + (rnd() < 0.5 ? 0 : Math.PI), CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)], prism, carShades, false, 0.95, 0);
    }
  }
  const f = cam.toScreen(x0, y0, 0);
  return { c, Z, fx: f.x, fy: f.y };
}

// Parkhaus vorrendern: Decks mit Stützen, Brüstungen, kleinen 3D-Autos, Treppenhaus mit P-Schild
function bakeGarage(b, level) {
  const Z = 2.4;
  const decks = 3 + level; // Parkebenen über dem Erdgeschoss
  const DH = 0.3;
  const x0 = b.fx - b.w, y0 = b.fy - b.d, x1 = b.fx, y1 = b.fy;
  const top = (decks + 1) * DH + 0.35;
  const pad = 8;
  const c = document.createElement('canvas');
  c.width = Math.ceil((b.w + b.d) * HALF_W * Z) + pad * 2;
  c.height = Math.ceil((b.w + b.d) * HALF_H * Z + top * ZS * Z) + pad * 2;
  const g = c.getContext('2d');
  const ox = pad - (x0 - y1) * HALF_W * Z;
  const oy = pad - (x0 + y0) * HALF_H * Z + top * ZS * Z;
  const cam = {
    zoom: Z,
    dpr: 1,
    toScreen: (wx, wy, wz = 0) => ({ x: (wx - wy) * HALF_W * Z + ox, y: (wx + wy) * HALF_H * Z - wz * ZS * Z + oy }),
    setScreen: (ctx) => ctx.setTransform(1, 0, 0, 1, 0, 0),
    setIso: (ctx, wz = 0) => ctx.setTransform(HALF_W * Z, HALF_H * Z, -HALF_W * Z, HALF_H * Z, ox, oy - wz * ZS * Z),
  };
  let seed = 1234 + level * 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const box = (ax, ay, bx, by, z0, z1, cTop, cA, cB) => prism(g, cam, [{ x: ax, y: ay }, { x: bx, y: ay }, { x: bx, y: by }, { x: ax, y: by }], z0, z1, cTop, cA, cB);
  const slab = [186, 184, 178], slabA = [150, 148, 142], slabB = [118, 116, 110];
  const rows = [y0 + 0.3, y0 + 0.66, y0 + 1.8, y0 + 2.16, y0 + 3.3, y0 + 3.66, y1 - 0.28];
  const quad = (pts, col) => {
    g.fillStyle = col;
    g.beginPath();
    pts.forEach(([x, y, z], i) => {
      const p = cam.toScreen(x, y, z);
      if (i) g.lineTo(p.x, p.y);
      else g.moveTo(p.x, p.y);
    });
    g.closePath();
    g.fill();
  };
  for (let lv = 0; lv <= decks; lv++) {
    const z = lv * DH;
    const roof = lv === decks;
    // dunkler Innenraum: Rückwände der Ebene (sieht man durch die offene Fassade)
    if (!roof) {
      quad([[x0, y0, z], [x1, y0, z], [x1, y0, z + DH], [x0, y0, z + DH]], '#3b3f45');
      quad([[x0, y0, z], [x0, y1, z], [x0, y1, z + DH], [x0, y0, z + DH]], '#2e3237');
    }
    box(x0, y0, x1, y1, Math.max(0, z - 0.035), z + 0.02, roof ? [160, 162, 160] : [78, 80, 86], slabA, slabB);
    if (roof) {
      // Fahrbahnmarkierung oben
      cam.setIso(g, z + 0.021);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (const ry of rows) for (let x = x0 + 0.25; x < x1 - 0.2; x += 0.2) g.fillRect(x, ry - 0.17, 0.012, 0.34);
    }
    // Autos
    for (const ry of rows) {
      for (let x = x0 + 0.35; x < x1 - 0.25; x += 0.2) {
        if (rnd() < (roof ? 0.45 : 0.25)) continue;
        drawCarBody(g, cam, x, ry, Math.PI / 2 + (rnd() < 0.5 ? 0 : Math.PI), CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)], prism, carShades, false, 0.95, z + 0.02);
      }
    }
    if (lv < decks) {
      // Stützen zur nächsten Ebene
      for (let x = x0 + 0.15; x <= x1 - 0.1; x += 1.3) for (const yy of [y0 + 0.1, y0 + 1.3, y0 + 2.9, y1 - 0.12]) box(x, yy, x + 0.08, yy + 0.08, z + 0.02, z + DH - 0.03, [150, 148, 142], [128, 126, 120], [100, 98, 94]);
    }
    // Brüstung ringsum (offene Fassade)
    const bz0 = z + 0.02, bz1 = z + 0.075;
    const wall = [214, 212, 206], wA = [188, 186, 180], wB = [150, 148, 142];
    box(x0, y0, x1, y0 + 0.04, bz0, bz1, wall, wA, wB);
    box(x0, y0, x0 + 0.04, y1, bz0, bz1, wall, wA, wB);
    box(x0, y1 - 0.04, x1, y1, bz0, bz1, wall, wA, wB);
    box(x1 - 0.04, y0, x1, y1, bz0, bz1, wall, wA, wB);
  }
  // Rampe an der Westseite und Treppenhaus mit P-Schild
  const zt = decks * DH;
  box(x0 + 0.1, y1 - 0.9, x0 + 0.75, y1 - 0.1, 0, zt + 0.3, [120, 124, 130], [94, 104, 118], [74, 84, 98]);
  cam.setScreen(g);
  const p0 = cam.toScreen(x0 + 0.75, y1 - 0.7, zt + 0.04), p1 = cam.toScreen(x0 + 0.75, y1 - 0.2, zt + 0.04);
  const p2 = cam.toScreen(x0 + 0.75, y1 - 0.2, zt + 0.28), p3 = cam.toScreen(x0 + 0.75, y1 - 0.7, zt + 0.28);
  g.fillStyle = '#1d4ed8';
  g.beginPath();
  g.moveTo(p0.x, p0.y);
  g.lineTo(p1.x, p1.y);
  g.lineTo(p2.x, p2.y);
  g.lineTo(p3.x, p3.y);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(0.2 * ZS * Z)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P', (p0.x + p2.x) / 2, (p0.y + p2.y) / 2);
  // Lichtmasten auf dem Dach
  for (let x = x0 + 1.2; x < x1 - 0.5; x += 1.6) box(x, (y0 + y1) / 2, x + 0.03, (y0 + y1) / 2 + 0.03, zt + 0.02, zt + 0.32, [220, 220, 220], [160, 160, 160], [120, 120, 120]);
  const f = cam.toScreen(x1, y1, 0);
  return { c, Z, fx: f.x, fy: f.y };
}

// Terminaldach als Bild in Weltkoordinaten (24 px je Kachel)
function makeRoof(T) {
  const PX = 24;
  const c = document.createElement('canvas');
  c.width = Math.ceil((T.x1 - T.x0) * PX);
  c.height = Math.ceil((T.y1 - T.y0) * PX);
  c.px = PX;
  const g = c.getContext('2d');
  g.fillStyle = pat(g, IMG.tex_roof, 3.2 * PX);
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(0, c.height - 0.08 * PX, c.width, 0.08 * PX);
  g.fillStyle = 'rgba(40,50,60,0.12)';
  g.fillRect(0, 1.6 * PX, c.width, 0.8 * PX);
  return c;
}
const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function lightLevel(state) {
  const h = hourOf(state.time);
  // 1 = Tag, 0 = Nacht
  if (h >= 7 && h <= 19) return 1;
  if (h <= 4.5 || h >= 21.8) return 0;
  if (h < 7) return (h - 4.5) / 2.5;
  return 1 - (h - 19) / 2.8;
}

export class MapRenderer {
  constructor(canvas, cam) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = cam;
    this.cache = null;
    this.cacheKey = '';
    this.trees = LY.makeTrees();
    this.rain = [];
    this.flash = 0;
    this.time = 0;
    this.cars = makeCars();
    this.ambient = new Ambient();
    this.topZ = {};
    this.picks = [];
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cam.w = w;
    this.cam.h = h;
    this.cam.dpr = dpr;
  }

  groundKey(state) {
    return state.stands.map((s) => (s.built ? s.size : '-')).join('') + '|' + state.upgrades.parking + state.upgrades.hotel + state.upgrades.rapidExit + (state.upgrades.rwy2 || 0) + '|' + Math.round((state.rwyCond ?? 88) / 10) + Math.round((state.rwyCondS ?? 100) / 10);
  }

  // ---------- Boden-Cache ----------
  buildGround(state) {
    const cs = (this.cam.w < 900 ? 0.5 : 0.72) * Math.min(1.5, this.cam.dpr);
    const offX = (RY1 - RX0) * HALF_W * cs;
    const offY = -(RX0 + RY0) * HALF_H * cs;
    const w = Math.ceil((RX1 - RY0 + RY1 - RX0) * HALF_W * cs);
    const h = Math.ceil((RX1 + RY1 - RX0 - RY0) * HALF_H * cs);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.setTransform(HALF_W * cs, HALF_H * cs, -HALF_W * cs, HALF_H * cs, offX, offY);
    drawGround(g, state, this.trees);
    this.cache = { c, cs, offX, offY };
    this.cacheKey = this.groundKey(state);
  }

  // ---------- Hauptzeichnen ----------
  render(state, dtReal, ui) {
    const ctx = this.ctx;
    const cam = this.cam;
    this.time += dtReal;
    this.garageLevel = state.upgrades.parking || 0;
    this.state = state;
    if (!this.cache || this.cacheKey !== this.groundKey(state)) this.buildGround(state);
    const light = lightLevel(state);
    const night = 1 - light;
    const lights = [];
    this.picks = [];

    // Hintergrund (Gras, weltfest)
    cam.setScreen(ctx);
    ctx.fillStyle = '#5d7f45';
    ctx.fillRect(0, 0, cam.w, cam.h);
    const corners = [cam.toWorld(0, 0), cam.toWorld(cam.w, 0), cam.toWorld(cam.w, cam.h), cam.toWorld(0, cam.h)];
    cam.setIso(ctx);
    ctx.fillStyle = this.grassPat || (this.grassPat = pat(ctx, IMG.tex_grass, 7));
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.fill();

    // Boden-Cache (sichtbaren Ausschnitt)
    const k = this.cache;
    const sc = cam.zoom / k.cs;
    const dx = cam.ox - k.offX * sc;
    const dy = cam.oy - k.offY * sc;
    cam.setScreen(ctx);
    const sx0 = Math.max(0, -dx / sc), sy0 = Math.max(0, -dy / sc);
    const sx1 = Math.min(k.c.width, (cam.w - dx) / sc), sy1 = Math.min(k.c.height, (cam.h - dy) / sc);
    if (sx1 > sx0 && sy1 > sy0) ctx.drawImage(k.c, sx0, sy0, sx1 - sx0, sy1 - sy0, dx + sx0 * sc, dy + sy0 * sc, (sx1 - sx0) * sc, (sy1 - sy0) * sc);

    // Wolkenschatten
    if (state.weather.kind !== 'clear' && state.weather.kind !== 'fog') this.cloudShadows(ctx, state);

    // Baustellen (Boden)
    const sites = [];
    for (const p of state.projects || []) {
      const g = siteGeom(state, p);
      if (g) sites.push({ p, g });
    }
    this.sites = sites;
    this.siteLights = [];
    for (const s of sites) drawSiteGround(this, state, s.p, s.g);
    this.drawRunwayWorkGround(state);

    // Objekte sammeln
    const items = [];
    for (const b of LY.BUILDINGS) {
      if (b.requires && !state.upgrades[b.requires]) continue;
      const x0 = b.fx - b.w, y0 = b.fy - b.d;
      items.push({ d: (x0 + b.fx) / 2 + (y0 + b.fy) / 2, f: () => this.drawBuilding(b) });
    }
    items.push({ d: 56 + 2.0, f: () => this.drawLot(state) });
    for (const s of sites) siteItems(this, state, s.p, s.g, items);
    permanentItems(this, state, items, sites);
    const T = LY.TERMINAL;
    for (let x = T.x0; x < T.x1 - 1e-6; x += 1) {
      const xb = Math.min(T.x1, x + 1);
      items.push({ d: (x + xb) / 2 + (T.y0 + T.y1) / 2, f: () => this.drawTerminalSlice(x, xb, xb >= T.x1 - 1e-6, night) });
    }
    for (const st of state.stands) {
      if (st.kind !== 'contact' || !st.built) continue;
      items.push({ d: st.x - 1.2 + 15.4, f: () => this.drawBridge(state, st) });
    }
    const view = this.viewRect();
    for (const t of this.trees) {
      if (!inView(view, t.x, t.y, 2)) continue;
      if (sites.some((q) => q.g.fence && t.x > q.g.x0 - 0.4 && t.x < q.g.x1 + 0.4 && t.y > q.g.y0 - 0.4 && t.y < q.g.y1 + 0.4)) continue;
      items.push({ d: t.x + t.y, f: () => this.drawTree(t) });
    }
    for (const car of this.cars) {
      const p = carPos(car, this.ambient.vt);
      items.push({ d: p.x + p.y, f: () => this.drawCar(p, car, night, lights) });
    }
    // Belebung: Besucherverkehr, Fußgänger, Bodenpersonal, Baustellen, Nachtlichter
    this.ambient.update(state, dtReal);
    this.ambient.items(this, state, items, lights, night, sites, (x, y) => inView(view, x, y, 1.5));
    const flying = [];
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      if (!inView(view, ac.x, ac.y, 6 + ac.z * 2)) continue;
      if (ac.z > 0.35) flying.push(ac);
      else items.push({ d: ac.x + ac.y, f: () => this.drawAircraft(state, ac, lights, night, ui) });
    }
    // Fahrzeuge unter Flügel oder Heck eines stehenden Flugzeugs vor dem Flugzeug zeichnen (sonst liegen sie obendrauf)
    const parked = state.acs.filter((a) => a.mode === 'map' && a.z < 0.05);
    for (const v of state.vehicles) {
      if (!inView(view, v.x, v.y, 2)) continue;
      let d = v.x + v.y;
      for (const a of parked) {
        const dx = v.x - a.x, dy = v.y - a.y;
        if (dx * dx + dy * dy > a.len * a.len * 0.36) continue;
        const fx = Math.cos(a.hdg), fy = Math.sin(a.hdg);
        const along = dx * fx + dy * fy, side = -dx * fy + dy * fx;
        const span = a.len * 0.5;
        const viewerSide = side * (-fy + fx) > 0; // seitlich zum Betrachter hin versetzt
        if (Math.abs(along) < a.len * 0.5 && Math.abs(side) < span && !(viewerSide && Math.abs(side) < 0.6 && along > -a.len * 0.3)) d = Math.min(d, a.x + a.y - 0.05);
      }
      items.push({ d, f: () => this.drawVehicle(state, v, lights) });
    }
    if (state.fire) for (const t of state.fire.trucks) items.push({ d: t.x + t.y, f: () => this.drawFireTruck(t, lights) });
    items.push({ d: 66 + 35.6, f: () => this.drawWindsock(state) });
    this.runwayWorkItems(state, items, lights);
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.f();
    flying.sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const ac of flying) this.drawAircraft(state, ac, lights, night, ui);

    // Nacht / Dämmerung
    const h = hourOf(state.time);
    const dusk = clamp(1 - Math.abs(h - (h < 12 ? 5.8 : 20.2)) / 1.6, 0, 1);
    cam.setScreen(ctx);
    if (night > 0.02 || dusk > 0.02) {
      let col = mix([255, 255, 255], [40, 58, 110], night * 0.85);
      col = mix(col, [255, 170, 110], dusk * 0.35 * (1 - night * 0.5));
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = rgb(col);
      ctx.fillRect(0, 0, cam.w, cam.h);
      ctx.globalCompositeOperation = 'source-over';
    }
    const wx = state.weather.kind;
    if (wx === 'rain' || wx === 'storm' || wx === 'clouds') {
      ctx.fillStyle = wx === 'storm' ? 'rgba(30,40,60,0.28)' : wx === 'rain' ? 'rgba(60,70,90,0.18)' : 'rgba(80,90,110,0.06)';
      ctx.fillRect(0, 0, cam.w, cam.h);
    }

    // Lichter
    this.staticLights(state, lights, night);
    ctx.globalCompositeOperation = 'lighter';
    const intensity = 0.3 + 0.7 * night;
    const zf = Math.max(0.55, Math.sqrt(cam.zoom));
    for (const L of lights) {
      const p = cam.toScreen(L.x, L.y, L.z || 0);
      if (p.x < -80 || p.y < -80 || p.x > cam.w + 80 || p.y > cam.h + 80) continue;
      const s = L.s * (L.flat ? cam.zoom : zf) * 1.7 * (0.6 + 0.4 * night);
      const a = clamp((L.a ?? 1) * (L.day ? Math.max(intensity, 0.8) : intensity), 0, 1);
      if (a < 0.02 || s < 0.5) continue;
      ctx.globalAlpha = a;
      const img = glowTinted(L.c, L.soft);
      if (L.flat) {
        // flacher Lichtkegel auf dem Boden (Ellipse)
        ctx.drawImage(img, p.x - s, p.y - s * 0.5, s * 2, s);
      } else {
        ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
        // heller Kern
        const c = Math.max(1.5, s * 0.16);
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(IMG.glow, p.x - c, p.y - c, c * 2, c * 2);
      }
    }
    // Warnlichter der Baukräne
    for (const L of this.siteLights) {
      const s = 22 * zf;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(glowTinted('#ff2a20'), L.sx - s / 2, L.sy - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Wetter
    if (wx === 'rain' || wx === 'storm') this.drawRain(ctx, dtReal, wx === 'storm' ? 1 : 0.6, state);
    if (wx === 'fog') {
      const g = ctx.createLinearGradient(0, 0, 0, cam.h);
      g.addColorStop(0, 'rgba(215,222,230,0.85)');
      g.addColorStop(1, 'rgba(215,222,230,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cam.w, cam.h);
    }
    if (wx === 'storm') {
      if (Math.random() < dtReal * 0.12) this.flash = 1;
      if (this.flash > 0) {
        ctx.fillStyle = `rgba(230,235,255,${this.flash * 0.55})`;
        ctx.fillRect(0, 0, cam.w, cam.h);
        this.flash = Math.max(0, this.flash - dtReal * 4);
      }
    }

    // Overlays: Positionen, Auswahl, Labels
    this.drawOverlays(state, ui);
  }

  // Pistenarbeiten / FOD-Kontrolle: Sperrkreuze, frische Deckschicht, Fahrzeuge auf der Piste
  drawRunwayWorkGround(state) {
    const ctx = this.ctx, cam = this.cam;
    const p = state.rwyWorking ? (state.projects || []).find((q) => q.id === state.rwyWorking) : null;
    cam.setIso(ctx, 0.01);
    if (p) {
      const rw = stripGeom(p.strip || 'N');
      const x = rw.x0 + 4 + (rw.x1 - rw.x0 - 8) * p.prog;
      ctx.fillStyle = p.target === 'resurface' ? 'rgba(20,20,24,0.55)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(rw.x0 + 0.3, rw.y - rw.hw + 0.05, x - rw.x0 - 0.3, 2 * rw.hw - 0.1);
    }
    for (const strip of state.upgrades.rwy2 ? ['N', 'S'] : ['N']) {
      if (!runwayClosed(state, strip)) continue;
      const rw = stripGeom(strip);
      // weiße Sperrkreuze
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 0.28;
      ctx.lineCap = 'butt';
      for (const cx of [rw.x0 + 6, rw.x1 - 6, (rw.x0 + rw.x1) / 2]) {
        ctx.beginPath();
        ctx.moveTo(cx - 1.4, rw.y - 0.85);
        ctx.lineTo(cx + 1.4, rw.y + 0.85);
        ctx.moveTo(cx - 1.4, rw.y + 0.85);
        ctx.lineTo(cx + 1.4, rw.y - 0.85);
        ctx.stroke();
      }
    }
  }

  runwayWorkItems(state, items, lights) {
    const t = this.time;
    const mk = (id, type, x, y, hdg) => {
      const fv = { id, type, x, y, hdg, st: 'work', brokenUntil: 0 };
      items.push({ d: x + y, f: () => this.drawVehicle(state, fv, lights) });
    };
    if (state.rwyWorking) {
      const p = (state.projects || []).find((q) => q.id === state.rwyWorking);
      const rw = stripGeom((p && p.strip) || 'N');
      const x = rw.x0 + 4 + (rw.x1 - rw.x0 - 8) * (p ? p.prog : 0);
      const types = p && p.target === 'resurface' ? ['catering', 'fuel', 'baggage', 'tug'] : ['cleaning', 'fuel', 'cleaning', 'tug'];
      types.forEach((ty, i) => mk(`rw${i}`, ty, x + (i - 1.5) * 1.5 + Math.sin(t * 0.4 + i) * 0.35, rw.y + (i % 2 ? 0.45 : -0.45), Math.PI));
    } else if (state.rwyClosedUntil > state.time && (state.rwyClosedWhy || '').startsWith('FOD')) {
      // Kontrollfahrzeug fährt die Piste ab
      const rw = stripGeom(state.rwyClosedStrip || 'N');
      const span = rw.x1 - rw.x0 - 2;
      const u = (t * 1.4) % (2 * span);
      const fwd = u < span;
      mk('fod', 'tug', rw.x0 + 1 + (fwd ? u : 2 * span - u), rw.y + (fwd ? -0.5 : 0.5), fwd ? 0 : Math.PI);
    }
  }

  viewRect() {
    const c = this.cam;
    const p = [c.toWorld(0, 0), c.toWorld(c.w, 0), c.toWorld(c.w, c.h + 200), c.toWorld(0, c.h + 200)];
    return { x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), y0: Math.min(...p.map((q) => q.y)), y1: Math.max(...p.map((q) => q.y)), c };
  }

  // ---------- Gebäude ----------
  drawBuilding(b) {
    if (b.id === 'parking') return this.drawGarage(b);
    const img = IMG[b.sprite];
    if (!img) return;
    const ctx = this.ctx, cam = this.cam;
    cam.setScreen(ctx);
    const dw = (b.w + b.d) * HALF_W * cam.zoom;
    const dh = (dw * img.height) / img.width;
    const fc = cam.toScreen(b.fx, b.fy);
    ctx.drawImage(img, fc.x - b.frac * dw, fc.y - dh, dw, dh);
    if (b.id === 'tower' || b.id === 'hangar') {
      // Höhe der Gebäudespitze für Hindernisfeuer
      const cx = b.fx - b.w / 2, cy = b.fy - b.d / 2;
      const cb = cam.toScreen(cx, cy);
      const z = (cb.y - (fc.y - dh * (b.id === 'tower' ? 0.985 : 0.9))) / (ZS * cam.zoom);
      this.topZ[b.id] = z;
      this.topZ[b.id + 'X'] = cx;
      this.topZ[b.id + 'Y'] = cy;
    }
    this.picks.push({ type: 'building', id: b.id, x: fc.x, y: fc.y - dh * 0.45, r: dw * 0.35 });
  }

  drawLot(state) {
    const ctx = this.ctx, cam = this.cam;
    const lvl = state.upgrades.parking || 0;
    if (!this.lot || this.lot.lvl !== lvl) this.lot = { lvl, ...bakeLot(lvl) };
    const L = this.lot;
    cam.setScreen(ctx);
    const k = cam.zoom / L.Z;
    const p = cam.toScreen(56, 2.0);
    ctx.drawImage(L.c, p.x - L.fx * k, p.y - L.fy * k, L.c.width * k, L.c.height * k);
  }

  // Parkhaus: prozedural und maßstabsgerecht (Etagen je Ausbaustufe), einmal vorgerendert
  drawGarage(b) {
    const ctx = this.ctx, cam = this.cam;
    const lvl = this.garageLevel || 0;
    const key = 'g' + lvl;
    if (!this.garage || this.garage.key !== key) this.garage = { key, ...bakeGarage(b, lvl) };
    const G = this.garage;
    this.topZ.garage = (3 + lvl) * 0.3 + 0.08;
    this.topZ.garageCorners = [[b.fx - b.w, b.fy - b.d], [b.fx, b.fy - b.d], [b.fx, b.fy], [b.fx - b.w, b.fy]];
    cam.setScreen(ctx);
    const k = cam.zoom / G.Z;
    const fc = cam.toScreen(b.fx, b.fy);
    ctx.drawImage(G.c, fc.x - G.fx * k, fc.y - G.fy * k, G.c.width * k, G.c.height * k);
    // Ausbau im Gange: neues Parkdeck wächst auf dem Dach (Stützen, Schalung, Beton nach Fortschritt)
    const pj = (this.state && (this.state.projects || []).find((q) => q.kind === 'upgrade' && q.target === 'parking' && q.status !== 'waiting')) || null;
    if (pj) {
      const x0 = b.fx - b.w, y0 = b.fy - b.d, x1 = b.fx, y1 = b.fy;
      const z0 = (3 + lvl) * 0.3 + 0.02, z1 = z0 + 0.3;
      const pr = clamp(pj.prog, 0, 1);
      const colH = z0 + 0.27 * clamp(pr * 2.5, 0.1, 1);
      for (let x = x0 + 0.15; x <= x1 - 0.1; x += 1.3) for (const yy of [y0 + 0.1, y0 + 1.3, y0 + 2.9, y1 - 0.12]) prism(ctx, cam, rectPts(x + 0.04, yy + 0.04, 0.08, 0.08, 0), z0, colH, [150, 146, 138], [120, 116, 110], [96, 92, 88]);
      if (pr > 0.35) {
        const u = clamp((pr - 0.35) / 0.65, 0, 1);
        const xe = x0 + (x1 - x0) * u;
        // Schalung (Holz) vor dem Beton, Beton dahinter
        prism(ctx, cam, [{ x: x0, y: y0 }, { x: Math.min(x1, xe + 0.8), y: y0 }, { x: Math.min(x1, xe + 0.8), y: y1 }, { x: x0, y: y1 }], z1 - 0.05, z1 - 0.035, [176, 124, 68], [140, 98, 54], [110, 76, 42]);
        prism(ctx, cam, [{ x: x0, y: y0 }, { x: xe, y: y0 }, { x: xe, y: y1 }, { x: x0, y: y1 }], z1 - 0.035, z1 + 0.02, [178, 176, 170], [146, 144, 138], [116, 114, 108]);
      }
    }
    this.picks.push({ type: 'building', id: b.id, x: fc.x - G.c.width * k * 0.3, y: fc.y - G.c.height * k * 0.45, r: G.c.width * k * 0.35 });
  }

  drawTerminalSlice(xa, xb, last, night) {
    const ctx = this.ctx, cam = this.cam;
    const T = LY.TERMINAL;
    const h = T.h;
    // Dach (einmal vorgerendert, je Scheibe nur ein Ausschnitt – Musterfüllung ist teuer)
    cam.setIso(ctx, h);
    const roof = this.roofCanvas || (this.roofCanvas = makeRoof(T));
    const PX = roof.px;
    const sx = Math.max(0, (xa - 0.01 - T.x0) * PX), ex = Math.min(roof.width, (xb + 0.02 - T.x0) * PX);
    if (ex > sx) ctx.drawImage(roof, sx, 0, ex - sx, roof.height, T.x0 + sx / PX, T.y0, (ex - sx) / PX, T.y1 - T.y0);
    // Fassaden
    this.facade(xa, xb, T.y1, h, 'x', 0, night);
    if (last) this.facade(T.y0, T.y1, T.x1, h, 'y', 0.22, night);
  }

  // Fassadentextur affin auf eine Wand legen
  facade(a0, a1, fixed, h, axis, shade, night) {
    const img = IMG.tex_facade;
    const ctx = this.ctx, cam = this.cam;
    const z = cam.zoom, dpr = cam.dpr;
    const rep = 2.1;
    const IW = img ? img.width : 1, IH = img ? img.height : 1;
    const base = axis === 'x' ? LY.TERMINAL.x0 : LY.TERMINAL.y0;
    const start = base + Math.floor((a0 - base) / rep) * rep;
    for (let rs = start; rs < a1 - 1e-6; rs += rep) {
      const s0 = Math.max(a0, rs), s1 = Math.min(a1, rs + rep + 0.01);
      if (s1 <= s0) continue;
      const p = axis === 'x' ? cam.toScreen(rs, fixed, h) : cam.toScreen(fixed, rs, h);
      const ux = axis === 'x' ? HALF_W * z : -HALF_W * z;
      const uy = HALF_H * z;
      ctx.setTransform(((ux * rep) / IW) * dpr, ((uy * rep) / IW) * dpr, 0, ((ZS * z * h) / IH) * dpr, p.x * dpr, p.y * dpr);
      const u0 = ((s0 - rs) / rep) * IW, u1 = ((s1 - rs) / rep) * IW;
      if (img) ctx.drawImage(img, u0, 0, u1 - u0, IH, u0, 0, u1 - u0, IH);
      else {
        ctx.fillStyle = '#7fa6c8';
        ctx.fillRect(u0, 0, u1 - u0, IH);
      }
      if (shade) {
        ctx.fillStyle = `rgba(0,10,30,${shade})`;
        ctx.fillRect(u0, 0, u1 - u0, IH);
      }
      if (night > 0.05 && img) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = night * 0.42;
        ctx.fillStyle = '#ffc070';
        ctx.fillRect(u0, IH * 0.08, u1 - u0, IH * 0.84);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  drawBridge(state, st) {
    const ctx = this.ctx, cam = this.cam;
    const ac = st.occ ? state.acs.find((a) => a.id === st.occ) : null;
    const root = LY.bridgeRoot(st);
    const park = { x: st.x - 0.95, y: 15.75 };
    const door = ac ? LY.bridgeDoor(st, ac.len) : park;
    const e = st.bridge || 0;
    const end = { x: lerp(park.x, door.x - 0.12, e), y: lerp(park.y, door.y, e) };
    // Rotunde (Glas-Drehturm am Terminal)
    prism(ctx, cam, rectPts(root.x, root.y + 0.12, 0.36, 0.36, 0), 0, 0.5, [120, 132, 146], [92, 110, 130], [70, 86, 104]);
    prism(ctx, cam, rectPts(root.x, root.y + 0.12, 0.4, 0.4, 0), 0.5, 0.58, [196, 202, 210], [160, 168, 178], [130, 138, 150]);
    // Tunnel
    const ang = Math.atan2(end.y - root.y, end.x - root.x);
    const len = Math.hypot(end.x - root.x, end.y - root.y);
    const mid = { x: (root.x + end.x) / 2, y: (root.y + end.y) / 2 };
    // Stütze mit Fahrwerk
    const lx = end.x - Math.cos(ang) * 0.34, ly = end.y - Math.sin(ang) * 0.34;
    prism(ctx, cam, rectPts(lx, ly, 0.22, 0.12, ang + Math.PI / 2), 0, 0.05, [40, 44, 50], [30, 33, 38], [22, 24, 28]);
    prism(ctx, cam, rectPts(lx, ly, 0.05, 0.05, ang), 0.05, 0.38, [110, 116, 124], [80, 86, 94], [60, 64, 70]);
    prism(ctx, cam, rectPts(mid.x, mid.y, len, 0.22, ang), 0.38, 0.58, [204, 208, 214], [168, 176, 186], [132, 140, 152]);
    // Fensterband an beiden Tunnelseiten
    cam.setScreen(ctx);
    const nx = -Math.sin(ang) * 0.111, ny = Math.cos(ang) * 0.111;
    for (const sgn of [1, -1]) {
      if ((nx * sgn + ny * sgn) <= 0) continue; // nur die zum Betrachter gewandte Seite
      const a = cam.toScreen(root.x + nx * sgn, root.y + ny * sgn, 0.44), b = cam.toScreen(end.x + nx * sgn, end.y + ny * sgn, 0.44);
      const c = cam.toScreen(end.x + nx * sgn, end.y + ny * sgn, 0.52), d = cam.toScreen(root.x + nx * sgn, root.y + ny * sgn, 0.52);
      ctx.fillStyle = 'rgba(40,64,92,0.85)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    }
    // Kabine am Flugzeug
    prism(ctx, cam, rectPts(end.x, end.y, 0.3, 0.3, ang), 0.36, 0.6, [214, 218, 224], [120, 138, 160], [96, 112, 132]);
  }

  drawTree(t) {
    const img = IMG[t.t];
    if (!img) return;
    const ctx = this.ctx, cam = this.cam;
    cam.setScreen(ctx);
    const p = cam.toScreen(t.x, t.y);
    const base = t.t === 'tree1' ? 1.25 : 0.45;
    const dw = base * t.s * HALF_W * 2 * cam.zoom * 0.62;
    const dh = (dw * img.height) / img.width;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#10200a';
    ctx.beginPath();
    ctx.ellipse(p.x + dw * 0.18, p.y - dw * 0.02, dw * 0.42, dw * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(img, p.x - dw / 2, p.y - dh * 0.97, dw, dh);
  }

  drawCar(p, car, night, lights) {
    const ctx = this.ctx, cam = this.cam;
    // Schatten
    cam.setIso(ctx, 0);
    ctx.save();
    ctx.translate(p.x + 0.06, p.y + 0.03);
    ctx.rotate(p.h);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(-0.16, -0.07, 0.32, 0.14);
    ctx.restore();
    drawCarBody(ctx, cam, p.x, p.y, p.h, car.c, prism, carShades, cam.zoom < 0.7);
    if (night > 0.2) {
      lights.push({ x: p.x + Math.cos(p.h) * 0.3, y: p.y + Math.sin(p.h) * 0.3, z: 0.03, c: '#fff4d0', s: 14, a: 0.7 });
      lights.push({ x: p.x - Math.cos(p.h) * 0.18, y: p.y - Math.sin(p.h) * 0.18, z: 0.03, c: '#ff3020', s: 8, a: 0.7 });
    }
  }

  // Fahrzeuge der Belebung: Auto, Taxi, Bus, Follow-me, Kipper
  drawAmbientCar(c, p, night, lights) {
    const ctx = this.ctx, cam = this.cam;
    const a = p.alpha ?? 1;
    const fx = Math.cos(p.h), fy = Math.sin(p.h), rx = -fy, ry = fx;
    const rect = (f0, f1, s, z0, z1, top, sa, sb) => prism(ctx, cam, [
      { x: p.x + fx * f0 + rx * s, y: p.y + fy * f0 + ry * s },
      { x: p.x + fx * f1 + rx * s, y: p.y + fy * f1 + ry * s },
      { x: p.x + fx * f1 - rx * s, y: p.y + fy * f1 - ry * s },
      { x: p.x + fx * f0 - rx * s, y: p.y + fy * f0 - ry * s },
    ], z0, z1, top, sa, sb);
    // Schatten
    cam.setIso(ctx, 0);
    ctx.save();
    ctx.globalAlpha = 0.28 * a;
    ctx.translate(p.x + 0.06, p.y + 0.03);
    ctx.rotate(p.h);
    ctx.fillStyle = '#000';
    const len = c.kind === 'bus' ? 0.42 : c.kind === 'dump' ? 0.3 : 0.16;
    ctx.fillRect(-len, -0.08, len * 2, 0.16);
    ctx.restore();
    ctx.globalAlpha = a;
    if (c.kind === 'bus') {
      const cs = carShades(c.col);
      rect(-0.4, 0.4, 0.085, 0.02, 0.2, cs.top, cs.a, cs.b);
      // Fensterband
      rect(-0.36, 0.38, 0.087, 0.11, 0.17, [40, 60, 84], [34, 52, 74], [26, 40, 58]);
    } else if (c.kind === 'dump') {
      rect(0.12, 0.3, 0.075, 0.02, 0.15, [245, 158, 11], [200, 120, 8], [160, 96, 6]);
      rect(-0.3, 0.1, 0.085, 0.03, 0.13, [120, 110, 100], [96, 88, 80], [70, 64, 58]);
      rect(-0.26, 0.06, 0.07, 0.13, 0.15, [150, 120, 80], [120, 96, 64], [96, 76, 50]);
    } else {
      drawCarBody(ctx, cam, p.x, p.y, p.h, c.col, prism, carShades, cam.zoom < 0.7);
      if (c.kind === 'taxi') rect(-0.02, 0.03, 0.02, 0.095, 0.11, [255, 255, 255], [220, 220, 220], [190, 190, 190]);
      if (c.kind === 'followme') {
        rect(-0.1, 0.1, 0.066, 0.059, 0.062, [20, 20, 20], [20, 20, 20], [20, 20, 20]);
        if ((this.ambient.vt * 2) % 1 < 0.5) lights.push({ x: p.x, y: p.y, z: 0.12, c: '#ffae00', s: 14, a: 0.9, day: true });
      }
    }
    ctx.globalAlpha = 1;
    if (night > 0.2 && a > 0.5) {
      const L = c.kind === 'bus' ? 0.45 : 0.3;
      lights.push({ x: p.x + fx * L, y: p.y + fy * L, z: 0.03, c: '#fff4d0', s: 14, a: 0.7 });
      lights.push({ x: p.x - fx * L * 0.6, y: p.y - fy * L * 0.6, z: 0.03, c: '#ff3020', s: 8, a: 0.7 });
    }
  }

  drawWindsock(state) {
    const ctx = this.ctx, cam = this.cam;
    cam.setScreen(ctx);
    const base = cam.toScreen(66, 35.4, 0), top = cam.toScreen(66, 35.4, 0.5);
    ctx.strokeStyle = '#d9d9d9';
    ctx.lineWidth = Math.max(1, 1.6 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    const to = ((state.wind.dir + 180 - 90) * Math.PI) / 180; // Weltwinkel, in den der Wind weht
    const L = 0.18 + 0.3 * clamp(state.wind.spd / 15, 0, 1);
    const droop = 0.12 * (1 - clamp(state.wind.spd / 15, 0, 1));
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const a = i / segs, b = (i + 1) / segs;
      const p0 = cam.toScreen(66 + Math.cos(to) * L * a, 35.6 + Math.sin(to) * L * a, 0.5 - droop * a);
      const p1 = cam.toScreen(66 + Math.cos(to) * L * b, 35.6 + Math.sin(to) * L * b, 0.5 - droop * b);
      ctx.strokeStyle = i % 2 ? '#f5f5f5' : '#ff6a00';
      ctx.lineWidth = Math.max(1, (4.5 - i * 0.8) * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  // ---------- Flugzeuge ----------
  drawAircraft(state, ac, lights, night, ui) {
    const ctx = this.ctx, cam = this.cam;
    const type = AC_TYPES[ac.type];
    const img = IMG[type.sprite];
    const L = ac.len;
    const Wd = img ? (L * img.width) / img.height : L;
    const rot = ac.hdg + Math.PI / 2;
    // Schatten
    const sh = shadowOf(type.sprite);
    if (sh) {
      cam.setIso(ctx, 0);
      ctx.globalAlpha = clamp(0.38 - ac.z * 0.06, 0.07, 0.38);
      ctx.save();
      const sOff = L * 0.06 + ac.z * 0.9;
      ctx.translate(ac.x + sOff, ac.y + sOff * 0.35);
      ctx.rotate(rot);
      ctx.drawImage(sh, -Wd / 2, -L / 2, Wd, L);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    const onGround = ac.mode !== 'air' && ac.z < 0.05;
    if (ui && ui.selected === ac.id) this.selRing(ac.x, ac.y, L * 0.62, ac.z);
    const mk = markOf(ac);
    if (mk) {
      // Markierung: gestrichelter Ring in Markierungsfarbe
      cam.setIso(ctx, 0.02);
      ctx.strokeStyle = mk.hex;
      ctx.lineWidth = 0.09;
      ctx.setLineDash([0.28, 0.16]);
      ctx.lineDashOffset = -this.time * 0.4;
      ctx.beginPath();
      ctx.arc(ac.x, ac.y, L * 0.74, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    // Körper mit Volumen (Fahrwerk, Flügel, Triebwerke, runder Rumpf)
    const al = AIRLINES[ac.airline] || AIRLINES.AUR;
    const body = drawAircraftBody(ctx, cam, ac, img, type.sprite, L, Wd, rot, onGround, al.color);
    const zb = body.wing;
    // Seitenleitwerk in Airline-Farbe, sitzt auf dem Rumpfrücken
    const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg);
    const fh = type.finH * 0.8;
    const zf = body.top - body.r * 0.25;
    const P = (f, z) => cam.toScreen(ac.x + fx * f * L, ac.y + fy * f * L, zf + z);
    cam.setScreen(ctx);
    const a = P(-0.49, 0), b = P(-0.47, fh), c = P(-0.39, fh), d = P(-0.25, 0);
    // Seite zum Betrachter etwas dunkler, je nach Blickwinkel
    const side = Math.abs(fx - fy) / 1.42;
    ctx.fillStyle = al.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(0.6, 0.8 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(8,12,24,${0.08 + 0.22 * (1 - side)})`;
    ctx.fill();
    ctx.stroke();
    const m1 = P(-0.465, fh * 0.55), m2 = P(-0.37, fh * 0.55), m3 = P(-0.355, fh * 0.72), m4 = P(-0.47, fh * 0.72);
    ctx.fillStyle = al.color2;
    ctx.beginPath();
    ctx.moveTo(m1.x, m1.y);
    ctx.lineTo(m2.x, m2.y);
    ctx.lineTo(m3.x, m3.y);
    ctx.lineTo(m4.x, m4.y);
    ctx.fill();
    // Vorderkante glänzt
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(0.6, 1 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();

    // Lichter
    const t = this.time;
    const rx = -fy, ry = fx;
    const span = Wd * 0.48;
    const moving = ac.phase !== PH.STAND;
    if (ac.engines || moving) {
      if ((t + (ac.id.length % 7) * 0.13) % 1.2 < 0.14) lights.push({ x: ac.x, y: ac.y, z: body.top + 0.02, c: '#ff2a1a', s: 26, a: 0.95, day: true });
      lights.push({ x: ac.x - rx * span, y: ac.y - ry * span, z: zb, c: '#ff2020', s: 11, a: 0.8 });
      lights.push({ x: ac.x + rx * span, y: ac.y + ry * span, z: zb, c: '#20ff60', s: 11, a: 0.8 });
    }
    const onRwy = [PH.FINAL, PH.ROLLOUT, PH.LINED, PH.TAKEOFF, PH.MISSED, PH.LINEUP].includes(ac.phase);
    if (onRwy && (t % 1.1 < 0.06 || (t % 1.1 > 0.16 && t % 1.1 < 0.22))) {
      lights.push({ x: ac.x - rx * span, y: ac.y - ry * span, z: zb, c: '#ffffff', s: 30, a: 1, day: true });
      lights.push({ x: ac.x + rx * span, y: ac.y + ry * span, z: zb, c: '#ffffff', s: 30, a: 1, day: true });
    }
    if ([PH.FINAL, PH.TAKEOFF, PH.ROLLOUT, PH.MISSED].includes(ac.phase) || (night > 0.3 && [PH.TAXI_IN, PH.TAXI_OUT, PH.LINEUP].includes(ac.phase))) {
      lights.push({ x: ac.x + fx * L * 0.55, y: ac.y + fy * L * 0.55, z: zb, c: '#fff8e0', s: 34, a: 0.9 });
      lights.push({ x: ac.x + fx * L * 1.6, y: ac.y + fy * L * 1.6, z: 0, c: '#fff2d0', s: 70, a: 0.35 * (ac.z < 1.5 ? 1 : 0), flat: true, soft: true });
    }
    const sp = cam.toScreen(ac.x, ac.y, body.mid);
    this.picks.push({ type: 'ac', id: ac.id, x: sp.x, y: sp.y, r: Math.max(14, L * 22 * cam.zoom) });
  }

  selRing(x, y, r, z) {
    const ctx = this.ctx, cam = this.cam;
    cam.setIso(ctx, 0.02);
    const pulse = 1 + Math.sin(this.time * 5) * 0.06;
    ctx.strokeStyle = 'rgba(80,220,255,0.95)';
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(80,220,255,0.12)';
    ctx.fill();
  }

  drawVehicle(state, v, lights) {
    const ctx = this.ctx, cam = this.cam;
    const vt = VEH_TYPES[v.type];
    const img = IMG[vt.sprite];
    const L = vt.len * 1.15;
    const Wd = img ? (L * img.width) / img.height : L * 0.4;
    const H = VEH_H[v.type] || 0.1;
    this.vehShadow(vt.sprite, v.x, v.y, v.hdg, L, Wd, H);
    if (img) drawVehicleBody(ctx, cam, vt.sprite, v.x, v.y, v.hdg, L, Wd, H);
    const active = v.st !== 'idle';
    const broken = v.brokenUntil > state.time;
    if ((active && (this.time * 2 + v.x) % 1 < 0.35) || broken) lights.push({ x: v.x, y: v.y, z: H + 0.05, c: broken ? '#ff3030' : '#ffae00', s: 16, a: 0.9, day: true });
    const sp = cam.toScreen(v.x, v.y, 0.1);
    this.picks.push({ type: 'veh', id: v.id, x: sp.x, y: sp.y, r: 10 });
  }

  // Schattenriss eines Fahrzeugs, je nach Höhe versetzt (Sonne von Nordwest)
  vehShadow(sprite, x, y, hdg, L, Wd, H) {
    const ctx = this.ctx, cam = this.cam;
    const sh = shadowOf(sprite);
    cam.setIso(ctx, 0);
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.translate(x + 0.03 + H * 0.55, y + 0.02 + H * 0.25);
    ctx.rotate(hdg + Math.PI / 2);
    if (sh) ctx.drawImage(sh, -Wd / 2 - 0.01, -L / 2 - 0.01, Wd + 0.02, L + 0.02);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(-Wd / 2, -L / 2, Wd, L);
    }
    ctx.restore();
  }

  drawFireTruck(t, lights) {
    const ctx = this.ctx, cam = this.cam;
    const img = IMG.veh_fire;
    const L = 0.75;
    const Wd = img ? (L * img.width) / img.height : 0.3;
    this.vehShadow('veh_fire', t.x, t.y, t.hdg, L, Wd, 0.15);
    if (img) drawVehicleBody(ctx, cam, 'veh_fire', t.x, t.y, t.hdg, L, Wd, 0.15);
    if (t.st !== 'home') {
      const on = (this.time * 3 + t.x) % 1 < 0.5;
      lights.push({ x: t.x, y: t.y, z: 0.22, c: on ? '#3060ff' : '#ff2020', s: 22, a: 1, day: true });
    }
  }

  cloudShadows(ctx, state) {
    const cam = this.cam;
    cam.setIso(ctx, 0);
    const n = state.weather.kind === 'clouds' ? 5 : 8;
    const t = this.time * 0.25 + state.time * 0.002;
    const wd = ((state.wind.dir + 180 - 90) * Math.PI) / 180;
    ctx.fillStyle = state.weather.kind === 'clouds' ? 'rgba(20,30,40,0.10)' : 'rgba(20,30,40,0.14)';
    for (let i = 0; i < n; i++) {
      const bx = ((i * 37.7 + Math.cos(wd) * t * 3) % 120) - 20;
      const by = ((i * 23.3 + Math.sin(wd) * t * 3) % 70) - 14;
      const x = ((bx % 120) + 120) % 120 - 20, y = ((by % 70) + 70) % 70 - 14;
      ctx.beginPath();
      ctx.ellipse(x, y, 7 + (i % 3) * 3, 4 + (i % 2) * 2, i, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawRain(ctx, dt, amount, state) {
    const cam = this.cam;
    const n = Math.round(260 * amount);
    while (this.rain.length < n) this.rain.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, v: 500 + Math.random() * 400 });
    this.rain.length = n;
    cam.setScreen(ctx);
    ctx.strokeStyle = 'rgba(190,210,235,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const wx = Math.sin(((state.wind.dir + 180) * Math.PI) / 180) * 0.25;
    for (const r of this.rain) {
      r.y += r.v * dt;
      r.x += r.v * wx * dt;
      if (r.y > cam.h) {
        r.y = -10;
        r.x = Math.random() * cam.w;
      }
      if (r.x > cam.w) r.x -= cam.w;
      if (r.x < 0) r.x += cam.w;
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + wx * 14, r.y + 14);
    }
    ctx.stroke();
  }

  // ---------- statische Lichter ----------
  staticLights(state, lights, night) {
    if (night < 0.05) {
      // tagsüber nur Blitzfolge der Anflugbefeuerung
    }
    const rw = LY.RWY;
    const t = this.time;
    if (night > 0.05 && state.upgrades.rwy2) {
      // Südbahn: Randfeuer, Schwellen, Rollweg B, Anflugbefeuerung
      const S = LY.RWY_S;
      for (let x = S.x0 + 0.5; x <= S.x1 - 0.5; x += 2) {
        lights.push({ x, y: S.y - S.hw - 0.05, c: '#fff6dc', s: 9, a: 0.9 });
        lights.push({ x, y: S.y + S.hw + 0.05, c: '#fff6dc', s: 9, a: 0.9 });
      }
      const dS = LY.rwyDir(state.rwy);
      const thrS = S.thr[state.rwy], endS = S.thr[state.rwy === '27' ? '09' : '27'];
      for (let yy = -1.1; yy <= 1.1; yy += 0.36) {
        lights.push({ x: thrS - dS * 0.2, y: S.y + yy, c: '#30ff60', s: 12, a: 1 });
        lights.push({ x: endS + dS * 0.2, y: S.y + yy, c: '#ff2a20', s: 12, a: 1 });
      }
      for (let x = 8; x <= 72; x += 1.4) lights.push({ x, y: LY.TWY_B, c: '#30ff80', s: 6, a: 0.8 });
      for (const c of LY.CROSS) for (let d = -0.55; d <= 0.56; d += 0.22) lights.push({ x: c + d, y: LY.HOLD_CROSS, c: '#ffb020', s: 7, a: 0.9 });
      const rabbitS = Math.floor((t * 16 + 7) % 20);
      for (let i = 1; i <= 16; i++) {
        const x = thrS - dS * (i * 1.1 + 0.8);
        lights.push({ x, y: S.y, c: '#fff4e0', s: 10, a: 0.9 });
        if (16 - i === rabbitS) lights.push({ x, y: S.y, z: 0.05, c: '#ffffff', s: 30, a: 1, day: true });
      }
    }
    if (night > 0.05) {
      for (let x = rw.x0 + 0.5; x <= rw.x1 - 0.5; x += 2) {
        const c = '#fff6dc';
        lights.push({ x, y: rw.y - rw.hw - 0.05, c, s: 9, a: 0.9 });
        lights.push({ x, y: rw.y + rw.hw + 0.05, c, s: 9, a: 0.9 });
      }
      const dir = LY.rwyDir(state.rwy);
      const thr = rw.thr[state.rwy], end = rw.thr[state.rwy === '27' ? '09' : '27'];
      for (let yy = -1.1; yy <= 1.1; yy += 0.36) {
        lights.push({ x: thr - dir * 0.2, y: rw.y + yy, c: '#30ff60', s: 12, a: 1 });
        lights.push({ x: end + dir * 0.2, y: rw.y + yy, c: '#ff2a20', s: 12, a: 1 });
      }
      // Rollweg-Mittellinie (grün) & Kanten (blau)
      for (let x = 8; x <= 72; x += 1.4) {
        lights.push({ x, y: LY.TWY_A, c: '#30ff80', s: 6, a: 0.8 });
        if (Math.round(x * 10) % 28 === 0) {
          lights.push({ x, y: LY.TWY_A - 0.75, c: '#3a6bff', s: 7, a: 0.8 });
          lights.push({ x, y: LY.TWY_A + 0.75, c: '#3a6bff', s: 7, a: 0.8 });
        }
      }
      for (let x = 12; x <= 66; x += 1.6) lights.push({ x, y: LY.LANE, c: '#30ff80', s: 5, a: 0.6 });
      // Vorfeld-Flutlicht
      for (let x = 14; x <= 66; x += 8) {
        lights.push({ x, y: 20.3, z: 0, c: '#ffd9a0', s: 260, a: 0.2, flat: true, soft: true });
        lights.push({ x, y: LY.LANE + 1.6, z: 1.4, c: '#ffe8c0', s: 18, a: 0.9 });
      }
      // Straßenlaternen
      for (let x = -6; x <= 86; x += 5) lights.push({ x, y: 1.0, z: 0.5, c: '#ffc070', s: 16, a: 0.8 });
      for (let x = -6; x <= 86; x += 5) lights.push({ x, y: 0.3, z: 0, c: '#ffb060', s: 50, a: 0.18, flat: true, soft: true });
      // Tower-Kanzel, Hotel
      lights.push({ x: 76.6, y: 7.6, z: 4.6, c: '#9fffd0', s: 30, a: 0.6 });
      if (state.upgrades.hotel) for (let i = 0; i < 6; i++) lights.push({ x: 17.2, y: 8.5, z: 0.5 + i * 0.4, c: '#ffd890', s: 22, a: 0.35 });
    }
    // Rollhalt-Stoppbalken
    for (const rwy of ['09', '27']) {
      const hx = rw.thr[rwy];
      const cleared = state.acs.some((a) => a.rwy === rwy && (a.phase === PH.LINEUP || a.phase === PH.LINED || ((a.phase === PH.HOLDING || a.phase === PH.TAXI_OUT) && (a.clr.lineup || a.clr.takeoff))));
      if (rwy === state.rwy && night > 0.05) for (let d = -0.55; d <= 0.56; d += 0.22) lights.push({ x: hx + d, y: LY.HOLD_Y, c: cleared ? '#30ff60' : '#ff2020', s: 8, a: 0.95 });
    }
    // Anflugbefeuerung mit Lauflicht
    const dir = LY.rwyDir(state.rwy);
    const thr = rw.thr[state.rwy];
    const n = 16;
    const rabbit = Math.floor((t * 16) % (n + 4));
    for (let i = 1; i <= n; i++) {
      const x = thr - dir * (i * 1.1 + 0.8);
      if (night > 0.05) lights.push({ x, y: rw.y, c: '#fff4e0', s: 10, a: 0.9 });
      if (n - i === rabbit) lights.push({ x, y: rw.y, z: 0.05, c: '#ffffff', s: 30, a: 1, day: true });
      if (i === 8 && night > 0.05) for (let yy = -1; yy <= 1; yy += 0.4) lights.push({ x, y: rw.y + yy, c: '#fff4e0', s: 9, a: 0.9 });
    }
  }

  // ---------- Overlays ----------
  drawOverlays(state, ui) {
    const ctx = this.ctx, cam = this.cam;
    const role = state.role;
    const sites = this.sites || [];
    const showStands = ui && (ui.showStands || role === 'ground' || role === 'manager');
    if (showStands) {
      cam.setScreen(ctx);
      ctx.font = `600 ${Math.max(9, 12 * cam.zoom)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const st of state.stands) {
        const p = cam.toScreen(st.x, LY.LANE - 1.6);
        let col = '#2ecc71', txt = `P${st.id}`;
        const sp = sites.find((q) => (q.p.kind === 'stand' || q.p.kind === 'standL') && q.p.target === st.id);
        if (sp) {
          col = '#fbbf24';
          txt = sp.p.status === 'waiting' ? `P${st.id} ⏳` : `P${st.id} ${Math.floor(sp.p.prog * 100)}%`;
        } else if (!st.built) {
          col = 'rgba(160,160,160,0.8)';
          txt = `P${st.id} +`;
        } else if (st.occ) col = '#94a3b8';
        else if (st.resv) col = '#3b82f6';
        const hl = ui && (ui.hoverStand === st.id || ui.selStand === st.id);
        const r = Math.max(9, 13 * cam.zoom) * (hl ? 1.25 : 1);
        ctx.fillStyle = 'rgba(10,15,25,0.72)';
        const wl = sp ? 2.3 : 1.6;
        roundRect(ctx, p.x - r * wl, p.y - r * 0.7, r * wl * 2, r * 1.4, 4);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = hl ? 2.5 : 1.5;
        ctx.stroke();
        ctx.fillStyle = col === '#94a3b8' ? '#e2e8f0' : col;
        ctx.fillText(txt, p.x, p.y + 0.5);
        this.picks.push({ type: 'stand', id: st.id, x: p.x, y: p.y, r: r * 1.6 });
      }
    }
    // Ausgewählter Rollweg
    const sel = ui && ui.selected ? state.acs.find((a) => a.id === ui.selected) : null;
    if (sel && sel.mode === 'map' && sel.path && sel.pi < sel.path.length - 1) {
      cam.setIso(ctx, 0.02);
      ctx.strokeStyle = 'rgba(80,220,255,0.85)';
      ctx.lineWidth = 0.09;
      ctx.setLineDash([0.35, 0.25]);
      ctx.beginPath();
      ctx.moveTo(sel.x, sel.y);
      for (let i = sel.pi + 1; i < sel.path.length; i++) ctx.lineTo(sel.path[i].x, sel.path[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Baustellen-Schilder (Manager/Beobachter oder ausgewählt)
    for (const q of sites) {
      const selSite = ui && ui.sel && ui.sel.type === 'site' && ui.sel.id === q.p.id;
      if (role === 'manager' || role === 'observer' || selSite) drawSiteLabel(this, state, q.p, q.g, selSite);
    }
    // Labels
    if (!ui) return;
    cam.setScreen(ctx);
    const fs = Math.round(clamp(11 * Math.sqrt(cam.zoom / 0.6), 9, 13));
    ctx.font = `700 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      const isSel = ui.selected === ac.id;
      const mk = markOf(ac);
      if (!ui.labels && !isSel && !ac.req && !ac.emergency && !mk) continue;
      const p = cam.toScreen(ac.x, ac.y, ac.z + 0.3);
      if (p.x < -80 || p.y < -40 || p.x > cam.w + 80 || p.y > cam.h + 40) continue;
      const line2 = ui.labelFn ? ui.labelFn(ac) : '';
      const line3 = mk && ac.mark.note ? `⚑ ${ac.mark.note}` : '';
      const w1 = ctx.measureText(ac.cs).width;
      ctx.font = `500 ${fs - 1}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const w2 = line2 ? ctx.measureText(line2).width : 0;
      const w3 = line3 ? ctx.measureText(line3).width : 0;
      ctx.font = `700 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const bw = Math.max(w1, w2, w3) + 10 + (mk ? 4 : 0);
      const bh = (line2 ? fs * 2 + 8 : fs + 7) + (line3 ? fs + 2 : 0);
      const bx = p.x + 10, by = p.y - 26 - bh / 2;
      let border = 'rgba(255,255,255,0.25)';
      const sc = ui.seqCol ? ui.seqCol(ac) : null;
      if (ac.req) border = '#fbbf24';
      if (sc) border = sc;
      if (ac.emergency) border = '#f43f5e';
      if (isSel) border = '#38bdf8';
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(bx, by + bh / 2);
      ctx.stroke();
      ctx.fillStyle = isSel ? 'rgba(8,40,60,0.9)' : 'rgba(10,14,22,0.78)';
      roundRect(ctx, bx, by, bw, bh, 4);
      ctx.fill();
      ctx.lineWidth = isSel || ac.req || sc ? 1.8 : 1;
      ctx.stroke();
      const tx = bx + 5 + (mk ? 4 : 0);
      if (mk) {
        ctx.fillStyle = mk.hex;
        ctx.fillRect(bx + 1, by + 1, 4, bh - 2);
      }
      ctx.fillStyle = ac.emergency ? '#fda4af' : '#f8fafc';
      ctx.fillText(ac.cs, tx, by + fs / 2 + 4);
      if (line2 || line3) ctx.font = `500 ${fs - 1}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      if (line2) {
        ctx.fillStyle = sc || (ac.req ? '#fcd34d' : '#94a3b8');
        ctx.fillText(line2, tx, by + fs * 1.5 + 5);
      }
      if (line3) {
        ctx.fillStyle = mk.hex;
        ctx.fillText(line3, tx, by + (line2 ? fs * 2.5 + 6 : fs * 1.5 + 5));
      }
      ctx.font = `700 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    }
  }

  pick(sx, sy, types = null) {
    let best = null, bd = 1e9;
    for (const p of this.picks) {
      if (types && !types.includes(p.type)) continue;
      const d = Math.hypot(p.x - sx, p.y - sy);
      const pri = p.type === 'ac' ? 0 : p.type === 'stand' ? 2 : p.type === 'veh' ? 4 : 12;
      if (d < p.r && d + pri < bd) {
        bd = d + pri;
        best = p;
      }
    }
    return best;
  }
}

// ---------- Hilfsfunktionen ----------
function inView(v, x, y, m) {
  const p = v.c.toScreen(x, y);
  return p.x > -m * 40 * v.c.zoom - 80 && p.x < v.c.w + m * 40 * v.c.zoom + 80 && p.y > -m * 60 * v.c.zoom - 80 && p.y < v.c.h + 200;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function rectPts(cx, cy, l, w, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const hx = l / 2, hy = w / 2;
  return [
    { x: cx - c * hx + s * hy, y: cy - s * hx - c * hy },
    { x: cx + c * hx + s * hy, y: cy + s * hx - c * hy },
    { x: cx + c * hx - s * hy, y: cy + s * hx + c * hy },
    { x: cx - c * hx - s * hy, y: cy - s * hx + c * hy },
  ];
}

// Extrudiertes Polygon mit Licht von links oben
function prism(ctx, cam, pts, z0, z1, cTop, cA, cB) {
  cam.setScreen(ctx);
  const n = pts.length;
  const cx = pts.reduce((t, p) => t + p.x, 0) / n, cy = pts.reduce((t, p) => t + p.y, 0) / n;
  const P0 = pts.map((p) => cam.toScreen(p.x, p.y, z0));
  const P1 = pts.map((p) => cam.toScreen(p.x, p.y, z1));
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    let nx = b.y - a.y, ny = -(b.x - a.x);
    const mx = (a.x + b.x) / 2 - cx, my = (a.y + b.y) / 2 - cy;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (nx + ny <= 1e-4) continue;
    const t = clamp(Math.abs(nx) / (Math.abs(nx) + Math.abs(ny)), 0, 1);
    ctx.fillStyle = rgb(mix(cA, cB, t));
    ctx.beginPath();
    ctx.moveTo(P0[i].x, P0[i].y);
    ctx.lineTo(P0[(i + 1) % n].x, P0[(i + 1) % n].y);
    ctx.lineTo(P1[(i + 1) % n].x, P1[(i + 1) % n].y);
    ctx.lineTo(P1[i].x, P1[i].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = rgb(cTop);
  ctx.beginPath();
  P1.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
}

// Aufbauhöhe der Vorfeldfahrzeuge (Kacheln)
const VEH_H = { tug: 0.075, baggage: 0.07, fuel: 0.13, catering: 0.15, cleaning: 0.1, bus: 0.13 };
// Lackfarbe -> Dach/Seiten + getönte Scheiben (gecacht)
const carShadeCache = {};
function carShades(hex) {
  if (carShadeCache[hex]) return carShadeCache[hex];
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const sc = (f) => c.map((v) => Math.round(v * f));
  return (carShadeCache[hex] = { top: sc(1.0), a: sc(0.72), b: sc(0.5), glassTop: [70, 90, 110], glassA: [38, 52, 68], glassB: [26, 36, 50] });
}

// Autos auf der Landseite
const CAR_COLORS = ['#e2e8f0', '#1f2937', '#b91c1c', '#1d4ed8', '#9ca3af', '#f59e0b', '#065f46', '#f8fafc', '#475569', '#7c2d12'];
function makeCars() {
  const routes = [
    { pts: [{ x: -8, y: -0.4 }, { x: 88, y: -0.4 }], loop: false },
    { pts: [{ x: 88, y: 0.4 }, { x: -8, y: 0.4 }], loop: false },
  ];
  const cars = [];
  for (let i = 0; i < 22; i++) {
    const r = routes[i % 2];
    cars.push({ r, off: (i * 0.0457 * 7) % 1, v: 0.018 + ((i * 7) % 5) * 0.002, c: CAR_COLORS[i % CAR_COLORS.length] });
  }
  return cars;
}
function carPos(car, t) {
  const pts = car.r.pts;
  const u = (car.off + t * car.v) % 1;
  const a = pts[0], b = pts[1];
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, h: Math.atan2(b.y - a.y, b.x - a.x) };
}

// ---------- Boden zeichnen (einmalig in den Cache) ----------
function drawGround(g, state, trees) {
  const grass = pat(g, IMG.tex_grass, 7);
  const concrete = pat(g, IMG.tex_concrete, 2.2);
  const asphalt = pat(g, IMG.tex_asphalt, 4);
  // Gras
  g.fillStyle = grass;
  g.fillRect(RX0, RY0, RX1 - RX0, RY1 - RY0);
  // Mähstreifen auf der Luftseite
  g.fillStyle = 'rgba(255,255,240,0.045)';
  for (let y = 24; y < 42; y += 2.4) g.fillRect(-8, y, 96, 1.2);
  // Unregelmäßige Flecken
  let s = 987;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(40,60,20,0.08)' : 'rgba(200,200,120,0.06)';
    g.beginPath();
    g.ellipse(RX0 + r() * (RX1 - RX0), RY0 + r() * (RY1 - RY0), 1 + r() * 3, 0.6 + r() * 2, r() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // Gebäudeschatten
  for (const b of LY.BUILDINGS) {
    if (b.requires && !state.upgrades[b.requires]) continue;
    const hgt = BH[b.id] || 1;
    const x0 = b.fx - b.w, y0 = b.fy - b.d;
    const L = Math.min(6, hgt * 0.8);
    g.fillStyle = 'rgba(10,20,10,0.16)';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(b.fx + L, y0 - L * 0.1);
    g.lineTo(b.fx + L, b.fy - L * 0.1);
    g.lineTo(x0, b.fy);
    g.closePath();
    g.fill();
  }
  const T = LY.TERMINAL;
  g.fillStyle = 'rgba(10,20,10,0.18)';
  g.fillRect(T.x0, T.y0, T.x1 - T.x0 + 0.8, T.y1 - T.y0);

  // ---- Landseite ----
  g.fillStyle = asphalt;
  g.fillRect(RX0, -0.9, RX1 - RX0, 1.8); // Hauptstraße
  g.fillRect(24.2, 0.9, 12.5, 0.45); // Vorfahrt Terminal
  g.fillRect(16.6, 0.9, 0.8, 4.4); // Hotel
  g.fillRect(50.6, 0.9, 0.8, 3.3); // Parkhaus
  g.fillRect(58, 0.9, 0.8, 1.1);
  g.fillRect(75.9, 0.9, 0.6, 5.9); // Tower
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let x = RX0; x < RX1; x += 1.4) g.fillRect(x, -0.02, 0.7, 0.05);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(RX0, -0.82, RX1 - RX0, 0.04);
  g.fillRect(RX0, 0.78, RX1 - RX0, 0.04);
  // Gehweg
  g.fillStyle = '#b9b5ab';
  g.fillRect(RX0, 0.9, RX1 - RX0, 0.18);
  g.fillRect(RX0, -1.1, RX1 - RX0, 0.2);
  // Parkplatz – maßstabsgerecht (1 Kachel ≈ 15 m): Stellplatz 0,2 × 0,36 Kacheln ≈ 3 × 5,5 m
  const pw = 12.5 + state.upgrades.parking * 2;
  g.fillStyle = asphalt;
  g.fillRect(56, 2.0, pw, 4.6);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (const yy of LOT_ROWS) for (let x = 56.15; x < 56 + pw - 0.15; x += 0.2) g.fillRect(x, yy, 0.012, 0.34);
  // Fahrgassen-Pfeile
  g.fillStyle = 'rgba(255,255,255,0.45)';
  for (const ay of [3.2, 4.65]) for (let x = 57.5; x < 56 + pw - 1; x += 3) g.fillRect(x, ay - 0.02, 0.5, 0.04);
  // Zaun Luft-/Landseite
  g.strokeStyle = 'rgba(60,60,60,0.55)';
  g.lineWidth = 0.05;
  g.setLineDash([0.15, 0.1]);
  g.beginPath();
  g.moveTo(RX0, 10.2);
  g.lineTo(T.x0 - 0.5, 10.2);
  g.moveTo(66, 9.4);
  g.lineTo(RX1, 9.4);
  g.stroke();
  g.setLineDash([]);

  // ---- Vorfeld (Beton) ----
  g.fillStyle = concrete;
  g.fillRect(10.2, T.y1, 58.2, LY.LANE + 1.6 - T.y1); // Hauptvorfeld
  g.fillRect(49.5, 9.6, 25, 11.4); // Fracht/Depot
  g.fillRect(0.6, 21.2, 10.2, 5.8); // Hangar-Vorfeld
  g.fillRect(34.8, 43.9, 5.8, 2.1); // Feuerwache
  g.fillRect(74.4, 12.6, 6, 4.4); // Tanklager
  // Dehnfugen etwas dunkler an Vorfeldkante
  g.strokeStyle = 'rgba(240,200,40,0.9)';
  g.lineWidth = 0.05;
  g.strokeRect(10.25, T.y1 + 0.02, 58.1, LY.LANE + 1.55 - T.y1);

  // ---- Rollwege & Piste (Asphalt) ----
  const tw = 1.35;
  const strokeP = (pts, rad = 1.3) => {
    const p = roundedPath(pts, rad, 0.25);
    g.beginPath();
    p.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
    g.stroke();
  };
  g.strokeStyle = asphalt;
  g.lineWidth = tw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  strokeP([{ x: 6.4, y: LY.TWY_A }, { x: 73.6, y: LY.TWY_A }]);
  for (const x of LY.EXITS) {
    strokeP([{ x, y: LY.RWY.y }, { x, y: LY.TWY_A }]);
    strokeP([{ x: x - 3, y: LY.RWY.y }, { x, y: LY.RWY.y }, { x, y: LY.TWY_A }, { x: x + 3, y: LY.TWY_A }]);
    strokeP([{ x: x + 3, y: LY.RWY.y }, { x, y: LY.RWY.y }, { x, y: LY.TWY_A }, { x: x - 3, y: LY.TWY_A }]);
  }
  for (const c of LY.CONN) {
    strokeP([{ x: c, y: LY.TWY_A }, { x: c, y: LY.LANE + 1 }]);
    strokeP([{ x: c - 3, y: LY.TWY_A }, { x: c, y: LY.TWY_A }, { x: c, y: LY.LANE }, { x: c + 3, y: LY.LANE }]);
    strokeP([{ x: c + 3, y: LY.TWY_A }, { x: c, y: LY.TWY_A }, { x: c, y: LY.LANE }, { x: c - 3, y: LY.LANE }]);
  }
  strokeP([{ x: 5.5, y: 26.8 }, { x: 5.5, y: LY.TWY_A }, { x: 9, y: LY.TWY_A }], 1);
  // Pisten (Nord immer, Süd nach dem Ausbau)
  const two = !!state.upgrades.rwy2;
  const rw = LY.RWY;
  if (two) {
    // Parallelrollweg B, Abrollwege der Südbahn, Kreuzungen der Nordbahn
    const S = LY.RWY_S;
    strokeP([{ x: 6.4, y: LY.TWY_B }, { x: 73.6, y: LY.TWY_B }]);
    for (const x of LY.EXITS_S) {
      strokeP([{ x, y: S.y }, { x, y: LY.TWY_B }]);
      strokeP([{ x: x - 3, y: S.y }, { x, y: S.y }, { x, y: LY.TWY_B }, { x: x + 3, y: LY.TWY_B }]);
      strokeP([{ x: x + 3, y: S.y }, { x, y: S.y }, { x, y: LY.TWY_B }, { x: x - 3, y: LY.TWY_B }]);
    }
    for (const c of LY.CROSS) {
      strokeP([{ x: c, y: LY.TWY_B }, { x: c, y: rw.y }]);
      strokeP([{ x: c - 2.5, y: LY.TWY_B }, { x: c, y: LY.TWY_B }, { x: c, y: rw.y }]);
      strokeP([{ x: c + 2.5, y: LY.TWY_B }, { x: c, y: LY.TWY_B }, { x: c, y: rw.y }]);
    }
    paintRunway(g, S, { '09': '09R', '27': '27L' }, asphalt, state.rwyCondS ?? 100);
  }
  paintRunway(g, rw, two ? { '09': '09L', '27': '27R' } : { '09': '09', '27': '27' }, asphalt, state.rwyCond ?? 88);

  // ---- Gelbe Markierungen ----
  g.strokeStyle = '#f2c81f';
  g.lineWidth = 0.07;
  g.lineCap = 'butt';
  strokeP([{ x: 6.4, y: LY.TWY_A }, { x: 73.6, y: LY.TWY_A }]);
  for (const x of LY.EXITS) {
    strokeP([{ x: x - 3, y: LY.RWY.y }, { x, y: LY.RWY.y }, { x, y: LY.TWY_A }, { x: x + 3, y: LY.TWY_A }], 1.3);
    strokeP([{ x: x + 3, y: LY.RWY.y }, { x, y: LY.RWY.y }, { x, y: LY.TWY_A }, { x: x - 3, y: LY.TWY_A }], 1.3);
  }
  for (const c of LY.CONN) {
    strokeP([{ x: c - 3, y: LY.TWY_A }, { x: c, y: LY.TWY_A }, { x: c, y: LY.LANE }, { x: c + 3, y: LY.LANE }], 1.15);
    strokeP([{ x: c + 3, y: LY.TWY_A }, { x: c, y: LY.TWY_A }, { x: c, y: LY.LANE }, { x: c - 3, y: LY.LANE }], 1.15);
  }
  strokeP([{ x: 12, y: LY.LANE }, { x: 66, y: LY.LANE }]);
  // Rollhalte-Markierungen
  for (const x of LY.EXITS) {
    g.fillStyle = '#f2c81f';
    g.fillRect(x - 0.68, LY.HOLD_Y - 0.12, 1.36, 0.05);
    g.fillRect(x - 0.68, LY.HOLD_Y - 0.02, 1.36, 0.05);
    for (let k = -0.68; k < 0.68; k += 0.28) {
      g.fillRect(k + x, LY.HOLD_Y + 0.1, 0.15, 0.05);
      g.fillRect(k + x, LY.HOLD_Y + 0.2, 0.15, 0.05);
    }
  }
  if (two) {
    g.strokeStyle = '#f2c81f';
    g.lineWidth = 0.07;
    strokeP([{ x: 6.4, y: LY.TWY_B }, { x: 73.6, y: LY.TWY_B }]);
    for (const x of LY.EXITS_S) {
      strokeP([{ x: x - 3, y: LY.RWY_S.y }, { x, y: LY.RWY_S.y }, { x, y: LY.TWY_B }, { x: x + 3, y: LY.TWY_B }], 1.3);
      strokeP([{ x: x + 3, y: LY.RWY_S.y }, { x, y: LY.RWY_S.y }, { x, y: LY.TWY_B }, { x: x - 3, y: LY.TWY_B }], 1.3);
    }
    for (const c of LY.CROSS) {
      strokeP([{ x: c, y: LY.TWY_B }, { x: c, y: rw.y }]);
      // Haltelinie vor der Nordbahn (Kreuzung)
      g.fillStyle = '#f2c81f';
      g.fillRect(c - 0.68, LY.HOLD_CROSS + 0.02, 1.36, 0.05);
      g.fillRect(c - 0.68, LY.HOLD_CROSS + 0.12, 1.36, 0.05);
      for (let k = -0.68; k < 0.68; k += 0.28) {
        g.fillRect(k + c, LY.HOLD_CROSS - 0.1, 0.15, 0.05);
        g.fillRect(k + c, LY.HOLD_CROSS - 0.2, 0.15, 0.05);
      }
      // rote Kreuzungs-Tafel
      g.fillStyle = 'rgba(200,30,30,0.95)';
      g.fillRect(c + 0.8, LY.HOLD_CROSS - 0.15, 0.5, 0.25);
    }
  }
  // Servicestraße
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let x = 10.5; x < 74; x += 0.7) {
    g.fillRect(x, LY.SERVICE - 0.42, 0.4, 0.04);
    g.fillRect(x, LY.SERVICE + 0.38, 0.4, 0.04);
  }
  // Parkpositionen
  for (const st of state.stands) {
    const sx = st.x;
    if (!st.built) {
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 0.05;
      g.setLineDash([0.3, 0.2]);
      g.strokeRect(sx - 2.3, LY.STAND_NOSE - 0.2, 4.6, 5.8);
      g.setLineDash([]);
      continue;
    }
    g.strokeStyle = '#f2c81f';
    g.lineWidth = 0.07;
    strokeP([{ x: sx - 3, y: LY.LANE }, { x: sx, y: LY.LANE }, { x: sx, y: LY.STAND_NOSE + 0.2 }], 1.15);
    strokeP([{ x: sx + 3, y: LY.LANE }, { x: sx, y: LY.LANE }, { x: sx, y: LY.STAND_NOSE + 0.2 }], 1.15);
    g.fillStyle = '#f2c81f';
    g.fillRect(sx - 0.35, LY.STAND_NOSE + 0.12, 0.7, 0.08);
    g.strokeStyle = 'rgba(210,40,40,0.8)';
    g.lineWidth = 0.05;
    const hw = st.size === 'L' ? 2.75 : 2.05;
    g.strokeRect(sx - hw, LY.STAND_NOSE - 0.2, hw * 2, st.size === 'L' ? 6.1 : 4.4);
    // Nummer
    g.save();
    g.translate(sx + 0.9, LY.LANE - 1.4);
    g.scale(0.027, 0.027);
    g.fillStyle = 'rgba(20,20,20,0.85)';
    g.fillRect(-14, -12, 28, 24);
    g.fillStyle = '#f2c81f';
    g.font = '700 18px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(st.id), 0, 1);
    g.restore();
  }
  // Feuerwehrzufahrt (bis zur Nordbahn, über die Südbahn hinweg)
  g.fillStyle = asphalt;
  if (two) {
    g.fillRect(36.9, rw.y + rw.hw + 0.3, 0.9, LY.RWY_S.y - LY.RWY_S.hw - 0.5 - (rw.y + rw.hw + 0.3));
    g.fillRect(36.9, LY.RWY_S.y + LY.RWY_S.hw + 0.4, 0.9, 43.9 - (LY.RWY_S.y + LY.RWY_S.hw + 0.4));
  } else g.fillRect(36.9, rw.y + rw.hw + 0.3, 0.9, 43.9 - (rw.y + rw.hw + 0.3));
}

// Eine Piste mit Markierungen, Kennungen und Anflugbefeuerungs-Masten
function paintRunway(g, rw, names, asphalt, cond = 90) {
  g.fillStyle = 'rgba(150,150,140,0.55)';
  g.fillRect(rw.x0, rw.y - rw.hw - 0.4, rw.x1 - rw.x0, 2 * rw.hw + 0.8);
  g.fillStyle = asphalt;
  g.fillRect(rw.x0, rw.y - rw.hw, rw.x1 - rw.x0, 2 * rw.hw);
  g.fillStyle = `rgba(0,0,0,${0.04 + (1 - cond / 100) * 0.3})`;
  g.fillRect(rw.x0, rw.y - 0.35, rw.x1 - rw.x0, 0.7); // Gummiabrieb
  for (const tx of [rw.thr['09'] + 3, rw.thr['27'] - 11]) g.fillRect(tx, rw.y - 0.5, 8, 1.0);
  // Blast pads
  g.fillStyle = 'rgba(110,110,100,0.9)';
  g.fillRect(rw.x0 - 2, rw.y - rw.hw, 2, 2 * rw.hw);
  g.fillRect(rw.x1, rw.y - rw.hw, 2, 2 * rw.hw);
  g.strokeStyle = '#e8c21a';
  g.lineWidth = 0.1;
  for (const [x0, d] of [[rw.x0, -1], [rw.x1, 1]]) {
    for (let k = 0.4; k < 2; k += 0.55) {
      g.beginPath();
      g.moveTo(x0 + d * (k - 0.4), rw.y - rw.hw + 0.1);
      g.lineTo(x0 + d * k, rw.y);
      g.lineTo(x0 + d * (k - 0.4), rw.y + rw.hw - 0.1);
      g.stroke();
    }
  }
  // Pistenmarkierungen (weiß)
  g.fillStyle = '#f4f4f0';
  g.fillRect(rw.x0 + 0.2, rw.y - rw.hw + 0.08, rw.x1 - rw.x0 - 0.4, 0.07);
  g.fillRect(rw.x0 + 0.2, rw.y + rw.hw - 0.15, rw.x1 - rw.x0 - 0.4, 0.07);
  for (let x = rw.thr['09'] + 5; x < rw.thr['27'] - 5.5; x += 2.4) g.fillRect(x, rw.y - 0.05, 1.4, 0.1);
  for (const rwy of ['09', '27']) {
    const tx = rw.thr[rwy];
    const d = LY.rwyDir(rwy);
    for (let i = 0; i < 12; i++) {
      const yy = rw.y - 1.0 + i * 0.172 + (i >= 6 ? 0.25 : 0);
      if (yy > rw.y + 1.02) continue;
      g.fillRect(d > 0 ? tx + 0.15 : tx - 1.75, yy - 0.2 + 0.2, 1.6, 0.1);
    }
    g.fillRect(tx - 0.04, rw.y - rw.hw + 0.1, 0.08, 2 * rw.hw - 0.2);
    for (const [k, big] of [[3.2, false], [4.6, true], [6.2, false], [7.8, false]]) {
      const x = tx + d * k;
      const len = big ? 1.2 : 0.7;
      const th = big ? 0.28 : 0.09;
      for (const side of [-1, 1]) {
        const y0 = rw.y + side * (big ? 0.45 : 0.4);
        for (let j = 0; j < (big ? 1 : 2); j++) g.fillRect(d > 0 ? x : x - len, y0 + (side > 0 ? j * 0.16 : -j * 0.16 - th), len, th);
      }
    }
    g.save();
    g.translate(tx + d * 2.5, rw.y);
    g.rotate(d > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.scale(0.04, 0.04);
    g.font = '700 30px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(names[rwy], 0, 0);
    g.restore();
  }
  // Anflugbefeuerung (Masten)
  g.fillStyle = 'rgba(80,80,80,0.7)';
  for (const rwy of ['09', '27']) {
    const d = LY.rwyDir(rwy);
    const tx = rw.thr[rwy];
    for (let i = 1; i <= 16; i++) {
      const x = tx - d * (i * 1.1 + 0.8);
      g.fillRect(x - 0.05, rw.y - 0.18, 0.1, 0.36);
      if (i === 8) g.fillRect(x - 0.05, rw.y - 1.1, 0.1, 2.2);
    }
  }
}
