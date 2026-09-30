// Sicherheitskontrolle: Passagierströme vor den Abflügen gegen die Kapazität der Kontrollspuren.
// Zu Stoßzeiten entstehen Schlangen – das Boarding dauert länger, Passagiere beschweren sich.
import { clamp } from '../util.js';
import { notify, log } from './messages.js';

export const secLanes = (state) => 4 + 2 * (state.upgrades.security || 0);
export const secCapacity = (state) => secLanes(state) * 120; // Passagiere je Stunde

export function secState(state) {
  if (!state.sec) state.sec = { q: 0, wait: 0, demand: 0, warned: false, peak: 0 };
  return state.sec;
}

export function updateSecurity(state, dt) {
  const S = secState(state);
  S.t = (S.t || 0) - dt;
  if (S.t <= 0) {
    S.t = 60;
    // Reisende kommen 30–120 Minuten vor Abflug durch die Kontrolle
    let pax = 0;
    for (const r of Object.values(state.rots)) {
      if (r.status === 'departed' || r.status === 'cancelled' || r.status === 'diverted' || !r.paxOut) continue;
      const dt0 = r.std - state.time;
      if (dt0 > 30 * 60 && dt0 < 120 * 60) pax += r.paxOut;
    }
    S.demand = pax / 1.5;
  }
  const cap = secCapacity(state);
  // bei sehr langen Schlangen öffnet das Personal Notspuren und Reisende kommen früher – mehr als ~45 min wird es nicht
  S.q = clamp(S.q + ((S.demand - cap) * dt) / 3600, 0, cap * 0.75);
  S.wait = (S.q / cap) * 60;
  S.peak = Math.max(S.peak || 0, S.wait);
  // lange Schlangen bremsen das Boarding (Nachzügler) und kosten Ansehen
  state.secSlow = S.wait > 12 ? Math.min(1.45, 1 + (S.wait - 12) / 60) : 1;
  if (S.wait > 25) state.reputation = clamp(state.reputation - (dt / 3600) * 0.25, 0, 100);
  if (S.wait > 20 && !S.warned) {
    S.warned = true;
    notify(state, `🚶 Lange Schlange an der Sicherheitskontrolle (≈${Math.round(S.wait)} min) – Boarding dauert länger`, 'warn');
    log(state, 'mgr', `Sicherheitskontrolle überlastet: ${Math.round(S.demand)} Reisende/h bei ${cap} Kapazität (${secLanes(state)} Spuren).`);
  }
  if (S.wait < 8) S.warned = false;
}
