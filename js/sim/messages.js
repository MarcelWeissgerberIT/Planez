// Funk-/Ereignisprotokoll und Benachrichtigungen (im Spielstand, flüchtige Toasts separat)
export const listeners = { radio: [], toast: [], fx: [], ach: [], rank: [] };

// kind: 'atc' (Lotse), 'pilot', 'gnd' (Vorfeld), 'crew' (Betriebsfunk Vorfeld), 'mgr' (Management), 'sys'
export function log(state, kind, text, from = '', extra = null) {
  const m = extra ? { t: state.time, kind, text, from, ...extra } : { t: state.time, kind, text, from };
  state.log.push(m);
  if (state.log.length > 160) state.log.splice(0, state.log.length - 160);
  for (const fn of listeners.radio) fn(m);
}

// level: info | good | warn | bad
export function notify(state, text, level = 'info') {
  for (const fn of listeners.toast) fn({ text, level });
}

// Sprachausgabe meldet, ob ein Sender noch spricht oder in der Warteschlange steht (Startlauf erst nach gehörter Rücklesung)
export const speech = { pending: () => false };

export function radio(state, from, text, kind = 'pilot') {
  log(state, kind, text, from);
}

// schwebende Rückmeldung auf der Karte (z. B. „✓ pünktlich“, „+2.400 €“); kind: good | bad | warn | cash | info
export function fx(state, x, y, text, kind = 'info') {
  for (const fn of listeners.fx) fn({ x, y, text, kind });
}
