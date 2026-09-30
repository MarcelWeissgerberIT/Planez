// Glossar: Abkürzungen & Fachbegriffe, automatische Tooltips, Erklär-Popups
import { AC_TYPES, AIRLINES, CITIES, AIRPORT } from '../config.js';
import { esc } from '../util.js';

// cat: Kategorie für die Glossar-Liste; auto: im Text automatisch erklären
const E = (t, long, desc, cat, auto = true) => ({ t, long, desc, cat, auto });
export const GLOSSARY = [
  // Flugsicherung
  E('ATC', 'Air Traffic Control', 'Flugverkehrskontrolle – die Lotsen, die Abstände zwischen Flugzeugen sicherstellen und Freigaben erteilen.', 'Flugsicherung'),
  E('TWR', 'Tower', 'Platzkontrolle im Kontrollturm: zuständig für Starts, Landungen und den Rollverkehr auf dem Flughafen.', 'Flugsicherung'),
  E('APP', 'Approach', 'Anflugkontrolle: führt Flugzeuge aus dem Streckennetz bis in den Endanflug.', 'Flugsicherung'),
  E('STCA', 'Short Term Conflict Alert', 'Kurzfristige Konfliktwarnung des Radars: zwei Flugzeuge kommen sich näher als 3 NM seitlich und 1000 ft in der Höhe. Rot blinkend im Radar.', 'Flugsicherung'),
  E('AIRPROX', 'Aircraft Proximity', 'Gefährliche Annäherung zweier Flugzeuge (hier: unter 1 NM und 500 ft). Schwerer Vorfall mit hoher Strafe.', 'Flugsicherung'),
  E('Staffelung', 'Separation', 'Vorgeschriebener Mindestabstand zwischen Flugzeugen: im Radar 3 NM seitlich oder 1000 ft vertikal, hinter schweren Flugzeugen mehr (Wirbelschleppen).', 'Flugsicherung', false),
  E('Squawk', 'Transpondercode', 'Vierstelliger Code, den das Flugzeug per Transponder sendet. 7700 = Notfall, 7600 = Funkausfall, 7500 = Entführung.', 'Flugsicherung'),
  E('7700', 'Squawk 7700', 'Notfallcode: das Flugzeug hat eine Notlage (MAYDAY) und braucht absoluten Vorrang.', 'Flugsicherung'),
  E('MAYDAY', 'Notruf', 'Notfall mit Gefahr für Leib und Leben (Triebwerksausfall, Feuer, Treibstoffnot). Absoluter Vorrang für Anflug und Landung.', 'Flugsicherung'),
  E('PAN PAN', 'Dringlichkeitsmeldung', 'Dringlicher, aber (noch) kein lebensbedrohlicher Fall, z. B. Vogelschlag. Bevorzugt behandeln.', 'Flugsicherung'),
  E('MINIMUM FUEL', 'Minimum Fuel', 'Der Pilot meldet: Treibstoff reicht für keine weitere Verzögerung. Noch kein Notfall, aber bald Anflug freigeben – sonst folgt MAYDAY FUEL.', 'Flugsicherung'),
  E('MAYDAY FUEL', 'Treibstoffnotlage', 'Treibstoff unter der Endreserve – das Flugzeug muss sofort landen (Notfall, Squawk 7700).', 'Flugsicherung'),
  E('MINFUEL', 'Minimum Fuel', 'Kurzform auf Radar und Streifen: das Flugzeug hat Minimum Fuel erklärt.', 'Flugsicherung'),
  E('ATIS', 'Automatic Terminal Information Service', 'Bandansage mit Wetter, Wind und Piste in Betrieb. Jede neue Ausgabe hat einen Buchstaben (Alpha, Bravo, …), den Piloten beim Erstanruf nennen.', 'Flugsicherung'),
  E('Freigabe', 'Clearance', 'Erlaubnis des Lotsen für eine Handlung (Anflug, Landung, Rollen, Start). Ohne Freigabe darf der Pilot nicht handeln.', 'Flugsicherung', false),
  E('Pistenfolge', 'Runway Sequence', 'Gemeinsame Reihenfolge aller Landungen und Starts auf der Piste, mit geplanten Pistenzeiten. Der Tower kann sie umsortieren.', 'Flugsicherung', false),
  // Anflug & Landung
  E('ILS', 'Instrument Landing System', 'Instrumentenlandesystem: Funkleitstrahlen für Kurs (Localizer) und Gleitweg führen das Flugzeug präzise zur Piste – auch ohne Sicht.', 'Anflug & Landung'),
  E('CAT I', 'ILS-Kategorie I', 'Landungen bis 550 m Pistensichtweite (RVR) und 200 ft Entscheidungshöhe.', 'Anflug & Landung'),
  E('CAT III', 'ILS-Kategorie III', 'Präzisionsanflug bis fast null Sicht (RVR ab ca. 75 m) – mit Autoland. Ohne CAT III müssen Flüge bei dichtem Nebel ausweichen.', 'Anflug & Landung'),
  E('IAF', 'Initial Approach Fix', 'Anfangspunkt des Anflugs; hier liegen die Warteschleifen (NOLTA, SUDEN für Piste 27, WELDA, RIMOS für Piste 09).', 'Anflug & Landung'),
  E('IP', 'Intermediate Point', 'Zwischenpunkt 15 NM vor der Schwelle auf der verlängerten Pistenachse.', 'Anflug & Landung'),
  E('FAF', 'Final Approach Fix', 'Endanflugpunkt 10 NM vor der Schwelle – ab hier fliegt das Flugzeug stabil auf dem ILS-Gleitweg.', 'Anflug & Landung'),
  E('THR', 'Threshold', 'Pistenschwelle: Beginn des nutzbaren Landebereichs.', 'Anflug & Landung'),
  E('NOLTA', 'Warteschleifen-Fix', 'IAF nordöstlich, für Anflüge auf Piste 27.', 'Anflug & Landung'),
  E('SUDEN', 'Warteschleifen-Fix', 'IAF südöstlich, für Anflüge auf Piste 27.', 'Anflug & Landung'),
  E('WELDA', 'Warteschleifen-Fix', 'IAF nordwestlich, für Anflüge auf Piste 09.', 'Anflug & Landung'),
  E('RIMOS', 'Warteschleifen-Fix', 'IAF südwestlich, für Anflüge auf Piste 09.', 'Anflug & Landung'),
  E('Warteschleife', 'Holding', 'Rennbahnförmige Schleife am Fix. Flugzeuge stapeln sich im Abstand von 1000 ft; der Unterste verlässt den Stapel zuerst.', 'Anflug & Landung', false),
  E('Durchstarten', 'Go-around', 'Abgebrochene Landung: das Flugzeug steigt wieder und fliegt eine neue Runde – z. B. wenn die Piste belegt ist oder keine Landefreigabe vorliegt.', 'Anflug & Landung', false),
  E('Wirbelschleppe', 'Wake Turbulence', 'Luftwirbel hinter jedem Flugzeug, besonders stark hinter schweren (H). Folgende Flugzeuge brauchen mehr Abstand: H→H 4 NM, H→M 5 NM, H→L 6 NM, M→L 5 NM; bei Starts bis 2 Minuten.', 'Anflug & Landung', false),
  E('WTC', 'Wake Turbulence Category', 'Wirbelschleppen-Kategorie: L = Light (leicht, < 7 t), M = Medium (mittel), H = Heavy (schwer, > 136 t).', 'Anflug & Landung'),
  E('Heavy', 'Wirbelschleppen-Kategorie H', 'Schweres Flugzeug über 136 t Höchstabfluggewicht (z. B. B787, A350, B777, B747). Erzeugt starke Wirbelschleppen.', 'Anflug & Landung'),
  E('Medium', 'Wirbelschleppen-Kategorie M', 'Mittleres Flugzeug zwischen 7 und 136 t (z. B. A320, B737, E190, ATR 72).', 'Anflug & Landung'),
  E('Light', 'Wirbelschleppen-Kategorie L', 'Leichtes Flugzeug unter 7 t bzw. kleine Businessjets – besonders empfindlich gegen Wirbelschleppen.', 'Anflug & Landung'),
  E('Bremswirkung', 'Braking Action', 'Wie gut Flugzeuge auf der Piste bremsen: gut / mittel / schlecht. Hängt vom Gummiabrieb und von Nässe ab; schlecht = längere Ausrollstrecke, spätere Abrollwege.', 'Anflug & Landung', false),
  // Abflug & Slots
  E('A-CDM', 'Airport Collaborative Decision Making', 'Gemeinsame Planung von Abfertigung, Tower und Verkehrsflusssteuerung über Zielzeiten (TOBT, TSAT, CTOT). Ziel: pünktlich starten, ohne am Rollhalt mit laufenden Triebwerken zu warten.', 'Abflug & Slots'),
  E('TOBT', 'Target Off-Block Time', 'Zielzeit, zu der die Abfertigung fertig ist und das Flugzeug abrollbereit sein wird. Wird automatisch nachgeführt, wenn der Turnaround länger dauert.', 'Abflug & Slots'),
  E('TSAT', 'Target Start-up Approval Time', 'Zielzeit für Anlass- und Pushback-Freigabe. Bei Slot-Flügen: CTOT minus Rollzeit (EXOT). Früher schieben heißt: am Rollhalt warten und Treibstoff verbrennen.', 'Abflug & Slots'),
  E('CTOT', 'Calculated Take-Off Time', 'Startslot der europäischen Verkehrsflusssteuerung. Start nur im Fenster −5/+10 Minuten erlaubt; verpasst = neuer, späterer Slot.', 'Abflug & Slots'),
  E('EXOT', 'Estimated Taxi-Out Time', 'Geschätzte Zeit von der Parkposition bis zum Abheben (Pushback, Anlassen, Rollen).', 'Abflug & Slots'),
  E('ATFM', 'Air Traffic Flow Management', 'Verkehrsflusssteuerung (z. B. Eurocontrol Network Manager): vergibt Slots, wenn Lufträume oder Zielflughäfen überlastet sind. ATFM-Verspätung zählt nicht gegen den Flughafen.', 'Abflug & Slots'),
  E('Slot', 'Startslot', 'Zugeteilte Startzeit (CTOT) mit Toleranzfenster −5/+10 Minuten.', 'Abflug & Slots'),
  E('Rollhalt', 'Holding Point', 'Haltelinie vor der Piste. Hier wartet das Flugzeug auf „Line up“ oder die Startfreigabe.', 'Abflug & Slots', false),
  E('Line up', 'Line up and wait', 'Auf die Piste rollen, ausrichten und auf die Startfreigabe warten. Blockiert die Piste für Landungen!', 'Abflug & Slots'),
  E('Pushback', 'Zurückschieben', 'Das Flugzeug wird vom Schlepper rückwärts von der Parkposition geschoben, danach werden die Triebwerke angelassen.', 'Abflug & Slots'),
  // Boden & Abfertigung
  E('Turnaround', 'Bodenabfertigung', 'Alle Arbeiten zwischen Ankunft und Abflug: Aussteigen, Entladen, Reinigung, Catering, Betankung, Einsteigen, Beladen, Pushback.', 'Boden & Abfertigung'),
  E('GSE', 'Ground Support Equipment', 'Bodenfahrzeuge: Schlepper, Gepäckzüge, Tankwagen, Catering-LKW, Reinigung, Vorfeldbusse.', 'Boden & Abfertigung'),
  E('Vorfeld', 'Apron', 'Abstellfläche für Flugzeuge mit Parkpositionen und Servicestraße.', 'Boden & Abfertigung', false),
  E('Pos', 'Parkposition', 'Abstellplatz eines Flugzeugs (P1–P10). Gebäudepositionen haben eine Fluggastbrücke, Vorfeldpositionen brauchen Busse.', 'Boden & Abfertigung'),
  E('Klasse', 'Positionsklasse S/M/L', 'Größe einer Parkposition: M für Kurz-/Mittelstrecke (bis A321), L für Großraumflugzeuge (B787, A350, B777, B747).', 'Boden & Abfertigung', false),
  E('Mindestbodenzeit', 'Minimum Turnaround Time', 'Kürzeste planbare Abfertigungszeit je Flugzeugtyp (z. B. A320 40 min, B777 90 min).', 'Boden & Abfertigung', false),
  E('Tankwagen', 'Fuel Truck', 'Fasst 36 t Kerosin. Große Flugzeuge brauchen mehrere Ladungen; leere Tankwagen fahren zum Tanklager nach.', 'Boden & Abfertigung', false),
  E('FOD', 'Foreign Object Debris', 'Fremdkörper auf der Piste (Metallteile, Steine). Gefahr für Reifen und Triebwerke – die Piste wird für eine Kontrolle kurz gesperrt.', 'Boden & Abfertigung'),
  E('Gummiabrieb', 'Rubber Deposits', 'Reifenabrieb im Aufsetzbereich macht die Piste glatt. Wird nachts per Hochdruck-Wasserstrahl entfernt.', 'Boden & Abfertigung', false),
  // Wirtschaft
  E('MTOW', 'Maximum Take-Off Weight', 'Höchstabfluggewicht in Tonnen – Grundlage für das Landeentgelt.', 'Wirtschaft'),
  E('Pax', 'Passengers', 'Passagiere (Fluggäste).', 'Wirtschaft'),
  E('KPI', 'Key Performance Indicator', 'Kennzahl zur Leistungsmessung, z. B. Pünktlichkeit oder Slot-Einhaltung.', 'Wirtschaft'),
  E('Tsd', 'Tausend', '1 Tsd € = 1 000 €.', 'Wirtschaft'),
  E('Mio', 'Millionen', '1 Mio € = 1 000 000 €.', 'Wirtschaft'),
  E('Marge', 'Kerosin-Aufschlag', 'Aufschlag auf den Einkaufspreis beim Verkauf an die Airlines. Zu hoch → Airlines tanken woanders (Tankering).', 'Wirtschaft', false),
  E('Tankering', 'Fuel Tankering', 'Airlines tanken am günstigen Flughafen mehr, um am teuren weniger kaufen zu müssen.', 'Wirtschaft', false),
  E('Kerosin', 'Jet A-1', 'Flugturbinenkraftstoff. Der Flughafen kauft am Markt ein, lagert im Tanklager und verkauft mit Aufschlag an die Airlines.', 'Wirtschaft', false),
  E('Annuität', 'Kreditrate', 'Gleichbleibende Tagesrate aus Zins und Tilgung.', 'Wirtschaft', false),
  E('Nachtflugverbot', 'Curfew', 'Zwischen 23 und 5 Uhr keine planmäßigen Flüge. Weniger Lärmbeschwerden, aber Frachtairlines verlieren Nachtslots.', 'Wirtschaft', false),
  E('ICAO', 'International Civil Aviation Organization', 'UN-Organisation für die Zivilluftfahrt. ICAO-Codes: 4 Zeichen für Flugzeugtypen (A320), 3 Buchstaben für Airlines (AUR).', 'Wirtschaft'),
  E('IATA', 'International Air Transport Association', 'Airline-Dachverband. IATA-Codes: 3 Buchstaben für Flughäfen (z. B. LHR = London Heathrow).', 'Wirtschaft'),
  // Wetter
  E('RVR', 'Runway Visual Range', 'Pistensichtweite in Metern. Unter 550 m reicht ILS CAT I nicht mehr – dann nur mit CAT III landen.', 'Wetter'),
  E('LVP', 'Low Visibility Procedures', 'Verfahren bei schlechter Sicht: größere Abstände zwischen Anflügen, geschützte ILS-Zonen, weniger Kapazität.', 'Wetter'),
  E('Rückenwind', 'Tailwind', 'Wind von hinten verlängert Start- und Landestrecke. Über 5 kt Rückenwind wird die Betriebsrichtung gewechselt.', 'Wetter', false),
  E('Gegenwind', 'Headwind', 'Wind von vorne – erwünscht, verkürzt Start und Landung.', 'Wetter', false),
  // Einheiten & Kennungen
  E('RWY', 'Runway', 'Start- und Landebahn. Die Nummer ist die Richtung in Zehnergrad: RWY 27 = Richtung 270° (Westen), RWY 09 = 90° (Osten).', 'Einheiten & Kennungen'),
  E('NM', 'Nautische Meile', '1 NM = 1,852 km. Entfernungen in der Luftfahrt.', 'Einheiten & Kennungen'),
  E('kt', 'Knoten', 'Geschwindigkeit in NM pro Stunde: 1 kt ≈ 1,85 km/h. 160 kt ≈ 300 km/h.', 'Einheiten & Kennungen'),
  E('ft', 'Fuß', 'Höhenangabe: 1 ft = 0,3048 m. 5000 ft ≈ 1,5 km.', 'Einheiten & Kennungen'),
  E('feet', 'Fuß', 'Höhenangabe: 1 ft = 0,3048 m.', 'Einheiten & Kennungen'),
  E('FL', 'Flight Level', 'Flugfläche: Höhe in 100 ft bei Standard-Luftdruck. FL120 = 12 000 ft. Im Radar steht die Höhe in 100 ft (z. B. 050 = 5000 ft).', 'Einheiten & Kennungen'),
  E('STA', 'Scheduled Time of Arrival', 'Planmäßige Ankunftszeit laut Flugplan.', 'Einheiten & Kennungen'),
  E('STD', 'Scheduled Time of Departure', 'Planmäßige Abflugzeit laut Flugplan (Off-Block).', 'Einheiten & Kennungen'),
  E('ETA', 'Estimated Time of Arrival', 'Voraussichtliche Ankunftszeit.', 'Einheiten & Kennungen'),
  E('XP', 'Erfahrungspunkte', 'Für erreichte Ziele und gute Tage. Mehr XP = höherer Flughafen-Rang = mehr Airline-Interesse.', 'Einheiten & Kennungen'),
  E(AIRPORT.code, AIRPORT.name, 'IATA-Code dieses Flughafens.', 'Einheiten & Kennungen'),
];

// Dynamische Einträge: Flugzeugtypen, Airlines, Flughäfen
for (const t of Object.values(AC_TYPES)) {
  GLOSSARY.push(E(t.id, t.name, `ICAO-Typcode. ${t.cargo ? `Frachter, ${t.cargo} t Fracht` : `${t.pax} Sitze`}, Wirbelschleppe ${t.wake}, Positionsklasse ${t.size}, MTOW ${t.mtow} t, Mindestbodenzeit ${t.turn} min, Anfluggeschwindigkeit ${t.vapp} kt.`, 'Flugzeugtypen'));
}
for (const a of Object.values(AIRLINES)) {
  GLOSSARY.push(E(a.code, a.name, `ICAO-Airline-Code (fiktiv). Rufname im Funk: „${a.tel}“. Flotte: ${a.types.join(', ')}.`, 'Airlines'));
}
for (const [code, c] of Object.entries(CITIES)) {
  GLOSSARY.push(E(code, c.name, `IATA-Flughafencode. ${{ short: 'Kurzstrecke', mid: 'Mittelstrecke', long: 'Langstrecke' }[c.cat]}.`, 'Flughäfen'));
}

const BY_T = new Map(GLOSSARY.map((g) => [g.t, g]));
export const glossaryEntry = (k) => BY_T.get(k);

// ---------- Erklärungen für Panel-Abschnitte ----------
export const EXPLAIN = {
  seq: '<b>Flugstreifen</b>: unten links die Landungen, rechts die Starts – links steht, wer zuerst dran ist. Oben der Filter <b>An / Beide / Ab</b>. Die ausgewählte Karte wird groß und zeigt alle Befehle. <b>Ziehen</b> ändert die Reihenfolge (auch ◀ ▶ oder W/S): mit <b>Auto-Staffelung</b> gibt der Tower dann die Anflugfreigaben in dieser Reihenfolge, bremst Anflüge auf 180/160 kt, gibt Vorgezogenen „Direkt FAF“ und schickt notfalls einen in die Warteschleife. Starts, die du vor eine Landung ziehst, bekommen eine Lücke. Wer schon im Endanflug oder auf der Piste ist, bleibt vorn. Eine Karte aus der Warteliste in die Pistenfolge ziehen = Anflug frei; zurückziehen = Warteschleife.',
  arr: '<b>Anflug</b>: Flüge im Luftraum ohne Anflugfreigabe. <i>A</i> = Anflug frei über IP und FAF, <i>D</i> = direkt zum FAF (kürzer), <i>H</i> = Warteschleife. ⛽ zeigt die Treibstoffreserve in Minuten – unter 12 min meldet der Pilot MINIMUM FUEL.',
  gnd: '<b>Rollverkehr</b>: Flugzeuge auf Rollwegen und Anfragen für Pushback/Rollen. Bei Slot-Flügen erst zur TSAT schieben („Warten bis TSAT“), sonst warten sie mit laufenden Triebwerken am Rollhalt.',
  dep: '<b>Abflug</b>: gerade gestartete Flüge im Nahbereich.',
  rwy: '<b>Piste</b>: Betriebsrichtung nach dem Wind (max. 5 kt Rückenwind). Zustand = Gummiabrieb/Reibwert, daraus folgt die Bremswirkung (bei Nässe schlechter). Bei Sperrung (FOD-Kontrolle, Bauarbeiten) keine Landungen und Starts.',
  inb: '<b>Ankünfte</b>: jede Ankunft braucht eine passende Parkposition (Klasse M/L, Fracht auf Frachtpositionen). Ohne Position wartet das Flugzeug am Rollweg-Ende.',
  ta: '<b>Turnaround</b>: Aufgaben mit Abhängigkeiten. Gelbe Felder anklicken schickt das nächste freie Fahrzeug. TOBT = voraussichtlich fertig, CTOT = Startslot. Liegt die TOBT nach der STD, wird der Flug verspätet; ist ein Slot nicht mehr erreichbar, gibt es einen neuen.',
  fleet: '<b>Fuhrpark</b>: Fahrzeuge je Typ, Schalter = automatische Disposition. Tankwagen fassen 36 t und fahren leer zum Tanklager nach (Balken = Ladung).',
  build: '<b>Ausbau</b>: jedes Projekt hat Bauzeit und ist als Baustelle sichtbar. Pistenarbeiten laufen nur nachts in Verkehrspausen und sperren dann die Piste.',
  fuel: '<b>Kerosin</b>: Einkauf zum Marktpreis (+2 % Transport), Lieferung nach 2–3,5 h. Verkauf an Airlines mit deiner Marge; hohe Marge → Airlines tanken weniger (Tankering). Leeres Tanklager = Betankungen stocken = Verspätungen.',
  fees: '<b>Gebühren</b>: Landeentgelt je Tonne MTOW, Passagierentgelt je abfliegendem Passagier, Positionsentgelt je Stunde. Nachtentgelt je Bewegung zwischen 23 und 5 Uhr.',
  loans: '<b>Kredite</b>: Auszahlung sofort, Rückzahlung in 30 gleichen Tagesraten (Annuität). Der Zins pro Tag hängt vom Ansehen ab. Sondertilgung jederzeit möglich.',
  goals: '<b>Ziele</b>: drei Aufgaben je Station. Erreichen bringt Prämie und XP; XP heben den Flughafen-Rang – höhere Ränge locken mehr Airlines an.',
  contracts: '<b>Verträge</b>: Airlines fliegen täglich nach Plan. Zufriedenheit sinkt bei Verspätungen, hohen Gebühren und verpassten Slots; unzufriedene Airlines verlängern nicht.',
};
export const qm = (key) => `<button class="qm" data-explain="${key}" aria-label="Erklärung" title="Erklärung">?</button>`;

// ---------- automatische Tooltips ----------
let enabled = true;
export function setGlossaryEnabled(v) {
  enabled = !!v;
  document.body.classList.toggle('no-glossary', !enabled);
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AL = Object.keys(AIRLINES).join('|');
let RE = null;
function regex() {
  if (RE) return RE;
  const keys = GLOSSARY.filter((g) => g.auto).map((g) => g.t).sort((a, b) => b.length - a.length).map(escRe);
  // Rufzeichen (AUR883), Flugflächen (FL120), Parkpositionen (P4) und Einträge
  RE = new RegExp(`(?<![A-Za-z0-9ÄÖÜäöüß-])(?:((?:${AL})\\d{1,4})|(FL\\d{2,3})|(P\\d{1,2})|(${keys.join('|')}))(?![A-Za-z0-9ÄÖÜäöüß])`, 'g');
  return RE;
}
const SKIP = new Set(['SCRIPT', 'STYLE', 'KBD', 'ABBR', 'CODE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CANVAS', 'SVG', 'TEXT']);

export function glossify(root) {
  if (!enabled || !root) return;
  const re = regex();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.length < 2) return NodeFilter.FILTER_REJECT;
      for (let p = n.parentNode; p && p !== root.parentNode; p = p.parentNode) {
        if (p.nodeType === 1 && (SKIP.has(p.nodeName.toUpperCase()) || (p.classList && p.classList.contains('no-gl')))) return NodeFilter.FILTER_REJECT;
      }
      re.lastIndex = 0;
      return re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const txt = n.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(txt))) {
      if (m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
      const a = document.createElement('abbr');
      a.className = 'gl';
      a.textContent = m[0];
      if (m[1]) a.dataset.gl = `cs:${m[1]}`;
      else if (m[2]) a.dataset.gl = 'FL';
      else if (m[3]) a.dataset.gl = `pos:${m[3]}`;
      else a.dataset.gl = m[4];
      frag.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
    n.parentNode.replaceChild(frag, n);
  }
}

// Tooltip-Inhalt
function tipHtml(key) {
  if (key.startsWith('cs:')) {
    const cs = key.slice(3);
    const al = AIRLINES[cs.slice(0, 3)];
    const n = cs.slice(3);
    return `<b>${esc(cs)}</b> · Rufzeichen<div class="gl-d">${esc(al.name)}, Flugnummer ${esc(n)}. Im Funk: „${esc(al.tel)} ${esc(n)}“. Ankunft und Abflug haben unterschiedliche Nummern.</div>`;
  }
  if (key.startsWith('pos:')) return `<b>${esc(key.slice(4))}</b> · Parkposition ${esc(key.slice(5))}<div class="gl-d">Abstellplatz auf dem Vorfeld. P1–P7 am Terminal (Fluggastbrücke), P8 Vorfeldposition mit Bus, P9–P10 Fracht.</div>`;
  const g = BY_T.get(key);
  if (!g) return null;
  return `<b>${esc(g.t)}</b> · ${esc(g.long)}<div class="gl-d">${esc(g.desc)}</div>`;
}
export const glTag = (key, text = key) => `<abbr class="gl" data-gl="${esc(key)}">${esc(text)}</abbr>`;

let tip = null;
let tipT = 0;
let pop = null;
function showTip(el) {
  const html = tipHtml(el.dataset.gl);
  if (!html) return;
  tip.innerHTML = html;
  tip.classList.add('show');
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
  let y = r.top - h - 8;
  if (y < 8) y = r.bottom + 8;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => tip && tip.classList.remove('show');

export function initGlossary() {
  tip = document.createElement('div');
  tip.id = 'gltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  pop = document.createElement('div');
  pop.id = 'explainpop';
  pop.className = 'explainpop hidden';
  document.body.appendChild(pop);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest && e.target.closest('abbr.gl, [data-gl]');
    clearTimeout(tipT);
    if (!el || !enabled) return hideTip();
    tipT = setTimeout(() => showTip(el), 220);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest && e.target.closest('abbr.gl, [data-gl]')) {
      clearTimeout(tipT);
      hideTip();
    }
  });
  // Touch: Tippen auf eine Abkürzung zeigt die Erklärung
  document.addEventListener('click', (e) => {
    const q = e.target.closest && e.target.closest('[data-explain]');
    if (q) {
      e.stopPropagation();
      e.preventDefault();
      showExplain(q);
      return;
    }
    if (!pop.classList.contains('hidden') && !pop.contains(e.target)) pop.classList.add('hidden');
    const el = e.target.closest && e.target.closest('abbr.gl');
    if (el && enabled && !el.closest('button, [data-cmd], a')) {
      showTip(el);
      clearTimeout(tipT);
      tipT = setTimeout(hideTip, 4000);
    }
  }, true);
  window.addEventListener('scroll', hideTip, true);
}

function showExplain(btn) {
  const html = EXPLAIN[btn.dataset.explain];
  if (!html) return;
  pop.innerHTML = `${html}<button class="mini ep-x" aria-label="Schließen">✕</button>`;
  glossify(pop);
  pop.classList.remove('hidden');
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left - w + 30))}px`;
  pop.style.top = `${r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  pop.querySelector('.ep-x').addEventListener('click', () => pop.classList.add('hidden'));
}

// ---------- Glossar-Liste (Hilfe) ----------
export function glossaryHtml(filter = '') {
  const f = filter.trim().toLowerCase();
  const cats = {};
  for (const g of GLOSSARY) {
    if (f && !(`${g.t} ${g.long} ${g.desc}`.toLowerCase().includes(f))) continue;
    (cats[g.cat] = cats[g.cat] || []).push(g);
  }
  const order = ['Flugsicherung', 'Anflug & Landung', 'Abflug & Slots', 'Boden & Abfertigung', 'Wirtschaft', 'Wetter', 'Einheiten & Kennungen', 'Flugzeugtypen', 'Airlines', 'Flughäfen'];
  let h = '';
  for (const c of order) {
    const list = cats[c];
    if (!list) continue;
    h += `<h3>${c}</h3><dl class="gloss">`;
    for (const g of list) h += `<dt>${esc(g.t)}</dt><dd><b>${esc(g.long)}</b> – ${esc(g.desc)}</dd>`;
    h += `</dl>`;
  }
  return h || '<p class="empty">Kein Eintrag gefunden.</p>';
}
