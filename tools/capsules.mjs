// Shop-Grafiken (Steam-Kapseln, itch.io-Cover, Social-Vorschau) aus dem Titelbild bauen – je Sprache (de/en).
// Aufruf: node tools/capsules.mjs   (kein Server nötig – Dateien werden über page.route ausgeliefert; braucht Playwright + Chromium)
// Eingaben: store/art/key_wide.jpg (Querformat), store/art/key_tall.jpg (Hochformat). Ausgabe: store/capsules/*.png
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store/capsules');
fs.mkdirSync(OUT, { recursive: true });
const HOST = 'http://planez.local/';
const url = (p) => HOST + p;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.css': 'text/css' };
const TXT = {
  de: { tag: 'LANDEN. ABFERTIGEN. AUSBAUEN. WACHSEN.', sub: 'Vom Grasplatz zum Drehkreuz' },
  en: { tag: 'LAND. HANDLE. BUILD. GROW.', sub: 'From grass strip to hub' },
};
// name, Breite, Höhe, Bild, Logo-Größe (px der Zeile PLANEZ), Lage, Tagline/Unterzeile zeigen
const SPECS = [
  ['steam_header', 920, 430, 'wide', 74, 'left', true, false],
  ['steam_small', 462, 174, 'wide', 52, 'left', false, false],
  ['steam_main', 1232, 706, 'wide', 104, 'left', true, true],
  ['steam_vertical', 748, 896, 'tall', 88, 'mid', true, true],
  ['steam_library_capsule', 600, 900, 'tall', 72, 'mid', true, true],
  ['steam_library_hero', 3840, 1240, 'wide', 0, 'none', false, false],
  ['steam_library_logo', 1280, 720, 'none', 190, 'center', false, false],
  ['itch_cover', 630, 500, 'wide', 64, 'left', true, false],
  ['social_card', 1200, 630, 'wide', 96, 'left', true, true],
];
const fonts = fs.readFileSync(path.join(ROOT, 'css/fonts.css'), 'utf8').replace(/url\(\.\.\//g, `url(${url('')}`);

function html(spec, lang) {
  const [, w, h, art, size, pos, showTag, showSub] = spec;
  const t = TXT[lang];
  // sehr breite Formate etwas nach oben schieben, damit der anfliegende Jet im Bild bleibt
  const bg = art === 'none' ? 'transparent' : `url(${url(`store/art/key_${art}.jpg`)}) center ${w / h > 2.5 ? '12%' : 'center'}/cover no-repeat`;
  // Abdunklung hinter dem Logo, damit es auf jedem Ausschnitt lesbar bleibt
  const shade = pos === 'left' ? 'linear-gradient(100deg, rgba(4,10,24,.78) 0%, rgba(4,10,24,.45) 38%, rgba(4,10,24,0) 62%)' : pos === 'mid' ? 'linear-gradient(180deg, rgba(4,10,24,0) 30%, rgba(4,10,24,.55) 48%, rgba(4,10,24,.55) 62%, rgba(4,10,24,0) 78%)' : 'none';
  const place = pos === 'left' ? `left:${Math.round(w * 0.055)}px; top:${Math.round(h * (showSub ? 0.14 : 0.12))}px; align-items:flex-start;` : pos === 'mid' ? `left:0; right:0; top:${Math.round(h * 0.44)}px; align-items:center; text-align:center;` : 'left:0; right:0; top:0; bottom:0; align-items:center; justify-content:center;';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${art === 'none' ? 'transparent' : '#08101f'}}
  .art{position:absolute;inset:0;background:${bg}}
  .shade{position:absolute;inset:0;background:${shade}}
  .logo{position:absolute;display:flex;flex-direction:column;${place}}
  .t1{font-family:'Orbitron';font-weight:900;font-size:${size}px;line-height:.95;letter-spacing:.08em;background:linear-gradient(180deg,#fff 0%,#cfd8e3 45%,#8e9aab 58%,#eef2f7 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 ${size / 22}px ${size / 5}px rgba(0,0,0,.7))}
  .t2{font-family:'Orbitron';font-weight:900;font-size:${size * 0.86}px;line-height:.95;letter-spacing:.08em;color:#38d6f5;margin-top:.08em;text-shadow:0 0 ${size / 4}px rgba(56,214,245,.6),0 0 ${size / 1.6}px rgba(56,214,245,.3),0 2px 6px rgba(0,0,0,.5)}
  .tag{font-family:'Chakra Petch';font-weight:700;color:#f5a623;font-size:${Math.max(11, size * 0.16)}px;letter-spacing:.3em;margin-top:${size * 0.26}px;text-shadow:0 2px 8px rgba(0,0,0,.85)}
  .sub{font-family:'Chakra Petch';font-weight:600;color:#eef2f7;font-size:${Math.max(12, size * 0.22)}px;letter-spacing:.06em;margin-top:${size * 0.1}px;text-shadow:0 2px 10px rgba(0,0,0,.9)}
  </style></head><body><div class="art"></div><div class="shade"></div>${size ? `<div class="logo"><div class="t1">PLANEZ</div><div class="t2">AIRPORT</div>${showTag ? `<div class="tag">${t.tag}</div>` : ''}${showSub ? `<div class="sub">${t.sub}</div>` : ''}</div>` : ''}</body></html>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const spec of SPECS) {
  const [name, w, h] = spec;
  // Kapseln ohne Text brauchen nur eine Fassung
  const langs = spec[4] === 0 || (!spec[6] && !spec[7]) ? ['all'] : ['de', 'en'];
  for (const lang of langs) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const doc = html(spec, lang === 'all' ? 'en' : lang);
    await page.route(HOST + '**', (r) => {
      const rel = decodeURIComponent(new URL(r.request().url()).pathname).replace(/^\//, '');
      if (!rel) return r.fulfill({ contentType: 'text/html', body: doc });
      const f = path.join(ROOT, rel);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
      r.fulfill({ contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    });
    await page.goto(HOST, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, lang === 'all' ? `${name}.png` : `${name}_${lang}.png`);
    await page.screenshot({ path: file, omitBackground: spec[3] === 'none' });
    await page.close();
    console.log(path.relative(ROOT, file), `${w}x${h}`);
  }
}
await browser.close();
