// Bodencrew an der Parkposition: An Außenpositionen steht ein Einwinker mit orangen Leuchtkellen vor dem Stand,
// winkt das einrollende Flugzeug heran und kreuzt die Kellen über dem Kopf, sobald es steht. An Brückenpositionen
// übernimmt das eine Andockanzeige (VDGS) an der Terminalfassade: Typ, Restabstand in Metern, „STOP“, dann „OK“. Während der Abfertigung markieren Pylonen
// Flügelspitzen und Heck; vor dem Pushback räumt die Crew sie wieder weg. Nur Darstellung.
import { IMG } from '../assets.js';
import { AC_TYPES, ZS } from '../config.js';
import { PH } from '../sim/aircraft.js';
import * as LY from '../layout.js';
import { drawPerson, gaPlane } from './ambient.js';

const STOP_S = 4; // Sekunden „Halt“-Zeichen nach dem Anhalten
const CONE_S = 3; // Pylonen erscheinen kurz nach dem Anhalten

export class StandCrew {
  constructor() {
    this.arr = new Map(); // Flugzeug -> Zeitpunkt (Darstellungszeit), seit dem es an der Position steht
    this.wave = new Map(); // Flugzeug -> Beginn des Abschiedswinkens
    this.pin = new Map(); // Flugzeug -> Standort des Mitarbeiters mit dem Bolzen
  }

  items(r, state, items, lights, night, visible) {
    const now = r.time;
    const seen = new Set();
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      if (gaPlane(state, ac)) continue; // Grasplatz: Piloten machen das selbst (render/galife.js)
      // Pushback: Wing Walker läuft an der Flügelspitze mit; Triebwerksstart: Mitarbeiter zeigt den Bugrad-Bolzen
      // mit roter Fahne, beim Losrollen winkt er zum Abschied
      if (ac.phase === PH.PUSH || ac.phase === PH.STARTUP || (ac.phase === PH.TAXI_OUT && (this.wave.get(ac.id) ?? now) > now - 6)) {
        const L = ac.len;
        const img = IMG[AC_TYPES[ac.type].sprite];
        const span = img ? (L * img.width) / img.height : L;
        const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
        if (ac.phase === PH.PUSH) {
          const wx = ac.x + rx * (span * 0.5 + 0.15) - fx * L * 0.05, wy = ac.y + ry * (span * 0.5 + 0.15) - fy * L * 0.05;
          if (visible(wx, wy)) items.push({ d: wx + wy, p: [wx, wy], f: () => drawPerson(r, wx, wy, '#facc15', 1, false, now * 2, true, true) });
        } else {
          if (ac.phase === PH.TAXI_OUT && !this.wave.has(ac.id)) this.wave.set(ac.id, now);
          if (ac.phase !== PH.TAXI_OUT) this.wave.delete(ac.id);
          // fester Standort links vor der Nase (beim Losrollen bleibt er stehen)
          let P = this.pin.get(ac.id);
          if (ac.phase === PH.STARTUP) {
            const side = span * 0.5 + 0.35; // außerhalb der Flügelspitze, damit die Tragfläche nicht über ihn streicht
            P = { x: ac.x + fx * (L * 0.5 + 0.6) - rx * side, y: ac.y + fy * (L * 0.5 + 0.6) - ry * side };
            this.pin.set(ac.id, P);
          }
          if (!P) continue; // erst beim Triebwerksstart gesehen (z. B. nach dem Laden): niemand da
          const waving = ac.phase === PH.TAXI_OUT;
          if (visible(P.x, P.y)) items.push({ d: P.x + P.y, p: [P.x, P.y], f: () => this.pinMan(r, P.x, P.y, waving, now) });
        }
        continue;
      }
      if (ac.stand == null) continue;
      const st = state.stands.find((s) => s.id === ac.stand);
      if (!st || st.ga) continue; // Wiesenplatz: kein Einwinker, kein Andockleitsystem
      const mx = st.x, my = LY.STAND_NOSE - 0.55;
      const vdgs = st.kind === 'contact';
      const T = LY.TERMINAL;
      const dock = (text, col, bar) => items.push({ d: st.x + T.y1 + 0.3, f: () => this.vdgs(r, st.x, T.y1 + 0.03, text, col, bar, lights) });
      if (ac.phase === PH.TAXI_IN) {
        // erst auf dem letzten Stück in die Position hinein
        if (Math.abs(ac.x - st.x) > 0.4 || ac.y > LY.LANE - 0.3 || !visible(mx, my)) continue;
        if (vdgs) {
          const m = Math.max(0, Math.round((ac.y - ac.len / 2 - LY.STAND_NOSE) * 20));
          dock(m > 15 ? AC_TYPES[ac.type].id : `${m} m`, m > 15 ? '#fde047' : '#fde047', Math.min(1, m / 15));
        } else items.push({ d: mx + my, f: () => this.marshal(r, mx, my, 'come', now, lights, night) });
        continue;
      }
      if (ac.phase !== PH.STAND) continue;
      seen.add(ac.id);
      if (!this.arr.has(ac.id)) this.arr.set(ac.id, now);
      const since = now - this.arr.get(ac.id);
      if (vdgs) {
        if (since < STOP_S) dock('STOP', '#ef4444', 0);
        else if (since < STOP_S + 3) dock('OK', '#22c55e', 0);
      } else if (since < STOP_S && visible(mx, my)) items.push({ d: mx + my, f: () => this.marshal(r, mx, my, 'stop', now, lights, night) });
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
    if (this.pin.size > 40) this.pin.clear();
    if (this.wave.size > 40) this.wave.clear();
  }

  // Mitarbeiter mit Bugrad-Bolzen: hält die rote Fahne hoch (Pilot sieht: Schlepper ist ab), winkt beim Losrollen
  pinMan(r, x, y, waving, t) {
    const { ctx, cam } = r;
    drawPerson(r, x, y, '#facc15', 1, false, 0, false, true, false);
    const z = cam.zoom;
    const b = cam.toScreen(x, y, 0);
    const H = 0.12 * ZS * z;
    const w = Math.max(1, 0.035 * ZS * z);
    const sx = b.x + w * 0.55, sy = b.y - H * 0.8;
    const sw = waving ? Math.sin(t * 7) * 0.5 : 0;
    const hx = sx + w * (0.4 + sw * 0.6), hy = sy - H * 0.42;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(1.2, w * 0.32);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    if (!waving) {
      // rote „Remove before flight“-Fahne am Bolzen
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(hx, hy - H * 0.05, Math.max(2, w * 0.9), Math.max(2, H * 0.3));
    }
    ctx.restore();
  }

  // Andockanzeige an der Fassade: dunkles Gehäuse mit leuchtender Schrift und Annäherungsbalken
  vdgs(r, x, y, text, col, bar, lights) {
    const { ctx, cam } = r;
    cam.setScreen(ctx);
    const p = cam.toScreen(x, y, 0.62);
    const z = cam.zoom;
    const w = 17 * z + 5, h = 10 * z + 4;
    ctx.fillStyle = '#0b0f17';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
    ctx.strokeRect(p.x - w / 2, p.y - h / 2, w, h);
    ctx.fillStyle = col;
    ctx.font = `bold ${Math.max(5, Math.round(4.3 * z + 2))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, p.x, p.y - (bar > 0 ? h * 0.12 : 0));
    if (bar > 0) {
      ctx.fillStyle = '#fde047';
      const bw = (w - 6) * bar;
      ctx.fillRect(p.x - bw / 2, p.y + h * 0.28, bw, Math.max(1, h * 0.1));
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    if (lights) lights.push({ x, y: y + 0.05, z: 0.62, c: col, s: 7, a: 0.5 });
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
