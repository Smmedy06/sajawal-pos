/* Inventory: totals, stock levels, movement log, receiving stock, Excel import. */
'use strict';

(() => {
  const st = { tab: 'stock', status: 'attention', q: '', page: 1, mvRange: DateRange.make('30d'), mvType: '', mvQ: '' };
  let root = null;
  let res = null;

  const FIELDS = [
    { key: 'name', label: 'Product name', required: true, syn: ['product name', 'name', 'product', 'item', 'item name', 'title', 'description'] },
    { key: 'sku', label: 'Barcode / SKU', syn: ['barcode', 'sku', 'code', 'item code', 'product code', 'bar code'] },
    { key: 'category', label: 'Category', syn: ['category', 'type', 'group', 'department'] },
    { key: 'brand', label: 'Brand', syn: ['brand', 'make', 'company'] },
    { key: 'supplier', label: 'Supplier', syn: ['supplier', 'source', 'vendor', 'distributor'] },
    { key: 'cost_price', label: 'Cost price', syn: ['cost price', 'cost', 'purchase price', 'buying price', 'buy price', 'cost price (rs.)'] },
    { key: 'sell_price', label: 'Selling price', syn: ['selling price', 'sale price', 'sell price', 'retail price', 'price', 'mrp', 'selling price (rs.)'] },
    { key: 'stock_qty', label: 'Stock quantity', syn: ['stock quantity', 'stock', 'qty', 'quantity', 'stock qty', 'opening stock', 'in stock'] },
    { key: 'low_stock_level', label: 'Low-stock level', syn: ['low stock level', 'reorder level', 'min stock', 'minimum stock', 'alert level'] },
    { key: 'expiry_date', label: 'Expiry date', syn: ['expiry date', 'expiry', 'exp date', 'expires', 'best before'] }
  ];

  /* ---------------------------------------------------------------- summary */

  async function renderSummary() {
    const s = await api('inventory.summary');
    const canProfit = !Lock.isActionLocked('viewProfit');
    setHTML($('#inv-kpis', root), html`
      <div class="kpi"><div class="kpi-label">${icon('products', 'i-sm')} Products</div><div class="kpi-value">${Fmt.num(s.products)}</div><div class="kpi-foot">${s.categories} categories${s.archived ? ` · ${s.archived} archived` : ''}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('boxes', 'i-sm')} Units in stock</div><div class="kpi-value">${Fmt.num(s.units)}</div><div class="kpi-foot">Total pieces on shelves</div></div>
      ${canProfit ? html`<div class="kpi"><div class="kpi-label">${icon('coins', 'i-sm')} Stock value (cost)</div><div class="kpi-value">${Fmt.money(s.cost_value)}</div><div class="kpi-foot">What the stock cost you</div></div>` : ''}
      <div class="kpi"><div class="kpi-label">${icon('tag', 'i-sm')} Stock value (selling)</div><div class="kpi-value">${Fmt.money(s.retail_value)}</div><div class="kpi-foot">${canProfit ? `Potential profit ${Fmt.money(s.potential_profit)}` : 'At current prices'}</div></div>
      <div class="kpi clickable ${s.out_of_stock ? 'is-alert' : s.low_stock ? 'is-warn' : ''}" data-action="kpiStatus" data-s="attention"><div class="kpi-label">${icon('warning', 'i-sm')} Needs reorder</div><div class="kpi-value">${s.low_stock + s.out_of_stock}</div><div class="kpi-foot">${s.low_stock} low · ${s.out_of_stock} out of stock</div></div>
      <div class="kpi clickable ${s.expiring ? 'is-alert' : ''}" data-action="kpiStatus" data-s="expiring"><div class="kpi-label">${icon('hourglass', 'i-sm')} Expiring</div><div class="kpi-value">${s.expiring}</div><div class="kpi-foot">Within ${App.settings.expiry_alert_days} days</div></div>`);
  }

  /* ---------------------------------------------------------------- tabs */

  async function loadTab() {
    const box = $('#inv-body', root);
    if (st.tab === 'stock') return loadStock(box);
    if (st.tab === 'moves') return loadMoves(box);
    if (st.tab === 'receive') return renderReceive(box);
    return renderImport(box);
  }

  async function loadStock(box) {
    try { res = await api('products.list', { q: st.q, status: st.status, sort: st.status === 'expiring' ? 'expiry' : 'stock_asc', page: st.page, pageSize: 25 }); } catch (e) { toast(e.message, 'error'); return; }
    const canProfit = !Lock.isActionLocked('viewProfit');
    setHTML(box, html`
      <div class="toolbar">
        <div class="input-wrap search">${icon('search')}<input class="input" value="${st.q}" placeholder="Find product…" data-on-input="sq"></div>
        <div class="seg">${[['attention', 'Needs attention'], ['low', 'Low'], ['out', 'Out of stock'], ['expiring', 'Expiring'], ['', 'All products']].map(([v, l]) => html`<button class="${st.status === v ? 'on' : ''}" data-action="sstatus" data-s="${v}">${l}</button>`)}</div>
      </div>
      <div class="card">${res.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Alert at</th>${canProfit ? html`<th class="num">Value (cost)</th>` : ''}<th class="num">Value (selling)</th><th>Expiry</th><th></th></tr></thead><tbody>
        ${res.rows.map((p) => html`<tr class="clickable" data-action="openP" data-id="${p.id}">
          <td><div class="cell-title">${p.name}</div><div class="cell-sub">${[p.sku, p.category].filter(Boolean).join(' · ') || '—'}</div></td>
          <td class="num">${stockCell(p)}</td><td class="num muted">${p.low_level}</td>
          ${canProfit ? html`<td class="num">${Fmt.money(Math.max(0, p.stock_qty) * p.cost_price)}</td>` : ''}
          <td class="num">${Fmt.money(Math.max(0, p.stock_qty) * p.price)}</td>
          <td>${p.expiry_date ? Fmt.date(p.expiry_date) : html`<span class="faint">—</span>`}</td>
          <td class="actions"><button class="btn btn-secondary btn-sm" data-action="quickAdd" data-id="${p.id}">${icon('packagePlus', 'i-sm')} Add</button>
            <button class="btn btn-ghost btn-sm" data-action="quickRemove" data-id="${p.id}">${icon('packageMinus', 'i-sm')}</button></td></tr>`)}
      </tbody></table></div>${pager(res)}` : emptyState('checkCircle', st.status === 'attention' ? 'Nothing needs attention' : 'No products', st.status === 'attention' ? 'All products are above their low-stock level.' : '')}</div>`);
  }

  const TYPES = [['', 'All movements'], ['in', 'All stock in'], ['out', 'All stock out'], ['stock_in', 'Purchases / added'], ['stock_out', 'Removed (damaged, expired…)'], ['count', 'Count corrections'], ['sale', 'Sales'], ['return', 'Returns'], ['sale_edit', 'Invoice edits'], ['import', 'Excel imports'], ['opening', 'Opening stock']];

  async function loadMoves(box) {
    let mv;
    try { mv = await api('inventory.movements', { from: st.mvRange.from, to: st.mvRange.to, type: st.mvType, q: st.mvQ, page: st.page, pageSize: 30 }); } catch (e) { toast(e.message, 'error'); return; }
    setHTML(box, html`
      <div class="toolbar">
        <div class="input-wrap search">${icon('search')}<input class="input" value="${st.mvQ}" placeholder="Product, invoice or note…" data-on-input="mq"></div>
        <select class="select" style="width:220px" data-on-change="mtype">${TYPES.map(([v, l]) => html`<option value="${v}" ${st.mvType === v ? raw('selected') : ''}>${l}</option>`)}</select>
        ${DateRange.button(st.mvRange)}
        <span class="spacer"></span>
        <button class="btn btn-secondary" data-action="mvExport">${icon('download')} Excel</button>
      </div>
      <div class="strip">
        <div class="strip-item"><div class="strip-label">Movements</div><div class="strip-value">${Fmt.num(mv.total)}</div></div>
        <div class="strip-item"><div class="strip-label">Pieces in</div><div class="strip-value pos">+${Fmt.num(mv.qty_in)}</div></div>
        <div class="strip-item"><div class="strip-label">Pieces out</div><div class="strip-value neg">−${Fmt.num(mv.qty_out)}</div></div>
      </div>
      <div class="card">${mv.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Details</th><th class="num">Change</th><th class="num">Stock after</th><th>By</th></tr></thead><tbody>
        ${mv.rows.map((x) => html`<tr class="clickable" data-action="openP" data-id="${x.product_id}">
          <td class="nowrap">${Fmt.dateTime(x.created_at)}</td><td class="cell-title"><div class="ellipsis" style="max-width:240px">${x.product_name}</div></td>
          <td><span class="badge ${MOVE_BADGE[x.type] || 'b-gray'}">${x.type_label}</span></td>
          <td><div class="ellipsis" style="max-width:280px" title="${x.note}">${x.ref_no ? html`<b>${x.ref_no}</b> ` : ''}${x.note}</div></td>
          <td class="num strong ${x.qty > 0 ? 'pos' : 'neg'}">${x.qty > 0 ? '+' : ''}${x.qty}</td><td class="num">${x.balance_after}</td><td class="muted">${x.user}</td></tr>`)}
      </tbody></table></div>${pager(mv)}` : emptyState('activity', 'No stock movements match')}</div>`);
  }

  /* ---------------------------------------------------------------- receive stock */

  const rec = { lines: [], supplier: '', note: '' };
  let saleProducts = [];

  async function renderReceive(box) {
    saleProducts = await api('products.forSale');
    const total = rec.lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
    setHTML(box, html`<div class="grid grid-main">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Receive stock</div><div class="card-sub">Record a delivery from a supplier — all products are added in one step.</div></div></div>
        <div class="card-body stack">
          <div class="input-wrap" style="position:relative">${icon('search')}<input class="input" id="rec-q" placeholder="Search or scan product to add…" autocomplete="off"></div>
          <div id="rec-suggest"></div>
          ${rec.lines.length ? html`<table class="table table-compact"><thead><tr><th>Product</th><th class="num" style="width:110px">Qty</th><th class="num" style="width:140px">Cost / piece</th><th class="center" style="width:90px">Update cost</th><th class="num">Line</th><th></th></tr></thead><tbody>
            ${rec.lines.map((l, i) => html`<tr><td><div class="cell-title">${l.name}</div><div class="cell-sub">In stock: ${l.stock} · current cost ${Fmt.money(l.current_cost)}</div></td>
              <td class="num"><input class="input num" style="height:30px" data-i="${i}" data-role="rqty" value="${l.qty}" inputmode="numeric"></td>
              <td class="num"><input class="input num" style="height:30px" data-i="${i}" data-role="rcost" value="${l.unit_cost}" inputmode="decimal"></td>
              <td class="center"><input type="checkbox" data-i="${i}" data-role="rupd" ${l.update_cost ? raw('checked') : ''}></td>
              <td class="num">${Fmt.money((Number(l.qty) || 0) * (Number(l.unit_cost) || 0))}</td>
              <td class="actions"><button class="btn btn-ghost btn-sm btn-icon" data-action="recDel" data-i="${i}">${icon('x', 'i-sm')}</button></td></tr>`)}
          </tbody></table>` : emptyState('truck', 'No products added yet', 'Search above to add the products in this delivery.')}
        </div>
      </div>
      <div class="card card-pad stack">
        <div class="field"><label>Supplier</label><input class="input" id="rec-supplier" value="${rec.supplier}" placeholder="e.g. Al-Fatah Distributors"></div>
        <div class="field"><label>Note / bill number</label><input class="input" id="rec-note" value="${rec.note}" placeholder="Supplier bill # 4512"></div>
        <dl class="kv"><dt>Products</dt><dd>${rec.lines.length}</dd><dt>Pieces</dt><dd>${rec.lines.reduce((a, l) => a + (Number(l.qty) || 0), 0)}</dd><dt>Total cost</dt><dd class="strong">${Fmt.money(total)}</dd></dl>
        <button class="btn btn-primary btn-lg" data-action="recSave" ${rec.lines.length ? '' : raw('disabled')}>${icon('check')} Add to stock</button>
        ${rec.lines.length ? html`<button class="btn btn-ghost btn-sm" data-action="recClear">Clear list</button>` : ''}
      </div></div>`);
    const q = $('#rec-q', root);
    const sug = $('#rec-suggest', root);
    const showSug = () => {
      const terms = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) { setHTML(sug, ''); return; }
      const hits = saleProducts.filter((p) => terms.every((t) => `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(t))).slice(0, 8);
      setHTML(sug, hits.length ? html`<div class="card suggest" style="padding:4px">${hits.map((p) => html`<div class="suggest-item" data-action="recAdd" data-id="${p.id}"><div class="grow"><div class="strong">${p.name}</div><div class="small muted">${p.sku || 'No barcode'} · ${p.stock_qty} in stock</div></div>${icon('plus', 'i-sm')}</div>`)}</div>` : html`<div class="small muted">No product found. Add it first in Products.</div>`);
    };
    q.addEventListener('input', showSug);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = q.value.trim().toLowerCase();
        const exact = saleProducts.find((p) => p.sku && p.sku.toLowerCase() === v);
        const first = exact || saleProducts.find((p) => `${p.name} ${p.sku}`.toLowerCase().includes(v));
        if (first) addRecLine(first.id);
      }
    });
    box.oninput = (e) => {
      const i = Number(e.target.dataset.i);
      if (e.target.dataset.role === 'rqty') rec.lines[i].qty = e.target.value;
      if (e.target.dataset.role === 'rcost') rec.lines[i].unit_cost = e.target.value;
      if (e.target.id === 'rec-supplier') rec.supplier = e.target.value;
      if (e.target.id === 'rec-note') rec.note = e.target.value;
    };
    box.onchange = (e) => {
      const i = Number(e.target.dataset.i);
      if (e.target.dataset.role === 'rupd') rec.lines[i].update_cost = e.target.checked;
      if (['rqty', 'rcost'].includes(e.target.dataset.role)) renderReceive(box);
    };
    setTimeout(() => q.focus(), 20);
  }

  function addRecLine(id) {
    const p = saleProducts.find((x) => x.id === Number(id));
    if (!p) return;
    const ex = rec.lines.find((l) => l.product_id === p.id);
    if (ex) ex.qty = (Number(ex.qty) || 0) + 1;
    else rec.lines.push({ product_id: p.id, name: p.name, stock: p.stock_qty, current_cost: p.cost_price, qty: 1, unit_cost: p.cost_price, update_cost: false });
    renderReceive($('#inv-body', root));
  }

  /* ---------------------------------------------------------------- import / export */

  const imp = { headers: [], rows: [], map: {}, mode: 'skip', fileName: '' };

  function autoMap(headers) {
    const norm = headers.map((h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' '));
    const used = new Set();
    const map = {};
    // pass 1: exact synonyms; pass 2: "contains" (but never map a cost column to selling price)
    for (const pass of [1, 2]) {
      for (const f of FIELDS) {
        if (map[f.key] !== undefined) continue;
        let idx = -1;
        for (const s of f.syn) {
          idx = norm.findIndex((h, i) => !used.has(i) && (pass === 1 ? h === s : h.includes(s) && !(f.key === 'sell_price' && /cost|purchase|buy/.test(h)) && !(f.key === 'name' && /id$|code/.test(h))));
          if (idx !== -1) break;
        }
        if (idx !== -1) { map[f.key] = idx; used.add(idx); }
      }
    }
    return map;
  }

  function cellDate(v) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return Fmt.iso(v);
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s); // dd/mm/yyyy
    if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    return 'invalid';
  }

  function mappedRows() {
    const numOrBlank = (v) => (v === '' || v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v).replace(/[,\s]|rs\.?/gi, ''));
    const seen = new Set();
    return imp.rows.map((r, i) => {
      const get = (k) => (imp.map[k] === undefined || imp.map[k] === '' ? '' : r[imp.map[k]]);
      const row = {
        row: i + 2,
        name: String(get('name') ?? '').trim(), sku: String(get('sku') ?? '').trim(), category: String(get('category') ?? '').trim(),
        brand: String(get('brand') ?? '').trim(), supplier: String(get('supplier') ?? '').trim(),
        cost_price: numOrBlank(get('cost_price')), sell_price: numOrBlank(get('sell_price')), stock_qty: numOrBlank(get('stock_qty')),
        low_stock_level: numOrBlank(get('low_stock_level')), expiry_date: cellDate(get('expiry_date'))
      };
      const errs = [];
      if (!row.name) errs.push('name missing');
      for (const k of ['cost_price', 'sell_price', 'stock_qty', 'low_stock_level']) if (row[k] !== '' && !Number.isFinite(Number(row[k]))) errs.push(`${k.replace('_', ' ')} not a number`);
      if (row.stock_qty !== '' && (Number(row.stock_qty) < 0 || !Number.isInteger(Number(row.stock_qty)))) errs.push('stock must be a whole number ≥ 0');
      if (row.expiry_date === 'invalid') errs.push('expiry date not understood');
      const key = row.name.toLowerCase();
      if (row.name && seen.has(key)) errs.push('repeated in this file');
      seen.add(key);
      row.errors = errs;
      return row;
    });
  }

  function renderImport(box) {
    if (!imp.rows.length) {
      setHTML(box, html`<div class="grid grid-2">
        <div class="card card-pad stack">
          <div class="card-title">Import products from Excel</div>
          <div class="muted">Use the template, or any sheet with a header row. You will check the columns and preview every row before anything is saved.</div>
          <div class="dropzone">${icon('upload', 'i-xl')}<div class="strong mt-8">Choose an .xlsx or .csv file</div><div class="small muted mt-4">First sheet is used</div>
            <button class="btn btn-primary mt-12" data-action="pickFile">${icon('folder')} Choose file…</button></div>
          <button class="btn btn-secondary" data-action="template">${icon('download')} Download template</button>
        </div>
        <div class="card card-pad stack">
          <div class="card-title">Export</div>
          <div class="muted">Download your full product list (can be edited and imported again).</div>
          <button class="btn btn-secondary" data-action="exportCatalog">${icon('download')} Export products (.xlsx)</button>
          <button class="btn btn-secondary" data-action="exportStock">${icon('download')} Export stock valuation (.xlsx)</button>
        </div></div>`);
      return;
    }
    const rows = mappedRows();
    const bad = rows.filter((r) => r.errors.length).length;
    setHTML(box, html`<div class="stack">
      <div class="card"><div class="card-head"><div><div class="card-title">1 · Match the columns</div><div class="card-sub">${imp.fileName} · ${rows.length} rows. Check that each field uses the right column.</div></div><button class="btn btn-ghost btn-sm" data-action="impReset">Choose another file</button></div>
        <div class="card-body"><div class="map-grid">${FIELDS.map((f) => html`<div class="field"><label>${f.label}${f.required ? ' *' : ''}</label>
          <select class="select" data-field="${f.key}" data-on-change="mapCol"><option value="">— not in file —</option>${imp.headers.map((h, i) => html`<option value="${i}" ${imp.map[f.key] === i ? raw('selected') : ''}>${h || `Column ${i + 1}`}</option>`)}</select></div>`)}</div>
          <div class="small muted mt-12">Blank selling price = price is calculated from cost + markup (${App.settings.markup_percentage}%).</div></div></div>
      <div class="card"><div class="card-head"><div><div class="card-title">2 · Check the rows</div><div class="card-sub">${rows.length - bad} ready · <span class="${bad ? 'neg' : ''}">${bad} with problems (will be skipped)</span></div></div></div>
        <div class="table-wrap" style="max-height:340px"><table class="table table-compact"><thead><tr><th>Row</th><th>Name</th><th>Barcode</th><th>Category</th><th class="num">Cost</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th></tr></thead><tbody>
          ${rows.slice(0, 300).map((r) => html`<tr><td class="muted">${r.row}</td><td class="cell-title">${r.name || '—'}</td><td>${r.sku}</td><td>${r.category}</td><td class="num">${r.cost_price}</td><td class="num">${r.sell_price === '' ? html`<span class="faint">markup</span>` : r.sell_price}</td><td class="num">${r.stock_qty}</td>
            <td>${r.errors.length ? html`<span class="badge b-red" title="${r.errors.join(', ')}">${r.errors[0]}</span>` : html`<span class="badge b-green">OK</span>`}</td></tr>`)}
        </tbody></table></div>${rows.length > 300 ? html`<div class="pager">Showing first 300 of ${rows.length}</div>` : ''}</div>
      <div class="card card-pad"><div class="card-title mb-8">3 · If a product with the same name already exists</div>
        <div class="stack" style="gap:6px">
          <label class="check"><input type="radio" name="impmode" value="skip" ${imp.mode === 'skip' ? raw('checked') : ''} data-on-change="impMode"> Skip it (don't change existing products)</label>
          <label class="check"><input type="radio" name="impmode" value="add_stock" ${imp.mode === 'add_stock' ? raw('checked') : ''} data-on-change="impMode"> Add the file's quantity to its stock</label>
          <label class="check"><input type="radio" name="impmode" value="update" ${imp.mode === 'update' ? raw('checked') : ''} data-on-change="impMode"> Update its prices/details and add the quantity</label>
        </div>
        <div class="row mt-16"><button class="btn btn-primary btn-lg" data-action="impGo" ${imp.map.name === undefined || rows.length === bad ? raw('disabled') : ''}>${icon('upload')} Import ${rows.length - bad} products</button></div>
      </div></div>`);
  }

  async function pickFile() {
    const f = await attempt(() => Native.openFile({ filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'xls', 'csv'] }] }));
    if (!f || f.canceled) return;
    try {
      const wb = XLSX.read(f.bytes, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const headerIdx = all.findIndex((r) => r.filter((c) => String(c).trim()).length >= 2);
      if (headerIdx === -1) throw new Error('No header row found in the first sheet.');
      imp.headers = all[headerIdx].map((h) => String(h).trim());
      imp.rows = all.slice(headerIdx + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
      if (!imp.rows.length) throw new Error('The sheet has a header but no product rows.');
      imp.map = autoMap(imp.headers);
      imp.fileName = f.name;
      renderImport($('#inv-body', root));
    } catch (e) { toast(`Could not read the file: ${e.message}`, 'error'); }
  }

  async function runImport() {
    const rows = mappedRows().filter((r) => !r.errors.length).map(({ errors, ...r }) => ({
      ...r, cost_price: r.cost_price === '' ? 0 : Number(r.cost_price), sell_price: r.sell_price === '' ? null : Number(r.sell_price),
      stock_qty: r.stock_qty === '' ? 0 : Number(r.stock_qty), low_stock_level: r.low_stock_level === '' ? '' : Number(r.low_stock_level)
    }));
    const r = await attempt(() => api('products.import', { rows, mode: imp.mode }));
    if (!r) return;
    imp.rows = []; imp.headers = []; imp.map = {};
    modal({
      title: 'Import finished', size: 'narrow',
      body: html`<dl class="kv"><dt>New products</dt><dd>${r.created}</dd><dt>Updated</dt><dd>${r.updated}</dd><dt>Stock added to existing</dt><dd>${r.stock_added}</dd><dt>Skipped (already existed)</dt><dd>${r.skipped}</dd><dt>Rows with errors</dt><dd class="${r.errors.length ? 'neg' : ''}">${r.errors.length}</dd></dl>
        ${r.errors.length ? html`<div class="callout danger mt-12">${icon('alert')}<div>${r.errors.slice(0, 15).map((e) => html`<div>Row ${e.row} (${e.name}): ${e.message}</div>`)}</div></div>` : ''}`,
      foot: html`<button class="btn btn-primary" data-action="__close">Done</button>`
    });
    renderSummary();
    renderImport($('#inv-body', root));
  }

  function template() {
    const rows = [
      { 'Product Name': 'Maybelline Fit Me Foundation 128', Barcode: '8901526001234', Category: 'Face', Brand: 'Maybelline', Supplier: 'Beauty Distributors', 'Cost Price': 2200, 'Selling Price': 2850, 'Stock Quantity': 12, 'Low Stock Level': 3, 'Expiry Date': '2027-06-30' },
      { 'Product Name': 'The Ordinary Niacinamide 10% 30ml', Barcode: '', Category: 'Skin care', Brand: 'The Ordinary', Supplier: '', 'Cost Price': 2400, 'Selling Price': '', 'Stock Quantity': 20, 'Low Stock Level': '', 'Expiry Date': '' }
    ];
    exportExcel('Sajawal_Product_Import_Template', [{ name: 'Products', rows }]);
  }

  /* ---------------------------------------------------------------- page */

  function renderPage() {
    setHTML(root, html`
      <div class="page-head">
        <div><div class="page-title">Inventory</div><div class="page-sub">Stock totals, every stock movement, deliveries and Excel import.</div></div>
        <div class="page-actions"><button class="btn btn-secondary" data-action="goReceive">${icon('truck')} Receive stock</button></div>
      </div>
      <div class="kpis" id="inv-kpis"></div>
      <div class="tabs">
        ${[['stock', 'Stock levels', 'boxes'], ['moves', 'Stock movements', 'activity'], ['receive', 'Receive stock', 'truck'], ['import', 'Import / Export', 'upload']].map(([k, l, ic]) => html`<button class="tab ${st.tab === k ? 'on' : ''}" data-action="tab" data-t="${k}">${icon(ic, 'i-sm')} ${l}</button>`)}
      </div>
      <div id="inv-body"><div class="card card-pad"><div class="skeleton"></div></div></div>`);
  }

  const sSearch = debounce(() => { st.page = 1; loadTab(); }, 200);

  Views.inventory = {
    async render(container, params = {}) {
      root = container;
      if (params.tab) st.tab = params.tab;
      st.mvRange = DateRange.fresh(st.mvRange);
      renderPage();
      const off = delegate(root, {
        tab: (t) => { st.tab = t.dataset.t; st.page = 1; $$('[data-action=tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.t === st.tab)); loadTab(); },
        goReceive: () => handlersTab('receive'),
        kpiStatus: (t) => { st.tab = 'stock'; st.status = t.dataset.s; st.page = 1; renderPage(); renderSummary(); loadTab(); },
        sq: (t) => { st.q = t.value; sSearch(); },
        sstatus: (t) => { st.status = t.dataset.s; st.page = 1; loadTab(); },
        page: (t) => { st.page = Number(t.dataset.page); loadTab(); },
        openP: (t, e) => { if (e.target.closest('.actions')) return; openProduct(Number(t.dataset.id), { onChange: () => { renderSummary(); loadTab(); } }); },
        quickAdd: (t, e) => { e.stopPropagation(); const p = res.rows.find((x) => String(x.id) === t.dataset.id); stockDialog(p, () => { renderSummary(); loadTab(); }, 'add'); },
        quickRemove: (t, e) => { e.stopPropagation(); const p = res.rows.find((x) => String(x.id) === t.dataset.id); stockDialog(p, () => { renderSummary(); loadTab(); }, 'remove'); },
        mq: (t) => { st.mvQ = t.value; sSearch(); },
        mtype: (t) => { st.mvType = t.value; st.page = 1; loadTab(); },
        openRange: (t) => DateRange.open(t, st.mvRange, (r) => { st.mvRange = r; st.page = 1; loadTab(); }),
        mvExport: async () => {
          const all = await attempt(() => fetchAll('inventory.movements', { from: st.mvRange.from, to: st.mvRange.to, type: st.mvType, q: st.mvQ }));
          if (all) exportExcel('Sajawal_Stock_Movements', [{ name: 'Movements', rows: all.rows.map((x) => ({ Date: Fmt.dateTime(x.created_at), Product: x.product_name, Type: x.type_label, Reference: x.ref_no, Details: x.note, Change: x.qty, 'Stock after': x.balance_after, User: x.user })) }]);
        },
        recAdd: (t) => { addRecLine(t.dataset.id); },
        recDel: (t) => { rec.lines.splice(Number(t.dataset.i), 1); renderReceive($('#inv-body', root)); },
        recClear: () => { rec.lines = []; renderReceive($('#inv-body', root)); },
        recSave: async () => {
          const lines = rec.lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_cost: l.unit_cost, update_cost: l.update_cost }));
          if (lines.some((l) => !Number.isInteger(l.qty) || l.qty <= 0)) { toast('Every quantity must be a whole number above 0', 'error'); return; }
          const r = await attempt(() => api('inventory.receive', { lines, supplier: rec.supplier, note: rec.note }));
          if (!r) return;
          toast(`${r.units} pieces added to stock across ${r.lines} products`, 'success');
          rec.lines = []; rec.note = '';
          renderSummary(); renderReceive($('#inv-body', root));
        },
        pickFile: () => pickFile(),
        template: () => template(),
        impReset: () => { imp.rows = []; renderImport($('#inv-body', root)); },
        mapCol: (t) => { imp.map[t.dataset.field] = t.value === '' ? undefined : Number(t.value); renderImport($('#inv-body', root)); },
        impMode: (t) => { imp.mode = t.value; },
        impGo: () => runImport(),
        exportCatalog: () => App.go('products').then(() => $('[data-action=export]') && $('[data-action=export]').click()),
        exportStock: async () => {
          const v = await attempt(() => api('reports.stock'));
          const cp = !Lock.isActionLocked('viewProfit');
          if (v) exportExcel('Sajawal_Stock_Valuation', [{ name: 'By category', rows: v.rows.map((r) => ({ Category: r.category, Products: r.products, Units: r.units, ...(cp ? { 'Cost value': r.cost_value } : {}), 'Selling value': r.retail_value, ...(cp ? { 'Potential profit': r.potential_profit } : {}) })) }]);
        }
      });
      function handlersTab(tab) { st.tab = tab; renderPage(); renderSummary(); loadTab(); }
      await renderSummary();
      await loadTab();
      return off;
    }
  };
})();
