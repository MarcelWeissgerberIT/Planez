// Solarpark und Bahnhof: Boden (Gleise), Gebäude, Solarfelder (vorgerendert) und fahrende Züge
import * as LY from '../layout.js';
import { clamp } from '../util.js';
import { HALF_W, HALF_H } from './camera.js';
import { ZS } from '../config.js';

// ---------- Boden (in den Boden-Cache) ----------
export function drawRailGround(g, state) {
  if (!state.upgrades.rail) return;
  const R = LY.RAIL;
  // Schotterbett, Schwellen, Schienen
  g.fillStyle = '#7b756b';
  g.fillRect(R.x0, R.y - 0.28, R.x1 - R.x0, 0.56);
  g.fillStyle = '#5b4a3a';
  for (let x = R.x0; x < R.x1; x += 0.16) g.fillRect(x, R.y - 0.19, 0.06, 0.38);
  g.fillStyle = '#c9ced6';
  g.fillRect(R.x0, R.y - 0.1, R.x1 - R.x0, 0.025);
  g.fillRect(R.x0, R.y + 0.075, R.x1 - R.x0, 0.025);
  // Prellbock
  g.fillStyle = '#b91c1c';
  g.fillRect(R.x1 - 0.1, R.y - 0.2, 0.12, 0.4);
  // Bahnsteig mit Sicherheitslinie
  g.fillStyle = '#b8b3a8';
  g.fillRect(R.station.x0 - 0.3, R.platform.y0, R.station.x1 - R.station.x0 + 0.6, R.platform.y1 - R.platform.y0);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillRect(R.station.x0 - 0.3, R.platform.y0 + 0.06, R.station.x1 - R.station.x0 + 0.6, 0.03);
  // Vorplatz zwischen Halle und Bahnsteig, Fußweg zum Terminal
  g.fillStyle = '#b9b5ab';
  g.fillRect(R.station.x0 - 0.3, R.station.y1, R.station.x1 - R.station.x0 + 0.6, R.platform.y0 - R.station.y1);
  g.fillRect(R.station.x1, 2.75, 12.2 - R.station.x1, 0.35);
  g.fillRect(11.85, 1.0, 0.35, 2.1);
}

// ---------- Solarpark (vorgerendert) ----------
function bake(fn, x0, y0, x1, y1, top) {
  const Z = 2.4, pad = 6;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0 + y1 - y0) * HALF_W * Z) + pad * 2;
  c.height = Math.ceil((x1 - x0 + y1 - y0) * HALF_H * Z + top * ZS * Z) + pad * 2;
  const g = c.getContext('2d');
  const ox = pad - (x0 - y1) * HALF_W * Z, oy = pad - (x0 + y0) * HALF_H * Z + top * ZS * Z;
  const P = (wx, wy, wz = 0) => ({ x: (wx - wy) * HALF_W * Z + ox, y: (wx + wy) * HALF_H * Z - wz * ZS * Z + oy });
  fn(g, P, Z);
  const f = P(x0, y0, 0);
  return { c, Z, fx: f.x, fy: f.y, x0, y0 };
}
const quad = (g, pts, fill) => {
  g.fillStyle = fill;
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fill();
};

function bakeSolar() {
  const S = LY.SOLAR;
  return bake((g, P) => {
    for (let y = S.y0; y < S.y1 - 0.3; y += 0.62) {
      for (let x = S.x0; x < S.x1 - 0.2; x += 3.1) {
        const x2 = Math.min(S.x1, x + 2.9);
        // Stützen
        for (const sx of [x + 0.2, x2 - 0.2]) {
          const a = P(sx, y + 0.3, 0), b = P(sx, y + 0.3, 0.07);
          g.strokeStyle = '#4b5563';
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
        // Moduloberfläche (nach Süden geneigt: hinten hoch, vorn tief)
        const p0 = P(x, y, 0.2), p1 = P(x2, y, 0.2), p2 = P(x2, y + 0.4, 0.07), p3 = P(x, y + 0.4, 0.07);
        const gr = g.createLinearGradient(p0.x, p0.y, p3.x, p3.y);
        gr.addColorStop(0, '#2c4f7c');
        gr.addColorStop(1, '#122a4a');
        quad(g, [p0, p1, p2, p3], gr);
        // Rahmen und Zellraster
        g.strokeStyle = 'rgba(200,220,245,0.35)';
        g.lineWidth = 0.6;
        for (let k = 1; k < 8; k++) {
          const u = x + ((x2 - x) * k) / 8;
          const a = P(u, y, 0.2), b = P(u, y + 0.4, 0.07);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
        const m0 = P(x, y + 0.2, 0.135), m1 = P(x2, y + 0.2, 0.135);
        g.beginPath();
        g.moveTo(m0.x, m0.y);
        g.lineTo(m1.x, m1.y);
        g.stroke();
        // Glanzlicht
        quad(g, [P(x, y, 0.2), P(x2, y, 0.2), P(x2, y + 0.06, 0.18), P(x, y + 0.06, 0.18)], 'rgba(255,255,255,0.18)');
      }
    }
    // Wechselrichter-Station
    const bx = S.x0 - 1.0, by = S.y0 + 1.6;
    quad(g, [P(bx, by, 0.3), P(bx + 0.8, by, 0.3), P(bx + 0.8, by + 0.6, 0.3), P(bx, by + 0.6, 0.3)], '#e5e7eb');
    quad(g, [P(bx, by + 0.6, 0), P(bx + 0.8, by + 0.6, 0), P(bx + 0.8, by + 0.6, 0.3), P(bx, by + 0.6, 0.3)], '#9ca3af');
    quad(g, [P(bx + 0.8, by, 0), P(bx + 0.8, by + 0.6, 0), P(bx + 0.8, by + 0.6, 0.3), P(bx + 0.8, by, 0.3)], '#cbd5e1');
  }, S.x0 - 1.2, S.y0, S.x1, S.y1, 0.4);
}

function bakeStation() {
  const R = LY.RAIL, B = R.station;
  return bake((g, P) => {
    const box = (x0, y0, x1, y1, z0, z1, top, front, side) => {
      quad(g, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], front);
      quad(g, [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], side);
      quad(g, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top);
    };
    // Bahnsteigdach
    for (let x = B.x0; x < B.x1; x += 1.4) {
      const a = P(x + 0.1, (R.platform.y0 + R.platform.y1) / 2, 0.02), b = P(x + 0.1, (R.platform.y0 + R.platform.y1) / 2, 0.34);
      g.strokeStyle = '#64748b';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    box(B.x0 - 0.3, R.platform.y0 - 0.05, B.x1 + 0.3, R.platform.y1 + 0.15, 0.34, 0.38, '#cbd5e1', '#94a3b8', '#a8b4c4');
    // Empfangshalle: Glasfront zum Bahnsteig, Metalldach mit Oberlichtern
    const h2 = 0.42;
    box(B.x0, B.y0, B.x1, B.y1, 0, h2, '#8a97a8', 'rgba(70,120,170,0.95)', 'rgba(90,140,190,0.95)');
    g.strokeStyle = 'rgba(230,240,250,0.75)';
    g.lineWidth = 1;
    for (let x = B.x0 + 0.4; x < B.x1; x += 0.4) {
      const a = P(x, B.y1, 0), b = P(x, B.y1, h2);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    for (let x = B.x0 + 0.5; x < B.x1 - 0.4; x += 1.2) quad(g, [P(x, B.y0 + 0.3, h2 + 0.001), P(x + 0.6, B.y0 + 0.3, h2 + 0.001), P(x + 0.6, B.y1 - 0.3, h2 + 0.001), P(x, B.y1 - 0.3, h2 + 0.001)], 'rgba(150,200,240,0.75)');
    box(B.x0 - 0.08, B.y0 - 0.08, B.x1 + 0.08, B.y1 + 0.08, h2, h2 + 0.05, 'rgba(0,0,0,0)', '#e2e8f0', '#cbd5e1');
    const s0 = P(B.x0 + 0.3, B.y1 + 0.09, h2 + 0.04), s1 = P(B.x0 + 1.3, B.y1 + 0.09, h2 + 0.04), s2 = P(B.x0 + 1.3, B.y1 + 0.09, h2 - 0.14), s3 = P(B.x0 + 0.3, B.y1 + 0.09, h2 - 0.14);
    quad(g, [s0, s1, s2, s3], '#16a34a');
    g.fillStyle = '#fff';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('S', (s0.x + s2.x) / 2, (s0.y + s2.y) / 2);
  }, B.x0 - 0.4, B.y0 - 0.2, B.x1 + 0.4, R.platform.y1 + 0.2, 0.7);
}

function drawBaked(r, key, fnBake) {
  const { ctx, cam } = r;
  if (!r[key]) r[key] = fnBake();
  const B = r[key];
  cam.setScreen(ctx);
  const k = cam.zoom / B.Z;
  const p = cam.toScreen(B.x0, B.y0);
  ctx.drawImage(B.c, p.x - B.fx * k, p.y - B.fy * k, B.c.width * k, B.c.height * k);
}

// ---------- Züge ----------
// Fahrplan: Einfahrt von Westen (12 s), Halt (18 s), Ausfahrt (12 s), Pause (26 s)
const CYCLE = 68;
export function trainPos(vt) {
  const R = LY.RAIL;
  const t = vt % CYCLE;
  const stopX = R.x1 - 0.6; // Zugspitze am Prellbock
  const farX = R.x0 - 8;
  const ease = (u) => 1 - (1 - u) * (1 - u);
  if (t < 12) return { head: farX + (stopX - farX) * ease(t / 12), dwell: false, moving: true };
  if (t < 30) return { head: stopX, dwell: true, moving: false, t: t - 12 };
  if (t < 42) {
    const u = (t - 30) / 12;
    return { head: stopX - (stopX - farX) * u * u, dwell: false, moving: true };
  }
  return null;
}

function drawTrain(r, head, night, lights) {
  const { ctx, cam } = r;
  const R = LY.RAIL;
  const cars = 4, L = 1.3, gap = 0.05;
  for (let i = cars - 1; i >= 0; i--) {
    const x1 = head - i * (L + gap), x0 = x1 - L;
    if (x1 < R.x0 - 0.2) continue;
    const xa = Math.max(x0, R.x0 - 0.2);
    const y0 = R.y - 0.13, y1 = R.y + 0.13;
    const pts = [{ x: xa, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: xa, y: y1 }];
    r.prism(pts, 0.03, 0.26, [240, 242, 245], [205, 30, 40], [170, 24, 32]);
    // Fensterband
    r.prism([{ x: xa + 0.08, y: y1 - 0.001 }, { x: x1 - 0.08, y: y1 - 0.001 }, { x: x1 - 0.08, y: y1 }, { x: xa + 0.08, y: y1 }], 0.13, 0.21, [40, 60, 84], night > 0.3 ? [255, 236, 170] : [40, 64, 92], [30, 48, 70]);
  }
  if (night > 0.2) lights.push({ x: head + 0.05, y: R.y, z: 0.12, c: '#fff4d0', s: 16, a: 0.9 });
}

// Zeichenobjekte für Tiefensortierung
export function infraItems(r, state, items, lights, night) {
  const u = state.upgrades;
  if (u.solar) {
    const S = LY.SOLAR;
    items.push({ d: (S.x0 + S.x1) / 2 + S.y0 + 0.5, f: () => drawBaked(r, 'solarBaked', bakeSolar) });
  }
  if (u.rail) {
    const B = LY.RAIL.station;
    items.push({ d: (B.x0 + B.x1) / 2 + B.y0, f: () => drawBaked(r, 'stationBaked', bakeStation) });
    const tp = trainPos(r.ambient.vt);
    if (tp) items.push({ d: tp.head - 2 + LY.RAIL.y, f: () => drawTrain(r, tp.head, night, lights) });
    if (night > 0.1) for (let x = B.x0; x < B.x1; x += 1.4) lights.push({ x: x + 0.1, y: (LY.RAIL.platform.y0 + LY.RAIL.platform.y1) / 2, z: 0.34, c: '#fff1d6', s: 14, a: 0.8 });
  }
}

// Bäume in bebauten Flächen ausblenden
export function treeBlocked(state, t) {
  const S = LY.SOLAR, R = LY.RAIL;
  if ((state.upgrades.solar || (state.projects || []).some((p) => p.target === 'solar')) && t.x > S.x0 - 1.6 && t.x < S.x1 + 0.6 && t.y > S.y0 - 0.5 && t.y < S.y1 + 0.5) return true;
  if ((state.upgrades.rail || (state.projects || []).some((p) => p.target === 'rail')) && t.x < R.station.x1 + 3.8 && t.y < R.y + 0.9 && t.y > 1.4) return true;
  return false;
}
