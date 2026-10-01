// Desktop-Pakete für Steam & Co. bauen: Vollversion (oder Demo) in die Electron-Hülle desktop/ packen.
// node tools/desktop.mjs [win|linux|mac|all] [full|demo]   → dist/desktop/ (Ordner und ZIP/TAR je System)
// Beim ersten Aufruf installiert npm Electron und electron-builder in desktop/node_modules (einmalig ~250 MB).
// Windows-Pakete lassen sich auch unter Linux bauen (ohne eigenes Programmsymbol in der .exe – Steam zeigt ohnehin
// die Symbole aus der Steamworks-Seite); macOS-Pakete nur auf einem Mac (Signatur/Notarisierung).
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DESK = path.join(ROOT, 'desktop');
const target = process.argv[2] || (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux');
const ed = process.argv[3] || 'full';
const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: 'inherit' });

// 1) Spiel bauen und nach desktop/game kopieren
run(`node tools/build.mjs ${ed}`);
const game = path.join(DESK, 'game');
fs.rmSync(game, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'dist', `planez-${ed}`), game, { recursive: true });
// 2) Version aus js/version.js übernehmen (electron-builder liest sie aus package.json)
const version = /VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'))[1];
const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version) ? version : (version.match(/\d+/g) || ['1']).concat(['0', '0']).slice(0, 3).join('.');
// 3) Electron und electron-builder bei Bedarf installieren, dann paketieren
if (!fs.existsSync(path.join(DESK, 'node_modules', 'electron-builder'))) run('npm install --no-audit --no-fund', DESK);
const flags = { win: '--win', linux: '--linux', mac: '--mac', all: '--win --linux' }[target] || '--linux';
const name = ed === 'demo' ? 'Planez Demo' : 'Planez';
run(`npx electron-builder ${flags} --publish never -c.extraMetadata.version=${semver} -c.productName="${name}" -c.appId=com.planez.${ed === 'demo' ? 'demo' : 'airport'}`, DESK);
console.log(`\nfertig: ${path.relative(ROOT, path.join(ROOT, 'dist/desktop'))} (${name} ${semver})`);
