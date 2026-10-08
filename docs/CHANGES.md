# Sajawal POS 2.0 — What changed and why

This document records every change made in version 2.0: each problem found in the review
of v1.2, each of the client's 20 requests, the extra features added from research, and how
the system is now built. Issue IDs (C1, H3, …) refer to the review of v1.2.0.

The original v1.2.0 source is preserved in git history (commit `f24e3ab`, "First Commit Before Opus").

---

## 1. The big change: a real database

v1.2 kept everything in the browser's `localStorage`. That was the root cause of the most
dangerous problems: no transactions (a crash mid-sale could deduct stock without saving the
invoice), a ~10 MB size limit, no backups, and random 4-digit IDs that collided.

v2.0 stores data in **SQLite**, using the engine built into Electron itself (`node:sqlite`).
Nothing needs compiling on the client's PC.

| Guarantee | How |
|---|---|
| **Atomic** — a sale is saved completely or not at all | Every operation (sale, edit, return, import, stock change) runs in one transaction (`Store.tx`). If anything fails, everything is rolled back. |
| **Consistent** | Server-side validation; `CHECK` constraints; unique indexes for product names, barcodes, invoice numbers and customer phones; foreign keys enforced. |
| **Isolated** | A single writer (the main process) plus a single-instance lock — two copies of the app can no longer run at once. |
| **Durable** | WAL journal with `synchronous=FULL`, so a power cut can't lose a committed sale. |
| **Exact money** | Every amount is stored as whole **paisa** (integers), so totals never drift by 0.01. |
| **Proper IDs** | Auto-increment IDs (fixes the collisions in C3 and the "wrong product opens" bug, #20). |

Data file: `%APPDATA%\sajawal-pos\data\sajawal-pos.db`. This is the same `%APPDATA%\sajawal-pos`
folder v1 used, so upgrading finds the old data.

### Automatic move of old data (first start)

The first time v2.0 starts on the client's PC, it reads the v1.2 data out of `localStorage`
and imports it in **one transaction** (`src/main/services/legacy.js`). The old copy is never deleted.

While importing, it repairs v1 damage:
- products that shared a random ID are told apart by name;
- duplicate product names get a "(2)" suffix;
- products deleted in v1 that still appear on old bills come back as *archived*, so history stays complete;
- customer names on bills become real customer records;
- UTC times become Pakistan local time.

A summary dialog then shows what was imported. This is tested end to end (`scripts/smoke.js --legacy`).

---

## 2. Review issues — all fixed

### Critical
| ID | Problem in v1.2 | Fix in v2.0 |
|---|---|---|
| C1 | Sidebar stopped working after saving settings | The shell is rebuilt with event delegation; navigation is re-bound every time. |
| C2 | Excel import set **selling price = cost price** | New import with exact-match column detection that never maps a "cost" column to selling price. Shows the column mapping (editable) and a row-by-row preview with errors before saving. Tested. |
| C3 | Random 4-digit IDs collided | Database auto-increment IDs. |
| C4 | No backup; a full `localStorage` could lose a sale half-way | SQLite transactions, plus automatic backups (daily, every 3 h while open, on exit). Optional second backup folder (USB / D:). One-click restore. |
| C5 | "Load Test Mock Data" could wipe real data | Removed. "Delete all data" now needs the owner PIN (if set), typing `DELETE`, and makes a safety backup first. |
| C6 | Full-credit bills printed "Amount Paid = total" | Payments are separate records; bills print the real amounts. |
| C7 | Editing an old invoice re-priced it at today's price | Editing keeps the original sold price and cost; every edit stores a full before-snapshot (edit history). |
| C8 | A4/6×8 printed at receipt width; the 58 mm setting was ignored | Each document prints in its own hidden window with the exact paper size (see #15). Verified by `scripts/print-check.js`. |

### High
| ID | Problem | Fix |
|---|---|---|
| H1 | Search only looked at the current page | All searching and paging happen in the database (also #19). |
| H2 | Qty/discount boxes lost focus on every key; negative or >100% discounts allowed | Lines update in place without losing focus; discounts validated on screen *and* on the server. |
| H3 | UTC dates put after-midnight sales on the wrong day | Times are stored as local shop time. |
| H4 | Edit mode capped quantity at current stock; parking during an edit made a duplicate | Stock available while editing = stock + qty already on the invoice. You can't park during an edit. |
| H5 | Overselling hidden; stale drafts; deleted products silently dropped | Stock is checked inside the sale transaction and overselling is blocked (can be allowed in Settings). Drafts are re-checked on resume, with a warning for missing items. |
| H6 | Names with `'` or `"` broke buttons (e.g. D'Souza); injection risk | All screen output goes through an escaping template (`html```). No inline JavaScript. Strict Content-Security-Policy. |
| H7 | Customers identified only by typed name | Real customer records with phone numbers (phone must be unique) and fast search. |
| H8 | Repayments not linked to bills; no history, undo or receipt | Payments ledger; payments settle the oldest bills first (FIFO), so each bill shows Paid / Partly paid / Udhaar; payment receipts; voiding with a reason (logged). |
| H9 | Profit ignored discounts; losses hidden; deleted products vanished | Discounts are shared across the items on the bill; losses show; reports read sales history, not the current catalogue. |
| H10 | Import added duplicates, defaulted stock to 10, no validation | Choose what happens to duplicates (skip / add stock / update); blank = 0; every row validated. |

### Medium
| ID | Fix |
|---|---|
| M1 | Owner PIN with locked pages and locked actions (see #5). |
| M2 | Single-instance lock; navigation and new windows blocked; all permission requests denied; sandboxed renderer; strict CSP; fonts bundled (works fully offline). |
| M3 | Hard-coded `.gemini` icon path removed; app icons are generated from `build/icon.svg` (`scripts/make-icon.js`). |
| M4 | One build config in `package.json`; lockfile in sync (`electron 43.3.0`); the package contains only app files. |
| M5 | Validation for negative prices or stock, duplicate names or barcodes, and below-cost warnings. Product edits log what changed (old → new). |
| M6 | Currency symbol used everywhere; footer, terms and tagline are editable; "TAX INVOICE" changed to "INVOICE". |
| M7 | Toasts survive saving settings; silent printing to a chosen printer is optional. |
| M8 | Indexed SQL queries, debounced search, icons as inline SVG (no full-page icon scan). |
| M9 | Low-stock alerts, stock history, best sellers, recent sales, category/brand/supplier, barcodes, keyboard shortcuts, returns and cancellations. |
| M10 | SheetJS updated to **0.20.3** (fixes the known security holes in 0.18.5). |
| M11 | `.gitignore` added. Recommendation: run `git init` inside the `pos` folder (the current repo is your whole user folder). |

---

## 3. The client's 20 requests

| # | Request | What was built |
|---|---|---|
| 1 | Logs must show how many items were added or removed | Every stock change writes a movement record (`+12` / `−2`, with stock before → after) and an activity-log line: *"Added 12 pcs to 'X' (stock 10 → 22). Reason: Purchase"*. Inventory → Stock movements lists them all, with filters and an Excel export. |
| 2 | Compact bills, no signature | New receipt / A5 / A4 layouts: small type, dense tables, no signature box. An 80 mm receipt is cut to exactly the length of its content. |
| 3 | Cart jumps to the top when editing quantity | The cart is never fully redrawn; only the changed line updates, so scroll position and typing focus are kept. |
| 4 | Sales by any date or range, in charts too | A date-range picker on the dashboard, sales, reports, ledgers and logs: presets (Today, Yesterday, This week, Last 7/30/90 days, This/Last month, This year, All time) plus a custom range. The chart switches automatically between hourly, daily and monthly, and every figure is compared with the previous period. |
| 5 | Lock pages with a PIN | Owner PIN (hashed, never stored in plain text) with a recovery code. Choose which pages to lock and which actions need the PIN (edit invoice, returns, cancel, stock changes, see profit, restore, delete…). Auto-locks after N idle minutes; `Ctrl+L` locks immediately. Enforced in the main process, not only by hiding buttons. |
| 6 | Customers can see prices on the screen | Product tiles show no prices by default (a setting), and **F9** privacy mode blurs every amount on the Sell screen. Hover a line to reveal it. |
| 7 | Search inside the cart | "Find in cart" box (F6). It appears automatically once the cart has more than 3 lines. |
| 8 | Profit every way | Reports → Profit by **product, category, customer, invoice, day, month**, plus a sales summary. Net profit takes away expenses. Every report exports to Excel and prints/saves as PDF. |
| 9 | Full customer ledger | Customer page: opening balance, every bill, payment, return and refund in date order with a running balance; any date range; unpaid-bills alert; invoices, payments and products-bought tabs; printable statement (A4/A5/PDF/Excel). |
| 10 | Total products in inventory | Inventory summary: products, categories, units in stock, stock value at cost and at selling price, potential profit, needs-reorder count, expiring count. Stock valuation by category in Reports. |
| 11 | Everything about one product | Product panel: stock now, received, removed, sold, returned, sales and profit for any period; complete stock history with running balance; units sold to each customer; every invoice. |
| 12 | Collect old udhaar and the new bill together | Checkout shows the customer's old balance and a "Bill + udhaar" button. Money received above the bill pays off old udhaar automatically (or can be kept as advance). Change is worked out correctly, and the bill prints previous balance, this bill, received and balance due. |
| 13 | Sale return / cancel | Return any quantity of any line (partial returns), or cancel the whole sale. Items go back to stock (optional, e.g. not for damaged goods). The refund is calculated correctly: walk-in customers are refunded in cash; for account customers the return reduces their udhaar first and only an advance can be refunded. Return notes print. The invoice keeps its full history. |
| 14 | Previews everywhere | A Preview window (switch Receipt / A5 / A4, then Print or Save PDF) for invoices, statements, payment receipts, return notes, the sales list and every report. |
| 15 | A5 instead of 6×8; client's prints cut at top and bottom | 6×8 replaced by **A5**. The paper size is sent to the printer driver directly (no need to pick it under "Advanced"), with a safe 8 mm margin that can be changed in Settings. Printers can be chosen per document type, with optional silent printing. PDF sizes verified: A5 = 148×210 mm, A4 = 210×297 mm. |
| 16 | Sell search text kept disappearing | The search text is kept until you clear it (Esc / ×), even after switching pages. After a barcode scan the text is selected, so the next scan replaces it. |
| 17 | Gaps between product card rows | Fixed-height tile rows (`grid-auto-rows`, `align-content: start`). |
| 18 | Typing the customer name lagged | Indexed, debounced customer search (it used to recalculate every customer's balance on every key). |
| 19 | Next/Previous showed "no products" first | Search and paging done together in the database. |
| 20 | Edit opened the wrong product | Caused by the duplicate random IDs (C3). Fixed by real IDs. |

---

## 4. Added from research (leading POS systems and Pakistani retail software)

- **Barcode scanning**: scan anywhere on the Sell screen; an exact barcode match is added instantly.
- **Split payments**: Cash + EasyPaisa/JazzCash/Card/Bank Transfer on one bill. Change only comes from cash.
- **Keyboard-first billing**: F2 search, arrow keys and Enter to add, F4 customer, F6 cart search, F7 discount, F8 park, F9 privacy, F12 / Ctrl+Enter charge, Alt+1…0 pages, F1 help.
- **Day-end cash report**: collected from sales, udhaar received, refunds and expenses per day and per payment method; "cash in drawer" to compare with the counted cash.
- **Udhaar aging**: who owes what, by age (0–30, 31–60, 61–90, 90+ days) plus opening balance.
- **Expenses**: rent, bills, salaries — feed into net profit and the cash report.
- **Expiry dates** for cosmetics, with an "expiring soon" alert.
- **Receive stock** from a supplier: several products in one step, optional cost update.
- **Categories, brands, suppliers, low-stock level per product.**
- **Best sellers, needs-attention list, recent sales, top debtors** on the dashboard.
- **Payment receipts** for udhaar payments; **return notes**.
- **Unsaved-sale protection**: closing the app with items in the cart asks to park the sale.
- **Ctrl+R is disabled**, so the cart can't be lost by accident.

## 5. Interface

The interface was redesigned following common POS UX practice:
- a neutral palette with one accent (lime, used only for "Charge" and the active page);
- 1px borders instead of heavy shadows, and no gradients or glass effects;
- Inter for text and Manrope for headings, bundled so it works offline;
- tabular figures, so money columns line up;
- right-aligned numbers, a consistent status-badge system and empty states that say what to do next.

The sidebar collapses to icons on smaller or zoomed laptop screens. All screens were checked at 125–150% Windows display scaling.

## 6. Project layout

```
main.js, preload.js        Electron entry + narrow, explicit bridge (contextIsolation + sandbox)
src/main/                  Main process: database, services (business rules), backups, printing, IPC
  services/                settings, auth, products (+stock), customers (+ledger), sales (+returns, drafts),
                           payments (+expenses, activity), reports, legacy (v1 import)
index.html, css/app.css    Screen
js/core/                   Safe templating, API client, UI components, app shell, icons
js/views/                  One file per page
js/docs/docs.js            Printable documents (receipt, A5/A4 invoice, statement, reports…)
tests/                     Business-rule tests (stock, money, udhaar, returns, profit, PIN, import, migration)
scripts/                   smoke test (UI), print-check (paper sizes), icon builders
```

## 7. Commands

```
npm start              run the app (uses the real data folder)
npm test               business-logic tests (19 tests)
npm run smoke          launches the app on a throw-away data folder, opens every page/dialog, saves screenshots to smoke-out/
npm run print-check    renders receipt/A5/A4 to PDF and checks the paper sizes
npm run dist           tests + builds release/Sajawal-POS-Setup-2.0.0.exe and Sajawal-POS-Portable-2.0.0.exe
```

## 8. Upgrade notes for the client's PC

1. Close the old app.
2. Run `Sajawal-POS-Setup-2.0.0.exe`, or replace the old portable exe with `Sajawal-POS-Portable-2.0.0.exe`.
3. Start it. The "Your data has been moved" summary appears once.
4. In **Settings → Backup & data**, choose a second backup folder (USB or another drive).
5. In **Settings → Bills & printing**, pick the receipt printer and the A5 printer and press *Test print*.
6. Optional: **Settings → Security & locks** → set an owner PIN and choose the pages and actions to lock. Write the recovery code down.
