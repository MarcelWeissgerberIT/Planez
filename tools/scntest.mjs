// Herausforderungen headless durchspielen (alles automatisch) und Sterne ausgeben: node tools/scntest.mjs [id] [seed]
import { newGame } from '../js/state.js';
import { step } from '../js/sim/sim.js';
import { SCENARIOS, applyScenario, scenarioListeners, scenarioById } from '../js/sim/scenarios.js';
import { buyUpgrade } from '../js/sim/economy.js';

const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
const seeds = process.argv[3] ? [Number(process.argv[3])] : [1, 2, 3];
let res = null;
scenarioListeners.push((s, def, r) => (res = r));
// Tagesherausforderungen: daily-JJJJMMTT (mit ihrem festen Zufall, sofern kein Seed angegeben)
const list = only && only.startsWith('daily-') ? [scenarioById(only)] : SCENARIOS;
for (const def of list) {
  if (only && def.id !== only) continue;
  for (const seed of def.daily && !process.argv[3] ? [def.seed] : seeds) {
    const s = newGame({ role: def.role, seed, hour: def.hour, density: def.density });
    applyScenario(s, def);
    s.auto = { atc: true, ground: true, manager: true };
    if (def.id === 'growth') buyUpgrade(s, 'rwy2');
    res = null;
    const t0 = Date.now();
    while (!res && s.time < s.scenario.end + 10) step(s, 1);
    const rows = res.rows.map((r, i) => `${def.goals[i].key}=${Math.round(r.v)}(${r.stars}★)`).join(' ');
    console.log(`${def.id.padEnd(11)} seed ${seed}: ${res.stars}★ ${res.failed ? 'FAIL ' + res.failed : ''} | ${rows} | inc ${res.m.incidents} ga ${res.m.goArounds} div ${res.m.diversions} mov ${res.m.mov} punct ${res.m.punct} | ${Date.now() - t0} ms`);
  }
}
