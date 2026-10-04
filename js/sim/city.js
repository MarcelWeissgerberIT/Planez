// Heimatstadt des Flughafens: ein fiktiver Ortsname mit Flughafenkürzel, beim Spielstart gewürfelt (im Startdialog
// änderbar). Sie steht im Funk („Velmarau Tower“, ATIS), in Strecken („Velmarau → Madrid“), auf der Streckenkarte
// und im Titel der Lokalzeitung. Alte Spielstände und Herausforderungen bleiben bei „Planez“ (Kürzel PNZ).
import { AIRPORT, CITIES, AIRLINES } from '../config.js';
import { EN } from '../i18n.js';

// ausgedachte Wortstämme und typische Endungen – ergibt Namen wie Velmarau, Orlenfeld, Kessenburg
const STEM = ['Velmar', 'Orlen', 'Kessen', 'Tarven', 'Rabis', 'Lenter', 'Morsen', 'Faltis', 'Ellwar', 'Brisen', 'Hanwil', 'Ostrel', 'Selden', 'Valden', 'Tessel', 'Ilmar', 'Korbis', 'Wittel', 'Gaven', 'Arnis', 'Delmer', 'Fennow', 'Quarren', 'Ulmis'];
const END = ['au', 'burg', 'feld', 'hausen', 'heim', 'dorf', 'stedt', 'born', 'tal', 'hagen', 'brück', 'furt', 'rode', 'wald', 'ingen', 'see'];

export const DEFAULT_CITY = { name: 'Planez', code: 'PNZ' };

// dreibuchstabiges Kürzel aus dem Namen: Anfangsbuchstabe und die nächsten zwei Mitlaute (Velmarau -> VLM)
export function cityCode(name) {
  const s = String(name || '')
    .toUpperCase()
    .replace(/Ä/g, 'A')
    .replace(/Ö/g, 'O')
    .replace(/Ü/g, 'U')
    .replace(/ß/g, 'S')
    .replace(/[^A-Z]/g, '');
  if (!s) return DEFAULT_CITY.code;
  let code = s[0];
  for (const ch of s.slice(1)) {
    if (code.length === 3) break;
    if (!'AEIOUY'.includes(ch) && ch !== code[code.length - 1]) code += ch;
  }
  for (const ch of s.slice(1)) if (code.length < 3) code += ch;
  code = code.padEnd(3, 'X');
  // nicht wie ein Zielflughafen, eine Airline oder „PLZ“ (läse sich wie Postleitzahl): letzten Buchstaben weiterdrehen
  const taken = new Set([...Object.keys(CITIES), ...Object.values(AIRLINES).map((a) => a.code), 'PLZ']);
  for (let i = 0; taken.has(code) && i < 26; i++) code = code.slice(0, 2) + String.fromCharCode(65 + ((code.charCodeAt(2) - 64) % 26));
  return code;
}

export function makeCity(rand = Math.random) {
  const name = STEM[Math.floor(rand() * STEM.length)] + END[Math.floor(rand() * END.length)];
  return { name, code: cityCode(name) };
}

export const cityOf = (state) => (state && state.city) || DEFAULT_CITY;

// Zeitungstitel: „Velmarauer Kurier“ bzw. „Velmarau Courier“
export function paperName(state) {
  const n = cityOf(state).name;
  return EN ? `${n} Courier` : `${n}${/e$/.test(n) ? 'r' : 'er'} Kurier`;
}

// Kennungen im Spiel auf die Stadt dieses Spielstands setzen (Funk, Tower-Kopf, Kürzel in Strecken)
export function applyCity(state) {
  const c = cityOf(state);
  AIRPORT.city = c.name;
  AIRPORT.code = c.code;
  AIRPORT.tower = `${c.name} Tower`;
}
