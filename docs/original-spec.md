# StockLine POS — Desktop Inventory & Billing System

A single-machine, offline-first Point of Sale application for a retail client. Handles product/stock management, flexible pricing, invoice generation with thermal printer support, and sales history — packaged as one installable `.exe`.

> Note on the name: "StockLine" is a placeholder. Rename it to whatever fits the client's shop before shipping — don't leave a generic default like "POS System" in the title bar, installer, or invoice header.

---

## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** | Packages to a single Windows `.exe` via `electron-builder`, no runtime install needed for the client. |
| UI | **React + TypeScript** | Predictable state management for a form-heavy app (products, invoices, settings). |
| Styling | **TailwindCSS** (custom config, not defaults) | Fast to build with, but only if the theme is deliberately customized — see Section 5. |
| Local DB | **SQLite via `better-sqlite3`** | Zero-config, file-based, synchronous, fast enough for single-till POS use. No server, no PHP/MySQL needed — this is fully offline. |
| Excel import | **`xlsx` (SheetJS)** | Reads `.xlsx`/`.csv` product sheets directly into the product table. |
| Thermal printing | **`node-thermal-printer`** (ESC/POS) for direct USB/network thermal printers, OR Electron's built-in `webContents.print()` with a `@media print` stylesheet sized to 58mm/80mm for driver-based thermal printers | See Section 6 — pick based on what printer the client actually has. |
| PDF invoice (optional, for email/backup) | **`pdfmake`** or `electron`'s native print-to-PDF | Only needed if the client wants a digital copy alongside the paper receipt. |
| Packaging | **`electron-builder`** | Produces a signed/unsigned NSIS installer (`.exe`) with desktop shortcut, auto-launch option. |

No PHP or Python needed here — Electron + Node covers the entire app, and avoids running a local server process the client would need to keep alive.

---

## 2. Core Features

### 2.1 Product & Stock Management
- Add product: **name, stock quantity, source (supplier), cost price**. Selling price is **optional at creation**.
- **Settings → Pricing Rule**: a global (or per-category) markup percentage (e.g. 10%, 15%, 25%). If a product has no manual selling price set, selling price = `cost price + (cost price × markup%)`, calculated live.
- If the client *does* set a manual selling price for a product, that overrides the percentage rule for that product only.
- Per-product stock tracking: current quantity, low-stock threshold with visual warning (not a generic red banner — see Section 5), stock history log (additions, sales deductions, manual adjustments).
- **Bulk import via Excel**: upload `.xlsx`/`.csv`, map columns (name, stock, source, cost price, selling price) to fields, preview before committing, flag duplicate product names before import.

### 2.2 Billing / Invoice Page
This is the page the client will use most — it needs to be fast, not just pretty.
- Search-as-you-type product picker (by name, autocomplete).
- Add product to cart with quantity; auto-calculate line total from selling price (manual or percentage-derived).
- Live-updating cart: subtotal, discount, tax (if applicable), grand total.
- **Discount**: flat amount or percentage, applied to the whole invoice.
- On confirm: deduct stock automatically, save invoice record, generate receipt.
- **Print button** → sends formatted receipt to the configured thermal printer (see Section 6).
- Every invoice is saved permanently with: invoice number, date/time, items, quantities, prices at time of sale, discount applied, total, payment method (cash/card — keep it simple, just a dropdown).

### 2.3 Sales History
- Table of past invoices, searchable/filterable by date range, product, or invoice number.
- **Edit button** on past sales — reopens the invoice for correction (e.g. wrong quantity entered). Editing should re-adjust stock accordingly (return old quantities, apply new ones) and log that the invoice was edited (with timestamp) rather than silently overwrite, so there's an audit trail.
- Option to reprint any past invoice.

### 2.4 Dashboard
Keep it useful, not decorative:
- Today's sales total, this week, this month (toggle).
- Low-stock alert list (products under threshold).
- Best-selling products (by quantity, over selectable period).
- Recent invoices (last 10, clickable to open).
- Simple sales trend chart (line or bar) — not a wall of Chart.js gradients, one clean chart is enough.

### 2.5 Settings
- Global markup percentage rule (and whether it applies store-wide or is overridden per product).
- Currency symbol.
- Business name, address, phone — used on invoice header.
- Thermal printer configuration: paper width (58mm / 80mm), printer name/connection type.
- Low-stock threshold default.

---

## 3. Data Model (SQLite)

```
products
  id, name, source, cost_price, selling_price (nullable), stock_qty,
  low_stock_threshold, category (optional), created_at, updated_at

settings
  id, markup_percentage, currency_symbol, business_name, business_address,
  business_phone, printer_width_mm, printer_name, low_stock_default

invoices
  id, invoice_number, created_at, edited_at (nullable),
  subtotal, discount_type (flat/percent), discount_value,
  total, payment_method

invoice_items
  id, invoice_id (FK), product_id (FK), product_name_snapshot,
  quantity, unit_price_snapshot, line_total

stock_log
  id, product_id (FK), change_qty, reason (sale/import/manual_adjust/edit_reversal),
  invoice_id (nullable FK), created_at
```

Storing `product_name_snapshot` and `unit_price_snapshot` on invoice items matters — if a product's name or price changes later, old invoices should still show what was actually sold at the time.

---

## 4. Folder Structure

```
stockline-pos/
├── electron/
│   ├── main.ts              # Electron main process
│   ├── preload.ts           # Context bridge (IPC)
│   └── db/
│       ├── schema.sql
│       └── db.ts            # better-sqlite3 setup + migrations
├── src/
│   ├── pages/
│   │   ├── Dashboard/
│   │   ├── Products/
│   │   ├── Billing/
│   │   ├── SalesHistory/
│   │   └── Settings/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   │   ├── pricing.ts        # markup % calculation logic
│   │   ├── excelImport.ts
│   │   └── printReceipt.ts
│   └── App.tsx
├── build/                    # electron-builder config, icons
├── package.json
└── electron-builder.yml
```

---

## 5. UI Direction — Explicit Constraints

The client's biggest ask was that this shouldn't look AI-generated. That mostly comes down to avoiding a handful of defaults:

**Avoid:**
- Purple/indigo gradient buttons and backgrounds (the single most obvious "AI dashboard" tell).
- Glassmorphism / frosted blur cards for no reason.
- Default Tailwind + shadcn theme left untouched.
- Using Inter for everything with no hierarchy.
- Generic rounded-everything cards with heavy drop shadows.
- Emoji as icons.

**Do instead:**
- Pick **one accent color** tied to the business (ask the client, or use something specific like a deep amber, teal, or burgundy — not a stock blue/purple) and use it sparingly: primary buttons, active states, key numbers. Everything else stays neutral (slate/charcoal grays, off-white background, not pure white).
- Font pairing with actual hierarchy: a distinct heading font (e.g. **Sora**, **Space Grotesk**, or **Manrope**) paired with a plain, dense body font (e.g. **IBM Plex Sans** or **Inter** — but only for body text, not headings too).
- Numbers matter most in a POS — use tabular/monospaced figures for prices and totals (e.g. `font-variant-numeric: tabular-nums`) so columns of numbers align.
- Flat design with restrained shadows — a 1px border does more work than a heavy shadow.
- Billing page should feel like a fast tool, not a marketing dashboard: large tap targets, minimal whitespace padding compared to the dashboard, keyboard-shortcut friendly (Enter to add, Esc to clear).
- Low-stock warnings: a small colored dot/badge with the accent-adjacent warning tone, not a full red banner shouting across the screen.

---

## 6. Thermal Printing — Two Approaches

Pick one based on the client's actual printer:

**Option A — Browser-style print (simpler, works with most drivers)**
Use Electron's `webContents.print()` (or `printToPDF`) on a hidden receipt window styled with CSS for the exact paper width (58mm or 80mm). Works with any thermal printer that has a Windows driver installed — which is most of them. No special printer SDK needed.

**Option B — Direct ESC/POS (more control, needed for USB/network printers without a driver)**
Use `node-thermal-printer` to send raw ESC/POS commands directly over USB or network (IP). Better for programmatic control (cut paper, cash drawer kick, barcode printing) but requires knowing the printer's connection type upfront.

Recommendation: build Option A first since it covers most real-world thermal printers with minimal integration risk, and only move to Option B if the client's printer needs it or they want cash-drawer triggering.

---

## 7. Packaging to `.exe`

```json
// package.json (relevant scripts)
"scripts": {
  "build": "vite build && electron-builder"
}
```

```yaml
# electron-builder.yml
appId: com.yourbrand.stocklinepos
productName: StockLine POS
win:
  target: nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

Output: a single NSIS installer `.exe` in `dist/` that the client double-clicks — creates a desktop shortcut, no separate runtime install, no terminal, no localhost URL.

---

## 8. Build Order (suggested)

1. SQLite schema + Electron IPC bridge for basic CRUD on products.
2. Product management page (add/edit/list) + Excel import.
3. Settings page (markup %, business info, printer config).
4. Billing page — cart logic, pricing resolution (manual vs. percentage), discount, save invoice.
5. Thermal print integration (Option A first).
6. Sales history page + edit-invoice flow with stock reversal logic.
7. Dashboard (pull from existing invoice/stock data — build last, it's just aggregation).
8. UI pass for theming (Section 5) — do this throughout, not bolted on at the end.
9. `electron-builder` packaging + test install on a clean machine.