/* App shell: navigation, PIN lock, printing/preview, shortcuts, start-up. */
'use strict';

const Views = {};

const NAV = [
  { group: 'Store' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', key: '1' },
  { id: 'sell', label: 'Sell', icon: 'sell', key: '2' },
  { id: 'sales', label: 'Sales & Returns', icon: 'sales', key: '3' },
  { id: 'customers', label: 'Customers & Udhaar', icon: 'customers', key: '4' },
  { group: 'Stock' },
  { id: 'products', label: 'Products', icon: 'products', key: '5' },
  { id: 'inventory', label: 'Inventory', icon: 'inventory', key: '6' },
  { group: 'Money' },
  { id: 'reports', label: 'Reports', icon: 'reports', key: '7' },
  { id: 'expenses', label: 'Expenses', icon: 'expenses', key: '8' },
  { group: 'System' },
  { id: 'activity', label: 'Activity Log', icon: 'activity', key: '9' },
  { id: 'settings', label: 'Settings', icon: 'settings', key: '0' }
];

const App = {
  settings: null,
  info: null,
  current: null,
  params: {},
  cleanup: null,
  lastBackup: null,

  async start() {
    try {
      this.info = await Native.info();
      await this.reloadSettings();
      await this.migrateLegacy();
      await Lock.refresh();
    } catch (e) {
      document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif"><h2>Sajawal POS could not start</h2><p>${esc(e.message)}</p></div>`;
      return;
    }
    this.renderShell();
    this.bindGlobal();
    this.refreshBackupStatus();
    this.go('sell');
  },

  async reloadSettings() {
    this.settings = await api('settings.get');
    Fmt.currency = this.settings.currency_symbol || 'Rs.';
    return this.settings;
  },

  /** v1.x kept data in localStorage. Move it into the database once. */
  async migrateLegacy() {
    const st = await api('legacy.status');
    if (st.imported) return;
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
    const payload = {
      settings: read('sajawal_settings'),
      products: read('sajawal_products') || [],
      sales: read('sajawal_sales') || [],
      activity: read('sajawal_activity_log') || [],
      drafts: read('sajawal_drafts') || [],
      repayments: read('sajawal_repayments') || []
    };
    const hasData = payload.products.length || payload.sales.length || payload.repayments.length;
    if (!hasData || !st.empty) { await api('legacy.markNone'); return; }
    const rep = await api('legacy.import', payload);
    if (rep && !rep.skipped) {
      await this.reloadSettings();
      setTimeout(() => {
        modal({
          title: 'Your data has been moved to the new system',
          size: 'narrow',
          body: html`<div class="stack">
            <div class="callout ok">${icon('checkCircle')}<div>Everything from the previous version was imported safely. The old copy was left untouched.</div></div>
            <dl class="kv">
              <dt>Products</dt><dd>${rep.products}</dd>
              <dt>Invoices</dt><dd>${rep.sales}</dd>
              <dt>Customers (from names on bills)</dt><dd>${rep.customers}</dd>
              <dt>Udhaar repayments</dt><dd>${rep.repayments}</dd>
              <dt>Activity log entries</dt><dd>${rep.logs}</dd>
              ${rep.archived_products ? html`<dt>Deleted products found on old bills</dt><dd>${rep.archived_products} (kept as archived)</dd>` : ''}
            </dl>
            ${rep.renamed.length ? html`<div class="callout warn">${icon('warning')}<div>Some products had the same name and were renamed so they stay separate: ${rep.renamed.join(', ')}</div></div>` : ''}
            <div class="small muted">Tip: add phone numbers to customers in "Customers & Udhaar" so names never get mixed up.</div>
          </div>`,
          foot: html`<button class="btn btn-primary" data-action="__close">Got it</button>`
        });
      }, 400);
    }
  },

  renderShell() {
    const s = this.settings;
    setHTML(document.getElementById('app'), html`
      <div class="app">
        <aside class="side">
          <div class="brand">
            <img class="brand-logo" src="assets/logo.png" alt="">
            <div><div class="brand-name ellipsis" style="max-width:150px">${s.business_name}</div><div class="brand-sub">Point of Sale</div></div>
          </div>
          <nav class="nav" id="nav"></nav>
          <div class="side-foot">
            <div class="side-status" id="backup-status" title="Automatic backups"><span class="dot"></span><span>Backups on</span></div>
            <button class="side-btn" data-action="lock" id="lock-btn"></button>
            <button class="side-btn" data-action="shortcuts">${icon('keyboard')}<span>Shortcuts</span></button>
            <div class="side-user">
              <div class="avatar">${Fmt.initials(s.cashier_name)}</div>
              <div class="meta"><div class="name ellipsis" style="max-width:140px">${s.cashier_name}</div><div class="role">v${this.info.version}</div></div>
            </div>
          </div>
        </aside>
        <main class="main"><div class="page" id="page"></div></main>
      </div>`);
    this.renderNav();
    delegate(document.querySelector('.side'), {
      nav: (t) => this.go(t.dataset.id),
      lock: () => (Lock.status.enabled ? (Lock.status.unlocked ? Lock.lock() : Lock.prompt()) : this.go('settings', { section: 'security' })),
      shortcuts: () => showShortcuts()
    });
  },

  renderNav() {
    const sec = this.settings.security;
    setHTML($('#nav'), NAV.map((n) => {
      if (n.group) return html`<li class="nav-label">${n.group}</li>`;
      const locked = Lock.status.enabled && !Lock.status.unlocked && (sec.locked_pages.includes(n.id) || n.id === 'settings');
      return html`<li><button class="nav-item ${this.current === n.id ? 'active' : ''}" data-action="nav" data-id="${n.id}" title="${n.label} (Alt+${n.key})">
        ${icon(n.icon)}<span>${n.label}</span>${locked ? html`<span class="nav-lock">${icon('lock', 'i-sm')}</span>` : ''}</button></li>`;
    }));
    const lb = $('#lock-btn');
    if (lb) {
      setHTML(lb, Lock.status.enabled
        ? (Lock.status.unlocked ? html`${icon('unlock')}<span>Lock now</span>` : html`${icon('lock')}<span>Unlock (owner)</span>`)
        : html`${icon('shield')}<span>Set owner PIN</span>`);
    }
  },

  async go(id, params = {}) {
    if (!Views[id]) id = 'sell';
    closePopovers();
    while (Overlay.stack.length) Overlay.top().close();
    if (this.cleanup) { try { this.cleanup(); } catch (_) { /* ignore */ } this.cleanup = null; }
    this.current = id;
    this.params = params;
    this.renderNav();
    const page = $('#page');
    page.className = 'page';
    page.scrollTop = 0;
    if (Lock.isPageLocked(id)) {
      renderLockedPage(page, id);
      return;
    }
    const view = Views[id];
    try {
      const c = await view.render(page, params);
      this.cleanup = typeof c === 'function' ? c : null;
    } catch (e) {
      console.error(e);
      if (e.code === 'LOCKED') { renderLockedPage(page, id); return; }
      setHTML(page, emptyState('alert', 'This page could not be loaded', e.message));
    }
  },

  refresh() { return this.go(this.current, this.params); },

  async refreshBackupStatus() {
    try {
      const b = await Native.backupList();
      this.lastBackup = b.last;
      const elx = $('#backup-status');
      if (!elx) return;
      const ageH = b.last ? (Date.now() - new Date(b.last.modified).getTime()) / 3600000 : Infinity;
      setHTML(elx, html`<span class="dot ${ageH > 48 ? 'warn' : ''}"></span><span>${b.last ? `Backup ${Fmt.ago(b.last.modified)}` : 'No backup yet'}</span>`);
    } catch (_) { /* ignore */ }
  },

  bindGlobal() {
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if (e.key === 'Escape') {
        if (popover.current && popover.current.root.isConnected) { closePopovers(); e.preventDefault(); return; }
        const top = Overlay.top();
        if (top && top.dismissable !== false) { top.close(); e.preventDefault(); return; }
      }
      if (e.altKey && !e.ctrlKey && /^[0-9]$/.test(e.key)) {
        const n = NAV.find((x) => x.key === e.key);
        if (n) { e.preventDefault(); this.go(n.id); }
        return;
      }
      if (e.key === 'F2' && !Overlay.stack.length) {
        e.preventDefault();
        if (this.current !== 'sell') this.go('sell'); else Views.sell.focusSearch && Views.sell.focusSearch();
        return;
      }
      if ((e.key === 'F1' || (e.key === '?' && !typing)) && !Overlay.stack.length) { e.preventDefault(); showShortcuts(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'l' && Lock.status.enabled) { e.preventDefault(); Lock.lock(); return; }
      if (Views[this.current] && Views[this.current].onKey && !Overlay.stack.length) Views[this.current].onKey(e, typing);
    });

    // Idle auto-lock
    const touch = () => { Lock.lastActivity = Date.now(); };
    ['mousedown', 'keydown', 'wheel', 'touchstart'].forEach((t) => document.addEventListener(t, touch, { passive: true }));
    setInterval(() => Lock.checkIdle(), 15000);
    setInterval(() => this.refreshBackupStatus(), 5 * 60000);

    window.bridge.onBeforeClose(async () => {
      await window.bridge.closeAck();
      const unsaved = Views.sell.hasUnsaved && Views.sell.hasUnsaved();
      if (!unsaved) { window.bridge.confirmClose(); return; }
      const m = modal({
        title: 'You have an unfinished sale',
        sub: 'The cart still has items that were not charged.',
        size: 'narrow',
        body: html`<div class="muted">Park it to continue later, or close without saving it.</div>`,
        foot: html`<button class="btn btn-secondary" data-action="cancel">Keep working</button>
          <button class="btn btn-danger-ghost" data-action="discard">Close anyway</button>
          <button class="btn btn-primary" data-action="park">Park sale & close</button>`,
        actions: {
          cancel: (_t, _e, mm) => mm.close(),
          discard: () => window.bridge.confirmClose(),
          park: async (_t, _e, mm) => { const ok = await Views.sell.parkSilently(); if (ok) window.bridge.confirmClose(); else mm.close(); }
        }
      });
      return m;
    });
  }
};

/* ------------------------------------------------------------------ lock */

const Lock = {
  status: { enabled: false, unlocked: true },
  lastActivity: Date.now(),

  async refresh() {
    this.status = await api('auth.status');
    if (App.settings) App.renderNav && $('#nav') && App.renderNav();
    return this.status;
  },

  isPageLocked(id) {
    if (!this.status.enabled || this.status.unlocked) return false;
    if (id === 'settings') return true;
    return (App.settings.security.locked_pages || []).includes(id);
  },

  isActionLocked(action) {
    return this.status.enabled && !this.status.unlocked && (App.settings.security.protected_actions || []).includes(action);
  },

  async lock() {
    await api('auth.lock');
    await this.refresh();
    App.renderNav();
    toast('Locked. Owner PIN needed for protected pages.', 'info');
    if (this.isPageLocked(App.current)) App.go(App.current, App.params);
  },

  checkIdle() {
    const mins = Number(App.settings && App.settings.security.auto_lock_minutes) || 0;
    if (!mins || !this.status.enabled || !this.status.unlocked) return;
    if (Date.now() - this.lastActivity > mins * 60000) this.lock();
  },

  /** PIN pad dialog. Resolves true when unlocked. */
  prompt(reason = 'Enter owner PIN') {
    let pin = '';
    const m = modal({
      title: 'Owner PIN', sub: reason, size: 'narrow',
      body: html`<div class="lock-card" style="width:auto">
        <div class="pin-dots" id="pin-dots">${[0, 1, 2, 3].map(() => html`<span></span>`)}</div>
        <input class="input center" type="password" inputmode="numeric" maxlength="8" id="pin-in" autocomplete="off" placeholder="PIN" autofocus style="letter-spacing:6px;font-size:18px;height:44px">
        <div class="pin-pad mt-12">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button data-action="digit" data-d="${n}">${n}</button>`)}
          <button data-action="clear" title="Clear">${icon('x')}</button><button data-action="digit" data-d="0">0</button><button data-action="ok" title="Unlock">${icon('check')}</button></div>
        <div class="err small mt-8" id="pin-err" style="color:var(--red);min-height:18px"></div>
        <button class="btn btn-ghost btn-sm" data-action="forgot">Forgot PIN?</button>
      </div>`,
      actions: {
        digit: (t, _e, mm) => { const inp = mm.root.querySelector('#pin-in'); inp.value = (inp.value + t.dataset.d).slice(0, 8); sync(mm); },
        clear: (_t, _e, mm) => { mm.root.querySelector('#pin-in').value = ''; sync(mm); },
        ok: (_t, _e, mm) => submit(mm),
        forgot: (_t, _e, mm) => { mm.close(false); recoverPin(); }
      }
    });
    const sync = (mm) => {
      pin = mm.root.querySelector('#pin-in').value.replace(/\D/g, '');
      const n = Math.max(4, pin.length);
      setHTML(mm.root.querySelector('#pin-dots'), Array.from({ length: n }, (_, i) => html`<span class="${i < pin.length ? 'on' : ''}"></span>`));
      mm.root.querySelector('#pin-err').textContent = '';
    };
    const submit = async (mm) => {
      try {
        await api('auth.unlock', { pin: mm.root.querySelector('#pin-in').value });
        await Lock.refresh();
        App.renderNav();
        mm.close(true);
        toast('Unlocked', 'success');
      } catch (e) {
        mm.root.querySelector('#pin-err').textContent = e.message;
        mm.root.querySelector('#pin-in').value = '';
        sync(mm);
        mm.root.querySelector('#pin-err').textContent = e.message;
      }
    };
    const inp = m.root.querySelector('#pin-in');
    inp.addEventListener('input', () => sync(m));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(m); } });
    return m.result.then((v) => !!v);
  }
};

async function recoverPin() {
  const m = modal({
    title: 'Reset owner PIN', size: 'narrow',
    body: html`<form class="stack" data-on-submit="go">
      <div class="callout info">${icon('info')}<div>Enter the recovery code that was shown when the PIN was created.</div></div>
      <div class="field"><label>Recovery code</label><input class="input" name="code" placeholder="XXXX-XXXX-XXXX" autofocus></div>
      <div class="field"><label>New PIN (4–8 digits)</label><input class="input" name="pin" type="password" inputmode="numeric" maxlength="8"></div>
    </form>`,
    foot: html`<button class="btn btn-secondary" data-action="__close">Cancel</button><button class="btn btn-primary" data-action="go">Reset PIN</button>`,
    actions: {
      go: async (_t, _e, mm) => {
        const f = formData(mm.root.querySelector('form'));
        const r = await attempt(() => api('auth.recover', f));
        if (!r) return;
        mm.close();
        await Lock.refresh();
        App.renderNav();
        showRecoveryCode(r.recoveryCode);
      }
    }
  });
  return m;
}

function showRecoveryCode(code) {
  modal({
    title: 'Save your recovery code', size: 'narrow', dismissable: false,
    body: html`<div class="stack">
      <div class="callout warn">${icon('key')}<div>If the PIN is ever forgotten, this code is the only way to reset it. Write it down and keep it somewhere safe (not on this computer).</div></div>
      <div class="center" style="font-family:var(--font-head);font-size:26px;font-weight:800;letter-spacing:3px;padding:10px;border:1px dashed var(--border-strong);border-radius:8px">${code}</div>
    </div>`,
    foot: html`<button class="btn btn-primary" data-action="__close">I have written it down</button>`
  });
}

function renderLockedPage(page, id) {
  const n = NAV.find((x) => x.id === id) || { label: 'This page' };
  setHTML(page, html`<div class="lock-screen"><div class="card card-pad lock-card">
    <div class="center">${icon('lock', 'i-xl')}</div>
    <div class="modal-title mt-8">${n.label} is locked</div>
    <div class="muted small mt-4">Only the owner can open this page.</div>
    <button class="btn btn-primary btn-block mt-16" data-action="unlock">${icon('key')} Enter owner PIN</button>
  </div></div>`);
  const off = delegate(page, { unlock: async () => { if (await Lock.prompt()) { off(); App.go(id, App.params); } } });
  App.cleanup = off;
}

function showShortcuts() {
  const k = (keys, label) => html`<div><span>${label}</span><span>${keys.map((x) => html`<kbd>${x}</kbd> `)}</span></div>`;
  modal({
    title: 'Keyboard shortcuts', size: 'wide',
    body: html`<div class="shortcuts">
      ${k(['F2'], 'Go to Sell / search products')}
      ${k(['Enter'], 'Add highlighted product (or scanned barcode)')}
      ${k(['↑', '↓', '←', '→'], 'Move between products')}
      ${k(['F4'], 'Choose customer')}
      ${k(['F6'], 'Search inside the cart')}
      ${k(['F7'], 'Discount')}
      ${k(['F8'], 'Park sale')}
      ${k(['F9'], 'Hide / show prices on screen')}
      ${k(['F12'], 'Charge / complete sale')}
      ${k(['Ctrl', 'Enter'], 'Charge / complete sale')}
      ${k(['Esc'], 'Close window / clear search')}
      ${k(['Alt', '1…0'], 'Switch pages')}
      ${k(['Ctrl', 'L'], 'Lock (when PIN is set)')}
      ${k(['F1'], 'This help')}
    </div>
    <div class="callout info mt-16">${icon('barcode')}<div>Barcode scanners work automatically: scan while the search box is focused and the product is added to the cart.</div></div>`,
    foot: html`<button class="btn btn-primary" data-action="__close">Close</button>`
  });
}

/* ------------------------------------------------------------------ printing & preview */

const PAPER_LABEL = { thermal: 'Receipt', a5: 'A5', a4: 'A4' };
const PAPER_PX = { thermal: () => (Number(App.settings.print.receipt_width) === 58 ? 222 : 304), a5: () => 559, a4: () => 794 };

const Printer = {
  async loadSale(idOrSale) {
    return typeof idOrSale === 'object' ? idOrSale : api('sales.get', { id: idOrSale });
  },
  saleHtml(sale, paper) {
    return paper === 'thermal' ? Docs.receipt(sale, App.settings) : Docs.invoice(sale, App.settings, paper);
  },
  async printHtml(htmlDoc, paper) {
    const r = await attempt(() => Native.print({ html: htmlDoc, paper }));
    return r;
  },
  async sale(idOrSale, paper) {
    const sale = await this.loadSale(idOrSale);
    return this.printHtml(this.saleHtml(sale, paper), paper);
  },
  async previewSale(idOrSale, paper = App.settings.print.default_format) {
    const sale = await this.loadSale(idOrSale);
    return this.preview({
      title: `Invoice ${sale.invoice_no}`,
      name: `${sale.invoice_no} ${sale.customer_name}`,
      papers: ['thermal', 'a5', 'a4'],
      paper: paper === 'none' ? 'thermal' : paper,
      build: (p) => this.saleHtml(sale, p)
    });
  },
  /** Generic preview window with paper switcher, Print and Save PDF. */
  preview({ title, name, papers = ['a4'], paper, build }) {
    let current = paper || papers[0];
    const m = modal({
      title: 'Preview', sub: title, size: 'xwide',
      body: html`<div class="row-between mb-12">
          ${papers.length > 1 ? html`<div class="seg" id="paper-seg">${papers.map((p) => html`<button data-action="paper" data-p="${p}" class="${p === current ? 'on' : ''}">${PAPER_LABEL[p]}</button>`)}</div>` : html`<span></span>`}
          <span class="small muted" id="paper-note"></span>
        </div>
        <div class="preview-wrap"><iframe class="preview-frame" id="pv" sandbox="allow-same-origin" title="Document preview"></iframe></div>`,
      foot: html`<div class="left"><button class="btn btn-secondary" data-action="pdf">${icon('download')} Save PDF</button></div>
        <button class="btn btn-secondary" data-action="__close">Close</button>
        <button class="btn btn-primary" data-action="print">${icon('printer')} Print</button>`,
      actions: {
        paper: (t, _e, mm) => { current = t.dataset.p; mm.root.querySelectorAll('#paper-seg button').forEach((b) => b.classList.toggle('on', b.dataset.p === current)); render(mm); },
        print: async (_t, _e, mm) => { const r = await Printer.printHtml(build(current), current); if (r) mm.close(); },
        pdf: async () => { await attempt(() => Native.pdf({ html: build(current), paper: current, name: name || title })); }
      }
    });
    const render = (mm) => {
      const frame = mm.root.querySelector('#pv');
      const w = PAPER_PX[current]();
      frame.style.width = `${w}px`;
      frame.style.height = '200px';
      frame.srcdoc = build(current);
      const fit = () => {
        try {
          const h = frame.contentDocument.documentElement.scrollHeight;
          const minH = current === 'a4' ? 1123 : current === 'a5' ? 794 : 0;
          frame.style.height = `${Math.max(h, minH) + 4}px`;
        } catch (_) { frame.style.height = '900px'; }
      };
      frame.onload = () => { fit(); setTimeout(fit, 250); };
      const pr = App.settings.print;
      const printerName = current === 'thermal' ? pr.receipt_printer : current === 'a5' ? pr.a5_printer : pr.a4_printer;
      setHTML(mm.root.querySelector('#paper-note'), html`${icon('printer', 'i-sm')} ${printerName || 'Printer chosen in the print dialog'}`);
    };
    render(m);
    return m.result;
  }
};

/** Ask which document to print for an invoice (small menu). */
function printMenu(anchor, saleId) {
  menu(anchor, [
    { label: 'Print receipt (thermal)', icon: 'receipt', action: () => Printer.sale(saleId, 'thermal') },
    { label: 'Print A5 invoice', icon: 'file', action: () => Printer.sale(saleId, 'a5') },
    { label: 'Print A4 invoice', icon: 'file', action: () => Printer.sale(saleId, 'a4') },
    { sep: true },
    { label: 'Preview…', icon: 'eye', action: () => Printer.previewSale(saleId) }
  ]);
}

window.addEventListener('DOMContentLoaded', () => App.start());
window.addEventListener('error', (e) => console.error('[ui]', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => {
  console.error('[ui] unhandled', e.reason);
  if (e.reason && e.reason.message) toast(e.reason.message, 'error');
});
