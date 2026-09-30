// Kontextbezogene Tipps je Station
import { PH } from '../sim/aircraft.js';
import { tailwind, preferredRunway } from '../sim/atc.js';
import { TASKS, VEH_TYPES } from '../config.js';
import { fleetSummary } from '../sim/ground.js';
import { esc } from '../util.js';

function towerHint(s) {
  const conf = s.acs.find((a) => a.conflict);
  if (conf) return `⚠ Staffelung unterschritten bei <b>${esc(conf.cs)}</b>! Den Hinteren auf 160 kt bremsen oder in die Warteschleife (H) schicken.`;
  const land = s.acs.find((a) => a.req === 'land');
  if (land) return `<b>${esc(land.cs)}</b> ist auf dem Endanflug – Landefreigabe (L) geben, sobald die Piste frei ist. Ohne Freigabe startet er bei 1 NM durch.`;
  const vac = s.acs.find((a) => a.req === 'taxi_in' && a.stand);
  if (vac) return `<b>${esc(vac.cs)}</b> hat die Piste verlassen – Rollfreigabe zur Position ${vac.stand} (R).`;
  const push = s.acs.find((a) => a.req === 'push');
  if (push) return `<b>${esc(push.cs)}</b> ist abgefertigt – Pushback freigeben (P). Achte auf Verkehr auf der Vorfeldstraße.`;
  const tx = s.acs.find((a) => a.req === 'taxi_out');
  if (tx) return `<b>${esc(tx.cs)}</b> ist startklar – Rollfreigabe zum Rollhalt (R).`;
  const first = s.seq && s.seq.length ? s.acs.find((a) => a.id === s.seq[0]) : null;
  if (first && first.phase === PH.HOLDING && !first.clr.takeoff && !first.clr.lineup) return `<b>${esc(first.cs)}</b> ist #1 der Pistenfolge und wartet am Rollhalt – Startfreigabe (T) oder erst „Line up“ (U).`;
  const to = s.acs.find((a) => a.req === 'takeoff');
  if (to) return `<b>${esc(to.cs)}</b> wartet am Rollhalt. Startfreigabe (T), wenn der nächste Anflug noch mindestens ~5 NM entfernt ist.`;
  const app = s.acs.filter((a) => a.phase === PH.APPROACH || a.phase === PH.FINAL).length;
  const holds = s.acs.filter((a) => a.phase === PH.HOLD).sort((a, b) => a.alt - b.alt);
  const wait = holds[0] || s.acs.filter((a) => a.phase === PH.INBOUND).sort((a, b) => Math.hypot(a.pos.x, a.pos.y) - Math.hypot(b.pos.x, b.pos.y))[0];
  if (wait && app < 2) return `Gib <b>${esc(wait.cs)}</b> die Anflugfreigabe (A). Zwischen zwei Anflügen etwa 6–8 NM Abstand lassen.`;
  if (preferredRunway(s) !== s.rwy && tailwind(s, s.rwy) > 5 && !s.rwyPending) return `Rückenwind auf Piste ${s.rwy} – Betriebsrichtung oben im Panel wechseln.`;
  return null;
}

function groundHint(s) {
  const need = s.acs.find((a) => a.arr && !a.stand && [PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT].includes(a.phase));
  if (need) return `<b>${esc(need.cs)}</b> hat keine Parkposition – oben zuweisen oder Flugzeug anklicken und dann eine Position (P…) auf der Karte.`;
  const fs = fleetSummary(s);
  for (const ac of s.acs) {
    if (ac.phase !== PH.STAND || !ac.ta) continue;
    for (const t of Object.values(ac.ta.tasks)) {
      if (t.st !== 'ready' || !t.need || s.settings.vehAuto[t.need]) continue;
      const f = fs[t.need];
      if (f.total - f.busy - f.broken <= 0) return `Alle ${VEH_TYPES[t.need].name}s sind im Einsatz – die frühesten Abflüge zuerst bedienen oder den Typ auf Auto schalten.`;
      return `Bei <b>${esc(ac.cs)}</b> (P${ac.stand}) ist „${TASKS[t.k].name}“ bereit – gelbes Feld anklicken, um ${VEH_TYPES[t.need].name} zu schicken.`;
    }
  }
  return null;
}

function managerHint(s) {
  if (s.offers.length) return `Neues Vertragsangebot – im Tab <b>Verträge</b> prüfen, ob die Kapazität reicht.`;
  if (s.acs.some((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand)) return `Flugzeuge warten auf Parkpositionen – unter <b>Ausbau</b> neue Positionen bauen.`;
  const w = s.stats.vehWait || {};
  const worst = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] > 1800) return `Engpass bei ${VEH_TYPES[worst[0]].name}en – im Tab <b>Betrieb</b> Fahrzeuge nachkaufen.`;
  if (s.cash > 3000000 && !s.upgrades.retail) return `Tipp: <b>Shopping & Gastronomie</b> erhöht den Umsatz je Passagier dauerhaft.`;
  return null;
}

export function currentHint(s) {
  if (s.role === 'tower') return towerHint(s);
  if (s.role === 'ground') return groundHint(s);
  if (s.role === 'manager') return managerHint(s);
  return null;
}
