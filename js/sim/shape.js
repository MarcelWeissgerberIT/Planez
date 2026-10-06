// Umriss eines Flugzeugs am Boden für Abstands- und Kollisionsprüfungen (Tower und Großflughäfen): Rumpf,
// Tragfläche und Höhenleitwerk als Strecken mit Dicke, dazu ein schmaler Flügelkern für Flügel gegen Flügel.
// Einheiten frei (Kacheln der jeweiligen Karte); hdg = Nase in Bogenmaß (cos = x, sin = y).
export function shapeAt(x, y, hdg, L, sp) {
  const dx = Math.cos(hdg), dy = Math.sin(hdg);
  const wx = x + dx * 0.05 * L, wy = y + dy * 0.05 * L; // Flügel etwas vor der Mitte
  const tx = x - dx * 0.42 * L, ty = y - dy * 0.42 * L; // Höhenleitwerk am Heck
  const cs = sp * 0.8; // Flügelkern: Spitzen dürfen sich auf eng parallelen Rollwegen nahe kommen
  return [
    [x - (dx * L) / 2, y - (dy * L) / 2, x + (dx * L) / 2, y + (dy * L) / 2, 0.1 * L, 'f'],
    [wx - (dy * sp) / 2, wy + (dx * sp) / 2, wx + (dy * sp) / 2, wy - (dx * sp) / 2, 0.07 * L, 'w'],
    [tx - dy * 0.17 * L, ty + dx * 0.17 * L, tx + dy * 0.17 * L, ty - dx * 0.17 * L, 0.07 * L, 't'],
    [wx - (dy * cs) / 2, wy + (dx * cs) / 2, wx + (dy * cs) / 2, wy - (dx * cs) / 2, 0.04, 'c'],
  ];
}
const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// kürzester Abstand zweier Strecken
export function segDist(ax, ay, bx, by, cx, cy, ex, ey) {
  const ptSeg = (px, py, x1, y1, x2, y2) => {
    const vx = x2 - x1, vy = y2 - y1, l2 = vx * vx + vy * vy;
    const t = l2 ? cl01(((px - x1) * vx + (py - y1) * vy) / l2) : 0;
    return Math.hypot(px - x1 - t * vx, py - y1 - t * vy);
  };
  const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  if (o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, ex, ey) < 0 && o(cx, cy, ex, ey, ax, ay) * o(cx, cy, ex, ey, bx, by) < 0) return 0;
  return Math.min(ptSeg(ax, ay, cx, cy, ex, ey), ptSeg(bx, by, cx, cy, ex, ey), ptSeg(cx, cy, ax, ay, bx, by), ptSeg(ex, ey, ax, ay, bx, by));
}
// Lücke zwischen zwei Umrissen (negativ = sie berühren sich). Rumpf und Leitwerk gegen alles mit voller Fläche,
// Flügel gegen Flügel nur mit dem Flügelkern
// loose: Flügel überall nur mit dem Kern (enge Vorfelder der Großflughäfen – Flügelspitzen dürfen über die
// Nachbarposition ragen, Rumpf und Leitwerk nie)
export function shapeGap(sa, sb, loose = false) {
  let g = 1e9;
  for (const a of sa)
    for (const b of sb) {
      const ka = a[5], kb = b[5];
      if (loose) {
        if (ka === 'w' || kb === 'w') continue;
      } else if (ka === 'c' || kb === 'c' ? !(ka === 'c' && kb === 'c') : ka === 'w' && kb === 'w') continue;
      g = Math.min(g, segDist(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]) - (a[4] + b[4]) / 2);
    }
  return g;
}
// Überdecken sich die vollen Flügel (Spitzen)? – für Auswertungen
export function wingsTouch(sa, sb) {
  const a = sa[1], b = sb[1];
  return segDist(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]) - (a[4] + b[4]) / 2 < 0;
}
