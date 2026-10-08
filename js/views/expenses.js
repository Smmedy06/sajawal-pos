/* Expenses: shop running costs (rent, bills, salaries…) used in net profit & cash reports. */
'use strict';

(() => {
  const st = { range: DateRange.make('month'), category: '', q: '', page: 1 };
  let root = null;
  let res = null;

  function expenseForm(onSaved) {
    const cats = App.settings.expense_categories;
    const methods = App.settings.payment_methods;
    const m = modal({
      title: 'Add expense', size: 'narrow',
      body: html`<form class="form-grid" data-on-submit="save">
        <div class="field"><label>Date</label><input class="input" type="date" name="date" value="${Fmt.iso()}" max="${Fmt.iso()}"></div>
        <div class="field"><label>Category</label><select class="select" name="category">${cats.map((c) => html`<option>${c}</option>`)}</select></div>
        <div class="field"><label>Amount *</label><div class="input-affix"><span class="affix">${Fmt.currency}</span><input class="input num" name="amount" inputmode="decimal" autofocus></div></div>
        <div class="field"><label>Paid by</label><select class="select" name="method">${methods.map((x) => html`<option>${x}</option>`)}</select></div>
        <div class="field span-2"><label>Note</label><input class="input" name="note" placeholder="e.g. LESCO bill September"></div>
      </form>`,
      foot: html`<button class="btn btn-secondary" data-action="__close">Cancel</button><button class="btn btn-primary" data-action="save">Save expense</button>`,
      actions: {
        save: async (_t, _e, mm) => {
          const f = formData(mm.root.querySelector('form'));
          if (!(Number(f.amount) > 0)) { mm.root.querySelector('[name=amount]').classList.add('invalid'); return; }
          if (await attempt(() => api('expenses.add', { ...f, amount: Number(f.amount) }), { success: 'Expense saved' })) { mm.close(); onSaved(); }
        }
      }
    });
    return m;
  }

  async function load() {
    try { res = await api('expenses.list', { from: st.range.from, to: st.range.to, category: st.category, q: st.q, page: st.page, pageSize: 30 }); } catch (e) { toast(e.message, 'error'); return; }
    setHTML($('#exp-strip', root), html`<div class="strip-item"><div class="strip-label">Total expenses</div><div class="strip-value">${Fmt.money(res.sum)}</div></div>
      ${res.by_category.slice(0, 4).map((c) => html`<div class="strip-item"><div class="strip-label">${c.category}</div><div class="strip-value">${Fmt.money(c.amount)}</div></div>`)}`);
    setHTML($('#exp-table', root), res.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Paid by</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${res.rows.map((e) => html`<tr><td class="nowrap">${Fmt.date(e.date)}</td><td><span class="badge b-gray">${e.category}</span></td><td>${e.note || html`<span class="faint">—</span>`}<div class="cell-sub">by ${e.cashier}</div></td>
        <td>${e.method}</td><td class="num strong">${Fmt.money(e.amount)}</td>
        <td class="actions"><button class="btn btn-danger-ghost btn-sm btn-icon" data-action="del" data-id="${e.id}" title="Delete">${icon('trash', 'i-sm')}</button></td></tr>`)}
    </tbody></table></div>${pager(res)}` : emptyState('expenses', 'No expenses in this period', 'Record rent, electricity, salaries and other costs to see true net profit.', html`<button class="btn btn-primary" data-action="add">${icon('plus')} Add expense</button>`));
  }

  function render() {
    setHTML(root, html`
      <div class="page-head">
        <div><div class="page-title">Expenses</div><div class="page-sub">Running costs of the shop. They reduce net profit and cash in the drawer.</div></div>
        <div class="page-actions">${DateRange.button(st.range)}<button class="btn btn-secondary" data-action="export">${icon('download')} Excel</button><button class="btn btn-primary" data-action="add">${icon('plus')} Add expense</button></div>
      </div>
      <div class="strip" id="exp-strip"></div>
      <div class="toolbar">
        <div class="input-wrap search">${icon('search')}<input class="input" placeholder="Search notes…" value="${st.q}" data-on-input="q"></div>
        <select class="select" style="width:190px" data-on-change="cat"><option value="">All categories</option>${App.settings.expense_categories.map((c) => html`<option ${st.category === c ? raw('selected') : ''}>${c}</option>`)}</select>
      </div>
      <div class="card" id="exp-table"><div class="card-pad"><div class="skeleton"></div></div></div>`);
    load();
  }

  const search = debounce(() => { st.page = 1; load(); }, 200);

  Views.expenses = {
    async render(container) {
      root = container;
      st.range = DateRange.fresh(st.range);
      const off = delegate(root, {
        add: () => expenseForm(load),
        q: (t) => { st.q = t.value; search(); },
        cat: (t) => { st.category = t.value; st.page = 1; load(); },
        page: (t) => { st.page = Number(t.dataset.page); load(); },
        openRange: (t) => DateRange.open(t, st.range, (r) => { st.range = r; st.page = 1; render(); }),
        del: async (t) => {
          const e = res.rows.find((x) => String(x.id) === t.dataset.id);
          if (!(await confirmDialog({ title: 'Delete expense?', message: `${e.category} · ${Fmt.money(e.amount)} on ${Fmt.date(e.date)}. This is recorded in the activity log.`, confirm: 'Delete', danger: true }))) return;
          if (await attempt(() => api('expenses.void', { id: e.id }), { success: 'Expense deleted' })) load();
        },
        export: async () => {
          const all = await attempt(() => fetchAll('expenses.list', { from: st.range.from, to: st.range.to, category: st.category, q: st.q }));
          if (all) exportExcel('Sajawal_Expenses', [{ name: 'Expenses', rows: all.rows.map((e) => ({ Date: e.date, Category: e.category, Note: e.note, 'Paid by': e.method, Amount: e.amount, 'Entered by': e.cashier })) }]);
        }
      });
      render();
      return off;
    }
  };
})();
