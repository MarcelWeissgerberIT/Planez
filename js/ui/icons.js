// Eigene Oberflächen-Icons im Stil des Spiels: schlanke Linien (2 px, runde Enden), ein Akzentpunkt in der
// Rollenfarbe, 24er-Raster. Ersetzt die System-Emojis in Kartenleiste, Leitstand und Panel-Köpfen, damit die
// Oberfläche auf allen Geräten gleich aussieht. icon(name) liefert SVG-Markup, hydrateIcons(root) füllt
// Elemente mit data-ico="name".

const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4.5V8M9 19v1.5M15 19v1.5M3 12.5v3M21 12.5v3"/><circle class="a" cx="9.5" cy="13" r="1.4"/><circle class="a" cx="14.5" cy="13" r="1.4"/><circle cx="12" cy="4" r="1"/>',
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
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect class="a" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  tower: '<path d="M9 21l1-10h4l1 10M7.5 11h9M8 11l-1-4h10l-1 4"/><path d="M12 7V3.5"/><circle class="a" cx="12" cy="3.2" r="1.2"/>',
  headset: '<path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2"/><rect x="3.5" y="13" width="4" height="6" rx="1.5"/><rect x="16.5" y="13" width="4" height="6" rx="1.5"/><path d="M18.5 19c0 1.5-2 2.5-5 2.5"/><circle class="a" cx="12.5" cy="21.4" r="1.1"/>',
  vest: '<path d="M8 3.5l4 4 4-4 3.5 2.5-1.5 4v10.5H6V10L4.5 6z"/><path class="a" d="M6.2 13.5h11.6" /><path d="M12 7.5v13"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="1.6"/><path d="M9 7.5V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3.5 12.5h17"/><rect class="a" x="10.5" y="11.2" width="3" height="2.6" rx=".6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/><circle class="a" cx="12" cy="12" r="1.2"/>',
  stream: '<circle class="a" cx="12" cy="12" r="1.8"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 18.7a9.5 9.5 0 0 1 0-13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
  radio: '<rect x="6.5" y="7.5" width="11" height="13.5" rx="2"/><path d="M9 7.5L8 3M9.5 11.5h5M9.5 14.5h5"/><circle class="a" cx="12" cy="18" r="1.1"/>',
  mic: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  plane: '<path d="M21 4.5c.6.6.2 1.8-.6 2.6l-3.6 3.5 2.1 8.6-1.6 1.6-4.2-6.8-3.4 3.3.4 2.9-1.3 1.3-1.9-3.7-3.7-1.9L4.5 14.6l2.9.4 3.3-3.4-6.8-4.2 1.6-1.6 8.6 2.1 3.5-3.6c.8-.8 2-1.2 2.6-.6z"/>',
  sun: '<circle class="a" cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  clouds: '<circle class="a" cx="8.5" cy="8.5" r="3"/><path d="M7 19h10.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-.6A3.8 3.8 0 0 0 7 19z"/>',
  rain: '<path d="M7 15h10.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-.6A3.8 3.8 0 0 0 7 15z"/><path class="a" d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>',
  storm: '<path d="M7 14h10.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-.6A3.8 3.8 0 0 0 7 14z"/><path class="a" d="M12.5 13.5l-2.5 4h3l-2 4"/>',
  fog: '<path d="M4 9h16M6 12.5h12M4 16h16M7 19.5h10"/><path class="a" d="M8 5.5h8"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><circle class="a" cx="12" cy="12" r="1.6"/>',
  leaf: '<path d="M5 19c0-8 5-14 14-14 0 9-6 14-14 14z"/><path class="a" d="M5 19l8-8"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 10c0-3.5 2.5-5.5 6.5-5.5 0 3.5-2.5 5.5-6.5 5.5z"/><path class="a" d="M8 21h8"/>',
  star: '<path class="a" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="a" d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  follow: '<rect x="3" y="7" width="12" height="10" rx="1.5"/><path d="M15 10.5l5.5-3v9l-5.5-3"/><circle class="a" cx="7" cy="10.5" r="1.1"/>',
  trails: '<path d="M3 17c5-1 9-4 12-9"/><path d="M3 20c6-1 11-5 15-11" opacity=".6"/><circle class="a" cx="18.5" cy="6" r="2"/>',
  tilt: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/><path class="a" d="M8 11h6"/>',
  // Abfertigung (Vorfeld)
  deboard: '<circle cx="10" cy="4.5" r="1.8"/><path d="M10 7.5v6l-2.5 6.5M10 13.5l3 6M10 9.5l-3 2.5M10 9.5l3.5 1.5"/><path class="a" d="M16 8h4.5M18.5 6l2 2-2 2"/>',
  board: '<circle cx="14" cy="4.5" r="1.8"/><path d="M14 7.5v6l2.5 6.5M14 13.5l-3 6M14 9.5l3 2.5M14 9.5l-3.5 1.5"/><path class="a" d="M8 8H3.5M5.5 6l-2 2 2 2"/>',
  unload: '<rect x="4" y="8" width="11" height="9" rx="1.5"/><path d="M7.5 8V6h4v2M4 12.5h11"/><path class="a" d="M17.5 12.5h4M19.5 10.5l2 2-2 2"/><circle cx="6.5" cy="19" r="1.2"/><circle cx="12.5" cy="19" r="1.2"/>',
  load: '<rect x="9" y="8" width="11" height="9" rx="1.5"/><path d="M12.5 8V6h4v2M9 12.5h11"/><path class="a" d="M6.5 12.5h-4M4.5 10.5l-2 2 2 2"/><circle cx="11.5" cy="19" r="1.2"/><circle cx="17.5" cy="19" r="1.2"/>',
  clean: '<path d="M9 3.5h4l1 5h-6z"/><path d="M8 8.5h8l1.5 12h-11z"/><path class="a" d="M17.5 4l1.2-1.2M19 6.5h1.8M17.5 9l1.2 1.2"/>',
  cater: '<rect x="4.5" y="5" width="15" height="15" rx="1.5"/><path d="M4.5 10h15M4.5 15h15M12 5v15"/><circle class="a" cx="8.3" cy="7.5" r=".9"/>',
  fuel: '<path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 5v15.5M3.5 20.5h12M14 9.5h2a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/><path class="a" d="M7 7h5v3.5H7z"/>',
  deice: '<path d="M4 20h7M7.5 20v-6l7-7"/><path d="M14.5 7l2-2"/><path class="a" d="M17.5 9.5v4M15.5 11.5h4M16 10l3 3M19 10l-3 3"/>',
  tug: '<path d="M3 16.5V12l2-4h7l2 4h6.5v4.5z"/><path d="M7 8V5.5h3V8"/><circle cx="7" cy="17.5" r="2"/><circle cx="16.5" cy="17.5" r="2"/><path class="a" d="M20.5 13.5H23"/>',
  planChart: '<rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M3.5 9h17M8 4v16"/><path class="a" d="M10 12h6M11.5 15.5h7"/>',
  bolt: '<path class="a" d="M13.5 2.5L5 13.5h6l-1.5 8L18 10.5h-6z"/>',
  land: '<path d="M3 20.5h18"/><path d="M4 9.5l2.5 1 1.5-3 1.3.4-.5 3.4 5 2 2.3-1.3c.8-.4 1.8 0 2 .8.1.6-.2 1.1-.7 1.4L6.5 15.8 3.8 14z"/><path class="a" d="M14 18.5h5"/>',
  takeoff: '<path d="M3 20.5h18"/><path d="M4.5 14.5l2-1 2 2 3.5-2.2-3.4-4.7 1.6-.9 5.3 3.4 3.3-2c.8-.5 1.8-.2 2.1.6.2.6-.1 1.2-.6 1.5L7.3 17.6z"/><path class="a" d="M5 18.5h5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/><circle class="a" cx="17" cy="6" r="1"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 5 9 6 9 8.5s-9 3.5-9 8.5M16.5 3.5c0 5-9 6-9 8.5s9 3.5 9 8.5"/><path class="a" d="M10 18.5h4l-2-2.2z"/>',
  // Entscheidungskarten
  medic: '<rect x="3.5" y="6.5" width="17" height="13" rx="2"/><path d="M9 6.5V4.5h6v2"/><path class="a" d="M12 9.5v7M8.5 13h7"/>',
  handshake: '<path d="M2.5 11l4-4 4 2 3-2 4 1 4 3"/><path d="M6.5 7v6l5 4.5c.6.5 1.4.5 2 0l5-4.5"/><path class="a" d="M10 14l2 2M12 12.5l2 2"/>',
  drone: '<circle cx="5.5" cy="6.5" r="2.5"/><circle cx="18.5" cy="6.5" r="2.5"/><path d="M7.5 8l3 3M16.5 8l-3 3"/><rect x="9.5" y="10.5" width="5" height="4" rx="1"/><circle class="a" cx="12" cy="17.5" r="1.4"/>',
  barrel: '<ellipse cx="12" cy="5.5" rx="6" ry="2"/><path d="M6 5.5v13c0 1.1 2.7 2 6 2s6-.9 6-2v-13M6 12c0 1.1 2.7 2 6 2s6-.9 6-2"/><path class="a" d="M15 16.5c.8.8.8 2 0 2.7"/>',
  wrench: '<path d="M14.5 3.5a5 5 0 0 0-4.6 6.9L3.5 16.8a2 2 0 0 0 2.8 2.8l6.4-6.4a5 5 0 0 0 6.9-4.6l-2.7 2.7-2.6-.6-.6-2.6z"/><circle class="a" cx="5.4" cy="18.6" r=".9"/>',
  laser: '<path d="M3.5 16.5l5-5 3 3-5 5z"/><path d="M8.5 11.5l3 3"/><path class="a" d="M12.5 10.5l8-7M14 12.5l7.5-3.5M11 9l2.5-6"/>',
  transfer: '<path d="M4 8.5h13l-3.5-3.5M20 15.5H7l3.5 3.5"/><circle class="a" cx="12" cy="12" r="1.2"/>',
  megaphone: '<path d="M3.5 10v4h3l9 4.5v-13l-9 4.5z"/><path d="M6.5 14l1.5 5h2.5l-1-4.5"/><path class="a" d="M18.5 9.5a3.5 3.5 0 0 1 0 5"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="1.5"/><rect x="9" y="3" width="6" height="3" rx="1"/><path d="M8.5 11h7M8.5 14.5h7"/><path class="a" d="M8.5 18h4"/>',
  bird: '<path d="M3 13c3 0 5-2 7-5 1 3 3 4 6 4l4.5-2-2 3.5c-1 3-4 5.5-8.5 5.5-3 0-5-2.5-7-6z"/><circle class="a" cx="17" cy="11.3" r=".9"/>',
  shop: '<path d="M4 9.5l1.5-5h13L20 9.5M4 9.5c0 1.4 1.2 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.2 2.5 2.7 2.5S20 10.9 20 9.5"/><path d="M5.5 12v8.5h13V12"/><rect class="a" x="10" y="15" width="4" height="5.5" rx=".5"/>',
  office: '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M8.5 7h2M13.5 7h2M8.5 10.5h2M13.5 10.5h2M8.5 14h2M13.5 14h2"/><rect class="a" x="10.5" y="17" width="3" height="3.5"/>',
  guitar: '<path d="M14 10l6-6.5M18 3l3 3"/><path d="M11.5 9.5c-2-1-4.5-.5-5.5 1.5-.8 1.5-.2 2.5-1.5 3.5S3 17 5 19s4 1 4.5-.5 1.5-1 3-1.5c2-1 2.5-3.5 1.5-5.5z"/><circle class="a" cx="9" cy="15" r="1.2"/>',
  balloon: '<path d="M12 3.5c3.6 0 6 2.8 6 6.3 0 3.8-3 7.2-6 7.2s-6-3.4-6-7.2c0-3.5 2.4-6.3 6-6.3z"/><path d="M12 17l-1 1.5h2zM12 18.5c0 1.5-1.5 2-1 3"/><path class="a" d="M9.3 8.5a3 3 0 0 1 2-2.3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/><circle class="a" cx="17.5" cy="7" r="1"/>',
  parking: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path class="a" d="M9.5 17V7.5h3.3a2.8 2.8 0 0 1 0 5.6H9.5"/>',
  fist: '<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V10M10 9V6.5a1.5 1.5 0 0 1 3 0V10M13 9.5V7a1.5 1.5 0 0 1 3 0v3M16 10.5V9a1.5 1.5 0 0 1 3 0v4c0 4-2.5 7-6.5 7S7 18 7 15v-1.5a2 2 0 0 1 2-2h2.5"/><path class="a" d="M10 21.5h5"/>',
  noentry: '<circle cx="12" cy="12" r="8.5"/><path class="a" d="M7.5 10.5h9v3h-9z"/>',
  thermo: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><circle class="a" cx="12" cy="17.5" r="2"/><path class="a" d="M12 15.5V9"/>',
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
