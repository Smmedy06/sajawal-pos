/* Sajawal POS — renderer core: safe templating, API, formatting, UI primitives. */
'use strict';

/* ------------------------------------------------------------------ safe HTML */

class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[&<>"'`]/g, (c) => ESC[c]);
}
function part(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}
/** Tagged template: every interpolated value is HTML-escaped unless it is SafeHtml. */
function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
const raw = (s) => new SafeHtml(String(s));

function icon(name, cls = '') {
  const p = (window.ICON_PATHS || {})[name] || '';
  return raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`);
}

/* ------------------------------------------------------------------ DOM helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function setHTML(el, content) { el.innerHTML = part(content); return el; }
function el(htmlContent) {
  const t = document.createElement('template');
  t.innerHTML = part(htmlContent).trim();
  return t.content.firstElementChild;
}
function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/**
 * Event delegation: elements carry data-action="name"; handlers receive (el, event).
 * Supports click (default), input, change, keydown, submit via data-on-<type>="name".
 */
function delegate(root, handlers) {
  const types = ['click', 'input', 'change', 'keydown', 'submit', 'focusin', 'dblclick'];
  const off = [];
  for (const type of types) {
    const fn = (e) => {
      const attr = type === 'click' ? 'data-action' : `data-on-${type}`;
      const target = e.target.closest(`[${attr}]`);
      if (!target || !root.contains(target)) return;
      const name = target.getAttribute(attr);
      const h = handlers[name];
      if (!h) return;
      if (type === 'submit') e.preventDefault();
      if (type === 'click' && target.tagName === 'A') e.preventDefault();
      h(target, e);
    };
    root.addEventListener(type, fn);
    off.push(() => root.removeEventListener(type, fn));
  }
  return () => off.forEach((f) => f());
}

/* ------------------------------------------------------------------ formatting */

const Fmt = {
  currency: 'Rs.',
  /** 12500 -> "Rs. 12,500"; decimals only when needed. */
  money(n, { sign = false, symbol = true } = {}) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const pre = v < 0 ? '−' : sign && v > 0 ? '+' : '';
    return `${pre}${symbol ? Fmt.currency + ' ' : ''}${abs}`;
  },
  num(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); },
  pct(n) { return n === null || n === undefined ? '—' : `${Number(n).toFixed(1).replace(/\.0$/, '')}%`; },
  parse(s) { return s ? new Date(String(s).replace(' ', 'T')) : null; },
  date(s) {
    const d = Fmt.parse(s);
    return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  },
  time(s) {
    const d = Fmt.parse(s);
    return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  },
  dateTime(s) { return s ? `${Fmt.date(s)}, ${Fmt.time(s)}` : '—'; },
  ago(s) {
    const d = Fmt.parse(s);
    if (!d) return '—';
    const sec = Math.round((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
    if (sec < 86400 * 7) return `${Math.floor(sec / 86400)} d ago`;
    return Fmt.date(s);
  },
  iso(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  },
  plural(n, word) { return `${Fmt.num(n)} ${word}${Number(n) === 1 ? '' : 's'}`; }
};

/* ------------------------------------------------------------------ API */

class ApiError extends Error {
  constructor(error) { super(error.message || 'Error'); this.code = error.code; }
}
async function unwrap(promise) {
  const res = await promise;
  if (!res || !res.ok) throw new ApiError((res && res.error) || { message: 'Unexpected error' });
  return res.data;
}
const api = (name, payload) => unwrap(window.bridge.api(name, payload));
const Native = {
  info: () => unwrap(window.bridge.appInfo()),
  printers: () => unwrap(window.bridge.printers()),
  print: (o) => unwrap(window.bridge.printDocument(o)),
  pdf: (o) => unwrap(window.bridge.savePdf(o)),
  saveFile: (o) => unwrap(window.bridge.saveFile(o)),
  openFile: (o) => unwrap(window.bridge.openFile(o)),
  openFolder: (w) => unwrap(window.bridge.openFolder(w)),
  pickFolder: () => unwrap(window.bridge.pickFolder()),
  backupList: () => unwrap(window.bridge.backupList()),
  backupNow: () => unwrap(window.bridge.backupNow()),
  backupCreate: () => unwrap(window.bridge.backupCreate()),
  backupRestore: (f) => unwrap(window.bridge.backupRestore(f)),
  clearData: (t) => unwrap(window.bridge.clearData(t))
};

/* ------------------------------------------------------------------ toasts */

function toast(message, type = 'info', ms = 3200) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const ic = type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : 'info';
  const t = el(html`<div class="toast ${type}" role="status">${icon(ic)}<span>${message}</span></div>`);
  box.appendChild(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 220); }, type === 'error' ? Math.max(ms, 5000) : ms);
}
/** Run an async action and show a friendly error instead of failing silently. */
async function attempt(fn, { success } = {}) {
  try {
    const r = await fn();
    if (success) toast(typeof success === 'function' ? success(r) : success, 'success');
    return r;
  } catch (e) {
    if (e && e.code === 'LOCKED') {
      const ok = await Lock.prompt('This action is locked');
      if (ok) return attempt(fn, { success });
      return undefined;
    }
    toast(e.message || String(e), 'error');
    return undefined;
  }
}

/* ------------------------------------------------------------------ modal / drawer */

const Overlay = {
  stack: [],
  top() { return this.stack[this.stack.length - 1]; },
  closeTop() { const t = this.top(); if (t) t.close(); }
};

/**
 * Opens a modal. content: SafeHtml or function(api) returning SafeHtml.
 * Returns an object with close(), root, and a promise `result`.
 */
function modal({ title, sub, body, foot, size = '', actions = {}, onOpen, onClose, dismissable = true }) {
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  const overlay = el(html`
    <div class="overlay">
      <div class="modal ${size}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div><div class="modal-title">${title}</div>${sub ? html`<div class="modal-sub">${sub}</div>` : ''}</div>
          ${dismissable ? html`<button class="btn btn-ghost btn-icon btn-sm" data-action="__close" aria-label="Close">${icon('x')}</button>` : ''}
        </div>
        <div class="modal-body">${body || ''}</div>
        ${foot ? html`<div class="modal-foot">${foot}</div>` : ''}
      </div>
    </div>`);
  const prevFocus = document.activeElement;
  const m = {
    root: overlay,
    body: overlay.querySelector('.modal-body'),
    foot: overlay.querySelector('.modal-foot'),
    result,
    closed: false,
    close(value) {
      if (m.closed) return;
      m.closed = true;
      undelegate();
      overlay.remove();
      Overlay.stack = Overlay.stack.filter((x) => x !== m);
      if (onClose) onClose(value);
      resolve(value);
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    },
    dismissable
  };
  const undelegate = delegate(overlay, { __close: () => m.close(undefined), ...Object.fromEntries(Object.entries(actions).map(([k, f]) => [k, (t, e) => f(t, e, m)])) });
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && dismissable) m.close(undefined); });
  document.body.appendChild(overlay);
  Overlay.stack.push(m);
  const first = overlay.querySelector('[autofocus]') || overlay.querySelector('.modal-body input:not([type=hidden]):not([disabled]), .modal-body select, .modal-body textarea');
  if (first) setTimeout(() => { first.focus(); if (first.select && first.type !== 'date') first.select(); }, 20);
  if (onOpen) onOpen(m);
  return m;
}

function drawer({ head, body, foot, actions = {}, onClose, width }) {
  const back = el(html`<div class="drawer-overlay"></div>`);
  const d = el(html`<aside class="drawer" role="dialog"><div class="drawer-head"></div><div class="drawer-body"></div><div class="drawer-foot"></div></aside>`);
  if (width) d.style.width = width;
  const api = {
    root: d,
    closed: false,
    set(parts) {
      if (parts.head !== undefined) setHTML(d.querySelector('.drawer-head'), html`<div class="grow">${parts.head}</div><button class="btn btn-ghost btn-icon btn-sm" data-action="__close" aria-label="Close">${icon('x')}</button>`);
      if (parts.body !== undefined) setHTML(d.querySelector('.drawer-body'), parts.body);
      if (parts.foot !== undefined) {
        const f = d.querySelector('.drawer-foot');
        setHTML(f, parts.foot);
        f.classList.toggle('hidden', !parts.foot);
      }
    },
    close() {
      if (api.closed) return;
      api.closed = true;
      undelegate();
      back.remove(); d.remove();
      Overlay.stack = Overlay.stack.filter((x) => x !== api);
      if (onClose) onClose();
    },
    dismissable: true
  };
  const undelegate = delegate(d, { __close: () => api.close(), ...Object.fromEntries(Object.entries(actions).map(([k, f]) => [k, (t, e) => f(t, e, api)])) });
  back.addEventListener('mousedown', () => api.close());
  document.body.append(back, d);
  Overlay.stack.push(api);
  api.set({ head, body: body || html`<div class="skeleton" style="width:60%"></div>`, foot: foot || '' });
  return api;
}

function confirmDialog({ title, message, confirm = 'Confirm', danger = false, detail }) {
  const m = modal({
    title, size: 'narrow',
    body: html`<div>${message}</div>${detail ? html`<div class="mt-12">${detail}</div>` : ''}`,
    foot: html`<button class="btn btn-secondary" data-action="no">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="yes" autofocus>${confirm}</button>`,
    actions: { yes: (_t, _e, mm) => mm.close(true), no: (_t, _e, mm) => mm.close(false) }
  });
  setTimeout(() => { const b = m.root.querySelector('[data-action=yes]'); if (b) b.focus(); }, 30);
  return m.result.then((v) => !!v);
}

function promptDialog({ title, label, value = '', placeholder = '', confirm = 'Save', required = false, multiline = false }) {
  const m = modal({
    title, size: 'narrow',
    body: html`<form data-on-submit="ok"><div class="field"><label>${label}</label>
      ${multiline ? html`<textarea class="textarea" name="v" placeholder="${placeholder}">${value}</textarea>` : html`<input class="input" name="v" value="${value}" placeholder="${placeholder}" autofocus>`}
      </div></form>`,
    foot: html`<button class="btn btn-secondary" data-action="no">Cancel</button><button class="btn btn-primary" data-action="ok">${confirm}</button>`,
    actions: {
      ok: (_t, _e, mm) => {
        const v = mm.root.querySelector('[name=v]').value.trim();
        if (required && !v) { mm.root.querySelector('[name=v]').classList.add('invalid'); return; }
        mm.close(v);
      },
      no: (_t, _e, mm) => mm.close(null)
    }
  });
  return m.result.then((v) => (v === undefined ? null : v));
}

/* ------------------------------------------------------------------ popover */

function popover(anchor, content, { actions = {}, width, align = 'left', onClose } = {}) {
  closePopovers();
  const p = el(html`<div class="popover">${content}</div>`);
  if (width) p.style.width = `${width}px`;
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  let left = align === 'right' ? r.right - pr.width : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
  let top = r.bottom + 6;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;
  const api = {
    root: p,
    close() {
      if (!p.isConnected) return;
      undelegate(); p.remove();
      document.removeEventListener('mousedown', outside, true);
      if (onClose) onClose();
    }
  };
  const undelegate = delegate(p, Object.fromEntries(Object.entries(actions).map(([k, f]) => [k, (t, e) => f(t, e, api)])));
  const outside = (e) => { if (!p.contains(e.target) && !anchor.contains(e.target)) api.close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  popover.current = api;
  return api;
}
function closePopovers() { if (popover.current) { popover.current.close(); popover.current = null; } }

/** Simple dropdown menu: items [{label, icon, action, danger, sep}] */
function menu(anchor, items, { align = 'right' } = {}) {
  const map = {};
  const content = html`<div class="menu">${items.map((it, i) => {
    if (it.sep) return html`<div class="menu-sep"></div>`;
    map[`m${i}`] = it.action;
    return html`<button class="menu-item ${it.danger ? 'danger' : ''}" data-action="m${i}">${it.icon ? icon(it.icon) : ''}<span>${it.label}</span></button>`;
  })}</div>`;
  const actions = {};
  for (const [k, f] of Object.entries(map)) actions[k] = (_t, _e, p) => { p.close(); f(); };
  return popover(anchor, content, { actions, align });
}

/* ------------------------------------------------------------------ date ranges */

const DateRange = {
  presets() {
    const t = new Date();
    const d = (y, m, day) => Fmt.iso(new Date(y, m, day));
    const Y = t.getFullYear(); const M = t.getMonth(); const D = t.getDate();
    const dow = (t.getDay() + 6) % 7; // Monday = 0
    return [
      { id: 'today', label: 'Today', from: d(Y, M, D), to: d(Y, M, D) },
      { id: 'yesterday', label: 'Yesterday', from: d(Y, M, D - 1), to: d(Y, M, D - 1) },
      { id: 'week', label: 'This week', from: d(Y, M, D - dow), to: d(Y, M, D) },
      { id: '7d', label: 'Last 7 days', from: d(Y, M, D - 6), to: d(Y, M, D) },
      { id: 'month', label: 'This month', from: d(Y, M, 1), to: d(Y, M, D) },
      { id: 'lastmonth', label: 'Last month', from: d(Y, M - 1, 1), to: d(Y, M, 0) },
      { id: '30d', label: 'Last 30 days', from: d(Y, M, D - 29), to: d(Y, M, D) },
      { id: '90d', label: 'Last 90 days', from: d(Y, M, D - 89), to: d(Y, M, D) },
      { id: 'year', label: 'This year', from: d(Y, 0, 1), to: d(Y, M, D) },
      { id: 'all', label: 'All time', from: '', to: '' }
    ];
  },
  make(id) {
    const p = DateRange.presets().find((x) => x.id === id) || DateRange.presets()[0];
    return { preset: p.id, from: p.from, to: p.to };
  },
  /** Re-evaluate preset ranges (so "Today" stays today after midnight). */
  fresh(r) { return r && r.preset && r.preset !== 'custom' ? DateRange.make(r.preset) : r; },
  label(r) {
    if (!r) return 'All time';
    const p = r.preset && r.preset !== 'custom' ? DateRange.presets().find((x) => x.id === r.preset) : null;
    if (p) return p.id === 'all' ? 'All time' : `${p.label} · ${DateRange.span(r)}`;
    return DateRange.span(r);
  },
  span(r) {
    if (!r.from && !r.to) return 'All time';
    const f = r.from ? Fmt.date(r.from) : 'Start';
    const t = r.to ? Fmt.date(r.to) : 'Today';
    return r.from === r.to ? f : `${f} – ${t}`;
  },
  /** Renders a button; on change calls onChange(range). */
  button(range, id = 'dr') {
    return html`<button class="btn btn-secondary dr-btn" data-action="openRange" data-range-id="${id}">${icon('calendar')}<span class="ellipsis">${DateRange.label(range)}</span>${icon('down', 'i-sm')}</button>`;
  },
  open(anchor, range, onChange) {
    const presets = DateRange.presets();
    const content = html`<div class="dr-pop">
      <div class="dr-presets menu">${presets.map((p) => html`<button class="menu-item ${range && range.preset === p.id ? 'active' : ''}" data-action="pick" data-id="${p.id}">${p.label}</button>`)}</div>
      <form class="dr-custom" data-on-submit="apply">
        <div class="strong">Custom range</div>
        <div class="field"><label>From</label><input type="date" class="input" name="from" value="${range ? range.from : ''}"></div>
        <div class="field"><label>To</label><input type="date" class="input" name="to" value="${range ? range.to : ''}"></div>
        <button class="btn btn-primary" type="submit">Apply</button>
      </form></div>`;
    popover(anchor, content, {
      actions: {
        pick: (t, _e, p) => { p.close(); onChange(DateRange.make(t.dataset.id)); },
        apply: (_t, e, p) => {
          if (e) e.preventDefault();
          let from = p.root.querySelector('[name=from]').value;
          let to = p.root.querySelector('[name=to]').value;
          if (from && to && from > to) [from, to] = [to, from];
          p.close();
          onChange({ preset: 'custom', from, to });
        }
      }
    });
  }
};

/* ------------------------------------------------------------------ pagination */

function pager(res, action = 'page') {
  if (!res || res.total <= res.pageSize) {
    return res && res.total ? html`<div class="pager"><span>${Fmt.plural(res.total, 'record')}</span><span></span></div>` : '';
  }
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  const from = (res.page - 1) * res.pageSize + 1;
  const to = Math.min(res.total, res.page * res.pageSize);
  return html`<div class="pager">
    <span>${Fmt.num(from)}–${Fmt.num(to)} of ${Fmt.num(res.total)}</span>
    <div class="row">
      <button class="btn btn-secondary btn-sm" data-action="${action}" data-page="${res.page - 1}" ${res.page <= 1 ? raw('disabled') : ''}>${icon('left', 'i-sm')} Prev</button>
      <span class="small">Page ${res.page} of ${pages}</span>
      <button class="btn btn-secondary btn-sm" data-action="${action}" data-page="${res.page + 1}" ${res.page >= pages ? raw('disabled') : ''}>Next ${icon('right', 'i-sm')}</button>
    </div></div>`;
}

function emptyState(ic, title, sub, action) {
  return html`<div class="empty">${icon(ic)}<div class="empty-title">${title}</div>${sub ? html`<div class="empty-sub">${sub}</div>` : ''}${action ? html`<div class="mt-12">${action}</div>` : ''}</div>`;
}

function statusBadge(s) {
  const map = {
    paid: ['b-green', 'Paid'], partial: ['b-amber', 'Partly paid'], unpaid: ['b-red', 'Udhaar'],
    completed: ['b-gray', 'Completed'], partially_returned: ['b-violet', 'Part returned'], returned: ['b-violet', 'Returned'], cancelled: ['b-gray', 'Cancelled'],
    ok: ['b-green', 'In stock'], low: ['b-amber', 'Low stock'], out: ['b-red', 'Out of stock']
  };
  const [cls, label] = map[s] || ['b-gray', s];
  return html`<span class="badge ${cls}">${label}</span>`;
}

function stockCell(p) {
  return html`<span class="stock-dot ${p.stock_status === 'ok' ? '' : p.stock_status}">${Fmt.num(p.stock_qty)}</span>`;
}

/** Read a <form> into a plain object. */
function formData(form) {
  const o = {};
  for (const elx of form.elements) {
    if (!elx.name) continue;
    if (elx.type === 'checkbox') o[elx.name] = elx.checked;
    else if (elx.type === 'radio') { if (elx.checked) o[elx.name] = elx.value; }
    else o[elx.name] = elx.value;
  }
  return o;
}

/* ------------------------------------------------------------------ export helpers */

/** rows: array of objects (already formatted for humans). */
async function exportExcel(fileBase, sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ Info: 'No records' }]);
    const cols = Object.keys(s.rows[0] || { Info: '' });
    ws['!cols'] = cols.map((c) => ({ wch: Math.min(48, Math.max(10, c.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const res = await Native.saveFile({ name: `${fileBase}_${Fmt.iso()}.xlsx`, data: new Uint8Array(data), filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] });
  if (res && !res.canceled) toast('Excel file saved', 'success');
}
