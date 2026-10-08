/* Dashboard: KPIs for any date range, sales & profit trend, attention lists. */
'use strict';

(() => {
  const LS = 'sajawal.dash.range';
  let range = (() => { try { return DateRange.fresh(JSON.parse(localStorage.getItem(LS))) || DateRange.make('today'); } catch (_) { return DateRange.make('today'); } })();
  let chart = null;
  let root = null;

  function delta(cur, prev) {
    if (cur === null || prev === null || prev === undefined) return '';
    if (!prev) return cur ? html`<span class="delta up">new</span>` : '';
    const d = ((cur - prev) / Math.abs(prev)) * 100;
    if (Math.abs(d) < 0.5) return html`<span class="delta">±0%</span>`;
    return html`<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</span>`;
  }

  function kpi(label, value, foot, opts = {}) {
    return html`<div class="kpi ${opts.cls || ''} ${opts.action ? 'clickable' : ''}" ${opts.action ? raw(`data-action="${opts.action}"`) : ''}>
      <div class="kpi-label">${opts.icon ? icon(opts.icon, 'i-sm') : ''}${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-foot">${foot}</div></div>`;
  }

  function labelFor(key, g) {
    if (g === 'hour') { const h = Number(key); return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`; }
    if (g === 'month') { const [y, mm] = key.split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); }
    return new Date(`${key}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  async function load() {
    const d = await api('reports.dashboard', { from: range.from, to: range.to });
    const t = d.totals;
    const p = d.previous.totals;
    const hid = d.profit_hidden;
    setHTML(root, html`
      <div class="page-head">
        <div><div class="page-title">Dashboard</div><div class="page-sub">${App.settings.business_name} · ${DateRange.span({ from: d.from, to: d.to })}</div></div>
        <div class="page-actions">${DateRange.button(range)}<button class="btn btn-secondary btn-icon" data-action="reload" title="Refresh">${icon('refresh')}</button></div>
      </div>
      <div class="kpis">
        ${kpi('Net sales', Fmt.money(t.net_sales), html`${delta(t.net_sales, p.net_sales)} <span>vs previous period</span>`, { icon: 'trendUp' })}
        ${kpi('Gross profit', hid ? '••••' : Fmt.money(t.gross_profit), hid ? 'Locked — owner PIN needed' : html`${Fmt.pct(t.margin)} margin ${delta(t.gross_profit, p.gross_profit)}`, { icon: 'coins' })}
        ${kpi('Invoices', Fmt.num(t.invoices), html`Avg bill ${Fmt.money(t.avg_bill)} · ${Fmt.num(t.items_sold)} items`, { icon: 'receipt' })}
        ${kpi('Money received', Fmt.money(t.money_received), html`incl. ${Fmt.money(t.udhaar_received)} udhaar recovered`, { icon: 'cash' })}
        ${kpi('Udhaar outstanding', Fmt.money(d.receivable), html`${Fmt.plural(d.debtors, 'customer')} · ${Fmt.money(t.udhaar_given)} given in period`, { icon: 'handCoins', cls: d.receivable > 0 ? 'is-alert' : '', action: 'goDebtors' })}
        ${kpi('Expenses', Fmt.money(t.expenses), hid ? '' : html`Net profit <b class="${t.net_profit < 0 ? 'neg' : ''}">${Fmt.money(t.net_profit)}</b>`, { icon: 'expenses' })}
      </div>

      <div class="grid grid-main mb-16">
        <div class="card">
          <div class="card-head"><div><div class="card-title">Sales${hid ? '' : ' & profit'}</div><div class="card-sub">${d.granularity === 'hour' ? 'By hour' : d.granularity === 'day' ? 'By day' : 'By month'} · returns deducted</div></div>
            <div class="row small muted"><span class="row gap-4"><span style="width:10px;height:10px;border-radius:2px;background:#3f3f46;display:inline-block"></span>Net sales</span>${hid ? '' : html`<span class="row gap-4"><span style="width:14px;height:3px;background:#65a30d;display:inline-block"></span>Gross profit</span>`}</div></div>
          <div class="card-body"><div class="chart-box"><canvas id="dash-chart"></canvas></div></div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><div class="card-title">Money received by method</div></div>
            <div class="card-body">${d.payment_methods.length ? html`<div class="bar-list">${d.payment_methods.map((x) => {
              const max = d.payment_methods[0].amount || 1;
              return html`<div class="bar-row"><div class="bar-top"><span>${x.method}</span><span class="num strong">${Fmt.money(x.amount)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (x.amount / max) * 100)}%"></div></div></div>`;
            })}</div>` : html`<div class="muted small">No money received in this period.</div>`}
            ${t.refunds ? html`<div class="small muted mt-12">Refunds paid out: <b>${Fmt.money(t.refunds)}</b></div>` : ''}</div>
          </div>
          <div class="card">
            <div class="card-head"><div class="card-title">Inventory</div><button class="btn btn-ghost btn-sm" data-action="goInventory">Open ${icon('arrowRight', 'i-sm')}</button></div>
            <div class="card-body"><dl class="kv">
              <dt>Products</dt><dd>${Fmt.num(d.inventory.products)}</dd>
              <dt>Units in stock</dt><dd>${Fmt.num(d.inventory.units)}</dd>
              <dt>Stock value (cost)</dt><dd>${hid ? '••••' : Fmt.money(d.inventory.cost_value)}</dd>
              <dt>Stock value (selling)</dt><dd>${Fmt.money(d.inventory.retail_value)}</dd>
              <dt>Low / out of stock</dt><dd><span style="color:var(--amber)">${d.inventory.low_stock}</span> / <span class="neg">${d.inventory.out_of_stock}</span></dd>
            </dl></div>
          </div>
        </div>
      </div>

      <div class="grid grid-3">
        <div class="card">
          <div class="card-head"><div class="card-title">Best sellers</div><span class="card-sub">by quantity</span></div>
          ${d.top_products.length ? html`<div class="table-wrap"><table class="table table-compact"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Sales</th></tr></thead><tbody>
            ${d.top_products.map((x) => html`<tr class="clickable" data-action="openProduct" data-id="${x.id}"><td><div class="cell-title ellipsis" style="max-width:220px">${x.name}</div></td><td class="num">${x.qty}</td><td class="num">${Fmt.money(x.revenue)}</td></tr>`)}
          </tbody></table></div>` : emptyState('bag', 'No sales in this period')}
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Needs attention</div><span class="card-sub">${d.low_stock_count} stock · ${d.expiring_count} expiry</span></div>
          ${d.low_stock.length || d.expiring.length ? html`<div class="table-wrap"><table class="table table-compact"><tbody>
            ${d.low_stock.map((x) => html`<tr class="clickable" data-action="openProduct" data-id="${x.id}"><td><div class="cell-title ellipsis" style="max-width:200px">${x.name}</div><div class="cell-sub">Reorder level ${x.low_level}</div></td><td class="num">${statusBadge(x.stock_status)}<div class="cell-sub">${x.stock_qty} left</div></td></tr>`)}
            ${d.expiring.map((x) => html`<tr class="clickable" data-action="openProduct" data-id="${x.id}"><td><div class="cell-title ellipsis" style="max-width:200px">${x.name}</div><div class="cell-sub">${x.stock_qty} in stock</div></td><td class="num"><span class="badge b-red">Expires ${Fmt.date(x.expiry_date)}</span></td></tr>`)}
          </tbody></table></div>` : emptyState('checkCircle', 'All good', 'No low stock or expiring products.')}
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Recent sales</div><button class="btn btn-ghost btn-sm" data-action="goSales">All ${icon('arrowRight', 'i-sm')}</button></div>
          ${d.recent_sales.length ? html`<div class="table-wrap"><table class="table table-compact"><tbody>
            ${d.recent_sales.map((s) => html`<tr class="clickable" data-action="openSale" data-id="${s.id}"><td><div class="cell-title">${s.invoice_no}</div><div class="cell-sub">${Fmt.ago(s.created_at)} · ${s.customer_name}</div></td>
              <td class="num"><div class="strong">${Fmt.money(s.net_total)}</div>${s.payment_status !== 'paid' ? statusBadge(s.payment_status) : s.status !== 'completed' ? statusBadge(s.status) : ''}</td></tr>`)}
          </tbody></table></div>` : emptyState('receipt', 'No sales yet')}
        </div>
      </div>
      ${d.top_debtors.length ? html`<div class="card mt-16">
        <div class="card-head"><div class="card-title">Highest udhaar</div><button class="btn btn-ghost btn-sm" data-action="goDebtors">All customers ${icon('arrowRight', 'i-sm')}</button></div>
        <div class="table-wrap"><table class="table table-compact"><tbody>${d.top_debtors.map((c) => html`<tr class="clickable" data-action="openCustomer" data-id="${c.id}">
          <td><div class="cell-title">${c.name}</div><div class="cell-sub">${c.phone || 'No phone'}</div></td><td class="num neg strong">${Fmt.money(c.balance)}</td></tr>`)}</tbody></table></div></div>` : ''}
    `);
    drawChart(d, hid);
  }

  function drawChart(d, hid) {
    if (chart) { chart.destroy(); chart = null; }
    const cv = $('#dash-chart', root);
    if (!cv || !window.Chart) return;
    const labels = d.series.map((s) => labelFor(s.key, d.granularity));
    const datasets = [{
      type: 'bar', label: 'Net sales', data: d.series.map((s) => s.net_sales), backgroundColor: '#3f3f46', borderRadius: 4, maxBarThickness: 34, order: 2
    }];
    if (!hid) datasets.push({ type: 'line', label: 'Gross profit', data: d.series.map((s) => s.gross_profit), borderColor: '#65a30d', backgroundColor: '#65a30d', pointRadius: d.series.length > 40 ? 0 : 3, tension: 0.3, borderWidth: 2, order: 1 });
    chart = new Chart(cv, {
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${Fmt.money(c.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#71717a', maxRotation: 0, autoSkipPadding: 10, font: { family: 'Inter', size: 11 } } },
          y: { beginAtZero: true, grid: { color: '#ececE6' }, border: { display: false }, ticks: { color: '#71717a', font: { family: 'Inter', size: 11 }, callback: (v) => (Math.abs(v) >= 1000 ? `${v / 1000}k` : v) } }
        }
      }
    });
  }

  Views.dashboard = {
    async render(container) {
      root = container;
      range = DateRange.fresh(range);
      setHTML(root, html`<div class="kpis">${[1, 2, 3, 4, 5, 6].map(() => html`<div class="kpi"><div class="skeleton" style="width:50%"></div><div class="skeleton mt-8" style="height:22px;width:70%"></div></div>`)}</div>`);
      const off = delegate(root, {
        openRange: (t) => DateRange.open(t, range, (r) => { range = r; try { localStorage.setItem(LS, JSON.stringify(r)); } catch (_) { /* ignore */ } load(); }),
        reload: () => load(),
        goDebtors: () => App.go('customers', { filter: 'due' }),
        goInventory: () => App.go('inventory'),
        goSales: () => App.go('sales'),
        openSale: (t) => openInvoice(Number(t.dataset.id)),
        openProduct: (t) => openProduct(Number(t.dataset.id)),
        openCustomer: (t) => App.go('customers', { id: Number(t.dataset.id) })
      });
      await load();
      return () => { off(); if (chart) { chart.destroy(); chart = null; } };
    }
  };
})();
