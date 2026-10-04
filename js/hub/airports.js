// Großflughäfen nach realem Vorbild – mit fiktiven Namen. Bahnsystem, Lage der Terminals, Betriebsrichtungen und
// Verkehrsmengen orientieren sich am Vorbild; Maße sind gerundet, Rollwege und Positionen vereinfacht.
// Koordinaten: Kacheln à 20 m, lokaler Rahmen je Platz (siehe dsl.js).
import { airport } from './dsl.js';

// Stündliche Bewegungen (Landungen + Starts) und Anteil Landungen je Stunde (0–23 Uhr)
const PROFILE_HUB = {
  mov: [4, 2, 0, 0, 2, 18, 62, 84, 86, 82, 80, 80, 82, 82, 80, 82, 84, 84, 82, 80, 78, 70, 46, 14],
  arr: [0.5, 0.5, 0.5, 0.5, 0.8, 0.85, 0.66, 0.52, 0.5, 0.48, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.48, 0.45, 0.4, 0.4],
};

// ---------------------------------------------------------------------------------------------------------------
// Kingsmoor International (KGM) – Vorbild London-Heathrow: zwei Parallelbahnen 09/27 im getrennten Betrieb (eine
// Bahn landet, eine startet, Wechsel um 15 Uhr), Terminals zwischen den Bahnen, Terminal 4 und Fracht im Süden.
export const KINGSMOOR = airport(
  {
    id: 'kgm',
    name: 'Kingsmoor International',
    code: 'KGM',
    city: 'Kingsmoor',
    vorbild: 'London-Heathrow',
    tower: 'Kingsmoor Tower',
    freq: '118.700',
    ground: '121.900',
    minSep: 2.5,
    profile: PROFILE_HUB,
    // Betriebsrichtung West bis 15 Uhr: 27R landet, 27L startet – danach umgekehrt (Bahnwechsel)
    alternate: { at: 15, pairs: { W: 'W2', W2: 'W' } },
    airlines: { AUR: 34, OPL: 16, NST: 9, SKB: 9, RHJ: 8, LUM: 8, FJW: 5, BWG: 4, ALP: 3, TGC: 4 },
    mix: { A388: 5, B77W: 13, B789: 10, A359: 9, A333: 4, A321: 14, A320: 20, B738: 10, A223: 8, E190: 4, CRJ9: 3 },
    terminals: { AUR: ['T5'], OPL: ['T3', 'T4'], TGC: ['CARGO'], '*': ['T2', 'T3', 'T4'] },
  },
  (d) => {
    d.frame(0, 0, 90);
    // Bahnen
    d.rwy('09L', '27R', [0, 0], [195, 0]);
    d.rwy('09R', '27L', [6, 71], [189, 71]);
    // Nordbahn: Parallelrollwege A (nach Westen) und B (nach Osten), Einfahrten an beiden Enden
    d.twy('A', [[194.2, 9], [0.8, 9]], { oneway: true });
    d.twy('B', [[0.8, 13], [194.2, 13]], { oneway: true });
    d.entry('09L', 13, 'AW');
    d.entry('27R', -13, 'AE');
    // Südbahn: L (nach Osten) und K (nach Westen) nördlich, S südlich
    d.twy('L', [[6.8, 58], [188.2, 58]], { oneway: true });
    d.twy('K', [[188.2, 62], [6.8, 62]], { oneway: true });
    d.entry('09R', -13, 'KW');
    d.entry('27L', 13, 'KE');
    d.twy('S', [[186, 80], [20, 80]], { oneway: true });
    // Schnellabrollwege
    [72, 92, 112, 134].forEach((s, i) => d.rapid('27R', s, -9, `N${i + 3}`));
    [72, 92, 112, 134].forEach((s, i) => d.rapid('09L', s, 13, `N${i + 7}`));
    [70, 90, 110, 130].forEach((s, i) => d.rapid('27L', s, 9, `S${i + 3}`));
    [70, 90, 110, 130].forEach((s, i) => d.rapid('09R', s, -13, `S${i + 7}`));
    // Südbahn auch nach Süden (Terminal 4, Fracht)
    [82, 118].forEach((s, i) => d.rapid('27L', s, -9, `S${i + 13}`));

    d.exit90('09L', 164, 13, 'N12');
    d.exit90('09R', 158, -13, 'S12');
    // Nord-Süd-Verbindungen durch den Mittelbereich (je Paar eine Richtung)
    d.twy('W1', [[14, 9], [14, 58]], { oneway: true });
    d.twy('W2', [[19, 58], [19, 9]], { oneway: true });
    d.twy('M1', [[68, 9], [68, 58]], { oneway: true });
    d.twy('M2', [[74, 58], [74, 9]], { oneway: true });
    d.twy('E1', [[182, 9], [182, 58]], { oneway: true });
    d.twy('E2', [[187, 58], [187, 9]], { oneway: true });
    // Kreuzungen der Südbahn zu Terminal 4 und Fracht
    d.twy('X1', [[140, 58], [140, 80]], { oneway: true });
    d.twy('X2', [[160, 80], [160, 58]], { oneway: true });
    d.twy('X3', [[40, 58], [40, 80]], { oneway: true });
    d.twy('X4', [[56, 80], [56, 58]], { oneway: true });

    // Terminal 5 (Westen): Hauptgebäude und Satellit, drei Gassen
    const t5a = d.lane('T5 N', [[14, 19], [68, 19]]);
    const t5b = d.lane('T5 M', [[68, 37], [14, 37]]);
    const t5c = d.lane('T5 S', [[14, 53.5], [68, 53.5]]);
    d.standRow({ lane: t5a, from: [27, 19], to: [61, 19], side: 1, sizes: ['L', 'M', 'L', 'M', 'M', 'L'], term: 'T5', prefix: '5' });
    d.standRow({ lane: t5b, from: [61, 37], to: [27, 37], side: 1, sizes: ['M', 'L', 'M', 'L', 'M'], term: 'T5', prefix: '5', start: 11 });
    d.standRow({ lane: t5b, from: [61, 37], to: [27, 37], side: -1, sizes: ['L', 'L', 'M', 'L', 'M'], term: 'T5', prefix: '5', start: 21 });
    d.standRow({ lane: t5c, from: [27, 53.5], to: [61, 53.5], side: -1, sizes: ['M', 'M', 'L', 'M', 'M', 'M'], term: 'T5', prefix: '5', start: 31 });
    d.box('terminal', 27, 25.5, 61, 30.5, 1.25, { name: 'Terminal 5' });
    d.box('pier', 27, 43.5, 61, 47.4, 0.85, { name: 'T5 B' });
    // Terminal 2 und 3 (Mitte)
    const ca = d.lane('Mitte N', [[74, 19], [182, 19]]);
    const cb = d.lane('Mitte M', [[182, 37], [74, 37]]);
    const cc = d.lane('Mitte S', [[74, 53.5], [182, 53.5]]);
    d.standRow({ lane: ca, from: [86, 19], to: [126, 19], side: 1, sizes: ['M', 'L', 'M', 'M', 'L', 'M', 'M'], term: 'T2', prefix: '2' });
    d.standRow({ lane: cb, from: [126, 37], to: [86, 37], side: 1, sizes: ['M', 'M', 'L', 'M', 'M', 'L'], term: 'T2', prefix: '2', start: 11 });
    d.standRow({ lane: cb, from: [126, 37], to: [86, 37], side: -1, sizes: ['M', 'L', 'M', 'M', 'L', 'M', 'M'], term: 'T2', prefix: '2', start: 21 });
    d.standRow({ lane: cc, from: [86, 53.5], to: [126, 53.5], side: -1, sizes: ['M', 'M', 'M', 'L', 'M', 'M'], term: 'T2', prefix: '2', start: 31 });
    d.standRow({ lane: ca, from: [132, 19], to: [177, 19], side: 1, sizes: ['L', 'L', 'M', 'L', 'L', 'M'], term: 'T3', prefix: '3' });
    d.standRow({ lane: cb, from: [177, 37], to: [132, 37], side: 1, sizes: ['L', 'M', 'L', 'L', 'M', 'L'], term: 'T3', prefix: '3', start: 11 });
    d.standRow({ lane: cb, from: [177, 37], to: [132, 37], side: -1, sizes: ['L', 'L', 'L', 'M', 'L', 'M'], term: 'T3', prefix: '3', start: 21 });
    d.standRow({ lane: cc, from: [132, 53.5], to: [177, 53.5], side: -1, sizes: ['M', 'L', 'M', 'L', 'M', 'L', 'M'], term: 'T3', prefix: '3', start: 31 });
    d.box('terminal', 86, 25.5, 126, 30.5, 1.15, { name: 'Terminal 2' });
    d.box('pier', 86, 43.5, 126, 47.4, 0.8, { name: 'T2 B' });
    d.box('terminal', 132, 25.5, 177, 30.5, 1.1, { name: 'Terminal 3' });
    d.box('pier', 132, 43.5, 177, 47.4, 0.8, { name: 'T3 B' });
    d.box('tower', 127.6, 25.6, 130.4, 28.4, 4.6, { name: 'Tower' });
    d.box('garage', 127.4, 33, 130.6, 41, 0.9);
    d.apron([[20, 15], [66, 15], [66, 56], [20, 56]]);
    d.apron([[76, 15], [180, 15], [180, 56], [76, 56]]);
    // Terminal 4 und Fracht im Süden
    d.twy('T4W', [[114, 80], [114, 85.5]], { oneway: true });
    d.twy('T4E', [[176, 85.5], [176, 80]], { oneway: true });
    const t4 = d.lane('T4', [[114, 85.5], [176, 85.5]]);
    d.standRow({ lane: t4, from: [117, 85.5], to: [173, 85.5], side: 1, sizes: ['L', 'M', 'M', 'L', 'M', 'M', 'L', 'M', 'M'], term: 'T4', prefix: '4' });
    d.box('terminal', 117, 91.9, 173, 96, 1.0, { name: 'Terminal 4' });
    d.twy('CW', [[24, 80], [24, 85.5]], { oneway: true });
    d.twy('CE', [[76, 85.5], [76, 80]], { oneway: true });
    const cg = d.lane('Fracht', [[24, 85.5], [76, 85.5]]);
    d.standRow({ lane: cg, from: [27, 85.5], to: [73, 85.5], side: 1, sizes: ['L'], term: 'CARGO', prefix: 'C', gapL: 6.6 });
    d.box('cargo', 27, 92.2, 73, 98, 0.9, { name: 'World Cargo' });
    // Umgebung: Hotels und Straßen im Norden, Wartungshallen im Osten, Tanklager, Straßen
    for (let u = 10; u < 190; u += 22) d.box('hotel', u, -24, u + 12, -17, 1.1 + ((u / 22) % 3) * 0.35);
    d.road([[-30, -12], [225, -12]], 1.2);
    d.road([[-30, 108], [225, 108]], 1.2);
    d.road([[-30, -12], [-30, 108]], 1.2);
    d.road([[225, -12], [225, 108]], 1.2);
    d.road([[127, 108], [129, 62.5]], 1.4);
    d.box('hangar', 199, 20, 214, 32, 1.5, { name: 'Wartung' });
    d.box('hangar', 199, 37, 214, 49, 1.5);
    d.box('tank', 92, 98, 102, 104, 0.5);
    d.box('fire', 98, -8, 104, -5, 0.45);
    d.box('fire', 98, 76, 104, 77.5, 0.4);
    d.box('garage', 140, 98, 160, 104, 1.0);
    for (const [u, v, r, n] of [[-45, 20, 14, 30], [240, 60, 16, 34], [60, 120, 18, 30], [170, 124, 14, 24], [-40, 90, 12, 22], [205, -35, 14, 22]]) d.grove(u, v, r, n, u + v);
    // Betriebsrichtungen
    d.config('W', { name: '27R Landungen · 27L Starts', arr: ['27R'], dep: ['27L'], wind: 260 });
    d.config('W2', { name: '27L Landungen · 27R Starts', arr: ['27L'], dep: ['27R'], wind: 260 });
    d.config('E', { name: '09L Landungen · 09R Starts', arr: ['09L'], dep: ['09R'], wind: 80 });
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Isarmoos International (ISM) – Vorbild München: zwei versetzte Parallelbahnen 08/26 (2,3 km Abstand) im
// gemischten Betrieb – auf beiden Bahnen wird gelandet und gestartet; Terminal 1, Terminal 2 mit Satellit und
// Fracht liegen dazwischen, keine Bahnkreuzungen.
export const ISARMOOS = airport(
  {
    id: 'ism',
    name: 'Isarmoos International',
    code: 'ISM',
    city: 'Isarmoos',
    vorbild: 'München',
    tower: 'Isarmoos Tower',
    freq: '118.705',
    ground: '121.775',
    minSep: 2.5,
    depQueue: 5,
    profile: {
      mov: [2, 0, 0, 0, 0, 14, 58, 82, 84, 76, 70, 70, 72, 70, 70, 74, 80, 82, 80, 74, 68, 56, 34, 8],
      arr: [0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.5, 0.48, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.52, 0.55, 0.6, 0.6],
    },
    airlines: { ALP: 30, AUR: 14, RHJ: 12, NST: 10, LUM: 10, SKB: 6, OPL: 8, FJW: 4, BWG: 3, TGC: 3 },
    mix: { A388: 2, B77W: 5, B789: 6, A359: 7, A333: 4, A321: 16, A320: 24, B738: 10, A223: 12, E190: 8, CRJ9: 6 },
    terminals: { ALP: ['T2'], AUR: ['T2'], OPL: ['T1'], TGC: ['CARGO'], '*': ['T1', 'T2'] },
  },
  (d) => {
    d.frame(0, 0, 82);
    d.rwy('08L', '26R', [70, 0], [270, 0]);
    d.rwy('08R', '26L', [0, 115], [200, 115]);
    // Nordbahn: A (nach Westen), B (nach Osten) südlich
    d.twy('A', [[269.2, 9], [70.8, 9]], { oneway: true });
    d.twy('B', [[70.8, 13], [269.2, 13]], { oneway: true });
    d.entry('08L', 13, 'B1');
    d.entry('26R', -13, 'B16');
    // Südbahn: C (nach Westen) und D (nach Osten) nördlich
    d.twy('C', [[199.2, 106], [0.8, 106]], { oneway: true });
    d.twy('D', [[0.8, 102], [199.2, 102]], { oneway: true });
    d.entry('08R', -13, 'D1');
    d.entry('26L', 13, 'D16');
    // Schnellabrollwege
    [70, 92, 114, 136].forEach((s, i) => d.rapid('26R', s, -9, `A${i + 6}`));
    [70, 92, 114, 136].forEach((s, i) => d.rapid('08L', s, 13, `B${i + 6}`));
    [70, 92, 114, 136].forEach((s, i) => d.rapid('26L', s, 9, `C${i + 6}`));
    [70, 92, 114, 136].forEach((s, i) => d.rapid('08R', s, -13, `D${i + 6}`));
    d.exit90('08L', 165, 13, 'B12');
    d.exit90('08R', 165, -13, 'D12');
    // Nord-Süd-Verbindungen (je Paar eine Richtung)
    d.twy('W1', [[76, 9], [76, 106]], { oneway: true });
    d.twy('W2', [[81, 106], [81, 9]], { oneway: true });
    d.twy('M1', [[128, 9], [128, 106]], { oneway: true });
    d.twy('M2', [[133, 106], [133, 9]], { oneway: true });
    d.twy('E1', [[190, 9], [190, 106]], { oneway: true });
    d.twy('E2', [[195, 106], [195, 9]], { oneway: true });
    // Terminal 1 (Westen) mit Vorfeld Nord und Süd
    const t1n = d.lane('T1 N', [[81, 30], [128, 30]]);
    const t1s = d.lane('T1 S', [[128, 48.5], [81, 48.5]]);
    d.standRow({ lane: t1n, from: [88, 30], to: [122, 30], side: -1, sizes: ['M', 'M', 'L', 'M', 'M', 'M'], term: 'T1', prefix: 'A' });
    d.standRow({ lane: t1n, from: [88, 30], to: [122, 30], side: 1, sizes: ['L', 'M', 'M', 'L', 'M', 'M'], term: 'T1', prefix: 'A', start: 11 });
    d.standRow({ lane: t1s, from: [122, 48.5], to: [88, 48.5], side: 1, sizes: ['M', 'L', 'M', 'M', 'L', 'M'], term: 'T1', prefix: 'B' });
    d.standRow({ lane: t1s, from: [122, 48.5], to: [88, 48.5], side: -1, sizes: ['M', 'M', 'M', 'L', 'M', 'M'], term: 'T1', prefix: 'B', start: 11 });
    d.box('terminal', 88, 36.5, 122, 42, 1.1, { name: 'Terminal 1' });
    // Terminal 2 und Satellit (Osten)
    const t2n = d.lane('T2 N', [[133, 28], [190, 28]]);
    const t2m = d.lane('T2 M', [[190, 46.5], [133, 46.5]]);
    const t2s = d.lane('T2 S', [[133, 63.5], [190, 63.5]]);
    d.standRow({ lane: t2n, from: [140, 28], to: [186, 28], side: -1, sizes: ['M', 'M', 'L', 'M', 'M', 'M', 'L', 'M'], term: 'T2', prefix: 'G' });
    d.standRow({ lane: t2n, from: [140, 28], to: [186, 28], side: 1, sizes: ['M', 'L', 'M', 'M', 'L', 'M', 'M', 'M'], term: 'T2', prefix: 'G', start: 11 });
    d.standRow({ lane: t2m, from: [186, 46.5], to: [140, 46.5], side: 1, sizes: ['M', 'M', 'L', 'M', 'M', 'L', 'M', 'M'], term: 'T2', prefix: 'H' });
    d.standRow({ lane: t2m, from: [186, 46.5], to: [140, 46.5], side: -1, sizes: ['L', 'M', 'M', 'L', 'M', 'M', 'L'], term: 'T2', prefix: 'K' });
    d.standRow({ lane: t2s, from: [140, 63.5], to: [186, 63.5], side: -1, sizes: ['M', 'L', 'M', 'M', 'L', 'M', 'M'], term: 'T2', prefix: 'K', start: 11 });
    d.standRow({ lane: t2s, from: [140, 63.5], to: [186, 63.5], side: 1, sizes: ['M', 'M', 'L', 'M', 'M', 'M', 'L'], term: 'T2', prefix: 'L' });
    d.box('terminal', 140, 34.5, 186, 40, 1.2, { name: 'Terminal 2' });
    d.box('pier', 140, 53, 186, 57, 0.85, { name: 'Satellit' });
    d.apron([[78, 18], [126, 18], [126, 58], [78, 58]]);
    d.apron([[135, 18], [188, 18], [188, 74], [135, 74]]);
    // Fracht (Südwesten, nördlich der Südbahn)
    d.twy('F1', [[26, 102], [26, 80]], { oneway: true });
    d.twy('F2', [[72, 80], [72, 102]], { oneway: true });
    const cg = d.lane('Fracht', [[26, 80], [72, 80]]);
    d.standRow({ lane: cg, from: [29, 80], to: [69, 80], side: -1, sizes: ['L'], term: 'CARGO', prefix: 'F', gapL: 6.6 });
    d.box('cargo', 29, 68, 69, 73.6, 0.9, { name: 'Cargo' });
    // Tower, Parkhäuser, Hotel, Wartung, Umland
    d.box('tower', 124.5, 18, 127.5, 21, 4.4, { name: 'Tower' });
    d.box('garage', 92, 62, 116, 70, 1.0);
    d.box('hotel', 88, 74, 104, 82, 1.4, { name: 'Hotel' });
    d.box('hangar', 205, -30, 222, -16, 1.6, { name: 'Wartung' });
    d.box('hangar', 228, -30, 245, -16, 1.6);
    d.box('fire', 150, 6, 156, 7.5, 0.4);
    d.box('fire', 60, 108, 66, 109.5, 0.4);
    d.box('tank', 10, 70, 20, 78, 0.5);
    d.road([[-30, 60], [76, 60]], 1.3);
    d.road([[-30, 60], [-30, 140]], 1.2);
    d.road([[-30, -24], [290, -24]], 1.2);
    d.road([[-30, 140], [290, 140]], 1.2);
    for (const [u, v, r, n] of [[20, 30, 22, 40], [250, 80, 24, 40], [290, 40, 14, 20], [-50, 100, 14, 22], [140, 160, 18, 28], [40, -40, 14, 22], [200, -50, 12, 18]]) d.grove(u, v, r, n, u * 3 + v);
    d.config('W', { name: 'Westbetrieb · 26R und 26L gemischt', arr: ['26R', '26L'], dep: ['26R', '26L'], wind: 250 });
    d.config('E', { name: 'Ostbetrieb · 08L und 08R gemischt', arr: ['08L', '08R'], dep: ['08L', '08R'], wind: 70 });
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Sunbay International (SBY) – Vorbild Los Angeles: vier Parallelbahnen in zwei Paaren. Gelandet wird auf den
// äußeren Bahnen, gestartet auf den inneren – jede Landung muss die innere Startbahn kreuzen. Terminals im Hufeisen
// zwischen den Paaren, Langstrecken-Terminal im Osten.
const crossExit = (d, endId, s, o1, o2, name) => {
  // Schnellabrollweg von der Außenbahn bis kurz vor die Innenbahn, dann rechtwinklig hinüber zur Rollbahn
  const run = Math.abs(o1) / Math.tan(Math.PI / 6);
  d.twy(name, [d.R(endId, s, 0), d.R(endId, s + run, o1), d.R(endId, s + run, o2)], { oneway: true, rapid: true, exitOf: [endId] });
};
export const SUNBAY = airport(
  {
    id: 'sby',
    name: 'Sunbay International',
    code: 'SBY',
    city: 'Sunbay',
    vorbild: 'Los Angeles',
    tower: 'Sunbay Tower',
    freq: '120.950',
    ground: '121.650',
    minSep: 2.5,
    depQueue: 6,
    profile: {
      mov: [30, 20, 12, 10, 12, 20, 50, 80, 88, 86, 84, 84, 86, 86, 84, 86, 88, 88, 86, 84, 80, 72, 60, 44],
      arr: [0.45, 0.4, 0.4, 0.5, 0.6, 0.65, 0.6, 0.52, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.48, 0.45, 0.4, 0.4],
    },
    airlines: { SKB: 22, OPL: 18, NST: 12, LUM: 14, AUR: 10, RHJ: 6, ALP: 4, FJW: 4, BWG: 2, TGC: 8 },
    mix: { A388: 4, B77W: 10, B789: 9, A359: 7, A333: 4, A321: 18, A320: 14, B738: 20, A223: 8, E190: 4, CRJ9: 2 },
    terminals: { OPL: ['TB'], TGC: ['CARGO'], '*': ['T1', 'T4', 'TB'] },
  },
  (d) => {
    d.frame(0, 0, 83);
    // Bahnen: Nordpaar (24R außen, 24L innen), Südpaar (25R innen, 25L außen)
    d.rwy('06L', '24R', [30, 0], [166, 0]);
    d.rwy('06R', '24L', [20, 13], [177, 13]);
    d.rwy('07L', '25R', [10, 96], [179, 96]);
    d.rwy('07R', '25L', [10, 109], [179, 109]);
    // Parallelrollwege: C (nach Westen), E (nach Osten) südlich des Nordpaars; F (nach Osten), D (nach Westen)
    d.twy('C', [[176.2, 20], [20.8, 20]], { oneway: true });
    d.twy('E', [[20.8, 24], [176.2, 24]], { oneway: true });
    d.twy('F', [[10.8, 84], [178.2, 84]], { oneway: true });
    d.twy('D', [[178.2, 88], [10.8, 88]], { oneway: true });
    d.entry('06R', 11, 'C1');
    d.entry('24L', -11, 'E14');
    d.entry('07L', -12, 'D1');
    d.entry('25R', 12, 'F14');
    // Außenbahnen: Enden (nur Ausfahrten) und Schnellabrollwege über die Innenbahn
    d.twy('B1', [[30.8, 0], [30.8, 20]], { exitOf: ['24R'] });
    d.twy('B9', [[165.2, 0], [165.2, 24]], { exitOf: ['06L'] });
    [62, 84, 106].forEach((s, i) => crossExit(d, '24R', s, -8.2, -20, `A${i + 4}`));
    [62, 84, 106].forEach((s, i) => crossExit(d, '06L', s, 8.2, 24, `A${i + 7}`));
    d.twy('K1', [[10.8, 109], [10.8, 88]], { exitOf: ['25L'] });
    d.twy('K9', [[178.6, 109], [178.6, 84]], { exitOf: ['07R'] });
    [64, 86, 108].forEach((s, i) => crossExit(d, '25L', s, 8.2, 21, `H${i + 4}`));
    [64, 86, 108].forEach((s, i) => crossExit(d, '07R', s, -8.2, -25, `H${i + 7}`));
    // Verbindungen Nord–Süd (je Paar eine Richtung)
    d.twy('W1', [[24, 20], [24, 88]], { oneway: true });
    d.twy('W2', [[29, 88], [29, 20]], { oneway: true });
    d.twy('Q1', [[157, 20], [157, 88]], { oneway: true });
    d.twy('Q2', [[152, 88], [152, 20]], { oneway: true });
    // Hufeisen: Nordgasse (nach Osten), Südgasse (nach Westen)
    const ln = d.lane('Nord', [[24, 33], [157, 33]]);
    const ls = d.lane('Süd', [[157, 75], [24, 75]]);
    d.standRow({ lane: ln, from: [38, 33], to: [144, 33], side: 1, sizes: ['M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'M', 'M', 'L', 'M', 'M', 'M', 'M'], term: 'T1', prefix: '1' });
    d.standRow({ lane: ln, from: [38, 33], to: [144, 33], side: -1, sizes: ['M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'M'], term: 'T1', prefix: '1', start: 41, apron: false });
    d.standRow({ lane: ls, from: [144, 75], to: [38, 75], side: 1, sizes: ['M', 'M', 'L', 'M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'M', 'M'], term: 'T4', prefix: '4' });
    d.standRow({ lane: ls, from: [144, 75], to: [38, 75], side: -1, sizes: ['M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'M'], term: 'T4', prefix: '4', start: 41, apron: false });
    d.box('terminal', 38, 39.5, 144, 44.5, 1.0, { name: 'Terminals 1–3' });
    d.box('terminal', 38, 63.5, 144, 68.5, 1.0, { name: 'Terminals 4–7' });
    d.apron([[26, 26.5], [155, 26.5], [155, 39.5], [26, 39.5]]);
    d.apron([[26, 68.5], [155, 68.5], [155, 82], [26, 82]]);
    // Langstrecken-Terminal im Osten (eigene Gasse nach Süden)
    const tb = d.lane('TB', [[170, 24], [170, 84]]);
    d.standRow({ lane: tb, from: [170, 30], to: [170, 79], side: -1, sizes: ['L'], term: 'TB', prefix: '1', start: 30, gapL: 6.6 });
    d.standRow({ lane: tb, from: [170, 32], to: [170, 78], side: 1, sizes: ['L', 'L', 'M', 'L', 'L', 'M', 'L'], term: 'TB', prefix: '2', start: 30 });
    d.box('terminal', 159.5, 32, 164, 78, 1.2, { name: 'Terminal B' });
    // Landseite in der Mitte: Parkhäuser, Tower, Wahrzeichen
    d.box('garage', 50, 48, 70, 60, 0.8);
    d.box('garage', 112, 48, 132, 60, 0.8);
    d.box('tower', 92, 47, 95, 50, 4.8, { name: 'Tower' });
    d.box('hotel', 84, 54, 90, 60, 1.4, { name: 'Theme Building' });
    d.road([[24, 54], [157, 54]], 1.4);
    d.road([[90, 54], [90, 140]], 1.6);
    // Fracht und Wartung südlich
    d.box('cargo', 40, 122, 90, 130, 0.9, { name: 'Cargo' });
    d.box('hangar', 110, 120, 128, 132, 1.5, { name: 'Wartung' });
    d.box('hangar', 132, 120, 150, 132, 1.5);
    d.road([[-20, 140], [200, 140]], 1.3);
    d.road([[-20, -20], [200, -20]], 1.3);
    d.box('fire', 95, 5.5, 101, 7, 0.4);
    d.box('fire', 95, 101.5, 101, 103, 0.4);
    // Strand im Westen (Sand) und Bäume
    for (const [u, v, r, n] of [[200, 60, 18, 30], [70, 160, 20, 30], [140, -40, 16, 24], [30, -40, 14, 20], [210, 140, 14, 20]]) d.grove(u, v, r, n, u + 2 * v);
    d.config('W', { name: 'Westbetrieb · außen landen, innen starten', arr: ['24R', '25L'], dep: ['24L', '25R'], wind: 250 });
    d.config('E', { name: 'Ostbetrieb (Santa-Ana-Wind) · 06L/07R landen, 06R/07L starten', arr: ['06L', '07R'], dep: ['06R', '07L'], wind: 70 });
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Mainhafen International (MHF) – Vorbild Frankfurt: Bahnsystem um 20° gedreht. Center- und Südbahn (07C/25C,
// 07R/25L) 520 m auseinander, die Nordwestbahn (07L/25R) nur für Landungen, die Startbahn West (18) nur für Starts
// nach Süden. Landungen auf der Südbahn kreuzen die Centerbahn zu Terminal 1 und 2; Terminal 3 und Fracht im Süden.
export const MAINHAFEN = airport(
  {
    id: 'mhf',
    name: 'Mainhafen International',
    code: 'MHF',
    city: 'Mainhafen',
    vorbild: 'Frankfurt',
    tower: 'Mainhafen Tower',
    freq: '119.900',
    ground: '121.800',
    minSep: 2.5,
    depQueue: 6,
    profile: {
      mov: [2, 0, 0, 0, 0, 22, 70, 92, 94, 88, 86, 86, 88, 88, 86, 88, 92, 94, 90, 86, 80, 66, 40, 10],
      arr: [0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.62, 0.5, 0.48, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.55, 0.6],
    },
    airlines: { AUR: 34, RHJ: 14, OPL: 12, NST: 9, SKB: 8, LUM: 8, ALP: 5, FJW: 3, BWG: 2, TGC: 5 },
    mix: { A388: 4, B77W: 8, B789: 9, A359: 9, A333: 6, A321: 16, A320: 22, B738: 8, A223: 10, E190: 5, CRJ9: 3 },
    terminals: { AUR: ['T1'], RHJ: ['T1'], OPL: ['T3'], TGC: ['CARGO'], '*': ['T2', 'T3'] },
  },
  (d) => {
    d.frame(0, 0, 70);
    d.rwy('07C', '25C', [0, 0], [200, 0]);
    d.rwy('07R', '25L', [0, 26], [200, 26]);
    d.rwy('07L', '25R', [-50, -84], [90, -84], 2.6);
    // Startbahn West: Kurs 180° (im lokalen Rahmen 110° gegen die u-Achse gedreht)
    const sx = Math.cos((110 * Math.PI) / 180), sy = Math.sin((110 * Math.PI) / 180);
    d.rwy('18', '36', [-25, 45], [-25 + sx * 200, 45 + sy * 200]);
    // Nordseite der Centerbahn: N1 (nach Westen), N2 (nach Osten), Wendeschleifen hinter den Bahnenden
    d.twy('N1', [[204, -9], [-4, -9]], { oneway: true });
    d.twy('NW', [[-4, -9], [-6.5, -11], [-4, -13]], { oneway: true });
    d.twy('N2', [[-4, -13], [204, -13]], { oneway: true });
    d.twy('NE', [[204, -13], [206.5, -11], [204, -9]], { oneway: true });
    d.entry('07C', -9, 'N3');
    d.entry('25C', 9, 'N29');
    // Südseite der Südbahn: S1 (nach Westen, weiter zur Startbahn West), S2 (nach Osten), Wendeschleifen
    d.twy('S1', [[199.2, 35], [-12, 35]], { oneway: true });
    d.twy('S2', [[-6, 39], [199.2, 39]], { oneway: true });
    d.twy('SW', [[-6, 35], [-6, 39]], { oneway: true });
    d.twy('SM', [[78, 35], [78, 39]], { oneway: true });
    d.twy('SE', [[199.2, 39], [199.2, 35]], { oneway: true });
    d.entry('07R', 9, 'S3');
    d.entry('25L', -9, 'S29');
    d.twy('W', [[-12, 35], d.R('18', 0.8, -9)], { oneway: true });
    d.entry('18', -9, 'W18');
    // Südbahn: Abrollwege nach Süden und über die Centerbahn nach Norden
    [74, 100].forEach((s, i) => d.rapid('25L', s, -9, `S${i + 14}`));
    [64, 88, 112].forEach((s, i) => crossExit(d, '25L', s, 8.2, 39, `N${i + 14}`));
    [74, 100].forEach((s, i) => d.rapid('07R', s, 13, `S${i + 4}`));
    [64, 88, 112].forEach((s, i) => crossExit(d, '07R', s, -8.2, -39, `N${i + 4}`));
    // Querungen beider Bahnen zwischen Nord- und Südseite (je Paar eine Richtung)
    d.twy('X1', [[60, -13], [60, 39]], { oneway: true });
    d.twy('X2', [[66, 39], [66, -13]], { oneway: true });
    d.twy('X3', [[140, -13], [140, 39]], { oneway: true });
    d.twy('X4', [[146, 39], [146, -13]], { oneway: true });
    // Nordwestbahn: R (nach Westen) mit Wendeschleife am Westende in Q (nach Osten) zu den Terminals
    d.twy('R', [[164, -75], [-54, -75]], { oneway: true });
    d.twy('RQ', [[-54, -75], [-58.5, -73], [-54, -71]], { oneway: true });
    d.twy('Q', [[-54, -71], [158, -71]], { oneway: true });
    [60, 82, 104].forEach((s, i) => d.rapid('25R', s, -9, `R${i + 2}`));
    d.twy('R1', [[-49.2, -84], [-49.2, -75]], { oneway: true, exitOf: ['25R'] });
    [64, 88, 108].forEach((s, i) => d.rapid('07L', s, 13, `R${i + 6}`));
    d.twy('R9', [[89.2, -84], [89.2, -71]], { oneway: true, exitOf: ['07L'] });
    // Verbindungen durch das Vorfeld (je Paar eine Richtung)
    d.twy('L1', [[8, -71], [8, -9]], { oneway: true });
    d.twy('L2', [[2, -13], [2, -71]], { oneway: true });
    d.twy('K1', [[158, -71], [158, -9]], { oneway: true });
    d.twy('K2', [[164, -13], [164, -75]], { oneway: true });
    // Terminal 1 (Flugsteige A, B, C, Z) und Terminal 2 (D, E) zwischen Centerbahn und Nordwestbahn
    const a1 = d.lane('T1 Süd', [[2, -19.5], [164, -19.5]]);
    const a2 = d.lane('T1 Mitte', [[164, -37.5], [2, -37.5]]);
    const a3 = d.lane('T1 Nord', [[2, -55.5], [164, -55.5]]);
    d.standRow({ lane: a1, from: [16, -19.5], to: [104, -19.5], side: -1, sizes: ['M', 'M', 'L', 'M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'L'], term: 'T1', prefix: 'A' });
    d.standRow({ lane: a2, from: [104, -37.5], to: [16, -37.5], side: -1, sizes: ['L', 'M', 'M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'L', 'M', 'M'], term: 'T1', prefix: 'B' });
    d.standRow({ lane: a2, from: [104, -37.5], to: [16, -37.5], side: 1, sizes: ['M', 'L', 'M', 'M', 'M', 'L', 'M', 'M', 'L', 'M', 'M', 'M'], term: 'T1', prefix: 'C' });
    d.standRow({ lane: a3, from: [16, -55.5], to: [104, -55.5], side: 1, sizes: ['L', 'L', 'M', 'L', 'L', 'M', 'L', 'L', 'M', 'L'], term: 'T1', prefix: 'Z' });
    d.standRow({ lane: a1, from: [110, -19.5], to: [152, -19.5], side: -1, sizes: ['M', 'L', 'M', 'M', 'L', 'M', 'M'], term: 'T2', prefix: 'D' });
    d.standRow({ lane: a2, from: [152, -37.5], to: [110, -37.5], side: -1, sizes: ['L', 'M', 'M', 'L', 'M', 'M', 'M'], term: 'T2', prefix: 'D', start: 11 });
    d.standRow({ lane: a2, from: [152, -37.5], to: [110, -37.5], side: 1, sizes: ['M', 'L', 'M', 'L', 'M', 'M', 'L'], term: 'T2', prefix: 'E' });
    d.standRow({ lane: a3, from: [110, -55.5], to: [152, -55.5], side: 1, sizes: ['L', 'M', 'L', 'M', 'L', 'M', 'L'], term: 'T2', prefix: 'E', start: 11 });
    d.box('terminal', 16, -31, 104, -26, 1.15, { name: 'Terminal 1' });
    d.box('pier', 16, -49, 104, -44, 0.85, { name: 'Flugsteig Z' });
    d.box('terminal', 110, -31, 152, -26, 1.05, { name: 'Terminal 2' });
    d.box('pier', 110, -49, 152, -44, 0.8, { name: 'Flugsteig E' });
    d.apron([[4, -58], [162, -58], [162, -16], [4, -16]]);
    // Terminal 3 (Flugsteige G, J) und Fracht südlich der Südbahn
    d.twy('T3W', [[100, 39], [100, 45.5]], { oneway: true });
    d.twy('T3E', [[190, 45.5], [190, 35]], { oneway: true });
    const t3 = d.lane('T3', [[100, 45.5], [190, 45.5]]);
    d.standRow({ lane: t3, from: [104, 45.5], to: [186, 45.5], side: 1, sizes: ['L', 'M', 'L', 'M', 'M', 'L', 'M', 'L', 'M', 'M', 'L', 'M', 'L', 'M'], term: 'T3', prefix: 'J' });
    d.box('terminal', 104, 52, 186, 56.5, 1.1, { name: 'Terminal 3' });
    d.twy('CE', [[86, 39], [86, 45.5]], { oneway: true });
    d.twy('CW', [[20, 45.5], [20, 35]], { oneway: true });
    const cg = d.lane('Fracht', [[86, 45.5], [20, 45.5]]);
    d.standRow({ lane: cg, from: [83, 45.5], to: [23, 45.5], side: -1, sizes: ['L'], term: 'CARGO', prefix: 'F', gapL: 6.6 });
    d.box('cargo', 23, 52, 83, 60, 0.95, { name: 'Cargo City Süd' });
    // Tower, Wartung, Parkhaus, Feuerwachen, Straßen und Stadtwald um die Startbahn West
    d.box('tower', 153, -24, 156, -21, 4.6, { name: 'Tower' });
    d.box('hangar', 208, -42, 228, -26, 1.6, { name: 'Wartung' });
    d.box('hangar', 208, -20, 228, -8, 1.5);
    d.box('garage', 60, -67, 92, -61, 0.9);
    d.box('fire', 30, 11, 36, 12.5, 0.4);
    d.box('fire', 30, -66, 36, -64.5, 0.4);
    d.road([[-70, -98], [230, -98]], 1.6);
    d.road([[-6, 72], [230, 72]], 1.3);
    d.road([[230, -98], [230, 72]], 1.3);
    const ru = (v) => -25 + (sx / sy) * (v - 45);
    for (const [v, r, n] of [[90, 18, 40], [150, 20, 46], [210, 18, 40]]) {
      d.grove(ru(v) - 32, v, r, n, v);
      d.grove(ru(v) + 32, v, r, n, v + 3);
    }
    for (const [u, v, r, n] of [[120, 100, 16, 26], [250, 40, 14, 20], [-100, -40, 16, 24], [40, 110, 20, 34]]) d.grove(u, v, r, n, u + v * 7);
    d.config('W', { name: 'Betriebsrichtung 25 · 25R/25L landen, 25C/18 starten', arr: ['25R', '25L'], dep: ['25C', '18'], wind: 250 });
    d.config('E', { name: 'Betriebsrichtung 07 · 07L/07R landen, 07C/18 starten', arr: ['07L', '07R'], dep: ['07C', '18'], wind: 70 });
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Liberty Bay International (LBY) – Vorbild New York JFK: zwei Paare paralleler Bahnen im rechten Winkel (04/22 und
// 13/31), die sich an den Enden kreuzen; in der Mitte das Terminalgebiet mit zwei gegenläufigen Ringrollwegen (A
// innen, B außen). Je nach Wind wird in vier Richtungen geflogen; Abflüge zur 13R/31L kreuzen die 13L/31R.
export const LIBERTY = airport(
  {
    id: 'lby',
    name: 'Liberty Bay International',
    code: 'LBY',
    city: 'Liberty Bay',
    vorbild: 'New York JFK',
    tower: 'Liberty Tower',
    freq: '119.100',
    ground: '121.650',
    minSep: 2.5,
    depQueue: 7,
    profile: {
      mov: [12, 8, 4, 4, 6, 16, 34, 50, 56, 58, 58, 60, 64, 68, 72, 78, 82, 84, 82, 78, 72, 62, 44, 24],
      arr: [0.6, 0.6, 0.55, 0.5, 0.6, 0.7, 0.6, 0.5, 0.5, 0.5, 0.52, 0.56, 0.6, 0.6, 0.55, 0.5, 0.45, 0.42, 0.4, 0.42, 0.45, 0.46, 0.5, 0.55],
    },
    airlines: { AUR: 22, OPL: 18, NST: 12, SKB: 10, LUM: 8, FJW: 6, BWG: 6, ALP: 6, RHJ: 6, TGC: 6 },
    mix: { A388: 3, B77W: 12, B789: 10, A359: 8, A333: 6, A321: 16, A320: 14, B738: 14, A223: 8, E190: 6, CRJ9: 3 },
    terminals: { AUR: ['T4'], OPL: ['T8'], NST: ['T5'], TGC: ['CARGO'], '*': ['T4', 'T5', 'T7', 'T8'] },
  },
  (d) => {
    d.frame(0, 0, 31);
    d.rwy('04L', '22R', [-150, -66], [34, -66]);
    d.rwy('04R', '22L', [-96, 64], [32, 64]);
    d.rwy('13L', '31R', [-88, -44], [-88, 108]);
    d.rwy('13R', '31L', [-140, -110], [-140, 111]);
    // Ringrollwege um das Terminalgebiet: A innen (im Uhrzeigersinn), B außen (gegen den Uhrzeigersinn)
    d.twy('A', [[-58, -40], [44, -40], [44, 28]], { oneway: true });
    d.twy('A ', [[44, 28], [-58, 28], [-58, -40]], { oneway: true });
    d.twy('B', [[-62, -44], [-62, 32], [48, 32]], { oneway: true });
    d.twy('B ', [[48, 32], [48, -44], [-62, -44]], { oneway: true });
    // 04L/22R (nur Starts): P nach Südwesten zur 04L, R nach Nordosten zur 22R
    d.twy('P', [[12, -57], [-149.2, -57]], { oneway: true });
    d.twy('R', [[-75, -53], [33.2, -53]], { oneway: true });
    d.entry('04L', 9, 'P1');
    d.entry('22R', -13, 'R9');
    d.twy('N1', [[-36, -40], [-36, -57]], { oneway: true });
    d.twy('N2', [[-44, -53], [-44, -40]], { oneway: true });
    d.twy('N3', [[12, -40], [12, -57]], { oneway: true });
    d.twy('N4', [[20, -53], [20, -40]], { oneway: true });
    // 04R/22L (nur Landungen): H nach Südwesten (Abrollwege der 22L), J nach Nordosten (Abrollwege der 04R)
    d.twy('H', [d.R('22L', 56 + 9 / Math.tan(Math.PI / 6), 9), [-75, 55]], { oneway: true });
    d.twy('J', [[-79, 51], [24, 51]], { oneway: true });
    [56, 72, 88].forEach((s, i) => d.rapid('22L', s, 9, `H${i + 2}`));
    [60, 76, 92].forEach((s, i) => d.rapid('04R', s, -13, `J${i + 2}`));
    d.twy('S1', [[-50, 55], [-50, 28]], { oneway: true });
    d.twy('S2', [[-4, 51], [-4, 28]], { oneway: true });
    d.twy('S3', [[24, 51], [24, 28]], { oneway: true });
    // 13L/31R (nur Landungen): D nach Südosten, E nach Nordwesten; W1/W2 kreuzen die Bahn zur 13R/31L
    d.twy('D', [[-79, -57], [-79, 51]], { oneway: true });
    d.twy('E', [[-75, 55], [-75, -53]], { oneway: true });
    [60, 74, 88].forEach((s, i) => d.rapid('31R', s, 13, `E${i + 2}`));
    [56, 72].forEach((s, i) => d.rapid('13L', s, -9, `D${i + 2}`));
    d.exit90('13L', 90, -9, 'D5', false);
    d.twy('W1', [[-58, -32], [-131, -32]], { oneway: true });
    d.twy('W2', [[-75, -26], [-58, -26]], { oneway: true });
    // 13R/31L (nur Starts): F nach Südosten zur 31L, G nach Nordwesten zur 13R
    d.twy('F', [[-131, -32], [-131, 110.2]], { oneway: true });
    d.twy('G', [[-127, -32], [-127, -109.2]], { oneway: true });
    d.entry('31L', 9, 'F9');
    d.entry('13R', -13, 'G1');
    // Terminalgebiet: vier Gassen im Wechsel, Terminals 8 und 7 (Norden), 5 (Mitte), 4 (Süden)
    const l1 = d.lane('Gasse 1', [[-62, -34], [48, -34]]);
    const l2 = d.lane('Gasse 2', [[48, -16], [-62, -16]]);
    const l3 = d.lane('Gasse 3', [[-62, 2], [48, 2]]);
    const l4 = d.lane('Gasse 4', [[48, 20], [-62, 20]]);
    const SZ = ['L', 'M', 'M', 'L', 'M', 'L', 'M'];
    d.standRow({ lane: l1, from: [-50, -34], to: [-14, -34], side: 1, sizes: SZ, term: 'T8', prefix: '8' });
    d.standRow({ lane: l1, from: [-8, -34], to: [36, -34], side: 1, sizes: SZ, term: 'T7', prefix: '7' });
    d.standRow({ lane: l2, from: [-14, -16], to: [-50, -16], side: 1, sizes: SZ, term: 'T8', prefix: '8', start: 21 });
    d.standRow({ lane: l2, from: [36, -16], to: [-8, -16], side: 1, sizes: SZ, term: 'T7', prefix: '7', start: 21 });
    d.standRow({ lane: l2, from: [36, -16], to: [-50, -16], side: -1, sizes: ['M', 'L', 'M', 'M', 'L'], term: 'T5', prefix: '5' });
    d.standRow({ lane: l3, from: [-50, 2], to: [36, 2], side: -1, sizes: ['M', 'M', 'L', 'M', 'L'], term: 'T5', prefix: '5', start: 21 });
    d.standRow({ lane: l3, from: [-50, 2], to: [36, 2], side: 1, sizes: ['L', 'L', 'M', 'L', 'M'], term: 'T4', prefix: '4' });
    d.standRow({ lane: l4, from: [36, 20], to: [-50, 20], side: 1, sizes: ['L', 'M', 'L', 'M', 'M'], term: 'T4', prefix: '4', start: 21 });
    d.box('terminal', -50, -27.5, -14, -22.5, 1.0, { name: 'Terminal 8' });
    d.box('terminal', -8, -27.5, 36, -22.5, 0.95, { name: 'Terminal 7' });
    d.box('terminal', -50, -9.5, 36, -4.5, 1.15, { name: 'Terminal 5' });
    d.box('terminal', -50, 8.5, 36, 13.5, 1.2, { name: 'Terminal 4' });
    d.box('tower', 38.5, -8.5, 41.5, -5.5, 4.8, { name: 'Tower' });
    d.box('garage', -56, -9.5, -52, -4.5, 0.9);
    d.box('garage', -56, 8.5, -52, 13.5, 0.9);
    d.apron([[-60, -38], [46, -38], [46, 26], [-60, 26]]);
    // Fracht nordöstlich des Rings
    d.twy('CN', [[44, -36], [56, -36]], { oneway: true });
    d.twy('CS', [[56, 24], [44, 24]], { oneway: true });
    const cg = d.lane('Fracht', [[56, -36], [56, 24]]);
    d.standRow({ lane: cg, from: [56, -33], to: [56, 21], side: -1, sizes: ['L'], term: 'CARGO', prefix: 'C', gapL: 6.6 });
    d.box('cargo', 63, -33, 70, 21, 0.95, { name: 'Cargo Center' });
    d.box('hangar', 76, -30, 90, -12, 1.6, { name: 'Wartung' });
    d.box('hangar', 76, -4, 90, 12, 1.5);
    d.box('fire', -112, 10, -106, 11.5, 0.4);
    d.box('fire', 0, 72, 6, 73.5, 0.4);
    d.road([[-162, -126], [98, -126]], 1.4);
    d.road([[98, -126], [98, 128]], 1.6);
    d.road([[-162, 128], [98, 128]], 1.2);
    d.road([[-162, -126], [-162, 128]], 1.2);
    for (const [u, v, r, n] of [[60, 96, 18, 30], [70, -96, 16, 26], [-176, 30, 12, 20], [-40, 104, 14, 24], [-30, -100, 14, 22]]) d.grove(u, v, r, n, u * 3 + v);
    d.config('SW', { name: '22L landet · 22R und 31L starten', arr: ['22L'], dep: ['22R', '31L'], wind: 220 });
    d.config('NW', { name: '31R landet · 31L startet', arr: ['31R'], dep: ['31L'], wind: 310 });
    d.config('NE', { name: '04R landet · 04L startet', arr: ['04R'], dep: ['04L'], wind: 40 });
    d.config('SE', { name: '13L landet · 13R startet', arr: ['13L'], dep: ['13R'], wind: 130 });
  }
);

export const AIRPORTS = [KINGSMOOR, ISARMOOS, SUNBAY, MAINHAFEN, LIBERTY];
export const airportById = (id) => AIRPORTS.find((a) => a.id === id);
