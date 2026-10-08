'use strict';
/*
 * Business-logic tests: run with `npm test`.
 * Each test uses a fresh in-memory database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/main/db');
const { createServices } = require('../src/main/services');

function setup() {
  const ctx = createServices(new Store(':memory:'));
  const call = (name, payload) => {
    const r = ctx.call(name, payload);
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.data;
  };
  const fails = (name, payload, re) => {
    const r = ctx.call(name, payload);
    assert.equal(r.ok, false, `${name} should have failed`);
    if (re) assert.match(r.error.message, re);
    return r.error;
  };
  return { ctx, call, fails };
}

function seed(call) {
  const lipstick = call('products.create', { name: 'MAC Lipstick', cost_price: 5800, sell_price: 7200, stock_qty: 20, category: 'Lips' });
  const serum = call('products.create', { name: 'Niacinamide Serum', cost_price: 2400, stock_qty: 10, category: 'Skin' }); // markup 20% -> 2880
  const ali = call('customers.create', { name: 'Ali Raza', phone: '0300-1234567' });
  return { lipstick, serum, ali };
}

test('markup price, stock and opening movement', () => {
  const { call } = setup();
  const { serum } = seed(call);
  assert.equal(serum.price, 2880);
  assert.equal(serum.stock_qty, 10);
  const mv = call('inventory.movements', { product_id: serum.id });
  assert.equal(mv.rows.length, 1);
  assert.equal(mv.rows[0].type, 'opening');
  assert.equal(mv.rows[0].balance_after, 10);
});

test('walk-in sale: stock deducted, payment recorded, change from cash', () => {
  const { call } = setup();
  const { lipstick, serum } = seed(call);
  const res = call('sales.create', {
    items: [{ product_id: lipstick.id, qty: 2 }, { product_id: serum.id, qty: 1 }],
    payments: [{ method: 'Cash', amount: 20000 }]
  });
  assert.equal(res.sale.total, 17280);
  assert.equal(res.summary.change, 2720);
  assert.equal(res.sale.paid_at_sale, 17280);
  assert.equal(call('products.get', { id: lipstick.id }).stock_qty, 18);
  assert.equal(res.sale.invoice_no, 'INV-1001');
  const cb = call('reports.cashbook', {});
  assert.equal(cb.totals.sales_collected, 17280);
});

test('walk-in cannot take udhaar; overselling is blocked and rolled back', () => {
  const { call, fails } = setup();
  const { lipstick, serum } = seed(call);
  fails('sales.create', { items: [{ product_id: lipstick.id, qty: 1 }], payments: [{ method: 'Cash', amount: 100 }] }, /paid in full/);
  fails('sales.create', { items: [{ product_id: serum.id, qty: 1 }, { product_id: lipstick.id, qty: 50 }], payments: [{ method: 'Cash', amount: 999999 }] }, /Not enough stock/);
  // nothing from the failed sale may remain
  assert.equal(call('products.get', { id: serum.id }).stock_qty, 10);
  assert.equal(call('sales.list', {}).total, 0);
});

test('credit sale, then old udhaar + new bill paid together (feature #12)', () => {
  const { call } = setup();
  const { lipstick, serum, ali } = seed(call);
  const s1 = call('sales.create', { customer_id: ali.id, items: [{ product_id: lipstick.id, qty: 1 }], payments: [{ method: 'Cash', amount: 2000 }] });
  assert.equal(s1.sale.payment_status, 'partial');
  assert.equal(s1.sale.due, 5200);
  assert.equal(call('customers.get', { id: ali.id }).balance, 5200);
  // second visit: bill 2880, pays 8080 = bill + all old udhaar
  const s2 = call('sales.create', { customer_id: ali.id, items: [{ product_id: serum.id, qty: 1 }], payments: [{ method: 'Cash', amount: 5000 }, { method: 'EasyPaisa', amount: 3080 }] });
  assert.equal(s2.summary.previous_balance, 5200);
  assert.equal(s2.summary.old_balance_received, 5200);
  assert.equal(s2.summary.change, 0);
  assert.equal(s2.summary.new_balance, 0);
  assert.equal(call('customers.get', { id: ali.id }).balance, 0);
  // first invoice now shows paid via FIFO allocation
  assert.equal(call('sales.get', { id: s1.sale.id }).payment_status, 'paid');
  // printed "previous balance" on 2nd bill is the balance before it
  const g2 = call('sales.get', { id: s2.sale.id });
  assert.equal(g2.previous_balance, 5200);
  assert.equal(g2.received_with_sale, 5200);
  assert.equal(g2.balance_after_sale, 0);
  const led = call('customers.ledger', { id: ali.id });
  assert.equal(led.closing_balance, 0);
  assert.equal(led.rows.at(-1).balance, 0);
});

test('discount is spread over lines and totals stay exact', () => {
  const { call } = setup();
  const { lipstick, serum } = seed(call);
  const res = call('sales.create', {
    items: [{ product_id: lipstick.id, qty: 1 }, { product_id: serum.id, qty: 3 }],
    discount_type: 'percent', discount_value: 7, payments: [{ method: 'Cash', amount: 20000 }]
  });
  const s = res.sale;
  const sumLines = s.items.reduce((a, i) => a + Math.round(i.line_total * 100), 0) / 100;
  assert.equal(sumLines, s.total);
  assert.equal(Math.round((s.subtotal - s.discount_amount) * 100) / 100, s.total);
});

test('edit invoice keeps prices, moves only the stock difference, keeps revision', () => {
  const { call } = setup();
  const { lipstick, serum } = seed(call);
  const { sale } = call('sales.create', { items: [{ product_id: lipstick.id, qty: 2, unit_price: 7000 }], payments: [{ method: 'Cash', amount: 14000 }] });
  // catalog price changes later — editing must keep the sold price when sent back
  call('products.update', { id: lipstick.id, sell_price: 9999 });
  const upd = call('sales.update', {
    id: sale.id,
    items: [{ product_id: lipstick.id, qty: 3, unit_price: 7000 }, { product_id: serum.id, qty: 1, unit_price: 2880 }],
    payments: [{ method: 'Cash', amount: 23880 }]
  });
  assert.equal(upd.sale.total, 23880);
  assert.equal(call('products.get', { id: lipstick.id }).stock_qty, 17);
  assert.equal(call('products.get', { id: serum.id }).stock_qty, 9);
  assert.equal(upd.sale.revisions.length, 1);
  assert.equal(upd.sale.paid_at_sale, 23880);
  const mv = call('inventory.movements', { product_id: lipstick.id });
  assert.equal(mv.rows[0].type, 'sale_edit');
  assert.equal(mv.rows[0].qty, -1);
});

test('partial return for walk-in refunds cash; cancel returns the rest', () => {
  const { call, fails } = setup();
  const { lipstick } = seed(call);
  const { sale } = call('sales.create', { items: [{ product_id: lipstick.id, qty: 3 }], discount_type: 'flat', discount_value: 600, payments: [{ method: 'Cash', amount: 21000 }] });
  assert.equal(sale.total, 21000);
  const item = sale.items[0];
  const quote = call('sales.returnQuote', { sale_id: sale.id, items: [{ sale_item_id: item.id, qty: 1 }] });
  assert.equal(quote.value, 7000);
  assert.equal(call('sales.list', {}).rows[0].returned_total, 0, 'quote must not save');
  const r = call('sales.return', { sale_id: sale.id, items: [{ sale_item_id: item.id, qty: 1 }], reason: 'Wrong shade' });
  assert.equal(r.refund, 7000);
  assert.equal(r.status, 'partially_returned');
  assert.equal(call('products.get', { id: lipstick.id }).stock_qty, 18);
  fails('sales.update', { id: sale.id, items: [{ product_id: lipstick.id, qty: 1 }], payments: [{ method: 'Cash', amount: 7000 }] }, /can no longer be edited/);
  fails('sales.return', { sale_id: sale.id, items: [{ sale_item_id: item.id, qty: 5 }] }, /Only 2/);
  const c = call('sales.cancel', { sale_id: sale.id, reason: 'Customer changed mind' });
  assert.equal(c.refund, 14000);
  assert.equal(c.status, 'cancelled');
  assert.equal(call('products.get', { id: lipstick.id }).stock_qty, 20);
  const t = call('reports.dashboard', {}).totals;
  assert.equal(t.net_sales, 0);
  assert.equal(t.gross_profit, 0);
  assert.equal(call('reports.cashbook', {}).totals.net, 0);
});

test('return on udhaar invoice reduces balance instead of paying cash', () => {
  const { call } = setup();
  const { lipstick, ali } = seed(call);
  const { sale } = call('sales.create', { customer_id: ali.id, items: [{ product_id: lipstick.id, qty: 2 }], payments: [] });
  assert.equal(call('customers.get', { id: ali.id }).balance, 14400);
  const r = call('sales.return', { sale_id: sale.id, items: [{ sale_item_id: sale.items[0].id, qty: 1 }] });
  assert.equal(r.refund, 0);
  assert.equal(r.credited_to_account, 7200);
  assert.equal(call('customers.get', { id: ali.id }).balance, 7200);
});

test('repayment, overpayment guard, void', () => {
  const { call, fails } = setup();
  const { lipstick, ali } = seed(call);
  call('sales.create', { customer_id: ali.id, items: [{ product_id: lipstick.id, qty: 1 }], payments: [] });
  fails('payments.receive', { customer_id: ali.id, amount: 9000, method: 'Cash' }, /more than the balance/);
  const r = call('payments.receive', { customer_id: ali.id, amount: 2000, method: 'JazzCash' });
  assert.equal(r.balance_after, 5200);
  call('payments.void', { id: r.payment.id, reason: 'Entered twice' });
  assert.equal(call('customers.get', { id: ali.id }).balance, 7200);
});

test('profit reports by product/customer/day agree with totals', () => {
  const { call } = setup();
  const { lipstick, serum, ali } = seed(call);
  call('sales.create', { customer_id: ali.id, items: [{ product_id: lipstick.id, qty: 2 }, { product_id: serum.id, qty: 2 }], discount_type: 'flat', discount_value: 1000, payments: [{ method: 'Cash', amount: 19160 }] });
  call('sales.create', { items: [{ product_id: serum.id, qty: 1 }], payments: [{ method: 'Cash', amount: 2880 }] });
  call('expenses.add', { category: 'Electricity', amount: 1500 });
  const t = call('reports.dashboard', {}).totals;
  // revenue: 14400+5760-1000 + 2880 = 22040 ; cost: 11600+4800+2400 = 18800
  assert.equal(t.net_sales, 22040);
  assert.equal(t.cogs, 18800);
  assert.equal(t.gross_profit, 3240);
  assert.equal(t.net_profit, 1740);
  for (const by of ['product', 'customer', 'category', 'invoice', 'day']) {
    const rows = call('reports.profit', { by }).rows;
    const sum = Math.round(rows.reduce((a, r) => a + r.profit * 100, 0)) / 100;
    assert.equal(sum, 3240, `profit by ${by}`);
  }
});

test('stock adjustments are logged with quantities (feature #1)', () => {
  const { call } = setup();
  const { serum } = seed(call);
  call('inventory.adjust', { product_id: serum.id, mode: 'add', qty: 12, reason: 'Purchase', unit_cost: 2500, update_cost: true, supplier: 'Ordinary Pk' });
  call('inventory.adjust', { product_id: serum.id, mode: 'remove', qty: 2, reason: 'Damaged' });
  call('inventory.adjust', { product_id: serum.id, mode: 'set', qty: 19, reason: 'Stock count' });
  const p = call('products.get', { id: serum.id });
  assert.equal(p.stock_qty, 19);
  assert.equal(p.cost_price, 2500);
  const log = call('activity.list', { q: 'Niacinamide' }).rows.map((r) => r.details).join('\n');
  assert.match(log, /Added 12 pcs to "Niacinamide Serum" \(stock 10 → 22\)/);
  assert.match(log, /Removed 2 pcs from "Niacinamide Serum" \(stock 22 → 20\)/);
  assert.match(log, /Removed 1 pcs from "Niacinamide Serum" \(stock 20 → 19\)/);
  const d = call('products.detail', { id: serum.id });
  assert.equal(d.totals.received, 22);
  assert.equal(d.totals.removed, 2);
});

test('PIN protects actions until unlocked', () => {
  const { call, fails } = setup();
  const { lipstick } = seed(call);
  const { recoveryCode } = call('auth.setPin', { pin: '4321' });
  call('auth.lock');
  fails('products.archive', { id: lipstick.id }, /locked/);
  fails('auth.unlock', { pin: '1111' }, /Incorrect/);
  call('auth.unlock', { pin: '4321' });
  call('products.archive', { id: lipstick.id });
  call('auth.lock');
  call('auth.recover', { code: recoveryCode.toLowerCase(), pin: '5555' });
  call('auth.lock');
  call('auth.unlock', { pin: '5555' });
  assert.equal(call('settings.get').security.pin_hash, undefined);
});

test('duplicate names / barcodes rejected; archived product keeps history', () => {
  const { call, fails } = setup();
  const { lipstick } = seed(call);
  fails('products.create', { name: 'mac lipstick', cost_price: 1 }, /already exists/);
  call('products.update', { id: lipstick.id, sku: '8901' });
  fails('products.create', { name: 'Other', cost_price: 1, sku: '8901' }, /already used/);
  call('sales.create', { items: [{ product_id: lipstick.id, qty: 1 }], payments: [{ method: 'Cash', amount: 7200 }] });
  call('products.archive', { id: lipstick.id });
  assert.equal(call('reports.profit', { by: 'product' }).rows.length, 1);
});

test('excel import: maps rows, skips / tops-up duplicates, reports errors', () => {
  const { call } = setup();
  seed(call);
  const res = call('products.import', {
    mode: 'add_stock',
    rows: [
      { row: 2, name: 'New Toner', cost_price: 900, sell_price: '', stock_qty: 5 },
      { row: 3, name: 'MAC Lipstick', stock_qty: 4 },
      { row: 4, name: '', cost_price: 1 },
      { row: 5, name: 'Bad', cost_price: 'abc' }
    ]
  });
  assert.equal(res.created, 1);
  assert.equal(res.stock_added, 1);
  assert.equal(res.errors.length, 2);
  assert.equal(call('products.findBySku', { sku: 'x' }), null);
  const toner = call('products.list', { q: 'Toner' }).rows[0];
  assert.equal(toner.price, 1080);
  assert.equal(call('products.list', { q: 'MAC' }).rows[0].stock_qty, 24);
});

test('search + pagination happen in the database (issues H1 / #19)', () => {
  const { call } = setup();
  for (let i = 1; i <= 30; i++) call('products.create', { name: `Item ${String(i).padStart(2, '0')}`, cost_price: 100, stock_qty: 1 });
  const p2 = call('products.list', { q: 'Item 2', page: 1, pageSize: 8 });
  assert.equal(p2.total, 10); // Item 02, 20-29
  const p = call('products.list', { page: 4, pageSize: 8 });
  assert.equal(p.rows.length, 6);
});

test('legacy v1 data import repairs collisions and keeps balances', () => {
  const { call, ctx } = setup();
  const legacy = {
    settings: { business_name: 'Sajawal Beauty', markup_percentage: 25, cashier_name: 'Sajawal Khan', currency_symbol: 'Rs.' },
    products: [
      { id: 'PROD-1111', name: 'Mascara', cost_price: 2200, selling_price: 2850, stock_qty: 35, created_at: '2026-07-01T10:00:00Z' },
      { id: 'PROD-1111', name: 'Cleanser', cost_price: 3800, selling_price: null, stock_qty: 15, created_at: '2026-07-01T10:00:00Z' },
      { id: 'PROD-2222', name: 'Mascara', cost_price: 2000, selling_price: 2500, stock_qty: 1 }
    ],
    sales: [
      { id: 'INV-1001', invoice_number: 'INV-1001', created_at: '2026-08-05T19:30:00Z', subtotal: 7600, discount_type: 'flat', discount_value: 100, total: 7500, amount_paid: 0, payment_method: 'Credit / Udhaar', customer_name: 'Ayesha',
        items: [{ product_id: 'PROD-1111', product_name_snapshot: 'Cleanser', unit_price_snapshot: 4750, cost_price_snapshot: 3800, quantity: 1, line_total: 4750 },
          { product_id: 'PROD-9999', product_name_snapshot: 'Old Blush', unit_price_snapshot: 2850, cost_price_snapshot: 2000, quantity: 1, line_total: 2850 }] },
      { id: 'INV-1002', invoice_number: 'INV-1002', created_at: '2026-08-06T10:00:00Z', total: 2850, amount_paid: 2850, payment_method: 'Cash', customer_name: 'Walk-in Customer',
        items: [{ product_id: 'PROD-1111', product_name_snapshot: 'Mascara', unit_price_snapshot: 2850, cost_price_snapshot: 2200, quantity: 1, line_total: 2850 }] }
    ],
    repayments: [{ customer_name: 'ayesha', amount: 2500, payment_method: 'Cash', timestamp: '2026-08-07T10:00:00Z' }],
    activity: [{ id: 'ACT-1', timestamp: '2026-08-05T11:30:00Z', user: 'Sajawal Khan', action: 'Sale Completed', details: 'x' }],
    drafts: []
  };
  const rep = call('legacy.import', legacy);
  assert.equal(rep.products, 3);
  assert.equal(rep.archived_products, 1);
  assert.equal(rep.customers, 1);
  assert.deepEqual(rep.renamed, ['Mascara → Mascara (2)']);
  const ayesha = call('customers.list', {}).rows[0];
  assert.equal(ayesha.balance, 5000);
  const inv = call('sales.list', { q: 'INV-1001' }).rows[0];
  assert.equal(inv.total, 7500);
  // stock comes from v1 as-is
  assert.equal(call('products.list', { q: 'Cleanser' }).rows[0].stock_qty, 15);
  // next invoice continues numbering
  const p = call('products.list', { q: 'Cleanser' }).rows[0];
  const s = call('sales.create', { items: [{ product_id: p.id, qty: 1 }], payments: [{ method: 'Cash', amount: 99999 }] });
  assert.equal(s.sale.invoice_no, 'INV-1003');
  assert.equal(call('legacy.import', legacy).skipped, true);
  assert.equal(ctx.settings.get().business_name, 'Sajawal Beauty');
});

test('change can only come from cash; advance can be kept for a customer', () => {
  const { call, fails } = setup();
  const { serum, ali } = seed(call);
  fails('sales.create', { items: [{ product_id: serum.id, qty: 1 }], payments: [{ method: 'EasyPaisa', amount: 3000 }] }, /Change can only be returned from cash/);
  const s = call('sales.create', { customer_id: ali.id, items: [{ product_id: serum.id, qty: 1 }], payments: [{ method: 'Cash', amount: 5000 }], keep_advance: true });
  assert.equal(s.summary.advance, 2120);
  assert.equal(s.summary.change, 0);
  assert.equal(call('customers.get', { id: ali.id }).balance, -2120);
});

test('return from a fully paid customer invoice refunds up to the advance', () => {
  const { call, fails } = setup();
  const { lipstick, ali } = seed(call);
  const { sale } = call('sales.create', { customer_id: ali.id, items: [{ product_id: lipstick.id, qty: 2 }], payments: [{ method: 'Cash', amount: 14400 }] });
  fails('sales.return', { sale_id: sale.id, items: [{ sale_item_id: sale.items[0].id, qty: 1 }], refund_amount: 9000 }, /Refund cannot be more/);
  const r = call('sales.return', { sale_id: sale.id, items: [{ sale_item_id: sale.items[0].id, qty: 1 }], refund_amount: 3000, restock: false });
  assert.equal(r.refund, 3000);
  assert.equal(r.credited_to_account, 4200);
  assert.equal(call('customers.get', { id: ali.id }).balance, -4200);
  // not restocked: stock stays, cost is not reversed (damaged goods are a loss)
  assert.equal(call('products.get', { id: lipstick.id }).stock_qty, 18);
  const t = call('reports.dashboard', {}).totals;
  assert.equal(t.net_sales, 7200);
  assert.equal(t.cogs, 11600);
});

test('editing an invoice can move it from walk-in to a customer on udhaar', () => {
  const { call } = setup();
  const { serum, ali } = seed(call);
  const { sale } = call('sales.create', { items: [{ product_id: serum.id, qty: 1 }], payments: [{ method: 'Cash', amount: 2880 }] });
  const upd = call('sales.update', { id: sale.id, customer_id: ali.id, items: [{ product_id: serum.id, qty: 2, unit_price: 2880 }], payments: [{ method: 'Cash', amount: 2880 }] });
  assert.equal(upd.sale.total, 5760);
  assert.equal(upd.sale.due, 2880);
  assert.equal(call('customers.get', { id: ali.id }).balance, 2880);
  assert.equal(call('reports.cashbook', {}).totals.sales_collected, 2880);
});
