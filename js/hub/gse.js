// Großflughäfen: Vorfeldfahrzeuge (nur Darstellung). Jedes Flugzeug an der Position bekommt einen kleinen Umlauf:
// Gepäckzug mit Förderband zum Entladen, Catering-LKW an der vorderen rechten Tür, Tankwagen unter der Tragfläche,
// vor dem Abflug wieder Gepäck zum Beladen und ein Pushback-Schlepper an der Bugnase, der beim Pushback mitschiebt.
// Die Fahrzeuge kommen über die Servicestraße vor den Bugnasen (zwischen Positionen und Terminal), fahren an ihren
// Platz, arbeiten und fahren in Fahrtrichtung weiter. Lage und Kurs ergeben sich aus der Uhrzeit des Umlaufs – die
// Simulation bleibt unberührt. Maße wie die Flugzeuge der Drehkreuze maßstäblich (SIZE).
import { AC_TYPES } from '../config.js';
import { servicePoint } from '../layout.js';
import { beltDoor } from '../acshape.js';
import { PHASE as P, SIZE } from './sim.js';

const ROAD = 2.65; // Servicestraße: Abstand vor der Positionsmitte (in Richtung Bugnase), Kacheln
const DRIVE = 45; // Spielsekunden für An- bzw. Abfahrt
const LEAD = 7; // Anfahrt beginnt so weit stromaufwärts auf der Servicestraße
const BELT_ANG = 0.45; // Förderband schräg zum Rumpf
const fullLen = (ac) => (AC_TYPES[ac.type] || AC_TYPES.A320).len;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Linienzug: Punkt und Kurs nach Anteil u (0 … 1)
function along(pts, u) {
  let L = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    L += d;
  }
  let s = clamp(u, 0, 1) * L;
  for (let i = 1; i < pts.length; i++) {
    const d = seg[i - 1];
    if (s <= d || i === pts.length - 1) {
      const t = d ? clamp(s / d, 0, 1) : 1;
      const a = pts[i - 1], b = pts[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, hdg: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    s -= d;
  }
  const a = pts[pts.length - 1];
  return { x: a.x, y: a.y, hdg: 0 };
}

// Landseite: Autos, Taxis und Busse auf den Straßen (je Straße zwei Richtungen, Abstand und Tempo je Auto fest)
const CAR_KINDS = ['sedan', 'compact', 'kombi', 'suv', 'sedan', 'compact', 'van', 'kombi'];
const CAR_COLORS = ['#f4f4f2', '#1f2329', '#9aa1a8', '#c9ced3', '#f4f4f2', '#2f3a4a', '#7a1f24', '#244a7a', '#d8cfb8', '#4a5a3a', '#1f2329', '#f2c230'];
function roadCars(roads) {
  const out = [];
  let n = 0;
  for (const r of roads) {
    const pts = r.pts;
    if (!pts || pts.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const L = cum[cum.length - 1];
    if (L < 4) continue;
    const per = Math.max(1, Math.round(L / 7));
    for (const dir of [1, -1]) {
      for (let k = 0; k < per; k++) {
        const h = (n * 0.6180339) % 1;
        out.push({ id: `car${n}`, pts, cum, L, dir, lane: dir * r.w * 0.22, s0: ((k + h * 0.6) / per) * L, v: 0.55 + h * 0.35, kind: n % 23 === 0 ? 'bus' + (n % 5) : CAR_KINDS[n % CAR_KINDS.length], color: CAR_COLORS[(n * 7) % CAR_COLORS.length] });
        n++;
      }
    }
  }
  return out;
}

export class HubGse {
  constructor(sim) {
    this.sim = sim;
    this.carDefs = roadCars(sim.ap.roads || []);
    this.turns = new Map(); // Flugzeug-ID -> Umlauf { tIn, st, w: { dienst: [von, bis] }, push }
    this.n = 0;
  }
  // Servicepunkt am Flugzeug (Hauptspiel-Maße, auf die Drehkreuz-Größe verkleinert)
  spot(kind, ac) {
    const p = servicePoint(kind, { x: 0, y: 0, hdg: ac.hdg, len: fullLen(ac), type: ac.type });
    return { x: ac.x + p.x * SIZE, y: ac.y + p.y * SIZE, hdg: p.hdg };
  }
  beltSpot(ac) {
    const D = beltDoor(ac.type, fullLen(ac));
    if (!D) return null;
    const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
    const dx = Math.cos(BELT_ANG), dl = -Math.sin(BELT_ANG);
    const a = (D.along - dx * D.reach) * SIZE, l = (D.lat - dl * D.reach) * SIZE;
    return { x: ac.x + fx * a + rx * l, y: ac.y + fy * a + ry * l, hdg: Math.atan2(fy * dx + ry * dl, fx * dx + rx * dl), top: D.top };
  }
  // Umlauf beim ersten Sehen an der Position festlegen (Zeitfenster der Dienste)
  turnOf(ac, t) {
    let tr = this.turns.get(ac.id);
    if (tr && tr.st === ac.stand) return tr;
    const tobt = ac.tobt ?? t + 3600;
    // schon beim Spielstart geparkt: mitten im Umlauf (je Flugzeug ein anderer Stand), sonst gerade angekommen
    const early = t - (this.sim.t0 ?? t) < 5;
    const tIn = early ? t - ((ac.id * 0.618) % 1) * clamp(tobt - t, 900, 5400) : t;
    const T = clamp(tobt - tIn, 1500, 7200);
    const w = {};
    const win = (k, a, b) => (b - a >= DRIVE + 40 ? (w[k] = [a, b]) : null);
    win('unload', tIn + 60, tIn + 60 + 0.24 * T);
    win('cater', tIn + 0.28 * T, tIn + 0.52 * T);
    win('fuel', tobt - 0.62 * T, tobt - 0.28 * T);
    win('load', tobt - 0.36 * T, tobt - 200);
    tr = { tIn, st: ac.stand, w, tug: tobt - 330, push: null, key: ++this.n };
    this.turns.set(ac.id, tr);
    return tr;
  }
  // Weg über die Servicestraße: hin (von stromaufwärts zum Platz) bzw. weg (vom Platz weiter stromabwärts)
  route(st, spot, inbound) {
    const n = { x: Math.cos(st.hdg), y: Math.sin(st.hdg) };
    const d = { x: -n.y, y: n.x };
    const lat = (spot.x - st.x) * d.x + (spot.y - st.y) * d.y;
    const R = (l, k = ROAD) => ({ x: st.x + n.x * k + d.x * l, y: st.y + n.y * k + d.y * l });
    // Ecke abrunden: kurz vor der Abzweigung schon etwas Richtung Position
    if (inbound) return [R(lat - LEAD), R(lat - 0.6), R(lat - 0.15, ROAD - 0.5), spot];
    return [spot, R(lat + 0.15, ROAD - 0.5), R(lat + 0.6), R(lat + LEAD)];
  }
  // ein Fahrzeug zum Zeitpunkt t im Fenster [a, b] am Platz spot; null = nicht da
  place(st, spot, a, b, t) {
    if (t < a || t > b + DRIVE) return null;
    if (t < a + DRIVE) {
      const u = (t - a) / DRIVE;
      const p = along(this.route(st, spot, true), u * (2 - u)); // abbremsen
      return { ...p, st: 'drive', fade: clamp(u * 5, 0, 1) };
    }
    if (t <= b) return { x: spot.x, y: spot.y, hdg: spot.hdg, st: 'work', fade: 1 };
    const u = (t - b) / DRIVE;
    const p = along(this.route(st, spot, false), u * u); // anfahren
    return { ...p, st: 'drive', fade: clamp((1 - u) * 5, 0, 1) };
  }
  // Autos auf den Straßen der Landseite (in Echtzeit-Tempo der Spieluhr), nur die im Rechteck view
  cars(view) {
    const t = this.sim.t, out = [];
    for (const c of this.carDefs) {
      let s = (c.s0 + c.dir * c.v * t) % c.L;
      if (s < 0) s += c.L;
      const { pts, cum } = c;
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i], d = cum[i] - cum[i - 1] || 1, u = (s - cum[i - 1]) / d;
      const dx = (b.x - a.x) / d, dy = (b.y - a.y) / d;
      const x = a.x + (b.x - a.x) * u - dy * c.lane, y = a.y + (b.y - a.y) * u + dx * c.lane;
      if (view && (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1)) continue;
      out.push({ id: c.id, x, y, hdg: c.dir > 0 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx), kind: c.kind, color: c.color });
    }
    return out;
  }
  // alle Fahrzeuge für dieses Bild
  list() {
    const sim = this.sim, t = sim.t, out = [];
    const seen = new Set();
    for (const ac of sim.acs) {
      const atStand = ac.phase === P.STAND && ac.stand;
      const pushing = ac.phase === P.PUSH || ac.phase === P.START;
      if (!atStand && !pushing) continue;
      const tr = atStand ? this.turnOf(ac, t) : this.turns.get(ac.id);
      if (!tr) continue;
      seen.add(ac.id);
      const st = tr.st;
      const id = (k) => `g${ac.id}-${k}-${tr.key}`;
      const num = (ac.id * 7 + tr.key) % 90 + 10;
      if (atStand) {
        for (const k of ['unload', 'cater', 'fuel', 'load']) {
          const w = tr.w[k];
          if (!w) continue;
          if (k === 'unload' || k === 'load') {
            const bs = this.beltSpot(ac);
            if (bs) {
              const p = this.place(st, bs, w[0] - 10, w[1] + 10, t);
              if (p) out.push({ id: id(k + 'B'), type: 'belt', ...p, sc: SIZE, top: bs.top, lift: p.st === 'work' ? 1 : 0, dir: k === 'unload' ? -1 : 1, name: '' });
            }
          }
          const sp = this.spot(k === 'cater' ? 'cater' : k === 'fuel' ? 'fuel' : 'unload', ac);
          // Fahrzeuge parken in Abfahrtsrichtung (Bug zur Servicestraße)
          sp.hdg = st.hdg;
          const p = this.place(st, sp, w[0], w[1], t);
          if (!p) continue;
          const type = k === 'cater' ? 'catering' : k === 'fuel' ? 'fuel' : 'baggage';
          out.push({ id: id(k), type, ...p, sc: SIZE, job: { ac: ac.id, k }, name: `${num + (k === 'fuel' ? 1 : k === 'cater' ? 2 : 3)}` });
        }
      }
      // Pushback-Schlepper: wartet an der Bugnase, schiebt mit, fährt danach weg
      const ps = this.spot('push', ac);
      if (atStand && t >= tr.tug) {
        const p = this.place(st, ps, tr.tug, Infinity, t);
        if (p) out.push({ id: id('tug'), type: 'tug', ...p, st: p.st === 'work' ? 'attached' : 'drive', sc: SIZE, job: { ac: ac.id, k: 'push' }, name: `${num}` });
      } else if (pushing) {
        if (ac.phase === P.PUSH) out.push({ id: id('tug'), type: 'tug', x: ps.x, y: ps.y, hdg: ps.hdg, st: 'work', fade: 1, sc: SIZE, job: { ac: ac.id, k: 'push' }, name: `${num}` });
        else {
          if (!tr.push) tr.push = { t, x: ps.x, y: ps.y, hdg: ps.hdg };
          const u = (t - tr.push.t) / DRIVE;
          if (u < 1) {
            // abkoppeln, ein Stück zurücksetzen und seitlich wegfahren
            const P0 = tr.push, h = P0.hdg;
            const side = { x: -Math.sin(h), y: Math.cos(h) };
            const pts = [{ x: P0.x, y: P0.y }, { x: P0.x + Math.cos(h) * 0.6, y: P0.y + Math.sin(h) * 0.6 }, { x: P0.x + Math.cos(h) * 1.4 + side.x * 1.2, y: P0.y + Math.sin(h) * 1.4 + side.y * 1.2 }, { x: P0.x + Math.cos(h) * 2 + side.x * 4, y: P0.y + Math.sin(h) * 2 + side.y * 4 }];
            const p = along(pts, u * u);
            out.push({ id: id('tug'), type: 'tug', ...p, st: 'drive', fade: clamp((1 - u) * 4, 0, 1), sc: SIZE, name: `${num}` });
          }
        }
      }
    }
    for (const k of this.turns.keys()) if (!seen.has(k)) this.turns.delete(k);
    return out;
  }
}
