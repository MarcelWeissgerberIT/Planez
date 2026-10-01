// Ereigniskarten mit Entscheidungen für die gespielte Rolle (Tower, Vorfeld, Manager).
// Jede Karte hat 2–3 Optionen mit echten Auswirkungen; ohne Antwort gilt nach Ablauf die erste Option.
// Rollen, die die KI spielt, entscheiden still selbst.
import { AIRLINES, CITIES, AC_TYPES, SIZE_RANK } from '../config.js';
import { rand, randRange, randInt, pick, pickWeighted, clamp, fmtMoney } from '../util.js';
import { log, notify, fx } from './messages.js';
import { earn, spend } from './economy.js';
import { PH, spawnSpecial, goAround } from './aircraft.js';
import * as AS from './airspace.js';
import { closeRunway } from './runway.js';
import { birdstrikeOn } from './events.js';
import { fuelState, FUEL, maxOrder } from './fuel.js';
import { CMDS, command } from './atc.js';
import { RIVAL_NAME, rivalState, acceptDiversions } from './rival.js';
import { temperature } from './winter.js';
import { pushNews } from './news.js';

const MIN = 60, H = 3600;
const repDelta = (state, d) => (state.reputation = clamp(state.reputation + d, 0, 100));
const byId = (state, id) => state.acs.find((a) => a.id === id);
const contractOfAc = (state, ac) => {
  const rot = ac && state.rots[ac.rot];
  return rot && rot.contract ? state.contracts.find((c) => c.id === rot.contract) : null;
};
const satDelta = (c, d) => c && (c.sat = clamp(c.sat + d, 0, 100));
const task = (ac, k) => ac && ac.ta && ac.ta.tasks[k];

// ---------------- Katalog ----------------
// cond(state) -> Parameter oder null; card(state, p) -> { icon, title, text, options: [{ label, detail, run(state, p) }] }
export const CATALOG = {
  // ======== Vorfeld ========
  belt: {
    role: 'ground', weight: 1.2, timeout: 8 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && [`Bandlader ${a.stand}`, `Vorfeld, Bandlader an Position ${a.stand}, das Band steht, ${a.cs} ist halb verladen. Wie geht's weiter?`]; },
    cond: (s) => {
      const c = s.acs.filter((a) => a.phase === PH.STAND && (['unload', 'load'].some((k) => task(a, k) && ['ready', 'active', 'wait'].includes(task(a, k).st))));
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🧳', title: `Gepäckband an P${ac?.stand} ausgefallen`,
        text: `Der Bandlader an ${ac?.cs} streikt. Techniker holen kostet Geld und kurz Zeit, Verladen per Hand dauert deutlich länger.`,
        options: [
          { label: 'Techniker rufen', detail: '8.000 € · 10 min Stillstand', run: (st) => { spend(st, 'other', 8000); for (const k of ['unload', 'load']) { const t = task(byId(st, p.ac), k); if (t) t.pausedUntil = st.time + 10 * MIN; } } },
          { label: 'Per Hand verladen', detail: 'Ent-/Beladen 70 % langsamer', run: (st) => { for (const k of ['unload', 'load']) { const t = task(byId(st, p.ac), k); if (t) t.slow = 1.7; } } },
        ],
      };
    },
  },
  missingPax: {
    role: 'ground', weight: 1, timeout: 6 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && [`Gate ${a.stand}`, `Vorfeld, Gate an Position ${a.stand}, uns fehlt ein Passagier für ${a.cs}, sein Koffer ist schon an Bord.`]; },
    cond: (s) => {
      const c = s.acs.filter((a) => a.phase === PH.STAND && task(a, 'board') && ['active', 'ready', 'wait'].includes(task(a, 'board').st) && s.rots[a.rot]?.paxOut > 20);
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🚶', title: `Passagier fehlt bei ${ac?.cs}`,
        text: 'Ein eingecheckter Passagier ist nicht am Gate. Warten kostet Zeit, sonst muss sein Koffer wieder ausgeladen werden.',
        options: [
          { label: 'Gepäck ausladen', detail: 'Beladen +5 min · Airline etwas unzufrieden', run: (st) => { const a = byId(st, p.ac); const t = task(a, 'load'); if (t) { t.dur += 5 * MIN; if (t.st === 'done') { t.st = 'ready'; t.prog = 0.7; t.readyT = st.time; } } satDelta(contractOfAc(st, a), -1); } },
          { label: 'Bis zu 8 min warten', detail: 'Boarding +8 min · meist taucht er auf', run: (st) => { const t = task(byId(st, p.ac), 'board'); if (t) t.dur += 8 * MIN; } },
        ],
      };
    },
  },
  catering: {
    role: 'ground', weight: 0.8, timeout: 6 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && ['Catering', `Vorfeld, Catering an Position ${a.stand}, Kühlkette gerissen, die Mahlzeiten für ${a.cs} dürfen nicht an Bord.`]; },
    cond: (s) => {
      const c = s.acs.filter((a) => a.phase === PH.STAND && task(a, 'cater') && ['ready', 'wait', 'active'].includes(task(a, 'cater').st));
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🍱', title: `Catering-Problem bei ${ac?.cs}`,
        text: 'Die Kühlkette der Bordverpflegung ist unterbrochen. Neue Mahlzeiten kosten Zeit, ohne warmes Essen ist die Airline verärgert.',
        options: [
          { label: 'Neue Mahlzeiten', detail: '3.000 € · Catering +12 min', run: (st) => { spend(st, 'other', 3000); const t = task(byId(st, p.ac), 'cater'); if (t) t.dur += 12 * MIN; } },
          { label: 'Ohne warmes Essen', detail: 'Zufriedenheit der Airline −4', run: (st) => { const a = byId(st, p.ac); const t = task(a, 'cater'); if (t) t.dur = Math.max(60, t.dur * 0.4); satDelta(contractOfAc(st, a), -4); } },
        ],
      };
    },
  },
  aog: {
    role: 'ground', weight: 0.5, timeout: 6 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && ['Technik', `Vorfeld, Technik an Position ${a.stand}, Positionsleuchte an ${a.cs} ist defekt. Tauschen oder nach MEL fliegen lassen?`]; },
    cond: (s) => {
      const c = s.acs.filter((a) => a.phase === PH.STAND && a.ta && task(a, 'board') && task(a, 'board').st !== 'done' && !a.aogDone);
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🔧', title: `Technischer Defekt an ${ac?.cs}`,
        text: 'Beim Außencheck meldet der Mechaniker eine defekte Positionsleuchte. Reparieren kostet Zeit – laut Mindestausrüstungsliste (MEL) darf die Maschine bei Tag auch so fliegen, aber die Airline sieht das nicht gern.',
        options: [
          { label: 'Reparieren', detail: '6.000 € · Abfertigung 15 min angehalten', run: (st) => { const a = byId(st, p.ac); if (!a) return; a.aogDone = true; spend(st, 'other', 6000); for (const t of Object.values(a.ta?.tasks || {})) if (t.st !== 'done') t.pausedUntil = st.time + 15 * MIN; log(st, 'gnd', `🔧 ${a.cs}: Positionsleuchte wird getauscht – Abfertigung ruht 15 Minuten.`); } },
          { label: 'Mit MEL-Freigabe fliegen', detail: '30 %: Airline verärgert, Ansehen −2', run: (st) => { const a = byId(st, p.ac); if (!a) return; a.aogDone = true; if (rand(st) < 0.3) { satDelta(contractOfAc(st, a), -6); repDelta(st, -2); log(st, 'gnd', `🔧 ${a.cs} fliegt mit MEL-Freigabe – die Airline beschwert sich über die Wartungsqualität.`); } else log(st, 'gnd', `🔧 ${a.cs} fliegt mit MEL-Freigabe, Reparatur am Zielflughafen.`); } },
        ],
      };
    },
  },
  loadsheet: {
    role: 'ground', weight: (s) => (s.scenario ? 0 : 0.5), // in Herausforderungen nicht – deren Balance bleibt unverändert timeout: 5 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && ['Ladeplanung', `Vorfeld, Ladeplanung, das Loadsheet von ${a.cs} passt nicht, rund ${p.kg} Kilo zu viel im hinteren Frachtraum.`]; },
    cond: (s) => {
      const c = s.acs.filter((a) => a.phase === PH.STAND && AC_TYPES[a.type].size !== 'S' && task(a, 'load') && ['active', 'done'].includes(task(a, 'load').st) && task(a, 'board') && task(a, 'board').st !== 'done' && !a.lsDone);
      return c.length ? { ac: pick(s, c).id, kg: randInt(s, 4, 9) * 100 } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '📋', title: `Loadsheet-Abweichung bei ${ac?.cs}`,
        text: `Die Schlussladeliste weicht ab: ${p.kg} kg mehr im hinteren Frachtraum als geplant. Umladen kostet ein paar Minuten. Ohne Umladen rechnet die Ladeplanung ein neues Loadsheet – manche Kapitäne bestehen trotzdem aufs Umladen.`,
        options: [
          { label: 'Neues Loadsheet rechnen', detail: '+2 min · 25 %: Kapitän verlangt doch Umladen (+12 min)', run: (st) => { const a = byId(st, p.ac); if (!a) return; a.lsDone = true; const t = task(a, 'board'); const no = rand(st) < 0.25; if (t) t.dur += (no ? 12 : 2) * MIN; if (no) log(st, 'gnd', `📋 Der Kapitän von ${a.cs} akzeptiert das neue Loadsheet nicht – es wird doch umgeladen.`); } },
          { label: 'Umladen', detail: 'Beladen +7 min', run: (st) => { const a = byId(st, p.ac); if (!a) return; a.lsDone = true; const t = task(a, 'load'); if (t) { t.dur += 7 * MIN; if (t.st === 'done') { t.st = 'ready'; t.prog = 0.75; t.readyT = st.time; } } } },
        ],
      };
    },
  },
  bagAlarm: {
    role: 'ground', weight: (s) => (s.scenario ? 0 : 0.35), timeout: 4 * MIN,
    crew: () => ['Sicherheitsdienst', 'Vorfeld, Sicherheitsdienst, herrenloser Koffer im Abflugbereich, wir brauchen eine Entscheidung zur Räumung.'],
    cond: (s) => {
      const n = s.acs.filter((a) => a.phase === PH.STAND && task(a, 'board') && task(a, 'board').st !== 'done').length;
      return n >= 2 && (s.time - (s.bagAlarmT || -1e9)) > 6 * H ? { n } : null;
    },
    card: (s, p) => ({
      icon: '🧳', title: 'Herrenloser Koffer im Terminal',
      text: `Im Abflugbereich steht ein Koffer ohne Besitzer. ${p.n} Maschinen sind gerade im Boarding. Räumen kostet überall Zeit, der Sprengstoffhund ist schneller, aber teuer – und Ignorieren ist keine gute Idee.`,
      options: [
        { label: 'Sprengstoffhund anfordern', detail: '6.000 € · Boarding überall +4 min', run: (st) => { st.bagAlarmT = st.time; spend(st, 'other', 6000); for (const a of st.acs) { const t = task(a, 'board'); if (a.phase === PH.STAND && t && t.st !== 'done') t.dur += 4 * MIN; } log(st, 'gnd', '🐕 Sprengstoffhund gibt Entwarnung – vergessener Koffer, Boarding geht weiter.'); } },
        { label: 'Bereich räumen', detail: 'Boarding überall +12 min · Ansehen +0,5 (Sicherheit zuerst)', run: (st) => { st.bagAlarmT = st.time; repDelta(st, 0.5); for (const a of st.acs) { const t = task(a, 'board'); if (a.phase === PH.STAND && t && t.st !== 'done') t.pausedUntil = st.time + 12 * MIN; } log(st, 'gnd', '🚨 Abflugbereich geräumt – Boarding ruht 12 Minuten, dann Entwarnung.'); pushNews(st, 'Herrenloser Koffer: Abflugbereich kurzzeitig geräumt – Entwarnung nach zwölf Minuten.', 'info', '🧳'); } },
        { label: 'Ignorieren', detail: '20 %: Bundespolizei greift ein – Ansehen −4, Boarding +15 min', run: (st) => { st.bagAlarmT = st.time; if (rand(st) < 0.2) { repDelta(st, -4); for (const a of st.acs) { const t = task(a, 'board'); if (a.phase === PH.STAND && t && t.st !== 'done') t.pausedUntil = st.time + 15 * MIN; } notify(st, '🚨 Die Polizei räumt den Abflugbereich – der Flughafen hatte nicht reagiert', 'bad'); pushNews(st, 'Herrenloser Koffer: Polizei kritisiert späte Reaktion des Flughafens.', 'bad', '🧳'); } } },
      ],
    }),
  },
  heat: {
    role: 'ground', weight: (s) => (s.scenario ? 0 : 0.6), timeout: 5 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && [`Gate ${a.stand}`, `Vorfeld, Gate an Position ${a.stand}, in der Kabine von ${a.cs} sind es über dreißig Grad, die Passagiere beschweren sich.`]; },
    cond: (s) => {
      if (temperature(s) < 25) return null;
      const c = s.acs.filter((a) => a.phase === PH.STAND && task(a, 'board') && ['ready', 'active', 'wait'].includes(task(a, 'board').st) && !a.pcaDone);
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🌡️', title: `Kabine überhitzt bei ${ac?.cs}`,
        text: `${Math.round(temperature(s))} °C auf dem Vorfeld, die Klimaanlage läuft am Boden nur mit Hilfsturbine. Ein Klimagerät (PCA) kühlt die Kabine schnell – oder das Boarding wartet, bis es erträglich ist.`,
        options: [
          { label: 'Klimagerät anschließen', detail: '2.500 € · Boarding normal', run: (st) => { const a = byId(st, p.ac); if (a) a.pcaDone = true; spend(st, 'other', 2500); } },
          { label: 'Türen auf und warten', detail: 'Boarding +6 min · Airline etwas unzufrieden', run: (st) => { const a = byId(st, p.ac); if (!a) return; a.pcaDone = true; const t = task(a, 'board'); if (t) t.dur += 6 * MIN; satDelta(contractOfAc(st, a), -2); } },
        ],
      };
    },
  },
  wrongBag: {
    role: 'ground', weight: 0.5, timeout: 5 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && ['Gepäckabgleich', `Vorfeld, Gepäckabgleich, in ${a.cs} an Position ${a.stand} liegt ein Koffer, der da nicht hingehört.`]; },
    cond: (s) => {
      const c = s.acs.filter((a) => a.phase === PH.STAND && task(a, 'load') && ['active', 'done'].includes(task(a, 'load').st) && task(a, 'board') && task(a, 'board').st !== 'done');
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🧳', title: `Koffer im falschen Flugzeug (${ac?.cs})`,
        text: 'Der Gepäckabgleich meldet einen Koffer an Bord, dessen Passagier eine andere Maschine nimmt. Umladen kostet ein paar Minuten, nachsenden kostet Geld und Nerven.',
        options: [
          { label: 'Umladen', detail: 'Beladen +6 min', run: (st) => { const t = task(byId(st, p.ac), 'load'); if (t) { t.dur += 6 * MIN; if (t.st === 'done') { t.st = 'ready'; t.prog = 0.8; t.readyT = st.time; } } } },
          { label: 'Per Kurier nachsenden', detail: '1.500 € · Passagier verärgert', run: (st) => { spend(st, 'other', 1500); repDelta(st, -0.5); } },
        ],
      };
    },
  },
  noStand: {
    role: 'ground', weight: 0, urgent: 2 * H, timeout: 4 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && ['Vorfeldaufsicht', `Vorfeld, ${a.cs} steht auf dem Rollweg und wartet, alle passenden Positionen sind belegt.`]; },
    cond: (s) => {
      const w = s.acs.find((a) => a.arr && !a.stand && [PH.VACATED, PH.TAXI_WAIT].includes(a.phase) && s.time - (a.reqT || s.time) > 3 * MIN);
      if (!w) return null;
      const t = AC_TYPES[w.type];
      const fits = (st) => st.built && !st.closed && SIZE_RANK[st.size] >= SIZE_RANK[t.size] && !(t.cargo && st.kind !== 'cargo');
      // Abflug an einer passenden Position, der am weitesten ist
      let best = null, bestDone = -1;
      for (const st of s.stands) {
        if (!fits(st) || !st.occ) continue;
        const d = s.acs.find((a) => a.id === st.occ && a.phase === PH.STAND && a.ta);
        if (!d) continue;
        const tk = Object.values(d.ta.tasks);
        const done = tk.filter((x) => x.st === 'done').length / Math.max(1, tk.length);
        if (done > bestDone) {
          bestDone = done;
          best = d;
        }
      }
      return best ? { ac: w.id, dep: best.id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac), dep = byId(s, p.dep);
      return {
        icon: '🅿️', title: `${ac?.cs} wartet auf eine Position`,
        text: `Alle passenden Positionen sind belegt, ${ac?.cs} steht mit laufenden Triebwerken auf dem Rollweg. Am weitesten ist ${dep?.cs} an P${dep?.stand} – mit Extra-Personal ginge es dort schneller.`,
        options: [
          { label: 'Warten lassen', detail: 'Airline von ' + (ac?.cs || '') + ' unzufrieden', run: (st) => satDelta(contractOfAc(st, byId(st, p.ac)), -3) },
          { label: `${dep?.cs || 'Abflug'} beschleunigen`, detail: '4.000 € Extra-Personal · Restarbeiten halb so lang', run: (st) => { const d = byId(st, p.dep); if (!d || !d.ta) return; spend(st, 'other', 4000); for (const [k, t] of Object.entries(d.ta.tasks)) if (t.st !== 'done' && k !== 'push') t.dur = Math.max(60, t.dur * 0.5); log(st, 'gnd', `🅿️ Extra-Personal an P${d.stand}: ${d.cs} wird schneller fertig, damit ${byId(st, p.ac)?.cs || 'die Ankunft'} einparken kann.`); } },
        ],
      };
    },
  },
  // Anschlussflug: verspätete Ankunft mit Umsteigern für einen Abflug derselben Airline
  connection: {
    role: 'ground', weight: 0.3, timeout: 6 * MIN, urgent: 3 * H,
    crew: (s, p) => { const a = byId(s, p.arr), d = byId(s, p.dep); return a && d && ['Transfer', `Vorfeld, Transferschalter, ${p.n} Umsteiger aus ${a.cs} wollen noch auf ${d.cs} an Position ${d.stand}.`]; },
    cond: (s) => {
      const late = s.acs.filter((a) => a.arr && a.mode === 'air' && [PH.INBOUND, PH.HOLD, PH.APPROACH].includes(a.phase) && ((s.rots[a.rot]?.arrDelay || 0) >= 3 || a.phase === PH.HOLD));
      for (const a of late) {
        const deps = s.acs.filter((d) => d.phase === PH.STAND && d.airline === a.airline && d.ta && task(d, 'board') && task(d, 'board').st !== 'done' && s.rots[d.rot] && s.rots[d.rot].std - s.time < 50 * MIN && s.rots[d.rot].std - s.time > 8 * MIN);
        if (deps.length) return { arr: a.id, dep: pick(s, deps).id, n: randInt(s, 8, 34) };
      }
      return null;
    },
    card: (s, p) => {
      const a = byId(s, p.arr), d = byId(s, p.dep);
      const dr = d && s.rots[d.rot];
      const city = dr ? CITIES[dr.city]?.name : '…';
      return {
        icon: '🔁', title: `Anschluss: ${p.n} Umsteiger von ${a?.cs || '…'}`,
        text: `${a?.cs || 'Die Ankunft'} ist verspätet. ${p.n} Umsteiger wollen noch auf ${d?.cs || '…'} nach ${city} (P${d?.stand || '?'}). Warten verschiebt das Boarding, ohne sie zu starten verärgert Reisende und Airline.`,
        options: [
          { label: 'Auf die Umsteiger warten', detail: 'Boarding +9 min · Airline zufrieden', run: (st) => { const dd = byId(st, p.dep); const t = task(dd, 'board'); if (t) t.dur += 9 * MIN; const r = dd && st.rots[dd.rot]; if (r) r.paxOut += p.n; satDelta(contractOfAc(st, dd), 3); } },
          { label: 'Umbuchen auf den nächsten Flug', detail: `${fmtMoney(p.n * 180)} Hotel & Umbuchung · Ansehen −0,5`, run: (st) => { spend(st, 'other', p.n * 180); repDelta(st, -0.5); } },
          { label: 'Ohne sie abfliegen', detail: 'Ansehen −1,5 · Airline verärgert', run: (st) => { repDelta(st, -1.5); satDelta(contractOfAc(st, byId(st, p.dep)), -4); } },
        ],
      };
    },
  },
  fuelSpill: {
    role: 'ground', weight: 0.7, timeout: 5 * MIN,
    crew: (s, p) => { const a = byId(s, p.ac); return a && ['Tankwagen', `Vorfeld, Tankwagen an Position ${a.stand}, Kerosin läuft aus, Betankung ${a.cs} gestoppt!`]; },
    cond: (s) => {
      const c = s.acs.filter((a) => a.phase === PH.STAND && task(a, 'fuel') && task(a, 'fuel').st === 'active');
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🛢️', title: `Kerosin ausgelaufen an P${ac?.stand}`,
        text: `Beim Betanken von ${ac?.cs} ist Kerosin ausgetreten. Die Betankung ruht, bis die Stelle gereinigt ist.`,
        options: [
          { label: 'Flughafenfeuerwehr', detail: '6.000 € · 5 min Pause', run: (st) => { spend(st, 'other', 6000); const t = task(byId(st, p.ac), 'fuel'); if (t) t.pausedUntil = st.time + 5 * MIN; } },
          { label: 'Eigenes Team', detail: 'kostenlos · 15 min Pause', run: (st) => { const t = task(byId(st, p.ac), 'fuel'); if (t) t.pausedUntil = st.time + 15 * MIN; } },
        ],
      };
    },
  },
  lightning: {
    role: 'ground', weight: 0.6, timeout: 4 * MIN,
    crew: () => ['Wetterwarte', 'An alle Bodencrews, Blitzwarnung, Gewitter im Umkreis von fünf Kilometern.'],
    cond: (s) => (['rain', 'clouds'].includes(s.weather.kind) && s.acs.some((a) => a.phase === PH.STAND) ? {} : null),
    card: () => ({
      icon: '⚡', title: 'Blitzwarnung im Umkreis von 5 km',
      text: 'Gewitterzellen ziehen nah am Flughafen vorbei. Vorschrift ist, das Vorfeld zu räumen – Weiterarbeiten spart Zeit, ist aber riskant.',
      options: [
        { label: 'Vorfeld räumen', detail: '12 min keine Abfertigung', run: (st) => { st.rampClosedUntil = st.time + 12 * MIN; log(st, 'gnd', 'Blitzwarnung: Vorfeld geräumt, Abfertigung ruht 12 Minuten.'); } },
        { label: 'Weiterarbeiten', detail: '30 % Risiko: Unfall, Ansehen −6', run: (st) => { if (rand(st) < 0.3) { repDelta(st, -6); spend(st, 'penalties', 25000); notify(st, '⚡ Blitzeinschlag nahe eines Mitarbeiters – Arbeitsunfall, Ermittlungen', 'bad'); st.rampClosedUntil = st.time + 25 * MIN; } } },
      ],
    }),
  },

  hubOffer: {
    role: 'manager', weight: 0.35, timeout: 4 * H,
    cond: (s) => {
      if (s.scenario || s.hub || s.hubPending || s.time < 3 * 86400 || s.reputation < 55) return null; // nicht in kurzen Herausforderungen
      // größter Partner (ohne Zufall – die Bedingung wird oft geprüft und soll den Spielverlauf nicht verschieben)
      const cnt = {};
      for (const c of s.contracts) if (AIRLINES[c.airline] && !AIRLINES[c.airline].special && AIRLINES[c.airline].types.some((t) => !AC_TYPES[t].cargo)) cnt[c.airline] = (cnt[c.airline] || 0) + 1;
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      return best ? { al: best[0] } : null;
    },
    card: (s, p) => {
      const al = AIRLINES[p.al];
      return {
        icon: '🌐', title: `${al.name} will eine Basis in ${s.name}`,
        text: `${al.name} möchte Flugzeuge und Crews hier stationieren: vier neue Verbindungen auf einen Schlag, 30 Tage fest. Dafür verlangt die Airline 15 % Rabatt auf die Entgelte und jede Woche mindestens 85 % Pünktlichkeit – zweimal verfehlt, und sie zieht wieder ab.`,
        options: [
          { label: 'Ablehnen', detail: 'kein Risiko für Pünktlichkeit und Entgelte', run: (st) => log(st, 'mgr', `${al.name} bekommt keine Basis – die Airline schaut sich bei ${RIVAL_NAME} um.`) },
          { label: 'Basis-Vertrag unterschreiben', detail: '4 Verbindungen · Entgelte −15 % · Ansehen +2', run: (st) => { st.hubPending = { airline: p.al, mult: 0.85 }; repDelta(st, 2); pushNews(st, `${al.name} macht ${st.name} zur Basis – neue Verbindungen ab übermorgen.`, 'good', '🌐'); } },
          { label: 'Nachverhandeln (nur −8 %)', detail: '50 % Chance – sonst geht die Basis an Nordhafen', run: (st) => {
            if (rand(st) < 0.5) {
              st.hubPending = { airline: p.al, mult: 0.92 };
              repDelta(st, 2);
              pushNews(st, `Harte Verhandlung, gutes Ergebnis: ${al.name} eröffnet eine Basis in ${st.name}.`, 'good', '🌐');
            } else {
              const R = rivalState(st);
              R.share = Math.max(5, R.share - 2);
              pushNews(st, `${al.name} eröffnet ihre neue Basis in ${RIVAL_NAME} statt bei uns.`, 'bad', '🏢');
            }
          } },
        ],
      };
    },
    // KI: nur bei guter Pünktlichkeit zusagen
    ai: (s) => (((s.history[s.history.length - 1] || {}).onTime || 0) >= 88 ? 1 : 0),
  },

  // ======== Tower ========
  medical: {
    role: 'tower', weight: 1, timeout: 5 * MIN,
    cond: (s) => {
      const c = s.acs.filter((a) => a.arr && a.mode === 'air' && [PH.INBOUND, PH.HOLD, PH.APPROACH].includes(a.phase) && !a.emergency && !a.medical);
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🩺', title: `Medizinischer Notfall an Bord von ${ac?.cs}`,
        text: 'Ein Passagier hat Herzprobleme. Der Pilot bittet um Vorrang. Vorrang heißt: Direktanflug, andere warten.',
        options: [
          { label: 'Vorrang + Rettungswagen', detail: 'Direktanflug, Ansehen +1,5', run: (st) => { const a = byId(st, p.ac); if (!a) return; a.medical = true; a.minFuel = true; if (CMDS.direct.valid(st, a)) command(st, a, 'direct'); repDelta(st, 1.5); } },
          { label: 'Normale Reihenfolge', detail: 'Ansehen −2 · Airline verärgert', run: (st) => { const a = byId(st, p.ac); repDelta(st, -2); satDelta(contractOfAc(st, a), -5); } },
        ],
      };
    },
  },
  drone: {
    role: 'tower', weight: 0.45, timeout: 3 * MIN,
    cond: (s) => {
      const h = (s.time / 3600) % 24;
      return h > 7 && h < 21 && s.acs.some((a) => a.arr && a.mode === 'air' && a.phase === PH.APPROACH) ? {} : null;
    },
    card: () => ({
      icon: '🛸', title: 'Drohne im Anflugsektor',
      text: 'Ein Pilot meldet eine Drohne etwa 4 NM vor der Schwelle, ca. 800 ft. Weiterlanden ist riskant – eine Sperrung kostet Zeit.',
      options: [
        { label: 'Anflüge aussetzen', detail: 'Piste 6 min gesperrt · sicher', run: (st) => { closeRunway(st, 6, 'Drohnensichtung'); log(st, 'sys', '🛸 Drohnensichtung im Endanflug – Landungen für 6 Minuten ausgesetzt, Polizei informiert.'); } },
        { label: 'Polizei-Hubschrauber', detail: '18 Tsd € · nur 3 min gesperrt', run: (st) => { spend(st, 'other', 18000); closeRunway(st, 3, 'Drohnensichtung'); log(st, 'sys', '🚁 Polizeihubschrauber vertreibt die Drohne – Piste nach 3 Minuten wieder frei.'); } },
        { label: 'Mit Vorsicht weiter', detail: '30 % Risiko: Durchstart, Ansehen −3', run: (st) => {
          if (rand(st) >= 0.3) return log(st, 'sys', '🛸 Die Drohne ist abgedreht – Betrieb läuft weiter.');
          const a = st.acs.filter((x) => x.arr && x.phase === PH.APPROACH && x.mode === 'air').sort((x, y) => AS.routeDistance(x.pos, x.route) - AS.routeDistance(y.pos, y.route))[0];
          if (a) goAround(st, a, 'Drohne im Endanflug');
          repDelta(st, -3);
          pushNews(st, 'Drohne zwingt Verkehrsflugzeug zum Durchstarten – Kritik an der Flughafenleitung.', 'bad', '🛸');
        } },
      ],
    }),
  },
  laser: {
    role: 'tower', weight: 0.35, timeout: 2 * MIN,
    cond: (s) => {
      const h = (s.time / 3600) % 24;
      if (h > 6.5 && h < 19.5) return null; // nur bei Dunkelheit
      const c = s.acs.filter((a) => a.arr && a.mode === 'air' && a.phase === PH.APPROACH && !a.emergency);
      return c.length ? { ac: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const ac = byId(s, p.ac);
      return {
        icon: '🔦', title: `Laserblendung bei ${ac?.cs}`,
        text: 'Die Besatzung meldet einen grünen Laser vom Boden, der Copilot ist kurz geblendet. Der Kommandant kann weiterfliegen – oder du lässt sicherheitshalber durchstarten.',
        options: [
          { label: 'Polizei rufen, Anflug fortsetzen', detail: '25 % Risiko: Pilot startet doch durch', run: (st) => { const a = byId(st, p.ac); log(st, 'sys', `🔦 Laserblendung bei ${a?.cs || 'einem Anflug'} – Polizei sucht den Täter.`); if (a && a.mode === 'air' && rand(st) < 0.25) goAround(st, a, 'Laserblendung'); } },
          { label: 'Durchstarten lassen', detail: 'sicher · ~8 min Verspätung', run: (st) => { const a = byId(st, p.ac); if (a && (a.phase === PH.APPROACH || a.phase === PH.FINAL)) goAround(st, a, 'Laserblendung (Anweisung)'); repDelta(st, 0.5); } },
        ],
      };
    },
  },
  birds: {
    role: 'tower', weight: 0.6, timeout: 4 * MIN,
    cond: (s) => (s.acs.some((a) => [PH.HOLDING, PH.TAXI_OUT, PH.APPROACH].includes(a.phase)) ? {} : null),
    card: () => ({
      icon: '🐦', title: 'Vogelschwarm an der Piste',
      text: 'Ein Schwarm Möwen hat sich neben der Piste niedergelassen. Die Vergrämung sperrt die Piste kurz, sonst droht Vogelschlag.',
      options: [
        { label: 'Vergrämen', detail: 'Piste 3 min gesperrt', run: (st) => { closeRunway(st, 3, 'Vogelvergrämung'); log(st, 'sys', 'Vogelvergrämung: Piste kurz gesperrt.'); } },
        { label: 'Weiter betreiben', detail: '35 % Risiko: Vogelschlag', run: (st) => { if (rand(st) < 0.35) st.birdRisk = st.time + 20 * MIN; } },
      ],
    }),
  },

  // ======== Manager ========
  discount: {
    role: 'manager', weight: 1.1, timeout: 2 * H,
    cond: (s) => {
      const c = s.contracts.filter((x) => !x.cargo && x.days > 5);
      return c.length ? { c: pick(s, c).id } : null;
    },
    card: (s, p) => {
      const c = s.contracts.find((x) => x.id === p.c);
      const al = AIRLINES[c?.airline] || AIRLINES.AUR;
      const amt = Math.round((60000 + (c?.freq || 1) * 25000) / 1000) * 1000;
      return {
        icon: '🤝', title: `${al.name} will Rabatt`,
        text: `${al.name} (Strecke nach ${CITIES[c?.city]?.name || '…'}) verlangt einen Nachlass auf die Entgelte, sonst wird die Verbindung überdacht.`,
        options: [
          { label: 'Rabatt gewähren', detail: `−${fmtMoney(amt)} · Zufriedenheit +12`, run: (st) => { spend(st, 'other', amt); const k = st.contracts.find((x) => x.id === p.c); satDelta(k, 12); } },
          { label: 'Ablehnen', detail: 'Zufriedenheit −10, Vertrag läuft 5 Tage früher aus', run: (st) => { const k = st.contracts.find((x) => x.id === p.c); if (k) { satDelta(k, -10); k.days = Math.max(1, k.days - 5); } } },
        ],
      };
    },
  },
  // Nach einem Zwischenfall wollen die Medien Antworten
  press: {
    role: 'manager', weight: 0, urgent: 4 * H, timeout: 2 * H,
    cond: (s) => (!s.scenario && s.lastInc && !s.lastInc.press && s.time - s.lastInc.t < 2 * H ? { kind: s.lastInc.kind, cs: s.lastInc.cs, t: s.lastInc.t } : null),
    card: (s, p) => {
      const what = { incursion: 'der Pistenbetretung', diversion: 'der Ausweichlandung', separation: 'der Staffelungsunterschreitung', airprox: 'der Beinahe-Kollision', fuelEmergency: 'dem Treibstoff-Notfall' }[p.kind] || 'dem Zwischenfall';
      const done = (st) => st.lastInc && st.lastInc.t === p.t && (st.lastInc.press = true);
      return {
        icon: '🎤', title: 'Pressekonferenz',
        text: `Nach ${what}${p.cs ? ` (${p.cs})` : ''} stehen Kamerateams vor dem Terminal. Nordhafen nutzt jede Schlagzeile – was sagen Sie den Journalisten?`,
        options: [
          { label: 'Offen informieren', detail: 'Ansehen +1 · Marktanteil −1', run: (st) => { done(st); repDelta(st, 1); const r = rivalState(st); r.share = clamp(r.share - 1, 5, 95); pushNews(st, `Flughafenchef erklärt offen, was bei ${what} passiert ist – Lob für die Transparenz.`, 'good', '🎤'); } },
          { label: 'Pressesprecherin schicken', detail: '8.000 € · Ansehen +0,5', run: (st) => { done(st); spend(st, 'other', 8000); repDelta(st, 0.5); } },
          { label: 'Kein Kommentar', detail: 'Ansehen −1,5', run: (st) => { done(st); repDelta(st, -1.5); pushNews(st, `„Kein Kommentar“ – Flughafen schweigt nach ${what}.`, 'bad', '🎤'); } },
        ],
      };
    },
  },
  noise: {
    role: 'manager', weight: 0.9, timeout: 3 * H,
    cond: (s) => ((s.stats.today.complaints || 0) + (s.stats.yesterday?.complaints || 0) > 6 || rand(s) < 0.3 ? {} : null),
    card: () => ({
      icon: '📢', title: 'Bürgerinitiative gegen Fluglärm',
      text: 'Anwohner protestieren vor dem Terminal. Die Lokalzeitung berichtet.',
      options: [
        { label: 'Schallschutzfenster zahlen', detail: '150.000 € · Ansehen +3', run: (st) => { spend(st, 'other', 150000); repDelta(st, 3); st.stats.today.complaints = 0; } },
        { label: 'Nachtflugverbot einführen', detail: 'Ansehen +2 · keine Nachtentgelte mehr', run: (st) => { st.settings.curfew = true; repDelta(st, 2); } },
        { label: 'Aussitzen', detail: 'Ansehen −2', run: (st) => repDelta(st, -2) },
      ],
    }),
  },
  union: {
    role: 'manager', weight: 0.7, timeout: 3 * H,
    cond: (s) => (s.staff > 20 && !(s.strikeUntil > s.time) ? {} : null),
    card: (s) => {
      const bonus = Math.round((s.staff * 1800) / 1000) * 1000;
      return {
        icon: '✊', title: 'Gewerkschaft fordert Prämie',
        text: 'Das Bodenpersonal verlangt eine Einmalzahlung für die vielen Überstunden. Ohne Einigung droht ein Warnstreik.',
        options: [
          { label: 'Prämie zahlen', detail: `${fmtMoney(bonus)} · 2 Tage +10 % Effizienz`, run: (st) => { spend(st, 'staff', bonus); st.moraleUntil = st.time + 2 * 24 * H; } },
          { label: 'Ablehnen', detail: '60 %: Warnstreik in den nächsten Stunden', run: (st) => { if (rand(st) < 0.6) st.pendingStrike = st.time + randRange(st, 1, 5) * H; } },
        ],
      };
    },
  },
  fuelDeal: {
    role: 'manager', weight: 0.8, timeout: 2 * H,
    cond: (s) => (maxOrder(s) >= 200 ? { f: Math.round(randRange(s, 0.86, 1.06) * 100) / 100, q: Math.min(400, Math.floor(maxOrder(s) / 50) * 50) } : null),
    card: (s, p) => {
      const f = fuelState(s);
      const unit = Math.round(f.price * p.f);
      return {
        icon: '⛽', title: 'Festpreis-Angebot für Kerosin',
        text: `Ein Händler bietet ${p.q} t zum Festpreis von ${unit} €/t an (Markt gerade ${Math.round(f.price)} €/t). Lieferung sofort.`,
        // Standard bei Zeitablauf (erste Option): günstige Angebote kaufen, teure ablehnen
        options: (p.f < 0.99 ? (a, b) => [b, a] : (a, b) => [a, b])(
          { label: 'Ablehnen', detail: 'kein Risiko', run: () => {} },
          { label: 'Kaufen', detail: `${fmtMoney(p.q * unit)} · ${p.f < 1 ? `${Math.round((1 - p.f) * 100)} % unter Markt` : `${Math.round((p.f - 1) * 100)} % über Markt`}`, run: (st) => { const fs = fuelState(st); const q = Math.min(p.q, FUEL.cap - fs.stock); if (st.cash < q * unit) return notify(st, 'Nicht genug Geld für das Kerosin-Angebot', 'warn'); st.cash -= q * unit; st.ledger.fuelBuy = (st.ledger.fuelBuy || 0) + q * unit; fs.value = (fs.value || 0) + q * unit; fs.stock += q; log(st, 'mgr', `Kerosin-Festpreis: ${q} t zu ${unit} €/t gekauft.`); } },
        ),
      };
    },
    // KI: kaufen, wenn der Preis höchstens leicht über Markt liegt, Platz im Tanklager ist und das Geld reicht
    // (das Kerosin wird mit Marge an die Airlines weiterverkauft)
    ai: (s, p) => {
      const f = fuelState(s);
      const buy = p.f <= 1.03 && f.stock < FUEL.cap * 0.85 && s.cash > p.q * f.price * p.f * 1.5;
      return buy === p.f < 0.99 ? 0 : 1; // Index je nach Reihenfolge der Optionen
    },
  },
  charter: {
    role: 'manager', weight: 0.8, timeout: 2 * H,
    cond: (s) => (s.stands.filter((x) => x.built).length >= 6 ? { n: randInt(s, 2, 3) } : null),
    card: (s, p) => ({
      icon: '🎸', title: 'Festival in der Stadt',
      text: `Ein Reiseveranstalter möchte ${p.n} Charterflüge für das Wochenend-Festival abfertigen lassen – guter Umsatz, aber voller Flughafen.`,
      options: [
        { label: 'Charter annehmen', detail: `${p.n} Zusatzflüge · Umsatz`, run: (st) => { for (let i = 0; i < p.n; i++) { const al = pick(st, ['SKB', 'NST', 'AUR']); const n = randInt(st, 900, 989); (st.pendingSpecials = st.pendingSpecials || []).push({ at: st.time + i * 25 * MIN, opts: { airline: al, type: pick(st, ['A320', 'B738', 'A321']), arrNo: `${al}${n}`, depNo: `${al}${n + 1}`, city: pick(st, ['PMI', 'AYT', 'HER', 'TFS']), special: 'charter', feeMult: 1.3 } }); } repDelta(st, 1); } },
        { label: 'Ablehnen', detail: 'nichts passiert', run: () => {} },
      ],
    }),
  },
  // Wettbewerb (nur über pushDecision, nie zufällig)
  rivalPoach: {
    role: 'manager', weight: 0, timeout: 3 * H,
    cond: () => null,
    ai: (s, p) => {
      const c = s.contracts.find((x) => x.id === p.c);
      return c && (c.sat || 50) < 40 && s.cash > 400000 ? 1 : 0;
    },
    card: (s, p) => {
      const c = s.contracts.find((x) => x.id === p.c);
      const al = AIRLINES[c?.airline] || AIRLINES.AUR;
      const cost = Math.round((70000 + (c?.freq || 1) * 30000) / 1000) * 1000;
      return {
        icon: '🏢', title: `${RIVAL_NAME} wirbt ${al.name} ab`,
        text: `${RIVAL_NAME} bietet ${al.name} für die Strecke nach ${CITIES[c?.city]?.name || '…'} günstigere Entgelte. Die Airline (Zufriedenheit ${Math.round(c?.sat ?? 50)}) will wissen, was du bietest.`,
        options: [
          { label: 'Gegenangebot: −15 % Entgelte', detail: 'Verbindung bleibt, +10 Tage Laufzeit · Zufriedenheit +8', run: (st) => { const k = st.contracts.find((x) => x.id === p.c); if (!k) return; k.feeMult = Math.round((k.feeMult || 1) * 0.85 * 100) / 100; k.days += 10; satDelta(k, 8); } },
          { label: 'Service-Paket', detail: `${fmtMoney(cost)} · Zufriedenheit +14 · Ansehen +1`, run: (st) => { const k = st.contracts.find((x) => x.id === p.c); spend(st, 'other', cost); satDelta(k, 14); repDelta(st, 1); } },
          { label: 'Ziehen lassen', detail: 'Verbindung endet in 2 Tagen', run: (st) => { const k = st.contracts.find((x) => x.id === p.c); if (!k) return; k.days = Math.min(k.days, 2); rivalState(st).poached++; pushNews(st, `${AIRLINES[k.airline].name} wechselt mit der Strecke nach ${CITIES[k.city].name} zu ${RIVAL_NAME}.`, 'bad', '🏢'); } },
        ],
      };
    },
  },
  rivalDivert: {
    role: 'manager', weight: 0, timeout: 40 * MIN,
    cond: () => null,
    ai: (s) => (s.stands.filter((x) => x.built && !x.occ && !x.closed).length >= 2 ? 0 : 1),
    card: (s, p) => ({
      icon: '⛔', title: `${RIVAL_NAME} gesperrt – Umleitungen?`,
      text: `${RIVAL_NAME} ist gesperrt (${p.why}). ${p.n} Flüge suchen einen Ausweichflughafen. Das bringt Zusatzentgelte und Ansehen, aber auch Betrieb auf Piste und Vorfeld.`,
      options: [
        { label: `${p.n} Umleitungen annehmen`, detail: '+40 % Entgelte · Ansehen +1 · Marktanteil', run: (st) => acceptDiversions(st, p.n) },
        { label: 'Ablehnen', detail: 'Kapazität schonen', run: () => {} },
      ],
    }),
  },
  rent: {
    role: 'manager', weight: 0.6, timeout: 3 * H,
    cond: (s) => (!(s.rentUntil > s.time) ? {} : null),
    card: () => ({
      icon: '🏬', title: 'Mieter für Terminalfläche',
      text: 'Eine Elektronikkette will eine Fläche im Terminal für 10 Tage mieten. Das bringt Geld, macht das Terminal aber enger.',
      options: [
        { label: 'Vermieten', detail: '+20.000 €/Tag · Ansehen −1', run: (st) => { st.rentUntil = st.time + 10 * 24 * H; repDelta(st, -1); } },
        { label: 'Ablehnen', detail: 'nichts passiert', run: () => {} },
      ],
    }),
  },
};

// Karte von außen einreihen (Wettbewerb). Spielt die KI den Manager, entscheidet sie sofort.
export function pushDecision(state, key, p) {
  const c = CATALOG[key];
  if (!c) return;
  const D = decisionsState(state);
  const d = { id: 'd' + Math.floor(state.time) + key, key, p, role: c.role, t: state.time, expires: state.time + c.timeout };
  if (state.role !== c.role || state.settings.events === false) {
    D.active.push(d);
    choose(state, d.id, c.ai ? c.ai(state, p) : 0);
    return;
  }
  D.active.push(d);
  const card = c.card(state, p);
  notify(state, `${card.icon} Entscheidung: ${card.title}`, 'warn');
}

// ---------------- Ablauf ----------------
const PLAYABLE = { tower: true, ground: true, manager: true };
function nextGap(state, role) {
  return role === 'manager' ? randRange(state, 3, 6) * H : randRange(state, 60, 120) * MIN;
}

export function decisionsState(state) {
  if (!state.decisions) state.decisions = { active: [], next: {} };
  return state.decisions;
}

// aktive Karte der Spielerrolle
export function activeDecision(state) {
  const D = decisionsState(state);
  return D.active.find((d) => d.role === state.role) || null;
}

export function describe(state, d) {
  const c = CATALOG[d.key];
  return c ? c.card(state, d.p) : null;
}

export function choose(state, id, idx, byPlayer = false) {
  const D = decisionsState(state);
  const d = D.active.find((x) => x.id === id);
  if (!d) return false;
  const card = describe(state, d);
  const o = card && card.options[idx];
  D.active = D.active.filter((x) => x !== d);
  if (!o) return false;
  if (byPlayer) {
    state.life = state.life || {};
    state.life.decided = (state.life.decided || 0) + 1;
  }
  try {
    o.run(state, d.p);
  } catch (e) {}
  log(state, d.role === 'manager' ? 'mgr' : d.role === 'ground' ? 'gnd' : 'sys', `${card.icon} ${card.title}: ${o.label}.`);
  return true;
}

// Karte aufschlagen; im Vorfeld meldet sich die betroffene Crew zusätzlich über den Betriebsfunk
function pushCard(state, D, key, c, p, role) {
  D.active.push({ id: 'd' + Math.floor(state.time) + key, key, p, role, t: state.time, expires: state.time + c.timeout });
  notify(state, `${c.card(state, p).icon} Entscheidung: ${c.card(state, p).title}`, 'warn');
  if (c.crew && state.role === 'ground') {
    const r = c.crew(state, p);
    if (r) log(state, 'crew', r[1], r[0], { prio: 2 });
  }
}
export function updateDecisions(state, dt) {
  const D = decisionsState(state);
  // laufende Folgen
  if (state.pendingStrike && state.time >= state.pendingStrike) {
    state.pendingStrike = 0;
    state.strikeUntil = state.time + randRange(state, 3, 5) * H;
    notify(state, '✊ Warnstreik – die Gewerkschaft macht ihre Drohung wahr', 'bad');
    log(state, 'gnd', 'Warnstreik: Bodenpersonal nur eingeschränkt verfügbar.');
  }
  if (state.rentUntil > state.time) {
    state.rentAcc = (state.rentAcc || 0) + (20000 * dt) / (24 * H);
    if (state.rentAcc > 1000) {
      earn(state, 'other', state.rentAcc);
      state.rentAcc = 0;
    }
  }
  if (state.birdRisk && state.time < state.birdRisk) {
    const dep = state.acs.find((a) => a.phase === PH.DEPART && a.alt < 3000 && !a.returning);
    if (dep && rand(state) < dt / 240) {
      state.birdRisk = 0;
      birdstrikeOn(state, dep);
    }
  }
  if (state.pendingSpecials && state.pendingSpecials.length) {
    for (const x of state.pendingSpecials.filter((q) => state.time >= q.at)) spawnSpecial(state, x.opts);
    state.pendingSpecials = state.pendingSpecials.filter((q) => state.time < q.at);
  }
  // Ablauf: Standardoption
  for (const d of [...D.active]) {
    if (state.time >= d.expires) {
      choose(state, d.id, 0);
      if (d.role === state.role) notify(state, `⏱️ Keine Entscheidung – automatisch: ${describe(state, d)?.options[0]?.label || ''}`, 'warn');
    }
  }
  // neue Karten nur für die Spielerrolle; KI-Rollen bekommen keine (entscheiden im Hintergrund nicht nötig)
  const role = state.role;
  if (!PLAYABLE[role]) return;
  if (state.settings.events === false) return;
  if (D.active.some((d) => d.role === role)) return;
  // dringende Karten (z. B. Anschlussflug) nicht dem Zufall überlassen: sobald die Lage passt, höchstens alle paar Stunden
  D.urgT = (D.urgT || 0) - dt;
  if (D.urgT <= 0) {
    D.urgT = 120;
    D.lastUrgent = D.lastUrgent || {};
    for (const [key, c] of Object.entries(CATALOG)) {
      if (c.role !== role || !c.urgent || state.time - (D.lastUrgent[key] ?? -1e9) < c.urgent) continue;
      const p = c.cond(state);
      if (!p) continue;
      D.lastUrgent[key] = state.time;
      pushCard(state, D, key, c, p, role);
      return;
    }
  }
  if (D.next[role] === undefined) D.next[role] = state.time + nextGap(state, role) * 0.5;
  if (state.time < D.next[role]) return;
  D.next[role] = state.time + nextGap(state, role);
  const cands = Object.entries(CATALOG).filter(([, c]) => c.role === role);
  const tried = [];
  for (let i = 0; i < cands.length; i++) {
    const pickd = pickWeighted(state, cands.filter((x) => !tried.includes(x[0])), (x) => (typeof x[1].weight === 'function' ? x[1].weight(state) : x[1].weight));
    if (!pickd) break;
    const [key, c] = pickd;
    tried.push(key);
    const p = c.cond(state);
    if (!p) continue;
    pushCard(state, D, key, c, p, role);
    break;
  }
}
