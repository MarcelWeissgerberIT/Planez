// Großflughäfen: gebaute Layouts zwischenspeichern (einmal je Platz)
import { buildAirport } from './build.js';
import { airportById } from './airports.js';

const BUILT = new Map();
export function getAirport(id) {
  if (!BUILT.has(id)) BUILT.set(id, buildAirport(airportById(id)));
  return BUILT.get(id);
}
