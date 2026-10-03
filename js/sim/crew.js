// Betriebsfunk des Vorfelds: Bodencrews melden sich auf Deutsch (Auftrag, fertig, Pushback, Probleme).
// Nur wenn das Vorfeld gespielt wird – im Log als „Crew“, mit Sprachausgabe in der Vorfeld-Rolle.
import { log } from './messages.js';
import { fmtClock } from '../util.js';
import { T, DEC } from '../i18n.js';

const on = (state) => state.role === 'ground';
// feste Auswahl je Anlass, damit die Sprüche abwechseln, ohne den Sim-Zufall zu verbrauchen
const pickLine = (state, list) => list[(state.crewN = ((state.crewN || 0) + 1) % 997) % list.length];
function say(state, from, text, prio = 1) {
  log(state, 'crew', text, from, { prio });
}

const t1 = (x) => String(Math.round(x * 10) / 10).replace('.', DEC);

// Fahrzeug übernimmt einen Auftrag
export function crewDispatch(state, v, ac, k) {
  if (!on(state)) return;
  const P = T`Position ${ac.stand}`;
  const task = ac.ta && ac.ta.tasks[k];
  const L = {
    fuel: [T`verstanden, rolle zu ${P}, ${t1(task && task.uplift ? task.uplift - (task.delivered || 0) : 0)} Tonnen für ${ac.cs}.`, T`${P} übernommen, bin mit dem Tankwagen unterwegs.`],
    baggage: [T`fahre ${P}, Entladen ${ac.cs}.`, T`Gepäckzug unterwegs zu ${P}.`],
    catering: [T`${P} übernommen, Trolleys sind geladen.`, T`Catering rollt zu ${P}.`],
    cleaning: [T`Team unterwegs zu ${P}.`, T`verstanden, Kabinenreinigung ${P}.`],
    bus: [T`fahre ${P}, Passagiere ${ac.cs}.`, T`Bus rollt zu ${P}.`],
    stairs: [T`Treppe kommt an ${P}, vordere Tür.`, T`verstanden, fahre Treppe zu ${P}.`],
    tug: [T`fahre ${P}, Push für ${ac.cs}.`, T`Schlepper unterwegs zu ${P}.`],
    deice: [T`fahre ${P}, Enteisung ${ac.cs}.`, T`verstanden, Enteiser rollt zu ${P}.`],
  }[v.type];
  if (L) say(state, v.name, pickLine(state, L), 1);
}

// Aufgabe erledigt
export function crewDone(state, v, ac, k, task) {
  if (!on(state)) return;
  const P = T`Position ${ac.stand}`;
  let text = null;
  if (k === 'fuel') text = T`${P} betankt, ${t1(task.delivered || task.uplift || 0)} Tonnen, Schlauch ist ab.`;
  else if (k === 'unload') text = pickLine(state, [T`${P} entladen, Gepäck ist auf dem Weg zum Band.`, T`Laderaum an ${P} ist leer.`]);
  else if (k === 'load') text = pickLine(state, [T`${P} beladen, Laderaum zu.`, T`Gepäck und Fracht an ${P} verladen.`]);
  else if (k === 'cater') text = pickLine(state, [T`${P} beliefert, Trolleys verstaut.`, T`Catering an ${P} fertig.`]);
  else if (k === 'clean') text = pickLine(state, [T`Kabine ${P} ist sauber.`, T`Reinigung ${P} abgeschlossen.`]);
  else if (k === 'deice') text = T`${ac.cs} enteist, Holdover ab ${fmtClock(state.time)}.`;
  else if (k === 'stairs') text = pickLine(state, [T`Treppe an ${P} steht, Tür kann auf.`, T`Treppe angesetzt an ${P}, gesichert.`]);
  else if (k === 'board') return say(state, `Gate ${ac.stand}`, pickLine(state, [T`Boarding ${ac.cs} abgeschlossen, Tür ist zu.`, T`alle Passagiere an Bord, ${ac.cs} ist fertig.`]), 2);
  if (text) say(state, v ? v.name : `Crew ${ac.stand}`, text, 1);
}

export function crewStairsAway(state, v, ac) {
  if (!on(state)) return;
  say(state, v.name, pickLine(state, [T`Tür ${ac.cs} ist zu, Treppe ist weg.`, T`Treppe von Position ${ac.stand} abgezogen.`]), 1);
}

export function crewEmpty(state, v, ac, task) {
  if (!on(state)) return;
  say(state, v.name, T`leer an Position ${ac.stand} nach ${t1(task.delivered)} von ${t1(task.uplift)} Tonnen – brauche Ablösung!`, 3);
}

export function crewOnBlock(state, ac) {
  if (!on(state) || !ac.stand) return;
  say(state, T`Einweiser ${ac.stand}`, pickLine(state, [T`${ac.cs} steht, Keile liegen, Triebwerke aus.`, T`${ac.cs} auf Position, Bremsklötze gesetzt.`]), 1);
}

export function crewPushStart(state, ac, tug) {
  if (!on(state)) return;
  say(state, tug ? tug.name : T`Push-Crew ${ac.stand}`, pickLine(state, [T`angekoppelt, Bremsen gelöst – wir schieben ${ac.cs}.`, T`Push ${ac.cs} läuft, Heck ist frei.`]), 2);
}

export function crewPushDone(state, ac, tug) {
  if (!on(state)) return;
  say(state, tug ? tug.name : T('Push-Crew'), pickLine(state, [T`${ac.cs} abgekoppelt, Pin gezogen, Handzeichen gegeben.`, T`Push ${ac.cs} beendet, Schlepper frei.`]), 1);
}

export function crewBroken(state, v, hours) {
  if (!on(state)) return;
  say(state, v.name, T`Panne! Fahrzeug fällt aus, Werkstatt schätzt ${Math.round(hours)} Stunden.`, 3);
}
