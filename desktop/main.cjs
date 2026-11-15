// ZeroPy desktop app: shows the built site (dist/) in its own window.
// Everything is served from inside the app, so it works fully offline.
// Progress lives in the browser storage of the app's own origin
// (app://zeropy), saved in %APPDATA%\ZeroPy. It stays there across
// restarts and updates, because the origin and the app id never change.
const { app, BrowserWindow, Menu, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://zeropy`;
const ROOT = path.join(__dirname, '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.py': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Must run before the app is ready. "standard" + "secure" make the origin
// behave like https: storage, module workers and WebAssembly all work.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== 'zeropy') return new Response('Not found', { status: 404 });
  const rel = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const res = await net.fetch(pathToFileURL(file).toString());
    if (!res.ok) return new Response('Not found', { status: 404 });
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return new Response(res.body, { status: 200, headers: { 'content-type': type } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function isInside(url) {
  return url === ORIGIN || url.startsWith(`${ORIGIN}/`);
}

/** Links to other sites (for example the Python docs) open in the normal browser. */
function openOutside(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function guard(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    // "Read check.py first" opens the file in a small app window.
    if (isInside(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 700, autoHideMenuBar: true } };
    }
    openOutside(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isInside(url)) {
      event.preventDefault();
      openOutside(url);
    }
  });
}

function buildMenu() {
  // The menu bar stays hidden (press Alt to show it). It keeps zoom keys,
  // which help readers who need bigger text.
  const view = [
    { role: 'zoomIn', accelerator: 'CommandOrControl+=' },
    { role: 'zoomOut' },
    { role: 'resetZoom' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];
  if (!app.isPackaged) view.push({ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'View', submenu: view }]));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    title: 'ZeroPy',
    backgroundColor: '#F3EDE2',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/** Writes pending storage to disk, so progress is never lost on exit. */
function flush() {
  try {
    session.defaultSession.flushStorageData();
  } catch {
    // Nothing to flush.
  }
}

// One window only: two copies would fight over the same saved progress.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('web-contents-created', (_event, contents) => guard(contents));
  app.on('before-quit', flush);
  app.on('window-all-closed', () => {
    flush();
    app.quit();
  });
  void app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);
    buildMenu();
    createWindow();
  });
}
