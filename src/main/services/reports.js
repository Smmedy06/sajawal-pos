'use strict';
/*
 * Reporting. All figures for a period follow one accounting rule:
 *   - a sale counts on the day it was made,
 *   - a return / cancellation counts on the day it happened,
 *   - net sales = sales − returns; COGS = cost of sold items − cost of restocked returns,
 *   - gross profit = net sales − COGS; net profit = gross profit − expenses.
 */
const { R, today, isDate } = require('../util');

const DAY = 86400000;

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

module.exports = function reportsService(ctx) {
  const { store } = ctx;

  function bounds(opts = {}) {
    let from = isDate(opts.from) ? opts.from : null;
    const to = isDate(opts.to) ? opts.to : today();
    if (!from) {
      const first = store.value('SELECT MIN(created_at) FROM sales');
      from = first ? first.slice(0, 10) : to;
    }
    if (from > to) from = to;
    return { from, to, fromTs: `${from} 00:00:00`, toTs: `${to} 23:59:59.999` };
  }

  function granularity(from, to, requested) {
    if (requested && ['hour', 'day', 'month'].includes(requested)) return requested;
    const days = Math.round((parseDate(to) - parseDate(from)) / DAY) + 1;
    if (days <= 1) return 'hour';
    if (days <= 92) return 'day';
    return 'month';
  }

  function bucketExpr(g, col) {
    if (g === 'hour') return `strftime('%H', ${col})`;
    if (g === 'month') return `substr(${col}, 1, 7)`;
    return `substr(${col}, 1, 10)`;
  }

  function bucketLabels(from, to, g) {
    const out = [];
    if (g === 'hour') {
      for (let h = 0; h < 24; h++) out.push(String(h).padStart(2, '0'));
    } else if (g === 'day') {
      for (let d = parseDate(from); d <= parseDate(to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(today(d));
    } else {
      const end = parseDate(to);
      for (let d = parseDate(from); d <= end || (d.getFullYear() === end.getFullYear() && d.getMonth() === end.getMonth()); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        out.push(today(d).slice(0, 7));
        if (out.length > 600) break;
      }
    }
    return out;
  }

  /** Sales / returns / expenses per time bucket. */
  function series(b, g) {
    const sb = bucketExpr(g, 's.created_at');
    const rb = bucketExpr(g, 'r.created_at');
    const eb = g === 'hour' ? "'00'" : g === 'month' ? 'substr(e.date, 1, 7)' : 'e.date';
    const map = new Map(bucketLabels(b.from, b.to, g).map((k) => [k, { key: k, sales: 0, cost: 0, returns: 0, return_cost: 0, invoices: 0, expenses: 0 }]));
    for (const r of store.all(`SELECT ${sb} AS k, SUM(s.total) AS v, SUM(s.cost_total) AS c, SUM(CASE WHEN s.status <> 'cancelled' THEN 1 ELSE 0 END) AS n
                               FROM sales s WHERE s.created_at BETWEEN ? AND ? GROUP BY k`, b.fromTs, b.toTs)) {
      const e = map.get(r.k); if (e) { e.sales = Number(r.v); e.cost = Number(r.c); e.invoices = Number(r.n); }
    }
    for (const r of store.all(`SELECT ${rb} AS k, SUM(r.total) AS v, SUM(r.cost_total) AS c FROM returns r WHERE r.created_at BETWEEN ? AND ? GROUP BY k`, b.fromTs, b.toTs)) {
      const e = map.get(r.k); if (e) { e.returns = Number(r.v); e.return_cost = Number(r.c); }
    }
    if (g !== 'hour') {
      for (const r of store.all(`SELECT ${eb} AS k, SUM(e.amount) AS v FROM expenses e WHERE e.voided = 0 AND e.date BETWEEN ? AND ? GROUP BY k`, b.from, b.to)) {
        const e = map.get(r.k); if (e) e.expenses = Number(r.v);
      }
    }
    return [...map.values()].map((e) => {
      const net = e.sales - e.returns;
      const cogs = e.cost - e.return_cost;
      return {
        key: e.key, invoices: e.invoices, sales: R(e.sales), returns: R(e.returns), net_sales: R(net), cogs: R(cogs),
        gross_profit: R(net - cogs), expenses: R(e.expenses), net_profit: R(net - cogs - e.expenses)
      };
    });
  }

  function totals(b) {
    const s = store.get(`SELECT COUNT(CASE WHEN status <> 'cancelled' THEN 1 END) AS n, COALESCE(SUM(total),0) AS gross, COALESCE(SUM(cost_total),0) AS cost,
                                COALESCE(SUM(discount_amount),0) AS discount
                         FROM sales WHERE created_at BETWEEN ? AND ?`, b.fromTs, b.toTs);
    const r = store.get('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS v, COALESCE(SUM(cost_total),0) AS c, COALESCE(SUM(refund_amount),0) AS refunded FROM returns WHERE created_at BETWEEN ? AND ?', b.fromTs, b.toTs);
    const q = store.get('SELECT COALESCE(SUM(i.qty),0) AS q FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.created_at BETWEEN ? AND ?', b.fromTs, b.toTs);
    const rq = store.get('SELECT COALESCE(SUM(ri.qty),0) AS q FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE r.created_at BETWEEN ? AND ?', b.fromTs, b.toTs);
    const exp = Number(store.value('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE voided = 0 AND date BETWEEN ? AND ?', b.from, b.to));
    const pay = store.get(`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END),0) AS received,
                                  COALESCE(SUM(CASE WHEN kind = 'receipt' AND amount > 0 THEN amount END),0) AS udhaar_received,
                                  COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END),0) AS refunds
                           FROM payments WHERE voided = 0 AND created_at BETWEEN ? AND ?`, b.fromTs, b.toTs);
    // Udhaar given = part of credit sales not paid at the counter.
    const credit = Number(store.value(
      `SELECT COALESCE(SUM(MAX(0, s.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sale_id = s.id AND p.kind = 'sale' AND p.voided = 0), 0))), 0)
       FROM sales s WHERE s.customer_id IS NOT NULL AND s.created_at BETWEEN ? AND ?`, b.fromTs, b.toTs));
    const net = Number(s.gross) - Number(r.v);
    const cogs = Number(s.cost) - Number(r.c);
    const invoices = Number(s.n);
    return {
      invoices, gross_sales: R(s.gross), discounts: R(s.discount), returns: R(r.v), return_count: Number(r.n), net_sales: R(net),
      cogs: R(cogs), gross_profit: R(net - cogs), margin: net > 0 ? Math.round(((net - cogs) / net) * 1000) / 10 : 0,
      expenses: R(exp), net_profit: R(net - cogs - exp), items_sold: Number(q.q) - Number(rq.q),
      avg_bill: invoices ? R(Math.round(net / invoices)) : 0,
      money_received: R(pay.received), udhaar_received: R(pay.udhaar_received), refunds: R(pay.refunds), udhaar_given: R(credit)
    };
  }

  function dashboard(opts = {}) {
    const b = bounds(opts);
    const g = granularity(b.from, b.to, opts.granularity);
    const t = totals(b);
    // Same-length previous period for comparison.
    const days = Math.round((parseDate(b.to) - parseDate(b.from)) / DAY) + 1;
    const pf = parseDate(b.from);
    const prevTo = today(new Date(pf.getFullYear(), pf.getMonth(), pf.getDate() - 1));
    const prevFrom = today(new Date(pf.getFullYear(), pf.getMonth(), pf.getDate() - days));
    const prev = totals({ from: prevFrom, to: prevTo, fromTs: `${prevFrom} 00:00:00`, toTs: `${prevTo} 23:59:59.999` });
    const top = byProduct(b).sort((a, c) => c.qty - a.qty).filter((x) => x.qty > 0).slice(0, 8);
    const methods = store.all(`SELECT method, SUM(amount) AS v FROM payments WHERE voided = 0 AND amount > 0 AND created_at BETWEEN ? AND ? GROUP BY method ORDER BY v DESC`, b.fromTs, b.toTs)
      .map((r) => ({ method: r.method, amount: R(r.v) }));
    const recent = ctx.sales.list({ page: 1, pageSize: 8 }).rows;
    const attention = ctx.products.list({ status: 'attention', sort: 'stock_asc', pageSize: 8 });
    const expiring = ctx.products.list({ status: 'expiring', sort: 'expiry', pageSize: 5 });
    const cust = ctx.customers.list({ filter: 'due', pageSize: 5 });
    return {
      from: b.from, to: b.to, granularity: g, totals: t,
      previous: { from: prevFrom, to: prevTo, totals: prev },
      series: series(b, g), top_products: top, payment_methods: methods, recent_sales: recent,
      low_stock: attention.rows, low_stock_count: attention.total, expiring: expiring.rows, expiring_count: expiring.total,
      receivable: cust.receivable, debtors: cust.debtors, top_debtors: cust.rows,
      inventory: ctx.products.summary()
    };
  }

  // ------------------------------------------------------------ profit breakdowns

  function finish(rows) {
    return rows.map((r) => {
      const revenue = r.revenue - (r.ret_amount || 0);
      const cost = r.cost - (r.ret_cost || 0);
      return {
        ...r, qty: (r.qty || 0) - (r.ret_qty || 0), revenue: R(revenue), cost: R(cost), profit: R(revenue - cost),
        margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0,
        discount: R(r.discount || 0), returns: R(r.ret_amount || 0)
      };
    }).map(({ ret_amount, ret_cost, ret_qty, ...x }) => x);
  }

  function byProduct(b) {
    const map = new Map();
    for (const r of store.all(
      `SELECT i.product_id AS id, MAX(i.product_name) AS name, COALESCE(p.category, '') AS category, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue,
              SUM(i.qty * i.cost_price) AS cost, SUM(i.discount_share) AS discount, COUNT(DISTINCT i.sale_id) AS invoices
       FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN products p ON p.id = i.product_id
       WHERE s.created_at BETWEEN ? AND ? GROUP BY i.product_id`, b.fromTs, b.toTs)) {
      map.set(r.id, { id: r.id, name: r.name, category: r.category, qty: Number(r.qty), revenue: Number(r.revenue), cost: Number(r.cost), discount: Number(r.discount), invoices: Number(r.invoices) });
    }
    for (const r of store.all(
      `SELECT ri.product_id AS id, MAX(ri.product_name) AS name, COALESCE(p.category,'') AS category, SUM(ri.qty) AS q, SUM(ri.amount) AS a, SUM(ri.cost) AS c
       FROM return_items ri JOIN returns r ON r.id = ri.return_id LEFT JOIN products p ON p.id = ri.product_id
       WHERE r.created_at BETWEEN ? AND ? GROUP BY ri.product_id`, b.fromTs, b.toTs)) {
      const e = map.get(r.id) || { id: r.id, name: r.name, category: r.category, qty: 0, revenue: 0, cost: 0, discount: 0, invoices: 0 };
      e.ret_qty = Number(r.q); e.ret_amount = Number(r.a); e.ret_cost = Number(r.c);
      map.set(r.id, e);
    }
    return finish([...map.values()]);
  }

  function byCategory(b) {
    const map = new Map();
    for (const p of byProduct(b)) {
      const k = p.category || 'Uncategorised';
      const e = map.get(k) || { id: k, name: k, qty: 0, revenue: 0, cost: 0, profit: 0, discount: 0, returns: 0, products: 0 };
      e.qty += p.qty; e.revenue += p.revenue; e.cost += p.cost; e.profit += p.profit; e.discount += p.discount; e.returns += p.returns; e.products += 1;
      map.set(k, e);
    }
    return [...map.values()].map((e) => ({
      ...e, revenue: Math.round(e.revenue * 100) / 100, cost: Math.round(e.cost * 100) / 100, profit: Math.round(e.profit * 100) / 100,
      margin: e.revenue > 0 ? Math.round((e.profit / e.revenue) * 1000) / 10 : 0
    }));
  }

  function byCustomer(b) {
    const map = new Map();
    for (const r of store.all(
      `SELECT COALESCE(s.customer_id, 0) AS id, CASE WHEN s.customer_id IS NULL THEN 'Walk-in customers' ELSE MAX(s.customer_name) END AS name,
              COUNT(CASE WHEN s.status <> 'cancelled' THEN 1 END) AS invoices, SUM(s.total) AS revenue, SUM(s.cost_total) AS cost, SUM(s.discount_amount) AS discount,
              (SELECT COALESCE(SUM(i.qty),0) FROM sale_items i JOIN sales s2 ON s2.id = i.sale_id WHERE COALESCE(s2.customer_id,0) = COALESCE(s.customer_id,0) AND s2.created_at BETWEEN ? AND ?) AS qty
       FROM sales s WHERE s.created_at BETWEEN ? AND ? GROUP BY COALESCE(s.customer_id, 0)`, b.fromTs, b.toTs, b.fromTs, b.toTs)) {
      map.set(r.id, { id: r.id, name: r.name, invoices: Number(r.invoices), qty: Number(r.qty), revenue: Number(r.revenue), cost: Number(r.cost), discount: Number(r.discount) });
    }
    for (const r of store.all(
      `SELECT COALESCE(r.customer_id, 0) AS id, MAX(s.customer_name) AS name, SUM(r.total) AS a, SUM(r.cost_total) AS c,
              (SELECT COALESCE(SUM(ri.qty),0) FROM return_items ri JOIN returns r2 ON r2.id = ri.return_id WHERE COALESCE(r2.customer_id,0) = COALESCE(r.customer_id,0) AND r2.created_at BETWEEN ? AND ?) AS q
       FROM returns r JOIN sales s ON s.id = r.sale_id WHERE r.created_at BETWEEN ? AND ? GROUP BY COALESCE(r.customer_id, 0)`, b.fromTs, b.toTs, b.fromTs, b.toTs)) {
      const e = map.get(r.id) || { id: r.id, name: r.id ? r.name : 'Walk-in customers', invoices: 0, qty: 0, revenue: 0, cost: 0, discount: 0 };
      e.ret_amount = Number(r.a); e.ret_cost = Number(r.c); e.ret_qty = Number(r.q);
      map.set(r.id, e);
    }
    const rows = finish([...map.values()]);
    for (const r of rows) r.balance = r.id ? R(ctx.customers.balanceP(r.id)) : 0;
    return rows;
  }

  function byInvoice(b) {
    return store.all(
      `SELECT s.id, s.invoice_no AS name, s.created_at, s.customer_name, s.status, s.discount_amount AS discount,
              (SELECT COALESCE(SUM(qty - returned_qty),0) FROM sale_items WHERE sale_id = s.id) AS qty,
              s.total - s.returned_total AS revenue, s.cost_total - s.returned_cost AS cost, s.returned_total AS returns
       FROM sales s WHERE s.created_at BETWEEN ? AND ? ORDER BY s.created_at DESC`, b.fromTs, b.toTs
    ).map((r) => ({
      id: r.id, name: r.name, created_at: r.created_at, customer_name: r.customer_name, status: r.status, qty: Number(r.qty),
      revenue: R(r.revenue), cost: R(r.cost), profit: R(r.revenue - r.cost), discount: R(r.discount), returns: R(r.returns),
      margin: r.revenue > 0 ? Math.round(((r.revenue - r.cost) / r.revenue) * 1000) / 10 : 0
    }));
  }

  function profit(opts = {}) {
    const b = bounds(opts);
    const by = opts.by || 'product';
    let rows;
    if (by === 'product') rows = byProduct(b);
    else if (by === 'category') rows = byCategory(b);
    else if (by === 'customer') rows = byCustomer(b);
    else if (by === 'invoice') rows = byInvoice(b);
    else if (by === 'day' || by === 'month') {
      rows = series(b, by).filter((x) => x.sales || x.returns || x.expenses).map((x) => ({
        id: x.key, name: x.key, invoices: x.invoices, revenue: x.net_sales, cost: x.cogs, profit: x.gross_profit,
        returns: x.returns, expenses: x.expenses, net_profit: x.net_profit,
        margin: x.net_sales > 0 ? Math.round((x.gross_profit / x.net_sales) * 1000) / 10 : 0
      })).reverse();
    } else rows = [];
    if (by !== 'day' && by !== 'month' && by !== 'invoice') rows.sort((a, c) => c.profit - a.profit);
    return { from: b.from, to: b.to, by, rows, totals: totals(b) };
  }

  // ------------------------------------------------------------ cash book / day end

  function cashbook(opts = {}) {
    const b = bounds(opts);
    const methods = ctx.settings.get().payment_methods;
    const days = new Map();
    const ensure = (d) => {
      if (!days.has(d)) days.set(d, { date: d, sales_collected: 0, udhaar_received: 0, refunds: 0, expenses: 0, by_method: {} });
      return days.get(d);
    };
    for (const r of store.all(`SELECT substr(created_at,1,10) AS d, kind, method, SUM(amount) AS v FROM payments WHERE voided = 0 AND created_at BETWEEN ? AND ? GROUP BY d, kind, method`, b.fromTs, b.toTs)) {
      const e = ensure(r.d);
      const v = Number(r.v);
      if (r.kind === 'sale') e.sales_collected += v;
      else if (r.kind === 'receipt') e.udhaar_received += v;
      else if (r.kind === 'refund') e.refunds += -v;
      e.by_method[r.method] = (e.by_method[r.method] || 0) + v;
    }
    for (const r of store.all('SELECT date AS d, method, SUM(amount) AS v FROM expenses WHERE voided = 0 AND date BETWEEN ? AND ? GROUP BY d, method', b.from, b.to)) {
      const e = ensure(r.d);
      e.expenses += Number(r.v);
      e.by_method[r.method] = (e.by_method[r.method] || 0) - Number(r.v);
    }
    const rows = [...days.values()].sort((a, c) => (a.date < c.date ? 1 : -1)).map((e) => ({
      date: e.date, sales_collected: R(e.sales_collected), udhaar_received: R(e.udhaar_received), refunds: R(e.refunds), expenses: R(e.expenses),
      net: R(e.sales_collected + e.udhaar_received - e.refunds - e.expenses),
      cash_net: R(e.by_method.Cash || 0),
      by_method: Object.fromEntries(Object.entries(e.by_method).map(([k, v]) => [k, R(v)]))
    }));
    const methodTotals = {};
    for (const m of methods) methodTotals[m] = 0;
    for (const r of rows) for (const [m, v] of Object.entries(r.by_method)) methodTotals[m] = Math.round(((methodTotals[m] || 0) + v) * 100) / 100;
    const sum = (k) => Math.round(rows.reduce((a, r) => a + r[k] * 100, 0)) / 100;
    return {
      from: b.from, to: b.to, rows, methods: methodTotals,
      totals: { sales_collected: sum('sales_collected'), udhaar_received: sum('udhaar_received'), refunds: sum('refunds'), expenses: sum('expenses'), net: sum('net'), cash_net: sum('cash_net') },
      summary: totals(b)
    };
  }

  // ------------------------------------------------------------ receivables & stock

  function receivables() {
    const list = store.all(`SELECT c.id, c.name, c.phone, c.opening_balance, ${ctx.customers.BALANCE_SQL} AS balance FROM customers c WHERE c.is_active = 1 AND ${ctx.customers.BALANCE_SQL} > 0 ORDER BY balance DESC`);
    const t = Date.now();
    const rows = list.map((c) => {
      const dues = ctx.customers.invoiceDues(c.id);
      const age = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
      let oldest = null;
      for (const s of store.all('SELECT id, created_at FROM sales WHERE customer_id = ? ORDER BY created_at', c.id)) {
        const e = dues.get(s.id);
        if (!e || e.due <= 0) continue;
        const days = Math.floor((t - new Date(s.created_at.replace(' ', 'T')).getTime()) / DAY);
        if (!oldest) oldest = s.created_at;
        if (days <= 30) age.d0_30 += e.due; else if (days <= 60) age.d31_60 += e.due; else if (days <= 90) age.d61_90 += e.due; else age.d90 += e.due;
      }
      const invoiceDue = age.d0_30 + age.d31_60 + age.d61_90 + age.d90;
      const opening = Math.max(0, Number(c.balance) - invoiceDue); // opening (pre-system) udhaar not yet paid
      const lastPay = store.value('SELECT MAX(created_at) FROM payments WHERE customer_id = ? AND voided = 0 AND amount > 0', c.id);
      return {
        id: c.id, name: c.name, phone: c.phone, balance: R(c.balance), oldest_due: oldest, last_payment: lastPay || null,
        opening: R(opening), d0_30: R(age.d0_30), d31_60: R(age.d31_60), d61_90: R(age.d61_90), d90: R(age.d90)
      };
    });
    const sum = (k) => Math.round(rows.reduce((a, r) => a + r[k] * 100, 0)) / 100;
    return { rows, totals: { balance: sum('balance'), opening: sum('opening'), d0_30: sum('d0_30'), d31_60: sum('d31_60'), d61_90: sum('d61_90'), d90: sum('d90') } };
  }

  function stockValuation() {
    const s = ctx.settings.get();
    const markup = Number(s.markup_percentage) || 0;
    const rows = store.all(
      `SELECT CASE WHEN category = '' THEN 'Uncategorised' ELSE category END AS category, COUNT(*) AS products,
              COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty END),0) AS units,
              COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty * cost_price END),0) AS cost_value,
              COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty * COALESCE(sell_price, CAST(ROUND(cost_price * (1 + ? / 100.0) / 100.0) AS INTEGER) * 100) END),0) AS retail_value
       FROM products WHERE is_active = 1 GROUP BY 1 ORDER BY cost_value DESC`, markup
    ).map((r) => ({ category: r.category, products: Number(r.products), units: Number(r.units), cost_value: R(r.cost_value), retail_value: R(r.retail_value), potential_profit: R(r.retail_value - r.cost_value) }));
    return { rows, totals: ctx.products.summary() };
  }

  return { dashboard, profit, cashbook, receivables, stockValuation, totals: (o) => totals(bounds(o)), series: (o) => { const b = bounds(o); return series(b, granularity(b.from, b.to, o.granularity)); } };
};
