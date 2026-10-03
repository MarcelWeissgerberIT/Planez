// Plastische Darstellung: Sprites werden in Scheiben übereinander gestapelt (unten dunkel, oben hell).
// So bekommen Rumpf, Triebwerke und Fahrzeuge echte Höhe statt flach auf dem Boden zu kleben.
import { IMG } from '../assets.js';
import { clamp } from '../util.js';
import { ZS } from '../config.js';
import { Q } from './quality.js';

// Triebwerke je Flugzeug-Sprite: [Mitte x, Anfang y, Ende y, Breite] (x/Breite relativ zur Bildbreite, y zur Höhe)
const ENGINES = {
  plane_narrow: [[0.339, 0.293, 0.406, 0.082], [0.661, 0.293, 0.406, 0.082]],
  plane_wide: [[0.33, 0.278, 0.388, 0.082], [0.66, 0.278, 0.388, 0.082]],
  plane_prop: [[0.355, 0.28, 0.478, 0.045], [0.641, 0.28, 0.478, 0.045]],
  plane_cargo: [[0.33, 0.32, 0.433, 0.057], [0.666, 0.32, 0.433, 0.057], [0.189, 0.393, 0.498, 0.057], [0.807, 0.393, 0.498, 0.057]],
  plane_bizjet: [[0.416, 0.609, 0.775, 0.073], [0.59, 0.609, 0.775, 0.073]],
  plane_super: [[0.318, 0.278, 0.378, 0.06], [0.678, 0.278, 0.378, 0.06], [0.182, 0.372, 0.468, 0.056], [0.814, 0.372, 0.468, 0.056]],
};
// Flügellage: tief (unter dem Rumpf), hoch (Schulterdecker) – Triebwerke am Heck beim Bizjet
const WING = { plane_prop: 'high', plane_bizjet: 'low' };
const REAR = { plane_bizjet: true };

const TONES = [0.34, 0.46, 0.58, 0.7, 0.82, 0.92, 1];
const SHADE = [14, 20, 34];

function tone(src, sx, sy, sw, sh, f, scale = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const g = c.getContext('2d');
  g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  if (f < 1) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(${SHADE[0]},${SHADE[1]},${SHADE[2]},${1 - f})`;
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

// einfarbige Silhouette eines Ausschnitts (glatte Rumpfseiten statt Textur-Streifen)
function silhouette(src, sx, sy, sw, sh, col) {
  const c = tone(src, sx, sy, sw, sh, 1);
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = col;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
const shadeCol = (c, f) => `rgb(${Math.round(c[0] * f + SHADE[0] * (1 - f))},${Math.round(c[1] * f + SHADE[1] * (1 - f))},${Math.round(c[2] * f + SHADE[2] * (1 - f))})`;

// Fensterreihe an beiden Rumpfseiten
function windowSlice(src, x0, bw, H, col) {
  const c = silhouette(src, x0, 0, bw, H, col);
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(20,32,48,0.9)';
  const e = Math.max(1, c.width * 0.2);
  for (let y = c.height * 0.14; y < c.height * 0.8; y += c.height * 0.016) {
    g.fillRect(0, y, e, c.height * 0.008);
    g.fillRect(c.width - e, y, e, c.height * 0.008);
  }
  // Cockpitscheiben seitlich
  g.fillRect(0, c.height * 0.034, e * 1.4, c.height * 0.016);
  g.fillRect(c.width - e * 1.4, c.height * 0.034, e * 1.4, c.height * 0.016);
  return c;
}

// obere Rumpfhälfte glänzt: heller Streifen längs der Mittellinie
function highlight(src, sx, sy, sw, sh) {
  const c = tone(src, sx, sy, sw, sh, 1);
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, c.width, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.32, 'rgba(255,255,255,0.28)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  gr.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

const acCache = {};
function liverySlice(v, im, col) {
  if (!v.band.livery[col]) v.band.livery[col] = silhouette(im, v.band.x0, 0, v.band.bw, v.H, col);
  return v.band.livery[col];
}
// Rumpfband (Spalten, die fast über die ganze Länge belegt sind) und Triebwerke eines Flugzeug-Sprites
function acVol(name) {
  if (acCache[name] !== undefined) return acCache[name];
  const im = IMG[name];
  if (!im) return (acCache[name] = null);
  const W = im.width, H = im.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  let data;
  try {
    data = g.getImageData(0, 0, W, H).data;
  } catch (e) {
    return (acCache[name] = null);
  }
  let x0 = W, x1 = 0;
  for (let x = Math.floor(W * 0.3); x < W * 0.7; x++) {
    let n = 0;
    for (let y = 0; y < H; y += 2) if (data[(y * W + x) * 4 + 3] > 40) n++;
    if (n / (H / 2) > 0.6) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
  }
  if (x1 <= x0) {
    x0 = W * 0.45;
    x1 = W * 0.55;
  }
  const bw = x1 - x0 + 1;
  // mittlere Rumpffarbe
  let r = 0, gg = 0, b = 0, k = 0;
  for (let y = Math.floor(H * 0.2); y < H * 0.8; y += 3)
    for (let x = x0; x <= x1; x += 2) {
      const i = (y * W + x) * 4;
      if (data[i + 3] > 200) {
        r += data[i];
        gg += data[i + 1];
        b += data[i + 2];
        k++;
      }
    }
  const base = k ? [r / k, gg / k, b / k] : [230, 232, 236];
  const band = {
    x0,
    bw,
    base,
    tones: TONES.map((f) => silhouette(im, x0, 0, bw, H, shadeCol(base, f))),
    windows: windowSlice(im, x0, bw, H, shadeCol(base, 0.9)),
    top: highlight(im, x0, 0, bw, H),
    livery: {},
  };
  const engines = (ENGINES[name] || []).map(([cx, y0, y1, w]) => {
    const sx = (cx - w / 2) * W, sw = w * W, sy = y0 * H, sh = (y1 - y0) * H;
    return { sx, sw, sy, sh, cx: cx - 0.5, tones: TONES.map((f) => tone(im, sx, sy, sw, sh, f)), top: highlight(im, sx, sy, sw, sh) };
  });
  const wingDark = tone(im, 0, 0, W, H, 0.55, Math.min(1, 256 / Math.max(W, H)));
  return (acCache[name] = { W, H, band, engines, wingDark, wing: WING[name] || 'low', rear: !!REAR[name] });
}

// Basis-Transformation (Iso, Position, Drehung) einmal je Objekt; Höhen danach nur als Pixelversatz
function frame(ctx, cam, x, y, rot) {
  cam.setIso(ctx, 0);
  ctx.translate(x, y);
  ctx.rotate(rot);
  const m = ctx.getTransform();
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f, k: ZS * cam.zoom * cam.dpr };
}
const atZ = (ctx, F, z) => ctx.setTransform(F.a, F.b, F.c, F.d, F.e, F.f - z * F.k);

// Stapel eines Bildausschnitts. dx/dy: Mitte (lokal), w/l: Breite/Länge; z0..z1 Höhe; round = runder Querschnitt
function stack(ctx, F, zoom, part, dx, dy, w, l, z0, z1, round, maxN = 18) {
  const n = clamp(Math.round(((z1 - z0) * ZS * zoom) / 1.1), 1, maxN);
  const tn = part.tones.length;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 unten … 1 oben
    const h = t * 2 - 1;
    const k = round ? Math.sqrt(Math.max(0, 1 - h * h * 0.92)) : 1;
    if (k < 0.12) continue;
    const img = i === n ? part.top : part.tones[clamp(Math.round(t * (tn - 1)), 0, tn - 1)];
    atZ(ctx, F, z0 + (z1 - z0) * t);
    ctx.drawImage(img, dx - (w * k) / 2, dy - l / 2, w * k, l);
  }
}

// Flugzeug mit Volumen: Fahrwerk, Flügel (mit Kante), Triebwerke, runder Rumpf
// nur die Höhenmaße des Rumpfs (für Lichter), ohne zu zeichnen
export function aircraftDims(ac, name, Wd) {
  const v = acVol(name);
  if (!v) return { top: ac.z + 0.2, mid: ac.z + 0.12, r: 0.1, wing: ac.z + 0.07 };
  const r = ((v.band.bw / v.W) * Wd) / 2;
  const zBot = ac.z + r * (v.wing === 'high' ? 0.55 : 0.85);
  return { r, mid: zBot + r, top: zBot + 2 * r, wing: v.wing === 'high' ? zBot + 2 * r - r * 0.25 : zBot + r * 0.3 };
}

export function drawAircraftBody(ctx, cam, ac, img, name, L, Wd, rot, onGround, livery) {
  const v = acVol(name);
  const F = frame(ctx, cam, ac.x, ac.y, rot);
  if (!v) {
    atZ(ctx, F, ac.z + 0.07);
    if (img) ctx.drawImage(img, -Wd / 2, -L / 2, Wd, L);
    return { top: ac.z + 0.2, mid: ac.z + 0.12, r: 0.1, wing: ac.z + 0.07 };
  }
  const fw = (v.band.bw / v.W) * Wd; // Rumpfbreite in Kacheln
  const r = fw / 2;
  const gear = r * (v.wing === 'high' ? 0.55 : 0.85);
  const zBot = ac.z + gear;
  const zMid = zBot + r;
  const zTop = zBot + 2 * r;
  const zWing = v.wing === 'high' ? zTop - r * 0.25 : zBot + r * 0.3;
  const bx = ((v.band.x0 + v.band.bw / 2) / v.W - 0.5) * Wd;
  const hpx = (zTop - zBot) * ZS * cam.zoom;
  const detail = hpx >= 3.5;

  // Fahrwerk (nur am Boden): Federbeine als Linien, Radpakete als dunkle Rechtecke am Boden
  if (onGround && detail) {
    const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
    const legs = [[0.36, 0, 0.5], [-0.04, r * 1.4, 1], [-0.04, -r * 1.4, 1]];
    atZ(ctx, F, ac.z + 0.004);
    ctx.fillStyle = '#16181c';
    for (const [f, sx, big] of legs) ctx.fillRect(sx - r * 0.28 * big, -f * L - r * 0.4 * big, r * 0.56 * big, r * 0.8 * big);
    cam.setScreen(ctx);
    ctx.strokeStyle = '#3a3f46';
    ctx.lineWidth = Math.max(1, r * 0.22 * ZS * cam.zoom);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [f, sx] of legs) {
      const gx = ac.x + fx * f * L + rx * sx, gy = ac.y + fy * f * L + ry * sx;
      const a = cam.toScreen(gx, gy, ac.z + r * 0.15), b = cam.toScreen(gx, gy, zBot + r * 0.5);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // Rumpf als Scheibenstapel (runder Querschnitt); zwei Durchgänge, damit der Flügel dazwischen liegt
  const part = v.band;
  const nF = detail ? clamp(Math.round(hpx / 1.1), 3, Q.slices) : 2;
  const iWing = clamp(Math.floor(((zWing - zBot) / (zTop - zBot)) * nF), 0, nF);
  const tn = part.tones.length;
  const iWin = nF >= 4 ? Math.round(nF * 0.7) : -1;
  const iLiv = nF >= 5 ? Math.round(nF * 0.42) : -1;
  const livImg = livery && iLiv >= 0 ? liverySlice(v, img, livery) : null;
  // Nase (vorn) und Heckkonus (hinten) je Scheibe stauchen statt abschneiden:
  // runde Nasenkuppel mit Spitze knapp unter der Mitte, Heck unten hochgezogen – ohne Stufen
  const LN = 0.095, LT = 0.24;
  const drawFus = (from, to) => {
    for (let i = from; i <= to; i++) {
      const t = i / nF;
      const h = t * 2 - 1;
      const k = Math.sqrt(Math.max(0, 1 - h * h * 0.94));
      if (k < 0.15) continue;
      const im = i === nF ? part.top : i === iWin ? part.windows : i === iLiv && livImg ? livImg : part.tones[clamp(Math.round(t * (tn - 1)), 0, tn - 1)];
      const hn = (h + 0.18) / 1.1;
      const fn = LN * (1 - Math.sqrt(Math.max(0, 1 - hn * hn)));
      const ft = LT * (0.8 * Math.pow(clamp((0.3 - h) / 1.3, 0, 1), 1.2) + (h > 0.7 ? 0.2 * (h - 0.7) / 0.3 : 0));
      const W = fw * k, x = bx - W / 2, y0 = -L / 2;
      const H = im.height;
      atZ(ctx, F, zBot + (zTop - zBot) * t);
      ctx.drawImage(im, 0, 0, im.width, H * LN, x, y0 + L * fn, W, L * (LN - fn));
      ctx.drawImage(im, 0, H * LN, im.width, H * (1 - LN - LT), x, y0 + L * LN, W, L * (1 - LN - LT));
      ctx.drawImage(im, 0, H * (1 - LT), im.width, H * LT, x, y0 + L * (1 - LT), W, L * (LT - ft));
    }
  };

  // Triebwerke (bei weitem Zoom reicht das Flügelbild)
  const drawEngines = () => {
    if (!detail) return;
    for (const e of v.engines) {
      const ew = (e.sw / v.W) * Wd, el = (e.sh / v.H) * L;
      const er = ew / 2;
      const zc = v.rear ? zMid + r * 0.15 : v.wing === 'high' ? zWing - er * 0.2 : zWing - er * 0.9;
      stack(ctx, F, cam.zoom, e, e.cx * Wd, -L / 2 + ((e.sy + e.sh / 2) / v.H) * L, ew, el, zc - er, zc + er, true, Q.vehSlices);
    }
  };

  if (v.wing !== 'high') {
    drawFus(0, iWing);
    if (!v.rear) drawEngines();
  }
  // Flügel mit dunkler Unterkante (Dicke); Heckteil (Höhenleitwerk) sitzt höher, auf halber Rumpfhöhe
  const TS = 0.74;
  const zTail = v.wing === 'high' ? zWing : zMid + r * 0.1;
  const part2 = (im, z) => {
    const H = im.height, W = im.width;
    atZ(ctx, F, z);
    ctx.drawImage(im, 0, 0, W, H * TS, -Wd / 2, -L / 2, Wd, L * TS);
  };
  const tail2 = (im, z) => {
    const H = im.height, W = im.width;
    atZ(ctx, F, z);
    ctx.drawImage(im, 0, H * TS, W, H * (1 - TS), -Wd / 2, -L / 2 + L * TS, Wd, L * (1 - TS));
  };
  if (detail) part2(v.wingDark, zWing - Math.max(0.012, r * 0.14));
  part2(img, zWing);
  if (v.wing === 'high') {
    drawFus(0, nF);
    drawEngines();
    if (detail) tail2(v.wingDark, zTail - 0.012);
    tail2(img, zTail);
  } else {
    // Rumpf bis zur Leitwerkshöhe, dann Höhenleitwerk, dann obere Rumpfhälfte
    const iTail = clamp(Math.floor(((zTail - zBot) / (zTop - zBot)) * nF), iWing + 1, nF);
    drawFus(iWing + 1, iTail);
    if (detail) tail2(v.wingDark, zTail - Math.max(0.01, r * 0.1));
    tail2(img, zTail);
    drawFus(iTail + 1, nF);
    if (v.rear) drawEngines();
  }
  return { top: zTop, mid: zMid, r, wing: zWing };
}

// ---------- Fahrzeuge ----------
const vehCache = {};
function vehVol(name) {
  if (vehCache[name] !== undefined) return vehCache[name];
  const im = IMG[name];
  if (!im) return (vehCache[name] = null);
  const s = Math.min(1, 128 / Math.max(im.width, im.height));
  return (vehCache[name] = { tones: TONES.map((f) => tone(im, 0, 0, im.width, im.height, f * 0.95, s)), top: tone(im, 0, 0, im.width, im.height, 1, Math.min(1, 256 / Math.max(im.width, im.height))) });
}

// Fahrzeugkörper: Sprite als Dach, abgedunkelte Scheiben als Seitenwände, Räder unten
export function drawVehicleBody(ctx, cam, name, x, y, hdg, L, Wd, height, lift = 0.02) {
  const v = vehVol(name);
  if (!v) return;
  const F = frame(ctx, cam, x, y, hdg + Math.PI / 2);
  if (height * ZS * cam.zoom >= 2) {
    atZ(ctx, F, 0.005);
    ctx.fillStyle = '#121418';
    const wr = Math.min(0.07, L * 0.14);
    for (const fy of [-L * 0.32, L * 0.32]) {
      ctx.fillRect(-Wd / 2 - 0.004, fy - wr / 2, Wd * 0.2, wr);
      ctx.fillRect(Wd / 2 - Wd * 0.2 + 0.004, fy - wr / 2, Wd * 0.2, wr);
    }
  }
  stack(ctx, F, cam.zoom, v, 0, 0, Wd, L, lift, lift + height, false, Q.vehSlices);
}

// Auto aus zwei Quadern (Karosserie + Kabine) mit Licht-/Schattenseiten; sc = Maßstab, zb = Bodenhöhe
export function drawCarBody(ctx, cam, x, y, h, color, prism, mixFn, simple = false, sc = 1, zb = 0) {
  const fx = Math.cos(h), fy = Math.sin(h);
  const rx = -fy, ry = fx;
  const box = (f0, f1, s, z0, z1, top, sa, sb) => {
    f0 *= sc;
    f1 *= sc;
    s *= sc;
    const pts = [
      { x: x + fx * f0 + rx * s, y: y + fy * f0 + ry * s },
      { x: x + fx * f1 + rx * s, y: y + fy * f1 + ry * s },
      { x: x + fx * f1 - rx * s, y: y + fy * f1 - ry * s },
      { x: x + fx * f0 - rx * s, y: y + fy * f0 - ry * s },
    ];
    prism(ctx, cam, pts, zb + z0 * sc, zb + z1 * sc, top, sa, sb);
  };
  const c = mixFn(color);
  box(-0.15, 0.15, 0.065, 0.015, 0.058, c.top, c.a, c.b);
  if (!simple) box(-0.07, 0.07, 0.057, 0.058, 0.095, c.glassTop, c.glassA, c.glassB);
}
