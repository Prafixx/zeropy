// Draws desktop/icon.png (512 x 512) from public/favicon.svg.
// Run with: npm run desktop:icon   (only needed when the logo changes)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 512;
const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), 'utf8');
const html = `<html><body style="margin:0;background:transparent">
<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${SIZE}" height="${SIZE}"></body></html>`;

app.disableHardwareAcceleration();
void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(1);
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), image.toPNG());
  console.log('desktop/icon.png written');
  app.quit();
});
