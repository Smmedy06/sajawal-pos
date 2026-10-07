/* Sajawal POS - Main Single Store Desktop Application Controller */

class POSApp {
  constructor() {
    this.currentTab = "home"; // 'home' | 'sell' | 'reporting' | 'catalog' | 'inventory' | 'setup'
    this.activePeriod = "This Month";

    // Reporting state & Sub-tabs
    this.reportingSubTab = "sales"; // 'sales' | 'invoices' | 'credits'
    this.productBreakdownSearch = "";
    this.invoiceSearch = "";
    this.invoiceDateFilter = "";
    this.invoicesPage = 1;
    this.invoicesPerPage = 8;
    this.customerCreditSearch = "";

    // Catalog state & Pagination
    this.catalogSearch = "";
    this.catalogPage = 1;
    this.catalogPerPage = 8;

    // Inventory state & Pagination
    this.inventorySubTab = "stock"; // 'stock' | 'activity_logs'
    this.activityLogSearch = "";
    this.logsPage = 1;
    this.logsPerPage = 10;

    // Cart State
    this.cart = [];
    this.cartDiscountType = "flat";
    this.cartDiscountValue = 0;
    this.cartPaymentMethod = "Cash";
    this.cartCustomerName = "Walk-in Customer";
    this.editingInvoiceId = null;

    this.init();
  }

  init() {
    this.renderLayout();
    this.bindGlobalEvents();
    this.switchTab("home");
  }

  renderLayout() {
    const settings = db.getSettings();
    const appRoot = document.getElementById("app-root");

    appRoot.innerHTML = `
      <!-- Toast Container -->
      <div id="toast-container"></div>

      <!-- Sidebar Navigation -->
      <aside class="sidebar">
        <div>
          <div class="sidebar-header">
            <div class="sidebar-brand">
              <span>SAJAWAL POS</span>
            </div>
          </div>

          <ul class="sidebar-menu">
            <li class="sidebar-item active" data-tab="home">
              <div class="sidebar-item-left">
                <i data-lucide="layout-grid"></i>
                <span>Home</span>
              </div>
            </li>

            <li class="sidebar-item" data-tab="sell">
              <div class="sidebar-item-left">
                <i data-lucide="dollar-sign"></i>
                <span>Sell</span>
              </div>
            </li>

            <li class="sidebar-item" data-tab="reporting">
              <div class="sidebar-item-left">
                <i data-lucide="bar-chart-2"></i>
                <span>Reporting & Udhaar</span>
              </div>
            </li>

            <li class="sidebar-item" data-tab="catalog">
              <div class="sidebar-item-left">
                <i data-lucide="shopping-cart"></i>
                <span>Catalog</span>
              </div>
            </li>

            <li class="sidebar-item" data-tab="inventory">
              <div class="sidebar-item-left">
                <i data-lucide="package"></i>
                <span>Inventory & Logs</span>
              </div>
            </li>

            <li class="sidebar-item" data-tab="setup">
              <div class="sidebar-item-left">
                <i data-lucide="settings"></i>
                <span>Setup</span>
              </div>
            </li>
          </ul>
        </div>

        <div class="sidebar-footer">
          <div class="user-profile">
            <div class="user-avatar">${settings.cashier_name.charAt(0)}</div>
            <div class="user-info">
              <span class="user-name">${settings.cashier_name}</span>
              <span class="user-role">Till Manager</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main Canvas Area -->
      <main class="main-content" id="main-content">
        <!-- Rendered dynamically -->
      </main>

      <!-- Modal Container -->
      <div id="modal-container"></div>
    `;

    lucide.createIcons();
  }

  bindGlobalEvents() {
    document.querySelectorAll(".sidebar-item").forEach(item => {
      item.addEventListener("click", () => {
        const tab = item.getAttribute("data-tab");
        this.switchTab(tab);
      });
    });

    document.addEventListener("click", (e) => {
      const popup = document.getElementById("customer-suggestions-popup");
      const input = document.getElementById("checkout-customer-name");
      if (popup && input && !input.contains(e.target) && !popup.contains(e.target)) {
        popup.style.display = "none";
      }
    });
  }

  // Clear search states on tab switch (Point #2)
  resetSearchStates() {
    this.productBreakdownSearch = "";
    this.invoiceSearch = "";
    this.invoiceDateFilter = "";
    this.catalogSearch = "";
    this.activityLogSearch = "";
    this.customerCreditSearch = "";
    this.invoicesPage = 1;
    this.catalogPage = 1;
    this.logsPage = 1;
  }

  // -------------------------------------------------------------
  // CUSTOM UI TOASTS & MODAL DIALOGS
  // -------------------------------------------------------------
  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast-message ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
    toast.innerHTML = `
      <i data-lucide="${type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info'}" style="width: 18px; height: 18px;"></i>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-10px)";
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  showConfirmModal(title, message, onConfirm) {
    document.getElementById("modal-container").innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card" style="max-width: 440px;">
          <div class="modal-header">
            <h3>${title}</h3>
            <button class="modal-close" onclick="app.closeModal()">&times;</button>
          </div>
          <div style="font-size: 0.92rem; color: var(--text-main); margin-bottom: 20px; line-height: 1.4;">
            ${message}
          </div>
          <div style="display: flex; gap: 12px;">
            <button class="btn-secondary" style="flex: 1;" onclick="app.closeModal()">Cancel</button>
            <button class="btn-danger" style="flex: 1;" id="confirm-modal-btn">Confirm Action</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById("confirm-modal-btn").addEventListener("click", () => {
      this.closeModal();
      onConfirm();
    });
  }

  showPromptModal(title, message, defaultValue, onSubmit) {
    document.getElementById("modal-container").innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card" style="max-width: 460px;">
          <div class="modal-header">
            <h3>${title}</h3>
            <button class="modal-close" onclick="app.closeModal()">&times;</button>
          </div>
          <form onsubmit="app.submitPromptForm(event)">
            <div class="form-group">
              <label>${message}</label>
              <input type="text" id="prompt-modal-input" value="${defaultValue}" required autofocus>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 20px;">
              <button type="button" class="btn-secondary" style="flex: 1;" onclick="app.closeModal()">Cancel</button>
              <button type="submit" class="btn-primary" style="flex: 1;">Save</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this._promptOnSubmit = onSubmit;
  }

  submitPromptForm(e) {
    e.preventDefault();
    const val = document.getElementById("prompt-modal-input").value;
    this.closeModal();
    if (this._promptOnSubmit) this._promptOnSubmit(val);
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    this.resetSearchStates(); // Clean search filter state on page switch (Point #2)

    document.querySelectorAll(".sidebar-item").forEach(item => {
      if (item.getAttribute("data-tab") === tabName) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    const main = document.getElementById("main-content");
    if (main) main.scrollTop = 0;

    switch (tabName) {
      case "home":
        this.renderHome(main);
        break;
      case "sell":
        this.renderSell(main);
        break;
      case "reporting":
        this.renderReporting(main);
        break;
      case "catalog":
        this.renderCatalog(main);
        break;
      case "inventory":
        this.renderInventory(main);
        break;
      case "setup":
        this.renderSetup(main);
        break;
      default:
        this.renderHome(main);
    }

    lucide.createIcons();
  }

  // -------------------------------------------------------------
  // 1. HOME SCREEN
  // -------------------------------------------------------------
  renderHome(container) {
    const settings = db.getSettings();
    const sales = db.getSales();

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthStr = now.toISOString().slice(0, 7);

    // Calculate start of current week (Monday)
    const dayOfWeek = now.getDay();
    const diffToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() + diffToMon);

    const periodSales = sales.filter(s => {
      if (!s.created_at) return false;
      const sDateStr = s.created_at.slice(0, 10);
      if (this.activePeriod === "Today") {
        return sDateStr === todayStr;
      } else if (this.activePeriod === "This Week") {
        return new Date(s.created_at) >= startOfWeek;
      } else { // This Month
        return s.created_at.slice(0, 7) === monthStr;
      }
    });

    let periodRevenue = 0;
    let periodCreditDue = 0;
    periodSales.forEach(s => {
      periodRevenue += (s.total || 0);
      periodCreditDue += (s.credit_amount || 0);
    });

    const avgSaleValue = periodSales.length > 0 ? Math.round(periodRevenue / periodSales.length) : 0;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Hi, ${settings.cashier_name}! Welcome to ${settings.business_name}</h1>
          <p>${settings.business_address}</p>
        </div>
        <div class="header-controls">
          <div class="period-pill-group">
            <button class="period-btn ${this.activePeriod === 'Today' ? 'active' : ''}" onclick="app.setPeriod('Today')">Today</button>
            <button class="period-btn ${this.activePeriod === 'This Week' ? 'active' : ''}" onclick="app.setPeriod('This Week')">This Week</button>
            <button class="period-btn ${this.activePeriod === 'This Month' ? 'active' : ''}" onclick="app.setPeriod('This Month')">This Month</button>
          </div>
        </div>
      </div>

      <div class="card" style="width: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
          <div>
            <div style="font-size: 0.88rem; font-weight: 600; color: var(--text-muted);">${this.activePeriod} Store Revenue</div>
            <div class="metric-hero num-pk">${settings.currency_symbol} ${periodRevenue.toLocaleString()}</div>
            <div style="display: flex; gap: 16px; margin-top: 6px;">
              <span style="font-size: 0.85rem; color: var(--brand-green); font-weight: 600;">
                Completed Sales: ${periodSales.length} Invoices
              </span>
              ${periodCreditDue > 0 ? `
                <span style="font-size: 0.85rem; color: var(--brand-red); font-weight: 700;">
                  Period Udhaar / Credit Due: ${settings.currency_symbol} ${periodCreditDue.toLocaleString()}
                </span>
              ` : ''}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-muted);">Average Sale Value</div>
            <div class="num-pk" style="font-size: 1.4rem; font-weight: 800;">${settings.currency_symbol} ${avgSaleValue.toLocaleString()}</div>
          </div>
        </div>

        <div style="height: 340px; width: 100%; position: relative;">
          <canvas id="salesTrendChart"></canvas>
        </div>
      </div>
    `;

    setTimeout(() => this.renderHomeChart(), 50);
  }

  setPeriod(p) {
    this.activePeriod = p;
    this.renderHome(document.getElementById("main-content"));
  }

  renderHomeChart() {
    const ctx = document.getElementById('salesTrendChart');
    if (!ctx) return;

    if (this._homeChartInstance) {
      this._homeChartInstance.destroy();
      this._homeChartInstance = null;
    }

    const sales = db.getSales();
    const settings = db.getSettings();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthStr = now.toISOString().slice(0, 7);

    // Calculate start of current week (Monday)
    const dayOfWeek = now.getDay();
    const diffToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() + diffToMon);

    let labels = [];
    let values = [];

    if (this.activePeriod === "Today") {
      labels = ['9 AM', '11 AM', '1 PM', '3 PM', '5 PM', '7 PM', '9 PM'];
      values = [0, 0, 0, 0, 0, 0, 0];

      sales.forEach(s => {
        if (s.created_at && s.created_at.slice(0, 10) === todayStr) {
          const hour = new Date(s.created_at).getHours();
          let idx = 0;
          if (hour < 10) idx = 0;
          else if (hour < 12) idx = 1;
          else if (hour < 14) idx = 2;
          else if (hour < 16) idx = 3;
          else if (hour < 18) idx = 4;
          else if (hour < 20) idx = 5;
          else idx = 6;
          values[idx] += (s.total || 0);
        }
      });
    } else if (this.activePeriod === "This Week") {
      labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      values = [0, 0, 0, 0, 0, 0, 0];

      sales.forEach(s => {
        if (s.created_at) {
          const sDate = new Date(s.created_at);
          if (sDate >= startOfWeek) {
            let dow = sDate.getDay();
            let idx = (dow === 0 ? 6 : dow - 1);
            values[idx] += (s.total || 0);
          }
        }
      });
    } else {
      labels = ['1st-5th', '6th-10th', '11th-15th', '16th-20th', '21st-25th', '26th-End'];
      values = [0, 0, 0, 0, 0, 0];

      sales.forEach(s => {
        if (s.created_at && s.created_at.slice(0, 7) === monthStr) {
          const day = new Date(s.created_at).getDate();
          let idx = 0;
          if (day <= 5) idx = 0;
          else if (day <= 10) idx = 1;
          else if (day <= 15) idx = 2;
          else if (day <= 20) idx = 3;
          else if (day <= 25) idx = 4;
          else idx = 5;
          values[idx] += (s.total || 0);
        }
      });
    }

    this._homeChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: `Sales (${settings.currency_symbol})`,
          data: values,
          borderColor: '#84cc16',
          backgroundColor: 'rgba(132, 204, 22, 0.15)',
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: '#e5e5dc' },
            beginAtZero: true,
            suggestedMax: values.every(v => v === 0) ? 10000 : undefined
          }
        }
      }
    });
  }

  // -------------------------------------------------------------
  // 2. SELL / POS BILLING SCREEN (DOM-Preserving Live Filter)
  // -------------------------------------------------------------
  renderSell(container) {
    container.innerHTML = `
      <div class="billing-layout">
        <div class="pos-catalog-panel">
          <div class="pos-search-bar">
            <i data-lucide="search"></i>
            <input type="text" id="pos-search-input" placeholder="Search products by name..."
                   oninput="app.onSellSearchInput(this.value)">
          </div>

          <div class="product-cards-grid" id="product-cards-grid">
            <!-- Dynamic Cards -->
          </div>
        </div>

        <div class="pos-cart-panel" id="pos-cart-panel">
          <!-- Dynamic Cart -->
        </div>
      </div>
    `;

    this.renderProductGrid();
    this.renderCartPanel();
    lucide.createIcons();
  }

  // DOM preserving live search - No re-rendering input (Points #2 & #3)
  onSellSearchInput(q) {
    const query = q.toLowerCase();
    const cards = document.querySelectorAll(".product-card");
    cards.forEach(card => {
      const name = card.getAttribute("data-name") || "";
      if (name.toLowerCase().includes(query)) {
        card.style.display = "flex";
      } else {
        card.style.display = "none";
      }
    });
  }

  renderProductGrid() {
    const grid = document.getElementById("product-cards-grid");
    if (!grid) return;

    const settings = db.getSettings();
    const products = db.getProducts();

    grid.innerHTML = products.map(prod => {
      const effectivePrice = db.getEffectivePrice(prod, settings.markup_percentage);
      const isManualPrice = prod.selling_price !== null;
      const isOut = prod.stock_qty === 0;

      return `
        <div class="product-card" data-name="${prod.name}" title="${prod.name}" onclick="app.addToCart('${prod.id}')">
          <span class="product-badge-stock ${isOut ? 'stock-out' : 'stock-good'}">
            ${isOut ? 'Out of Stock' : `${prod.stock_qty} in stock`}
          </span>
          <div class="product-title">${prod.name}</div>
          <div class="product-price-row">
            <span class="product-price num-pk">${settings.currency_symbol} ${effectivePrice.toLocaleString()}</span>
            <span class="markup-pill">${isManualPrice ? 'Manual' : `${settings.markup_percentage}% markup`}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  renderCartPanel() {
    const panel = document.getElementById("pos-cart-panel");
    if (!panel) return;

    const settings = db.getSettings();
    const drafts = db.getDrafts();

    let cartSubtotal = 0;
    this.cart.forEach(item => {
      const stdPrice = db.getEffectivePrice(item.product, settings.markup_percentage);
      const price = (item.custom_unit_price !== undefined && item.custom_unit_price !== null && item.custom_unit_price !== "") ? Number(item.custom_unit_price) : stdPrice;
      cartSubtotal += price * item.quantity;
    });

    let discountAmount = 0;
    if (this.cartDiscountType === "percent") {
      discountAmount = (cartSubtotal * Number(this.cartDiscountValue)) / 100;
    } else {
      discountAmount = Number(this.cartDiscountValue) || 0;
    }

    const grandTotal = Math.round(Math.max(0, cartSubtotal - discountAmount));

    panel.innerHTML = `
      <div class="cart-header">
        <h3>Current Sale</h3>
        <div style="display: flex; gap: 6px;">
          <button class="btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;"
                  onclick="app.parkCurrentSale()" ${this.cart.length === 0 ? 'disabled style="opacity:0.5;"' : ''}>
            <i data-lucide="bookmark" style="width: 12px;"></i> Park
          </button>
          
          <button class="btn-secondary" style="padding: 3px 8px; font-size: 0.75rem; position: relative;" onclick="app.showDraftsModal()">
            <i data-lucide="folder-open" style="width: 12px;"></i> Drafts
            ${drafts.length > 0 ? `<span style="background: var(--brand-amber); color: #fff; border-radius: 10px; padding: 1px 5px; font-size: 0.7rem; font-weight: 800; margin-left: 3px;">${drafts.length}</span>` : ''}
          </button>

          <button class="btn-secondary" style="padding: 3px 8px; font-size: 0.75rem; color: var(--brand-red);" onclick="app.clearCart()">Clear</button>
        </div>
      </div>

      ${this.editingInvoiceId ? `
        <div class="editing-banner">
          <span>Editing ${this.editingInvoiceId}</span>
          <button style="background: none; border: none; color: #b45309; font-weight: bold; cursor: pointer;" onclick="app.cancelEditingMode()">Cancel Edit</button>
        </div>
      ` : ''}

      <div class="cart-items-list">
        ${this.cart.length === 0 ? `
          <div style="text-align: center; color: var(--text-muted); margin-top: 50px;">
            <i data-lucide="shopping-bag" style="width: 40px; height: 40px; color: var(--text-muted);"></i>
            <p style="margin-top: 10px; font-size: 0.88rem;">Cart is empty. Click products to add.</p>
          </div>
        ` : this.cart.map((item, index) => {
          const stdPrice = db.getEffectivePrice(item.product, settings.markup_percentage);
          const price = (item.custom_unit_price !== undefined && item.custom_unit_price !== null && item.custom_unit_price !== "") ? Number(item.custom_unit_price) : stdPrice;
          const hasCustomPrice = (item.custom_unit_price !== undefined && item.custom_unit_price !== null && item.custom_unit_price !== "" && Number(item.custom_unit_price) !== stdPrice);
          const lineTotal = price * item.quantity;
          return `
            <div class="cart-item" data-id="${item.product.id}">
              <div class="cart-item-header">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                  <span class="cart-item-sr">#${index + 1}</span>
                  <span class="cart-item-name" title="${item.product.name}">${item.product.name}</span>
                </div>
                <button class="cart-delete-btn" title="Remove item" onclick="app.removeFromCart('${item.product.id}')">&times;</button>
              </div>

              <div class="cart-item-controls">
                <div class="cart-item-price-wrap" title="Click to manually edit unit price">
                  <span class="price-symbol">${settings.currency_symbol}</span>
                  <input type="number" class="cart-unit-input ${hasCustomPrice ? 'custom-price-active' : ''}"
                         value="${price}" step="any" min="0"
                         onchange="app.updateCartItemPrice('${item.product.id}', this.value)"
                         oninput="app.onCartItemPriceInput('${item.product.id}', this.value)">
                  ${hasCustomPrice ? `
                    <button class="cart-price-reset-btn" title="Reset to standard catalog price (${settings.currency_symbol} ${stdPrice.toLocaleString()})" onclick="app.resetCartItemPrice('${item.product.id}')">
                      &olarr;
                    </button>
                  ` : ''}
                </div>

                <div class="cart-qty-ctrl">
                  <button class="cart-qty-btn" onclick="app.updateQty('${item.product.id}', ${item.quantity - 1})">-</button>
                  <input type="number" class="cart-qty-input" value="${item.quantity}" min="1" max="${item.product.stock_qty}"
                         onchange="app.onCartQtyInputChange('${item.product.id}', this.value)"
                         oninput="app.onCartQtyInputChange('${item.product.id}', this.value)">
                  <button class="cart-qty-btn" onclick="app.updateQty('${item.product.id}', ${item.quantity + 1})">+</button>
                </div>

                <div class="cart-item-total num-pk">
                  ${settings.currency_symbol} ${lineTotal.toLocaleString()}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="cart-summary">
        <div class="summary-row">
          <span>Subtotal</span>
          <span class="num-pk">${settings.currency_symbol} ${cartSubtotal.toLocaleString()}</span>
        </div>

        <div class="summary-row">
          <span>Discount</span>
          <div style="display: flex; gap: 6px;">
            <select style="width: 65px; padding: 4px 6px; font-size: 0.8rem;" onchange="app.setDiscountType(this.value)">
              <option value="flat" ${this.cartDiscountType === 'flat' ? 'selected' : ''}>Rs.</option>
              <option value="percent" ${this.cartDiscountType === 'percent' ? 'selected' : ''}>%</option>
            </select>
            <input type="number" style="width: 75px; padding: 4px 6px; font-size: 0.85rem;"
                   value="${this.cartDiscountValue}" oninput="app.setDiscountValue(this.value)">
          </div>
        </div>

        <div class="summary-row">
          <span>Payment Method</span>
          <select style="width: 140px; padding: 4px 6px; font-size: 0.8rem;" onchange="app.setPaymentMethod(this.value)">
            <option value="Cash" ${this.cartPaymentMethod === 'Cash' ? 'selected' : ''}>Cash</option>
            <option value="Transfer" ${this.cartPaymentMethod === 'Transfer' ? 'selected' : ''}>Transfer</option>
            <option value="Credit / Udhaar" ${this.cartPaymentMethod === 'Credit / Udhaar' ? 'selected' : ''}>Credit / Udhaar</option>
          </select>
        </div>

        <div class="summary-row grand-total">
          <span>Grand Total</span>
          <span class="num-pk">${settings.currency_symbol} ${grandTotal.toLocaleString()}</span>
        </div>

        <button class="btn-primary" style="width: 100%; margin-top: 6px; padding: 12px;"
                onclick="app.showCheckoutModal(${grandTotal})" ${this.cart.length === 0 ? 'disabled style="opacity:0.5;"' : ''}>
          <i data-lucide="check-circle"></i>
          <span>${this.editingInvoiceId ? 'UPDATE SALE' : 'COMPLETE SALE'}</span>
        </button>
      </div>
    `;

    lucide.createIcons();
  }

  addToCart(id) {
    const product = db.getProducts().find(p => p.id === id);
    if (!product || product.stock_qty === 0) return;
    const existing = this.cart.find(i => i.product.id === id);
    if (existing) {
      if (existing.quantity < product.stock_qty) {
        existing.quantity++;
      } else {
        this.showToast(`Maximum stock for ${product.name} is ${product.stock_qty} pcs`, "error");
      }
    } else {
      this.cart.push({ product, quantity: 1 });
    }
    this.renderCartPanel();
    this.scrollCartToBottom();
  }

  scrollCartToBottom() {
    setTimeout(() => {
      const list = document.querySelector('.cart-items-list');
      if (list) {
        list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      }
    }, 40);
  }

  updateQty(id, qty) {
    const item = this.cart.find(i => i.product.id === id);
    if (!item) return;

    if (qty <= 0) {
      this.removeFromCart(id);
    } else if (qty > item.product.stock_qty) {
      this.showToast(`Cannot exceed ${item.product.stock_qty} pcs available stock`, "error");
      item.quantity = item.product.stock_qty;
      this.renderCartPanel();
    } else {
      item.quantity = qty;
      this.renderCartPanel();
    }
  }

  onCartQtyInputChange(id, val) {
    const item = this.cart.find(i => i.product.id === id);
    if (!item) return;

    let num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) return;

    if (num > item.product.stock_qty) {
      num = item.product.stock_qty;
      this.showToast(`Capped to max ${item.product.stock_qty} pcs in stock`, "error");
    }

    item.quantity = num;
    this.renderCartPanel();
  }

  onCartItemPriceInput(id, val) {
    const item = this.cart.find(i => i.product.id === id);
    if (!item) return;

    const settings = db.getSettings();
    const stdPrice = db.getEffectivePrice(item.product, settings.markup_percentage);
    let num = parseFloat(val);

    if (isNaN(num) || num < 0) {
      item.custom_unit_price = null;
    } else {
      item.custom_unit_price = num;
    }

    let cartSubtotal = 0;
    this.cart.forEach(ci => {
      const ciStd = db.getEffectivePrice(ci.product, settings.markup_percentage);
      const ciPrice = (ci.custom_unit_price !== undefined && ci.custom_unit_price !== null && ci.custom_unit_price !== "") ? Number(ci.custom_unit_price) : ciStd;
      cartSubtotal += ciPrice * ci.quantity;
    });

    let discountAmount = 0;
    if (this.cartDiscountType === "percent") {
      discountAmount = (cartSubtotal * Number(this.cartDiscountValue)) / 100;
    } else {
      discountAmount = Number(this.cartDiscountValue) || 0;
    }
    const grandTotal = Math.round(Math.max(0, cartSubtotal - discountAmount));

    const effectiveUnit = (item.custom_unit_price !== null && item.custom_unit_price !== undefined && item.custom_unit_price !== "") ? Number(item.custom_unit_price) : stdPrice;
    const lineTotal = effectiveUnit * item.quantity;

    const itemEl = document.querySelector(`.cart-item[data-id="${item.product.id}"]`);
    if (itemEl) {
      const lineTotEl = itemEl.querySelector('.cart-item-total');
      if (lineTotEl) lineTotEl.textContent = `${settings.currency_symbol} ${lineTotal.toLocaleString()}`;

      const priceInput = itemEl.querySelector('.cart-unit-input');
      if (priceInput) {
        if (effectiveUnit !== stdPrice) {
          priceInput.classList.add('custom-price-active');
        } else {
          priceInput.classList.remove('custom-price-active');
        }
      }
    }

    const subTotEl = document.querySelector('.cart-summary .summary-row:first-child .num-pk');
    if (subTotEl) subTotEl.textContent = `${settings.currency_symbol} ${cartSubtotal.toLocaleString()}`;

    const grandTotEl = document.querySelector('.cart-summary .grand-total .num-pk');
    if (grandTotEl) grandTotEl.textContent = `${settings.currency_symbol} ${grandTotal.toLocaleString()}`;
  }

  updateCartItemPrice(id, val) {
    const item = this.cart.find(i => i.product.id === id);
    if (!item) return;

    const settings = db.getSettings();
    const stdPrice = db.getEffectivePrice(item.product, settings.markup_percentage);
    let num = parseFloat(val);

    if (isNaN(num) || num < 0 || num === stdPrice) {
      item.custom_unit_price = null;
    } else {
      item.custom_unit_price = num;
    }

    this.renderCartPanel();
  }

  resetCartItemPrice(id) {
    const item = this.cart.find(i => i.product.id === id);
    if (!item) return;
    item.custom_unit_price = null;
    this.renderCartPanel();
  }

  removeFromCart(id) {
    this.cart = this.cart.filter(i => i.product.id !== id);
    this.renderCartPanel();
  }

  clearCart() {
    this.cart = [];
    this.editingInvoiceId = null;
    this.cartDiscountValue = 0;
    this.cartPaymentMethod = "Cash";
    this.cartCustomerName = "Walk-in Customer";
    this.renderCartPanel();
  }

  cancelEditingMode() {
    this.cart = [];
    this.editingInvoiceId = null;
    this.cartDiscountValue = 0;
    this.cartPaymentMethod = "Cash";
    this.cartCustomerName = "Walk-in Customer";
    this.renderCartPanel();
  }

  setDiscountType(t) { this.cartDiscountType = t; this.renderCartPanel(); }
  setDiscountValue(v) { this.cartDiscountValue = Number(v) || 0; this.renderCartPanel(); }
  setPaymentMethod(m) { this.cartPaymentMethod = m; }

  // -------------------------------------------------------------
  // PARK SALE / DRAFTS MODAL (Real-time Draft Badge Update - Point #5)
  // -------------------------------------------------------------
  parkCurrentSale() {
    if (this.cart.length === 0) return;
    
    this.showPromptModal(
      "Park Order Draft",
      "Enter Customer Name / Reference to identify this parked draft:",
      this.cartCustomerName !== "Walk-in Customer" ? this.cartCustomerName : "",
      (custName) => {
        db.saveDraft(this.cart, this.cartDiscountType, this.cartDiscountValue, this.cartPaymentMethod, custName || "Walk-in Customer");
        this.showToast("Order parked in Drafts!", "success");
        this.clearCart(); // Triggers renderCartPanel and updates Draft badge!
      }
    );
  }

  showDraftsModal() {
    const drafts = db.getDrafts();

    document.getElementById("modal-container").innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card" style="max-width: 620px;">
          <div class="modal-header">
            <h3>Parked Order Drafts</h3>
            <button class="modal-close" onclick="app.closeModal()">&times;</button>
          </div>

          ${drafts.length === 0 ? `
            <div style="text-align: center; color: var(--text-muted); padding: 40px;">
              <i data-lucide="folder-open" style="width: 44px; height: 44px; color: var(--text-muted);"></i>
              <p style="margin-top: 10px; font-weight: 600;">No parked sales drafts available.</p>
            </div>
          ` : `
            <div style="max-height: 380px; overflow-y: auto; margin-bottom: 10px;">
              <table class="pos-table">
                <thead>
                  <tr>
                    <th>TIME</th>
                    <th>CUSTOMER</th>
                    <th>ITEMS</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  ${drafts.map(d => `
                    <tr>
                      <td>${new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                      <td style="font-weight: 700;">${d.customer_name}</td>
                      <td>${d.item_count} pcs</td>
                      <td>
                        <button class="btn-primary" style="padding: 4px 10px; font-size: 0.78rem;" onclick="app.resumeDraft('${d.id}')">
                          <i data-lucide="play" style="width: 12px;"></i> Resume
                        </button>
                        <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.78rem; color: var(--brand-red);" onclick="app.deleteDraftConfirm('${d.id}')">
                          Delete
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
    lucide.createIcons();
  }

  resumeDraft(draftId) {
    const draft = db.getDrafts().find(d => d.id === draftId);
    if (!draft) return;

    if (this.cart.length > 0) {
      this.showConfirmModal(
        "Replace Active Cart?",
        "Resuming this draft will replace items currently in your cart. Continue?",
        () => this.doResumeDraft(draft)
      );
    } else {
      this.doResumeDraft(draft);
    }
  }

  doResumeDraft(draft) {
    this.cart = draft.cart;
    this.cartDiscountType = draft.discount_type || "flat";
    this.cartDiscountValue = draft.discount_value || 0;
    this.cartPaymentMethod = draft.payment_method || "Cash";
    this.cartCustomerName = draft.customer_name || "Walk-in Customer";

    db.deleteDraft(draft.id);
    this.closeModal();
    this.renderCartPanel(); // Updates Draft badge immediately! (Point #5)
    this.showToast("Draft restored into cart!", "success");
  }

  // Real-time Draft Badge Update on Delete (Point #5)
  deleteDraftConfirm(draftId) {
    this.showConfirmModal(
      "Delete Draft?",
      "Are you sure you want to permanently delete this parked draft?",
      () => {
        db.deleteDraft(draftId);
        this.renderCartPanel(); // Update Draft badge count on Sell panel! (Point #5)
        this.showDraftsModal();
        this.showToast("Draft deleted.", "info");
      }
    );
  }

  // -------------------------------------------------------------
  // CHECKOUT MODAL
  // -------------------------------------------------------------
  showCheckoutModal(grandTotal) {
    const settings = db.getSettings();
    const initialPaid = this.cartPaymentMethod === "Credit / Udhaar" ? 0 : grandTotal;
    const existingCustomers = db.getUniqueCustomerNames();

    document.getElementById("modal-container").innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <h3>${this.editingInvoiceId ? `Update ${this.editingInvoiceId}` : 'Complete Checkout'}</h3>
            <button class="modal-close" onclick="app.closeModal()">&times;</button>
          </div>

          <div class="form-group">
            <label>Grand Total</label>
            <div class="metric-hero num-pk" style="color: var(--brand-green);">${settings.currency_symbol} ${grandTotal.toLocaleString()}</div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Payment Method</label>
              <select id="checkout-payment-method" onchange="app.onCheckoutMethodChange(${grandTotal}, this.value)">
                <option value="Cash" ${this.cartPaymentMethod === 'Cash' ? 'selected' : ''}>Cash</option>
                <option value="Transfer" ${this.cartPaymentMethod === 'Transfer' ? 'selected' : ''}>Transfer</option>
                <option value="Credit / Udhaar" ${this.cartPaymentMethod === 'Credit / Udhaar' ? 'selected' : ''}>Credit / Udhaar</option>
              </select>
            </div>
            <div class="form-group">
              <label>Amount Paid / Received (Rs.)</label>
              <input type="number" id="cash-received-input" value="${initialPaid}" oninput="app.calcCheckoutBalance(${grandTotal})">
            </div>
          </div>

          <div class="form-group">
            <label>Customer Name / Phone Number ${this.cartPaymentMethod === 'Credit / Udhaar' ? '<span style="color:red">* (Required for Credit)</span>' : ''}</label>
            <div class="customer-input-container">
              <input type="text" id="checkout-customer-name" value="${this.cartCustomerName}" placeholder="Type customer name..."
                     oninput="app.onCheckoutCustomerInput(this.value, ${grandTotal})"
                     onfocus="app.onCheckoutCustomerInput(this.value, ${grandTotal})"
                     autocomplete="off">
              <div id="customer-suggestions-popup" class="customer-suggestions-popup" style="display: none;"></div>
            </div>
          </div>

          <div id="checkout-udhaar-summary-box" style="margin-bottom: 16px; display: none;"></div>

          <div class="form-row" style="background: #f9f9f6; padding: 12px; border-radius: 12px; margin-bottom: 16px;">
            <div>
              <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);">CHANGE RETURN</div>
              <div class="num-pk" id="change-return-display" style="font-size: 1.2rem; font-weight: 800; color: var(--brand-green);">${settings.currency_symbol} 0</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);">REMAINING CREDIT DUE</div>
              <div class="num-pk" id="credit-due-display" style="font-size: 1.2rem; font-weight: 800; color: var(--brand-red);">${settings.currency_symbol} 0</div>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; gap: 8px;">
              <button class="btn-secondary" style="flex: 1;" onclick="app.closeModal()">Cancel</button>
              <button class="btn-primary" style="flex: 1.5; background: #374151;" onclick="app.processCheckoutSubmit(${grandTotal}, false, false, false)">
                Save Only (No Print)
              </button>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn-primary btn-success" style="flex: 1; padding: 8px 6px; font-size: 0.8rem;" onclick="app.processCheckoutSubmit(${grandTotal}, true, false, false)">
                <i data-lucide="printer" style="width: 14px;"></i> Thermal (80mm)
              </button>
              <button class="btn-primary" style="flex: 1; background: #0891b2; padding: 8px 6px; font-size: 0.8rem;" onclick="app.processCheckoutSubmit(${grandTotal}, false, false, true)">
                <i data-lucide="file" style="width: 14px;"></i> 6" × 8" Invoice
              </button>
              <button class="btn-primary" style="flex: 1; background: #1e3a8a; padding: 8px 6px; font-size: 0.8rem;" onclick="app.processCheckoutSubmit(${grandTotal}, false, true, false)">
                <i data-lucide="file-text" style="width: 14px;"></i> A4 Invoice
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    lucide.createIcons();
    this.calcCheckoutBalance(grandTotal);
  }

  onCheckoutMethodChange(grandTotal, method) {
    this.cartPaymentMethod = method;
    const paidInput = document.getElementById("cash-received-input");
    if (paidInput) {
      if (method === "Credit / Udhaar") {
        paidInput.value = 0;
      } else {
        paidInput.value = grandTotal;
      }
    }
    this.calcCheckoutBalance(grandTotal);
  }

  onCheckoutCustomerInput(val, grandTotal) {
    this.cartCustomerName = val;
    this.calcCheckoutBalance(grandTotal);

    const query = val.trim().toLowerCase();
    const popup = document.getElementById("customer-suggestions-popup");
    if (!popup) return;

    const allCustomers = db.getUniqueCustomerNames();
    const matching = query ? allCustomers.filter(c => c.toLowerCase().includes(query)) : allCustomers;

    if (matching.length === 0) {
      popup.style.display = "none";
      popup.innerHTML = "";
      return;
    }

    const settings = db.getSettings();
    popup.innerHTML = matching.map(name => {
      const prevCredit = db.getCustomerPreviousCredit(name, this.editingInvoiceId);
      const nameEscaped = name.replace(/'/g, "\\'");
      return `
        <div class="suggestion-item" onclick="app.selectCustomerSuggestion('${nameEscaped}', ${grandTotal})">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i data-lucide="user" style="width: 14px; height: 14px; color: var(--text-muted);"></i>
            <span style="font-weight: 600; font-size: 0.88rem; color: var(--text-main);">${name}</span>
          </div>
          ${prevCredit > 0 ? `
            <span style="font-size: 0.72rem; color: #b91c1c; font-weight: 700; background: #fee2e2; padding: 2px 6px; border-radius: 6px;">
              Udhaar: ${settings.currency_symbol} ${prevCredit.toLocaleString()}
            </span>
          ` : `
            <span style="font-size: 0.72rem; color: #166534; font-weight: 600; background: #f0fdf4; padding: 2px 6px; border-radius: 6px;">
              Clear
            </span>
          `}
        </div>
      `;
    }).join('');

    popup.style.display = "block";
    lucide.createIcons();
  }

  selectCustomerSuggestion(name, grandTotal) {
    this.cartCustomerName = name;
    const input = document.getElementById("checkout-customer-name");
    if (input) input.value = name;

    const popup = document.getElementById("customer-suggestions-popup");
    if (popup) popup.style.display = "none";

    this.calcCheckoutBalance(grandTotal);
  }

  calcCheckoutBalance(grandTotal) {
    const settings = db.getSettings();
    const paidInput = document.getElementById("cash-received-input");
    const customerInput = document.getElementById("checkout-customer-name");
    const custName = customerInput ? customerInput.value.trim() : "Walk-in Customer";
    const rec = paidInput ? Number(paidInput.value) || 0 : grandTotal;

    const changeReturn = Math.max(0, rec - grandTotal);
    const creditDue = Math.max(0, grandTotal - rec);

    const changeDisp = document.getElementById("change-return-display");
    const creditDisp = document.getElementById("credit-due-display");

    if (changeDisp) changeDisp.innerText = `${settings.currency_symbol} ${changeReturn.toLocaleString()}`;
    if (creditDisp) creditDisp.innerText = `${settings.currency_symbol} ${creditDue.toLocaleString()}`;

    // Udhaar / Customer Credit summary breakdown
    const prevCredit = db.getCustomerPreviousCredit(custName, this.editingInvoiceId);
    const collectiveBalance = creditDue + prevCredit;

    const udhaarBox = document.getElementById("checkout-udhaar-summary-box");
    if (udhaarBox) {
      if (prevCredit > 0 || (this.cartPaymentMethod === "Credit / Udhaar" && creditDue > 0)) {
        udhaarBox.style.display = "block";
        udhaarBox.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.06); border: 1px dashed #ef4444; padding: 10px 14px; border-radius: 10px;">
            <div style="font-size: 0.76rem; font-weight: 800; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
              <i data-lucide="info" style="width:12px; height:12px; display:inline; vertical-align:middle; margin-right:4px;"></i> Customer Udhaar Summary (${custName || 'Walk-in Customer'})
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.83rem; color: #4b5563; margin-bottom: 3px;">
              <span>Previous Udhaar Balance:</span>
              <strong style="color: ${prevCredit > 0 ? '#dc2626' : '#111827'};">${settings.currency_symbol} ${prevCredit.toLocaleString()}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.83rem; color: #4b5563; margin-bottom: 3px;">
              <span>Current Sale Credit Due:</span>
              <strong style="color: ${creditDue > 0 ? '#dc2626' : '#111827'};">${settings.currency_symbol} ${creditDue.toLocaleString()}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.95rem; font-weight: 800; border-top: 1px dashed rgba(239,68,68,0.3); padding-top: 5px; margin-top: 4px; color: #b91c1c;">
              <span>Total Collective Udhaar:</span>
              <span>${settings.currency_symbol} ${collectiveBalance.toLocaleString()}</span>
            </div>
          </div>
        `;
        lucide.createIcons();
      } else {
        udhaarBox.style.display = "none";
        udhaarBox.innerHTML = "";
      }
    }
  }

  closeModal() { document.getElementById("modal-container").innerHTML = ""; }

  processCheckoutSubmit(grandTotal, shouldPrintThermal = false, shouldPrintA4 = false, shouldPrint6x8 = false) {
    const customerNameInput = document.getElementById("checkout-customer-name");
    const customerName = customerNameInput ? customerNameInput.value.trim() : "Walk-in Customer";
    const paidInput = document.getElementById("cash-received-input");
    const amountPaid = paidInput ? Number(paidInput.value) : grandTotal;

    const creditAmount = Math.max(0, grandTotal - amountPaid);
    if (creditAmount > 0 && (!customerName || customerName.toLowerCase() === "walk-in customer")) {
      this.showToast("Customer Name / Phone is required for Credit / Udhaar sales!", "error");
      if (customerNameInput) customerNameInput.focus();
      return;
    }

    let saleRecord;
    if (this.editingInvoiceId) {
      saleRecord = db.updateSaleAndRevertStock(
        this.editingInvoiceId,
        this.cart,
        this.cartDiscountType,
        this.cartDiscountValue,
        this.cartPaymentMethod,
        customerName,
        amountPaid
      );
      this.editingInvoiceId = null;
    } else {
      saleRecord = db.createSale(
        this.cart,
        this.cartDiscountType,
        this.cartDiscountValue,
        this.cartPaymentMethod,
        customerName,
        amountPaid
      );
    }

    if (shouldPrintThermal) {
      this.printThermalReceipt(saleRecord);
    } else if (shouldPrint6x8) {
      this.printCustom6x8Invoice(saleRecord);
    } else if (shouldPrintA4) {
      this.printA4Invoice(saleRecord);
    }

    this.showToast(`Invoice ${saleRecord.invoice_number} processed successfully!`, "success");
    this.cart = [];
    this.cartDiscountValue = 0;
    this.cartPaymentMethod = "Cash";
    this.cartCustomerName = "Walk-in Customer";
    this.closeModal();
    this.switchTab("sell");
  }

  // -------------------------------------------------------------
  // PRINT HANDLERS: THERMAL (80mm), 6"x8" CUSTOM, AND A4 INVOICE
  // -------------------------------------------------------------
  printCustom6x8Invoice(sale) {
    const settings = db.getSettings();
    const container = document.getElementById("custom-6x8-invoice-print");

    const previousCredit = db.getCustomerPreviousCredit(sale.customer_name, sale.id);
    const collectiveBalance = (sale.credit_amount || 0) + previousCredit;

    const custClean = (sale.customer_name || "Walk-in").replace(/[^a-zA-Z0-9]/g, "_");
    const dateClean = (sale.created_at || "").slice(0, 10);
    const invoiceFileName = `Sajawal_POS_6x8_Invoice_${sale.invoice_number}_${custClean}_${dateClean}`;

    const originalDocTitle = document.title;
    document.title = invoiceFileName;

    container.innerHTML = `
      <div class="doc-6x8">
        <div class="doc-6x8-header">
          <div class="doc-6x8-brand">
            <h1>${settings.business_name}</h1>
            <p>${settings.business_address}</p>
            <p>Phone: ${settings.business_phone}</p>
          </div>
          <div class="doc-6x8-meta">
            <h2>TAX INVOICE</h2>
            <div><strong>Invoice No:</strong> ${sale.invoice_number}</div>
            <div><strong>Date:</strong> ${new Date(sale.created_at).toLocaleDateString()} ${new Date(sale.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
            <div><strong>Cashier:</strong> ${sale.cashier_name}</div>
          </div>
        </div>

        <div class="doc-6x8-info-grid">
          <div class="doc-6x8-info-card">
            <h4>Billed To (Customer):</h4>
            <div style="font-size: 0.95rem; font-weight: 700;">${sale.customer_name}</div>
            <div style="font-size: 0.78rem; color: #4b5563; margin-top: 2px;">Payment: <strong>${sale.payment_method}</strong></div>
          </div>
          <div class="doc-6x8-info-card" style="text-align: right;">
            <h4>Payment Status:</h4>
            <div style="font-size: 1rem; font-weight: 800; color: ${sale.credit_amount > 0 ? '#dc2626' : '#15803d'};">
              ${sale.payment_status || 'Paid'}
            </div>
            ${sale.credit_amount > 0 ? `<div style="font-size: 0.76rem; color: #dc2626; font-weight:700;">Current Credit: ${settings.currency_symbol} ${sale.credit_amount.toLocaleString()}</div>` : ''}
            ${previousCredit > 0 ? `<div style="font-size: 0.76rem; color: #b91c1c; font-weight:700;">Previous Udhaar: ${settings.currency_symbol} ${previousCredit.toLocaleString()}</div>` : ''}
            ${(previousCredit > 0 || sale.credit_amount > 0) ? `<div style="font-size: 0.82rem; color: #991b1b; font-weight:800; margin-top:2px; border-top: 1px dashed #fca5a5; padding-top: 1px;">Total Udhaar: ${settings.currency_symbol} ${collectiveBalance.toLocaleString()}</div>` : ''}
          </div>
        </div>

        <table class="doc-6x8-table">
          <thead>
            <tr>
              <th style="width: 25px;">#</th>
              <th>Item Description</th>
              <th style="width: 75px; text-align: right;">Price</th>
              <th style="width: 45px; text-align: center;">Qty</th>
              <th style="width: 85px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${sale.items.map((item, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><strong>${item.product_name_snapshot}</strong></td>
                <td style="text-align: right;">${settings.currency_symbol} ${item.unit_price_snapshot.toLocaleString()}</td>
                <td style="text-align: center;">${item.quantity}</td>
                <td style="text-align: right; font-weight: 700;">${settings.currency_symbol} ${item.line_total.toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="doc-6x8-summary-block">
          <div class="doc-6x8-summary-table">
            <div class="doc-6x8-summary-row">
              <span>Subtotal</span>
              <span>${settings.currency_symbol} ${sale.subtotal.toLocaleString()}</span>
            </div>
            ${sale.discount_amount > 0 ? `
              <div class="doc-6x8-summary-row">
                <span>Discount</span>
                <span>-${settings.currency_symbol} ${sale.discount_amount.toLocaleString()}</span>
              </div>
            ` : ''}
            <div class="doc-6x8-summary-row total-row">
              <span>Grand Total</span>
              <span>${settings.currency_symbol} ${sale.total.toLocaleString()}</span>
            </div>
            <div class="doc-6x8-summary-row">
              <span>Amount Paid</span>
              <span>${settings.currency_symbol} ${(sale.amount_paid || sale.total).toLocaleString()}</span>
            </div>
            ${sale.credit_amount > 0 ? `
              <div class="doc-6x8-summary-row" style="font-weight: 700; color: #dc2626;">
                <span>Current Credit</span>
                <span>${settings.currency_symbol} ${sale.credit_amount.toLocaleString()}</span>
              </div>
            ` : ''}
            ${previousCredit > 0 ? `
              <div class="doc-6x8-summary-row" style="color: #4b5563;">
                <span>Previous Udhaar</span>
                <span>${settings.currency_symbol} ${previousCredit.toLocaleString()}</span>
              </div>
              <div class="doc-6x8-summary-row" style="font-weight: 800; font-size: 0.88rem; color: #b91c1c; border-top: 1.5px solid #ef4444; margin-top: 3px; padding-top: 2px;">
                <span>Total Outstanding</span>
                <span>${settings.currency_symbol} ${collectiveBalance.toLocaleString()}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="doc-6x8-footer-sig">
          <div>
            <p style="font-weight: bold; font-size: 0.72rem;">Terms & Conditions:</p>
            <p style="font-size: 0.7rem; color: #6b7280; margin-top: 2px;">1. Exchange within 3 days with bill.<br>2. Opened items non-returnable.</p>
          </div>
          <div class="sig-box">
            Authorized Signature
          </div>
        </div>
      </div>
    `;

    document.body.classList.add("printing-6x8");
    window.print();
    document.body.classList.remove("printing-6x8");
    document.title = originalDocTitle;
  }

  printThermalReceipt(sale) {
    const settings = db.getSettings();
    const printContainer = document.getElementById("thermal-receipt-print");
    const paperWidth = settings.printer_width_mm || 80;

    const previousCredit = db.getCustomerPreviousCredit(sale.customer_name, sale.id);
    const collectiveBalance = (sale.credit_amount || 0) + previousCredit;

    printContainer.style.width = `${paperWidth}mm`;

    let dynamicPageStyle = document.getElementById("dynamic-print-style");
    if (!dynamicPageStyle) {
      dynamicPageStyle = document.createElement("style");
      dynamicPageStyle.id = "dynamic-print-style";
      document.head.appendChild(dynamicPageStyle);
    }
    dynamicPageStyle.innerHTML = `@media print { @page { size: ${paperWidth}mm auto; margin: 0; } }`;

    printContainer.innerHTML = `
      <div class="thermal-receipt-header">
        <h2>${settings.business_name}</h2>
        <div>${settings.business_address}</div>
        <div>Tel: ${settings.business_phone}</div>
        <div style="margin-top: 6px; font-weight: bold;">INVOICE #: ${sale.invoice_number}</div>
        <div>Date: ${new Date(sale.created_at).toLocaleString()}</div>
        <div>Cashier: ${sale.cashier_name} | Customer: ${sale.customer_name}</div>
      </div>

      <div class="thermal-line-items">
        ${sale.items.map(item => `
          <div class="thermal-line-row">
            <span>${item.quantity}x ${item.product_name_snapshot}</span>
            <span>${settings.currency_symbol} ${item.line_total.toLocaleString()}</span>
          </div>
        `).join('')}
      </div>

      <div class="thermal-totals">
        <div class="thermal-line-row">
          <span>Subtotal:</span>
          <span>${settings.currency_symbol} ${sale.subtotal.toLocaleString()}</span>
        </div>
        ${sale.discount_amount > 0 ? `
          <div class="thermal-line-row">
            <span>Discount:</span>
            <span>-${settings.currency_symbol} ${sale.discount_amount.toLocaleString()}</span>
          </div>
        ` : ''}
        <div class="thermal-line-row" style="font-weight: bold; font-size: 14px;">
          <span>GRAND TOTAL:</span>
          <span>${settings.currency_symbol} ${sale.total.toLocaleString()}</span>
        </div>
        <div class="thermal-line-row">
          <span>Amount Paid:</span>
          <span>${settings.currency_symbol} ${(sale.amount_paid || sale.total).toLocaleString()}</span>
        </div>
        ${sale.credit_amount > 0 ? `
          <div class="thermal-line-row" style="font-weight: bold; color: red;">
            <span>Current Sale Credit:</span>
            <span>${settings.currency_symbol} ${sale.credit_amount.toLocaleString()}</span>
          </div>
        ` : ''}
        ${previousCredit > 0 ? `
          <div class="thermal-line-row" style="font-size: 11px; color: #444;">
            <span>Previous Udhaar:</span>
            <span>${settings.currency_symbol} ${previousCredit.toLocaleString()}</span>
          </div>
          <div class="thermal-line-row" style="font-weight: 800; border-top: 1px dashed #000; padding-top: 3px; margin-top: 2px;">
            <span>TOTAL UDHAAR BAL:</span>
            <span>${settings.currency_symbol} ${collectiveBalance.toLocaleString()}</span>
          </div>
        ` : ''}
        <div class="thermal-line-row">
          <span>Payment Method:</span>
          <span>${sale.payment_method}</span>
        </div>
      </div>

      <div class="thermal-footer">
        <p>*** THANK YOU FOR SHOPPING AT SAJAWAL POS ***</p>
      </div>
    `;

    if (window.electronAPI) {
      window.electronAPI.printReceipt({ printerName: settings.printer_name });
    } else {
      window.print();
    }
  }

  printA4Invoice(sale) {
    const settings = db.getSettings();
    const container = document.getElementById("a4-invoice-print");

    const previousCredit = db.getCustomerPreviousCredit(sale.customer_name, sale.id);
    const collectiveBalance = (sale.credit_amount || 0) + previousCredit;

    const custClean = (sale.customer_name || "Walk-in").replace(/[^a-zA-Z0-9]/g, "_");
    const dateClean = (sale.created_at || "").slice(0, 10);
    const invoiceFileName = `Sajawal_POS_Invoice_${sale.invoice_number}_${custClean}_${dateClean}`;

    const originalDocTitle = document.title;
    document.title = invoiceFileName;

    container.innerHTML = `
      <div class="a4-document">
        <div class="a4-header">
          <div class="a4-brand">
            <h1>${settings.business_name}</h1>
            <p>${settings.business_address}</p>
            <p>Phone / WhatsApp: ${settings.business_phone}</p>
          </div>
          <div class="a4-inv-meta">
            <h2>TAX INVOICE</h2>
            <div><strong>Invoice No:</strong> ${sale.invoice_number}</div>
            <div><strong>Date:</strong> ${new Date(sale.created_at).toLocaleDateString()} ${new Date(sale.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
            <div><strong>Cashier:</strong> ${sale.cashier_name}</div>
          </div>
        </div>

        <div class="a4-info-grid">
          <div class="a4-info-card">
            <h4>Billed To (Customer):</h4>
            <div style="font-size: 1rem; font-weight: 700;">${sale.customer_name}</div>
            <div style="font-size: 0.82rem; color: #4b5563; margin-top: 4px;">Payment Method: <strong>${sale.payment_method}</strong></div>
          </div>
          <div class="a4-info-card" style="text-align: right;">
            <h4>Payment Status:</h4>
            <div style="font-size: 1.1rem; font-weight: 800; color: ${sale.credit_amount > 0 ? '#dc2626' : '#65a30d'};">
              ${sale.payment_status || 'Paid'}
            </div>
            ${sale.credit_amount > 0 ? `<div style="font-size: 0.82rem; color: #dc2626; font-weight:700; margin-top:3px;">Current Sale Credit: ${settings.currency_symbol} ${sale.credit_amount.toLocaleString()}</div>` : ''}
            ${previousCredit > 0 ? `<div style="font-size: 0.82rem; color: #b91c1c; font-weight:700; margin-top:2px;">Previous Udhaar: ${settings.currency_symbol} ${previousCredit.toLocaleString()}</div>` : ''}
            ${(previousCredit > 0 || sale.credit_amount > 0) ? `<div style="font-size: 0.9rem; color: #991b1b; font-weight:800; margin-top:4px; border-top: 1px dashed #fca5a5; padding-top: 2px;">Total Udhaar Due: ${settings.currency_symbol} ${collectiveBalance.toLocaleString()}</div>` : ''}
          </div>
        </div>

        <table class="a4-table">
          <thead>
            <tr>
              <th style="width: 40px;">#</th>
              <th>Item Description</th>
              <th style="width: 90px; text-align: right;">Price</th>
              <th style="width: 60px; text-align: center;">Qty</th>
              <th style="width: 110px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${sale.items.map((item, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><strong>${item.product_name_snapshot}</strong></td>
                <td style="text-align: right;">${settings.currency_symbol} ${item.unit_price_snapshot.toLocaleString()}</td>
                <td style="text-align: center;">${item.quantity}</td>
                <td style="text-align: right; font-weight: 700;">${settings.currency_symbol} ${item.line_total.toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="a4-summary-block">
          <div class="a4-summary-table">
            <div class="a4-summary-row">
              <span>Subtotal</span>
              <span>${settings.currency_symbol} ${sale.subtotal.toLocaleString()}</span>
            </div>
            ${sale.discount_amount > 0 ? `
              <div class="a4-summary-row">
                <span>Discount</span>
                <span>-${settings.currency_symbol} ${sale.discount_amount.toLocaleString()}</span>
              </div>
            ` : ''}
            <div class="a4-summary-row total-row">
              <span>Grand Total</span>
              <span>${settings.currency_symbol} ${sale.total.toLocaleString()}</span>
            </div>
            <div class="a4-summary-row">
              <span>Amount Paid</span>
              <span>${settings.currency_symbol} ${(sale.amount_paid || sale.total).toLocaleString()}</span>
            </div>
            ${sale.credit_amount > 0 ? `
              <div class="a4-summary-row" style="font-weight: 700; color: #dc2626;">
                <span>Current Bill Credit</span>
                <span>${settings.currency_symbol} ${sale.credit_amount.toLocaleString()}</span>
              </div>
            ` : ''}
            ${previousCredit > 0 ? `
              <div class="a4-summary-row" style="color: #4b5563;">
                <span>Previous Udhaar Balance</span>
                <span>${settings.currency_symbol} ${previousCredit.toLocaleString()}</span>
              </div>
              <div class="a4-summary-row" style="font-weight: 800; font-size: 0.95rem; color: #b91c1c; border-top: 2px solid #ef4444; margin-top: 4px; padding-top: 4px;">
                <span>Total Udhaar Outstanding</span>
                <span>${settings.currency_symbol} ${collectiveBalance.toLocaleString()}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="a4-footer-sig">
          <div>
            <p style="font-weight: bold;">Terms & Conditions:</p>
            <p style="font-size: 0.8rem; color: #6b7280;">1. Exchange possible within 3 days with original invoice.<br>2. Cosmetics once opened cannot be returned.</p>
          </div>
          <div class="sig-box">
            Authorized Signature
          </div>
        </div>
      </div>
    `;

    document.body.classList.add("printing-a4");
    window.print();
    document.body.classList.remove("printing-a4");
    document.title = originalDocTitle;
  }

  // -------------------------------------------------------------
  // 3. REPORTING & CUSTOMER CREDIT LEDGER SCREEN (DOM Preserving Live Search)
  // -------------------------------------------------------------
  renderReporting(container) {
    const settings = db.getSettings();
    const products = db.getProducts();
    const sales = db.getSales();
    const customerCredits = db.getCustomerCredits();

    const filteredSales = sales.filter(s => {
      const q = this.invoiceSearch.toLowerCase();
      const matchSearch = !q || s.invoice_number.toLowerCase().includes(q) ||
                          s.customer_name.toLowerCase().includes(q) ||
                          s.items.some(i => i.product_name_snapshot.toLowerCase().includes(q));

      const matchDate = !this.invoiceDateFilter || (s.created_at && s.created_at.slice(0, 10) === this.invoiceDateFilter);
      return matchSearch && matchDate;
    });

    const totalInvoicesPages = Math.max(1, Math.ceil(filteredSales.length / this.invoicesPerPage));
    if (this.invoicesPage > totalInvoicesPages) this.invoicesPage = totalInvoicesPages;
    const paginatedSales = filteredSales.slice((this.invoicesPage - 1) * this.invoicesPerPage, this.invoicesPage * this.invoicesPerPage);

    const filteredCredits = customerCredits.filter(c => {
      const q = this.customerCreditSearch.toLowerCase();
      return !q || c.customer_name.toLowerCase().includes(q);
    });

    const filteredProducts = products.filter(p => {
      const q = this.productBreakdownSearch.toLowerCase();
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    });

    const productReports = filteredProducts.map(prod => {
      let totalQtySold = 0;
      let revenue = 0;
      let cogs = 0;

      sales.forEach(sale => {
        sale.items.forEach(item => {
          if (item.product_id === prod.id) {
            totalQtySold += item.quantity;
            revenue += item.line_total;
            cogs += (item.cost_price_snapshot || prod.cost_price) * item.quantity;
          }
        });
      });

      const grossProfit = Math.max(0, revenue - cogs);
      return { product: prod, totalQtySold, revenue, cogs, grossProfit };
    });

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Sales History & Customer Credit Ledger</h1>
          <p>Track sales performance, search past invoices, and manage customer Udhaar balances.</p>
        </div>
        ${this.reportingSubTab === 'credits' ? `
          <button class="btn-secondary" onclick="ExcelImporter.exportCustomerCreditsToExcel()">
            <i data-lucide="download" style="width: 16px;"></i> Export Credit Ledger (.xlsx)
          </button>
        ` : `
          <button class="btn-secondary" onclick="ExcelImporter.exportSalesToExcel(app.getFilteredSales())">
            <i data-lucide="download" style="width: 16px;"></i> Export Sales History (.xlsx)
          </button>
        `}
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--card-border); margin-bottom: 20px;">
        <div style="display: flex; gap: 20px; font-size: 0.88rem; font-weight: 700;">
          <span style="padding-bottom: 8px; cursor: pointer; color: ${this.reportingSubTab === 'sales' ? 'var(--text-main)' : 'var(--text-muted)'}; border-bottom: ${this.reportingSubTab === 'sales' ? '2px solid var(--text-main)' : 'none'};"
                onclick="app.switchReportingTab('sales')">Product Sales Breakdown</span>
          <span style="padding-bottom: 8px; cursor: pointer; color: ${this.reportingSubTab === 'invoices' ? 'var(--text-main)' : 'var(--text-muted)'}; border-bottom: ${this.reportingSubTab === 'invoices' ? '2px solid var(--text-main)' : 'none'};"
                onclick="app.switchReportingTab('invoices')">Past Invoices & Editing</span>
          <span style="padding-bottom: 8px; cursor: pointer; color: ${this.reportingSubTab === 'credits' ? 'var(--text-main)' : 'var(--text-muted)'}; border-bottom: ${this.reportingSubTab === 'credits' ? '2px solid var(--text-main)' : 'none'};"
                onclick="app.switchReportingTab('credits')">Customer Credit / Udhaar Ledger</span>
        </div>

        ${this.reportingSubTab === 'sales' ? `
          <div class="pos-search-bar" style="width: 260px;">
            <i data-lucide="search"></i>
            <input type="text" placeholder="Search product breakdown..."
                   value="${this.productBreakdownSearch}" oninput="app.onLiveBreakdownSearch(this.value)">
          </div>
        ` : this.reportingSubTab === 'invoices' ? `
          <div style="display: flex; gap: 10px; align-items: center;">
            <div style="display: flex; align-items: center; gap: 6px; background: #fff; border: 1px solid var(--card-border); border-radius: 10px; padding: 4px 10px;">
              <i data-lucide="calendar" style="width: 16px; color: var(--text-muted);"></i>
              <input type="date" value="${this.invoiceDateFilter}" onchange="app.onInvoiceDateFilter(this.value)"
                     style="border: none; padding: 2px 0; outline: none; font-size: 0.85rem; width: 130px;">
              ${this.invoiceDateFilter ? `<button style="border:none; background:none; cursor:pointer; font-weight:bold;" onclick="app.onInvoiceDateFilter('')">&times;</button>` : ''}
            </div>

            <div class="pos-search-bar" style="width: 240px;">
              <i data-lucide="search"></i>
              <input type="text" id="invoice-search-input" placeholder="Search invoice #, customer..."
                     value="${this.invoiceSearch}" oninput="app.onLiveInvoiceSearch(this.value)">
            </div>
          </div>
        ` : `
          <div class="pos-search-bar" style="width: 260px;">
            <i data-lucide="search"></i>
            <input type="text" placeholder="Search customer credit..."
                   value="${this.customerCreditSearch}" oninput="app.onLiveCreditSearch(this.value)">
          </div>
        `}
      </div>

      ${this.reportingSubTab === 'sales' ? `
        <div class="card">
          <div class="table-container">
            <table class="pos-table" id="breakdown-table">
              <thead>
                <tr>
                  <th>PRODUCT</th>
                  <th>UNITS SOLD</th>
                  <th>REVENUE</th>
                  <th>COST OF GOODS SOLD</th>
                  <th>GROSS PROFIT</th>
                </tr>
              </thead>
              <tbody>
                ${productReports.map(r => `
                  <tr data-search="${r.product.name.toLowerCase()} ${r.product.id.toLowerCase()}">
                    <td>
                      <div style="font-weight: 700;">${r.product.name}</div>
                      <div style="font-size: 0.75rem; color: var(--text-muted);">${r.product.id}</div>
                    </td>
                    <td class="num-pk">${r.totalQtySold} pcs</td>
                    <td class="num-pk" style="font-weight: 700;">${settings.currency_symbol} ${r.revenue.toLocaleString()}</td>
                    <td class="num-pk">${settings.currency_symbol} ${r.cogs.toLocaleString()}</td>
                    <td class="num-pk" style="font-weight: 700; color: var(--brand-green);">${settings.currency_symbol} ${r.grossProfit.toLocaleString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : this.reportingSubTab === 'invoices' ? `
        <div class="card">
          <div class="table-container">
            <table class="pos-table" id="invoices-table">
              <thead>
                <tr>
                  <th>INVOICE #</th>
                  <th>DATE & TIME</th>
                  <th>CUSTOMER</th>
                  <th>ITEMS</th>
                  <th>PAYMENT STATUS</th>
                  <th>TOTAL</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                ${paginatedSales.length === 0 ? `
                  <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No sales invoices recorded yet.</td></tr>
                ` : paginatedSales.map(s => `
                  <tr data-search="${s.invoice_number.toLowerCase()} ${s.customer_name.toLowerCase()}">
                    <td style="font-weight: 700;">${s.invoice_number}</td>
                    <td>${new Date(s.created_at).toLocaleString()}</td>
                    <td style="font-weight: 600;">${s.customer_name}</td>
                    <td>${s.items.length} items</td>
                    <td>
                      <span class="badge-status ${s.credit_amount > 0 ? (s.amount_paid > 0 ? 'badge-partial' : 'badge-credit') : 'badge-paid'}">
                        ${s.payment_status || 'Paid'}
                      </span>
                    </td>
                    <td class="num-pk" style="font-weight: 700;">${settings.currency_symbol} ${s.total.toLocaleString()}</td>
                    <td>
                      <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="app.reopenSaleForEditing('${s.id}')">
                        <i data-lucide="edit-2" style="width: 12px;"></i> Edit
                      </button>
                      <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="app.printThermalReceipt(db.getSales().find(x=>x.id==='${s.id}'))">
                        <i data-lucide="printer" style="width: 12px;"></i> Thermal
                      </button>
                      <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="app.printCustom6x8Invoice(db.getSales().find(x=>x.id==='${s.id}'))">
                        <i data-lucide="file" style="width: 12px;"></i> 6"×8"
                      </button>
                      <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="app.printA4Invoice(db.getSales().find(x=>x.id==='${s.id}'))">
                        <i data-lucide="download" style="width: 12px;"></i> A4 PDF
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          ${filteredSales.length > this.invoicesPerPage ? `
            <div class="pagination-bar">
              <span>Showing ${(this.invoicesPage - 1) * this.invoicesPerPage + 1} to ${Math.min(filteredSales.length, this.invoicesPage * this.invoicesPerPage)} of ${filteredSales.length} invoices</span>
              <div class="pagination-controls">
                <button class="page-btn" ${this.invoicesPage === 1 ? 'disabled' : ''} onclick="app.changeInvoicesPage(-1)">Previous</button>
                <span style="font-weight: 700;">Page ${this.invoicesPage} of ${totalInvoicesPages}</span>
                <button class="page-btn" ${this.invoicesPage >= totalInvoicesPages ? 'disabled' : ''} onclick="app.changeInvoicesPage(1)">Next</button>
              </div>
            </div>
          ` : ''}
        </div>
      ` : `
        <div class="card">
          <div class="table-container">
            <table class="pos-table" id="credits-table">
              <thead>
                <tr>
                  <th>CUSTOMER NAME</th>
                  <th>INVOICES</th>
                  <th>TOTAL PURCHASES</th>
                  <th>TOTAL PAID</th>
                  <th>TOTAL CREDIT TAKEN</th>
                  <th>REPAYMENTS PAID</th>
                  <th>REMAINING UDHAAR BALANCE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                ${filteredCredits.length === 0 ? `
                  <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No customer credit records found.</td></tr>
                ` : filteredCredits.map(c => `
                  <tr data-search="${c.customer_name.toLowerCase()}">
                    <td style="font-weight: 700;">${c.customer_name}</td>
                    <td>${c.total_sales_count} bills</td>
                    <td class="num-pk">${settings.currency_symbol} ${c.total_purchased.toLocaleString()}</td>
                    <td class="num-pk">${settings.currency_symbol} ${c.total_paid.toLocaleString()}</td>
                    <td class="num-pk">${settings.currency_symbol} ${c.total_credit.toLocaleString()}</td>
                    <td class="num-pk" style="color: var(--brand-green); font-weight:700;">${settings.currency_symbol} ${c.total_repaid.toLocaleString()}</td>
                    <td class="num-pk" style="font-size: 1rem; font-weight: 800; color: ${c.remaining_balance > 0 ? 'var(--brand-red)' : 'var(--brand-green)'};">
                      ${settings.currency_symbol} ${c.remaining_balance.toLocaleString()}
                    </td>
                    <td>
                      ${c.remaining_balance > 0 ? `
                        <button class="btn-primary btn-success" style="padding: 4px 10px; font-size: 0.78rem;" onclick="app.showRepaymentModal('${c.customer_name}', ${c.remaining_balance})">
                          <i data-lucide="dollar-sign" style="width: 12px;"></i> Record Repayment
                        </button>
                      ` : `
                        <span class="badge-status badge-paid">Settled / Clear</span>
                      `}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
    `;

    lucide.createIcons();
  }

  // DOM Preserving Live Search Handlers (Point #1 & #3 - Zero Focus Loss)
  onLiveBreakdownSearch(q) {
    this.productBreakdownSearch = q;
    const query = q.toLowerCase();
    const rows = document.querySelectorAll("#breakdown-table tbody tr");
    rows.forEach(r => {
      const data = r.getAttribute("data-search") || "";
      r.style.display = data.includes(query) ? "" : "none";
    });
  }

  onLiveInvoiceSearch(q) {
    this.invoiceSearch = q;
    const query = q.toLowerCase();
    const rows = document.querySelectorAll("#invoices-table tbody tr");
    rows.forEach(r => {
      const data = r.getAttribute("data-search") || "";
      r.style.display = data.includes(query) ? "" : "none";
    });
  }

  onLiveCreditSearch(q) {
    this.customerCreditSearch = q;
    const query = q.toLowerCase();
    const rows = document.querySelectorAll("#credits-table tbody tr");
    rows.forEach(r => {
      const data = r.getAttribute("data-search") || "";
      r.style.display = data.includes(query) ? "" : "none";
    });
  }

  changeInvoicesPage(delta) {
    this.invoicesPage += delta;
    this.renderReporting(document.getElementById("main-content"));
  }

  getFilteredSales() {
    const sales = db.getSales();
    return sales.filter(s => {
      const q = this.invoiceSearch.toLowerCase();
      const matchSearch = !q || s.invoice_number.toLowerCase().includes(q) ||
                          s.customer_name.toLowerCase().includes(q) ||
                          s.items.some(i => i.product_name_snapshot.toLowerCase().includes(q));
      const matchDate = !this.invoiceDateFilter || (s.created_at && s.created_at.slice(0, 10) === this.invoiceDateFilter);
      return matchSearch && matchDate;
    });
  }

  onInvoiceDateFilter(d) {
    this.invoiceDateFilter = d;
    this.invoicesPage = 1;
    this.renderReporting(document.getElementById("main-content"));
  }

  switchReportingTab(t) {
    this.reportingSubTab = t;
    this.resetSearchStates(); // Clear search filter text when switching sub-tabs (Point #2)
    this.renderReporting(document.getElementById("main-content"));
  }

  // -------------------------------------------------------------
  // CUSTOMER REPAYMENT MODAL
  // -------------------------------------------------------------
  showRepaymentModal(customerName, maxBalance) {
    const settings = db.getSettings();

    document.getElementById("modal-container").innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <h3>Record Customer Repayment</h3>
            <button class="modal-close" onclick="app.closeModal()">&times;</button>
          </div>

          <form onsubmit="app.submitRepayment(event, '${customerName}', ${maxBalance})">
            <div class="form-group">
              <label>Customer Name</label>
              <input type="text" value="${customerName}" disabled style="background:#f3f4f6; font-weight:bold;">
            </div>

            <div class="form-group">
              <label>Current Remaining Credit Due</label>
              <div class="num-pk" style="font-size: 1.4rem; font-weight: 800; color: var(--brand-red);">${settings.currency_symbol} ${maxBalance.toLocaleString()}</div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Repayment Amount Paid (Rs.) *</label>
                <input type="number" id="rep-amount" max="${maxBalance}" value="${maxBalance}" required>
              </div>

              <div class="form-group">
                <label>Payment Method</label>
                <select id="rep-method">
                  <option value="Cash">Cash</option>
                  <option value="Transfer">Transfer</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Notes / Details (Optional)</label>
              <input type="text" id="rep-notes" placeholder="e.g. Paid via Easypaisa / Cash received at shop">
            </div>

            <div style="display: flex; gap: 12px; margin-top: 20px;">
              <button type="button" class="btn-secondary" style="flex: 1;" onclick="app.closeModal()">Cancel</button>
              <button type="submit" class="btn-primary btn-success" style="flex: 1.5;">Confirm Repayment</button>
            </div>
          </form>
        </div>
      </div>
    `;
    lucide.createIcons();
  }

  submitRepayment(e, customerName, maxBalance) {
    e.preventDefault();
    const amount = Number(document.getElementById("rep-amount").value);
    const method = document.getElementById("rep-method").value;
    const notes = document.getElementById("rep-notes").value;

    if (amount <= 0) {
      this.showToast("Please enter a valid repayment amount.", "error");
      return;
    }

    if (amount > maxBalance) {
      this.showToast(`Repayment cannot exceed balance of Rs. ${maxBalance.toLocaleString()}`, "error");
      return;
    }

    db.recordCustomerRepayment(customerName, amount, method, notes);
    this.showToast(`Recorded Rs. ${amount.toLocaleString()} repayment from ${customerName}!`, "success");
    this.closeModal();
    this.renderReporting(document.getElementById("main-content"));
  }

  reopenSaleForEditing(saleId) {
    const sale = db.getSales().find(s => s.id === saleId);
    if (!sale) return;

    const products = db.getProducts();
    this.cart = sale.items.map(item => {
      const prod = products.find(p => p.id === item.product_id) || {
        id: item.product_id,
        name: item.product_name_snapshot,
        cost_price: item.cost_price_snapshot,
        selling_price: item.unit_price_snapshot,
        stock_qty: 999
      };
      return { product: prod, quantity: item.quantity };
    });

    this.editingInvoiceId = sale.id;
    this.cartDiscountType = sale.discount_type || "flat";
    this.cartDiscountValue = sale.discount_value || 0;
    this.cartPaymentMethod = sale.payment_method || "Cash";
    this.cartCustomerName = sale.customer_name || "Walk-in Customer";

    this.switchTab("sell");
  }

  // -------------------------------------------------------------
  // 4. CATALOG SCREEN (DOM Preserving Live Search - Points #2 & #3)
  // -------------------------------------------------------------
  renderCatalog(container) {
    const settings = db.getSettings();
    const products = db.getProducts();

    const filteredProducts = products.filter(p => {
      const q = this.catalogSearch.toLowerCase();
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    });

    const totalCatalogPages = Math.max(1, Math.ceil(filteredProducts.length / this.catalogPerPage));
    if (this.catalogPage > totalCatalogPages) this.catalogPage = totalCatalogPages;
    const paginatedProducts = filteredProducts.slice((this.catalogPage - 1) * this.catalogPerPage, this.catalogPage * this.catalogPerPage);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Product Catalog & Pricing</h1>
          <p>Manage product items, cost prices, manual overrides, and markup rules.</p>
        </div>
        <button class="btn-primary" onclick="app.showAddProductModal()">+ Add New Product</button>
      </div>

      <div class="card">
        <div class="pos-search-bar" style="margin-bottom: 16px; width: 320px;">
          <i data-lucide="search"></i>
          <input type="text" id="catalog-search-input" placeholder="Search catalog by product name..."
                 value="${this.catalogSearch}" oninput="app.onLiveCatalogSearch(this.value)">
        </div>

        <div class="table-container">
          <table class="pos-table" id="catalog-table">
            <thead>
              <tr>
                <th>PRODUCT NAME</th>
                <th>COST PRICE</th>
                <th>PRICING RULE</th>
                <th>SELLING PRICE</th>
                <th>STOCK QTY</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              ${paginatedProducts.length === 0 ? `
                <tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">No products in catalog yet. Click "+ Add New Product" or Bulk Import from Excel.</td></tr>
              ` : paginatedProducts.map(p => {
                const effectivePrice = db.getEffectivePrice(p, settings.markup_percentage);
                const isManual = p.selling_price !== null;
                return `
                  <tr data-search="${p.name.toLowerCase()} ${p.id.toLowerCase()}">
                    <td style="font-weight: 700;">${p.name}</td>
                    <td class="num-pk">${settings.currency_symbol} ${p.cost_price.toLocaleString()}</td>
                    <td>
                      <span class="markup-pill" style="${isManual ? 'background:#e0f2fe; color:#0369a1;' : ''}">
                        ${isManual ? 'Manual Override' : `Cost + ${settings.markup_percentage}% Markup`}
                      </span>
                    </td>
                    <td class="num-pk" style="font-weight: 700;">${settings.currency_symbol} ${effectivePrice.toLocaleString()}</td>
                    <td class="num-pk">${p.stock_qty}</td>
                    <td>
                      <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="app.showEditProductModal('${p.id}')">Edit</button>
                      <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; color: var(--brand-red);" onclick="app.deleteProductConfirm('${p.id}')">Delete</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        ${filteredProducts.length > this.catalogPerPage ? `
          <div class="pagination-bar">
            <span>Showing ${(this.catalogPage - 1) * this.catalogPerPage + 1} to ${Math.min(filteredProducts.length, this.catalogPage * this.catalogPerPage)} of ${filteredProducts.length} products</span>
            <div class="pagination-controls">
              <button class="page-btn" ${this.catalogPage === 1 ? 'disabled' : ''} onclick="app.changeCatalogPage(-1)">Previous</button>
              <span style="font-weight: 700;">Page ${this.catalogPage} of ${totalCatalogPages}</span>
              <button class="page-btn" ${this.catalogPage >= totalCatalogPages ? 'disabled' : ''} onclick="app.changeCatalogPage(1)">Next</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    lucide.createIcons();
  }

  // DOM Preserving Live Search (Point #3)
  onLiveCatalogSearch(q) {
    this.catalogSearch = q;
    const query = q.toLowerCase();
    const rows = document.querySelectorAll("#catalog-table tbody tr");
    rows.forEach(r => {
      const data = r.getAttribute("data-search") || "";
      r.style.display = data.includes(query) ? "" : "none";
    });
  }

  changeCatalogPage(delta) {
    this.catalogPage += delta;
    this.renderCatalog(document.getElementById("main-content"));
  }

  deleteProductConfirm(id) {
    const prod = db.getProducts().find(p => p.id === id);
    if (!prod) return;

    this.showConfirmModal(
      "Delete Product?",
      `Are you sure you want to delete '${prod.name}' from the catalog?`,
      () => {
        db.deleteProduct(id);
        this.renderCatalog(document.getElementById("main-content"));
        this.showToast(`Deleted '${prod.name}'`, "info");
      }
    );
  }

  showAddProductModal() {
    document.getElementById("modal-container").innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <h3>Add New Product</h3>
            <button class="modal-close" onclick="app.closeModal()">&times;</button>
          </div>
          <form onsubmit="app.saveNewProduct(event)">
            <div class="form-group">
              <label>Product Name</label>
              <input type="text" id="p-name" placeholder="Item name" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Cost Price (Rs.)</label>
                <input type="number" id="p-cost" required>
              </div>
              <div class="form-group">
                <label>Manual Selling Price (Optional)</label>
                <input type="number" id="p-sell" placeholder="Leave empty for % markup">
              </div>
            </div>
            <div class="form-group">
              <label>Initial Stock Quantity</label>
              <input type="number" id="p-stock" value="10" required>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 20px;">
              <button type="button" class="btn-secondary" style="flex: 1;" onclick="app.closeModal()">Cancel</button>
              <button type="submit" class="btn-primary" style="flex: 1;">Save Product</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  saveNewProduct(e) {
    e.preventDefault();
    const name = document.getElementById("p-name").value;
    db.addProduct({
      name: name,
      cost_price: document.getElementById("p-cost").value,
      selling_price: document.getElementById("p-sell").value || null,
      stock_qty: document.getElementById("p-stock").value
    });
    this.showToast(`Product '${name}' saved!`, "success");
    this.closeModal();
    this.switchTab("catalog");
  }

  showEditProductModal(id) {
    const product = db.getProducts().find(p => p.id === id);
    if (!product) return;

    document.getElementById("modal-container").innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <h3>Edit Product</h3>
            <button class="modal-close" onclick="app.closeModal()">&times;</button>
          </div>
          <form onsubmit="app.updateProductSubmit(event, '${id}')">
            <div class="form-group">
              <label>Product Name</label>
              <input type="text" id="ep-name" value="${product.name}" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Cost Price (Rs.)</label>
                <input type="number" id="ep-cost" value="${product.cost_price}" required>
              </div>
              <div class="form-group">
                <label>Manual Selling Price</label>
                <input type="number" id="ep-sell" value="${product.selling_price !== null ? product.selling_price : ''}">
              </div>
            </div>
            <div class="form-group">
              <label>Stock Quantity</label>
              <input type="number" id="ep-stock" value="${product.stock_qty}" required>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 20px;">
              <button type="button" class="btn-secondary" style="flex: 1;" onclick="app.closeModal()">Cancel</button>
              <button type="submit" class="btn-primary" style="flex: 1;">Update Product</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  updateProductSubmit(e, id) {
    e.preventDefault();
    db.updateProduct(id, {
      name: document.getElementById("ep-name").value,
      cost_price: Number(document.getElementById("ep-cost").value),
      selling_price: document.getElementById("ep-sell").value ? Number(document.getElementById("ep-sell").value) : null,
      stock_qty: Number(document.getElementById("ep-stock").value)
    });
    this.showToast("Product updated successfully!", "success");
    this.closeModal();
    this.switchTab("catalog");
  }

  // -------------------------------------------------------------
  // 5. INVENTORY & SYSTEM AUDIT LOG SCREEN (DOM Preserving Live Search)
  // -------------------------------------------------------------
  renderInventory(container) {
    const logs = db.getActivityLogs();

    const filteredLogs = logs.filter(l => {
      const q = this.activityLogSearch.toLowerCase();
      if (!q) return true;
      return l.action.toLowerCase().includes(q) ||
             l.details.toLowerCase().includes(q) ||
             l.user.toLowerCase().includes(q);
    });

    const totalLogsPages = Math.max(1, Math.ceil(filteredLogs.length / this.logsPerPage));
    if (this.logsPage > totalLogsPages) this.logsPage = totalLogsPages;
    const paginatedLogs = filteredLogs.slice((this.logsPage - 1) * this.logsPerPage, this.logsPage * this.logsPerPage);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Inventory & System Activity Logs</h1>
          <p>Import/Export product data and review complete POS system audit activity.</p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn-secondary" onclick="ExcelImporter.exportProductsToExcel()">
            <i data-lucide="download" style="width: 16px;"></i> Export Catalog (.xlsx)
          </button>
          <button class="btn-primary" onclick="app.showExcelImportModal()">
            <i data-lucide="upload" style="width: 16px;"></i> Bulk Import (.xlsx/.csv)
          </button>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--card-border); margin-bottom: 20px;">
        <div style="display: flex; gap: 20px; font-size: 0.88rem; font-weight: 700;">
          <span style="padding-bottom: 8px; cursor: pointer; color: ${this.inventorySubTab === 'stock' ? 'var(--text-main)' : 'var(--text-muted)'}; border-bottom: ${this.inventorySubTab === 'stock' ? '2px solid var(--text-main)' : 'none'};"
                onclick="app.switchInventoryTab('stock')">Product Stock Overview</span>
          <span style="padding-bottom: 8px; cursor: pointer; color: ${this.inventorySubTab === 'activity_logs' ? 'var(--text-main)' : 'var(--text-muted)'}; border-bottom: ${this.inventorySubTab === 'activity_logs' ? '2px solid var(--text-main)' : 'none'};"
                onclick="app.switchInventoryTab('activity_logs')">Full System Activity Log</span>
        </div>

        ${this.inventorySubTab === 'activity_logs' ? `
          <div style="display: flex; gap: 10px;">
            <div class="pos-search-bar" style="width: 240px;">
              <i data-lucide="search"></i>
              <input type="text" id="log-search-input" placeholder="Search activity logs..."
                     value="${this.activityLogSearch}" oninput="app.onLiveActivityLogSearch(this.value)">
            </div>
            <button class="btn-secondary" style="font-size: 0.8rem; padding: 6px 12px;" onclick="ExcelImporter.exportActivityLogToExcel()">
              <i data-lucide="download" style="width: 14px;"></i> Export Logs
            </button>
          </div>
        ` : ''}
      </div>

      ${this.inventorySubTab === 'stock' ? `
        <div class="card">
          <div class="table-container">
            <table class="pos-table">
              <thead>
                <tr>
                  <th>PRODUCT ID</th>
                  <th>PRODUCT NAME</th>
                  <th>COST PRICE</th>
                  <th>SELLING PRICE</th>
                  <th>STOCK QUANTITY</th>
                </tr>
              </thead>
              <tbody>
                ${db.getProducts().length === 0 ? `
                  <tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px;">Inventory is empty. Use "+ Add New Product" or Bulk Import.</td></tr>
                ` : db.getProducts().map(p => `
                  <tr>
                    <td>${p.id}</td>
                    <td style="font-weight: 700;">${p.name}</td>
                    <td class="num-pk">Rs. ${p.cost_price.toLocaleString()}</td>
                    <td class="num-pk" style="font-weight: 700;">Rs. ${db.getEffectivePrice(p).toLocaleString()}</td>
                    <td class="num-pk">${p.stock_qty}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : `
        <div class="card">
          <div class="table-container">
            <table class="pos-table" id="logs-table">
              <thead>
                <tr>
                  <th>LOG ID</th>
                  <th>TIMESTAMP</th>
                  <th>USER</th>
                  <th>ACTION</th>
                  <th>ACTIVITY DETAILS</th>
                </tr>
              </thead>
              <tbody>
                ${paginatedLogs.map(l => `
                  <tr data-search="${l.action.toLowerCase()} ${l.details.toLowerCase()} ${l.user.toLowerCase()}">
                    <td>${l.id}</td>
                    <td>${new Date(l.timestamp).toLocaleString()}</td>
                    <td><span class="markup-pill">${l.user}</span></td>
                    <td style="font-weight: 700; color: var(--text-main);">${l.action}</td>
                    <td>${l.details}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          ${filteredLogs.length > this.logsPerPage ? `
            <div class="pagination-bar">
              <span>Showing ${(this.logsPage - 1) * this.logsPerPage + 1} to ${Math.min(filteredLogs.length, this.logsPage * this.logsPerPage)} of ${filteredLogs.length} activity logs</span>
              <div class="pagination-controls">
                <button class="page-btn" ${this.logsPage === 1 ? 'disabled' : ''} onclick="app.changeLogsPage(-1)">Previous</button>
                <span style="font-weight: 700;">Page ${this.logsPage} of ${totalLogsPages}</span>
                <button class="page-btn" ${this.logsPage >= totalLogsPages ? 'disabled' : ''} onclick="app.changeLogsPage(1)">Next</button>
              </div>
            </div>
          ` : ''}
        </div>
      `}
    `;

    lucide.createIcons();
  }

  // DOM Preserving Live Activity Search (Point #4)
  onLiveActivityLogSearch(q) {
    this.activityLogSearch = q;
    const query = q.toLowerCase();
    const rows = document.querySelectorAll("#logs-table tbody tr");
    rows.forEach(r => {
      const data = r.getAttribute("data-search") || "";
      r.style.display = data.includes(query) ? "" : "none";
    });
  }

  changeLogsPage(delta) {
    this.logsPage += delta;
    this.renderInventory(document.getElementById("main-content"));
  }

  switchInventoryTab(t) {
    this.inventorySubTab = t;
    this.resetSearchStates(); // Reset search queries on sub-tab switch
    this.renderInventory(document.getElementById("main-content"));
  }

  showExcelImportModal() {
    document.getElementById("modal-container").innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card" style="max-width: 680px;">
          <div class="modal-header">
            <h3>Bulk Excel / CSV Product Import</h3>
            <button class="modal-close" onclick="app.closeModal()">&times;</button>
          </div>

          <div style="background: #f9f9f6; border: 1px solid var(--card-border); padding: 14px; border-radius: 12px; margin-bottom: 16px;">
            <div style="font-weight: 700; font-size: 0.88rem; margin-bottom: 6px;">📋 Excel File Column Structure:</div>
            <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
              Your Excel sheet (first tab) should have a header row with the following column headers:
            </p>
            <div style="font-size: 0.8rem; margin-top: 6px; font-weight: 600;">
              • <code>Product Name</code> (Required)<br>
              • <code>Cost Price</code> (Required)<br>
              • <code>Selling Price</code> (Optional, leave blank for % markup)<br>
              • <code>Stock Quantity</code> (Required)
            </div>
            <button class="btn-secondary" style="margin-top: 10px; padding: 4px 10px; font-size: 0.78rem;" onclick="ExcelImporter.downloadSampleExcelTemplate()">
              <i data-lucide="file-spreadsheet" style="width: 14px;"></i> Download Sample Template (.xlsx)
            </button>
          </div>

          <div style="border: 2px dashed var(--card-border); padding: 20px; border-radius: 16px; text-align: center; margin-bottom: 16px;">
            <i data-lucide="upload-cloud" style="width: 36px; height: 36px; color: var(--brand-green);"></i>
            <p style="margin-top: 6px; font-weight: 600; font-size: 0.9rem;">Select .xlsx or .csv product catalog file</p>
            <input type="file" id="excel-file-input" accept=".xlsx,.xls,.csv" style="margin-top: 10px;" onchange="app.handleExcelFile(this)">
          </div>

          <div id="excel-preview-area"></div>
        </div>
      </div>
    `;
    lucide.createIcons();
  }

  handleExcelFile(input) {
    if (!input.files || input.files.length === 0) return;
    ExcelImporter.parseFile(input.files[0], res => {
      const previewArea = document.getElementById("excel-preview-area");
      if (res.error) {
        previewArea.innerHTML = `<div style="color: var(--brand-red); font-weight: 600;">${res.error}</div>`;
        return;
      }

      previewArea.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 8px;">Parsed ${res.items.length} items from file:</div>
        <div style="max-height: 180px; overflow-y: auto; margin-bottom: 14px;">
          <table class="pos-table">
            <thead>
              <tr><th>ROW</th><th>NAME</th><th>COST</th><th>STOCK</th><th>STATUS</th></tr>
            </thead>
            <tbody>
              ${res.items.map(item => `
                <tr>
                  <td>${item.rowNum}</td>
                  <td>${item.name}</td>
                  <td>Rs. ${item.cost_price}</td>
                  <td>${item.stock_qty}</td>
                  <td>
                    ${item.isDuplicate ? '<span style="color: var(--brand-amber); font-weight:700;">Duplicate</span>' : '<span style="color: var(--brand-green); font-weight:700;">Ready</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <button class="btn-primary" style="width: 100%;" onclick="app.commitExcelImport()">Commit Import to Database</button>
      `;
    });
  }

  commitExcelImport() {
    const count = ExcelImporter.commitImport(ExcelImporter.parsedData);
    this.showToast(`Successfully imported ${count} items!`, "success");
    this.closeModal();
    this.switchTab("inventory");
  }

  // -------------------------------------------------------------
  // 6. SETUP SCREEN
  // -------------------------------------------------------------
  renderSetup(container) {
    const settings = db.getSettings();

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Store Setup & Settings</h1>
          <p>Configure shop profile, pricing rules, thermal printer paper size, and database controls.</p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div class="card">
          <div class="card-title">Business Information</div>
          <form onsubmit="app.saveSettingsForm(event)">
            <div class="form-group">
              <label>Business Name</label>
              <input type="text" id="set-name" value="${settings.business_name}" required>
            </div>
            <div class="form-group">
              <label>Business Address</label>
              <input type="text" id="set-address" value="${settings.business_address}" required>
            </div>
            <div class="form-group">
              <label>Phone Number</label>
              <input type="text" id="set-phone" value="${settings.business_phone}" required>
            </div>
            <div class="form-group">
              <label>Cashier / Manager Name</label>
              <input type="text" id="set-cashier" value="${settings.cashier_name}" required>
            </div>
            <button type="submit" class="btn-primary" style="margin-top: 8px;">
              <i data-lucide="save" style="width: 16px;"></i> Save Shop Profile
            </button>
          </form>
        </div>

        <div style="display: flex; flex-direction: column; gap: 20px;">
          <div class="card">
            <div class="card-title">Pricing Rule & Thermal Printer</div>
            <form onsubmit="app.saveSettingsForm(event)">
              <div class="form-group">
                <label>Global Default Markup Percentage (%)</label>
                <input type="number" id="set-markup" value="${settings.markup_percentage}" required>
                <small style="color: var(--text-muted); font-size: 0.75rem;">Formula: Selling Price = Cost Price + (Cost Price × Markup %)</small>
              </div>
              <div class="form-group" style="margin-top: 10px;">
                <label>Thermal Printer Width</label>
                <select id="set-printer-width">
                  <option value="80" ${settings.printer_width_mm == 80 ? 'selected' : ''}>80mm (Standard 3-inch receipt)</option>
                  <option value="58" ${settings.printer_width_mm == 58 ? 'selected' : ''}>58mm (Mini 2-inch receipt)</option>
                </select>
              </div>
              <div class="form-group">
                <label>Currency Symbol</label>
                <input type="text" id="set-currency" value="${settings.currency_symbol}" required>
              </div>
              <button type="submit" class="btn-primary" style="margin-top: 8px;">
                <i data-lucide="sliders" style="width: 16px;"></i> Save Rules
              </button>
            </form>
          </div>

          <div class="card">
            <div class="card-title">Database & Mock Data Controls</div>
            <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 10px;">
              Easily clear the database or load test mock data on demand.
            </p>
            <div style="display: flex; gap: 12px; margin-top: 14px;">
              <button type="button" class="btn-secondary" style="flex: 1;" onclick="app.resetDemoData()">
                <i data-lucide="refresh-cw" style="width: 14px;"></i> Load Test Mock Data
              </button>
              <button type="button" class="btn-danger" style="flex: 1;" onclick="app.clearAllData()">
                <i data-lucide="trash-2" style="width: 14px;"></i> Delete All Data (Clean Slate)
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    lucide.createIcons();
  }

  saveSettingsForm(e) {
    e.preventDefault();
    const current = db.getSettings();
    const updated = {
      ...current,
      business_name: document.getElementById("set-name").value,
      business_address: document.getElementById("set-address").value,
      business_phone: document.getElementById("set-phone").value,
      cashier_name: document.getElementById("set-cashier") ? document.getElementById("set-cashier").value : current.cashier_name,
      markup_percentage: document.getElementById("set-markup") ? Number(document.getElementById("set-markup").value) : current.markup_percentage,
      printer_width_mm: document.getElementById("set-printer-width") ? Number(document.getElementById("set-printer-width").value) : current.printer_width_mm,
      currency_symbol: document.getElementById("set-currency") ? document.getElementById("set-currency").value : current.currency_symbol
    };

    db.saveSettings(updated);
    this.showToast("Settings saved successfully!", "success");
    this.renderLayout();
    this.switchTab("setup");
  }

  resetDemoData() {
    this.showConfirmModal(
      "Load Test Mock Dataset?",
      "Are you sure you want to load the sample beauty & cosmetics mock dataset into the database?",
      () => {
        db.resetToDemo();
        this.showToast("Test mock dataset loaded!", "success");
        this.renderLayout();
        this.switchTab("catalog");
      }
    );
  }

  clearAllData() {
    this.showConfirmModal(
      "Wipe Entire Database?",
      "Are you sure you want to delete ALL products, sales invoices, activity logs, drafts, and customer credit ledgers? This action CANNOT be undone.",
      () => {
        db.clearAllData();
        this.showToast("Database wiped clean! Starting with 0 products.", "info");
        this.renderLayout();
        this.switchTab("catalog");
      }
    );
  }
}

// Initialize Application
let app;
window.addEventListener("DOMContentLoaded", () => {
  app = new POSApp();
});
