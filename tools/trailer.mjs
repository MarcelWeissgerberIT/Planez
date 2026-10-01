// Trailer aus echtem Spielmaterial: Szenen werden Bild für Bild mit angehaltener Uhr aufgenommen (flüssig auch auf
// langsamen Rechnern), mit Untertiteln, Titel- und Schlusskarte versehen und mit der Menümusik zu einer MP4 gemischt.
// Aufruf: node tools/trailer.mjs [en|de] [nur,diese,szenen | --from=szene | --redo=szene,szene]  (eigener Mini-Server; PLANEZ_URL nutzt einen anderen)
// Braucht Playwright + Chromium und ffmpeg (Umgebungsvariable FFMPEG oder ffmpeg im PATH).
// Ausgabe: store/trailer/planez_trailer_<sprache>.mp4 (nicht im Repository)
import fs from 'fs';
import http from 'http';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// eingebauter Mini-Server für den Spielordner (ohne PLANEZ_URL kein externer Server nötig)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary' };
async function serve() {
  if (process.env.PLANEZ_URL) return { url: process.env.PLANEZ_URL, close: () => {} };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/index.html`, close: () => srv.close() };
}
const SERVER = await serve();
const BASE = SERVER.url;
const LANG = process.argv[2] || 'en';
const ARG = process.argv[3] || '';
const FROM = ARG.startsWith('--from=') ? ARG.slice(7) : null; // Aufnahme ab dieser Szene fortsetzen, frühere Bilder bleiben
const REDO = ARG.startsWith('--redo=') ? ARG.slice(7).split(',') : null; // nur diese Szenen neu aufnehmen, Rest bleibt
const ONLY = ARG && !FROM && !REDO ? ARG.split(',') : null;
const FPS = 30;
const W = 1920, H = 1080;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const OUT = path.join(ROOT, 'store/trailer');
const FR = path.join(OUT, `frames_${LANG}`);

const TXT = {
  en: {
    tag: 'LAND. HANDLE. BUILD. GROW.',
    grass: ['Start small', 'A grass strip, a clubhouse and €40,000'],
    hub: ['Grow into a hub', 'Five expansion stages – earned, not bought'],
    land: ['Every flight simulated', 'Approach, landing, taxi, turnaround'],
    tower: ['Work the tower', 'Radar, real radio, wake separation'],
    ground: ['Run the apron', 'Stands, tugs, fuel trucks, de-icing'],
    mgmt: ['Run the business', 'Airlines, fees, fuel trading, loans'],
    storm: ['Weather the storm', 'Thunderstorms, fog and snow'],
    night: ['Day and night', 'A living airport around the clock'],
    end1: 'Free demo · Full version €29',
    end2: 'German & English · plays in your browser',
  },
  de: {
    tag: 'LANDEN. ABFERTIGEN. AUSBAUEN. WACHSEN.',
    grass: ['Fang klein an', 'Eine Graspiste, ein Vereinsheim und 40.000 €'],
    hub: ['Wachse zum Drehkreuz', 'Fünf Ausbaustufen – verdient, nicht gekauft'],
    land: ['Jeder Flug simuliert', 'Anflug, Landung, Rollen, Abfertigung'],
    tower: ['Übernimm den Tower', 'Radar, echter Funk, Wirbelschleppen-Staffelung'],
    ground: ['Führe das Vorfeld', 'Positionen, Schlepper, Tankwagen, Enteisung'],
    mgmt: ['Lenke das Geschäft', 'Airlines, Gebühren, Kerosinhandel, Kredite'],
    storm: ['Trotze dem Wetter', 'Gewitter, Nebel und Schnee'],
    night: ['Tag und Nacht', 'Ein lebendiger Flughafen rund um die Uhr'],
    end1: 'Kostenlose Demo · Vollversion 29 €',
    end2: 'Deutsch & Englisch · läuft im Browser',
  },
}[LANG];

// ---------- Spiel vorbereiten ----------
const prep = () => {
  try {
    localStorage.setItem('planez_help_seen', '1');
    for (const r of ['tower', 'ground', 'manager', 'observer']) localStorage.setItem('planez_tut_' + r, '1');
    localStorage.setItem('planez_prefs', JSON.stringify({ briefing: false, tts: false, calm: true, sound: false, music: false, gameMusic: false, ambience: false }));
  } catch (e) {}
};
async function start(page, role, kind = 'regional') {
  await page.click('[data-mm=new]');
  await page.waitForTimeout(300);
  await page.selectOption('#inp-start', kind);
  if (role === 'observer') await page.click('#mm-new [data-role-start=observer]');
  else await page.click(`.role-card[data-role=${role}]`);
  await page.waitForTimeout(1200);
  await closeModals(page);
}
// offene Fenster schließen; Erfolgs-Popups und Meldungen im Trailer ausblenden
async function closeModals(page) {
  for (let k = 0; k < 4; k++) {
    if (!(await page.evaluate(() => !document.getElementById('modal').classList.contains('hidden')))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.addStyleTag({ content: '.ach-pop, #toasts { display: none !important; }' });
}
async function sim(page, sec, { hour, weather } = {}) {
  await page.evaluate(
    async ([sec, hour, weather]) => {
      const m = await import('./js/sim/sim.js');
      const s = window.planez.state;
      s.auto = { atc: true, ground: true, manager: true };
      for (let i = 0; i < sec; i++) m.step(s, 1);
      if (hour != null) {
        const target = Math.floor(s.time / 86400) * 86400 + hour * 3600;
        while (s.time < target) m.step(s, 1);
      }
      if (weather) s.weather.kind = weather;
    },
    [sec, hour ?? null, weather ?? null],
  );
  await page.waitForTimeout(800);
  await closeModals(page);
}
const photo = (page) => page.evaluate(() => document.getElementById('game').classList.add('photo'));
// 3D-Kino öffnen (die Szene selbst wird erst bei angehaltener Uhr gewählt, siehe forceShot)
async function cine(page) {
  await page.click('#t-tower3d');
  await page.waitForTimeout(2000);
  await page.click('#ride [data-rd=cine]');
  await page.waitForTimeout(2500);
}
// bei angehaltener Uhr die Simulation vorspulen, bis eine passende Szene beginnt (Landung: gerade im Endanflug)
const forceShot = (page, want) =>
  page.evaluate(async (want) => {
    const m = await import('./js/sim/sim.js');
    const s = window.planez.state, r = window.planez.ride;
    for (let k = 0; k < 6000; k++) {
      const c = r.cineShots(s).filter((x) => x.kind === want);
      if (c.length) {
        r.recent = [];
        r.shot = r.pickShot.call(Object.assign(Object.create(Object.getPrototypeOf(r)), r, { cineShots: () => [c[0]], recent: [] }), s);
        return true;
      }
      m.step(s, 0.5);
    }
    return false;
  }, want);

// ---------- Szenen ----------
// dur in s, speed = Spieltempo, cam = Kamerafahrt (Zoomfaktor Anfang/Ende, Verschiebung in Kacheln)
const CLIPS = [
  { id: 'title', dur: 3.6, card: 'title' },
  { id: 'grass', dur: 5, cap: TXT.grass, speed: 2, cam: { z: [1, 1.18] }, setup: async (p) => { await start(p, 'manager', 'grass'); await sim(p, 3 * 86400, { hour: 10.6, weather: 'clear' }); await photo(p); await p.evaluate(() => Object.assign(window.planez.cam, { x: 44, y: 16.5, zoom: 1.15, tx: null })); } },
  { id: 'hub', dur: 5, cap: TXT.hub, speed: 2, cam: { z: [0.78, 0.62] }, setup: async (p) => { await start(p, 'observer'); await sim(p, 2 * 3600, { hour: 8.2, weather: 'clear' }); await photo(p); } },
  { id: 'land', dur: 5, cap: TXT.land, speed: 1, setup: async (p) => { await start(p, 'observer'); await sim(p, 3 * 3600, { hour: 17.3, weather: 'clouds' }); await cine(p); }, after: (p) => forceShot(p, 'land') },
  { id: 'tower', dur: 5, cap: TXT.tower, speed: 2, setup: async (p) => { await start(p, 'tower'); await sim(p, 3 * 3600, { hour: 9.1 }); } },
  { id: 'ground', dur: 5, cap: TXT.ground, speed: 2, setup: async (p) => { await start(p, 'ground'); await sim(p, 3 * 3600, { hour: 8.4 }); } },
  { id: 'mgmt', dur: 4.5, cap: TXT.mgmt, speed: 1, setup: async (p) => { await start(p, 'manager'); await sim(p, 2 * 86400, { hour: 13 }); await p.keyboard.press('o'); await p.waitForTimeout(900); } },
  { id: 'storm', dur: 4, cap: TXT.storm, speed: 2, cam: { z: [0.85, 0.95] }, setup: async (p) => { await start(p, 'observer'); await sim(p, 3 * 3600, { hour: 15.5, weather: 'storm' }); await photo(p); } },
  { id: 'night', dur: 4, cap: TXT.night, speed: 2, cam: { z: [0.9, 0.8] }, setup: async (p) => { await start(p, 'observer'); await sim(p, 3 * 3600, { hour: 22.2, weather: 'clear' }); await photo(p); } },
  { id: 'takeoff', dur: 4.5, speed: 1, setup: async (p) => { await start(p, 'observer'); await sim(p, 3 * 3600, { hour: 18.4, weather: 'clear' }); await cine(p); }, after: (p) => forceShot(p, 'takeoff') },
  { id: 'end', dur: 4.8, card: 'end' },
];

// ---------- Overlay (Untertitel, Karten, Blende) ----------
const OVERLAY = ({ tag, end1, end2 }) => {
  const css = `
  #tr{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:'Chakra Petch',sans-serif}
  #tr .cap{position:absolute;left:0;bottom:84px;padding:26px 60px 28px 96px;background:linear-gradient(90deg,rgba(4,10,24,.82),rgba(4,10,24,.55) 70%,rgba(4,10,24,0));opacity:0}
  #tr .cap i{display:block;width:110px;height:4px;background:#f5a623;margin-bottom:16px}
  #tr .cap b{display:block;font-family:'Orbitron';font-weight:900;font-size:56px;letter-spacing:.05em;color:#fff;text-shadow:0 4px 22px rgba(0,0,0,.8)}
  #tr .cap small{display:block;font-size:26px;color:#38d6f5;letter-spacing:.12em;font-weight:700;margin-top:10px}
  #tr .card{position:absolute;inset:0;opacity:0;overflow:hidden;background:#05080f}
  #tr .card .bg{position:absolute;inset:0;background:url(store/art/key_wide.jpg) center/cover;transform-origin:60% 40%}
  #tr .card .sh{position:absolute;inset:0;background:linear-gradient(100deg,rgba(4,10,24,.82) 0%,rgba(4,10,24,.4) 40%,rgba(4,10,24,0) 62%)}
  #tr .card .lg{position:absolute;left:110px;top:150px}
  #tr .t1{font-family:'Orbitron';font-weight:900;font-size:150px;line-height:.95;letter-spacing:.08em;background:linear-gradient(180deg,#fff 0%,#cfd8e3 45%,#8e9aab 58%,#eef2f7 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 26px rgba(0,0,0,.7))}
  #tr .t2{font-family:'Orbitron';font-weight:900;font-size:128px;line-height:.95;letter-spacing:.08em;color:#38d6f5;margin-top:.08em;text-shadow:0 0 36px rgba(56,214,245,.6),0 0 90px rgba(56,214,245,.3)}
  #tr .tg{font-weight:700;color:#f5a623;font-size:26px;letter-spacing:.3em;margin-top:40px;text-shadow:0 2px 8px rgba(0,0,0,.85)}
  #tr .e1{font-weight:700;color:#fff;font-size:44px;margin-top:46px;letter-spacing:.04em;text-shadow:0 2px 12px rgba(0,0,0,.9)}
  #tr .e2{font-weight:600;color:#cfe8f5;font-size:28px;margin-top:12px;letter-spacing:.05em;text-shadow:0 2px 10px rgba(0,0,0,.9)}
  #tr .fade{position:absolute;inset:0;background:#000;opacity:0}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'tr';
  el.innerHTML = `<div class="card"><div class="bg"></div><div class="sh"></div><div class="lg"><div class="t1">PLANEZ</div><div class="t2">AIRPORT</div><div class="tg">${tag}</div><div class="e1"></div><div class="e2"></div></div></div><div class="cap"><i></i><b></b><small></small></div><div class="fade"></div>`;
  document.body.appendChild(el);
  window.__tr = ({ cap, capA, capY, card, cardA, cardS, fade }) => {
    const c = el.querySelector('.cap');
    if (cap) {
      c.querySelector('b').textContent = cap[0];
      c.querySelector('small').textContent = cap[1];
    }
    c.style.opacity = capA;
    c.style.transform = `translateX(${capY}px)`;
    const k = el.querySelector('.card');
    k.style.opacity = cardA;
    k.querySelector('.bg').style.transform = `scale(${cardS})`;
    k.querySelector('.tg').style.display = card === 'title' ? '' : 'none';
    k.querySelector('.e1').textContent = card === 'end' ? end1 : '';
    k.querySelector('.e2').textContent = card === 'end' ? end2 : '';
    el.querySelector('.fade').style.opacity = fade;
  };
};

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
// Bildnummer, mit der eine Szene beginnt (jede Szene hat feste Länge)
const startOf = (id) => CLIPS.slice(0, CLIPS.findIndex((c) => c.id === id)).reduce((a, c) => a + Math.round(c.dur * FPS), 0);
if (!FROM && !REDO) fs.rmSync(FR, { recursive: true, force: true });
fs.mkdirSync(FR, { recursive: true });
if (FROM) for (const f of fs.readdirSync(FR)) if (+f.slice(0, 5) >= startOf(FROM)) fs.rmSync(path.join(FR, f));
const TOTAL = CLIPS.reduce((a, c) => a + Math.round(c.dur * FPS), 0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let frame = FROM ? startOf(FROM) : 0;
const t0 = Date.now();
for (const clip of CLIPS) {
  if (ONLY && !ONLY.includes(clip.id)) continue;
  if (FROM && CLIPS.indexOf(clip) < CLIPS.findIndex((c) => c.id === FROM)) continue;
  if (REDO) {
    if (!REDO.includes(clip.id)) continue;
    frame = startOf(clip.id);
  }
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(prep);
  await page.goto(`${BASE}?lang=${LANG}`);
  await page.waitForSelector('#menu:not(.hidden)');
  if (clip.setup) await clip.setup(page);
  await page.evaluate(OVERLAY, { tag: TXT.tag, end1: TXT.end1, end2: TXT.end2 });
  await page.evaluate((speed) => {
    if (window.planez && window.planez.state) window.planez.state.speed = speed;
    const c = window.planez && window.planez.cam;
    if (c) window.__c0 = { x: c.x, y: c.y, zoom: c.zoom };
  }, clip.speed || 1);
  await page.waitForTimeout(300);
  await page.clock.install();
  if (clip.after && !(await clip.after(page))) console.log(`${clip.id}: keine passende Szene gefunden`);
  await page.clock.runFor(500);
  const n = Math.round(clip.dur * FPS);
  for (let f = 0; f < n; f++) {
    const t = f / (n - 1), sec = f / FPS;
    const fadeIn = clip.card === 'title' ? 1 - ease(sec / 0.8) : 1 - ease(sec / 0.25);
    const fadeOut = clip.id === 'end' ? ease((sec - (clip.dur - 1.2)) / 1.0) : ease((sec - (clip.dur - 0.25)) / 0.25);
    const capA = clip.cap ? ease((sec - 0.35) / 0.4) * (1 - ease((sec - (clip.dur - 0.7)) / 0.4)) : 0;
    await page.evaluate(
      ([o, cam, t]) => {
        window.__tr(o);
        const c = window.planez && window.planez.cam, c0 = window.__c0;
        if (cam && c && c0) {
          c.tx = null;
          c.zoom = c0.zoom * (cam.z[0] + (cam.z[1] - cam.z[0]) * t);
          c.x = c0.x + (cam.dx || 0) * t;
          c.y = c0.y + (cam.dy || 0) * t;
        }
      },
      [{ cap: clip.cap, capA, capY: (1 - ease((sec - 0.35) / 0.5)) * -40, card: clip.card, cardA: clip.card ? 1 : 0, cardS: 1 + 0.06 * t, fade: Math.max(fadeIn, fadeOut) }, clip.cam || null, ease(t)],
    );
    await page.clock.runFor(1000 / FPS);
    await page.screenshot({ path: path.join(FR, String(frame++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 });
  }
  console.log(`${clip.id.padEnd(8)} ${n} frames  ${errors.length ? 'ERR ' + errors[0] : 'ok'}  (${Math.round((Date.now() - t0) / 1000)} s)`);
  await page.close();
}
await browser.close();
SERVER.close();

// ---------- Video + Musik ----------
const total = (REDO ? TOTAL : frame) / FPS;
const out = path.join(OUT, `planez_trailer_${LANG}${ONLY ? '_part' : ''}.mp4`);
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FR, '%05d.jpg'), '-i', path.join(ROOT, 'assets/music/menu.mp3'), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-af', `afade=t=in:d=0.8,afade=t=out:st=${(total - 2.5).toFixed(2)}:d=2.5`, '-t', total.toFixed(2), '-movflags', '+faststart', out]);
console.log('trailer', path.relative(ROOT, out), total.toFixed(1), 's');
