'use strict';
/*
 * Backups: consistent snapshots made with SQLite's VACUUM INTO (safe while the
 * app is running). Automatic backups run at start-up (once a day), every few
 * hours while open, and when the app closes. Old automatic backups are pruned.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_VERSION } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

class BackupManager {
  constructor({ dir, getStore, getSettings }) {
    this.dir = dir;
    this.getStore = getStore;
    this.getSettings = getSettings;
    fs.mkdirSync(dir, { recursive: true });
  }

  snapshot(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const escaped = file.replace(/'/g, "''");
    this.getStore().db.exec(`VACUUM INTO '${escaped}'`);
    return file;
  }

  /** Automatic backup into the app's backup folder (+ optional mirror folder). */
  auto(reason = 'auto') {
    const file = path.join(this.dir, `sajawal-pos_${stamp()}_${reason}.db`);
    this.snapshot(file);
    const cfg = this.getSettings().backup || {};
    let mirrored = null;
    if (cfg.mirror_dir) {
      try {
        fs.mkdirSync(cfg.mirror_dir, { recursive: true });
        mirrored = path.join(cfg.mirror_dir, path.basename(file));
        fs.copyFileSync(file, mirrored);
        this.prune(cfg.mirror_dir, cfg.keep || 30);
      } catch (e) {
        mirrored = null;
        console.warn('[backup] mirror failed:', e.message);
      }
    }
    this.prune(this.dir, cfg.keep || 30);
    return { file, mirrored };
  }

  hasBackupToday() {
    const today = stamp().slice(0, 10);
    return this.list().some((b) => b.name.includes(`_${today}_`));
  }

  list(dir = this.dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^sajawal-pos_.*\.db$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, file: path.join(dir, f), size: st.size, modified: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.modified < b.modified ? 1 : -1));
  }

  prune(dir, keep) {
    const files = this.list(dir);
    for (const f of files.slice(keep)) {
      try { fs.unlinkSync(f.file); } catch (_) { /* ignore */ }
    }
  }

  /** Check that a file really is a Sajawal POS database before restoring it. */
  static validate(file) {
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const version = Number(db.prepare('PRAGMA user_version').get().user_version);
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
      for (const t of ['products', 'sales', 'sale_items', 'payments', 'customers', 'settings']) {
        if (!tables.has(t)) return { ok: false, message: 'This file is not a Sajawal POS backup.' };
      }
      if (version > SCHEMA_VERSION) return { ok: false, message: 'This backup was made by a newer version of Sajawal POS. Please update the app first.' };
      const integrity = db.prepare('PRAGMA quick_check').get();
      if (Object.values(integrity)[0] !== 'ok') return { ok: false, message: 'The backup file is damaged.' };
      const counts = {
        products: Number(db.prepare('SELECT COUNT(*) AS n FROM products').get().n),
        sales: Number(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n),
        customers: Number(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n)
      };
      const last = db.prepare('SELECT MAX(created_at) AS d FROM sales').get().d;
      return { ok: true, version, counts, last_sale: last || null };
    } catch (e) {
      return { ok: false, message: 'This file could not be opened as a database.' };
    } finally {
      try { db && db.close(); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { BackupManager, stamp };
