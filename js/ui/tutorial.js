// Interaktive Einführung je Rolle: Hervorhebung (Spotlight), Sprechblase, Schritte gehen weiter,
// sobald die Aktion wirklich ausgeführt wurde. Beim ersten Spielen einer Rolle automatisch.
import { PH } from '../sim/aircraft.js';
import { projects } from '../sim/construction.js';
import { T } from '../i18n.js';

const KEY = 'planez_tut_';
const seen = (role) => {
  try {
    return !!localStorage.getItem(KEY + role);
  } catch (e) {
    return true;
  }
};
const markSeen = (role) => {
  try {
    localStorage.setItem(KEY + role, '1');
  } catch (e) {}
};

// Schritte: sel = hervorzuhebendes Element, text, done(state, game, ctx) -> true wenn erledigt; wait = nur „Weiter“
const STEPS = {
  tower: [
    { sel: '#panel', title: T('Dein Arbeitsplatz'), text: T('Rechts siehst du <b>Radar</b>, <b>Pistenstatus</b> und den <b>Funk</b>. Auf dem Radar fliegen die Anflüge von den Warteschleifen-Fixen auf die Piste zu.'), wait: true },
    { sel: '#rail', title: T('Flugstreifen'), text: T('Unten sind alle Flüge als Karten: <b>links Landungen</b>, <b>rechts Starts</b>. Links steht, wer zuerst dran ist. Mit <b>An / Beide / Ab</b> filterst du.'), wait: true },
    { sel: '#rl-arr', title: T('Landefreigabe geben'), text: T('Sobald ein Anflug im Endanflug „bittet um Landefreigabe“ (gelb pulsierend), klicke auf <b>Landefreigabe</b> oder drücke <kbd>L</kbd>. Warte ruhig, bis es so weit ist.'), done: (s, g, c) => s.acs.some((a) => a.clr && a.clr.land && !c.land0.has(a.id)) },
    { sel: '#rl-arr', title: T('Reihenfolge ziehen'), text: T('Ziehe eine Landungskarte vor eine andere – die <b>Auto-Staffelung</b> passt Anflugfreigaben, Geschwindigkeiten und Lücken automatisch an. (Oder: Karte anklicken und ◀ früher.)'), done: (s) => !!s.seqManual || !!s.arrQManual, skip: true },
    { sel: '#rl-dep', title: T('Startfreigabe'), text: T('Steht ein Start am Rollhalt, gib <b>Startfreigabe</b> (<kbd>T</kbd>) – wenn der nächste Anflug noch weit genug weg ist. Sonst erst „Line up“ (<kbd>U</kbd>).'), done: (s, g, c) => s.acs.some((a) => a.clr && a.clr.takeoff && !c.to0.has(a.id)) },
    { sel: '#log-wrap', title: T('Echter Funk'), text: T('Lotse und Piloten sprechen (🔊). Mit der <b>Sprechtaste</b> <kbd>V</kbd> (gedrückt halten) kannst du Freigaben selbst einsprechen, z. B. „Aurora five four two, cleared to land“ (Chrome/Edge).'), wait: true },
    { sel: null, title: T('Los geht’s!'), text: T('Mehr erklärt <b>?</b> neben jedem Abschnitt, Abkürzungen erklären sich beim Überfahren, 📖 öffnet das Glossar. Viel Erfolg im Tower!'), wait: true, last: true },
  ],
  ground: [
    { sel: '#panel', title: T('Vorfeld-Leitstand'), text: T('Hier steuerst du die <b>Abfertigung</b>: Parkpositionen, Fahrzeuge, Kerosin. Die dringendste Abfertigung steht oben – der Balken zeigt den Zeitpuffer bis zur TOBT.'), wait: true },
    { sel: '#gp-ta', title: T('Fahrzeug losschicken'), text: T('Gelb umrandete Felder sind <b>bereit</b>: Klick darauf schickt das nächste freie Fahrzeug (z. B. Tankwagen, Gepäckzug).'), done: (s, g, c) => s.vehicles.some((v) => v.job && !c.jobs0.has(v.id)) },
    { sel: '#gp-all', title: T('Alles bedienen'), text: T('<b>⚡ Alles bedienen</b> oder Taste <kbd>D</kbd> bedient alle bereiten Aufgaben auf einmal – die dringendsten zuerst.'), done: (s, g, c) => c.clickedAll, skip: true },
    { sel: '#gp-inb', title: T('Parkpositionen'), text: T('Ankommende Flüge brauchen eine Position. Automatisch oder per Auswahl – große Jets (L) passen nur auf große Positionen.'), wait: true },
    { sel: '#gp-plan', title: T('Positionsplan'), text: T('Öffne den <b>Positionsplan</b> (<kbd>G</kbd>): ein Zeitstrahl aller Positionen. Ankünfte ohne Position ziehst du einfach auf eine grün leuchtende Zeile.'), done: (s, g) => !!(g.splan && g.splan.isOpen()), skip: true },
    { sel: null, title: T('Los geht’s!'), text: T('Achte auf den Puffer: grün passt, gelb wird knapp, rot kommt zu spät. Im Winter kommt die <b>Enteisung</b> ❄️ dazu. Viel Erfolg!'), wait: true, last: true },
  ],
  manager: [
    { sel: '#panel', title: T('Dein Leitstand'), text: T('Links oben die wichtigsten Zahlen, darunter <b>„Jetzt wichtig“</b> – dort stehen die Dinge, die deine Aufmerksamkeit brauchen.'), wait: true },
    { sel: '.dock-open', title: T('Management-Zentrale'), text: T('Öffne die <b>Management-Zentrale</b> (Klick oder Taste <kbd>O</kbd>). Dort findest du alles: Verträge, Ausbau, Kerosin, Gebühren, Finanzen.'), done: () => !!document.querySelector('#mgmt:not(.hidden)') },
    { sel: '#mg-list', title: T('Kategorien'), text: T('Links die Kategorien. Öffne <b>„Terminal & Landseite“</b> oder <b>„Pisten & Rollwege“</b> und starte einen Ausbau – er wird als Baustelle auf der Karte gebaut.'), done: (s, g, c) => projects(s).length > c.proj0 },
    { sel: '#mgmt [data-mg-close]', title: T('Zurück zum Flughafen'), text: T('Schließe die Zentrale (<kbd>Esc</kbd>) und schau dir die <b>Baustelle</b> auf der Karte an. Unten läuft der Nachrichten-Ticker.'), done: () => !document.querySelector('#mgmt:not(.hidden)') },
    { sel: null, title: T('Los geht’s!'), text: T('Ab und zu kommen <b>Entscheidungskarten</b> – jede Option hat Folgen. Behalte die <b>Pistenauslastung</b> im Blick. Viel Erfolg als Manager!'), wait: true, last: true },
  ],
  observer: [
    { sel: '#panel', title: T('Beobachter'), text: T('Alle Stationen laufen automatisch – du schaust zu. Die Management-Zentrale zeigt alle Zahlen.'), wait: true },
    { sel: '.dock-open.cine', title: T('Kino-Modus'), text: T('Starte den <b>Kino-Modus</b> (<kbd>K</kbd>): Die Kamera fährt selbst zu Landungen, Starts und Abfertigungen.'), done: (s, g) => !!(g.cinema && g.cinema.on), last: true },
  ],
};

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.on = false;
    const el = document.createElement('div');
    el.id = 'tut';
    el.className = 'hidden';
    el.innerHTML = T`<div class="tut-spot"></div><div class="tut-bub"><div class="tut-k"></div><div class="tut-t"></div><div class="tut-x"></div><div class="tut-a"><button class="mini" data-tut="skip">Einführung beenden</button><span class="tut-n"></span><button class="btn btn-good" data-tut="next">Weiter</button></div></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.spot = el.querySelector('.tut-spot');
    this.bub = el.querySelector('.tut-bub');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tut]');
      if (!b) return;
      if (b.dataset.tut === 'skip') this.stop();
      else this.advance();
    });
    // „Alles bedienen“ mitzählen
    document.addEventListener('click', (e) => {
      if (this.on && e.target.closest('#gp-all')) this.ctx.clickedAll = true;
    }, true);
    window.addEventListener('keydown', (e) => {
      if (this.on && (e.key === 'd' || e.key === 'D')) this.ctx.clickedAll = true;
    }, true);
  }

  maybeStart() {
    const s = this.game.state;
    if (!s || !STEPS[s.role] || seen(s.role) || this.pending || this.on) return;
    this.pending = true;
    setTimeout(() => {
      this.pending = false;
      if (!this.on && this.game.state && !seen(this.game.state.role)) this.start();
    }, 900);
  }

  start(role) {
    const s = this.game.state;
    if (!s) return;
    this.role = role || s.role;
    this.steps = STEPS[this.role];
    if (!this.steps) return;
    this.i = 0;
    this.on = true;
    this.el.classList.remove('hidden');
    this.enter();
  }

  stop() {
    this.on = false;
    this.el.classList.add('hidden');
    markSeen(this.role);
  }

  enter() {
    const s = this.game.state;
    // Ausgangslage merken, damit nur neue Aktionen zählen
    this.ctx = {
      land0: new Set(s.acs.filter((a) => a.clr && a.clr.land).map((a) => a.id)),
      to0: new Set(s.acs.filter((a) => a.clr && a.clr.takeoff).map((a) => a.id)),
      jobs0: new Set(s.vehicles.filter((v) => v.job).map((v) => v.id)),
      proj0: projects(s).length,
      clickedAll: false,
    };
    const st = this.steps[this.i];
    this.el.querySelector('.tut-k').textContent = T`Einführung · Schritt ${this.i + 1} von ${this.steps.length}`;
    this.el.querySelector('.tut-t').textContent = st.title;
    this.el.querySelector('.tut-x').innerHTML = st.text + (st.done && !st.wait ? T('<div class="tut-do">👉 Probier es aus – es geht automatisch weiter.</div>') : '');
    const next = this.el.querySelector('[data-tut=next]');
    next.textContent = st.last ? T('Fertig') : st.wait ? T('Weiter') : T('Überspringen');
    next.className = st.wait || st.last ? 'btn btn-good' : 'mini';
    this.place();
  }

  advance() {
    const st = this.steps[this.i];
    if (st.last) return this.stop();
    this.i++;
    if (this.i >= this.steps.length) return this.stop();
    this.enter();
  }

  place() {
    const st = this.steps[this.i];
    const t = st.sel ? document.querySelector(st.sel) : null;
    const W = window.innerWidth, H = window.innerHeight;
    if (!t || !t.offsetParent) {
      this.spot.style.cssText = `left:${W / 2}px;top:${H / 2}px;width:0;height:0`;
      this.bub.style.cssText = `left:${W / 2 - 190}px;top:${H / 2 - 100}px`;
      return;
    }
    const r = t.getBoundingClientRect();
    const pad = 6;
    this.spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    // Blase neben das Ziel: links davon, wenn rechts, sonst darüber/darunter
    const bw = 380, bh = this.bub.offsetHeight || 190;
    let x, y;
    if (r.left > W * 0.55) {
      x = r.left - bw - 18;
      y = Math.min(H - bh - 12, Math.max(12, r.top + 20));
    } else if (r.top > H * 0.5) {
      x = Math.min(W - bw - 12, Math.max(12, r.left + 20));
      y = r.top - bh - 18;
    } else {
      x = Math.min(W - bw - 12, Math.max(12, r.left + 20));
      y = Math.min(H - bh - 12, r.bottom + 18);
    }
    this.bub.style.cssText = `left:${Math.max(12, x)}px;top:${Math.max(12, y)}px`;
  }

  update() {
    if (!this.on) return;
    const s = this.game.state;
    const st = this.steps[this.i];
    if (st.done && st.done(s, this.game, this.ctx)) {
      this.advance();
      return;
    }
    this.place();
  }
}
