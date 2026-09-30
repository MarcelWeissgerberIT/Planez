// Betriebsfunk des Vorfelds: Bodencrews melden sich auf Deutsch (Auftrag, fertig, Pushback, Probleme).
// Nur wenn das Vorfeld gespielt wird – im Log als „Crew“, mit Sprachausgabe in der Vorfeld-Rolle.
import { log } from './messages.js';
import { fmtClock } from '../util.js';

const on = (state) => state.role === 'ground';
// feste Auswahl je Anlass, damit die Sprüche abwechseln, ohne den Sim-Zufall zu verbrauchen
const pickLine = (state, list) => list[(state.crewN = ((state.crewN || 0) + 1) % 997) % list.length];
function say(state, from, text, prio = 1) {
  log(state, 'crew', text, from, { prio });
}

const t1 = (x) => String(Math.round(x * 10) / 10).replace('.', ',');

// Fahrzeug übernimmt einen Auftrag
export function crewDispatch(state, v, ac, k) {
  if (!on(state)) return;
  const P = `Position ${ac.stand}`;
  const task = ac.ta && ac.ta.tasks[k];
  const L = {
    fuel: [`verstanden, rolle zu ${P}, ${t1(task && task.uplift ? task.uplift - (task.delivered || 0) : 0)} Tonnen für ${ac.cs}.`, `${P} übernommen, bin mit dem Tankwagen unterwegs.`],
    baggage: [`fahre ${P}, Entladen ${ac.cs}.`, `Gepäckzug unterwegs zu ${P}.`],
    catering: [`${P} übernommen, Trolleys sind geladen.`, `Catering rollt zu ${P}.`],
    cleaning: [`Team unterwegs zu ${P}.`, `verstanden, Kabinenreinigung ${P}.`],
    bus: [`fahre ${P}, Passagiere ${ac.cs}.`, `Bus rollt zu ${P}.`],
    tug: [`fahre ${P}, Push für ${ac.cs}.`, `Schlepper unterwegs zu ${P}.`],
    deice: [`fahre ${P}, Enteisung ${ac.cs}.`, `verstanden, Enteiser rollt zu ${P}.`],
  }[v.type];
  if (L) say(state, v.name, pickLine(state, L), 1);
}

// Aufgabe erledigt
export function crewDone(state, v, ac, k, task) {
  if (!on(state)) return;
  const P = `Position ${ac.stand}`;
  let text = null;
  if (k === 'fuel') text = `${P} betankt, ${t1(task.delivered || task.uplift || 0)} Tonnen, Schlauch ist ab.`;
  else if (k === 'unload') text = pickLine(state, [`${P} entladen, Gepäck ist auf dem Weg zum Band.`, `Laderaum an ${P} ist leer.`]);
  else if (k === 'load') text = pickLine(state, [`${P} beladen, Laderaum zu.`, `Gepäck und Fracht an ${P} verladen.`]);
  else if (k === 'cater') text = pickLine(state, [`${P} beliefert, Trolleys verstaut.`, `Catering an ${P} fertig.`]);
  else if (k === 'clean') text = pickLine(state, [`Kabine ${P} ist sauber.`, `Reinigung ${P} abgeschlossen.`]);
  else if (k === 'deice') text = `${ac.cs} enteist, Holdover ab ${fmtClock(state.time)}.`;
  else if (k === 'board') return say(state, `Gate ${ac.stand}`, pickLine(state, [`Boarding ${ac.cs} abgeschlossen, Tür ist zu.`, `alle Passagiere an Bord, ${ac.cs} ist fertig.`]), 2);
  if (text) say(state, v ? v.name : `Crew ${ac.stand}`, text, 1);
}

export function crewEmpty(state, v, ac, task) {
  if (!on(state)) return;
  say(state, v.name, `leer an Position ${ac.stand} nach ${t1(task.delivered)} von ${t1(task.uplift)} Tonnen – brauche Ablösung!`, 3);
}

export function crewOnBlock(state, ac) {
  if (!on(state) || !ac.stand) return;
  say(state, `Einweiser ${ac.stand}`, pickLine(state, [`${ac.cs} steht, Keile liegen, Triebwerke aus.`, `${ac.cs} auf Position, Bremsklötze gesetzt.`]), 1);
}

export function crewPushStart(state, ac, tug) {
  if (!on(state)) return;
  say(state, tug ? tug.name : `Push-Crew ${ac.stand}`, pickLine(state, [`angekoppelt, Bremsen gelöst – wir schieben ${ac.cs}.`, `Push ${ac.cs} läuft, Heck ist frei.`]), 2);
}

export function crewPushDone(state, ac, tug) {
  if (!on(state)) return;
  say(state, tug ? tug.name : 'Push-Crew', pickLine(state, [`${ac.cs} abgekoppelt, Pin gezogen, Handzeichen gegeben.`, `Push ${ac.cs} beendet, Schlepper frei.`]), 1);
}

export function crewBroken(state, v, hours) {
  if (!on(state)) return;
  say(state, v.name, `Panne! Fahrzeug fällt aus, Werkstatt schätzt ${Math.round(hours)} Stunden.`, 3);
}
