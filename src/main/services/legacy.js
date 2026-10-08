'use strict';
/*
 * One-time import of the v1.x data that lived in the browser's localStorage
 * (keys sajawal_*). Runs in a single transaction: either everything is
 * imported or nothing is. The old localStorage data is never deleted.
 *
 * Repairs v1 problems while importing:
 *  - duplicate random product IDs (C3) are matched by ID + name snapshot,
 *  - duplicate product names get a "(2)" suffix instead of failing,
 *  - products that were deleted in v1 but appear on old invoices are
 *    re-created as archived products so history stays complete,
 *  - customers identified only by name become real customer records,
 *  - UTC timestamps become local shop time.
 */
const { P, now, toLocalStamp, str } = require('../util');

function arr(x) { return Array.isArray(x) ? x : []; }

module.exports = function legacyService(ctx) {
  const { store } = ctx;

  function status() {
    return {
      imported: !!store.meta('legacy_imported_at'),
      imported_at: store.meta('legacy_imported_at') || null,
      empty: Number(store.value('SELECT COUNT(*) FROM products')) === 0 && Number(store.value('SELECT COUNT(*) FROM sales')) === 0
    };
  }

  function importData(payload = {}) {
    if (store.meta('legacy_imported_at')) return { skipped: true, reason: 'already imported' };
    if (!status().empty) return { skipped: true, reason: 'database already has data' };
    const products = arr(payload.products);
    const sales = arr(payload.sales);
    const repayments = arr(payload.repayments);
    const logs = arr(payload.activity);
    const drafts = arr(payload.drafts);
    const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : null;

    const report = { products: 0, archived_products: 0, customers: 0, sales: 0, payments: 0, repayments: 0, logs: 0, drafts: 0, renamed: [] };

    store.tx(() => {
      const ts = now();
      // ---- settings
      if (settings) {
        const patch = {};
        for (const k of ['business_name', 'business_address', 'business_phone', 'currency_symbol', 'cashier_name']) {
          if (settings[k]) patch[k] = settings[k];
        }
        if (Number.isFinite(Number(settings.markup_percentage))) patch.markup_percentage = Math.max(0, Number(settings.markup_percentage));
        if (Number(settings.printer_width_mm) === 58) patch.print = { receipt_width: 58 };
        try { ctx.settings.update(patch); } catch (_) { /* keep defaults on bad legacy values */ }
      }

      // ---- products
      const byLegacy = new Map(); // legacy id -> [{ newId, name }]
      const usedNames = new Set();
      const uniqueName = (name) => {
        let n = str(name, 160) || 'Unnamed product';
        let candidate = n;
        let i = 2;
        while (usedNames.has(candidate.toLowerCase())) candidate = `${n} (${i++})`;
        if (candidate !== n) report.renamed.push(`${n} → ${candidate}`);
        usedNames.add(candidate.toLowerCase());
        return candidate;
      };
      const insertProduct = (p, active, stockQty, createdAt) => {
        const name = uniqueName(p.name);
        const res = store.run(
          `INSERT INTO products(name, sku, category, cost_price, sell_price, stock_qty, is_active, legacy_id, created_at, updated_at)
           VALUES (?,?,?,?,?,0,?,?,?,?)`,
          name, null, '', Math.max(0, P(p.cost_price || 0)),
          p.selling_price === null || p.selling_price === undefined || p.selling_price === '' ? null : Math.max(0, P(p.selling_price)),
          active ? 1 : 0, String(p.id || ''), createdAt, ts
        );
        const id = Number(res.lastInsertRowid);
        const list = byLegacy.get(String(p.id)) || [];
        list.push({ id, name: String(p.name || '').trim().toLowerCase() });
        byLegacy.set(String(p.id), list);
        return id;
      };
      for (const p of products) {
        const created = p.created_at ? toLocalStamp(p.created_at) : ts;
        const id = insertProduct(p, true, 0, created);
        const qty = Math.trunc(Number(p.stock_qty) || 0);
        if (qty) ctx.products.moveStock(id, qty, 'opening', { note: 'Opening stock (moved from v1.2)', allowNegative: true });
        report.products++;
      }
      const resolveProduct = (legacyId, nameSnapshot, item) => {
        const list = byLegacy.get(String(legacyId)) || [];
        const nm = String(nameSnapshot || '').trim().toLowerCase();
        let hit = list.find((x) => x.name === nm) || null;
        if (!hit) {
          // match by name among all imported products (IDs may have collided)
          for (const l of byLegacy.values()) { hit = l.find((x) => x.name === nm); if (hit) break; }
        }
        if (!hit && list.length === 1 && !nm) hit = list[0];
        if (hit) return hit.id;
        const id = insertProduct({ id: legacyId, name: nameSnapshot || 'Deleted product', cost_price: item.cost_price_snapshot, selling_price: item.unit_price_snapshot }, false, 0, ts);
        report.archived_products++;
        return id;
      };

      // ---- customers (from names on sales & repayments)
      const customerIds = new Map();
      const customerFor = (name, when) => {
        const n = str(name, 100);
        if (!n || n.toLowerCase() === 'walk-in customer' || n.toLowerCase() === 'walk-in') return null;
        const key = n.toLowerCase();
        if (customerIds.has(key)) return customerIds.get(key);
        const looksLikePhone = /^[+\d][\d\s-]{6,}$/.test(n);
        const res = store.run('INSERT INTO customers(name, phone, created_at, updated_at) VALUES (?,?,?,?)',
          n, looksLikePhone ? n.replace(/[^\d+]/g, '') : '', when || ts, ts);
        const id = Number(res.lastInsertRowid);
        customerIds.set(key, id);
        report.customers++;
        return id;
      };

      // ---- sales, oldest first
      const sortedSales = [...sales].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const usedInvoices = new Set();
      for (const s of sortedSales) {
        const items = arr(s.items).filter((i) => Number(i.quantity) > 0);
        if (!items.length) continue;
        const created = s.created_at ? toLocalStamp(s.created_at) : ts;
        const customerId = customerFor(s.customer_name, created);
        let invoiceNo = str(s.invoice_number || s.id, 40) || `INV-L${report.sales + 1}`;
        while (usedInvoices.has(invoiceNo)) invoiceNo = `${invoiceNo}-D`;
        usedInvoices.add(invoiceNo);

        const lines = items.map((i) => {
          const qty = Math.trunc(Number(i.quantity));
          const unit = Math.max(0, P(i.unit_price_snapshot || 0));
          const cost = Math.max(0, P(i.cost_price_snapshot || 0));
          return {
            product_id: resolveProduct(i.product_id, i.product_name_snapshot, i),
            product_name: str(i.product_name_snapshot, 160) || 'Item', qty, unit, cost, sub: unit * qty
          };
        });
        const subtotal = lines.reduce((a, l) => a + l.sub, 0);
        const total = Math.max(0, Math.min(subtotal, P(s.total ?? subtotal)));
        const discount = subtotal - total;
        let allocated = 0;
        lines.forEach((l) => { l.share = subtotal ? Math.floor((discount * l.sub) / subtotal) : 0; allocated += l.share; });
        if (lines.length) lines[0].share += discount - allocated;
        const costTotal = lines.reduce((a, l) => a + l.cost * l.qty, 0);
        const res = store.run(
          `INSERT INTO sales(invoice_no, created_at, customer_id, customer_name, subtotal, discount_type, discount_value, discount_amount, total, cost_total,
                             cashier, edited_at, edit_count, is_legacy)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
          invoiceNo, created, customerId, customerId ? str(s.customer_name, 100) : 'Walk-in Customer', subtotal,
          s.discount_type === 'percent' ? 'percent' : 'flat', Number(s.discount_value) || 0, discount, total, costTotal,
          str(s.cashier_name, 60), s.edited_at ? toLocalStamp(s.edited_at) : null, s.edited_at ? 1 : 0
        );
        const saleId = Number(res.lastInsertRowid);
        for (const l of lines) {
          store.run(
            `INSERT INTO sale_items(sale_id, product_id, product_name, qty, std_price, unit_price, cost_price, line_subtotal, discount_share, line_total)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            saleId, l.product_id, l.product_name, l.qty, l.unit, l.unit, l.cost, l.sub, l.share, l.sub - l.share
          );
        }
        // Money actually received at the counter. v1 stored amount_paid correctly (only its display was wrong).
        let paid = s.amount_paid === undefined || s.amount_paid === null ? total : P(s.amount_paid);
        paid = Math.max(0, Math.min(total, paid));
        if (!customerId) paid = total; // v1 never allowed credit for walk-in
        if (paid > 0) {
          const method = s.payment_method && s.payment_method !== 'Credit / Udhaar' ? (s.payment_method === 'Transfer' ? 'Bank Transfer' : s.payment_method) : 'Cash';
          store.run('INSERT INTO payments(created_at, customer_id, sale_id, amount, method, kind, note, cashier) VALUES (?,?,?,?,?,?,?,?)',
            created, customerId, saleId, paid, method, 'sale', 'Moved from v1.2', str(s.cashier_name, 60));
          report.payments++;
        }
        report.sales++;
      }

      // ---- repayments (v1 credit ledger)
      for (const r of repayments) {
        const amt = P(r.amount || 0);
        if (amt <= 0) continue;
        const created = r.timestamp ? toLocalStamp(r.timestamp) : ts;
        const cid = customerFor(r.customer_name, created);
        if (!cid) continue;
        const method = r.payment_method === 'Transfer' ? 'Bank Transfer' : (r.payment_method || 'Cash');
        store.run('INSERT INTO payments(created_at, customer_id, amount, method, kind, note, cashier) VALUES (?,?,?,?,?,?,?)',
          created, cid, amt, ctx.settings.get().payment_methods.includes(method) ? method : 'Cash', 'receipt', str(r.notes, 200) || 'Moved from v1.2', str(r.cashier_name, 60));
        report.repayments++;
      }

      // ---- activity log (oldest first so IDs follow time)
      for (const l of [...logs].reverse()) {
        store.run('INSERT INTO audit_log(created_at, user, action, entity, details) VALUES (?,?,?,?,?)',
          l.timestamp ? toLocalStamp(l.timestamp) : ts, str(l.user, 60), str(l.action, 60) || 'Activity', 'legacy', str(l.details, 2000));
        report.logs++;
      }

      // ---- parked drafts
      for (const d of drafts) {
        const items = arr(d.cart).map((c) => {
          const pid = c.product ? resolveProduct(c.product.id, c.product.name, {}) : null;
          if (!pid) return null;
          const custom = c.custom_unit_price !== undefined && c.custom_unit_price !== null && c.custom_unit_price !== '';
          return { product_id: pid, qty: Math.max(1, Math.trunc(Number(c.quantity) || 1)), unit_price: custom ? Number(c.custom_unit_price) : null };
        }).filter(Boolean);
        if (!items.length) continue;
        const data = { items, discount_type: d.discount_type === 'percent' ? 'percent' : 'flat', discount_value: Number(d.discount_value) || 0, customer_id: null, customer_label: str(d.customer_name, 100) };
        store.run('INSERT INTO drafts(created_at, label, data) VALUES (?,?,?)', d.timestamp ? toLocalStamp(d.timestamp) : ts, str(d.customer_name, 80) || 'Parked sale', JSON.stringify(data));
        report.drafts++;
      }

      // Invoice numbering continues after the highest imported number.
      store.meta('invoice_seq', 0);
      store.run("DELETE FROM meta WHERE key = 'invoice_seq'");
      store.meta('legacy_imported_at', ts);
      store.meta('legacy_report', JSON.stringify(report));
      ctx.audit('Data Migrated', 'system', null,
        `Moved v1.2 data into the new database: ${report.products} products, ${report.sales} invoices, ${report.customers} customers, ${report.repayments} repayments, ${report.logs} log entries` +
        (report.archived_products ? `, ${report.archived_products} deleted products restored as archived` : '') +
        (report.renamed.length ? `. Renamed duplicates: ${report.renamed.join('; ')}` : ''));
    });
    return report;
  }

  /** Mark migration done when there is nothing to import (fresh install). */
  function markNone() {
    if (!store.meta('legacy_imported_at')) store.meta('legacy_imported_at', 'none');
    return true;
  }

  return { status, importData, markNone };
};
