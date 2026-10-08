/* Activity log: every change in the system, with who and when. */
'use strict';

(() => {
  const st = { q: '', entity: '', range: DateRange.make('30d'), page: 1 };
  let root = null;

  const ENTITIES = [['', 'Everything'], ['sale', 'Sales & returns'], ['product', 'Products & stock'], ['customer', 'Customers & payments'], ['expense', 'Expenses'], ['settings', 'Settings'], ['security', 'Security'], ['system', 'System & backups'], ['legacy', 'From v1.2']];
  const COLORS = { sale: 'b-green', product: 'b-blue', customer: 'b-violet', expense: 'b-amber', security: 'b-red', settings: 'b-gray', system: 'b-gray', draft: 'b-gray', legacy: 'b-gray' };

  async function load() {
    let res;
    try { res = await api('activity.list', { q: st.q, entity: st.entity, from: st.range.from, to: st.range.to, page: st.page, pageSize: 30 }); } catch (e) { toast(e.message, 'error'); return; }
    setHTML($('#act-table', root), res.rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th style="width:170px">When</th><th style="width:190px">Action</th><th>Details</th><th style="width:130px">By</th></tr></thead><tbody>
      ${res.rows.map((l) => html`<tr><td class="nowrap">${Fmt.dateTime(l.created_at)}<div class="cell-sub">${Fmt.ago(l.created_at)}</div></td>
        <td><span class="badge ${COLORS[l.entity] || 'b-gray'}">${l.action}</span></td>
        <td style="white-space:normal">${l.details}</td><td class="muted">${l.user}</td></tr>`)}
    </tbody></table></div>${pager(res)}` : emptyState('activity', 'No activity found'));
    App._activityTotal = res.total;
  }

  function render() {
    setHTML(root, html`
      <div class="page-head">
        <div><div class="page-title">Activity Log</div><div class="page-sub">A permanent record of sales, edits, returns, stock changes, payments and settings.</div></div>
        <div class="page-actions">${DateRange.button(st.range)}<button class="btn btn-secondary" data-action="export">${icon('download')} Excel</button></div>
      </div>
      <div class="toolbar">
        <div class="input-wrap search">${icon('search')}<input class="input" placeholder="Search product, invoice, customer…" value="${st.q}" data-on-input="q"></div>
        <select class="select" style="width:210px" data-on-change="entity">${ENTITIES.map(([v, l]) => html`<option value="${v}" ${st.entity === v ? raw('selected') : ''}>${l}</option>`)}</select>
      </div>
      <div class="card" id="act-table"><div class="card-pad"><div class="skeleton"></div></div></div>`);
    load();
  }

  const search = debounce(() => { st.page = 1; load(); }, 200);

  Views.activity = {
    async render(container) {
      root = container;
      st.range = DateRange.fresh(st.range);
      const off = delegate(root, {
        q: (t) => { st.q = t.value; search(); },
        entity: (t) => { st.entity = t.value; st.page = 1; load(); },
        page: (t) => { st.page = Number(t.dataset.page); load(); $('#page').scrollTop = 0; },
        openRange: (t) => DateRange.open(t, st.range, (r) => { st.range = r; st.page = 1; render(); }),
        export: async () => {
          const all = await attempt(() => fetchAll('activity.list', { q: st.q, entity: st.entity, from: st.range.from, to: st.range.to }));
          if (all) exportExcel('Sajawal_Activity_Log', [{ name: 'Activity', rows: all.rows.map((l) => ({ When: Fmt.dateTime(l.created_at), Action: l.action, Details: l.details, By: l.user })) }]);
        }
      });
      render();
      return off;
    }
  };
})();
