// Staatsbesuch: Eine Regierungsmaschine (Regierungsstaffel, Rufzeichen „State“) kommt mit einer Delegation.
// Protokoll für den Tower: Landung ohne Warteschleife und ohne Durchstarten. Am Boden warten roter Teppich,
// Ehrenformation und Fahrzeugkolonne an einer Großraumposition; Protokoll fürs Vorfeld: pünktlich abfliegen.
// Gelingt beides, gibt es Ansehen und eine Protokollgebühr – Zeitung, Kino und Fotomomente greifen den Besuch auf.
import { PH, spawnSpecial, tel } from './aircraft.js';
import { radio, log, notify } from './messages.js';
import { scoreProtocol } from './score.js';
import { pushNews } from './news.js';
import { clamp } from '../util.js';
import { AC_TYPES } from '../config.js';

const DAY = 86400;
// gleichmäßige Pseudozufallszahl aus der Spielzeit (verbraucht den Zufallsgenerator des Spiels nicht)
const hash01 = (t) => {
  let h = (Math.floor(t / 60) * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const GUESTS = ['Staatspräsidentin', 'Premierminister', 'Königspaar', 'Bundeskanzlerin', 'Außenminister', 'Staatspräsident'];

export const svActive = (state) => state.sv && !state.sv.done ? state.sv : null;
export const isProtocol = (state, ac) => !!(state.sv && !state.sv.done && ac && state.sv.ac === ac.id);
const rep = (state, d) => (state.reputation = clamp(state.reputation + d, 0, 100));

// Kann gerade ein Staatsbesuch kommen? (eine freie Großraum-Kontaktposition, höchstens einer alle zwei Tage)
export function stateVisitPossible(state) {
  if (svActive(state)) return false;
  if (state.sv && state.time - state.sv.t < 2 * DAY) return false;
  return state.stands.some((st) => st.built && !st.closed && st.size === 'L' && st.kind !== 'cargo');
}

export function startStateVisit(state) {
  if (!stateVisitPossible(state)) return null;
  const n = 1 + Math.floor(hash01(state.time) * 3);
  const guest = GUESTS[Math.floor(hash01(state.time + 11) * GUESTS.length)];
  const ac = spawnSpecial(state, { airline: 'GOV', type: 'A333', arrNo: `GOV0${n}`, depNo: `GOV0${n + 3}`, city: ['VIE', 'CDG', 'ARN', 'BUD', 'DUB', 'IST'][Math.floor(hash01(state.time + 23) * 6)], pax: 46, special: 'state', feeMult: 2 });
  if (!ac) return null;
  ac.protocol = true;
  // Die Delegation hat Termine in der Stadt: etwas mehr Zeit am Boden als ein normaler Umlauf
  const r = state.rots[ac.rot];
  if (r) r.std = r.sta + (AC_TYPES.A333.turn + 35) * 60;
  state.sv = { ac: ac.id, rot: ac.rot, t: state.time, guest, held: false, landT: null, onT: null, offT: null, arrOk: null, depOk: null, done: false };
  const L = state.life || (state.life = {});
  L.stateVisit = (L.stateVisit || 0) + 1;
  notify(state, `🎖️ Staatsbesuch: ${guest} im Anflug (${ac.cs}) – Protokoll: Landung ohne Warteschleife, Abflug pünktlich`, 'good');
  if (state.role === 'ground') notify(state, '🎖️ Vorfeld: eine freie Großraum-Kontaktposition (3 oder 5) für die Regierungsmaschine bereithalten', 'info');
  pushNews(state, `Staatsbesuch: ${guest} landet heute in ${state.name} – die Polizei sperrt die Zufahrt zum Vorfeld.`, 'info', '🎖️');
  log(state, 'sys', `🎖️ Staatsbesuch angekündigt: ${guest} mit der Regierungsmaschine ${ac.cs} (AV-33). Roter Teppich und Kolonne stehen bereit.`);
  return ac;
}

export function updateStateVisit(state, dt) {
  const S = svActive(state);
  if (!S) return;
  const ac = state.acs.find((a) => a.id === S.ac);
  const rot = state.rots[S.rot];
  if (!ac) {
    // Maschine weg (abgeflogen oder ausgewichen)
    finish(state, S, rot);
    return;
  }
  // kurz an der Warteschleife vorbei ist verziehen, echtes Kreisen (über 4 min) nicht
  if (ac.phase === PH.HOLD) S.holdT = (S.holdT || 0) + dt;
  if (S.holdT > 4 * 60 && !S.held) {
    S.held = true;
    log(state, 'sys', `🎖️ ${ac.cs} muss in die Warteschleife – das Protokoll ist nicht begeistert.`);
  }
  if (S.landT == null && ac.mode === 'map' && [PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN].includes(ac.phase)) {
    S.landT = state.time;
    const ga = (rot && rot.goArounds) || 0;
    S.arrOk = !S.held && !ga;
    if (S.arrOk) {
      rep(state, 1);
      notify(state, `🎖️ ${ac.cs} gelandet – pünktlich nach Protokoll, ohne Warteschleife`, 'good');
    } else {
      rep(state, -1);
      notify(state, `🎖️ ${ac.cs} gelandet – ${ga ? 'nach einem Durchstarten' : 'nach der Warteschleife'}; die Delegation ist verstimmt`, 'warn');
    }
    scoreProtocol(state, ac, 'tower', S.arrOk);
    if (state.role === 'ground') log(state, 'crew', `Vorfeld, Vorfeldaufsicht, die Kolonne für ${S.guest} rollt über die Vorfeldstraße, bitte Fahrweg freihalten.`, 'Vorfeldaufsicht', { prio: 2 });
  }
  if (S.onT == null && ac.phase === PH.STAND) {
    S.onT = state.time;
    S.stand = ac.stand;
    log(state, 'sys', `🎖️ ${S.guest} schreitet an Position ${ac.stand} den roten Teppich ab – Ehrenformation und Kolonne stehen bereit.`);
    radio(state, ac.cs, `Ground, ${tel(ac)}, on blocks, thank you for the warm welcome.`);
  }
  if (S.offT == null && S.onT != null && [PH.PUSH, PH.STARTUP, PH.TAXI_OUT].includes(ac.phase)) {
    S.offT = state.time;
    const late = rot ? (state.time - rot.std) / 60 : 0;
    S.depOk = late <= 5;
    if (S.depOk) {
      rep(state, 1);
      notify(state, `🎖️ ${ac.cs} pünktlich off-block – die Delegation verabschiedet sich zufrieden`, 'good');
    } else {
      rep(state, -1);
      notify(state, `🎖️ ${ac.cs} ${Math.round(late)} min zu spät – das Protokoll vermerkt die Verspätung`, 'warn');
    }
    scoreProtocol(state, ac, 'ground', S.depOk);
  }
  if (ac.mode === 'air' && ac.phase === PH.DEPART) finish(state, S, rot);
}

function finish(state, S, rot) {
  S.done = true;
  const perfect = S.arrOk && S.depOk;
  const L = state.life || (state.life = {});
  if (perfect) L.svPerfect = (L.svPerfect || 0) + 1;
  if (S.landT == null) return; // ausgewichen – kein Abschlussbericht
  log(state, 'sys', perfect ? `🎖️ Staatsbesuch ohne Makel: ${S.guest} bedankt sich für den reibungslosen Ablauf.` : `🎖️ Staatsbesuch beendet${S.arrOk === false ? ' – Ankunft nicht nach Protokoll' : ''}${S.depOk === false ? ' – Abflug verspätet' : ''}.`);
  if (perfect) {
    notify(state, '🎖️ Staatsbesuch ohne Makel – Dankschreiben der Staatskanzlei', 'good');
    pushNews(state, `${S.guest} reist ab – Lob für den reibungslosen Ablauf am Flughafen.`, 'good', '🎖️');
  }
}

// Kolonne: Position der Fahrzeuge (Polizei vorn und hinten, drei Limousinen) – nur für die Darstellung
// u: 0 = noch nicht da, 1 = am Flugzeug geparkt; danach wieder 1 → 0 bei der Abfahrt
export function motorcade(state) {
  const S = svActive(state) || (state.sv && state.sv.done && state.sv.offT && state.time - state.sv.offT < 480 ? state.sv : null);
  if (!S) return null;
  const ac = state.acs.find((a) => a.id === S.ac);
  const stand = state.stands.find((st) => st.id === (S.stand || (ac && ac.stand)));
  if (!stand) return null;
  const T = 480; // Sim-Sekunden für die Anfahrt (gemächliches Kolonnentempo)
  let u = 0, leaving = false;
  if (S.offT != null) {
    u = 1 - clamp((state.time - S.offT) / T, 0, 1);
    leaving = true;
  } else if (S.landT != null) u = clamp((state.time - S.landT) / T, 0, 1);
  else return null;
  return { stand, u, leaving, carpet: !!(ac && ac.phase === PH.STAND) };
}
