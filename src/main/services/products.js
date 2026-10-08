'use strict';
const { fail, P, Pn, R, int, now, today, str, likeTerm, paging, fmtMoney } = require('../util');

const MOVE_LABELS = {
  opening: 'Opening stock',
  stock_in: 'Stock in',
  stock_out: 'Stock out',
  count: 'Stock count correction',
  sale: 'Sale',
  sale_edit: 'Sale edited',
  return: 'Sale return',
  cancel: 'Sale cancelled',
  import: 'Excel import'
};

module.exports = function productsService(ctx) {
  const { store } = ctx;

  function effectivePrice(row, markup) {
    if (row.sell_price !== null && row.sell_price !== undefined) return row.sell_price;
    const m = markup === undefined ? Number(ctx.settings.get().markup_percentage) || 0 : markup;
    // Markup prices are rounded to the nearest whole rupee.
    return Math.round((row.cost_price * (1 + m / 100)) / 100) * 100;
  }

  function lowLevel(row, def) {
    return row.low_stock_level === null || row.low_stock_level === undefined ? def : row.low_stock_level;
  }

  function toApi(row, s = ctx.settings.get()) {
    if (!row) return null;
    const price = effectivePrice(row, s.markup_percentage);
    const low = lowLevel(row, s.low_stock_default);
    return {
      id: row.id,
      name: row.name,
      sku: row.sku || '',
      category: row.category,
      brand: row.brand,
      supplier: row.supplier,
      cost_price: R(row.cost_price),
      sell_price: R(row.sell_price),
      price: R(price),
      price_rule: row.sell_price === null ? 'markup' : 'manual',
      stock_qty: row.stock_qty,
      low_stock_level: row.low_stock_level,
      low_level: low,
      stock_status: row.stock_qty <= 0 ? 'out' : row.stock_qty <= low ? 'low' : 'ok',
      expiry_date: row.expiry_date || '',
      is_active: !!row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  function getRow(id) {
    const row = store.get('SELECT * FROM products WHERE id = ?', int(id, 'Product'));
    if (!row) fail('Product not found', 'NOT_FOUND');
    return row;
  }

  /**
   * The single entry point for changing stock. Writes the movement record
   * (with running balance) in the caller's transaction.
   */
  function moveStock(productId, qty, type, { refType = null, refId = null, refNo = null, note = '', unitCost = null, allowNegative } = {}) {
    if (!qty) return null;
    const row = getRow(productId);
    const balance = row.stock_qty + qty;
    const negOk = allowNegative !== undefined ? allowNegative : ctx.settings.get().allow_negative_stock;
    if (qty < 0 && balance < 0 && !negOk) {
      fail(`Not enough stock for "${row.name}". Available: ${row.stock_qty}, needed: ${-qty}.`, 'INSUFFICIENT_STOCK');
    }
    const ts = now();
    store.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', balance, ts, row.id);
    store.run(
      `INSERT INTO stock_movements(product_id, created_at, qty, balance_after, type, unit_cost, ref_type, ref_id, ref_no, note, user)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      row.id, ts, qty, balance, type, unitCost, refType, refId, refNo, str(note, 300), ctx.user()
    );
    return { before: row.stock_qty, after: balance, name: row.name };
  }

  function validate(data, existing) {
    const out = {};
    const name = data.name !== undefined ? str(data.name, 160) : existing.name;
    if (!name) fail('Product name is required', 'VALIDATION');
    out.name = name;
    out.sku = data.sku !== undefined ? str(data.sku, 64) : existing.sku || '';
    out.category = data.category !== undefined ? str(data.category, 60) : existing.category;
    out.brand = data.brand !== undefined ? str(data.brand, 60) : existing.brand;
    out.supplier = data.supplier !== undefined ? str(data.supplier, 100) : existing.supplier;
    out.cost_price = data.cost_price !== undefined ? P(data.cost_price) : existing.cost_price;
    if (out.cost_price < 0) fail('Cost price cannot be negative', 'VALIDATION');
    out.sell_price = data.sell_price !== undefined ? Pn(data.sell_price) : existing.sell_price;
    if (out.sell_price !== null && out.sell_price < 0) fail('Selling price cannot be negative', 'VALIDATION');
    if (data.low_stock_level !== undefined) {
      out.low_stock_level = data.low_stock_level === '' || data.low_stock_level === null ? null : int(data.low_stock_level, 'Low stock level');
      if (out.low_stock_level !== null && out.low_stock_level < 0) fail('Low stock level cannot be negative', 'VALIDATION');
    } else out.low_stock_level = existing.low_stock_level;
    if (data.expiry_date !== undefined) {
      const e = str(data.expiry_date, 10);
      if (e && !/^\d{4}-\d{2}-\d{2}$/.test(e)) fail('Expiry date must be a valid date', 'VALIDATION');
      out.expiry_date = e || null;
    } else out.expiry_date = existing.expiry_date;
    return out;
  }

  function assertUnique(name, sku, exceptId = 0) {
    const dup = store.get('SELECT id FROM products WHERE is_active = 1 AND name = ? COLLATE NOCASE AND id <> ?', name, exceptId);
    if (dup) fail(`A product named "${name}" already exists`, 'DUPLICATE');
    if (sku) {
      const d2 = store.get('SELECT name FROM products WHERE is_active = 1 AND sku = ? COLLATE NOCASE AND id <> ?', sku, exceptId);
      if (d2) fail(`Barcode/SKU "${sku}" is already used by "${d2.name}"`, 'DUPLICATE');
    }
  }

  function create(data = {}, { movementType = 'opening', silent = false } = {}) {
    return store.tx(() => {
      const v = validate(data, { name: '', sku: '', category: '', brand: '', supplier: '', cost_price: 0, sell_price: null, low_stock_level: null, expiry_date: null });
      assertUnique(v.name, v.sku);
      const stock = data.stock_qty === undefined || data.stock_qty === '' ? 0 : int(data.stock_qty, 'Opening stock');
      if (stock < 0) fail('Opening stock cannot be negative', 'VALIDATION');
      const ts = now();
      const res = store.run(
        `INSERT INTO products(name, sku, category, brand, supplier, cost_price, sell_price, stock_qty, low_stock_level, expiry_date, legacy_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)`,
        v.name, v.sku || null, v.category, v.brand, v.supplier, v.cost_price, v.sell_price, v.low_stock_level, v.expiry_date, data.legacy_id || null, ts, ts
      );
      const id = Number(res.lastInsertRowid);
      if (stock) moveStock(id, stock, movementType, { note: data.stock_note || MOVE_LABELS[movementType], unitCost: v.cost_price, allowNegative: true });
      if (!silent) ctx.audit('Product Added', 'product', id, `Added "${v.name}" — cost ${fmtMoney(v.cost_price)}, ${v.sell_price === null ? 'markup price' : 'price ' + fmtMoney(v.sell_price)}, opening stock ${stock} pcs`);
      return get(id);
    });
  }

  function update(id, data = {}) {
    return store.tx(() => {
      const row = getRow(id);
      if (!row.is_active) fail('This product is archived. Restore it first.', 'ARCHIVED');
      const v = validate(data, row);
      assertUnique(v.name, v.sku, row.id);
      const changes = [];
      const cmp = [
        ['name', 'Name', (x) => `"${x}"`],
        ['sku', 'Barcode', (x) => x || '—'],
        ['category', 'Category', (x) => x || '—'],
        ['brand', 'Brand', (x) => x || '—'],
        ['supplier', 'Supplier', (x) => x || '—'],
        ['cost_price', 'Cost', fmtMoney],
        ['sell_price', 'Price', (x) => (x === null ? 'markup' : fmtMoney(x))],
        ['low_stock_level', 'Low-stock level', (x) => (x === null ? 'default' : x)],
        ['expiry_date', 'Expiry', (x) => x || '—']
      ];
      for (const [k, label, f] of cmp) {
        const a = row[k] === undefined ? null : row[k];
        const b = v[k] === '' && k === 'sku' ? null : v[k];
        if ((a || null) !== (b || null) && !(a === 0 && b === 0)) changes.push(`${label}: ${f(a)} → ${f(b)}`);
      }
      store.run(
        `UPDATE products SET name=?, sku=?, category=?, brand=?, supplier=?, cost_price=?, sell_price=?, low_stock_level=?, expiry_date=?, updated_at=? WHERE id=?`,
        v.name, v.sku || null, v.category, v.brand, v.supplier, v.cost_price, v.sell_price, v.low_stock_level, v.expiry_date, now(), row.id
      );
      if (changes.length) ctx.audit('Product Updated', 'product', row.id, `"${row.name}": ${changes.join('; ')}`);
      return get(row.id);
    });
  }

  function archive(id) {
    return store.tx(() => {
      const row = getRow(id);
      store.run('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?', now(), row.id);
      ctx.audit('Product Archived', 'product', row.id, `Archived "${row.name}" (stock ${row.stock_qty}). Sales history is kept.`);
      return true;
    });
  }

  function restore(id) {
    return store.tx(() => {
      const row = getRow(id);
      assertUnique(row.name, row.sku, row.id);
      store.run('UPDATE products SET is_active = 1, updated_at = ? WHERE id = ?', now(), row.id);
      ctx.audit('Product Restored', 'product', row.id, `Restored "${row.name}"`);
      return get(row.id);
    });
  }

  function get(id) {
    return toApi(getRow(id));
  }

  function filterSql(opts, params) {
    const s = ctx.settings.get();
    const where = [];
    where.push(opts.status === 'archived' ? 'p.is_active = 0' : 'p.is_active = 1');
    if (opts.q) {
      where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.category LIKE ? ESCAPE '\\')");
      const t = likeTerm(opts.q);
      params.push(t, t, t, t);
    }
    if (opts.category) { where.push('p.category = ?'); params.push(opts.category); }
    const lowExpr = `COALESCE(p.low_stock_level, ${Number(s.low_stock_default) || 0})`;
    if (opts.status === 'low') where.push(`p.stock_qty > 0 AND p.stock_qty <= ${lowExpr}`);
    if (opts.status === 'out') where.push('p.stock_qty <= 0');
    if (opts.status === 'attention') where.push(`p.stock_qty <= ${lowExpr}`);
    if (opts.status === 'expiring') {
      const limit = new Date(Date.now() + (Number(s.expiry_alert_days) || 0) * 86400000);
      where.push('p.expiry_date IS NOT NULL AND p.expiry_date <= ?');
      params.push(today(limit));
    }
    return `WHERE ${where.join(' AND ')}`;
  }

  const SORTS = {
    name: 'p.name COLLATE NOCASE ASC',
    newest: 'p.id DESC',
    stock_asc: 'p.stock_qty ASC, p.name COLLATE NOCASE',
    stock_desc: 'p.stock_qty DESC, p.name COLLATE NOCASE',
    expiry: "COALESCE(p.expiry_date, '9999') ASC"
  };

  function list(opts = {}) {
    const params = [];
    const where = filterSql(opts, params);
    const pg = paging(opts, 25);
    const total = store.value(`SELECT COUNT(*) FROM products p ${where}`, ...params);
    const order = SORTS[opts.sort] || SORTS.name;
    const rows = store.all(`SELECT p.* FROM products p ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, pg.limit, pg.offset);
    const s = ctx.settings.get();
    return { rows: rows.map((r) => toApi(r, s)), total: Number(total), page: pg.page, pageSize: pg.pageSize };
  }

  /** Lightweight list of every active product for the Sell screen. */
  function forSale() {
    const s = ctx.settings.get();
    return store.all('SELECT * FROM products WHERE is_active = 1 ORDER BY name COLLATE NOCASE').map((r) => {
      const a = toApi(r, s);
      return { id: a.id, name: a.name, sku: a.sku, category: a.category, brand: a.brand, price: a.price, cost_price: a.cost_price, stock_qty: a.stock_qty, stock_status: a.stock_status };
    });
  }

  function categories() {
    return store.all("SELECT category, COUNT(*) AS n FROM products WHERE is_active = 1 AND category <> '' GROUP BY category ORDER BY category COLLATE NOCASE")
      .map((r) => ({ name: r.category, count: Number(r.n) }));
  }

  function findBySku(sku) {
    const row = store.get('SELECT * FROM products WHERE is_active = 1 AND sku = ? COLLATE NOCASE', str(sku, 64));
    return row ? toApi(row) : null;
  }

  // ---------------------------------------------------------------- stock

  /**
   * Manual stock change from the Inventory screen.
   * mode: 'add' (+qty), 'remove' (-qty), 'set' (physical count).
   */
  function adjust({ product_id, mode, qty, reason = '', note = '', unit_cost, update_cost = false, supplier = '' }) {
    return store.tx(() => {
      const row = getRow(product_id);
      if (!row.is_active) fail('This product is archived', 'ARCHIVED');
      let n = int(qty, 'Quantity');
      let delta;
      let type;
      if (mode === 'add') { if (n <= 0) fail('Quantity to add must be more than 0'); delta = n; type = 'stock_in'; }
      else if (mode === 'remove') { if (n <= 0) fail('Quantity to remove must be more than 0'); delta = -n; type = 'stock_out'; }
      else if (mode === 'set') { if (n < 0) fail('Counted quantity cannot be negative'); delta = n - row.stock_qty; type = 'count'; }
      else fail('Unknown stock adjustment');
      if (delta === 0) fail('Stock is already at this quantity', 'NO_CHANGE');
      const costP = unit_cost === undefined || unit_cost === '' || unit_cost === null ? null : P(unit_cost);
      const why = str(reason, 60);
      const text = [why, str(note, 200), supplier ? `Supplier: ${str(supplier, 100)}` : ''].filter(Boolean).join(' — ');
      const res = moveStock(row.id, delta, type, { note: text, unitCost: costP ?? row.cost_price, allowNegative: mode === 'set' ? true : undefined });
      let costNote = '';
      if (mode === 'add' && update_cost && costP !== null && costP !== row.cost_price) {
        store.run('UPDATE products SET cost_price = ?, updated_at = ? WHERE id = ?', costP, now(), row.id);
        costNote = ` Cost updated ${fmtMoney(row.cost_price)} → ${fmtMoney(costP)}.`;
      }
      if (mode === 'add' && supplier && !row.supplier) store.run('UPDATE products SET supplier = ? WHERE id = ?', str(supplier, 100), row.id);
      const verb = delta > 0 ? `Added ${delta} pcs to` : `Removed ${-delta} pcs from`;
      ctx.audit(type === 'count' ? 'Stock Counted' : delta > 0 ? 'Stock Added' : 'Stock Removed', 'product', row.id,
        `${verb} "${row.name}" (stock ${res.before} → ${res.after})${text ? '. Reason: ' + text : ''}.${costNote}`);
      return get(row.id);
    });
  }

  /** Receive a supplier delivery: several products in one atomic step. */
  function receive({ lines = [], supplier = '', note = '' }) {
    if (!Array.isArray(lines) || !lines.length) fail('Add at least one product to receive', 'VALIDATION');
    return store.tx(() => {
      let units = 0;
      for (const l of lines) {
        adjust({ product_id: l.product_id, mode: 'add', qty: l.qty, reason: 'Purchase / stock received', note, unit_cost: l.unit_cost, update_cost: !!l.update_cost, supplier });
        units += Number(l.qty) || 0;
      }
      return { lines: lines.length, units };
    });
  }

  function movements(opts = {}) {
    const params = [];
    const where = ['1=1'];
    if (opts.product_id) { where.push('m.product_id = ?'); params.push(int(opts.product_id)); }
    if (opts.type) {
      if (opts.type === 'in') where.push('m.qty > 0');
      else if (opts.type === 'out') where.push('m.qty < 0');
      else { where.push('m.type = ?'); params.push(opts.type); }
    }
    if (opts.from) { where.push('m.created_at >= ?'); params.push(`${opts.from} 00:00:00`); }
    if (opts.to) { where.push('m.created_at <= ?'); params.push(`${opts.to} 23:59:59.999`); }
    if (opts.q) {
      where.push("(p.name LIKE ? ESCAPE '\\' OR m.note LIKE ? ESCAPE '\\' OR m.ref_no LIKE ? ESCAPE '\\')");
      const t = likeTerm(opts.q); params.push(t, t, t);
    }
    const w = `WHERE ${where.join(' AND ')}`;
    const pg = paging(opts, 30);
    const total = store.value(`SELECT COUNT(*) FROM stock_movements m JOIN products p ON p.id = m.product_id ${w}`, ...params);
    const sums = store.get(`SELECT COALESCE(SUM(CASE WHEN m.qty > 0 THEN m.qty END),0) AS qty_in, COALESCE(SUM(CASE WHEN m.qty < 0 THEN -m.qty END),0) AS qty_out
                            FROM stock_movements m JOIN products p ON p.id = m.product_id ${w}`, ...params);
    const rows = store.all(
      `SELECT m.*, p.name AS product_name FROM stock_movements m JOIN products p ON p.id = m.product_id ${w}
       ORDER BY m.id DESC LIMIT ? OFFSET ?`, ...params, pg.limit, pg.offset
    ).map((m) => ({
      id: m.id, created_at: m.created_at, product_id: m.product_id, product_name: m.product_name,
      qty: m.qty, balance_after: m.balance_after, type: m.type, type_label: MOVE_LABELS[m.type] || m.type,
      unit_cost: R(m.unit_cost), ref_type: m.ref_type, ref_id: m.ref_id, ref_no: m.ref_no || '', note: m.note, user: m.user
    }));
    return { rows, total: Number(total), page: pg.page, pageSize: pg.pageSize, qty_in: Number(sums.qty_in), qty_out: Number(sums.qty_out) };
  }

  /** Inventory totals for the summary module (feature #10). */
  function summary() {
    const s = ctx.settings.get();
    const low = Number(s.low_stock_default) || 0;
    const markup = Number(s.markup_percentage) || 0;
    const expiryLimit = today(new Date(Date.now() + (Number(s.expiry_alert_days) || 0) * 86400000));
    const r = store.get(
      `SELECT COUNT(*) AS products,
              COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty END), 0) AS units,
              COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty * cost_price END), 0) AS cost_value,
              COALESCE(SUM(CASE WHEN stock_qty > 0 THEN stock_qty * COALESCE(sell_price, CAST(ROUND(cost_price * (1 + ? / 100.0) / 100.0) AS INTEGER) * 100) END), 0) AS retail_value,
              COALESCE(SUM(CASE WHEN stock_qty <= 0 THEN 1 END), 0) AS out_of_stock,
              COALESCE(SUM(CASE WHEN stock_qty > 0 AND stock_qty <= COALESCE(low_stock_level, ?) THEN 1 END), 0) AS low_stock,
              COALESCE(SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date <= ? THEN 1 END), 0) AS expiring,
              COUNT(DISTINCT NULLIF(category, '')) AS categories
       FROM products WHERE is_active = 1`, markup, low, expiryLimit
    );
    return {
      products: Number(r.products),
      units: Number(r.units),
      cost_value: R(r.cost_value),
      retail_value: R(r.retail_value),
      potential_profit: R(r.retail_value - r.cost_value),
      out_of_stock: Number(r.out_of_stock),
      low_stock: Number(r.low_stock),
      expiring: Number(r.expiring),
      categories: Number(r.categories),
      archived: Number(store.value('SELECT COUNT(*) FROM products WHERE is_active = 0'))
    };
  }

  /** Everything about one product: stock in/out, sales per customer (feature #11). */
  function detail(id, opts = {}) {
    const product = get(id);
    const from = opts.from ? `${opts.from} 00:00:00` : '0000-01-01';
    const to = opts.to ? `${opts.to} 23:59:59.999` : '9999-12-31';
    const m = store.get(
      `SELECT COALESCE(SUM(CASE WHEN qty > 0 AND type IN ('opening','stock_in','import') THEN qty END),0) AS received,
              COALESCE(SUM(CASE WHEN type = 'stock_out' THEN -qty END),0) AS removed,
              COALESCE(SUM(CASE WHEN type = 'count' THEN qty END),0) AS count_adj
       FROM stock_movements WHERE product_id = ? AND created_at BETWEEN ? AND ?`, product.id, from, to);
    const s = store.get(
      `SELECT COALESCE(SUM(i.qty),0) AS qty, COALESCE(SUM(i.line_total),0) AS revenue, COALESCE(SUM(i.qty * i.cost_price),0) AS cost,
              COUNT(DISTINCT i.sale_id) AS invoices
       FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.product_id = ? AND s.created_at BETWEEN ? AND ?`, product.id, from, to);
    const r = store.get(
      `SELECT COALESCE(SUM(ri.qty),0) AS qty, COALESCE(SUM(ri.amount),0) AS amount, COALESCE(SUM(ri.cost),0) AS cost
       FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE ri.product_id = ? AND r.created_at BETWEEN ? AND ?`, product.id, from, to);
    const byCustomer = store.all(
      `SELECT s.customer_id, s.customer_name, COUNT(DISTINCT s.id) AS invoices, SUM(i.qty) AS qty, SUM(i.returned_qty) AS returned,
              SUM(i.line_total) AS revenue, MAX(s.created_at) AS last_date
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
       WHERE i.product_id = ? AND s.created_at BETWEEN ? AND ?
       GROUP BY COALESCE(s.customer_id, 0), CASE WHEN s.customer_id IS NULL THEN 'Walk-in Customer' ELSE s.customer_name END
       ORDER BY qty DESC LIMIT 100`, product.id, from, to
    ).map((x) => ({
      customer_id: x.customer_id, customer_name: x.customer_id ? x.customer_name : 'Walk-in customers',
      invoices: Number(x.invoices), qty: Number(x.qty), returned: Number(x.returned), revenue: R(x.revenue), last_date: x.last_date
    }));
    const recentSales = store.all(
      `SELECT s.id AS sale_id, s.invoice_no, s.created_at, s.customer_name, i.qty, i.returned_qty, i.unit_price, i.line_total
       FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.product_id = ? AND s.created_at BETWEEN ? AND ?
       ORDER BY s.id DESC LIMIT 50`, product.id, from, to
    ).map((x) => ({ ...x, unit_price: R(x.unit_price), line_total: R(x.line_total) }));
    const soldQty = Number(s.qty) - Number(r.qty);
    const revenue = Number(s.revenue) - Number(r.amount);
    const cost = Number(s.cost) - Number(r.cost);
    return {
      product,
      totals: {
        received: Number(m.received), removed: Number(m.removed), count_adjustment: Number(m.count_adj),
        sold: Number(s.qty), returned: Number(r.qty), net_sold: soldQty, invoices: Number(s.invoices),
        revenue: R(revenue), cost: R(cost), profit: R(revenue - cost),
        stock_value: R(Math.max(0, product.stock_qty) * P(product.cost_price))
      },
      by_customer: byCustomer,
      recent_sales: recentSales
    };
  }

  return { MOVE_LABELS, effectivePrice, toApi, getRow, moveStock, create, update, archive, restore, get, list, forSale, categories, findBySku, adjust, receive, movements, summary, detail };
};
