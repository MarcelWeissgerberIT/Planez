// Streckennetz: polare Karte um den eigenen Flughafen (Peilung wie im Spiel, Entfernung logarithmisch),
// Routen je Vertrag in Airline-Farbe, fliegende Punkte, Angebote gestrichelt, Tooltip je Ziel
import { CITIES, AIRLINES, AC_TYPES } from '../config.js';
import { esc } from '../util.js';
import { T, LOCALE, EN } from '../i18n.js';

// ungefähre Koordinaten der Ziele (Grad) – der eigene Flughafen liegt in Mitteldeutschland
const HOME = [50.5, 9.0];
const LL = {
  PMI: [39.55, 2.73], AYT: [36.9, 30.8], LHR: [51.47, -0.45], CDG: [49.01, 2.55], MAD: [40.47, -3.56], FCO: [41.8, 12.25], VIE: [48.11, 16.57], ZRH: [47.46, 8.55],
  CPH: [55.62, 12.65], ARN: [59.65, 17.92], OSL: [60.19, 11.1], AMS: [52.31, 4.76], BCN: [41.3, 2.08], LIS: [38.77, -9.13], ATH: [37.94, 23.94], IST: [41.26, 28.74],
  DXB: [25.25, 55.36], JFK: [40.64, -73.78], SIN: [1.36, 103.99], HND: [35.55, 139.78], ORD: [41.98, -87.9], DOH: [25.27, 51.61], WAW: [52.17, 20.97], PRG: [50.1, 14.26],
  BUD: [47.44, 19.26], HER: [35.34, 25.18], TFS: [28.04, -16.57], HRG: [27.18, 33.8], RIX: [56.92, 23.97], HEL: [60.32, 24.96], DUB: [53.42, -6.27], NCE: [43.66, 7.21],
  OLB: [40.9, 9.52], LEJ: [51.42, 12.24], HKG: [22.31, 113.92], PVG: [31.14, 121.81], YYZ: [43.68, -79.63], GVA: [46.24, 6.11],
};
const rad = (d) => (d * Math.PI) / 180;
export function distKm(code) {
  const b = LL[code];
  if (!b) return 1000;
  const [la1, lo1] = HOME.map(rad), [la2, lo2] = b.map(rad);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const DMAX = 11000;
const rOf = (d, R) => (R * Math.log(1 + d / 90)) / Math.log(1 + DMAX / 90);
const RINGS = [500, 1000, 2000, 5000, 10000];

export class RouteMap {
  constructor(game) {
    this.game = game;
    const el = document.createElement('div');
    el.className = 'route-map';
    el.innerHTML = `<canvas></canvas><div class="rm-legend"></div><div class="rm-tip hidden"></div>`;
    this.el = el;
    this.cv = el.querySelector('canvas');
    this.tip = el.querySelector('.rm-tip');
    this.legend = el.querySelector('.rm-legend');
    this.hover = null;
    this.pts = [];
    this.cv.addEventListener('pointermove', (e) => {
      const r = this.cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 16;
      for (const p of this.pts) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      this.hover = best ? best.code : null;
      this.showTip(best, x, y);
    });
    this.cv.addEventListener('pointerleave', () => {
      this.hover = null;
      this.tip.classList.add('hidden');
    });
    this.loop = this.loop.bind(this);
  }

  // in einen Platzhalter einhängen (der Bereich wird regelmäßig neu aufgebaut, die Karte bleibt erhalten)
  attach(slot) {
    if (!slot) return;
    if (this.el.parentNode !== slot) slot.appendChild(this.el);
    if (!this.running) {
      this.running = true;
      this.t0 = performance.now();
      requestAnimationFrame(this.loop);
    }
  }

  loop(ts) {
    if (!this.el.isConnected || !this.game.state) {
      this.running = false;
      return;
    }
    this.draw(ts / 1000);
    requestAnimationFrame(this.loop);
  }

  routes(s) {
    const by = new Map();
    const add = (c, offer) => {
      const k = c.city;
      if (!by.has(k)) by.set(k, { code: k, list: [], offers: [], perDay: 0 });
      const e = by.get(k);
      if (offer) e.offers.push(c);
      else {
        e.list.push(c);
        e.perDay += c.perDay;
      }
    };
    for (const c of s.contracts) add(c, false);
    for (const o of s.offers) add(o, true);
    return [...by.values()];
  }

  draw(t) {
    const s = this.game.state;
    const cv = this.cv;
    const W = this.el.clientWidth || 600, H = Math.round(Math.max(240, Math.min(520, W * 0.42, window.innerHeight * 0.42)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.height = H + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 6, R = Math.min(W * 0.46, H * 0.46);
    // Hintergrund
    const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
    bg.addColorStop(0, 'rgba(22,48,70,0.9)');
    bg.addColorStop(1, 'rgba(6,14,24,0.95)');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // Ringe und Speichen
    g.strokeStyle = 'rgba(56,214,245,0.14)';
    g.fillStyle = 'rgba(148,197,220,0.55)';
    g.font = '10px JetBrains Mono, monospace';
    g.lineWidth = 1;
    for (const d of RINGS) {
      const r = rOf(d, R);
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      g.fillText(`${d.toLocaleString(LOCALE)} km`, cx + 4, cy - r - 3);
    }
    for (let b = 0; b < 360; b += 30) {
      const a = rad(b);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.sin(a) * R * 1.02, cy - Math.cos(a) * R * 1.02);
      g.stroke();
    }
    g.fillStyle = 'rgba(56,214,245,0.7)';
    g.font = 'bold 11px Chakra Petch, sans-serif';
    for (const [b, l] of [[0, 'N'], [90, EN ? 'E' : 'O'], [180, 'S'], [270, 'W']]) g.fillText(l, cx + Math.sin(rad(b)) * (R + 10) - 4, cy - Math.cos(rad(b)) * (R + 10) + 4);
    // Ziele
    const routes = this.routes(s);
    const served = new Set(routes.filter((r) => r.list.length).map((r) => r.code));
    const pos = (code) => {
      const c = CITIES[code];
      const r = rOf(distKm(code), R);
      const a = rad(c.brg);
      return { x: cx + Math.sin(a) * r, y: cy - Math.cos(a) * r };
    };
    this.pts = [];
    const boxes = [];
    const placeLabel = (label, p, force) => {
      const w = g.measureText(label).width + 4, h = 12;
      const right = p.x >= cx;
      const cands = [[right ? 7 : -7 - w, 4], [right ? 7 : -7 - w, -8], [right ? 7 : -7 - w, 15], [-w / 2, -9], [-w / 2, 18]];
      for (const [ox, oy] of cands) {
        const b = { x: p.x + ox, y: p.y + oy - 10, w, h };
        if (force || !boxes.some((q) => b.x < q.x + q.w && b.x + b.w > q.x && b.y < q.y + q.h && b.y + b.h > q.y)) {
          boxes.push(b);
          g.fillText(label, p.x + ox, p.y + oy);
          return;
        }
      }
    };
    // nicht angeflogene Ziele schwach
    for (const code of Object.keys(CITIES)) {
      if (served.has(code)) continue;
      const p = pos(code);
      this.pts.push({ code, ...p });
      g.fillStyle = this.hover === code ? 'rgba(226,232,240,0.9)' : 'rgba(148,163,184,0.35)';
      g.beginPath();
      g.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    // Routen
    const labels = [];
    for (const rt of routes) {
      const p = pos(rt.code);
      const hov = this.hover === rt.code;
      // leicht gekrümmte Bahn
      const mx = (cx + p.x) / 2, my = (cy + p.y) / 2;
      const dx = p.x - cx, dy = p.y - cy;
      const qx = mx - dy * 0.12, qy = my + dx * 0.12;
      if (rt.offers.length && !rt.list.length) {
        g.setLineDash([4, 4]);
        g.strokeStyle = `rgba(251,191,36,${0.55 + 0.35 * Math.sin(t * 3)})`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(cx, cy);
        g.quadraticCurveTo(qx, qy, p.x, p.y);
        g.stroke();
        g.setLineDash([]);
      }
      rt.list.forEach((c, i) => {
        const col = (AIRLINES[c.airline] || AIRLINES.AUR).color;
        const off = (i - (rt.list.length - 1) / 2) * 0.05;
        const qx2 = qx - dy * off, qy2 = qy + dx * off;
        g.strokeStyle = col;
        g.globalAlpha = hov ? 0.95 : 0.55;
        g.lineWidth = 0.8 + c.perDay * 0.7 + (hov ? 1 : 0);
        g.beginPath();
        g.moveTo(cx, cy);
        g.quadraticCurveTo(qx2, qy2, p.x, p.y);
        g.stroke();
        g.globalAlpha = 1;
        // fliegende Punkte (hin und zurück), Anzahl nach Frequenz
        const n = Math.min(3, c.perDay);
        const spd = 0.05 + 12 / (distKm(rt.code) + 400) * 0.6;
        for (let k = 0; k < n; k++) {
          const ph = (t * spd + k / n + i * 0.17) % 2;
          const u = ph < 1 ? ph : 2 - ph;
          const q = (1 - u) * (1 - u), w = 2 * (1 - u) * u, v = u * u;
          const x = q * cx + w * qx2 + v * p.x, y = q * cy + w * qy2 + v * p.y;
          g.fillStyle = '#fff';
          g.shadowColor = col;
          g.shadowBlur = 6;
          g.beginPath();
          g.arc(x, y, 1.9, 0, Math.PI * 2);
          g.fill();
          g.shadowBlur = 0;
        }
      });
      // Zielpunkt
      this.pts.push({ code: rt.code, ...p });
      const sz = 3 + Math.min(5, rt.perDay * 0.9);
      g.fillStyle = rt.list.length ? '#e2e8f0' : '#fbbf24';
      g.beginPath();
      g.arc(p.x, p.y, sz, 0, Math.PI * 2);
      g.fill();
      if (rt.list.length) {
        g.strokeStyle = 'rgba(56,214,245,0.6)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(p.x, p.y, sz + 2 + Math.sin(t * 2 + p.x) * 0.8, 0, Math.PI * 2);
        g.stroke();
      }
      const label = CITIES[rt.code].name + (rt.list.length ? '' : T(' · neu?'));
      labels.push({ label, p, hov, served: rt.list.length > 0, w: rt.perDay });
    }
    // Beschriftungen: wichtige zuerst, überlappende weglassen (beim Überfahren immer)
    labels.sort((a, b) => b.hov - a.hov || b.w - a.w);
    boxes.push({ x: cx - 8, y: cy - 8, w: 40, h: 26 });
    for (const L of labels) {
      g.font = `${L.hov ? 'bold ' : ''}11px Inter, sans-serif`;
      g.fillStyle = L.served ? 'rgba(241,245,249,0.92)' : 'rgba(251,191,36,0.95)';
      placeLabel(L.label, L.p, L.hov);
    }
    if (this.hover && !labels.some((L) => L.hov)) {
      const p = this.pts.find((q) => q.code === this.hover);
      g.font = 'bold 11px Inter, sans-serif';
      g.fillStyle = 'rgba(226,232,240,0.9)';
      if (p) placeLabel(CITIES[this.hover].name, p, true);
    }
    // eigener Flughafen
    const pulse = (t * 0.6) % 1;
    g.strokeStyle = `rgba(56,214,245,${0.7 * (1 - pulse)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 5 + pulse * 18, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#38d6f5';
    g.beginPath();
    g.arc(cx, cy, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 11px Chakra Petch, sans-serif';
    g.fillText('PLZ', cx + 8, cy + 14);
    // Legende
    const flights = s.contracts.reduce((a, c) => a + c.perDay, 0);
    const als = new Set(s.contracts.map((c) => c.airline));
    const far = s.contracts.filter((c) => CITIES[c.city].cat === 'long').length;
    const html = T`<b>${served.size}</b> Ziele · <b>${flights}</b> Umläufe/Tag · <b>${als.size}</b> Airlines · <b>${far}</b> Langstrecke${s.offers.length ? (s.offers.length > 1 ? T` · <span class="rm-new">${s.offers.length} Angebote</span>` : T` · <span class="rm-new">${s.offers.length} Angebot</span>`) : ''}`;
    if (this.legend._h !== html) {
      this.legend.innerHTML = html;
      this.legend._h = html;
    }
  }

  showTip(p, x, y) {
    if (!p) return this.tip.classList.add('hidden');
    const s = this.game.state;
    const c = CITIES[p.code];
    const list = s.contracts.filter((k) => k.city === p.code);
    const offers = s.offers.filter((k) => k.city === p.code);
    const rows = list.map((k) => T`<div><i style="background:${AIRLINES[k.airline].color}"></i>${esc(AIRLINES[k.airline].name)} · ${k.perDay}× täglich · ${esc(AC_TYPES[k.type].name)} · ${Math.round(k.sat)} %</div>`).join('');
    const orows = offers.map((k) => T`<div class="o"><i style="background:${AIRLINES[k.airline].color}"></i>Angebot: ${esc(AIRLINES[k.airline].name)} · ${k.perDay}× täglich</div>`).join('');
    this.tip.innerHTML = `<b>${esc(c.name)}</b> <small>${p.code} · ${Math.round(distKm(p.code)).toLocaleString(LOCALE)} km · ${{ short: T('Kurzstrecke'), mid: T('Mittelstrecke'), long: T('Langstrecke') }[c.cat]}</small>${rows || orows ? rows + orows : T('<div class="n">noch keine Verbindung</div>')}`;
    this.tip.classList.remove('hidden');
    const W = this.el.clientWidth;
    this.tip.style.left = `${Math.min(W - 250, x + 14)}px`;
    this.tip.style.top = `${y + 12}px`;
  }
}
