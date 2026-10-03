// Gepäckförderband als Begleiter des Gepäckzugs: Es fährt hinter dem Zug her (auf dessen Spur), stellt sich am
// Flugzeug schräg an die hintere Frachttür (rechts, zwischen Rumpf und Gepäckzug) und fährt das Band hoch; danach
// senkt es das Band und folgt dem Zug wieder. Im Depot steht es nicht extra herum. Nur Darstellung (Karte und 3D).
import { BELT, beltDoor } from '../acshape.js';
import * as LY from '../layout.js';

const TRAIL = new Map(); // Fahrzeug-ID → letzte Positionen des Gepäckzugs
const POSE = new Map(); // Fahrzeug-ID → { mode, t0, from, cur }
const BEHIND = 0.475 + 0.06 + BELT.h; // Abstand hinter der Mitte des Gepäckzugs
const ANG = 0.45; // Anstellwinkel zum Rumpf
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (u) => u * u * (3 - 2 * u);
const angLerp = (a, b, u) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * u;

function trailOf(v) {
  let t = TRAIL.get(v.id);
  if (!t) TRAIL.set(v.id, (t = []));
  const l = t[t.length - 1];
  if (!l || Math.hypot(v.x - l.x, v.y - l.y) > 0.03) t.push({ x: v.x, y: v.y });
  if (Math.hypot(v.x - (l?.x ?? v.x), v.y - (l?.y ?? v.y)) > 2) t.splice(0, t.length - 1); // Sprung (Laden, Teleport)
  if (t.length > 80) t.splice(0, t.length - 80);
  return t;
}
// Platz hinter dem Zug, auf seiner gefahrenen Spur
function follow(v, t) {
  let rest = BEHIND, x = v.x, y = v.y;
  for (let i = t.length - 1; i >= 0; i--) {
    const p = t[i], d = Math.hypot(p.x - x, p.y - y);
    if (d >= rest && d > 1e-6) {
      const q = { x: x + ((p.x - x) * rest) / d, y: y + ((p.y - y) * rest) / d };
      return { x: q.x, y: q.y, h: Math.atan2(y - q.y, x - q.x) };
    }
    rest -= d;
    (x = p.x), (y = p.y);
  }
  const h = v.hdg || 0; // Spur zu kurz: gerade hinter dem Zug
  return { x: x - Math.cos(h) * rest, y: y - Math.sin(h) * rest, h: Math.atan2(v.y - (y - Math.sin(h) * rest), v.x - (x - Math.cos(h) * rest)) };
}
// gerade hinter dem stehenden Zug (am Flugzeug ohne Förderband-Tür)
function behind(v) {
  const h = v.hdg || 0;
  return { x: v.x - Math.cos(h) * BEHIND, y: v.y - Math.sin(h) * BEHIND, h };
}
// Stellung an der Frachttür
function atDoor(ac) {
  const D = beltDoor(ac.type, ac.len);
  if (!D) return null;
  const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
  const dx = Math.cos(ANG), dl = -Math.sin(ANG); // nach vorn und zum Rumpf hin
  const a = D.along - dx * D.reach, l = D.lat - dl * D.reach;
  return { x: ac.x + fx * a + rx * l, y: ac.y + fy * a + ry * l, h: Math.atan2(fy * dx + ry * dl, fx * dx + rx * dl), top: D.top };
}

// Förderbänder für dieses Bild (als Fahrzeuge: id, type 'belt', Lage, Kurs, Schwellenhöhe top, Bandstellung lift)
export function beltLoaders(state) {
  const out = [];
  let acs = null;
  for (const v of state.vehicles) {
    if (v.type !== 'baggage') continue;
    const t = trailOf(v);
    const ac = v.st === 'work' && v.job && (acs ||= new Map(state.acs.map((a) => [a.id, a]))).get(v.job.ac);
    const door = ac ? atDoor(ac) : null;
    const bay = LY.DEPOT_BAYS[(v.bay || 0) % LY.DEPOT_BAYS.length];
    if (!door && bay && Math.hypot(v.x - bay.x, v.y - bay.y) < 1.2) {
      POSE.delete(v.id);
      continue;
    }
    const mode = door ? 'door' : 'follow', tgt = door || (v.st === 'work' ? behind(v) : follow(v, t));
    let P = POSE.get(v.id);
    if (!P) POSE.set(v.id, (P = { mode, t0: -1e9, from: { ...tgt, lift: 0 }, cur: { ...tgt, lift: 0 } }));
    if (P.mode !== mode) Object.assign(P, { mode, t0: state.time, from: { ...P.cur } });
    if (Math.hypot(P.cur.x - tgt.x, P.cur.y - tgt.y) > 1.5) P.t0 = -1e9; // nach einem Sprung (Laden, Zeitraffer) gleich an Ort und Stelle
    if (P.t0 < -1e8) P.from = { ...tgt, lift: door ? 1 : 0 };
    const dt = state.time - P.t0;
    // hin: erst anfahren (6 s), dann Band hoch (6 s); weg: erst Band runter (4 s), dann anschließen (6 s)
    const um = ease(clamp01(door ? dt / 6 : (dt - 4) / 6)), lift = door ? ease(clamp01((dt - 6) / 6)) : P.from.lift * (1 - clamp01(dt / 4));
    const cur = { x: P.from.x + (tgt.x - P.from.x) * um, y: P.from.y + (tgt.y - P.from.y) * um, h: angLerp(P.from.h, tgt.h, um), lift };
    P.cur = cur;
    // dir: Koffer laufen beim Entladen das Band hinunter (−1), beim Beladen hinauf (+1)
    out.push({ id: 'belt' + v.id, type: 'belt', len: 2 * BELT.h + 0.03, x: cur.x, y: cur.y, hdg: cur.h, top: door ? door.top : P.from.top || BELT.y, lift, st: v.st === 'idle' ? 'idle' : 'work', dir: door && v.job ? (v.job.k === 'load' ? 1 : -1) : 0 });
    if (door) cur.top = door.top;
  }
  return out;
}
