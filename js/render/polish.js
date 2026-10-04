// Visueller Feinschliff: Reifenrauch und Reifenspuren beim Aufsetzen, Gischt auf nasser Piste, Wolken über den
// Wolkenschatten, Kondensfahnen an den Flügelspitzen bei feuchter Luft (Endanflug, Abheben, Durchstarten)
import { PH } from '../sim/aircraft.js';
import { AC_TYPES } from '../config.js';
import { clamp, hourOf } from '../util.js';
import { Q } from './quality.js';

const TRAIL_S = 0.8; // Sekunden, die eine Kondensfahne sichtbar bleibt
const MARKS = 70; // so viele Reifenspuren bleiben auf der Bahn (ältere verschwinden)
// Aufsetzpunkt streut je Landung ein Stück (in Kacheln hinter dem Aufsetzpunkt der Simulation)
const tdJitter = (id) => {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 1000) / 1000;
};

export class Polish {
  constructor() {
    this.prev = new Map(); // Phase je Flugzeug
    this.parts = [];
    this.trails = new Map(); // Flugzeug -> Wirbelschleppen-Punkte (linke/rechte Flügelspitze)
    this.td = new Map(); // Flugzeug -> Aufsetzen, das gleich Rauch und Spur erzeugt (Startpunkt, Härte)
    this.marks = []; // Reifenspuren: Start, Kurs, Länge, Spurweite, Drehgestelle, Zeitpunkt
    this.t = 0;
  }

  // Ereignisse erkennen und Partikel erzeugen
  update(r, state, dt) {
    this.t += dt;
    const kind = state.weather.kind;
    const humid = Q.agents > 0.3 && (kind === 'rain' || kind === 'storm' || kind === 'fog' || kind === 'snow' || (kind === 'clouds' && hourOf(state.time) < 10));
    const wet = state.weather.kind === 'rain' || state.weather.kind === 'storm' || state.weather.kind === 'snow';
    const seen = new Set();
    for (const ac of state.acs) {
      if (ac.mode !== 'map') continue;
      seen.add(ac.id);
      const p = this.prev.get(ac.id);
      const big = { S: 0.7, M: 1, L: 1.5 }[AC_TYPES[ac.type].size] || 1;
      const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx;
      // Aufsetzen: Die Hauptfahrwerksreifen stehen still und werden beim Aufsetzen schlagartig auf Tempo gebracht –
      // dabei qualmt es weiß-bläulich, und auf der Bahn bleiben dunkle Gummistreifen. Wo genau aufgesetzt wird, streut je
      // Landung um bis zu 1,6 Kacheln (≈ 30 m), damit sich die Spuren in der Aufsetzzone wie in echt überlagern.
      if (p === PH.FINAL && ac.phase === PH.ROLLOUT) {
        const hard = ac.tdFpm ? Math.max(0.35, Math.min(2.2, ac.tdFpm / 260)) : 1;
        this.td.set(ac.id, { x0: ac.x, y0: ac.y, at: tdJitter(ac.id) * 1.6, hard });
      }
      const td = this.td.get(ac.id);
      if (td && Math.hypot(ac.x - td.x0, ac.y - td.y0) >= td.at) {
        this.td.delete(ac.id);
        const { hard } = td;
        const gauge = 0.12 * big, gx = ac.x - fx * ac.len * 0.05, gy = ac.y - fy * ac.len * 0.05;
        const len = (0.9 + 0.5 * Math.min(1.6, hard)) * (0.8 + 0.25 * big);
        this.marks.push({ x: gx, y: gy, fx, fy, len, gauge, bogie: big >= 1.5 ? 2 : 1, t: this.t, k: 0.7 + 0.3 * Math.min(1, hard) });
        if (this.marks.length > MARKS) this.marks.shift();
        // Qualmwolken entlang der Spur: am Aufsetzpunkt am dichtesten, bleiben stehen und treiben mit dem Wind
        const wd = ((state.wind.dir + 180 - 90) * Math.PI) / 180, wk = 0.05 + (state.wind.spd || 8) * 0.006; // wie die Wolken
        const wx = Math.cos(wd) * wk, wy = Math.sin(wd) * wk;
        const n = Math.round((6 + 6 * hard) * Math.max(0.5, Q.agents));
        for (const side of [-1, 1]) {
          for (let k = 0; k < n; k++) {
            const u = Math.pow(Math.random(), 1.8); // meist vorn an der Spur
            const sx = gx + fx * u * len + rx * side * gauge + (Math.random() - 0.5) * 0.08;
            const sy = gy + fy * u * len + ry * side * gauge + (Math.random() - 0.5) * 0.08;
            const fw = 0.15 + Math.random() * 0.35; // vom Rad ein Stück mitgerissen
            this.parts.push({ x: sx, y: sy, z: 0.02, vx: fx * fw + wx + (Math.random() - 0.5) * 0.12, vy: fy * fw + wy + (Math.random() - 0.5) * 0.12, vz: 0.04 + Math.random() * 0.07, life: 0, dur: 2.2 + Math.random() * 1.8 * Math.min(1.4, hard), r: 0.1 * big, grow: (0.45 + 0.35 * Math.random()) * big * Math.sqrt(hard), c: Math.random() < 0.4 ? '226,232,240' : '242,244,247', a: 0.5 + 0.25 * Math.min(1, hard) });
          }
        }
      }
      // Gischt hinter den Triebwerken bei nasser Piste (Ausrollen und Startlauf)
      if (wet && (ac.phase === PH.ROLLOUT || ac.phase === PH.TAKEOFF) && ac.z < 0.3 && Math.random() < dt * 30 * Q.agents) {
        const sp = ac.phase === PH.TAKEOFF ? 1.3 : 0.9;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.parts.push({ x: ac.x - fx * ac.len * 0.3 + rx * side * 0.25 * big, y: ac.y - fy * ac.len * 0.3 + ry * side * 0.25 * big, z: 0.02, vx: -fx * sp * (0.8 + Math.random()), vy: -fy * sp * (0.8 + Math.random()), vz: 0.03, life: 0, dur: 1 + Math.random() * 0.8, r: 0.1, grow: 0.9 * big, c: state.weather.kind === 'snow' ? '250,252,255' : '215,225,235', a: 0.38 });
      }
      // Brand/Rauch: dunkle Rauchfahne vom Triebwerk, bis die Feuerwehr gelöscht hat
      if (ac.emergency && (ac.emgKind === 'engine' || ac.emgKind === 'smoke') && !ac.fireDone && Math.random() < dt * 14 * Q.agents) {
        const fa = state.fireAlert;
        const k = fa && fa.ac === ac.id ? clamp(1 - (fa.sprayed || 0) / 110, 0.1, 1) : 1;
        const side = ac.emgKind === 'engine' ? 1 : 0;
        const moving = ac.fireStop ? 0 : 1;
        this.parts.push({ x: ac.x + rx * side * 0.32 * big - fx * 0.1, y: ac.y + ry * side * 0.32 * big - fy * 0.1, z: Math.max(0.12, ac.z + 0.1), vx: -fx * moving * 0.8 + (Math.random() - 0.5) * 0.08, vy: -fy * moving * 0.8 + (Math.random() - 0.5) * 0.08, vz: 0.12 + Math.random() * 0.1, life: 0, dur: 2.2 + Math.random() * 1.5, r: 0.1 * big, grow: 0.8 * big, c: ac.emgKind === 'engine' ? '52,52,56' : '120,120,126', a: 0.55 * k });
      }
      // Kondensfahnen: Die Flügelspitzen ziehen bei feuchter Luft dünne weiße Fäden hinter sich her
      const vap = humid && ((ac.phase === PH.FINAL && ac.z > 0.12) || ((ac.phase === PH.TAKEOFF || ac.phase === PH.MISSED) && ac.z > 0.08 && ac.z < 3.5));
      if (vap) {
        let tr = this.trails.get(ac.id);
        if (!tr) this.trails.set(ac.id, (tr = []));
        const last = tr[tr.length - 1];
        if (!last || this.t - last.t > 0.05) {
          const half = ac.len * 0.47, zw = ac.z + 0.1 * big;
          tr.push({ t: this.t, ax: ac.x + rx * half, ay: ac.y + ry * half, bx: ac.x - rx * half, by: ac.y - ry * half, z: zw });
        }
      }
      this.prev.set(ac.id, ac.phase);
    }
    for (const [id, tr] of this.trails) {
      while (tr.length && this.t - tr[0].t > TRAIL_S) tr.shift();
      if (!tr.length || !seen.has(id)) this.trails.delete(id);
    }
    for (const id of this.prev.keys()) if (!seen.has(id)) this.prev.delete(id);
    for (const id of this.td.keys()) if (!seen.has(id)) this.td.delete(id);
    for (const q of this.parts) {
      q.life += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.vx *= 0.97;
      q.vy *= 0.97;
    }
    this.parts = this.parts.filter((q) => q.life < q.dur);
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
  }

  // Reifenspuren auf der Bahn (unter den Flugzeugen): frisch kräftig schwarz, nach einer Minute nur noch ein grauer
  // Gummifilm – in der Aufsetzzone sammelt sich der Abrieb wie an echten Pisten
  drawMarks(r) {
    if (!this.marks.length) return;
    const { ctx, cam } = r;
    cam.setIso(ctx, 0.012);
    ctx.lineCap = 'round';
    for (const m of this.marks) {
      const age = this.t - m.t;
      const a = m.k * (0.16 + 0.5 * Math.exp(-age / 45));
      const rx = -m.fy, ry = m.fx;
      for (const side of [-1, 1]) {
        for (let b = 0; b < m.bogie; b++) {
          const off = side * m.gauge + (m.bogie > 1 ? (b - 0.5) * 0.07 * side : 0);
          const x0 = m.x + rx * off, y0 = m.y + ry * off;
          const x1 = x0 + m.fx * m.len, y1 = y0 + m.fy * m.len;
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, `rgba(18,18,20,${(a * 0.6).toFixed(3)})`);
          g.addColorStop(0.12, `rgba(18,18,20,${a.toFixed(3)})`);
          g.addColorStop(1, 'rgba(18,18,20,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 0.07;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'butt';
  }

  drawParticles(r) {
    const { ctx, cam } = r;
    if (this.trails.size) this.drawTrails(r);
    if (!this.parts.length) return;
    cam.setScreen(ctx);
    for (const q of this.parts) {
      const u = q.life / q.dur;
      const s = cam.toScreen(q.x, q.y, q.z);
      const rad = (q.r + q.grow * u) * 32 * cam.zoom;
      const a = q.a * (1 - u) * clamp(u * 8, 0, 1);
      if (!(rad > 0.3) || !(a > 0)) continue; // Canvas wirft bei negativem Radius
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad);
      g.addColorStop(0, `rgba(${q.c},${a})`);
      g.addColorStop(1, `rgba(${q.c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(s.x - rad, s.y - rad, rad * 2, rad * 2);
    }
  }

  drawTrails(r) {
    const { ctx, cam } = r;
    cam.setScreen(ctx);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, 1.3 * cam.zoom);
    for (const tr of this.trails.values()) {
      for (let i = 1; i < tr.length; i++) {
        const p = tr[i - 1], q = tr[i];
        const a = 0.42 * (1 - (this.t - q.t) / TRAIL_S) * clamp((this.t - q.t) * 10, 0, 1);
        if (a <= 0.01) continue;
        ctx.strokeStyle = `rgba(245,248,252,${a})`;
        ctx.beginPath();
        let s0 = cam.toScreen(p.ax, p.ay, p.z), s1 = cam.toScreen(q.ax, q.ay, q.z);
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        s0 = cam.toScreen(p.bx, p.by, p.z);
        s1 = cam.toScreen(q.bx, q.by, q.z);
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  }

  // Wolkenfeld: dieselben Wolken für Schatten am Boden und Wolken in der Höhe (ziehen mit dem Wind über den Platz)
  cloudField(r, state) {
    const kind = state.weather.kind;
    const n = kind === 'clouds' ? 6 : 9;
    const t = r.time * 0.25 + state.time * 0.002;
    const wd = ((state.wind.dir + 180 - 90) * Math.PI) / 180;
    const out = [];
    for (let i = 0; i < n; i++) {
      const bx = (i * 37.7 + Math.cos(wd) * t * 3) % 120, by = (i * 23.3 + Math.sin(wd) * t * 3) % 70;
      const x = ((bx % 120) + 120) % 120 - 20, y = ((by % 70) + 70) % 70 - 14;
      out.push({ x, y, rx: 6 + (i % 3) * 2.6 + (i % 4) * 0.8, v: i % CLOUD_N, z: 6.4 + (i % 3) * 0.7 });
    }
    return out;
  }

  // weiche Schatten der Wolken auf dem Boden (Umriss der jeweiligen Wolke, flach auf das Gelände gelegt)
  drawCloudShadows(r, state) {
    const kind = state.weather.kind;
    if (kind === 'clear' || kind === 'fog') return;
    const { ctx, cam } = r;
    this.cloudSprites();
    cam.setIso(ctx, 0);
    ctx.globalAlpha = kind === 'clouds' ? 0.2 : 0.26;
    for (const c of this.cloudField(r, state)) {
      const w = c.rx * 2.3, h = w * 0.62;
      ctx.drawImage(this.clouds[c.v].shadow, c.x - w / 2, c.y - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
  }

  cloudSprites() {
    if (!this.clouds) this.clouds = Array.from({ length: CLOUD_N }, (_, i) => makeCloud(1013 + i * 7919));
    return this.clouds;
  }

  // Haufenwolken in der Höhe, über ihren Schatten (Versatz durch den Sonnenstand); bei Regen grauer, bei Gewitter dunkel
  drawClouds(r, state) {
    const kind = state.weather.kind;
    if (kind !== 'clouds' && kind !== 'rain' && kind !== 'storm' && kind !== 'snow') return;
    const { ctx, cam } = r;
    // bei starkem Zoom unsichtbar (die Kamera ist „unter“ den Wolken)
    const vis = clamp((1.15 - cam.zoom) / 0.6, 0, 1);
    if (vis <= 0.02) return;
    const spr = this.cloudSprites();
    // abgedunkelte Varianten vorberechnen (ctx.filter ist pro Bild sehr teuer)
    const dk = kind === 'storm' ? 'storm' : kind === 'rain' || kind === 'snow' ? 'rain' : 'clear';
    cam.setScreen(ctx);
    for (const c of this.cloudField(r, state)) {
      const sp = spr[c.v];
      const img = dk === 'clear' ? sp.img : (sp[dk] ||= darken(sp.img, dk === 'storm' ? 0.58 : 0.82));
      // Schatten liegt rechts unten versetzt: Wolke entsprechend links oben in der Höhe
      const s = cam.toScreen(c.x - 2.2, c.y - 1.2, c.z);
      const w = c.rx * 2.6 * 32 * cam.zoom, h = w * (sp.img.height / sp.img.width);
      if (s.x + w / 2 < 0 || s.x - w / 2 > cam.w || s.y + h / 2 < 0 || s.y - h / 2 > cam.h) continue;
      ctx.globalAlpha = vis * (kind === 'clouds' ? 0.78 : 0.85);
      ctx.drawImage(img, s.x - w / 2, s.y - h * 0.62, w, h);
    }
    ctx.globalAlpha = 1;
  }
}

const CLOUD_N = 5; // verschiedene Wolkenformen

function darken(src, f) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(28,34,46,${1 - f})`;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// Haufenwolke (Cumulus humilis/mediocris): breite, flache Basis, darüber Quellbuckel wie Blumenkohl. Licht von links
// oben: Kuppen fast weiß, Lücken und Unterseite blaugrau, Ränder weich auslaufend. Dazu ein weicher Schattenumriss.
function makeCloud(seed) {
  const W = 640, H = 360;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  let sd = seed;
  const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const base = H * 0.8;
  const lobes = [];
  const n = 8 + Math.floor(r() * 5);
  const tower = 0.6 + r() * 0.8; // wie hoch die Wolke quillt
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const hump = Math.pow(Math.sin(u * Math.PI), 1.3);
    const rad = 32 + hump * 40 + r() * 18;
    const x = W * 0.2 + u * W * 0.6 + (r() - 0.5) * 34;
    const y = Math.max(rad + 6, base - rad * 0.5 - hump * tower * (50 + r() * 50));
    lobes.push({ x, y, rad });
  }
  // Quellköpfe oben auf den Buckeln (Blumenkohl)
  for (let i = 0; i < 10; i++) {
    const L = lobes[1 + Math.floor(r() * (lobes.length - 2))];
    const rad = L.rad * (0.38 + r() * 0.3);
    lobes.push({ x: L.x + (r() - 0.5) * L.rad * 1.1, y: Math.max(rad + 6, L.y - L.rad * (0.35 + r() * 0.4)), rad });
  }
  // hinten (oben) zuerst, die unteren Buckel liegen davor
  lobes.sort((p, q) => p.y - q.y);
  // Körper: blaugrau, weich auslaufend
  for (const L of lobes) {
    const gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.rad);
    gr.addColorStop(0, 'rgba(192,203,220,1)');
    gr.addColorStop(0.72, 'rgba(190,202,219,0.85)');
    gr.addColorStop(1, 'rgba(186,199,217,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(L.x, L.y, L.rad, 0, Math.PI * 2);
    g.fill();
  }
  // je Buckel: Eigenschatten rechts unten, dann Licht von links oben – so setzt sich jeder Buckel vom dahinterliegenden ab
  for (const L of lobes) {
    const sx = L.x + L.rad * 0.18, sy = L.y + L.rad * 0.22;
    const sg = g.createRadialGradient(sx, sy, L.rad * 0.3, sx, sy, L.rad * 1.02);
    sg.addColorStop(0, 'rgba(168,182,204,0.55)');
    sg.addColorStop(0.75, 'rgba(160,176,200,0.35)');
    sg.addColorStop(1, 'rgba(160,176,200,0)');
    g.fillStyle = sg;
    g.beginPath();
    g.arc(sx, sy, L.rad * 1.02, 0, Math.PI * 2);
    g.fill();
    const lx = L.x - L.rad * 0.3, ly = L.y - L.rad * 0.36;
    const gr = g.createRadialGradient(lx, ly, 0, lx, ly, L.rad * 0.96);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(251,252,255,0.8)');
    gr.addColorStop(0.82, 'rgba(240,244,250,0.3)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(lx, ly, L.rad * 0.96, 0, Math.PI * 2);
    g.fill();
  }
  // flache Basis: unten weich abschneiden
  g.globalCompositeOperation = 'destination-out';
  const cut = g.createLinearGradient(0, base - 8, 0, base + 26);
  cut.addColorStop(0, 'rgba(0,0,0,0)');
  cut.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = cut;
  g.fillRect(0, base - 8, W, H - base + 8);
  // Unterseite im Eigenschatten, oben ein Hauch warmes Sonnenlicht
  g.globalCompositeOperation = 'source-atop';
  const sh = g.createLinearGradient(0, base - 110, 0, base + 10);
  sh.addColorStop(0, 'rgba(120,136,162,0)');
  sh.addColorStop(1, 'rgba(112,128,156,0.5)');
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H);
  const warm = g.createLinearGradient(0, 0, 0, base * 0.6);
  warm.addColorStop(0, 'rgba(255,246,228,0.22)');
  warm.addColorStop(1, 'rgba(255,246,228,0)');
  g.fillStyle = warm;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  // Schatten: Umriss dunkel, über eine kleine Zwischenstufe weichgezeichnet
  const sm = document.createElement('canvas');
  sm.width = W / 10;
  sm.height = H / 10;
  const gs = sm.getContext('2d');
  gs.drawImage(c, 0, 0, sm.width, sm.height);
  gs.globalCompositeOperation = 'source-in';
  gs.fillStyle = 'rgb(18,26,34)';
  gs.fillRect(0, 0, sm.width, sm.height);
  const shadow = document.createElement('canvas');
  shadow.width = W / 4;
  shadow.height = H / 4;
  const g2 = shadow.getContext('2d');
  g2.imageSmoothingQuality = 'high';
  g2.drawImage(sm, 2, 2, shadow.width - 4, shadow.height - 4);
  return { img: c, shadow };
}
