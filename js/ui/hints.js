// Kontextbezogene Tipps je Station
import { PH } from '../sim/aircraft.js';
import { tailwind, preferredRunway } from '../sim/atc.js';
import { TASKS, VEH_TYPES } from '../config.js';
import { fleetSummary } from '../sim/ground.js';
import { esc, fmtClock } from '../util.js';
import { runwayClosed, rwyCond } from '../sim/runway.js';
import { fuelState, FUEL } from '../sim/fuel.js';

function towerHint(s) {
  const conf = s.acs.find((a) => a.conflict);
  if (conf) return `⚠ Staffelung unterschritten bei <b>${esc(conf.cs)}</b>! Den Hinteren auf 160 kt bremsen oder in die Warteschleife (H) schicken.`;
  const fe = s.acs.find((a) => a.fuelEmergency && a.mode === 'air' && [PH.INBOUND, PH.HOLD].includes(a.phase));
  if (fe) return `🚨 <b>${esc(fe.cs)}</b> hat MAYDAY FUEL – sofort „Direkt FAF“ (D) und vor allen anderen landen lassen!`;
  const mf = s.acs.find((a) => a.minFuel && a.mode === 'air' && [PH.INBOUND, PH.HOLD].includes(a.phase));
  if (mf) return `⛽ <b>${esc(mf.cs)}</b> meldet MINIMUM FUEL (noch ${Math.round(mf.fuelMin)} min) – als Nächstes freigeben (A oder D).`;
  const ww = s.acs.find((a) => a.wakeWarn);
  if (ww) return `🌀 <b>${esc(ww.cs)}</b> fliegt zu dicht hinter einem schweren Flugzeug (Soll ${ww.wakeReq} NM) – Geschwindigkeit reduzieren oder vorher mehr Abstand planen.`;
  const rc = runwayClosed(s);
  if (rc) return `⛔ Piste gesperrt (${esc(rc)}) – keine Lande- oder Startfreigaben. Anflüge weiterfliegen lassen oder in die Warteschleife (H).`;
  const slotPush = s.acs.find((a) => a.req === 'push' && s.rots[a.rot] && s.rots[a.rot].tsat > s.time + 150);
  if (slotPush) return `<b>${esc(slotPush.cs)}</b> möchte schieben, TSAT ist aber erst ${fmtClock(s.rots[slotPush.rot].tsat)} – „Warten bis TSAT“ (E), sonst wartet er mit laufenden Triebwerken am Rollhalt.`;
  const closing = s.acs.find((a) => a.phase === PH.HOLDING && s.rots[a.rot] && s.rots[a.rot].ctot && s.rots[a.rot].ctot + 600 - s.time < 300 && s.time > s.rots[a.rot].ctot - 300 && !a.clr.takeoff);
  if (closing) return `⏱️ Slot-Fenster von <b>${esc(closing.cs)}</b> schließt um ${fmtClock(s.rots[closing.rot].ctot + 600)} – jetzt Startfreigabe (T), sonst gibt es einen neuen Slot.`;
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
  const fu = fuelState(s);
  if (fu.stock < FUEL.cap * 0.1) return `⛽ Tanklager fast leer (${Math.round(fu.stock)} t) – Tankwagen können kaum nachfüllen. Die Betankungen der frühesten Abflüge zuerst bedienen.`;
  const late = s.acs.find((a) => a.phase === PH.STAND && a.ta && s.rots[a.rot] && s.rots[a.rot].tobt > s.rots[a.rot].std + 240);
  if (late) return `<b>${esc(late.cs)}</b>: TOBT ${fmtClock(s.rots[late.rot].tobt)} liegt nach der STD ${fmtClock(s.rots[late.rot].std)} – fehlende Aufgaben sofort bedienen${s.rots[late.rot].ctot ? `, sonst verfällt der Slot (CTOT ${fmtClock(s.rots[late.rot].ctot)})` : ''}.`;
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
  const fu = fuelState(s);
  if (fu.stock + fu.orders.reduce((t, o) => t + o.qty, 0) < FUEL.cap * 0.3) return `⛽ Kerosin wird knapp (${Math.round(fu.stock)} t) – Management-Zentrale (O) → <b>Kerosin</b>.`;
  if (s.cash < 0) return `Kasse im Minus – Management-Zentrale (O) → <b>Finanzen &amp; Kredite</b>.`;
  if (rwyCond(s) < 50 && !(s.projects || []).some((p) => p.kind === 'rwy')) return `Pistenzustand nur ${Math.round(rwyCond(s))} % – Management-Zentrale (O) → <b>Pisten &amp; Rollwege</b>: Gummiabrieb entfernen (läuft nachts).`;
  if ((s.stats.today.complaints || 0) > 25 && !s.settings.curfew) return `Viele Lärmbeschwerden – Nachtentgelt erhöhen oder Nachtflugverbot prüfen (Zentrale → <b>Gebühren</b>).`;
  if (fu.price < FUEL.basePrice * 0.92 && fu.stock < FUEL.cap * 0.7) return `🛢️ Kerosin ist gerade günstig (${Math.round(fu.price)} €/t) – guter Moment zum Einkaufen.`;
  if (s.offers.length) return `Neues Vertragsangebot – Management-Zentrale (O) → <b>Airlines &amp; Verträge</b>.`;
  if (s.acs.some((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand)) return `Flugzeuge warten auf Parkpositionen – Zentrale (O) → <b>Parkpositionen</b> ausbauen.`;
  const w = s.stats.vehWait || {};
  const worst = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] > 1800) return `Engpass bei ${VEH_TYPES[worst[0]].name}en – Zentrale (O) → <b>Fuhrpark</b> nachkaufen.`;
  if (s.cash > 3000000 && !s.upgrades.retail) return `Tipp: <b>Shopping & Gastronomie</b> erhöht den Umsatz je Passagier dauerhaft.`;
  return null;
}

export function currentHint(s) {
  if (s.role === 'tower') return towerHint(s);
  if (s.role === 'ground') return groundHint(s);
  if (s.role === 'manager') return managerHint(s);
  return null;
}
