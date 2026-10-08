/* Products: catalogue, product form, product history drawer, stock adjustments. */
'use strict';

const MOVE_BADGE = {
  opening: 'b-gray', stock_in: 'b-green', import: 'b-green', stock_out: 'b-red', count: 'b-blue',
  sale: 'b-gray', sale_edit: 'b-amber', return: 'b-violet', cancel: 'b-violet'
};

async function productForm(p, onSaved) {
  const isNew = !p;
  let cats = [];
  try { cats = await api('products.categories'); } catch (_) { /* ignore */ }
  const markup = Number(App.settings.markup_percentage) || 0;
  const manual = p ? p.price_rule === 'manual' : false;
  const m = modal({
    title: isNew ? 'Add product' : `Edit ${p.name}`, size: 'wide',
    body: html`<form data-on-submit="save" class="stack">
      <div class="form-grid">
        <div class="field span-2"><label>Product name *</label><input class="input" name="name" value="${p ? p.name : ''}" required autofocus placeholder="e.g. Maybelline Fit Me Foundation 128"></div>
        <div class="field"><label>Barcode / SKU</label><input class="input" name="sku" value="${p ? p.sku : ''}" placeholder="Scan or type"><span class="hint">Scan the barcode with the cursor here.</span></div>
        <div class="field"><label>Category</label><input class="input" name="category" list="cat-list" value="${p ? p.category : ''}" placeholder="e.g. Lips, Skin care"><datalist id="cat-list">${cats.map((c) => html`<option value="${c.name}">`)}</datalist></div>
        <div class="field"><label>Brand</label><input class="input" name="brand" value="${p ? p.brand : ''}"></div>
        <div class="field"><label>Supplier</label><input class="input" name="supplier" value="${p ? p.supplier : ''}"></div>
      </div>
      <div class="divider"></div>
      <div class="form-grid form-grid-3">
        <div class="field"><label>Cost price *</label><div class="input-affix"><span class="affix">${Fmt.currency}</span><input class="input num" name="cost_price" value="${p ? p.cost_price : ''}" inputmode="decimal" required></div></div>
        <div class="field"><label>Selling price</label>
          <div class="seg" style="width:100%"><button type="button" data-action="rule" data-r="markup" class="${manual ? '' : 'on'}" style="flex:1;justify-content:center">Markup ${markup}%</button><button type="button" data-action="rule" data-r="manual" class="${manual ? 'on' : ''}" style="flex:1;justify-content:center">Fixed price</button></div></div>
        <div class="field"><label>&nbsp;</label><div class="input-affix ${manual ? '' : 'hidden'}" id="sell-wrap"><span class="affix">${Fmt.currency}</span><input class="input num" name="sell_price" value="${p && manual ? p.sell_price : ''}" inputmode="decimal" placeholder="Price"></div>
          <div class="small muted ${manual ? 'hidden' : ''}" id="markup-note" style="padding-top:8px"></div></div>
      </div>
      <div id="margin-note" class="small"></div>
      <div class="divider"></div>
      <div class="form-grid form-grid-3">
        ${isNew ? html`<div class="field"><label>Opening stock</label><input class="input num" name="stock_qty" value="0" inputmode="numeric"></div>` : html`<div class="field"><label>Stock</label><input class="input num" value="${p.stock_qty}" disabled><span class="hint">Change stock with “Adjust stock”.</span></div>`}
        <div class="field"><label>Low-stock alert at</label><input class="input num" name="low_stock_level" value="${p && p.low_stock_level !== null ? p.low_stock_level : ''}" placeholder="Default ${App.settings.low_stock_default}" inputmode="numeric"></div>
        <div class="field"><label>Expiry date</label><input class="input" type="date" name="expiry_date" value="${p ? p.expiry_date : ''}"></div>
      </div>
    </form>`,
    foot: html`<button class="btn btn-secondary" data-action="__close">Cancel</button><button class="btn btn-primary" data-action="save">${isNew ? 'Add product' : 'Save changes'}</button>`,
    actions: {
      rule: (t, _e, mm) => {
        const isManual = t.dataset.r === 'manual';
        mm.root.querySelectorAll('[data-action=rule]').forEach((b) => b.classList.toggle('on', b === t));
        mm.root.querySelector('#sell-wrap').classList.toggle('hidden', !isManual);
        mm.root.querySelector('#markup-note').classList.toggle('hidden', isManual);
        if (isManual) mm.root.querySelector('[name=sell_price]').focus(); else mm.root.querySelector('[name=sell_price]').value = '';
        upd();
      },
      save: async (_t, _e, mm) => {
        const f = formData(mm.root.querySelector('form'));
        const isManual = mm.root.querySelector('[data-action=rule][data-r=manual]').classList.contains('on');
        if (isManual && f.sell_price === '') { mm.root.querySelector('[name=sell_price]').classList.add('invalid'); return; }
        f.sell_price = isManual ? Number(f.sell_price) : null;
        f.cost_price = Number(f.cost_price);
        const r = await attempt(() => (isNew ? api('products.create', f) : api('products.update', { id: p.id, ...f })));
        if (r) { mm.close(); toast(isNew ? `"${r.name}" added` : 'Product saved', 'success'); if (onSaved) onSaved(r); }
      }
    }
  });
  const upd = () => {
    const cost = Number(m.root.querySelector('[name=cost_price]').value) || 0;
    const isManual = m.root.querySelector('[data-action=rule][data-r=manual]').classList.contains('on');
    const auto = Math.round(cost * (1 + markup / 100));
    const price = isManual ? Number(m.root.querySelector('[name=sell_price]').value) || 0 : auto;
    m.root.querySelector('#markup-note').textContent = `Sells at ${Fmt.money(auto)}`;
    const note = m.root.querySelector('#margin-note');
    if (!cost || !price) { note.textContent = ''; return; }
    const margin = ((price - cost) / price) * 100;
    note.className = `small ${price < cost ? 'neg' : 'muted'}`;
    note.textContent = price < cost ? `Warning: selling price is below cost (loss of ${Fmt.money(cost - price)} per piece).` : `Profit ${Fmt.money(price - cost)} per piece · ${margin.toFixed(1)}% margin`;
  };
  m.root.addEventListener('input', upd);
  upd();
  return m;
}

function stockDialog(p, onDone, mode = 'add') {
  const reasons = {
    add: ['Purchase / new stock', 'Returned from customer (no bill)', 'Found during count', 'Other'],
    remove: ['Damaged', 'Expired', 'Used as tester', 'Lost / stolen', 'Returned to supplier', 'Other'],
    set: ['Physical stock count']
  };
  const m = modal({
    title: 'Adjust stock', sub: `${p.name} · now ${p.stock_qty} in stock`,
    body: html`<form data-on-submit="save" class="stack">
      <div class="seg" style="width:100%">
        <button type="button" data-action="mode" data-m="add" style="flex:1;justify-content:center">${icon('packagePlus', 'i-sm')} Add stock</button>
        <button type="button" data-action="mode" data-m="remove" style="flex:1;justify-content:center">${icon('packageMinus', 'i-sm')} Remove</button>
        <button type="button" data-action="mode" data-m="set" style="flex:1;justify-content:center">${icon('clipboard', 'i-sm')} Set count</button>
      </div>
      <div class="form-grid">
        <div class="field"><label id="qty-label">Quantity</label><input class="input num input-lg" style="height:40px" name="qty" inputmode="numeric" autofocus></div>
        <div class="field"><label>Reason</label><select class="select" name="reason" style="height:40px"></select></div>
        <div class="field add-only"><label>Cost per piece</label><div class="input-affix"><span class="affix">${Fmt.currency}</span><input class="input num" name="unit_cost" value="${p.cost_price}" inputmode="decimal"></div></div>
        <div class="field add-only"><label>Supplier</label><input class="input" name="supplier" value="${p.supplier || ''}"></div>
        <label class="check add-only span-2"><input type="checkbox" name="update_cost"> Update the product's cost price to this cost</label>
        <div class="field span-2"><label>Note</label><input class="input" name="note" placeholder="Optional details (bill no., batch…)"></div>
      </div>
      <div class="callout info" id="stock-preview">${icon('info')}<div>Enter a quantity.</div></div>
    </form>`,
    foot: html`<button class="btn btn-secondary" data-action="__close">Cancel</button><button class="btn btn-primary" data-action="save">Save</button>`,
    actions: {
      mode: (t) => setMode(t.dataset.m),
      save: async (_t, _e, mm) => {
        const f = formData(mm.root.querySelector('form'));
        const r = await attempt(() => api('inventory.adjust', { product_id: p.id, mode, qty: Number(f.qty), reason: f.reason, note: f.note, unit_cost: mode === 'add' ? f.unit_cost : undefined, update_cost: mode === 'add' && f.update_cost, supplier: mode === 'add' ? f.supplier : '' }));
        if (r) { mm.close(); toast(`Stock updated: ${p.name} now ${r.stock_qty}`, 'success'); if (onDone) onDone(r); }
      }
    }
  });
  const setMode = (md) => {
    mode = md;
    m.root.querySelectorAll('[data-action=mode]').forEach((b) => b.classList.toggle('on', b.dataset.m === md));
    m.root.querySelectorAll('.add-only').forEach((x) => x.classList.toggle('hidden', md !== 'add'));
    m.root.querySelector('#qty-label').textContent = md === 'set' ? 'Counted quantity (actual on shelf)' : md === 'add' ? 'Quantity to add' : 'Quantity to remove';
    setHTML(m.root.querySelector('[name=reason]'), reasons[md].map((r) => html`<option>${r}</option>`));
    upd();
    m.root.querySelector('[name=qty]').focus();
  };
  const upd = () => {
    const q = parseInt(m.root.querySelector('[name=qty]').value, 10);
    const box = m.root.querySelector('#stock-preview');
    if (!Number.isFinite(q) || q < 0 || (q === 0 && mode !== 'set')) { setHTML(box, html`${icon('info')}<div>Enter a quantity.</div>`); box.className = 'callout info'; return; }
    const after = mode === 'add' ? p.stock_qty + q : mode === 'remove' ? p.stock_qty - q : q;
    const diff = after - p.stock_qty;
    box.className = `callout ${after < 0 ? 'danger' : diff === 0 ? 'warn' : 'ok'}`;
    setHTML(box, html`${icon(after < 0 ? 'alert' : 'checkCircle')}<div>Stock <b>${p.stock_qty}</b> → <b>${after}</b> (${diff >= 0 ? '+' : ''}${diff} pcs). ${after < 0 ? 'Stock cannot go below zero.' : 'This change will be recorded in the stock history and activity log.'}</div>`);
  };
  m.root.querySelector('[name=qty]').addEventListener('input', upd);
  setMode(mode);
  return m;
}

/** Product history drawer (feature #11). */
async function openProduct(id, { onChange } = {}) {
  const st = { tab: 'moves', period: 'all', page: 1 };
  const d = drawer({ head: html`<div class="modal-title">Loading…</div>`, width: 'min(760px, 94vw)' });
  const periods = { all: 'All time', '30d': 'Last 30 days', month: 'This month', year: 'This year' };
  const load = async () => {
    const r = st.period === 'all' ? { from: '', to: '' } : DateRange.make(st.period);
    let det;
    try { det = await api('products.detail', { id, from: r.from, to: r.to }); } catch (e) { d.set({ body: emptyState('alert', 'Could not load', e.message) }); return; }
    const p = det.product;
    const t = det.totals;
    const canProfit = !Lock.isActionLocked('viewProfit');
    d.product = p;
    let tabBody = '';
    if (st.tab === 'moves') {
      const mv = await api('inventory.movements', { product_id: id, from: r.from, to: r.to, page: st.page, pageSize: 25 });
      d.moves = mv;
      tabBody = mv.rows.length ? html`<div class="card"><table class="table table-compact"><thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="num">Change</th><th class="num">Stock after</th></tr></thead><tbody>
        ${mv.rows.map((x) => html`<tr ${x.ref_type === 'sale' || x.ref_type === 'return' ? raw(`class="clickable" data-action="openRef" data-no="${esc(x.ref_no)}"`) : ''}><td class="nowrap">${Fmt.dateTime(x.created_at)}<div class="cell-sub">${x.user}</div></td>
          <td><span class="badge ${MOVE_BADGE[x.type] || 'b-gray'}">${x.type_label}</span></td>
          <td><div class="ellipsis" style="max-width:250px" title="${x.note}">${x.ref_no ? html`<b>${x.ref_no}</b> ` : ''}${x.note}</div></td>
          <td class="num strong ${x.qty > 0 ? 'pos' : 'neg'}">${x.qty > 0 ? '+' : ''}${x.qty}</td><td class="num">${x.balance_after}</td></tr>`)}
      </tbody></table>${pager(mv)}</div>` : emptyState('clipboard', 'No stock movements in this period');
    } else if (st.tab === 'customers') {
      tabBody = det.by_customer.length ? html`<div class="card"><table class="table table-compact"><thead><tr><th>Customer</th><th class="num">Invoices</th><th class="num">Qty</th><th class="num">Returned</th><th class="num">Amount</th><th>Last</th></tr></thead><tbody>
        ${det.by_customer.map((c) => html`<tr ${c.customer_id ? raw(`class="clickable" data-action="openCust" data-id="${c.customer_id}"`) : ''}><td class="cell-title">${c.customer_name}</td><td class="num">${c.invoices}</td><td class="num">${c.qty}</td><td class="num">${c.returned || '—'}</td><td class="num">${Fmt.money(c.revenue)}</td><td>${Fmt.date(c.last_date)}</td></tr>`)}
      </tbody></table></div>` : emptyState('customers', 'Not sold in this period');
    } else {
      tabBody = det.recent_sales.length ? html`<div class="card"><table class="table table-compact"><thead><tr><th>Invoice</th><th>Customer</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>
        ${det.recent_sales.map((x) => html`<tr class="clickable" data-action="openSale" data-id="${x.sale_id}"><td><div class="cell-title">${x.invoice_no}</div><div class="cell-sub">${Fmt.dateTime(x.created_at)}</div></td><td>${x.customer_name}</td>
          <td class="num">${x.qty}${x.returned_qty ? html`<div class="cell-sub">−${x.returned_qty} ret.</div>` : ''}</td><td class="num">${Fmt.money(x.unit_price)}</td><td class="num">${Fmt.money(x.line_total)}</td></tr>`)}
      </tbody></table></div>` : emptyState('receipt', 'No sales in this period');
    }
    d.set({
      head: html`<div class="row" style="gap:8px;flex-wrap:wrap"><div class="modal-title">${p.name}</div>${statusBadge(p.stock_status)}${p.is_active ? '' : html`<span class="badge b-gray">Archived</span>`}</div>
        <div class="modal-sub">${[p.sku && `Barcode ${p.sku}`, p.brand, p.category, p.supplier && `Supplier: ${p.supplier}`].filter(Boolean).join(' · ') || 'No barcode / category'}</div>`,
      body: html`
        <div class="row-between mb-12">
          <div class="seg">${Object.entries(periods).map(([k, l]) => html`<button class="${st.period === k ? 'on' : ''}" data-action="period" data-p="${k}">${l}</button>`)}</div>
          ${p.expiry_date ? html`<span class="badge b-amber">Expiry ${Fmt.date(p.expiry_date)}</span>` : ''}
        </div>
        <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
          <div class="kpi"><div class="kpi-label">In stock now</div><div class="kpi-value">${p.stock_qty}</div><div class="kpi-foot">${canProfit ? `Value ${Fmt.money(t.stock_value)}` : `Alert at ${p.low_level}`}</div></div>
          <div class="kpi"><div class="kpi-label">Received</div><div class="kpi-value pos">+${t.received}</div><div class="kpi-foot">Removed ${t.removed}${t.count_adjustment ? ` · counts ${t.count_adjustment > 0 ? '+' : ''}${t.count_adjustment}` : ''}</div></div>
          <div class="kpi"><div class="kpi-label">Sold</div><div class="kpi-value">${t.net_sold}</div><div class="kpi-foot">${t.invoices} invoices${t.returned ? ` · ${t.returned} returned` : ''}</div></div>
          <div class="kpi"><div class="kpi-label">Sales${canProfit ? ' / profit' : ''}</div><div class="kpi-value">${Fmt.money(t.revenue)}</div><div class="kpi-foot">${canProfit ? html`Profit <b class="${t.profit < 0 ? 'neg' : 'pos'}">${Fmt.money(t.profit)}</b>` : ''}</div></div>
        </div>
        <dl class="kv mb-16" style="grid-template-columns:auto 1fr auto 1fr">
          <dt>Selling price</dt><dd>${Fmt.money(p.price)} <span class="muted small">(${p.price_rule === 'manual' ? 'fixed' : 'markup'})</span></dd>
          ${canProfit ? html`<dt>Cost price</dt><dd>${Fmt.money(p.cost_price)}</dd>` : ''}
        </dl>
        <div class="tabs">
          <button class="tab ${st.tab === 'moves' ? 'on' : ''}" data-action="tab" data-t="moves">${icon('activity', 'i-sm')} Stock history</button>
          <button class="tab ${st.tab === 'customers' ? 'on' : ''}" data-action="tab" data-t="customers">${icon('customers', 'i-sm')} Sold to customers</button>
          <button class="tab ${st.tab === 'sales' ? 'on' : ''}" data-action="tab" data-t="sales">${icon('receipt', 'i-sm')} Invoices</button>
        </div>
        ${tabBody}`,
      foot: p.is_active ? html`<button class="btn btn-primary" data-action="adjust">${icon('boxes')} Adjust stock</button>
        <button class="btn btn-secondary" data-action="edit">${icon('edit')} Edit</button>
        <span class="grow"></span>
        <button class="btn btn-secondary" data-action="excel">${icon('download')} Stock history Excel</button>` : html`<button class="btn btn-secondary" data-action="restore">${icon('restore')} Restore product</button>`
    });
  };
  const changed = () => { load(); if (onChange) onChange(); };
  d.root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    if (a === 'tab') { st.tab = t.dataset.t; st.page = 1; load(); }
    else if (a === 'period') { st.period = t.dataset.p; st.page = 1; load(); }
    else if (a === 'page') { st.page = Number(t.dataset.page); load(); }
    else if (a === 'adjust') stockDialog(d.product, changed);
    else if (a === 'edit') productForm(d.product, changed);
    else if (a === 'restore') { if (await attempt(() => api('products.restore', { id }), { success: 'Product restored' })) changed(); }
    else if (a === 'openSale') openInvoice(Number(t.dataset.id));
    else if (a === 'openCust') { d.close(); App.go('customers', { id: Number(t.dataset.id) }); }
    else if (a === 'openRef') {
      const r = await api('sales.list', { q: t.dataset.no, pageSize: 1 });
      if (r.rows[0]) openInvoice(r.rows[0].id);
    } else if (a === 'excel') {
      const all = await attempt(() => fetchAll('inventory.movements', { product_id: id }));
      if (all) exportExcel(`Stock_${d.product.name.replace(/\W+/g, '_')}`, [{ name: 'Stock history', rows: all.rows.map((x) => ({ Date: Fmt.dateTime(x.created_at), Type: x.type_label, Reference: x.ref_no, Note: x.note, Change: x.qty, 'Stock after': x.balance_after, User: x.user })) }]);
    }
  });
  await load();
  return d;
}

(() => {
  const st = { q: '', category: '', status: '', sort: 'name', page: 1 };
  let root = null;
  let res = null;

  async function load() {
    try { res = await api('products.list', { ...st, pageSize: 25 }); } catch (e) { toast(e.message, 'error'); return; }
    const canProfit = !Lock.isActionLocked('viewProfit');
    const box = $('#prod-table', root);
    setHTML($('#prod-count', root), Fmt.plural(res.total, 'product'));
    setHTML(box, res.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr>
        <th>Product</th><th>Category</th>${canProfit ? html`<th class="num">Cost</th>` : ''}<th class="num">Price</th>${canProfit ? html`<th class="num">Margin</th>` : ''}<th class="num">Stock</th><th>Expiry</th><th></th></tr></thead><tbody>
      ${res.rows.map((p) => {
        const margin = p.price > 0 ? ((p.price - p.cost_price) / p.price) * 100 : 0;
        const expSoon = p.expiry_date && p.expiry_date <= Fmt.iso(new Date(Date.now() + App.settings.expiry_alert_days * 86400000));
        return html`<tr class="clickable ${p.is_active ? '' : 'muted-row'}" data-action="open" data-id="${p.id}">
          <td><div class="cell-title ellipsis" style="max-width:320px">${p.name}</div><div class="cell-sub">${[p.sku, p.brand].filter(Boolean).join(' · ') || '—'}</div></td>
          <td>${p.category || html`<span class="faint">—</span>`}</td>
          ${canProfit ? html`<td class="num">${Fmt.money(p.cost_price)}</td>` : ''}
          <td class="num"><div class="strong">${Fmt.money(p.price)}</div><div class="cell-sub">${p.price_rule === 'manual' ? 'Fixed' : 'Markup'}</div></td>
          ${canProfit ? html`<td class="num ${margin < 0 ? 'neg' : ''}">${Fmt.pct(margin)}</td>` : ''}
          <td class="num">${stockCell(p)}</td>
          <td>${p.expiry_date ? html`<span class="${expSoon ? 'neg strong' : ''}">${Fmt.date(p.expiry_date)}</span>` : html`<span class="faint">—</span>`}</td>
          <td class="actions">${p.is_active ? html`<button class="btn btn-ghost btn-sm" data-action="adjust" data-id="${p.id}" title="Adjust stock">${icon('boxes', 'i-sm')}</button>
            <button class="btn btn-ghost btn-sm btn-icon" data-action="rowMenu" data-id="${p.id}">${icon('more', 'i-sm')}</button>` : html`<button class="btn btn-ghost btn-sm" data-action="restore" data-id="${p.id}">Restore</button>`}</td></tr>`;
      })}</tbody></table></div>${pager(res)}`
      : emptyState('products', st.q ? `No product matches “${st.q}”` : 'No products here', st.q || st.status ? 'Try another search or filter.' : 'Add your first product or import a list from Excel.',
        !st.q && !st.status ? html`<button class="btn btn-primary" data-action="add">${icon('plus')} Add product</button>` : ''));
  }

  async function render() {
    let cats = [];
    try { cats = await api('products.categories'); } catch (_) { /* ignore */ }
    setHTML(root, html`
      <div class="page-head">
        <div><div class="page-title">Products</div><div class="page-sub"><span id="prod-count"></span> · prices, barcodes, stock alerts and expiry dates.</div></div>
        <div class="page-actions">
          <button class="btn btn-secondary" data-action="import">${icon('upload')} Import Excel</button>
          <button class="btn btn-secondary" data-action="export">${icon('download')} Excel</button>
          <button class="btn btn-primary" data-action="add">${icon('plus')} Add product</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="input-wrap search">${icon('search')}<input class="input" value="${st.q}" placeholder="Name, barcode, brand…" data-on-input="q" id="prod-q"></div>
        <select class="select" style="width:170px" data-on-change="category"><option value="">All categories</option>${cats.map((c) => html`<option value="${c.name}" ${st.category === c.name ? raw('selected') : ''}>${c.name} (${c.count})</option>`)}</select>
        <div class="seg">${[['', 'All'], ['low', 'Low stock'], ['out', 'Out of stock'], ['expiring', 'Expiring'], ['archived', 'Archived']].map(([v, l]) => html`<button class="${st.status === v ? 'on' : ''}" data-action="status" data-s="${v}">${l}</button>`)}</div>
        <span class="spacer"></span>
        <select class="select" style="width:160px" data-on-change="sort">${[['name', 'Name A–Z'], ['newest', 'Newest first'], ['stock_asc', 'Stock: low to high'], ['stock_desc', 'Stock: high to low'], ['expiry', 'Expiry soonest']].map(([v, l]) => html`<option value="${v}" ${st.sort === v ? raw('selected') : ''}>${l}</option>`)}</select>
      </div>
      <div class="card" id="prod-table"><div class="card-pad"><div class="skeleton"></div></div></div>`);
    await load();
  }

  const search = debounce(() => { st.page = 1; load(); }, 200);

  Views.products = {
    async render(container, params = {}) {
      root = container;
      if (params.status !== undefined) st.status = params.status;
      const off = delegate(root, {
        q: (t) => { st.q = t.value; search(); },
        category: (t) => { st.category = t.value; st.page = 1; load(); },
        status: (t) => { st.status = t.dataset.s; st.page = 1; $$('[data-action=status]', root).forEach((b) => b.classList.toggle('on', b.dataset.s === st.status)); load(); },
        sort: (t) => { st.sort = t.value; load(); },
        page: (t) => { st.page = Number(t.dataset.page); load(); $('#page').scrollTop = 0; },
        add: () => productForm(null, () => load()),
        import: () => App.go('inventory', { tab: 'import' }),
        open: (t, e) => { if (e.target.closest('.actions')) return; openProduct(Number(t.dataset.id), { onChange: load }); },
        adjust: (t, e) => { e.stopPropagation(); const p = res.rows.find((x) => String(x.id) === t.dataset.id); stockDialog(p, load); },
        restore: async (t, e) => { e.stopPropagation(); if (await attempt(() => api('products.restore', { id: Number(t.dataset.id) }), { success: 'Product restored' })) load(); },
        rowMenu: (t, e) => {
          e.stopPropagation();
          const p = res.rows.find((x) => String(x.id) === t.dataset.id);
          menu(t, [
            { label: 'Edit', icon: 'edit', action: () => productForm(p, () => load()) },
            { label: 'Adjust stock', icon: 'boxes', action: () => stockDialog(p, load) },
            { label: 'History', icon: 'activity', action: () => openProduct(p.id, { onChange: load }) },
            { sep: true },
            { label: 'Archive (hide from sale)', icon: 'archive', danger: true, action: async () => {
              if (!(await confirmDialog({ title: `Archive "${p.name}"?`, message: 'It will no longer appear on the Sell screen. Sales history and reports are kept, and you can restore it any time.', confirm: 'Archive', danger: true }))) return;
              if (await attempt(() => api('products.archive', { id: p.id }), { success: 'Product archived' })) load();
            } }
          ]);
        },
        export: async () => {
          const all = await attempt(() => fetchAll('products.list', { ...st, page: 1 }));
          if (!all) return;
          const canProfit = !Lock.isActionLocked('viewProfit');
          exportExcel('Sajawal_Products', [{ name: 'Products', rows: all.rows.map((p) => ({
            'Product Name': p.name, Barcode: p.sku, Category: p.category, Brand: p.brand, Supplier: p.supplier,
            ...(canProfit ? { 'Cost Price': p.cost_price } : {}), 'Selling Price': p.price_rule === 'manual' ? p.sell_price : '', 'Effective Price': p.price,
            'Stock Quantity': p.stock_qty, 'Low Stock Level': p.low_stock_level ?? '', 'Expiry Date': p.expiry_date
          })) }]);
        }
      });
      await render();
      setTimeout(() => { const q = $('#prod-q', root); if (q && !st.q) q.focus(); }, 30);
      return off;
    }
  };
})();
