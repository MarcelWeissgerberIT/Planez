// Flughafenpolizei auf dem Vorfeld (ab dem Regionalflughafen): Ein Streifenwagen steht am Polizeiposten östlich des
// Terminals, fährt in Abständen die Servicestraße ab, hält in den Buchten zwischen den Fluggastbrücken (Präsenz,
// Kontrolle – manchmal mit Blaulicht) und kehrt zum Posten zurück. Er hält Abstand wie die Abfertigungsfahrzeuge, und
// diese halten Abstand zu ihm (siehe headway in ground.js).
import * as LY from '../layout.js';
import { moveAlong } from './ground.js';

const POST = { x: 53.2, y: 14.2, hdg: Math.PI };
// eigener Zufall (verschiebt die übrigen Zufallsereignisse des Spiels nicht)
const rnd = (P) => (P.seed = (P.seed * 16807) % 2147483647) / 2147483647;
const range = (P, a, b) => a + rnd(P) * (b - a);
const SPEED = 0.27;
// Buchten nördlich der Servicestraße, zwischen den Fluggastbrücken der gebauten Positionen am Terminal
function bays(state) {
  const out = state.stands.filter((s) => s.built && s.kind === 'contact' && s.x + 1.9 < LY.TERMINAL.x1 - 0.4).map((s) => ({ x: s.x + 1.9, y: LY.SERVICE - 0.42 }));
  return out.length ? out : [{ x: 50.6 - 1.4, y: LY.SERVICE - 0.42 }];
}
function go(state, c, to) {
  c.path = LY.vehPath({ x: c.x, y: c.y }, to);
  c.pi = 0;
  c.st = 'drive';
  c.toPost = to === POST; // als Merker (Spielstände speichern Kopien)
}

export function updatePatrol(state, dt) {
  if (LY.GEO.stage < 2) {
    state.patrol = null;
    return;
  }
  if (!state.patrol) state.patrol = { seed: ((state.seed || 1) % 2147483646) + 1, cars: [{ id: 'pol1', type: 'police', len: 0.27, x: POST.x, y: POST.y, hdg: POST.hdg, st: 'home', t: 120, stops: [], lights: false }] };
  const P = state.patrol;
  for (const c of P.cars) {
    if (c.st === 'home' || c.st === 'stop') {
      c.t -= dt;
      if (c.t > 0) continue;
      if (c.st === 'home') {
        // neue Runde: zwei bis drei Buchten in zufälliger Reihenfolge, dann zurück zum Posten
        const B = bays(state).sort(() => rnd(P) - 0.5);
        c.stops = B.slice(0, 2 + (rnd(P) < 0.4 ? 1 : 0));
        c.siren = rnd(P) < 0.12; // selten eine Einsatzfahrt mit Blaulicht
      }
      c.lights = c.siren;
      go(state, c, c.stops.shift() || POST);
      continue;
    }
    // fahren
    if (!moveAlong(c, dt, SPEED * (c.siren ? 1.25 : 1), state)) continue;
    c.path = null;
    if (c.toPost) {
      c.st = 'home';
      c.hdg = POST.hdg;
      c.t = range(P, 360, 900);
      c.lights = c.siren = false;
    } else {
      c.st = 'stop';
      c.t = range(P, 25, 70);
      c.lights = c.siren || rnd(P) < 0.3;
    }
  }
}
