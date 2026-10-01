// Baustellen auf der isometrischen Karte
import { IMG } from '../assets.js';
import { HALF_W } from './camera.js';
import * as LY from '../layout.js';
import { clamp } from '../util.js';
import { remainingHours } from '../sim/construction.js';
import { fmtHours } from '../ui/projects.js';
import { T } from '../i18n.js';

// Sprite-Anker: Anteil der Bildbreite, an dem der Fußpunkt liegt, und Breite in Kacheln (w+d)
const SPR = {
  crane: { frac: 0.38, size: 2.6, top: { fx: 0.383, fy: 0.09 } },
  excavator: { frac: 0.3, size: 1.55 },
  mixer: { frac: 0.33, size: 1.35 },
  site_office: { frac: 0.48, size: 2.1 },
  skeleton: { frac: 0.43 },
};

// Geometrie einer Baustelle: Fläche, Zaun, Maschinen
export function siteGeom(state, p) {
  const m = (sprite, x, y, extra = {}) => ({ sprite, x, y, ...extra });
  if (p.kind === 'stand' || p.kind === 'standL') {
    const st = state.stands.find((s) => s.id === p.target);
    if (!st) return null;
    // Umbau wartet noch auf das Flugzeug: nur Schild, noch keine Baustelle
    if (p.status === 'waiting') return { x0: st.x - 2.3, y0: LY.STAND_NOSE, x1: st.x + 2.3, y1: LY.STAND_NOSE + 4.5, fence: false, ground: null, machines: [], label: `P${st.id}` };
    const L = p.kind === 'standL';
    const x0 = st.x - (L ? 2.75 : 2.3), x1 = st.x + (L ? 2.75 : 2.3);
    const y0 = LY.STAND_NOSE - 0.2, y1 = LY.STAND_NOSE + (L ? 6.0 : 5.6);
    const machines = p.kind === 'stand'
      ? [m('crane', st.x + 1.5, y0 + 0.9), m('excavator', st.x - 0.9, y0 + 2.8, { dig: true }), m('mixer', st.x + 0.7, y1 - 0.7, { shake: true })]
      : [m('excavator', st.x - 1.5, y1 - 0.9, { dig: true }), m('mixer', st.x + 1.6, y1 - 0.8, { shake: true })];
    return { x0, y0, x1, y1, fence: true, ground: p.kind === 'stand' ? 'stand' : 'extend', stand: st, machines, label: `P${st.id}` };
  }
  switch (p.target) {
    case 'hotel': {
      const b = LY.BUILDINGS.find((q) => q.id === 'hotel');
      return { x0: b.fx - b.w - 2.4, y0: b.fy - b.d - 0.5, x1: b.fx + 1.7, y1: b.fy + 1.6, fence: true, ground: 'gravel', grow: b, machines: [m('crane', b.fx + 1.1, b.fy - b.d + 0.5), m('site_office', b.fx - b.w - 1.0, b.fy + 0.3), m('mixer', b.fx + 0.6, b.fy + 1.1, { shake: true })], label: 'Hotel' };
    }
    case 'parking': {
      const x0 = 56 + 12.5 + (p.level - 1) * 2;
      // Parkplatz-Erweiterung plus neues Parkdeck oben auf dem Parkhaus (Kran und Betonmischer am Parkhaus)
      return { x0, y0: 1.9, x1: x0 + 2.2, y1: 6.7, fence: true, ground: 'lot', machines: [m('excavator', x0 + 1.1, 3.4, { dig: true }), m('mixer', x0 + 1.4, 6.1, { shake: true }), m('crane', 55.1, 6.2), m('mixer', 54.9, 8.4, { shake: true })], label: 'Parkhaus' };
    }
    case 'retail':
    case 'security':
    case 'lounge':
      // Terminal-Anbau neben der Halle (Landseite)
      return { x0: 37.2, y0: 4.6, x1: 42.6, y1: 10.2, fence: true, ground: 'gravel', annex: true, machines: [m('crane', 41.4, 5.6), m('site_office', 40.6, 9.9), m('mixer', 42.0, 8.2, { shake: true })], label: 'Terminal' };
    case 'ils3':
      return { x0: -0.6, y0: 30.2, x1: 2.4, y1: 34.2, fence: true, ground: 'gravel', antenna: true, machines: [m('mixer', 0.4, 34.0, { shake: true }), m('excavator', 1.9, 30.9, { dig: true })], label: 'ILS' };
    case 'rapidExit':
      return { x0: 43.2, y0: 28.2, x1: 48.6, y1: 29.8, fence: false, cones: [32, 44], ground: null, machines: [m('excavator', 46.0, 29.2, { dig: true }), m('mixer', 47.9, 29.0, { shake: true })], label: 'Rollwege' };
    case 'rwy2': {
      // Parallelbahn: Baufront wandert von West nach Ost, dahinter frischer Asphalt
      const S = LY.RWY_S;
      const front = S.x0 + (S.x1 - S.x0) * clamp(p.prog, 0.02, 0.98);
      return {
        x0: 3.4, y0: LY.TWY_B - 1.1, x1: 76.6, y1: S.y + S.hw + 1.0, fence: true, ground: 'rwy2', front,
        machines: [m('excavator', Math.min(74, front + 3), S.y - 0.2, { dig: true }), m('mixer', Math.max(6, front - 1.2), S.y + 0.7, { shake: true }), m('excavator', Math.min(74, front + 5), LY.TWY_B + 0.3, { dig: true }), m('mixer', Math.max(6, front + 0.8), LY.TWY_B - 0.3, { shake: true }), m('crane', 38, S.y + 2.3), m('site_office', 71, S.y + 2.8)],
        label: 'Parallelbahn',
      };
    }
    case 'solar': {
      const S = LY.SOLAR;
      return { x0: S.x0 - 0.4, y0: S.y0 - 0.3, x1: S.x1 + 0.4, y1: S.y1 + 0.2, fence: true, ground: 'gravel', solar: true, machines: [m('excavator', S.x0 + 2 + (S.x1 - S.x0 - 4) * clamp(p.prog, 0, 1), S.y0 + 2.2, { dig: true }), m('site_office', S.x1 - 0.8, S.y1 - 0.4), m('mixer', S.x0 + 1.2, S.y1 - 0.5, { shake: true })], label: 'Solar' };
    }
    case 'rail': {
      const R = LY.RAIL;
      return { x0: R.station.x0 - 1.2, y0: R.station.y0 - 0.4, x1: R.station.x1 + 1.8, y1: R.y + 0.6, fence: true, ground: 'gravel', rail: true, machines: [m('crane', R.station.x0 + 3.5, R.station.y0 + 0.8), m('excavator', R.station.x0 + 0.5, R.y, { dig: true }), m('mixer', R.station.x1 + 0.8, R.station.y1, { shake: true }), m('site_office', R.station.x1 + 1.2, R.station.y0 + 0.4)], label: 'Bahnhof' };
    }
    case 'apronLights':
      // Kabelgraben entlang der Vorfeldkante
      return { x0: 14, y0: 25.45, x1: 66, y1: 26.35, fence: false, cones: null, ground: 'trench', machines: [m('excavator', 14 + 52 * clamp(p.prog, 0.02, 0.98), 26.3, { dig: true })], label: 'Licht' };
  }
  return null;
}

function pat(ctx, img, tiles) {
  if (!img) return '#8a7458';
  const p = ctx.createPattern(img, 'repeat');
  if (p.setTransform) p.setTransform(new DOMMatrix().scale(tiles / img.width));
  return p;
}

// Bodenschicht (unter allen Objekten)
export function drawSiteGround(r, state, p, g) {
  const { ctx, cam } = r;
  cam.setIso(ctx, 0);
  const gravel = r.gravelPat || (r.gravelPat = pat(ctx, IMG.tex_gravel, 3));
  const concrete = r.concretePat || (r.concretePat = pat(ctx, IMG.tex_concrete, 2.2));
  const asphalt = r.asphaltPat || (r.asphaltPat = pat(ctx, IMG.tex_asphalt, 4));
  if (g.ground === 'stand' || g.ground === 'gravel' || g.ground === 'lot') {
    ctx.fillStyle = gravel;
    ctx.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
  }
  if (g.ground === 'extend') {
    // nur der neue Randbereich wird aufgerissen
    ctx.fillStyle = gravel;
    const st = g.stand;
    ctx.fillRect(g.x0, g.y0, 0.65, g.y1 - g.y0);
    ctx.fillRect(g.x1 - 0.65, g.y0, 0.65, g.y1 - g.y0);
    ctx.fillRect(g.x0, LY.STAND_NOSE + 4.2, g.x1 - g.x0, g.y1 - LY.STAND_NOSE - 4.2);
    if (p.prog > 0.4) {
      ctx.globalAlpha = clamp((p.prog - 0.4) / 0.4, 0, 1);
      ctx.fillStyle = concrete;
      ctx.fillRect(g.x0, g.y0, 0.65, g.y1 - g.y0);
      ctx.fillRect(g.x1 - 0.65, g.y0, 0.65, g.y1 - g.y0);
      ctx.fillRect(g.x0, LY.STAND_NOSE + 4.2, g.x1 - g.x0, g.y1 - LY.STAND_NOSE - 4.2);
      ctx.globalAlpha = 1;
    }
    void st;
  }
  if (g.ground === 'stand') {
    // Beton wächst von der Nase zur Vorfeldstraße
    const f = clamp((p.prog - 0.12) / 0.6, 0, 1);
    if (f > 0) {
      ctx.fillStyle = concrete;
      ctx.fillRect(g.x0 + 0.1, g.y0 + 0.1, g.x1 - g.x0 - 0.2, (g.y1 - g.y0 - 0.2) * f);
      // frische Kante
      ctx.fillStyle = 'rgba(60,50,40,0.35)';
      ctx.fillRect(g.x0 + 0.1, g.y0 + 0.1 + (g.y1 - g.y0 - 0.2) * f - 0.06, g.x1 - g.x0 - 0.2, 0.06);
    }
    if (p.prog > 0.78) {
      ctx.globalAlpha = clamp((p.prog - 0.78) / 0.2, 0, 1);
      ctx.fillStyle = '#f2c81f';
      ctx.fillRect(g.stand.x - 0.035, LY.STAND_NOSE + 0.2, 0.07, g.y1 - LY.STAND_NOSE - 0.3);
      ctx.fillRect(g.stand.x - 0.35, LY.STAND_NOSE + 0.12, 0.7, 0.08);
      ctx.globalAlpha = 1;
    }
  }
  if (g.ground === 'rwy2') {
    const S = LY.RWY_S;
    ctx.fillStyle = gravel;
    ctx.fillRect(S.x0 - 1, S.y - S.hw - 0.4, S.x1 - S.x0 + 2, 2 * S.hw + 0.8);
    ctx.fillRect(6, LY.TWY_B - 0.75, 68, 1.5);
    const f = g.front;
    ctx.fillStyle = asphalt;
    ctx.fillRect(S.x0, S.y - S.hw, f - S.x0, 2 * S.hw);
    ctx.fillRect(6.4, LY.TWY_B - 0.67, Math.max(0, f - 6.4 - 3), 1.34);
    // frische Markierungen hinter der Front
    if (p.prog > 0.3) {
      ctx.fillStyle = 'rgba(244,244,240,0.9)';
      for (let x = S.x0 + 8; x < f - 3; x += 2.4) ctx.fillRect(x, S.y - 0.05, 1.4, 0.1);
    }
    // Vermessungspflöcke vor der Front
    ctx.fillStyle = '#f97316';
    for (let x = f + 2; x < S.x1; x += 3) {
      ctx.fillRect(x, S.y - S.hw, 0.12, 0.12);
      ctx.fillRect(x, S.y + S.hw - 0.12, 0.12, 0.12);
    }
  }
  if (g.ground === 'trench') {
    const f = clamp(p.prog, 0, 1);
    const xe = g.x0 + (g.x1 - g.x0) * f;
    ctx.fillStyle = '#8a6a44';
    ctx.fillRect(g.x0, 25.62, xe - g.x0, 0.5);
    ctx.fillStyle = '#4a3420';
    ctx.fillRect(g.x0, 25.76, xe - g.x0, 0.2);
    // Erdhaufen neben dem Graben
    ctx.fillStyle = '#a07c50';
    for (let x = g.x0 + 0.6; x < xe; x += 1.7) {
      ctx.beginPath();
      ctx.ellipse(x, 26.2, 0.35, 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // neue Lichtmasten (Sockel) im Abstand von 4 Kacheln
    ctx.fillStyle = '#d1d5db';
    for (let x = g.x0 + 2; x < xe - 0.5; x += 4) ctx.fillRect(x - 0.09, 25.5, 0.18, 0.18);
  }
  if (g.ground === 'lot') {
    const f = clamp((p.prog - 0.2) / 0.6, 0, 1);
    if (f > 0) {
      ctx.fillStyle = asphalt;
      ctx.fillRect(g.x0 + 0.1, g.y0 + 0.1, (g.x1 - g.x0 - 0.2) * f, g.y1 - g.y0 - 0.2);
    }
  }
  if (g.ground === 'gravel' && (g.grow || g.annex)) {
    // Fundamentplatte
    const b = g.grow || ANNEX;
    const f = clamp(p.prog / 0.1, 0, 1);
    ctx.globalAlpha = f;
    ctx.fillStyle = concrete;
    ctx.fillRect(b.fx - b.w, b.fy - b.d, b.w, b.d);
    ctx.globalAlpha = 1;
  }
}

// Objekte (tiefensortiert) für eine Baustelle
export function siteItems(r, state, p, g, items) {
  const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
  if (g.fence) {
    const e = [
      [g.x0, g.y0, g.x1, g.y0],
      [g.x0, g.y0, g.x0, g.y1],
      [g.x1, g.y0, g.x1, g.y1],
      [g.x0, g.y1, g.x1, g.y1],
    ];
    for (const [ax, ay, bx, by] of e) items.push({ d: (ax + bx) / 2 + (ay + by) / 2 - 0.05, f: () => drawFence(r, ax, ay, bx, by) });
  }
  if (g.cones) for (const x of g.cones) items.push({ d: x + 29, f: () => drawCones(r, x) });
  if (g.grow) items.push({ d: g.grow.fx - g.grow.w / 2 + g.grow.fy - g.grow.d / 2, f: () => drawGrowing(r, p, g.grow) });
  if (g.annex) items.push({ d: ANNEX.fx - ANNEX.w / 2 + ANNEX.fy - ANNEX.d / 2, f: () => drawAnnex(r, hasAnnex(state) ? DONE : p) });
  if (g.antenna) items.push({ d: 1 + 32.2, f: () => drawAntenna(r, p) });
  for (const m of g.machines) items.push({ d: m.x + m.y, f: () => drawMachine(r, state, m) });
  r.picks.push({ type: 'site', id: p.id, ...screenOf(r, cx, cy, 0.5), r: 40 * r.cam.zoom + 12 });
}

const DONE = { prog: 1 };
const TERMINAL_UPS = ['retail', 'security', 'lounge'];
const hasAnnex = (state) => TERMINAL_UPS.some((k) => state.upgrades[k] > 0);

// Dauerhafte Ergebnisse fertiger Projekte (ohne laufende Baustelle an derselben Stelle)
export function permanentItems(r, state, items, sites) {
  const busy = (k) => sites.some((s) => s.p.kind === 'upgrade' && (k === 'terminal' ? TERMINAL_UPS.includes(s.p.target) : s.p.target === k));
  if (hasAnnex(state) && !busy('terminal')) items.push({ d: ANNEX.fx - ANNEX.w / 2 + ANNEX.fy - ANNEX.d / 2, f: () => drawAnnex(r, DONE) });
  if (state.upgrades.ils3 && !busy('ils3')) items.push({ d: 1 + 32.2, f: () => drawAntenna(r, DONE) });
}

function screenOf(r, x, y, z) {
  const s = r.cam.toScreen(x, y, z);
  return { x: s.x, y: s.y };
}

function drawSprite(r, name, x, y, sizeTiles, frac, dy = 0, alpha = 1) {
  const img = IMG[name];
  if (!img) return null;
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const dw = sizeTiles * HALF_W * cam.zoom;
  const dh = (dw * img.height) / img.width;
  const p = cam.toScreen(x, y);
  const left = p.x - frac * dw, top = p.y - dh + dy;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(img, left, top, dw, dh);
  ctx.globalAlpha = 1;
  return { left, top, dw, dh };
}

function drawMachine(r, state, m) {
  const t = r.time;
  const s = SPR[m.sprite];
  const dy = m.dig ? Math.sin(t * 2.6 + m.x) * 1.1 * r.cam.zoom : m.shake ? Math.sin(t * 40 + m.y) * 0.35 : 0;
  // Schatten
  const { ctx, cam } = r;
  cam.setIso(ctx, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(m.x + 0.12, m.y + 0.05, s.size * 0.32, s.size * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  const box = drawSprite(r, m.sprite, m.x, m.y, s.size, s.frac, dy);
  if (!box) return;
  // Staubwolken am Bagger
  if (m.dig) {
    cam.setScreen(ctx);
    for (let i = 0; i < 5; i++) {
      const ph = (t * 0.45 + i / 5) % 1;
      const px = box.left + box.dw * (0.08 + 0.1 * Math.sin(i * 2.1)) - ph * 8 * cam.zoom;
      const py = box.top + box.dh * 0.92 - ph * 26 * cam.zoom;
      ctx.fillStyle = `rgba(170,140,100,${0.28 * (1 - ph)})`;
      ctx.beginPath();
      ctx.arc(px, py, (3 + ph * 9) * cam.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Warnlicht an der Kranspitze
  if (m.sprite === 'crane' && (t * 1.1) % 1 < 0.45) {
    r.siteLights.push({ sx: box.left + box.dw * s.top.fx, sy: box.top + box.dh * s.top.fy });
  }
}

function drawFence(r, ax, ay, bx, by) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const L = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.round(L / 0.32));
  const h = 0.16;
  ctx.lineWidth = Math.max(1, 1.8 * cam.zoom);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
    const a = cam.toScreen(x0, y0, h), b = cam.toScreen(x1, y1, h);
    const a2 = cam.toScreen(x0, y0, h * 0.5), b2 = cam.toScreen(x1, y1, h * 0.5);
    ctx.strokeStyle = i % 2 ? '#f8fafc' : '#dc2626';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.moveTo(a2.x, a2.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.stroke();
    if (i % 2 === 0) {
      const g0 = cam.toScreen(x0, y0, 0);
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = Math.max(1, 1.2 * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(g0.x, g0.y);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, 1.8 * cam.zoom);
    }
  }
}

function drawCones(r, x) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  for (const side of [-0.85, 0.85]) {
    for (let y = LY.TWY_A + 0.9; y < LY.RWY.y - LY.RWY.hw - 0.2; y += 0.55) {
      const b = cam.toScreen(x + side, y, 0), t = cam.toScreen(x + side, y, 0.14);
      const w = 3.2 * cam.zoom + 1;
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(b.x + w, b.y);
      ctx.lineTo(b.x - w, b.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(b.x - w * 0.55, (b.y + t.y) / 2 - 0.8, w * 1.1, Math.max(1, 1.4 * cam.zoom));
    }
  }
}

// Hotel wächst: Fundament -> Rohbau (von unten) -> Fassade blendet ein
function drawGrowing(r, p, b) {
  const img = IMG.skeleton, fin = IMG[b.sprite];
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const dw = (b.w + b.d) * HALF_W * cam.zoom;
  const fc = cam.toScreen(b.fx, b.fy);
  const f = clamp((p.prog - 0.08) / 0.62, 0, 1);
  if (img && f > 0) {
    const dh = (dw * img.height) / img.width;
    const left = fc.x - SPR.skeleton.frac * dw;
    ctx.globalAlpha = p.prog > 0.72 ? clamp(1 - (p.prog - 0.72) / 0.25, 0, 1) : 1;
    ctx.drawImage(img, 0, img.height * (1 - f), img.width, img.height * f, left, fc.y - dh * f, dw, dh * f);
    ctx.globalAlpha = 1;
  }
  if (fin && p.prog > 0.7) {
    const dh = (dw * fin.height) / fin.width;
    ctx.globalAlpha = clamp((p.prog - 0.7) / 0.3, 0, 1);
    ctx.drawImage(fin, fc.x - b.frac * dw, fc.y - dh, dw, dh);
    ctx.globalAlpha = 1;
  }
}

// ILS-Antennen wachsen
function drawAntenna(r, p) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const h = 0.45 * clamp((p.prog - 0.3) / 0.6, 0, 1);
  if (h <= 0) return;
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = Math.max(1, 1.6 * cam.zoom);
  for (let y = 30.9; y <= 33.55; y += 0.3) {
    const a = cam.toScreen(1.0, y, 0), b = cam.toScreen(1.0, y, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (h > 0.3) {
    const a = cam.toScreen(1.0, 30.9, h), b = cam.toScreen(1.0, 33.5, h);
    ctx.strokeStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// Terminal-Anbau: Rohbau wächst in Stockwerken (prozedural)
const ANNEX = { fx: 40.4, fy: 9.4, w: 2.8, d: 3.6 };
function drawAnnex(r, p) {
  const { ctx, cam } = r;
  const b = ANNEX;
  const x0 = b.fx - b.w, y0 = b.fy - b.d;
  const f = clamp((p.prog - 0.1) / 0.8, 0, 1);
  const floors = 3;
  const hTot = 1.5;
  const h = hTot * f;
  if (h <= 0.02) return;
  cam.setScreen(ctx);
  const P = (x, y, z) => cam.toScreen(x, y, z);
  const face = (pts, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
  };
  // Seiten (Rohbau-Beton, Stockwerksbänder)
  face([P(b.fx, y0, 0), P(b.fx, b.fy, 0), P(b.fx, b.fy, h), P(b.fx, y0, h)], '#b8b2a6');
  face([P(x0, b.fy, 0), P(b.fx, b.fy, 0), P(b.fx, b.fy, h), P(x0, b.fy, h)], '#9d978c');
  ctx.strokeStyle = 'rgba(40,40,40,0.55)';
  ctx.lineWidth = Math.max(1, 1.2 * cam.zoom);
  for (let k = 1; k <= floors; k++) {
    const z = (hTot / floors) * k;
    if (z > h) break;
    ctx.beginPath();
    let a = P(x0, b.fy, z), c = P(b.fx, b.fy, z), e = P(b.fx, y0, z);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
  }
  // Fensteröffnungen / Glas (ab 60 %)
  const glass = clamp((p.prog - 0.55) / 0.35, 0, 1);
  const n = 6;
  for (let k = 0; k < floors; k++) {
    const za = (hTot / floors) * k + 0.1, zb = (hTot / floors) * (k + 1) - 0.1;
    if (zb > h) break;
    for (let i = 0; i < n; i++) {
      const xa = x0 + (b.w / n) * (i + 0.2), xb = x0 + (b.w / n) * (i + 0.8);
      face([P(xa, b.fy, za), P(xb, b.fy, za), P(xb, b.fy, zb), P(xa, b.fy, zb)], glass > 0 ? `rgba(90,150,200,${0.35 + 0.55 * glass})` : 'rgba(30,30,30,0.6)');
    }
    for (let i = 0; i < n; i++) {
      const ya = y0 + (b.d / n) * (i + 0.2), yb = y0 + (b.d / n) * (i + 0.8);
      face([P(b.fx, ya, za), P(b.fx, yb, za), P(b.fx, yb, zb), P(b.fx, ya, zb)], glass > 0 ? `rgba(120,175,220,${0.35 + 0.55 * glass})` : 'rgba(30,30,30,0.55)');
    }
  }
  // Decke
  face([P(x0, y0, h), P(b.fx, y0, h), P(b.fx, b.fy, h), P(x0, b.fy, h)], f >= 1 ? '#7d8791' : '#c9c3b6');
  // Bewehrungseisen auf der obersten Decke
  if (f < 1) {
    ctx.strokeStyle = 'rgba(120,70,40,0.9)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const xx = x0 + (b.w / 6) * i;
      const a = P(xx, y0 + 0.2, h), c = P(xx, y0 + 0.2, h + 0.18);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
  }
}

// Fortschrittsschild
export function drawSiteLabel(r, state, p, g, sel = false) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const c = cam.toScreen((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, 2.2);
  const fs = Math.round(clamp(11 * Math.sqrt(cam.zoom / 0.6), 9, 13));
  const title = `🏗️ ${p.name}`;
  const rem = remainingHours(p);
  const sub = p.status === 'waiting' ? T('wartet auf freie Position') : T`${Math.floor(p.prog * 100)} % · noch ${fmtHours(rem)}${state.weather.kind === 'storm' ? T(' · Gewitter-Pause') : ''}`;
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  const w1 = ctx.measureText(title).width;
  ctx.font = `500 ${fs - 1}px ui-monospace, Menlo, monospace`;
  const w2 = ctx.measureText(sub).width;
  const bw = Math.max(w1, w2, 110) + 14, bh = fs * 2 + 16;
  const x = c.x - bw / 2, y = c.y - bh;
  ctx.fillStyle = 'rgba(15,20,30,0.88)';
  ctx.strokeStyle = sel ? '#38bdf8' : '#fbbf24';
  ctx.lineWidth = sel ? 2.2 : 1.5;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, bw, bh, 6) : ctx.rect(x, y, bw, bh);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fde68a';
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  ctx.fillText(title, x + 7, y + fs + 3);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = `500 ${fs - 1}px ui-monospace, Menlo, monospace`;
  ctx.fillText(sub, x + 7, y + fs * 2 + 5);
  // Balken
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x + 6, y + bh - 6, bw - 12, 3);
  ctx.fillStyle = p.status === 'waiting' ? '#94a3b8' : '#fbbf24';
  ctx.fillRect(x + 6, y + bh - 6, (bw - 12) * p.prog, 3);
  // Zeiger
  ctx.strokeStyle = 'rgba(251,191,36,0.6)';
  ctx.beginPath();
  ctx.moveTo(c.x, y + bh);
  ctx.lineTo(c.x, c.y + 18 * cam.zoom);
  ctx.stroke();
  r.picks.push({ type: 'site', id: p.id, x: c.x, y: y + bh / 2, r: bw / 2 });
}
