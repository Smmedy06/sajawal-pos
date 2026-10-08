'use strict';
const { fail, P, R, int, now, today, isDate, str, likeTerm, paging, fmtMoney } = require('../util');

const KIND_LABELS = { sale: 'Paid at sale', receipt: 'Udhaar received', refund: 'Refund' };

module.exports = function paymentsService(ctx) {
  const { store } = ctx;

  /** Customer pays off udhaar (or leaves an advance). */
  function receive({ customer_id, amount, method = 'Cash', note = '', allow_advance = false }) {
    return store.tx(() => {
      const c = ctx.customers.getRow(customer_id);
      const amt = P(amount);
      if (amt <= 0) fail('Enter an amount greater than 0', 'VALIDATION');
      const methods = ctx.settings.get().payment_methods;
      if (!methods.includes(method)) fail(`Unknown payment method "${method}"`, 'VALIDATION');
      const balance = ctx.customers.balanceP(c.id);
      if (amt > Math.max(0, balance) && !allow_advance) {
        fail(`Amount is more than the balance due (${fmtMoney(Math.max(0, balance))}). Tick "keep extra as advance" to accept it.`, 'OVERPAYMENT');
      }
      const ts = now();
      const res = store.run('INSERT INTO payments(created_at, customer_id, amount, method, kind, note, cashier) VALUES (?,?,?,?,?,?,?)',
        ts, c.id, amt, method, 'receipt', str(note, 200), ctx.user());
      const id = Number(res.lastInsertRowid);
      const after = ctx.customers.balanceP(c.id);
      ctx.audit('Payment Received', 'customer', c.id,
        `Received ${fmtMoney(amt)} (${method}) from "${c.name}". Balance ${fmtMoney(balance)} → ${fmtMoney(after)}${note ? '. Note: ' + str(note, 200) : ''}`);
      return { payment: get(id), balance_before: R(balance), balance_after: R(after) };
    });
  }

  /** Reverse a wrongly entered udhaar receipt. Sale payments change only by editing the invoice. */
  function voidPayment(id, reason = '') {
    return store.tx(() => {
      const p = store.get('SELECT * FROM payments WHERE id = ?', int(id));
      if (!p) fail('Payment not found', 'NOT_FOUND');
      if (p.voided) fail('Payment is already voided', 'VALIDATION');
      if (p.kind !== 'receipt') fail('Only udhaar receipts can be voided. To change what was paid on a bill, edit the invoice.', 'VALIDATION');
      if (!str(reason)) fail('Please enter a reason', 'VALIDATION');
      store.run('UPDATE payments SET voided = 1, voided_at = ?, void_reason = ? WHERE id = ?', now(), str(reason, 200), p.id);
      const name = p.customer_id ? ctx.customers.getRow(p.customer_id).name : 'Walk-in';
      ctx.audit('Payment Voided', 'customer', p.customer_id, `Voided receipt RCPT-${p.id} of ${fmtMoney(p.amount)} from "${name}". Reason: ${str(reason, 200)}`);
      return true;
    });
  }

  function toApi(p) {
    return {
      id: p.id, receipt_no: `RCPT-${p.id}`, created_at: p.created_at, customer_id: p.customer_id, customer_name: p.customer_name || (p.customer_id ? '' : 'Walk-in'),
      sale_id: p.sale_id, invoice_no: p.invoice_no || '', amount: R(p.amount), method: p.method, kind: p.kind, kind_label: KIND_LABELS[p.kind] || p.kind,
      note: p.note, cashier: p.cashier, voided: !!p.voided, void_reason: p.void_reason
    };
  }

  function get(id) {
    const p = store.get(`SELECT p.*, c.name AS customer_name, s.invoice_no FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
                         LEFT JOIN sales s ON s.id = p.sale_id WHERE p.id = ?`, int(id));
    if (!p) fail('Payment not found', 'NOT_FOUND');
    const out = toApi(p);
    if (p.customer_id) out.balance_now = R(ctx.customers.balanceP(p.customer_id));
    return out;
  }

  function list(opts = {}) {
    const params = [];
    const where = ['1=1'];
    if (!opts.include_voided) where.push('p.voided = 0');
    if (opts.from) { where.push('p.created_at >= ?'); params.push(`${opts.from} 00:00:00`); }
    if (opts.to) { where.push('p.created_at <= ?'); params.push(`${opts.to} 23:59:59.999`); }
    if (opts.customer_id) { where.push('p.customer_id = ?'); params.push(int(opts.customer_id)); }
    if (opts.kind) { where.push('p.kind = ?'); params.push(opts.kind); }
    if (opts.method) { where.push('p.method = ?'); params.push(opts.method); }
    if (opts.q) {
      const t = likeTerm(str(opts.q, 60));
      where.push("(c.name LIKE ? ESCAPE '\\' OR s.invoice_no LIKE ? ESCAPE '\\' OR p.note LIKE ? ESCAPE '\\')");
      params.push(t, t, t);
    }
    const w = `WHERE ${where.join(' AND ')}`;
    const join = 'FROM payments p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN sales s ON s.id = p.sale_id';
    const pg = paging(opts, 30);
    const total = Number(store.value(`SELECT COUNT(*) ${join} ${w}`, ...params));
    const sums = store.get(`SELECT COALESCE(SUM(CASE WHEN p.amount > 0 THEN p.amount END),0) AS received, COALESCE(SUM(CASE WHEN p.amount < 0 THEN -p.amount END),0) AS paid_out ${join} ${w}`, ...params);
    const rows = store.all(`SELECT p.*, c.name AS customer_name, s.invoice_no ${join} ${w} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`, ...params, pg.limit, pg.offset).map(toApi);
    return { rows, total, page: pg.page, pageSize: pg.pageSize, received: R(sums.received), paid_out: R(sums.paid_out) };
  }

  // ------------------------------------------------------------ expenses

  function addExpense({ date, category, amount, method = 'Cash', note = '' }) {
    return store.tx(() => {
      const amt = P(amount);
      if (amt <= 0) fail('Expense amount must be greater than 0', 'VALIDATION');
      const d = isDate(date) ? date : today();
      const cat = str(category, 40) || 'Other';
      const methods = ctx.settings.get().payment_methods;
      const m = methods.includes(method) ? method : 'Cash';
      const res = store.run('INSERT INTO expenses(date, created_at, category, amount, method, note, cashier) VALUES (?,?,?,?,?,?,?)',
        d, now(), cat, amt, m, str(note, 200), ctx.user());
      ctx.audit('Expense Added', 'expense', Number(res.lastInsertRowid), `${cat}: ${fmtMoney(amt)} (${m}) on ${d}${note ? ' — ' + str(note, 200) : ''}`);
      return { id: Number(res.lastInsertRowid) };
    });
  }

  function voidExpense(id, reason = '') {
    return store.tx(() => {
      const e = store.get('SELECT * FROM expenses WHERE id = ?', int(id));
      if (!e) fail('Expense not found', 'NOT_FOUND');
      if (e.voided) return true;
      store.run('UPDATE expenses SET voided = 1 WHERE id = ?', e.id);
      ctx.audit('Expense Deleted', 'expense', e.id, `Removed ${e.category} expense of ${fmtMoney(e.amount)} dated ${e.date}${reason ? '. Reason: ' + str(reason, 200) : ''}`);
      return true;
    });
  }

  function listExpenses(opts = {}) {
    const params = [];
    const where = ['voided = 0'];
    if (isDate(opts.from)) { where.push('date >= ?'); params.push(opts.from); }
    if (isDate(opts.to)) { where.push('date <= ?'); params.push(opts.to); }
    if (opts.category) { where.push('category = ?'); params.push(opts.category); }
    if (opts.q) { where.push("note LIKE ? ESCAPE '\\'"); params.push(likeTerm(str(opts.q, 60))); }
    const w = `WHERE ${where.join(' AND ')}`;
    const pg = paging(opts, 30);
    const total = Number(store.value(`SELECT COUNT(*) FROM expenses ${w}`, ...params));
    const sum = Number(store.value(`SELECT COALESCE(SUM(amount),0) FROM expenses ${w}`, ...params));
    const byCategory = store.all(`SELECT category, SUM(amount) AS amount, COUNT(*) AS n FROM expenses ${w} GROUP BY category ORDER BY amount DESC`, ...params)
      .map((r) => ({ category: r.category, amount: R(r.amount), count: Number(r.n) }));
    const rows = store.all(`SELECT * FROM expenses ${w} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`, ...params, pg.limit, pg.offset)
      .map((e) => ({ id: e.id, date: e.date, created_at: e.created_at, category: e.category, amount: R(e.amount), method: e.method, note: e.note, cashier: e.cashier }));
    return { rows, total, page: pg.page, pageSize: pg.pageSize, sum: R(sum), by_category: byCategory };
  }

  // ------------------------------------------------------------ activity log

  function audit(action, entity = '', entityId = null, details = '') {
    store.run('INSERT INTO audit_log(created_at, user, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)',
      now(), ctx.user(), str(action, 60), str(entity, 30), entityId === undefined ? null : entityId, str(details, 2000));
  }

  function activity(opts = {}) {
    const params = [];
    const where = ['1=1'];
    if (opts.from) { where.push('created_at >= ?'); params.push(`${opts.from} 00:00:00`); }
    if (opts.to) { where.push('created_at <= ?'); params.push(`${opts.to} 23:59:59.999`); }
    if (opts.entity) { where.push('entity = ?'); params.push(opts.entity); }
    if (opts.q) {
      const t = likeTerm(str(opts.q, 80));
      where.push("(action LIKE ? ESCAPE '\\' OR details LIKE ? ESCAPE '\\' OR user LIKE ? ESCAPE '\\')");
      params.push(t, t, t);
    }
    const w = `WHERE ${where.join(' AND ')}`;
    const pg = paging(opts, 30);
    const total = Number(store.value(`SELECT COUNT(*) FROM audit_log ${w}`, ...params));
    const rows = store.all(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, pg.limit, pg.offset);
    return { rows, total, page: pg.page, pageSize: pg.pageSize };
  }

  return { receive, voidPayment, get, list, addExpense, voidExpense, listExpenses, audit, activity, KIND_LABELS };
};
