// The bridge between the page and the app: the window and the updater, nothing else.
// The page cannot reach Node or the file system through it.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zeropyWindow', {
  /** Colors the window buttons like the title bar: { color, symbolColor }. */
  titleBar: (colors) => ipcRenderer.send('window:title-bar', colors),
  /** Full screen on or off. */
  fullScreen: (on) => ipcRenderer.send('window:full-screen', Boolean(on)),
  /** The state of the window: { full, zoom }, after each change. */
  onState: (listener) => ipcRenderer.on('window:state', (_event, state) => listener(state)),
});

contextBridge.exposeInMainWorld('zeropyUpdates', {
  /** Asks GitHub for a newer version. Resolves to { state, version?, size? }. */
  check: () => ipcRenderer.invoke('update:check'),
  /** The newest version on GitHub (for the portable app): { state, version?, reason? }. */
  latest: () => ipcRenderer.invoke('update:latest'),
  /** Downloads the new version. Progress comes as events. */
  download: () => ipcRenderer.invoke('update:download'),
  /** Closes the app, installs the new version and starts it again. */
  install: () => ipcRenderer.invoke('update:install'),
  /** Download progress and the end of the download. Returns a function that stops listening. */
  onEvent: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on('update:event', handler);
    return () => ipcRenderer.removeListener('update:event', handler);
  },
});
