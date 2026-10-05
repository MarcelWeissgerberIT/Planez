// Tastenkürzel-Übersicht (Taste ?): kompakte Karte mit den Tasten der aktuellen Station
import { ROLES } from '../state.js';
import { esc } from '../util.js';
import { T } from '../i18n.js';

const COMMON = [
  [T('Leertaste'), T('Pause / weiter')],
  ['1 – 5', T('Tempo 1× · 2× · 5× · 10× · 20×')],
  [T('Maus ziehen · Pfeiltasten'), T('Karte verschieben')],
  [T('Mausrad · + / −'), 'Zoom'],
  ['B', T('Beschriftungen an/aus')],
  [T('Umschalt+K'), T('Minikarte ein/aus – Klick darauf springt dorthin')],
  [T('M · Umschalt+M'), T('Flugzeug markieren / Markierung weg')],
  ['K', T('Kino-Modus')],
  ['I', T('Anzeigetafel Abflug/Ankunft')],
  ['J', T('Spotterbuch')],
  [T('Umschalt+P'), T('Fotomodus')],
  [T('Umschalt+R'), T('Wiederholung der letzten Sekunden (Zeitlupe)')],
  ['Esc', T('Auswahl aufheben · Pausenmenü')],
  ['?', T('diese Übersicht')],
];
const ROLE_KEYS = {
  tower: [
    ['A', T('Anflug frei')], ['D', T('Direkt zum FAF')], ['H', T('Warteschleife')], ['L', T('Landefreigabe')], ['G', T('Durchstarten')],
    ['R', T('Rollfreigabe')], ['P', T('Pushback')], ['E', T('Warten bis TSAT')], ['U', T('Line up')], ['T', T('Startfreigabe')], ['X · C', T('Halt · weiterrollen')],
    ['W · S', T('in der Pistenfolge früher / später')], ['N · Tab', T('nächste Anfrage')], ['F', T('Radar groß')], [T('V (halten)'), T('Sprechtaste – selbst funken')], ['Q', T('falschen Readback korrigieren')], ['Y', T('Wetterumweg genehmigen · sonst Heli, Touch and Go oder Pistenkontrolle freigeben')],
  ],
  ground: [['D', T('Alles bedienen (dringendste zuerst)')], ['G', T('Positionsplan (Zeitstrahl, Drag & Drop)')], ['F', T('ausgewähltes Flugzeug spotten (Foto)')]],
  manager: [['O', T('Management-Zentrale')], [T('↑ ↓ (in der Zentrale)'), T('Bereich wechseln')], ['F', T('ausgewähltes Flugzeug spotten (Foto)')]],
  observer: [['O', T('Management-Zentrale')], ['K', T('Kino-Modus – am besten mit 2×')], ['L', T('Spotter-Livestream mit Live-Chat')], ['F', T('ausgewähltes Flugzeug spotten (Foto)')]],
};

export function keysHtml(role) {
  const row = ([k, t]) => `<div class="kr"><span>${k.split(' · ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</span><em>${esc(t)}</em></div>`;
  return T`<h2>⌨️ Tastenkürzel</h2>
    <div class="keys-cols"><div><div class="kh">${ROLES[role].icon} ${esc(ROLES[role].name)}</div>${(ROLE_KEYS[role] || []).map(row).join('')}</div>
    <div><div class="kh">Überall</div>${COMMON.map(row).join('')}</div></div>
    <div class="modal-acts"><button class="btn btn-primary" data-close-modal>Schließen</button></div>`;
}
