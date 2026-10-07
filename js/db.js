/* Database & Activity Persistence for Sajawal POS */

class POSDatabase {
  constructor() {
    this.STORAGE_KEYS = {
      SETTINGS: "sajawal_settings",
      PRODUCTS: "sajawal_products",
      SALES: "sajawal_sales",
      ACTIVITY_LOG: "sajawal_activity_log",
      DRAFTS: "sajawal_drafts",
      REPAYMENTS: "sajawal_repayments"
    };

    this.init();
  }

  init() {
    if (!localStorage.getItem(this.STORAGE_KEYS.SETTINGS)) {
      localStorage.setItem(this.STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
    }
    if (!localStorage.getItem(this.STORAGE_KEYS.PRODUCTS)) {
      localStorage.setItem(this.STORAGE_KEYS.PRODUCTS, JSON.stringify(INITIAL_PRODUCTS));
    }
    if (!localStorage.getItem(this.STORAGE_KEYS.SALES)) {
      localStorage.setItem(this.STORAGE_KEYS.SALES, JSON.stringify(INITIAL_SALES));
    }
    if (!localStorage.getItem(this.STORAGE_KEYS.ACTIVITY_LOG)) {
      localStorage.setItem(this.STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify(INITIAL_ACTIVITY_LOG));
    }
    if (!localStorage.getItem(this.STORAGE_KEYS.DRAFTS)) {
      localStorage.setItem(this.STORAGE_KEYS.DRAFTS, JSON.stringify(INITIAL_DRAFTS));
    }
    if (!localStorage.getItem(this.STORAGE_KEYS.REPAYMENTS)) {
      localStorage.setItem(this.STORAGE_KEYS.REPAYMENTS, JSON.stringify(INITIAL_REPAYMENTS));
    }
  }

  getSettings() {
    return JSON.parse(localStorage.getItem(this.STORAGE_KEYS.SETTINGS)) || DEFAULT_SETTINGS;
  }

  getProducts() {
    return JSON.parse(localStorage.getItem(this.STORAGE_KEYS.PRODUCTS)) || [];
  }

  getSales() {
    return JSON.parse(localStorage.getItem(this.STORAGE_KEYS.SALES)) || [];
  }

  getActivityLogs() {
    return JSON.parse(localStorage.getItem(this.STORAGE_KEYS.ACTIVITY_LOG)) || [];
  }

  getDrafts() {
    return JSON.parse(localStorage.getItem(this.STORAGE_KEYS.DRAFTS)) || [];
  }

  getRepayments() {
    return JSON.parse(localStorage.getItem(this.STORAGE_KEYS.REPAYMENTS)) || [];
  }

  saveSettings(newSettings) {
    localStorage.setItem(this.STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
    this.logActivity("Settings Updated", "Updated store profile and pricing markup rules");
    return newSettings;
  }

  saveProducts(products) {
    localStorage.setItem(this.STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    return products;
  }

  saveSales(sales) {
    localStorage.setItem(this.STORAGE_KEYS.SALES, JSON.stringify(sales));
    return sales;
  }

  saveActivityLogs(logs) {
    localStorage.setItem(this.STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify(logs));
    return logs;
  }

  saveDrafts(drafts) {
    localStorage.setItem(this.STORAGE_KEYS.DRAFTS, JSON.stringify(drafts));
    return drafts;
  }

  saveRepayments(repayments) {
    localStorage.setItem(this.STORAGE_KEYS.REPAYMENTS, JSON.stringify(repayments));
    return repayments;
  }

  logActivity(action, details) {
    const logs = this.getActivityLogs();
    const settings = this.getSettings();
    logs.unshift({
      id: "ACT-" + Math.floor(1000 + Math.random() * 9000),
      timestamp: new Date().toISOString(),
      user: settings.cashier_name || "System",
      action: action,
      details: details
    });
    this.saveActivityLogs(logs);
  }

  // Consistent Sequential Invoice Number Generator (INV-1001, INV-1002, etc.)
  getNextInvoiceNumber() {
    const sales = this.getSales();
    let maxNum = 1000;

    sales.forEach(s => {
      if (s.invoice_number && s.invoice_number.startsWith("INV-")) {
        const numPart = parseInt(s.invoice_number.replace("INV-", ""), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    });

    return `INV-${maxNum + 1}`;
  }

  getEffectivePrice(product, markupPercent = null) {
    if (!product) return 0;
    if (product.selling_price !== null && product.selling_price !== undefined && product.selling_price !== "") {
      return Number(product.selling_price);
    }
    const markup = markupPercent !== null ? markupPercent : this.getSettings().markup_percentage;
    const cost = Number(product.cost_price) || 0;
    return Math.round(cost + (cost * (markup / 100)));
  }

  // -------------------------------------------------------------
  // PARKED SALES / ORDER DRAFTS
  // -------------------------------------------------------------
  saveDraft(cart, discountType = "flat", discountValue = 0, paymentMethod = "Cash", customerName = "Walk-in Customer") {
    if (!cart || cart.length === 0) return null;
    const drafts = this.getDrafts();
    const newDraft = {
      id: "DRAFT-" + Math.floor(1000 + Math.random() * 9000),
      timestamp: new Date().toISOString(),
      cart: cart,
      discount_type: discountType,
      discount_value: discountValue,
      payment_method: paymentMethod,
      customer_name: customerName || "Walk-in Customer",
      item_count: cart.reduce((acc, i) => acc + i.quantity, 0)
    };
    drafts.unshift(newDraft);
    this.saveDrafts(drafts);
    this.logActivity("Order Parked", `Parked sale draft for ${newDraft.customer_name} with ${newDraft.item_count} items`);
    return newDraft;
  }

  deleteDraft(draftId) {
    const drafts = this.getDrafts();
    const filtered = drafts.filter(d => d.id !== draftId);
    this.saveDrafts(filtered);
    this.logActivity("Draft Removed", `Removed parked order draft ${draftId}`);
  }

  // -------------------------------------------------------------
  // PRODUCTS MANAGEMENT
  // -------------------------------------------------------------
  addProduct(productData) {
    const products = this.getProducts();
    const newProduct = {
      id: "PROD-" + Math.floor(1000 + Math.random() * 9000),
      name: productData.name,
      cost_price: Number(productData.cost_price) || 0,
      selling_price: productData.selling_price ? Number(productData.selling_price) : null,
      stock_qty: Number(productData.stock_qty) || 0,
      created_at: new Date().toISOString()
    };
    products.unshift(newProduct);
    this.saveProducts(products);

    this.logActivity("Product Added", `Added product '${newProduct.name}' with stock ${newProduct.stock_qty}`);
    return newProduct;
  }

  updateProduct(id, updatedFields) {
    const products = this.getProducts();
    const index = products.findIndex(p => p.id === id);
    if (index !== -1) {
      const oldName = products[index].name;
      products[index] = { ...products[index], ...updatedFields, updated_at: new Date().toISOString() };
      this.saveProducts(products);

      this.logActivity("Product Updated", `Updated details for product '${oldName}'`);
      return products[index];
    }
    return null;
  }

  deleteProduct(id) {
    const products = this.getProducts();
    const prod = products.find(p => p.id === id);
    const filtered = products.filter(p => p.id !== id);
    this.saveProducts(filtered);

    if (prod) {
      this.logActivity("Product Deleted", `Deleted product '${prod.name}' from catalog`);
    }
  }

  // -------------------------------------------------------------
  // SALES & CREDIT CHECKOUT SYSTEM
  // -------------------------------------------------------------
  createSale(cartItems, discountType = "flat", discountVal = 0, paymentMethod = "Cash", customerName = "Walk-in Customer", amountReceived = null) {
    const products = this.getProducts();
    const settings = this.getSettings();
    const invoiceNum = this.getNextInvoiceNumber();

    let subtotal = 0;
    const invoiceItems = [];

    cartItems.forEach(cartItem => {
      const prodIndex = products.findIndex(p => p.id === cartItem.product.id);
      if (prodIndex !== -1) {
        const prod = products[prodIndex];
        let unitPrice = this.getEffectivePrice(prod, settings.markup_percentage);
        if (cartItem.custom_unit_price !== undefined && cartItem.custom_unit_price !== null && cartItem.custom_unit_price !== "") {
          unitPrice = Number(cartItem.custom_unit_price);
        } else if (cartItem.unit_price_snapshot !== undefined && cartItem.unit_price_snapshot !== null && cartItem.unit_price_snapshot !== "") {
          unitPrice = Number(cartItem.unit_price_snapshot);
        }

        const lineTotal = unitPrice * cartItem.quantity;
        subtotal += lineTotal;

        prod.stock_qty = Math.max(0, prod.stock_qty - cartItem.quantity);

        invoiceItems.push({
          product_id: prod.id,
          product_name_snapshot: prod.name,
          unit_price_snapshot: unitPrice,
          cost_price_snapshot: prod.cost_price,
          quantity: cartItem.quantity,
          line_total: lineTotal
        });
      }
    });

    this.saveProducts(products);

    let discountAmount = 0;
    if (discountType === "percent") {
      discountAmount = (subtotal * Number(discountVal)) / 100;
    } else {
      discountAmount = Number(discountVal) || 0;
    }

    const grandTotal = Math.round(Math.max(0, subtotal - discountAmount));

    // Calculate Amount Paid vs Remaining Credit Balance
    let paidAmount = amountReceived !== null ? Number(amountReceived) : grandTotal;
    if (paymentMethod === "Credit / Udhaar" && amountReceived === null) {
      paidAmount = 0; // Default full credit if no amount given
    }
    paidAmount = Math.min(grandTotal, Math.max(0, paidAmount));
    const creditAmount = Math.max(0, grandTotal - paidAmount);

    let paymentStatus = "Paid";
    if (creditAmount > 0) {
      paymentStatus = paidAmount === 0 ? "Full Credit" : "Partial Credit";
    }

    const saleRecord = {
      id: invoiceNum,
      invoice_number: invoiceNum,
      created_at: new Date().toISOString(),
      edited_at: null,
      subtotal: subtotal,
      discount_type: discountType,
      discount_value: Number(discountVal),
      discount_amount: discountAmount,
      total: grandTotal,
      amount_paid: paidAmount,
      credit_amount: creditAmount,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      customer_name: customerName || "Walk-in Customer",
      cashier_name: settings.cashier_name,
      items: invoiceItems
    };

    const sales = this.getSales();
    sales.unshift(saleRecord);
    this.saveSales(sales);

    this.logActivity("Sale Completed", `Invoice ${invoiceNum} created for Rs. ${grandTotal.toLocaleString()} (${paymentStatus}). Paid: Rs. ${paidAmount.toLocaleString()}, Credit Due: Rs. ${creditAmount.toLocaleString()}`);
    return saleRecord;
  }

  updateSaleAndRevertStock(invoiceId, updatedCartItems, discountType, discountValue, paymentMethod, customerName, amountReceived = null) {
    const sales = this.getSales();
    const products = this.getProducts();
    const saleIndex = sales.findIndex(s => s.id === invoiceId);

    if (saleIndex === -1) return null;
    const oldSale = sales[saleIndex];

    // Revert old item stock deductions
    oldSale.items.forEach(oldItem => {
      const pIndex = products.findIndex(p => p.id === oldItem.product_id);
      if (pIndex !== -1) {
        products[pIndex].stock_qty += oldItem.quantity;
      }
    });

    // Apply new item stock deductions
    let newSubtotal = 0;
    const newInvoiceItems = [];

    updatedCartItems.forEach(cartItem => {
      const prod = cartItem.product || products.find(p => p.id === cartItem.product_id);
      if (prod) {
        const pIndex = products.findIndex(p => p.id === prod.id);
        let unitPrice = this.getEffectivePrice(prod);
        if (cartItem.custom_unit_price !== undefined && cartItem.custom_unit_price !== null && cartItem.custom_unit_price !== "") {
          unitPrice = Number(cartItem.custom_unit_price);
        } else if (cartItem.unit_price_snapshot !== undefined && cartItem.unit_price_snapshot !== null && cartItem.unit_price_snapshot !== "") {
          unitPrice = Number(cartItem.unit_price_snapshot);
        }

        const lineTotal = unitPrice * cartItem.quantity;
        newSubtotal += lineTotal;

        if (pIndex !== -1) {
          products[pIndex].stock_qty = Math.max(0, products[pIndex].stock_qty - cartItem.quantity);
        }

        newInvoiceItems.push({
          product_id: prod.id,
          product_name_snapshot: prod.name,
          unit_price_snapshot: unitPrice,
          cost_price_snapshot: prod.cost_price,
          quantity: cartItem.quantity,
          line_total: lineTotal
        });
      }
    });

    this.saveProducts(products);

    let discountAmount = 0;
    if (discountType === "percent") {
      discountAmount = (newSubtotal * Number(discountValue)) / 100;
    } else {
      discountAmount = Number(discountValue) || 0;
    }

    const grandTotal = Math.round(Math.max(0, newSubtotal - discountAmount));

    let paidAmount = amountReceived !== null ? Number(amountReceived) : grandTotal;
    if (paymentMethod === "Credit / Udhaar" && amountReceived === null) {
      paidAmount = 0;
    }
    paidAmount = Math.min(grandTotal, Math.max(0, paidAmount));
    const creditAmount = Math.max(0, grandTotal - paidAmount);

    let paymentStatus = "Paid";
    if (creditAmount > 0) {
      paymentStatus = paidAmount === 0 ? "Full Credit" : "Partial Credit";
    }

    // Build item-by-item change details for audit log
    const changeNotes = [];
    const oldItemMap = new Map();
    oldSale.items.forEach(i => oldItemMap.set(i.product_id, i));

    const newItemMap = new Map();
    newInvoiceItems.forEach(i => newItemMap.set(i.product_id, i));

    // Check modified or added items
    newInvoiceItems.forEach(newItem => {
      const oldItem = oldItemMap.get(newItem.product_id);
      if (oldItem) {
        if (oldItem.quantity !== newItem.quantity) {
          const diff = newItem.quantity - oldItem.quantity;
          const stockAction = diff > 0 ? `${Math.abs(diff)} pcs deducted from stock` : `${Math.abs(diff)} pcs returned to stock`;
          changeNotes.push(`'${newItem.product_name_snapshot}' qty: ${oldItem.quantity} → ${newItem.quantity} (${stockAction})`);
        }
      } else {
        changeNotes.push(`Added '${newItem.product_name_snapshot}' qty: ${newItem.quantity} (${newItem.quantity} pcs deducted from stock)`);
      }
    });

    // Check removed items
    oldSale.items.forEach(oldItem => {
      if (!newItemMap.has(oldItem.product_id)) {
        changeNotes.push(`Removed '${oldItem.product_name_snapshot}' (${oldItem.quantity} pcs returned to stock)`);
      }
    });

    const changeSummary = changeNotes.length > 0 ? changeNotes.join("; ") : "No line item quantities changed";

    sales[saleIndex] = {
      ...oldSale,
      edited_at: new Date().toISOString(),
      subtotal: newSubtotal,
      discount_type: discountType,
      discount_value: Number(discountValue),
      discount_amount: discountAmount,
      total: grandTotal,
      amount_paid: paidAmount,
      credit_amount: creditAmount,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      customer_name: customerName || "Walk-in Customer",
      items: newInvoiceItems
    };

    this.saveSales(sales);
    this.logActivity("Sale Edited", `Updated Invoice ${invoiceId} for '${customerName || "Walk-in Customer"}'. Changes: ${changeSummary}. New Total: Rs. ${grandTotal.toLocaleString()}, Credit Due: Rs. ${creditAmount.toLocaleString()}`);
    return sales[saleIndex];
  }

  // -------------------------------------------------------------
  // CUSTOMER CREDIT LEDGER & REPAYMENT SYSTEM
  // -------------------------------------------------------------
  getUniqueCustomerNames() {
    const sales = this.getSales();
    const credits = this.getCustomerCredits();
    const repayments = this.getRepayments();
    const set = new Set();

    sales.forEach(s => {
      const name = (s.customer_name || "").trim();
      if (name && name.toLowerCase() !== "walk-in customer") {
        set.add(name);
      }
    });

    credits.forEach(c => {
      const name = (c.customer_name || "").trim();
      if (name && name.toLowerCase() !== "walk-in customer") {
        set.add(name);
      }
    });

    repayments.forEach(r => {
      const name = (r.customer_name || "").trim();
      if (name && name.toLowerCase() !== "walk-in customer") {
        set.add(name);
      }
    });

    return Array.from(set).sort();
  }
  // -------------------------------------------------------------
  getCustomerCredits() {
    const sales = this.getSales();
    const repayments = this.getRepayments();
    const customerMap = {};

    // Aggregate credit amounts per customer from sales
    sales.forEach(sale => {
      const cName = (sale.customer_name || "Walk-in Customer").trim();
      if (cName && cName.toLowerCase() !== "walk-in customer") {
        if (!customerMap[cName.toLowerCase()]) {
          customerMap[cName.toLowerCase()] = {
            customer_name: cName,
            total_sales_count: 0,
            total_purchased: 0,
            total_paid: 0,
            total_credit: 0,
            total_repaid: 0,
            remaining_balance: 0,
            last_activity: sale.created_at
          };
        }
        const cust = customerMap[cName.toLowerCase()];
        cust.total_sales_count++;
        cust.total_purchased += sale.total;
        cust.total_paid += sale.amount_paid || sale.total;
        cust.total_credit += sale.credit_amount || 0;
        if (new Date(sale.created_at) > new Date(cust.last_activity)) {
          cust.last_activity = sale.created_at;
        }
      }
    });

    // Subtract repayments made by customer
    repayments.forEach(rep => {
      const cName = (rep.customer_name || "").trim();
      if (cName && customerMap[cName.toLowerCase()]) {
        const cust = customerMap[cName.toLowerCase()];
        cust.total_repaid += rep.amount;
        if (new Date(rep.timestamp) > new Date(cust.last_activity)) {
          cust.last_activity = rep.timestamp;
        }
      }
    });

    // Calculate final remaining balance for each customer
    const resultList = [];
    Object.values(customerMap).forEach(cust => {
      cust.remaining_balance = Math.max(0, cust.total_credit - cust.total_repaid);
      resultList.push(cust);
    });

    return resultList.sort((a, b) => b.remaining_balance - a.remaining_balance);
  }

  getCustomerPreviousCredit(customerName, excludeInvoiceId = null) {
    if (!customerName || customerName.trim().toLowerCase() === "walk-in customer") return 0;
    const normName = customerName.trim().toLowerCase();
    const sales = this.getSales();
    const repayments = this.getRepayments();

    let totalCredit = 0;
    sales.forEach(sale => {
      if (excludeInvoiceId && sale.id === excludeInvoiceId) return;
      const sName = (sale.customer_name || "").trim().toLowerCase();
      if (sName === normName) {
        totalCredit += (sale.credit_amount || 0);
      }
    });

    let totalRepaid = 0;
    repayments.forEach(rep => {
      const rName = (rep.customer_name || "").trim().toLowerCase();
      if (rName === normName) {
        totalRepaid += (rep.amount || 0);
      }
    });

    return Math.max(0, totalCredit - totalRepaid);
  }

  recordCustomerRepayment(customerName, amount, paymentMethod = "Cash", notes = "") {
    const numAmount = Number(amount) || 0;
    if (numAmount <= 0 || !customerName) return null;

    const repayments = this.getRepayments();
    const newRepayment = {
      id: "REP-" + Math.floor(1000 + Math.random() * 9000),
      timestamp: new Date().toISOString(),
      customer_name: customerName.trim(),
      amount: numAmount,
      payment_method: paymentMethod,
      notes: notes,
      cashier_name: this.getSettings().cashier_name
    };

    repayments.unshift(newRepayment);
    this.saveRepayments(repayments);

    this.logActivity("Credit Repayment Received", `Received Rs. ${numAmount.toLocaleString()} credit repayment from customer '${customerName}' via ${paymentMethod}`);
    return newRepayment;
  }

  resetToDemo() {
    localStorage.setItem(this.STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
    localStorage.setItem(this.STORAGE_KEYS.PRODUCTS, JSON.stringify(TEST_MOCK_PRODUCTS));
    localStorage.setItem(this.STORAGE_KEYS.SALES, JSON.stringify(TEST_MOCK_SALES));
    localStorage.setItem(this.STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify(TEST_MOCK_LOGS));
    localStorage.setItem(this.STORAGE_KEYS.DRAFTS, JSON.stringify([]));
    localStorage.setItem(this.STORAGE_KEYS.REPAYMENTS, JSON.stringify([]));
    this.logActivity("Demo Data Loaded", "Loaded test mock dataset into database");
  }

  clearAllData() {
    localStorage.setItem(this.STORAGE_KEYS.PRODUCTS, JSON.stringify([]));
    localStorage.setItem(this.STORAGE_KEYS.SALES, JSON.stringify([]));
    localStorage.setItem(this.STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify([]));
    localStorage.setItem(this.STORAGE_KEYS.DRAFTS, JSON.stringify([]));
    localStorage.setItem(this.STORAGE_KEYS.REPAYMENTS, JSON.stringify([]));
    this.logActivity("Database Cleared", "Wiped all inventory products, sales, activity logs, drafts, and repayments");
  }
}

const db = new POSDatabase();
