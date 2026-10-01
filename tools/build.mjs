// Pakete für den Verkauf bauen: dist/planez-full und dist/planez-demo (jeweils als Ordner und ZIP für itch.io).
// node tools/build.mjs [full|demo|both]
// Kopiert nur, was das Spiel braucht (index.html, css, js, assets, LIZENZEN.md), und schreibt die Ausgabe fest in
// js/edition.js – in den Paketen lässt sich die Demo nicht per Adresse umschalten.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const which = process.argv[2] || 'both';
const editions = which === 'both' ? ['full', 'demo'] : [which];
const COPY = ['index.html', 'css', 'js', 'assets', 'LIZENZEN.md'];
const SKIP = new Set(['.DS_Store']);

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) if (!SKIP.has(f)) copy(path.join(src, f), path.join(dst, f));
  } else fs.copyFileSync(src, dst);
}

const version = /VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'))[1];
for (const ed of editions) {
  const out = path.join(ROOT, 'dist', `planez-${ed}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of COPY) copy(path.join(ROOT, f), path.join(out, f));
  const edFile = path.join(out, 'js/edition.js');
  const src = fs.readFileSync(edFile, 'utf8').replace(/export const EDITION = [^;]+;/, `export const EDITION = '${ed}';`);
  fs.writeFileSync(edFile, src);
  const zip = path.join(ROOT, 'dist', `planez-${ed}-${version}.zip`);
  fs.rmSync(zip, { force: true });
  try {
    execSync(`cd "${out}" && zip -qr -9 "${zip}" .`);
  } catch (e) {
    console.warn('zip nicht verfügbar – nur Ordner erstellt');
  }
  const size = fs.existsSync(zip) ? (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB' : '–';
  console.log(`${ed}: ${path.relative(ROOT, out)} · ZIP ${size}`);
}
