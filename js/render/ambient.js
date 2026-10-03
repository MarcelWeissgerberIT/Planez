// Belebung des Flughafens (nur Darstellung, nicht Teil der Simulation):
// Besucherverkehr ins Parkhaus und auf den Parkplatz, Taxis und Busse am Terminal, Fußgänger,
// Bodenpersonal an den Flugzeugen, Follow-me-Wagen, Arbeiter und Kipper auf Baustellen, Nachtlichter.
import { clamp, hourOf } from '../util.js';
import * as LY from '../layout.js';
import { PH } from '../sim/aircraft.js';
import { ZS, AC_TYPES } from '../config.js';
import { trainPos } from './infra.js';
import { Q } from './quality.js';
import { season } from '../sim/winter.js';
import { carPaint, carKind, POLICE_BLUE } from './cars.js';

const SHIRTS = ['#1d4ed8', '#b91c1c', '#f8fafc', '#111827', '#15803d', '#a855f7', '#f59e0b', '#0e7490', '#be185d', '#57534e'];
const HIVIS = ['#facc15', '#f97316', '#fde047'];
const EAST = -0.4, WEST = 0.4; // Fahrspuren der Landseite (nach Osten / nach Westen)

export class Ambient {
  constructor() {
    this.vt = 0; // Darstellungszeit
    this.cars = [];
    this.peds = [];
    this.spawnT = 0;
    this.pedT = 0;
    this.seed = 20240917;
  }

  rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  // Verkehr je Tageszeit (nachts wenig, Spitzen morgens und abends)
  traffic(state) {
    const h = hourOf(state.time);
    if (h < 4.5 || h > 23.5) return 0.15;
    if (h < 6) return 0.5;
    return 0.75 + 0.25 * Math.max(Math.exp(-((h - 7.5) ** 2) / 3), Math.exp(-((h - 17.5) ** 2) / 4));
  }

  update(state, realDt) {
    const f = state.speed ? Math.min(2.8, 0.55 + 0.5 * Math.sqrt(state.speed)) : 0;
    const dt = Math.min(0.1, realDt) * f;
    if (!dt) return;
    this.vt += dt;
    const tr = this.traffic(state) * (state.upgrades.rail ? 0.8 : 1);
    // Bahnhof: beim Halt steigen Fahrgäste aus und gehen zum Terminal (und umgekehrt)
    if (state.upgrades.rail) {
      const tp = trainPos(this.vt);
      const dwell = !!(tp && tp.dwell);
      if (dwell && !this.wasDwell) {
        const R = LY.RAIL;
        const n = Math.round(4 + tr * 8);
        for (let k = 0; k < n; k++) {
          const sx = R.station.x0 + 0.5 + this.rnd() * (R.station.x1 - R.station.x0 - 1);
          const tx = 16 + this.rnd() * 18;
          const toT = [{ x: sx, y: R.platform.y1 - 0.1, fadeIn: true }, { x: sx, y: R.station.y1 + 0.15 }, { x: R.station.x1 + 0.3, y: R.station.y1 + 0.15 }, { x: R.station.x1 + 0.3, y: 2.92 }, { x: 12.0, y: 2.92 }, { x: 12.0, y: 1.0 }, { x: tx, y: 1.0 }, { x: tx, y: 1.18, fade: true }];
          this.peds.push(this.ped(toT, true, k * 0.6));
          if (k % 2) this.peds.push(this.ped([...toT].reverse().map((p, i, arr) => ({ ...p, fadeIn: i === 0, fade: i === arr.length - 1 })), true, k * 0.5));
        }
      }
      this.wasDwell = dwell;
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.cars.length < (12 + tr * 22) * Q.agents) {
      this.spawnT = (1.4 + this.rnd() * 1.6) / tr;
      this.spawnTrip(state);
    }
    this.pedT -= dt;
    if (this.pedT <= 0 && this.peds.length < (70 * tr + 8) * Q.agents) {
      this.pedT = 0.5 / tr;
      this.spawnWalker();
    }
    for (const c of this.cars) moveAgent(c, dt, (x, y) => this.onStop(c, x, y));
    this.cars = this.cars.filter((c) => !c.done);
    for (const p of this.peds) moveAgent(p, dt);
    this.peds = this.peds.filter((p) => !p.done);
  }

  // Fahrten erzeugen: Parkhaus rein/raus, Parkplatz, Vorfahrt am Terminal, Taxi, Bus
  spawnTrip(state) {
    const r = this.rnd();
    const fromWest = this.rnd() < 0.5;
    const col = carPaint(this.rnd());
    const car = { kind: 'car', col, body: carKind(this.rnd()), v: 1.1 + this.rnd() * 0.35, pts: [], i: 0, t: 0 };
    const inRoad = (xTurn) => (fromWest ? [{ x: -8, y: EAST }, { x: xTurn - 0.6, y: EAST }] : [{ x: 88, y: WEST }, { x: xTurn + 0.6, y: WEST }]);
    const outRoad = (xTurn, east) => (east ? [{ x: xTurn + 0.6, y: EAST }, { x: 88, y: EAST }] : [{ x: xTurn - 0.6, y: WEST }, { x: -8, y: WEST }]);
    const GX = 51.0, LX = 58.4;
    if (r < 0.26) {
      // ins Parkhaus
      car.pts = [...inRoad(GX), { x: GX, y: 0.8 }, { x: GX, y: 4.1, fade: true }];
    } else if (r < 0.46) {
      // aus dem Parkhaus
      const east = this.rnd() < 0.5;
      car.pts = [{ x: GX, y: 4.1 }, { x: GX, y: 0.8 }, ...outRoad(GX, east)];
      car.fadeIn = 1;
    } else if (r < 0.66) {
      // Parkplatz: Einfahrt, Parksuche durch zwei Gassen, wieder raus (manchmal kurz warten)
      const pw = 12.5 + (state.upgrades.parking || 0) * 2;
      const xe = 56 + pw - 0.6;
      const wait = this.rnd() < 0.4 ? 4 + this.rnd() * 10 : 0;
      car.pts = [...inRoad(LX), { x: LX, y: 0.8 }, { x: LX, y: 3.2 }, { x: 58.4 + (xe - 58.4) * this.rnd(), y: 3.2, w: wait }, { x: xe, y: 3.2 }, { x: xe, y: 4.65 }, { x: LX, y: 4.65 }, { x: LX, y: 0.8 }, ...outRoad(LX, this.rnd() < 0.5)];
      car.v *= 0.75;
    } else if (r < 0.7) {
      // Flughafenpolizei auf Streife: fährt langsam die Zufahrtsstraße entlang und hält am Rand beim Parkplatz bzw.
      // Parkhaus (Kontrolle, Präsenz), dann weiter
      car.kind = 'police';
      car.col = POLICE_BLUE;
      car.body = this.rnd() < 0.3 ? 'policevan' : 'police';
      car.patrolLights = this.rnd() < 0.45; // bei manchen Kontrollen Blaulicht
      car.v *= 0.7;
      const x = 46 + this.rnd() * 18;
      car.pts = [{ x: 88, y: WEST }, { x: x + 1, y: WEST }, { x, y: 0.95, w: 25 + this.rnd() * 35 }, { x: x - 1.2, y: WEST }, { x: -8, y: WEST }];
    } else if (r < 0.84) {
      // Vorfahrt am Terminal (Aussteigen)
      const x = 27.5 + this.rnd() * 8;
      car.pts = [{ x: 88, y: WEST }, { x: x + 1, y: WEST }, { x, y: 0.72, w: 5 + this.rnd() * 7, drop: 1 + Math.floor(this.rnd() * 3) }, { x: x - 1.2, y: WEST }, { x: -8, y: WEST }];
    } else if (r < 0.94) {
      // Taxi am Taxistand
      car.kind = 'taxi';
      car.col = '#facc15';
      car.body = 'sedan';
      const x = 23 + this.rnd() * 2.5;
      car.pts = [{ x: 88, y: WEST }, { x: x + 1, y: WEST }, { x, y: 0.72, w: 8 + this.rnd() * 10, pick: 1 + Math.floor(this.rnd() * 2) }, { x: x - 1.2, y: WEST }, { x: -8, y: WEST }];
    } else {
      // Bus (Linienbus oder Hotel-Shuttle)
      car.kind = 'bus';
      car.col = state.upgrades.hotel && this.rnd() < 0.5 ? '#f8fafc' : '#2563eb';
      car.v = 0.85;
      car.pts = [{ x: 88, y: WEST }, { x: 40.8, y: WEST }, { x: 39.4, y: 0.7, w: 12 + this.rnd() * 8, drop: 3, pick: 3 }, { x: 37.6, y: WEST }, { x: -8, y: WEST }];
    }
    this.cars.push(car);
  }

  // Halt eines Fahrzeugs: Fahrgäste steigen aus bzw. ein
  onStop(c, x, y) {
    const w = c.pts[c.i];
    if (!w) return;
    for (let k = 0; k < (w.drop || 0); k++) this.peds.push(this.ped([{ x: x + (this.rnd() - 0.5) * 0.3, y: 0.86 }, { x: x + (this.rnd() - 0.5) * 1.2, y: 1.18, fade: true }], true, k * 0.8));
    for (let k = 0; k < (w.pick || 0); k++) this.peds.push(this.ped([{ x: x + (this.rnd() - 0.5) * 1.4, y: 1.18 }, { x: x + (this.rnd() - 0.5) * 0.3, y: 0.86, fade: true }], true, k * 0.7));
  }

  ped(pts, bag = false, delay = 0) {
    return { pts, i: 0, t: -delay, v: 0.09 + this.rnd() * 0.05, col: SHIRTS[Math.floor(this.rnd() * SHIRTS.length)], bag: bag || this.rnd() < 0.4, ph: this.rnd() * 6 };
  }

  // Spaziergänger auf den Gehwegen, zwischen Parkhaus/Parkplatz und Terminal
  spawnWalker() {
    const r = this.rnd();
    if (r < 0.45) {
      const y = this.rnd() < 0.6 ? 0.98 : -1.0;
      const a = -6 + this.rnd() * 90, b = a + (this.rnd() < 0.5 ? -1 : 1) * (6 + this.rnd() * 20);
      this.peds.push(this.ped([{ x: a, y, fadeIn: true }, { x: b, y, fade: true }]));
    } else if (r < 0.75) {
      // Parkhaus -> Terminal (und zurück)
      const to = this.rnd() < 0.55;
      const pts = [{ x: 48.3, y: 6.5 }, { x: 48.3, y: 1.0 }, { x: 37 + this.rnd() * 3, y: 1.0 }, { x: 36 + this.rnd() * 2, y: 1.18 }];
      if (!to) pts.reverse();
      pts[0].fadeIn = true;
      pts[pts.length - 1].fade = true;
      this.peds.push(this.ped(pts, true));
    } else {
      // Parkplatz -> Terminal über die Straße (Zebrastreifen bei x 45)
      const to = this.rnd() < 0.5;
      const pts = [{ x: 58 + this.rnd() * 6, y: 2.4 + this.rnd() * 2.6 }, { x: 57.5, y: 1.0 }, { x: 45.2, y: 1.0 }, { x: 36 + this.rnd() * 2, y: 1.18 }];
      if (!to) pts.reverse();
      pts[0].fadeIn = true;
      pts[pts.length - 1].fade = true;
      this.peds.push(this.ped(pts, true));
    }
  }

  // Zeichenobjekte beitragen (Tiefensortierung über d = x + y)
  items(r, state, items, lights, night, sites, vis = () => true) {
    const vt = this.vt;
    const zoom = r.cam.zoom;
    for (const c of this.cars) {
      const p = agentPos(c);
      if (!p || !vis(p.x, p.y)) continue;
      items.push({ d: p.x + p.y, f: () => r.drawAmbientCar(c, p, night, lights) });
    }
    if (zoom >= 0.55) {
      for (const p of this.peds) {
        const q = agentPos(p);
        if (!q || !vis(q.x, q.y)) continue;
        items.push({ d: q.x + q.y, f: () => drawPerson(r, q.x, q.y, p.col, q.alpha, p.bag, vt + p.ph, q.moving) });
      }
    }
    // Schlange vor der Sicherheitskontrolle (Terminal-Eingang, Landseite)
    const q = state.sec ? state.sec.q : 0;
    if (zoom >= 0.5 && q > 8) {
      const n = Math.min(60, Math.round(q / 10));
      const QC = ['#1e3a8a', '#7c2d12', '#334155', '#be123c', '#065f46', '#78350f', '#1f2937', '#6d28d9'];
      for (let k = 0; k < n; k++) {
        // Schlangenlinie in Reihen vor dem Eingang
        const row = Math.floor(k / 20), col = k % 20;
        const x = 35.9 - (row % 2 ? 19 - col : col) * 0.16;
        const y = 1.08 - row * 0.1;
        if (!vis(x, y)) continue;
        items.push({ d: x + y, f: () => drawPerson(r, x, y, QC[k % QC.length], 1, k % 3 === 0, vt + k * 0.37, false) });
      }
    }
    // Bodenpersonal an Flugzeugen in der Abfertigung
    if (zoom >= 0.6) {
      for (const ac of state.acs) {
        if (ac.phase !== PH.STAND || !ac.ta || !vis(ac.x, ac.y)) continue;
        if (gaPlane(state, ac)) continue; // Sportflieger an der Wiese: keine Vorfeldcrew (siehe galife.js)
        const busy = Object.values(ac.ta.tasks || {}).filter((t) => t.st === 'active' || t.st === 'assigned').length;
        const n = 2 + Math.min(3, busy);
        const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
        // typische Arbeitsplätze: Bugrad, vordere/hintere Frachttür, Tankanschluss am Flügel, Heck
        const SPOTS = [[0.44, 0.1], [0.28, 0.32], [-0.22, 0.34], [0.05, -0.62], [-0.38, -0.25]];
        for (let k = 0; k < n; k++) {
          const s = hash(ac.id, k);
          const [fa, fs] = SPOTS[k % SPOTS.length];
          const wob = Math.sin(vt * (0.35 + (s % 5) * 0.06) + s);
          const along = (fa + wob * 0.05) * ac.len;
          const side = fs * ac.len * 0.5 + Math.sign(fs) * 0.18 + Math.cos(vt * 0.5 + s) * 0.05;
          const x = ac.x + fx * along + rx * side;
          const y = ac.y + fy * along + ry * side;
          items.push({ d: x + y + 0.02, p: [x, y], f: () => drawPerson(r, x, y, HIVIS[s % 3], 1, false, vt * 1.3 + s, Math.abs(wob) < 0.9, true) });
        }
      }
    }
    // Planespotter am Westende der Bahn (Ostende: eigener Spotterhügel mit Zaun, Leitern und Stativen, render/spotters.js)
    // – bei schönem Wetter mehr, bei Superjumbo oder Sonderlackierung viele
    const hr = hourOf(state.time), wk = state.weather.kind;
    let nSp = hr > 7.5 && hr < 20.5 ? ({ clear: 4, clouds: 3, rain: 1 }[wk] || 0) : 0;
    if (nSp && state.acs.some((a) => a.type === 'A388' || a.special)) nSp += 6;
    if (zoom >= 0.55 && nSp) {
      const near = state.acs.filter((a) => a.mode === 'map' && [PH.FINAL, PH.TAKEOFF, PH.ROLLOUT].includes(a.phase));
      // hinter dem Westende, seitlich unter den Abflügen
      [{ x: 0.8, y: 35.4 }].forEach((g, gi) => {
        const close = near.some((a) => Math.hypot(a.x - g.x, a.y - g.y) < 16);
        for (let k = 0; k < nSp; k++) {
          const s = hash('spot' + (gi + 1), k);
          const x = g.x + (k % 5) * 0.5 + Math.sin(vt * 0.2 + s) * 0.04, y = g.y + Math.floor(k / 5) * 0.45;
          if (!vis(x, y)) continue;
          items.push({ d: x + y, f: () => drawPerson(r, x, y, SHIRTS[s % SHIRTS.length], 1, k % 2 === 0, vt + s, false) });
          // Blitzlicht, wenn ein Flugzeug nah vorbeizieht
          if (close && (vt * 2.3 + s * 0.13) % 1 < 0.04) lights.push({ x, y, z: 0.14, c: '#ffffff', s: 9, a: 0.95, day: true });
        }
      });
    }
    // Mähtraktor im Frühling und Sommer: zieht tagsüber Bahnen durch den Grasstreifen südlich der Nordbahn
    const sid = season(state).id;
    if ((sid === 'spring' || sid === 'summer') && hr > 8 && hr < 18 && state.weather.kind !== 'rain' && state.weather.kind !== 'storm') {
      const lanes = 3, laneL = 58; // je Bahn knapp eine Minute
      const total = (vt * 1.1) % (lanes * laneL);
      const lane = Math.floor(total / laneL), along = total % laneL;
      const east = lane % 2 === 0;
      const mx = east ? 11 + along : 11 + laneL - along, my = 34.55 + lane * 0.6;
      if (vis(mx, my)) items.push({ d: mx + my, f: () => r.drawAmbientCar({ kind: 'mower', col: '#15803d' }, { x: mx, y: my, h: east ? 0 : Math.PI }, night, lights) });
    }
    // Follow-me-Wagen auf der Vorfeldstraße (erst ab Regionalflughafen – am kleinen Platz gibt es keinen)
    if (LY.GEO.stage >= 2) {
      const L = 108, u = (vt * 0.9) % L;
      const fm = u < 54 ? { x: 12 + u, y: LY.SERVICE - 0.25, h: 0 } : { x: 66 - (u - 54), y: LY.SERVICE + 0.25, h: Math.PI };
      items.push({ d: fm.x + fm.y, f: () => r.drawAmbientCar({ kind: 'followme', col: '#facc15' }, fm, night, lights) });
    }

    // Baustellen: Arbeiter, Kipper, nachts Flutlicht
    for (const s of sites) {
      const g = s.g;
      if (!g || g.x1 === undefined || !(vis(g.x0, g.y0) || vis(g.x1, g.y1) || vis((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2))) continue;
      const w = g.x1 - g.x0, dep = g.y1 - g.y0;
      const nightWork = night > 0.5;
      const workers = nightWork ? 2 : Math.min(8, 3 + Math.round((w * dep) / 6));
      for (let k = 0; k < workers; k++) {
        const hs = hash(s.p.id, k);
        const ux = (Math.sin(vt * (0.12 + (hs % 7) * 0.02) + hs) + 1) / 2, uy = (Math.cos(vt * (0.1 + (hs % 5) * 0.025) + hs * 0.7) + 1) / 2;
        const x = g.x0 + 0.3 + ux * Math.max(0.2, w - 0.6), y = g.y0 + 0.3 + uy * Math.max(0.2, dep - 0.6);
        items.push({ d: x + y, f: () => drawPerson(r, x, y, HIVIS[hs % 3], 1, false, vt * 1.4 + hs, true, true, true) });
      }
      if (w > 1.8 || dep > 1.8) {
        // Kipper pendelt über die Baustelle
        const long = w >= dep;
        const u2 = (Math.sin(vt * 0.18 + hash(s.p.id, 99)) + 1) / 2;
        const tx = long ? g.x0 + 0.5 + u2 * (w - 1) : (g.x0 + g.x1) / 2 + 0.3;
        const ty = long ? (g.y0 + g.y1) / 2 + 0.25 : g.y0 + 0.5 + u2 * (dep - 1);
        const dir = Math.cos(vt * 0.18 + hash(s.p.id, 99)) >= 0 ? 0 : Math.PI;
        items.push({ d: tx + ty, f: () => r.drawAmbientCar({ kind: 'dump', col: '#f59e0b' }, { x: tx, y: ty, h: (long ? 0 : Math.PI / 2) + dir }, night, lights) });
      }
      if (night > 0.15) {
        for (const [cx, cy] of [[g.x0, g.y0], [g.x1, g.y1], [g.x1, g.y0], [g.x0, g.y1]]) lights.push({ x: cx, y: cy, z: 0.9, c: '#fff1cf', s: 26, a: 0.95 });
        lights.push({ x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2, z: 0, c: '#fff1cf', s: 40 + 14 * Math.max(w, dep), a: 0.45, flat: true, soft: true });
      }
    }
    // Hindernisfeuer und Tower-Rundumlicht
    if (night > 0.1) {
      const blink = (vt * 0.8) % 1 < 0.5;
      const tz = r.topZ || {};
      if (tz.tower) {
        lights.push({ x: tz.towerX, y: tz.towerY, z: tz.tower, c: blink ? '#ffffff' : '#30ff70', s: 30, a: 1 });
        lights.push({ x: tz.towerX, y: tz.towerY, z: tz.tower - 0.3, c: '#ff2a20', s: 12, a: 0.9 });
      }
      if (tz.garage) for (const [x, y] of tz.garageCorners) lights.push({ x, y, z: tz.garage, c: '#ff2a20', s: blink ? 11 : 8, a: 0.9 });
      if (tz.hangar) lights.push({ x: tz.hangarX, y: tz.hangarY, z: tz.hangar, c: '#ff2a20', s: 10, a: 0.9 });
    }
  }
}

// Bewegung entlang von Wegpunkten mit Wartezeiten, Ein-/Ausblenden
function moveAgent(a, dt, onStop) {
  if (a.done) return;
  a.t += dt;
  if (a.t < 0) return;
  if (a.wait > 0) {
    a.wait -= dt;
    return;
  }
  const p = a.pts[a.i], q = a.pts[a.i + 1];
  if (!q) {
    a.done = true;
    return;
  }
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 0.001;
  a.s = (a.s || 0) + a.v * dt;
  if (a.s >= len) {
    a.s = 0;
    a.i++;
    if (q.w) {
      a.wait = q.w;
      if (onStop) onStop(q.x, q.y);
    }
    if (a.i >= a.pts.length - 1) a.done = true;
  }
}

function agentPos(a) {
  if (a.t < 0) return null;
  const p = a.pts[Math.min(a.i, a.pts.length - 1)], q = a.pts[Math.min(a.i + 1, a.pts.length - 1)];
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 0.001;
  const u = clamp((a.s || 0) / len, 0, 1);
  let alpha = 1;
  if (p.fadeIn || (a.fadeIn && a.i === 0)) alpha = Math.min(alpha, clamp(u * 4, 0, 1));
  if (q.fade && a.i === a.pts.length - 2) alpha = Math.min(alpha, clamp((1 - u) * 4, 0, 1));
  return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, h: Math.atan2(q.y - p.y, q.x - p.x), alpha, moving: !(a.wait > 0) };
}

// Sportflieger oder Wiesenplatz – dort gibt es keine Abfertigungscrew, Einwinker oder Pylonen
export function gaPlane(state, ac) {
  const t = AC_TYPES[ac.type];
  if (t && t.light) return true;
  const st = ac.stand != null && state.stands.find((s) => s.id === ac.stand);
  return !!(st && st.ga);
}

function hash(str, k) {
  let h = 2166136261 ^ k;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return Math.abs(h) % 100000;
}

// Kleine Person: Beine, Körper, Kopf (Helm auf Baustellen), optional Koffer
export function drawPerson(r, x, y, col, alpha, bag, ph, moving, hivis = false, helmet = false) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const z = cam.zoom;
  const b = cam.toScreen(x, y, 0);
  const H = 0.12 * ZS * z; // ~1,8 m
  const w = Math.max(1, 0.035 * ZS * z);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(b.x + w * 0.8, b.y, w * 1.4, w * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  const step = moving ? Math.sin(ph * 7) * w * 0.5 : 0;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(b.x - w * 0.5 + step * 0.4, b.y - H * 0.45, w * 0.45, H * 0.45);
  ctx.fillRect(b.x + w * 0.05 - step * 0.4, b.y - H * 0.45, w * 0.45, H * 0.45);
  ctx.fillStyle = col;
  ctx.fillRect(b.x - w * 0.55, b.y - H * 0.85, w * 1.1, H * 0.42);
  if (hivis) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(b.x - w * 0.55, b.y - H * 0.68, w * 1.1, Math.max(1, H * 0.05));
  }
  ctx.fillStyle = helmet ? '#f8fafc' : '#e0b48c';
  ctx.beginPath();
  ctx.arc(b.x, b.y - H * 0.93, w * 0.42, 0, Math.PI * 2);
  ctx.fill();
  if (bag) {
    ctx.fillStyle = '#334155';
    ctx.fillRect(b.x + w * 0.7, b.y - H * 0.32, w * 0.7, H * 0.3);
  }
  ctx.globalAlpha = 1;
}
