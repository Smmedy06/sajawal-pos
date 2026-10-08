'use strict';
/*
 * Composes all services around one Store and exposes the API table used by IPC.
 * Each API entry may name a protected action; when the owner PIN is enabled and
 * the session is locked, those calls are refused here in the main process —
 * hiding a button in the UI is not the only line of defence.
 */
const settingsService = require('./settings');
const authService = require('./auth');
const productsService = require('./products');
const customersService = require('./customers');
const salesService = require('./sales');
const paymentsService = require('./payments');
const reportsService = require('./reports');
const legacyService = require('./legacy');
const { AppError } = require('../util');

function createServices(store) {
  const ctx = { store };
  ctx.user = () => {
    try { return ctx.settings.get().cashier_name || 'Staff'; } catch (_) { return 'Staff'; }
  };
  ctx.settings = settingsService(ctx);
  ctx.payments = paymentsService(ctx);
  ctx.audit = ctx.payments.audit;
  ctx.auth = authService(ctx);
  ctx.products = productsService(ctx);
  ctx.customers = customersService(ctx);
  ctx.sales = salesService(ctx);
  ctx.reports = reportsService(ctx);
  ctx.legacy = legacyService(ctx);

  const a = (fn, action) => ({ fn, action });
  const viewProfit = 'viewProfit';

  // name -> { fn(args), action? }
  ctx.api = {
    'settings.get': a(() => ctx.settings.getPublic()),
    'settings.update': a((p) => ctx.settings.update(p), 'settings'),

    'auth.status': a(() => ctx.auth.status()),
    'auth.unlock': a((p) => ctx.auth.unlock(p && p.pin)),
    'auth.lock': a(() => ctx.auth.lock()),
    'auth.setPin': a((p) => ctx.auth.setPin(p || {})),
    'auth.disablePin': a((p) => ctx.auth.disablePin(p || {})),
    'auth.recover': a((p) => ctx.auth.recover(p || {})),
    'auth.allowed': a((p) => ctx.auth.isAllowed(p && p.action)),

    'products.list': a((p) => ctx.products.list(p)),
    'products.get': a((p) => ctx.products.get(p.id)),
    'products.detail': a((p) => ctx.products.detail(p.id, p)),
    'products.forSale': a(() => ctx.products.forSale()),
    'products.categories': a(() => ctx.products.categories()),
    'products.findBySku': a((p) => ctx.products.findBySku(p.sku)),
    'products.create': a((p) => ctx.products.create(p), 'editProduct'),
    'products.update': a((p) => ctx.products.update(p.id, p), 'editProduct'),
    'products.archive': a((p) => ctx.products.archive(p.id), 'deleteProduct'),
    'products.restore': a((p) => ctx.products.restore(p.id), 'editProduct'),
    'products.import': a((p) => importProducts(ctx, p), 'editProduct'),

    'inventory.adjust': a((p) => ctx.products.adjust(p), 'adjustStock'),
    'inventory.receive': a((p) => ctx.products.receive(p), 'adjustStock'),
    'inventory.movements': a((p) => ctx.products.movements(p)),
    'inventory.summary': a(() => ctx.products.summary()),

    'customers.list': a((p) => ctx.customers.list(p)),
    'customers.search': a((p) => ctx.customers.search(p.q, p.limit)),
    'customers.get': a((p) => ctx.customers.get(p.id)),
    'customers.create': a((p) => ctx.customers.create(p)),
    'customers.update': a((p) => ctx.customers.update(p.id, p)),
    'customers.archive': a((p) => ctx.customers.archive(p.id)),
    'customers.ledger': a((p) => ctx.customers.ledger(p.id, p)),
    'customers.products': a((p) => ctx.customers.products(p.id, p)),

    'sales.create': a((p) => ctx.sales.create(p)),
    'sales.update': a((p) => ctx.sales.update(p.id, p), 'editSale'),
    'sales.get': a((p) => ctx.sales.get(p.id)),
    'sales.list': a((p) => ctx.sales.list(p)),
    'sales.returnQuote': a((p) => ctx.sales.returnQuote(p)),
    'sales.return': a((p) => ctx.sales.createReturn(p), 'returnSale'),
    'sales.cancel': a((p) => ctx.sales.cancel(p), 'cancelSale'),
    'sales.returns': a((p) => ctx.sales.listReturns(p)),
    'drafts.save': a((p) => ctx.sales.saveDraft(p)),
    'drafts.list': a(() => ctx.sales.listDrafts()),
    'drafts.delete': a((p) => ctx.sales.deleteDraft(p.id)),

    'payments.receive': a((p) => ctx.payments.receive(p)),
    'payments.void': a((p) => ctx.payments.voidPayment(p.id, p.reason), 'voidPayment'),
    'payments.get': a((p) => ctx.payments.get(p.id)),
    'payments.list': a((p) => ctx.payments.list(p)),
    'expenses.add': a((p) => ctx.payments.addExpense(p)),
    'expenses.void': a((p) => ctx.payments.voidExpense(p.id, p.reason), 'settings'),
    'expenses.list': a((p) => ctx.payments.listExpenses(p)),
    'activity.list': a((p) => ctx.payments.activity(p)),

    'reports.dashboard': a((p) => {
      const d = ctx.reports.dashboard(p);
      if (ctx.auth.isAllowed(viewProfit)) return d;
      // Profit is locked: keep sales figures, hide cost & profit.
      const hide = (t) => { for (const k of ['cogs', 'gross_profit', 'margin', 'net_profit']) t[k] = null; };
      hide(d.totals); hide(d.previous.totals);
      d.series.forEach((s) => { s.cogs = null; s.gross_profit = null; s.net_profit = null; });
      d.profit_hidden = true;
      return d;
    }),
    'reports.profit': a((p) => ctx.reports.profit(p), viewProfit),
    'reports.cashbook': a((p) => ctx.reports.cashbook(p)),
    'reports.receivables': a(() => ctx.reports.receivables()),
    'reports.stock': a(() => ctx.reports.stockValuation()),

    'legacy.status': a(() => ctx.legacy.status()),
    'legacy.import': a((p) => ctx.legacy.importData(p)),
    'legacy.markNone': a(() => ctx.legacy.markNone())
  };

  /** Dispatch an API call; returns {ok, data} or {ok:false, error}. */
  ctx.call = (name, payload) => {
    const entry = ctx.api[name];
    if (!entry) return { ok: false, error: { message: `Unknown action: ${name}`, code: 'UNKNOWN' } };
    try {
      if (entry.action) ctx.auth.require(entry.action);
      const data = entry.fn(payload || {});
      return { ok: true, data };
    } catch (err) {
      const known = err instanceof AppError;
      if (!known) console.error(`[api] ${name} failed:`, err);
      let message = known ? err.message : 'Something went wrong. Nothing was saved. Please try again.';
      if (!known && /UNIQUE constraint failed/i.test(String(err.message))) message = 'This record already exists (duplicate).';
      return { ok: false, error: { message, code: known ? err.code : 'INTERNAL', detail: known ? undefined : String(err.message) } };
    }
  };

  return ctx;
}

/**
 * Excel import (rows already parsed & mapped in the renderer).
 * mode for existing names: 'skip' | 'add_stock' | 'update'
 */
function importProducts(ctx, { rows = [], mode = 'skip' } = {}) {
  const { fail, int } = require('../util');
  if (!Array.isArray(rows) || !rows.length) fail('No rows to import', 'VALIDATION');
  if (rows.length > 20000) fail('Too many rows in one import (max 20,000)', 'VALIDATION');
  const result = { created: 0, updated: 0, stock_added: 0, skipped: 0, errors: [] };
  return ctx.store.tx(() => {
    rows.forEach((r, idx) => {
      const rowNo = r.row || idx + 2;
      try {
        ctx.store.tx(() => {
          const name = String(r.name || '').trim();
          if (!name) fail('Name is empty');
          const existing = ctx.store.get('SELECT * FROM products WHERE is_active = 1 AND name = ? COLLATE NOCASE', name);
          const stock = r.stock_qty === undefined || r.stock_qty === null || r.stock_qty === '' ? 0 : int(r.stock_qty, 'Stock');
          if (stock < 0) fail('Stock cannot be negative');
          if (!existing) {
            ctx.products.create({ ...r, name, stock_qty: stock, stock_note: 'Excel import' }, { movementType: 'import', silent: true });
            result.created++;
          } else if (mode === 'add_stock') {
            if (stock > 0) ctx.products.moveStock(existing.id, stock, 'import', { note: 'Excel import (added to existing stock)' });
            result.stock_added++;
          } else if (mode === 'update') {
            const patch = {};
            for (const k of ['sku', 'category', 'brand', 'supplier', 'cost_price', 'sell_price', 'low_stock_level', 'expiry_date']) {
              if (r[k] !== undefined && r[k] !== null && r[k] !== '') patch[k] = r[k];
            }
            ctx.products.update(existing.id, patch);
            if (stock > 0) ctx.products.moveStock(existing.id, stock, 'import', { note: 'Excel import (added to existing stock)' });
            result.updated++;
          } else {
            result.skipped++;
          }
        });
      } catch (e) {
        result.errors.push({ row: rowNo, name: r.name || '', message: e.message });
      }
    });
    ctx.audit('Excel Import', 'product', null,
      `Imported products: ${result.created} new, ${result.updated} updated, ${result.stock_added} stock top-ups, ${result.skipped} skipped, ${result.errors.length} errors`);
    return result;
  });
}

module.exports = { createServices };
