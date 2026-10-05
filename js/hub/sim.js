// Großflughäfen: Verkehrssimulation für den Tower. Anflüge (vom Anflug-Controller gestaffelt, mit Wirbelschleppen-
// Abständen), Landung, Ausfahrt, Rollen über das Netz mit Abstand und Vorfahrt, Pushback, Rollhalt, Start und
// Abflug. Der Spieler gibt Lande-, Aufroll-, Start- und Kreuzungsfreigaben (optional auch Pushback und Rollen);
// Bodenverkehr und Anflug-Staffelung erledigen KI-Kollegen. Konflikte werden erkannt und gezählt.
import { AC_TYPES, AIRLINES, CITIES } from '../config.js';
import { NM, KT, dist, sub, dot, cross, add, mul, norm, rng, angNorm, brgOfVec, segX } from './geom.js';
import { findRoute, pathFromRoute, pathAt } from './route.js';
import { speech } from '../sim/messages.js';

const GS = Math.tan((3 * Math.PI) / 180);
const SPAWN = 12 * NM; // Anflug erscheint 12 NM vor der Schwelle
const CALL = 7.5 * NM; // Erstanruf beim Tower
const NO_CLR = 1.1 * NM; // ohne Landefreigabe: Durchstarten
const DECIDE = 0.3 * NM; // Bahn muss frei sein
const TD = 15; // Aufsetzpunkt hinter der Schwelle
// Startlauf: Abhebegeschwindigkeit, Beschleunigung und Zeit bis zum Abheben aus dem Stand
const vrOf = (ac) => (ac.tt.vapp || 140) * 1.08 * KT;
const accOf = (ac) => (ac.size === 'L' ? 0.06 : ac.size === 'S' ? 0.1 : 0.085);
const tkTime = (ac) => vrOf(ac) / accOf(ac) + 3;
// gemischter Betrieb: Lücke in der Anflugkette (NM), in die ein Start passt
const GAP_MIX = 6.5;
const V_TAXI = 0.62, V_LANE = 0.3, V_STAND = 0.14, V_PUSH = 0.12, A_TAXI = 0.08, D_TAXI = 0.2;
// Wirbelschleppen-Abstände im Endanflug (NM): Vorausfliegender -> Folgender
const SEP = { J: { J: 4, H: 6, M: 7, L: 8 }, H: { J: 4, H: 4, M: 5, L: 6 }, M: { J: 3, H: 3, M: 3, L: 5 }, L: { J: 3, H: 3, M: 3, L: 3 } };
// Startabstand (s) hinter einem Start von derselben Bahn
const DEP_SEP = { J: { J: 120, H: 180, M: 180, L: 180 }, H: { J: 90, H: 90, M: 120, L: 120 }, M: { J: 60, H: 60, M: 60, L: 90 }, L: { J: 60, H: 60, M: 60, L: 60 } };
const TURN = { S: 40, M: 55, L: 95 }; // Umlaufzeiten (min)

export const PHASE = {
  APP: 'APP', FIN: 'FIN', ROLL: 'ROLL', TAXI_IN: 'TAXI_IN', STAND: 'STAND', GA: 'GA',
  PUSH: 'PUSH', START: 'START', TAXI_OUT: 'TAXI_OUT', HOLD: 'HOLD', LINEUP: 'LINEUP', LINED: 'LINED', TKOF: 'TKOF', CLIMB: 'CLIMB', GONE: 'GONE',
};
const P = PHASE;

export class HubSim {
  constructor(ap, opt = {}) {
    this.ap = ap;
    this.opt = opt;
    this.rand = rng(opt.seed || 12345);
    this.t = (opt.hour ?? 7) * 3600;
    this.t0 = this.t;
    this.tEnd = opt.minutes ? this.t + opt.minutes * 60 : Infinity;
    this.intensity = opt.intensity ?? 1;
    this.wind = { ...(opt.wind || { dir: 250, spd: 10 }) };
    this.cfg = ap.configs.find((c) => c.id === opt.config) || ap.configs[0];
    this.manualGround = !!opt.manualGround;
    this.auto = { land: false, dep: false, cross: false, ...(opt.auto || {}) };
    this.acs = [];
    this.seq = 0;
    this.prio = 0;
    this.radioLog = [];
    this.events = [];
    this.onRadio = null;
    this.onEvent = null;
    this.stats = { arr: 0, dep: 0, ga: 0, conf: 0, wake: 0, arrDelay: 0, depDelay: 0, cross: 0, incursion: 0 };
    this.lastTk = {}; // Bahn -> { t, wake } letzter Start
    this.backlog = []; // geplante Anflüge (noch nicht im Endanflug)
    this.conflictKeys = new Set();
    this.done = false;
    this.edgeUse = new Map();
    // Bahnkreuzungspunkte (sich kreuzende Bahnen)
    this.rwyX = [];
    const R = ap.runways;
    for (let i = 0; i < R.length; i++)
      for (let j = i + 1; j < R.length; j++) {
        const x = segX(R[i].a, R[i].b, R[j].a, R[j].b);
        if (x) this.rwyX.push({ a: R[i].id, b: R[j].id, p: x.p });
      }
    this.standBusy = new Map(); // Position -> Flugzeug (belegt oder reserviert)
    this.setup();
  }

  // ---------------------------------------------------------------- Hilfen
  r() {
    return this.rand();
  }
  pickW(obj) {
    const ent = Object.entries(obj);
    let tot = 0;
    for (const [, w] of ent) tot += w;
    let x = this.r() * tot;
    for (const [k, w] of ent) if ((x -= w) <= 0) return k;
    return ent[ent.length - 1][0];
  }
  activeEnds() {
    return new Set([...this.cfg.arr, ...this.cfg.dep]);
  }
  rwyActive(rwyId) {
    const r = this.ap.rwyById[rwyId];
    const act = this.activeEnds();
    return r.ends.some((e) => act.has(e));
  }
  radio(from, text, kind = 'pilot', ac = null) {
    const m = { t: this.t, from, text, kind, ac: ac ? ac.id : null };
    this.radioLog.push(m);
    if (this.radioLog.length > 80) this.radioLog.shift();
    if (this.onRadio) this.onRadio(m);
  }
  event(kind, text, ac = null) {
    const e = { t: this.t, kind, text, ac: ac ? ac.id : null };
    this.events.push(e);
    if (this.events.length > 40) this.events.shift();
    if (this.onEvent) this.onEvent(e);
  }
  windStr() {
    return `wind ${String(Math.round(this.wind.dir / 10) * 10 || 360).padStart(3, '0')} degrees ${Math.round(this.wind.spd)} knots`;
  }
  // Rücken-/Seitenwind für ein Bahnende (kt)
  windOn(endId) {
    const e = this.ap.ends[endId];
    const d = ((this.wind.dir - e.brg) * Math.PI) / 180;
    return { head: Math.cos(d) * this.wind.spd, cross: Math.abs(Math.sin(d) * this.wind.spd) };
  }

  // ---------------------------------------------------------------- Flugzeuge anlegen
  newFlight(kind, extra = {}) {
    const ap = this.ap;
    let airline = this.pickW(ap.airlines);
    let type;
    if (AIRLINES[airline]?.cargo) type = this.r() < 0.6 ? 'B77F' : 'B748F';
    else if (airline === 'BWG' || airline === 'FJW') type = this.r() < 0.5 ? 'E190' : this.r() < 0.5 ? 'CRJ9' : 'DH8D';
    else type = this.pickW(ap.mix);
    const tt = AC_TYPES[type];
    const num = airline === 'AUR' || airline === 'OPL' ? 100 + Math.floor(this.r() * 899) : 10 + Math.floor(this.r() * 3980);
    const al = AIRLINES[airline];
    const cats = tt.size === 'L' ? ['long', 'long', 'mid'] : tt.size === 'S' ? ['short'] : ['short', 'mid', 'mid'];
    const cat = cats[Math.floor(this.r() * cats.length)];
    const pool = Object.keys(CITIES).filter((k) => CITIES[k].cat === cat && k !== ap.code);
    const city = pool[Math.floor(this.r() * pool.length)] || 'MAD';
    return {
      id: ++this.seq,
      kind,
      airline,
      type,
      tt,
      cs: `${airline}${num}`,
      tel: `${al.tel} ${num}`,
      num,
      wake: type === 'A388' ? 'J' : tt.wake,
      size: tt.size,
      len: tt.len,
      span: tt.len * 0.95,
      city,
      x: 0,
      y: 0,
      z: 0,
      hdg: 0,
      spd: 0,
      phase: kind === 'arr' ? P.APP : P.STAND,
      req: null,
      mode: 'map',
      ...extra,
    };
  }
  // freie Position passend zu Größe und Airline
  freeStand(ac, used = this.standBusy) {
    const ap = this.ap;
    const pref = ap.terminals[ac.airline] || ap.terminals['*'];
    const fits = (st) => !used.has(st.id) && (st.size === 'L' || ac.size !== 'L') && (st.term === 'CARGO') === !!AIRLINES[ac.airline]?.cargo;
    let list = ap.stands.filter((st) => fits(st) && pref.includes(st.term));
    if (!list.length) list = ap.stands.filter(fits);
    if (!list.length && AIRLINES[ac.airline]?.cargo) list = ap.stands.filter((st) => !used.has(st.id) && st.size === 'L');
    if (!list.length) return null;
    // kleinere Flugzeuge lieber auf mittlere Positionen
    const small = list.filter((st) => st.size === (ac.size === 'L' ? 'L' : 'M'));
    const L = small.length ? small : list;
    return L[Math.floor(this.r() * L.length)];
  }

  // ---------------------------------------------------------------- Startaufstellung
  setup() {
    const ap = this.ap;
    const prof = ap.profile;
    const hourAt = (t) => Math.floor(t / 3600) % 24;
    const span = Math.min(this.tEnd, this.t0 + 3 * 3600) - this.t0;
    // geplante Bewegungen über die Einsatzzeit (bei Endlos: die ersten drei Stunden, danach laufend)
    this.planUntil = this.t0;
    this.planAhead(this.t0 + Math.min(span, 3600 * 1.5));
    // geparkte Flugzeuge: Abflüge der nächsten Zeit plus Langzeitparker (Füllgrad ~70 %)
    const depTimes = [];
    for (let t = this.t0 - 600; t < this.t0 + span; t += 60) {
      const h = hourAt(t);
      const perMin = ((prof.mov[h] || 0) * (1 - prof.arr[h]) * this.intensity) / 60;
      if (this.r() < perMin) depTimes.push(t + this.r() * 60);
    }
    const nStands = ap.stands.length;
    for (const tobt of depTimes) {
      const ac = this.newFlight('dep');
      const st = this.freeStand(ac);
      if (!st) break;
      this.park(ac, st);
      ac.tobt = tobt;
    }
    // Langzeitparker bis etwa 55 % Belegung
    let guard = 0;
    while (this.standBusy.size < nStands * 0.55 && guard++ < 400) {
      const ac = this.newFlight('dep');
      const st = this.freeStand(ac);
      if (!st) break;
      this.park(ac, st);
      ac.tobt = this.t0 + span + 600 + this.r() * 7200;
    }
    // die ersten Anflüge schon im Endanflug verteilen
    this.spawnArrivals(true);
  }
  park(ac, st) {
    ac.stand = st;
    ac.x = st.x;
    ac.y = st.y;
    ac.hdg = st.hdg;
    ac.phase = P.STAND;
    ac.z = 0;
    ac.spd = 0;
    this.standBusy.set(st.id, ac);
    this.acs.push(ac);
  }
  // Anflugplan fortschreiben (Ankunftszeiten an der Schwelle)
  planAhead(until) {
    const prof = this.ap.prof || this.ap.profile;
    for (let t = this.planUntil; t < until; t += 60) {
      const h = Math.floor(t / 3600) % 24;
      const perMin = ((prof.mov[h] || 0) * prof.arr[h] * this.intensity) / 60;
      if (this.r() < perMin) this.backlog.push({ eta: t + this.r() * 60, flight: null });
    }
    this.planUntil = Math.max(this.planUntil, until);
    this.backlog.sort((a, b) => a.eta - b.eta);
  }

  // ---------------------------------------------------------------- Anflug
  arrEnds() {
    return this.cfg.arr;
  }
  queueOn(endId) {
    return this.acs.filter((a) => (a.phase === P.APP || a.phase === P.FIN) && a.end === endId).sort((a, b) => a.dfin - b.dfin);
  }
  // Abstand (Kacheln) hinter dem letzten Anflug auf diesem Ende, den ein neuer Anflug braucht
  sepFor(lead, ac, endId) {
    let s = Math.max(this.ap.minSep || 2.5, SEP[lead.wake][ac.wake]);
    // gemischter Betrieb: Lücke für Starts, wenn welche warten
    if (this.cfg.dep.includes(endId)) {
      const waiting = this.acs.filter((a) => a.depEnd === endId && (a.phase === P.HOLD || a.phase === P.TAXI_OUT)).length;
      // jede zweite Lücke groß genug für einen Start, bei langer Schlange jede
      if (waiting >= 3 || (waiting && !lead.afterGap)) s = Math.max(s, GAP_MIX);
    }
    if (this.lvp) s = Math.max(s, 4.5);
    return s * NM;
  }
  chooseArrEnd(ac) {
    const ends = this.arrEnds();
    if (ends.length === 1) return ends[0];
    // Bahn auf der Seite der Position, bei Gleichstand die kürzere Warteschlange
    let best = null;
    for (const e of ends) {
      const end = this.ap.ends[e];
      const mid = add(end.thr, mul(end.dir, end.len * 0.5));
      const d = ac.stand ? dist(mid, ac.stand) : 0;
      const q = this.queueOn(e).length + this.backlog.filter((b) => b.end === e).length;
      const score = d + q * 18 + this.r() * 8;
      if (!best || score < best.score) best = { e, score };
    }
    return best.e;
  }
  spawnArrivals(initial = false) {
    // Anflüge aus dem Plan in den Endanflug holen, sobald Staffelung und Position es erlauben
    const lead = 3.6 * 60; // Flugzeit 12 NM ≈ 4 min
    let spawned = 0;
    while (this.backlog.length && spawned < 6) {
      const b = this.backlog[0];
      if (!initial && b.eta - lead > this.t) break;
      if (initial && b.eta > this.t + 8 * 60) break;
      if (!b.flight) b.flight = this.newFlight('arr', { eta: b.eta });
      if (!b.flight.stand) {
        const st = this.freeStand(b.flight);
        if (!st) {
          // Vorfeld voll: Anflug hält, bis eine Position frei wird
          b.eta += 120;
          b.held = (b.held || 0) + 1;
          this.backlog.sort((p, q) => p.eta - q.eta);
          return;
        }
        b.flight.stand = st;
        this.standBusy.set(st.id, b.flight);
      }
      const ac = b.flight;
      if (!ac.end) ac.end = this.chooseArrEnd(ac);
      const q = this.queueOn(ac.end);
      const last = q[q.length - 1];
      let d = SPAWN;
      if (initial) d = Math.max(5 * NM, Math.min(SPAWN, 5 * NM + ((b.eta - this.t) / 60) * 2.6 * NM));
      if (last) {
        const need = last.dfin + this.sepFor(last, ac, ac.end) + 0.8 * NM;
        if (need > SPAWN + 0.5) {
          if (initial) break;
          break;
        }
        d = Math.max(d, need);
        ac.afterGap = this.cfg.dep.includes(ac.end) && need - last.dfin > (GAP_MIX - 0.1) * NM;
      }
      this.backlog.shift();
      ac.dfin = Math.min(d, SPAWN);
      ac.phase = P.APP;
      ac.spd = 180 * KT;
      this.placeOnFinal(ac);
      this.acs.push(ac);
      spawned++;
    }
  }
  placeOnFinal(ac) {
    const end = this.ap.ends[ac.end];
    ac.x = end.thr.x - end.dir.x * ac.dfin;
    ac.y = end.thr.y - end.dir.y * ac.dfin;
    ac.z = ac.dfin * GS + 0.75;
    ac.hdg = end.hdg;
  }
  updateApproach(ac, dt) {
    const end = this.ap.ends[ac.end];
    const vapp = (ac.tt.vapp || 140) * KT;
    let v = ac.dfin > 6 * NM ? 180 * KT : ac.dfin > 3.6 * NM ? vapp + (180 * KT - vapp) * ((ac.dfin - 3.6 * NM) / (2.4 * NM)) : vapp;
    // Abstand zum Vordermann halten (Anflug-Controller verlangsamt früh)
    const q = this.queueOn(ac.end);
    const i = q.indexOf(ac);
    if (i > 0) {
      const lead = q[i - 1];
      const need = this.sepFor(lead, ac, ac.end) - 0.15 * NM;
      if (ac.dfin - lead.dfin < need && ac.dfin > 3 * NM) v = Math.min(v, Math.max(vapp * 0.92, lead.spd - 12 * KT));
    }
    ac.spd += Math.max(-0.4 * KT * dt * 3, Math.min(0.4 * KT * dt * 3, v - ac.spd));
    ac.dfin -= ac.spd * dt;
    this.placeOnFinal(ac);
    // Erstanruf beim Tower
    if (ac.phase === P.APP && ac.dfin < CALL) {
      ac.phase = P.FIN;
      ac.req = ac.landClr ? null : 'land';
      ac.tReq = this.t;
      this.radio(ac.tel, `${this.ap.tower}, ${ac.tel}, ILS runway ${ac.end}, ${Math.round(ac.dfin / NM)} miles`, 'pilot', ac);
    }
    if (ac.phase !== P.FIN) return;
    if (this.auto.land && !ac.landClr) this.autoLand(ac);
    // KI-Tower: wird die Bahn absehbar nicht rechtzeitig frei, früh durchstarten lassen
    else if (this.auto.land && ac.landClr && ac.dfin < 1.4 * NM && ac.dfin > 0.6 * NM && !ac.checked) {
      const tThr = ac.dfin / Math.max(ac.spd, 1);
      const rw = this.ap.ends[ac.end].rwy;
      if (this.occupants(rw, ac).some((o) => this.clearTime(o) > tThr - 2)) {
        this.orderGoAround(ac);
        return;
      }
    }
    if (!ac.landClr && ac.dfin < NO_CLR) {
      this.goAround(ac, 'noclr');
      return;
    }
    if (ac.landClr && ac.dfin < DECIDE && !ac.checked) {
      ac.checked = true;
      const tThr = ac.dfin / Math.max(ac.spd, 1);
      const occ = this.occupants(end.rwy, ac).filter((o) => this.clearTime(o) > tThr + 1);
      if (occ.length) {
        this.conflict(ac, occ[0], 'land');
        this.goAround(ac, 'occupied');
        return;
      }
      // Rückenwind: unstabiler Anflug
      const w = this.windOn(ac.end);
      if (w.head < -10 && this.r() < 0.35) {
        this.goAround(ac, 'tailwind');
        return;
      }
    }
    if (ac.dfin <= 0) this.touchdown(ac);
  }
  goAround(ac, why) {
    const end = this.ap.ends[ac.end];
    ac.phase = P.GA;
    ac.req = null;
    ac.landClr = false;
    ac.gaS = -ac.dfin;
    this.stats.ga++;
    if (why === 'atc') this.radio(ac.tel, `Going around, ${ac.tel}`, 'pilot', ac);
    else if (why === 'noclr') this.radio(ac.tel, `${ac.tel}, going around, no landing clearance`, 'pilot', ac);
    else if (why === 'occupied') this.radio(ac.tel, `${ac.tel}, going around, runway occupied`, 'pilot', ac);
    else this.radio(ac.tel, `${ac.tel}, going around, unstable approach`, 'pilot', ac);
    this.event('ga', why, ac);
    ac.end0 = end.id;
  }
  updateGoAround(ac, dt) {
    const end = this.ap.ends[ac.end0 || ac.end];
    ac.spd = Math.min(ac.spd + 2 * KT * dt, 200 * KT);
    ac.gaS += ac.spd * dt;
    ac.x = end.thr.x + end.dir.x * ac.gaS;
    ac.y = end.thr.y + end.dir.y * ac.gaS;
    ac.z = Math.max(ac.z, 0) + ac.spd * dt * 0.07;
    ac.hdg = end.hdg;
    if (ac.gaS > end.len + 4 * NM) {
      // neuer Anflug: hinten anstellen
      this.acs.splice(this.acs.indexOf(ac), 1);
      ac.phase = P.APP;
      ac.checked = false;
      ac.end = null;
      ac.end0 = null;
      ac.ga = (ac.ga || 0) + 1;
      this.backlog.push({ eta: this.t + 6 * 60, flight: ac });
      this.backlog.sort((p, q) => p.eta - q.eta);
    }
  }
  touchdown(ac) {
    const end = this.ap.ends[ac.end];
    ac.phase = P.ROLL;
    ac.req = null;
    // Ausfahrt wählen: erste, die nach dem Bremsweg erreichbar ist
    const a = ac.size === 'L' ? 0.062 : 0.075;
    const v = ac.spd;
    // Ausfahrt wählen: unter den erreichbaren (Bremsweg) die mit dem besten Weg zur Position
    let pick = null, best = Infinity, n = 0;
    for (const x of end.exits) {
      const vx = x.rapid ? 0.95 : 0.36;
      const need = TD + Math.max(0, (v * v - vx * vx) / (2 * a)) + 3;
      if (x.s < need) continue;
      const r = findRoute(this.ap, x.hold, ac.stand.node);
      if (!r) continue;
      let c = (x.s - need) * 3.5; // Bahn schnell freimachen hat Vorrang
      for (const st of r) c += this.ap.edges[st.e].len + (this.ap.edges[st.e].kind === 'rwz' ? 90 : 0);
      if (c < best) {
        best = c;
        pick = x;
      }
      if (++n >= 4) break;
    }
    if (!pick) pick = end.exits[end.exits.length - 1];
    ac.exit = pick;
    ac.decel = a;
    ac.vExit = pick.rapid ? 0.95 : 0.36;
    // Pfad: Bahnmitte bis zur Ausfahrt, dann über den Rollhalt zur Position
    const line = this.ap.lines[pick.line];
    const exitEdges = this.ap.edges.filter((e) => e.line === line.i);
    // Kanten der Ausfahrt vom Bahnknoten bis zum Rollhalt
    const route = [];
    let cur = pick.rn;
    for (let guard = 0; guard < 6 && cur !== pick.hold; guard++) {
      const e = exitEdges.find((x) => (x.a === cur || x.b === cur) && !route.some((r) => r.e === x.id));
      if (!e) break;
      const dir = e.a === cur ? 1 : -1;
      route.push({ e: e.id, dir });
      cur = dir === 1 ? e.b : e.a;
    }
    const rest = findRoute(this.ap, pick.hold, ac.stand.node) || [];
    const thrPt = { x: end.thr.x, y: end.thr.y };
    const path = pathFromRoute(this.ap, [...route, ...rest], thrPt, { append: [{ x: ac.stand.x, y: ac.stand.y }] });
    ac.vacS = path.segs.find((sg) => sg.to === pick.hold)?.s1 ?? 40;
    this.setPath(ac, path, 0);
    ac.landT = this.t;
    this.radio(this.ap.tower, `${ac.tel}, vacate via ${pick.name}, contact ground ${this.ap.ground}`, 'atc', ac);
  }

  // ---------------------------------------------------------------- Pfade und Rollen
  setPath(ac, path, s = 0) {
    ac.path = path;
    ac.s = s;
    ac.pi = 1;
    ac.stops = [];
    let prevRwy = null;
    for (const sg of path.segs) {
      if (sg.kind === 'rwz') {
        if (sg.rwy !== prevRwy) ac.stops.push({ s: sg.s0, rwy: sg.rwy, clr: false, seg: sg });
        prevRwy = sg.rwy;
      } else prevRwy = null;
    }
    // Ausfahrt nach der Landung beginnt in der Bahnzone: dort kein Halt nötig (spätere Kreuzungen schon)
    if (ac.phase === P.ROLL) ac.stops = ac.stops.filter((st) => st.s > (ac.vacS ?? 30) - 0.5);
    ac.prio = ++this.prio;
  }
  // Kanten-Abschnitt an Position s
  segAt(ac, s = ac.s) {
    const segs = ac.path.segs;
    for (const sg of segs) if (s >= sg.s0 - 0.01 && s <= sg.s1 + 0.01) return sg;
    return null;
  }
  // freie Strecke vor einem Flugzeug am Boden: andere Flugzeuge auf oder dicht an der eigenen Route voraus (Punkte
  // entlang des Pfads, damit Schlangen um Ecken herum erkannt werden)
  // Punkte entlang des eigenen Wegs voraus (ohne Weg: geradeaus in Rollrichtung)
  samplesOf(ac, look = 16) {
    const path = ac.path;
    const samples = [];
    if (path && ac.s != null) {
      let i = ac.pi || 1;
      for (let d = 0.6; d <= look; d += 0.8) {
        const q = pathAt(path, Math.min(path.total + 3, ac.s + d), i);
        i = q.i;
        samples.push({ x: q.x, y: q.y, d });
        if (ac.s + d > path.total + 2) break;
      }
    } else {
      const dx = Math.cos(ac.hdg), dy = Math.sin(ac.hdg);
      for (let d = 0.6; d <= look; d += 0.8) samples.push({ x: ac.x + dx * d, y: ac.y + dy * d, d });
    }
    return samples;
  }
  freeAhead(ac, dirx, diry, look = 16) {
    let free = Infinity, by = null;
    const path = ac.path;
    let samples;
    if (path) samples = this.samplesOf(ac, look);
    else {
      samples = [];
      for (let d = 0.6; d <= look; d += 0.8) samples.push({ x: ac.x + dirx * d, y: ac.y + diry * d, d });
    }
    // seitlicher Abstand eines Punkts zu einer Punktfolge
    const off = (sm, p) => sm.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)), Infinity);
    for (const o of this.movers) {
      if (o === ac) continue;
      const dx = o.x - ac.x, dy = o.y - ac.y;
      if (dx * dx + dy * dy > (look + 4) * (look + 4)) continue;
      const corridor = 1.0 + Math.min(1.0, (o.span + ac.span) * 0.06);
      let hit = null;
      for (const sp of samples) {
        if (Math.abs(o.x - sp.x) < corridor && Math.abs(o.y - sp.y) < corridor && Math.hypot(o.x - sp.x, o.y - sp.y) < corridor) {
          hit = sp;
          break;
        }
      }
      if (!hit) continue;
      // gegenseitige Blockade: es fährt, wer dem anderen weniger im Weg steht (der andere liegt weiter neben dem
      // eigenen Weg als man selbst neben dessen Weg); bei Gleichstand das ältere Flugzeug (niedrigere Priorität),
      // Nase an Nase nur als Notlösung nach längerem Warten. Die Entscheidung gilt eine Weile, damit kein Ruckeln
      // entsteht.
      if (o.blockedBy === ac.id) {
        if (ac.passId === o.id && this.t < ac.passUntil) continue;
        const mine = off(samples, o), theirs = off(this.samplesOf(o, look), ac);
        let go = mine > theirs + 0.15;
        if (!go && Math.abs(mine - theirs) <= 0.15 && ac.prio < o.prio) {
          const headOn = Math.cos(o.hdg - ac.hdg) < -0.6;
          go = !headOn || (ac.wait || 0) > 12;
        }
        if (go) {
          ac.passId = o.id;
          ac.passUntil = this.t + 25;
          continue;
        }
      }
      // Sicherheitsnetz gegen Ringblockaden (A wartet auf B wartet auf … A): nach langem Warten fährt das ältere
      if ((ac.wait || 0) > 30 && ac.prio < o.prio && this.inCycle(ac, o)) continue;
      const f = hit.d - (ac.len + o.len) * 0.5 - 0.9;
      if (f < free) {
        free = f;
        by = o.id;
      }
    }
    ac.blockedBy = by;
    return free;
  }
  // wartet o (über eine Kette) auf ac? Dann ist es eine Ringblockade
  inCycle(ac, o) {
    let x = o;
    for (let k = 0; k < 12 && x; k++) {
      if (x.blockedBy == null || (x.wait || 0) < 5) return false;
      if (x.blockedBy === ac.id) return true;
      x = this.byId.get(x.blockedBy);
    }
    return false;
  }
  moveTaxi(ac, dt, vmax = V_TAXI, fast = false, endGap = 0) {
    const path = ac.path;
    let limit = path.total - endGap - ac.s;
    // Halt vor Bahnzonen ohne Freigabe
    for (const st of ac.stops) {
      if (st.passed) continue;
      if (st.s < ac.s - 0.5) {
        st.passed = true;
        continue;
      }
      if (!st.clr) {
        if (!this.rwyActive(st.rwy) && !this.manualCross) st.clr = true;
        else {
          const nose = ac.len * 0.5;
          limit = Math.min(limit, st.s - nose - ac.s);
          if (st.s - nose - ac.s < 0.6 && ac.spd < 0.05 && ac.req !== 'cross') {
            ac.req = 'cross';
            ac.reqRwy = st.rwy;
            ac.reqStop = st;
            ac.tReq = this.t;
            const rw = this.ap.rwyById[st.rwy];
            this.radio(ac.tel, `${this.ap.tower}, ${ac.tel}, holding short runway ${rw.ends.join('/')}, request crossing`, 'pilot', ac);
          }
        }
      }
      break;
    }
    // Gegenverkehr auf beidseitig befahrenen Kanten: vor der Einfahrt warten
    const sg = this.segAt(ac);
    if (sg) {
      const idx = path.segs.indexOf(sg);
      const cur = this.ap.edges[sg.e];
      // vor der Einfahrt in einen beidseitig befahrenen Abschnitt: frei bis zum nächsten Einbahn-Stück?
      for (let k = idx + 1; k < path.segs.length; k++) {
        const nx = path.segs[k];
        if (nx.s0 - ac.s > 9 + ac.len * 0.5) break;
        const e = this.ap.edges[nx.e];
        if (e.oneway || e.kind === 'rwz') continue;
        if (!cur.oneway && cur.kind !== 'rwz' && k === idx + 1) break; // schon drin
        let blocked = false;
        const run = [];
        for (let j = k, len = 0; j < path.segs.length && len < 70; j++) {
          const sj = path.segs[j], ej = this.ap.edges[sj.e];
          if (ej.oneway || ej.kind === 'rwz') break;
          len += ej.len;
          run.push(sj);
          const users = this.edgeUse.get(sj.e);
          if (users && users.some((u) => u.ac !== ac && u.dir !== sj.dir)) {
            blocked = true;
            break;
          }
        }
        const wait = nx.s0 - ac.s - ac.len * 0.5 - 2.4;
        if (blocked) limit = Math.min(limit, wait);
        // frei und kurz davor: Strecke reservieren, damit niemand mehr entgegen einfährt
        else if (wait < 1.5 && !ac.resv) {
          ac.resv = run.map((sj) => ({ e: sj.e, dir: sj.dir, s1: sj.s1 }));
          // sofort eintragen, damit im selben Schritt niemand entgegen einfährt oder zurückschiebt
          for (const r of ac.resv) this.useEdge(r.e, ac, r.dir);
        }
        break;
      }
    }
    const p = pathAt(path, ac.s, ac.pi);
    const free = this.freeAhead(ac, Math.cos(ac.hdg), Math.sin(ac.hdg));
    // Kurven: langsamer
    const ahead = pathAt(path, ac.s + 3.5, p.i);
    const turn = Math.abs(angNorm(Math.atan2(ahead.dy, ahead.dx) - Math.atan2(p.dy, p.dx)));
    let vt = vmax;
    if (!fast) {
      if (turn > 0.7) vt = Math.min(vt, 0.26);
      else if (turn > 0.35) vt = Math.min(vt, 0.4);
    }
    const room = Math.min(limit, free);
    // bis auf wenige Zentimeter an Haltepunkt oder Ziel heranrollen
    vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * D_TAXI * (room - 0.03))) + (room > 0.06 ? 0.04 : 0));
    ac.spd += Math.max(-D_TAXI * 2 * dt, Math.min(A_TAXI * dt, vt - ac.spd));
    if (ac.spd < 0) ac.spd = 0;
    const step = Math.max(0, Math.min(ac.spd * dt, room));
    ac.s += step;
    ac.wait = step < 0.03 * dt ? (ac.wait || 0) + dt : 0;
    const q = pathAt(path, ac.s, p.i);
    ac.pi = q.i;
    ac.x = q.x;
    ac.y = q.y;
    const look = pathAt(path, Math.min(path.total, ac.s + 1.4), q.i);
    const back = pathAt(path, Math.max(0, ac.s - 1.0), q.i);
    if (Math.hypot(look.x - back.x, look.y - back.y) > 0.05) {
      const h = Math.atan2(look.y - back.y, look.x - back.x);
      ac.hdg += Math.max(-1.6 * dt, Math.min(1.6 * dt, angNorm(h - ac.hdg)));
    }
    // Bahnzone
    const sg2 = this.segAt(ac);
    ac.onRwz = sg2 && sg2.kind === 'rwz' ? sg2.rwy : null;
    ac.seg = sg2;
    // Bahnkreuzung abgeschlossen
    if (ac.crossRwy && ac.onRwz !== ac.crossRwy && ac.reqStop && ac.s > ac.reqStop.s + 2) ac.crossRwy = null;
    return ac.s >= path.total - endGap - 0.1;
  }

  // ---------------------------------------------------------------- Landung und Rollen zur Position
  updateRoll(ac, dt) {
    const end = this.ap.ends[ac.end];
    if (ac.s < TD) {
      // Ausschweben
      ac.z = Math.max(0, 0.75 * (1 - ac.s / TD));
    } else ac.z = 0;
    const sExit = ac.exit.s;
    if (ac.s < sExit - 1) {
      // ausrollen (Schubumkehr im Leerlauf) und so bremsen, dass die Abrollgeschwindigkeit genau an der Ausfahrt erreicht ist
      const rem = Math.max(0, sExit - 1 - ac.s);
      const vMax = Math.sqrt(ac.vExit * ac.vExit + 2 * ac.decel * rem);
      if (ac.s >= TD) ac.spd = Math.max(ac.vExit, Math.min(ac.spd - 0.03 * dt, vMax));
      // Konflikt voraus auf der Bahn
      this.rollAhead(ac, end.rwy);
      ac.s += ac.spd * dt;
      const q = pathAt(ac.path, ac.s, ac.pi);
      ac.pi = q.i;
      ac.x = q.x;
      ac.y = q.y;
      ac.hdg = end.hdg;
      ac.onRwz = end.rwy;
      return;
    }
    // auf dem Abrollweg
    ac.z = 0;
    const done = this.moveTaxi(ac, dt, ac.s < ac.vacS ? Math.max(0.5, ac.spd) : V_TAXI, ac.s < ac.vacS + 2);
    if (!ac.vacated && ac.s >= ac.vacS) {
      ac.vacated = true;
      ac.phase = P.TAXI_IN;
      this.stats.arr++;
      this.stats.arrDelay += Math.max(0, this.t - (ac.eta || this.t));
      this.event('landed', '', ac);
    }
    if (done) this.parkArrival(ac);
  }
  // Hindernis voraus auf der Bahn während Landung oder Start
  rollAhead(ac, rwyId) {
    for (const o of this.acs) {
      if (o === ac || o.z > 0.3 || o.phase === P.STAND || o.phase === P.APP || o.phase === P.FIN || o.phase === P.GA || o.phase === P.CLIMB) continue;
      const onR = o.onRwz === rwyId || ((o.phase === P.ROLL || o.phase === P.LINED || o.phase === P.LINEUP || o.phase === P.TKOF) && this.rwyOf(o) === rwyId);
      if (!onR) continue;
      const rx = o.x - ac.x, ry = o.y - ac.y;
      const h = { x: Math.cos(ac.hdg), y: Math.sin(ac.hdg) };
      const ahead = rx * h.x + ry * h.y, lat = Math.abs(rx * h.y - ry * h.x);
      // Landung: was hinter der eigenen Ausfahrt die Bahn kreuzt, stört nicht (wie bei der Kreuzungsfreigabe)
      const beyondExit = ac.phase === P.ROLL && ac.exit && ac.s + ahead > ac.exit.s + 6;
      if (ahead > 0 && ahead < 45 && lat < 4 && !beyondExit) {
        this.conflict(ac, o, 'roll');
        if (ac.phase === P.ROLL) ac.spd = Math.max(0, ac.spd - 0.25);
        return o;
      }
    }
    return null;
  }
  rwyOf(o) {
    if (o.phase === P.ROLL) return this.ap.ends[o.end]?.rwy;
    if (o.depEnd) return this.ap.ends[o.depEnd]?.rwy;
    return null;
  }
  parkArrival(ac) {
    const st = ac.stand;
    ac.phase = P.STAND;
    ac.x = st.x;
    ac.y = st.y;
    ac.hdg = st.hdg;
    ac.spd = 0;
    ac.path = null;
    ac.onRwz = null;
    // Umlauf: wird später ein Abflug mit neuer Flugnummer
    const turn = (TURN[ac.size] || 55) * 60 * (0.85 + this.r() * 0.5);
    ac.kind = 'dep';
    ac.tobt = this.t + turn;
    ac.num = ac.num + 1;
    ac.cs = `${ac.airline}${ac.num}`;
    ac.tel = `${AIRLINES[ac.airline].tel} ${ac.num}`;
    ac.vacated = false;
    ac.exit = null;
    ac.end = null;
    ac.landClr = false;
    ac.checked = false;
  }

  // ---------------------------------------------------------------- Abflug
  chooseDepEnd(ac) {
    const ends = this.cfg.dep;
    let best = null;
    for (const e of ends) {
      const end = this.ap.ends[e];
      const r = findRoute(this.ap, ac.stand.node, end.entries.map((x) => x.hold));
      if (!r) continue;
      let len = 0;
      for (const x of r) len += this.ap.edges[x.e].len + (this.ap.edges[x.e].kind === 'rwz' ? 60 : 0);
      const q = this.acs.filter((a) => a.depEnd === e && [P.TAXI_OUT, P.HOLD, P.LINEUP, P.LINED].includes(a.phase)).length;
      const score = len + q * 35;
      if (!best || score < best.score) best = { e, score, r };
    }
    return best;
  }
  useEdge(k, ac, dir) {
    if (!this.edgeUse.has(k)) this.edgeUse.set(k, []);
    this.edgeUse.get(k).push({ ac, dir });
  }
  // A-CDM: je Startbahn nur eine begrenzte Schlange – der Rest wartet mit abgeschalteten Triebwerken an der Position
  depSlot(ac) {
    // Route nur neu suchen, wenn sich die Betriebsrichtung geändert hat
    if (!ac.pre || ac.preCfg !== this.cfg.id) {
      ac.pre = this.chooseDepEnd(ac);
      ac.preCfg = this.cfg.id;
    }
    const best = ac.pre;
    if (!best) return false;
    const q = this.acs.filter((a) => a.depEnd === best.e && [P.PUSH, P.START, P.TAXI_OUT, P.HOLD, P.LINEUP, P.LINED].includes(a.phase)).length;
    if (q >= (this.ap.depQueue || 6)) {
      ac.tsatHold = true;
      return false;
    }
    ac.tsatHold = false;
    return true;
  }
  laneClear(ac) {
    const st = ac.stand;
    const a = this.ap.nodes[st.node];
    for (const o of this.movers) {
      if (o === ac) continue;
      if (dist(o, a) < (o.phase === P.PUSH ? 12 : 9)) return false;
    }
    // niemand auf der Gasse unterwegs oder angemeldet
    for (const eid of this.ap.lines[st.lane].edgeIds) if ((this.edgeUse.get(eid) || []).some((u) => u.ac !== ac)) return false;
    // niemand rollt in Kürze an der Position vorbei
    for (const o of this.movers) {
      if (o === ac || o.stand === st || !o.path || o.s == null) continue;
      for (const sg of o.path.segs) {
        if (sg.s1 < o.s) continue;
        if (sg.s0 > o.s + 30) break;
        if (sg.from === st.node || sg.to === st.node) return false;
      }
    }
    void a;
    return true;
  }
  startPush(ac) {
    const best = ac.pre || this.chooseDepEnd(ac);
    ac.pre = null;
    if (!best) {
      ac.tobt = this.t + 300;
      return;
    }
    ac.depEnd = best.e;
    ac.route = best.r;
    ac.phase = P.PUSH;
    ac.req = null;
    ac.pushFrom = { x: ac.x, y: ac.y };
    ac.pushTo = { x: this.ap.nodes[ac.stand.node].x, y: this.ap.nodes[ac.stand.node].y };
    ac.pushT = 0;
    ac.prio = ++this.prio;
    for (const eid of this.ap.lines[ac.stand.lane].edgeIds) this.useEdge(eid, ac, 0);
    // Position wird frei, sobald das Flugzeug draußen ist
    this.radio(this.ap.tower.replace('Tower', 'Ground'), `${ac.tel}, pushback and start-up approved, expect runway ${ac.depEnd}`, 'atc', ac);
    if (this.manualGround) this.radio(ac.tel, `Pushback and start-up approved, expect runway ${ac.depEnd}, ${ac.tel}`, 'pilot', ac);
  }
  updatePush(ac, dt) {
    const L = dist(ac.pushFrom, ac.pushTo);
    if (ac.pushT < L) {
      ac.pushT = Math.min(L, ac.pushT + V_PUSH * dt);
      const t = ac.pushT / L;
      ac.x = ac.pushFrom.x + (ac.pushTo.x - ac.pushFrom.x) * t;
      ac.y = ac.pushFrom.y + (ac.pushTo.y - ac.pushFrom.y) * t;
      ac.spd = V_PUSH;
      ac.pushing = true;
      return;
    }
    // Ausrichten zur Rollrichtung (Schlepper dreht das Flugzeug)
    if (!ac.taxiPath) {
      ac.taxiPath = pathFromRoute(this.ap, ac.route, null);
      this.standBusy.delete(ac.stand.id);
    }
    const p = ac.taxiPath;
    const tgt = pathAt(p, 2.5);
    const h = Math.atan2(tgt.y - ac.y, tgt.x - ac.x);
    const dh = angNorm(h - ac.hdg);
    if (Math.abs(dh) > 0.04) {
      ac.hdg += Math.max(-0.35 * dt, Math.min(0.35 * dt, dh));
      ac.spd = 0.02;
      return;
    }
    ac.pushing = false;
    ac.spd = 0;
    ac.phase = P.START;
    ac.startT = this.t + 35 + this.r() * 25;
  }
  beginTaxiOut(ac) {
    ac.phase = P.TAXI_OUT;
    ac.req = null;
    this.setPath(ac, ac.taxiPath, 0);
    ac.taxiPath = null;
    ac.taxiStart = this.t;
    ac.nomTaxi = ac.path.total / 0.5 + 150;
    this.radio(this.ap.tower.replace('Tower', 'Ground'), `${ac.tel}, taxi to holding point runway ${ac.depEnd}`, 'atc', ac);
    if (this.manualGround) this.radio(ac.tel, `Taxi to holding point runway ${ac.depEnd}, ${ac.tel}`, 'pilot', ac);
  }
  // am Rollhalt: Aufrollen und Start
  lineupPath(ac) {
    const end = this.ap.ends[ac.depEnd];
    const ent = end.entries[0];
    const line = this.ap.lines[ent.line];
    const edges = this.ap.edges.filter((e) => e.line === line.i);
    const route = [];
    let cur = ent.hold;
    const rnN = this.ap.nodes[ent.rn];
    for (let g = 0; g < 6 && cur !== ent.rn; g++) {
      // Kante, die zur Bahn hin führt
      const cand = edges.filter((x) => (x.a === cur || x.b === cur) && !route.some((r) => r.e === x.id));
      const e = cand.sort((p, q) => dist(this.ap.nodes[p.a === cur ? p.b : p.a], rnN) - dist(this.ap.nodes[q.a === cur ? q.b : q.a], rnN))[0];
      if (!e) break;
      const dir = e.a === cur ? 1 : -1;
      route.push({ e: e.id, dir });
      cur = dir === 1 ? e.b : e.a;
    }
    const rn = this.ap.nodes[ent.rn];
    const p1 = add(rn, mul(end.dir, 3.5));
    const p2 = add(rn, mul(end.dir, 6));
    return pathFromRoute(this.ap, route, { x: ac.x, y: ac.y }, { append: [p1, p2], r: 2.2 });
  }
  lineUp(ac, andGo = false) {
    if (ac.phase !== P.HOLD) return;
    ac.phase = P.LINEUP;
    ac.req = null;
    ac.tkClr = andGo;
    const lp = this.lineupPath(ac);
    this.setPath(ac, lp, 0);
    ac.stops = [];
  }
  takeoff(ac) {
    const end = this.ap.ends[ac.depEnd];
    ac.phase = P.TKOF;
    ac.req = null;
    ac.tkS = dot(sub(ac, end.thr), end.dir);
    ac.tkStart = this.t;
    ac.hdg = end.hdg;
    ac.vr = vrOf(ac);
    ac.acc = accOf(ac);
    // Wirbelschleppen-Abstand zum letzten Start
    const lt = this.lastTk[end.rwy];
    if (lt && this.t - lt.t < DEP_SEP[lt.wake][ac.wake] - 5) {
      this.stats.wake++;
      this.event('wake', `${Math.round(this.t - lt.t)}|${DEP_SEP[lt.wake][ac.wake]}`, ac);
    }
    this.lastTk[end.rwy] = { t: this.t, wake: ac.wake, ac: ac.id };
  }
  updateTakeoff(ac, dt) {
    const end = this.ap.ends[ac.depEnd];
    const ground = ac.z < 0.05;
    if (ground) {
      const o = this.rollAhead(ac, end.rwy);
      if (o && ac.spd < ac.vr * 0.8 && !ac.rto) {
        // Startabbruch
        ac.rto = true;
        this.radio(ac.tel, `${ac.tel}, stopping`, 'pilot', ac);
      }
    }
    if (ac.rto) {
      ac.spd = Math.max(0, ac.spd - 0.12 * dt);
      ac.tkS += ac.spd * dt;
      if (ac.spd <= 0.01) {
        // zurück zum Rollhalt: neu anstellen (vereinfacht: wieder aufgestellt)
        ac.rto = false;
        ac.phase = P.LINED;
        ac.req = 'takeoff';
        ac.tReq = this.t;
        ac.tkClr = false;
      }
    } else {
      ac.spd += ac.acc * dt * (ac.spd > ac.vr ? 0.6 : 1);
      ac.spd = Math.min(ac.spd, 200 * KT);
      ac.tkS += ac.spd * dt;
      if (ac.spd >= ac.vr) {
        if (!ac.rotS) ac.rotS = ac.tkS;
        ac.z = (ac.tkS - ac.rotS) * 0.085;
      }
    }
    ac.x = end.thr.x + end.dir.x * ac.tkS;
    ac.y = end.thr.y + end.dir.y * ac.tkS;
    ac.hdg = end.hdg;
    ac.onRwz = ac.z < 0.3 ? end.rwy : null;
    if (ac.z > 0.3 && ac.phase === P.TKOF) {
      ac.phase = P.CLIMB;
      this.radio(this.ap.tower, `${ac.tel}, contact departure, goodbye`, 'atc', ac);
    }
  }
  updateClimb(ac, dt) {
    const end = this.ap.ends[ac.depEnd];
    ac.spd = Math.min(ac.spd + 1.5 * KT * dt, 230 * KT);
    ac.tkS += ac.spd * dt;
    ac.z += ac.spd * dt * 0.075;
    ac.x = end.thr.x + end.dir.x * ac.tkS;
    ac.y = end.thr.y + end.dir.y * ac.tkS;
    if (ac.tkS > end.len + 3 * NM) {
      ac.phase = P.GONE;
      this.stats.dep++;
      this.stats.depDelay += Math.max(0, ac.tkStart - (ac.tobt + (ac.nomTaxi || 400)));
    }
  }

  // ---------------------------------------------------------------- Bahnbelegung und Konflikte
  // Flugzeuge, die eine Bahn gerade belegen (für Landungen)
  occupants(rwyId, except = null) {
    const out = [];
    const r = this.ap.rwyById[rwyId];
    for (const o of this.acs) {
      if (o === except) continue;
      if (o.phase === P.ROLL && this.ap.ends[o.end].rwy === rwyId && !o.vacated) out.push(o);
      else if ((o.phase === P.LINED || o.phase === P.LINEUP) && this.ap.ends[o.depEnd].rwy === rwyId && (o.phase === P.LINED || o.onRwz === rwyId)) out.push(o);
      else if (o.phase === P.TKOF && this.ap.ends[o.depEnd].rwy === rwyId && o.z < 0.2 && o.tkS < r.len * 0.55) out.push(o);
      else if ((o.onRwz === rwyId || o.crossRwy === rwyId) && o.phase !== P.TKOF && o.phase !== P.ROLL && o.z < 0.2) out.push(o);
    }
    // kreuzende Bahnen: Verkehr nahe am Kreuzungspunkt
    for (const x of this.rwyX) {
      if (x.a !== rwyId && x.b !== rwyId) continue;
      const other = x.a === rwyId ? x.b : x.a;
      for (const o of this.acs) {
        if (o === except || o.z > 0.3) continue;
        const busy = (o.phase === P.ROLL && this.ap.ends[o.end].rwy === other && !o.vacated) || ((o.phase === P.TKOF || o.phase === P.LINED) && this.ap.ends[o.depEnd]?.rwy === other);
        if (!busy) continue;
        const d = dist(o, x.p);
        const toward = dot(sub(x.p, o), { x: Math.cos(o.hdg), y: Math.sin(o.hdg) }) > 0;
        if (d < 6 || (toward && d < 120 && (o.phase !== P.LINED || o.tkClr))) out.push(o);
      }
    }
    return out;
  }
  conflict(a, b, kind) {
    const key = `${Math.min(a.id, b.id)}|${Math.max(a.id, b.id)}`;
    if (this.conflictKeys.has(key)) return;
    this.conflictKeys.add(key);
    this.stats.conf++;
    this.event('conflict', kind, a);
  }
  // Abstände in der Luft und Überflug kreuzender Bahnen werden über occupants() geprüft; am Boden Berührungen
  groundSafety() {
    const g = this.movers;
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        const d = dist(a, b);
        const min = (a.len + b.len) * 0.28;
        if (d < min && (a.spd > 0.4 || b.spd > 0.4)) {
          const key = `g${Math.min(a.id, b.id)}|${Math.max(a.id, b.id)}`;
          if (!this.conflictKeys.has(key)) {
            this.conflictKeys.add(key);
            this.stats.groundTouch = (this.stats.groundTouch || 0) + 1;
          }
        }
      }
  }

  // ---------------------------------------------------------------- Freigaben (Spieler oder KI)
  clearLand(ac) {
    if (ac.phase !== P.FIN && ac.phase !== P.APP) return false;
    ac.landClr = true;
    ac.req = null;
    this.radio(this.ap.tower, `${ac.tel}, ${this.windStr()}, runway ${ac.end}, cleared to land`, 'atc', ac);
    this.radio(ac.tel, `Cleared to land runway ${ac.end}, ${ac.tel}`, 'pilot', ac);
    return true;
  }
  orderGoAround(ac) {
    if (ac.phase !== P.FIN && ac.phase !== P.APP) return false;
    this.radio(this.ap.tower, `${ac.tel}, go around, I say again, go around`, 'atc', ac);
    this.goAround(ac, 'atc');
    return true;
  }
  clearLineup(ac) {
    if (ac.phase !== P.HOLD) return false;
    this.radio(this.ap.tower, `${ac.tel}, runway ${ac.depEnd}, line up and wait`, 'atc', ac);
    this.radio(ac.tel, `Line up and wait runway ${ac.depEnd}, ${ac.tel}`, 'pilot', ac);
    this.lineUp(ac, false);
    return true;
  }
  clearTakeoff(ac) {
    if (ac.phase !== P.HOLD && ac.phase !== P.LINED && ac.phase !== P.LINEUP) return false;
    this.radio(this.ap.tower, `${ac.tel}, ${this.windStr()}, runway ${ac.depEnd}, cleared for take-off`, 'atc', ac);
    this.radio(ac.tel, `Cleared for take-off runway ${ac.depEnd}, ${ac.tel}`, 'pilot', ac);
    ac.tkAt = this.t;
    if (ac.phase === P.HOLD) this.lineUp(ac, true);
    else ac.tkClr = true; // aufgestellt: rollt los, sobald die Rücklesung zu hören war
    ac.req = null;
    return true;
  }
  // Startlauf erst, wenn Freigabe und Rücklesung auf der Frequenz zu hören waren (höchstens eine Minute)
  readyToRoll(ac) {
    return this.t - (ac.tkAt ?? -1e9) >= 60 || !speech.pending(ac.tel);
  }
  clearCross(ac) {
    if (ac.req !== 'cross' || !ac.reqStop) return false;
    const rw = this.ap.rwyById[ac.reqRwy];
    ac.reqStop.clr = true;
    ac.req = null;
    ac.crossRwy = ac.reqRwy;
    const segs = ac.path.segs;
    let k = segs.indexOf(ac.reqStop.seg);
    while (k < segs.length && segs[k].kind === 'rwz' && segs[k].rwy === ac.reqRwy) k++;
    ac.crossOut = k < segs.length ? segs[k].s0 : ac.path.total;
    this.stats.cross++;
    this.radio(this.ap.tower, `${ac.tel}, cross runway ${rw.ends.join('/')}`, 'atc', ac);
    this.radio(ac.tel, `Crossing runway ${rw.ends.join('/')}, ${ac.tel}`, 'pilot', ac);
    return true;
  }
  approvePush(ac) {
    if (ac.req !== 'push') return false;
    this.startPush(ac);
    return true;
  }
  approveTaxi(ac) {
    if (ac.req !== 'taxi') return false;
    this.beginTaxiOut(ac);
    return true;
  }
  // Betriebsrichtung wechseln
  setConfig(id, why = 'player') {
    const c = this.ap.configs.find((x) => x.id === id);
    if (!c || c === this.cfg) return;
    const old = this.cfg;
    this.cfg = c;
    this.event('config', why, null);
    // Anflüge weit draußen auf die neuen Landebahnen, nahe dran landen wie geplant
    for (const ac of this.acs) {
      if ((ac.phase === P.APP || ac.phase === P.FIN) && ac.dfin > 6 * NM && !c.arr.includes(ac.end)) {
        ac.end = this.chooseArrEnd(ac);
        ac.landClr = false;
        ac.req = ac.phase === P.FIN ? 'land' : null;
        this.placeOnFinal(ac);
      }
    }
    for (const b of this.backlog) if (b.flight) b.flight.end = null;
    // Abflüge zur neuen Startbahn umleiten
    for (const ac of this.acs) {
      if (ac.kind !== 'dep' || !ac.depEnd || c.dep.includes(ac.depEnd)) continue;
      if (ac.phase === P.TAXI_OUT || ac.phase === P.HOLD) this.reroute(ac);
    }
    void old;
  }
  reroute(ac) {
    // nächster Knoten voraus auf dem Pfad als Start
    const sg = this.segAt(ac);
    if (!sg) return;
    const from = sg.to;
    let best = null;
    for (const e of this.cfg.dep) {
      const end = this.ap.ends[e];
      const r = findRoute(this.ap, from, end.entries.map((x) => x.hold));
      if (!r) continue;
      const len = r.reduce((s, x) => s + this.ap.edges[x.e].len, 0);
      if (!best || len < best.len) best = { e, r, len };
    }
    if (!best) return;
    const head = [{ e: sg.e, dir: sg.dir }];
    const path = pathFromRoute(this.ap, [...head, ...best.r], { x: ac.x, y: ac.y });
    ac.depEnd = best.e;
    ac.phase = P.TAXI_OUT;
    ac.req = null;
    this.setPath(ac, path, 0);
  }

  // ---------------------------------------------------------------- KI-Tower (optional je Bereich)
  nextArrival(rwyId) {
    let best = null;
    for (const a of this.acs) {
      if ((a.phase === P.FIN || a.phase === P.APP) && this.ap.ends[a.end]?.rwy === rwyId && (!best || a.dfin < best.dfin)) best = a;
    }
    return best;
  }
  // Zeit (s), bis ein Flugzeug die Bahn verlassen hat bzw. abgehoben ist
  clearTime(o) {
    if (o.crossRwy) return Math.max(0, (o.crossOut ?? o.s + 12) - o.s + o.len * 0.5) / Math.max(0.35, o.spd) + 3;
    if (o.phase === P.ROLL && !o.vacated) return Math.max(0, (o.vacS - o.s) / Math.max(0.8, o.spd * 0.7)) + 2;
    if (o.phase === P.TKOF) return o.z > 0.05 ? 0 : Math.max(0, (o.vr - o.spd) / o.acc) + 3;
    if (o.phase === P.LINED && o.tkClr) return tkTime(o) + 2;
    return Infinity;
  }
  autoLand(ac) {
    if (ac.dfin > 4.5 * NM) return;
    const rw = this.ap.ends[ac.end].rwy;
    const tArr = Math.max(0, ac.dfin - DECIDE) / Math.max(ac.spd, 1);
    const occ = this.occupants(rw, ac);
    // alles, was jetzt auf der Bahn ist, muss vor dem Entscheidungspunkt weg sein
    if (occ.some((o) => this.clearTime(o) > tArr - 6)) return;
    if (this.acs.some((o) => o.onRwz === rw && o.phase !== P.ROLL && o.phase !== P.TKOF && o.z < 0.2 && o !== ac)) return;
    this.clearLand(ac);
  }
  depOk(ac, rw) {
    // Bahn frei, nächste Landung weit genug weg, Wirbelschleppen-Zeit vorbei
    const end = this.ap.ends[ac.depEnd];
    if (this.occupants(rw, ac).some((o) => !(o.phase === P.TKOF && o.tkS > (ac.tkS0 || 0) + 40))) return false;
    const na = this.nextArrival(rw);
    // Zeit bis zum Abheben (je nach Größe 50–75 s), vom Rollhalt aus plus Aufrollen
    const need = tkTime(ac) + (ac.phase === P.LINED ? 8 : 40);
    if (na && na.dfin / Math.max(1, na.spd) < need) return false;
    const lt = this.lastTk[rw];
    if (lt && this.t - lt.t < DEP_SEP[lt.wake][ac.wake]) return false;
    // kreuzender Verkehr gerade auf der Bahn
    if (this.acs.some((o) => (o.onRwz === rw || o.crossRwy === rw) && o !== ac && o.phase !== P.TKOF)) return false;
    void end;
    return true;
  }
  // Aufrollen erlaubt: niemand anderes aufgestellt, keine Landung in den nächsten Minuten, Bahn höchstens von einem
  // abfliegenden Flugzeug belegt
  lineupOk(ac, rw) {
    if (this.acs.some((o) => o !== ac && (o.phase === P.LINED || o.phase === P.LINEUP) && this.ap.ends[o.depEnd].rwy === rw)) return false;
    const na = this.nextArrival(rw);
    // nur aufrollen, wenn der Start auch bald gehen kann (Wirbelschleppen-Zeit, nächste Landung)
    const lt = this.lastTk[rw];
    const wakeLeft = lt ? Math.max(0, DEP_SEP[lt.wake][ac.wake] - (this.t - lt.t)) : 0;
    // „hinter der Landung aufrollen“: eine Landung in gleicher Richtung, die schon aufgesetzt hat, rollt von der
    // Schwelle weg – aufrollen ja, Startfreigabe erst, wenn sie die Bahn verlassen hat
    let behind = 0;
    for (const o of this.acs) {
      if (o.phase !== P.ROLL || this.ap.ends[o.end].rwy !== rw || o.vacated) continue;
      if (o.end !== ac.depEnd || o.s < TD + 10) return false;
      behind = Math.max(behind, this.clearTime(o));
    }
    if (na && na.dfin / Math.max(1, na.spd) < Math.max(25, behind) + tkTime(ac) + 12 + wakeLeft) return false;
    if (this.acs.some((o) => o !== ac && (o.onRwz === rw || o.crossRwy === rw) && o.phase !== P.TKOF && o.phase !== P.ROLL && o.z < 0.2)) return false;
    return true;
  }
  // Kreuzen: keine Landung in den nächsten ~50 s, kein Startlauf, und hinter der Bahn ist Platz
  crossOk(ac) {
    const rw = ac.reqRwy;
    const na = this.nextArrival(rw);
    if (na && na.dfin / Math.max(na.spd, 1) < 55) return false;
    const st = ac.reqStop;
    const xn = this.ap.nodes[st.seg.dir === 1 ? st.seg.to : st.seg.from];
    const rwNode = this.ap.nodes[st.seg.to].kind === 'rwy' ? this.ap.nodes[st.seg.to] : xn;
    const passed = (o) => {
      const h = { x: Math.cos(o.hdg), y: Math.sin(o.hdg) };
      const ahead = dot(sub(rwNode, o), h);
      if (ahead < -(o.len * 0.6 + 3)) return true;
      // Landung, die vor der Kreuzung abrollt, stört nicht
      if (o.phase === P.ROLL && o.exit) {
        const end = this.ap.ends[o.end];
        const sx = dot(sub(rwNode, end.thr), end.dir);
        if (o.exit.s < sx - 6) return true;
      }
      return false;
    };
    if (this.acs.some((o) => o !== ac && ((o.phase === P.TKOF && o.z < 0.3 && this.ap.ends[o.depEnd].rwy === rw && !passed(o)) || (o.phase === P.ROLL && this.ap.ends[o.end].rwy === rw && !o.vacated && !passed(o)) || ((o.phase === P.LINED || o.phase === P.LINEUP) && o.tkClr && this.ap.ends[o.depEnd].rwy === rw) || (o.crossRwy === rw)))) return false;
    // Platz hinter dem Rollhalt auf der anderen Seite
    const segs = ac.path.segs;
    let k = segs.indexOf(st.seg);
    while (k < segs.length && segs[k].kind === 'rwz' && segs[k].rwy === rw) k++;
    const sOut = k < segs.length ? segs[k].s0 : ac.path.total;
    const pOut = pathAt(ac.path, sOut + ac.len * 0.5);
    for (const o of this.movers) if (o !== ac && dist(o, pOut) < ac.len * 0.6 + o.len * 0.5 + 0.8) return false;
    return true;
  }
  autoTower() {
    for (const ac of this.acs) {
      if (this.auto.dep && ac.req && (ac.phase === P.HOLD || ac.phase === P.LINED)) {
        const rw = this.ap.ends[ac.depEnd].rwy;
        if (this.depOk(ac, rw)) this.clearTakeoff(ac);
        else if (ac.phase === P.HOLD && this.lineupOk(ac, rw)) this.clearLineup(ac);
      }
      if (this.auto.cross && ac.req === 'cross' && this.crossOk(ac)) this.clearCross(ac);
    }
  }

  // ---------------------------------------------------------------- Takt
  update(dt) {
    if (this.done) return;
    const steps = Math.max(1, Math.ceil(dt / 0.25));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h);
  }
  step(dt) {
    this.t += dt;
    // Bahnwechsel (Kingsmoor: 15 Uhr)
    const alt = this.ap.alternate;
    if (alt && alt.pairs[this.cfg.id] && !this.altDone && this.t >= Math.floor(this.t0 / 86400) * 86400 + alt.at * 3600 && this.t0 < Math.floor(this.t0 / 86400) * 86400 + alt.at * 3600) {
      this.altDone = true;
      this.setConfig(alt.pairs[this.cfg.id], 'alternate');
    }
    if (this.planUntil < this.t + 3600) this.planAhead(this.t + 3600 * 1.5);
    this.spawnArrivals();
    this.byId = new Map(this.acs.map((a) => [a.id, a]));
    this.movers = this.acs.filter((a) => a.z < 0.3 && a.phase !== P.STAND && a.phase !== P.APP && a.phase !== P.FIN && a.phase !== P.GA && a.phase !== P.CLIMB);
    // Kantenbelegung (Gegenverkehr)
    this.edgeUse.clear();
    const use = (k, ac, dir) => this.useEdge(k, ac, dir);
    for (const a of this.movers) {
      // Pushback und Triebwerksstart sperren die Gasse in beide Richtungen
      if ((a.phase === P.PUSH || a.phase === P.START) && a.stand) {
        for (const eid of this.ap.lines[a.stand.lane].edgeIds) use(eid, a, 0);
        continue;
      }
      if (a.resv) {
        a.resv = a.resv.filter((r) => r.s1 > a.s);
        for (const r of a.resv) use(r.e, a, r.dir);
        if (!a.resv.length) a.resv = null;
      }
      if (!a.path || !a.seg) continue;
      use(a.seg.e, a, a.seg.dir);
    }
    for (const ac of [...this.acs]) {
      switch (ac.phase) {
        case P.APP:
        case P.FIN:
          this.updateApproach(ac, dt);
          break;
        case P.GA:
          this.updateGoAround(ac, dt);
          break;
        case P.ROLL:
        case P.TAXI_IN:
          this.updateRoll(ac, dt);
          break;
        case P.STAND:
          if (ac.kind === 'dep' && ac.tobt != null && this.t >= ac.tobt && this.t < this.tEnd + 600) {
            if (this.manualGround) {
              if (ac.req !== 'push') {
                ac.req = 'push';
                ac.tReq = this.t;
                this.radio(ac.tel, `${this.ap.tower.replace('Tower', 'Ground')}, ${ac.tel}, stand ${ac.stand.name}, request pushback`, 'pilot', ac);
              }
            } else if (this.laneClear(ac) && this.depSlot(ac)) this.startPush(ac);
          }
          break;
        case P.PUSH:
          this.updatePush(ac, dt);
          break;
        case P.START:
          if (this.t >= ac.startT) {
            if (this.manualGround) {
              if (ac.req !== 'taxi') {
                ac.req = 'taxi';
                ac.tReq = this.t;
                this.radio(ac.tel, `${this.ap.tower.replace('Tower', 'Ground')}, ${ac.tel}, request taxi`, 'pilot', ac);
              }
            } else this.beginTaxiOut(ac);
          }
          break;
        case P.TAXI_OUT: {
          const done = this.moveTaxi(ac, dt, V_TAXI, false, ac.len * 0.5);
          if (done) {
            ac.phase = P.HOLD;
            ac.spd = 0;
            ac.req = 'lineup';
            ac.tReq = this.t;
            const end = this.ap.ends[ac.depEnd];
            this.radio(ac.tel, `${this.ap.tower}, ${ac.tel}, holding point ${end.entries[0].name}, runway ${ac.depEnd}, ready for departure`, 'pilot', ac);
          }
          break;
        }
        case P.LINEUP: {
          const done = this.moveTaxi(ac, dt, 0.32);
          ac.onRwz = this.ap.ends[ac.depEnd].rwy;
          if (done) {
            ac.spd = 0;
            if (ac.tkClr && this.readyToRoll(ac)) this.takeoff(ac);
            else if (ac.tkClr) ac.phase = P.LINED;
            else {
              ac.phase = P.LINED;
              ac.req = 'takeoff';
              ac.tReq = this.t;
            }
          } else if (ac.tkClr && ac.path.total - ac.s < 1.5 && this.readyToRoll(ac)) {
            this.takeoff(ac);
          }
          if (ac.phase === P.LINEUP && !ac.tkClr && this.auto.dep) {
            /* wartet aufgestellt */
          }
          break;
        }
        case P.LINED:
          ac.onRwz = this.ap.ends[ac.depEnd].rwy;
          if (ac.tkClr && this.t - (ac.tkAt ?? -1e9) >= 3 && this.readyToRoll(ac)) this.takeoff(ac);
          break;
        case P.TKOF:
          this.updateTakeoff(ac, dt);
          break;
        case P.CLIMB:
          this.updateClimb(ac, dt);
          break;
      }
    }
    this.acs = this.acs.filter((a) => a.phase !== P.GONE);
    if (this.auto.dep || this.auto.cross) this.autoTower();
    this.groundSafety();
    if (this.t >= this.tEnd) {
      this.done = true;
      this.event('end', '', null);
    }
  }

  // ---------------------------------------------------------------- für die Oberfläche
  requests() {
    return this.acs.filter((a) => a.req).sort((a, b) => (a.tReq || 0) - (b.tReq || 0));
  }
  get movements() {
    return this.stats.arr + this.stats.dep;
  }
}

export { NM, KT };
