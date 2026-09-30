// Headless-Test der Simulation: node tools/simtest.mjs [tage] [rolle]
import { newGame, setRole } from '../js/state.js';
import { step } from '../js/sim/sim.js';
import { PH } from '../js/sim/aircraft.js';
import { listeners } from '../js/sim/messages.js';

const days = Number(process.argv[2] || 2);
const role = process.argv[3] || 'observer';
const s = newGame({ role, seed: 42 });
const logs = [];
listeners.radio.push((m) => logs.push(m));
const T0 = s.time;
const end = T0 + days * 86400;
let lastReport = 0;
const stuck = new Map();
while (s.time < end) {
  step(s, 1);
  // Stillstand erkennen: Flugzeug in Bewegungsphase ohne Positionsänderung
  if (Math.floor(s.time) % 60 === 0) {
    for (const a of s.acs) {
      const key = a.id;
      const pos = a.mode === 'air' ? `${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)}` : `${a.x.toFixed(2)},${a.y.toFixed(2)}`;
      const prev = stuck.get(key);
      if (prev && prev.pos === pos && prev.phase === a.phase) prev.n++;
      else stuck.set(key, { pos, phase: a.phase, n: 0 });
    }
  }
  if (s.time - lastReport >= 3 * 3600) {
    lastReport = s.time;
    const ph = {};
    for (const a of s.acs) ph[a.phase] = (ph[a.phase] || 0) + 1;
    const h = ((s.time % 86400) / 3600).toFixed(1);
    console.log(`Tag ${Math.floor(s.time / 86400) + 1} ${h}h | cash ${(s.cash / 1e6).toFixed(2)}M rep ${s.reputation.toFixed(1)} | acs ${s.acs.length} ${JSON.stringify(ph)} | rwy ${s.rwy}${s.rwyPending ? '->' + s.rwyPending : ''} wx ${s.weather.kind} | today ${JSON.stringify(s.stats.today)}`);
  }
}
console.log('\nHistorie:');
for (const h of s.history) console.log(JSON.stringify({ day: h.day, rev: h.rev, cost: h.cost, capex: h.capex, cash: h.cash, mov: h.mov, pax: h.pax, onTime: h.onTime, inc: h.incidents, ga: h.goArounds, div: h.diversions, rep: h.rep }));
console.log('\nLange stillstehende Flugzeuge (Minuten):');
const ST = new Set([PH.STAND, PH.HOLDING, PH.VACATED, PH.LINED, PH.STARTUP]);
for (const [id, v] of stuck) {
  const a = s.acs.find((x) => x.id === id);
  if (a && v.n >= 15) console.log(id, a.cs, v.phase, v.n, 'min', a.mode === 'map' ? `x=${a.x.toFixed(1)} y=${a.y.toFixed(1)} blockedBy=${a.blockedBy}` : '', a.req, a.stand, a.ta ? JSON.stringify(Object.fromEntries(Object.entries(a.ta.tasks).map(([k, t]) => [k, t.st]))) : '');
}
const sys = logs.filter((m) => m.kind === 'sys').slice(-25);
console.log('\nLetzte Systemmeldungen:');
for (const m of sys) console.log(((m.t % 86400) / 3600).toFixed(2), m.text);
