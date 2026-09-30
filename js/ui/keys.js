// Tastenkürzel-Übersicht (Taste ?): kompakte Karte mit den Tasten der aktuellen Station
import { ROLES } from '../state.js';
import { esc } from '../util.js';

const COMMON = [
  ['Leertaste', 'Pause / weiter'],
  ['1 – 5', 'Tempo 1× · 2× · 5× · 10× · 20×'],
  ['Maus ziehen · Pfeiltasten', 'Karte verschieben'],
  ['Mausrad · + / −', 'Zoom'],
  ['B', 'Beschriftungen an/aus'],
  ['M · Umschalt+M', 'Flugzeug markieren / Markierung weg'],
  ['K', 'Kino-Modus'],
  ['I', 'Anzeigetafel Abflug/Ankunft'],
  ['Umschalt+P', 'Fotomodus'],
  ['Esc', 'Auswahl aufheben · Pausenmenü'],
  ['?', 'diese Übersicht'],
];
const ROLE_KEYS = {
  tower: [
    ['A', 'Anflug frei'], ['D', 'Direkt zum FAF'], ['H', 'Warteschleife'], ['L', 'Landefreigabe'], ['G', 'Durchstarten'],
    ['R', 'Rollfreigabe'], ['P', 'Pushback'], ['E', 'Warten bis TSAT'], ['U', 'Line up'], ['T', 'Startfreigabe'], ['X · C', 'Halt · weiterrollen'],
    ['W · S', 'in der Pistenfolge früher / später'], ['N · Tab', 'nächste Anfrage'], ['F', 'Radar groß'], ['V (halten)', 'Sprechtaste – selbst funken'],
  ],
  ground: [['D', 'Alles bedienen (dringendste zuerst)'], ['G', 'Positionsplan (Zeitstrahl, Drag & Drop)']],
  manager: [['O', 'Management-Zentrale'], ['↑ ↓ (in der Zentrale)', 'Bereich wechseln']],
  observer: [['O', 'Management-Zentrale'], ['K', 'Kino-Modus – am besten mit 2×']],
};

export function keysHtml(role) {
  const row = ([k, t]) => `<div class="kr"><span>${k.split(' · ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</span><em>${esc(t)}</em></div>`;
  return `<h2>⌨️ Tastenkürzel</h2>
    <div class="keys-cols"><div><div class="kh">${ROLES[role].icon} ${esc(ROLES[role].name)}</div>${(ROLE_KEYS[role] || []).map(row).join('')}</div>
    <div><div class="kh">Überall</div>${COMMON.map(row).join('')}</div></div>
    <div class="modal-acts"><button class="btn btn-primary" data-close-modal>Schließen</button></div>`;
}
