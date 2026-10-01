// Desktop-Hülle (Steam & Co.): Electron lädt das Spiel aus game/ über das eigene Schema app://planez/.
// So laufen ES-Module, Videos (mit Range-Anfragen) und localStorage wie im Browser; Spielstände liegen im
// Benutzerordner der App. Bauen: node tools/desktop.mjs [win|linux|mac|all]
const { app, BrowserWindow, protocol, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, 'game');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary' };

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);
app.setName('Planez');
// Demo und Vollversion teilen sich den Datenordner – Spielstände aus der Demo laufen in der Vollversion weiter
app.setPath('userData', path.join(app.getPath('appData'), 'Planez'));

async function serve(req) {
  const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(GAME, rel));
  if (!file.startsWith(GAME + path.sep)) return new Response('forbidden', { status: 403 });
  let data;
  try {
    data = await fs.promises.readFile(file);
  } catch (e) {
    return new Response('not found', { status: 404 });
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (range) {
    const size = data.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start >= size || start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(data.subarray(start, end + 1), { status: 206, headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) } });
  }
  return new Response(data, { headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(data.length) } });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1280, minHeight: 720,
    backgroundColor: '#0b1220', title: 'Planez', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  // F11 schaltet Vollbild, Alt+Enter ebenso
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  // Links nach außen (Shopseite, Lizenzen) im Standardbrowser öffnen, nie im Spielfenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://planez/')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL('app://planez/index.html');
}

// nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorn (sonst teilen sich zwei Fenster die Spielstände)
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
  });
  app.on('window-all-closed', () => app.quit());
}
