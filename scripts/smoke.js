'use strict';
/*
 * UI smoke test: launches the real app against a throw-away data folder,
 * seeds sample data, opens every page, records console errors and saves
 * screenshots to ./smoke-out.
 *   npx electron scripts/smoke.js [--legacy] [--keep]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', 'smoke-out');
const LEGACY_PREP = process.argv.includes('--legacy-prepare');
const LEGACY = process.argv.includes('--legacy');
let userData;
if (LEGACY_PREP || LEGACY) {
  userData = path.join(os.tmpdir(), 'sajawal-smoke-legacy');
  if (LEGACY_PREP) fs.rmSync(userData, { recursive: true, force: true });
  if (LEGACY) fs.rmSync(path.join(userData, 'data'), { recursive: true, force: true }); // fresh DB, old localStorage kept
  fs.mkdirSync(userData, { recursive: true });
} else {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sajawal-smoke-'));
}
global.__sajawalCustomUserData = true;
app.setPath('userData', userData);
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (event) => {
    const level = event.level !== undefined ? event.level : event;
    const msg = event.message || '';
    if (level === 'error' || level === 3 || /error|uncaught/i.test(msg)) errors.push(msg);
    if (process.env.SMOKE_VERBOSE) console.log('[console]', level, msg);
  });
  win.webContents.once('did-finish-load', () => run(win).catch((e) => { console.error('SMOKE FAILED', e); app.exit(1); }));
});

async function js(win, code) {
  if (process.env.SMOKE_VERBOSE) console.log("[step]", code.trim().slice(0, 70).replace(/s+/g, " "));
  return win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
}

async function shot(win, name) {
  await sleep(450);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
}

async function run(win) {
  if (win.webContents.getURL().startsWith('data:') || !win.isVisible && false) return;
  win.setSize(1440, 900);
  await sleep(1500);
  if (LEGACY_PREP) {
    // Phase 1: plant v1.2-style data in localStorage, then quit.
    await js(win, `localStorage.setItem('sajawal_products', JSON.stringify([{id:'PROD-1234',name:'Maybelline Mascara',cost_price:2200,selling_price:2850,stock_qty:35},{id:'PROD-1234',name:'CeraVe Cleanser',cost_price:3800,selling_price:null,stock_qty:15}]));
      localStorage.setItem('sajawal_sales', JSON.stringify([{id:'INV-1001',invoice_number:'INV-1001',created_at:'2026-08-05T11:30:00Z',subtotal:7500,discount_type:'flat',discount_value:0,total:7500,amount_paid:2000,payment_method:'Credit / Udhaar',customer_name:'Ayesha Khan',items:[{product_id:'PROD-1234',product_name_snapshot:'Maybelline Mascara',unit_price_snapshot:2850,cost_price_snapshot:2200,quantity:1,line_total:2850},{product_id:'PROD-1234',product_name_snapshot:'CeraVe Cleanser',unit_price_snapshot:4650,cost_price_snapshot:3800,quantity:1,line_total:4650}]}]));
      localStorage.setItem('sajawal_settings', JSON.stringify({business_name:'Sajawal POS',cashier_name:'Sajawal Khan',markup_percentage:20,currency_symbol:'Rs.'}));
      return true;`);
    console.log('legacy data planted');
    await sleep(500);
    app.exit(0);
    return;
  } else if (LEGACY) {
    // Phase 2: fresh database + old localStorage => migration dialog.
    await sleep(1500);
    await shot(win, '00-legacy-import');
    await js(win, 'while (Overlay.stack.length) Overlay.top().close(); return true;');
  } else {
    await seed(win);
  }

  const pages = ['dashboard', 'sell', 'sales', 'customers', 'products', 'inventory', 'reports', 'expenses', 'activity', 'settings'];
  for (const [i, p] of pages.entries()) {
    await js(win, `await App.go('${p}'); return true;`);
    await sleep(500);
    await shot(win, `${String(i + 1).padStart(2, '0')}-${p}`);
  }
  await interactions(win);

  fs.writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n') || 'no errors');
  console.log(`SMOKE DONE — ${errors.length} console error(s). Screenshots in smoke-out/`);
  if (errors.length) console.log(errors.slice(0, 30).join('\n'));
  if (!process.argv.includes('--keep')) {
    setTimeout(() => app.exit(errors.length ? 2 : 0), 300);
  }
}

async function seed(win) {
  await js(win, `
    const a = (n, p) => window.bridge.api(n, p).then((r) => { if (!r.ok) throw new Error(n + ': ' + r.error.message); return r.data; });
    const cats = ['Lips', 'Eyes', 'Skin care', 'Face', 'Hair'];
    const brands = ['Maybelline', 'MAC', 'The Ordinary', 'L\\'Oréal', 'Huda Beauty', 'CeraVe', 'Garnier'];
    const names = ['Velvet Matte Lipstick', 'Lash Sensational Mascara', 'Niacinamide 10% Serum 30ml', 'Fit Me Foundation 128', 'Hydrating Cleanser 236ml',
      'Nude Eyeshadow Palette', 'Micellar Water 400ml', 'Hyaluronic Acid 2% Serum', 'Kohl Kajal Black', 'Setting Spray 100ml', 'Lip Liner "Spice"',
      'Sunscreen SPF 50', 'Vitamin C Serum', 'Hair Serum 100ml', 'Compact Powder', 'Blush "Peach"', 'Brow Pencil', 'Nail Polish Red', 'Face Wash Neem', 'BB Cream'];
    const ids = [];
    for (let i = 0; i < names.length; i++) {
      const cost = 500 + (i * 337) % 4000;
      const p = await a('products.create', { name: names[i], category: cats[i % 5], brand: brands[i % 7], cost_price: cost, sell_price: i % 3 ? null : Math.round(cost * 1.3), stock_qty: i === 4 ? 0 : i % 6 === 0 ? 3 : 10 + i, sku: '89010' + String(1000 + i), expiry_date: i % 7 === 0 ? '2026-11-15' : '' });
      ids.push(p.id);
    }
    const ali = await a('customers.create', { name: 'Ali Raza', phone: '0300-1234567' });
    const ayesha = await a('customers.create', { name: "Ayesha D'Souza", phone: '0321-7654321', opening_balance: 1500 });
    await a('sales.create', { items: [{ product_id: ids[0], qty: 2 }, { product_id: ids[1], qty: 1 }], payments: [{ method: 'Cash', amount: 20000 }] });
    await a('sales.create', { customer_id: ali.id, items: [{ product_id: ids[2], qty: 1 }, { product_id: ids[3], qty: 2 }], discount_type: 'percent', discount_value: 5, payments: [{ method: 'Cash', amount: 2000 }] });
    const s3 = await a('sales.create', { customer_id: ayesha.id, items: [{ product_id: ids[5], qty: 1 }], payments: [] });
    await a('sales.return', { sale_id: s3.sale.id, items: [{ sale_item_id: s3.sale.items[0].id, qty: 1 }], reason: 'Wrong shade' });
    await a('payments.receive', { customer_id: ali.id, amount: 1000, method: 'EasyPaisa' });
    await a('expenses.add', { category: 'Electricity', amount: 4500, note: 'K-Electric bill' });
    await a('inventory.adjust', { product_id: ids[6], mode: 'add', qty: 24, reason: 'Purchase', unit_cost: 800 });
    await a('drafts.save', { label: 'Lady in red', data: { items: [{ product_id: ids[7], qty: 1 }] } });
    return true;`);
}

async function interactions(win) {
  // Sell: add products, open checkout, preview a document.
  await js(win, `await App.go('sell'); return true;`);
  await sleep(300);
  await js(win, `document.querySelectorAll('.tile')[0].click(); document.querySelectorAll('.tile')[1].click(); document.querySelectorAll('.tile')[1].click(); return true;`);
  await shot(win, '20-sell-cart');
  await js(win, `const q = document.getElementById('sell-q'); q.value = 'serum'; q.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
  await sleep(200);
  await shot(win, '21-sell-search');
  await js(win, `document.querySelector('[data-action=charge]').click(); return true;`);
  await sleep(500);
  await shot(win, '22-checkout');
  await js(win, `Overlay.closeTop(); return true;`);
  await sleep(300);
  await js(win, `Printer.previewSale((await window.bridge.api('sales.list', {})).data.rows[0].id, 'thermal'); return true;`);
  await sleep(900);
  await shot(win, '23-preview-receipt');
  await js(win, `document.querySelector('#paper-seg [data-p=a5]').click(); return true;`);
  await sleep(900);
  await shot(win, '24-preview-a5');
  await js(win, `while (Overlay.stack.length) Overlay.top().close(); return true;`);
  // Sales drawer
  await js(win, `await App.go('sales'); return true;`);
  await sleep(300);
  await js(win, `const r = document.querySelector('tr.clickable'); if (r) r.click(); return true;`);
  await sleep(700);
  await shot(win, '25-invoice-drawer');
  await js(win, `while (Overlay.stack.length) Overlay.top().close(); return true;`);
  // Customer ledger
  await js(win, `await App.go('customers'); return true;`);
  await sleep(300);
  await js(win, `const r = document.querySelector('tr.clickable'); if (r) r.click(); return true;`);
  await sleep(800);
  await shot(win, '26-customer-detail');
  // Product detail
  await js(win, `await App.go('products'); return true;`);
  await sleep(300);
  await js(win, `const r = document.querySelector('tr.clickable'); if (r) r.click(); return true;`);
  await sleep(800);
  await shot(win, '27-product-detail');
  await js(win, `while (Overlay.stack.length) Overlay.top().close(); return true;`);

  // Dialogs
  const dialogs = [
    ['30-return-dialog', `const r = (await window.bridge.api('sales.list', { q: 'INV-1001' })).data.rows[0]; const s = (await window.bridge.api('sales.get', { id: r.id })).data; returnDialog(s); return true;`],
    ['31-receive-payment', `const c = (await window.bridge.api('customers.list', { filter: 'due' })).data.rows[0]; receivePayment(c); return true;`],
    ['32-stock-dialog', `const p = (await window.bridge.api('products.list', {})).data.rows[0]; stockDialog(p, null, 'add'); return true;`],
    ['33-product-form', `const p = (await window.bridge.api('products.list', {})).data.rows[2]; productForm(p); return true;`],
    ['34-customer-picker', `await App.go('sell'); document.getElementById('cust-btn').click(); return true;`],
    ['35-date-range', `await App.go('dashboard'); document.querySelector('[data-action=openRange]').click(); return true;`],
    ['36-shortcuts', `showShortcuts(); return true;`]
  ];
  for (const [name, code] of dialogs) {
    await js(win, code);
    await sleep(700);
    await shot(win, name);
    await js(win, `closePopovers(); while (Overlay.stack.length) Overlay.top().close(); return true;`);
  }
  // Pages / tabs not covered above
  const tabs = [
    ['40-reports-cash', `await App.go('reports', { tab: 'cash' }); return true;`],
    ['41-reports-aging', `await App.go('reports', { tab: 'aging' }); return true;`],
    ['42-inventory-moves', `await App.go('inventory', { tab: 'moves' }); return true;`],
    ['43-inventory-import', `await App.go('inventory', { tab: 'import' }); return true;`],
    ['44-inventory-receive', `await App.go('inventory', { tab: 'receive' }); return true;`],
    ['45-sales-payments', `await App.go('sales', { tab: 'payments' }); return true;`],
    ['46-settings-billing', `await App.go('settings', { section: 'billing' }); return true;`],
    ['47-settings-security', `await App.go('settings', { section: 'security' }); return true;`],
    ['48-settings-backup', `await App.go('settings', { section: 'backup' }); return true;`]
  ];
  for (const [name, code] of tabs) {
    await js(win, code);
    await sleep(700);
    await shot(win, name);
  }
  // End-to-end through the real screens: sell → checkout → complete, then edit that invoice.
  const flow = await js(win, `
    const before = (await window.bridge.api('sales.list', {})).data.total;
    await App.go('sell');
    Views.sell.focusSearch();
    document.querySelector('[data-action=clearCart]') && !document.querySelector('[data-action=clearCart]').disabled && null;
    const tiles = [...document.querySelectorAll('.tile:not(.out)')];
    tiles[0].click(); tiles[0].click(); tiles[1].click();
    // change qty of first line by typing (must keep focus and not re-render the list)
    const qty = document.querySelector('.line [data-role=qty]');
    qty.focus(); qty.value = '3'; qty.dispatchEvent(new Event('input', { bubbles: true }));
    const focusKept = document.activeElement === qty;
    document.querySelector('[data-action=charge]').click();
    await new Promise((r) => setTimeout(r, 400));
    const amt = document.querySelector('[data-role=amount]');
    const due = Number(amt.value);
    amt.value = String(due + 500); amt.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#fmt-seg [data-f=none]').click();
    document.getElementById('co-go').click();
    await new Promise((r) => setTimeout(r, 900));
    const successText = document.querySelector('.modal') ? document.querySelector('.modal').innerText : '';
    while (Overlay.stack.length) Overlay.top().close();
    const list = (await window.bridge.api('sales.list', {})).data;
    const sale = (await window.bridge.api('sales.get', { id: list.rows[0].id })).data;
    // edit it: reopen in Sell, remove one line, save
    await App.go('sell', { editSale: sale });
    const banner = !!document.querySelector('.edit-banner');
    const lines = document.querySelectorAll('.line').length;
    document.querySelectorAll('.line [data-action=remove]')[1].click();
    document.querySelector('[data-action=charge]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('co-go').click();
    await new Promise((r) => setTimeout(r, 900));
    while (Overlay.stack.length) Overlay.top().close();
    const edited = (await window.bridge.api('sales.get', { id: sale.id })).data;
    return { created: list.total === before + 1, focusKept, changeShown: /Change to return/.test(successText), qty: sale.items[0].qty,
      paid: sale.paid_at_sale === sale.total, banner, lines, saleLines: sale.items.length, editedLines: edited.items.length, revisions: edited.revisions.length, editedPaid: edited.paid_at_sale === edited.total };`);
  console.log('[flow]', JSON.stringify(flow));
  if (!(flow.created && flow.focusKept && flow.changeShown && flow.qty === 3 && flow.paid && flow.banner && flow.lines === flow.saleLines && flow.editedLines === flow.lines - 1 && flow.revisions === 1 && flow.editedPaid)) {
    errors.push(`UI sale/edit flow check failed: ${JSON.stringify(flow)}`);
  }

  // PIN lock: set a PIN, lock, open a locked page.
  await js(win, `await window.bridge.api('auth.setPin', { pin: '1234' }); await window.bridge.api('settings.update', { security: { locked_pages: ['reports'] } });
    await App.reloadSettings(); await Lock.refresh(); while (Overlay.stack.length) Overlay.top().close(); await Lock.lock(); await App.go('reports'); return true;`);
  await sleep(600);
  await shot(win, '50-locked-page');
  await js(win, `document.querySelector('[data-action=unlock]').click(); return true;`);
  await sleep(500);
  await shot(win, '51-pin-pad');
  await js(win, `const i = document.getElementById('pin-in'); i.value = '1234'; i.dispatchEvent(new Event('input')); document.querySelector('.pin-pad [data-action=ok]').click(); return true;`);
  await sleep(900);
  await shot(win, '52-unlocked-reports');
}

require('../src/main/index.js');
