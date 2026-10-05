// Glossar: Abkürzungen & Fachbegriffe, automatische Tooltips, Erklär-Popups
import { AC_TYPES, AIRLINES, CITIES, AIRPORT, typeCode } from '../config.js';
import { esc } from '../util.js';
import { T, EN } from '../i18n.js';

// cat: Kategorie für die Glossar-Liste; auto: im Text automatisch erklären
const E = (t, long, desc, cat, auto = true) => ({ t, long, desc, cat, auto });
export const GLOSSARY = [
  // Winterbetrieb
  E('De-Icing', T('Enteisung'), T('Vor dem Start werden Tragflächen und Leitwerk mit heißer Glykol-Lösung von Schnee und Eis befreit (Enteisungsfahrzeug). Danach läuft die Holdover-Zeit – in der Zeit muss das Flugzeug starten.'), 'Winter'),
  E(T('Enteisung'), 'De-Icing', T('Letzte Abfertigungsaufgabe im Winter (❄️ Eis), braucht ein Enteisungsfahrzeug. Bei Schneefall oder Frost mit Feuchtigkeit darf ohne Enteisung nicht gestartet werden.'), 'Winter', false),
  E(T('Schneeräumung'), 'Snow Clearing', T('Räumdienst: Pflüge und Kehrblasgeräte fahren in Staffelformation über die Piste. Die Bahn ist dafür einige Minuten gesperrt; danach ist die Bremswirkung wieder gut.'), 'Winter', false),
  E('Holdover', 'Holdover Time', T('Zeitspanne, in der das Enteisungsmittel vor neuem Eis schützt – bei starkem Schneefall nur wenige Minuten.'), 'Winter', false),
  // Flugsicherung
  E('ATC', 'Air Traffic Control', T('Flugverkehrskontrolle – die Lotsen, die Abstände zwischen Flugzeugen sicherstellen und Freigaben erteilen.'), T('Flugsicherung')),
  E('TWR', 'Tower', T('Platzkontrolle im Kontrollturm: zuständig für Starts, Landungen und den Rollverkehr auf dem Flughafen.'), T('Flugsicherung')),
  E('APP', 'Approach', T('Anflugkontrolle: führt Flugzeuge aus dem Streckennetz bis in den Endanflug.'), T('Flugsicherung')),
  E('STCA', 'Short Term Conflict Alert', T('Kurzfristige Konfliktwarnung des Radars: zwei Flugzeuge kommen sich näher als 3 NM seitlich und 1000 ft in der Höhe. Rot blinkend im Radar.'), T('Flugsicherung')),
  E('AIRPROX', 'Aircraft Proximity', T('Gefährliche Annäherung zweier Flugzeuge (hier: unter 1 NM und 500 ft). Schwerer Vorfall mit hoher Strafe.'), T('Flugsicherung')),
  E(T('Staffelung'), 'Separation', T('Vorgeschriebener Mindestabstand zwischen Flugzeugen: im Radar 3 NM seitlich oder 1000 ft vertikal, hinter schweren Flugzeugen mehr (Wirbelschleppen).'), T('Flugsicherung'), false),
  E('Squawk', T('Transpondercode'), T('Vierstelliger Code, den das Flugzeug per Transponder sendet. 7700 = Notfall, 7600 = Funkausfall, 7500 = Entführung.'), T('Flugsicherung')),
  E('7700', 'Squawk 7700', T('Notfallcode: das Flugzeug hat eine Notlage (MAYDAY) und braucht absoluten Vorrang.'), T('Flugsicherung')),
  E('MAYDAY', T('Notruf'), T('Notfall mit Gefahr für Leib und Leben (Triebwerksausfall, Feuer, Treibstoffnot). Absoluter Vorrang für Anflug und Landung.'), T('Flugsicherung')),
  E('PAN PAN', T('Dringlichkeitsmeldung'), T('Dringlicher, aber (noch) kein lebensbedrohlicher Fall, z. B. Vogelschlag. Bevorzugt behandeln.'), T('Flugsicherung')),
  E('MINIMUM FUEL', 'Minimum Fuel', T('Der Pilot meldet: Treibstoff reicht für keine weitere Verzögerung. Noch kein Notfall, aber bald Anflug freigeben – sonst folgt MAYDAY FUEL.'), T('Flugsicherung')),
  E('MAYDAY FUEL', T('Treibstoffnotlage'), T('Treibstoff unter der Endreserve – das Flugzeug muss sofort landen (Notfall, Squawk 7700).'), T('Flugsicherung')),
  E('MINFUEL', 'Minimum Fuel', T('Kurzform auf Radar und Streifen: das Flugzeug hat Minimum Fuel erklärt.'), T('Flugsicherung')),
  E('ATIS', 'Automatic Terminal Information Service', T('Bandansage mit Wetter, Wind und Piste in Betrieb. Jede neue Ausgabe hat einen Buchstaben (Alpha, Bravo, …), den Piloten beim Erstanruf nennen.'), T('Flugsicherung')),
  E('TAF', 'Terminal Aerodrome Forecast', T('Flugplatzwettervorhersage. Im Radar zeigt die TAF-Zeile die nächste Wetterlage, z. B. „ab 15:20 TSRA“ (Gewitter mit Regen).'), T('Flugsicherung')),
  E('TSRA', 'Thunderstorm with Rain', T('Wetterkürzel: Gewitter mit Regen. Weitere Kürzel: RA Regen, SN Schnee, FG Nebel, CAVOK klar.'), T('Flugsicherung')),
  E('SID', 'Standard Instrument Departure', T('Veröffentlichte Abflugroute. Im Spiel führt jede Route über einen der vier Fixe (NOLTA Nordost, SUDEN Südost, RIMOS Südwest, WELDA Nordwest). Zwei Starts auf derselben Route brauchen 100 Sekunden Abstand statt der üblichen 75 – auf verschiedenen Routen reicht der normale Abstand.'), T('Flugsicherung')),
  E('NORDO', 'No Radio', T('Flugzeug ohne Funkverbindung (Transponder-Code 7600). Es fliegt nach Flugplan weiter und bekommt Lichtsignale vom Tower: grünes Dauerlicht = Landung frei, rotes Dauerlicht = nicht landen/durchstarten, grünes Blinklicht am Boden = Rollen frei.'), T('Flugsicherung')),
  E('7600', 'Squawk 7600', T('Transponder-Code für Funkausfall (NORDO).'), T('Flugsicherung')),
  E('Readback', T('Rücklesung'), T('Der Pilot wiederholt jede Freigabe (Piste, Line up, Start, Landung). Der Lotse muss hinhören: Stimmt der Readback nicht, sofort mit „negative …“ korrigieren (im Spiel Taste Q) – sonst handelt der Pilot nach seinem Missverständnis.'), T('Flugsicherung')),
  E('WS ALERT', 'Windshear Alert', T('Windscherungswarnung: plötzliche Wind- und Auftriebsänderung im kurzen Endanflug (meist durch eine Gewitterzelle). Anflüge können durchstarten müssen – ein Pistenwechsel hilft.'), T('Flugsicherung')),
  E(T('Windscherung'), 'Windshear', T('Schnelle Änderung von Windrichtung oder -stärke auf kurzer Strecke, gefährlich im Endanflug. Wird als WS ALERT gemeldet.'), T('Flugsicherung'), false),
  E('GS', 'Ground Speed', T('Geschwindigkeit über Grund in Knoten.'), T('Flugsicherung')),
  E('HDG', 'Heading', T('Steuerkurs in Grad (360 = Norden, 090 = Osten).'), T('Flugsicherung')),
  E('ALT', 'Altitude', T('Flughöhe in Fuß über dem Meeresspiegel.'), T('Flugsicherung')),
  E('AV-38', 'Aviora AV-38 (Superjumbo)', T('Größtes Passagierflugzeug im Spiel: zwei Decks, vier Triebwerke, rund 500 Sitze. Braucht eine Großraumposition (L).'), T('Flugzeuge')),
  E(T('Freigabe'), 'Clearance', T('Erlaubnis des Lotsen für eine Handlung (Anflug, Landung, Rollen, Start). Ohne Freigabe darf der Pilot nicht handeln.'), T('Flugsicherung'), false),
  E(T('Pistenfolge'), 'Runway Sequence', T('Gemeinsame Reihenfolge aller Landungen und Starts auf der Piste, mit geplanten Pistenzeiten. Der Tower kann sie umsortieren.'), T('Flugsicherung'), false),
  // Anflug & Landung
  E('ILS', 'Instrument Landing System', T('Instrumentenlandesystem: Funkleitstrahlen für Kurs (Localizer) und Gleitweg führen das Flugzeug präzise zur Piste – auch ohne Sicht.'), T('Anflug & Landung')),
  E('CAT I', T('ILS-Kategorie I'), T('Landungen bis 550 m Pistensichtweite (RVR) und 200 ft Entscheidungshöhe.'), T('Anflug & Landung')),
  E('CAT III', T('ILS-Kategorie III'), T('Präzisionsanflug bis fast null Sicht (RVR ab ca. 75 m) – mit Autoland. Ohne CAT III müssen Flüge bei dichtem Nebel ausweichen.'), T('Anflug & Landung')),
  E('IAF', 'Initial Approach Fix', T('Anfangspunkt des Anflugs; hier liegen die Warteschleifen (NOLTA, SUDEN für Piste 27, WELDA, RIMOS für Piste 09).'), T('Anflug & Landung')),
  E('IP', 'Intermediate Point', T('Zwischenpunkt 15 NM vor der Schwelle auf der verlängerten Pistenachse.'), T('Anflug & Landung')),
  E('FAF', 'Final Approach Fix', T('Endanflugpunkt 10 NM vor der Schwelle – ab hier fliegt das Flugzeug stabil auf dem ILS-Gleitweg.'), T('Anflug & Landung')),
  E('THR', 'Threshold', T('Pistenschwelle: Beginn des nutzbaren Landebereichs.'), T('Anflug & Landung')),
  E('NOLTA', T('Warteschleifen-Fix'), T('IAF nordöstlich, für Anflüge auf Piste 27.'), T('Anflug & Landung')),
  E('SUDEN', T('Warteschleifen-Fix'), T('IAF südöstlich, für Anflüge auf Piste 27.'), T('Anflug & Landung')),
  E('WELDA', T('Warteschleifen-Fix'), T('IAF nordwestlich, für Anflüge auf Piste 09.'), T('Anflug & Landung')),
  E('RIMOS', T('Warteschleifen-Fix'), T('IAF südwestlich, für Anflüge auf Piste 09.'), T('Anflug & Landung')),
  E(T('Warteschleife'), 'Holding', T('Rennbahnförmige Schleife am Fix. Flugzeuge stapeln sich im Abstand von 1000 ft; der Unterste verlässt den Stapel zuerst.'), T('Anflug & Landung'), false),
  E(T('Durchstarten'), 'Go-around', T('Abgebrochene Landung: das Flugzeug steigt wieder und fliegt eine neue Runde – z. B. wenn die Piste belegt ist oder keine Landefreigabe vorliegt.'), T('Anflug & Landung'), false),
  E(T('Wirbelschleppe'), 'Wake Turbulence', T('Luftwirbel hinter jedem Flugzeug, besonders stark hinter schweren (H). Folgende Flugzeuge brauchen mehr Abstand: H→H 4 NM, H→M 5 NM, H→L 6 NM, M→L 5 NM; bei Starts bis 2 Minuten.'), T('Anflug & Landung'), false),
  E('WTC', 'Wake Turbulence Category', T('Wirbelschleppen-Kategorie: L = Light (leicht, < 7 t), M = Medium (mittel), H = Heavy (schwer, > 136 t).'), T('Anflug & Landung')),
  E('Heavy', T('Wirbelschleppen-Kategorie H'), T('Schweres Flugzeug über 136 t Höchstabfluggewicht (z. B. H-89, AV-35, H-77X, H-48F). Erzeugt starke Wirbelschleppen.'), T('Anflug & Landung')),
  E('Medium', T('Wirbelschleppen-Kategorie M'), T('Mittleres Flugzeug zwischen 7 und 136 t (z. B. AV-32, H-38, S-19, VT-70).'), T('Anflug & Landung')),
  E('Light', T('Wirbelschleppen-Kategorie L'), T('Leichtes Flugzeug unter 7 t bzw. kleine Businessjets – besonders empfindlich gegen Wirbelschleppen.'), T('Anflug & Landung')),
  E(T('Bremswirkung'), 'Braking Action', T('Wie gut Flugzeuge auf der Piste bremsen: gut / mittel / schlecht. Hängt vom Gummiabrieb und von Nässe ab; schlecht = längere Ausrollstrecke, spätere Abrollwege.'), T('Anflug & Landung'), false),
  // Abflug & Slots
  E('A-CDM', 'Airport Collaborative Decision Making', T('Gemeinsame Planung von Abfertigung, Tower und Verkehrsflusssteuerung über Zielzeiten (TOBT, TSAT, CTOT). Ziel: pünktlich starten, ohne am Rollhalt mit laufenden Triebwerken zu warten.'), T('Abflug & Slots')),
  E('TOBT', 'Target Off-Block Time', T('Zielzeit, zu der die Abfertigung fertig ist und das Flugzeug abrollbereit sein wird. Wird automatisch nachgeführt, wenn der Turnaround länger dauert.'), T('Abflug & Slots')),
  E('TSAT', T('Target Start-up Approval Time'), T('Zielzeit für Anlass- und Pushback-Freigabe. Bei Slot-Flügen: CTOT minus Rollzeit (EXOT). Früher schieben heißt: am Rollhalt warten und Treibstoff verbrennen.'), T('Abflug & Slots')),
  E('CTOT', 'Calculated Take-Off Time', T('Startslot der europäischen Verkehrsflusssteuerung. Start nur im Fenster −5/+10 Minuten erlaubt; verpasst = neuer, späterer Slot.'), T('Abflug & Slots')),
  E('EXOT', 'Estimated Taxi-Out Time', T('Geschätzte Zeit von der Parkposition bis zum Abheben (Pushback, Anlassen, Rollen).'), T('Abflug & Slots')),
  E('ATFM', 'Air Traffic Flow Management', T('Verkehrsflusssteuerung (z. B. Eurocontrol Network Manager): vergibt Slots, wenn Lufträume oder Zielflughäfen überlastet sind. ATFM-Verspätung zählt nicht gegen den Flughafen.'), T('Abflug & Slots')),
  E('Slot', T('Startslot'), T('Zugeteilte Startzeit (CTOT) mit Toleranzfenster −5/+10 Minuten.'), T('Abflug & Slots')),
  E(T('Rollhalt'), 'Holding Point', T('Haltelinie vor der Piste. Hier wartet das Flugzeug auf „Line up“ oder die Startfreigabe.'), T('Abflug & Slots'), false),
  E('Line up', 'Line up and wait', T('Auf die Piste rollen, ausrichten und auf die Startfreigabe warten. Blockiert die Piste für Landungen!'), T('Abflug & Slots')),
  E('Pushback', T('Zurückschieben'), T('Das Flugzeug wird vom Schlepper rückwärts von der Parkposition geschoben, danach werden die Triebwerke angelassen.'), T('Abflug & Slots')),
  // Boden & Abfertigung
  E('Turnaround', T('Bodenabfertigung'), T('Alle Arbeiten zwischen Ankunft und Abflug: Aussteigen, Entladen, Reinigung, Catering, Betankung, Einsteigen, Beladen, Pushback.'), T('Boden & Abfertigung')),
  E('GSE', 'Ground Support Equipment', T('Bodenfahrzeuge: Schlepper, Gepäckzüge, Tankwagen, Catering-LKW, Reinigung, Vorfeldbusse.'), T('Boden & Abfertigung')),
  E(T('Vorfeld'), 'Apron', T('Abstellfläche für Flugzeuge mit Parkpositionen und Servicestraße.'), T('Boden & Abfertigung'), false),
  E('Pos', T('Parkposition'), T('Abstellplatz eines Flugzeugs (P1–P10). Gebäudepositionen haben eine Fluggastbrücke, Vorfeldpositionen brauchen Busse.'), T('Boden & Abfertigung')),
  E(T('Klasse'), T('Positionsklasse S/M/L'), T('Größe einer Parkposition: M für Kurz-/Mittelstrecke (bis AV-32L), L für Großraumflugzeuge (H-89, AV-35, H-77X, H-48F).'), T('Boden & Abfertigung'), false),
  E(T('Mindestbodenzeit'), 'Minimum Turnaround Time', T('Kürzeste planbare Abfertigungszeit je Flugzeugtyp (z. B. AV-32 40 min, H-77X 90 min).'), T('Boden & Abfertigung'), false),
  E(T('Tankwagen'), 'Fuel Truck', T('Fasst 36 t Kerosin. Große Flugzeuge brauchen mehrere Ladungen; leere Tankwagen fahren zum Tanklager nach.'), T('Boden & Abfertigung'), false),
  E('FOD', 'Foreign Object Debris', T('Fremdkörper auf der Piste (Metallteile, Steine). Gefahr für Reifen und Triebwerke – die Piste wird für eine Kontrolle kurz gesperrt.'), T('Boden & Abfertigung')),
  E(T('Gummiabrieb'), 'Rubber Deposits', T('Reifenabrieb im Aufsetzbereich macht die Piste glatt. Wird nachts per Hochdruck-Wasserstrahl entfernt.'), T('Boden & Abfertigung'), false),
  // Wirtschaft
  E('MTOW', 'Maximum Take-Off Weight', T('Höchstabfluggewicht in Tonnen – Grundlage für das Landeentgelt.'), T('Wirtschaft')),
  E('Pax', 'Passengers', T('Passagiere (Fluggäste).'), T('Wirtschaft')),
  E('KPI', 'Key Performance Indicator', T('Kennzahl zur Leistungsmessung, z. B. Pünktlichkeit oder Slot-Einhaltung.'), T('Wirtschaft')),
  // deutsche Geld-Kürzel – im englischen Spiel steht €12k / €1.2m, dort braucht es sie nicht
  ...(EN ? [] : [E('Tsd', T('Tausend'), T('1 Tsd € = 1 000 €.'), T('Wirtschaft')), E('Mio', T('Millionen'), T('1 Mio € = 1 000 000 €.'), T('Wirtschaft'))]),
  E(T('Marge'), T('Kerosin-Aufschlag'), T('Aufschlag auf den Einkaufspreis beim Verkauf an die Airlines. Zu hoch → Airlines tanken woanders (Tankering).'), T('Wirtschaft'), false),
  E('Tankering', 'Fuel Tankering', T('Airlines tanken am günstigen Flughafen mehr, um am teuren weniger kaufen zu müssen.'), T('Wirtschaft'), false),
  E(T('Kerosin'), 'Jet A-1', T('Flugturbinenkraftstoff. Der Flughafen kauft am Markt ein, lagert im Tanklager und verkauft mit Aufschlag an die Airlines.'), T('Wirtschaft'), false),
  E(T('Annuität'), T('Kreditrate'), T('Gleichbleibende Tagesrate aus Zins und Tilgung.'), T('Wirtschaft'), false),
  E(T('Nachtflugverbot'), 'Curfew', T('Zwischen 23 und 5 Uhr keine planmäßigen Flüge. Weniger Lärmbeschwerden, aber Frachtairlines verlieren Nachtslots.'), T('Wirtschaft'), false),
  E('ICAO', 'International Civil Aviation Organization', T('UN-Organisation für die Zivilluftfahrt. ICAO-Codes: 4 Zeichen für Flugzeugtypen (im Spiel z. B. AV32), 3 Buchstaben für Airlines (AUR).'), T('Wirtschaft')),
  E('IATA', 'International Air Transport Association', T('Airline-Dachverband. IATA-Codes: 3 Buchstaben für Flughäfen (z. B. LHR = London Heathrow).'), T('Wirtschaft')),
  // Wetter
  E('RVR', 'Runway Visual Range', T('Pistensichtweite in Metern. Unter 550 m reicht ILS CAT I nicht mehr – dann nur mit CAT III landen.'), T('Wetter')),
  E('LVP', 'Low Visibility Procedures', T('Verfahren bei schlechter Sicht: größere Abstände zwischen Anflügen, geschützte ILS-Zonen, weniger Kapazität.'), T('Wetter')),
  E(T('Rückenwind'), 'Tailwind', T('Wind von hinten verlängert Start- und Landestrecke. Über 5 kt Rückenwind wird die Betriebsrichtung gewechselt.'), T('Wetter'), false),
  E(T('Gegenwind'), 'Headwind', T('Wind von vorne – erwünscht, verkürzt Start und Landung.'), T('Wetter'), false),
  // Einheiten & Kennungen
  E('RWY', 'Runway', T('Start- und Landebahn. Die Nummer ist die Richtung in Zehnergrad: RWY 27 = Richtung 270° (Westen), RWY 09 = 90° (Osten).'), T('Einheiten & Kennungen')),
  E('NM', T('Nautische Meile'), T('1 NM = 1,852 km. Entfernungen in der Luftfahrt.'), T('Einheiten & Kennungen')),
  E('kt', T('Knoten'), T('Geschwindigkeit in NM pro Stunde: 1 kt ≈ 1,85 km/h. 160 kt ≈ 300 km/h.'), T('Einheiten & Kennungen')),
  E('ft', T('Fuß'), T('Höhenangabe: 1 ft = 0,3048 m. 5000 ft ≈ 1,5 km.'), T('Einheiten & Kennungen')),
  E('feet', T('Fuß'), T('Höhenangabe: 1 ft = 0,3048 m.'), T('Einheiten & Kennungen')),
  E('FL', 'Flight Level', T('Flugfläche: Höhe in 100 ft bei Standard-Luftdruck. FL120 = 12 000 ft. Im Radar steht die Höhe in 100 ft (z. B. 050 = 5000 ft).'), T('Einheiten & Kennungen')),
  E('STA', 'Scheduled Time of Arrival', T('Planmäßige Ankunftszeit laut Flugplan.'), T('Einheiten & Kennungen')),
  E('STD', 'Scheduled Time of Departure', T('Planmäßige Abflugzeit laut Flugplan (Off-Block).'), T('Einheiten & Kennungen')),
  E('ETA', 'Estimated Time of Arrival', T('Voraussichtliche Ankunftszeit.'), T('Einheiten & Kennungen')),
  E('XP', T('Erfahrungspunkte'), T('Für erreichte Ziele und gute Tage. Mehr XP = höherer Flughafen-Rang = mehr Airline-Interesse.'), T('Einheiten & Kennungen')),
  { ...E(AIRPORT.code, AIRPORT.name, T('IATA-Code dieses Flughafens.'), T('Einheiten & Kennungen')), home: true },
];

// Dynamische Einträge: Flugzeugtypen, Airlines, Flughäfen
for (const t of Object.values(AC_TYPES)) {
  GLOSSARY.push(E(t.code || t.id, t.name, T`Typkürzel (fiktiver Hersteller). ${t.cargo ? T`Frachter, ${t.cargo} t Fracht` : T`${t.pax} Sitze`}, Wirbelschleppe ${t.wake}, Positionsklasse ${t.size}, MTOW ${t.mtow} t, Mindestbodenzeit ${t.turn} min, Anfluggeschwindigkeit ${t.vapp} kt.`, T('Flugzeugtypen')));
}
for (const a of Object.values(AIRLINES)) {
  GLOSSARY.push(E(a.code, a.name, T`ICAO-Airline-Code (fiktiv). Rufname im Funk: „${a.tel}“. Flotte: ${a.types.map((k) => typeCode(k)).join(', ')}.`, 'Airlines'));
}
for (const [code, c] of Object.entries(CITIES)) {
  GLOSSARY.push(E(code, c.name, T`IATA-Flughafencode. ${{ short: T('Kurzstrecke'), mid: T('Mittelstrecke'), long: T('Langstrecke') }[c.cat]}.`, T('Flughäfen')));
}

const BY_T = new Map(GLOSSARY.map((g) => [g.t, g]));
export const glossaryEntry = (k) => BY_T.get(k);

// ---------- Erklärungen für Panel-Abschnitte ----------
export const EXPLAIN = {
  seq: T('<b>Streifentafel</b> wie im echten Tower: jeder Flug ist ein Kontrollstreifen – <b>Anflüge orange</b>, <b>Abflüge blau</b>. Die Buchten zeigen, wo der Flug steht: <b>Luft</b> (Warteliste vor der Anflugfreigabe, darunter gerade gestartete), <b>Pistenfolge</b>, <b>Rollen</b>, <b>Vorfeld</b>; oben steht, wer als Nächstes dran ist. Rechts auf dem Streifen Piste und Zeit, daneben die Freigabe-Kästchen (APP, LND, TX bzw. PB, TX, LU, TO): ✓ = erteilt, gelb = jetzt fällig. Der ausgewählte Streifen klappt auf und zeigt alle Befehle. <b>Ziehen</b> ändert die Reihenfolge (auch ▲ ▼ oder W/S): mit <b>Auto-Staffelung</b> gibt der Tower dann die Anflugfreigaben in dieser Reihenfolge, bremst Anflüge auf 180/160 kt, gibt Vorgezogenen „Direkt FAF“ und schickt notfalls einen in die Warteschleife. Starts, die du vor eine Landung ziehst, bekommen eine Lücke. Wer schon im Endanflug oder auf der Piste ist, bleibt vorn. Einen Streifen aus „Luft“ in die Pistenfolge ziehen = Anflug frei; zurückziehen = Warteschleife.'),
  arr: T('<b>Anflug</b>: Flüge im Luftraum ohne Anflugfreigabe. <i>A</i> = Anflug frei über IP und FAF, <i>D</i> = direkt zum FAF (kürzer), <i>H</i> = Warteschleife. ⛽ zeigt die Treibstoffreserve in Minuten – unter 12 min meldet der Pilot MINIMUM FUEL.'),
  gnd: T('<b>Rollverkehr</b>: Flugzeuge auf Rollwegen und Anfragen für Pushback/Rollen. Bei Slot-Flügen erst zur TSAT schieben („Warten bis TSAT“), sonst warten sie mit laufenden Triebwerken am Rollhalt.'),
  dep: T('<b>Abflug</b>: gerade gestartete Flüge im Nahbereich.'),
  rwy: T('<b>Piste</b>: Betriebsrichtung nach dem Wind (max. 5 kt Rückenwind). Zustand = Gummiabrieb/Reibwert, daraus folgt die Bremswirkung (bei Nässe schlechter). Bei Sperrung (FOD-Kontrolle, Bauarbeiten) keine Landungen und Starts.'),
  inb: T('<b>Ankünfte</b>: jede Ankunft braucht eine passende Parkposition (Klasse M/L, Fracht auf Frachtpositionen). Ohne Position wartet das Flugzeug am Rollweg-Ende.'),
  ta: T('<b>Turnaround</b>: Aufgaben mit Abhängigkeiten. Gelbe Felder anklicken schickt das nächste freie Fahrzeug. TOBT = voraussichtlich fertig, CTOT = Startslot. Liegt die TOBT nach der STD, wird der Flug verspätet; ist ein Slot nicht mehr erreichbar, gibt es einen neuen.'),
  fleet: T('<b>Fuhrpark</b>: Fahrzeuge je Typ, Schalter = automatische Disposition. Tankwagen fassen 36 t und fahren leer zum Tanklager nach (Balken = Ladung).'),
  build: T('<b>Ausbau</b>: jedes Projekt hat Bauzeit und ist als Baustelle sichtbar. Pistenarbeiten laufen nur nachts in Verkehrspausen und sperren dann die Piste.'),
  fuel: T('<b>Kerosin</b>: Einkauf zum Marktpreis (+2 % Transport), Lieferung nach 2–3,5 h. Verkauf an Airlines mit deiner Marge; hohe Marge → Airlines tanken weniger (Tankering). Leeres Tanklager = Betankungen stocken = Verspätungen.'),
  fees: T('<b>Gebühren</b>: Landeentgelt je Tonne MTOW, Passagierentgelt je abfliegendem Passagier, Positionsentgelt je Stunde. Nachtentgelt je Bewegung zwischen 23 und 5 Uhr.'),
  loans: T('<b>Kredite</b>: Auszahlung sofort, Rückzahlung in 30 gleichen Tagesraten (Annuität). Der Zins pro Tag hängt vom Ansehen ab. Sondertilgung jederzeit möglich.'),
  goals: T('<b>Ziele</b>: drei Aufgaben je Station. Erreichen bringt Prämie und XP; XP heben den Flughafen-Rang – höhere Ränge locken mehr Airlines an.'),
  contracts: T('<b>Verträge</b>: Airlines fliegen täglich nach Plan. Zufriedenheit sinkt bei Verspätungen, hohen Gebühren und verpassten Slots; unzufriedene Airlines verlängern nicht.'),
};
export const qm = (key) => T`<button class="qm" data-explain="${key}" aria-label="Erklärung" title="Erklärung">?</button>`;

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
    return T`<b>${esc(cs)}</b> · Rufzeichen<div class="gl-d">${esc(al.name)}, Flugnummer ${esc(n)}. Im Funk: „${esc(al.tel)} ${esc(n)}“. Ankunft und Abflug haben unterschiedliche Nummern.</div>`;
  }
  if (key.startsWith('pos:')) return T`<b>${esc(key.slice(4))}</b> · Parkposition ${esc(key.slice(5))}<div class="gl-d">Abstellplatz auf dem Vorfeld. P1–P7 am Terminal (Fluggastbrücke), P8 Vorfeldposition mit Bus, P9–P10 Fracht.</div>`;
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
  pop.innerHTML = T`${html}<button class="mini ep-x" aria-label="Schließen">✕</button>`;
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
  const order = [T('Flugsicherung'), T('Anflug & Landung'), T('Abflug & Slots'), T('Boden & Abfertigung'), T('Wirtschaft'), T('Wetter'), T('Einheiten & Kennungen'), T('Flugzeugtypen'), 'Airlines', T('Flughäfen')];
  let h = '';
  for (const c of order) {
    const list = cats[c];
    if (!list) continue;
    h += `<h3>${c}</h3><dl class="gloss">`;
    for (const g of list) h += `<dt>${esc(g.t)}</dt><dd><b>${esc(g.long)}</b> – ${esc(g.desc)}</dd>`;
    h += `</dl>`;
  }
  return h || T('<p class="empty">Kein Eintrag gefunden.</p>');
}

// Heimatflughafen je Spielstand (fiktive Stadt): Kürzel im Glossar austauschen
export function setHomeAirport(code, city, name) {
  const h = GLOSSARY.find((g) => g.home);
  if (!h || (h.t === code && h.long === name)) return;
  BY_T.delete(h.t);
  h.t = code;
  h.long = name;
  h.desc = T`Kürzel des Heimatflughafens in ${city} (fiktive Stadt) – steht in Strecken, Flugstreifen und auf der Anzeigetafel.`;
  BY_T.set(code, h);
  RE = null;
}
