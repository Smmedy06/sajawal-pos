/* Reports: sales summary, profit (6 ways), day-end cash book, udhaar aging, stock value, expenses. */
'use strict';

(() => {
  const LS = 'sajawal.reports.range';
  const st = {
    tab: 'profit', by: 'product', gran: 'day', q: '',
    range: (() => { try { return DateRange.fresh(JSON.parse(localStorage.getItem(LS))) || DateRange.make('month'); } catch (_) { return DateRange.make('month'); } })()
  };
  let root = null;
  let current = null; // { title, subtitle, columns, rows, totals, summary } for print / excel

  const money = (v) => Fmt.money(v, { symbol: false });
  const TABS = [
    ['profit', 'Profit', 'coins'], ['summary', 'Sales summary', 'trendUp'], ['cash', 'Day-end / cash', 'cash'],
    ['aging', 'Udhaar aging', 'handCoins'], ['stock', 'Stock value', 'boxes'], ['expenses', 'Expenses', 'expenses']
  ];
  const BY = [['product', 'Product'], ['category', 'Category'], ['customer', 'Customer'], ['invoice', 'Invoice'], ['day', 'Day'], ['month', 'Month']];

  function table(cols, rows, totals, { clickable } = {}) {
    if (!rows.length) return emptyState('reports', 'No data for this period', 'Choose a different date range.');
    const cell = (c, r) => (c.html ? c.html(r[c.key], r) : c.fmt ? c.fmt(r[c.key], r) : r[c.key]);
    return html`<div class="table-wrap" style="max-height:calc(100vh - 330px)"><table class="table">
      <thead><tr>${cols.map((c) => html`<th class="${c.align === 'right' ? 'num' : ''}">${c.label}</th>`)}</tr></thead>
      <tbody>${rows.map((r) => html`<tr ${clickable ? raw(clickable(r)) : ''}>${cols.map((c) => html`<td class="${c.align === 'right' ? 'num' : ''} ${c.cls ? c.cls(r[c.key], r) : ''}">${cell(c, r)}</td>`)}</tr>`)}</tbody>
      ${totals ? html`<tfoot><tr>${cols.map((c, i) => html`<td class="${c.align === 'right' ? 'num' : ''}">${i === 0 ? 'Total' : totals[c.key] !== undefined ? (c.fmt ? c.fmt(totals[c.key], totals) : totals[c.key]) : ''}</td>`)}</tr></tfoot>` : ''}
    </table></div>`;
  }

  const sum = (rows, k) => Math.round(rows.reduce((a, r) => a + (Number(r[k]) || 0) * 100, 0)) / 100;
  const pctCls = (v) => (v < 0 ? 'neg' : '');
  const profCls = (v) => (v < 0 ? 'neg strong' : 'strong');

  async function lockedPanel(box) {
    setHTML(box, html`<div class="card card-pad center" style="padding:40px">${icon('lock', 'i-xl')}<div class="modal-title mt-8">Profit figures are locked</div>
      <div class="muted small mt-4">Enter the owner PIN to see cost and profit.</div><button class="btn btn-primary mt-16" data-action="unlock">${icon('key')} Enter PIN</button></div>`);
  }

  async function load() {
    const box = $('#rep-body', root);
    setHTML(box, html`<div class="card card-pad"><div class="skeleton"></div><div class="skeleton mt-8" style="width:60%"></div></div>`);
    const r = st.range;
    const span = DateRange.span(r);
    try {
      if (st.tab === 'profit') {
        const d = await api('reports.profit', { from: r.from, to: r.to, by: st.by });
        const t = d.totals;
        const q = st.q.trim().toLowerCase();
        const rows = q ? d.rows.filter((x) => `${x.name} ${x.customer_name || ''}`.toLowerCase().includes(q)) : d.rows;
        const nameLabel = { product: 'Product', category: 'Category', customer: 'Customer', invoice: 'Invoice', day: 'Date', month: 'Month' }[st.by];
        const cols = [
          { label: nameLabel, key: 'name', fmt: (v, x) => (st.by === 'day' ? Fmt.date(v) : st.by === 'invoice' ? `${v} · ${x.customer_name}` : v), html: st.by === 'product' ? (v, x) => html`<div class="cell-title">${v}</div><div class="cell-sub">${x.category || ''}</div>` : undefined },
          ...(st.by === 'day' || st.by === 'month' ? [{ label: 'Invoices', key: 'invoices', align: 'right' }] : [{ label: 'Qty', key: 'qty', align: 'right' }]),
          ...(st.by === 'customer' ? [{ label: 'Invoices', key: 'invoices', align: 'right' }] : []),
          { label: 'Net sales', key: 'revenue', align: 'right', fmt: money },
          { label: 'Cost', key: 'cost', align: 'right', fmt: money },
          { label: 'Gross profit', key: 'profit', align: 'right', fmt: money, cls: profCls },
          { label: 'Margin', key: 'margin', align: 'right', fmt: (v) => Fmt.pct(v), cls: pctCls },
          ...(st.by === 'day' || st.by === 'month' ? [{ label: 'Expenses', key: 'expenses', align: 'right', fmt: money }, { label: 'Net profit', key: 'net_profit', align: 'right', fmt: money, cls: profCls }] : [{ label: 'Returns', key: 'returns', align: 'right', fmt: (v) => (v ? money(v) : '') }])
        ];
        const totals = { qty: sum(rows, 'qty'), invoices: sum(rows, 'invoices'), revenue: sum(rows, 'revenue'), cost: sum(rows, 'cost'), profit: sum(rows, 'profit'), returns: sum(rows, 'returns'), expenses: sum(rows, 'expenses'), net_profit: sum(rows, 'net_profit') };
        totals.margin = totals.revenue ? Math.round((totals.profit / totals.revenue) * 1000) / 10 : 0;
        current = { title: `Profit by ${nameLabel.toLowerCase()}`, subtitle: span, columns: cols, rows, totals,
          summary: [{ label: 'Net sales', value: Fmt.money(t.net_sales) }, { label: 'Gross profit', value: Fmt.money(t.gross_profit) }, { label: 'Margin', value: Fmt.pct(t.margin) }, { label: 'Expenses', value: Fmt.money(t.expenses) }, { label: 'Net profit', value: Fmt.money(t.net_profit) }] };
        setHTML(box, html`
          <div class="kpis">
            <div class="kpi"><div class="kpi-label">Net sales</div><div class="kpi-value">${Fmt.money(t.net_sales)}</div><div class="kpi-foot">${Fmt.money(t.gross_sales)} sales − ${Fmt.money(t.returns)} returns</div></div>
            <div class="kpi"><div class="kpi-label">Cost of goods sold</div><div class="kpi-value">${Fmt.money(t.cogs)}</div><div class="kpi-foot">Discounts given ${Fmt.money(t.discounts)}</div></div>
            <div class="kpi"><div class="kpi-label">Gross profit</div><div class="kpi-value ${t.gross_profit < 0 ? 'neg' : ''}">${Fmt.money(t.gross_profit)}</div><div class="kpi-foot">${Fmt.pct(t.margin)} margin</div></div>
            <div class="kpi"><div class="kpi-label">Expenses</div><div class="kpi-value">${Fmt.money(t.expenses)}</div><div class="kpi-foot">Rent, bills, salaries…</div></div>
            <div class="kpi"><div class="kpi-label">Net profit</div><div class="kpi-value ${t.net_profit < 0 ? 'neg' : 'pos'}">${Fmt.money(t.net_profit)}</div><div class="kpi-foot">Gross profit − expenses</div></div>
          </div>
          <div class="toolbar">
            <span class="small muted strong">Profit by</span>
            <div class="seg">${BY.map(([k, l]) => html`<button class="${st.by === k ? 'on' : ''}" data-action="by" data-b="${k}">${l}</button>`)}</div>
            <span class="spacer"></span>
            ${['product', 'category', 'customer', 'invoice'].includes(st.by) ? html`<div class="input-wrap" style="width:240px">${icon('search')}<input class="input" placeholder="Filter…" value="${st.q}" data-on-input="q"></div>` : ''}
          </div>
          <div class="card">${table(cols, rows, totals, { clickable: st.by === 'product' ? (x) => `class="clickable" data-action="openP" data-id="${x.id}"` : st.by === 'invoice' ? (x) => `class="clickable" data-action="openS" data-id="${x.id}"` : st.by === 'customer' ? (x) => (x.id ? `class="clickable" data-action="openC" data-id="${x.id}"` : '') : null })}</div>
          <div class="small muted mt-8">Sales are counted on the day they were made, returns on the day they came back. Invoice discounts are shared across the items on the bill.</div>`);
      } else if (st.tab === 'summary') {
        const rows = (await api('reports.profit', { from: r.from, to: r.to, by: st.gran })).rows;
        const cols = [
          { label: st.gran === 'day' ? 'Date' : 'Month', key: 'name', fmt: (v) => (st.gran === 'day' ? Fmt.date(v) : v) },
          { label: 'Invoices', key: 'invoices', align: 'right' },
          { label: 'Returns', key: 'returns', align: 'right', fmt: (v) => (v ? money(v) : '') },
          { label: 'Net sales', key: 'revenue', align: 'right', fmt: money },
          { label: 'Gross profit', key: 'profit', align: 'right', fmt: money, cls: profCls },
          { label: 'Expenses', key: 'expenses', align: 'right', fmt: (v) => (v ? money(v) : '') },
          { label: 'Net profit', key: 'net_profit', align: 'right', fmt: money, cls: profCls }
        ];
        const totals = { invoices: sum(rows, 'invoices'), returns: sum(rows, 'returns'), revenue: sum(rows, 'revenue'), profit: sum(rows, 'profit'), expenses: sum(rows, 'expenses'), net_profit: sum(rows, 'net_profit') };
        current = { title: 'Sales summary', subtitle: span, columns: cols, rows, totals };
        setHTML(box, html`<div class="toolbar"><div class="seg"><button class="${st.gran === 'day' ? 'on' : ''}" data-action="gran" data-g="day">By day</button><button class="${st.gran === 'month' ? 'on' : ''}" data-action="gran" data-g="month">By month</button></div></div>
          <div class="card">${table(cols, rows, totals)}</div>`);
      } else if (st.tab === 'cash') {
        const d = await api('reports.cashbook', { from: r.from, to: r.to });
        const methods = Object.keys(d.methods).filter((k) => d.methods[k]);
        const cols = [
          { label: 'Date', key: 'date', fmt: (v) => Fmt.date(v) },
          { label: 'From sales', key: 'sales_collected', align: 'right', fmt: money },
          { label: 'Udhaar received', key: 'udhaar_received', align: 'right', fmt: (v) => (v ? money(v) : '') },
          { label: 'Refunds paid', key: 'refunds', align: 'right', fmt: (v) => (v ? `−${money(v)}` : '') },
          { label: 'Expenses', key: 'expenses', align: 'right', fmt: (v) => (v ? `−${money(v)}` : '') },
          { label: 'Net money in', key: 'net', align: 'right', fmt: money, cls: profCls },
          { label: 'Cash in drawer', key: 'cash_net', align: 'right', fmt: money }
        ];
        current = { title: 'Day-end cash report', subtitle: span, columns: cols, rows: d.rows, totals: d.totals,
          summary: [...methods.map((k) => ({ label: k, value: Fmt.money(d.methods[k]) })), { label: 'Net money in', value: Fmt.money(d.totals.net) }] };
        setHTML(box, html`
          <div class="kpis">
            ${methods.length ? methods.map((k) => html`<div class="kpi"><div class="kpi-label">${icon(k === 'Cash' ? 'cash' : 'card', 'i-sm')} ${k}</div><div class="kpi-value ${d.methods[k] < 0 ? 'neg' : ''}">${Fmt.money(d.methods[k])}</div><div class="kpi-foot">${k === 'Cash' ? 'Should be in the drawer' : 'Received into account'}</div></div>`)
              : html`<div class="kpi"><div class="kpi-label">Money in</div><div class="kpi-value">${Fmt.money(0)}</div></div>`}
            <div class="kpi"><div class="kpi-label">Udhaar given</div><div class="kpi-value neg">${Fmt.money(d.summary.udhaar_given)}</div><div class="kpi-foot">Sold on credit (not received)</div></div>
          </div>
          <div class="card">${table(cols, d.rows, d.totals)}</div>
          <div class="small muted mt-8">“Cash in drawer” = cash received − cash refunds − cash expenses for that day. Compare it with the cash you count at closing.</div>`);
      } else if (st.tab === 'aging') {
        const d = await api('reports.receivables');
        const cols = [
          { label: 'Customer', key: 'name', html: (v, x) => html`<div class="cell-title">${v}</div><div class="cell-sub">${x.phone || 'No phone'}</div>`, fmt: (v, x) => `${v}${x.phone ? ' (' + x.phone + ')' : ''}` },
          { label: 'Opening balance', key: 'opening', align: 'right', fmt: (v) => (v ? money(v) : '') },
          { label: '0–30 days', key: 'd0_30', align: 'right', fmt: (v) => (v ? money(v) : '') },
          { label: '31–60 days', key: 'd31_60', align: 'right', fmt: (v) => (v ? money(v) : '') },
          { label: '61–90 days', key: 'd61_90', align: 'right', fmt: (v) => (v ? money(v) : '') },
          { label: 'Over 90 days', key: 'd90', align: 'right', fmt: (v) => (v ? money(v) : ''), cls: (v) => (v ? 'neg' : '') },
          { label: 'Total due', key: 'balance', align: 'right', fmt: money, cls: () => 'strong' },
          { label: 'Last payment', key: 'last_payment', fmt: (v) => (v ? Fmt.date(v) : 'Never') }
        ];
        current = { title: 'Udhaar aging', subtitle: `As of ${Fmt.date(Fmt.iso())}`, columns: cols, rows: d.rows, totals: d.totals };
        setHTML(box, html`<div class="kpis">
            <div class="kpi is-alert"><div class="kpi-label">Total udhaar</div><div class="kpi-value">${Fmt.money(d.totals.balance)}</div><div class="kpi-foot">${Fmt.plural(d.rows.length, 'customer')}</div></div>
            <div class="kpi"><div class="kpi-label">Recent (0–30 days)</div><div class="kpi-value">${Fmt.money(d.totals.d0_30)}</div></div>
            <div class="kpi ${d.totals.d90 ? 'is-alert' : ''}"><div class="kpi-label">Old (over 90 days)</div><div class="kpi-value">${Fmt.money(d.totals.d90)}</div><div class="kpi-foot">Follow up first</div></div>
          </div>
          <div class="card">${table(cols, d.rows, d.totals, { clickable: (x) => `class="clickable" data-action="openC" data-id="${x.id}"` })}</div>
          <div class="small muted mt-8">Age is counted from the invoice date; payments settle the oldest bills first.</div>`);
      } else if (st.tab === 'stock') {
        const d = await api('reports.stock');
        const canProfit = !Lock.isActionLocked('viewProfit');
        const cols = [
          { label: 'Category', key: 'category' }, { label: 'Products', key: 'products', align: 'right' }, { label: 'Units', key: 'units', align: 'right' },
          ...(canProfit ? [{ label: 'Value at cost', key: 'cost_value', align: 'right', fmt: money }] : []),
          { label: 'Value at selling price', key: 'retail_value', align: 'right', fmt: money },
          ...(canProfit ? [{ label: 'Potential profit', key: 'potential_profit', align: 'right', fmt: money }] : [])
        ];
        const totals = { products: d.totals.products, units: d.totals.units, cost_value: d.totals.cost_value, retail_value: d.totals.retail_value, potential_profit: d.totals.potential_profit };
        current = { title: 'Stock valuation', subtitle: `As of ${Fmt.date(Fmt.iso())}`, columns: cols, rows: d.rows, totals };
        setHTML(box, html`<div class="card">${table(cols, d.rows, totals)}</div>`);
      } else {
        const d = await api('expenses.list', { from: r.from, to: r.to, pageSize: 500 });
        const cols = [{ label: 'Category', key: 'category' }, { label: 'Entries', key: 'count', align: 'right' }, { label: 'Amount', key: 'amount', align: 'right', fmt: money },
          { label: 'Share', key: 'share', align: 'right', fmt: (v) => Fmt.pct(v) }];
        const rows = d.by_category.map((x) => ({ ...x, share: d.sum ? (x.amount / d.sum) * 100 : 0 }));
        const totals = { count: sum(rows, 'count'), amount: d.sum, share: 100 };
        current = { title: 'Expenses by category', subtitle: span, columns: cols, rows, totals };
        setHTML(box, html`<div class="card">${table(cols, rows, totals)}</div><div class="mt-8"><button class="btn btn-ghost btn-sm" data-action="goExpenses">Open expenses ${icon('arrowRight', 'i-sm')}</button></div>`);
      }
    } catch (e) {
      if (e.code === 'LOCKED') { current = null; return lockedPanel(box); }
      setHTML(box, emptyState('alert', 'Could not build report', e.message));
    }
  }

  function render() {
    const needsRange = !['aging', 'stock'].includes(st.tab);
    setHTML(root, html`
      <div class="page-head">
        <div><div class="page-title">Reports</div><div class="page-sub">Profit, sales, cash and udhaar — for any period.</div></div>
        <div class="page-actions">${needsRange ? DateRange.button(st.range) : ''}
          <button class="btn btn-secondary" data-action="excel">${icon('download')} Excel</button>
          <button class="btn btn-secondary" data-action="print">${icon('printer')} Print / PDF</button></div>
      </div>
      <div class="tabs">${TABS.map(([k, l, ic]) => html`<button class="tab ${st.tab === k ? 'on' : ''}" data-action="tab" data-t="${k}">${icon(ic, 'i-sm')} ${l}</button>`)}</div>
      <div id="rep-body"></div>`);
    load();
  }

  const qSearch = debounce(() => load(), 200);

  Views.reports = {
    async render(container, params = {}) {
      root = container;
      st.range = DateRange.fresh(st.range);
      if (params.tab) st.tab = params.tab;
      const off = delegate(root, {
        tab: (t) => { st.tab = t.dataset.t; st.q = ''; render(); },
        by: (t) => { st.by = t.dataset.b; st.q = ''; load(); },
        gran: (t) => { st.gran = t.dataset.g; load(); },
        q: (t) => { st.q = t.value; qSearch(); },
        openRange: (t) => DateRange.open(t, st.range, (r) => { st.range = r; try { localStorage.setItem(LS, JSON.stringify(r)); } catch (_) { /* ignore */ } render(); }),
        unlock: async () => { if (await Lock.prompt()) load(); },
        openP: (t) => openProduct(Number(t.dataset.id)),
        openS: (t) => openInvoice(Number(t.dataset.id)),
        openC: (t) => App.go('customers', { id: Number(t.dataset.id) }),
        goExpenses: () => App.go('expenses'),
        excel: () => {
          if (!current) return;
          const rows = current.rows.map((r) => Object.fromEntries(current.columns.map((c) => [c.label, typeof r[c.key] === 'number' ? r[c.key] : c.fmt ? c.fmt(r[c.key], r) : r[c.key]])));
          rows.push(Object.fromEntries(current.columns.map((c, i) => [c.label, i === 0 ? 'Total' : current.totals && current.totals[c.key] !== undefined ? current.totals[c.key] : ''])));
          exportExcel(`Sajawal_${current.title.replace(/\W+/g, '_')}`, [{ name: current.title.slice(0, 31), rows }]);
        },
        print: () => {
          if (!current) return;
          const doc = current;
          Printer.preview({
            title: doc.title, name: `${doc.title} ${doc.subtitle}`, papers: ['a4', 'a5'], paper: 'a4',
            build: (p) => Docs.report({ title: doc.title, subtitle: doc.subtitle, columns: doc.columns.map((c) => ({ ...c, html: undefined })), rows: doc.rows, totals: doc.totals, summary: doc.summary || [] }, App.settings, p)
          });
        }
      });
      render();
      return off;
    }
  };
})();
