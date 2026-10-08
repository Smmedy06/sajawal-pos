/* Sell (POS billing) screen. */
'use strict';

(() => {
  const P = (r) => Math.round(Number(r || 0) * 100); // rupees -> paisa (client-side display maths)
  const R = (p) => p / 100;
  const LS_KEY = 'sajawal.sell.prefs';
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch (_) { /* ignore */ } };

  // State survives page switches (search text, cart, customer) — issue #16.
  const S = {
    products: [],
    byId: new Map(),
    query: '',
    category: '',
    kb: 0,
    cart: [],          // { product_id, name, sku, std_price, unit_price|null, qty }
    customer: null,    // { id, name, phone, balance }
    discountType: 'flat',
    discountValue: '',
    editing: null,     // { id, invoice_no, origQty: {pid: qty}, paid, total, customer_id }
    draftId: null,
    cartFilter: '',
    note: ''
  };
  let root = null;
  let shown = [];

  /* ---------------------------------------------------------------- maths */

  const unitOf = (l) => (l.unit_price === null || l.unit_price === undefined || l.unit_price === '' ? l.std_price : Number(l.unit_price));
  function totals() {
    let sub = 0;
    let qty = 0;
    for (const l of S.cart) { sub += P(unitOf(l)) * l.qty; qty += l.qty; }
    const v = Number(S.discountValue) || 0;
    let disc = S.discountType === 'percent' ? Math.round((sub * Math.min(100, Math.max(0, v))) / 100 / 100) * 100 : Math.min(sub, Math.max(0, P(v)));
    return { subtotal: R(sub), discount: R(disc), total: R(sub - disc), qty, lines: S.cart.length, invalidDiscount: v < 0 || (S.discountType === 'percent' ? v > 100 : P(v) > sub) };
  }
  function available(pid) {
    const p = S.byId.get(pid);
    const base = p ? p.stock_qty : 0;
    const orig = S.editing ? S.editing.origQty[pid] || 0 : 0;
    return base + orig;
  }
  const allowNegative = () => !!App.settings.allow_negative_stock;

  /* ---------------------------------------------------------------- data */

  async function loadProducts() {
    S.products = await api('products.forSale');
    S.byId = new Map(S.products.map((p) => [p.id, p]));
    for (const l of S.cart) {
      const p = S.byId.get(l.product_id);
      if (p) { l.std_price = p.price; l.name = p.name; }
    }
  }

  function matches(p, terms) {
    if (S.category && p.category !== S.category) return false;
    if (!terms.length) return true;
    const hay = `${p.name} ${p.sku} ${p.brand} ${p.category}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  }

  /* ---------------------------------------------------------------- render */

  function render(container) {
    root = container;
    container.className = 'page flush';
    const privacy = !!prefs.privacy;
    setHTML(container, html`
      <div class="sell ${privacy ? 'privacy' : ''}" id="sell">
        <section class="sell-left">
          <div class="sell-top">
            <div class="input-wrap sell-search">
              ${icon('search')}
              <input class="input" id="sell-q" placeholder="Search by name, brand or scan barcode…   (F2)" autocomplete="off" spellcheck="false"
                     value="${S.query}" data-on-input="q" data-on-keydown="qKey">
              <button class="clear-btn ${S.query ? '' : 'hidden'}" data-action="clearQ" title="Clear (Esc)">${icon('x', 'i-sm')}</button>
            </div>
            <button class="btn btn-secondary btn-icon" data-action="privacy" title="Hide prices from customers (F9)" id="privacy-btn">${icon(privacy ? 'eyeOff' : 'eye')}</button>
          </div>
          <div class="sell-cats" id="cats"></div>
          <div class="tiles" id="tiles"></div>
        </section>
        <aside class="cart" id="cart">
          <div class="cart-head" id="cart-head"></div>
          <div class="cart-lines" id="cart-lines"></div>
          <div class="cart-foot" id="cart-foot"></div>
        </aside>
      </div>`);
    renderCats();
    renderTiles();
    renderCartHead();
    renderLines();
    renderFoot();
    const off = delegate(container, handlers);
    setTimeout(() => focusSearch(false), 30);
    return off;
  }

  function renderCats() {
    const counts = new Map();
    for (const p of S.products) if (p.category) counts.set(p.category, (counts.get(p.category) || 0) + 1);
    const cats = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const box = $('#cats', root);
    if (!cats.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    setHTML(box, html`<button class="chip ${S.category ? '' : 'on'}" data-action="cat" data-c="">All <span class="count">${S.products.length}</span></button>
      ${cats.map(([c, n]) => html`<button class="chip ${S.category === c ? 'on' : ''}" data-action="cat" data-c="${c}">${c} <span class="count">${n}</span></button>`)}`);
  }

  function renderTiles() {
    const box = $('#tiles', root);
    if (!box) return;
    const terms = S.query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = S.products.filter((p) => matches(p, terms));
    // Exact barcode/name matches first, then in-stock before out-of-stock.
    const q = S.query.trim().toLowerCase();
    all.sort((a, b) => (b.sku && b.sku.toLowerCase() === q) - (a.sku && a.sku.toLowerCase() === q) || (a.stock_qty <= 0) - (b.stock_qty <= 0));
    shown = all.slice(0, 240);
    if (S.kb >= shown.length) S.kb = Math.max(0, shown.length - 1);
    const hidePrice = App.settings.privacy.hide_tile_prices;
    const inCart = new Map(S.cart.map((l) => [l.product_id, l.qty]));
    if (!S.products.length) {
      setHTML(box, html`<div style="grid-column:1/-1">${emptyState('products', 'No products yet', 'Add products in the Products page or import them from Excel.', html`<button class="btn btn-primary" data-action="goProducts">${icon('plus')} Add products</button>`)}</div>`);
      return;
    }
    if (!shown.length) {
      setHTML(box, html`<div style="grid-column:1/-1">${emptyState('search', `No product matches “${S.query}”`, 'Check the spelling, or search by barcode or brand.')}</div>`);
      return;
    }
    setHTML(box, html`${shown.map((p, i) => {
      const out = p.stock_qty <= 0;
      const low = p.stock_status === 'low';
      const n = inCart.get(p.id);
      return html`<button class="tile ${out ? 'out' : ''} ${i === S.kb && terms.length ? 'kb' : ''}" data-action="add" data-id="${p.id}" title="${p.name}${p.sku ? ' · ' + p.sku : ''}">
        ${n ? html`<span class="tile-incart">${n}</span>` : ''}
        <div><div class="tile-name">${p.name}</div><div class="tile-meta">${[p.brand, p.category].filter(Boolean).join(' · ') || p.sku || ' '}</div></div>
        <div class="tile-foot">
          <span class="${out ? 'neg' : low ? '' : 'muted'}" style="${low ? 'color:var(--amber)' : ''}">${out ? 'Out of stock' : `${p.stock_qty} in stock`}</span>
          ${hidePrice ? '' : html`<span class="tile-price amt">${Fmt.money(p.price)}</span>`}
        </div>
      </button>`;
    })}${all.length > shown.length ? html`<div class="small muted" style="grid-column:1/-1;padding:8px">Showing ${shown.length} of ${all.length}. Type more to narrow the list.</div>` : ''}`);
  }

  function renderCartHead() {
    const head = $('#cart-head', root);
    const c = S.customer;
    const t = totals();
    setHTML(head, html`
      ${S.editing ? html`<div class="edit-banner"><span>${icon('edit', 'i-sm')} Editing <b>${S.editing.invoice_no}</b></span><button class="btn btn-sm btn-ghost" data-action="cancelEdit">Cancel edit</button></div>` : ''}
      <button class="cust-btn" data-action="customer" id="cust-btn" title="Choose customer (F4)">
        <div class="avatar">${c ? Fmt.initials(c.name) : icon('user', 'i-sm')}</div>
        <div class="grow">
          <div class="cust-name ellipsis">${c ? c.name : 'Walk-in customer'}</div>
          <div class="cust-sub">${c ? html`${c.phone || 'No phone'}${c.balance ? html` · <span class="${c.balance > 0 ? 'neg' : 'pos'} strong amt">${c.balance > 0 ? 'Udhaar' : 'Advance'} ${Fmt.money(Math.abs(c.balance))}</span>` : ' · No dues'}` : 'Click to select a customer for udhaar (F4)'}</div>
        </div>
        ${c ? html`<span class="btn btn-ghost btn-sm btn-icon" data-action="clearCustomer" title="Back to walk-in">${icon('x', 'i-sm')}</span>` : icon('down', 'i-sm')}
      </button>
      <div class="cart-tools">
        <div class="input-wrap ${S.cart.length > 3 || S.cartFilter ? '' : 'hidden'}" id="cart-filter-wrap">
          ${icon('search', 'i-sm')}
          <input class="input" id="cart-filter" placeholder="Find in cart (F6)" value="${S.cartFilter}" data-on-input="cartFilter">
        </div>
        <span class="small muted grow ${S.cart.length > 3 || S.cartFilter ? 'hidden' : ''}" style="padding-left:2px">${S.cart.length ? `${t.qty} item${t.qty === 1 ? '' : 's'} · ${t.lines} line${t.lines === 1 ? '' : 's'}` : 'Current sale'}</span>
        <button class="btn btn-ghost btn-sm" data-action="park" ${S.cart.length && !S.editing ? '' : raw('disabled')} title="Park sale (F8)">${icon('bookmark', 'i-sm')} Park</button>
        <button class="btn btn-ghost btn-sm" data-action="drafts" title="Parked sales">${icon('drafts', 'i-sm')} <span id="draft-count">Drafts</span></button>
        <button class="btn btn-ghost btn-sm btn-icon" data-action="clearCart" ${S.cart.length ? '' : raw('disabled')} title="Clear cart">${icon('trash', 'i-sm')}</button>
      </div>`);
    updateDraftCount();
  }

  async function updateDraftCount() {
    try {
      const d = await api('drafts.list');
      const elx = $('#draft-count', root);
      if (elx) elx.textContent = d.length ? `Drafts (${d.length})` : 'Drafts';
    } catch (_) { /* ignore */ }
  }

  function lineHtml(l) {
    const unit = unitOf(l);
    const custom = l.unit_price !== null && l.unit_price !== undefined && l.unit_price !== '' && Number(l.unit_price) !== l.std_price;
    const p = S.byId.get(l.product_id);
    const avail = available(l.product_id);
    const notes = [];
    if (!allowNegative() && l.qty > avail) notes.push(`Only ${avail} available`);
    if (p && unit < p.cost_price) notes.push('Price is below cost');
    return html`<div class="line" data-pid="${l.product_id}">
      <div class="line-name" title="${l.name}">${l.name}</div>
      <div class="line-total amt" data-role="total">${Fmt.money(R(P(unit) * l.qty))}</div>
      <div class="line-controls">
        <div class="qty">
          <button data-action="dec" title="Less">${icon('minus', 'i-sm')}</button>
          <input data-role="qty" inputmode="numeric" value="${l.qty}" data-on-input="qtyInput" data-on-change="qtyChange" data-on-keydown="lineKey" aria-label="Quantity">
          <button data-action="inc" title="More">${icon('plus', 'i-sm')}</button>
        </div>
        <span class="small muted">×</span>
        <input class="input num price-in amt ${custom ? 'custom' : ''}" data-role="price" value="${unit}" inputmode="decimal"
               data-on-input="priceInput" data-on-change="priceChange" data-on-keydown="lineKey" title="Unit price — type to give a special price" aria-label="Unit price">
        <button class="btn btn-ghost btn-sm btn-icon ${custom ? '' : 'hidden'}" data-action="resetPrice" data-role="reset" title="Back to list price ${Fmt.money(l.std_price)}">${icon('refresh', 'i-sm')}</button>
        <button class="line-x" data-action="remove" title="Remove">${icon('x', 'i-sm')}</button>
      </div>
      <div class="line-note ${notes.length ? '' : 'hidden'}" data-role="note">${notes.join(' · ')}</div>
    </div>`;
  }

  function renderLines() {
    const box = $('#cart-lines', root);
    const scroll = box.scrollTop;
    if (!S.cart.length) {
      setHTML(box, html`<div class="cart-empty">${icon('bag', 'i-xl')}<div class="strong mt-8" style="color:var(--ink-2)">Cart is empty</div><div class="small mt-4">Click a product or scan a barcode to add it.</div></div>`);
      return;
    }
    setHTML(box, S.cart.map(lineHtml));
    box.scrollTop = scroll; // never jump back to the top (issue #3)
    applyCartFilter();
  }

  /** Update one line in place — keeps focus and scroll position. */
  function updateLine(pid, { replaceInputs = false } = {}) {
    const l = S.cart.find((x) => x.product_id === pid);
    const elx = $(`.line[data-pid="${pid}"]`, root);
    if (!l || !elx) return;
    const unit = unitOf(l);
    elx.querySelector('[data-role=total]').textContent = Fmt.money(R(P(unit) * l.qty));
    const custom = l.unit_price !== null && l.unit_price !== undefined && l.unit_price !== '' && Number(l.unit_price) !== l.std_price;
    elx.querySelector('[data-role=price]').classList.toggle('custom', custom);
    elx.querySelector('[data-role=reset]').classList.toggle('hidden', !custom);
    if (replaceInputs) {
      elx.querySelector('[data-role=qty]').value = l.qty;
      elx.querySelector('[data-role=price]').value = unit;
    }
    const p = S.byId.get(pid);
    const avail = available(pid);
    const notes = [];
    if (!allowNegative() && l.qty > avail) notes.push(`Only ${avail} available`);
    if (p && unit < p.cost_price) notes.push('Price is below cost');
    const n = elx.querySelector('[data-role=note]');
    n.textContent = notes.join(' · ');
    n.classList.toggle('hidden', !notes.length);
  }

  function flashLine(pid) {
    const elx = $(`.line[data-pid="${pid}"]`, root);
    if (!elx) return;
    elx.scrollIntoView({ block: 'nearest' });
    elx.classList.remove('flash');
    void elx.offsetWidth;
    elx.classList.add('flash');
  }

  function applyCartFilter() {
    const q = S.cartFilter.trim().toLowerCase();
    $$('.line', root).forEach((elx) => {
      const l = S.cart.find((x) => String(x.product_id) === elx.dataset.pid);
      elx.style.display = !q || (l && `${l.name} ${l.sku}`.toLowerCase().includes(q)) ? '' : 'none';
    });
  }

  function renderFoot() {
    const t = totals();
    const foot = $('#cart-foot', root);
    setHTML(foot, html`
      <div class="line-sum"><span class="muted">Subtotal</span><span class="amt" id="t-sub">${Fmt.money(t.subtotal)}</span></div>
      <div class="line-sum">
        <span class="muted">Discount</span>
        <div class="row gap-4">
          <div class="seg" style="padding:1px"><button class="${S.discountType === 'flat' ? 'on' : ''}" data-action="discType" data-t="flat" style="height:26px">${Fmt.currency}</button><button class="${S.discountType === 'percent' ? 'on' : ''}" data-action="discType" data-t="percent" style="height:26px">%</button></div>
          <input class="input num disc-in" id="disc" placeholder="0" value="${S.discountValue}" inputmode="decimal" data-on-input="disc" title="Discount (F7)">
        </div>
      </div>
      <div class="line-sum ${t.discount ? '' : 'hidden'}" id="t-disc-row"><span class="muted">Discount amount</span><span class="amt" id="t-disc">−${Fmt.money(t.discount)}</span></div>
      <div class="small neg ${t.invalidDiscount ? '' : 'hidden'}" id="disc-err">Discount is more than the bill</div>
      <div class="cart-total"><span class="lbl">Total</span><span class="val amt" id="t-total">${Fmt.money(t.total)}</span></div>
      <button class="btn btn-accent btn-xl btn-block" data-action="charge" id="charge-btn" ${S.cart.length ? '' : raw('disabled')}>
        ${S.editing ? 'Save changes' : 'Charge'} <span class="amt" id="t-charge">${Fmt.money(t.total)}</span><span class="kbd-hint">F12</span>
      </button>`);
  }

  function updateTotals() {
    const t = totals();
    const set = (id, v) => { const e = $(`#${id}`, root); if (e) e.textContent = v; };
    set('t-sub', Fmt.money(t.subtotal));
    set('t-disc', `−${Fmt.money(t.discount)}`);
    set('t-total', Fmt.money(t.total));
    set('t-charge', Fmt.money(t.total));
    const dr = $('#t-disc-row', root); if (dr) dr.classList.toggle('hidden', !t.discount);
    const de = $('#disc-err', root); if (de) de.classList.toggle('hidden', !t.invalidDiscount);
    const cb = $('#charge-btn', root); if (cb) cb.disabled = !S.cart.length;
  }

  function refreshCart() {
    renderCartHead();
    renderLines();
    renderFoot();
  }

  /* ---------------------------------------------------------------- cart actions */

  function addProduct(id, qty = 1) {
    const p = S.byId.get(Number(id));
    if (!p) return;
    const existing = S.cart.find((l) => l.product_id === p.id);
    const want = (existing ? existing.qty : 0) + qty;
    if (!allowNegative() && want > available(p.id)) {
      toast(available(p.id) <= 0 ? `"${p.name}" is out of stock` : `Only ${available(p.id)} of "${p.name}" in stock`, 'error');
      return;
    }
    if (existing) {
      existing.qty = want;
      updateLine(p.id, { replaceInputs: true });
      updateTotals();
      updateTileBadge(p.id);
      const ch = $('#cart-head', root); if (ch && S.cart.length <= 4) renderCartHead();
      flashLine(p.id);
    } else {
      S.cart.push({ product_id: p.id, name: p.name, sku: p.sku, std_price: p.price, unit_price: null, qty });
      renderCartHead();
      const box = $('#cart-lines', root);
      if (S.cart.length === 1) renderLines(); else { box.appendChild(el(lineHtml(S.cart[S.cart.length - 1]))); applyCartFilter(); }
      updateTotals();
      updateTileBadge(p.id);
      box.scrollTop = box.scrollHeight;
      flashLine(p.id);
    }
  }

  function updateTileBadge(pid) {
    const tile = $(`.tile[data-id="${pid}"]`, root);
    if (!tile) return;
    const l = S.cart.find((x) => x.product_id === pid);
    let b = tile.querySelector('.tile-incart');
    if (!l) { if (b) b.remove(); return; }
    if (!b) { b = el(html`<span class="tile-incart"></span>`); tile.prepend(b); }
    b.textContent = l.qty;
  }

  function setQty(pid, qty, { fromInput = false } = {}) {
    const l = S.cart.find((x) => x.product_id === pid);
    if (!l) return;
    if (qty <= 0) { removeLine(pid); return; }
    const avail = available(pid);
    if (!allowNegative() && qty > avail) {
      toast(`Only ${avail} of "${l.name}" in stock`, 'error');
      qty = Math.max(1, avail);
      l.qty = qty;
      updateLine(pid, { replaceInputs: true });
    } else {
      l.qty = qty;
      updateLine(pid, { replaceInputs: !fromInput });
    }
    updateTotals();
    updateTileBadge(pid);
  }

  function removeLine(pid) {
    S.cart = S.cart.filter((l) => l.product_id !== pid);
    const elx = $(`.line[data-pid="${pid}"]`, root);
    if (elx && S.cart.length) elx.remove(); else renderLines();
    renderCartHead();
    updateTotals();
    updateTileBadge(pid);
    if (!S.cart.length) renderFoot();
  }

  function resetSale() {
    S.cart = [];
    S.customer = null;
    S.discountType = 'flat';
    S.discountValue = '';
    S.editing = null;
    S.draftId = null;
    S.cartFilter = '';
    S.note = '';
  }

  /* ---------------------------------------------------------------- customer picker */

  function openCustomerPicker(anchor) {
    const content = html`<div style="padding:10px">
      <div class="input-wrap">${icon('search')}<input class="input" id="cp-q" placeholder="Name or phone…" autocomplete="off"></div>
      <div class="suggest mt-8" id="cp-list"></div>
      <div class="divider"></div>
      <div id="cp-new">
        <button class="btn btn-secondary btn-sm btn-block" data-action="showNew">${icon('userPlus', 'i-sm')} New customer</button>
      </div>
    </div>`;
    let results = [];
    let active = 0;
    const pop = popover(anchor, content, {
      width: 400,
      actions: {
        pick: (t, _e, p) => { const c = t.dataset.walkin ? null : results.find((x) => String(x.id) === t.dataset.id); p.close(); selectCustomer(c); },
        showNew: (_t, _e, p) => {
          const q = p.root.querySelector('#cp-q').value.trim();
          const isPhone = /^[+\d][\d\s-]{5,}$/.test(q);
          setHTML(p.root.querySelector('#cp-new'), html`<form class="stack" data-on-submit="create" style="gap:8px">
            <div class="form-grid"><div class="field"><label>Name *</label><input class="input" name="name" value="${isPhone ? '' : q}" required></div>
            <div class="field"><label>Phone</label><input class="input" name="phone" value="${isPhone ? q : ''}" placeholder="03xx-xxxxxxx"></div></div>
            <button class="btn btn-primary btn-sm" type="submit">${icon('check', 'i-sm')} Save & select</button></form>`);
          p.root.querySelector(isPhone || !q ? '[name=name]' : '[name=phone]').focus();
        },
        create: async (_t, e, p) => {
          if (e) e.preventDefault();
          const f = formData(p.root.querySelector('#cp-new form'));
          const c = await attempt(() => api('customers.create', f));
          if (c) { p.close(); selectCustomer(c); toast(`Customer "${c.name}" added`, 'success'); }
        }
      }
    });
    // #cp-new form submit is inside the popover; delegate catches data-on-submit
    const list = pop.root.querySelector('#cp-list');
    const draw = () => {
      setHTML(list, html`
        <div class="suggest-item ${active === -1 ? 'active' : ''}" data-action="pick" data-walkin="1"><div class="avatar" style="background:var(--surface-3);color:var(--ink-2)">${icon('user', 'i-sm')}</div><div class="grow"><div class="strong">Walk-in customer</div><div class="small muted">Cash sale, no account</div></div></div>
        ${results.map((c, i) => html`<div class="suggest-item ${i === active ? 'active' : ''}" data-action="pick" data-id="${c.id}">
          <div class="avatar" style="background:var(--surface-3);color:var(--ink-2)">${Fmt.initials(c.name)}</div>
          <div class="grow"><div class="strong ellipsis">${c.name}</div><div class="small muted">${c.phone || 'No phone'}</div></div>
          ${c.balance ? html`<span class="badge ${c.balance > 0 ? 'b-red' : 'b-green'}">${c.balance > 0 ? 'Udhaar' : 'Advance'} ${Fmt.money(Math.abs(c.balance))}</span>` : html`<span class="badge b-gray">Clear</span>`}
        </div>`)}
        ${!results.length && pop.root.querySelector('#cp-q').value ? html`<div class="small muted" style="padding:8px">No customer found. Add a new one below.</div>` : ''}`);
    };
    const search = debounce(async (q) => {
      try { results = await api('customers.search', { q, limit: 12 }); } catch (_) { results = []; }
      active = results.length ? 0 : -1;
      draw();
    }, 120); // debounced + indexed search — no typing lag (issue #18)
    const qIn = pop.root.querySelector('#cp-q');
    qIn.addEventListener('input', () => search(qIn.value.trim()));
    qIn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = Math.max(-1, active - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter') { e.preventDefault(); pop.close(); selectCustomer(active >= 0 ? results[active] : null); }
    });
    search('');
    setTimeout(() => qIn.focus(), 20);
  }

  function selectCustomer(c) {
    S.customer = c ? { id: c.id, name: c.name, phone: c.phone, balance: c.balance } : null;
    renderCartHead();
    focusSearch(false);
  }

  /* ---------------------------------------------------------------- park / drafts */

  function draftData() {
    return {
      items: S.cart.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, name: l.name })),
      discount_type: S.discountType, discount_value: S.discountValue,
      customer_id: S.customer ? S.customer.id : null, customer_label: S.customer ? S.customer.name : '', note: S.note
    };
  }

  async function park() {
    if (!S.cart.length) return;
    if (S.editing) { toast('Finish or cancel editing the invoice first', 'error'); return; }
    const label = await promptDialog({ title: 'Park this sale', label: 'Name or note to find it later', value: S.customer ? S.customer.name : '', placeholder: 'e.g. Lady in red dress, coming back', confirm: 'Park sale' });
    if (label === null) return;
    const ok = await attempt(async () => {
      if (S.draftId) { try { await api('drafts.delete', { id: S.draftId }); } catch (_) { /* gone */ } }
      return api('drafts.save', { label: label || (S.customer ? S.customer.name : 'Parked sale'), data: draftData() });
    }, { success: 'Sale parked. Find it under Drafts.' });
    if (ok) { resetSale(); refreshCart(); renderTiles(); focusSearch(false); }
  }

  async function parkSilently() {
    if (!S.cart.length || S.editing) return !S.editing;
    const r = await attempt(() => api('drafts.save', { label: S.customer ? S.customer.name : `Parked ${Fmt.time(new Date().toISOString())}`, data: draftData() }));
    if (r) resetSale();
    return !!r;
  }

  async function showDrafts() {
    const drafts = await attempt(() => api('drafts.list'));
    if (!drafts) return;
    const m = modal({
      title: 'Parked sales', sub: 'Sales put on hold. Resume one to continue billing.', size: 'wide',
      body: drafts.length ? html`<div class="card"><table class="table"><thead><tr><th>Parked</th><th>Name / note</th><th class="num">Items</th><th></th></tr></thead><tbody>
        ${drafts.map((d) => html`<tr><td class="nowrap">${Fmt.ago(d.created_at)}<div class="cell-sub">${Fmt.dateTime(d.created_at)}</div></td>
          <td><div class="cell-title">${d.label}</div>${d.data.customer_label ? html`<div class="cell-sub">${d.data.customer_label}</div>` : ''}</td>
          <td class="num">${d.item_count}</td>
          <td class="actions"><button class="btn btn-primary btn-sm" data-action="resume" data-id="${d.id}">Resume</button>
            <button class="btn btn-danger-ghost btn-sm" data-action="del" data-id="${d.id}">${icon('trash', 'i-sm')}</button></td></tr>`)}
        </tbody></table></div>` : emptyState('drafts', 'No parked sales', 'Use “Park” (F8) to put a sale on hold while a customer keeps shopping.'),
      foot: html`<button class="btn btn-secondary" data-action="__close">Close</button>`,
      actions: {
        resume: async (t, _e, mm) => {
          const d = drafts.find((x) => String(x.id) === t.dataset.id);
          if (S.cart.length && !(await confirmDialog({ title: 'Replace current cart?', message: 'The items now in the cart will be removed.', confirm: 'Replace' }))) return;
          mm.close();
          await resumeDraft(d);
        },
        del: async (t, _e, mm) => {
          if (!(await confirmDialog({ title: 'Delete parked sale?', message: 'This cannot be undone.', confirm: 'Delete', danger: true }))) return;
          if (await attempt(() => api('drafts.delete', { id: Number(t.dataset.id) }))) { mm.close(); updateDraftCount(); showDrafts(); }
        }
      }
    });
    return m;
  }

  async function resumeDraft(d) {
    await loadProducts();
    resetSale();
    const missing = [];
    for (const it of d.data.items || []) {
      const p = S.byId.get(Number(it.product_id));
      if (!p) { missing.push(it.name || `#${it.product_id}`); continue; }
      S.cart.push({ product_id: p.id, name: p.name, sku: p.sku, std_price: p.price, unit_price: it.unit_price === undefined ? null : it.unit_price, qty: Math.max(1, Number(it.qty) || 1) });
    }
    S.discountType = d.data.discount_type === 'percent' ? 'percent' : 'flat';
    S.discountValue = d.data.discount_value || '';
    S.note = d.data.note || '';
    S.draftId = d.id;
    if (d.data.customer_id) {
      try { const c = await api('customers.get', { id: d.data.customer_id }); if (c.is_active) S.customer = c; } catch (_) { /* customer removed */ }
    }
    refreshCart();
    renderTiles();
    if (missing.length) toast(`Some items are no longer available: ${missing.join(', ')}`, 'error');
    else toast('Parked sale resumed', 'success');
  }

  /* ---------------------------------------------------------------- edit mode */

  async function loadForEdit(sale) {
    await loadProducts();
    resetSale();
    S.editing = {
      id: sale.id, invoice_no: sale.invoice_no, paid: sale.paid_at_sale, total: sale.total, customer_id: sale.customer_id,
      origQty: sale.items.reduce((a, i) => { a[i.product_id] = (a[i.product_id] || 0) + i.qty; return a; }, {})
    };
    for (const i of sale.items) {
      const p = S.byId.get(i.product_id);
      // Keep the price the item was sold at (issue C7).
      S.cart.push({ product_id: i.product_id, name: i.product_name, sku: i.sku, std_price: p ? p.price : i.unit_price, unit_price: i.unit_price, qty: i.qty });
      if (!p) S.byId.set(i.product_id, { id: i.product_id, name: i.product_name, sku: i.sku, price: i.unit_price, cost_price: i.cost_price, stock_qty: 0, stock_status: 'out', category: '', brand: '' });
    }
    S.discountType = sale.discount_type;
    S.discountValue = sale.discount_amount ? String(sale.discount_type === 'percent' ? sale.discount_value : sale.discount_amount) : '';
    S.note = sale.note || '';
    if (sale.customer_id) {
      try { S.customer = await api('customers.get', { id: sale.customer_id }); } catch (_) { S.customer = null; }
    }
  }

  async function cancelEdit() {
    if (!(await confirmDialog({ title: 'Cancel editing?', message: `Changes to ${S.editing.invoice_no} will not be saved.`, confirm: 'Discard changes' }))) return;
    resetSale();
    refreshCart();
    renderTiles();
  }

  /* ---------------------------------------------------------------- checkout */

  function plan({ total, prev, tenders, applyToBalance, keepAdvance, hasCustomer }) {
    const t = tenders.map((x) => ({ method: x.method, amount: P(x.amount) })).filter((x) => x.amount > 0);
    const tendered = t.reduce((a, x) => a + x.amount, 0);
    const T = P(total);
    const salePart = Math.min(tendered, T);
    let extra = tendered - salePart;
    const balancePart = hasCustomer && applyToBalance ? Math.min(extra, Math.max(0, P(prev))) : 0;
    extra -= balancePart;
    const advance = hasCustomer && keepAdvance ? extra : 0;
    const change = extra - advance;
    const cash = t.filter((x) => x.method === 'Cash').reduce((a, x) => a + x.amount, 0);
    return { tendered: R(tendered), salePart: R(salePart), balancePart: R(balancePart), advance: R(advance), change: R(change), credit: R(T - salePart), changeError: change > cash };
  }

  async function checkout() {
    if (!S.cart.length) return;
    const t = totals();
    if (t.invalidDiscount) { toast('Please correct the discount first', 'error'); return; }
    if (!allowNegative()) {
      const short = S.cart.find((l) => l.qty > available(l.product_id));
      if (short) { toast(`Not enough stock for "${short.name}" (available ${available(short.product_id)})`, 'error'); return; }
    }
    // Fresh balance for the selected customer.
    let prev = 0;
    if (S.customer) {
      try {
        const c = await api('customers.get', { id: S.customer.id });
        S.customer.balance = c.balance;
        prev = c.balance;
        // When editing, this invoice's own unpaid part is already in the balance.
        if (S.editing && S.editing.customer_id === S.customer.id) prev = Math.round((c.balance - (S.editing.total - S.editing.paid)) * 100) / 100;
      } catch (e) { toast(e.message, 'error'); return; }
    }
    const hasCustomer = !!S.customer;
    const methods = App.settings.payment_methods;
    const defaultPaid = S.editing ? Math.min(S.editing.paid, t.total) : t.total;
    const st = {
      tenders: [{ method: 'Cash', amount: defaultPaid }],
      applyToBalance: true,
      keepAdvance: false,
      format: prefs.format || App.settings.print.default_format || 'thermal',
      preview: !!prefs.preview,
      busy: false
    };

    const roundUps = [...new Set([100, 500, 1000, 5000].map((s) => Math.ceil(t.total / s) * s).filter((v) => v > t.total))].slice(0, 3);
    const m = modal({
      title: S.editing ? `Save changes to ${S.editing.invoice_no}` : 'Complete sale',
      sub: hasCustomer ? `${S.customer.name}${S.customer.phone ? ' · ' + S.customer.phone : ''}` : 'Walk-in customer',
      size: 'wide',
      body: html`<div class="co-grid">
        <div class="stack">
          <div class="co-due">
            <div class="lbl">Amount due for this bill</div>
            <div class="val">${Fmt.money(t.total)}</div>
            <div class="sub"><span>${t.qty} item${t.qty === 1 ? '' : 's'}${t.discount ? ` · discount ${Fmt.money(t.discount)}` : ''}</span></div>
            ${hasCustomer && prev ? html`<div class="sub"><span>${prev > 0 ? 'Old udhaar' : 'Advance held'}</span><span>${Fmt.money(Math.abs(prev))}</span></div>
              ${prev > 0 ? html`<div class="sub" style="color:#fff;font-weight:700"><span>Bill + old udhaar</span><span>${Fmt.money(t.total + prev)}</span></div>` : ''}` : ''}
          </div>
          <div>
            <div class="label mb-8">Amount received</div>
            <div id="tenders" class="stack" style="gap:6px"></div>
            <button class="btn btn-ghost btn-sm mt-8" data-action="addTender">${icon('plus', 'i-sm')} Split payment (another method)</button>
          </div>
          <div class="quick-cash">
            <button class="btn btn-secondary btn-sm" data-action="quick" data-v="${t.total}">Exact</button>
            ${roundUps.map((v) => html`<button class="btn btn-secondary btn-sm" data-action="quick" data-v="${v}">${Fmt.money(v, { symbol: false })}</button>`)}
            ${hasCustomer && prev > 0 ? html`<button class="btn btn-secondary btn-sm" data-action="quick" data-v="${t.total + prev}" title="Pay this bill and clear all old udhaar">Bill + udhaar</button>` : ''}
            ${hasCustomer ? html`<button class="btn btn-secondary btn-sm" data-action="quick" data-v="0" title="Nothing paid now">Udhaar</button>` : ''}
          </div>
          ${hasCustomer ? html`<div class="stack" style="gap:6px">
            <label class="check"><input type="checkbox" id="opt-bal" checked> Use extra money to pay old udhaar</label>
            <label class="check"><input type="checkbox" id="opt-adv"> Keep any extra as advance (no change returned)</label>
          </div>` : ''}
        </div>
        <div class="stack">
          <div class="co-break" id="breakdown"></div>
          <div id="co-msg"></div>
          <div>
            <div class="label mb-8">Print</div>
            <div class="seg" id="fmt-seg">${['thermal', 'a5', 'a4', 'none'].map((f) => html`<button data-action="fmt" data-f="${f}" class="${st.format === f ? 'on' : ''}">${f === 'none' ? 'No print' : PAPER_LABEL[f]}</button>`)}</div>
            <label class="check mt-8"><input type="checkbox" id="opt-preview" ${st.preview ? raw('checked') : ''}> Show preview before printing</label>
          </div>
          <div class="field"><label>Note on invoice (optional)</label><input class="input" id="co-note" value="${S.note}" placeholder="e.g. Delivery tomorrow"></div>
        </div>
      </div>`,
      foot: html`<div class="left small muted">${icon('keyboard', 'i-sm')} Enter to complete · Esc to go back</div>
        <button class="btn btn-secondary" data-action="__close">Back</button>
        <button class="btn btn-accent btn-lg" data-action="complete" id="co-go">${S.editing ? 'Save changes' : 'Complete sale'}</button>`,
      actions: {
        addTender: () => { const used = st.tenders.map((x) => x.method); st.tenders.push({ method: methods.find((x) => !used.includes(x)) || methods[0], amount: 0 }); drawTenders(true); },
        delTender: (tg) => { st.tenders.splice(Number(tg.dataset.i), 1); if (!st.tenders.length) st.tenders.push({ method: 'Cash', amount: 0 }); drawTenders(); },
        quick: (tg) => { st.tenders = [{ method: st.tenders[0].method, amount: Number(tg.dataset.v) }]; drawTenders(); },
        fmt: (tg, _e, mm) => { st.format = tg.dataset.f; mm.root.querySelectorAll('#fmt-seg button').forEach((b) => b.classList.toggle('on', b.dataset.f === st.format)); },
        complete: () => submit()
      }
    });

    const drawTenders = (focusLast = false) => {
      setHTML(m.root.querySelector('#tenders'), st.tenders.map((x, i) => html`<div class="tender-row">
        <select class="select" data-i="${i}" data-role="method">${methods.map((mm) => html`<option ${mm === x.method ? raw('selected') : ''}>${mm}</option>`)}</select>
        <div class="input-affix"><span class="affix">${Fmt.currency}</span><input class="input num input-lg" style="height:38px" data-i="${i}" data-role="amount" inputmode="decimal" value="${x.amount || ''}" placeholder="0"></div>
        ${st.tenders.length > 1 ? html`<button class="btn btn-ghost btn-icon btn-sm" data-action="delTender" data-i="${i}" title="Remove">${icon('x', 'i-sm')}</button>` : html`<span></span>`}
      </div>`));
      const inputs = m.root.querySelectorAll('[data-role=amount]');
      const target = focusLast ? inputs[inputs.length - 1] : inputs[0];
      if (target) { target.focus(); target.select(); }
      update();
    };

    const update = () => {
      st.applyToBalance = hasCustomer ? m.root.querySelector('#opt-bal').checked : false;
      st.keepAdvance = hasCustomer ? m.root.querySelector('#opt-adv').checked : false;
      const r = plan({ total: t.total, prev, tenders: st.tenders, applyToBalance: st.applyToBalance, keepAdvance: st.keepAdvance, hasCustomer });
      const newBal = hasCustomer ? Math.round((prev + t.total - r.salePart - r.balancePart - r.advance) * 100) / 100 : 0;
      setHTML(m.root.querySelector('#breakdown'), html`
        <div class="line-sum"><span class="muted">Received</span><span class="strong">${Fmt.money(r.tendered)}</span></div>
        <div class="line-sum"><span class="muted">Towards this bill</span><span>${Fmt.money(r.salePart)}</span></div>
        ${hasCustomer ? html`<div class="line-sum"><span class="muted">Towards old udhaar</span><span>${Fmt.money(r.balancePart)}</span></div>` : ''}
        ${r.advance ? html`<div class="line-sum"><span class="muted">Kept as advance</span><span>${Fmt.money(r.advance)}</span></div>` : ''}
        ${r.change ? html`<div class="co-change"><span class="strong">Change to return</span><span class="big">${Fmt.money(r.change)}</span></div>` : ''}
        ${r.credit ? html`<div class="co-credit"><span class="strong">Udhaar on this bill</span><span class="big">${Fmt.money(r.credit)}</span></div>` : ''}
        ${hasCustomer ? html`<div class="line-sum" style="border-top:1px solid var(--border);padding-top:7px"><span class="strong">Customer balance after</span><span class="strong ${newBal > 0 ? 'neg' : 'pos'}">${newBal < 0 ? 'Advance ' : ''}${Fmt.money(Math.abs(newBal))}</span></div>` : ''}`);
      let msg = '';
      let blocked = false;
      if (!hasCustomer && r.credit > 0) {
        blocked = true;
        msg = html`<div class="callout danger">${icon('alert')}<div class="grow">Walk-in customers must pay the full amount (short by <b>${Fmt.money(r.credit)}</b>). To give udhaar, choose a customer.
          <div class="mt-8"><button class="btn btn-secondary btn-sm" data-action="pickCustomer">${icon('user', 'i-sm')} Choose customer</button></div></div></div>`;
      } else if (r.changeError) {
        blocked = true;
        msg = html`<div class="callout danger">${icon('alert')}<div>Change can only be given from cash. Reduce the ${st.tenders.filter((x) => x.method !== 'Cash').map((x) => x.method).join(' / ')} amount.</div></div>`;
      }
      setHTML(m.root.querySelector('#co-msg'), msg);
      m.root.querySelector('#co-go').disabled = blocked || st.busy;
      return { r, blocked };
    };

    m.root.addEventListener('input', (e) => {
      const tg = e.target;
      if (tg.dataset.role === 'amount') { st.tenders[Number(tg.dataset.i)].amount = tg.value; update(); }
    });
    m.root.addEventListener('change', (e) => {
      const tg = e.target;
      if (tg.dataset.role === 'method') { st.tenders[Number(tg.dataset.i)].method = tg.value; update(); }
      if (tg.id === 'opt-bal' || tg.id === 'opt-adv') update();
    });
    m.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'BUTTON') { e.preventDefault(); submit(); }
    });
    m.root.addEventListener('click', (e) => {
      if (e.target.closest('[data-action=pickCustomer]')) { m.close(); openCustomerPicker($('#cust-btn', root)); }
    });

    const submit = async () => {
      if (st.busy) return;
      const { blocked } = update();
      if (blocked) return;
      st.busy = true;
      m.root.querySelector('#co-go').disabled = true;
      prefs.format = st.format;
      prefs.preview = m.root.querySelector('#opt-preview').checked;
      savePrefs();
      S.note = m.root.querySelector('#co-note').value.trim();
      const payload = {
        items: S.cart.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price === null || l.unit_price === '' ? undefined : l.unit_price })),
        discount_type: S.discountType, discount_value: Number(S.discountValue) || 0,
        customer_id: S.customer ? S.customer.id : null,
        payments: st.tenders.map((x) => ({ method: x.method, amount: Number(x.amount) || 0 })).filter((x) => x.amount > 0),
        apply_to_balance: st.applyToBalance, keep_advance: st.keepAdvance, note: S.note, draft_id: S.draftId || undefined
      };
      try {
        const res = S.editing ? await api('sales.update', { id: S.editing.id, ...payload }) : await api('sales.create', payload);
        m.close();
        const wasEdit = !!S.editing;
        resetSale();
        await loadProducts();
        refreshCart();
        renderCats();
        renderTiles();
        showSuccess(res, st.format, prefs.preview, wasEdit);
      } catch (e) {
        st.busy = false;
        update();
        if (e.code === 'LOCKED') { if (await Lock.prompt('Editing invoices is locked')) submit(); return; }
        setHTML(m.root.querySelector('#co-msg'), html`<div class="callout danger">${icon('alert')}<div>${e.message}</div></div>`);
      }
    };

    drawTenders();
  }

  function showSuccess(res, format, preview, wasEdit) {
    const sale = res.sale;
    const sm = res.summary;
    const m = modal({
      title: wasEdit ? `${sale.invoice_no} updated` : `Sale complete · ${sale.invoice_no}`,
      size: 'narrow',
      body: html`<div class="center stack" style="gap:6px">
        ${sm.change ? html`<div class="muted">Change to return</div><div class="success-amount pos">${Fmt.money(sm.change)}</div>`
          : sm.credit ? html`<div class="muted">Added to udhaar</div><div class="success-amount neg">${Fmt.money(sm.credit)}</div>`
          : html`<div class="muted">Paid in full</div><div class="success-amount">${Fmt.money(sm.total)}</div>`}
        ${sale.customer_id ? html`<div class="small">${sale.customer_name}: balance now <b class="${sm.new_balance > 0 ? 'neg' : ''}">${sm.new_balance < 0 ? 'advance ' : ''}${Fmt.money(Math.abs(sm.new_balance))}</b>${sm.old_balance_received ? html` (old udhaar received ${Fmt.money(sm.old_balance_received)})` : ''}</div>` : ''}
      </div>`,
      foot: html`<div class="left"><button class="btn btn-secondary" data-action="printMenu">${icon('printer')} Print…</button></div>
        <button class="btn btn-primary" data-action="__close" autofocus>New sale <span class="kbd-hint">Enter</span></button>`,
      actions: { printMenu: (t) => printMenu(t, sale.id) },
      onClose: () => focusSearch(true)
    });
    m.root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); m.close(); } });
    setTimeout(() => { const b = m.root.querySelector('.modal-foot .btn-primary'); if (b) b.focus(); }, 40);
    if (format && format !== 'none') {
      if (preview) Printer.previewSale(sale, format);
      else Printer.sale(sale, format);
    }
  }

  /* ---------------------------------------------------------------- search helpers */

  function focusSearch(select = true) {
    const q = $('#sell-q', root);
    if (!q) return;
    q.focus();
    if (select) q.select();
  }

  function moveKb(delta) {
    if (!shown.length) return;
    S.kb = Math.max(0, Math.min(shown.length - 1, S.kb + delta));
    $$('.tile', root).forEach((t, i) => t.classList.toggle('kb', i === S.kb));
    const t = $$('.tile', root)[S.kb];
    if (t) t.scrollIntoView({ block: 'nearest' });
  }

  function columns() {
    const tiles = $$('.tile', root);
    if (tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    let n = 0;
    for (const t of tiles) { if (t.offsetTop !== top) break; n++; }
    return n || 1;
  }

  const runSearch = debounce(() => { S.kb = 0; renderTiles(); }, 60);

  /* ---------------------------------------------------------------- handlers */

  const lineId = (t) => Number(t.closest('.line').dataset.pid);

  const handlers = {
    q: (t) => {
      S.query = t.value;
      $('.sell-search .clear-btn', root).classList.toggle('hidden', !S.query);
      runSearch();
    },
    qKey: async (t, e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = t.value.trim();
        if (!q) return;
        // Barcode scanners type the code + Enter: exact barcode wins.
        const exact = S.products.find((p) => p.sku && p.sku.toLowerCase() === q.toLowerCase());
        if (exact) { addProduct(exact.id); t.select(); return; }
        renderTiles();
        if (shown[S.kb]) { addProduct(shown[S.kb].id); t.select(); }
        else toast(`No product found for “${q}”`, 'error');
      } else if (e.key === 'Escape' && S.query) {
        e.preventDefault(); e.stopPropagation();
        handlers.clearQ();
      } else if (e.key === 'ArrowDown') { e.preventDefault(); moveKb(columns()); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveKb(-columns()); }
      else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length && S.query) { e.preventDefault(); moveKb(1); }
      else if (e.key === 'ArrowLeft' && t.selectionStart === 0 && S.query) { e.preventDefault(); moveKb(-1); }
    },
    clearQ: () => {
      S.query = ''; S.kb = 0;
      const q = $('#sell-q', root); q.value = '';
      $('.sell-search .clear-btn', root).classList.add('hidden');
      renderTiles(); q.focus();
    },
    cat: (t) => { S.category = t.dataset.c; S.kb = 0; renderCats(); renderTiles(); },
    add: (t) => addProduct(Number(t.dataset.id)),
    goProducts: () => App.go('products'),
    privacy: () => {
      prefs.privacy = !prefs.privacy; savePrefs();
      $('#sell', root).classList.toggle('privacy', prefs.privacy);
      setHTML($('#privacy-btn', root), icon(prefs.privacy ? 'eyeOff' : 'eye'));
      toast(prefs.privacy ? 'Prices hidden on screen. Hover over a line to see it.' : 'Prices visible', 'info', 1800);
    },
    customer: (t, e) => {
      if (e.target.closest('[data-action=clearCustomer]')) return;
      openCustomerPicker($('#cust-btn', root));
    },
    clearCustomer: (t, e) => { e.stopPropagation(); selectCustomer(null); },
    cartFilter: (t) => { S.cartFilter = t.value; applyCartFilter(); },
    park: () => park(),
    drafts: () => showDrafts(),
    clearCart: async () => {
      if (S.editing) return cancelEdit();
      if (S.cart.length > 1 && !(await confirmDialog({ title: 'Clear the cart?', message: `Remove all ${S.cart.length} lines from this sale?`, confirm: 'Clear cart', danger: true }))) return;
      resetSale(); refreshCart(); renderTiles(); focusSearch(false);
    },
    cancelEdit: () => cancelEdit(),
    inc: (t) => { const id = lineId(t); const l = S.cart.find((x) => x.product_id === id); setQty(id, l.qty + 1); },
    dec: (t) => { const id = lineId(t); const l = S.cart.find((x) => x.product_id === id); setQty(id, l.qty - 1); },
    qtyInput: (t) => {
      const n = parseInt(t.value, 10);
      if (Number.isFinite(n) && n > 0) setQty(lineId(t), n, { fromInput: true });
    },
    qtyChange: (t) => {
      const id = lineId(t);
      const n = parseInt(t.value, 10);
      if (!Number.isFinite(n) || n <= 0) { const l = S.cart.find((x) => x.product_id === id); t.value = l ? l.qty : 1; }
    },
    lineKey: (t, e) => { if (e.key === 'Enter') { e.preventDefault(); t.blur(); focusSearch(true); } },
    priceInput: (t) => {
      const id = lineId(t);
      const l = S.cart.find((x) => x.product_id === id);
      const v = t.value.trim();
      const n = Number(v);
      l.unit_price = v === '' || !Number.isFinite(n) || n < 0 ? null : n;
      updateLine(id);
      updateTotals();
    },
    priceChange: (t) => {
      const id = lineId(t);
      const l = S.cart.find((x) => x.product_id === id);
      if (l.unit_price !== null && Number(l.unit_price) === l.std_price) l.unit_price = null;
      t.value = unitOf(l);
      updateLine(id);
    },
    resetPrice: (t) => { const id = lineId(t); const l = S.cart.find((x) => x.product_id === id); l.unit_price = null; updateLine(id, { replaceInputs: true }); updateTotals(); },
    remove: (t) => removeLine(lineId(t)),
    discType: (t) => { S.discountType = t.dataset.t; $$('[data-action=discType]', root).forEach((b) => b.classList.toggle('on', b.dataset.t === S.discountType)); updateTotals(); },
    disc: (t) => { S.discountValue = t.value; updateTotals(); },
    charge: () => checkout()
  };

  Views.sell = {
    async render(container, params = {}) {
      await loadProducts();
      if (params.editSale) await loadForEdit(params.editSale);
      if (params.customer) S.customer = params.customer;
      return render(container);
    },
    focusSearch: () => focusSearch(true),
    hasUnsaved: () => S.cart.length > 0,
    parkSilently,
    onKey(e, typing) {
      if (e.key === 'F12' || (e.ctrlKey && e.key === 'Enter')) { e.preventDefault(); checkout(); }
      else if (e.key === 'F8') { e.preventDefault(); park(); }
      else if (e.key === 'F9') { e.preventDefault(); handlers.privacy(); }
      else if (e.key === 'F4') { e.preventDefault(); openCustomerPicker($('#cust-btn', root)); }
      else if (e.key === 'F6') {
        e.preventDefault();
        $('#cart-filter-wrap', root).classList.remove('hidden');
        $('#cart-filter', root).focus();
      } else if (e.key === 'F7') { e.preventDefault(); const d = $('#disc', root); d.focus(); d.select(); }
      else if (!typing && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Typing anywhere starts a product search (also catches barcode scanners).
        focusSearch(false);
      }
    }
  };
})();
