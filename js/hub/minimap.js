// Minikarte an den Großflughäfen: Abbild aus den Layoutdaten (Vorfeld, Rollwege, Bahnen, Gebäude), aktive Bahnen
// etwas heller, Punkte für Flugzeuge je Phase
import { Minimap, MM_GRAY as G, mmLine, mmPoly } from '../ui/minimap.js';
import { PHASE as P } from './sim.js';

const RWY_PH = new Set([P.ROLL, P.LINEUP, P.LINED, P.TKOF]);

export function createHubMinimap(mode, el, btn) {
  const ap = mode.ap, sim = mode.sim;
  return new Minimap({
    el,
    legend: ['stand', 'taxi', 'rwy', 'air'],
    cam: () => mode.renderer.cam,
    bounds: () => ap.bounds,
    points: () => [...ap.nodes, ...ap.runways.flatMap((r) => [r.a, r.b]), ...ap.buildings.flatMap((b) => b.poly)],
    key: () => sim.cfg.id,
    paint: (g, k) => {
      const b = ap.bounds;
      g.fillStyle = G.field;
      g.fillRect(b.x0 + 22, b.y0 + 22, b.x1 - b.x0 - 44, b.y1 - b.y0 - 44);
      g.fillStyle = G.apron;
      for (const a of ap.aprons) mmPoly(g, a);
      g.strokeStyle = G.twy;
      for (const l of ap.lines) if (l.kind === 'twy' || l.kind === 'lane') mmLine(g, l.pts, l.w || 1.2, k, 0.9);
      // Bahnen, die gerade in Betrieb sind, etwas heller
      const act = new Set([...sim.cfg.arr, ...sim.cfg.dep]);
      g.lineCap = 'butt';
      for (const r of ap.runways) {
        g.strokeStyle = r.ends.some((e) => act.has(e)) ? '#a3acb7' : G.rwy;
        mmLine(g, [r.a, r.b], r.w, k, 2.2);
      }
      g.lineCap = 'round';
      for (const bd of ap.buildings) {
        if (bd.kind === 'tank') continue;
        g.fillStyle = bd.kind === 'terminal' || bd.kind === 'pier' ? G.term : G.bld;
        mmPoly(g, bd.poly);
      }
    },
    dots: () =>
      sim.acs.map((a) => {
        let c = 'taxi';
        if (a.phase === P.APP || a.phase === P.FIN || a.phase === P.GA || a.phase === P.CLIMB || (a.z || 0) > 0.3) c = 'air';
        else if (a.phase === P.STAND) c = 'stand';
        else if (RWY_PH.has(a.phase) || a.onRwz || a.crossRwy) c = 'rwy';
        return { x: a.x, y: a.y, c };
      }),
    jump: (x, y) => {
      const cam = mode.renderer.cam;
      mode.follow = false;
      cam.tx = null;
      cam.x = x;
      cam.y = y;
      cam.clampPos();
    },
    onToggle: (on) => btn && btn.classList.toggle('on', on),
  });
}
