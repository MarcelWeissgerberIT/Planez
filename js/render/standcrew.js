// Bodencrew an der Parkposition: Ein Einwinker mit orangen Leuchtkellen steht vor dem Stand, winkt das einrollende
// Flugzeug heran und kreuzt die Kellen über dem Kopf, sobald es steht. Während der Abfertigung markieren Pylonen
// Flügelspitzen und Heck; vor dem Pushback räumt die Crew sie wieder weg. Nur Darstellung.
import { IMG } from '../assets.js';
import { AC_TYPES, ZS } from '../config.js';
import { PH } from '../sim/aircraft.js';
import * as LY from '../layout.js';
import { drawPerson } from './ambient.js';

const STOP_S = 4; // Sekunden „Halt“-Zeichen nach dem Anhalten
const CONE_S = 3; // Pylonen erscheinen kurz nach dem Anhalten

export class StandCrew {
  constructor() {
    this.arr = new Map(); // Flugzeug -> Zeitpunkt (Darstellungszeit), seit dem es an der Position steht
  }

  items(r, state, items, lights, night, visible) {
    const now = r.time;
    const seen = new Set();
    for (const ac of state.acs) {
      if (ac.mode !== 'map' || ac.stand == null) continue;
      const st = state.stands.find((s) => s.id === ac.stand);
      if (!st) continue;
      const mx = st.x, my = LY.STAND_NOSE - 0.55;
      if (ac.phase === PH.TAXI_IN) {
        // erst auf dem letzten Stück in die Position hinein
        if (Math.abs(ac.x - st.x) > 0.4 || ac.y > LY.LANE - 0.3 || !visible(mx, my)) continue;
        items.push({ d: mx + my, f: () => this.marshal(r, mx, my, 'come', now, lights, night) });
        continue;
      }
      if (ac.phase !== PH.STAND) continue;
      seen.add(ac.id);
      if (!this.arr.has(ac.id)) this.arr.set(ac.id, now);
      const since = now - this.arr.get(ac.id);
      if (since < STOP_S && visible(mx, my)) items.push({ d: mx + my, f: () => this.marshal(r, mx, my, 'stop', now, lights, night) });
      if (since < CONE_S) continue;
      const L = ac.len;
      const img = IMG[AC_TYPES[ac.type].sprite];
      const span = img ? (L * img.width) / img.height : L;
      const cy = LY.STAND_NOSE + L * 0.5;
      const cones = [
        [st.x - span * 0.5 - 0.12, cy + L * 0.06],
        [st.x + span * 0.5 + 0.12, cy + L * 0.06],
        [st.x, LY.STAND_NOSE + L + 0.22],
      ];
      for (const [x, y] of cones) if (visible(x, y)) items.push({ d: x + y, f: () => cone(r, x, y) });
    }
    for (const id of this.arr.keys()) if (!seen.has(id)) this.arr.delete(id);
  }

  // Einwinker: „Kommen“ (Kellen schwingen über dem Kopf zum Körper) oder „Halt“ (Kellen über dem Kopf gekreuzt)
  marshal(r, x, y, mode, t, lights, night) {
    const { ctx, cam } = r;
    drawPerson(r, x, y, '#f97316', 1, false, 0, false, true, false);
    const z = cam.zoom;
    const b = cam.toScreen(x, y, 0);
    const H = 0.12 * ZS * z;
    const w = Math.max(1, 0.035 * ZS * z);
    const len = H * 0.58; // etwas überzeichnet, damit die Kellen auch aus der Entfernung lesbar bleiben
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, w * 0.32);
    for (const side of [-1, 1]) {
      const sx = b.x + side * w * 0.55, sy = b.y - H * 0.8;
      let hx, hy, ang;
      if (mode === 'stop') {
        hx = b.x + side * w * 0.5;
        hy = b.y - H * 1.12;
        ang = -Math.PI / 2 - side * 0.75; // Kellen kreuzen sich über dem Kopf
      } else {
        const sw = Math.sin(t * 5.5) * 0.55;
        hx = sx + side * w * 0.35;
        hy = sy - H * 0.32;
        ang = -Math.PI / 2 - side * (0.15 + 0.35 + sw * 0.6); // zum Kopf hin und zurück
      }
      // Arm
      ctx.strokeStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      // Leuchtkelle
      const ex = hx + Math.cos(ang) * len, ey = hy + Math.sin(ang) * len;
      ctx.strokeStyle = night ? '#ffb070' : '#ff6a00';
      ctx.lineWidth = Math.max(1.8, w * 0.55);
      if (night) {
        ctx.shadowColor = '#ff7a1a';
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1.2, w * 0.32);
    }
    ctx.restore();
    if (night && lights) lights.push({ x, y, z: 0.2, c: '#ff7a1a', s: 9, a: 0.7 });
  }
}

function cone(r, x, y) {
  const { ctx, cam } = r;
  cam.setScreen(ctx);
  const b = cam.toScreen(x, y, 0), t = cam.toScreen(x, y, 0.1);
  const w = 2.2 * cam.zoom + 0.8;
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(b.x + w, b.y);
  ctx.lineTo(b.x - w, b.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(b.x - w * 0.5, (b.y + t.y) / 2 - 0.6, w, Math.max(1, 1.1 * cam.zoom));
}
