'use strict';
/*
 * Printing & PDF.
 *
 * Every document is rendered in its own hidden window with an explicit page
 * size, instead of printing the app window with CSS tricks (the v1 approach
 * that made A4/A5 print at receipt width and clipped A5 pages, issue #15).
 *  - A4 / A5: the page size is passed to the printer driver, so the user does
 *    not have to pick it under "Advanced". Margins come from the document's
 *    @page rule (default 8 mm) which keeps content inside the printable area.
 *  - Thermal: page width = roll width, height = the receipt's real height,
 *    so the receipt is one continuous strip with no blank paper.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { BrowserWindow, dialog } = require('electron');

const MICRONS_PER_PX = 25400 / 96;
const PAGE = {
  a4: { name: 'A4', width: 210000, height: 297000 },
  a5: { name: 'A5', width: 148000, height: 210000 }
};

async function renderWindow(html) {
  const file = path.join(os.tmpdir(), `sajawal-print-${crypto.randomBytes(6).toString('hex')}.html`);
  fs.writeFileSync(file, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, spellcheck: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  await win.loadFile(file);
  // Wait for fonts so measurements are final.
  await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true');
  return {
    win,
    cleanup() {
      try { if (!win.isDestroyed()) win.destroy(); } catch (_) { /* ignore */ }
      fs.unlink(file, () => {});
    }
  };
}

async function pageSizeFor(win, paper, receiptWidth) {
  if (paper === 'thermal') {
    const widthMm = Number(receiptWidth) === 58 ? 58 : 80;
    const px = await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
    return { width: widthMm * 1000, height: Math.max(50000, Math.ceil(px * MICRONS_PER_PX) + 6000) };
  }
  return PAGE[paper] ? PAGE[paper].name : 'A4';
}

async function print({ html, paper = 'a4', printer = '', silent = false, copies = 1, receiptWidth = 80 }) {
  const { win, cleanup } = await renderWindow(html);
  try {
    const pageSize = await pageSizeFor(win, paper, receiptWidth);
    const opts = {
      silent: !!silent && !!printer,
      printBackground: true,
      deviceName: printer || undefined,
      copies: Math.min(10, Math.max(1, Number(copies) || 1)),
      pageSize,
      margins: { marginType: 'default' },
      landscape: false
    };
    if (!opts.deviceName) delete opts.deviceName;
    const result = await new Promise((resolve) => {
      win.webContents.print(opts, (success, reason) => resolve({ success, reason: reason || '' }));
    });
    if (!result.success && result.reason && !/cancel/i.test(result.reason)) {
      return { ok: false, message: `Printing failed: ${result.reason}` };
    }
    return { ok: true, printed: result.success };
  } finally {
    // Give the spooler a moment before the window disappears.
    setTimeout(cleanup, 1500);
  }
}

async function savePdf(parentWin, { html, paper = 'a4', defaultName = 'document', receiptWidth = 80 }) {
  const safe = String(defaultName).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'document';
  const res = await dialog.showSaveDialog(parentWin, {
    title: 'Save as PDF',
    defaultPath: path.join(require('electron').app.getPath('documents'), `${safe}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  const { win, cleanup } = await renderWindow(html);
  try {
    const size = await pageSizeFor(win, paper, receiptWidth);
    const pageSize = typeof size === 'string' ? size : { width: size.width / 25400, height: size.height / 25400 };
    const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: typeof size === 'string', pageSize });
    fs.writeFileSync(res.filePath, data);
    return { ok: true, path: res.filePath };
  } finally {
    cleanup();
  }
}

module.exports = { print, savePdf };
