// ZeroPy desktop app: shows the built site (dist/) in its own window.
// Everything is served from inside the app, so it works fully offline.
// Progress lives in the browser storage of the app's own origin
// (app://zeropy), saved in %APPDATA%\ZeroPy. It stays there across
// restarts and updates, because the origin and the app id never change.
const { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Windows groups windows and shortcuts by this id. The installer gives the
// shortcuts the appId of package.json; the app must use the same one, or
// the taskbar shows a separate button with an old, cached icon.
if (process.platform === 'win32') app.setAppUserModelId('io.github.prafixx.zeropy');
// The window icon (taskbar and title bar), sharp at every size.
const ICON = path.join(__dirname, 'icon.ico');

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

// ---- Updates ------------------------------------------------------------
// Only on a click in the settings: the app never goes online by itself.
// New versions come from the GitHub releases of the project (latest.yml).
// The download is checked against its SHA-512 before it is installed.
// The portable .exe cannot update itself: it gets the download page.
let updater = null;

function canSelfUpdate() {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
}

function getUpdater() {
  if (updater) return updater;
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  // A downloaded update also installs when the app closes, not only after
  // "Restart now": otherwise it waits forever and the app stays old.
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.logger = null;
  const send = (data) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update:event', data));
  updater.on('download-progress', (p) => send({ state: 'progress', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
  updater.on('error', (error) => {
    logUpdate(`updater: ${classify(error)}: ${String(error && error.message).replace(/\s+/g, ' ').slice(0, 240)}`);
    send({ state: 'error', reason: classify(error) });
  });
  return updater;
}

// Why a check failed, from the error itself: no more "check your connection"
// for everything. offline | timeout | limited (GitHub refuses for a while) |
// not-ready (a release without its files yet, just after publishing) |
// github-down (an error on GitHub's side) | unknown.
function classify(error) {
  const status = Number(error && (error.statusCode || error.status)) || 0;
  const text = String((error && (error.code || '')) + ' ' + (error && error.message) || '');
  if (!net.isOnline() || /ERR_INTERNET_DISCONNECTED/.test(text)) return 'offline';
  // Online, but github.com cannot be found or reached: DNS, a firewall, a VPN.
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_REFUSED|ERR_PROXY|ERR_CERT/.test(text)) return 'unreachable';
  if (/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT|ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/i.test(text)) return 'timeout';
  if (status === 429 || status === 403 || /rate limit/i.test(text)) return 'limited';
  if (status === 404 || /Cannot find .*latest\.yml|No published versions/i.test(text)) return 'not-ready';
  if (status >= 500 || /ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|ERR_NETWORK_CHANGED|ECONNRESET/.test(text)) return 'github-down';
  return 'unknown';
}

// A short log of failed checks (in the folder of the app's data), to find a
// problem later. Only the reason and GitHub's message: nothing personal.
function logUpdate(line) {
  try {
    const file = path.join(app.getPath('userData'), 'logs', 'updates.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').slice(-199) : [];
    fs.writeFileSync(file, [...old, `${new Date().toISOString()} ${line}`].join('\n'));
  } catch {
    // A log that cannot be written is no reason to fail.
  }
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })), ms))]);

/** Tries a check up to three times when the failure may pass (1.5 s, then 4 s later). */
async function withRetry(name, task) {
  const waits = [1500, 4000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withTimeout(task(), 20000);
    } catch (error) {
      const reason = classify(error);
      logUpdate(`${name} try ${attempt + 1}: ${reason}: ${String(error && error.message).replace(/\s+/g, ' ').slice(0, 240)}`);
      const passing = reason === 'timeout' || reason === 'github-down' || reason === 'unreachable' || reason === 'unknown';
      if (!passing || attempt >= waits.length) {
        const retryAfter = Number(error && error.headers && (error.headers['retry-after'] || error.headers['Retry-After'])) || null;
        return { state: 'error', reason, retryAfter };
      }
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

// The newest version, read from latest.yml of the newest release (a file,
// not the API of GitHub, which allows only 60 calls an hour per network).
// (ZEROPY_LATEST_URL: only for the tests of the failure messages.)
const LATEST_YML = process.env.ZEROPY_LATEST_URL || 'https://github.com/Prafixx/zeropy/releases/latest/download/latest.yml';
async function latestVersion() {
  const response = await net.fetch(LATEST_YML, { cache: 'no-store', headers: { 'User-Agent': `ZeroPy/${app.getVersion()}` } });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { statusCode: response.status, headers: { 'retry-after': response.headers.get('retry-after') } });
  const match = /^version:\s*['"]?([\d.]+)/m.exec(await response.text());
  if (!match) throw new Error('latest.yml has no version');
  return match[1];
}

function setupUpdates() {
  ipcMain.handle('update:check', async () => {
    if (!canSelfUpdate()) return { state: 'manual' };
    if (!net.isOnline()) return { state: 'error', reason: 'offline' };
    return withRetry('check', async () => {
      const result = await getUpdater().checkForUpdates();
      const info = result?.updateInfo;
      if (!result || !result.isUpdateAvailable || !info) return { state: 'none' };
      const size = info.files?.[0]?.size;
      return { state: 'available', version: info.version, size: typeof size === 'number' ? size : null };
    });
  });
  // The portable app cannot update itself: it only asks for the newest version.
  ipcMain.handle('update:latest', async () => {
    if (!net.isOnline()) return { state: 'error', reason: 'offline' };
    return withRetry('latest', async () => ({ state: 'latest', version: await latestVersion() }));
  });
  ipcMain.handle('update:download', async () => {
    if (!canSelfUpdate()) return false;
    try {
      await getUpdater().downloadUpdate();
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('update:install', () => {
    if (!canSelfUpdate() || !updater) return false;
    flush();
    // Silent: the installer of ZeroPy needs no clicks. Then the new version starts.
    setImmediate(() => updater.quitAndInstall(true, true));
    return true;
  });
}

function buildMenu() {
  // No menu bar (Alt showed a bare "View" menu). The keys it had still work:
  // see keys() below.
  Menu.setApplicationMenu(null);
}

/**
 * The size of everything. The page grows with the window, so a maximized or
 * full-screen window shows the same layout, bigger (not a small layout in a
 * sea of space). A layout of 1280 x 760 is the base. Ctrl + and Ctrl - add
 * the reader's own zoom on top, for those who need bigger text.
 */
const BASE_SIZE = { width: 1280, height: 760 };
const MAX_FIT = 1.75;
let ownZoom = 0; // steps of Ctrl + / Ctrl -
let lastFit = '';
function fit(win) {
  if (win.isDestroyed() || win.isMinimized()) return;
  const [width, height] = win.getContentSize();
  const auto = Math.min(MAX_FIT, Math.max(1, Math.min(width / BASE_SIZE.width, height / BASE_SIZE.height)));
  const zoom = Math.round(auto * 1.15 ** ownZoom * 100) / 100;
  const full = win.isFullScreen();
  // Windows sends a resize when a full-screen window gets the focus back
  // (Alt+Tab). Setting the same zoom and title bar again made Chromium lay
  // out and paint the whole page: about a second of black. So only a real
  // change does anything.
  const key = `${zoom}|${full}`;
  if (key === lastFit) return;
  lastFit = key;
  if (win.webContents.getZoomFactor() !== zoom) win.webContents.setZoomFactor(zoom);
  // The bar of the page grows with the zoom: the window buttons grow with it.
  const barHeight = Math.round(TITLE_BAR_HEIGHT * zoom);
  if (barHeight !== barColors.height) {
    barColors.height = barHeight;
    try {
      win.setTitleBarOverlay(barColors);
    } catch {
      // No overlay (full screen on some systems): nothing to size.
    }
  }
  win.webContents.send('window:state', { full, zoom });
}

/** Zoom, full screen, and in development reload and DevTools. */
function keys(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const wc = win.webContents;
    let done = true;
    if (ctrl && (input.key === '=' || input.key === '+')) ownZoom = Math.min(ownZoom + 1, 6);
    else if (ctrl && input.key === '-') ownZoom = Math.max(ownZoom - 1, -4);
    else if (ctrl && input.key === '0') ownZoom = 0;
    else if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    else if (!app.isPackaged && ctrl && input.key.toLowerCase() === 'r') wc.reload();
    else if (!app.isPackaged && (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i'))) wc.toggleDevTools();
    else done = false;
    if (done) {
      event.preventDefault();
      lastFit = '';
      fit(win);
    }
  });
}

/**
 * Full screen for real, over the taskbar: the button in the app's bar, F11,
 * and Esc to leave. The window has no maximize button of its own (it would
 * be a second full-screen button); it can still be resized at its edges.
 */
function fullScreen(win) {
  for (const name of ['resize', 'enter-full-screen', 'leave-full-screen', 'restore']) win.on(name, () => fit(win));
  win.webContents.on('did-finish-load', () => {
    lastFit = '';
    fit(win);
  });
}
ipcMain.on('window:full-screen', (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && typeof on === 'boolean') win.setFullScreen(on);
});

// The title bar is the app's own (src/main.ts draws it). Windows keeps its
// buttons on the right, in the colors of the theme.
const TITLE_BAR_HEIGHT = 36;
const titleBar = (dark) => ({ color: dark ? '#151729' : '#fdfbf7', symbolColor: dark ? '#f3f0e8' : '#1d1c26', height: TITLE_BAR_HEIGHT });
const barColors = titleBar(nativeTheme.shouldUseDarkColors);
ipcMain.on('window:title-bar', (event, colors) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && colors && typeof colors.color === 'string' && typeof colors.symbolColor === 'string') {
    barColors.color = colors.color;
    barColors.symbolColor = colors.symbolColor;
    win.setTitleBarOverlay(barColors);
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    title: 'ZeroPy',
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0e19' : '#f7f3ec',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBar(nativeTheme.shouldUseDarkColors),
    maximizable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  keys(win);
  fullScreen(win);
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

// Windows tells Chromium when a window is covered, and Chromium stops
// drawing it; coming back to a full-screen window then showed black for a
// moment. The window is drawn as usual instead.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

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
    setupUpdates();
    buildMenu();
    createWindow();
  });
}
