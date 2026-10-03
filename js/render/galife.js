// Leben am kleinen Platz (Aufbau-Modus: Grasplatz und Verkehrslandeplatz). Nur Darstellung, ohne eigenen Zustand –
// alles ergibt sich aus Spielzeit, Wetter und den Umläufen der Simulation:
// - Pilot und Mitflieger steigen aus, gehen ins Vereinsheim, sitzen auf der Terrasse und essen; vor dem Abflug kommen
//   sie zurück, der Pilot geht einmal ums Flugzeug (Außencheck), dann steigen alle ein
// - Absetzflüge: Springer kommen mit Fallschirm zum Flugzeug, gut 20 Minuten nach dem Start schweben die Schirme ein
// - der Platzwart fährt mit Quad und AvGas-Anhänger von der Tankstelle zum Flugzeug und tankt es auf
// - Ausflügler bei Kaffee und Kuchen auf der Terrasse, Zuschauer am Zaun, Autos auf dem Schotterparkplatz
// - Flugplatzfest: Festzelt, Würstchenbude mit Schlange, Hüpfburg, Wimpel am Zaun, Besucher und Wiesenparkplatz
import * as LY from '../layout.js';
import { ZS } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { clamp, hourOf } from '../util.js';

const WALK = 0.045; // Kacheln je Spielsekunde (gut 1 m/s)
const DRIVE = 0.11; // Quad
const TABLES = [{ x: 46.43, y: 14.63 }, { x: 46.76, y: 14.54 }, { x: 47.1, y: 14.49 }]; // Tische auf der Terrasse (Sprite)
const SEATS = TABLES.flatMap((t) => [[-0.07, 0.13], [0.07, 0.13], [-0.07, -0.12], [0.07, -0.12]].map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })));
const CLUB_D = 61.2; // Zeichentiefe knapp über dem Vereinsheim (Terrasse liegt in seiner Grundfläche)
const DECK_IN = { x: 46.02, y: 15.02 }; // Aufgang zur Terrasse (Westende)
const GATE = { x: 46.85, y: 12.7 }; // Tor im Zaun vom Parkplatz
const PUMP = { x: 40.5, y: 15.9 }; // Vorplatz der Tankstelle
const LZ = { x: 56.4, y: 17.8 }; // Landewiese der Fallschirmspringer
const FENCE_Y = 12.9;

const SHIRTS = ['#1d4ed8', '#b91c1c', '#f8fafc', '#111827', '#15803d', '#a855f7', '#f59e0b', '#0e7490', '#be185d', '#57534e', '#fb7185', '#84cc16'];
const PANTS = ['#1f2937', '#334155', '#1e3a8a', '#44403c', '#0f172a', '#78716c', '#e7e5e4'];
const SKIN = ['#f1c7a3', '#e0b48c', '#c68b5e', '#8d5a3b', '#f5d6bd'];
const HAIR = ['#2b1d12', '#5b3a1e', '#a16207', '#d6b370', '#111827', '#9ca3af', '#7c2d12'];
const SUITS = ['#0ea5e9', '#f97316', '#e11d48', '#16a34a', '#7c3aed', '#facc15'];
const CAR_COLS = ['#e2e8f0', '#1f2937', '#b91c1c', '#1d4ed8', '#9ca3af', '#065f46', '#f8fafc', '#475569', '#7c2d12', '#a16207'];

// fester Zufall
const h01 = (a, b = 0) => {
  let x = Math.imul((a | 0) * 374761393 + b * 668265263 + 1013904223, 1274126177) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1103515245) >>> 0;
  return ((x ^ (x >>> 16)) >>> 8) / 16777216;
};
const sh = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const pick = (arr, a, b) => arr[Math.floor(h01(a, b) * arr.length)];
const look = (seed) => ({ shirt: pick(SHIRTS, seed, 1), pants: pick(PANTS, seed, 2), skin: pick(SKIN, seed, 3), hair: pick(HAIR, seed, 4), kid: false });

// ---------- Wege ----------
function plen(p) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return L;
}
function along(p, s) {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (s <= L || i === p.length - 1) {
      const u = L > 1e-6 ? clamp(s / L, 0, 1) : 1;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    s -= L;
  }
  return { x: p[0].x, y: p[0].y };
}
// Position t Spielsekunden nach Aufbruch
function walkAt(p, t, v = WALK) {
  const L = plen(p), s = clamp(t * v, 0, L);
  const q = along(p, s);
  q.moving = t > 0 && s < L;
  return q;
}
const rev = (p) => [...p].reverse();

// ---------- Zeichnen ----------
// Person: stehen, gehen, sitzen; Arm heben (essen, zeigen, tanken), Kinder kleiner, Springer mit Fallschirm-Packsack
function drawFig(r, x, y, o, ph = 0) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const zm = cam.zoom;
  const b = cam.toScreen(x, y, o.z || 0);
  const k = o.kid ? 0.62 : 1;
  const H = 0.115 * ZS * zm * k, w = Math.max(1, 0.034 * ZS * zm * k);
  ctx.globalAlpha = o.alpha ?? 1;
  if (!o.z) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(b.x + w * 0.7, b.y, w * 1.3, w * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  let hip;
  if (o.pose === 'sit') {
    hip = b.y - H * 0.38;
    ctx.fillStyle = o.pants;
    ctx.fillRect(b.x - w * 0.5, hip - w * 0.2, w * 1.3, Math.max(1, w * 0.45)); // Oberschenkel
    ctx.fillRect(b.x + w * 0.45, hip, Math.max(1, w * 0.42), b.y - hip); // Unterschenkel
  } else {
    hip = b.y - H * 0.46;
    const step = o.moving ? Math.sin(ph * 7) * w * 0.5 : 0;
    ctx.fillStyle = o.pants;
    ctx.fillRect(b.x - w * 0.5 + step * 0.4, hip, w * 0.45, b.y - hip);
    ctx.fillRect(b.x + w * 0.05 - step * 0.4, hip, w * 0.45, b.y - hip);
  }
  const top = hip - H * 0.4;
  if (o.pack) {
    ctx.fillStyle = o.pack;
    ctx.fillRect(b.x - w * 0.95, top + H * 0.02, w * 0.55, H * 0.34);
  }
  ctx.fillStyle = o.shirt;
  ctx.fillRect(b.x - w * 0.55, top, w * 1.1, hip - top + 1);
  if (o.hivis) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(b.x - w * 0.55, top + H * 0.17, w * 1.1, Math.max(1, H * 0.05));
  }
  // Arm: heben (essen, zeigen, Zapfpistole), sonst locker
  ctx.strokeStyle = o.shirt;
  ctx.lineWidth = Math.max(1, w * 0.32);
  ctx.beginPath();
  ctx.moveTo(b.x + w * 0.5, top + H * 0.05);
  if (o.arm) ctx.lineTo(b.x + w * (0.8 + 0.25 * o.arm), top - H * 0.28 * o.arm + H * 0.12 * (1 - o.arm));
  else ctx.lineTo(b.x + w * 0.62, hip - H * 0.02);
  ctx.stroke();
  if (o.cup && o.arm) {
    ctx.fillStyle = o.cup;
    ctx.fillRect(b.x + w * (0.72 + 0.25 * o.arm), top - H * 0.32 * o.arm + H * 0.08, Math.max(1, w * 0.35), Math.max(1, w * 0.4));
  }
  const hy = top - H * 0.09;
  ctx.fillStyle = o.skin;
  ctx.beginPath();
  ctx.arc(b.x, hy, w * 0.44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = o.cap || o.hair;
  ctx.beginPath();
  ctx.arc(b.x, hy - w * 0.12, w * 0.44, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// gedrehter Quader (Quad, Anhänger): sichtbare Seiten nach Südost, dann Deckel
function boxRot(r, cx, cy, hdg, len, wid, z0, z1, col, dark = 0.72) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const fx = Math.cos(hdg), fy = Math.sin(hdg), rx = -fy, ry = fx;
  const C = [[len, wid], [len, -wid], [-len, -wid], [-len, wid]].map(([a, s]) => ({ x: cx + fx * a + rx * s, y: cy + fy * a + ry * s }));
  for (let i = 0; i < 4; i++) {
    const a = C[i], b2 = C[(i + 1) % 4];
    const nx = b2.y - a.y, ny = -(b2.x - a.x); // Außennormale (Uhrzeigersinn in Bildschirm-Logik egal: Vorzeichen prüfen)
    const mx = (a.x + b2.x) / 2 - cx, my = (a.y + b2.y) / 2 - cy;
    const out = nx * mx + ny * my > 0 ? 1 : -1;
    if ((nx + ny) * out <= 0) continue;
    const p = [cam.toScreen(a.x, a.y, z0), cam.toScreen(b2.x, b2.y, z0), cam.toScreen(b2.x, b2.y, z1), cam.toScreen(a.x, a.y, z1)];
    ctx.fillStyle = shade(col, nx * out > ny * out ? dark : dark * 0.82);
    poly(ctx, p);
  }
  ctx.fillStyle = col;
  poly(ctx, C.map((q) => cam.toScreen(q.x, q.y, z1)));
}
// achsparalleler Quader
function box(r, x0, y0, x1, y1, z0, z1, top, south, east) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const P = (x, y, z) => cam.toScreen(x, y, z);
  ctx.fillStyle = south;
  poly(ctx, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]);
  ctx.fillStyle = east;
  poly(ctx, [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)]);
  if (top) {
    ctx.fillStyle = top;
    poly(ctx, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]);
  }
}
function poly(ctx, p) {
  ctx.beginPath();
  p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.fill();
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

// Festzelt: weiße Wände, rot-weiß gestreiftes Satteldach (First in x-Richtung), offene Giebelseite
function drawMarquee(r, x0, y0, x1, y1) {
  const { ctx, cam } = r;
  const zw = 0.26, zr = 0.52, ym = (y0 + y1) / 2;
  const P = (x, y, z) => cam.toScreen(x, y, z);
  box(r, x0, y0, x1, y1, 0, zw, null, '#e5e7eb', '#cbd5e1');
  cam.setScreen(ctx);
  // Eingang an der Ostseite
  ctx.fillStyle = 'rgba(60,40,30,0.55)';
  poly(ctx, [P(x1 + 0.001, ym - 0.22, 0), P(x1 + 0.001, ym + 0.22, 0), P(x1 + 0.001, ym + 0.22, zw * 0.9), P(x1 + 0.001, ym - 0.22, zw * 0.9)]);
  // Dach: Nordhälfte (dunkler), Südhälfte in Streifen, Giebeldreieck im Osten
  const n = Math.max(4, Math.round((x1 - x0) / 0.32));
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n;
    ctx.fillStyle = i % 2 ? '#b91c1c' : '#e2e8f0';
    poly(ctx, [P(a, y0, zw), P(b, y0, zw), P(b, ym, zr), P(a, ym, zr)]);
    ctx.fillStyle = i % 2 ? '#dc2626' : '#f8fafc';
    poly(ctx, [P(a, ym, zr), P(b, ym, zr), P(b, y1, zw), P(a, y1, zw)]);
  }
  ctx.fillStyle = '#d1d5db';
  poly(ctx, [P(x1, y0, zw), P(x1, y1, zw), P(x1, ym, zr)]);
  // Fähnchen auf dem First
  for (const fx of [x0 + 0.15, x1 - 0.15]) {
    const p0 = P(fx, ym, zr), p1 = P(fx, ym, zr + 0.22);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    poly(ctx, [p1, { x: p1.x + 7 * cam.zoom, y: p1.y + 2 * cam.zoom }, { x: p1.x, y: p1.y + 4 * cam.zoom }]);
  }
}
// Würstchenbude: Holz, rote Markise, Rauch vom Grill
function drawStall(r, x0, y0, x1, y1, t) {
  const { ctx, cam } = r;
  box(r, x0, y0, x1, y1, 0, 0.2, '#92400e', '#a16207', '#854d0e');
  cam.setScreen(ctx);
  const P = (x, y, z) => cam.toScreen(x, y, z);
  for (let i = 0; i < 5; i++) {
    const a = x0 + ((x1 - x0) * i) / 5, b = x0 + ((x1 - x0) * (i + 1)) / 5;
    ctx.fillStyle = i % 2 ? '#f8fafc' : '#dc2626';
    poly(ctx, [P(a, y1, 0.3), P(b, y1, 0.3), P(b, y1 + 0.22, 0.2), P(a, y1 + 0.22, 0.2)]);
  }
  ctx.fillStyle = 'rgba(226,232,240,0.35)';
  for (let k = 0; k < 3; k++) {
    const u = (t * 0.02 + k / 3) % 1;
    const p = P(x1 - 0.15, (y0 + y1) / 2, 0.35 + u * 0.6);
    ctx.beginPath();
    ctx.arc(p.x + u * 6 * cam.zoom, p.y, (2 + u * 5) * cam.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}
// Hüpfburg mit Türmchen
function drawCastle(r, x0, y0, x1, y1, t) {
  const bob = Math.sin(t * 0.9) * 0.01;
  box(r, x0, y0, x1, y1, 0, 0.12, '#2563eb', '#1d4ed8', '#1e40af');
  const s = 0.2;
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) box(r, cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2, 0, 0.36 + bob, '#facc15', '#dc2626', '#b91c1c');
  box(r, x0 + 0.05, y1 - 0.06, x1 - 0.05, y1, 0.12, 0.3 + bob, null, '#ef4444', '#ef4444');
}

// ---------- Belegung ----------
// GA-Flugzeuge an Wiesenplätzen samt Umlauf
function gaParked(state) {
  const out = [];
  for (const ac of state.acs) {
    if (ac.mode !== 'map' || ac.phase !== PH.STAND || ac.stand == null) continue;
    const st = state.stands.find((s) => s.id === ac.stand);
    if (!st || !st.ga) continue;
    const rot = state.rots[ac.rot];
    if (!rot) continue;
    out.push({ ac, rot, seed: sh(String(rot.id)), a: rot.onBlock ?? state.time, dep: Math.max(rot.std || 0, (rot.onBlock ?? state.time) + 900) });
  }
  return out;
}
// Tür (links neben dem Rumpf) und Außencheck-Runde um ein Flugzeug
function doorOf(ac) {
  const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg);
  return { x: ac.x + fy * 0.2 + fx * 0.03, y: ac.y - fx * 0.2 + fy * 0.03 };
}
function walkaroundPts(ac) {
  const L = ac.len, fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
  const P = (a, s) => ({ x: ac.x + fx * a * L + rx * s * L, y: ac.y + fy * a * L + ry * s * L });
  return [P(0.1, -0.55), P(0.75, -0.3), P(0.75, 0.3), P(0.1, 0.8), P(-0.6, 0.3), P(-0.6, -0.3), P(0.1, -0.55)];
}
const toClub = (from) => [from, { x: from.x, y: Math.min(from.y, 17.3) }, { x: 46.1, y: 15.6 }, DECK_IN];
const fromGate = () => [GATE, { x: 45.92, y: 13.05 }, { x: 45.86, y: 14.9 }, DECK_IN];

// Kaffee und Kuchen: Anteil belegter Plätze nach Uhrzeit (Mittag, Nachmittag), Wetter, Wochenende, Bekanntheit, Fest
function cafeRate(state, hr, nice, fest) {
  if (hr < 9 || hr > 19.5) return 0;
  let base = hr < 11.5 ? 0.22 : hr < 13.8 ? 0.55 : hr < 17.5 ? 0.7 : 0.35;
  const day = Math.floor(state.time / 86400) + 1;
  if ([6, 0].includes(day % 7)) base *= 1.45;
  const fame = (state.career && state.career.fame) || 8;
  return clamp(base * nice * (0.55 + fame / 70) * (fest ? 1.8 : 1), 0, 0.95);
}

export function gaLifeItems(r, state, items, lights, night, vis) {
  if (LY.GEO.stage > 1) return;
  const t = state.time, hr = hourOf(t), zoom = r.cam.zoom, vt = r.time || 0;
  const wk = state.weather.kind;
  const nice = { clear: 1, clouds: 0.8, fog: 0.4, snow: 0.3, rain: 0.18, storm: 0.05 }[wk] ?? 0.6;
  const C = state.career || {};
  const F = C.fest;
  const fest = !!(F && t >= F.from && t < F.until);
  const festSet = !!(F && t >= F.from - 3 * 3600 && t < F.until + 2 * 3600); // Auf- und Abbau
  const people = zoom >= 0.5;
  const P = []; // { x, y, d, o, ph }
  const add = (x, y, o, ph = 0, d = null) => {
    if (vis(x, y)) P.push({ x, y, o, ph, d: d ?? x + y });
  };

  // ---- Flugzeuge, Piloten, Mitflieger, Springer ----
  const parked = gaParked(state);
  const agents = []; // Aufenthalte im Vereinsheim (für die Platzvergabe)
  for (const g of parked) {
    const { ac, rot, seed, a, dep } = g;
    const door = doorOf(ac);
    const partner = rot.partner;
    const n = partner === 'skydive' ? 1 : partner === 'school' ? 2 : clamp(1 + (rot.paxIn || 0), 1, 3);
    const walkIn = plen(toClub(door)) / WALK;
    const stayShort = dep - a < walkIn * 2 + 900;
    for (let k = 0; k < n; k++) {
      const lk = look(seed + k * 7);
      if (partner === 'school' && k === 0) lk.shirt = '#0f172a'; // Fluglehrer
      const out0 = a + 50 + k * 14, back0 = dep - 540 - walkIn - k * 12, board = dep - 70 + k * 8;
      if (t < out0 || t > board) continue;
      if (stayShort) {
        // kurzer Halt: Beine vertreten neben dem Flugzeug
        const ang = h01(seed, k) * Math.PI * 2;
        add(door.x + Math.cos(ang) * 0.32, door.y + Math.sin(ang) * 0.22, { ...lk }, vt + k);
        continue;
      }
      if (t < out0 + walkIn || t >= back0) {
        // unterwegs zum Vereinsheim bzw. zurück; der Pilot macht danach den Außencheck
        if (t < out0 + walkIn) agents.push({ key: `${rot.id}:${k}`, tin: out0 + walkIn, tout: back0, look: lk, walkIn: [toClub(door), t - out0] });
        else {
          const backT = t - back0;
          if (backT < walkIn) agents.push({ key: `${rot.id}:${k}`, tin: out0 + walkIn, tout: back0, look: lk, walkBack: [rev(toClub(door)), backT] });
          else if (k === 0) {
            const q = walkAt(walkaroundPts(ac), backT - walkIn, WALK * 0.5);
            add(q.x, q.y, { ...lk, moving: q.moving }, vt);
          } else add(door.x - 0.12 * k, door.y + 0.1 * k, { ...lk }, vt + k);
        }
        continue;
      }
      agents.push({ key: `${rot.id}:${k}`, tin: out0 + walkIn, tout: back0, look: lk });
    }
    // Absetzflug: Springer mit Packsack kommen vom Vereinsheim
    if (partner === 'skydive' && (rot.paxOut || 0) > 0) {
      const m = Math.min(8, rot.paxOut);
      const path = rev(toClub(door));
      const go = dep - 600;
      for (let k = 0; k < m; k++) {
        const tt = t - go - k * 9;
        if (tt < 0 || t > dep - 40) continue;
        const q = walkAt(path, tt);
        const lk = { ...look(seed + 100 + k), shirt: pick(SUITS, seed, 30 + k), pack: '#1f2937', cap: '#111827', moving: q.moving };
        if (q.moving) add(q.x, q.y, lk, vt + k);
        else add(door.x - 0.15 - (k % 4) * 0.1, door.y + 0.12 + Math.floor(k / 4) * 0.1, { ...lk, moving: false }, vt + k);
      }
    }
  }

  // ---- Ausflügler auf der Terrasse ----
  for (let k = 0; k < 10; k++) {
    const blockL = 1800 + h01(k, 9) * 2400, off = h01(k, 10) * blockL;
    for (const j of [Math.floor((t + off) / blockL) - 1, Math.floor((t + off) / blockL)]) {
      const b0 = j * blockL - off, b1 = b0 + blockL;
      if (h01(k * 131 + j, 11) >= cafeRate(state, hourOf(b0 + blockL / 2), nice, fest && b0 < F.until)) continue;
      const tin = b0 + 120 + h01(k, j) * 300, tout = b1 - 60 - h01(k + 50, j) * 300;
      if (tout - tin < 600) continue;
      agents.push({ key: `c${k}:${j}`, tin, tout, look: look(k * 977 + j), cafe: true, kid: h01(k, j + 3) < 0.2 });
    }
  }

  // Platzvergabe: in der Reihenfolge der Ankunft; wer keinen Platz bekommt, geht hinein
  agents.sort((p, q) => p.tin - q.tin);
  const held = [];
  for (const ag of agents) {
    const used = new Set(held.filter((h) => h.tout > ag.tin && h.seat != null).map((h) => h.seat));
    const pref = Math.floor(h01(sh(ag.key), 5) * SEATS.length);
    ag.seat = null;
    for (let i = 0; i < SEATS.length; i++) {
      const s = (pref + i * 5) % SEATS.length;
      if (!used.has(s)) {
        ag.seat = s;
        break;
      }
    }
    held.push(ag);
  }
  for (const ag of agents) {
    const lk = { ...ag.look, kid: !!ag.kid };
    const seat = ag.seat != null ? SEATS[ag.seat] : null;
    const tgt = seat || { x: 46.3, y: 14.95 };
    if (ag.walkIn) {
      const q = walkAt([...ag.walkIn[0], tgt], ag.walkIn[1]);
      add(q.x, q.y, { ...lk, moving: q.moving }, vt, q.y < 15.1 && q.x > 45.9 ? CLUB_D : null);
      continue;
    }
    if (ag.walkBack) {
      const q = walkAt([tgt, ...ag.walkBack[0]], ag.walkBack[1]);
      add(q.x, q.y, { ...lk, moving: q.moving }, vt, q.y < 15.1 && q.x > 45.9 ? CLUB_D : null);
      continue;
    }
    if (ag.cafe) {
      const path = [...fromGate(), tgt];
      const T = plen(path) / WALK;
      if (t < ag.tin - T || t > ag.tout + T) continue;
      if (t < ag.tin) {
        const q = walkAt(path, t - (ag.tin - T));
        add(q.x, q.y, { ...lk, moving: q.moving }, vt, q.x > 45.8 && q.y > 13 ? CLUB_D : null);
        continue;
      }
      if (t > ag.tout) {
        const q = walkAt(rev(path), t - ag.tout);
        add(q.x, q.y, { ...lk, moving: q.moving }, vt, q.x > 45.8 && q.y > 13 ? CLUB_D : null);
        continue;
      }
    } else if (t < ag.tin || t > ag.tout) continue;
    if (!seat) continue; // drinnen
    const sp = sh(ag.key);
    const eat = Math.sin(vt * 0.9 + (sp % 97)) > 0.55 ? 1 : 0;
    add(seat.x, seat.y, { ...lk, pose: 'sit', arm: eat, cup: ['#f8fafc', '#a16207', '#fde68a'][sp % 3] }, vt, CLUB_D + (seat.y - 14) * 0.01);
  }

  // ---- Platzwart tankt mit Quad und Anhänger ----
  const jobs = parked.filter((g) => h01(g.seed, 7) < 0.75).map((g) => ({ g, f0: g.a + 100 + h01(g.seed, 8) * 90 })).sort((p, q) => p.f0 - q.f0);
  let free = -1e9, quad = null;
  for (const j of jobs) {
    const ac = j.g.ac;
    const wing = { x: ac.x + 0.42, y: ac.y - 0.03 };
    const route = [PUMP, { x: PUMP.x, y: 16.95 }, { x: wing.x, y: 16.95 }, wing];
    const dT = plen(route) / DRIVE, fill = 240;
    const s0 = Math.max(j.f0, free), s1 = s0 + dT + fill + dT;
    free = s1;
    if (t < s0 || t >= s1 || t > j.g.dep - 120) continue;
    const u = t - s0;
    if (u < dT) quad = { ...walkAt(route, u, DRIVE), dir: 1, route, uu: u };
    else if (u < dT + fill) {
      quad = { ...wing, moving: false, route, uu: dT, fueling: ac };
    } else quad = { ...walkAt(rev(route), u - dT - fill, DRIVE), dir: -1, route: rev(route), uu: u - dT - fill };
    break;
  }
  {
    const q = quad || { ...PUMP, moving: false };
    // Fahrtrichtung aus dem Weg ableiten
    let hdg = Math.PI / 2;
    if (quad && quad.moving) {
      const a2 = walkAt(quad.route, quad.uu + 0.4 / DRIVE, DRIVE), a1 = { x: q.x, y: q.y };
      hdg = Math.atan2(a2.y - a1.y, a2.x - a1.x);
    }
    const bx = q.x - Math.cos(hdg) * 0.2, by = q.y - Math.sin(hdg) * 0.2;
    if (vis(q.x, q.y)) {
      items.push({ d: by + bx, f: () => {
        boxRot(r, bx, by, hdg, 0.11, 0.07, 0.03, 0.13, '#e5e7eb'); // AvGas-Tank auf dem Anhänger
        boxRot(r, bx, by, hdg, 0.12, 0.08, 0.0, 0.03, '#334155');
      } });
      items.push({ d: q.x + q.y, f: () => boxRot(r, q.x, q.y, hdg, 0.08, 0.06, 0.02, 0.1, '#b91c1c') }); // Quad
    }
    const wart = { shirt: '#1e3a8a', pants: '#1e3a8a', skin: SKIN[1], hair: HAIR[0], cap: '#f97316' };
    if (quad && quad.fueling) {
      const ac = quad.fueling;
      add(ac.x + 0.25, ac.y + 0.05, { ...wart, arm: 1 }, vt);
      const pl = Math.round(h01(sh(String(ac.id)), 2) * 2);
      if (pl) add(ac.x + 0.12, ac.y + 0.2, { ...look(sh(String(ac.id))) }, vt);
    } else if (quad) add(q.x, q.y, { ...wart, z: 0.08, pose: 'sit' }, vt, q.x + q.y + 0.01);
    else if (hr > 8 && hr < 19) add(PUMP.x - 0.25, PUMP.y - 0.05, { ...wart }, vt);
  }

  // ---- Zuschauer am Zaun ----
  if (hr > 8.5 && hr < 20) {
    const day = Math.floor(t / 86400) + 1;
    const wkend = [6, 0].includes(day % 7) ? 1.5 : 1;
    const fame = C.fame || 8;
    const nF = Math.round(clamp((3 + fame / 8) * nice * wkend * (fest ? 3.5 : 1), 0, 32));
    const busy = state.acs.some((a) => a.mode === 'map' && [PH.FINAL, PH.ROLLOUT, PH.TAKEOFF].includes(a.phase));
    for (let k = 0; k < nF; k++) {
      const s = 4000 + k;
      const side = h01(s, 1) < 0.45;
      const x = side ? 39.1 + h01(s, 2) * 6.4 : 48.5 + h01(s, 2) * 8.2;
      const y = FENCE_Y - 0.22 - h01(s, 3) * 0.12;
      const lk = { ...look(s), kid: h01(s, 4) < 0.22 };
      add(x + Math.sin(vt * 0.3 + k) * 0.02, y, { ...lk, arm: busy && h01(s, 5) < 0.5 ? 1 : 0, cup: h01(s, 6) < 0.3 ? '#111827' : null }, vt + k);
    }
  }

  // ---- Autos auf dem Schotterparkplatz ----
  const guests = agents.filter((ag) => ag.cafe && t > ag.tin - 300 && t < ag.tout + 300).length;
  const nCar = Math.min(18, Math.round(guests / 1.6 + (hr > 8 && hr < 19 ? 2 : 1) + (fest ? 14 : 0)));
  const SLOTS = [];
  for (const y of [10.95, 12.05]) for (const x of [43.75, 44.15, 44.55, 44.95, 45.35, 45.75, 46.15, 47.75, 48.15, 48.55, 48.95, 49.35, 49.75]) SLOTS.push({ x, y });
  const order = SLOTS.map((s, i) => ({ s, i, k: h01(i, 77) })).sort((p, q) => p.k - q.k);
  for (let k = 0; k < Math.min(nCar, order.length); k++) {
    const { s, i } = order[k];
    const p = { x: s.x, y: s.y, h: (s.y < 11.5 ? -1 : 1) * Math.PI / 2 };
    if (vis(p.x, p.y)) items.push({ d: p.x + p.y, f: () => r.drawAmbientCar({ kind: 'car', col: CAR_COLS[i % CAR_COLS.length] }, p, night, lights) });
  }

  // ---- Flugplatzfest ----
  if (festSet) {
    if (vis(52, 9)) items.push({ d: 53.6 + 9.9, f: () => drawMarquee(r, 50.8, 8.4, 53.6, 9.9) });
    if (vis(42.5, 12)) items.push({ d: 43.0 + 12.45, f: () => drawStall(r, 42.0, 11.9, 43.0, 12.45, vt) });
    if (vis(40.5, 11)) items.push({ d: 41.1 + 11.6, f: () => drawCastle(r, 40.0, 10.5, 41.1, 11.6, vt) });
    // Wimpelkette am Zaun – abschnittweise, damit das Vereinsheim sie richtig verdeckt
    const COL = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#f8fafc'];
    for (let i = 0; i < 62; i++) {
      const x = 38.6 + i * 0.3;
      if (!vis(x, FENCE_Y)) continue;
      items.push({ d: x + FENCE_Y, f: () => {
        const { ctx, cam } = r;
        cam.setScreen(ctx);
        const a0 = cam.toScreen(x, FENCE_Y, 0.22), a1 = cam.toScreen(x + 0.3, FENCE_Y, 0.22), mid = cam.toScreen(x + 0.15, FENCE_Y, 0.2);
        ctx.strokeStyle = 'rgba(71,85,105,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.quadraticCurveTo(mid.x, mid.y + 1, a1.x, a1.y);
        ctx.stroke();
        ctx.fillStyle = COL[i % COL.length];
        poly(ctx, [cam.toScreen(x + 0.06, FENCE_Y, 0.21), cam.toScreen(x + 0.24, FENCE_Y, 0.21), cam.toScreen(x + 0.15, FENCE_Y, 0.12)]);
      } });
    }
    // Wiesenparkplatz für die Festbesucher
    for (let k = 0; k < 28; k++) {
      const x = 50.6 + (k % 14) * 0.45, y = 3.4 + Math.floor(k / 14) * 1.3 + (k % 2) * 0.02;
      const p = { x, y, h: Math.PI / 2 };
      if (fest && h01(k, 91) < 0.85 && vis(x, y)) items.push({ d: x + y, f: () => r.drawAmbientCar({ kind: 'car', col: CAR_COLS[(k * 3) % CAR_COLS.length] }, p, night, lights) });
    }
    if (fest) {
      // Besucher schlendern zwischen Parkplatz, Zelt, Bude und Hüpfburg
      const SPOTS = [{ x: 54.0, y: 9.4 }, { x: 52.2, y: 10.4 }, { x: 40.6, y: 12.2 }, { x: 47, y: 12.6 }, { x: 43.2, y: 12.7 }, { x: 55.6, y: 11.8 }, { x: 51.2, y: 11.6 }, { x: 47, y: 9.2 }, { x: 42.6, y: 10.6 }];
      const fame = C.fame || 8;
      const nV = Math.round(clamp((28 + fame * 0.5) * (0.35 + 0.65 * nice), 10, 70));
      for (let k = 0; k < nV; k++) {
        const s = 9000 + k;
        const seg = 260 + h01(s, 1) * 260;
        const j = Math.floor((t + h01(s, 2) * seg) / seg);
        const A = SPOTS[Math.floor(h01(s, j) * SPOTS.length)], B = SPOTS[Math.floor(h01(s, j + 1) * SPOTS.length)];
        const u = ((t + h01(s, 2) * seg) % seg) / seg;
        const w = clamp((u - 0.55) / 0.45, 0, 1); // erst verweilen, dann weitergehen
        const jx = (h01(s, j * 3) - 0.5) * 0.9, jy = (h01(s, j * 3 + 1) - 0.5) * 0.5;
        const x = A.x + jx + (B.x - A.x) * w, y = clamp(A.y + jy + (B.y - A.y) * w, 8.2, 12.75);
        add(x, y, { ...look(s), kid: h01(s, 4) < 0.28, moving: w > 0 && w < 1, arm: h01(s, 5) < 0.15 ? 1 : 0, cup: h01(s, 6) < 0.3 ? '#fde68a' : null }, vt + k);
      }
      // Schlange vor der Würstchenbude
      for (let k = 0; k < 7; k++) add(41.85 - k * 0.17, 12.62 + (k % 2) * 0.04, { ...look(9500 + k), kid: k === 4 }, vt + k);
    }
  }

  // ---- Fallschirmspringer schweben ein (gut 20 Minuten nach dem Start des Absetzflugs) ----
  for (const rot of Object.values(state.rots)) {
    if (rot.partner !== 'skydive' || !rot.offBlock || t < rot.offBlock || t > rot.offBlock + 2400) continue;
    const m = Math.min(8, rot.paxOut || 0), seed = sh(String(rot.id));
    for (let k = 0; k < m; k++) {
      const open = rot.offBlock + 1260 + k * 22, land = open + 330;
      if (t < open || t > land + 420) continue;
      const lk = { ...look(seed + 100 + k), shirt: pick(SUITS, seed, 30 + k), pack: '#1f2937', cap: '#111827' };
      const lx = LZ.x + (h01(seed, k) - 0.5) * 2.2, ly = LZ.y + (h01(seed, k + 9) - 0.5) * 1.2;
      if (t < land) {
        const u = (t - open) / (land - open);
        const z = 7 * (1 - u) ** 1.2;
        const x = lx + (1 - u) * 3.5 + Math.sin(u * 9 + k) * 0.2, y = ly - (1 - u) * 1.5;
        const canopy = pick(SUITS, seed, 60 + k);
        items.push({ d: x + y + 200, f: () => drawCanopy(r, x, y, z, canopy, lk, vt + k) });
      } else {
        // Schirm einpacken, dann zum Vereinsheim
        const tt = t - land - 90;
        if (tt < 0) add(lx, ly, { ...lk, arm: 1 }, vt);
        else {
          const q = walkAt([{ x: lx, y: ly }, { x: 49.2, y: 15.7 }, { x: 46.1, y: 15.6 }, DECK_IN], tt);
          add(q.x, q.y, { ...lk, moving: q.moving }, vt + k, q.x > 45.9 && q.y < 15.1 ? CLUB_D : null);
        }
      }
    }
  }

  if (!people) return;
  for (const p of P) items.push({ d: p.d, f: () => drawFig(r, p.x, p.y, { shirt: '#64748b', pants: '#1f2937', skin: SKIN[1], hair: HAIR[0], ...p.o }, p.ph) });
}

// Fallschirm: Kappe (Rechteck mit Zellen) über dem Springer, Leinen
function drawCanopy(r, x, y, z, col, lk, ph) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const zm = cam.zoom;
  drawFig(r, x, y, { ...lk, z, arm: 1 }, ph);
  const b = cam.toScreen(x, y, z + 0.42);
  const w = 0.5 * ZS * zm, hgt = 0.13 * ZS * zm;
  const p0 = cam.toScreen(x, y, z + 0.12);
  ctx.strokeStyle = 'rgba(30,41,59,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(b.x - w / 2, b.y);
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(b.x + w / 2, b.y);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(b.x - w / 2, b.y);
  ctx.quadraticCurveTo(b.x, b.y - hgt * 1.6, b.x + w / 2, b.y);
  ctx.lineTo(b.x + w / 2, b.y - hgt * 0.2);
  ctx.quadraticCurveTo(b.x, b.y - hgt * 1.25, b.x - w / 2, b.y - hgt * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  for (let i = 1; i < 5; i++) {
    const xx = b.x - w / 2 + (w * i) / 5;
    ctx.beginPath();
    ctx.moveTo(xx, b.y - hgt * 0.15);
    ctx.lineTo(xx, b.y - hgt * (0.75 + 0.35 * Math.sin((i / 5) * Math.PI)));
    ctx.stroke();
  }
}
