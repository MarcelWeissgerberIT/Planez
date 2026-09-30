// Funk-/Ereignisprotokoll und Benachrichtigungen (im Spielstand, flüchtige Toasts separat)
export const listeners = { radio: [], toast: [] };

// kind: 'atc' (Lotse), 'pilot', 'gnd' (Vorfeld), 'mgr' (Management), 'sys'
export function log(state, kind, text, from = '') {
  const m = { t: state.time, kind, text, from };
  state.log.push(m);
  if (state.log.length > 160) state.log.splice(0, state.log.length - 160);
  for (const fn of listeners.radio) fn(m);
}

// level: info | good | warn | bad
export function notify(state, text, level = 'info') {
  for (const fn of listeners.toast) fn({ text, level });
}

export function radio(state, from, text, kind = 'pilot') {
  log(state, kind, text, from);
}
