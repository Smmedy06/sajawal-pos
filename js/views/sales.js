/* Sales & Returns: invoice list, invoice detail, returns, cancellations, payments. */
'use strict';

/** Fetch every page of a list endpoint (for Excel export). */
async function fetchAll(name, params = {}) {
  const out = [];
  let page = 1;
  for (;;) {
    const r = await api(name, { ...params, page, pageSize: 500 });
    out.push(...r.rows);
    if (out.length >= r.total || !r.rows.length) return { ...r, rows: out };
    page++;
  }
}

/* ------------------------------------------------------------------ invoice drawer */

async function openInvoice(id, { onChange } = {}) {
  const d = drawer({ head: html`<div class="modal-title">Loading…</div>`, actions: {} });
  const load = async () => {
    let s;
    try { s = await api('sales.get', { id }); } catch (e) { d.set({ body: emptyState('alert', 'Could not load invoice', e.message) }); return; }
    const canProfit = !Lock.isActionLocked('viewProfit');
    const live = s.status !== 'cancelled';
    const editable = s.status === 'completed' && !s.returned_total;
    const returnable = live && s.items.some((i) => i.qty > i.returned_qty);
    d.set({
      head: html`<div class="row" style="flex-wrap:wrap;gap:8px"><div class="modal-title">${s.invoice_no}</div>
          ${s.customer_id && s.net_total > 0 ? statusBadge(s.payment_status) : ''}${s.status !== 'completed' ? statusBadge(s.status) : ''}${s.edit_count ? html`<span class="badge b-blue">Edited ${s.edit_count}×</span>` : ''}${s.is_legacy ? html`<span class="badge b-gray">From v1.2</span>` : ''}</div>
        <div class="modal-sub">${Fmt.dateTime(s.created_at)} · by ${s.cashier || '—'}</div>`,
      body: html`
        <div class="row-between mb-12">
          <div class="row">
            <div class="avatar" style="background:var(--surface-3);color:var(--ink-2)">${s.customer_id ? Fmt.initials(s.customer_name) : icon('user', 'i-sm')}</div>
            <div><div class="strong">${s.customer_name}</div><div class="small muted">${s.customer_phone || (s.customer_id ? 'No phone' : 'Walk-in sale')}</div></div>
          </div>
          ${s.customer_id ? html`<button class="btn btn-secondary btn-sm" data-action="openCustomer">${icon('user', 'i-sm')} Account</button>` : ''}
        </div>
        ${s.note ? html`<div class="callout info mb-12">${icon('info')}<div>${s.note}</div></div>` : ''}
        <div class="card"><table class="table table-compact">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
          <tbody>${s.items.map((i) => html`<tr>
            <td><div class="cell-title">${i.product_name}</div>${i.returned_qty ? html`<div class="cell-sub" style="color:var(--violet)">${i.returned_qty} returned</div>` : ''}</td>
            <td class="num">${i.qty}</td>
            <td class="num">${Fmt.money(i.unit_price)}${i.unit_price !== i.std_price ? html`<div class="cell-sub">list ${Fmt.money(i.std_price)}</div>` : ''}</td>
            <td class="num strong">${Fmt.money(i.line_subtotal)}</td></tr>`)}</tbody>
        </table></div>
        <div class="row-between mt-12" style="align-items:flex-start">
          <div class="small muted" style="max-width:240px">${canProfit ? html`Cost ${Fmt.money(s.cost_total)} · Profit <b class="${s.profit < 0 ? 'neg' : 'pos'}">${Fmt.money(s.profit)}</b>` : ''}</div>
          <div class="totals" style="width:260px">
            <div class="line"><span class="muted">Subtotal</span><span>${Fmt.money(s.subtotal)}</span></div>
            ${s.discount_amount ? html`<div class="line"><span class="muted">Discount${s.discount_type === 'percent' ? ` (${s.discount_value}%)` : ''}</span><span>−${Fmt.money(s.discount_amount)}</span></div>` : ''}
            <div class="line big"><span>Total</span><span>${Fmt.money(s.total)}</span></div>
            ${s.returned_total ? html`<div class="line"><span class="muted">Returned</span><span>−${Fmt.money(s.returned_total)}</span></div><div class="line strong"><span>Net</span><span>${Fmt.money(s.net_total)}</span></div>` : ''}
            <div class="line"><span class="muted">Paid at counter</span><span>${Fmt.money(s.paid_at_sale)}</span></div>
            ${s.refunded ? html`<div class="line"><span class="muted">Refunded</span><span>${Fmt.money(s.refunded)}</span></div>` : ''}
            ${s.customer_id ? html`<div class="line ${s.due ? 'neg' : 'pos'} strong"><span>${s.due ? 'Still due on this bill' : 'Bill settled'}</span><span>${Fmt.money(s.due)}</span></div>` : ''}
          </div>
        </div>
        <div class="section-title mt-24">Payments</div>
        ${s.payments.length ? html`<div class="card"><table class="table table-compact"><tbody>${s.payments.map((p) => html`<tr class="${p.voided ? 'muted-row' : ''}">
          <td>${Fmt.dateTime(p.created_at)}<div class="cell-sub">${p.kind === 'refund' ? 'Refund' : 'Paid at sale'}${p.voided ? ` · cancelled (${p.void_reason})` : ''}</div></td>
          <td>${p.method}</td><td class="num strong ${p.amount < 0 ? 'neg' : ''}" style="${p.voided ? 'text-decoration:line-through' : ''}">${Fmt.money(p.amount)}</td></tr>`)}</tbody></table></div>`
          : html`<div class="small muted">Nothing paid at the counter — full amount on udhaar.</div>`}
        ${s.received_with_sale ? html`<div class="small muted mt-8">Also received ${Fmt.money(s.received_with_sale)} towards old udhaar with this bill.</div>` : ''}
        ${s.returns.length ? html`<div class="section-title mt-24">Returns</div>
          ${s.returns.map((r) => html`<div class="card card-pad mb-8"><div class="row-between"><div><span class="strong">${r.return_no}</span> <span class="badge ${r.kind === 'cancel' ? 'b-gray' : 'b-violet'}">${r.kind === 'cancel' ? 'Cancelled' : 'Return'}</span></div>
            <button class="btn btn-ghost btn-sm" data-action="printReturn" data-id="${r.id}">${icon('printer', 'i-sm')}</button></div>
            <div class="small muted">${Fmt.dateTime(r.created_at)} · ${r.cashier}${r.reason ? ` · ${r.reason}` : ''}${r.restocked ? '' : ' · not restocked'}</div>
            <div class="small mt-4">${r.items.map((i) => `${i.product_name} ×${i.qty}`).join(', ')}</div>
            <div class="small mt-4">Value <b>${Fmt.money(r.total)}</b> · refunded <b>${Fmt.money(r.refund_amount)}</b></div></div>`)}` : ''}
        ${s.revisions.length ? html`<div class="section-title mt-24">Edit history</div>
          ${s.revisions.map((r) => html`<div class="small mb-8"><span class="strong">${Fmt.dateTime(r.created_at)}</span> · ${r.user}<div class="muted">${r.summary || 'No item changes'}</div></div>`)}` : ''}
      `,
      foot: html`
        <button class="btn btn-primary" data-action="print">${icon('printer')} Print</button>
        <button class="btn btn-secondary" data-action="preview">${icon('eye')} Preview / PDF</button>
        <span class="grow"></span>
        ${s.customer_id && s.due > 0 ? html`<button class="btn btn-secondary" data-action="receive">${icon('handCoins')} Receive payment</button>` : ''}
        ${editable ? html`<button class="btn btn-secondary" data-action="edit">${icon('edit')} Edit</button>` : ''}
        ${returnable ? html`<button class="btn btn-secondary" data-action="moreActions">${icon('more')}</button>` : ''}`
    });
    d.sale = s;
  };
  const after = async () => { await load(); if (onChange) onChange(); };
  const acts = {
    print: (t) => printMenu(t, id),
    preview: () => Printer.previewSale(d.sale),
    openCustomer: () => { const cid = d.sale.customer_id; d.close(); App.go('customers', { id: cid }); },
    receive: () => receivePayment({ id: d.sale.customer_id, name: d.sale.customer_name }, { onDone: after }),
    edit: async () => {
      if (Lock.isActionLocked('editSale') && !(await Lock.prompt('Editing invoices is locked'))) return;
      const s = d.sale; d.close(); App.go('sell', { editSale: s });
    },
    moreActions: (t) => menu(t, [
      { label: 'Return items…', icon: 'returnIcon', action: () => returnDialog(d.sale, after) },
      { label: 'Cancel whole sale…', icon: 'ban', danger: true, action: () => cancelDialog(d.sale, after) }
    ]),
    printReturn: (t) => {
      const r = d.sale.returns.find((x) => String(x.id) === t.dataset.id);
      Printer.preview({ title: r.return_no, name: r.return_no, papers: ['thermal'], build: () => Docs.returnNote(d.sale, r, App.settings) });
    }
  };
  // Re-bind actions now that the drawer exists.
  d.root.addEventListener('click', (e) => {
    const tg = e.target.closest('[data-action]');
    if (tg && acts[tg.dataset.action]) acts[tg.dataset.action](tg, e);
  });
  await load();
  return d;
}

/* ------------------------------------------------------------------ returns */

const RETURN_REASONS = ['Wrong shade / item', 'Damaged / defective', 'Expired', 'Customer changed mind', 'Allergy / reaction', 'Other'];

function returnDialog(sale, onDone) {
  const remaining = sale.items.filter((i) => i.qty > i.returned_qty);
  const qty = Object.fromEntries(remaining.map((i) => [i.id, 0]));
  let quote = null;
  const methods = App.settings.payment_methods;
  const m = modal({
    title: `Return items · ${sale.invoice_no}`, sub: sale.customer_name, size: 'wide',
    body: html`<div class="stack">
      <div class="card"><table class="table table-compact"><thead><tr><th>Item</th><th class="num">Sold</th><th class="num">Price</th><th class="num" style="width:150px">Return qty</th></tr></thead><tbody>
        ${remaining.map((i) => html`<tr><td><div class="cell-title">${i.product_name}</div>${i.returned_qty ? html`<div class="cell-sub">${i.returned_qty} already returned</div>` : ''}</td>
          <td class="num">${i.qty - i.returned_qty}</td><td class="num">${Fmt.money(i.line_total / i.qty)}</td>
          <td class="num"><div class="qty" style="float:right"><button data-action="rdec" data-id="${i.id}">${icon('minus', 'i-sm')}</button><input data-id="${i.id}" data-role="rq" value="0" inputmode="numeric"><button data-action="rinc" data-id="${i.id}">${icon('plus', 'i-sm')}</button></div></td></tr>`)}
      </tbody></table></div>
      <div class="row"><button class="btn btn-ghost btn-sm" data-action="all">Return everything</button><span class="grow"></span>
        <label class="check"><input type="checkbox" id="restock" checked> Put returned items back in stock</label></div>
      <div class="form-grid">
        <div class="field"><label>Reason</label><select class="select" id="reason">${RETURN_REASONS.map((r) => html`<option>${r}</option>`)}</select></div>
        <div class="field"><label>Note (optional)</label><input class="input" id="rnote" placeholder="Details"></div>
      </div>
      <div id="rquote"></div>
    </div>`,
    foot: html`<button class="btn btn-secondary" data-action="__close">Cancel</button><button class="btn btn-primary" data-action="go" id="rgo" disabled>Confirm return</button>`,
    actions: {
      rinc: (t) => setQ(Number(t.dataset.id), qty[t.dataset.id] + 1),
      rdec: (t) => setQ(Number(t.dataset.id), qty[t.dataset.id] - 1),
      all: () => { remaining.forEach((i) => setQ(i.id, i.qty - i.returned_qty, false)); refresh(); },
      go: (_t, _e, mm) => submit(mm)
    }
  });
  const setQ = (id, v, doRefresh = true) => {
    const it = remaining.find((i) => i.id === id);
    const max = it.qty - it.returned_qty;
    qty[id] = Math.max(0, Math.min(max, Number.isFinite(v) ? v : 0));
    const inp = m.root.querySelector(`[data-role=rq][data-id="${id}"]`);
    if (inp && document.activeElement !== inp) inp.value = qty[id];
    if (doRefresh) refresh();
  };
  m.root.addEventListener('input', (e) => {
    if (e.target.dataset.role === 'rq') setQ(Number(e.target.dataset.id), parseInt(e.target.value, 10) || 0);
    if (e.target.id === 'refund-amt') validateRefund();
  });
  const items = () => Object.entries(qty).filter(([, v]) => v > 0).map(([k, v]) => ({ sale_item_id: Number(k), qty: v }));
  const refresh = debounce(async () => {
    const list = items();
    const box = m.root.querySelector('#rquote');
    if (!list.length) { setHTML(box, ''); m.root.querySelector('#rgo').disabled = true; quote = null; return; }
    try { quote = await api('sales.returnQuote', { sale_id: sale.id, items: list }); } catch (e) { setHTML(box, html`<div class="callout danger">${icon('alert')}<div>${e.message}</div></div>`); return; }
    setHTML(box, html`<div class="co-break">
      <div class="line-sum"><span class="muted">Return value</span><span class="big">${Fmt.money(quote.value)}</span></div>
      ${quote.refund_forced ? html`<div class="co-change"><span class="strong">Refund to customer</span><span class="big">${Fmt.money(quote.max_refund)}</span></div>
        <div class="field"><label>Refund paid by</label><select class="select" id="refund-method">${methods.map((x) => html`<option>${x}</option>`)}</select></div>`
      : html`<div class="small muted">${quote.max_refund > 0 ? `The customer can get up to ${Fmt.money(quote.max_refund)} back; anything not refunded stays in their account as advance.` : 'The return value is deducted from the customer’s udhaar. No cash refund is due.'}</div>
        ${quote.max_refund > 0 ? html`<div class="form-grid"><div class="field"><label>Refund now</label><input class="input num" id="refund-amt" value="${quote.max_refund}" inputmode="decimal"></div>
          <div class="field"><label>Refund paid by</label><select class="select" id="refund-method">${methods.map((x) => html`<option>${x}</option>`)}</select></div></div>` : ''}`}
      ${sale.customer_id ? html`<div class="small muted" id="bal-after"></div>` : ''}
    </div>`);
    validateRefund();
  }, 180);
  const validateRefund = () => {
    const inp = m.root.querySelector('#refund-amt');
    let ok = !!quote;
    let refund = quote ? (quote.refund_forced ? quote.max_refund : 0) : 0;
    if (inp) { const v = Number(inp.value); ok = ok && Number.isFinite(v) && v >= 0 && v <= quote.max_refund; inp.classList.toggle('invalid', !ok); refund = ok ? v : 0; }
    m.root.querySelector('#rgo').disabled = !ok;
    const ba = m.root.querySelector('#bal-after');
    if (ba && quote) {
      // quote.balance_after already includes the default (maximum) refund.
      const bal = Math.round((quote.balance_after - quote.refund + refund) * 100) / 100;
      ba.innerHTML = '';
      ba.append(`Customer balance after: ${bal < 0 ? 'advance ' : ''}${Fmt.money(Math.abs(bal))}`);
    }
  };
  const submit = async (mm) => {
    if (Lock.isActionLocked('returnSale') && !(await Lock.prompt('Returns are locked'))) return;
    const reason = [m.root.querySelector('#reason').value, m.root.querySelector('#rnote').value.trim()].filter(Boolean).join(' — ');
    const amt = m.root.querySelector('#refund-amt');
    const meth = m.root.querySelector('#refund-method');
    const res = await attempt(() => api('sales.return', {
      sale_id: sale.id, items: items(), reason, restock: m.root.querySelector('#restock').checked,
      refund_amount: amt ? Number(amt.value) : undefined, refund_method: meth ? meth.value : 'Cash'
    }));
    if (!res) return;
    mm.close();
    toast(`${res.return_no} saved${res.refund ? ` · refund ${Fmt.money(res.refund)}` : ''}`, 'success');
    if (onDone) onDone();
    const r = res.sale.returns.find((x) => x.return_no === res.return_no);
    if (r) Printer.preview({ title: r.return_no, name: r.return_no, papers: ['thermal'], build: () => Docs.returnNote(res.sale, r, App.settings) });
  };
}

function cancelDialog(sale, onDone) {
  const remaining = sale.items.filter((i) => i.qty > i.returned_qty).map((i) => ({ sale_item_id: i.id, qty: i.qty - i.returned_qty }));
  const methods = App.settings.payment_methods;
  const m = modal({
    title: `Cancel ${sale.invoice_no}?`, sub: 'All remaining items are returned and the bill is marked cancelled. The invoice stays in history.', size: 'narrow',
    body: html`<div class="stack"><div id="cq"><div class="skeleton"></div></div>
      <label class="check"><input type="checkbox" id="crestock" checked> Put items back in stock</label>
      <div class="field"><label>Reason *</label><input class="input" id="creason" placeholder="Why is this sale cancelled?" autofocus></div></div>`,
    foot: html`<button class="btn btn-secondary" data-action="__close">Keep sale</button><button class="btn btn-danger" data-action="go">Cancel sale</button>`,
    actions: {
      go: async (_t, _e, mm) => {
        const reason = mm.root.querySelector('#creason').value.trim();
        if (!reason) { mm.root.querySelector('#creason').classList.add('invalid'); return; }
        if (Lock.isActionLocked('cancelSale') && !(await Lock.prompt('Cancelling sales is locked'))) return;
        const amt = mm.root.querySelector('#c-refund');
        const res = await attempt(() => api('sales.cancel', {
          sale_id: sale.id, reason, restock: mm.root.querySelector('#crestock').checked,
          refund_amount: amt ? Number(amt.value) : undefined, refund_method: (mm.root.querySelector('#c-method') || {}).value || 'Cash'
        }));
        if (!res) return;
        mm.close();
        toast(`${sale.invoice_no} cancelled${res.refund ? ` · refund ${Fmt.money(res.refund)}` : ''}`, 'success');
        if (onDone) onDone();
      }
    }
  });
  api('sales.returnQuote', { sale_id: sale.id, items: remaining }).then((q) => {
    setHTML(m.root.querySelector('#cq'), html`<div class="co-break">
      <div class="line-sum"><span class="muted">Value returned</span><span class="strong">${Fmt.money(q.value)}</span></div>
      ${q.refund_forced ? html`<div class="co-change"><span class="strong">Refund to customer</span><span class="big">${Fmt.money(q.max_refund)}</span></div>`
        : q.max_refund ? html`<div class="field"><label>Refund now (max ${Fmt.money(q.max_refund)})</label><input class="input num" id="c-refund" value="${q.max_refund}"></div>`
        : html`<div class="small muted">Value is deducted from the customer’s udhaar. No cash refund.</div>`}
      ${q.max_refund ? html`<div class="field"><label>Refund paid by</label><select class="select" id="c-method">${methods.map((x) => html`<option>${x}</option>`)}</select></div>` : ''}
    </div>`);
  }).catch((e) => setHTML(m.root.querySelector('#cq'), html`<div class="callout danger">${icon('alert')}<div>${e.message}</div></div>`));
}

/* ------------------------------------------------------------------ receive udhaar (shared) */

async function receivePayment(customer, { onDone } = {}) {
  let c;
  try { c = await api('customers.get', { id: customer.id }); } catch (e) { toast(e.message, 'error'); return; }
  const methods = App.settings.payment_methods;
  const m = modal({
    title: 'Receive udhaar payment', sub: `${c.name}${c.phone ? ' · ' + c.phone : ''}`, size: 'narrow',
    body: html`<form class="stack" data-on-submit="go">
      <div class="co-due"><div class="lbl">${c.balance >= 0 ? 'Balance due' : 'Advance held'}</div><div class="val">${Fmt.money(Math.abs(c.balance))}</div></div>
      <div class="form-grid">
        <div class="field"><label>Amount received *</label><input class="input num input-lg" style="height:40px" name="amount" value="${c.balance > 0 ? c.balance : ''}" inputmode="decimal" autofocus></div>
        <div class="field"><label>Method</label><select class="select" name="method" style="height:40px">${methods.map((x) => html`<option>${x}</option>`)}</select></div>
        <div class="field span-2"><label>Note (optional)</label><input class="input" name="note" placeholder="e.g. JazzCash ref 12345"></div>
      </div>
      <div id="rp-after" class="small muted"></div>
      <label class="check"><input type="checkbox" name="allow_advance"> Accept more than the balance (keep as advance)</label>
      <label class="check"><input type="checkbox" name="print" checked> Print payment receipt</label>
    </form>`,
    foot: html`<button class="btn btn-secondary" data-action="__close">Cancel</button><button class="btn btn-primary" data-action="go">${icon('check')} Save payment</button>`,
    actions: {
      go: async (_t, _e, mm) => {
        const f = formData(mm.root.querySelector('form'));
        const res = await attempt(() => api('payments.receive', { customer_id: c.id, amount: Number(f.amount), method: f.method, note: f.note, allow_advance: f.allow_advance }));
        if (!res) return;
        mm.close();
        toast(`Received ${Fmt.money(res.payment.amount)} from ${c.name}. Balance now ${Fmt.money(res.balance_after)}`, 'success');
        if (f.print) {
          const p = { ...res.payment, balance_before: res.balance_before, balance_after: res.balance_after };
          Printer.printHtml(Docs.paymentReceipt(p, App.settings, 'thermal'), 'thermal');
        }
        if (onDone) onDone(res);
      }
    }
  });
  const upd = () => {
    const v = Number(m.root.querySelector('[name=amount]').value) || 0;
    m.root.querySelector('#rp-after').textContent = `Balance after this payment: ${Fmt.money(c.balance - v)}${c.balance - v < 0 ? ' (advance)' : ''}`;
  };
  m.root.querySelector('[name=amount]').addEventListener('input', upd);
  upd();
  return m;
}

/* ------------------------------------------------------------------ page */

(() => {
  const LS = 'sajawal.sales.range';
  const st = {
    tab: 'invoices',
    range: (() => { try { return DateRange.fresh(JSON.parse(localStorage.getItem(LS))) || DateRange.make('month'); } catch (_) { return DateRange.make('month'); } })(),
    q: '', status: '', page: 1
  };
  let root = null;
  let res = null;

  const STATUS = [['', 'All invoices'], ['due', 'Udhaar / unpaid'], ['partial', 'Partly paid'], ['paid', 'Fully paid'], ['returned', 'With returns'], ['cancelled', 'Cancelled'], ['edited', 'Edited']];

  function params() {
    const p = { from: st.range.from, to: st.range.to, q: st.q, page: st.page, pageSize: 25 };
    if (st.tab === 'invoices') {
      if (['due', 'partial', 'paid'].includes(st.status)) p.payment = st.status;
      else if (st.status) p.status = st.status;
    }
    return p;
  }

  async function load() {
    const tableBox = $('#sales-table', root);
    if (!tableBox) return;
    try {
      if (st.tab === 'invoices') res = await api('sales.list', params());
      else if (st.tab === 'returns') res = await api('sales.returns', params());
      else res = await api('payments.list', { ...params(), include_voided: true });
    } catch (e) { setHTML(tableBox, emptyState('alert', 'Could not load', e.message)); return; }
    renderStrip();
    renderTable();
  }

  function renderStrip() {
    const s = $('#sales-strip', root);
    if (st.tab === 'invoices') {
      setHTML(s, html`<div class="strip-item"><div class="strip-label">Invoices</div><div class="strip-value">${Fmt.num(res.total)}</div></div>
        <div class="strip-item"><div class="strip-label">Sales</div><div class="strip-value">${Fmt.money(res.gross)}</div></div>
        <div class="strip-item"><div class="strip-label">Returned</div><div class="strip-value">${Fmt.money(res.returned)}</div></div>
        <div class="strip-item"><div class="strip-label">Net sales</div><div class="strip-value">${Fmt.money(res.net)}</div></div>`);
    } else if (st.tab === 'returns') {
      setHTML(s, html`<div class="strip-item"><div class="strip-label">Returns</div><div class="strip-value">${Fmt.num(res.total)}</div></div>
        <div class="strip-item"><div class="strip-label">Value returned</div><div class="strip-value">${Fmt.money(res.value)}</div></div>
        <div class="strip-item"><div class="strip-label">Cash refunded</div><div class="strip-value">${Fmt.money(res.refunded)}</div></div>`);
    } else {
      setHTML(s, html`<div class="strip-item"><div class="strip-label">Entries</div><div class="strip-value">${Fmt.num(res.total)}</div></div>
        <div class="strip-item"><div class="strip-label">Money in</div><div class="strip-value pos">${Fmt.money(res.received)}</div></div>
        <div class="strip-item"><div class="strip-label">Money out (refunds)</div><div class="strip-value neg">${Fmt.money(res.paid_out)}</div></div>
        <div class="strip-item"><div class="strip-label">Net</div><div class="strip-value">${Fmt.money(res.received - res.paid_out)}</div></div>`);
    }
  }

  function renderTable() {
    const box = $('#sales-table', root);
    if (!res.rows.length) {
      setHTML(box, emptyState(st.tab === 'payments' ? 'cash' : 'receipt', st.q ? `Nothing matches “${st.q}”` : 'Nothing in this period', st.q ? 'Try another invoice number, customer or product.' : 'Change the date range to see older records.'));
      return;
    }
    if (st.tab === 'invoices') {
      setHTML(box, html`<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Customer</th><th class="num">Items</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${res.rows.map((s) => html`<tr class="clickable ${s.status === 'cancelled' ? 'muted-row' : ''}" data-action="open" data-id="${s.id}">
          <td><div class="cell-title">${s.invoice_no}</div><div class="cell-sub">${Fmt.dateTime(s.created_at)}</div></td>
          <td><div class="ellipsis" style="max-width:260px">${s.customer_name}</div>${s.customer_phone ? html`<div class="cell-sub">${s.customer_phone}</div>` : ''}</td>
          <td class="num">${s.qty}</td>
          <td class="num"><div class="strong">${Fmt.money(s.net_total)}</div>${s.returned_total ? html`<div class="cell-sub">of ${Fmt.money(s.total)}</div>` : ''}</td>
          <td><div class="row gap-4" style="flex-wrap:wrap">${s.net_total <= 0 ? '' : s.customer_id ? statusBadge(s.payment_status) : html`<span class="badge b-green">Paid</span>`}${s.status !== 'completed' ? statusBadge(s.status) : ''}${s.edit_count ? html`<span class="badge b-blue">Edited</span>` : ''}</div>
            ${s.due ? html`<div class="cell-sub neg">${Fmt.money(s.due)} due</div>` : ''}</td>
          <td class="actions"><button class="btn btn-ghost btn-sm btn-icon" data-action="printRow" data-id="${s.id}" title="Print">${icon('printer', 'i-sm')}</button></td>
        </tr>`)}</tbody></table></div>${pager(res)}`);
    } else if (st.tab === 'returns') {
      setHTML(box, html`<div class="table-wrap"><table class="table"><thead><tr><th>Return</th><th>Invoice</th><th>Customer</th><th class="num">Qty</th><th class="num">Value</th><th class="num">Refunded</th><th>Reason</th></tr></thead><tbody>
        ${res.rows.map((r) => html`<tr class="clickable" data-action="open" data-id="${r.sale_id}">
          <td><div class="cell-title">${r.return_no}</div><div class="cell-sub">${Fmt.dateTime(r.created_at)}</div></td>
          <td>${r.invoice_no} ${r.kind === 'cancel' ? html`<span class="badge b-gray">Cancelled</span>` : ''}</td><td>${r.customer_name}</td>
          <td class="num">${r.qty}</td><td class="num strong">${Fmt.money(r.total)}</td><td class="num">${Fmt.money(r.refund_amount)}</td>
          <td><div class="ellipsis" style="max-width:220px">${r.reason || '—'}</div>${r.restocked ? '' : html`<div class="cell-sub">Not restocked</div>`}</td></tr>`)}
      </tbody></table></div>${pager(res)}`);
    } else {
      setHTML(box, html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead><tbody>
        ${res.rows.map((p) => html`<tr class="${p.voided ? 'muted-row' : ''}">
          <td>${Fmt.dateTime(p.created_at)}<div class="cell-sub">${p.invoice_no || p.receipt_no}</div></td>
          <td>${p.customer_name || 'Walk-in'}</td>
          <td>${p.kind_label}${p.voided ? html` <span class="badge b-gray">Voided</span>` : ''}${p.note ? html`<div class="cell-sub ellipsis" style="max-width:240px">${p.note}</div>` : ''}</td>
          <td>${p.method}</td>
          <td class="num strong ${p.amount < 0 ? 'neg' : ''}" style="${p.voided ? 'text-decoration:line-through' : ''}">${Fmt.money(p.amount)}</td>
          <td class="actions">${p.sale_id ? html`<button class="btn btn-ghost btn-sm" data-action="open" data-id="${p.sale_id}">Invoice</button>` : ''}
            ${p.kind === 'receipt' && !p.voided ? html`<button class="btn btn-ghost btn-sm btn-icon" data-action="payMenu" data-id="${p.id}">${icon('more', 'i-sm')}</button>` : ''}</td></tr>`)}
      </tbody></table></div>${pager(res)}`);
    }
  }

  function renderPage() {
    setHTML(root, html`
      <div class="page-head">
        <div><div class="page-title">Sales & Returns</div><div class="page-sub">Every invoice, return and payment — search, reprint, edit, return or cancel.</div></div>
        <div class="page-actions">${DateRange.button(st.range)}
          <button class="btn btn-secondary" data-action="export">${icon('download')} Excel</button>
          <button class="btn btn-secondary" data-action="printList">${icon('printer')} Print list</button>
          <button class="btn btn-primary" data-action="newSale">${icon('plus')} New sale</button></div>
      </div>
      <div class="tabs">
        <button class="tab ${st.tab === 'invoices' ? 'on' : ''}" data-action="tab" data-t="invoices">${icon('receipt', 'i-sm')} Invoices</button>
        <button class="tab ${st.tab === 'returns' ? 'on' : ''}" data-action="tab" data-t="returns">${icon('returnIcon', 'i-sm')} Returns</button>
        <button class="tab ${st.tab === 'payments' ? 'on' : ''}" data-action="tab" data-t="payments">${icon('cash', 'i-sm')} Payments</button>
      </div>
      <div class="toolbar">
        <div class="input-wrap search">${icon('search')}<input class="input" id="sales-q" value="${st.q}" placeholder="${st.tab === 'payments' ? 'Customer, invoice or note…' : 'Invoice #, customer, phone or product…'}" data-on-input="q"></div>
        ${st.tab === 'invoices' ? html`<select class="select" style="width:190px" data-on-change="status">${STATUS.map(([v, l]) => html`<option value="${v}" ${st.status === v ? raw('selected') : ''}>${l}</option>`)}</select>` : ''}
      </div>
      <div class="strip" id="sales-strip"></div>
      <div class="card" id="sales-table"><div class="card-pad"><div class="skeleton"></div></div></div>`);
  }

  const search = debounce(() => { st.page = 1; load(); }, 220);

  Views.sales = {
    async render(container, params = {}) {
      root = container;
      st.range = DateRange.fresh(st.range);
      if (params.tab) st.tab = params.tab;
      renderPage();
      const off = delegate(root, {
        tab: (t) => { st.tab = t.dataset.t; st.page = 1; st.status = ''; renderPage(); load(); },
        q: (t) => { st.q = t.value; search(); },
        status: (t) => { st.status = t.value; st.page = 1; load(); },
        page: (t) => { st.page = Number(t.dataset.page); load(); $('#page').scrollTop = 0; },
        openRange: (t) => DateRange.open(t, st.range, (r) => { st.range = r; st.page = 1; try { localStorage.setItem(LS, JSON.stringify(r)); } catch (_) { /* ignore */ } renderPage(); load(); }),
        open: (t, e) => { if (e.target.closest('[data-action=printRow]')) return; openInvoice(Number(t.dataset.id), { onChange: load }); },
        printRow: (t, e) => { e.stopPropagation(); printMenu(t, Number(t.dataset.id)); },
        newSale: () => App.go('sell'),
        payMenu: (t) => {
          const p = res.rows.find((x) => String(x.id) === t.dataset.id);
          menu(t, [
            { label: 'Print receipt', icon: 'printer', action: async () => { const full = await api('payments.get', { id: p.id }); Printer.preview({ title: full.receipt_no, name: full.receipt_no, papers: ['thermal', 'a5'], paper: 'thermal', build: (pp) => Docs.paymentReceipt(full, App.settings, pp) }); } },
            { label: 'Void this payment…', icon: 'ban', danger: true, action: async () => {
              const reason = await promptDialog({ title: 'Void payment', label: `Why is the ${Fmt.money(p.amount)} payment from ${p.customer_name} being voided?`, required: true, confirm: 'Void payment' });
              if (reason && await attempt(() => api('payments.void', { id: p.id, reason }), { success: 'Payment voided' })) load();
            } }
          ]);
        },
        export: async () => {
          const all = await attempt(() => (st.tab === 'invoices' ? fetchAll('sales.list', params()) : st.tab === 'returns' ? fetchAll('sales.returns', params()) : fetchAll('payments.list', { ...params(), include_voided: true })));
          if (!all) return;
          let rows;
          if (st.tab === 'invoices') rows = all.rows.map((s) => ({ Invoice: s.invoice_no, Date: Fmt.dateTime(s.created_at), Customer: s.customer_name, Phone: s.customer_phone, Items: s.qty, Total: s.total, Returned: s.returned_total, Net: s.net_total, 'Due on bill': s.due, Payment: s.customer_id ? s.payment_status : 'paid', Status: s.status, Edited: s.edit_count ? 'Yes' : '', Cashier: s.cashier }));
          else if (st.tab === 'returns') rows = all.rows.map((r) => ({ Return: r.return_no, Date: Fmt.dateTime(r.created_at), Invoice: r.invoice_no, Customer: r.customer_name, Type: r.kind, Qty: r.qty, Value: r.total, Refunded: r.refund_amount, Restocked: r.restocked ? 'Yes' : 'No', Reason: r.reason }));
          else rows = all.rows.map((p) => ({ Date: Fmt.dateTime(p.created_at), Reference: p.invoice_no || p.receipt_no, Customer: p.customer_name || 'Walk-in', Type: p.kind_label, Method: p.method, Amount: p.amount, Voided: p.voided ? 'Yes' : '', Note: p.note }));
          exportExcel(`Sajawal_${st.tab}`, [{ name: st.tab, rows }]);
        },
        printList: async () => {
          if (st.tab !== 'invoices') { toast('Use Excel export for this list', 'info'); return; }
          const all = await attempt(() => fetchAll('sales.list', params()));
          if (!all) return;
          Printer.preview({
            title: 'Sales list', name: `Sales ${DateRange.span(st.range)}`, papers: ['a4'],
            build: () => Docs.report({
              title: 'Sales list', subtitle: DateRange.span(st.range),
              summary: [{ label: 'Invoices', value: Fmt.num(all.total) }, { label: 'Sales', value: Fmt.money(all.gross) }, { label: 'Returned', value: Fmt.money(all.returned) }, { label: 'Net', value: Fmt.money(all.net) }],
              columns: [
                { label: 'Invoice', key: 'invoice_no' }, { label: 'Date', key: 'created_at', fmt: (v) => Fmt.dateTime(v) }, { label: 'Customer', key: 'customer_name' },
                { label: 'Qty', key: 'qty', align: 'right' }, { label: 'Net', key: 'net_total', align: 'right', fmt: (v) => Fmt.money(v, { symbol: false }) },
                { label: 'Due', key: 'due', align: 'right', fmt: (v) => (v ? Fmt.money(v, { symbol: false }) : '') }
              ],
              rows: all.rows, totals: { net_total: all.net, due: Math.round(all.rows.reduce((a, r) => a + r.due * 100, 0)) / 100 }
            }, App.settings, 'a4')
          });
        }
      });
      await load();
      if (params.openId) openInvoice(params.openId, { onChange: load });
      return off;
    }
  };
})();
