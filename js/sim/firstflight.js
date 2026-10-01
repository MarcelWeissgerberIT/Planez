// Erstflug mit Wassertaufe: Die erste Landung einer neu unterschriebenen Strecke wird gefeiert – zwei Löschfahrzeuge
// der Flughafenfeuerwehr stellen sich beidseits des Rollwegs auf und schießen einen Wasserbogen, durch den das
// Flugzeug zur Position rollt. Bringt etwas Ansehen, eine Schlagzeile im Kurier und Jubel im Livestream.
import { PH, tel } from './aircraft.js';
import { AIRLINES, CITIES } from '../config.js';
import { radio, log, notify } from './messages.js';
import { clamp } from '../util.js';
import { pushNews } from './news.js';
import { T } from '../i18n.js';

// Bogenpunkt: ein langes gerades Stück auf der Vorfeld-Rollgasse (der Pfad ist dicht abgetastet), das noch vor dem
// Flugzeug liegt – dort ist links und rechts Platz für die Löschfahrzeuge
function pickPoint(ac) {
  let best = null, run = null;
  const P = ac.path;
  const close = () => {
    if (run && run.L >= 4 && (!best || run.L > best.L)) best = run;
    run = null;
  };
  for (let i = Math.max(0, ac.pi || 0); i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const flat = Math.abs(b.y - a.y) < 0.03 && a.y > 21 && a.y < 26;
    if (!flat) {
      close();
      continue;
    }
    if (!run) run = { x0: a.x, y: a.y, L: 0, dir: Math.sign(b.x - a.x) };
    run.x1 = b.x;
    run.L = Math.abs(run.x1 - run.x0);
  }
  close();
  if (!best) return null;
  return { x: (best.x0 + best.x1) / 2, y: best.y, hdg: best.dir < 0 ? Math.PI : 0, L: best.L };
}

export function updateFirstFlight(state) {
  const S = state.salute;
  if (S) {
    const ac = state.acs.find((a) => a.id === S.ac);
    if (!ac || state.time > S.until || ac.phase === PH.STAND) {
      state.salute = null;
      return;
    }
    if (!S.p && ac.phase === PH.TAXI_IN && ac.path) {
      S.p = pickPoint(ac);
      if (!S.p) state.salute = null; // kein Platz auf dem Weg – der nächste Flug der Strecke bekommt die Taufe
      else {
        const c = state.contracts.find((x) => x.id === S.contract);
        if (c) c.firstFlight = false;
        state.saluteLast = { airline: S.airline, city: S.city };
        const city = CITIES[S.city] ? CITIES[S.city].name : '…';
        radio(state, 'TWR', T`${tel(ac)}, welcome to Planez on your first flight from ${city}, the fire brigade has a little surprise for you on the way in.`, 'atc');
        radio(state, ac.cs, `Thank you very much, we'll enjoy it, ${tel(ac)}.`, 'pilot');
        notify(state, T`💦 Erstflug: ${AIRLINES[S.airline].name} aus ${city} – die Feuerwehr gibt die Wassertaufe`, 'good');
        S.off = Math.max(1.7, ac.len * 0.6 + 0.4);
        if (state.role === 'ground') log(state, 'crew', T`Vorfeld, Feuerwehr, zwei Löschfahrzeuge in Position für die Wassertaufe von ${ac.cs}.`, T('Feuerwehr'), { prio: 2 });
      }
      return;
    }
    if (S.p && !S.done && Math.hypot(ac.x - S.p.x, ac.y - S.p.y) < 0.7) {
      S.done = true;
      const L = state.life || (state.life = {});
      L.salutes = (L.salutes || 0) + 1;
      state.reputation = clamp(state.reputation + 0.5, 0, 100);
      pushNews(state, CITIES[S.city] ? T`Neue Verbindung: ${AIRLINES[S.airline].name} fliegt jetzt nach ${CITIES[S.city].name} – Erstflug mit Wassertaufe begrüßt.` : T`Neue Verbindung: ${AIRLINES[S.airline].name} fliegt jetzt neu – Erstflug mit Wassertaufe begrüßt.`, 'good', '💦');
      log(state, 'sys', T`💦 Wassertaufe für ${ac.cs}: Der Erstflug von ${AIRLINES[S.airline].name} aus ${CITIES[S.city] ? CITIES[S.city].name : '…'} rollt durch den Wasserbogen der Feuerwehr.`);
    }
    return;
  }
  for (const ac of state.acs) {
    if (ac.mode !== 'map' || ac.phase !== PH.ROLLOUT || ac.saluteChk) continue;
    ac.saluteChk = true;
    const rot = state.rots[ac.rot];
    const c = rot && rot.contract && state.contracts.find((x) => x.id === rot.contract);
    if (!c || !c.firstFlight) continue;
    // Sportflieger und Partner am kleinen Platz (Flugschule, Rundflug, Lufttaxi …) bekommen keine Wassertaufe
    const al = AIRLINES[rot.airline];
    if (al && (al.ga || al.partner)) {
      c.firstFlight = false;
      continue;
    }
    state.salute = { ac: ac.id, contract: c.id, t: state.time, until: state.time + 40 * 60, p: null, done: false, city: rot.city, airline: rot.airline };
    return;
  }
}

// Darstellung: Position der beiden Löschfahrzeuge und ob gerade gespritzt wird
export function saluteView(state) {
  const S = state.salute;
  if (!S || !S.p) return null;
  const ac = state.acs.find((a) => a.id === S.ac);
  const nx = -Math.sin(S.p.hdg), ny = Math.cos(S.p.hdg);
  const trucks = [-1, 1].map((sg) => {
    const x = S.p.x + nx * S.off * sg, y = S.p.y + ny * S.off * sg;
    return { x, y, hdg: Math.atan2(S.p.y - y, S.p.x - x), st: 'salute' };
  });
  const d = ac ? Math.hypot(ac.x - S.p.x, ac.y - S.p.y) : 99;
  return { p: S.p, trucks, spray: d < 7 && !(S.done && d > 3) };
}
