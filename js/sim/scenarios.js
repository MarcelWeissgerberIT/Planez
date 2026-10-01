// Herausforderungen: kurze Szenarien je Station mit festem Start (Uhrzeit, Wetter, Jahreszeit, Kasse),
// Drehbuch-Ereignissen, Zeitlimit und Zielen mit 1–3 Sternen. Bestwerte bleiben im Browser gespeichert.
import { IS_DEMO, DEMO } from '../edition.js';
import { vfrState } from './vfr.js';
import { heliState } from './heli.js';
import { notify, log, radio } from './messages.js';
import { triggerEvent } from './events.js';
import { requestRunwayChange } from './atc.js';
import { fmtMoney, rand } from '../util.js';
import { AC_TYPES, AIRLINES } from '../config.js';
import { nextId } from './schedule.js';
import { T } from '../i18n.js';

const H = 3600;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// Stoßzeit: jede Welle bringt mehr zusätzliche Anflüge (1, 1, 1, 2, 2, 2, 3 …) aus den vorhandenen Linien;
// nach jeder vollen Stunde gibt es einen Schichtbonus (1 aus 3)
function rushWave(s, i) {
  const sc = s.scenario;
  if ((i + 1) % 4 === 0 && i < 30) offerShiftBonus(s);
  if (sc.skip > 0) {
    sc.skip--;
    notify(s, T('🌤️ Atempause: Diese Welle fällt aus.'), 'good');
    return;
  }
  const n = Math.max(1, 1 + Math.floor(i / 3) - (sc.minus || 0));
  const gap = sc.spread ? 160 : 90;
  const cs = s.contracts.filter((c) => !c.cargo && AC_TYPES[c.type] && AC_TYPES[c.type].size !== 'L' && AIRLINES[c.airline]);
  if (!cs.length) return;
  for (let k = 0; k < n; k++) {
    const c = cs[Math.floor(rand(s) * cs.length)];
    const t = AC_TYPES[c.type];
    const al = AIRLINES[c.airline];
    const fn = 600 + ((i * 7 + k * 3) % 380);
    const sta = s.time + Math.round((21 + (k * gap) / 30 + Math.round(rand(s) * 4)) * 60);
    const rot = {
      id: nextId(s, 'r'), contract: c.id, airline: c.airline, type: c.type, arrNo: `${al.code}${fn}`, depNo: `${al.code}${fn + 1}`, city: c.city,
      sta, std: sta + t.turn * 60 + 15 * 60, arrDelay: 0,
      paxIn: Math.round(t.pax * 0.85), paxOut: Math.round(t.pax * 0.8), cargoIn: Math.round(t.pax * 0.01), cargoOut: Math.round(t.pax * 0.012),
      status: 'planned', feeMult: c.feeMult || 1, spawnAt: s.time + k * gap, ac: null,
    };
    s.rots[rot.id] = rot;
  }
  notify(s, n > 1 ? T`⏱️ Neue Welle: ${n} zusätzliche Anflüge` : T('⏱️ Neue Welle: ein zusätzlicher Anflug'), 'warn');
}
export const SHIFT_BONI = {
  buffer: { icon: '🛡️', name: () => T('Rückendeckung'), desc: () => T('Ein Vorfall mehr, bevor du abgelöst wirst.') },
  smaller: { icon: '✂️', name: () => T('Kleinere Wellen'), desc: () => T('Jede weitere Welle bringt einen Anflug weniger (mindestens einen).') },
  calm: { icon: '🌤️', name: () => T('Atempause'), desc: () => T('Die nächste Welle fällt aus.') },
  spread: { icon: '📡', name: () => T('Anflugkoordinator'), desc: () => T('Die Anflüge einer Welle kommen mit deutlich größerem Abstand.') },
  fuel: { icon: '⛽', name: () => T('Volle Tanks'), desc: () => T('Alle Anflüge – auch die schon in der Luft – haben 10 Minuten mehr Treibstoff.') },
};
const BONUS_AI = ['buffer', 'smaller', 'calm', 'spread', 'fuel'];
function offerShiftBonus(s) {
  const sc = s.scenario;
  const pool = Object.keys(SHIFT_BONI).filter((k) => !(k === 'spread' && sc.spread));
  const opts = [];
  while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]);
  sc.bonusChoice = { opts, hour: Math.round((s.time - sc.start) / H) };
  if (s.auto.atc) chooseShiftBonus(s, BONUS_AI.find((k) => opts.includes(k)));
}
export function chooseShiftBonus(s, k) {
  const sc = s.scenario;
  if (!sc || !sc.bonusChoice || !sc.bonusChoice.opts.includes(k)) return;
  sc.bonusChoice = null;
  (sc.boni = sc.boni || []).push(k);
  if (k === 'buffer') sc.lives = (sc.lives || 0) + 1;
  else if (k === 'smaller') sc.minus = (sc.minus || 0) + 1;
  else if (k === 'calm') sc.skip = (sc.skip || 0) + 1;
  else if (k === 'spread') sc.spread = true;
  else if (k === 'fuel') {
    sc.fuelPlus = (sc.fuelPlus || 0) + 10;
    for (const ac of s.acs) if (ac.arr && ac.fuelMin !== undefined) ac.fuelMin += 10;
  }
  notify(s, T`${SHIFT_BONI[k].icon} Schichtbonus: ${SHIFT_BONI[k].name()}`, 'good');
}
export const shiftLimit = (s) => 3 + ((s.scenario && s.scenario.lives) || 0);

// Kennzahlen aus den Zählern (Zuwachs seit Szenariostart)
function metrics(state) {
  const sc = state.scenario;
  const L = state.life || {};
  const d = (k) => (L[k] || 0) - (sc.base[k] || 0);
  const a = sc.acc;
  const deps = (a.mov || 0) - d('landings');
  return {
    landings: d('landings'),
    deps: Math.max(0, deps),
    mov: a.mov || 0,
    pax: d('pax'),
    punct: (a.onTime || 0) + (a.delayed || 0) ? pct(a.onTime || 0, (a.onTime || 0) + (a.delayed || 0)) : null,
    depsDone: (a.onTime || 0) + (a.delayed || 0),
    onTime: a.onTime || 0,
    incidents: a.incidents || 0,
    goArounds: a.goArounds || 0,
    diversions: a.diversions || 0,
    slotMiss: a.slotMiss || 0,
    wakeInf: a.wakeInf || 0,
    emg: d('emgLanded'),
    deiced: d('deiced'),
    cash: state.cash,
    rep: Math.round(state.reputation),
    rwy2: state.upgrades.rwy2 ? 1 : 0,
    side: d('touchGo') + d('heliX'),
    mins: Math.round((state.time - sc.start) / 60),
  };
}
// Tageszähler aufsummieren (auch über den Tageswechsel hinweg)
const ACC_KEYS = ['mov', 'onTime', 'delayed', 'incidents', 'goArounds', 'diversions', 'slotMiss', 'wakeInf'];
function accumulate(state) {
  const sc = state.scenario;
  const t = state.stats.today;
  for (const k of ACC_KEYS) {
    const cur = t[k] || 0;
    const last = sc.last[k] || 0;
    sc.acc[k] = (sc.acc[k] || 0) + (cur >= last ? cur - last : cur);
    sc.last[k] = cur;
  }
}

// Sterne eines Ziels: t = Schwellen für 1/2/3 Sterne; low = kleiner ist besser
export function goalStars(g, v) {
  if (v == null) return 0;
  let n = 0;
  for (let i = 0; i < 3; i++) if (g.low ? v <= g.t[i] : v >= g.t[i]) n = i + 1;
  return n;
}
const fmt = (g, v) => (v == null ? '—' : g.money ? fmtMoney(v) : g.unit ? `${v} ${g.unit}` : String(v));
export const goalValue = (g, v) => fmt(g, v);
export const goalNeed = (g, i) => (g.low ? `≤ ${fmt(g, g.t[i])}` : `≥ ${fmt(g, g.t[i])}`);

// ---------- Drehbuch-Aktionen ----------
function setWeather(state, kind, hours, extra = {}) {
  state.weather.kind = kind;
  state.weather.until = state.time + hours * H;
  state.weather.cells = [];
  state.weather.rvr = extra.rvr ?? null;
  if (kind === 'storm') state.weather.cells = [{ x: 8, y: -12, r: 6 }, { x: -18, y: 10, r: 5 }, { x: 24, y: 18, r: 4 }];
  if (kind === 'fog') state.stats.today.hadFog = true;
}
function windShift(state, dir, spd) {
  const w = state.wind;
  w.tDir = dir;
  w.tSpd = spd;
  w.dir = dir;
  w.spd = spd;
  w.nextChange = state.time + 12 * H;
}

export const SCENARIOS = [
  {
    id: 'morning', role: 'tower', icon: '🌅', diff: 1, title: T('Morgenwelle'), img: 'assets/scn/morning.webp',
    brief: T('Montagmorgen, 6 Uhr: Die erste Welle rollt an – dichter Anflugverkehr und volle Rollhalte. Bring so viele Flüge wie möglich sicher auf und von der Bahn.'),
    tips: [T('Auto-Staffelung an lassen und die Reihenfolge per Ziehen anpassen'), T('Starts in die Lücken zwischen zwei Landungen legen'), T('Landefreigabe früh geben (L)')],
    hour: 6, dur: 2.5 * H, density: 1.35,
    setup: (s) => {
      setWeather(s, 'clear', 4);
      windShift(s, 255, 8);
    },
    goals: [
      { text: T('Bewegungen (Landungen + Starts)'), key: 'mov', t: [14, 19, 23] },
      { text: T('Durchstarts'), key: 'goArounds', t: [3, 1, 0], low: true },
      { text: T('Vorfälle'), key: 'incidents', t: [1, 0, 0], low: true },
    ],
    fail: (m) => (m.incidents >= 3 ? T('Drei Vorfälle – die Schicht wurde abgelöst.') : null),
  },
  {
    id: 'fog', role: 'tower', icon: '🌫️', diff: 2, title: T('Nebelsuppe'), img: 'assets/scn/fog.webp',
    brief: T('Dichter Morgennebel, RVR 600 m: Low Visibility Procedures sind aktiv, Anflüge brauchen mehr Abstand. Keiner soll ausweichen müssen – und die Starts dürfen nicht liegen bleiben.'),
    tips: [T('Im Nebel gelten größere Abstände – nicht zu dicht staffeln'), T('Treibstoff der Warteschleifen im Blick behalten'), T('Slots (CTOT) der Starts einhalten')],
    hour: 6, dur: 3 * H, density: 1.1,
    setup: (s) => {
      setWeather(s, 'fog', 3.2, { rvr: 600 });
      windShift(s, 260, 4);
    },
    script: [
      { at: 95 * 60, run: (s) => { s.weather.rvr = 800; log(s, 'sys', T('Wetterdienst: Sicht bessert sich langsam, RVR 800 m.')); } },
    ],
    goals: [
      { text: T('Landungen'), key: 'landings', t: [7, 10, 13] },
      { text: T('Ausweichlandungen'), key: 'diversions', t: [2, 1, 0], low: true },
      { text: T('Starts'), key: 'deps', t: [6, 9, 12] },
    ],
    fail: (m) => (m.incidents >= 3 ? T('Drei Vorfälle – die Schicht wurde abgelöst.') : null),
  },
  {
    id: 'storm', role: 'tower', icon: '⛈️', diff: 3, title: T('Gewitterfront'), img: 'assets/scn/storm.webp',
    brief: T('Am Nachmittag zieht eine Gewitterfront durch. Der Wind dreht, die Betriebsrichtung muss gewechselt werden – und mitten im Chaos meldet ein Flugzeug einen Notfall.'),
    tips: [T('Beim Pistenwechsel erst alle laufenden Bewegungen abwickeln'), T('Notfälle haben Vorrang: Direkt FAF (D) und sofort Landefreigabe'), T('Nach Durchstarts ruhig neu einreihen')],
    hour: 14, dur: 3 * H, density: 1.2,
    setup: (s) => {
      setWeather(s, 'clouds', 0.6);
      windShift(s, 250, 12);
    },
    script: [
      { at: 30 * 60, run: (s) => { setWeather(s, 'storm', 1.2); notify(s, T('⛈️ Gewitter über dem Platz – Vorfeld gesperrt, Böen bis 30 kt'), 'warn'); } },
      { at: 50 * 60, run: (s) => { windShift(s, 95, 14); log(s, 'sys', T('Wetterdienst: Winddrehung auf 090°, 14 kt – Rückenwind auf Piste 27.')); notify(s, T('🧭 Wind dreht auf Ost – Betriebsrichtung 09 anordnen!'), 'warn'); if (s.auto.atc) requestRunwayChange(s, '09'); } },
      { at: 75 * 60, run: (s) => triggerEvent(s, 'emergency') },
      { at: 105 * 60, run: (s) => setWeather(s, 'rain', 2) },
    ],
    goals: [
      { text: T('Bewegungen'), key: 'mov', t: [9, 13, 17] },
      { text: T('Notfall sicher gelandet'), key: 'emg', t: [1, 1, 1] },
      { text: T('Vorfälle'), key: 'incidents', t: [2, 1, 0], low: true },
    ],
    fail: (m) => (m.incidents >= 4 ? T('Zu viele Vorfälle – die Schicht wurde abgelöst.') : null),
  },
  {
    id: 'mayday', role: 'tower', icon: '🚨', diff: 2, title: T('Notfall-Schicht'), img: 'assets/scn/mayday.webp',
    brief: T('Ein ganz normaler Vormittag – bis kurz nacheinander ein MAYDAY und ein Vogelschlag gemeldet werden. Notfälle zuerst, der Rest des Verkehrs läuft weiter.'),
    tips: [T('Squawk 7700 ist rot markiert – sofort nach vorne ziehen'), T('Die Feuerwehr fährt automatisch raus'), T('Andere Anflüge in die Warteschleife (H)')],
    hour: 9, dur: 2 * H, density: 1.1,
    setup: (s) => {
      setWeather(s, 'clouds', 3);
      windShift(s, 265, 9);
    },
    script: [
      { at: 12 * 60, run: (s) => triggerEvent(s, 'emergency') },
      { at: 55 * 60, run: (s) => { if (!triggerEvent(s, 'birdstrike')) s.scenario.retry = { at: s.time + 300, kind: 'birdstrike' }; } },
      { at: 80 * 60, run: (s) => triggerEvent(s, 'emergency') },
    ],
    goals: [
      { text: T('Notfälle sicher gelandet'), key: 'emg', t: [1, 2, 3] },
      { text: T('Bewegungen'), key: 'mov', t: [9, 13, 17] },
      { text: T('Vorfälle'), key: 'incidents', t: [1, 0, 0], low: true },
    ],
    fail: (m) => (m.incidents >= 3 ? T('Drei Vorfälle – die Schicht wurde abgelöst.') : null),
  },
  {
    id: 'flytag', role: 'tower', icon: '🛩️', diff: 3, title: T('Großer Flugtag'), img: 'assets/scn/flytag.webp', side: true,
    brief: T('Sonnenschein und ein voller Himmel: Die Flugschule übt Platzrunden, der Rettungshubschrauber will mehrmals über die Bahnen, und am Vormittag landet ein Staatsgast. Dazwischen läuft der Linienverkehr ganz normal weiter.'),
    tips: [T('Touch and Go nur in echte Lücken – sonst kreist die Alcedo'), T('Rescue 7 schwebt südlich: Querung frei, wenn niemand im Endanflug ist'), T('Die Regierungsmaschine 🎖️ ohne Warteschleife hereinholen')],
    hour: 9.5, dur: 2 * H, density: 1,
    setup: (s) => {
      setWeather(s, 'clear', 4);
      windShift(s, 262, 8);
    },
    script: [
      { at: 60, run: (s) => { vfrState(s).next = s.time; } },
      { at: 20 * 60, run: (s) => retry(s, 'state') },
      { at: 35 * 60, run: (s) => { heliState(s).next = s.time; } },
      { at: 70 * 60, run: (s) => { const V = vfrState(s); if (!V.p) V.next = s.time; } },
      { at: 85 * 60, run: (s) => { const Hs = heliState(s); if (!Hs.h) Hs.next = s.time; } },
    ],
    goals: [
      { text: T('Bewegungen'), key: 'mov', t: [9, 12, 15] },
      { text: T('Nebenverkehr (Touch and Go, Heli-Querungen)'), key: 'side', t: [4, 7, 10] },
      { text: T('Vorfälle'), key: 'incidents', t: [1, 0, 0], low: true },
    ],
    fail: (m) => (m.incidents >= 3 ? T('Drei Vorfälle – die Schicht wurde abgelöst.') : null),
  },
  {
    id: 'rushhour', role: 'tower', icon: '⏱️', diff: 3, title: T('Stoßzeit (endlos)'), img: 'assets/scn/rushhour.webp', endless: true,
    brief: T('Kein Feierabend in Sicht: Alle 15 Minuten kommt eine neue Welle Anflüge – und jede ist größer als die letzte. Nach jeder vollen Stunde wählst du einen Schichtbonus. Wie lange hältst du die Bahn sicher? Beim dritten Vorfall wirst du abgelöst.'),
    tips: [T('Starts konsequent in die Lücken legen, sonst stauen sich die Rollhalte'), T('Warteschleifen früh nutzen, bevor der Treibstoff knapp wird'), T('Lieber ein Durchstart als ein Vorfall')],
    hour: 7, dur: 8 * H, density: 1.2,
    setup: (s) => {
      setWeather(s, 'clear', 9);
      windShift(s, 255, 7);
    },
    script: Array.from({ length: 31 }, (_, i) => ({ at: (i + 1) * 15 * 60, run: (s) => rushWave(s, i) })),
    goals: [
      { text: T('Überstandene Minuten'), key: 'mins', t: [90, 180, 300] },
      { text: T('Bewegungen (Landungen + Starts)'), key: 'mov', t: [30, 60, 100] },
    ],
    fail: (m, s) => (m.incidents >= shiftLimit(s) ? T`${m.incidents} Vorfälle – die Schicht wurde abgelöst.` : null),
  },
  {
    id: 'rushGround', role: 'ground', icon: '🧳', diff: 1, title: T('Ferienstart'), img: 'assets/scn/rush.webp',
    brief: T('Die Sommerferien beginnen: Jede Maschine ist voll, die Umläufe sind knapp geplant. Halte die Abflüge pünktlich.'),
    tips: [T('⚡ Alles bedienen (D) schickt alle bereiten Fahrzeuge'), T('Tankwagen rechtzeitig nachfüllen lassen'), T('Dringendste Abfertigung steht oben')],
    hour: 6, dur: 3 * H, density: 1.3,
    setup: (s) => {
      s.seasonFix = 'summer';
      setWeather(s, 'clear', 4);
    },
    goals: [
      { text: T('Pünktlichkeit'), key: 'punct', unit: '%', t: [75, 85, 93] },
      { text: T('Abflüge abgefertigt'), key: 'depsDone', t: [8, 11, 14] },
    ],
  },
  {
    id: 'strike', role: 'ground', icon: '✊', diff: 2, title: T('Streiktag'), img: 'assets/scn/strike.webp',
    brief: T('Warnstreik beim Bodenpersonal, zwei Fahrzeuge sind in der Werkstatt. Mit halber Mannschaft muss der Betrieb trotzdem laufen.'),
    tips: [T('Fahrzeuge nach Dringlichkeit einsetzen'), T('Kurze Wege: Positionen nah am Depot bevorzugen'), T('Gepäck und Tanken zuerst – Reinigung kann warten')],
    hour: 8, dur: 3 * H, density: 1.1,
    setup: (s) => {
      setWeather(s, 'clouds', 4);
      triggerEvent(s, 'strike', { hours: 3.5 });
      triggerEvent(s, 'breakdown', { type: 'baggage', hours: 3.5 });
      triggerEvent(s, 'breakdown', { type: 'tug', hours: 2 });
    },
    goals: [
      { text: T('Pünktlichkeit'), key: 'punct', unit: '%', t: [55, 68, 80] },
      { text: T('Abflüge abgefertigt'), key: 'depsDone', t: [7, 10, 13] },
    ],
  },
  {
    id: 'winter', role: 'ground', icon: '❄️', diff: 3, title: T('Winterchaos'), img: 'assets/scn/winter.webp',
    brief: T('Starker Schneefall am frühen Morgen. Jeder Abflug muss enteist werden, die Räumdienste sperren immer wieder die Bahn. Kriegst du die Welle trotzdem raus?'),
    tips: [T('Enteisung ❄️ ist die letzte Aufgabe vor dem Pushback'), T('Enteisungsfahrzeug früh losschicken'), T('Im Schnee fahren alle langsamer – Puffer einplanen')],
    hour: 6, dur: 3 * H, density: 1.1,
    setup: (s) => {
      s.seasonFix = 'winter';
      s.tempBias = 3;
      s.snow = 0.55;
      s.rwySnow = { N: 0.18, S: 0 };
      setWeather(s, 'snow', 2.5);
    },
    goals: [
      { text: T('Pünktlichkeit'), key: 'punct', unit: '%', t: [60, 75, 88] },
      { text: T('Flugzeuge enteist'), key: 'deiced', t: [5, 8, 11] },
      { text: T('Abflüge abgefertigt'), key: 'depsDone', t: [6, 9, 12] },
    ],
  },
  {
    id: 'rescue', role: 'manager', icon: '📉', diff: 2, title: T('Sanierungsfall'), img: 'assets/scn/rescue.webp',
    brief: T('Der Vorgänger hat den Flughafen heruntergewirtschaftet: Die Kasse ist im Minus, das Ansehen im Keller. Du hast zwei Tage, um das Ruder herumzureißen.'),
    tips: [T('Gebühren prüfen – zu hoch vergrault Airlines, zu niedrig kostet Geld'), T('Kerosin günstig einkaufen und mit Marge verkaufen'), T('Keine teuren Bauten ohne Rendite')],
    hour: 6, dur: 48 * H, density: 1,
    setup: (s) => {
      s.cash = -1500000;
      s.reputation = 40;
      for (const c of s.contracts) c.sat = Math.min(c.sat ?? 70, 55);
    },
    goals: [
      { text: T('Kasse'), key: 'cash', money: true, t: [0, 480000, 1500000] },
      { text: T('Ansehen'), key: 'rep', t: [42, 48, 55] },
    ],
    fail: (m, s) => (s.cash < -4000000 ? T('Die Bank hat den Kreditrahmen gekündigt.') : null),
  },
  {
    id: 'growth', role: 'manager', icon: '🏗️', diff: 3, title: T('Wachstumskurs'), img: 'assets/scn/growth.webp',
    brief: T('Die Investoren wollen Wachstum: In drei Tagen soll die Parallelbahn in Betrieb sein und der Flughafen deutlich mehr Passagiere abfertigen – ohne pleite zu gehen.'),
    tips: [T('Parallelbahn früh starten – sie braucht 40 Stunden Bauzeit'), T('Mehr Verträge nur, wenn die Piste es hergibt'), T('Kredite helfen bei der Finanzierung')],
    hour: 6, dur: 72 * H, density: 1.1,
    setup: (s) => {
      s.cash = 12000000;
    },
    goals: [
      { text: T('Parallelbahn in Betrieb'), key: 'rwy2', t: [1, 1, 1] },
      { text: T('Passagiere'), key: 'pax', t: [30000, 38000, 44000] },
      { text: T('Ansehen'), key: 'rep', t: [64, 72, 78] },
    ],
    fail: (m, s) => (s.cash < -5000000 ? T('Die Investoren haben die Reißleine gezogen.') : null),
  },
];
export const scenarioById = (id) => (id && id.startsWith('daily-') ? dailyDef(id.slice(6)) : SCENARIOS.find((x) => x.id === id));

// ---------- Tagesherausforderung ----------
// Jeden Kalendertag eine neue Mischung: Grund-Szenario (Tower/Vorfeld) + zwei Zusatzregeln, fester Zufall für alle
const DAILY_BASES = ['morning', 'fog', 'storm', 'mayday', 'rushGround', 'strike', 'winter'];
const retry = (s, kind) => {
  if (!triggerEvent(s, kind)) s.scenario.retry = { at: s.time + 300, kind };
};
export const MUTATORS = {
  dense: { icon: '📈', name: T('Hochbetrieb'), text: T('25 % mehr Verkehr – die Zielwerte liegen höher'), roles: ['tower', 'ground'] },
  nordo: { icon: '📻', name: T('Funkausfall'), text: T('Ein anfliegendes Flugzeug verliert den Funk – Lichtsignale geben'), roles: ['tower'], at: 35 * 60, run: (s) => retry(s, 'nordo') },
  a380: { icon: '🐋', name: T('Superjumbo'), text: T('Eine AV-38 kommt zu Besuch'), roles: ['tower', 'ground'], at: 25 * 60, run: (s) => retry(s, 'a380') },
  vip: { icon: '🎖️', name: T('Staatsbesuch'), text: T('Eine Regierungsmaschine kommt – Landung ohne Warteschleife, Abflug pünktlich'), roles: ['tower', 'ground'], at: 15 * 60, run: (s) => retry(s, 'state') },
  birds: { icon: '🐦', name: T('Vogelzug'), text: T('Ein Vogelschlag mitten in der Schicht'), roles: ['tower'], at: 70 * 60, run: (s) => retry(s, 'birdstrike') },
  emergency: { icon: '🚨', name: T('Notfall'), text: T('Ein MAYDAY mitten in der Schicht'), roles: ['tower'], at: 50 * 60, run: (s) => triggerEvent(s, 'emergency') },
  gusts: {
    icon: '🧭', name: T('Winddrehung'), text: T('Nach einer Stunde dreht der Wind – Betriebsrichtung wechseln'), roles: ['tower'], at: 60 * 60,
    run: (s) => {
      windShift(s, (s.wind.dir + 180) % 360, 12);
      notify(s, T('🧭 Der Wind dreht – Betriebsrichtung wechseln!'), 'warn');
      if (s.auto.atc) requestRunwayChange(s, s.rwy === '27' ? '09' : '27');
    },
  },
  flightschool: { icon: '🛩️', name: T('Flugschule'), text: T('Eine Alcedo übt Platzrunden – Touch and Go in die Lücken setzen'), roles: ['tower'], not: ['fog', 'storm'], at: 5 * 60, run: (s) => { s.scenario.side = true; vfrState(s).next = s.time; } },
  airrescue: { icon: '🚁', name: T('Luftrettung'), text: T('Der Rettungshubschrauber will über die Bahnen – rechtzeitig queren lassen'), roles: ['tower'], at: 25 * 60, run: (s) => { s.scenario.side = true; heliState(s).next = s.time; } },
  tanker: { icon: '⛽', name: T('Tankwagen-Panne'), text: T('Ein Tankwagen fällt für zwei Stunden aus'), roles: ['ground'], at: 10 * 60, run: (s) => triggerEvent(s, 'breakdown', { type: 'fuel', hours: 2 }) },
  tugs: { icon: '🚜', name: T('Schlepper knapp'), text: T('Ein Pushback-Schlepper ist den ganzen Tag in der Werkstatt'), roles: ['ground'], at: 60, run: (s) => triggerEvent(s, 'breakdown', { type: 'tug', hours: 4 }) },
};
const COUNT_KEYS = ['mov', 'landings', 'deps', 'depsDone', 'deiced'];
export function dailyKey(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
export const dailyLabel = (key) => `${key.slice(6, 8)}.${key.slice(4, 6)}.${key.slice(0, 4)}`;
export function dailyDef(key = dailyKey()) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const rnd = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const baseId = DAILY_BASES[Math.floor(rnd() * DAILY_BASES.length)];
  const base = SCENARIOS.find((x) => x.id === baseId);
  const cands = Object.keys(MUTATORS).filter((k) => MUTATORS[k].roles.includes(base.role) && !(MUTATORS[k].not || []).includes(baseId));
  const muts = [];
  while (muts.length < 2 && cands.length) muts.push(cands.splice(Math.floor(rnd() * cands.length), 1)[0]);
  const dense = muts.includes('dense');
  const goals = base.goals.map((g) => ({ ...g, t: dense && !g.low && COUNT_KEYS.includes(g.key) ? g.t.map((v) => Math.round(v * 1.2)) : g.t }));
  const script = [...(base.script || []), ...muts.filter((m) => MUTATORS[m].at).map((m) => ({ at: MUTATORS[m].at, run: MUTATORS[m].run }))].sort((a, b) => a.at - b.at);
  return {
    ...base,
    id: 'daily-' + key,
    daily: key,
    sub: base.title,
    icon: '📅',
    title: T`Heute: ${base.title}`,
    density: base.density * (dense ? 1.25 : 1),
    seed: (h >>> 0) % 2147483647,
    script,
    goals,
    muts,
    brief: T`${base.brief} Heute zusätzlich: ${muts.map((m) => `${MUTATORS[m].icon} ${MUTATORS[m].name}`).join(T(' und '))}.`,
    tips: [...base.tips.slice(0, 2), ...muts.map((m) => MUTATORS[m].text)],
  };
}
// Serie: an aufeinanderfolgenden Tagen mindestens einen Stern
const DAILY_KEY = 'planez_daily';
export function dailyInfo() {
  try {
    return JSON.parse(localStorage.getItem(DAILY_KEY) || 'null') || { streak: 0, last: null, days: {} };
  } catch (e) {
    return { streak: 0, last: null, days: {} };
  }
}
function recordDaily(key, stars) {
  const D = dailyInfo();
  D.days = D.days || {};
  D.days[key] = Math.max(D.days[key] || 0, stars);
  if (stars >= 1 && D.last !== key) {
    const y = new Date(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)) - 1);
    D.streak = D.last === dailyKey(y) ? (D.streak || 0) + 1 : 1;
    D.last = key;
    D.best = Math.max(D.best || 0, D.streak);
  }
  const keys = Object.keys(D.days).sort();
  while (keys.length > 60) delete D.days[keys.shift()];
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(D));
  } catch (e) {}
  return D;
}

// Szenario auf einen frischen Spielstand anwenden
export function applyScenario(state, def) {
  def.setup && def.setup(state);
  state.eventTimer = def.dur + 6 * H; // keine zufälligen Großereignisse – das Drehbuch bestimmt
  state.speed = def.role === 'manager' ? 10 : 1;
  state.scenario = { id: def.id, side: !!def.side, start: state.time, end: state.time + def.dur, base: { ...(state.life || {}) }, acc: {}, last: { ...state.stats.today }, fired: 0, done: false, result: null };
  log(state, 'sys', T`Herausforderung „${def.title}“ beginnt.`);
  return state;
}

// je Simulationsschritt
export function updateScenario(state) {
  const sc = state.scenario;
  if (!sc || sc.done) return;
  const def = scenarioById(sc.id);
  if (!def) return;
  accumulate(state);
  const el = state.time - sc.start;
  const script = def.script || [];
  while (sc.fired < script.length && el >= script[sc.fired].at) {
    script[sc.fired].run(state);
    sc.fired++;
  }
  if (sc.retry && state.time >= sc.retry.at) {
    const k = sc.retry.kind;
    sc.retry = triggerEvent(state, k) ? null : { at: state.time + 300, kind: k };
  }
  // Abbruchbedingung nur alle paar Sekunden prüfen
  sc.tick = (sc.tick || 0) + 1;
  const failed = sc.tick % 10 === 0 && def.fail ? def.fail(metrics(state), state) : null;
  if (state.time >= sc.end || failed) finishScenario(state, failed);
}

export function finishScenario(state, failed = null) {
  const sc = state.scenario;
  const def = scenarioById(sc.id);
  const m = metrics(state);
  const rows = def.goals.map((g) => ({ g, v: m[g.key], stars: goalStars(g, m[g.key]) }));
  // Endlos-Herausforderung: Ablösung ist das normale Ende – gewertet wird trotzdem
  let stars = (failed && !def.endless) || rows.some((r) => !r.stars) ? 0 : Math.floor(rows.reduce((a, r) => a + r.stars, 0) / rows.length);
  sc.done = true;
  const pts = state.score ? state.score.pts : 0;
  sc.result = { stars, failed, rows: rows.map((r) => ({ v: r.v, stars: r.stars })), m, pts };
  if (def.endless) Object.assign(sc.result, { waves: Math.min(def.script.length, Math.floor(m.mins / 15)), boni: sc.boni || [] });
  state.speed = 0;
  const best = recordBest(def.id, stars, rows, pts, def.endless ? m.mins : 0);
  sc.result.best = best;
  if (def.daily) sc.result.daily = recordDaily(def.daily, stars);
  radio(state, 'TWR', stars ? 'All stations, shift complete, good work.' : 'All stations, shift ended.', 'atc');
  for (const fn of scenarioListeners) fn(state, def, sc.result);
}
export const scenarioListeners = [];

// Zwischenstand für die HUD-Leiste
export function scenarioLive(state) {
  const sc = state.scenario;
  if (!sc) return null;
  const def = scenarioById(sc.id);
  if (!def) return null;
  const m = metrics(state);
  return { def, m, left: Math.max(0, sc.end - state.time), frac: Math.min(1, (state.time - sc.start) / (sc.end - sc.start)), rows: def.goals.map((g) => ({ g, v: m[g.key], stars: goalStars(g, m[g.key]) })) };
}

// ---------- Bestwerte ----------
const BEST_KEY = 'planez_scn_best';
export function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
  } catch (e) {
    return {};
  }
}
// mins: Endlos-Herausforderung – längste überstandene Zeit als eigener Rekord
function recordBest(id, stars, rows, pts = 0, mins = 0) {
  const all = loadBest();
  const old = all[id];
  const score = stars * 1000 + rows.reduce((a, r) => a + r.stars * 100, 0);
  const isNew = !old || score > (old.score || 0) || (score === (old.score || 0) && pts > (old.pts || 0));
  const ptsNew = pts > ((old && old.pts) || 0);
  const minsNew = mins > ((old && old.mins) || 0);
  if (isNew || ptsNew || minsNew) {
    all[id] = { stars: isNew ? stars : old.stars, score: isNew ? score : old.score, pts: Math.max(pts, (old && old.pts) || 0), at: Date.now() };
    const mb = Math.max(mins, (old && old.mins) || 0);
    if (mb) all[id].mins = mb;
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  return { ...all[id], ...(isNew || ptsNew || minsNew ? {} : old), isNew, ptsNew, minsNew, prev: old || null };
}
export const totalStars = () => Object.entries(loadBest()).reduce((a, [k, b]) => a + (k.startsWith('daily-') ? 0 : b.stars || 0), 0);
// Freischaltung: die erste Herausforderung je Station ist offen, weitere nach mindestens einem Stern
export function unlocked(def) {
  if (IS_DEMO && !DEMO.scenarios.includes(def.id)) return false;
  const same = SCENARIOS.filter((x) => x.role === def.role);
  const i = same.indexOf(def);
  if (i <= 0) return true;
  const best = loadBest();
  return same.slice(0, i).some((x) => (best[x.id]?.stars || 0) >= 1);
}
