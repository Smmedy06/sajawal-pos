'use strict';
const { str, fail } = require('../util');

const DEFAULTS = {
  business_name: 'Sajawal POS',
  business_address: 'Shop # 14, Commercial Market, MM Alam Road, Gulberg III, Lahore',
  business_phone: '+92 321 4829100',
  business_email: '',
  business_tagline: 'Beauty & Cosmetics',
  receipt_footer: 'Thank you for shopping with us!',
  invoice_terms: 'Exchange within 3 days with original bill. Opened cosmetics are not returnable.',
  currency_symbol: 'Rs.',
  markup_percentage: 20,
  low_stock_default: 5,
  expiry_alert_days: 60,
  allow_negative_stock: false,
  cashier_name: 'Sajawal Khan',
  invoice_prefix: 'INV-',
  payment_methods: ['Cash', 'Bank Transfer', 'EasyPaisa', 'JazzCash', 'Card'],
  expense_categories: ['Rent', 'Electricity', 'Salaries', 'Transport', 'Supplies', 'Maintenance', 'Other'],
  print: {
    receipt_width: 80,          // 80 or 58 (mm)
    default_format: 'thermal',  // thermal | a5 | a4 | none
    receipt_printer: '',
    a5_printer: '',
    a4_printer: '',
    silent: false,              // print straight to the chosen printer without a dialog
    margin_mm: 8                // safe margin for A4/A5 so nothing is clipped
  },
  privacy: {
    hide_tile_prices: true      // product tiles on the Sell screen show no prices by default
  },
  security: {
    pin_hash: '',
    pin_salt: '',
    recovery_hash: '',
    locked_pages: [],
    protected_actions: ['settings', 'deleteProduct', 'editSale', 'cancelSale', 'voidPayment', 'restoreBackup', 'clearData'],
    auto_lock_minutes: 10
  },
  backup: {
    mirror_dir: '',             // optional second folder (USB / D: drive) for automatic backups
    keep: 30
  }
};

const SECRET_KEYS = ['pin_hash', 'pin_salt', 'recovery_hash'];

module.exports = function settingsService(ctx) {
  const { store } = ctx;
  let cache = null;

  function load() {
    if (cache) return cache;
    const rows = store.all('SELECT key, value FROM settings');
    const saved = {};
    for (const r of rows) {
      try { saved[r.key] = JSON.parse(r.value); } catch (_) { /* skip corrupt key */ }
    }
    const merged = {};
    for (const [k, def] of Object.entries(DEFAULTS)) {
      if (def && typeof def === 'object' && !Array.isArray(def)) merged[k] = { ...def, ...(saved[k] || {}) };
      else merged[k] = saved[k] !== undefined ? saved[k] : def;
    }
    cache = merged;
    return cache;
  }

  function write(key, value) {
    store.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
    cache = null;
  }

  /** Settings safe to hand to the renderer (secrets removed). */
  function getPublic() {
    const s = JSON.parse(JSON.stringify(load()));
    s.security.pin_enabled = !!s.security.pin_hash;
    for (const k of SECRET_KEYS) delete s.security[k];
    return s;
  }

  function sanitizeList(list, fallback) {
    if (!Array.isArray(list)) return fallback;
    const out = [...new Set(list.map((x) => str(x, 40)).filter(Boolean))];
    return out.length ? out : fallback;
  }

  /** Update non-secret settings. Unknown keys are ignored. */
  function update(patch = {}) {
    const cur = load();
    const changes = [];
    return store.tx(() => {
      const textKeys = ['business_name', 'business_address', 'business_phone', 'business_email', 'business_tagline',
        'receipt_footer', 'invoice_terms', 'currency_symbol', 'cashier_name', 'invoice_prefix'];
      for (const k of textKeys) {
        if (patch[k] === undefined) continue;
        const v = str(patch[k], k === 'invoice_terms' ? 600 : 200);
        if (['business_name', 'currency_symbol', 'cashier_name'].includes(k) && !v) fail(`${k.replace(/_/g, ' ')} cannot be empty`);
        if (v !== cur[k]) { write(k, v); changes.push(k); }
      }
      const numKeys = { markup_percentage: [0, 1000], low_stock_default: [0, 100000], expiry_alert_days: [0, 3650] };
      for (const [k, [min, max]] of Object.entries(numKeys)) {
        if (patch[k] === undefined) continue;
        const n = Number(patch[k]);
        if (!Number.isFinite(n) || n < min || n > max) fail(`${k.replace(/_/g, ' ')} must be between ${min} and ${max}`);
        if (n !== cur[k]) { write(k, n); changes.push(k); }
      }
      if (patch.allow_negative_stock !== undefined && !!patch.allow_negative_stock !== cur.allow_negative_stock) {
        write('allow_negative_stock', !!patch.allow_negative_stock); changes.push('allow_negative_stock');
      }
      if (patch.payment_methods !== undefined) {
        const list = sanitizeList(patch.payment_methods, cur.payment_methods);
        if (!list.includes('Cash')) list.unshift('Cash');
        write('payment_methods', list); changes.push('payment_methods');
      }
      if (patch.expense_categories !== undefined) {
        write('expense_categories', sanitizeList(patch.expense_categories, cur.expense_categories)); changes.push('expense_categories');
      }
      if (patch.print) {
        const p = { ...cur.print };
        if (patch.print.receipt_width !== undefined) p.receipt_width = Number(patch.print.receipt_width) === 58 ? 58 : 80;
        if (patch.print.default_format !== undefined) p.default_format = ['thermal', 'a5', 'a4', 'none'].includes(patch.print.default_format) ? patch.print.default_format : 'thermal';
        for (const k of ['receipt_printer', 'a5_printer', 'a4_printer']) if (patch.print[k] !== undefined) p[k] = str(patch.print[k], 200);
        if (patch.print.silent !== undefined) p.silent = !!patch.print.silent;
        if (patch.print.margin_mm !== undefined) p.margin_mm = Math.min(25, Math.max(3, Number(patch.print.margin_mm) || 8));
        write('print', p); changes.push('print');
      }
      if (patch.privacy) {
        write('privacy', { ...cur.privacy, hide_tile_prices: !!patch.privacy.hide_tile_prices }); changes.push('privacy');
      }
      if (patch.backup) {
        const b = { ...cur.backup };
        if (patch.backup.mirror_dir !== undefined) b.mirror_dir = str(patch.backup.mirror_dir, 500);
        if (patch.backup.keep !== undefined) b.keep = Math.min(365, Math.max(5, Number(patch.backup.keep) || 30));
        write('backup', b); changes.push('backup');
      }
      if (patch.security) {
        const sec = { ...cur.security };
        const PAGES = ['dashboard', 'sell', 'sales', 'customers', 'products', 'inventory', 'reports', 'expenses', 'activity'];
        const ACTIONS = ['settings', 'deleteProduct', 'editProduct', 'adjustStock', 'editSale', 'returnSale', 'cancelSale', 'voidPayment', 'restoreBackup', 'clearData', 'viewProfit'];
        if (patch.security.locked_pages !== undefined) sec.locked_pages = (patch.security.locked_pages || []).filter((p) => PAGES.includes(p));
        if (patch.security.protected_actions !== undefined) {
          sec.protected_actions = (patch.security.protected_actions || []).filter((a) => ACTIONS.includes(a));
          if (!sec.protected_actions.includes('settings')) sec.protected_actions.push('settings');
        }
        if (patch.security.auto_lock_minutes !== undefined) sec.auto_lock_minutes = Math.min(240, Math.max(0, Number(patch.security.auto_lock_minutes) || 0));
        write('security', sec); changes.push('security');
      }
      if (changes.length) ctx.audit('Settings Updated', 'settings', null, `Changed: ${changes.join(', ').replace(/_/g, ' ')}`);
      return getPublic();
    });
  }

  return {
    DEFAULTS,
    get: load,
    getPublic,
    update,
    writeRaw: write,
    invalidate() { cache = null; }
  };
};
