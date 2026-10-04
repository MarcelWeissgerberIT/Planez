// Isometrische Flughafenansicht
import { IMG, shadowOf, glowTinted } from '../assets.js';
import { lookOf } from '../sim/spotter.js';
import { drawAircraftBody, drawVehicleBody, drawCarBody, aircraftDims } from './volume.js';
import { Q } from './quality.js';
import { Ambient, drawPerson } from './ambient.js';
import { gaLifeItems } from './galife.js';
import { busPaxItems } from './buspax.js';
import { carPaint, carKind, hash01, POLICE_BLUE } from './cars.js';
import { stairsTop as doorTop, HELI_DIM } from '../acshape.js';
import { vehVsAc, vehOrder, acParts, personBox } from './occlude.js';
import { beltLoaders } from './beltloader.js';
import { jetBridges } from './jetbridge.js';
import { drawApronBus, drawStairsTruck, boxShadow, stairsSize } from './gse2d.js';
import { drawRailGround, infraItems, treeBlocked } from './infra.js';
import { Polish } from './polish.js';
import { paintHeliBase, heliBaseLights } from './helibase.js';
import { heliOnMap } from '../sim/heli.js';
import { drawSnowCover, drawRunwaySnow, plowItems, deiceFx, drawSnowfall, snowySprite } from './snow.js';
import { updateWetness, drawWetGround, drawWetReflections } from './wet.js';
import { Wildlife } from './wildlife.js';
import { StandCrew } from './standcrew.js';
import { spotterHillItems } from './spotters.js';
import { seasonalTree, seasonalGrass } from './seasonal.js';
import { season as seasonOf } from '../sim/winter.js';
import { HALF_W, HALF_H } from './camera.js';
import * as LY from '../layout.js';
import { AC_TYPES, AIRLINES, VEH_TYPES, ZS, TIME_SCALE } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { hourOf, roundedPath, clamp, lerp } from '../util.js';
import { MARKS } from '../ui/marks.js';
import { siteGeom, drawSiteGround, siteItems, permanentItems, drawSiteLabel } from './sites.js';
import { runwayClosed, stripGeom } from '../sim/runway.js';
import { motorcade } from '../sim/statevisit.js';
import { saluteView } from '../sim/firstflight.js';
import { drawSmallField } from './smallfield.js';
import { drawTerrain, terrainItems, onField } from './terrain.js';
import { followMeCars } from './followme.js';
import { standBuildable } from '../sim/career.js';
import { T as tr_ } from '../i18n.js';
const markOf = (ac) => (ac.mark && MARKS[ac.mark.c] ? MARKS[ac.mark.c] : null);

const BH = { hall: 1.3, tower: 5, hangar: 1.8, cargo: 0.9, depot: 0.7, fire: 1.0, fuel: 0.9, parking: 1.1, hotel: 3.2, radar: 2.6, club: 0.5, gahangar: 0.6, avgas: 0.25, sterm: 0.6, stower: 1.6 };
const MARGIN = 8;
const RX0 = -MARGIN, RY0 = -MARGIN, RX1 = LY.W + MARGIN, RY1 = LY.H + MARGIN;

function pat(ctx, img, tiles) {
  if (!img) return '#6a8f4e';
  const p = ctx.createPattern(img, 'repeat');
  if (p.setTransform) p.setTransform(new DOMMatrix().scale(tiles / img.width));
  return p;
}
// Maßstab der vorgerenderten Ebenen (Parkplatz, Parkhaus): nah herangezoomt feiner, damit nichts verschwimmt
function bakeZ(cam) {
  const z = cam.zoom * Math.min(cam.dpr || 1, 1.5);
  return z > 4.2 ? 6.4 : z > 2.6 ? 4.2 : 2.4;
}
// Parkplatz: Stellplatzreihen und vorgerenderte 3D-Autos (maßstabsgerecht)
const LOT_ROWS = [2.1, 2.48, 3.56, 3.94, 5.02, 5.4, 6.16];
function bakeLot(level, Z = 2.4) {
  const pw = 12.5 + level * 2;
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
      carBody(g, cam, cx, cy, Math.PI / 2 + (rnd() < 0.5 ? 0 : Math.PI), carPaint(rnd()), false, 0.95, 0, true, carKind(rnd()));
    }
  }
  const f = cam.toScreen(x0, y0, 0);
  return { c, Z, fx: f.x, fy: f.y };
}

// Parkhaus vorrendern: Decks mit Stützen, Brüstungen, kleinen 3D-Autos, Treppenhaus mit P-Schild
function bakeGarage(b, level, Z = 2.4) {
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
        carBody(g, cam, x, ry, Math.PI / 2 + (rnd() < 0.5 ? 0 : Math.PI), carPaint(rnd()), false, 0.95, z + 0.02, true, carKind(rnd()));
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
    this.standCrew = new StandCrew();
    this.topZ = {};
    this.fxList = [];
    this.siteCenters = new Map();
    this.polish = new Polish();
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
    return seasonOf(state).id + '|' + LY.GEO.stage + '|' + state.stands.map((s) => (s.built ? s.size : '-')).join('') + '|' + state.upgrades.parking + state.upgrades.hotel + state.upgrades.rapidExit + (state.upgrades.rwy2 || 0) + (state.upgrades.rail || 0) + '|' + Math.round((state.rwyCond ?? 88) / 10) + Math.round((state.rwyCondS ?? 100) / 10);
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

  // Nah herangezoomt: sichtbarer Ausschnitt (mit Rand) in voller Schärfe über dem groben Boden-Cache. Neu gezeichnet wird
  // erst, wenn die Kamera kurz stillsteht (beim Zoomen und Schieben nicht jedes Bild); bis dahin bleibt der alte Ausschnitt
  // liegen, soweit er passt, der Rest kommt aus dem groben Cache.
  groundDetail(state) {
    const cam = this.cam, k = this.cache;
    const sd = Math.min(cam.dpr, 1.5), Z = cam.zoom * sd; // Bildpunkte je Bildschirmpunkt im Ausschnitt
    if (Q.perf || Z < k.cs * 2) return (this.detail = null);
    let d = this.detail;
    if (d && (d.zoom !== cam.zoom || d.sd !== sd || d.key !== this.cacheKey)) d = this.detail = null;
    const covered = d && Math.abs(cam.ox - d.ox) <= d.pw * 0.6 && Math.abs(cam.oy - d.oy) <= d.ph * 0.6;
    if (!covered) {
      const want = `${cam.zoom}|${Math.round(cam.ox)}|${Math.round(cam.oy)}|${this.cacheKey}`;
      const now = performance.now();
      if (this.detailWant !== want) (this.detailWant = want), (this.detailT = now);
      else if (now - this.detailT > 160) {
        const pw = Math.round(cam.w * 0.18), ph = Math.round(cam.h * 0.18);
        const c = d && d.c.width === Math.ceil((cam.w + 2 * pw) * sd) && d.c.height === Math.ceil((cam.h + 2 * ph) * sd) ? d.c : document.createElement('canvas');
        c.width = Math.ceil((cam.w + 2 * pw) * sd);
        c.height = Math.ceil((cam.h + 2 * ph) * sd);
        const g = c.getContext('2d');
        g.setTransform(HALF_W * Z, HALF_H * Z, -HALF_W * Z, HALF_H * Z, (cam.ox + pw) * sd, (cam.oy + ph) * sd);
        drawGround(g, state, this.trees);
        d = this.detail = { c, zoom: cam.zoom, sd, ox: cam.ox, oy: cam.oy, pw, ph, key: this.cacheKey };
      }
    }
    if (d) d.full = Math.abs(cam.ox - d.ox) <= d.pw && Math.abs(cam.oy - d.oy) <= d.ph;
    return d;
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
    this.nightK = night;
    // Sonnenstand: flache Sonne morgens/abends = lange Schatten, nachts keine
    const hr = hourOf(state.time);
    const elev = clamp(Math.sin((Math.PI * (hr - 5.6)) / 14.6), 0, 1);
    this.shadowK = clamp(1 / (0.38 + 0.62 * elev), 1, 2.6);
    this.shadowA = clamp(light * (state.weather.kind === 'clear' ? 1 : state.weather.kind === 'clouds' ? 0.7 : 0.45), 0.15, 1);
    this.shadowSway = (hr - 12.5) * -0.05;
    const lights = [];
    this.picks = [];

    // Hintergrund (Gras, weltfest)
    cam.setScreen(ctx);
    ctx.fillStyle = '#5d7f45';
    ctx.fillRect(0, 0, cam.w, cam.h);
    const corners = [cam.toWorld(0, 0), cam.toWorld(cam.w, 0), cam.toWorld(cam.w, cam.h), cam.toWorld(0, cam.h)];
    cam.setIso(ctx);
    const sid = seasonOf(state).id;
    this.seasonId = sid;
    if (this.grassPatKey !== sid) {
      this.grassPat = pat(ctx, seasonalGrass(sid), 7);
      this.grassPatKey = sid;
    }
    ctx.fillStyle = this.grassPat;
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
    // nah herangezoomt deckt der scharfe Ausschnitt meist alles ab – dann den groben Cache gar nicht erst zeichnen
    const det = this.groundDetail(state);
    if (!det || !det.full) {
      if (sx1 > sx0 && sy1 > sy0) ctx.drawImage(k.c, sx0, sy0, sx1 - sx0, sy1 - sy0, dx + sx0 * sc, dy + sy0 * sc, (sx1 - sx0) * sc, (sy1 - sy0) * sc);
    }
    if (det) {
      const f = cam.dpr / det.sd;
      ctx.setTransform(f, 0, 0, f, (cam.ox - det.ox - det.pw) * cam.dpr, (cam.oy - det.oy - det.ph) * cam.dpr);
      ctx.drawImage(det.c, 0, 0);
      cam.setScreen(ctx);
    }

    // Winter: Schneedecke und verschneite Pisten
    drawSnowCover(this, state);
    drawRunwaySnow(this, state);
    // Regen: nasser, glänzender Asphalt mit Pfützen
    updateWetness(this, state, dtReal * (state.speed || 0) * TIME_SCALE);
    drawWetGround(this);

    // Wolkenschatten
    if (state.weather.kind !== 'clear' && state.weather.kind !== 'fog') this.polish.drawCloudShadows(this, state);
    if (ui && ui.noise) this.drawNoise(ctx, state);

    // Baustellen (Boden)
    const sites = [];
    for (const p of state.projects || []) {
      const g = siteGeom(state, p);
      if (g) sites.push({ p, g });
    }
    this.sites = sites;
    // fertige Baustelle: „Fertig“ über der Stelle
    const nowIds = new Map(sites.map((q) => [q.p.id, { x: (q.g.x0 + q.g.x1) / 2, y: (q.g.y0 + q.g.y1) / 2, name: q.p.name, prog: q.p.prog }]));
    for (const [id, c] of this.siteCenters) if (!nowIds.has(id) && c.prog > 0.9) this.addFx({ x: c.x, y: c.y, text: tr_`🏗️ Fertig: ${c.name}`, kind: 'good' });
    this.siteCenters = nowIds;
    this.siteLights = [];
    for (const s of sites) drawSiteGround(this, state, s.p, s.g);
    this.drawRunwayWorkGround(state);
    this.polish.drawMarks(this);

    // Objekte sammeln
    const items = [];
    const big = LY.GEO.stage >= 2; // Terminal, Parkhaus, Brücken erst ab Regionalflughafen (Karriere)
    for (const b of LY.BUILDINGS) {
      if (!LY.buildingOn(state, b)) continue;
      const x0 = b.fx - b.w, y0 = b.fy - b.d;
      items.push({ d: (x0 + b.fx) / 2 + (y0 + b.fy) / 2, f: () => this.drawBuilding(b) });
    }
    if (big) items.push({ d: 56 + 2.0, f: () => this.drawLot(state) });
    for (const s of sites) siteItems(this, state, s.p, s.g, items);
    permanentItems(this, state, items, sites);
    const T = LY.TERMINAL;
    if (big) for (let x = T.x0; x < T.x1 - 1e-6; x += 1) {
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
      if (treeBlocked(state, t) || onField(t.x, t.y)) continue;
      items.push({ d: t.x + t.y, f: () => this.drawTree(t) });
    }
    terrainItems(this, state, items, (x, y) => inView(view, x, y, 3));
    for (const car of this.cars) {
      const p = carPos(car, this.ambient.vt);
      items.push({ d: p.x + p.y, f: () => this.drawCar(p, car, night, lights) });
    }
    // Belebung: Besucherverkehr, Fußgänger, Bodenpersonal, Baustellen, Nachtlichter
    this.ambient.update(state, dtReal);
    this.ambient.items(this, state, items, lights, night, sites, (x, y) => inView(view, x, y, 1.5));
    this.standCrew.items(this, state, items, lights, night, (x, y) => inView(view, x, y, 1.5));
    gaLifeItems(this, state, items, lights, night, (x, y) => inView(view, x, y, 3));
    busPaxItems(this, state, items, (x, y) => inView(view, x, y, 1.5));
    spotterHillItems(this, state, items, (x, y) => inView(view, x, y, 4), lights);
    const flying = [];
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      if (!inView(view, ac.x, ac.y, 6 + ac.z * 2)) continue;
      if (ac.z > 0.35) flying.push(ac);
      else items.push({ d: ac.x + ac.y, f: () => this.drawAircraft(state, ac, lights, night, ui) });
    }
    // Flugzeuge als 3D-Modelle vorab in den Atlas rendern (nicht im Leistungsmodus)
    if (!Q.perf) loadImp();
    const belts = IMP && !Q.perf ? beltLoaders(state) : [];
    const jbs = IMP && !Q.perf ? jetBridges(state) : [];
    this.jbObj = new Map(jbs.map((o) => [o.stand.id, o]));
    if (IMP && !Q.perf) {
      const list = [];
      for (const ac of state.acs) {
        if (ac.mode !== 'map' || this.hideAc === ac.id || !inView(view, ac.x, ac.y, 6 + ac.z * 2)) continue;
        const crab = this.crabOf(state, ac);
        list.push(crab ? { ...ac, hdg: ac.hdg + crab } : ac);
      }
      const vl = state.vehicles.filter((v) => inView(view, v.x, v.y, 2));
      for (const t of fireTrucks(state)) if (inView(view, t.x, t.y, 2)) vl.push(t);
      for (const b of belts) if (inView(view, b.x, b.y, 1)) vl.push(b);
      for (const o of jbs) if (inView(view, o.x, o.y, 2)) vl.push(o);
      for (const c of followMeCars(state)) if (inView(view, c.x, c.y, 2)) vl.push({ ...c, type: 'followme' });
      saluteView(state)?.trucks.forEach((t, i) => vl.push({ id: 'sal' + i, type: 'fire', x: t.x, y: t.y, hdg: t.hdg, st: 'alarm' }));
      IMP.prepare(this, state, list, vl, dtReal * (state.speed || 0) * TIME_SCALE);
    } else if (IMP) IMP.prepare(this, state, [], []);
    // Fahrzeuge unter Flügel oder Heck eines stehenden Flugzeugs vor dem Flugzeug zeichnen (sonst liegen sie obendrauf)
    const parked = state.acs.filter((a) => a.mode === 'map' && a.z < 0.05);
    for (const v of state.vehicles) if (inView(view, v.x, v.y, 2)) items.push({ d: vehDepth(v, parked), f: () => this.drawVehicle(state, v, lights) });
    for (const t of fireTrucks(state)) items.push({ d: t.x + t.y, f: () => this.drawFireTruck(t, lights) });
    // Gepäckförderbänder (begleiten die Gepäckzüge, an der Frachttür hochgestellt)
    for (const b of belts) {
      if (!inView(view, b.x, b.y, 1)) continue;
      items.push({ d: vehDepth(b, parked), f: () => IMP.has(b.id) && (boxShadow(this, b, b.len, 0.1, 0.08), IMP.draw(this, b.id, b.x, b.y, 0)) });
    }
    // Polizeistreife auf dem Vorfeld (Streifenwagen als 3D-Modell, Blaulicht bei Einsatzfahrt oder Kontrolle)
    for (const c of state.patrol?.cars || []) {
      if (!inView(view, c.x, c.y, 1)) continue;
      const car = { kind: 'police', col: POLICE_BLUE, body: 'police', siren: c.lights };
      items.push({ d: vehDepth(c, parked), f: () => this.drawAmbientCar(car, { x: c.x, y: c.y, h: c.hdg, moving: c.st === 'drive' }, night, lights) });
    }
    items.push({ d: 66 + 35.6, f: () => this.drawWindsock(state) });
    if (LY.heliBaseOn() && inView(view, 43.2, 45.8, 3)) this.heliBaseItems(state, items, lights, night);
    this.runwayWorkItems(state, items, lights);
    this.followMeItems(state, items, lights);
    this.stateVisitItems(state, items, lights, night);
    this.festiveLights(state, lights, night);
    this.evacItems(state, items, lights, night);
    this.medicalItems(state, items, lights, night);
    this.openDayItems(state, items);
    const sal = saluteView(state);
    if (sal) sal.trucks.forEach((t, i) => items.push({ d: t.x + t.y, f: () => this.drawFireTruck(t, lights, 'sal' + i) }));
    plowItems(this, state, items, lights);
    infraItems(this, state, items, lights, night);
    deiceFx(this, state, items);
    // Personen (p: Standort) unter Tragfläche, Leitwerk oder Rumpf eines stehenden Flugzeugs vor ihm zeichnen
    for (const it of items) if (it.p) it.d = personDepth(it.p[0], it.p[1], parked, it.d);
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.f();
    this.drawFireSpray(state);
    if (sal && sal.spray) this.drawSalute(sal);
    const heli = heliOnMap(state);
    if (heli) this.drawHeli({ ...heli, pitch: HELI_PITCH[heli.st] ?? 0 }, lights);
    if (state.vfr && state.vfr.p) this.drawCessna(state.vfr.p, lights);
    flying.sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const ac of flying) this.drawAircraft(state, ac, lights, night, ui);
    this.drawLightBeam(state);
    // Reifenrauch, Gischt, Wolken
    this.polish.update(this, state, dtReal * (state.speed ? Math.min(3, 0.6 + state.speed * 0.4) : 0));
    this.polish.drawParticles(this);
    // Vögel und Hubschrauber (Echtzeit, bei Pause stehend)
    if (!this.wildlife) this.wildlife = new Wildlife();
    this.wildlife.update(state, dtReal * (state.speed ? Math.min(2.5, 0.7 + state.speed * 0.3) : 0));
    this.wildlife.draw(this, state);
    this.polish.drawClouds(this, state);

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
    // goldene Stunde: warmes Streiflicht von der Sonnenseite (morgens rechts, abends links)
    const golden = clamp(1 - Math.abs(h - (h < 12 ? 7.1 : 18.5)) / 1.7, 0, 1) * (1 - night * 0.8) * (wx === 'clear' ? 1 : wx === 'clouds' ? 0.55 : 0.2);
    if (golden > 0.02) {
      const am = h < 12;
      // warme Grundtönung (weniger Blau), dazu Streiflicht und Sonnenschein von der Seite
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = rgb(mix([255, 255, 255], [255, 206, 150], golden * 0.55));
      ctx.fillRect(0, 0, cam.w, cam.h);
      const g = ctx.createLinearGradient(am ? cam.w : 0, 0, am ? cam.w * 0.15 : cam.w * 0.85, cam.h);
      g.addColorStop(0, `rgba(255,160,70,${0.55 * golden})`);
      g.addColorStop(0.55, `rgba(255,190,120,${0.22 * golden})`);
      g.addColorStop(1, 'rgba(255,210,160,0)');
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cam.w, cam.h);
      ctx.globalCompositeOperation = 'screen';
      const g2 = ctx.createRadialGradient(am ? cam.w * 1.05 : -cam.w * 0.05, -cam.h * 0.1, 0, am ? cam.w * 1.05 : -cam.w * 0.05, -cam.h * 0.1, cam.w * 0.8);
      g2.addColorStop(0, `rgba(255,190,110,${0.4 * golden})`);
      g2.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, cam.w, cam.h);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (wx === 'rain' || wx === 'storm' || wx === 'clouds') {
      ctx.fillStyle = wx === 'storm' ? 'rgba(30,40,60,0.28)' : wx === 'rain' ? 'rgba(60,70,90,0.18)' : 'rgba(80,90,110,0.06)';
      ctx.fillRect(0, 0, cam.w, cam.h);
    }

    // Lichter
    this.staticLights(state, lights, night);
    drawWetReflections(this, lights, night);
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
    if (wx === 'snow') drawSnowfall(this, dtReal, state);
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

    this.drawRainbow(ctx, state, wx);
    this.lightTrails(state);

    // Overlays: Positionen, Auswahl, Labels
    this.drawOverlays(state, ui);
    this.drawFx(dtReal);
  }

  // Langzeitbelichtung (Fotomodus „Lichtspuren“): Positions- und Landescheinwerfer bewegter Flugzeuge zeichnen
  // Leuchtspuren, solange die Kamera still steht – nachts werden Starts und Landungen zu Lichtbändern.
  lightTrails(state) {
    if (!this.trailsOn) {
      this.trailCv = null;
      return;
    }
    const cam = this.cam, ctx = this.ctx;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const key = `${cam.x.toFixed(3)}|${cam.y.toFixed(3)}|${cam.zoom.toFixed(3)}|${W}|${H}`;
    if (!this.trailCv || this.trailKey !== key) {
      this.trailCv = document.createElement('canvas');
      this.trailCv.width = W;
      this.trailCv.height = H;
      this.trailKey = key;
      this.trailPrev = new Map();
    }
    const g = this.trailCv.getContext('2d');
    cam.setScreen(g);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    const seen = new Set();
    for (const ac of state.acs) {
      if (ac.mode !== 'map' || (ac.v || 0) < 0.01) continue;
      const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
      const half = ac.len * 0.47, zw = (ac.z || 0) + 0.1;
      const pts = [
        ['l', ac.x - rx * half, ac.y - ry * half, zw, 'rgba(255,60,50,0.55)', 1.6],
        ['r', ac.x + rx * half, ac.y + ry * half, zw, 'rgba(60,255,120,0.55)', 1.6],
        ['n', ac.x + fx * ac.len * 0.5, ac.y + fy * ac.len * 0.5, zw, 'rgba(255,244,214,0.6)', 2.4],
      ];
      for (const [k, x, y, z, col, w] of pts) {
        const id = ac.id + k;
        seen.add(id);
        const p = cam.toScreen(x, y, z);
        const q = this.trailPrev.get(id);
        this.trailPrev.set(id, p);
        if (!q || Math.hypot(p.x - q.x, p.y - q.y) < 0.4 || Math.hypot(p.x - q.x, p.y - q.y) > 80) continue;
        const lw = w * Math.max(0.7, Math.sqrt(cam.zoom));
        // weicher Schein und heller Kern
        g.strokeStyle = col.replace(/[\d.]+\)$/, '0.09)');
        g.lineWidth = lw * 4;
        g.beginPath();
        g.moveTo(q.x, q.y);
        g.lineTo(p.x, p.y);
        g.stroke();
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.stroke();
      }
    }
    for (const id of this.trailPrev.keys()) if (!seen.has(id)) this.trailPrev.delete(id);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.trailCv, 0, 0);
    ctx.restore();
  }

  // Regenbogen: Klart es nach Regen oder Gewitter bei tiefstehender Sonne auf (morgens oder am späten Nachmittag),
  // steht für eine Weile ein Regenbogen gegenüber der Sonne – morgens im Westen, nachmittags im Osten.
  drawRainbow(ctx, state, wx) {
    const cam = this.cam;
    if (wx !== this.prevWx) {
      if ((this.prevWx === 'rain' || this.prevWx === 'storm') && (wx === 'clear' || wx === 'clouds')) this.rainbowT = state.time;
      this.prevWx = wx;
    }
    this.rainbowOn = false;
    if (this.rainbowT == null) return;
    const DUR = 25 * 60;
    const age = state.time - this.rainbowT;
    if (age < 0 || age > DUR) {
      this.rainbowT = null;
      return;
    }
    const h = hourOf(state.time);
    if (!((h > 6.5 && h < 10.5) || (h > 15 && h < 19.5))) return;
    const a = Math.min(1, age / 120) * Math.min(1, (DUR - age) / 300) * (wx === 'clouds' ? 0.7 : 1);
    if (a <= 0.01) return;
    this.rainbowOn = true;
    const cx = cam.w * (h < 12 ? 0.3 : 0.7), cy = cam.h * 1.08, R = Math.min(cam.h * 0.86, cam.w * 0.75);
    const cols = ['255,40,40', '255,150,30', '255,236,60', '60,210,90', '40,150,255', '90,60,220', '170,70,230'];
    const bw = R * 0.016;
    ctx.save();
    ctx.lineWidth = bw * 1.5;
    cols.forEach((c, i) => {
      ctx.strokeStyle = `rgba(${c},${0.17 * a})`;
      ctx.beginPath();
      ctx.arc(cx, cy, R - i * bw, Math.PI, 2 * Math.PI);
      ctx.stroke();
    });
    // heller Schimmer innerhalb des Bogens
    const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R - 7 * bw);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(255,255,255,${0.05 * a})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 7 * bw, Math.PI, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }

  // Pistenarbeiten / Sperrung: frische Deckschicht, gesperrte Bahn rot überlagert (statt Sperrkreuzen)
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
      // halbtransparentes Rot über der ganzen Bahn, sanft pulsierend – Markierungen bleiben lesbar
      const a = 0.24 + 0.06 * Math.sin(this.time * 2.2);
      ctx.fillStyle = `rgba(239,68,68,${a.toFixed(3)})`;
      ctx.fillRect(rw.x0, rw.y - rw.hw, rw.x1 - rw.x0, 2 * rw.hw);
      ctx.strokeStyle = 'rgba(239,68,68,0.75)';
      ctx.lineWidth = 0.12;
      ctx.strokeRect(rw.x0 + 0.06, rw.y - rw.hw + 0.06, rw.x1 - rw.x0 - 0.12, 2 * rw.hw - 0.12);
    }
  }

  // Lärmkarte: Lärmzonen um die Bahn – Größe nach Bewegungen der letzten Stunde (schwere Flugzeuge zählen mehr),
  // nachts deutlich größer; zur Abflugseite gestreckt
  drawNoise(ctx, state) {
    const t = state.stats.today;
    const h = Math.floor(hourOf(state.time));
    const mov = ((t.arrH && t.arrH[h]) || 0) + ((t.depH && t.depH[h]) || 0) + 0.5 * (((t.arrH && t.arrH[h - 1]) || 0) + ((t.depH && t.depH[h - 1]) || 0));
    const heavy = state.acs.filter((a) => AC_TYPES[a.type].wake === 'H' || AC_TYPES[a.type].wake === 'J').length;
    const night = h < 6 || h >= 22 ? 1.6 : 1;
    const I = clamp(((mov + heavy * 1.5) / 14) * night, 0.12, 1.8);
    const rw = LY.RWY;
    const dir = state.rwy === '27' ? -1 : 1; // Startrichtung
    const cx = (rw.x0 + rw.x1) / 2 + dir * (3 + I * 3), cy = rw.y;
    this.cam.setIso(ctx, 0);
    const rings = [[1, 'rgba(250,204,21,0.16)'], [0.7, 'rgba(249,115,22,0.2)'], [0.42, 'rgba(239,68,68,0.26)']];
    for (const [k, col] of rings) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(cx, cy, (rw.x1 - rw.x0) / 2 + (6 + I * 16) * k, (3 + I * 9) * k + 1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.setLineDash([0.4, 0.3]);
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = 'rgba(239,68,68,0.6)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, (rw.x1 - rw.x0) / 2 + (6 + I * 16) * 0.42, (3 + I * 9) * 0.42 + 1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    this.cam.setScreen(ctx);
  }

  // „Follow me“: Superjumbo, Regierungsmaschine und VIP-Jets werden nach der Landung von einem gelben Lotsenfahrzeug zur Position geführt
  followMeItems(state, items, lights) {
    for (const c of followMeCars(state)) {
      if (IMP && !Q.perf && IMP.has(c.id)) {
        // 3D-Modell (gelber Kombi mit „FOLLOW ME“-Leuchtschild), sonst wie bisher als Schleppersilhouette
        items.push({ d: c.x + c.y, f: () => { boxShadow(this, c, 0.26, 0.1, 0.09); IMP.draw(this, c.id, c.x, c.y, 0); if ((this.time * 2 + c.x) % 1 < 0.35) lights.push({ x: c.x, y: c.y, z: 0.14, c: '#ffae00', s: 14, a: 0.9, day: true }); } });
        continue;
      }
      const fv = { ...c, type: 'tug' };
      items.push({ d: c.x + c.y, f: () => this.drawVehicle(state, fv, lights) });
    }
  }

  // Staatsbesuch: Treppe und roter Teppich an der hinteren linken Tür, Ehrenformation, Fahnen und die Kolonne
  // (Polizei vorn und hinten, drei Limousinen), die über die Vorfeldstraße anrollt und neben dem Flugzeug parkt
  stateVisitItems(state, items, lights, night) {
    const M = motorcade(state);
    if (!M) return;
    const S = state.sv;
    const ac = state.acs.find((a) => a.id === S.ac);
    const t = this.ambient.vt;
    const st = M.stand;
    const parkX = st.x - 3, yEnd = LY.STAND_NOSE + 4.6;
    // über die Zufahrt südlich des Tanklagers und die Servicestraße (nicht quer durch Gebäude)
    const route = [...LY.gateRoute(parkX, 0.25), { x: parkX, y: yEnd }];
    const Ltot = LY.polyLen(route);
    const at = (s) => LY.alongPoly(route, s);
    const KINDS = ['police', 'limo', 'limo', 'limo', 'police'];
    const ease = (u) => 1 - (1 - u) * (1 - u);
    KINDS.forEach((kind, k) => {
      const s = M.leaving ? Ltot - k * 0.55 - (1 - M.u) * (Ltot + 3) : ease(M.u) * Ltot - k * 0.55;
      if (s < 0) return;
      const p = at(Math.min(s, Ltot - k * 0.55));
      if (M.leaving) p.h += Math.PI;
      const moving = M.leaving ? M.u < 1 : M.u < 1;
      items.push({ d: p.x + p.y, f: () => this.drawAmbientCar({ kind, col: kind === 'police' ? POLICE_BLUE : '#0b0d12', siren: moving || kind === 'police' }, p, night, lights) });
    });
    if (!M.carpet || !ac) return;
    // Treppe und Teppich an der hinteren linken Tür (hinter der Tragfläche)
    const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), lx = fy, ly = -fx; // links von der Flugrichtung
    const along = -0.3 * ac.len, half = 0.24 * (AC_TYPES[ac.type].scale || 1) * 0.55 + 0.12;
    const door = { x: ac.x + fx * along + lx * half, y: ac.y + fy * along + ly * half };
    const len = 2.2, w = 0.32;
    const end = { x: door.x + lx * (len + 0.45), y: door.y + ly * (len + 0.45) };
    const ctx = this.ctx, cam = this.cam;
    items.push({
      d: Math.min(door.x + door.y, end.x + end.y) - 0.3,
      f: () => {
        cam.setIso(ctx, 0);
        ctx.save();
        ctx.translate(door.x + lx * 0.45, door.y + ly * 0.45);
        ctx.rotate(Math.atan2(ly, lx));
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0.04, -w / 2 + 0.04, len, w);
        ctx.fillStyle = '#b91c1c';
        ctx.fillRect(0, -w / 2, len, w);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(0, -w / 2, len, 0.03);
        ctx.fillRect(0, w / 2 - 0.03, len, 0.03);
        ctx.restore();
        // Fluggasttreppe
        prism(ctx, cam, [
          { x: door.x + fx * 0.14, y: door.y + fy * 0.14 },
          { x: door.x + lx * 0.45 + fx * 0.14, y: door.y + ly * 0.45 + fy * 0.14 },
          { x: door.x + lx * 0.45 - fx * 0.14, y: door.y + ly * 0.45 - fy * 0.14 },
          { x: door.x - fx * 0.14, y: door.y - fy * 0.14 },
        ], 0, 0.16, [235, 238, 242], [200, 204, 210], [170, 174, 180]);
      },
    });
    // Fahnenmasten am Teppichende
    for (const sgn of [-1, 1]) {
      const fpx = end.x + fx * sgn * 0.45, fpy = end.y + fy * sgn * 0.45;
      items.push({
        d: fpx + fpy,
        f: () => {
          cam.setScreen(ctx);
          const b = cam.toScreen(fpx, fpy, 0), top = cam.toScreen(fpx, fpy, 0.7);
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = Math.max(1, 1.2 * cam.zoom);
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(top.x, top.y);
          ctx.stroke();
          const fw = 9 * cam.zoom, fh = 6 * cam.zoom, wav = Math.sin(t * 3 + sgn) * 1.5 * cam.zoom;
          ctx.fillStyle = sgn < 0 ? '#1e3a8a' : '#f8fafc';
          ctx.beginPath();
          ctx.moveTo(top.x, top.y);
          ctx.quadraticCurveTo(top.x + fw * 0.5, top.y + wav, top.x + fw, top.y);
          ctx.lineTo(top.x + fw, top.y + fh);
          ctx.quadraticCurveTo(top.x + fw * 0.5, top.y + fh + wav, top.x, top.y + fh);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#facc15';
          ctx.fillRect(top.x + fw * 0.35, top.y + fh * 0.3, fw * 0.3, fh * 0.4);
        },
      });
    }
    // Ehrenformation beidseits des Teppichs und Empfangskomitee – bei Ankunft und Abschied
    const rot = state.rots[ac.rot];
    const ceremony = state.time - (S.onT || 0) < 25 * 60 || (rot && rot.std - state.time < 15 * 60);
    if (!ceremony || this.cam.zoom < 0.45) return;
    for (let i = 0; i < 6; i++) {
      for (const sgn of [-1, 1]) {
        const a = 0.55 + i * 0.3;
        const px = door.x + lx * a + fx * sgn * 0.3, py = door.y + ly * a + fy * sgn * 0.3;
        items.push({ d: px + py, p: [px, py], f: () => drawPerson(this, px, py, '#3f4a3c', 1, false, 0, false) });
      }
    }
    const COM = ['#111827', '#7f1d1d', '#111827'];
    COM.forEach((c, i) => {
      const px = end.x + lx * 0.15 + fx * (i - 1) * 0.22, py = end.y + ly * 0.15 + fy * (i - 1) * 0.22;
      items.push({ d: px + py, p: [px, py], f: () => drawPerson(this, px, py, c, 1, false, t + i, false) });
    });
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
    } else if (state.rwyClosedUntil > state.time && state.rwyClosedWhy === tr_('Pistenkontrolle') && state.insp && state.insp.active) {
      // Pistenkontrolle: einmal die Bahn entlang, von der aktiven Schwelle aus, im Schlangenlinien-Blick nach Fremdkörpern
      const rw = stripGeom('N');
      const A = state.insp.active;
      const u = Math.max(0, Math.min(1, (state.time - A.start) / Math.max(1, A.until - A.start)));
      const d = state.rwy === '27' ? -1 : 1;
      const x0 = d > 0 ? rw.x0 + 1 : rw.x1 - 1;
      const x = x0 + d * (rw.x1 - rw.x0 - 2) * u;
      mk('insp', 'tug', x, rw.y + Math.sin(u * 40) * 0.35, d > 0 ? 0 : Math.PI);
    } else if (state.rwyClosedUntil > state.time && ((state.rwyClosedWhy || '').startsWith('FOD') || state.rwyClosedWhy === tr_('FOD-Kontrolle (Fremdkörper)'))) {
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
    const snow = this.state ? this.state.snow || 0 : 0;
    if (snow > 0.03) {
      const sn = snowySprite(b.sprite);
      if (sn) {
        ctx.globalAlpha = clamp(snow * 1.2, 0, 1);
        ctx.drawImage(sn, fc.x - b.frac * dw, fc.y - dh, dw, dh);
        ctx.globalAlpha = 1;
      }
    }
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
    const bz = bakeZ(cam);
    if (!this.lot || this.lot.lvl !== lvl || this.lot.imp !== !!IMP || this.lot.bz !== bz) this.lot = { lvl, imp: !!IMP, bz, ...bakeLot(lvl, bz) }; // mit 3D-Autos neu, sobald geladen
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
    const bz = bakeZ(cam);
    const key = 'g' + lvl + (IMP ? 'i' : '') + bz;
    if (!this.garage || this.garage.key !== key) this.garage = { key, ...bakeGarage(b, lvl, bz) };
    const G = this.garage;
    this.topZ.garage = (3 + lvl) * 0.3 + 0.08;
    this.topZ.garageCorners = [[b.fx - b.w, b.fy - b.d], [b.fx, b.fy - b.d], [b.fx, b.fy], [b.fx - b.w, b.fy]];
    cam.setScreen(ctx);
    const k = cam.zoom / G.Z;
    const fc = cam.toScreen(b.fx, b.fy);
    ctx.drawImage(G.c, fc.x - G.fx * k, fc.y - G.fy * k, G.c.width * k, G.c.height * k);
    const snowG = this.state ? this.state.snow || 0 : 0;
    if (snowG > 0.03) {
      cam.setIso(ctx, this.topZ.garage - 0.06);
      ctx.fillStyle = `rgba(246,249,253,${clamp(snowG * 0.7, 0, 0.65)})`;
      ctx.fillRect(b.fx - b.w, b.fy - b.d, b.w, b.d);
      cam.setScreen(ctx);
    }
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
    const snow = this.state ? this.state.snow || 0 : 0;
    if (snow > 0.03) {
      ctx.fillStyle = `rgba(246,249,253,${clamp(snow * 0.9, 0, 0.85)})`;
      ctx.fillRect(xa - 0.01, T.y0, xb - xa + 0.03, T.y1 - T.y0);
    }
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
    // 3D-Modell (Rotunde, Teleskop-Tunnel, Fahrstütze, Kabine mit Faltenbalg), sonst die einfache Form unten
    const o = this.jbObj?.get(st.id);
    if (o && IMP && !Q.perf && IMP.has(o.id)) {
      boxShadow(this, o, o.len, 0.14, 0.42);
      IMP.draw(this, o.id, o.x, o.y, 0);
      return;
    }
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
    const img = seasonalTree(t.t, this.seasonId || 'summer', Math.floor(Math.abs(t.x * 7.3 + t.y * 13.1)));
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
    carBody(ctx, cam, p.x, p.y, p.h, car.c, cam.zoom < 0.7, 1, 0, false, car.k);
    if (night > 0.2) {
      lights.push({ x: p.x + Math.cos(p.h) * 0.3, y: p.y + Math.sin(p.h) * 0.3, z: 0.03, c: '#fff4d0', s: 14, a: 0.7 });
      lights.push({ x: p.x - Math.cos(p.h) * 0.18, y: p.y - Math.sin(p.h) * 0.18, z: 0.03, c: '#ff3020', s: 8, a: 0.7 });
    }
  }

  prism(pts, z0, z1, cTop, cA, cB) {
    prism(this.ctx, this.cam, pts, z0, z1, cTop, cA, cB);
  }

  // schwebende Rückmeldungen (Weltposition, steigen auf und blenden aus)
  addFx(f) {
    // gleichzeitige Meldungen am selben Ort übereinander stapeln statt überlagern
    const near = this.fxList.filter((o) => o.age < 1.4 && Math.abs(o.x - f.x) < 1.2 && Math.abs(o.y - f.y) < 1.2).length;
    this.fxList.push({ ...f, age: 0, row: Math.min(4, near) });
    if (this.fxList.length > 40) this.fxList.shift();
  }
  drawFx(dt) {
    const ctx = this.ctx, cam = this.cam;
    if (!this.fxList.length) return;
    const gc = document.getElementById('game').classList;
    if (gc.contains('photo') || gc.contains('cinema')) {
      this.fxList = [];
      return;
    }
    cam.setScreen(ctx);
    const cb = document.documentElement.classList.contains('a11y-cb'); // Farbsehschwäche: Blau/Orange
    const COL = { good: cb ? '#60a5fa' : '#4ade80', bad: cb ? '#fb923c' : '#f87171', warn: '#fbbf24', cash: '#fde047', info: '#e2e8f0', score: '#fcd34d' };
    const fs = Math.round(clamp(13 * Math.sqrt(cam.zoom / 0.8), 11, 20));
    ctx.font = `800 ${fs}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const f of this.fxList) {
      f.age += dt;
      const dur = 2.6;
      const u = f.age / dur;
      if (u >= 1) continue;
      const p = cam.toScreen(f.x, f.y, 0.6);
      const y = p.y - 18 * cam.zoom - u * 34 - (f.row || 0) * (fs + 4);
      const a = u < 0.12 ? u / 0.12 : u > 0.7 ? (1 - u) / 0.3 : 1;
      ctx.globalAlpha = a;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(4,10,20,0.85)';
      ctx.strokeText(f.text, p.x, y);
      ctx.fillStyle = COL[f.kind] || COL.info;
      ctx.fillText(f.text, p.x, y);
    }
    ctx.globalAlpha = 1;
    this.fxList = this.fxList.filter((f) => f.age < 2.6);
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
    if (c.kind === 'bus' && IMP && !Q.perf && cam.zoom >= 0.7 && IMP.drawCar(ctx, cam, p.x, p.y, p.h, c.col, 1.1, 0, false, c.col === '#f8fafc' ? 'bus-hotel' : 'bus-line')) {
      // Linienbus/Shuttle als 3D-Modell
    } else if (c.kind === 'bus') {
      const cs = carShades(c.col);
      rect(-0.4, 0.4, 0.085, 0.02, 0.2, cs.top, cs.a, cs.b);
      // Fensterband
      rect(-0.36, 0.38, 0.087, 0.11, 0.17, [40, 60, 84], [34, 52, 74], [26, 40, 58]);
    } else if (c.kind === 'mower') {
      // Traktor mit Mähwerk vorn: Mähdeck, Motorhaube, Kabine, große Hinterräder, gelbe Rundumleuchte
      rect(0.14, 0.3, 0.13, 0.01, 0.035, [120, 124, 130], [96, 100, 106], [80, 84, 90]);
      rect(-0.04, 0.14, 0.05, 0.03, 0.1, [34, 160, 80], [22, 128, 61], [20, 100, 50]);
      rect(-0.16, -0.02, 0.065, 0.03, 0.17, [21, 128, 61], [20, 100, 50], [16, 80, 40]);
      rect(-0.15, -0.03, 0.068, 0.17, 0.19, [30, 30, 30], [24, 24, 24], [20, 20, 20]);
      rect(-0.18, -0.08, 0.085, 0, 0.08, [25, 25, 25], [18, 18, 18], [12, 12, 12]);
      if ((this.ambient.vt * 2.5) % 1 < 0.4) lights.push({ x: p.x - fx * 0.09, y: p.y - fy * 0.09, z: 0.2, c: '#ffb000', s: 8, a: 0.8, day: true });
    } else if (c.kind === 'dump') {
      rect(0.12, 0.3, 0.075, 0.02, 0.15, [245, 158, 11], [200, 120, 8], [160, 96, 6]);
      rect(-0.3, 0.1, 0.085, 0.03, 0.13, [120, 110, 100], [96, 88, 80], [70, 64, 58]);
      rect(-0.26, 0.06, 0.07, 0.13, 0.15, [150, 120, 80], [120, 96, 64], [96, 76, 50]);
    } else {
      const real = carBody(ctx, cam, p.x, p.y, p.h, c.col, cam.zoom < 0.7, 1, 0, false, c.body || BODY_OF[c.kind] || 'sedan');
      if (c.kind === 'taxi') rect(-0.02, 0.03, 0.02, 0.095, 0.11, [255, 255, 255], [220, 220, 220], [190, 190, 190]);
      if (c.kind === 'police') {
        // als 3D-Modell trägt der Streifenwagen Streifen und Blaulichtbalken selbst
        if (!real) rect(-0.03, 0.05, 0.05, 0.095, 0.11, [59, 130, 246], [37, 99, 235], [30, 64, 175]);
        if (!real) rect(-0.16, 0.16, 0.081, 0.03, 0.05, [212, 242, 30], [180, 206, 26], [150, 172, 22]);
        if (c.siren || (c.patrolLights && !p.moving)) {
          const on = (this.ambient.vt * 3) % 1 < 0.5;
          lights.push({ x: p.x, y: p.y, z: 0.12, c: on ? '#3b82f6' : '#93c5fd', s: on ? 16 : 9, a: 0.95, day: true });
        }
      }
      if (c.kind === 'ambulance') {
        // ohne 3D-Modell: Kastenaufbau, rote Leuchtstreifen; Blaulicht auf dem Dach immer
        if (!real) {
          rect(-0.2, 0.06, 0.088, 0.02, 0.07, [248, 250, 252], [226, 232, 240], [203, 213, 225]);
          rect(-0.2, 0.06, 0.088, 0.07, 0.095, [220, 38, 38], [200, 30, 30], [170, 24, 24]);
          rect(-0.2, 0.06, 0.088, 0.095, 0.15, [248, 250, 252], [226, 232, 240], [203, 213, 225]);
        }
        if (c.siren) {
          const on = (this.time * 3.2) % 1 < 0.5;
          lights.push({ x: p.x + fx * 0.04, y: p.y + fy * 0.04, z: 0.17, c: on ? '#2563eb' : '#93c5fd', s: on ? 18 : 9, a: 0.95, day: true });
        }
      }
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

  // Luftrettungsstation: Gebäude als 3D-Bild (sonst einfache Quader), Windsack, Autos der Crew, Landeplatzbefeuerung
  heliBaseItems(state, items, lights, night) {
    const B = LY.HELIBASE;
    items.push({
      d: 88.6,
      f: () => {
        if (IMP && !Q.perf && IMP.drawHeliBase(this)) return;
        const { ctx, cam } = this;
        const rp = (r) => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
        prism(ctx, cam, rp(B.station), 0, B.station.h, [236, 238, 240], [200, 204, 208], [170, 174, 180]);
        prism(ctx, cam, rp(B.hangar), 0, B.hangar.h, [150, 158, 168], [208, 214, 220], [178, 184, 192]);
      },
    });
    items.push({ d: B.sock.x + B.sock.y, f: () => this.drawWindsock(state, B.sock.x, B.sock.y, 0) });
    B.cars.forEach((c, i) => {
      const car = i ? { kind: 'car', col: '#1e3a5f', body: 'estate' } : { kind: 'ambulance', col: '#f8fafc' };
      items.push({ d: c.x + c.y, f: () => this.drawAmbientCar(car, { x: c.x, y: c.y, h: c.hdg }, night, lights) });
    });
    heliBaseLights(lights);
  }

  drawWindsock(state, x = 66, y = 35.4, dy = 0.2) {
    const ctx = this.ctx, cam = this.cam;
    cam.setScreen(ctx);
    const base = cam.toScreen(x, y, 0), top = cam.toScreen(x, y, 0.5);
    ctx.strokeStyle = '#d9d9d9';
    ctx.lineWidth = Math.max(1, 1.6 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    const g = state.wind.gust || 0, ws = state.wind.spd + g; // in Böen streckt er sich und flattert
    const to = ((state.wind.dir + 180 - 90) * Math.PI) / 180 + Math.sin(this.time * 7.3) * Math.min(0.25, g * 0.015); // Weltwinkel, in den der Wind weht
    const L = 0.18 + 0.3 * clamp(ws / 15, 0, 1);
    const droop = 0.12 * (1 - clamp(ws / 15, 0, 1));
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const a = i / segs, b = (i + 1) / segs;
      const p0 = cam.toScreen(x + Math.cos(to) * L * a, y + dy + Math.sin(to) * L * a, 0.5 - droop * a);
      const p1 = cam.toScreen(x + Math.cos(to) * L * b, y + dy + Math.sin(to) * L * b, 0.5 - droop * b);
      ctx.strokeStyle = i % 2 ? '#f5f5f5' : '#ff6a00';
      ctx.lineWidth = Math.max(1, (4.5 - i * 0.8) * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  // ---------- Flugzeuge ----------
  // Seitenwind: Im Endanflug, beim Durchstarten und nach dem Abheben fliegt das Flugzeug schräg mit der Nase in
  // den Wind („Crab“) und richtet sich erst im Abfangbogen kurz vor dem Aufsetzen auf die Bahn aus. Böen lassen es
  // leicht pendeln. Nur Darstellung – die Bahnführung der Simulation bleibt unverändert.
  crabOf(state, ac) {
    if (ac.mode !== 'map' || ac.z < 0.05 || !state.wind || !state.wind.spd) return 0;
    const ph = ac.phase;
    let k;
    if (ph === PH.FINAL) k = clamp((ac.z - 0.08) / 0.45, 0, 1);
    else if (ph === PH.MISSED || ph === PH.TAKEOFF) k = clamp((ac.z - 0.05) / 0.6, 0, 1);
    else return 0;
    if (!k) return 0;
    const track = (ac.hdg * 180) / Math.PI + 90; // Kartenwinkel -> Kompasskurs
    const xw = state.wind.spd * Math.sin(((state.wind.dir - track) * Math.PI) / 180); // + = Wind von rechts
    const tas = (AC_TYPES[ac.type] && AC_TYPES[ac.type].vapp) || 140;
    let c = clamp((xw / tas) * 1.6, -0.3, 0.3);
    const g = state.wind.gust || 0;
    if (g) c += Math.sin(this.time * 1.7 + (ac.id.length % 5)) * Math.min(0.05, g * 0.004);
    return c * k;
  }

  drawAircraft(state, ac, lights, night, ui) {
    if (this.hideAc === ac.id) return; // Mitfliegen im Cockpit
    const crab = this.crabOf(state, ac);
    if (crab) ac = { ...ac, hdg: ac.hdg + crab };
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
      ctx.globalAlpha = clamp(0.38 - ac.z * 0.06, 0.07, 0.38) * (this.shadowA ?? 1);
      ctx.save();
      const sOff = (L * 0.06 + ac.z * 0.9) * (this.shadowK || 1);
      ctx.translate(ac.x + sOff, ac.y + sOff * (0.35 + (this.shadowSway || 0)));
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
    // echtes 3D-Modell aus dem Atlas (render/acimp.js); sonst gezeichneter Körper mit Volumen und Leitwerk
    if (IMP && IMP.draw(this, ac.id, ac.x, ac.y, ac.z || 0)) {
      this.acLights(state, ac, aircraftDims(ac, type.sprite, Wd), L, Wd, lights, night);
      return;
    }
    const lk = lookOf(ac);
    const body = drawAircraftBody(ctx, cam, ac, img, type.sprite, L, Wd, rot, onGround, lk.band);
    // Seitenleitwerk in Airline-Farbe, sitzt auf dem Rumpfrücken
    const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg);
    const fh = type.finH * 0.8;
    const zf = body.top - body.r * 0.25;
    const P = (f, z) => cam.toScreen(ac.x + fx * f * L, ac.y + fy * f * L, zf + z);
    cam.setScreen(ctx);
    const a = P(-0.49, 0), b = P(-0.47, fh), c = P(-0.39, fh), d = P(-0.25, 0);
    // Seite zum Betrachter etwas dunkler, je nach Blickwinkel
    const side = Math.abs(fx - fy) / 1.42;
    ctx.fillStyle = lk.fin;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(0.6, 0.8 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
    if (lk.stripes) {
      // Regenbogen: waagrechte Streifen über das ganze Leitwerk
      const n = lk.stripes.length;
      const lp = (p, q, f) => ({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
      for (let k = 0; k < n; k++) {
        const f0 = k / n, f1 = (k + 1) / n;
        const p0 = lp(a, b, f0), p1 = lp(a, b, f1), q1 = lp(d, c, f1), q0 = lp(d, c, f0);
        ctx.fillStyle = lk.stripes[k];
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(q1.x, q1.y);
        ctx.lineTo(q0.x, q0.y);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
    }
    ctx.fillStyle = `rgba(8,12,24,${0.08 + 0.22 * (1 - side)})`;
    ctx.fill();
    ctx.stroke();
    const m1 = P(-0.465, fh * 0.55), m2 = P(-0.37, fh * 0.55), m3 = P(-0.355, fh * 0.72), m4 = P(-0.47, fh * 0.72);
    if (!lk.stripes) {
      ctx.fillStyle = lk.accent;
      ctx.beginPath();
      ctx.moveTo(m1.x, m1.y);
      ctx.lineTo(m2.x, m2.y);
      ctx.lineTo(m3.x, m3.y);
      ctx.lineTo(m4.x, m4.y);
      ctx.fill();
    }
    // Vorderkante glänzt
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(0.6, 1 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();

    this.acLights(state, ac, body, L, Wd, lights, night);
  }

  // Positions-, Blitz-, Lande- und Rolllichter, nachts Kabinenfenster; Klickfläche
  acLights(state, ac, body, L, Wd, lights, night) {
    const cam = this.cam;
    const zb = body.wing;
    const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg);
    const t = this.time;
    const rx = -fy, ry = fx;
    const span = Wd * 0.48;
    const moving = ac.phase !== PH.STAND;
    if (ac.engines || moving) {
      if ((t + (ac.id.length % 7) * 0.13) % 1.2 < 0.14) lights.push({ x: ac.x, y: ac.y, z: body.top + 0.02, c: '#ff2a1a', s: 26, a: 0.95, day: true });
      lights.push({ x: ac.x - rx * span, y: ac.y - ry * span, z: zb, c: '#ff2020', s: 11, a: 0.8 });
      lights.push({ x: ac.x + rx * span, y: ac.y + ry * span, z: zb, c: '#20ff60', s: 11, a: 0.8 });
    }
    // Kabinenfenster leuchten nachts
    if (night > 0.35) {
      const n = Math.max(2, Math.round(L * 1.4));
      for (let i = 0; i < n; i++) {
        const f = -0.3 + (0.62 * i) / Math.max(1, n - 1);
        for (const sd of [-1, 1]) lights.push({ x: ac.x + fx * f * L + rx * sd * body.r * 0.9, y: ac.y + fy * f * L + ry * sd * body.r * 0.9, z: body.mid + body.r * 0.3, c: '#ffd89a', s: 5, a: 0.55 });
      }
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
    if (IMP && !Q.perf && IMP.has(v.id)) {
      // 3D-Modell mit Texturen, Werbung, Dachnummer (render/acimp.js): Schatten, Bild, Rundumleuchte
      const img = IMG[vt.sprite];
      const L = vt.len * 1.15, H = VEH_H[v.type] || 0.12;
      if (img) this.vehShadow(vt.sprite, v.x, v.y, v.hdg, L, (L * img.width) / img.height, H);
      else if (v.type === 'stairs') boxShadow(this, v, stairsSize().L, stairsSize().W, 0.14);
      IMP.draw(this, v.id, v.x, v.y, 0);
      const broken = v.brokenUntil > state.time;
      if ((v.st !== 'idle' && (this.time * 2 + v.x) % 1 < 0.35) || broken) lights.push({ x: v.x, y: v.y, z: H + 0.05, c: broken ? '#ff3030' : '#ffae00', s: 16, a: 0.9, day: true });
      const sp = cam.toScreen(v.x, v.y, 0.1);
      this.picks.push({ type: 'veh', id: v.id, x: sp.x, y: sp.y, r: 10 });
      return;
    }
    if (v.type === 'bus' || v.type === 'stairs') {
      // eigene Formen: Vorfeldbus mit Panoramafenstern, Treppenfahrzeug mit ausfahrender Treppe
      const broken = v.brokenUntil > state.time;
      const beacon = (v.st !== 'idle' && (this.time * 2 + v.x) % 1 < 0.35) || broken;
      if (v.type === 'bus') drawApronBus(this, v, beacon, this.nightK || 0, lights);
      else drawStairsTruck(this, v, stairsTop(state, v), beacon, lights);
      const sp = cam.toScreen(v.x, v.y, 0.1);
      this.picks.push({ type: 'veh', id: v.id, x: sp.x, y: sp.y, r: 10 });
      return;
    }
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
    ctx.globalAlpha = 0.34 * (this.shadowA ?? 1);
    const k = this.shadowK || 1;
    ctx.translate(x + 0.03 + H * 0.55 * k, y + 0.02 + H * (0.25 + (this.shadowSway || 0)) * k);
    ctx.rotate(hdg + Math.PI / 2);
    if (sh) ctx.drawImage(sh, -Wd / 2 - 0.01, -L / 2 - 0.01, Wd + 0.02, L + 0.02);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(-Wd / 2, -L / 2, Wd, L);
    }
    ctx.restore();
  }

  // Löschangriff: Wasser-/Schaumbögen von den Dachwerfern, Schaumteppich unter dem Flugzeug
  // Haltebalken (Stop Bars): rote Lichterreihe am Rollhalt der aktiven Bahn und an den Kreuzungen –
  // erlischt mit der Line-up-/Start- bzw. Kreuzungsfreigabe, dann führen grüne Lichter auf die Bahn
  stopBars(state, lights) {
    const rw = LY.RWY;
    const thrX = rw.thr[state.rwy];
    const cleared = state.acs.some((a) => a.mode === 'map' && [PH.TAXI_OUT, PH.HOLDING, PH.LINEUP].includes(a.phase) && (a.clr.lineup || a.clr.takeoff) && Math.abs(a.x - thrX) < 2.5);
    if (!cleared) for (let d = -0.6; d <= 0.61; d += 0.2) lights.push({ x: thrX + d, y: LY.HOLD_Y, z: 0.02, c: '#ff2a20', s: 8, a: 0.95, day: true });
    else for (let y = LY.HOLD_Y; y <= rw.y + 0.01; y += 0.46) lights.push({ x: thrX, y, z: 0.02, c: '#30ff60', s: 7, a: 0.9, day: true });
    if (!state.upgrades.rwy2) return;
    for (const c of LY.CROSS) {
      const go = state.acs.some((a) => a.mode === 'map' && a.crossX === c && (a.crossing || a.clr.taxi));
      if (!go) for (let d = -0.5; d <= 0.51; d += 0.25) lights.push({ x: c + d, y: LY.HOLD_CROSS + 0.12, z: 0.02, c: '#ff2a20', s: 6, a: 0.85, day: true });
      else for (let y = LY.HOLD_CROSS; y >= rw.y - rw.hw - 0.3; y -= 0.5) lights.push({ x: c, y, z: 0.02, c: '#30ff60', s: 6, a: 0.85, day: true });
    }
  }

  // Lichtsignal vom Tower (Funkausfall): farbiger Strahl aus der Kanzel zum Flugzeug, ein paar Sekunden lang
  drawLightBeam(state) {
    const B = state.lightBeam;
    if (!B) return;
    if (this.beamN !== B.n) {
      this.beamN = B.n;
      this.beamT = this.time;
    }
    const age = this.time - this.beamT;
    if (age > 6) return;
    const ac = state.acs.find((a) => a.id === B.ac);
    if (!ac) return;
    const { ctx, cam } = this;
    const tw = LY.BUILDINGS.find((b) => b.id === 'tower');
    const src = cam.toScreen(tw.fx - tw.w * 0.5, tw.fy - tw.d * 0.5, 4.1);
    // Ziel: auf der Karte das Flugzeug, sonst Richtung Anflug am Kartenrand
    let dst;
    if (ac.mode === 'map') dst = cam.toScreen(ac.x, ac.y, (ac.z || 0) + 0.25);
    else {
      const east = (ac.rwy || state.rwy) === '27';
      dst = cam.toScreen(east ? LY.W + 6 : -6, LY.RWY.y, 3);
    }
    const on = !B.blink || Math.floor(age * 3) % 2 === 0;
    if (!on) return;
    const fade = Math.min(1, age * 4) * Math.min(1, (6 - age) / 1.5);
    cam.setScreen(ctx);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const w = Math.max(3, 9 * cam.zoom);
    const g = ctx.createLinearGradient(src.x, src.y, dst.x, dst.y);
    g.addColorStop(0, B.col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = g;
    ctx.globalAlpha = 0.55 * fade;
    ctx.lineCap = 'round';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.stroke();
    ctx.globalAlpha = 0.9 * fade;
    ctx.lineWidth = Math.max(1, w * 0.25);
    ctx.stroke();
    // Lampe in der Kanzel und Lichtfleck am Flugzeug
    for (const [p, r] of [[src, 16], [dst, 22]]) {
      const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * Math.max(0.6, cam.zoom));
      rg.addColorStop(0, B.col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.globalAlpha = 0.8 * fade;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * Math.max(0.6, cam.zoom), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFireSpray(state) {
    const f = state.fire;
    if (!f || !f.trucks.some((t) => t.spray)) return;
    const { ctx, cam } = this;
    const al = state.fireAlert;
    const ac = al && state.acs.find((a) => a.id === al.ac);
    if (ac) {
      // Schaumteppich wächst mit der Sprühzeit
      const u = clamp((al.sprayed || 0) / 100, 0, 1);
      cam.setIso(ctx, 0.01);
      ctx.fillStyle = `rgba(245,248,252,${0.35 + 0.3 * u})`;
      for (let k = 0; k < 7; k++) {
        const a = k * 0.9 + 0.4, rr = (0.25 + 0.55 * u) * (0.6 + ((k * 37) % 10) / 20);
        ctx.beginPath();
        ctx.ellipse(ac.x + Math.cos(a) * 0.5 * u, ac.y + Math.sin(a) * 0.5 * u, rr, rr * 0.8, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    cam.setScreen(ctx);
    for (const t of f.trucks) {
      if (!t.spray) continue;
      const tgt = t.spray;
      for (let k = 0; k < 16; k++) {
        const ph = (this.time * 1.4 + k / 16) % 1;
        const x = t.x + (tgt.x - t.x) * ph, y = t.y + (tgt.y - t.y) * ph;
        const z = 0.34 + ph * (1 - ph) * 1.6 - ph * 0.22;
        const p = cam.toScreen(x, y, z);
        const r = (1.2 + ph * 4.5) * cam.zoom;
        ctx.fillStyle = k % 4 ? `rgba(235,245,255,${0.75 * (1 - ph * 0.6)})` : `rgba(190,215,240,${0.6 * (1 - ph)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Dampf/Sprühnebel am Ziel
      const p = cam.toScreen(tgt.x, tgt.y, 0.2);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 22 * cam.zoom);
      g.addColorStop(0, 'rgba(240,244,250,0.55)');
      g.addColorStop(1, 'rgba(240,244,250,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 22 * cam.zoom, p.y - 22 * cam.zoom, 44 * cam.zoom, 44 * cam.zoom);
    }
  }

  // Evakuierung bei Rauch in der Kabine: Notrutschen an beiden Seiten, Reisende laufen zum Sammelpunkt nördlich
  // der Bahn, ein Bus holt sie ab – nur Darstellung, solange das Flugzeug mit der Feuerwehr auf der Bahn steht
  // Tag der offenen Tür (Manager-Entscheidung): Besucher an der Terrassenkante des Terminals, die den Fliegern
  // zuwinken, eine Wimpelkette und aufsteigende Luftballons. Nur Darstellung.
  openDayItems(state, items) {
    const O = state.openDay;
    if (!O || state.time < O.from || state.time > O.until) return;
    if (LY.GEO.stage < 2) return; // am kleinen Platz: eigenes Flugplatzfest (render/galife.js)
    const T = LY.TERMINAL, zr = T.h;
    const n = O.big ? 120 : 40;
    const cols = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#ec4899', '#14b8a6', '#f8fafc', '#1f2937'];
    const h01 = (i, k) => {
      let x = Math.imul(i * 374761393 + k * 668265263, 1274126177) >>> 0;
      x = Math.imul(x ^ (x >>> 13), 1103515245) >>> 0;
      return (x >>> 8) / 16777216;
    };
    const span = T.x1 - T.x0 - 3;
    for (let i = 0; i < n; i++) {
      const x = T.x0 + 1.5 + ((i + h01(i, 1) * 0.8) / n) * span;
      const y = T.y1 - 0.1 - (i % 3) * 0.16 - h01(i, 2) * 0.08; // drei lockere Reihen an der Brüstung
      const col = cols[Math.floor(h01(i, 3) * cols.length)];
      const kid = h01(i, 4) < 0.25;
      items.push({ d: x + T.y1 + 0.05, f: () => this.roofPerson(x, y, zr, col, kid, this.time * 2 + i) });
    }
    // Sonnenschirme der Terrassen-Gastronomie
    for (let i = 0; i < (O.big ? 8 : 3); i++) {
      const x = T.x0 + 3 + ((i + 0.5) / (O.big ? 8 : 3)) * (span - 3), y = T.y1 - 0.9;
      const col = ['#ef4444', '#f8fafc', '#eab308', '#3b82f6'][i % 4];
      items.push({ d: x + y + 0.6, f: () => {
        const ctx = this.ctx, cam = this.cam;
        cam.setScreen(ctx);
        const p = cam.toScreen(x, y, zr), t = cam.toScreen(x, y, zr + 0.17);
        const rr = 0.3 * ZS * cam.zoom * 0.5;
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = Math.max(1, cam.zoom);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(t.x, t.y, rr * 1.4, rr * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + rr * 0.15, rr * 1.4, rr * 0.45, 0, 0, Math.PI);
        ctx.fill();
      } });
    }
    // Wimpelkette entlang der Terrassenkante
    items.push({ d: T.x1 + T.y1, f: () => {
      const ctx = this.ctx, cam = this.cam;
      cam.setScreen(ctx);
      const y = T.y1 - 0.04, z0 = zr + 0.32;
      const x0 = T.x0 + 1, x1 = T.x1 - 1, seg = 2.2;
      ctx.lineWidth = 1;
      for (let x = x0; x < x1 - 0.01; x += seg) {
        const xe = Math.min(x1, x + seg);
        const sag = (u) => z0 - Math.sin(u * Math.PI) * 0.1;
        ctx.strokeStyle = 'rgba(60,60,60,0.7)';
        ctx.beginPath();
        for (let k = 0; k <= 8; k++) {
          const u = k / 8, p = cam.toScreen(x + (xe - x) * u, y, sag(u));
          k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        }
        ctx.stroke();
        for (let k = 1; k < 8; k++) {
          const u = k / 8, xa = x + (xe - x) * u;
          const a = cam.toScreen(xa - 0.08, y, sag(u)), b = cam.toScreen(xa + 0.08, y, sag(u)), c = cam.toScreen(xa, y, sag(u) - 0.14);
          ctx.fillStyle = cols[(Math.round(xa * 4) + k) % 8];
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.fill();
        }
      }
    } });
    // Luftballons steigen auf und treiben mit dem Wind
    const wd = ((state.wind.dir + 180 - 90) * Math.PI) / 180;
    for (let i = 0; i < (O.big ? 9 : 4); i++) {
      const per = 16 + h01(i, 7) * 8;
      const u = ((this.time + h01(i, 8) * per) % per) / per;
      const bx = T.x0 + 3 + h01(i, 9) * (span - 3) + Math.cos(wd) * u * 3, by = T.y1 - 0.2 + Math.sin(wd) * u * 3;
      const bz = zr + 0.3 + u * 4.5;
      const col = cols[i % 8];
      items.push({ d: bx + by + 40, f: () => {
        const ctx = this.ctx, cam = this.cam;
        cam.setScreen(ctx);
        const p = cam.toScreen(bx, by, bz), q = cam.toScreen(bx, by, bz - 0.35);
        const rr = Math.max(1.5, 2.6 * cam.zoom);
        ctx.globalAlpha = Math.min(1, (1 - u) * 3);
        ctx.strokeStyle = 'rgba(80,80,80,0.6)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + rr);
        ctx.lineTo(q.x + Math.sin(this.time * 3 + i) * 1.5, q.y);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rr * 0.85, rr, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(p.x - rr * 0.3, p.y - rr * 0.35, rr * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } });
    }
  }

  roofPerson(x, y, z, col, kid, ph) {
    const ctx = this.ctx, cam = this.cam;
    cam.setScreen(ctx);
    const b = cam.toScreen(x, y, z);
    const zm = cam.zoom;
    const H = (kid ? 0.08 : 0.12) * ZS * zm;
    const w = Math.max(1, 0.035 * ZS * zm);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(b.x - w * 0.5, b.y - H * 0.45, w, H * 0.45);
    ctx.fillStyle = col;
    ctx.fillRect(b.x - w * 0.55, b.y - H * 0.85, w * 1.1, H * 0.42);
    ctx.fillStyle = '#e0b48c';
    ctx.beginPath();
    ctx.arc(b.x, b.y - H * 0.93, w * 0.42, 0, Math.PI * 2);
    ctx.fill();
    // ab und zu winken
    if (Math.sin(ph * 0.7) > 0.4) {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, w * 0.3);
      ctx.beginPath();
      ctx.moveTo(b.x + w * 0.5, b.y - H * 0.8);
      ctx.lineTo(b.x + w * (0.8 + Math.sin(ph * 6) * 0.3), b.y - H * 1.15);
      ctx.stroke();
    }
  }

  // Medizinischer Notfall: Ein Rettungswagen fährt mit Blaulicht über die Vorfeldstraße an die Parkposition,
  // zwei Sanitäter tragen den Patienten auf der Trage von der vorderen rechten Tür zum Wagen, danach fährt er ab.
  // Nur Darstellung, zeitlich an die Spielzeit gekoppelt (Pause hält alles an).
  medicalItems(state, items, lights, night) {
    const M = this.medics || (this.medics = new Map());
    const now = state.time;
    const DRIVE = 240, HANDOVER = 420;
    for (const ac of state.acs) {
      if (ac.mode !== 'map' || !(ac.emgKind === 'medical' || ac.medical) || !ac.arr) continue;
      if (!M.has(ac.id) && [PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN, PH.STAND].includes(ac.phase)) M.set(ac.id, { t0: now, tStand: null, ac: ac.id, stand: ac.stand });
      const m = M.get(ac.id);
      if (m && ac.phase === PH.STAND && m.tStand == null) m.tStand = now;
    }
    for (const [id, m] of M) {
      const ac = state.acs.find((a) => a.id === id);
      const st = state.stands.find((s) => s.id === (ac && ac.stand != null ? ac.stand : m.stand));
      if (!st || now < m.t0 || now - m.t0 > 3 * 3600) {
        M.delete(id);
        continue;
      }
      const atStand = ac && ac.phase === PH.STAND;
      // Abfahrt: nach der Übergabe oder sobald das Flugzeug die Position verlässt
      if (m.tLeave == null && ((m.tStand != null && now - m.tStand > HANDOVER) || (m.tStand != null && !atStand))) m.tLeave = now;
      const parkX = st.x + 1.05, yEnd = LY.STAND_NOSE + 0.85;
      const route = [...LY.gateRoute(parkX, 0.25), { x: parkX, y: yEnd }];
      const Ltot = LY.polyLen(route);
      const at = (s) => LY.alongPoly(route, s);
      const ease = (u) => 1 - (1 - u) * (1 - u);
      let p, moving;
      if (m.tLeave != null) {
        const u = clamp((now - m.tLeave) / DRIVE, 0, 1);
        if (u >= 1) {
          M.delete(id);
          continue;
        }
        p = at(Ltot * (1 - u * u));
        p.h += Math.PI;
        moving = true;
      } else {
        const u = clamp((now - m.t0) / DRIVE, 0, 1);
        p = at(ease(u) * Ltot);
        moving = u < 1;
      }
      items.push({ d: p.x + p.y, f: () => this.drawAmbientCar({ kind: 'ambulance', col: '#f8fafc', siren: moving || m.tLeave == null }, p, night, lights) });
      // Sanitäter mit Trage: vordere rechte Tür -> Heck des Rettungswagens
      if (atStand && m.tLeave == null && m.tStand != null) {
        const k = (now - m.tStand - 90) / (HANDOVER - 150);
        if (k > 0 && k < 1) {
          const door = { x: st.x + 0.3, y: LY.STAND_NOSE + ac.len * 0.13 };
          const dst = { x: parkX, y: yEnd + 0.32 };
          const wx = door.x + (dst.x - door.x) * k, wy = door.y + (dst.y - door.y) * k;
          const ph = this.time * 3;
          items.push({ d: wx + wy, f: () => {
            const ctx = this.ctx, cam = this.cam;
            cam.setScreen(ctx);
            const a = cam.toScreen(wx - 0.09, wy, 0.07), b = cam.toScreen(wx + 0.09, wy, 0.07);
            ctx.strokeStyle = '#f1f5f9';
            ctx.lineWidth = Math.max(2, 3.2 * cam.zoom);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            drawPerson(this, wx - 0.14, wy, '#dc2626', 1, false, ph, true, true);
            drawPerson(this, wx + 0.14, wy, '#dc2626', 1, false, ph + 1, true, true);
          } });
        }
      }
    }
  }

  evacItems(state, items, lights, night) {
    for (const ac of state.acs) {
      if (ac.mode !== 'map' || ac.emgKind !== 'smoke' || !ac.fireStop || ac.fireDone) continue;
      const el = state.time - ac.fireStop;
      const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
      const half = 0.2 * (AC_TYPES[ac.type].scale || 1) * 0.55 + 0.1;
      const doors = [0.32, -0.28].map((a) => a * ac.len);
      const ctx = this.ctx, cam = this.cam;
      // Rutschen (gelb, flach am Boden) – erst nach ein paar Sekunden aufgeblasen
      const inf = clamp(el / 20, 0, 1);
      for (const along of doors) {
        for (const sg of [-1, 1]) {
          const bx = ac.x + fx * along + rx * half * sg, by = ac.y + fy * along + ry * half * sg;
          items.push({
            d: bx + by - 0.4,
            f: () => {
              cam.setIso(ctx, 0);
              ctx.save();
              ctx.translate(bx, by);
              ctx.rotate(Math.atan2(ry * sg, rx * sg));
              ctx.fillStyle = 'rgba(250,204,21,0.95)';
              ctx.beginPath();
              ctx.moveTo(0, -0.06);
              ctx.lineTo(0.55 * inf, -0.1);
              ctx.lineTo(0.55 * inf, 0.1);
              ctx.lineTo(0, 0.06);
              ctx.closePath();
              ctx.fill();
              ctx.fillStyle = 'rgba(202,138,4,0.9)';
              ctx.fillRect(0, -0.015, 0.55 * inf, 0.03);
              ctx.restore();
            },
          });
        }
      }
      if (inf < 1 || this.cam.zoom < 0.5) continue;
      // Sammelpunkt: nördlich der Bahn, neben dem Flugzeug
      const side = ry < 0 ? 1 : -1; // die Seite Richtung Norden (kleineres y)
      const gx = ac.x, gy = ac.y - 3.2;
      const busT = el - 160; // nach knapp drei Minuten kommt der Bus
      const n = 36;
      for (let k = 0; k < n; k++) {
        const along = doors[k % 2], sg = k % 4 < 2 ? side : -side;
        const sx = ac.x + fx * along + rx * (half + 0.55) * sg, sy = ac.y + fy * along + ry * (half + 0.55) * sg;
        const start = 20 + k * 2.2;
        const u = clamp((el - start) / 45, 0, 1);
        if (u <= 0) continue;
        if (busT > 0 && busT * 0.35 > k) continue; // schon im Bus
        const h = ((k * 7919) % 100) / 100;
        const tx = gx + (h - 0.5) * 2.2, ty = gy + (((k * 104729) % 100) / 100 - 0.5) * 0.9;
        // wer auf der Südseite herauskommt, läuft vor der Nase herum auf die Nordseite
        const pts = [{ x: sx, y: sy }];
        if (sg !== side) {
          const ax = ac.x + fx * ac.len * 0.75, ay = ac.y + fy * ac.len * 0.75;
          pts.push({ x: ax + rx * (half + 0.6) * sg, y: ay + ry * (half + 0.6) * sg }, { x: ax + rx * (half + 0.6) * side, y: ay + ry * (half + 0.6) * side });
        }
        pts.push({ x: tx, y: ty });
        const seg = u * (pts.length - 1), i0 = Math.min(pts.length - 2, Math.floor(seg)), f = seg - i0;
        const px = pts[i0].x + (pts[i0 + 1].x - pts[i0].x) * f, py = pts[i0].y + (pts[i0 + 1].y - pts[i0].y) * f;
        const col = ['#1e3a8a', '#7c2d12', '#334155', '#be123c', '#065f46', '#6d28d9'][k % 6];
        items.push({ d: px + py, p: [px, py], f: () => drawPerson(this, px, py, col, 1, false, this.time + k, u < 1) });
      }
      if (busT > 0) {
        const bu = clamp(busT / 25, 0, 1);
        const bx = gx - 6 + 6 * bu, by = gy - 0.8;
        items.push({ d: bx + by, f: () => this.drawAmbientCar({ kind: 'bus', col: '#e2e8f0' }, { x: bx, y: by, h: 0 }, night, lights) });
      }
      // Sammelpunkt merken: die Reisenden warten dort weiter, wenn das Flugzeug abrollt
      this.evacs = this.evacs || new Map();
      this.evacs.set(ac.id, { gx, gy, t0: ac.fireStop, busT0: ac.fireStop + 160 });
    }
    // nach dem Abrollen: Gruppe am Sammelpunkt, der Bus holt alle ab
    if (this.evacs) {
      for (const [id, E] of this.evacs) {
        const ac = state.acs.find((a) => a.id === id);
        if (ac && ac.fireStop && !ac.fireDone) continue;
        if (!E.doneT) E.doneT = Math.max(state.time, E.t0 + 60);
        const bt = state.time - Math.max(E.doneT, E.busT0 - 140);
        if (bt > 120 || state.time < E.t0) {
          this.evacs.delete(id);
          continue;
        }
        const left = Math.max(0, 36 - Math.max(0, bt - 25) * 0.5);
        for (let k = 0; k < left; k++) {
          const h = ((k * 7919) % 100) / 100;
          const px = E.gx + (h - 0.5) * 2.2, py = E.gy + (((k * 104729) % 100) / 100 - 0.5) * 0.9;
          const col = ['#1e3a8a', '#7c2d12', '#334155', '#be123c', '#065f46', '#6d28d9'][k % 6];
          items.push({ d: px + py, p: [px, py], f: () => drawPerson(this, px, py, col, 1, false, this.time + k, false) });
        }
        const bu = clamp(bt / 25, 0, 1);
        const away = bt > 25 + 72 ? clamp((bt - 97) / 20, 0, 1) : 0;
        const bx = E.gx - 6 + 6 * bu + 8 * away, by = E.gy - 0.8;
        if (bt > 0) items.push({ d: bx + by, f: () => this.drawAmbientCar({ kind: 'bus', col: '#e2e8f0' }, { x: bx, y: by, h: 0 }, night, lights) });
      }
    }
  }

  // Winter: Lichterketten an der Dachkante des Terminals (Vorfeldseite), funkeln in den Abend- und Nachtstunden
  festiveLights(state, lights, night) {
    if (night < 0.25 || seasonOf(state).id !== 'winter') return;
    const T = LY.TERMINAL, C = ['#ff4040', '#40ff70', '#ffd040', '#60a0ff'];
    const t = this.time;
    for (let x = T.x0 + 0.4, k = 0; x < T.x1 - 0.3; x += 0.55, k++) {
      const tw = 0.55 + 0.45 * Math.sin(t * 2.2 + k * 1.7);
      lights.push({ x, y: T.y1 + 0.02, z: T.h + 0.02, c: C[k % 4], s: 5, a: 0.5 + 0.45 * tw * night });
    }
  }

  // Cessna der Platzrunden: Hochdecker mit Streifen, Propellerkreis und Positionslichtern
  drawCessna(c, lights) {
    const { ctx, cam } = this;
    const z0 = cam.zoom;
    const fx = Math.cos(c.hdg), fy = Math.sin(c.hdg);
    const P = (a, s = 0, dz = 0) => cam.toScreen(c.x + fx * a - fy * s, c.y + fy * a + fx * s, c.z + dz);
    cam.setScreen(ctx);
    const sh = cam.toScreen(c.x + c.z * 0.35, c.y + c.z * 0.15, 0);
    ctx.fillStyle = `rgba(0,0,0,${c.z > 0.1 ? 0.16 : 0.26})`;
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, 13 * z0, 5 * z0, 0, 0, Math.PI * 2);
    ctx.fill();
    const line = (a, b, col, w) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, w * z0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    // Rumpf, Leitwerk, Tragfläche (oben)
    line(P(0.32), P(-0.34), '#f8fafc', 4.2);
    line(P(0.2), P(-0.3), '#1d4ed8', 1.2);
    line(P(-0.32, -0.15), P(-0.32, 0.15), '#e2e8f0', 2.4);
    line(P(-0.33, 0, 0), P(-0.36, 0, 0.12), '#dc2626', 2.2);
    line(P(0.06, -0.42, 0.05), P(0.06, 0.42, 0.05), '#f1f5f9', 3.4);
    line(P(0.06, -0.42, 0.05), P(0.06, -0.3, 0.05), '#dc2626', 3.4);
    line(P(0.06, 0.3, 0.05), P(0.06, 0.42, 0.05), '#dc2626', 3.4);
    ctx.lineCap = 'butt';
    // Propellerkreis
    const pr = P(0.35);
    ctx.fillStyle = 'rgba(60,60,60,0.25)';
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, 3.6 * z0, 3.6 * z0, 0, 0, Math.PI * 2);
    ctx.fill();
    // Positionslichter: links rot, rechts grün, Blitz
    const L = (a, s) => ({ x: c.x + fx * a - fy * s, y: c.y + fy * a + fx * s });
    const l = L(0.06, -0.42), r = L(0.06, 0.42);
    lights.push({ x: l.x, y: l.y, z: c.z + 0.05, c: '#ff3030', s: 6, a: 0.8 });
    lights.push({ x: r.x, y: r.y, z: c.z + 0.05, c: '#30ff60', s: 6, a: 0.8 });
    if ((this.time * 1.1) % 1 < 0.1) lights.push({ x: c.x, y: c.y, z: c.z + 0.1, c: '#ffffff', s: 10, a: 0.9, day: true });
  }

  // Hubschrauber (Luftrettung gelb, Polizei silber-blau): weicher Schatten am Boden, Rumpf als 3D-Modell, darüber der
  // Hauptrotor – bei voller Drehzahl als Unschärfe-Scheibe mit verwischten Blättern, beim An- und Auslaufen als einzelne
  // Blätter, abgestellt stehend. h: x, y, z, hdg, rpm (0…1, Standard 1), pitch (Längsneigung, vorwärts nach unten)
  drawHeli(h, lights, kind = 'rescue', id = 'heli') {
    const { ctx, cam } = this;
    const z0 = cam.zoom;
    const fx = Math.cos(h.hdg), fy = Math.sin(h.hdg);
    const rpm = h.rpm ?? 1;
    const D = HELI_DIM;
    const imp = IMP && !Q.perf;
    if (!imp && kind !== 'rescue') return false; // ohne 3D-Bild zeichnet der Aufrufer selbst
    // Schatten: Rumpf, Heckausleger und (bei laufendem Rotor) ein Hauch Rotorscheibe; mit der Höhe versetzt und blasser
    const z = h.z || 0, fade = clamp(1 - z / 8, 0.25, 1);
    cam.setIso(ctx, 0);
    ctx.save();
    ctx.translate(h.x + z * 0.35, h.y + z * 0.15);
    ctx.rotate(h.hdg);
    ctx.fillStyle = `rgba(0,0,0,${(0.24 * fade).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0.04, 0, 0.18, 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-0.45, -0.012, 0.32, 0.024);
    ctx.beginPath();
    ctx.arc(-0.432, 0, 0.032, 0, Math.PI * 2);
    ctx.fill();
    if (rpm > 0.3) {
      ctx.fillStyle = `rgba(0,0,0,${(0.07 * fade * rpm).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(D.mastX, 0, D.rotorR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (!(imp && IMP.drawHeli(this, id, kind, h.x, h.y, z, h.hdg, h.pitch || 0))) {
      if (kind === 'rescue') this.drawHeliFlat(h, lights || []);
      return kind === 'rescue';
    }
    // Hauptrotor über dem Modell (Echtzeit-Winkel je Hubschrauber)
    const st = (this.rotors ||= {})[id] || (this.rotors[id] = { a: Math.random() * 6, t: this.time });
    st.a += (this.time - st.t) * 42 * rpm;
    st.t = this.time;
    const hx = h.x + fx * D.mastX, hy = h.y + fy * D.mastX, hz = z + D.H + D.mastY;
    cam.setScreen(ctx);
    const hub = cam.toScreen(hx, hy, hz);
    const R = D.rotorR, rx = R * 32 * Math.SQRT2 * z0;
    const blur = clamp((rpm - 0.35) / 0.45, 0, 1); // 0 = einzelne Blätter, 1 = Scheibe
    if (blur > 0) {
      ctx.save();
      ctx.translate(hub.x, hub.y);
      ctx.scale(1, 0.5);
      const g = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
      g.addColorStop(0, `rgba(34,40,50,${(0.08 * blur).toFixed(3)})`);
      g.addColorStop(0.75, `rgba(34,40,50,${(0.2 * blur).toFixed(3)})`);
      g.addColorStop(0.95, `rgba(34,40,50,${(0.3 * blur).toFixed(3)})`);
      g.addColorStop(1, 'rgba(34,40,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      // Blattspitzen-Kreis: heller Ring, damit die Scheibe auch über Gras und Asphalt zu erkennen ist
      ctx.strokeStyle = `rgba(226,232,240,${(0.32 * blur).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, 0.9 * z0) / 0.75;
      ctx.beginPath();
      ctx.arc(0, 0, rx * 0.97, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.4, 0.95 * z0);
    const ghosts = blur > 0 ? 3 : 1;
    for (let gI = 0; gI < ghosts; gI++) {
      const al = (blur > 0 ? 0.55 * (1 - blur * 0.3) : 0.95) * (gI ? 0.45 / gI : 1);
      ctx.strokeStyle = `rgba(36,40,47,${al.toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = st.a - gI * 0.16 + (i * Math.PI) / 2;
        const tip = cam.toScreen(hx + Math.cos(a) * R, hy + Math.sin(a) * R, hz);
        const root = cam.toScreen(hx + Math.cos(a) * 0.014, hy + Math.sin(a) * 0.014, hz);
        ctx.moveTo(root.x, root.y);
        ctx.lineTo(tip.x, tip.y);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#2b3038';
    ctx.beginPath();
    ctx.ellipse(hub.x, hub.y, Math.max(1.5, 0.014 * 45 * z0), Math.max(1, 0.014 * 22 * z0), 0, 0, Math.PI * 2);
    ctx.fill();
    // Blitzlicht auf dem Seitenleitwerk (nur bei laufendem Rotor), rotes Positionslicht am Heck
    if (lights) {
      const tx = h.x - fx * 0.462, ty = h.y - fy * 0.462;
      if (rpm > 0.05 && (this.time * 1.3) % 1 < 0.12) lights.push({ x: tx, y: ty, z: z + D.H + 0.17, c: '#ffffff', s: 14, a: 0.95, day: true });
      if (rpm > 0.05) lights.push({ x: tx, y: ty, z: z + D.H + 0.16, c: '#ff3030', s: 7, a: 0.8 });
    }
    return true;
  }

  // einfache Zeichnung, falls kein 3D-Bild möglich ist (ohne WebGL oder im Leistungsmodus)
  drawHeliFlat(h, lights) {
    const { ctx, cam } = this;
    const z0 = cam.zoom;
    const fx = Math.cos(h.hdg), fy = Math.sin(h.hdg);
    const P = (a, s = 0, dz = 0) => cam.toScreen(h.x + fx * a - fy * s, h.y + fy * a + fx * s, h.z + dz);
    cam.setScreen(ctx);
    // Schatten
    const sh = cam.toScreen(h.x + 0.15, h.y + 0.08, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, 15 * z0, 7 * z0, 0, 0, Math.PI * 2);
    ctx.fill();
    // Kufen
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = Math.max(1, 1.4 * z0);
    for (const s of [-0.11, 0.11]) {
      const a = P(0.22, s, -0.1), b = P(-0.2, s, -0.1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // Heckausleger und Leitwerk
    const c = P(0, 0, 0), t = P(-0.62, 0, 0.04);
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = Math.max(1.5, 3 * z0);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    const tf = P(-0.62, 0, 0.16);
    ctx.lineWidth = Math.max(1.5, 2.6 * z0);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(tf.x, tf.y);
    ctx.stroke();
    // Heckrotor
    ctx.strokeStyle = 'rgba(30,30,30,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(tf.x, (tf.y + t.y) / 2, 3.2 * z0, 0, Math.PI * 2);
    ctx.stroke();
    // Rumpf
    const n = P(0.3, 0, 0.02), r = P(-0.22, 0, 0.02);
    const ang = Math.atan2(n.y - r.y, n.x - r.x);
    const len = Math.hypot(n.x - r.x, n.y - r.y);
    ctx.save();
    ctx.translate((n.x + r.x) / 2, (n.y + r.y) / 2 - 3 * z0);
    ctx.rotate(ang);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.ellipse(0, 0, len / 2 + 3 * z0, 6.5 * z0, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-len / 2, -1.2 * z0, len * 0.75, 2.4 * z0);
    ctx.fillStyle = '#1e3a5f';
    ctx.beginPath();
    ctx.ellipse(len / 2 - 1 * z0, -1 * z0, 4.2 * z0, 4.6 * z0, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.restore();
    // Hauptrotor: Rotorkreis und zwei Blätter
    const hub = P(0, 0, 0.16);
    const R = 0.46;
    ctx.fillStyle = 'rgba(40,44,52,0.13)';
    ctx.beginPath();
    ctx.ellipse(hub.x, hub.y, R * 32 * z0 * 1.05, R * 16 * z0 * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,30,34,0.75)';
    ctx.lineWidth = Math.max(1, 1.6 * z0);
    const a0 = this.time * 26;
    for (const k of [0, Math.PI / 2]) {
      const a = P(Math.cos(a0 + k) * R, Math.sin(a0 + k) * R, 0.16), b = P(-Math.cos(a0 + k) * R, -Math.sin(a0 + k) * R, 0.16);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // Blitzlicht oben und rotes Heck-Positionslicht
    if ((this.time * 1.3) % 1 < 0.12) lights.push({ x: h.x, y: h.y, z: h.z + 0.2, c: '#ffffff', s: 14, a: 0.95, day: true });
    lights.push({ x: h.x - fx * 0.6, y: h.y - fy * 0.6, z: h.z + 0.05, c: '#ff3030', s: 7, a: 0.8 });
  }

  // Wassertaufe: zwei Bögen von den Löschfahrzeugen, die sich hoch über dem Rollweg kreuzen
  drawSalute(sal) {
    const { ctx, cam } = this;
    cam.setScreen(ctx);
    const [A, B] = sal.trucks;
    for (const [s, e] of [[A, B], [B, A]]) {
      const tx = s.x + (e.x - s.x) * 0.62, ty = s.y + (e.y - s.y) * 0.62;
      for (let k = 0; k < 34; k++) {
        const ph = (this.time * 0.9 + k / 34) % 1;
        const x = s.x + (tx - s.x) * ph, y = s.y + (ty - s.y) * ph;
        const z = 0.36 + ph * (1 - ph) * 4.4 - ph * 0.3;
        const p = cam.toScreen(x, y, z);
        const r = (1.9 + ph * 5) * cam.zoom;
        ctx.fillStyle = k % 3 ? `rgba(225,240,255,${0.72 * (1 - ph * 0.5)})` : `rgba(170,205,240,${0.55 * (1 - ph * 0.7)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Sprühnebel, wo der Strahl herunterkommt
      const p = cam.toScreen(tx, ty, 0.25);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26 * cam.zoom);
      g.addColorStop(0, 'rgba(235,242,252,0.45)');
      g.addColorStop(1, 'rgba(235,242,252,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 26 * cam.zoom, p.y - 26 * cam.zoom, 52 * cam.zoom, 52 * cam.zoom);
    }
  }

  drawFireTruck(t, lights, id = t.id) {
    const ctx = this.ctx, cam = this.cam;
    const img = IMG.veh_fire;
    const real = IMP && !Q.perf && id && IMP.has(id); // 3D-Modell (Flughafen-Löschfahrzeug 6×6)
    const L = real ? 0.64 : 0.75;
    const Wd = img ? (L * img.width) / img.height : 0.3;
    this.vehShadow('veh_fire', t.x, t.y, t.hdg, L, Wd, 0.17);
    if (real) IMP.draw(this, id, t.x, t.y, 0);
    else if (img) drawVehicleBody(ctx, cam, 'veh_fire', t.x, t.y, t.hdg, L, Wd, 0.15);
    if (t.st !== 'home') {
      const on = (this.time * 3 + t.x) % 1 < 0.5;
      lights.push({ x: t.x, y: t.y, z: 0.22, c: on ? '#3060ff' : '#ff2020', s: 22, a: 1, day: true });
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
    this.stopBars(state, lights);
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
      // Positionsschilder: klein und halb durchsichtig, wachsen beim Zoomen nur wenig (die Nummer steht ja auch am Boden)
      const fsz = clamp(8 + 2.4 * cam.zoom, 9, 14);
      ctx.font = `600 ${fsz}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const st of state.stands) {
        const sp = sites.find((q) => (q.p.kind === 'stand' || q.p.kind === 'standL') && q.p.target === st.id);
        // Aufbau-Modus: nicht baubare Positionen der kleinen Stufen nicht anzeigen; Wiesenplätze klein beschriften
        if (!st.built && !sp && !standBuildable(state, st)) continue;
        if (st.ga && (!st.built || st.closed)) continue;
        const p = cam.toScreen(st.x, st.ga ? LY.GA_NOSE + 1.15 : LY.LANE - 1.6);
        let col = '#2ecc71', txt = st.ga ? `${st.id}` : `P${st.id}`;
        if (sp) {
          col = '#fbbf24';
          txt = sp.p.status === 'waiting' ? `P${st.id} ⏳` : `P${st.id} ${Math.floor(sp.p.prog * 100)}%`;
        } else if (!st.built) {
          col = 'rgba(160,160,160,0.8)';
          txt = `P${st.id} +`;
        } else if (st.occ) col = '#94a3b8';
        else if (st.resv) col = '#3b82f6';
        const hl = ui && (ui.hoverStand === st.id || ui.selStand === st.id);
        const r = fsz * (st.ga ? 0.7 : 0.95) * (hl ? 1.2 : 1);
        ctx.fillStyle = hl ? 'rgba(10,15,25,0.82)' : 'rgba(10,15,25,0.5)';
        const wl = sp ? 2.3 : st.ga ? 1.15 : 1.6;
        roundRect(ctx, p.x - r * wl, p.y - r * 0.7, r * wl * 2, r * 1.4, 4);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = hl ? 2 : 1;
        ctx.globalAlpha = hl ? 1 : 0.75;
        ctx.stroke();
        ctx.globalAlpha = 1;
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
    const fs = Math.round(clamp(10 * Math.sqrt(cam.zoom / 0.6), 9, 12));
    const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.font = `700 ${fs}px ${MONO}`;
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
      ctx.font = `500 ${fs - 1}px ${MONO}`;
      const w2 = line2 ? ctx.measureText(line2).width : 0;
      const w3 = line3 ? ctx.measureText(line3).width : 0;
      ctx.font = `700 ${fs}px ${MONO}`;
      const bw = Math.max(w1, w2, w3) + 14 + (mk ? 4 : 0);
      const bh = (line2 ? fs * 2 + 8 : fs + 7) + (line3 ? fs + 2 : 0);
      // Schild über dem Flugzeug statt auf dem Rumpf: nah herangezoomt weiter nach oben, Linie zeigt auf das Flugzeug
      const lift = 22 + Math.min(110, (ac.len || 1) * 7 * cam.zoom);
      const bx = p.x + 10, by = p.y - lift - bh / 2;
      const quiet = !isSel && !ac.req && !ac.emergency && !mk;
      let border = quiet ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.25)';
      const sc = ui.seqCol ? ui.seqCol(ac) : null;
      if (ac.req) border = '#fbbf24';
      if (sc) border = sc;
      if (ac.emergency) border = '#f43f5e';
      if (isSel) border = '#38bdf8';
      if (quiet) ctx.globalAlpha = cam.zoom > 1.6 ? 0.78 : 0.9;
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(bx, by + bh / 2);
      ctx.stroke();
      ctx.fillStyle = border;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      const lg = ctx.createLinearGradient(0, by, 0, by + bh);
      lg.addColorStop(0, isSel ? 'rgba(14,58,84,0.94)' : quiet ? 'rgba(22,32,52,0.62)' : 'rgba(22,32,52,0.88)');
      lg.addColorStop(1, isSel ? 'rgba(6,30,46,0.94)' : quiet ? 'rgba(8,12,22,0.58)' : 'rgba(8,12,22,0.86)');
      ctx.fillStyle = lg;
      roundRect(ctx, bx, by, bw, bh, 5);
      ctx.fill();
      ctx.lineWidth = isSel || ac.req || sc ? 1.6 : 1;
      ctx.stroke();
      // Farbstreifen links: Markierung, sonst Airline-Farbe
      const al = AIRLINES[ac.airline];
      ctx.fillStyle = mk ? mk.hex : (al && al.color) || '#64748b';
      roundRect(ctx, bx + 1.5, by + 2.5, 3, bh - 5, 1.5);
      ctx.fill();
      const tx = bx + 8 + (mk ? 4 : 0);
      ctx.fillStyle = ac.emergency ? '#fda4af' : '#f8fafc';
      ctx.fillText(ac.cs, tx, by + fs / 2 + 4);
      if (line2 || line3) ctx.font = `500 ${fs - 1}px ${MONO}`;
      if (line2) {
        ctx.fillStyle = sc || (ac.req ? '#fcd34d' : '#94a3b8');
        ctx.fillText(line2, tx, by + fs * 1.5 + 5);
      }
      if (line3) {
        ctx.fillStyle = mk.hex;
        ctx.fillText(line3, tx, by + (line2 ? fs * 2.5 + 6 : fs * 1.5 + 5));
      }
      ctx.font = `700 ${fs}px ${MONO}`;
      ctx.globalAlpha = 1;
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
// Höhe der Treppe: an der Tür fährt sie langsam bis zur Schwelle hoch, sonst liegt sie flach zum Fahren
function stairsTop(state, v) {
  if (v.st !== 'docked' || !v.job) return 0.12;
  const ac = state.acs.find((a) => a.id === v.job.ac);
  const door = ac ? doorTop(ac) : 0.16;
  return 0.12 + (door - 0.12) * clamp((state.time - (v.dockT || 0)) / 25, 0, 1);
}
// Flugzeuge als 3D-Modelle (lädt three.js nach; bis dahin und im Leistungsmodus die gezeichneten Flugzeuge)
// Zeichentiefe eines Fahrzeugs: vor oder hinter stehenden Flugzeugen einsortieren (Rumpf, Flügel und Leitwerk einzeln
// geprüft, siehe occlude.js); die kleine Verschiebung je Abstand erhält die Reihenfolge mehrerer Fahrzeuge am selben Flugzeug
function personDepth(x, y, parked, d0) {
  let d = d0, lo = Infinity, hi = -Infinity;
  for (const a of parked) {
    const dx = x - a.x, dy = y - a.y, r = a.len * 0.62 + 0.3;
    if (dx * dx + dy * dy > r * r) continue;
    const o = vehOrder(personBox(x, y), acParts(a)), ad = a.x + a.y, k = (d0 - ad) * 0.005;
    if (o < 0) lo = Math.min(lo, ad - 0.04 + k);
    else if (o > 0) hi = Math.max(hi, ad + 0.04 + k);
  }
  if (hi > d) d = hi;
  if (lo < d) d = lo;
  return d;
}
function vehDepth(v, parked) {
  let d = v.x + v.y, lo = Infinity, hi = -Infinity;
  for (const a of parked) {
    const dx = v.x - a.x, dy = v.y - a.y, r = a.len * 0.62 + 0.6;
    if (dx * dx + dy * dy > r * r) continue;
    const o = vehVsAc(v, a), ad = a.x + a.y, k = (d - ad) * 0.005;
    if (o < 0) lo = Math.min(lo, ad - 0.04 + k);
    else if (o > 0) hi = Math.max(hi, ad + 0.04 + k);
  }
  if (hi > d) d = hi;
  if (lo < d) d = lo;
  return d;
}
// Löschfahrzeuge als Fahrzeuge für die 3D-Bilder (feste Kennung je Fahrzeug; in der Wache nur ab dem Verkehrslandeplatz sichtbar)
const FIRE_V = [];
function fireTrucks(state) {
  if (!state.fire) return [];
  const out = [];
  state.fire.trucks.forEach((t, i) => {
    if (t.st === 'home' && LY.GEO.stage === 0) return;
    const v = (FIRE_V[i] ||= { id: 'fire' + i, type: 'fire' });
    v.x = t.x;
    v.y = t.y;
    v.hdg = t.hdg;
    v.st = t.st;
    out.push(v);
  });
  return out;
}
// Hubschrauber: Nase im zügigen Vorwärtsflug leicht nach unten
const HELI_PITCH = { out: -0.07, cross: -0.07, around: -0.07, home: -0.05, lift: -0.02 };
let IMP = null;
let impLoad = null;
function loadImp() {
  if (!impLoad) impLoad = import('./acimp.js').then((m) => (IMP = m.ready() ? m : null)).catch(() => (IMP = null));
}
// Pkw: als 3D-Modell (rund, mit Scheiben und Rädern), im Leistungsmodus, weit herausgezoomt oder vor dem Laden als Quader
// Bauform für besondere Autos (Taxi, Polizei, Rettungswagen, Kolonne, Follow-me)
const BODY_OF = { taxi: 'sedan', police: 'police', ambulance: 'ambulance', followme: 'suv', limo: 'sedan' };
function carBody(ctx, cam, x, y, h, color, simple, sc = 1, zb = 0, force = false, kind = 'sedan') {
  if (IMP && !Q.perf && !simple && IMP.drawCar(ctx, cam, x, y, h, color, sc * 1.3, zb, force, kind)) return true;
  drawCarBody(ctx, cam, x, y, h, color, prism, carShades, simple, sc, zb);
  return false;
}
const VEH_H = { tug: 0.125, baggage: 0.13, fuel: 0.13, catering: 0.15, cleaning: 0.1, bus: 0.13, deice: 0.15 };
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
function makeCars() {
  const routes = [
    { pts: [{ x: -8, y: -0.4 }, { x: 88, y: -0.4 }], loop: false },
    { pts: [{ x: 88, y: 0.4 }, { x: -8, y: 0.4 }], loop: false },
  ];
  const cars = [];
  for (let i = 0; i < 22; i++) {
    const r = routes[i % 2];
    cars.push({ r, off: (i * 0.0457 * 7) % 1, v: 0.018 + ((i * 7) % 5) * 0.002, c: carPaint(hash01(i)), k: carKind(hash01(i + 50)) });
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
  const grass = pat(g, seasonalGrass(seasonOf(state).id), 7);
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

  // Umland: Felder, Hecken, Feldwege, Dorfstraße, Teich
  drawTerrain(g, state, seasonOf(state).id);
  // Gebäudeschatten
  for (const b of LY.BUILDINGS) {
    if (!LY.buildingOn(state, b)) continue;
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
  // Karriere: Grasplatz und Verkehrslandeplatz haben einen eigenen, kleinen Grundriss
  if (LY.GEO.stage < 2) return drawSmallField(g, state, { asphalt, concrete, gravel: pat(g, IMG.tex_gravel, 2.5), paintRunway });
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
  drawRailGround(g, state);
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
  g.fillRect(36.9, 43.7, 2.7, 3.1); // Feuerwache mit Vorplatz vor den Toren
  if (LY.heliBaseOn()) paintHeliBase(g); // Luftrettungsstation daneben
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
  // Mittellinie: zwei Fahrspuren, Rechtsverkehr
  g.fillStyle = 'rgba(250,204,21,0.7)';
  for (let x = 10.6; x < 74; x += 0.7) g.fillRect(x, LY.SERVICE - 0.017, 0.3, 0.034);
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
