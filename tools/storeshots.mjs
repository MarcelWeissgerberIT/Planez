// Shop-Screenshots (1920×1080) in Deutsch und Englisch: Menü, Grasplatz, Tower, Vorfeld, Management-Zentrale, Nacht, 3D-Kino.
// Aufruf: lokalen Server starten (python3 -m http.server 8765) und dann  node tools/storeshots.mjs [de|en]
// Ausgabe: store/screenshots/<sprache>/NN_name.jpg (nicht im Repository)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PLANEZ_URL || 'http://localhost:8765/index.html';
const LANGS = process.argv[2] ? [process.argv[2]] : ['de', 'en'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const prep = () => {
  try {
    localStorage.setItem('planez_help_seen', '1');
    for (const r of ['tower', 'ground', 'manager', 'observer']) localStorage.setItem('planez_tut_' + r, '1');
    localStorage.setItem('planez_prefs', JSON.stringify({ briefing: false, tts: false, calm: true, sound: false, music: false, gameMusic: false }));
  } catch (e) {}
};
async function open(lang) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript(prep);
  await page.goto(`${BASE}?lang=${lang}`);
  await page.waitForSelector('#menu:not(.hidden)');
  return page;
}
// neues Spiel starten; Rolle observer über eigenen Knopf
async function start(page, role, startKind = 'regional') {
  await page.click('[data-mm=new]');
  await page.waitForTimeout(300);
  await page.selectOption('#inp-start', startKind);
  if (role === 'observer') await page.click('#mm-new [data-role-start=observer]');
  else await page.click(`.role-card[data-role=${role}]`);
  await page.waitForTimeout(1200);
  await closeModals(page);
}
// offene Fenster (Tagesbericht, Entscheidungen) schließen; Erfolgs-Popups und Meldungen fürs Foto ausblenden
async function closeModals(page) {
  for (let k = 0; k < 4; k++) {
    const m = await page.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));
    if (!m) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.addStyleTag({ content: '.ach-pop, #toasts { display: none !important; }' });
}
// Simulation vorspulen (KI übernimmt alle Stationen), dann Tageszeit/Wetter setzen
async function sim(page, sec, { hour, weather, auto = true } = {}) {
  await page.evaluate(
    async ([sec, hour, weather, auto]) => {
      const m = await import('./js/sim/sim.js');
      const s = window.planez.state;
      if (auto) s.auto = { atc: true, ground: true, manager: true };
      for (let i = 0; i < sec; i++) m.step(s, 1);
      if (hour != null) {
        const target = Math.floor(s.time / 86400) * 86400 + hour * 3600;
        while (s.time < target) m.step(s, 1);
      }
      if (weather) s.weather.kind = weather;
      s.speed = 1;
    },
    [sec, hour ?? null, weather ?? null, auto],
  );
  await page.waitForTimeout(1500);
  await closeModals(page);
}
const cam = (page, x, y, zoom) => page.evaluate(([x, y, zoom]) => { const c = window.planez.cam; if (x != null) c.focus(x, y); if (zoom) c.zoom = zoom; }, [x, y, zoom]);

const SHOTS = [
  ['01_menu', async (p) => { await p.waitForTimeout(1500); }],
  ['02_grass_strip', async (p) => { await start(p, 'manager', 'grass'); await sim(p, 3 * 86400, { hour: 11 }); await cam(p, null, null, 1.15); }],
  ['03_tower', async (p) => { await start(p, 'tower'); await sim(p, 3 * 3600, { hour: 9.2 }); }],
  ['04_apron', async (p) => { await start(p, 'ground'); await sim(p, 3 * 3600, { hour: 8.4 }); await cam(p, null, null, 0.85); }],
  ['05_management', async (p) => { await start(p, 'manager'); await sim(p, 2 * 86400, { hour: 13 }); await p.keyboard.press('o'); await p.waitForTimeout(900); }],
  ['06_night_storm', async (p) => { await start(p, 'observer'); await sim(p, 3 * 3600, { hour: 21.5, weather: 'storm' }); await p.evaluate(() => document.getElementById('game').classList.add('photo')); await cam(p, null, null, 0.9); }],
  ['07_cinema_3d', async (p) => {
    await start(p, 'observer');
    await sim(p, 3 * 3600, { hour: 17.2, weather: 'clouds' });
    await p.click('#t-tower3d');
    await p.waitForTimeout(2000);
    await p.click('#ride [data-rd=cine]');
    await p.waitForTimeout(6000);
  }],
  ['08_tower_view_3d', async (p) => { await start(p, 'tower'); await sim(p, 3 * 3600, { hour: 10 }); await p.click('#t-tower3d'); await p.waitForTimeout(5000); }],
];

for (const lang of LANGS) {
  const out = path.join(ROOT, 'store/screenshots', lang);
  fs.mkdirSync(out, { recursive: true });
  for (const [name, fn] of SHOTS) {
    const page = await open(lang);
    try {
      await fn(page);
      await page.screenshot({ path: path.join(out, name + '.jpg'), type: 'jpeg', quality: 90 });
      console.log(lang, name, page.errors.length ? 'ERR ' + page.errors[0] : 'ok');
    } catch (e) {
      console.log(lang, name, 'FAILED', e.message.split('\n')[0]);
    }
    await page.close();
  }
}
await browser.close();
