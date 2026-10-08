/* Customers & Udhaar ledger. */
'use strict';

function customerForm(c, onSaved) {
  const isNew = !c;
  const m = modal({
    title: isNew ? 'New customer' : `Edit ${c.name}`,
    body: html`<form class="form-grid" data-on-submit="save">
      <div class="field"><label>Name *</label><input class="input" name="name" value="${c ? c.name : ''}" required autofocus></div>
      <div class="field"><label>Phone</label><input class="input" name="phone" value="${c ? c.phone : ''}" placeholder="03xx-xxxxxxx"><span class="hint">Phone keeps customers with the same name apart.</span></div>
      <div class="field span-2"><label>Address</label><input class="input" name="address" value="${c ? c.address : ''}"></div>
      <div class="field span-2"><label>Notes</label><input class="input" name="notes" value="${c ? c.notes : ''}" placeholder="e.g. prefers matte shades"></div>
      <div class="field"><label>Opening balance (old udhaar)</label><input class="input num" name="opening_balance" value="${c ? c.opening_balance || '' : ''}" placeholder="0" inputmode="decimal">
        <span class="hint">Money owed from before using this system. Negative = advance.</span></div>
    </form>`,
    foot: html`<button class="btn btn-secondary" data-action="__close">Cancel</button><button class="btn btn-primary" data-action="save">${isNew ? 'Add customer' : 'Save'}</button>`,
    actions: {
      save: async (_t, _e, mm) => {
        const f = formData(mm.root.querySelector('form'));
        f.opening_balance = Number(f.opening_balance) || 0;
        const r = await attempt(() => (isNew ? api('customers.create', f) : api('customers.update', { id: c.id, ...f })));
        if (r) { mm.close(); toast(isNew ? `Customer "${r.name}" added` : 'Customer saved', 'success'); if (onSaved) onSaved(r); }
      }
    }
  });
  return m;
}

(() => {
  const st = { q: '', filter: '', sort: 'balance', page: 1 };
  const det = { id: null, tab: 'ledger', range: DateRange.make('all'), page: 1 };
  let root = null;

  /* ---------------------------------------------------------------- list */

  async function loadList() {
    let res;
    try { res = await api('customers.list', { q: st.q, filter: st.filter, sort: st.sort, page: st.page, pageSize: 25 }); } catch (e) { toast(e.message, 'error'); return; }
    setHTML($('#cust-strip', root), html`
      <div class="strip-item"><div class="strip-label">Total udhaar to collect</div><div class="strip-value neg">${Fmt.money(res.receivable)}</div></div>
      <div class="strip-item"><div class="strip-label">Customers with udhaar</div><div class="strip-value">${Fmt.num(res.debtors)}</div></div>
      <div class="strip-item"><div class="strip-label">Advances held</div><div class="strip-value">${Fmt.money(res.advances)}</div></div>`);
    setHTML($('#cust-table', root), res.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Customer</th><th class="num">Invoices</th><th>Last activity</th><th class="num">Balance</th><th></th></tr></thead><tbody>
      ${res.rows.map((c) => html`<tr class="clickable" data-action="open" data-id="${c.id}">
        <td><div class="row"><div class="avatar" style="background:var(--surface-3);color:var(--ink-2)">${Fmt.initials(c.name)}</div><div><div class="cell-title">${c.name}</div><div class="cell-sub">${c.phone || 'No phone'}</div></div></div></td>
        <td class="num">${c.invoices}</td>
        <td>${Fmt.ago(c.last_activity)}</td>
        <td class="num"><span class="strong ${c.balance > 0 ? 'neg' : c.balance < 0 ? 'pos' : 'muted'}">${c.balance < 0 ? 'Advance ' : ''}${Fmt.money(Math.abs(c.balance))}</span></td>
        <td class="actions">${c.balance > 0 ? html`<button class="btn btn-secondary btn-sm" data-action="receive" data-id="${c.id}">${icon('handCoins', 'i-sm')} Receive</button>` : ''}</td>
      </tr>`)}</tbody></table></div>${pager(res)}`
      : emptyState('customers', st.q ? `No customer matches “${st.q}”` : 'No customers yet', 'Customers are needed for udhaar. Add one here or from the Sell screen.', html`<button class="btn btn-primary" data-action="add">${icon('userPlus')} Add customer</button>`));
  }

  function renderList() {
    setHTML(root, html`
      <div class="page-head">
        <div><div class="page-title">Customers & Udhaar</div><div class="page-sub">Who owes what, full account history and statements.</div></div>
        <div class="page-actions">
          <button class="btn btn-secondary" data-action="export">${icon('download')} Excel</button>
          <button class="btn btn-primary" data-action="add">${icon('userPlus')} Add customer</button>
        </div>
      </div>
      <div class="strip" id="cust-strip"></div>
      <div class="toolbar">
        <div class="input-wrap search">${icon('search')}<input class="input" value="${st.q}" placeholder="Search name or phone…" data-on-input="q"></div>
        <div class="seg">${[['', 'All'], ['due', 'Has udhaar'], ['advance', 'Advance'], ['clear', 'Clear']].map(([v, l]) => html`<button class="${st.filter === v ? 'on' : ''}" data-action="filter" data-f="${v}">${l}</button>`)}</div>
        <span class="spacer"></span>
        <select class="select" style="width:180px" data-on-change="sort">${[['balance', 'Highest udhaar first'], ['name', 'Name A–Z'], ['recent', 'Recently active']].map(([v, l]) => html`<option value="${v}" ${st.sort === v ? raw('selected') : ''}>${l}</option>`)}</select>
      </div>
      <div class="card" id="cust-table"><div class="card-pad"><div class="skeleton"></div></div></div>`);
    loadList();
  }

  /* ---------------------------------------------------------------- detail */

  async function renderDetail() {
    let c;
    try { c = await api('customers.get', { id: det.id }); } catch (e) { setHTML(root, emptyState('alert', 'Customer not found', e.message)); return; }
    det.customer = c;
    setHTML(root, html`
      <button class="back-link" data-action="back">${icon('left', 'i-sm')} All customers</button>
      <div class="page-head">
        <div class="row gap-12">
          <div class="avatar" style="width:46px;height:46px;font-size:16px;background:var(--ink);color:#fff">${Fmt.initials(c.name)}</div>
          <div><div class="page-title">${c.name}${c.is_active ? '' : html` <span class="badge b-gray">Archived</span>`}</div>
            <div class="page-sub">${[c.phone || 'No phone', c.address].filter(Boolean).join(' · ')}${c.notes ? html` · <i>${c.notes}</i>` : ''}</div></div>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary" data-action="edit">${icon('edit')} Edit</button>
          <button class="btn btn-secondary" data-action="statement">${icon('file')} Statement</button>
          <button class="btn btn-secondary" data-action="sell">${icon('sell')} New sale</button>
          <button class="btn btn-primary" data-action="receiveOne">${icon('handCoins')} Receive payment</button>
          <button class="btn btn-ghost btn-icon" data-action="moreCust">${icon('more')}</button>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi ${c.balance > 0 ? 'is-alert' : ''}"><div class="kpi-label">${c.balance >= 0 ? 'Balance due (udhaar)' : 'Advance held'}</div><div class="kpi-value">${Fmt.money(Math.abs(c.balance))}</div><div class="kpi-foot">${c.balance > 0 ? 'Customer owes the shop' : c.balance < 0 ? 'Shop owes the customer' : 'Fully settled'}</div></div>
        <div class="kpi"><div class="kpi-label">Total purchases</div><div class="kpi-value">${Fmt.money(c.purchases)}</div><div class="kpi-foot">${Fmt.plural(c.invoices, 'invoice')} (after returns)</div></div>
        <div class="kpi"><div class="kpi-label">Total paid</div><div class="kpi-value">${Fmt.money(c.received)}</div><div class="kpi-foot">${c.refunded ? `Refunds ${Fmt.money(c.refunded)}` : 'All payments received'}</div></div>
        <div class="kpi"><div class="kpi-label">Opening balance</div><div class="kpi-value">${Fmt.money(c.opening_balance)}</div><div class="kpi-foot">Customer since ${Fmt.date(c.created_at)}</div></div>
      </div>
      <div class="tabs">
        ${[['ledger', 'Ledger', 'clipboard'], ['invoices', 'Invoices', 'receipt'], ['payments', 'Payments', 'cash'], ['products', 'Products bought', 'bag']].map(([k, l, ic]) => html`<button class="tab ${det.tab === k ? 'on' : ''}" data-action="dtab" data-t="${k}">${icon(ic, 'i-sm')} ${l}</button>`)}
        <span class="grow"></span>
        <div style="padding-bottom:6px">${DateRange.button(det.range)}</div>
      </div>
      <div id="cust-body"><div class="card card-pad"><div class="skeleton"></div></div></div>`);
    loadTab();
  }

  async function loadTab() {
    const box = $('#cust-body', root);
    const r = det.range;
    try {
      if (det.tab === 'ledger') {
        const led = await api('customers.ledger', { id: det.id, from: r.from, to: r.to });
        det.ledger = led;
        setHTML(box, html`
          ${led.open_invoices.length ? html`<div class="callout warn mb-12">${icon('warning')}<div><b>${led.open_invoices.length} unpaid bill${led.open_invoices.length === 1 ? '' : 's'}:</b>
            ${led.open_invoices.slice(0, 6).map((o) => html`<a href="#" data-action="openSale" data-id="${o.sale_id}" style="margin-left:6px">${o.invoice_no} (${Fmt.money(o.due)})</a>`)}${led.open_invoices.length > 6 ? ' …' : ''}</div></div>` : ''}
          <div class="card">
            <div class="card-head"><div><div class="card-title">Account ledger</div><div class="card-sub">${DateRange.span(r)} · oldest first, running balance</div></div>
              <div class="row"><button class="btn btn-secondary btn-sm" data-action="ledgerExcel">${icon('download', 'i-sm')} Excel</button><button class="btn btn-secondary btn-sm" data-action="statement">${icon('printer', 'i-sm')} Print / PDF</button></div></div>
            ${led.rows.length || led.opening_balance ? html`<div class="table-wrap"><table class="table">
              <thead><tr><th>Date</th><th>Reference</th><th>Details</th><th class="num">Debit (+)</th><th class="num">Credit (−)</th><th class="num">Balance</th></tr></thead>
              <tbody>
                ${r.from ? html`<tr><td colspan="5" class="strong">Opening balance on ${Fmt.date(r.from)}</td><td class="num strong">${Fmt.money(led.opening_balance)}</td></tr>` : ''}
                ${led.rows.map((x) => html`<tr class="${x.sale_id ? 'clickable' : ''}" ${x.sale_id ? raw(`data-action="openSale" data-id="${x.sale_id}"`) : ''}>
                  <td class="nowrap">${Fmt.dateTime(x.date)}</td><td class="nowrap">${x.ref}</td><td><div class="ellipsis" style="max-width:380px" title="${x.description}">${x.description}</div></td>
                  <td class="num">${x.debit ? Fmt.money(x.debit) : ''}</td><td class="num pos">${x.credit ? Fmt.money(x.credit) : ''}</td>
                  <td class="num strong ${x.balance > 0 ? 'neg' : ''}">${Fmt.money(x.balance)}</td></tr>`)}
              </tbody>
              <tfoot><tr><td colspan="3">Closing balance</td><td class="num">${Fmt.money(led.total_debit)}</td><td class="num">${Fmt.money(led.total_credit)}</td><td class="num ${led.closing_balance > 0 ? 'neg' : ''}">${Fmt.money(led.closing_balance)}</td></tr></tfoot>
            </table></div>` : emptyState('clipboard', 'No transactions in this period')}
          </div>`);
      } else if (det.tab === 'invoices') {
        const res = await api('sales.list', { customer_id: det.id, from: r.from, to: r.to, page: det.page, pageSize: 25 });
        setHTML(box, html`<div class="card">${res.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th class="num">Items</th><th class="num">Total</th><th class="num">Due on bill</th><th>Status</th></tr></thead><tbody>
          ${res.rows.map((s) => html`<tr class="clickable" data-action="openSale" data-id="${s.id}"><td><div class="cell-title">${s.invoice_no}</div><div class="cell-sub">${Fmt.dateTime(s.created_at)}</div></td>
            <td class="num">${s.qty}</td><td class="num strong">${Fmt.money(s.net_total)}</td><td class="num ${s.due ? 'neg' : ''}">${s.due ? Fmt.money(s.due) : '—'}</td>
            <td><div class="row gap-4">${statusBadge(s.payment_status)}${s.status !== 'completed' ? statusBadge(s.status) : ''}</div></td></tr>`)}</tbody></table></div>${pager(res)}` : emptyState('receipt', 'No invoices in this period')}</div>`);
      } else if (det.tab === 'payments') {
        const res = await api('payments.list', { customer_id: det.id, from: r.from, to: r.to, page: det.page, pageSize: 25, include_voided: true });
        setHTML(box, html`<div class="card">${res.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Type</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead><tbody>
          ${res.rows.map((p) => html`<tr class="${p.voided ? 'muted-row' : ''}"><td>${Fmt.dateTime(p.created_at)}<div class="cell-sub">${p.invoice_no || p.receipt_no}</div></td>
            <td>${p.kind_label}${p.voided ? html` <span class="badge b-gray">Voided</span>` : ''}${p.note ? html`<div class="cell-sub">${p.note}</div>` : ''}</td><td>${p.method}</td>
            <td class="num strong ${p.amount < 0 ? 'neg' : 'pos'}" style="${p.voided ? 'text-decoration:line-through' : ''}">${Fmt.money(p.amount)}</td>
            <td class="actions">${p.kind === 'receipt' && !p.voided ? html`<button class="btn btn-ghost btn-sm" data-action="printPay" data-id="${p.id}">${icon('printer', 'i-sm')}</button>` : ''}</td></tr>`)}
          </tbody></table></div>${pager(res)}` : emptyState('cash', 'No payments in this period')}</div>`);
      } else {
        const rows = await api('customers.products', { id: det.id, from: r.from, to: r.to });
        setHTML(box, html`<div class="card">${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th class="num">Bought</th><th class="num">Returned</th><th class="num">Avg price</th><th class="num">Amount</th><th>Last bought</th></tr></thead><tbody>
          ${rows.map((x) => html`<tr class="clickable" data-action="openProduct" data-id="${x.product_id}"><td class="cell-title">${x.product_name}</td><td class="num">${x.qty}</td><td class="num">${x.returned || '—'}</td>
            <td class="num">${Fmt.money(x.avg_price)}</td><td class="num strong">${Fmt.money(x.amount)}</td><td>${Fmt.date(x.last_date)}</td></tr>`)}</tbody></table></div>` : emptyState('bag', 'Nothing bought in this period')}</div>`);
      }
    } catch (e) { setHTML(box, emptyState('alert', 'Could not load', e.message)); }
  }

  async function statement() {
    const led = await attempt(() => api('customers.ledger', { id: det.id, from: det.range.from, to: det.range.to }));
    if (!led) return;
    Printer.preview({ title: `Statement — ${led.customer.name}`, name: `Statement ${led.customer.name} ${Fmt.iso()}`, papers: ['a4', 'a5'], paper: 'a4', build: (p) => Docs.statement(led, App.settings, p) });
  }

  const search = debounce(() => { st.page = 1; loadList(); }, 200);

  const handlers = {
    q: (t) => { st.q = t.value; search(); },
    filter: (t) => { st.filter = t.dataset.f; st.page = 1; $$('[data-action=filter]', root).forEach((b) => b.classList.toggle('on', b.dataset.f === st.filter)); loadList(); },
    sort: (t) => { st.sort = t.value; loadList(); },
    page: (t) => { if (det.id) { det.page = Number(t.dataset.page); loadTab(); } else { st.page = Number(t.dataset.page); loadList(); } },
    add: () => customerForm(null, (c) => { if (det.id) return; App.go('customers', { id: c.id }); }),
    open: (t, e) => { if (e.target.closest('[data-action=receive]')) return; App.go('customers', { id: Number(t.dataset.id) }); },
    receive: (t, e) => { e.stopPropagation(); receivePayment({ id: Number(t.dataset.id) }, { onDone: loadList }); },
    export: async () => {
      const all = await attempt(() => fetchAll('customers.list', { q: st.q, filter: st.filter, sort: st.sort }));
      if (all) exportExcel('Sajawal_Customers', [{ name: 'Customers', rows: all.rows.map((c) => ({ Name: c.name, Phone: c.phone, Address: c.address, Invoices: c.invoices, Balance: c.balance, 'Opening balance': c.opening_balance, 'Last activity': Fmt.dateTime(c.last_activity) })) }]);
    },
    // detail
    back: () => App.go('customers'),
    dtab: (t) => { det.tab = t.dataset.t; det.page = 1; $$('[data-action=dtab]', root).forEach((b) => b.classList.toggle('on', b.dataset.t === det.tab)); loadTab(); },
    openRange: (t) => DateRange.open(t, det.range, (r) => { det.range = r; det.page = 1; renderDetail(); }),
    openSale: (t) => openInvoice(Number(t.dataset.id), { onChange: () => renderDetail() }),
    openProduct: (t) => openProduct(Number(t.dataset.id)),
    edit: () => customerForm(det.customer, () => renderDetail()),
    statement: () => statement(),
    sell: () => App.go('sell', { customer: det.customer }),
    receiveOne: () => receivePayment(det.customer, { onDone: () => renderDetail() }),
    printPay: async (t) => {
      const p = await attempt(() => api('payments.get', { id: Number(t.dataset.id) }));
      if (p) Printer.preview({ title: p.receipt_no, name: p.receipt_no, papers: ['thermal', 'a5'], paper: 'thermal', build: (pp) => Docs.paymentReceipt(p, App.settings, pp) });
    },
    ledgerExcel: () => {
      const led = det.ledger;
      if (!led) return;
      const rows = [];
      if (det.range.from) rows.push({ Date: det.range.from, Reference: '', Details: 'Opening balance', Debit: '', Credit: '', Balance: led.opening_balance });
      for (const x of led.rows) rows.push({ Date: Fmt.dateTime(x.date), Reference: x.ref, Details: x.description, Debit: x.debit || '', Credit: x.credit || '', Balance: x.balance });
      rows.push({ Date: '', Reference: '', Details: 'Closing balance', Debit: led.total_debit, Credit: led.total_credit, Balance: led.closing_balance });
      exportExcel(`Ledger_${led.customer.name.replace(/\W+/g, '_')}`, [{ name: 'Ledger', rows }]);
    },
    moreCust: (t) => menu(t, [
      { label: 'Archive customer', icon: 'archive', danger: true, action: async () => {
        if (!(await confirmDialog({ title: `Archive ${det.customer.name}?`, message: 'Archived customers are hidden from lists. Their history is kept. Only possible when the balance is zero.', confirm: 'Archive' }))) return;
        if (await attempt(() => api('customers.archive', { id: det.id }), { success: 'Customer archived' })) App.go('customers');
      } }
    ])
  };

  Views.customers = {
    async render(container, params = {}) {
      root = container;
      const off = delegate(root, handlers);
      if (params.id) {
        if (det.id !== params.id) { det.tab = 'ledger'; det.range = DateRange.make('all'); det.page = 1; }
        det.id = params.id;
        await renderDetail();
      } else {
        det.id = null;
        if (params.filter !== undefined) st.filter = params.filter;
        renderList();
      }
      return off;
    }
  };
})();
