'use strict';
/*
 * Builds the app icons from build/icon.svg (the Sajawal POS "SP" mark):
 *   build/icon.png (512), build/icon.ico (16–256), assets/logo.png (64, sidebar).
 *   npx electron scripts/make-icon.js
 */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'build', 'icon.svg');
const FONT = path.join(ROOT, 'assets', 'fonts', 'manrope-var.woff2');

function ico(images) {
  // ICO with PNG-compressed entries (supported since Windows Vista).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const dir = [];
  const data = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e); data.push(png);
  }
  return Buffer.concat([header, ...dir, ...data]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const font = fs.readFileSync(FONT).toString('base64');
  const win = new BrowserWindow({ show: false, width: 600, height: 600, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const render = async (size) => {
    const page = `<!doctype html><html><head><style>
      @font-face{font-family:'Manrope';src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:200 800}
      html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`;
    await win.loadURL(`data:text/html;base64,${Buffer.from(page).toString('base64')}`);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    return img.resize({ width: size, height: size, quality: 'best' }).toPNG();
  };
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), await render(512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const s of sizes) images.push({ size: s, png: await render(s) });
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(images));
  fs.writeFileSync(path.join(ROOT, 'assets', 'logo.png'), await render(64));
  console.log('icons written from build/icon.svg');
  app.exit(0);
});
