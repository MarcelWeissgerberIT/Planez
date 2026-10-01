// Ausgabe des Spiels: 'full' (Verkaufsversion) oder 'demo' (Anspielversion). tools/build.mjs schreibt beim Paketieren
// einen festen Wert hinein; im Quellstand lässt sich die Demo zum Testen mit ?demo in der Adresse einschalten.
const fromUrl = () => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
  } catch (e) {
    return false;
  }
};
export const EDITION = fromUrl() ? 'demo' : 'full';
export const IS_DEMO = EDITION === 'demo';
// Link zur Shopseite (leer = Knopf „Vollversion“ ausblenden)
export const SHOP_URL = '';
// Umfang der Demo: Aufbau bis zum Verkehrslandeplatz, freies Spiel drei Tage, zwei Herausforderungen und das erste Kapitel
export const DEMO = { careerMaxStage: 1, freeDays: 3, scenarios: ['morning', 'rushGround'], chapters: 1 };
