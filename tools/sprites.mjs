// Gebäudegrafiken der Karte aus den 3D-Modellen (assets/models) neu rendern: node tools/sprites.mjs [id …]
// Schreibt assets/sprites/<sprite>.webp in der Projektion der Karte; die Grundfläche (w, d) kommt aus js/layout.js.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Parkhaus zeichnet die Karte selbst, Tower und Radar haben (noch) kein Modell
const IDS = process.argv.slice(2).length ? process.argv.slice(2) : ['club', 'gahangar', 'avgas', 'sterm', 'stower', 'hall', 'hangar', 'cargo', 'depot', 'fire', 'fuel', 'hotel'];
const SPRITE = { club: 'clubhouse', gahangar: 'ga_hangar', avgas: 'avgas', sterm: 'small_terminal', stower: 'small_tower', hall: 'terminal_hall', hangar: 'hangar', cargo: 'cargo', depot: 'gse_depot', fire: 'fire_station', fuel: 'fuel_farm', hotel: 'hotel' };
const MAXPX = 1800; // längste Kante der Grafik (scharf bis zur größten Zoomstufe)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page:', e.message));
await page.goto(`http://127.0.0.1:${srv.address().port}/tools/sprites.html`);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
for (const id of IDS) {
  // Maßstab so, dass die längste Kante etwa MAXPX hat (erst grob rendern, dann passend)
  const probe = await page.evaluate((id) => window.renderSprite(id, 1), id);
  if (!probe) {
    console.log(id, 'kein Modell');
    continue;
  }
  const S = MAXPX / Math.max(probe.w, probe.h);
  const out = await page.evaluate(([id, S]) => window.renderSprite(id, S), [id, S]);
  const file = path.join(ROOT, 'assets/sprites', SPRITE[id] + '.webp');
  fs.writeFileSync(file, Buffer.from(out.webp.split(',')[1], 'base64'));
  console.log(id.padEnd(9), `${out.w}×${out.h}`, 'frac', out.frac.toFixed(3), '→', path.relative(ROOT, file));
}
await browser.close();
srv.close();
