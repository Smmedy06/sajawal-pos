'use strict';
/*
 * SQLite storage (Node's built-in node:sqlite, shipped inside Electron).
 *
 * Durability: WAL journal + synchronous=FULL, foreign keys enforced.
 * Atomicity: every business operation runs inside tx(), so a crash or an
 * error part-way through leaves the database exactly as it was before.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  // v1 — initial schema
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    sku             TEXT,
    category        TEXT NOT NULL DEFAULT '',
    brand           TEXT NOT NULL DEFAULT '',
    supplier        TEXT NOT NULL DEFAULT '',
    cost_price      INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    sell_price      INTEGER CHECK (sell_price IS NULL OR sell_price >= 0),
    stock_qty       INTEGER NOT NULL DEFAULT 0,
    low_stock_level INTEGER,
    expiry_date     TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    legacy_id       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ux_products_name ON products(name COLLATE NOCASE) WHERE is_active = 1;
  CREATE UNIQUE INDEX ux_products_sku  ON products(sku COLLATE NOCASE) WHERE is_active = 1 AND sku IS NOT NULL AND sku <> '';
  CREATE INDEX ix_products_category ON products(category);

  CREATE TABLE stock_movements (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    created_at    TEXT NOT NULL,
    qty           INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    type          TEXT NOT NULL,
    unit_cost     INTEGER,
    ref_type      TEXT,
    ref_id        INTEGER,
    ref_no        TEXT,
    note          TEXT NOT NULL DEFAULT '',
    user          TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX ix_moves_product ON stock_movements(product_id, id);
  CREATE INDEX ix_moves_date ON stock_movements(created_at);

  CREATE TABLE customers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL DEFAULT '',
    address         TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    opening_balance INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ux_customers_phone ON customers(phone) WHERE phone <> '' AND is_active = 1;
  CREATE INDEX ix_customers_name ON customers(name COLLATE NOCASE);

  CREATE TABLE sales (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no      TEXT NOT NULL UNIQUE,
    created_at      TEXT NOT NULL,
    customer_id     INTEGER REFERENCES customers(id),
    customer_name   TEXT NOT NULL DEFAULT 'Walk-in Customer',
    customer_phone  TEXT NOT NULL DEFAULT '',
    subtotal        INTEGER NOT NULL,
    discount_type   TEXT NOT NULL DEFAULT 'flat',
    discount_value  REAL NOT NULL DEFAULT 0,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL CHECK (total >= 0),
    cost_total      INTEGER NOT NULL DEFAULT 0,
    returned_total  INTEGER NOT NULL DEFAULT 0,
    returned_cost   INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'completed',
    note            TEXT NOT NULL DEFAULT '',
    cashier         TEXT NOT NULL DEFAULT '',
    edited_at       TEXT,
    edit_count      INTEGER NOT NULL DEFAULT 0,
    is_legacy       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ix_sales_date ON sales(created_at);
  CREATE INDEX ix_sales_customer ON sales(customer_id, created_at);

  CREATE TABLE sale_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id        INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id     INTEGER NOT NULL REFERENCES products(id),
    product_name   TEXT NOT NULL,
    sku            TEXT NOT NULL DEFAULT '',
    qty            INTEGER NOT NULL CHECK (qty > 0),
    std_price      INTEGER NOT NULL,
    unit_price     INTEGER NOT NULL CHECK (unit_price >= 0),
    cost_price     INTEGER NOT NULL DEFAULT 0,
    line_subtotal  INTEGER NOT NULL,
    discount_share INTEGER NOT NULL DEFAULT 0,
    line_total     INTEGER NOT NULL,
    returned_qty   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ix_items_sale ON sale_items(sale_id);
  CREATE INDEX ix_items_product ON sale_items(product_id);

  CREATE TABLE returns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    return_no     TEXT NOT NULL UNIQUE,
    sale_id       INTEGER NOT NULL REFERENCES sales(id),
    created_at    TEXT NOT NULL,
    customer_id   INTEGER REFERENCES customers(id),
    kind          TEXT NOT NULL DEFAULT 'return',
    total         INTEGER NOT NULL,
    cost_total    INTEGER NOT NULL DEFAULT 0,
    refund_amount INTEGER NOT NULL DEFAULT 0,
    restocked     INTEGER NOT NULL DEFAULT 1,
    reason        TEXT NOT NULL DEFAULT '',
    cashier       TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX ix_returns_sale ON returns(sale_id);
  CREATE INDEX ix_returns_date ON returns(created_at);

  CREATE TABLE return_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id    INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
    product_id   INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    qty          INTEGER NOT NULL CHECK (qty > 0),
    amount       INTEGER NOT NULL,
    cost         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ix_return_items_return ON return_items(return_id);
  CREATE INDEX ix_return_items_product ON return_items(product_id);

  -- Every rupee that moves: +amount = money received, -amount = money paid out (refund).
  CREATE TABLE payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    sale_id     INTEGER REFERENCES sales(id),
    return_id   INTEGER REFERENCES returns(id),
    with_sale_id INTEGER REFERENCES sales(id),  -- old-udhaar receipt taken at the counter together with this invoice
    amount      INTEGER NOT NULL,
    method      TEXT NOT NULL DEFAULT 'Cash',
    kind        TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    cashier     TEXT NOT NULL DEFAULT '',
    voided      INTEGER NOT NULL DEFAULT 0,
    voided_at   TEXT,
    void_reason TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX ix_payments_customer ON payments(customer_id, created_at);
  CREATE INDEX ix_payments_sale ON payments(sale_id);
  CREATE INDEX ix_payments_date ON payments(created_at);

  CREATE TABLE expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'General',
    amount     INTEGER NOT NULL CHECK (amount > 0),
    method     TEXT NOT NULL DEFAULT 'Cash',
    note       TEXT NOT NULL DEFAULT '',
    cashier    TEXT NOT NULL DEFAULT '',
    voided     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ix_expenses_date ON expenses(date);

  CREATE TABLE drafts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL
  );

  CREATE TABLE sale_revisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id    INTEGER NOT NULL REFERENCES sales(id),
    created_at TEXT NOT NULL,
    user       TEXT NOT NULL DEFAULT '',
    summary    TEXT NOT NULL DEFAULT '',
    snapshot   TEXT NOT NULL
  );
  CREATE INDEX ix_revisions_sale ON sale_revisions(sale_id);

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    user       TEXT NOT NULL DEFAULT '',
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL DEFAULT '',
    entity_id  INTEGER,
    details    TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX ix_audit_date ON audit_log(created_at);
  `
];

class Store {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = FULL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.depth = 0;
    this.stmtCache = new Map();
    this.migrate();
  }

  migrate() {
    const version = Number(this.db.prepare('PRAGMA user_version').get().user_version);
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  stmt(sql) {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  all(sql, ...params) { return this.stmt(sql).all(...params); }
  get(sql, ...params) { return this.stmt(sql).get(...params); }
  run(sql, ...params) { return this.stmt(sql).run(...params); }
  value(sql, ...params) {
    const row = this.get(sql, ...params);
    return row ? Object.values(row)[0] : undefined;
  }

  /** Run fn atomically. Nested calls become savepoints. */
  tx(fn) {
    const sp = `sp${this.depth}`;
    this.db.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.depth--;
      this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }

  meta(key, value) {
    if (value === undefined) return this.value('SELECT value FROM meta WHERE key = ?', key);
    this.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
    return value;
  }

  checkpoint() {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (_) { /* ignore */ }
  }

  close() {
    this.checkpoint();
    this.stmtCache.clear();
    this.db.close();
  }
}

module.exports = { Store, SCHEMA_VERSION: MIGRATIONS.length };
