// Isometrische Flughafenansicht
import { IMG, shadowOf, glowTinted } from '../assets.js';
import { HALF_W, HALF_H } from './camera.js';
import * as LY from '../layout.js';
import { AC_TYPES, AIRLINES, VEH_TYPES, ZS } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { hourOf, roundedPath, clamp, lerp } from '../util.js';
import { MARKS } from '../ui/marks.js';
import { siteGeom, drawSiteGround, siteItems, permanentItems, drawSiteLabel } from './sites.js';
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
    return state.stands.map((s) => (s.built ? s.size : '-')).join('') + '|' + state.upgrades.parking + state.upgrades.hotel + state.upgrades.rapidExit;
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

    // Objekte sammeln
    const items = [];
    for (const b of LY.BUILDINGS) {
      if (b.requires && !state.upgrades[b.requires]) continue;
      const x0 = b.fx - b.w, y0 = b.fy - b.d;
      items.push({ d: (x0 + b.fx) / 2 + (y0 + b.fy) / 2, f: () => this.drawBuilding(b) });
    }
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
      const p = carPos(car, this.time);
      items.push({ d: p.x + p.y, f: () => this.drawCar(p, car, night, lights) });
    }
    const flying = [];
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      if (!inView(view, ac.x, ac.y, 6 + ac.z * 2)) continue;
      if (ac.z > 0.35) flying.push(ac);
      else items.push({ d: ac.x + ac.y, f: () => this.drawAircraft(state, ac, lights, night, ui) });
    }
    for (const v of state.vehicles) {
      if (!inView(view, v.x, v.y, 2)) continue;
      items.push({ d: v.x + v.y, f: () => this.drawVehicle(state, v, lights) });
    }
    if (state.fire) for (const t of state.fire.trucks) items.push({ d: t.x + t.y, f: () => this.drawFireTruck(t, lights) });
    items.push({ d: 66 + 35.6, f: () => this.drawWindsock(state) });
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

  viewRect() {
    const c = this.cam;
    const p = [c.toWorld(0, 0), c.toWorld(c.w, 0), c.toWorld(c.w, c.h + 200), c.toWorld(0, c.h + 200)];
    return { x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), y0: Math.min(...p.map((q) => q.y)), y1: Math.max(...p.map((q) => q.y)), c };
  }

  // ---------- Gebäude ----------
  drawBuilding(b) {
    const img = IMG[b.sprite];
    if (!img) return;
    const ctx = this.ctx, cam = this.cam;
    cam.setScreen(ctx);
    const dw = (b.w + b.d) * HALF_W * cam.zoom;
    const dh = (dw * img.height) / img.width;
    const fc = cam.toScreen(b.fx, b.fy);
    ctx.drawImage(img, fc.x - b.frac * dw, fc.y - dh, dw, dh);
    this.picks.push({ type: 'building', id: b.id, x: fc.x, y: fc.y - dh * 0.45, r: dw * 0.35 });
  }

  drawTerminalSlice(xa, xb, last, night) {
    const ctx = this.ctx, cam = this.cam;
    const T = LY.TERMINAL;
    const h = T.h;
    // Dach
    cam.setIso(ctx, h);
    ctx.fillStyle = this.roofPat || (this.roofPat = pat(ctx, IMG.tex_roof, 3.2));
    ctx.fillRect(xa - 0.01, T.y0, xb - xa + 0.03, T.y1 - T.y0);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(xa - 0.01, T.y1 - 0.08, xb - xa + 0.03, 0.08);
    ctx.fillStyle = 'rgba(40,50,60,0.12)';
    ctx.fillRect(xa - 0.01, T.y0 + 1.6, xb - xa + 0.03, 0.8);
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
    // Rotunde
    prism(ctx, cam, rectPts(root.x, root.y + 0.12, 0.42, 0.42, 0), 0, 0.62, [235, 238, 242], [205, 210, 216], [168, 175, 184]);
    // Tunnel
    const ang = Math.atan2(end.y - root.y, end.x - root.x);
    const len = Math.hypot(end.x - root.x, end.y - root.y);
    const mid = { x: (root.x + end.x) / 2, y: (root.y + end.y) / 2 };
    // Stütze
    cam.setScreen(ctx);
    const leg0 = cam.toScreen(end.x - Math.cos(ang) * 0.3, end.y - Math.sin(ang) * 0.3, 0);
    const leg1 = cam.toScreen(end.x - Math.cos(ang) * 0.3, end.y - Math.sin(ang) * 0.3, 0.36);
    ctx.strokeStyle = '#3b4148';
    ctx.lineWidth = Math.max(1, 2.2 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(leg0.x, leg0.y);
    ctx.lineTo(leg1.x, leg1.y);
    ctx.stroke();
    prism(ctx, cam, rectPts(mid.x, mid.y, len, 0.24, ang), 0.36, 0.58, [228, 231, 236], [196, 202, 210], [160, 168, 178]);
    // Kabine
    prism(ctx, cam, rectPts(end.x, end.y, 0.34, 0.34, ang), 0.33, 0.62, [220, 224, 230], [170, 182, 196], [140, 150, 164]);
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
    cam.setIso(ctx, 0.03);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-0.15, -0.06, 0.34, 0.16);
    ctx.fillStyle = car.c;
    ctx.fillRect(-0.17, -0.075, 0.34, 0.15);
    ctx.fillStyle = 'rgba(20,30,40,0.75)';
    ctx.fillRect(0.02, -0.06, 0.08, 0.12);
    ctx.restore();
    if (night > 0.2) {
      lights.push({ x: p.x + Math.cos(p.h) * 0.3, y: p.y + Math.sin(p.h) * 0.3, z: 0.03, c: '#fff4d0', s: 14, a: 0.7 });
      lights.push({ x: p.x - Math.cos(p.h) * 0.18, y: p.y - Math.sin(p.h) * 0.18, z: 0.03, c: '#ff3020', s: 8, a: 0.7 });
    }
  }

  drawWindsock(state) {
    const ctx = this.ctx, cam = this.cam;
    cam.setScreen(ctx);
    const base = cam.toScreen(66, 35.6, 0), top = cam.toScreen(66, 35.6, 0.5);
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
      ctx.globalAlpha = clamp(0.3 - ac.z * 0.05, 0.06, 0.3);
      ctx.save();
      ctx.translate(ac.x + 0.12 + ac.z * 0.9, ac.y + 0.04 + ac.z * 0.2);
      ctx.rotate(rot);
      ctx.drawImage(sh, -Wd / 2, -L / 2, Wd, L);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    const zb = ac.z + 0.07;
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
    cam.setIso(ctx, zb);
    ctx.save();
    ctx.translate(ac.x, ac.y);
    ctx.rotate(rot);
    if (img) ctx.drawImage(img, -Wd / 2, -L / 2, Wd, L);
    else {
      ctx.fillStyle = '#eee';
      ctx.fillRect(-0.1, -L / 2, 0.2, L);
    }
    ctx.restore();
    // Seitenleitwerk in Airline-Farbe
    const al = AIRLINES[ac.airline] || AIRLINES.AUR;
    const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg);
    const fh = type.finH * 0.8;
    const P = (f, z) => cam.toScreen(ac.x + fx * f * L, ac.y + fy * f * L, zb + z);
    cam.setScreen(ctx);
    const a = P(-0.49, 0.05), b = P(-0.47, fh), c = P(-0.39, fh), d = P(-0.27, 0.05);
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
    ctx.stroke();
    const m1 = P(-0.465, fh * 0.55), m2 = P(-0.37, fh * 0.55), m3 = P(-0.355, fh * 0.72), m4 = P(-0.47, fh * 0.72);
    ctx.fillStyle = al.color2;
    ctx.beginPath();
    ctx.moveTo(m1.x, m1.y);
    ctx.lineTo(m2.x, m2.y);
    ctx.lineTo(m3.x, m3.y);
    ctx.lineTo(m4.x, m4.y);
    ctx.fill();

    // Lichter
    const t = this.time;
    const rx = -fy, ry = fx;
    const span = Wd * 0.48;
    const moving = ac.phase !== PH.STAND;
    if (ac.engines || moving) {
      if ((t + (ac.id.length % 7) * 0.13) % 1.2 < 0.14) lights.push({ x: ac.x, y: ac.y, z: zb + 0.1, c: '#ff2a1a', s: 26, a: 0.95, day: true });
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
    const sp = cam.toScreen(ac.x, ac.y, zb);
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
    cam.setIso(ctx, 0);
    ctx.save();
    ctx.translate(v.x + 0.05, v.y + 0.03);
    ctx.rotate(v.hdg + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-Wd / 2, -L / 2, Wd, L);
    ctx.restore();
    cam.setIso(ctx, 0.05);
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.hdg + Math.PI / 2);
    if (img) ctx.drawImage(img, -Wd / 2, -L / 2, Wd, L);
    ctx.restore();
    const active = v.st !== 'idle';
    const broken = v.brokenUntil > state.time;
    if ((active && (this.time * 2 + v.x) % 1 < 0.35) || broken) lights.push({ x: v.x, y: v.y, z: 0.15, c: broken ? '#ff3030' : '#ffae00', s: 16, a: 0.9, day: true });
    const sp = cam.toScreen(v.x, v.y, 0.1);
    this.picks.push({ type: 'veh', id: v.id, x: sp.x, y: sp.y, r: 10 });
  }

  drawFireTruck(t, lights) {
    const ctx = this.ctx, cam = this.cam;
    const img = IMG.veh_fire;
    const L = 0.75;
    const Wd = img ? (L * img.width) / img.height : 0.3;
    cam.setIso(ctx, 0.05);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.hdg + Math.PI / 2);
    if (img) ctx.drawImage(img, -Wd / 2, -L / 2, Wd, L);
    ctx.restore();
    if (t.st !== 'home') {
      const on = (this.time * 3 + t.x) % 1 < 0.5;
      lights.push({ x: t.x, y: t.y, z: 0.2, c: on ? '#3060ff' : '#ff2020', s: 22, a: 1, day: true });
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
  // Parkplatz
  g.fillStyle = asphalt;
  g.fillRect(56, 2.0, 12.5 + state.upgrades.parking * 2, 4.6);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  const pw = 12.5 + state.upgrades.parking * 2;
  for (let row = 0; row < 3; row++) {
    const yy = 2.3 + row * 1.5;
    for (let x = 56.2; x < 56 + pw - 0.2; x += 0.42) g.fillRect(x, yy, 0.03, 0.62);
  }
  const cc = ['#e2e8f0', '#1f2937', '#b91c1c', '#1d4ed8', '#9ca3af', '#f59e0b', '#065f46', '#475569'];
  for (let row = 0; row < 3; row++) {
    const yy = 2.3 + row * 1.5;
    for (let x = 56.25; x < 56 + pw - 0.5; x += 0.42) {
      if (r() < 0.3) continue;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 0.08, yy + 0.08, 0.3, 0.52);
      g.fillStyle = cc[Math.floor(r() * cc.length)];
      g.fillRect(x + 0.05, yy + 0.04, 0.3, 0.52);
      g.fillStyle = 'rgba(20,30,40,0.6)';
      g.fillRect(x + 0.08, yy + 0.14, 0.24, 0.12);
    }
  }
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
  g.fillRect(34.8, 34.5, 5.8, 2.7); // Feuerwache
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
  // Piste
  const rw = LY.RWY;
  g.fillStyle = 'rgba(150,150,140,0.55)';
  g.fillRect(rw.x0, rw.y - rw.hw - 0.4, rw.x1 - rw.x0, 2 * rw.hw + 0.8);
  g.fillStyle = asphalt;
  g.fillRect(rw.x0, rw.y - rw.hw, rw.x1 - rw.x0, 2 * rw.hw);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(rw.x0, rw.y - 0.35, rw.x1 - rw.x0, 0.7); // Gummiabrieb
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
    // Schwellenbalken
    for (let i = 0; i < 12; i++) {
      const yy = rw.y - 1.0 + i * 0.172 + (i >= 6 ? 0.25 : 0);
      if (yy > rw.y + 1.02) continue;
      g.fillRect(d > 0 ? tx + 0.15 : tx - 1.75, yy - 0.2 + 0.2, 1.6, 0.1);
    }
    g.fillRect(tx - 0.04, rw.y - rw.hw + 0.1, 0.08, 2 * rw.hw - 0.2);
    // Aufsetzzone
    for (const [k, big] of [[3.2, false], [4.6, true], [6.2, false], [7.8, false]]) {
      const x = tx + d * k;
      const len = big ? 1.2 : 0.7;
      const th = big ? 0.28 : 0.09;
      for (const side of [-1, 1]) {
        const y0 = rw.y + side * (big ? 0.45 : 0.4);
        for (let j = 0; j < (big ? 1 : 2); j++) g.fillRect(d > 0 ? x : x - len, y0 + (side > 0 ? j * 0.16 : -j * 0.16 - th), len, th);
      }
    }
    // Kennung
    g.save();
    g.translate(tx + d * 2.5, rw.y);
    g.rotate(d > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.scale(0.04, 0.04);
    g.font = '700 30px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(rwy, 0, 0);
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
  // Feuerwehrzufahrt
  g.fillStyle = asphalt;
  g.fillRect(36.9, rw.y + rw.hw + 0.3, 0.9, 34.6 - (rw.y + rw.hw + 0.3));
}
