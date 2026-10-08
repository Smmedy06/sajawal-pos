/* Settings */
'use strict';

(() => {
  let root = null;
  let section = 'store';
  const SECTIONS = [
    ['store', 'Store details', 'store'], ['billing', 'Bills & printing', 'printer'], ['pricing', 'Pricing & stock', 'tag'],
    ['payments', 'Payments & expenses', 'cash'], ['security', 'Security & locks', 'shield'], ['backup', 'Backup & data', 'database'], ['about', 'About & help', 'info']
  ];
  const PAGES = [['dashboard', 'Dashboard'], ['sell', 'Sell'], ['sales', 'Sales & Returns'], ['customers', 'Customers & Udhaar'], ['products', 'Products'], ['inventory', 'Inventory'], ['reports', 'Reports'], ['expenses', 'Expenses'], ['activity', 'Activity Log']];
  const ACTIONS = [
    ['viewProfit', 'See cost price & profit'], ['editSale', 'Edit invoices'], ['returnSale', 'Return items'], ['cancelSale', 'Cancel sales'],
    ['editProduct', 'Add / edit products & prices'], ['deleteProduct', 'Archive products'], ['adjustStock', 'Adjust stock'],
    ['voidPayment', 'Void payments'], ['restoreBackup', 'Restore backups'], ['clearData', 'Delete all data']
  ];

  const S = () => App.settings;
  const field = (label, name, value, { hint, type = 'text', cls = '', attrs = '' } = {}) => html`<div class="field ${cls}"><label>${label}</label>
    <input class="input ${type === 'number' ? 'num' : ''}" type="${type}" name="${name}" value="${value}" ${raw(attrs)}>${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;

  function sampleSale() {
    return {
      id: 0, invoice_no: `${S().invoice_prefix}TEST`, created_at: new Date().toISOString(), customer_id: 1, customer_name: 'Test Customer', customer_phone: '0300-0000000',
      subtotal: 5800, discount_type: 'flat', discount_value: 300, discount_amount: 300, total: 5500, returned_total: 0, status: 'completed', note: '', cashier: S().cashier_name,
      paid_at_sale: 5000, received_with_sale: 0, refunded: 0, previous_balance: 1200, balance_after_sale: 1700,
      items: [{ product_name: 'Sample Lipstick Matte 05', qty: 2, unit_price: 1450, line_subtotal: 2900, returned_qty: 0 }, { product_name: 'Sample Face Wash 150ml', qty: 1, unit_price: 2900, line_subtotal: 2900, returned_qty: 0 }],
      payments: [{ kind: 'sale', voided: false, method: 'Cash', amount: 5000 }]
    };
  }

  /** Shop name / lock state may have changed: rebuild the sidebar and reopen this section. */
  function refreshShell() {
    App.renderShell();
    App.go('settings', { section });
  }

  async function save(patch, msg = 'Settings saved') {
    const r = await attempt(() => api('settings.update', patch));
    if (!r) return false;
    await App.reloadSettings();
    toast(msg, 'success');
    refreshShell();
    return true;
  }

  async function renderSection() {
    const box = $('#set-body', root);
    const s = S();
    setHTML($('#set-nav', root), SECTIONS.map(([k, l, ic]) => html`<button class="${section === k ? 'on' : ''}" data-action="sec" data-s="${k}">${icon(ic)} ${l}</button>`));
    if (section === 'store') {
      setHTML(box, html`<form class="card card-pad set-section stack" data-on-submit="saveStore">
        <div class="card-title">Store details</div><div class="muted small">Shown on bills, statements and reports.</div>
        <div class="form-grid">
          ${field('Shop name *', 'business_name', s.business_name)}${field('Tagline', 'business_tagline', s.business_tagline, { hint: 'e.g. Beauty & Cosmetics' })}
          ${field('Address', 'business_address', s.business_address, { cls: 'span-2' })}
          ${field('Phone / WhatsApp', 'business_phone', s.business_phone)}${field('Email', 'business_email', s.business_email)}
          ${field('Cashier / user name *', 'cashier_name', s.cashier_name, { hint: 'Recorded on every bill and in the activity log' })}
        </div>
        <div><button class="btn btn-primary" data-action="saveStore">${icon('save')} Save</button></div></form>`);
    } else if (section === 'billing') {
      let printers = [];
      try { printers = await Native.printers(); } catch (_) { /* none */ }
      const sel = (name, value) => html`<select class="select" name="${name}"><option value="">Ask every time (print dialog)</option>
        ${printers.map((p) => html`<option value="${p.name}" ${value === p.name ? raw('selected') : ''}>${p.displayName}${p.isDefault ? ' (Windows default)' : ''}</option>`)}
        ${value && !printers.some((p) => p.name === value) ? html`<option value="${value}" selected>${value} (not found)</option>` : ''}</select>`;
      setHTML(box, html`<form class="stack set-section" data-on-submit="saveBilling">
        <div class="card card-pad stack">
          <div class="card-title">Printers</div>
          <div class="form-grid">
            <div class="field"><label>Receipt (thermal) printer</label>${sel('receipt_printer', s.print.receipt_printer)}</div>
            <div class="field"><label>Receipt paper width</label><select class="select" name="receipt_width"><option value="80" ${s.print.receipt_width === 80 ? raw('selected') : ''}>80 mm (3 inch)</option><option value="58" ${s.print.receipt_width === 58 ? raw('selected') : ''}>58 mm (2 inch)</option></select></div>
            <div class="field"><label>A5 invoice printer</label>${sel('a5_printer', s.print.a5_printer)}</div>
            <div class="field"><label>A4 printer</label>${sel('a4_printer', s.print.a4_printer)}</div>
            <div class="field"><label>Page margin for A4/A5 (mm)</label><input class="input num" type="number" name="margin_mm" min="3" max="25" value="${s.print.margin_mm}"><span class="hint">Increase if the top or bottom gets cut. 8 mm suits most printers.</span></div>
            <div class="field"><label>Default print after a sale</label><select class="select" name="default_format">${[['thermal', 'Receipt (thermal)'], ['a5', 'A5 invoice'], ['a4', 'A4 invoice'], ['none', 'Don’t print']].map(([v, l]) => html`<option value="${v}" ${s.print.default_format === v ? raw('selected') : ''}>${l}</option>`)}</select></div>
          </div>
          <label class="check"><input type="checkbox" name="silent" ${s.print.silent ? raw('checked') : ''}> Print straight to the chosen printer (no print dialog)</label>
          <div class="callout info">${icon('info')}<div>The paper size (A4 / A5 / receipt) is now sent to the printer automatically — no need to choose it under “Advanced”. If your A5 printer still cuts the edges, raise the margin above.</div></div>
          <div class="row"><span class="small muted">Test print:</span>
            <button type="button" class="btn btn-secondary btn-sm" data-action="test" data-p="thermal">Receipt</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="test" data-p="a5">A5</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="test" data-p="a4">A4</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="testPreview">${icon('eye', 'i-sm')} Preview</button></div>
        </div>
        <div class="card card-pad stack">
          <div class="card-title">Bill text</div>
          <div class="form-grid">
            ${field('Invoice number prefix', 'invoice_prefix', s.invoice_prefix, { hint: 'Numbers continue automatically, e.g. INV-1001' })}
            ${field('Footer message', 'receipt_footer', s.receipt_footer)}
            <div class="field span-2"><label>Terms / return policy</label><textarea class="textarea" name="invoice_terms" rows="2">${s.invoice_terms}</textarea></div>
          </div>
        </div>
        <div><button class="btn btn-primary" data-action="saveBilling">${icon('save')} Save</button></div></form>`);
    } else if (section === 'pricing') {
      setHTML(box, html`<form class="card card-pad set-section stack" data-on-submit="savePricing">
        <div class="card-title">Pricing & stock</div>
        <div class="form-grid">
          ${field('Default markup %', 'markup_percentage', s.markup_percentage, { type: 'number', hint: 'Products without a fixed price sell at cost + this %.', attrs: 'min="0" max="1000" step="0.1"' })}
          ${field('Low-stock alert at (pieces)', 'low_stock_default', s.low_stock_default, { type: 'number', hint: 'Can be changed per product.', attrs: 'min="0"' })}
          ${field('Expiry warning (days before)', 'expiry_alert_days', s.expiry_alert_days, { type: 'number', attrs: 'min="0"' })}
        </div>
        <label class="check"><input type="checkbox" name="allow_negative_stock" ${s.allow_negative_stock ? raw('checked') : ''}> Allow selling more than the stock on record (not recommended)</label>
        <label class="check"><input type="checkbox" name="hide_tile_prices" ${s.privacy.hide_tile_prices ? raw('checked') : ''}> Hide prices on product tiles in the Sell screen (customers can see the screen)</label>
        <div><button class="btn btn-primary" data-action="savePricing">${icon('save')} Save</button></div></form>`);
    } else if (section === 'payments') {
      setHTML(box, html`<form class="card card-pad set-section stack" data-on-submit="savePayments">
        <div class="card-title">Payment methods</div><div class="small muted">One per line. “Cash” is always kept because change is given in cash.</div>
        <textarea class="textarea" name="payment_methods" rows="6">${s.payment_methods.join('\n')}</textarea>
        <div class="card-title mt-8">Expense categories</div>
        <textarea class="textarea" name="expense_categories" rows="7">${s.expense_categories.join('\n')}</textarea>
        <div><button class="btn btn-primary" data-action="savePayments">${icon('save')} Save</button></div></form>`);
    } else if (section === 'security') {
      const sec = s.security;
      setHTML(box, html`<div class="stack set-section">
        <div class="card card-pad stack">
          <div class="row-between"><div><div class="card-title">Owner PIN</div><div class="small muted">${sec.pin_enabled ? 'PIN is on. Locked pages and actions need the PIN.' : 'No PIN set — everyone can open every page.'}</div></div>
            ${sec.pin_enabled ? html`<span class="badge b-green">${icon('shield', 'i-sm')} Protected</span>` : html`<span class="badge b-amber">Not protected</span>`}</div>
          <div class="row">${sec.pin_enabled ? html`<button class="btn btn-secondary" data-action="setPin">${icon('key')} Change PIN</button><button class="btn btn-danger-ghost" data-action="disablePin">Turn off PIN</button>` : html`<button class="btn btn-primary" data-action="setPin">${icon('key')} Set owner PIN</button>`}</div>
        </div>
        <form class="card card-pad stack" data-on-submit="saveSecurity">
          <div class="card-title">Lock these pages</div><div class="small muted">Staff need the PIN to open them. Settings is always locked when a PIN is set.</div>
          <div class="check-grid">${PAGES.map(([k, l]) => html`<label class="check"><input type="checkbox" name="page_${k}" ${sec.locked_pages.includes(k) ? raw('checked') : ''}> ${l}</label>`)}</div>
          <div class="card-title mt-8">Lock these actions</div><div class="small muted">Even on open pages, these need the PIN.</div>
          <div class="check-grid">${ACTIONS.map(([k, l]) => html`<label class="check"><input type="checkbox" name="act_${k}" ${sec.protected_actions.includes(k) ? raw('checked') : ''}> ${l}</label>`)}</div>
          <div class="field" style="max-width:260px"><label>Lock again automatically after (minutes idle)</label><input class="input num" type="number" name="auto_lock_minutes" min="0" max="240" value="${sec.auto_lock_minutes}"><span class="hint">0 = only when “Lock now” is pressed.</span></div>
          <div><button class="btn btn-primary" data-action="saveSecurity">${icon('save')} Save</button></div>
        </form></div>`);
    } else if (section === 'backup') {
      let list = { auto: [], last: null };
      try { list = await Native.backupList(); } catch (_) { /* ignore */ }
      setHTML(box, html`<div class="stack set-section">
        <div class="card card-pad stack">
          <div class="row-between"><div><div class="card-title">Automatic backups</div><div class="small muted">A copy of all data is saved every day, every few hours while open, and when the app closes. The newest ${s.backup.keep} are kept.</div></div>
            <span class="badge ${list.last ? 'b-green' : 'b-amber'}">${list.last ? `Last: ${Fmt.ago(list.last.modified)}` : 'No backup yet'}</span></div>
          <div class="row"><button class="btn btn-primary" data-action="backupNow">${icon('save')} Back up now</button>
            <button class="btn btn-secondary" data-action="backupCopy">${icon('drive')} Save a copy to USB / folder…</button>
            <button class="btn btn-ghost" data-action="openBackups">${icon('folder')} Open backup folder</button></div>
          <form class="form-grid" data-on-submit="saveBackup">
            <div class="field span-2"><label>Second backup folder (USB, D: drive or Google Drive folder)</label>
              <div class="row"><input class="input" name="mirror_dir" value="${s.backup.mirror_dir}" placeholder="Not set — backups only on this computer" readonly>
                <button type="button" class="btn btn-secondary" data-action="pickMirror">Choose…</button>${s.backup.mirror_dir ? html`<button type="button" class="btn btn-ghost" data-action="clearMirror">Remove</button>` : ''}</div>
              <span class="hint">Strongly recommended: if this computer fails, the second copy keeps the shop’s records safe.</span></div>
            <div class="field"><label>Backups to keep</label><input class="input num" type="number" name="keep" min="5" max="365" value="${s.backup.keep}"></div>
            <div class="field"><label>&nbsp;</label><button class="btn btn-secondary" data-action="saveBackup">Save</button></div>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title">Restore a backup</div><button class="btn btn-secondary btn-sm" data-action="restoreFile">${icon('upload', 'i-sm')} Restore from file…</button></div>
          ${list.auto.length ? html`<div class="table-wrap" style="max-height:300px"><table class="table table-compact"><tbody>${list.auto.slice(0, 40).map((b) => html`<tr><td>${Fmt.dateTime(b.modified)}<div class="cell-sub">${b.name}</div></td><td class="num muted">${(b.size / 1024).toFixed(0)} KB</td>
            <td class="actions"><button class="btn btn-ghost btn-sm" data-action="restore" data-file="${b.file}">Restore</button></td></tr>`)}</tbody></table></div>` : html`<div class="card-body muted small">No automatic backups yet.</div>`}
        </div>
        <div class="card card-pad stack" style="border-color:var(--red-bd)">
          <div class="card-title neg">Danger zone</div>
          <div class="small muted">Deletes every product, sale, customer, payment and log. Settings are kept. A backup is made first so it can be undone with “Restore”.</div>
          <div><button class="btn btn-danger" data-action="clearAll">${icon('trash')} Delete all data…</button></div>
        </div>
        <div class="small muted">Data file: ${App.info.dataFile}</div>
      </div>`);
    } else {
      setHTML(box, html`<div class="stack set-section">
        <div class="card card-pad"><div class="row gap-12"><img src="assets/logo.png" alt="" style="width:44px;height:44px;border-radius:10px">
          <div><div class="card-title">Sajawal POS ${App.info.version}</div><div class="small muted">Offline point of sale for beauty & cosmetics retail. All data stays on this computer.</div></div></div></div>
        <div class="card card-pad"><div class="card-title mb-8">Keyboard shortcuts</div><button class="btn btn-secondary" data-action="shortcuts">${icon('keyboard')} Show all shortcuts</button></div>
        <div class="card card-pad stack"><div class="card-title">Data location</div><div class="small">${App.info.dataFile}</div><div><button class="btn btn-ghost btn-sm" data-action="openData">${icon('folder', 'i-sm')} Open folder</button></div></div>
      </div>`);
    }
  }

  async function pinDialog() {
    const enabled = S().security.pin_enabled;
    const m = modal({
      title: enabled ? 'Change owner PIN' : 'Set owner PIN', size: 'narrow',
      body: html`<form class="stack" data-on-submit="go">
        ${enabled ? html`<div class="field"><label>Current PIN</label><input class="input" type="password" name="current" inputmode="numeric" maxlength="8" autofocus></div>` : ''}
        <div class="field"><label>New PIN (4–8 digits)</label><input class="input" type="password" name="pin" inputmode="numeric" maxlength="8" ${enabled ? '' : raw('autofocus')}></div>
        <div class="field"><label>Repeat new PIN</label><input class="input" type="password" name="pin2" inputmode="numeric" maxlength="8"></div>
        <div class="small muted">You will get a recovery code to reset the PIN if you forget it.</div></form>`,
      foot: html`<button class="btn btn-secondary" data-action="__close">Cancel</button><button class="btn btn-primary" data-action="go">Save PIN</button>`,
      actions: {
        go: async (_t, _e, mm) => {
          const f = formData(mm.root.querySelector('form'));
          if (f.pin !== f.pin2) { toast('The two PINs do not match', 'error'); return; }
          const r = await attempt(() => api('auth.setPin', { current: f.current, pin: f.pin }));
          if (!r) return;
          mm.close();
          await App.reloadSettings(); await Lock.refresh();
          refreshShell();
          showRecoveryCode(r.recoveryCode);
        }
      }
    });
    return m;
  }

  const handlers = {
    sec: (t) => { section = t.dataset.s; renderSection(); },
    saveStore: () => save(formData($('form', $('#set-body', root)))),
    saveBilling: () => {
      const f = formData($('form', $('#set-body', root)));
      return save({ invoice_prefix: f.invoice_prefix, receipt_footer: f.receipt_footer, invoice_terms: f.invoice_terms,
        print: { receipt_printer: f.receipt_printer, a5_printer: f.a5_printer, a4_printer: f.a4_printer, receipt_width: Number(f.receipt_width), default_format: f.default_format, silent: f.silent, margin_mm: Number(f.margin_mm) } });
    },
    test: (t) => { const p = t.dataset.p; Printer.printHtml(Printer.saleHtml(sampleSale(), p), p); },
    testPreview: () => Printer.preview({ title: 'Test page', name: 'test', papers: ['thermal', 'a5', 'a4'], paper: 'a5', build: (p) => Printer.saleHtml(sampleSale(), p) }),
    savePricing: () => {
      const f = formData($('form', $('#set-body', root)));
      return save({ markup_percentage: Number(f.markup_percentage), low_stock_default: Number(f.low_stock_default), expiry_alert_days: Number(f.expiry_alert_days), allow_negative_stock: f.allow_negative_stock, privacy: { hide_tile_prices: f.hide_tile_prices } });
    },
    savePayments: () => {
      const f = formData($('form', $('#set-body', root)));
      const lines = (v) => v.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
      return save({ payment_methods: lines(f.payment_methods), expense_categories: lines(f.expense_categories) });
    },
    setPin: () => pinDialog(),
    disablePin: async () => {
      const pin = await promptDialog({ title: 'Turn off PIN', label: 'Enter the current PIN to remove protection', required: true, confirm: 'Turn off' });
      if (!pin) return;
      if (await attempt(() => api('auth.disablePin', { current: pin }), { success: 'PIN turned off' })) { await App.reloadSettings(); await Lock.refresh(); refreshShell(); }
    },
    saveSecurity: () => {
      const f = formData($$('form', $('#set-body', root))[0]);
      return save({ security: {
        locked_pages: PAGES.map(([k]) => k).filter((k) => f[`page_${k}`]),
        protected_actions: ['settings', ...ACTIONS.map(([k]) => k).filter((k) => f[`act_${k}`])],
        auto_lock_minutes: Number(f.auto_lock_minutes) || 0
      } }, 'Security settings saved');
    },
    backupNow: async () => { const r = await attempt(() => Native.backupNow(), { success: 'Backup saved' }); if (r) { App.refreshBackupStatus(); renderSection(); } },
    backupCopy: () => attempt(() => Native.backupCreate()),
    openBackups: () => Native.openFolder('backups'),
    openData: () => Native.openFolder('data'),
    pickMirror: async () => { const dir = await attempt(() => Native.pickFolder()); if (dir) save({ backup: { mirror_dir: dir } }, 'Second backup folder set'); },
    clearMirror: () => save({ backup: { mirror_dir: '' } }),
    saveBackup: () => { const f = formData($('form', $('#set-body', root))); return save({ backup: { keep: Number(f.keep) } }); },
    restore: async (t) => { if (Lock.isActionLocked('restoreBackup') && !(await Lock.prompt())) return; attempt(() => Native.backupRestore(t.dataset.file)); },
    restoreFile: async () => { if (Lock.isActionLocked('restoreBackup') && !(await Lock.prompt())) return; attempt(() => Native.backupRestore()); },
    clearAll: async () => {
      if (Lock.isActionLocked('clearData') && !(await Lock.prompt())) return;
      const text = await promptDialog({ title: 'Delete ALL data?', label: 'This removes every product, invoice, customer, payment and log. Type DELETE to confirm.', placeholder: 'DELETE', confirm: 'Delete everything' });
      if (text === null) return;
      const r = await attempt(() => Native.clearData(text.trim()));
      if (r) { toast('All data deleted. A safety backup was saved first.', 'success'); App.go('dashboard'); }
    },
    shortcuts: () => showShortcuts()
  };

  Views.settings = {
    async render(container, params = {}) {
      root = container;
      if (params.section) section = params.section;
      setHTML(root, html`<div class="page-head"><div><div class="page-title">Settings</div><div class="page-sub">Shop details, printing, security and backups.</div></div></div>
        <div class="settings"><nav class="settings-nav" id="set-nav"></nav><div id="set-body"></div></div>`);
      const off = delegate(root, handlers);
      await renderSection();
      return off;
    }
  };
})();
