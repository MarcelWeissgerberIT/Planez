// Karriere: Boden der kleinen Ausbaustufen. Grasplatz = gemähte Graspiste mit weißen Randmarkierungen und
// Schwellenbalken, ausgefahrene Rollspuren im Gras, Abstellplätze vor Vereinsheim und Halle, Schotterparkplatz,
// Holzzaun. Verkehrslandeplatz = kurze Asphaltbahn (paintRunway), Rollweg A, kleines Vorfeld mit fünf Positionen,
// Parkplatz am Abfertigungsgebäude; die Wiese mit den Sportflugzeugen bleibt.
import * as LY from '../layout.js';
import { roundedPath } from '../util.js';

const strokeP = (g, pts, rad = 1.2) => {
  const p = roundedPath(pts, rad, 0.25);
  g.beginPath();
  p.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
  g.stroke();
};

// gemähte Bahn: hellere Streifen in Laufrichtung, Mitte etwas ausgefahren
function mownStrip(g, x0, x1, y0, y1) {
  g.fillStyle = 'rgba(190,220,120,0.22)';
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  const n = 6;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,220,0.07)' : 'rgba(40,70,20,0.07)';
    g.fillRect(x0, y0 + ((y1 - y0) * i) / n, x1 - x0, (y1 - y0) / n);
  }
}

// ausgefahrene Rollspur im Gras
function track(g, pts, w = 0.7) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(200,225,130,0.28)';
  g.lineWidth = w;
  strokeP(g, pts);
  g.strokeStyle = 'rgba(120,95,55,0.18)';
  g.lineWidth = w * 0.18;
  for (const o of [-0.16, 0.16]) strokeP(g, pts.map((p, i) => ({ x: p.x + (i && pts[i - 1].y === p.y ? 0 : o), y: p.y + (i && pts[i - 1].x === p.x ? 0 : o) })));
}

export function drawGrassRunway(g) {
  const R = LY.RWY;
  mownStrip(g, R.x0 - 0.6, R.x1 + 0.6, R.y - R.hw - 0.35, R.y + R.hw + 0.35);
  // Aufsetzzonen leicht abgefahren
  g.fillStyle = 'rgba(130,110,70,0.12)';
  for (const [x, d] of [[R.thr['09'], 1], [R.thr['27'], -1]]) g.fillRect(Math.min(x, x + d * 6), R.y - 0.35, 6, 0.7);
  // weiße Randmarkierungen (Tafeln) alle 2 Kacheln, an den Ecken rot-weiß
  for (let x = R.x0; x <= R.x1 + 0.01; x += 2) {
    for (const s of [-1, 1]) {
      g.fillStyle = x === R.x0 || x >= R.x1 - 0.1 ? '#ef4444' : '#f8fafc';
      g.fillRect(x - 0.22, R.y + s * R.hw - 0.05, 0.44, 0.1);
    }
  }
  // Schwellen: Reihe weißer Tafeln quer zur Bahn
  g.fillStyle = '#f8fafc';
  for (const x of [R.thr['09'], R.thr['27']]) for (let y = R.y - R.hw + 0.15; y <= R.y + R.hw - 0.1; y += 0.32) g.fillRect(x - 0.08, y - 0.06, 0.16, 0.12);
  // Kennziffern aus weißen Platten
  for (const [rwy, x, d] of [['09', R.thr['09'], 1], ['27', R.thr['27'], -1]]) {
    g.save();
    g.translate(x + d * 1.4, R.y);
    g.rotate(d > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.scale(0.03, 0.03);
    g.font = '700 30px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(248,250,252,0.92)';
    g.fillText(rwy, 0, 0);
    g.restore();
  }
}

export function drawSmallField(g, state, P) {
  const st = LY.GEO.stage;
  const R = LY.RWY;
  // ---- Landseite: Landstraße, Zufahrt, Parkplatz ----
  g.fillStyle = P.asphalt;
  g.fillRect(-8, -0.7, LY.W + 16, 1.4);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let x = -8; x < LY.W + 8; x += 1.6) g.fillRect(x, -0.02, 0.8, 0.04);
  // Schotterweg und -parkplatz am Vereinsheim (beide Stufen)
  g.fillStyle = P.gravel;
  g.fillRect(46.6, 0.7, 0.8, 10.0);
  g.fillRect(43.4, 10.5, 6.6, 2.0);
  g.strokeStyle = 'rgba(90,80,60,0.35)';
  g.lineWidth = 0.04;
  g.strokeRect(43.4, 10.5, 6.6, 2.0);
  if (st >= 1) {
    // Zufahrt und Parkplatz am Abfertigungsgebäude
    g.fillStyle = P.asphalt;
    g.fillRect(27.2, 0.7, 0.8, 7.2);
    g.fillRect(22.6, 7.6, 8.4, 2.8);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (const yy of [7.85, 9.75]) for (let x = 22.8; x < 30.8; x += 0.22) g.fillRect(x, yy, 0.012, 0.36);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    for (let x = 23.2; x < 30.6; x += 1.4) g.fillRect(x, 9.05, 0.6, 0.04);
  }
  // Holzzaun zwischen Parkplatz und Flugbetrieb
  g.strokeStyle = 'rgba(110,80,50,0.6)';
  g.lineWidth = 0.05;
  g.setLineDash([0.25, 0.12]);
  g.beginPath();
  g.moveTo(st === 0 ? 38.5 : 42, 12.9);
  g.lineTo(57, 12.9);
  g.stroke();
  g.setLineDash([]);

  // ---- Bahn ----
  if (st === 0) drawGrassRunway(g);
  else P.paintRunway(g, R, { '09': '09', '27': '27' }, P.asphalt, state.rwyCond ?? 88);

  // ---- Rollwege ----
  const x0 = Math.min(LY.CONN[0], R.thr['09']) - 0.6, x1 = Math.max(LY.CONN[LY.CONN.length - 1], R.thr['27']) + 0.6;
  if (st === 0) {
    track(g, [{ x: x0, y: LY.TWY_A }, { x: x1, y: LY.TWY_A }]);
    for (const x of LY.EXITS) track(g, [{ x, y: R.y }, { x, y: LY.TWY_A }]);
    for (const c of LY.CONN) track(g, [{ x: c, y: LY.TWY_A }, { x: c, y: LY.LANE }]);
    track(g, [{ x: LY.CONN[0], y: LY.LANE }, { x: 39, y: LY.LANE }], 0.6);
    track(g, [{ x: 53.4, y: LY.LANE }, { x: LY.CONN[LY.CONN.length - 1], y: LY.LANE }], 0.6);
  } else {
    g.strokeStyle = P.asphalt;
    g.lineWidth = 1.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    strokeP(g, [{ x: x0, y: LY.TWY_A }, { x: x1, y: LY.TWY_A }]);
    for (const x of LY.EXITS) strokeP(g, [{ x, y: R.y }, { x, y: LY.TWY_A }]);
    for (const c of LY.CONN) strokeP(g, [{ x: c, y: LY.TWY_A }, { x: c, y: LY.LANE + 0.6 }]);
    strokeP(g, [{ x: LY.CONN[0], y: LY.LANE }, { x: LY.CONN[LY.CONN.length - 1], y: LY.LANE }]);
    // kleines Vorfeld vor dem Abfertigungsgebäude
    g.fillStyle = P.concrete;
    g.fillRect(10.2, 14.6, 31.4, LY.LANE + 1.4 - 14.6);
    g.strokeStyle = 'rgba(240,200,40,0.9)';
    g.lineWidth = 0.05;
    g.strokeRect(10.25, 14.62, 31.3, LY.LANE + 1.35 - 14.6);
    // gelbe Mittellinien
    g.strokeStyle = '#f2c81f';
    g.lineWidth = 0.07;
    g.lineCap = 'butt';
    strokeP(g, [{ x: x0, y: LY.TWY_A }, { x: x1, y: LY.TWY_A }]);
    for (const x of LY.EXITS) strokeP(g, [{ x, y: R.y }, { x, y: LY.TWY_A }]);
    for (const c of LY.CONN) strokeP(g, [{ x: c, y: LY.TWY_A }, { x: c, y: LY.LANE }]);
    strokeP(g, [{ x: LY.CONN[0], y: LY.LANE }, { x: LY.CONN[LY.CONN.length - 1], y: LY.LANE }]);
    // Haltebalken vor der Bahn
    g.fillStyle = '#f2c81f';
    for (const x of LY.EXITS) {
      g.fillRect(x - 0.6, LY.HOLD_Y - 0.12, 1.2, 0.05);
      g.fillRect(x - 0.6, LY.HOLD_Y - 0.02, 1.2, 0.05);
    }
    // Feuerwehrzufahrt
    g.fillStyle = P.asphalt;
    g.fillRect(36.9, R.y + R.hw + 0.3, 0.9, 43.9 - (R.y + R.hw + 0.3));
    g.fillStyle = P.concrete;
    g.fillRect(34.8, 43.9, 5.8, 2.1);
    // Depot-Vorplatz
    g.fillRect(66.2, 14.4, 8.4, 4.4);
    // Servicestraße vom kleinen Vorfeld zum Depot – südlich an Tankstelle, Vereinsheim und Halle vorbei
    g.strokeStyle = P.asphalt;
    g.lineWidth = 0.9;
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    strokeP(g, LY.serviceRun(41.2, 66.6), 0.8);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 0.03;
    g.setLineDash([0.3, 0.3]);
    strokeP(g, LY.serviceRun(41.6, 66.2), 0.8);
    g.setLineDash([]);
  }
  // ---- Abstellplätze ----
  // gemähte Abstellwiese für die Sportflieger (Reihe vor Tankstelle, Vereinsheim und Halle)
  const ga = state.stands.filter((s) => s.ga && s.built && !s.closed);
  if (ga.length) {
    const gx0 = Math.min(...ga.map((s) => s.x)) - 1.2, gx1 = Math.max(...ga.map((s) => s.x)) + 1.2;
    mownStrip(g, gx0, gx1, LY.GA_NOSE - 0.9, LY.LANE + 0.5);
    g.strokeStyle = 'rgba(248,250,252,0.35)';
    g.lineWidth = 0.035;
    g.strokeRect(gx0, LY.GA_NOSE - 0.9, gx1 - gx0, LY.LANE + 1.4 - LY.GA_NOSE);
  }
  for (const s of state.stands) {
    if (!s.built) continue;
    const sx = s.x;
    if (s.ga) {
      if (s.closed) continue;
      g.fillStyle = 'rgba(248,250,252,0.85)';
      g.fillRect(sx - 0.28, LY.GA_NOSE + 0.05, 0.56, 0.05);
      g.fillStyle = 'rgba(60,60,60,0.5)';
      for (const o of [-0.26, 0.26]) g.fillRect(sx + o - 0.03, LY.GA_NOSE + 0.32, 0.06, 0.06);
      continue;
    }
    g.strokeStyle = '#f2c81f';
    g.lineWidth = 0.07;
    strokeP(g, [{ x: sx - 2.5, y: LY.LANE }, { x: sx, y: LY.LANE }, { x: sx, y: LY.STAND_NOSE + 0.2 }], 1.1);
    g.fillStyle = '#f2c81f';
    g.fillRect(sx - 0.35, LY.STAND_NOSE + 0.12, 0.7, 0.08);
    g.strokeStyle = 'rgba(210,40,40,0.8)';
    g.lineWidth = 0.05;
    g.strokeRect(sx - 2.05, LY.STAND_NOSE - 0.2, 4.1, 4.4);
    g.save();
    g.translate(sx + 0.9, LY.LANE - 1.4);
    g.scale(0.027, 0.027);
    g.fillStyle = 'rgba(20,20,20,0.85)';
    g.fillRect(-14, -12, 28, 24);
    g.fillStyle = '#f2c81f';
    g.font = '700 18px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(s.id), 0, 1);
    g.restore();
  }
  // Vorplatz der Tankstelle, Weg vom Parkplatz zum Vereinsheim
  g.fillStyle = P.concrete;
  g.fillRect(39.7, 15.35, 1.6, 0.8);
  g.fillStyle = P.gravel;
  g.fillRect(46.6, 12.5, 0.5, 0.9);
}
