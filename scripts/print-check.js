'use strict';
/*
 * Verifies the print pipeline: renders a receipt, an A5 and an A4 invoice
 * exactly like the app does and checks the resulting PDF page sizes.
 *   npx electron scripts/print-check.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

global.__sajawalCustomUserData = true;
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sajawal-print-')));

const OUT = path.join(__dirname, '..', 'smoke-out');
fs.mkdirSync(OUT, { recursive: true });

function pageSizes(pdf) {
  const s = pdf.toString('latin1');
  return [...s.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => ({
    wMm: Math.round(((Number(m[3]) - Number(m[1])) / 72) * 25.4), hMm: Math.round(((Number(m[4]) - Number(m[2])) / 72) * 25.4)
  }));
}

app.whenReady().then(async () => {
  // Build the documents inside a page that loads the real renderer code.
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, '..', 'index.html')).catch(() => {});
  const docs = await win.webContents.executeJavaScript(`(() => {
    const s = { business_name: 'Sajawal POS', business_tagline: 'Beauty & Cosmetics', business_address: 'Gulberg III, Lahore', business_phone: '0321-4829100', business_email: '',
      receipt_footer: 'Thank you!', invoice_terms: 'Exchange within 3 days.', print: { receipt_width: 80, margin_mm: 8 } };
    const items = Array.from({ length: 14 }, (_, i) => ({ product_name: 'Product line number ' + (i + 1), qty: 1 + (i % 3), unit_price: 950 + i * 10, line_subtotal: (1 + (i % 3)) * (950 + i * 10), returned_qty: 0 }));
    const sale = { id: 1, invoice_no: 'INV-2001', created_at: '2026-10-08 12:30:00', customer_id: 3, customer_name: 'Test', customer_phone: '0300', subtotal: 30000, discount_type: 'flat', discount_value: 0,
      discount_amount: 0, total: 30000, returned_total: 0, refunded: 0, status: 'completed', note: '', cashier: 'Sajawal', paid_at_sale: 20000, received_with_sale: 0, previous_balance: 1000, balance_after_sale: 11000,
      items, payments: [{ kind: 'sale', voided: false, method: 'Cash', amount: 20000 }] };
    return { thermal: Docs.receipt(sale, s), a5: Docs.invoice(sale, s, 'a5'), a4: Docs.invoice(sale, s, 'a4') };
  })()`);
  const results = [];
  for (const [paper, html] of Object.entries(docs)) {
    const file = path.join(os.tmpdir(), `print-check-${paper}.html`);
    fs.writeFileSync(file, html);
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await w.loadFile(file);
    let opts;
    if (paper === 'thermal') {
      const px = await w.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
      const microns = Math.max(50000, Math.ceil(px * (25400 / 96)) + 6000);
      opts = { printBackground: true, pageSize: { width: 80 / 25.4, height: microns / 25400 } };
    } else {
      opts = { printBackground: true, preferCSSPageSize: true, pageSize: paper === 'a5' ? 'A5' : 'A4' };
    }
    const pdf = await w.webContents.printToPDF(opts);
    fs.writeFileSync(path.join(OUT, `print-${paper}.pdf`), pdf);
    const sizes = pageSizes(pdf);
    results.push({ paper, pages: sizes.length, size: sizes[0] });
    w.destroy();
  }
  console.log(JSON.stringify(results, null, 1));
  const ok = results.find((r) => r.paper === 'a5').size.wMm === 148 && results.find((r) => r.paper === 'a5').size.hMm === 210
    && results.find((r) => r.paper === 'a4').size.wMm === 210 && results.find((r) => r.paper === 'thermal').size.wMm === 80
    && results.find((r) => r.paper === 'thermal').pages === 1;
  console.log(ok ? 'PRINT CHECK OK' : 'PRINT CHECK FAILED');
  app.exit(ok ? 0 : 1);
});
