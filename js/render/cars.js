// Pkw-Vielfalt: Bauformen und Lackfarben mit Häufigkeiten wie auf echten Parkplätzen (viel Weiß, Schwarz, Grau und
// Silber, einige Blau- und Rottöne, selten Grün, Braun, Beige, Gelb, Orange). Ohne three.js, damit Karte und 3D sie teilen.
export const CAR_PAINT = [
  ['#f4f5f2', 14], ['#e6e3da', 6], ['#15171b', 12], ['#3b4148', 9], ['#6b7280', 8], ['#b9bfc7', 11],
  ['#1f3a6b', 7], ['#2f62b8', 5], ['#86a7c6', 2], ['#9f1820', 6], ['#d33a2c', 2], ['#5a1a2a', 2],
  ['#1f4d3a', 3], ['#6b7350', 1], ['#5b3b25', 2], ['#c8b48e', 3], ['#e3b326', 1], ['#d4661f', 1], ['#2a7f86', 1],
];
// Kleinwagen, Kompakt (Fließheck), Limousine, Kombi, SUV, Kleinbus, Pick-up
export const CAR_KINDS = [['hatch', 24], ['sedan', 16], ['estate', 14], ['suv', 20], ['mini', 11], ['van', 9], ['pickup', 6]];

const pick = (list, u) => {
  let t = u * list.reduce((s, x) => s + x[1], 0);
  for (const [v, w] of list) if ((t -= w) < 0) return v;
  return list[list.length - 1][0];
};
export const carPaint = (u) => pick(CAR_PAINT, u);
// Polizeiblau (Streifenwagen; Leuchtgelb und Schriftzug trägt das Modell)
export const POLICE_BLUE = '#1f3f94';
export const carKind = (u) => pick(CAR_KINDS, u);
// feste Zufallszahl 0..1 aus einer Zahl (für Autos ohne eigenen Zufallsgenerator)
export const hash01 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
