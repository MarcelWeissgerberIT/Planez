// Demo-Ende: freundlicher Hinweis auf die Vollversion, wenn eine Grenze der Anspielversion erreicht ist
// (Tag 3 im freien Spiel, nächste Ausbaustufe im Aufbau, gesperrte Herausforderung).
import { openModal, closeModal } from './dom.js';
import { IS_DEMO, SHOP_URL, DEMO } from '../edition.js';
import { stagePic } from './careerUi.js';

const FEATURES = [
  ['🌐', 'Aufbau bis zum Drehkreuz', 'Regionalflughafen, International, Drehkreuz mit Parallelbahn und Superjumbo'],
  ['🗺️', 'Freies Spiel ohne Grenzen', 'Wochen und Monate, Aufsichtsrat, Konkurrenz Nordhafen, Winter, Kerosinhandel'],
  ['🏆', 'Alle Herausforderungen', 'Nebel, Gewitter, Streik, Winterchaos, Staatsbesuch – und die ganze Kampagne'],
  ['💾', 'Spielstände bleiben', 'Was du in der Demo gespielt hast, geht in der Vollversion weiter'],
];

export function demoFreeOver(state, rec) {
  return IS_DEMO && !state.career && !state.scenario && rec && rec.day >= DEMO.freeDays;
}

// reason: 'free' | 'career' | 'scn'
export function showDemoEnd(reason, { onMenu, onStay } = {}) {
  const head = { free: `Das waren deine ${DEMO.freeDays} Demo-Tage`, career: 'Der Verkehrslandeplatz ist geschafft!', scn: 'Diese Herausforderung gibt es in der Vollversion' }[reason] || 'Ende der Demo';
  const sub = {
    free: 'Der Flughafen läuft – aber die Demo endet hier. In der Vollversion geht es ohne Zeitlimit weiter.',
    career: 'Vom Grasplatz zum Verkehrslandeplatz – stark. Den Ausbau zum Regionalflughafen und weiter bis zum Drehkreuz gibt es in der Vollversion.',
    scn: 'Die Demo enthält „Morgenwelle“, „Ferienstart“, das erste Kapitel der Kampagne und die Tagesherausforderung.',
  }[reason];
  openModal(
    `<div class="demo-end"><div class="de-pic" style="background-image:url(${stagePic(reason === 'career' ? 2 : 4)})"><span>DEMO</span></div>
      <h2>${head}</h2><p class="de-sub">${sub}</p>
      <div class="de-feat">${FEATURES.map(([i, t, d]) => `<div><span>${i}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div>
      <div class="modal-acts">${SHOP_URL ? `<a class="btn btn-primary" href="${SHOP_URL}" target="_blank" rel="noopener">⭐ Vollversion holen</a>` : ''}${onStay ? '<button class="btn" data-de-stay>Weiterspielen</button>' : ''}<button class="btn${SHOP_URL ? '' : ' btn-primary'}" data-de-menu>Zum Hauptmenü</button></div></div>`,
    (box) => {
      const m = box.querySelector('[data-de-menu]');
      if (m) m.addEventListener('click', () => (closeModal(), onMenu && onMenu()));
      const st = box.querySelector('[data-de-stay]');
      if (st) st.addEventListener('click', () => (closeModal(), onStay && onStay()));
    }
  );
}
