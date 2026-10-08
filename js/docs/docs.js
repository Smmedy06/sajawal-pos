/* Printable documents. Each function returns a complete HTML page.
   The same HTML is used for the on-screen preview and for printing / PDF,
   so what you preview is exactly what prints. */
'use strict';

const Docs = (() => {
  const m = (n) => Fmt.money(n, { symbol: false });
  const neg = (n) => (Number(n) ? `-${m(n)}` : m(0));
  const cur = () => Fmt.currency;

  const BASE_CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    table{border-collapse:collapse;width:100%}
    .r{text-align:right}.c{text-align:center}.b{font-weight:700}.mut{color:#555}
    .nowrap{white-space:nowrap}
  `;

  function page(title, css, body) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}${css}</style></head><body>${part(body)}</body></html>`;
  }

  /* ---------------------------------------------------------------- thermal receipt */

  function receiptCss(width) {
    const content = width === 58 ? 48 : 72;
    const fs = width === 58 ? 10 : 11;
    return `
      @page{size:${width}mm auto;margin:0}
      @media screen{html,body{overflow:hidden}}
      html,body{width:${width}mm}
      .rc{width:${content}mm;margin:0 auto;padding:2mm 0 4mm;font-size:${fs}px;line-height:1.28}
      .hd{text-align:center;margin-bottom:4px}
      .hd .nm{font-size:${fs + 4}px;font-weight:800;letter-spacing:.2px}
      .hd .sm{font-size:${fs - 1.5}px;color:#222}
      .rule{border-top:1px dashed #000;margin:4px 0}
      .meta{display:flex;justify-content:space-between;gap:6px;font-size:${fs - 1}px}
      .it{margin:2px 0}
      .it .n{font-weight:600;word-break:break-word}
      .it .q{display:flex;justify-content:space-between;font-size:${fs - 0.5}px}
      .ln{display:flex;justify-content:space-between;gap:8px}
      .tot{font-size:${fs + 3}px;font-weight:800;margin:2px 0}
      .box{border:1px solid #000;padding:3px 5px;margin-top:4px}
      .ft{text-align:center;font-size:${fs - 1.5}px;margin-top:5px}
      .title{text-align:center;font-weight:800;font-size:${fs + 1}px;margin:2px 0;letter-spacing:.5px}
    `;
  }

  function storeHeader(s, cls = 'hd') {
    return html`<div class="${cls}">
      <div class="nm">${s.business_name}</div>
      ${s.business_tagline ? html`<div class="sm">${s.business_tagline}</div>` : ''}
      ${s.business_address ? html`<div class="sm">${s.business_address}</div>` : ''}
      ${s.business_phone ? html`<div class="sm">${s.business_phone}</div>` : ''}
    </div>`;
  }

  function paidLines(sale) {
    const live = sale.payments.filter((p) => !p.voided && p.kind === 'sale');
    return live;
  }

  function receipt(sale, s) {
    const width = Number(s.print.receipt_width) === 58 ? 58 : 80;
    const payments = paidLines(sale);
    const tendered = sale.paid_at_sale + sale.received_with_sale;
    const hasCustomer = !!sale.customer_id;
    const body = html`<div class="rc">
      ${storeHeader(s)}
      <div class="rule"></div>
      <div class="meta"><span class="b">${sale.invoice_no}</span><span>${Fmt.date(sale.created_at)} ${Fmt.time(sale.created_at)}</span></div>
      ${hasCustomer ? html`<div class="meta"><span>${sale.customer_name}</span><span>${sale.customer_phone}</span></div>` : ''}
      ${sale.status === 'cancelled' ? html`<div class="title">*** CANCELLED ***</div>` : ''}
      <div class="rule"></div>
      ${sale.items.map((i) => html`<div class="it">
        <div class="n">${i.product_name}</div>
        <div class="q"><span>${i.qty} × ${m(i.unit_price)}${i.returned_qty ? html` <i>(ret ${i.returned_qty})</i>` : ''}</span><span>${m(i.line_subtotal)}</span></div>
      </div>`)}
      <div class="rule"></div>
      <div class="ln"><span>Items</span><span>${sale.items.reduce((a, i) => a + i.qty, 0)}</span></div>
      <div class="ln"><span>Subtotal</span><span>${m(sale.subtotal)}</span></div>
      ${sale.discount_amount ? html`<div class="ln"><span>Discount${sale.discount_type === 'percent' ? ` (${sale.discount_value}%)` : ''}</span><span>-${m(sale.discount_amount)}</span></div>` : ''}
      <div class="ln tot"><span>TOTAL ${cur()}</span><span>${m(sale.total)}</span></div>
      ${payments.map((p) => html`<div class="ln"><span>Paid · ${p.method}</span><span>${m(p.amount)}</span></div>`)}
      ${sale.returned_total && !hasCustomer ? html`<div class="ln"><span>Returned (refunded)</span><span>${neg(sale.returned_total)}</span></div>` : ''}
      ${!hasCustomer && tendered > sale.total ? '' : ''}
      ${hasCustomer ? html`<div class="box">
        <div class="ln"><span>Previous balance</span><span>${m(sale.previous_balance)}</span></div>
        <div class="ln"><span>This bill</span><span>${m(sale.total)}</span></div>
        <div class="ln"><span>Received</span><span>${neg(tendered)}</span></div>
        ${sale.returned_total ? html`<div class="ln"><span>Returned</span><span>${neg(sale.returned_total)}</span></div>` : ''}
        ${sale.refunded ? html`<div class="ln"><span>Refund paid</span><span>${m(sale.refunded)}</span></div>` : ''}
        <div class="ln b"><span>Balance due</span><span>${m(sale.balance_after_sale)}</span></div>
      </div>` : ''}
      <div class="rule"></div>
      <div class="ft">${s.receipt_footer}</div>
      ${s.invoice_terms ? html`<div class="ft">${s.invoice_terms}</div>` : ''}
    </div>`;
    return page(sale.invoice_no, receiptCss(width), body);
  }

  /* ---------------------------------------------------------------- A4 / A5 invoice */

  function sheetCss(paper, marginMm) {
    const a5 = paper === 'a5';
    const fs = a5 ? 9.5 : 10.5;
    return `
      @page{size:${a5 ? 'A5' : 'A4'};margin:${marginMm}mm}
      @media screen{body{padding:${marginMm}mm}}
      body{font-size:${fs}px;line-height:1.35}
      .top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:${a5 ? 6 : 8}px;border-bottom:1.5px solid #111}
      .top .nm{font-size:${a5 ? 15 : 19}px;font-weight:800;letter-spacing:-.2px}
      .top .sm{font-size:${fs - 0.5}px;color:#333}
      .doc{text-align:right}
      .doc .t{font-size:${a5 ? 12 : 14}px;font-weight:800;letter-spacing:1px}
      .doc .sm{font-size:${fs - 0.5}px}
      .parties{display:flex;justify-content:space-between;gap:12px;margin:${a5 ? 6 : 10}px 0}
      .lbl{font-size:${fs - 1.5}px;text-transform:uppercase;letter-spacing:.6px;color:#666;margin-bottom:1px}
      table.items th{font-size:${fs - 1}px;text-transform:uppercase;letter-spacing:.4px;color:#444;text-align:left;border-bottom:1px solid #111;padding:${a5 ? 3 : 4}px 4px}
      table.items td{padding:${a5 ? 2.5 : 3.5}px 4px;border-bottom:1px solid #ddd;vertical-align:top}
      table.items th.r,table.items td.r{text-align:right}
      .sum{display:flex;justify-content:space-between;gap:14px;margin-top:${a5 ? 6 : 10}px;align-items:flex-start}
      .totals{width:${a5 ? 52 : 42}%}
      .totals .ln{display:flex;justify-content:space-between;padding:1.5px 0}
      .totals .gt{border-top:1.5px solid #111;margin-top:3px;padding-top:3px;font-size:${fs + 2.5}px;font-weight:800}
      .ud{border:1px solid #bbb;border-radius:3px;padding:4px 6px;margin-top:5px}
      .ud .ln{display:flex;justify-content:space-between;padding:1px 0}
      .notes{flex:1;font-size:${fs - 1}px;color:#333}
      .foot{margin-top:${a5 ? 8 : 14}px;padding-top:4px;border-top:1px solid #ccc;font-size:${fs - 1.5}px;color:#444;display:flex;justify-content:space-between;gap:10px}
      .stamp{display:inline-block;border:1.5px solid #b91c1c;color:#b91c1c;font-weight:800;padding:1px 6px;font-size:${fs}px;letter-spacing:1px}
    `;
  }

  function invoice(sale, s, paper = 'a4') {
    const payments = paidLines(sale);
    const tendered = sale.paid_at_sale + sale.received_with_sale;
    const hasCustomer = !!sale.customer_id;
    const body = html`
      <div class="top">
        <div>
          <div class="nm">${s.business_name}</div>
          ${s.business_tagline ? html`<div class="sm">${s.business_tagline}</div>` : ''}
          <div class="sm">${s.business_address}</div>
          <div class="sm">${[s.business_phone, s.business_email].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="doc">
          <div class="t">INVOICE</div>
          <div class="sm"><b>${sale.invoice_no}</b></div>
          <div class="sm">${Fmt.date(sale.created_at)}, ${Fmt.time(sale.created_at)}</div>
          ${sale.status === 'cancelled' ? html`<div class="stamp">CANCELLED</div>` : sale.returned_total ? html`<div class="stamp">RETURNS</div>` : ''}
        </div>
      </div>
      <div class="parties">
        <div><div class="lbl">Bill to</div><div class="b">${sale.customer_name}</div>${sale.customer_phone ? html`<div>${sale.customer_phone}</div>` : ''}</div>
        <div class="r"><div class="lbl">Payment</div><div>${payments.length ? payments.map((p) => p.method).join(' + ') : 'Udhaar (credit)'}</div>
          ${sale.cashier ? html`<div class="mut">Served by ${sale.cashier}</div>` : ''}</div>
      </div>
      <table class="items">
        <thead><tr><th style="width:5%">#</th><th>Item</th><th class="r" style="width:8%">Qty</th><th class="r" style="width:16%">Price</th><th class="r" style="width:18%">Amount</th></tr></thead>
        <tbody>${sale.items.map((i, n) => html`<tr>
          <td>${n + 1}</td>
          <td>${i.product_name}${i.returned_qty ? html` <span class="mut">(returned ${i.returned_qty})</span>` : ''}</td>
          <td class="r">${i.qty}</td><td class="r nowrap">${m(i.unit_price)}</td><td class="r nowrap">${m(i.line_subtotal)}</td></tr>`)}
        </tbody>
      </table>
      <div class="sum">
        <div class="notes">
          ${sale.note ? html`<div><b>Note:</b> ${sale.note}</div>` : ''}
          ${s.invoice_terms ? html`<div class="mt">${s.invoice_terms}</div>` : ''}
        </div>
        <div class="totals">
          <div class="ln"><span>Subtotal</span><span>${m(sale.subtotal)}</span></div>
          ${sale.discount_amount ? html`<div class="ln"><span>Discount${sale.discount_type === 'percent' ? ` (${sale.discount_value}%)` : ''}</span><span>-${m(sale.discount_amount)}</span></div>` : ''}
          <div class="ln gt"><span>Total ${cur()}</span><span>${m(sale.total)}</span></div>
          ${payments.map((p) => html`<div class="ln"><span>Paid (${p.method})</span><span>${m(p.amount)}</span></div>`)}
          ${sale.returned_total && !hasCustomer ? html`<div class="ln"><span>Returned (refunded)</span><span>${neg(sale.returned_total)}</span></div>` : ''}
          ${hasCustomer ? html`<div class="ud">
            <div class="ln"><span>Previous balance</span><span>${m(sale.previous_balance)}</span></div>
            <div class="ln"><span>This invoice</span><span>${m(sale.total)}</span></div>
            <div class="ln"><span>Received</span><span>${neg(tendered)}</span></div>
        ${sale.returned_total ? html`<div class="ln"><span>Returned</span><span>${neg(sale.returned_total)}</span></div>` : ''}
        ${sale.refunded ? html`<div class="ln"><span>Refund paid</span><span>${m(sale.refunded)}</span></div>` : ''}
            <div class="ln b"><span>Balance due</span><span>${m(sale.balance_after_sale)}</span></div>
          </div>` : ''}
        </div>
      </div>
      <div class="foot"><span>${s.receipt_footer}</span><span>Printed ${Fmt.dateTime(new Date().toISOString())}</span></div>`;
    return page(sale.invoice_no, sheetCss(paper, s.print.margin_mm || 8), body);
  }

  /* ---------------------------------------------------------------- statement */

  function statement(led, s, paper = 'a4') {
    const c = led.customer;
    const period = led.from || led.to ? `${led.from ? Fmt.date(led.from) : 'Start'} – ${led.to ? Fmt.date(led.to) : 'Today'}` : 'All transactions';
    const body = html`
      <div class="top">
        <div><div class="nm">${s.business_name}</div><div class="sm">${s.business_address}</div><div class="sm">${s.business_phone}</div></div>
        <div class="doc"><div class="t">ACCOUNT STATEMENT</div><div class="sm">${period}</div><div class="sm">Printed ${Fmt.date(new Date().toISOString())}</div></div>
      </div>
      <div class="parties">
        <div><div class="lbl">Customer</div><div class="b">${c.name}</div>${c.phone ? html`<div>${c.phone}</div>` : ''}${c.address ? html`<div>${c.address}</div>` : ''}</div>
        <div class="r"><div class="lbl">Balance due</div><div class="b" style="font-size:15px">${cur()} ${m(led.closing_balance)}</div>
          ${led.closing_balance < 0 ? html`<div class="mut">Advance held for customer</div>` : ''}</div>
      </div>
      <table class="items">
        <thead><tr><th style="width:15%">Date</th><th style="width:12%">Ref</th><th>Description</th><th class="r" style="width:12%">Debit</th><th class="r" style="width:12%">Credit</th><th class="r" style="width:13%">Balance</th></tr></thead>
        <tbody>
          ${led.from ? html`<tr><td colspan="5"><b>Opening balance</b></td><td class="r b">${m(led.opening_balance)}</td></tr>` : ''}
          ${led.rows.map((r) => html`<tr><td class="nowrap">${Fmt.date(r.date)}</td><td class="nowrap">${r.ref}</td><td>${r.description}</td>
            <td class="r nowrap">${r.debit ? m(r.debit) : ''}</td><td class="r nowrap">${r.credit ? m(r.credit) : ''}</td><td class="r nowrap b">${m(r.balance)}</td></tr>`)}
        </tbody>
      </table>
      <div class="sum"><div class="notes">Debit = purchases on credit / refunds paid. Credit = payments received / goods returned.</div>
        <div class="totals">
          ${led.from ? html`<div class="ln"><span>Opening balance</span><span>${m(led.opening_balance)}</span></div>` : ''}
          <div class="ln"><span>Total debit</span><span>${m(led.total_debit)}</span></div>
          <div class="ln"><span>Total credit</span><span>-${m(led.total_credit)}</span></div>
          <div class="ln gt"><span>Closing balance</span><span>${m(led.closing_balance)}</span></div>
        </div></div>
      <div class="foot"><span>${s.business_name} · ${s.business_phone}</span><span>Thank you for your business</span></div>`;
    return page(`Statement ${c.name}`, sheetCss(paper, s.print.margin_mm || 8), body);
  }

  /* ---------------------------------------------------------------- payment receipt */

  function paymentReceipt(p, s, paper = 'thermal') {
    const lines = html`
      <div class="ln"><span>Receipt no.</span><span class="b">${p.receipt_no}</span></div>
      <div class="ln"><span>Date</span><span>${Fmt.dateTime(p.created_at)}</span></div>
      <div class="ln"><span>Customer</span><span>${p.customer_name}</span></div>
      <div class="ln"><span>Method</span><span>${p.method}</span></div>
      ${p.note ? html`<div class="ln"><span>Note</span><span>${p.note}</span></div>` : ''}`;
    if (paper === 'thermal') {
      const width = Number(s.print.receipt_width) === 58 ? 58 : 80;
      return page(p.receipt_no, receiptCss(width), html`<div class="rc">${storeHeader(s)}<div class="rule"></div>
        <div class="title">PAYMENT RECEIPT</div><div class="rule"></div>${lines}<div class="rule"></div>
        <div class="ln tot"><span>RECEIVED ${cur()}</span><span>${m(p.amount)}</span></div>
        ${p.balance_after !== undefined ? html`<div class="box"><div class="ln"><span>Balance before</span><span>${m(p.balance_before)}</span></div><div class="ln b"><span>Balance now</span><span>${m(p.balance_after)}</span></div></div>` : ''}
        <div class="rule"></div><div class="ft">${s.receipt_footer}</div></div>`);
    }
    return page(p.receipt_no, sheetCss(paper, s.print.margin_mm || 8), html`
      <div class="top"><div><div class="nm">${s.business_name}</div><div class="sm">${s.business_address}</div><div class="sm">${s.business_phone}</div></div>
      <div class="doc"><div class="t">PAYMENT RECEIPT</div><div class="sm"><b>${p.receipt_no}</b></div><div class="sm">${Fmt.dateTime(p.created_at)}</div></div></div>
      <div class="sum"><div class="notes"><div class="lbl">Received from</div><div class="b" style="font-size:14px">${p.customer_name}</div><div>Method: ${p.method}</div>${p.note ? html`<div>${p.note}</div>` : ''}</div>
      <div class="totals"><div class="ln gt"><span>Amount ${cur()}</span><span>${m(p.amount)}</span></div>
      ${p.balance_after !== undefined ? html`<div class="ud"><div class="ln"><span>Balance before</span><span>${m(p.balance_before)}</span></div><div class="ln b"><span>Balance now</span><span>${m(p.balance_after)}</span></div></div>` : ''}</div></div>
      <div class="foot"><span>${s.receipt_footer}</span><span></span></div>`);
  }

  /* ---------------------------------------------------------------- return note */

  function returnNote(sale, ret, s) {
    const width = Number(s.print.receipt_width) === 58 ? 58 : 80;
    return page(ret.return_no, receiptCss(width), html`<div class="rc">${storeHeader(s)}<div class="rule"></div>
      <div class="title">${ret.kind === 'cancel' ? 'SALE CANCELLED' : 'RETURN NOTE'}</div>
      <div class="meta"><span class="b">${ret.return_no}</span><span>${Fmt.date(ret.created_at)} ${Fmt.time(ret.created_at)}</span></div>
      <div class="meta"><span>Invoice ${sale.invoice_no}</span><span>${sale.customer_name}</span></div>
      <div class="rule"></div>
      ${ret.items.map((i) => html`<div class="it"><div class="n">${i.product_name}</div><div class="q"><span>${i.qty} pcs</span><span>${m(i.amount)}</span></div></div>`)}
      <div class="rule"></div>
      <div class="ln tot"><span>RETURN VALUE</span><span>${m(ret.total)}</span></div>
      <div class="ln"><span>Refunded</span><span>${m(ret.refund_amount)}</span></div>
      ${sale.customer_id && ret.total - ret.refund_amount > 0 ? html`<div class="ln"><span>Adjusted in account</span><span>${m(ret.total - ret.refund_amount)}</span></div>` : ''}
      ${ret.reason ? html`<div class="ln"><span>Reason</span><span>${ret.reason}</span></div>` : ''}
      <div class="rule"></div><div class="ft">${s.receipt_footer}</div></div>`);
  }

  /* ---------------------------------------------------------------- generic report */

  /**
   * columns: [{label, key, align:'right'|'left', fmt:(v,row)=>string, width}]
   * summary: [{label, value}]
   */
  function report({ title, subtitle, columns, rows, totals, summary = [] }, s, paper = 'a4') {
    const cell = (c, r) => (c.fmt ? c.fmt(r[c.key], r) : r[c.key]);
    const body = html`
      <div class="top"><div><div class="nm">${s.business_name}</div><div class="sm">${s.business_address}</div></div>
        <div class="doc"><div class="t">${String(title).toUpperCase()}</div>${subtitle ? html`<div class="sm">${subtitle}</div>` : ''}<div class="sm">Printed ${Fmt.dateTime(new Date().toISOString())}</div></div></div>
      ${summary.length ? html`<div class="parties" style="flex-wrap:wrap">${summary.map((x) => html`<div><div class="lbl">${x.label}</div><div class="b" style="font-size:12px">${x.value}</div></div>`)}</div>` : html`<div style="height:8px"></div>`}
      <table class="items">
        <thead><tr>${columns.map((c) => html`<th class="${c.align === 'right' ? 'r' : ''}" ${c.width ? raw(`style="width:${c.width}"`) : ''}>${c.label}</th>`)}</tr></thead>
        <tbody>${rows.map((r) => html`<tr>${columns.map((c) => html`<td class="${c.align === 'right' ? 'r nowrap' : ''}">${cell(c, r)}</td>`)}</tr>`)}</tbody>
        ${totals ? html`<tfoot><tr>${columns.map((c, i) => html`<td class="${c.align === 'right' ? 'r nowrap' : ''} b" style="border-top:1.5px solid #111;padding:4px">${i === 0 ? 'Total' : totals[c.key] !== undefined ? (c.fmt ? c.fmt(totals[c.key], totals) : totals[c.key]) : ''}</td>`)}</tr></tfoot>` : ''}
      </table>`;
    return page(title, sheetCss(paper, s.print.margin_mm || 8), body);
  }

  return { receipt, invoice, statement, paymentReceipt, returnNote, report };
})();
