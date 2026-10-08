'use strict';
/*
 * Electron main process: window, security, database lifecycle, IPC.
 */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require('electron');
const { Store } = require('./db');
const { createServices } = require('./services');
const { BackupManager } = require('./backup');
const printing = require('./printing');

const ROOT = path.join(__dirname, '..', '..');
const isDev = !app.isPackaged;

// Keep the data folder used by v1.x (%APPDATA%\sajawal-pos) so upgrading finds the
// existing records. Test harnesses set their own throw-away folder first.
// SAJAWAL_USER_DATA can point a support/test run at a different folder.
if (process.env.SAJAWAL_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.SAJAWAL_USER_DATA));
} else if (!global.__sajawalCustomUserData) {
  app.setPath('userData', path.join(app.getPath('appData'), 'sajawal-pos'));
}

let mainWindow = null;
let store = null;
let ctx = null;
let backups = null;
let dirty = false;
let quitting = false;
let backupTimer = null;
let closeAck = false;

const paths = () => {
  const userData = app.getPath('userData');
  return {
    userData,
    dataDir: path.join(userData, 'data'),
    dbFile: path.join(userData, 'data', 'sajawal-pos.db'),
    backupDir: path.join(userData, 'backups')
  };
};

// ------------------------------------------------------------------ single instance

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight over the same data — focus the first one instead.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(start);
}

function openDatabase() {
  const p = paths();
  try {
    store = new Store(p.dbFile);
    const check = store.db.prepare('PRAGMA quick_check').get();
    if (Object.values(check)[0] !== 'ok') throw new Error('Database integrity check failed');
  } catch (err) {
    console.error('[db] open failed', err);
    const bm = new BackupManager({ dir: p.backupDir, getStore: () => null, getSettings: () => ({}) });
    const latest = bm.list()[0];
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Sajawal POS — database problem',
      message: 'The shop database could not be opened.',
      detail: latest
        ? `The latest automatic backup is from ${new Date(latest.modified).toLocaleString()}.\n\nRestore it now? The damaged file will be kept next to it.`
        : `No backup was found.\n\nError: ${err.message}`,
      buttons: latest ? ['Restore latest backup', 'Quit'] : ['Quit'],
      defaultId: 0,
      cancelId: latest ? 1 : 0
    });
    if (latest && choice === 0) {
      try { if (store) store.close(); } catch (_) { /* ignore */ }
      const damaged = `${p.dbFile}.damaged-${Date.now()}`;
      if (fs.existsSync(p.dbFile)) fs.renameSync(p.dbFile, damaged);
      for (const ext of ['-wal', '-shm']) if (fs.existsSync(p.dbFile + ext)) fs.rmSync(p.dbFile + ext, { force: true });
      fs.copyFileSync(latest.file, p.dbFile);
      store = new Store(p.dbFile);
    } else {
      app.exit(1);
      return false;
    }
  }
  ctx = createServices(store);
  backups = new BackupManager({ dir: p.backupDir, getStore: () => store, getSettings: () => ctx.settings.get() });
  return true;
}

function runAutoBackup(reason) {
  try {
    if (!store) return null;
    const r = backups.auto(reason);
    dirty = false;
    return r;
  } catch (e) {
    console.warn('[backup] failed:', e.message);
    return null;
  }
}

async function start() {
  if (!openDatabase()) return;

  // Deny every permission request (camera, mic, geolocation, notifications…).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  Menu.setApplicationMenu(null);

  registerIpc();
  createWindow();

  // Backups: once at start-up per day, every 3 hours if something changed, and on exit.
  setTimeout(() => { if (!backups.hasBackupToday()) runAutoBackup('daily'); }, 8000);
  backupTimer = setInterval(() => { if (dirty) runAutoBackup('auto'); }, 3 * 60 * 60 * 1000);
}

function createWindow() {
  const iconPath = path.join(ROOT, 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: 'Sajawal POS',
    backgroundColor: '#f4f4f0',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: isDev
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Never navigate away from the app or open new windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (isDev && input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
    // Block reload shortcuts so an accidental Ctrl+R never loses an unsaved cart.
    if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'r') e.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] gone', details);
    if (!quitting) mainWindow.reload();
  });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    // Ask the screen first (it warns about an unsaved cart). It acknowledges
    // immediately; only if it never answers (hung) do we close anyway.
    closeAck = false;
    mainWindow.webContents.send('app:before-close');
    setTimeout(() => { if (!closeAck && !quitting) forceQuit(); }, 3000);
  });

  mainWindow.loadFile(path.join(ROOT, 'index.html'));
}

function forceQuit() {
  if (quitting) return;
  quitting = true;
  clearInterval(backupTimer);
  if (dirty) runAutoBackup('exit');
  try { store && store.close(); } catch (_) { /* ignore */ }
  app.exit(0);
}

function senderOk(e) {
  const url = e.senderFrame ? e.senderFrame.url : '';
  return mainWindow && e.sender === mainWindow.webContents && url.startsWith('file://');
}

const READ_ONLY = /\.(get|list|search|status|detail|forSale|categories|findBySku|movements|summary|ledger|returns|dashboard|profit|cashbook|receivables|stock|returnQuote|allowed)$/;

function guard(handler) {
  return async (e, ...args) => {
    if (!senderOk(e)) return { ok: false, error: { message: 'Blocked', code: 'BLOCKED' } };
    try {
      return await handler(...args);
    } catch (err) {
      console.error('[ipc]', err);
      return { ok: false, error: { message: err.message || 'Unexpected error', code: err.code || 'INTERNAL' } };
    }
  };
}

function registerIpc() {
  ipcMain.handle('api', guard((name, payload) => {
    const res = ctx.call(String(name), payload);
    if (res.ok && !READ_ONLY.test(name) && !name.startsWith('auth.')) dirty = true;
    return res;
  }));

  ipcMain.handle('app:info', guard(() => {
    const p = paths();
    return {
      ok: true,
      data: { version: app.getVersion(), dataFile: p.dbFile, backupDir: p.backupDir, isDev, platform: process.platform }
    };
  }));

  ipcMain.handle('app:close-ack', guard(() => { closeAck = true; return { ok: true }; }));
  ipcMain.handle('app:confirm-close', guard(() => { forceQuit(); return { ok: true }; }));

  ipcMain.handle('print:printers', guard(async () => {
    const list = await mainWindow.webContents.getPrintersAsync();
    return { ok: true, data: list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault })) };
  }));

  ipcMain.handle('print:document', guard(async (opts) => {
    const s = ctx.settings.get().print;
    const paper = ['thermal', 'a4', 'a5'].includes(opts.paper) ? opts.paper : 'a4';
    const printer = opts.printer !== undefined ? opts.printer : paper === 'thermal' ? s.receipt_printer : paper === 'a5' ? s.a5_printer : s.a4_printer;
    const silent = opts.silent !== undefined ? opts.silent : s.silent;
    const r = await printing.print({ html: String(opts.html || ''), paper, printer, silent, copies: opts.copies, receiptWidth: s.receipt_width });
    return r.ok ? { ok: true, data: r } : { ok: false, error: { message: r.message } };
  }));

  ipcMain.handle('print:pdf', guard(async (opts) => {
    const r = await printing.savePdf(mainWindow, { html: String(opts.html || ''), paper: opts.paper, defaultName: opts.name, receiptWidth: ctx.settings.get().print.receipt_width });
    if (r.ok) shell.showItemInFolder(r.path);
    return { ok: true, data: r };
  }));

  ipcMain.handle('file:save', guard(async ({ name, data, filters }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('documents'), String(name || 'export').replace(/[\\/:*?"<>|]+/g, '_')),
      filters: Array.isArray(filters) ? filters : undefined
    });
    if (res.canceled || !res.filePath) return { ok: true, data: { canceled: true } };
    fs.writeFileSync(res.filePath, Buffer.from(data));
    shell.showItemInFolder(res.filePath);
    return { ok: true, data: { path: res.filePath } };
  }));

  ipcMain.handle('file:open', guard(async ({ filters }) => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
    if (res.canceled || !res.filePaths[0]) return { ok: true, data: { canceled: true } };
    const file = res.filePaths[0];
    const st = fs.statSync(file);
    if (st.size > 30 * 1024 * 1024) return { ok: false, error: { message: 'File is too large (max 30 MB)' } };
    return { ok: true, data: { name: path.basename(file), bytes: fs.readFileSync(file) } };
  }));

  ipcMain.handle('shell:open-folder', guard(({ which }) => {
    const p = paths();
    const target = which === 'backups' ? p.backupDir : which === 'mirror' ? ctx.settings.get().backup.mirror_dir : p.dataDir;
    if (target && fs.existsSync(target)) shell.openPath(target);
    return { ok: true };
  }));

  ipcMain.handle('dialog:pick-folder', guard(async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return { ok: true, data: res.canceled ? null : res.filePaths[0] };
  }));

  // ---------------------------------------------------------------- backups

  ipcMain.handle('backup:list', guard(() => ({ ok: true, data: { auto: backups.list(), last: backups.list()[0] || null } })));

  ipcMain.handle('backup:create', guard(async () => {
    const name = `sajawal-pos_${require('./backup').stamp()}_manual.db`;
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save a backup copy',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'Sajawal POS backup', extensions: ['db'] }]
    });
    if (res.canceled || !res.filePath) return { ok: true, data: { canceled: true } };
    backups.snapshot(res.filePath);
    ctx.audit('Backup Created', 'system', null, `Manual backup saved to ${res.filePath}`);
    shell.showItemInFolder(res.filePath);
    return { ok: true, data: { path: res.filePath } };
  }));

  ipcMain.handle('backup:now', guard(() => {
    const r = runAutoBackup('manual');
    return r ? { ok: true, data: r } : { ok: false, error: { message: 'Backup failed. Check that the backup folder is available.' } };
  }));

  ipcMain.handle('backup:restore', guard(async ({ file } = {}) => {
    ctx.auth.require('restoreBackup');
    let source = file;
    if (!source) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a backup to restore',
        defaultPath: backups.dir,
        properties: ['openFile'],
        filters: [{ name: 'Sajawal POS backup', extensions: ['db'] }]
      });
      if (res.canceled || !res.filePaths[0]) return { ok: true, data: { canceled: true } };
      source = res.filePaths[0];
    }
    const check = BackupManager.validate(source);
    if (!check.ok) return { ok: false, error: { message: check.message } };
    const confirm = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Restore backup',
      message: 'Replace ALL current data with this backup?',
      detail: `Backup contains ${check.counts.products} products, ${check.counts.sales} invoices, ${check.counts.customers} customers` +
        `${check.last_sale ? `\nLast sale: ${check.last_sale.slice(0, 16)}` : ''}\n\nA safety copy of the current data is saved first. The app will restart.`,
      buttons: ['Restore and restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    });
    if (confirm !== 0) return { ok: true, data: { canceled: true } };
    runAutoBackup('before-restore');
    const p = paths();
    const temp = `${p.dbFile}.restore-${Date.now()}`;
    fs.copyFileSync(source, temp);
    quitting = true;
    clearInterval(backupTimer);
    store.close();
    for (const ext of ['-wal', '-shm']) fs.rmSync(p.dbFile + ext, { force: true });
    fs.renameSync(temp, p.dbFile);
    app.relaunch();
    app.exit(0);
    return { ok: true, data: { restarted: true } };
  }));

  ipcMain.handle('data:clear', guard(({ confirmText } = {}) => {
    ctx.auth.require('clearData');
    if (confirmText !== 'DELETE') return { ok: false, error: { message: 'Type DELETE to confirm' } };
    const b = runAutoBackup('before-clear');
    if (!b) return { ok: false, error: { message: 'Could not make a safety backup, so nothing was deleted.' } };
    store.tx(() => {
      for (const t of ['return_items', 'returns', 'payments', 'sale_revisions', 'sale_items', 'sales', 'stock_movements', 'products', 'customers', 'expenses', 'drafts', 'audit_log']) {
        store.db.exec(`DELETE FROM ${t}`);
      }
      store.db.exec("DELETE FROM sqlite_sequence WHERE name <> 'settings'");
      store.db.exec("DELETE FROM meta WHERE key IN ('invoice_seq','return_seq')");
      ctx.audit('All Data Deleted', 'system', null, `All business data was deleted. Safety backup: ${path.basename(b.file)}`);
    });
    dirty = true;
    return { ok: true, data: { backup: b.file } };
  }));
}

app.on('window-all-closed', () => forceQuit());
app.on('before-quit', () => { /* handled by window close */ });
