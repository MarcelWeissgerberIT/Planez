// Spielkonstanten und Stammdaten
export const TIME_SCALE = 15; // Spielsekunden pro Echtzeitsekunde bei 1x
export const SPEEDS = [0, 1, 2, 5, 10, 20];
// Echtzeit-Minuten pro Spieltag bei Tempo v (10× ≈ 10 Minuten)
export const dayMinutes = (v) => (v ? 86400 / (TIME_SCALE * v) / 60 : Infinity);
// Starttempo je Rolle: Manager/Beobachter im 10-Minuten-Tag, Lotsen in Echtzeit-nah
export const DEFAULT_SPEED = { tower: 1, ground: 1, manager: 10, observer: 10 };
export const NM_PER_TILE = 20 / 1852; // 1 Kachel = 20 m
export const ZS = 32; // Pixel pro Kachel Höhe (bei Zoom 1)

export const AIRPORT = { name: 'Planez International', code: 'PLZ', tower: 'Planez Tower', freq: '118.705' };

// size: S < M < L  (Parkpositions-Klasse)
// Flugzeugtypen: Hersteller und Modelle sind frei erfunden (Aviora, Halvard, Ventis …); `code` ist das Typkürzel für
// Karte, Radar und Streifen, der Schlüssel (id) bleibt intern gleich, damit Spielstände kompatibel bleiben
export const AC_TYPES = {
  AT76: { id: 'AT76', name: 'Ventis VT-70', code: 'VT70', sprite: 'plane_prop', size: 'S', wake: 'M', len: 1.82, mtow: 23, pax: 70, vapp: 115, turn: 30, fuel: 2500, scale: 0.55, finH: 0.32 },
  E190: { id: 'E190', name: 'Selva S-19', code: 'SL19', sprite: 'plane_narrow', size: 'M', wake: 'M', len: 2.27, mtow: 51, pax: 100, vapp: 130, turn: 35, fuel: 6000, scale: 0.7, finH: 0.4 },
  A320: { id: 'A320', name: 'Aviora AV-32', code: 'AV32', sprite: 'plane_narrow', size: 'M', wake: 'M', len: 2.47, mtow: 79, pax: 180, vapp: 135, turn: 40, fuel: 11000, scale: 1, finH: 0.45 },
  B738: { id: 'B738', name: 'Halvard H-38', code: 'HV38', sprite: 'plane_narrow', size: 'M', wake: 'M', len: 2.6, mtow: 79, pax: 186, vapp: 142, turn: 40, fuel: 11000, scale: 1, finH: 0.47 },
  A321: { id: 'A321', name: 'Aviora AV-32L', code: 'AV3L', sprite: 'plane_narrow', size: 'M', wake: 'M', len: 2.93, mtow: 97, pax: 220, vapp: 140, turn: 45, fuel: 14000, scale: 1.15, finH: 0.47 },
  B789: { id: 'B789', name: 'Halvard H-89', code: 'HV89', sprite: 'plane_wide', size: 'L', wake: 'H', len: 4.03, mtow: 254, pax: 290, vapp: 145, turn: 75, fuel: 60000, scale: 1.7, finH: 0.7 },
  A359: { id: 'A359', name: 'Aviora AV-35', code: 'AV35', sprite: 'plane_wide', size: 'L', wake: 'H', len: 4.29, mtow: 280, pax: 325, vapp: 142, turn: 80, fuel: 70000, scale: 1.85, finH: 0.75 },
  B77W: { id: 'B77W', name: 'Halvard H-77X', code: 'HV7X', sprite: 'plane_wide', size: 'L', wake: 'H', len: 4.81, mtow: 351, pax: 396, vapp: 150, turn: 90, fuel: 90000, scale: 2.1, finH: 0.8 },
  A388: { id: 'A388', name: 'Aviora AV-38', code: 'AV38', sprite: 'plane_super', size: 'L', wake: 'H', len: 5.0, mtow: 575, pax: 520, vapp: 140, turn: 110, fuel: 120000, scale: 2.4, finH: 0.95 },
  B748F: { id: 'B748F', name: 'Halvard H-48F Frachter', code: 'HV48', sprite: 'plane_cargo', size: 'L', wake: 'H', len: 4.94, mtow: 448, pax: 0, cargo: 130, vapp: 155, turn: 100, fuel: 110000, scale: 2.2, finH: 0.9 },
  B77F: { id: 'B77F', name: 'Halvard H-77F Frachter', code: 'HV7F', sprite: 'plane_wide', size: 'L', wake: 'H', len: 4.16, mtow: 348, pax: 0, cargo: 100, vapp: 150, turn: 90, fuel: 85000, scale: 2, finH: 0.78 },
  A223: { id: 'A223', name: 'Aviora AV-23', code: 'AV23', sprite: 'plane_narrow', size: 'M', wake: 'M', len: 2.35, mtow: 70, pax: 140, vapp: 130, turn: 35, fuel: 9000, scale: 0.9, finH: 0.42 },
  CRJ9: { id: 'CRJ9', name: 'Corvin KR-90', code: 'KR90', sprite: 'plane_narrow', size: 'S', wake: 'M', len: 2.1, mtow: 38, pax: 90, vapp: 135, turn: 30, fuel: 4500, scale: 0.68, finH: 0.38 },
  DH8D: { id: 'DH8D', name: 'Borealis BR-40', code: 'BR40', sprite: 'plane_prop', size: 'S', wake: 'M', len: 1.98, mtow: 30, pax: 78, vapp: 130, turn: 28, fuel: 3000, scale: 0.6, finH: 0.34 },
  A333: { id: 'A333', name: 'Aviora AV-33', code: 'AV33', sprite: 'plane_wide', size: 'L', wake: 'H', len: 3.9, mtow: 242, pax: 300, vapp: 140, turn: 70, fuel: 55000, scale: 1.75, finH: 0.7 },
  C68A: { id: 'C68A', name: 'Vireo VX-7', code: 'VX7', sprite: 'plane_bizjet', size: 'S', wake: 'L', len: 1.3, mtow: 14, pax: 8, vapp: 120, turn: 30, fuel: 3000, scale: 0.4, finH: 0.25 },
  // Karriere (Grasplatz/Verkehrslandeplatz): Sportflugzeuge und Lufttaxis. light = rollt selbst, tankt an der
  // Zapfsäule, Gäste gehen zu Fuß; selfTaxi = kein Pushback (rollt aus eigener Kraft vom Abstellplatz)
  C172: { id: 'C172', name: 'Alcedo AL-4', code: 'AL4', sprite: 'plane_ga', size: 'S', wake: 'L', len: 0.42, mtow: 1.1, pax: 3, vapp: 65, turn: 25, fuel: 120, scale: 0.2, finH: 0.12, light: true, selfTaxi: true, vmax: 115, cruise: 3500 },
  PA28: { id: 'PA28', name: 'Pember PB-3', code: 'PB3', sprite: 'plane_ga2', size: 'S', wake: 'L', len: 0.37, mtow: 1.2, pax: 3, vapp: 66, turn: 25, fuel: 130, scale: 0.19, finH: 0.11, light: true, selfTaxi: true, vmax: 120, cruise: 4500 },
  DR40: { id: 'DR40', name: 'Merle ME-4', code: 'ME4', sprite: 'plane_ga2', size: 'S', wake: 'L', len: 0.35, mtow: 1.0, pax: 3, vapp: 62, turn: 25, fuel: 110, scale: 0.18, finH: 0.1, light: true, selfTaxi: true, vmax: 115, cruise: 3500 },
  PC12: { id: 'PC12', name: 'Alpenwerk AW-10', code: 'AW10', sprite: 'plane_tp', size: 'S', wake: 'L', len: 0.72, mtow: 4.7, pax: 8, vapp: 85, turn: 25, fuel: 900, scale: 0.32, finH: 0.2, selfTaxi: true, walk: true, vmax: 210, cruise: 9000 },
  BE20: { id: 'BE20', name: 'Regent RG-26', code: 'RG26', sprite: 'plane_prop', size: 'S', wake: 'L', len: 0.67, mtow: 5.7, pax: 9, vapp: 100, turn: 25, fuel: 1000, scale: 0.3, finH: 0.2, selfTaxi: true, walk: true, vmax: 240, cruise: 11000 },
};
export const SIZE_RANK = { S: 0, M: 1, L: 2 };

// Fiktive Airlines
export const AIRLINES = {
  AUR: { code: 'AUR', name: 'Aurora Airways', tel: 'Aurora', color: '#e63946', color2: '#ffffff', types: ['A320', 'A321', 'B789'] },
  RHJ: { code: 'RHJ', name: 'Rheinjet', tel: 'Rheinjet', color: '#1d4ed8', color2: '#fbbf24', types: ['A320', 'E190', 'A321', 'CRJ9'] },
  ALP: { code: 'ALP', name: 'Alpina Air', tel: 'Alpina', color: '#059669', color2: '#ffffff', types: ['E190', 'AT76', 'A320'] },
  NST: { code: 'NST', name: 'Nordstern', tel: 'Nordstern', color: '#7c3aed', color2: '#fde047', types: ['B738', 'A320'] },
  SKB: { code: 'SKB', name: 'SkyBridge', tel: 'Skybridge', color: '#f59e0b', color2: '#1f2937', types: ['B738', 'A321'] },
  OPL: { code: 'OPL', name: 'Orient Pearl', tel: 'Pearl', color: '#db2777', color2: '#fde68a', types: ['A359', 'B77W', 'B789', 'A333'] },
  TGC: { code: 'TGC', name: 'Transglobal Cargo', tel: 'Transglobal', color: '#92400e', color2: '#fbbf24', types: ['B748F', 'B77F'], cargo: true },
  BWG: { code: 'BWG', name: 'Balticwings', tel: 'Baltic', color: '#0891b2', color2: '#ffffff', types: ['AT76', 'E190', 'DH8D'] },
  LUM: { code: 'LUM', name: 'Lumen Air', tel: 'Lumen', color: '#84cc16', color2: '#312e81', types: ['A223', 'A320', 'B738'] },
  FJW: { code: 'FJW', name: 'Fjordwing', tel: 'Fjordwing', color: '#0f766e', color2: '#f8fafc', types: ['DH8D', 'CRJ9', 'E190'] },
  VIP: { code: 'VIP', name: 'Executive Charter', tel: 'Exec', color: '#111827', color2: '#d4af37', types: ['C68A'], special: true },
  GOV: { code: 'GOV', name: 'Regierungsstaffel', tel: 'State', color: '#f8fafc', color2: '#1e3a8a', types: ['A333'], special: true },
  // Karriere: Privatflieger und Partner am kleinen Platz (Rufzeichen = Kennzeichen, z. B. D-EKLM)
  GAV: { code: 'GAV', name: 'Privatflieger', tel: 'Private', color: '#1d4ed8', color2: '#ffffff', types: ['C172', 'PA28', 'DR40'], special: true, ga: true },
  FSH: { code: 'FSH', name: 'Flugschule Himmelblau', tel: 'Himmelblau', color: '#0ea5e9', color2: '#ffffff', types: ['C172', 'C172', 'DR40'], special: true, ga: true, partner: 'school' },
  SKD: { code: 'SKD', name: 'Fallschirmclub Freifall', tel: 'Freifall', color: '#f97316', color2: '#111827', types: ['PC12'], special: true, ga: true, partner: 'skydive' },
  RFS: { code: 'RFS', name: 'Rundflug-Service Panorama', tel: 'Panorama', color: '#dc2626', color2: '#ffffff', types: ['C172', 'PA28'], special: true, ga: true, partner: 'scenic' },
  ATX: { code: 'ATX', name: 'Alpenblick Lufttaxi', tel: 'Alpenblick', color: '#334155', color2: '#e2e8f0', types: ['PC12', 'BE20'], special: true, partner: 'taxi' },
};

// Ziele: brg = Peilung vom Flughafen, cat = Distanzklasse
export const CITIES = {
  PMI: { name: 'Palma', brg: 205, cat: 'mid' }, AYT: { name: 'Antalya', brg: 135, cat: 'mid' }, LHR: { name: 'London', brg: 285, cat: 'short' },
  CDG: { name: 'Paris', brg: 260, cat: 'short' }, MAD: { name: 'Madrid', brg: 235, cat: 'mid' }, FCO: { name: 'Rom', brg: 170, cat: 'mid' },
  VIE: { name: 'Wien', brg: 115, cat: 'short' }, ZRH: { name: 'Zürich', brg: 190, cat: 'short' }, CPH: { name: 'Kopenhagen', brg: 10, cat: 'short' },
  ARN: { name: 'Stockholm', brg: 20, cat: 'short' }, OSL: { name: 'Oslo', brg: 355, cat: 'short' }, AMS: { name: 'Amsterdam', brg: 290, cat: 'short' },
  BCN: { name: 'Barcelona', brg: 220, cat: 'mid' }, LIS: { name: 'Lissabon', brg: 245, cat: 'mid' }, ATH: { name: 'Athen', brg: 145, cat: 'mid' },
  IST: { name: 'Istanbul', brg: 125, cat: 'mid' }, DXB: { name: 'Dubai', brg: 115, cat: 'long' }, JFK: { name: 'New York', brg: 295, cat: 'long' },
  SIN: { name: 'Singapur', brg: 95, cat: 'long' }, HND: { name: 'Tokio', brg: 40, cat: 'long' }, ORD: { name: 'Chicago', brg: 310, cat: 'long' },
  DOH: { name: 'Doha', brg: 120, cat: 'long' }, WAW: { name: 'Warschau', brg: 80, cat: 'short' }, PRG: { name: 'Prag', brg: 100, cat: 'short' },
  BUD: { name: 'Budapest', brg: 120, cat: 'short' }, HER: { name: 'Heraklion', brg: 150, cat: 'mid' }, TFS: { name: 'Teneriffa', brg: 225, cat: 'mid' },
  HRG: { name: 'Hurghada', brg: 140, cat: 'mid' }, RIX: { name: 'Riga', brg: 50, cat: 'short' }, HEL: { name: 'Helsinki', brg: 35, cat: 'short' },
  DUB: { name: 'Dublin', brg: 285, cat: 'short' }, NCE: { name: 'Nizza', brg: 200, cat: 'short' }, OLB: { name: 'Olbia', brg: 190, cat: 'mid' },
  LEJ: { name: 'Leipzig', brg: 85, cat: 'short' }, HKG: { name: 'Hongkong', brg: 70, cat: 'long' }, PVG: { name: 'Shanghai', brg: 60, cat: 'long' },
  YYZ: { name: 'Toronto', brg: 300, cat: 'long' }, GVA: { name: 'Genf', brg: 205, cat: 'short' },
  // kleine Plätze in der Umgebung (Karriere: Privatflieger, Rundflüge)
  LND: { name: 'Lindenau', brg: 40, cat: 'ga' }, SEF: { name: 'Seefeld', brg: 160, cat: 'ga' }, BRH: { name: 'Bergheim', brg: 215, cat: 'ga' },
  KRD: { name: 'Kirchdorf', brg: 300, cat: 'ga' }, WBR: { name: 'Waldbrunn', brg: 95, cat: 'ga' }, HSL: { name: 'Hasselfeld', brg: 340, cat: 'ga' },
  RND: { name: 'Rundflug', brg: 250, cat: 'local' }, JMP: { name: 'Absetzflug', brg: 180, cat: 'local' }, PLR: { name: 'Platzrunde', brg: 0, cat: 'local' },
};

// Bodenfahrzeuge
export const VEH_TYPES = {
  tug: { id: 'tug', name: 'Pushback-Schlepper', short: 'Schlepper', sprite: 'veh_tug', len: 0.42, price: 180000, upkeep: 140, speed: 0.2, color: '#facc15' },
  baggage: { id: 'baggage', name: 'Gepäckzug', short: 'Gepäck', sprite: 'veh_baggage', len: 0.95, price: 90000, upkeep: 90, speed: 0.2, color: '#f59e0b' },
  fuel: { id: 'fuel', name: 'Tankwagen', short: 'Tank', sprite: 'veh_fuel', len: 0.78, price: 220000, upkeep: 160, speed: 0.18, color: '#ef4444' },
  catering: { id: 'catering', name: 'Catering-LKW', short: 'Catering', sprite: 'veh_catering', len: 0.62, price: 160000, upkeep: 110, speed: 0.19, color: '#e5e7eb' },
  cleaning: { id: 'cleaning', name: 'Reinigungsteam', short: 'Reinigung', sprite: 'veh_cleaning', len: 0.36, price: 60000, upkeep: 60, speed: 0.22, color: '#22c55e' },
  bus: { id: 'bus', name: 'Vorfeldbus', short: 'Bus', sprite: 'veh_bus', len: 0.8, price: 300000, upkeep: 150, speed: 0.19, color: '#3b82f6' },
  deice: { id: 'deice', name: 'Enteisungsfahrzeug', short: 'Enteiser', sprite: 'veh_deice', len: 0.82, price: 380000, upkeep: 170, speed: 0.17, color: '#f97316' },
};

// Abfertigungs-Aufgaben (Basisdauer in Minuten für A320)
export const TASKS = {
  deboard: { name: 'Aussteigen', short: 'Aus', icon: '🚶', base: 8, pax: true },
  unload: { name: 'Entladen', short: 'Ent', icon: '🧳', base: 10, veh: 'baggage' },
  clean: { name: 'Reinigung', short: 'Rein', icon: '🧽', base: 11, veh: 'cleaning', pax: true },
  cater: { name: 'Catering', short: 'Cat', icon: '🍱', base: 9, veh: 'catering', pax: true },
  fuel: { name: 'Betankung', short: 'Tank', icon: '⛽', base: 12, veh: 'fuel' },
  board: { name: 'Einsteigen', short: 'Ein', icon: '🎫', base: 16, pax: true },
  load: { name: 'Beladen', short: 'Bel', icon: '📦', base: 11, veh: 'baggage' },
  deice: { name: 'Enteisung', short: 'Eis', icon: '❄️', base: 7, veh: 'deice' },
  push: { name: 'Pushback', short: 'Push', icon: '🚜', base: 0, veh: 'tug' },
};
export const TASK_ORDER = ['deboard', 'unload', 'clean', 'cater', 'fuel', 'board', 'load', 'deice', 'push'];

// Fixkosten pro Tag
export const COSTS = {
  staffDaily: 260, // pro Bodenmitarbeiter
  atcDaily: 14000,
  standDaily: 1100,
  terminalDaily: 22000,
  runwayDaily: 9000,
  adminDaily: 16000,
  utilitiesDaily: 7000,
  delayPerMin: 45, // Vertragsstrafe je Minute über 15 min (Abfertigung/ATC verschuldet)
};

export const DEFAULT_FEES = { landing: 7.5, pax: 14, parking: 90 };
export const FEE_LIMITS = { landing: [2, 20], pax: [4, 35], parking: [20, 250], night: [0, 4000] };

// Ausbau-Katalog
export const UPGRADES = {
  retail: { name: 'Shopping & Gastronomie', desc: 'Mehr Umsatz je Passagier (+30 % je Stufe).', max: 3, cost: [900000, 1600000, 2800000], cat: 'Terminal' },
  security: { name: 'Sicherheitsspuren', desc: 'Kürzere Wartezeiten, zufriedenere Passagiere.', max: 3, cost: [600000, 1100000, 1800000], cat: 'Terminal' },
  lounge: { name: 'Premium-Lounge', desc: 'Langstrecken-Airlines zufriedener, mehr Angebote.', max: 1, cost: [1400000], cat: 'Terminal' },
  parking: { name: 'Parkhaus-Ausbau', desc: 'Parkerlöse +40 % je Stufe.', max: 2, cost: [1500000, 2400000], cat: 'Landseite' },
  hotel: { name: 'Flughafen-Hotel', desc: 'Täglicher Zusatzerlös und mehr Ansehen.', max: 1, cost: [4200000], cat: 'Landseite' },
  rwy2: { name: 'Parallelbahn Süd (09R/27L)', icon: '🛬', big: true, desc: 'Zweite Start- und Landebahn mit Parallelrollweg B: Landungen auf der Südbahn, Starts auf der Nordbahn – deutlich mehr Kapazität, Pistenarbeiten ohne Betriebsstopp.', more: 'Ankünfte kreuzen danach die Startbahn (Kreuzungsfreigabe durch den Tower). Laufende Kosten: +9.000 €/Tag.', max: 1, cost: [9500000], cat: 'Pisten' },
  ils3: { name: 'ILS CAT III', desc: 'Landungen auch bei dichtem Nebel möglich.', max: 1, cost: [3000000], cat: 'Betrieb' },
  rapidExit: { name: 'Schnellabrollwege', desc: 'Kürzere Pistenbelegung nach der Landung.', max: 1, cost: [2500000], cat: 'Betrieb' },
  apronLights: { name: 'LED-Vorfeldbeleuchtung', desc: 'Nachts 15 % schnellere Abfertigung, weniger Stromkosten.', max: 1, cost: [700000], cat: 'Betrieb' },
  solar: { name: 'Solarpark', icon: '☀️', desc: 'Photovoltaik südlich der Piste: Energiekosten −60 %, Stromverkauf ca. 9.000 €/Tag, Ansehen +4 („grüner Flughafen“).', max: 1, cost: [1200000], cat: 'Betrieb' },
  rail: { name: 'Flughafen-Bahnhof', icon: '🚆', big: true, desc: 'S-Bahn-Anschluss direkt am Terminal: mehr Airline-Angebote (+20 %), Ansehen +5, Anteil an Fahrkarten ca. 7.000 €/Tag – dafür 15 % weniger Parkerlöse.', more: 'Züge fahren sichtbar ein und aus; weniger Autos auf der Landseite.', max: 1, cost: [5200000], cat: 'Landseite' },
};

export const STAND_COSTS = { contactM: 1800000, contactL: 2600000, remote: 700000, upgradeL: 900000 };
export const MARKETING = { cost: 350000, days: 5 };

// Anzeige: Typkürzel und Typname (fiktiv)
export const typeCode = (t) => (AC_TYPES[t] && AC_TYPES[t].code) || t;
export const typeName = (t) => (AC_TYPES[t] && AC_TYPES[t].name) || t;
