// Rumpfmaße der Flugzeugmodelle (für 3D-Modelle, Karte und Simulation gemeinsam): Bauart je Typ, Rumpfradius r und
// Höhenfaktor kh (je Länge L), Höhe der Rumpfachse h (in Rumpfradien), dazu die Maße des Treppenfahrzeugs.
export const SHAPE_OF = { AT76: 'prop', DH8D: 'prop', CRJ9: 'rear', C68A: 'biz', A388: 'super', B748F: 'jumbo', B789: 'wide', A359: 'wide', B77W: 'wide', B77F: 'wide', A333: 'wide' };
export const SHAPE = {
  narrow: { r: 0.053, kh: 1.06, h: 1.95 },
  wide: { r: 0.048, kh: 1.06, h: 2.05 },
  super: { r: 0.05, kh: 1.28, h: 2.0 },
  jumbo: { r: 0.045, kh: 1.06, h: 2.1 },
  prop: { r: 0.05, kh: 1.05, h: 1.5 },
  rear: { r: 0.042, kh: 1.05, h: 1.45 },
  biz: { r: 0.052, kh: 1.05, h: 1.5 },
};
export const R_OF = { E190: 0.045, A223: 0.048, B77W: 0.044, B77F: 0.046 };

// Rumpf: halbe Breite rz, halbe Höhe ry, Höhe der Achse über dem Boden (Kacheln)
export function fuselage(type, len) {
  const k = SHAPE[SHAPE_OF[type] || 'narrow'];
  const rz = (R_OF[type] ?? k.r) * len, ry = rz * k.kh;
  return { rz, ry, axis: k.h * ry };
}
// Schwelle der vorderen Tür (gemalt von 56° bis 93° unter dem Scheitel, also knapp unter der Rumpfachse)
export function doorSill(type, len) {
  const f = fuselage(type, len);
  return f.axis - 0.05 * f.ry;
}

// Lage der vorderen Tür entlang des Rumpfs (Anteil der Länge ab Mitte; Turboprops haben die kürzere Nase)
export const doorAlong = (type) => -0.5 + 0.8545 * (0.8 + (SHAPE_OF[type] === 'prop' ? 0.16 : 0.19));

// Treppenfahrzeug: Treppe hinten bei hinge angelenkt (Höhe y, Länge len), oben das Podest (Tiefe plat)
export const STAIRS = { hinge: -0.15, y: 0.052, len: 0.4, plat: 0.066 }; // Podest ragt etwas über das Fahrerhaus hinaus
// Höhe des Podests an einer Tür bzw. in Fahrstellung
export const stairsTop = (ac) => (ac ? Math.max(0.1, doorSill(ac.type, ac.len) - 0.004) : 0.12);
// Treppe für ein Podest auf Höhe top: Neigung th (höchstens 40°, darüber fährt die Treppe teleskopartig aus), Länge len
// und wie weit das Podest vor der Fahrzeugmitte endet (reach)
export function stairsGeom(top) {
  const h = Math.max(0, top - STAIRS.y), MAX = 0.7;
  let th = Math.asin(Math.min(1, h / STAIRS.len)), len = STAIRS.len;
  if (th > MAX) (th = MAX), (len = h / Math.sin(MAX));
  return { th, len, reach: STAIRS.hinge + Math.cos(th) * len + STAIRS.plat };
}
// Abstand der Fahrzeugmitte von der Rumpfachse, damit das Podest an der Tür anliegt
export function stairsOffset(ac) {
  return fuselage(ac.type, ac.len).rz + stairsGeom(stairsTop(ac)).reach + 0.004;
}
