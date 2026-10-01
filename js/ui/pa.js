// Terminal-Durchsagen (Vorfeld und Beobachter, mit „Echter Funk“): Gong und deutsche Ansage, wenn das Boarding
// beginnt, beim letzten Aufruf kurz vor Abflug und bei besonderen Ankünften. Höchstens eine Ansage pro Minute,
// nur bei gemächlichem Tempo und wenn gerade niemand funkt.
import { AIRLINES, CITIES } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { voice } from '../voice.js';
import { sfx } from '../audio.js';
import { T } from '../i18n.js';

const seen = new Set();
let lastT = 0;
const flight = (ac, no) => T`${AIRLINES[ac.airline] ? AIRLINES[ac.airline].name : ''} Flug ${String(no || ac.cs).replace(/^[A-Z]+/, '')}`;

export function paTick(s) {
  if (!s || !voice.on || !(s.role === 'ground' || s.role === 'observer') || !s.speed || s.speed > 2) return;
  if (performance.now() - lastT < 60000 || voice.current || voice.queue.length) return;
  for (const ac of s.acs) {
    if (ac.phase !== PH.STAND || !ac.ta) continue;
    const rot = s.rots[ac.rot];
    const b = ac.ta.tasks.board;
    if (!rot || !b) continue;
    const city = CITIES[rot.city] ? CITIES[rot.city].name : '';
    let key = null, text = null;
    if (b.st === 'active' && !seen.has(ac.id + 'b')) {
      key = ac.id + 'b';
      text = T`Sehr geehrte Fluggäste, ${flight(ac, rot.depNo)} nach ${city} ist jetzt zum Einsteigen bereit. Bitte begeben Sie sich zu Position ${ac.stand}.`;
    } else if (b.st === 'active' && rot.std - s.time < 5 * 60 && (b.prog || 0) < 0.85 && !seen.has(ac.id + 'l')) {
      key = ac.id + 'l';
      text = T`Letzter Aufruf für ${flight(ac, rot.depNo)} nach ${city}. Die Türen werden in Kürze geschlossen.`;
    }
    if (!key) continue;
    seen.add(key);
    if (seen.size > 400) seen.clear();
    lastT = performance.now();
    sfx.chime();
    setTimeout(() => voice.announce(text), 1400);
    return;
  }
}
