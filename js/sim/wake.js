// Wirbelschleppen-Kategorien und Staffelungswerte (vereinfacht nach ICAO Doc 4444)
export const WAKE_DE = { L: 'leicht (Light)', M: 'mittel (Medium)', H: 'schwer (Heavy)' };

// Radarstaffelung im Endanflug in NM: [vorausfliegend][folgend]
const ARR_NM = { HH: 4, HM: 5, HL: 6, ML: 5 };
export const wakeNm = (lead, foll) => ARR_NM[(lead || 'M') + (foll || 'M')] || 3;

// Zeitstaffelung zwischen zwei Starts in Spielsekunden
export function wakeDepSec(lead, foll) {
  if (lead === 'H' && foll !== 'H') return 120;
  if (lead === 'M' && foll === 'L') return 120;
  if (lead === 'H') return 90;
  return 75;
}

// Planungsabstand der Pistenfolge (Sekunden) zwischen zwei Landungen: ~80 s je 3 NM
export const wakeArrSec = (lead, foll) => Math.round((80 * wakeNm(lead, foll)) / 3);
