// Großflughäfen: Einsätze je Platz (Startzeit, Dauer, Verkehrsdichte, Betriebsrichtung, Wind) mit Zielen und Sternen
import { T } from '../i18n.js';

// mov = Ziel-Bewegungen (Landungen + Starts) im Einsatz; abgestimmt mit der KI-Tower-Simulation
export const HUB_SCENARIOS = [
  // Kingsmoor (Vorbild London-Heathrow)
  { id: 'kgm-morning', ap: 'kgm', icon: '🌅', title: T('Langstrecken-Morgenwelle'), sub: T('06:00 · Westbetrieb, 27R landet, 27L startet – die Nachtflüge aus Asien und Amerika kommen alle auf einmal'), hour: 6, minutes: 45, intensity: 1, config: 'W', wind: { dir: 250, spd: 12 }, goal: { mov: 32 } },
  { id: 'kgm-switch', ap: 'kgm', icon: '🔁', title: T('Bahnwechsel um 15 Uhr'), sub: T('14:30 · um 15 Uhr tauschen die Bahnen: dann landet 27L und 27R startet – der Wechsel passiert mitten im Betrieb'), hour: 14.5, minutes: 60, intensity: 1, config: 'W', wind: { dir: 240, spd: 9 }, goal: { mov: 63 } },
  { id: 'kgm-east', ap: 'kgm', icon: '🧭', title: T('Ostwind'), sub: T('17:00 · Ostbetrieb: 09L landet, 09R startet – Abendspitze mit dichter Anflugkette'), hour: 17, minutes: 60, intensity: 1, config: 'E', wind: { dir: 80, spd: 11 }, goal: { mov: 62 } },
  { id: 'kgm-free', ap: 'kgm', icon: '♾️', title: T('Freier Betrieb'), sub: T('ohne Zeitlimit – Betriebsrichtung frei wählbar, Bahnwechsel um 15 Uhr'), hour: 8, minutes: 0, intensity: 1, config: 'W', wind: { dir: 260, spd: 10 }, goal: null },
  // Isarmoos (Vorbild München)
  { id: 'ism-morning', ap: 'ism', icon: '🌅', title: T('Erste Umsteigewelle'), sub: T('06:00 · Westbetrieb, beide Bahnen gemischt – auf jeder Bahn wird im Wechsel gelandet und gestartet'), hour: 6, minutes: 45, intensity: 1, config: 'W', wind: { dir: 250, spd: 8 }, goal: { mov: 32 } },
  { id: 'ism-east', ap: 'ism', icon: '🏔️', title: T('Föhn und Ostwind'), sub: T('12:00 · Ostbetrieb mit kräftigem Wind – Lücken in der Anflugkette für die Abflüge nutzen'), hour: 12, minutes: 60, intensity: 1, config: 'E', wind: { dir: 80, spd: 18 }, goal: { mov: 55 } },
  { id: 'ism-evening', ap: 'ism', icon: '🌆', title: T('Abendwelle'), sub: T('17:00 · Westbetrieb – die Heimat-Airline bringt ihre Flotte zurück, gleichzeitig starten die Europaflüge'), hour: 17, minutes: 60, intensity: 1.05, config: 'W', wind: { dir: 260, spd: 10 }, goal: { mov: 71 } },
  { id: 'ism-free', ap: 'ism', icon: '♾️', title: T('Freier Betrieb'), sub: T('ohne Zeitlimit – gemischter Betrieb auf beiden Bahnen'), hour: 9, minutes: 0, intensity: 1, config: 'W', wind: { dir: 250, spd: 9 }, goal: null },
  // Sunbay (Vorbild Los Angeles)
  { id: 'sby-morning', ap: 'sby', icon: '🌅', title: T('Pazifik-Morgen'), sub: T('07:00 · Westbetrieb: außen landen, innen starten – die Nachtflüge aus Asien und der erste Inlandsverkehr'), hour: 7, minutes: 45, intensity: 1, config: 'W', wind: { dir: 250, spd: 10 }, goal: { mov: 48 } },
  { id: 'sby-santaana', ap: 'sby', icon: '🔥', title: T('Santa-Ana-Wind'), sub: T('13:00 · der heiße Wüstenwind dreht den Betrieb: Landungen über dem Meer, Starts Richtung Berge'), hour: 13, minutes: 60, intensity: 1, config: 'E', wind: { dir: 70, spd: 16 }, goal: { mov: 74 } },
  { id: 'sby-evening', ap: 'sby', icon: '🌇', title: T('Abendspitze'), sub: T('18:00 · vier Bahnen unter Volllast – jede Landung kreuzt auf dem Weg zum Terminal eine Startbahn'), hour: 18, minutes: 60, intensity: 1.05, config: 'W', wind: { dir: 260, spd: 12 }, goal: { mov: 82 } },
  { id: 'sby-free', ap: 'sby', icon: '♾️', title: T('Freier Betrieb'), sub: T('ohne Zeitlimit – vier Parallelbahnen, Betriebsrichtung frei wählbar'), hour: 10, minutes: 0, intensity: 1, config: 'W', wind: { dir: 250, spd: 10 }, goal: null },
  // Mainhafen (Vorbild Frankfurt)
  { id: 'mhf-morning', ap: 'mhf', icon: '🌅', title: T('Langstrecken-Morgen'), sub: T('06:00 · Betriebsrichtung 25: Nordwest- und Südbahn landen, Centerbahn und Startbahn West starten'), hour: 6, minutes: 45, intensity: 1, config: 'W', wind: { dir: 250, spd: 9 }, goal: { mov: 39 } },
  { id: 'mhf-east', ap: 'mhf', icon: '🧭', title: T('Betriebsrichtung 07'), sub: T('12:00 · Ostwind: Landungen auf 07L und 07R, Starts auf 07C und nach Süden auf der Startbahn West'), hour: 12, minutes: 60, intensity: 1, config: 'E', wind: { dir: 70, spd: 12 }, goal: { mov: 74 } },
  { id: 'mhf-peak', ap: 'mhf', icon: '🔥', title: T('Spitzenstunde'), sub: T('17:00 · fast 100 Bewegungen pro Stunde – die Landungen der Südbahn kreuzen die startende Centerbahn'), hour: 17, minutes: 60, intensity: 1.08, config: 'W', wind: { dir: 240, spd: 10 }, goal: { mov: 83 } },
  { id: 'mhf-free', ap: 'mhf', icon: '♾️', title: T('Freier Betrieb'), sub: T('ohne Zeitlimit – vier Bahnen, Betriebsrichtung frei wählbar'), hour: 9, minutes: 0, intensity: 1, config: 'W', wind: { dir: 250, spd: 8 }, goal: null },
  // Liberty Bay (Vorbild New York JFK)
  { id: 'lby-europe', ap: 'lby', icon: '🌍', title: T('Europa-Welle am Abend'), sub: T('16:00 · 22L landet, 22R und 31L starten – die Transatlantikflüge rollen zu zwei sich kreuzenden Startbahnen'), hour: 16, minutes: 60, intensity: 1, config: 'SW', wind: { dir: 210, spd: 12 }, goal: { mov: 66 } },
  { id: 'lby-cross', ap: 'lby', icon: '✖️', title: T('Kreuzungsbetrieb'), sub: T('13:00 · Nordwestwind: 31R landet, 31L startet – jeder Abflug muss die Landebahn kreuzen'), hour: 13, minutes: 60, intensity: 1, config: 'NW', wind: { dir: 310, spd: 14 }, goal: { mov: 51 } },
  { id: 'lby-northeast', ap: 'lby', icon: '🌊', title: T('Nordost-Morgen'), sub: T('08:00 · Wind vom Atlantik: 04R landet, 04L startet – die Nachtflüge von der Westküste kommen an'), hour: 8, minutes: 45, intensity: 1, config: 'NE', wind: { dir: 40, spd: 11 }, goal: { mov: 32 } },
  { id: 'lby-free', ap: 'lby', icon: '♾️', title: T('Freier Betrieb'), sub: T('ohne Zeitlimit – vier Bahnen in zwei Richtungen, Betriebsrichtung frei wählbar'), hour: 10, minutes: 0, intensity: 1, config: 'SW', wind: { dir: 220, spd: 10 }, goal: null },
];

export const scenariosOf = (apId) => HUB_SCENARIOS.filter((s) => s.ap === apId);
export const hubScenarioById = (id) => HUB_SCENARIOS.find((s) => s.id === id);

// Sterne: Bewegungen im Verhältnis zum Ziel, Sicherheit, Durchstarts, Verspätung
export function hubStars(scn, st) {
  if (!scn.goal) return 0;
  const mov = st.arr + st.dep;
  const r = mov / scn.goal.mov;
  const delay = (st.arrDelay + st.depDelay) / Math.max(1, mov) / 60;
  let s = 0;
  if (r >= 0.5 && st.conf <= 2) s = 1;
  if (r >= 0.78 && st.conf <= 1 && st.ga <= 4) s = 2;
  if (r >= 0.92 && st.conf === 0 && st.ga <= 2 && delay <= 9) s = 3;
  return s;
}

const KEY = 'planez_hub_best';
export function loadHubBest() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch (e) {
    return {};
  }
}
export function saveHubBest(id, rec) {
  const b = loadHubBest();
  const old = b[id];
  if (!old || rec.stars > old.stars || (rec.stars === old.stars && rec.mov > old.mov)) b[id] = rec;
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch (e) {}
  return b[id];
}
export function hubTotalStars() {
  const b = loadHubBest();
  return Object.values(b).reduce((s, r) => s + (r.stars || 0), 0);
}
