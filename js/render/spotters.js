// Spotterhügel östlich des Bahnendes (Anflug auf die 27): Hinter dem Zaun stehen Flugzeugfotografen mit Kameras,
// manche auf Leitern, manche mit Stativ. Wie viele kommen, hängt vom Tag ab: Superjumbo, Staatsbesuch,
// Sonderlackierung oder Tag der offenen Tür locken viele an, bei Regen stehen nur die Hartgesottenen mit Schirm da,
// nachts niemand. Kommt ein Flugzeug nahe vorbei, gehen die Kameras hoch. Nur Darstellung.
import { ZS } from '../config.js';
import { hourOf } from '../util.js';
import { drawPerson } from './ambient.js';
import { HALF_H } from './camera.js';

export const HILL = { x: 77.3, y: 36.9 };
const FENCE_Y = 35.35;
const COLS = ['#334155', '#1d4ed8', '#15803d', '#b91c1c', '#a16207', '#6d28d9', '#0f766e', '#475569'];
const h01 = (i, k) => {
  let x = Math.imul(i * 2246822519 + k * 3266489917, 668265263) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2654435761) >>> 0;
  return (x >>> 8) / 16777216;
};

// Wie viele Spotter sind gerade da?
export function spotterCount(state) {
  const h = hourOf(state.time);
  if (h < 6 || h > 21.5) return 0;
  const wx = state.weather.kind;
  if (wx === 'storm' || wx === 'fog') return wx === 'fog' ? 1 : 0;
  let n = 4;
  if (state.acs.some((a) => a.type === 'A388' || a.protocol || a.special)) n += 7;
  const od = state.openDay;
  if (od && state.time > od.from && state.time < od.until) n += 4;
  if (h < 8 || h > 19) n -= 2;
  if (wx === 'rain' || wx === 'snow') n = Math.ceil(n * 0.5);
  return Math.max(0, Math.min(16, n));
}

export function spotterHillItems(r, state, items, visible, lights) {
  if (!visible(HILL.x, HILL.y)) return;
  // flacher Grashügel
  items.push({
    d: HILL.x + HILL.y - 3,
    f: () => {
      const { ctx, cam } = r;
      cam.setIso(ctx, 0);
      ctx.fillStyle = 'rgba(70,110,40,0.35)';
      ctx.beginPath();
      ctx.ellipse(HILL.x, HILL.y, 2.1, 1.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,175,90,0.22)';
      ctx.beginPath();
      ctx.ellipse(HILL.x - 0.2, HILL.y - 0.15, 1.4, 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Trampelpfad
      ctx.strokeStyle = 'rgba(160,140,100,0.45)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(HILL.x + 0.4, HILL.y + 1.2);
      ctx.quadraticCurveTo(HILL.x + 1.2, HILL.y + 2.2, HILL.x + 2.4, HILL.y + 2.8);
      ctx.stroke();
    },
  });
  // Zaun zwischen Hügel und Bahn
  items.push({
    d: HILL.x + FENCE_Y,
    f: () => {
      const { ctx, cam } = r;
      cam.setScreen(ctx);
      ctx.strokeStyle = 'rgba(160,170,180,0.85)';
      ctx.lineWidth = Math.max(0.6, 0.6 * cam.zoom);
      const x0 = HILL.x - 2.6, x1 = Math.min(79.8, HILL.x + 2.4);
      for (const z of [0.05, 0.1, 0.15]) {
        const a = cam.toScreen(x0, FENCE_Y, z), b = cam.toScreen(x1, FENCE_Y, z);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.lineWidth = Math.max(1, 0.9 * cam.zoom);
      ctx.strokeStyle = 'rgba(110,118,128,0.95)';
      for (let x = x0; x <= x1 + 1e-6; x += 0.5) {
        const a = cam.toScreen(x, FENCE_Y, 0), b = cam.toScreen(x, FENCE_Y, 0.17);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    },
  });
  const n = spotterCount(state);
  if (!n) return;
  // Kommt gerade ein Flugzeug nahe vorbei? Dann Kameras hoch
  const close = state.acs.some((a) => a.mode === 'map' && Math.hypot(a.x - HILL.x, a.y - HILL.y) < 13 && (a.z > 0.05 || a.v > 0.1));
  const wet = state.weather.kind === 'rain' || state.weather.kind === 'snow';
  for (let i = 0; i < n; i++) {
    const x = HILL.x + (h01(i, 1) - 0.5) * 3.0;
    const y = FENCE_Y + 0.3 + h01(i, 2) * (i < 8 ? 0.35 : 0.9); // die meisten direkt am Zaun
    const kind = i % 4 === 0 ? 'ladder' : i % 4 === 1 ? 'tripod' : 'hand';
    const col = COLS[Math.floor(h01(i, 3) * COLS.length)];
    items.push({ d: x + y, f: () => drawSpotter(r, x, y, col, kind, close, wet && i % 2 === 0, i) });
    // ab und zu ein Blitz, wenn ein Flugzeug nah vorbeizieht
    if (close && lights && ((r.time * 2.3 + i * 0.17) % 1) < 0.035) lights.push({ x, y, z: 0.15, c: '#ffffff', s: 9, a: 0.95, day: true });
  }
}

function drawSpotter(r, x, y, col, kind, up, umbrella, i) {
  const { ctx, cam } = r;
  const zm = cam.zoom;
  const lift = kind === 'ladder' ? 0.07 : 0;
  if (kind === 'ladder') {
    // kleine Trittleiter
    cam.setScreen(ctx);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = Math.max(1, 0.8 * zm);
    for (const dx of [-0.05, 0.05]) {
      const a = cam.toScreen(x + dx, y, 0), b = cam.toScreen(x + dx, y, lift);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  // Person (auf der Leiter etwas höher)
  // auf der Leiter: Bodenpunkt so verschieben, dass die Figur um „lift“ höher erscheint (gleiche Bildspalte)
  const d = (lift * ZS) / (2 * HALF_H);
  drawPerson(r, x - d, y - d, col, 1, false, 0, false, false, false);
  cam.setScreen(ctx);
  const b = cam.toScreen(x, y, lift);
  const H = 0.12 * ZS * zm;
  const w = Math.max(1, 0.035 * ZS * zm);
  // Kamera: oben vor dem Gesicht (zum Anflug gerichtet) oder locker vor der Brust
  const cy = up ? b.y - H * 0.9 : b.y - H * 0.6;
  const cx = b.x + w * (up ? 0.55 : 0.35);
  ctx.fillStyle = '#111827';
  ctx.fillRect(cx - w * 0.35, cy - w * 0.3, w * 0.8, w * 0.6);
  // Teleobjektiv in Richtung Bahn (Norden = nach rechts oben)
  ctx.strokeStyle = kind === 'tripod' ? '#e5e7eb' : '#1f2937';
  ctx.lineWidth = Math.max(1, w * 0.4);
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.4, cy);
  ctx.lineTo(cx + w * (up ? 1.4 : 1.0), cy - w * (up ? 0.6 : 0.3));
  ctx.stroke();
  if (kind === 'tripod') {
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = Math.max(0.7, w * 0.18);
    const tx = cx + w * 1.2, ty = cy + w * 0.2;
    for (const dx of [-0.5, 0.2, 0.8]) {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + dx * w * 1.4, b.y + w * 0.2);
      ctx.stroke();
    }
  }
  if (umbrella) {
    const u = cam.toScreen(x, y, lift + 0.2);
    ctx.fillStyle = ['#1e3a8a', '#7f1d1d', '#0f172a', '#14532d'][i % 4];
    ctx.beginPath();
    ctx.ellipse(u.x, u.y, w * 2.2, w * 0.9, 0, Math.PI, 2 * Math.PI);
    ctx.fill();
  }
}
