'use strict';
/*
 * Sales, invoice edits, returns / cancellations and parked drafts.
 *
 * Rules that keep stock and money correct:
 *  - Prices, discounts and totals are recalculated here; the screen's numbers are never trusted.
 *  - Stock leaves only through products.moveStock(), inside the same transaction as the invoice.
 *  - A walk-in sale must be paid in full. Udhaar requires a saved customer.
 *  - Money received above the bill can settle the customer's old balance (feature #12).
 *  - An invoice that already has a return cannot be edited (use a further return instead).
 */
const { fail, P, R, int, now, str, likeTerm, paging, fmtMoney } = require('../util');

module.exports = function salesService(ctx) {
  const { store } = ctx;
  const products = () => ctx.products;
  const customers = () => ctx.customers;

  // ------------------------------------------------------------ helpers

  function nextNumber(metaKey, prefix, table, column) {
    let seq = Number(store.meta(metaKey) || 0);
    if (!seq) {
      // Continue from the highest existing number (keeps INV-1001… sequence from v1).
      const rows = store.all(`SELECT ${column} AS no FROM ${table}`);
      for (const r of rows) {
        const m = /(\d+)$/.exec(r.no || '');
        if (m) seq = Math.max(seq, Number(m[1]));
      }
      if (!seq) seq = 1000;
    }
    let no;
    do {
      seq += 1;
      no = `${prefix}${seq}`;
    } while (store.get(`SELECT 1 FROM ${table} WHERE ${column} = ?`, no));
    store.meta(metaKey, seq);
    return no;
  }

  function getSaleRow(id) {
    const row = store.get('SELECT * FROM sales WHERE id = ?', int(id, 'Invoice'));
    if (!row) fail('Invoice not found', 'NOT_FOUND');
    return row;
  }

  /**
   * Price a cart exactly once, server-side.
   * items: [{ product_id, qty, unit_price? }]   (unit_price = manual price in rupees)
   */
  function priceCart(items, discountType, discountValue, { allowArchived = new Set() } = {}) {
    if (!Array.isArray(items) || items.length === 0) fail('The cart is empty', 'EMPTY_CART');
    const merged = new Map();
    for (const it of items) {
      const pid = int(it.product_id, 'Product');
      const qty = int(it.qty, 'Quantity');
      if (qty <= 0) fail('Quantity must be at least 1', 'VALIDATION');
      const existing = merged.get(pid);
      if (existing) existing.qty += qty;
      else merged.set(pid, { pid, qty, unit_price: it.unit_price });
    }
    const markup = Number(ctx.settings.get().markup_percentage) || 0;
    const lines = [];
    let subtotal = 0;
    let costTotal = 0;
    for (const m of merged.values()) {
      const row = products().getRow(m.pid);
      if (!row.is_active && !allowArchived.has(row.id)) fail(`"${row.name}" is archived and cannot be sold`, 'ARCHIVED');
      const std = products().effectivePrice(row, markup);
      const custom = m.unit_price !== undefined && m.unit_price !== null && m.unit_price !== '';
      const unit = custom ? P(m.unit_price) : std;
      if (unit < 0) fail('Price cannot be negative', 'VALIDATION');
      const lineSub = unit * m.qty;
      subtotal += lineSub;
      costTotal += row.cost_price * m.qty;
      lines.push({ product_id: row.id, product_name: row.name, sku: row.sku || '', qty: m.qty, std_price: std, unit_price: unit, cost_price: row.cost_price, line_subtotal: lineSub });
    }
    let type = discountType === 'percent' ? 'percent' : 'flat';
    let value = Number(discountValue) || 0;
    if (value < 0) fail('Discount cannot be negative', 'VALIDATION');
    let discount;
    if (type === 'percent') {
      if (value > 100) fail('Discount cannot be more than 100%', 'VALIDATION');
      // Percentage discounts are rounded to the nearest whole rupee, as bills are settled in rupees.
      discount = Math.round((subtotal * value) / 100 / 100) * 100;
    } else {
      discount = P(value);
      if (discount > subtotal) fail('Discount cannot be more than the bill subtotal', 'VALIDATION');
    }
    // Spread the invoice discount over the lines so profit per product is accurate.
    let allocated = 0;
    let biggest = 0;
    // Shares are whole rupees when the discount is in whole rupees (keeps per-product figures clean).
    const step = discount % 100 === 0 ? 100 : 1;
    lines.forEach((l, i) => {
      l.discount_share = subtotal > 0 ? Math.floor((discount * l.line_subtotal) / subtotal / step) * step : 0;
      allocated += l.discount_share;
      if (l.line_subtotal > lines[biggest].line_subtotal) biggest = i;
    });
    lines[biggest].discount_share += discount - allocated;
    lines.forEach((l) => { l.line_total = l.line_subtotal - l.discount_share; });
    return { lines, subtotal, discount_type: type, discount_value: value, discount, total: subtotal - discount, cost_total: costTotal };
  }

  /**
   * Split what the customer handed over between: this bill, old udhaar, advance and change.
   * tenders: [{ method, amount }] in rupees.
   */
  function planPayments({ total, customerId, prevBalance, tenders, applyToBalance = true, keepAdvance = false }) {
    const methods = ctx.settings.get().payment_methods;
    const list = (Array.isArray(tenders) ? tenders : [])
      .map((t) => ({ method: str(t.method, 40) || 'Cash', amount: P(t.amount) }))
      .filter((t) => t.amount !== 0);
    for (const t of list) {
      if (t.amount < 0) fail('Payment amounts cannot be negative', 'VALIDATION');
      if (!methods.includes(t.method)) fail(`Unknown payment method "${t.method}"`, 'VALIDATION');
    }
    const tendered = list.reduce((a, t) => a + t.amount, 0);
    if (!customerId && tendered < total) {
      fail(`Walk-in sales must be paid in full (short by ${fmtMoney(total - tendered)}). Select or add a customer to record udhaar.`, 'NEEDS_CUSTOMER');
    }
    const salePart = Math.min(tendered, total);
    let extra = tendered - salePart;
    const balancePart = customerId && applyToBalance ? Math.min(extra, Math.max(0, prevBalance)) : 0;
    extra -= balancePart;
    const advancePart = customerId && keepAdvance ? extra : 0;
    const change = extra - advancePart;
    const cash = list.filter((t) => t.method === 'Cash').reduce((a, t) => a + t.amount, 0);
    if (change > cash) fail('Change can only be returned from cash. Please correct the non-cash amounts.', 'VALIDATION');

    // Take the change out of the cash tenders, then allocate: bill first, the rest to the account.
    const buckets = list.map((t) => ({ ...t }));
    let ch = change;
    for (const b of buckets) {
      if (ch <= 0) break;
      if (b.method !== 'Cash') continue;
      const take = Math.min(b.amount, ch);
      b.amount -= take; ch -= take;
    }
    const saleRows = [];
    const receiptRows = [];
    let needSale = salePart;
    for (const b of buckets) {
      if (b.amount <= 0) continue;
      const toSale = Math.min(b.amount, needSale);
      if (toSale > 0) { saleRows.push({ method: b.method, amount: toSale }); needSale -= toSale; }
      const rest = b.amount - toSale;
      if (rest > 0) receiptRows.push({ method: b.method, amount: rest });
    }
    return { tendered, salePart, balancePart, advancePart, change, credit: total - salePart, saleRows, receiptRows };
  }

  function insertPayments(plan, { saleId, customerId, invoiceNo, ts }) {
    const cashier = ctx.user();
    for (const p of plan.saleRows) {
      store.run('INSERT INTO payments(created_at, customer_id, sale_id, amount, method, kind, note, cashier) VALUES (?,?,?,?,?,?,?,?)',
        ts, customerId, saleId, p.amount, p.method, 'sale', '', cashier);
    }
    for (const p of plan.receiptRows) {
      store.run('INSERT INTO payments(created_at, customer_id, sale_id, with_sale_id, amount, method, kind, note, cashier) VALUES (?,?,?,?,?,?,?,?,?)',
        ts, customerId, null, saleId, p.amount, p.method, 'receipt', `Received at counter with ${invoiceNo}`, cashier);
    }
  }

  function resolveCustomer(customerId) {
    if (customerId === null || customerId === undefined || customerId === '' || customerId === 0) return null;
    const c = customers().getRow(customerId);
    if (!c.is_active) fail(`Customer "${c.name}" is archived`, 'ARCHIVED');
    return c;
  }

  function insertItems(saleId, lines) {
    for (const l of lines) {
      store.run(
        `INSERT INTO sale_items(sale_id, product_id, product_name, sku, qty, std_price, unit_price, cost_price, line_subtotal, discount_share, line_total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        saleId, l.product_id, l.product_name, l.sku, l.qty, l.std_price, l.unit_price, l.cost_price, l.line_subtotal, l.discount_share, l.line_total
      );
    }
  }

  // ------------------------------------------------------------ create

  function create(input = {}) {
    return store.tx(() => {
      const customer = resolveCustomer(input.customer_id);
      const priced = priceCart(input.items, input.discount_type, input.discount_value);
      const prevBalance = customer ? customers().balanceP(customer.id) : 0;
      const plan = planPayments({
        total: priced.total, customerId: customer?.id, prevBalance, tenders: input.payments,
        applyToBalance: input.apply_to_balance !== false, keepAdvance: !!input.keep_advance
      });
      const ts = now();
      const invoiceNo = nextNumber('invoice_seq', ctx.settings.get().invoice_prefix || 'INV-', 'sales', 'invoice_no');
      const res = store.run(
        `INSERT INTO sales(invoice_no, created_at, customer_id, customer_name, customer_phone, subtotal, discount_type, discount_value,
                           discount_amount, total, cost_total, note, cashier)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        invoiceNo, ts, customer?.id ?? null, customer ? customer.name : 'Walk-in Customer', customer ? customer.phone : '',
        priced.subtotal, priced.discount_type, priced.discount_value, priced.discount, priced.total, priced.cost_total,
        str(input.note, 300), ctx.user()
      );
      const saleId = Number(res.lastInsertRowid);
      insertItems(saleId, priced.lines);
      for (const l of priced.lines) {
        products().moveStock(l.product_id, -l.qty, 'sale', { refType: 'sale', refId: saleId, refNo: invoiceNo, note: customer ? customer.name : 'Walk-in' });
      }
      insertPayments(plan, { saleId, customerId: customer?.id ?? null, invoiceNo, ts });
      if (input.draft_id) store.run('DELETE FROM drafts WHERE id = ?', int(input.draft_id));

      const parts = [`${priced.lines.length} item(s), total ${fmtMoney(priced.total)}`];
      parts.push(`paid ${fmtMoney(plan.salePart)}`);
      if (plan.credit) parts.push(`udhaar ${fmtMoney(plan.credit)}`);
      if (plan.balancePart) parts.push(`old balance received ${fmtMoney(plan.balancePart)}`);
      if (plan.advancePart) parts.push(`advance ${fmtMoney(plan.advancePart)}`);
      ctx.audit('Sale Completed', 'sale', saleId, `${invoiceNo} — ${customer ? customer.name : 'Walk-in'}: ${parts.join(', ')}`);
      return { sale: get(saleId), summary: planSummary(plan, priced.total, prevBalance, customer?.id) };
    });
  }

  function planSummary(plan, total, prevBalance, customerId) {
    return {
      total: R(total), tendered: R(plan.tendered), paid_for_bill: R(plan.salePart), credit: R(plan.credit),
      old_balance_received: R(plan.balancePart), advance: R(plan.advancePart), change: R(plan.change),
      previous_balance: R(prevBalance), new_balance: customerId ? R(customers().balanceP(customerId)) : 0
    };
  }

  // ------------------------------------------------------------ edit

  function update(saleId, input = {}) {
    return store.tx(() => {
      const sale = getSaleRow(saleId);
      if (sale.status !== 'completed' || sale.returned_total > 0) {
        fail('This invoice has returns or was cancelled, so it can no longer be edited. Use "Return items" instead.', 'NOT_EDITABLE');
      }
      const before = get(sale.id);
      const oldItems = store.all('SELECT * FROM sale_items WHERE sale_id = ?', sale.id);
      const oldQty = new Map();
      for (const i of oldItems) oldQty.set(i.product_id, (oldQty.get(i.product_id) || 0) + i.qty);

      const customer = resolveCustomer(input.customer_id);
      const priced = priceCart(input.items, input.discount_type, input.discount_value, { allowArchived: new Set(oldQty.keys()) });
      const newQty = new Map(priced.lines.map((l) => [l.product_id, l.qty]));

      // Stock: apply only the difference per product, logged against the invoice.
      const changes = [];
      const allIds = new Set([...oldQty.keys(), ...newQty.keys()]);
      for (const pid of allIds) {
        const a = oldQty.get(pid) || 0;
        const b = newQty.get(pid) || 0;
        if (a === b) continue;
        const name = products().getRow(pid).name;
        products().moveStock(pid, a - b, 'sale_edit', {
          refType: 'sale', refId: sale.id, refNo: sale.invoice_no,
          note: `${sale.invoice_no} edited: qty ${a} → ${b}`
        });
        if (!a) changes.push(`added "${name}" ×${b}`);
        else if (!b) changes.push(`removed "${name}" ×${a}`);
        else changes.push(`"${name}" qty ${a} → ${b}`);
      }
      for (const l of priced.lines) {
        const old = oldItems.find((i) => i.product_id === l.product_id);
        if (old && old.unit_price !== l.unit_price) changes.push(`"${l.product_name}" price ${fmtMoney(old.unit_price)} → ${fmtMoney(l.unit_price)}`);
      }

      store.run('INSERT INTO sale_revisions(sale_id, created_at, user, summary, snapshot) VALUES (?,?,?,?,?)',
        sale.id, now(), ctx.user(), changes.join('; '), JSON.stringify(before));

      // Replace lines and payments taken at the time of sale.
      store.run('DELETE FROM sale_items WHERE sale_id = ?', sale.id);
      insertItems(sale.id, priced.lines);
      const oldPaid = Number(store.value("SELECT COALESCE(SUM(amount),0) FROM payments WHERE sale_id = ? AND kind = 'sale' AND voided = 0", sale.id));
      const ts = now();
      store.run("UPDATE payments SET voided = 1, voided_at = ?, void_reason = 'Invoice edited' WHERE sale_id = ? AND kind = 'sale' AND voided = 0", ts, sale.id);
      store.run(
        `UPDATE sales SET customer_id=?, customer_name=?, customer_phone=?, subtotal=?, discount_type=?, discount_value=?, discount_amount=?,
                total=?, cost_total=?, note=?, edited_at=?, edit_count = edit_count + 1 WHERE id = ?`,
        customer?.id ?? null, customer ? customer.name : 'Walk-in Customer', customer ? customer.phone : '',
        priced.subtotal, priced.discount_type, priced.discount_value, priced.discount, priced.total, priced.cost_total,
        input.note !== undefined ? str(input.note, 300) : sale.note, ts, sale.id
      );
      // Balance before this invoice = current balance minus this (still unpaid) invoice.
      const prevBalance = customer ? customers().balanceP(customer.id) - priced.total : 0;
      const plan = planPayments({
        total: priced.total, customerId: customer?.id, prevBalance, tenders: input.payments,
        applyToBalance: input.apply_to_balance !== false, keepAdvance: !!input.keep_advance
      });
      // Payments keep the original sale date so day reports stay stable; receipts are dated now.
      for (const p of plan.saleRows) {
        store.run('INSERT INTO payments(created_at, customer_id, sale_id, amount, method, kind, note, cashier) VALUES (?,?,?,?,?,?,?,?)',
          sale.created_at, customer?.id ?? null, sale.id, p.amount, p.method, 'sale', 'Re-recorded after invoice edit', ctx.user());
      }
      for (const p of plan.receiptRows) {
        store.run('INSERT INTO payments(created_at, customer_id, sale_id, amount, method, kind, note, cashier) VALUES (?,?,?,?,?,?,?,?)',
          ts, customer?.id ?? null, null, p.amount, p.method, 'receipt', `Received while editing ${sale.invoice_no}`, ctx.user());
      }
      if ((sale.customer_id || null) !== (customer?.id ?? null)) changes.push(`customer "${sale.customer_name}" → "${customer ? customer.name : 'Walk-in Customer'}"`);
      if (sale.total !== priced.total) changes.push(`total ${fmtMoney(sale.total)} → ${fmtMoney(priced.total)}`);
      if (oldPaid !== plan.salePart) changes.push(`paid ${fmtMoney(oldPaid)} → ${fmtMoney(plan.salePart)}`);
      ctx.audit('Sale Edited', 'sale', sale.id, `${sale.invoice_no}: ${changes.length ? changes.join('; ') : 'saved without changes'}`);
      return { sale: get(sale.id), summary: planSummary(plan, priced.total, prevBalance, customer?.id) };
    });
  }

  // ------------------------------------------------------------ returns & cancel

  /**
   * Preview what a return would do (value, max refund) without saving anything.
   */
  function returnQuote({ sale_id, items }) {
    let result;
    try {
      store.tx(() => {
        result = applyReturn({ sale_id, items, preview: true });
        throw Object.assign(new Error('preview'), { __preview: true });
      });
    } catch (e) {
      if (!e.__preview) throw e;
    }
    return result;
  }

  function applyReturn({ sale_id, items, refund_amount, refund_method = 'Cash', reason = '', restock = true, kind = 'return', preview = false }) {
    const sale = getSaleRow(sale_id);
    if (sale.status === 'cancelled') fail('This invoice is already cancelled', 'CANCELLED');
    const saleItems = store.all('SELECT * FROM sale_items WHERE sale_id = ?', sale.id);
    let wanted;
    if (kind === 'cancel') {
      wanted = saleItems.filter((si) => si.qty > si.returned_qty).map((si) => ({ sale_item_id: si.id, qty: si.qty - si.returned_qty }));
    } else {
      wanted = (items || []).map((x) => ({ sale_item_id: int(x.sale_item_id, 'Item'), qty: int(x.qty, 'Quantity') })).filter((x) => x.qty > 0);
    }
    if (!wanted.length) fail(kind === 'cancel' ? 'Everything on this invoice has already been returned' : 'Choose at least one item and quantity to return', 'VALIDATION');

    const lines = [];
    for (const w of wanted) {
      const si = saleItems.find((x) => x.id === w.sale_item_id);
      if (!si) fail('Item does not belong to this invoice', 'VALIDATION');
      const remaining = si.qty - si.returned_qty;
      if (w.qty > remaining) fail(`Only ${remaining} of "${si.product_name}" can still be returned`, 'VALIDATION');
      const prevAmount = Number(store.value('SELECT COALESCE(SUM(amount),0) FROM return_items WHERE sale_item_id = ?', si.id));
      const amount = si.returned_qty + w.qty === si.qty ? si.line_total - prevAmount : Math.round((si.line_total * w.qty) / si.qty);
      lines.push({ si, qty: w.qty, amount, cost: si.cost_price * w.qty });
    }
    const value = lines.reduce((a, l) => a + l.amount, 0);
    const costBack = restock ? lines.reduce((a, l) => a + l.cost, 0) : 0;

    const ts = now();
    const returnNo = preview ? 'PREVIEW' : nextNumber('return_seq', 'RET-', 'returns', 'return_no');
    const res = store.run(
      'INSERT INTO returns(return_no, sale_id, created_at, customer_id, kind, total, cost_total, refund_amount, restocked, reason, cashier) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      returnNo, sale.id, ts, sale.customer_id, kind, value, costBack, 0, restock ? 1 : 0, str(reason, 300), ctx.user()
    );
    const returnId = Number(res.lastInsertRowid);
    for (const l of lines) {
      store.run('INSERT INTO return_items(return_id, sale_item_id, product_id, product_name, qty, amount, cost) VALUES (?,?,?,?,?,?,?)',
        returnId, l.si.id, l.si.product_id, l.si.product_name, l.qty, l.amount, restock ? l.cost : 0);
      store.run('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?', l.qty, l.si.id);
      if (restock) {
        products().moveStock(l.si.product_id, l.qty, kind === 'cancel' ? 'cancel' : 'return', {
          refType: 'return', refId: returnId, refNo: sale.invoice_no, note: `${returnNo} from ${sale.invoice_no}`, allowNegative: true
        });
      }
    }
    const fully = Number(store.value('SELECT COUNT(*) FROM sale_items WHERE sale_id = ? AND returned_qty < qty', sale.id)) === 0;
    const status = kind === 'cancel' ? 'cancelled' : fully ? 'returned' : 'partially_returned';
    store.run('UPDATE sales SET returned_total = returned_total + ?, returned_cost = returned_cost + ?, status = ? WHERE id = ?', value, costBack, status, sale.id);

    // How much money must / may go back to the customer.
    let maxRefund;
    let forced = false;
    if (!sale.customer_id) {
      const paid = Number(store.value('SELECT COALESCE(SUM(amount),0) FROM payments WHERE sale_id = ? AND voided = 0', sale.id));
      const net = sale.total - sale.returned_total - value;
      maxRefund = Math.max(0, paid - net);
      forced = true; // walk-in customers always get their money back
    } else {
      maxRefund = Math.max(0, -customers().balanceP(sale.customer_id));
    }
    maxRefund = Math.min(maxRefund, value);
    let refund = forced || refund_amount === undefined || refund_amount === null || refund_amount === '' ? maxRefund : P(refund_amount);
    if (refund < 0) fail('Refund cannot be negative', 'VALIDATION');
    if (refund > maxRefund) fail(`Refund cannot be more than ${fmtMoney(maxRefund)}`, 'VALIDATION');
    const methods = ctx.settings.get().payment_methods;
    const method = methods.includes(refund_method) ? refund_method : 'Cash';
    if (refund > 0) {
      store.run('INSERT INTO payments(created_at, customer_id, sale_id, return_id, amount, method, kind, note, cashier) VALUES (?,?,?,?,?,?,?,?,?)',
        ts, sale.customer_id, sale.id, returnId, -refund, method, 'refund', `${returnNo}${reason ? ' — ' + str(reason, 100) : ''}`, ctx.user());
      store.run('UPDATE returns SET refund_amount = ? WHERE id = ?', refund, returnId);
    }
    const balanceAfter = sale.customer_id ? customers().balanceP(sale.customer_id) : 0;
    const out = {
      return_id: returnId, return_no: returnNo, value: R(value), refund: R(refund), max_refund: R(maxRefund),
      refund_forced: forced, credited_to_account: R(sale.customer_id ? value - refund : 0), balance_after: R(balanceAfter), status
    };
    if (!preview) {
      const itemsText = lines.map((l) => `"${l.si.product_name}" ×${l.qty}`).join(', ');
      ctx.audit(kind === 'cancel' ? 'Sale Cancelled' : 'Sale Return', 'sale', sale.id,
        `${returnNo} on ${sale.invoice_no}: ${itemsText}. Value ${fmtMoney(value)}, refunded ${fmtMoney(refund)}${refund ? ' (' + method + ')' : ''}${restock ? ', items back in stock' : ', items NOT restocked'}${reason ? '. Reason: ' + str(reason, 200) : ''}`);
      out.sale = get(sale.id);
    }
    return out;
  }

  function createReturn(input = {}) {
    return store.tx(() => applyReturn({ ...input, kind: 'return' }));
  }

  function cancel(input = {}) {
    return store.tx(() => applyReturn({ ...input, kind: 'cancel' }));
  }

  // ------------------------------------------------------------ read

  function paymentInfo(sale) {
    const paidRows = store.all('SELECT * FROM payments WHERE sale_id = ? ORDER BY id', sale.id);
    let paidAtSale = 0;
    let refunded = 0;
    for (const p of paidRows) {
      if (p.voided) continue;
      if (p.kind === 'sale') paidAtSale += p.amount;
      if (p.kind === 'refund') refunded += -p.amount;
    }
    let due = 0;
    let status = 'paid';
    if (sale.customer_id) {
      const entry = customers().invoiceDues(sale.customer_id).get(sale.id);
      due = entry ? entry.due : 0;
      status = customers().statusFor(entry);
    }
    return { paidRows, paidAtSale, refunded, due, status };
  }

  function get(id) {
    const s = getSaleRow(id);
    const items = store.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', s.id);
    const info = paymentInfo(s);
    const returns = store.all('SELECT * FROM returns WHERE sale_id = ? ORDER BY id', s.id).map((r) => ({
      id: r.id, return_no: r.return_no, created_at: r.created_at, kind: r.kind, total: R(r.total), refund_amount: R(r.refund_amount),
      restocked: !!r.restocked, reason: r.reason, cashier: r.cashier,
      items: store.all('SELECT * FROM return_items WHERE return_id = ?', r.id).map((ri) => ({ product_name: ri.product_name, qty: ri.qty, amount: R(ri.amount) }))
    }));
    const revisions = store.all('SELECT id, created_at, user, summary FROM sale_revisions WHERE sale_id = ? ORDER BY id DESC', s.id);
    // Balance just before this invoice (printed as "previous balance" on the bill):
    // opening + earlier invoices − payments made before this invoice's time.
    let previousBalance = 0;
    let currentBalance = 0;
    let receivedWithSale = 0;
    if (s.customer_id) {
      currentBalance = customers().balanceP(s.customer_id);
      const opening = Number(store.value('SELECT opening_balance FROM customers WHERE id = ?', s.customer_id) || 0);
      const earlierSales = Number(store.value(
        'SELECT COALESCE(SUM(total - returned_total),0) FROM sales WHERE customer_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))',
        s.customer_id, s.created_at, s.created_at, s.id));
      // Payments before this invoice; money taken together with this (or a later) invoice is excluded.
      const earlierPaid = Number(store.value(
        `SELECT COALESCE(SUM(amount),0) FROM payments
         WHERE customer_id = ? AND voided = 0 AND created_at <= ?
           AND COALESCE(sale_id, with_sale_id, 0) <> ?
           AND NOT (created_at = ? AND COALESCE(sale_id, with_sale_id, 0) > ?)`,
        s.customer_id, s.created_at, s.id, s.created_at, s.id));
      previousBalance = opening + earlierSales - earlierPaid;
      receivedWithSale = Number(store.value(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE customer_id = ? AND voided = 0 AND kind = 'receipt' AND with_sale_id = ? AND created_at = ?",
        s.customer_id, s.id, s.created_at));
    }
    return {
      id: s.id, invoice_no: s.invoice_no, created_at: s.created_at,
      customer_id: s.customer_id, customer_name: s.customer_name, customer_phone: s.customer_phone,
      subtotal: R(s.subtotal), discount_type: s.discount_type, discount_value: s.discount_value, discount_amount: R(s.discount_amount),
      total: R(s.total), cost_total: R(s.cost_total), returned_total: R(s.returned_total), net_total: R(s.total - s.returned_total),
      profit: R(s.total - s.returned_total - (s.cost_total - s.returned_cost)),
      status: s.status, note: s.note, cashier: s.cashier, edited_at: s.edited_at, edit_count: s.edit_count, is_legacy: !!s.is_legacy,
      paid_at_sale: R(info.paidAtSale), refunded: R(info.refunded), due: R(info.due), payment_status: info.status,
      credit_at_sale: R(Math.max(0, s.total - info.paidAtSale)),
      previous_balance: R(previousBalance), received_with_sale: R(receivedWithSale), current_balance: R(currentBalance),
      // Effect of this invoice on the account: bill − returns − money received + refunds paid out.
      balance_after_sale: R(previousBalance + s.total - s.returned_total - info.paidAtSale - receivedWithSale + info.refunded),
      items: items.map((i) => ({
        id: i.id, product_id: i.product_id, product_name: i.product_name, sku: i.sku, qty: i.qty, returned_qty: i.returned_qty,
        std_price: R(i.std_price), unit_price: R(i.unit_price), cost_price: R(i.cost_price),
        line_subtotal: R(i.line_subtotal), discount_share: R(i.discount_share), line_total: R(i.line_total)
      })),
      payments: info.paidRows.map((p) => ({ id: p.id, created_at: p.created_at, amount: R(p.amount), method: p.method, kind: p.kind, note: p.note, voided: !!p.voided, void_reason: p.void_reason })),
      returns,
      revisions
    };
  }

  function list(opts = {}) {
    const params = [];
    const where = ['1=1'];
    if (opts.from) { where.push('s.created_at >= ?'); params.push(`${opts.from} 00:00:00`); }
    if (opts.to) { where.push('s.created_at <= ?'); params.push(`${opts.to} 23:59:59.999`); }
    if (opts.customer_id) { where.push('s.customer_id = ?'); params.push(int(opts.customer_id)); }
    if (opts.walkin) where.push('s.customer_id IS NULL');
    if (opts.q) {
      const t = likeTerm(str(opts.q, 80));
      where.push("(s.invoice_no LIKE ? ESCAPE '\\' OR s.customer_name LIKE ? ESCAPE '\\' OR s.customer_phone LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND (i.product_name LIKE ? ESCAPE '\\' OR i.sku LIKE ? ESCAPE '\\')))");
      params.push(t, t, t, t, t);
    }
    const st = opts.status;
    if (st === 'returned') where.push("s.status IN ('returned','partially_returned')");
    else if (st === 'cancelled') where.push("s.status = 'cancelled'");
    else if (st === 'edited') where.push('s.edit_count > 0');
    else if (st === 'udhaar') where.push('s.customer_id IS NOT NULL');
    const w = `WHERE ${where.join(' AND ')}`;
    const pg = paging(opts, 25);
    const decorate = (rows) => {
      const dueCache = new Map();
      return rows.map((s) => {
        let status = 'paid';
        let due = 0;
        if (s.customer_id) {
          if (!dueCache.has(s.customer_id)) dueCache.set(s.customer_id, customers().invoiceDues(s.customer_id));
          const e = dueCache.get(s.customer_id).get(s.id);
          status = customers().statusFor(e);
          due = e ? e.due : 0;
        }
        return {
          id: s.id, invoice_no: s.invoice_no, created_at: s.created_at, customer_id: s.customer_id, customer_name: s.customer_name,
          customer_phone: s.customer_phone, items: Number(s.item_count), qty: Number(s.qty), total: R(s.total), returned_total: R(s.returned_total),
          net_total: R(s.total - s.returned_total), status: s.status, payment_status: status, due: R(due), edit_count: s.edit_count, cashier: s.cashier
        };
      });
    };
    const select = `SELECT s.*, (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS item_count,
                           (SELECT COALESCE(SUM(qty),0) FROM sale_items i WHERE i.sale_id = s.id) AS qty
                    FROM sales s ${w} ORDER BY s.created_at DESC, s.id DESC`;
    let rows;
    let total;
    if (['paid', 'partial', 'unpaid', 'due'].includes(opts.payment)) {
      const all = decorate(store.all(select, ...params)).filter((r) => (opts.payment === 'due' ? r.payment_status !== 'paid' : r.payment_status === opts.payment));
      total = all.length;
      rows = all.slice(pg.offset, pg.offset + pg.limit);
    } else {
      total = Number(store.value(`SELECT COUNT(*) FROM sales s ${w}`, ...params));
      rows = decorate(store.all(`${select} LIMIT ? OFFSET ?`, ...params, pg.limit, pg.offset));
    }
    const sums = store.get(`SELECT COALESCE(SUM(s.total),0) AS gross, COALESCE(SUM(s.returned_total),0) AS returned FROM sales s ${w}`, ...params);
    return { rows, total, page: pg.page, pageSize: pg.pageSize, gross: R(sums.gross), returned: R(sums.returned), net: R(sums.gross - sums.returned) };
  }

  function listReturns(opts = {}) {
    const params = [];
    const where = ['1=1'];
    if (opts.from) { where.push('r.created_at >= ?'); params.push(`${opts.from} 00:00:00`); }
    if (opts.to) { where.push('r.created_at <= ?'); params.push(`${opts.to} 23:59:59.999`); }
    if (opts.q) {
      const t = likeTerm(str(opts.q, 80));
      where.push("(r.return_no LIKE ? ESCAPE '\\' OR s.invoice_no LIKE ? ESCAPE '\\' OR s.customer_name LIKE ? ESCAPE '\\')");
      params.push(t, t, t);
    }
    const w = `WHERE ${where.join(' AND ')}`;
    const pg = paging(opts, 25);
    const total = Number(store.value(`SELECT COUNT(*) FROM returns r JOIN sales s ON s.id = r.sale_id ${w}`, ...params));
    const sums = store.get(`SELECT COALESCE(SUM(r.total),0) AS value, COALESCE(SUM(r.refund_amount),0) AS refunded FROM returns r JOIN sales s ON s.id = r.sale_id ${w}`, ...params);
    const rows = store.all(
      `SELECT r.*, s.invoice_no, s.customer_name, (SELECT COALESCE(SUM(qty),0) FROM return_items WHERE return_id = r.id) AS qty
       FROM returns r JOIN sales s ON s.id = r.sale_id ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...params, pg.limit, pg.offset
    ).map((r) => ({
      id: r.id, return_no: r.return_no, sale_id: r.sale_id, invoice_no: r.invoice_no, customer_name: r.customer_name, created_at: r.created_at,
      kind: r.kind, qty: Number(r.qty), total: R(r.total), refund_amount: R(r.refund_amount), restocked: !!r.restocked, reason: r.reason, cashier: r.cashier
    }));
    return { rows, total, page: pg.page, pageSize: pg.pageSize, value: R(sums.value), refunded: R(sums.refunded) };
  }

  // ------------------------------------------------------------ drafts (parked sales)

  function saveDraft({ label, data }) {
    if (!data || !Array.isArray(data.items) || !data.items.length) fail('Nothing to park — the cart is empty', 'EMPTY_CART');
    return store.tx(() => {
      const json = JSON.stringify(data);
      if (json.length > 200000) fail('Draft is too large', 'VALIDATION');
      const res = store.run('INSERT INTO drafts(created_at, label, data) VALUES (?,?,?)', now(), str(label, 80) || 'Parked sale', json);
      const qty = data.items.reduce((a, i) => a + (Number(i.qty) || 0), 0);
      ctx.audit('Sale Parked', 'draft', Number(res.lastInsertRowid), `Parked "${str(label, 80) || 'Parked sale'}" with ${qty} item(s)`);
      return { id: Number(res.lastInsertRowid) };
    });
  }

  function listDrafts() {
    return store.all('SELECT * FROM drafts ORDER BY id DESC').map((d) => {
      let data = {};
      try { data = JSON.parse(d.data); } catch (_) { /* corrupt draft */ }
      const items = Array.isArray(data.items) ? data.items : [];
      return { id: d.id, created_at: d.created_at, label: d.label, data, item_count: items.reduce((a, i) => a + (Number(i.qty) || 0), 0), lines: items.length };
    });
  }

  function deleteDraft(id) {
    return store.tx(() => {
      const d = store.get('SELECT * FROM drafts WHERE id = ?', int(id));
      if (!d) return false;
      store.run('DELETE FROM drafts WHERE id = ?', d.id);
      ctx.audit('Draft Removed', 'draft', d.id, `Removed parked sale "${d.label}"`);
      return true;
    });
  }

  return { priceCart, planPayments, create, update, returnQuote, createReturn, cancel, get, list, listReturns, saveDraft, listDrafts, deleteDraft, nextNumber };
};
