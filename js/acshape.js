// Rumpfmaße der Flugzeugmodelle (für 3D-Modelle, Karte und Simulation gemeinsam): Bauart je Typ, Rumpfradius r und
// Höhenfaktor kh (je Länge L), Höhe der Rumpfachse h (in Rumpfradien), dazu die Maße des Treppenfahrzeugs.
export const SHAPE_OF = { AT76: 'prop', DH8D: 'prop', CRJ9: 'rear', C68A: 'biz', A388: 'super', B748F: 'jumbo', B789: 'wide', A359: 'wide', B77W: 'wide', B77F: 'wide', A333: 'wide' };
// Tragfläche: Spannweite span, Pfeilung sweep (Grad), Flügeltiefe innen cr / außen ct, Vorderkante an der Wurzel wx (je L)
export const SHAPE = {
  narrow: { r: 0.053, kh: 1.06, h: 1.95, span: 0.95, sweep: 25, cr: 0.21, ct: 0.065, wx: 0.1 },
  wide: { r: 0.048, kh: 1.06, h: 2.05, span: 0.97, sweep: 31, cr: 0.22, ct: 0.05, wx: 0.08 },
  super: { r: 0.05, kh: 1.28, h: 2.0, span: 1.08, sweep: 33, cr: 0.27, ct: 0.055, wx: 0.08 },
  jumbo: { r: 0.045, kh: 1.06, h: 2.1, span: 0.9, sweep: 37, cr: 0.22, ct: 0.05, wx: 0.08 },
  prop: { r: 0.05, kh: 1.05, h: 1.5, span: 1.0, sweep: 2, cr: 0.11, ct: 0.065, wx: 0.07 },
  rear: { r: 0.042, kh: 1.05, h: 1.45, span: 0.69, sweep: 26, cr: 0.17, ct: 0.05, wx: 0.0 },
  biz: { r: 0.052, kh: 1.05, h: 1.5, span: 1.05, sweep: 28, cr: 0.2, ct: 0.07, wx: -0.02 },
};
export const R_OF = { E190: 0.045, A223: 0.048, B77W: 0.044, B77F: 0.046 };

// Rumpf: halbe Breite rz, halbe Höhe ry, Höhe der Achse über dem Boden (Kacheln)
export function fuselage(type, len) {
  const k = SHAPE[SHAPE_OF[type] || 'narrow'];
  const rz = (R_OF[type] ?? k.r) * len, ry = rz * k.kh;
  return { rz, ry, axis: k.h * ry };
}
// Grundriss einer Tragfläche in (entlang, quer ≥ 0): Wurzel-Vorderkante, Spitze-Vorderkante, Spitze-Hinterkante, Wurzel-Hinterkante
export function wingPoly(type, len) {
  const k = SHAPE[SHAPE_OF[type] || 'narrow'], rz = fuselage(type, len).rz;
  const b = (k.span * len) / 2, z0 = rz * 0.6;
  const rLE = k.wx * len, tLE = rLE - (b - z0) * Math.tan((k.sweep * Math.PI) / 180);
  return [[rLE, z0], [tLE, b], [tLE - k.ct * len, b], [rLE - k.cr * len, z0]];
}
// liegt der Punkt (entlang, quer) unter dieser Tragfläche? (pad = Rand)
export function underWing(poly, along, lat, pad = 0) {
  if (lat < poly[0][1] - pad || lat > poly[1][1] + pad) return false;
  const t = (lat - poly[0][1]) / (poly[1][1] - poly[0][1] || 1);
  const le = poly[0][0] + (poly[1][0] - poly[0][0]) * t, te = poly[3][0] + (poly[2][0] - poly[3][0]) * t;
  return along <= le + pad && along >= te - pad;
}

// Gepäckförderband: Band hinten bei px (vor der Mitte) in Höhe y angelenkt, Länge len; h = halbe Fahrzeuglänge
export const BELT = { px: -0.1, y: 0.05, len: 0.3, h: 0.185 };
// Band für eine Schwelle in Höhe top: Neigung th (höchstens 34°, darüber fährt das Band aus), Länge len, Reichweite
export function beltGeom(top) {
  const h = Math.max(0, top - BELT.y), MAX = 0.6;
  let th = Math.asin(Math.min(1, h / BELT.len)), len = BELT.len;
  if (th > MAX) (th = MAX), (len = h / Math.sin(MAX));
  return { th, len, reach: BELT.px + Math.cos(th) * len };
}
// Förderband an der hinteren Frachttür (rechts, Steuerbord): Lage (entlang, quer) der Bandspitze und Schwellenhöhe.
// Die Bandspitze liegt an der Rumpfflanke (gut ein Drittel unter der Achse), nicht unter dem Bauch – von schräg
// oben (Karte, Turmblick) sieht man sonst nicht, dass das Band am Rumpf anliegt
export function beltDoor(type, len) {
  const kind = SHAPE_OF[type] || 'narrow';
  if (kind === 'prop' || kind === 'biz') return null; // Turboprops und Businessjets: kein Förderband
  const f = fuselage(type, len), k = 0.35, top = f.axis - k * f.ry;
  return { along: -0.3 * len, lat: Math.sqrt(1 - k * k) * f.rz + 0.01, top, ...beltGeom(top) };
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
