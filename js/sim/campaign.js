// Kampagne „Planez – Vom Regionalflughafen zum Drehkreuz“: zehn Kapitel in fester Reihenfolge über alle Stationen.
// Jedes Kapitel spielt eine Herausforderung; die Aufsichtsratsvorsitzende erzählt vorher, worum es geht, und
// nachher, was es bewirkt hat. Ein Kapitel gilt mit mindestens einem Stern als geschafft und öffnet das nächste.
import { IS_DEMO, DEMO } from '../edition.js';
import { loadBest } from './scenarios.js';

export const CHAPTERS = [
  {
    scn: 'morning', title: 'Erster Arbeitstag',
    intro: 'Willkommen bei Planez International. Bevor Sie Verantwortung für den ganzen Flughafen tragen, will ich sehen, dass Sie den Betrieb von innen kennen. Ihr erster Platz: der Tower, Montagmorgen, die erste Welle.',
    outro: 'Sauber gearbeitet. Die Lotsen reden schon über den Neuen im Tower. Aber ein Flughafen ist mehr als eine Startbahn – morgen geht es aufs Vorfeld.',
  },
  {
    scn: 'rushGround', title: 'Ferienstart',
    intro: 'Die Sommerferien beginnen, und das Vorfeld platzt aus allen Nähten. Jede Minute am Boden kostet die Airlines Geld – und uns ihr Vertrauen. Zeigen Sie mir pünktliche Abflüge.',
    outro: 'Die Airlines haben angerufen – positiv, ausnahmsweise. Aber der Herbst kommt, und mit ihm der Nebel.',
  },
  {
    scn: 'fog', title: 'Nebel über Planez',
    intro: 'Dichter Nebel, Low Visibility Procedures. Jede Ausweichlandung nach Nordhafen ist eine Schlagzeile für die Konkurrenz. Holen Sie die Maschinen herunter – sicher.',
    outro: 'Nordhafen musste heute selbst Flüge umleiten. Wir nicht. Das spricht sich herum – jetzt schauen wir auf die Zahlen.',
  },
  {
    scn: 'rescue', title: 'Rote Zahlen',
    intro: 'Ich bin ehrlich: Die Bilanz ist rot, die Gesellschafter werden nervös. Sie übernehmen die Geschäftsführung. Bringen Sie die Kasse ins Plus, ohne den Ruf zu ruinieren.',
    outro: 'Schwarze Zahlen. Der Aufsichtsrat atmet auf – und die Gewerkschaft hat Ihren Erfolg auch bemerkt. Sie wollen ihren Anteil.',
  },
  {
    scn: 'strike', title: 'Streiktag',
    intro: 'Warnstreik beim Bodenpersonal und bei der Flugsicherung. Mit halber Mannschaft müssen die Flugzeuge trotzdem raus. Teilen Sie Ihre Leute klug ein.',
    outro: 'Sie haben den Laden zusammengehalten. Die Einigung mit der Gewerkschaft steht. Ein ruhiger Sommer? Der Wetterdienst sieht das anders.',
  },
  {
    scn: 'storm', title: 'Die Front',
    intro: 'Eine Gewitterfront zieht heute Nachmittag über uns hinweg, der Wind dreht. Und Sie wissen, wie das ist: Wenn es kracht, dann richtig. Zurück in den Tower.',
    outro: 'Pistenwechsel im Gewitter, ein Notfall mittendrin – und alle sind sicher unten. Ich habe den Mitschnitt gehört. Respekt.',
  },
  {
    scn: 'winter', title: 'Winterchaos',
    intro: 'Schnee. Enteisung, Räumdienst, verspätete Crews. Der Winter ist der Härtetest für jedes Vorfeld. Halten Sie den Betrieb am Laufen.',
    outro: 'Andere Flughäfen hatten heute geschlossen. Wir hatten offen. Die Presse nennt uns „das kleine Wunder im Schnee“.',
  },
  {
    scn: 'mayday', title: 'Mayday',
    intro: 'Heute Nacht wird es ernst: mehrere Notfälle kurz hintereinander. Das ist der Moment, für den Lotsen trainieren. Ich vertraue Ihnen.',
    outro: 'Alle Notfälle sicher gelandet. Ich habe den Gesellschaftern vorgeschlagen, Ihnen den nächsten Schritt anzuvertrauen: das große Wachstum.',
  },
  {
    scn: 'growth', title: 'Drehkreuz',
    intro: 'Das letzte Kapitel. Die Parallelbahn steht, die Airlines klopfen an. Machen Sie aus Planez ein Drehkreuz – mehr Passagiere, besseres Ansehen, solide Finanzen.',
    outro: 'Vom Regionalflughafen zum Drehkreuz. Ich habe in vierzig Jahren viele Flughafenchefs gesehen – Sie gehören zu den besten. Willkommen im Vorstand.',
  },
  {
    scn: 'flytag', title: 'Großer Flugtag',
    intro: 'Eine Bitte noch, bevor Sie im Vorstand verschwinden: Zum Jubiläum möchte ich Sie dort sehen, wo alles anfing – im Tower. Heute ist Flugtag: die Flugschule, der Rettungshubschrauber, ein Staatsgast und der ganz normale Linienverkehr. Zeigen Sie allen, wie man einen vollen Himmel ordnet.',
    outro: 'Was für ein Tag. Die Flugschüler haben applaudiert, der Staatsgast hat sich bedankt, und Rescue 7 kam jedes Mal ohne Umweg durch. Planez ist bereit für alles, was kommt – und Sie auch.',
  },
];

export const chapterOf = (id) => (id && id.startsWith('camp-') ? Number(id.slice(5)) : null);
export const chapterDone = (i, best = loadBest()) => (best[CHAPTERS[i].scn]?.stars || 0) >= 1;
export const chapterOpen = (i, best = loadBest()) => !(IS_DEMO && i >= DEMO.chapters) && (i === 0 || chapterDone(i - 1, best));
export function campaignProgress() {
  const best = loadBest();
  const done = CHAPTERS.filter((_, i) => chapterDone(i, best)).length;
  const next = CHAPTERS.findIndex((_, i) => !chapterDone(i, best));
  return { done, next: next < 0 ? null : next, total: CHAPTERS.length };
}
