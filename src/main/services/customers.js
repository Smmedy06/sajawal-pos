'use strict';
/*
 * Customers & Udhaar (credit) ledger.
 *
 * A customer's balance is never stored; it is always derived:
 *   balance = opening_balance + Σ(invoice total − returned) − Σ(payments, refunds are negative)
 * Positive balance = customer owes the shop. Negative = shop holds an advance.
 */
const { fail, P, R, int, now, str, likeTerm, paging, fmtMoney } = require('../util');

const BALANCE_SQL = `(c.opening_balance
  + COALESCE((SELECT SUM(s.total - s.returned_total) FROM sales s WHERE s.customer_id = c.id), 0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id = c.id AND p.voided = 0), 0))`;

module.exports = function customersService(ctx) {
  const { store } = ctx;

  function getRow(id) {
    const row = store.get('SELECT * FROM customers WHERE id = ?', int(id, 'Customer'));
    if (!row) fail('Customer not found', 'NOT_FOUND');
    return row;
  }

  function balanceP(id) {
    return Number(store.value(`SELECT ${BALANCE_SQL} FROM customers c WHERE c.id = ?`, id) || 0);
  }

  function toApi(row, balance) {
    return {
      id: row.id, name: row.name, phone: row.phone, address: row.address, notes: row.notes,
      opening_balance: R(row.opening_balance), is_active: !!row.is_active,
      balance: R(balance !== undefined ? balance : balanceP(row.id)),
      created_at: row.created_at
    };
  }

  function normPhone(p) {
    return str(p, 30).replace(/[^\d+]/g, '');
  }

  function validate(data, existing = {}) {
    const name = data.name !== undefined ? str(data.name, 100) : existing.name;
    if (!name) fail('Customer name is required', 'VALIDATION');
    if (name.toLowerCase() === 'walk-in customer') fail('"Walk-in Customer" is reserved. Please use a real name.', 'VALIDATION');
    const phone = data.phone !== undefined ? normPhone(data.phone) : existing.phone || '';
    return {
      name,
      phone,
      address: data.address !== undefined ? str(data.address, 200) : existing.address || '',
      notes: data.notes !== undefined ? str(data.notes, 300) : existing.notes || ''
    };
  }

  function assertPhoneFree(phone, exceptId = 0) {
    if (!phone) return;
    const d = store.get('SELECT name FROM customers WHERE is_active = 1 AND phone = ? AND id <> ?', phone, exceptId);
    if (d) fail(`Phone ${phone} already belongs to "${d.name}"`, 'DUPLICATE');
  }

  function create(data = {}, { silent = false, createdAt } = {}) {
    return store.tx(() => {
      const v = validate(data);
      assertPhoneFree(v.phone);
      const opening = P(data.opening_balance || 0);
      const ts = createdAt || now();
      const res = store.run(
        'INSERT INTO customers(name, phone, address, notes, opening_balance, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        v.name, v.phone, v.address, v.notes, opening, ts, ts
      );
      const id = Number(res.lastInsertRowid);
      if (!silent) ctx.audit('Customer Added', 'customer', id, `Added customer "${v.name}"${v.phone ? ' (' + v.phone + ')' : ''}${opening ? ', opening balance ' + fmtMoney(opening) : ''}`);
      return get(id);
    });
  }

  function update(id, data = {}) {
    return store.tx(() => {
      const row = getRow(id);
      const v = validate(data, row);
      assertPhoneFree(v.phone, row.id);
      const opening = data.opening_balance !== undefined ? P(data.opening_balance) : row.opening_balance;
      const changes = [];
      if (v.name !== row.name) changes.push(`Name: "${row.name}" → "${v.name}"`);
      if (v.phone !== row.phone) changes.push(`Phone: ${row.phone || '—'} → ${v.phone || '—'}`);
      if (v.address !== row.address) changes.push('Address changed');
      if (opening !== row.opening_balance) changes.push(`Opening balance: ${fmtMoney(row.opening_balance)} → ${fmtMoney(opening)}`);
      store.run('UPDATE customers SET name=?, phone=?, address=?, notes=?, opening_balance=?, updated_at=? WHERE id=?',
        v.name, v.phone, v.address, v.notes, opening, now(), row.id);
      // Keep invoice snapshots readable when a customer is renamed.
      if (v.name !== row.name || v.phone !== row.phone) {
        store.run('UPDATE sales SET customer_name = ?, customer_phone = ? WHERE customer_id = ?', v.name, v.phone, row.id);
      }
      if (changes.length) ctx.audit('Customer Updated', 'customer', row.id, `"${v.name}": ${changes.join('; ')}`);
      return get(row.id);
    });
  }

  function archive(id) {
    return store.tx(() => {
      const row = getRow(id);
      const bal = balanceP(row.id);
      if (bal !== 0) fail(`"${row.name}" still has a balance of ${fmtMoney(Math.abs(bal))}${bal < 0 ? ' (advance)' : ''}. Settle it before archiving.`, 'HAS_BALANCE');
      store.run('UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ?', now(), row.id);
      ctx.audit('Customer Archived', 'customer', row.id, `Archived "${row.name}"`);
      return true;
    });
  }

  function get(id) {
    const row = getRow(id);
    const agg = store.get(
      `SELECT COUNT(*) AS invoices, COALESCE(SUM(total - returned_total),0) AS purchases, MAX(created_at) AS last_sale
       FROM sales WHERE customer_id = ?`, row.id);
    const paid = store.get(
      `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END),0) AS received, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END),0) AS refunded
       FROM payments WHERE customer_id = ? AND voided = 0`, row.id);
    const c = toApi(row);
    c.invoices = Number(agg.invoices);
    c.purchases = R(agg.purchases);
    c.received = R(paid.received);
    c.refunded = R(paid.refunded);
    c.last_sale = agg.last_sale;
    return c;
  }

  function list(opts = {}) {
    const params = [];
    const where = [opts.archived ? 'c.is_active = 0' : 'c.is_active = 1'];
    if (opts.q) {
      where.push("(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')");
      const t = likeTerm(opts.q); params.push(t, t);
    }
    if (opts.filter === 'due') where.push(`${BALANCE_SQL} > 0`);
    if (opts.filter === 'advance') where.push(`${BALANCE_SQL} < 0`);
    if (opts.filter === 'clear') where.push(`${BALANCE_SQL} = 0`);
    const w = `WHERE ${where.join(' AND ')}`;
    const pg = paging(opts, 25);
    const total = store.value(`SELECT COUNT(*) FROM customers c ${w}`, ...params);
    const order = opts.sort === 'name' ? 'c.name COLLATE NOCASE' : opts.sort === 'recent' ? 'last_activity DESC' : 'balance DESC, c.name COLLATE NOCASE';
    const rows = store.all(
      `SELECT c.*, ${BALANCE_SQL} AS balance,
              (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS invoices,
              MAX(COALESCE((SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id), c.created_at),
                  COALESCE((SELECT MAX(created_at) FROM payments p WHERE p.customer_id = c.id), c.created_at)) AS last_activity
       FROM customers c ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, pg.limit, pg.offset
    ).map((r) => ({ ...toApi(r, r.balance), invoices: Number(r.invoices), last_activity: r.last_activity }));
    const totals = store.get(
      `SELECT COALESCE(SUM(CASE WHEN b > 0 THEN b END),0) AS receivable, COALESCE(SUM(CASE WHEN b < 0 THEN -b END),0) AS advances,
              COALESCE(SUM(CASE WHEN b > 0 THEN 1 END),0) AS debtors
       FROM (SELECT ${BALANCE_SQL} AS b FROM customers c WHERE c.is_active = 1)`);
    return {
      rows, total: Number(total), page: pg.page, pageSize: pg.pageSize,
      receivable: R(totals.receivable), advances: R(totals.advances), debtors: Number(totals.debtors)
    };
  }

  /** Fast autocomplete for the checkout / sell screen (feature #18: no lag). */
  function search(q, limit = 12) {
    const t = likeTerm(str(q, 60));
    return store.all(
      `SELECT c.*, ${BALANCE_SQL} AS balance FROM customers c
       WHERE c.is_active = 1 AND (c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')
       ORDER BY CASE WHEN c.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, c.name COLLATE NOCASE LIMIT ?`,
      t, t, `${str(q, 60).replace(/[\\%_]/g, (m) => '\\' + m)}%`, Math.min(50, limit)
    ).map((r) => toApi(r, r.balance));
  }

  /**
   * Allocate a customer's payments to invoices (oldest first) so each invoice
   * can show Paid / Partial / Unpaid. Payments made against a specific invoice
   * settle that invoice first; general receipts settle the oldest dues.
   */
  function invoiceDues(customerId) {
    const sales = store.all('SELECT id, total, returned_total FROM sales WHERE customer_id = ? ORDER BY created_at, id', customerId);
    const direct = new Map();
    for (const r of store.all('SELECT sale_id, SUM(amount) AS amt FROM payments WHERE customer_id = ? AND voided = 0 AND sale_id IS NOT NULL GROUP BY sale_id', customerId)) {
      direct.set(r.sale_id, Number(r.amt));
    }
    let pool = Number(store.value('SELECT COALESCE(SUM(amount),0) FROM payments WHERE customer_id = ? AND voided = 0 AND sale_id IS NULL', customerId));
    const opening = Number(store.value('SELECT opening_balance FROM customers WHERE id = ?', customerId) || 0);
    const result = new Map();
    const dues = [];
    for (const s of sales) {
      const net = s.total - s.returned_total;
      const paidDirect = direct.get(s.id) || 0;
      const due = net - paidDirect;
      if (due < 0) pool += -due; // over-paid invoice (e.g. return without refund) feeds the pool
      const entry = { net, paid: Math.min(net, Math.max(0, paidDirect)), due: Math.max(0, due) };
      result.set(s.id, entry);
      if (entry.due > 0) dues.push(entry);
    }
    // Opening balance is the oldest debt.
    if (opening > 0) pool -= Math.min(pool, opening);
    for (const e of dues) {
      if (pool <= 0) break;
      const take = Math.min(pool, e.due);
      e.due -= take; e.paid += take; pool -= take;
    }
    return result;
  }

  function statusFor(entry) {
    if (!entry) return 'paid';
    if (entry.net <= 0) return 'paid';
    if (entry.due <= 0) return 'paid';
    if (entry.due >= entry.net) return 'unpaid';
    return 'partial';
  }

  /** Full ledger statement with running balance (feature #9). */
  function ledger(id, opts = {}) {
    const customer = get(id);
    const row = getRow(id);
    const entries = [];
    if (row.opening_balance) {
      entries.push({ date: row.created_at, type: 'opening', ref: '', description: 'Opening balance', debit: row.opening_balance, credit: 0, order: 0 });
    }
    for (const s of store.all('SELECT id, invoice_no, created_at, total, subtotal, discount_amount, status FROM sales WHERE customer_id = ?', row.id)) {
      const items = store.all('SELECT product_name, qty FROM sale_items WHERE sale_id = ? ORDER BY id', s.id);
      const desc = items.slice(0, 3).map((i) => `${i.product_name} ×${i.qty}`).join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : '');
      entries.push({ date: s.created_at, type: 'sale', ref: s.invoice_no, sale_id: s.id, description: `Invoice — ${desc}`, debit: s.total, credit: 0, order: 1 });
    }
    for (const r of store.all('SELECT r.id, r.return_no, r.created_at, r.total, r.kind, s.invoice_no, s.id AS sale_id FROM returns r JOIN sales s ON s.id = r.sale_id WHERE s.customer_id = ?', row.id)) {
      entries.push({ date: r.created_at, type: r.kind, ref: r.return_no, sale_id: r.sale_id, description: `${r.kind === 'cancel' ? 'Sale cancelled' : 'Goods returned'} (${r.invoice_no})`, debit: 0, credit: r.total, order: 2 });
    }
    for (const p of store.all(
      `SELECT p.id, p.created_at, p.amount, p.method, p.kind, p.note, s.invoice_no, p.sale_id FROM payments p LEFT JOIN sales s ON s.id = p.sale_id
       WHERE p.customer_id = ? AND p.voided = 0`, row.id)) {
      let desc;
      if (p.kind === 'refund') desc = `Refund paid (${p.method})${p.invoice_no ? ' — ' + p.invoice_no : ''}`;
      else if (p.kind === 'sale') desc = `Paid at sale (${p.method}) — ${p.invoice_no}`;
      else desc = `Payment received (${p.method})${p.note ? ' — ' + p.note : ''}`;
      entries.push({
        date: p.created_at, type: p.kind === 'refund' ? 'refund' : 'payment', ref: p.invoice_no || `RCPT-${p.id}`, payment_id: p.id, sale_id: p.sale_id,
        description: desc, debit: p.amount < 0 ? -p.amount : 0, credit: p.amount > 0 ? p.amount : 0, order: 3
      });
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
    const from = opts.from ? `${opts.from} 00:00:00` : null;
    const to = opts.to ? `${opts.to} 23:59:59.999` : null;
    let running = 0;
    let opening = 0;
    const rows = [];
    let totalDebit = 0;
    let totalCredit = 0;
    for (const e of entries) {
      running += e.debit - e.credit;
      if (from && e.date < from) { opening = running; continue; }
      if (to && e.date > to) continue;
      totalDebit += e.debit; totalCredit += e.credit;
      rows.push({ ...e, debit: R(e.debit), credit: R(e.credit), balance: R(running) });
    }
    const closing = from || to ? opening + totalDebit - totalCredit : running;
    const dues = invoiceDues(row.id);
    const openInvoices = store.all('SELECT id, invoice_no, created_at, total, returned_total FROM sales WHERE customer_id = ? ORDER BY created_at', row.id)
      .map((s) => ({ sale_id: s.id, invoice_no: s.invoice_no, created_at: s.created_at, net: R(s.total - s.returned_total), due: R(dues.get(s.id)?.due || 0), status: statusFor(dues.get(s.id)) }))
      .filter((s) => s.due > 0);
    return {
      customer,
      from: opts.from || '', to: opts.to || '',
      opening_balance: R(opening),
      total_debit: R(totalDebit), total_credit: R(totalCredit),
      closing_balance: R(closing),
      rows,
      open_invoices: openInvoices
    };
  }

  /** What a customer has bought, per product (net of returns). */
  function products(id, opts = {}) {
    const row = getRow(id);
    const from = opts.from ? `${opts.from} 00:00:00` : '0000-01-01';
    const to = opts.to ? `${opts.to} 23:59:59.999` : '9999-12-31';
    return store.all(
      `SELECT i.product_id, MAX(i.product_name) AS product_name, SUM(i.qty) AS qty, SUM(i.returned_qty) AS returned,
              SUM(i.line_total) AS amount, COUNT(DISTINCT i.sale_id) AS invoices, MAX(s.created_at) AS last_date,
              ROUND(SUM(i.line_total) * 1.0 / SUM(i.qty)) AS avg_price
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
       WHERE s.customer_id = ? AND s.created_at BETWEEN ? AND ?
       GROUP BY i.product_id ORDER BY qty DESC`, row.id, from, to
    ).map((r) => ({
      product_id: r.product_id, product_name: r.product_name, qty: Number(r.qty), returned: Number(r.returned), net_qty: Number(r.qty) - Number(r.returned),
      amount: R(r.amount), avg_price: R(r.avg_price), invoices: Number(r.invoices), last_date: r.last_date
    }));
  }

  return { BALANCE_SQL, getRow, balanceP, create, update, archive, get, list, search, invoiceDues, statusFor, ledger, products };
};
