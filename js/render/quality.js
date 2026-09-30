// Grafikqualität: Leistungsmodus reduziert Details für langsamere Rechner
export const Q = {
  perf: false,
  // Scheiben für plastische Körper
  get slices() {
    return this.perf ? 6 : 18;
  },
  get vehSlices() {
    return this.perf ? 4 : 10;
  },
  // Anteil der Belebung (Autos, Fußgänger)
  get agents() {
    return this.perf ? 0.45 : 1;
  },
  get dprCap() {
    return this.perf ? 1 : 2;
  },
};
