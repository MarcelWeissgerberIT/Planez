// Eigene Oberflächen-Icons im Stil des Spiels: schlanke Linien (2 px, runde Enden), ein Akzentpunkt in der
// Rollenfarbe, 24er-Raster. Ersetzt die System-Emojis in Kartenleiste, Leitstand und Panel-Köpfen, damit die
// Oberfläche auf allen Geräten gleich aussieht. icon(name) liefert SVG-Markup, hydrateIcons(root) füllt
// Elemente mit data-ico="name".

const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  labels: '<path d="M3.5 11.2V4.5a1 1 0 0 1 1-1h6.7l9.3 9.3-7.7 7.7z"/><circle class="a" cx="8" cy="8" r="1.6"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5" opacity=".55"/><path d="M12 12l6-6"/><circle class="a" cx="15.6" cy="14.6" r="1.4"/>',
  noise: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11"/>',
  cinema: '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M3.5 9l2-4.5 15 0-2 4.5M8.5 4.5L7 9M13.5 4.5 12 9"/><path class="a" d="M10.5 12.5v4.5l3.8-2.25z"/>',
  photo: '<path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.6"/><circle class="a" cx="17.6" cy="10.4" r=".9"/>',
  spotbook: '<path d="M5.5 3.5h11a2 2 0 0 1 2 2v15h-11a2 2 0 0 1-2-2z"/><path d="M5.5 18.5a2 2 0 0 1 2-2h11"/><path class="a" d="M8.5 10.5l3 .8 2.5-2.6c.5-.5 1.3-.2 1.2.5l-.6 3.2 1.4 1.7-1 .3-1.4-1.1-3 .8z"/>',
  fids: '<rect x="3" y="4.5" width="18" height="13" rx="1.5"/><path d="M6 8.5h5M6 11.5h7M6 14.5h4M15 8.5h3M15 11.5h3M15 14.5h3"/><path d="M9 21h6M12 17.5V21"/>',
  gloss: '<path d="M12 6.5c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z"/><path d="M12 6.5v13"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.6"/><circle class="a" cx="12" cy="16.8" r="1.1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  tower: '<path d="M9 21l1-10h4l1 10M7.5 11h9M8 11l-1-4h10l-1 4"/><path d="M12 7V3.5"/><circle class="a" cx="12" cy="3.2" r="1.2"/>',
  headset: '<path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2"/><rect x="3.5" y="13" width="4" height="6" rx="1.5"/><rect x="16.5" y="13" width="4" height="6" rx="1.5"/><path d="M18.5 19c0 1.5-2 2.5-5 2.5"/><circle class="a" cx="12.5" cy="21.4" r="1.1"/>',
  vest: '<path d="M8 3.5l4 4 4-4 3.5 2.5-1.5 4v10.5H6V10L4.5 6z"/><path class="a" d="M6.2 13.5h11.6" /><path d="M12 7.5v13"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="1.6"/><path d="M9 7.5V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3.5 12.5h17"/><rect class="a" x="10.5" y="11.2" width="3" height="2.6" rx=".6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/><circle class="a" cx="12" cy="12" r="1.2"/>',
  stream: '<circle class="a" cx="12" cy="12" r="1.8"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 18.7a9.5 9.5 0 0 1 0-13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
  radio: '<rect x="6.5" y="7.5" width="11" height="13.5" rx="2"/><path d="M9 7.5L8 3M9.5 11.5h5M9.5 14.5h5"/><circle class="a" cx="12" cy="18" r="1.1"/>',
  mic: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  plane: '<path d="M21 4.5c.6.6.2 1.8-.6 2.6l-3.6 3.5 2.1 8.6-1.6 1.6-4.2-6.8-3.4 3.3.4 2.9-1.3 1.3-1.9-3.7-3.7-1.9L4.5 14.6l2.9.4 3.3-3.4-6.8-4.2 1.6-1.6 8.6 2.1 3.5-3.6c.8-.8 2-1.2 2.6-.6z"/>',
  medal: '<path d="M8 3.5l2.5 6M16 3.5l-2.5 6"/><circle cx="12" cy="15" r="5.5"/><path class="a" d="M12 12.2l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"/>',
};

export function icon(name, cls = '') {
  const p = P[name];
  if (!p) return '';
  return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${p}</svg>`;
}

export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-ico]')) {
    if (el.dataset.icoDone) continue;
    el.innerHTML = icon(el.dataset.ico);
    el.dataset.icoDone = '1';
  }
}
