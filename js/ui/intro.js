// Kino-Intro beim Start eines neuen Spiels: Kameraflug vom Endanflug über die Bahn zum Terminal,
// Letterbox und Titelkarte (Flughafenname, Tag, Uhrzeit, Station). Klick, Esc, Enter oder Leertaste überspringt.
import * as LY from '../layout.js';
import { ROLES } from '../state.js';
import { fmtClock, dayOf, esc } from '../util.js';
import { T } from '../i18n.js';

const DUR = 7.5;
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export function playIntro(game, done) {
  const s = game.state;
  const cam = game.cam;
  const g = document.getElementById('game');
  const el = document.createElement('div');
  el.id = 'intro';
  el.innerHTML = T`<i class="in-bar top"></i><i class="in-bar bot"></i>
    <div class="in-t"><small>${ROLES[s.role].icon} ${esc(ROLES[s.role].name)} · Tag ${dayOf(s.time)} · ${fmtClock(s.time)}</small><b>${esc(s.name)}</b><em>Landen. Abfertigen. Ausbauen. Wachsen.</em></div>
    <button class="in-skip">Überspringen ▸</button>`;
  g.appendChild(el);
  g.classList.add('intro-on');
  const speed = s.speed;
  s.speed = 0;
  const labels = game.ui.labels; // Rufzeichen-Schilder während des Flugs aus
  game.ui.labels = false;
  // Pfad: hoch über dem Endanflug → entlang der Bahn → Terminal
  const R = LY.RWY;
  const east = s.rwy === '27';
  const pts = [
    { x: east ? R.x1 + 14 : R.x0 - 14, y: R.y - 6, z: 0.42 },
    { x: (R.x0 + R.x1) / 2, y: R.y - 4, z: 0.55 },
    { x: 36, y: 15, z: 1.05 },
  ];
  const at = (u) => {
    const k = ease(u);
    const a = k < 0.5 ? pts[0] : pts[1], b = k < 0.5 ? pts[1] : pts[2];
    const f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
  };
  let t = 0, last = performance.now(), fin = false;
  const finish = () => {
    if (fin) return;
    fin = true;
    window.removeEventListener('keydown', onKey, true);
    const p = at(1);
    Object.assign(cam, { x: p.x, y: p.y, zoom: p.z, tx: null });
    el.classList.add('out');
    g.classList.remove('intro-on');
    s.speed = speed || 1;
    game.ui.labels = labels;
    setTimeout(() => el.remove(), 600);
    done && done();
  };
  const onKey = (e) => {
    if (['Escape', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      finish();
    }
  };
  window.addEventListener('keydown', onKey, true);
  el.addEventListener('click', finish);
  const step = (now) => {
    if (fin) return;
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    const p = at(Math.min(1, t / DUR));
    cam.x = p.x;
    cam.y = p.y;
    cam.zoom = p.z;
    cam.tx = null;
    if (t > 0.5) el.classList.add('show');
    if (t > DUR - 1.6) el.classList.add('fade');
    if (t >= DUR) return finish();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
