# ✈️ Planez – Airport Simulator

Isometrische Flughafen-Simulation im Browser – eine Mischung aus **Simulation, Wirtschaft und Logistik**.
Du übernimmst eine Station am Flughafen, alle anderen Bereiche laufen automatisch weiter:

| Station | Deine Aufgabe | Automatisch |
|---|---|---|
| 🎧 **Tower-Lotse** | Radar & Flugstreifen: gemeinsame Pistenfolge aus Landungen und Starts (selbst sortierbar, farbig auf Radar und Karte), Warteschleifen, Lande-/Startfreigaben, Pushback, Rollverkehr, Pistenwechsel bei Rückenwind | Abfertigung, Management |
| 🦺 **Vorfeld & Abfertigung** | Parkpositionen vergeben, Turnaround steuern (Aussteigen, Entladen, Reinigung, Catering, Betankung, Einsteigen, Beladen, Pushback), Fahrzeuge disponieren | Flugsicherung, Management |
| 💼 **Flughafen-Manager** | Airline-Verträge, Gebühren, Ausbau (Positionen, Terminal, Hotel, ILS CAT III …), Fuhrpark, Personal, Finanzen | Flugsicherung, Abfertigung |
| 👁️ **Beobachter** | zurücklehnen | alles |

**Spielen:** https://marcelweissgerberit.github.io/Planez/

## Features
- Isometrische, animierte Flughafenansicht mit Tag/Nacht-Zyklus, Befeuerung (Pisten-, Rollweg-, Anflug-Lauflicht), Wetter (Regen, Nebel, Gewitter), Wind & Windsack
- Luftraum mit Radar (Sweep, Datenblöcke, Warteschleifen-Fixes, Endanflug, Konfliktwarnung/STCA)
- Markierungen: Flüge per Streifen, Karte oder Radar farbig markieren und mit Notiz versehen – im Radar als Ring und Fähnchen sichtbar, mit Filter
- Pistenfolge: Landungen und Starts in einer nummerierten Liste mit geplanten Pistenzeiten; Farben auf Radar/Karte: türkis = Landung, hellblau = Landung frei, bernstein = Start, magenta = Startfreigabe
- Echte Abläufe: Warteschleifen-Stapel, ILS-Anflug, Landefreigabe, Durchstarten, Abrollwege, Rollwege mit Vorfahrt/Kollisionsvermeidung, Pushback mit Schlepper, Line-up, Start
- Turnaround mit Abhängigkeiten und Fahrzeugflotte (Schlepper, Gepäckzüge, Tankwagen, Catering, Reinigung, Vorfeldbusse), Fluggastbrücken
- Baustellen: Jeder Ausbau hat eine Bauzeit (Spielstunden) und ist auf der Karte als Baustelle sichtbar – Bauzaun, Kran mit Warnlicht, Bagger, Betonmischer, Baucontainer; Beton wächst, das Hotel steigt Stockwerk für Stockwerk als Rohbau empor, Pylonen sperren Rollwege. Schild mit Fortschritt und Restzeit, Liste im Tab *Ausbau* mit „📍 Zeigen“ und Abbruch (50 % Erstattung der noch nicht verbauten Kosten); bei Gewitter ruht die Arbeit
- Wirtschaft: Lande-, Passagier- und Positionsentgelte, Shops, Parken, Fracht, Vertragsstrafen, Airline-Zufriedenheit, Tagesberichte
- Ereignisse: Notfälle (Squawk 7700 + Feuerwehr), Vogelschlag, VIP-Jets, Streik, Fahrzeugdefekte, Winddrehungen
- Speichern im Browser, Funkprotokoll (englische Phraseologie, optional per Sprachausgabe)

## Steuerung
- Karte ziehen = verschieben · Mausrad / Pinch = Zoom · Klick = auswählen
- `Leertaste` Pause · `1`–`5` Tempo · `B` Beschriftungen · `N`/`Tab` nächste Anfrage · `F` Radar groß · `W`/`S` Flug in der Pistenfolge vor/zurück (auch ▲▼ oder Ziehen)
- Markieren: `M` (Farbe weiterschalten, `Shift`+`M` entfernen), ⚑ auf dem Flugstreifen oder Rechtsklick / langes Drücken auf ein Flugzeug in Karte bzw. Radar – mit Farbe und Notiz, sichtbar auf Radar, Karte und Streifen („⚑ Filter“ im Radar)
- Tower: `A` Anflug frei · `D` Direkt FAF · `H` Warteschleife · `L` Landefreigabe · `G` Durchstarten · `R` Rollfreigabe · `P` Pushback · `U` Line up · `T` Startfreigabe · `X` Halt · `C` Weiterrollen

## Technik
Reines HTML/CSS/JavaScript (ES-Module, Canvas 2D) ohne Build-Schritt – läuft direkt auf GitHub Pages.
Lokal starten: `npx http-server .` und `http://localhost:8080` öffnen. Headless-Simulationstest: `node tools/simtest.mjs 3`.

## Credits
Alle Grafiken (Gebäude-, Flugzeug- und Fahrzeug-Sprites, Baumaschinen, Rohbau, Texturen, Rollen-Porträts, Logo) sowie das animierte Titelvideo wurden mit **Higgsfield AI** generiert (GPT Image 2.5, Kling 3.0).
Alle Airlines und Flugnummern sind fiktiv.
