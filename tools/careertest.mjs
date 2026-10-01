// Aufbau-Modus headless: die KI spielt vom Grasplatz aus; je Tag Stufe, Kasse, Verkehr und Bedingungen.
// node tools/careertest.mjs [tage] [seed]
import { newGame } from '../js/state.js';
import { step } from '../js/sim/sim.js';
import { stageOf, stageUpStatus, careerState } from '../js/sim/career.js';

const days = Number(process.argv[2] || 12);
const seed = Number(process.argv[3] || 7);
const s = newGame({ role: 'observer', seed, career: true });
s.auto = { atc: true, ground: true, manager: true };
const T0 = s.time;
let lastDay = 0;
while (s.time < T0 + days * 86400) {
  step(s, 1);
  const d = Math.floor(s.time / 86400);
  if (d === lastDay) continue;
  lastDay = d;
  const r = s.history[s.history.length - 1];
  if (!r) continue;
  const S = stageUpStatus(s);
  const next = S ? S.reqs.map((q) => (q.ok ? '✓' : '✗') + q.have).join(' ') + (S.building ? ` · Bau ${Math.round(S.building.prog * 100)} %` : '') : 'Ziel erreicht';
  console.log(`Tag ${r.day} · Stufe ${stageOf(s)} · Kasse ${Math.round(s.cash).toLocaleString('de-DE')} € · Ergebnis ${(r.rev - r.cost).toLocaleString('de-DE')} € · ${r.mov} Bewegungen · ${r.pax} Pax · Ansehen ${r.rep} · Bekanntheit ${careerState(s).fame.toFixed(0)} · Vorfälle ${r.incidents} · nächste Stufe: ${next}`);
}
