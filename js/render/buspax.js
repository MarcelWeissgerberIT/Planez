// Außenpositionen: Treppe an der vorderen linken Tür und Fluggäste, die zwischen Treppe und Vorfeldbus bzw. zwischen Bus
// und Terminal laufen. Der Bus selbst pendelt in der Simulation (sim/ground.js), hier nur die Fußgänger. Nur Darstellung.
import { PH } from '../sim/aircraft.js';
import { BUS_DWELL_AC, BUS_DWELL_STOP } from '../sim/ground.js';
import * as LY from '../layout.js';
import { drawPerson } from './ambient.js';
import { stairsFoot } from './gse2d.js';
import { clamp } from '../util.js';

const SHIRTS = ['#1d4ed8', '#b91c1c', '#f8fafc', '#111827', '#15803d', '#a855f7', '#f59e0b', '#0e7490', '#be185d', '#57534e'];
const WALK = 0.05; // Kacheln je Spielsekunde (mit Gepäck)
const N = 18; // sichtbare Fluggäste je Fahrt

// Lage am Flugzeug: along = Richtung Nase, lat = nach Steuerbord (negativ = links)
function at(ac, along, lat) {
  const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg);
  return { x: ac.x + fx * along - fy * lat, y: ac.y + fy * along + fx * lat };
}
// Tür, Fuß der Treppe und Bustür (Bus steht am Service-Punkt „deboard“, Tür zur Flugzeugseite)
function geom(ac) {
  const L = ac.len;
  return { door: at(ac, 0.36 * L, -0.07 * L), foot: at(ac, 0.3 * L, -0.07 * L - 0.26), bus: at(ac, 0.18 * L, -0.8) };
}

export function busPaxItems(r, state, items, vis) {
  const now = state.time;
  for (const ac of state.acs) {
    if (ac.mode !== 'map' || ac.phase !== PH.STAND || !ac.ta) continue;
    const T = ac.ta.tasks;
    if (!(T.deboard && T.deboard.need === 'bus') && !(T.board && T.board.need === 'bus')) continue;
    if (T.board && T.board.st === 'done') continue; // Treppe wird vor dem Pushback weggefahren
    if (T.stairs) continue; // das Treppenfahrzeug bringt die Treppe (render/gse2d.js)
    const g = geom(ac);
    if (vis(g.foot.x, g.foot.y)) items.push({ d: g.foot.x + g.foot.y + 0.02, f: () => stairs(r, ac, g) });
  }
  for (const v of state.vehicles) {
    const B = v.sh;
    if (v.type !== 'bus' || !B || (B.ph !== 'ac' && B.ph !== 'stop')) continue;
    const el = now - (B.t0 || now);
    let pts, dwell;
    if (B.ph === 'ac') {
      const ac = v.job && state.acs.find((a) => a.id === v.job.ac);
      if (!ac) continue;
      const g = geom(ac);
      const st = state.vehicles.find((x) => x.type === 'stairs' && x.st === 'docked' && x.job && x.job.ac === ac.id);
      const foot = st ? stairsFoot(st) : g.foot;
      pts = B.k === 'deboard' ? [foot, g.bus] : [g.bus, foot];
      dwell = BUS_DWELL_AC;
    } else {
      const S = LY.busStop();
      const bd = { x: v.x, y: v.y - 0.14 };
      pts = B.k === 'deboard' ? [bd, S.door] : [S.door, bd];
      dwell = BUS_DWELL_STOP;
    }
    const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const walkT = len / WALK;
    const gap = Math.max(0.9, (dwell - walkT - 4) / N);
    for (let k = 0; k < N; k++) {
      const u = clamp((el - 2 - k * gap) / walkT, 0, 1);
      if (u <= 0 || u >= 1) continue;
      const h = ((k * 7919 + (v.id.length || 0) * 31) % 100) / 100 - 0.5;
      const x = pts[0].x + (pts[1].x - pts[0].x) * u + h * 0.12, y = pts[0].y + (pts[1].y - pts[0].y) * u + h * 0.08;
      if (!vis(x, y)) continue;
      // an Treppe, Bus und Tür ein- bzw. ausblenden
      const a = Math.min(1, u * 6, (1 - u) * 6);
      const col = SHIRTS[(k * 3 + (v.id.charCodeAt(v.id.length - 1) || 0)) % SHIRTS.length];
      items.push({ d: x + y, f: () => drawPerson(r, x, y, col, a, k % 3 !== 1, now + k, true) });
    }
  }
}

// Fluggasttreppe (Treppenwagen): Rampe von der Tür schräg nach unten, Geländer, kleines Fahrgestell
function stairs(r, ac, g) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const z = Math.max(0.1, 0.085 * ac.len); // Höhe der Türschwelle
  const fx = Math.cos(ac.hdg) * 0.05, fy = Math.sin(ac.hdg) * 0.05; // halbe Treppenbreite entlang des Rumpfs
  const P = (p, h, s) => cam.toScreen(p.x + fx * s, p.y + fy * s, h);
  const top = g.door, bot = g.foot;
  // Fahrgestell unter der Treppe
  const mid = { x: (top.x + bot.x) / 2, y: (top.y + bot.y) / 2 };
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  for (const [p, h, s] of [[bot, 0.02, -1.4], [bot, 0.02, 1.4], [mid, 0.035, 1.4], [mid, 0.035, -1.4]]) {
    const q = P(p, h, s);
    ctx.lineTo(q.x, q.y);
  }
  ctx.closePath();
  ctx.fill();
  // Stufen
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  for (const [p, h, s] of [[bot, 0.01, -1], [bot, 0.01, 1], [top, z, 1], [top, z, -1]]) {
    const q = P(p, h, s);
    ctx.lineTo(q.x, q.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(71,85,105,0.9)';
  ctx.lineWidth = Math.max(0.6, cam.zoom * 0.5);
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const p = { x: bot.x + (top.x - bot.x) * t, y: bot.y + (top.y - bot.y) * t };
    const a = P(p, z * t + 0.01, -1), b = P(p, z * t + 0.01, 1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Geländer
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = Math.max(0.8, cam.zoom * 0.7);
  for (const s of [-1, 1]) {
    const a = P(bot, 0.05, s), b = P(top, z + 0.045, s);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}
