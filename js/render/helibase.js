// Luftrettungsstation am Boden (Karte und Textur der 3D-Ansicht): Zufahrt von der Feuerwache, Betonvorplatz mit Fugen,
// Landeplatz (TLOF) mit weißer Umrandung, gelbem Aufsetzkreis und weißem „H“, Pkw-Stellplätze der Crew.
// g zeichnet in Kacheln (Karte: isometrischer Kontext; Textur: entsprechend skaliert und verschoben).
import { HELIBASE } from '../layout.js';

export function paintHeliBase(g) {
  const B = HELIBASE, A = B.apron, P = B.pad, R = B.road;
  // Zufahrt (Asphalt)
  g.fillStyle = '#4a4d52';
  g.fillRect(R.x0, R.y - R.w / 2, R.x1 - R.x0 + 0.05, R.w);
  // Vorplatz (Beton) mit Fugen
  g.fillStyle = '#b9b6ae';
  g.fillRect(A.x0, A.y0, A.x1 - A.x0, A.y1 - A.y0);
  g.strokeStyle = 'rgba(90,88,82,0.35)';
  g.lineWidth = 0.02;
  g.beginPath();
  for (let x = A.x0 + 0.5; x < A.x1; x += 0.5) (g.moveTo(x, A.y0), g.lineTo(x, A.y1));
  for (let y = A.y0 + 0.5; y < A.y1; y += 0.5) (g.moveTo(A.x0, y), g.lineTo(A.x1, y));
  g.stroke();
  // Landeplatz: etwas helleres Feld, weiße Randlinie, gestrichelte Außenkante (Sicherheitsfläche)
  const h = P.hw;
  g.fillStyle = '#c9c6be';
  g.fillRect(P.x - h, P.y - h, 2 * h, 2 * h);
  g.strokeStyle = '#f4f4f2';
  g.lineWidth = 0.06;
  g.strokeRect(P.x - h + 0.03, P.y - h + 0.03, 2 * h - 0.06, 2 * h - 0.06);
  g.setLineDash([0.16, 0.12]);
  g.lineWidth = 0.035;
  g.strokeRect(P.x - h - 0.22, P.y - h - 0.22, 2 * h + 0.44, 2 * h + 0.44);
  g.setLineDash([]);
  // gelber Aufsetzkreis
  g.strokeStyle = '#f2c230';
  g.lineWidth = 0.055;
  g.beginPath();
  g.arc(P.x, P.y, h * 0.7, 0, Math.PI * 2);
  g.stroke();
  // weißes „H“ (Balken in Anflugrichtung Nord–Süd)
  g.fillStyle = '#f7f7f5';
  const hh = h * 0.42, hw = h * 0.27, t = 0.075;
  g.fillRect(P.x - hw - t / 2, P.y - hh, t, 2 * hh);
  g.fillRect(P.x + hw - t / 2, P.y - hh, t, 2 * hh);
  g.fillRect(P.x - hw, P.y - t / 2, 2 * hw, t);
  // Stellplätze der Crew vor dem Stationsgebäude
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 0.025;
  g.beginPath();
  for (let i = 0; i <= 3; i++) {
    const x = 41.3 + i * 0.36;
    g.moveTo(x, 46.95);
    g.lineTo(x, 47.5);
  }
  g.stroke();
}

// Befeuerung des Landeplatzes (nachts): grüne Randfeuer, dazu ein Flutlicht über dem Hangartor
export function heliBaseLights(lights) {
  const P = HELIBASE.pad, h = P.hw;
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 4; k++) {
      const u = -h + (k * 2 * h) / 4;
      const [x, y] = [[P.x + u, P.y - h], [P.x + h, P.y + u], [P.x - u, P.y + h], [P.x - h, P.y - u]][i];
      lights.push({ x, y, z: 0.02, c: '#3cff6a', s: 5, a: 0.9 });
    }
  const Hg = HELIBASE.hangar;
  lights.push({ x: (Hg.x0 + Hg.x1) / 2, y: Hg.y1 + 0.02, z: Hg.h * 0.9, c: '#fff2d0', s: 18, a: 0.7 });
}
