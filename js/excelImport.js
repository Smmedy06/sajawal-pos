/* Excel & CSV Bulk Import/Export Module */

const ExcelImporter = {
  parsedData: [],

  downloadSampleExcelTemplate: function() {
    const sampleData = [
      {
        "Product Name": "Maybelline Lash Sensational Mascara",
        "Cost Price": 2200,
        "Selling Price": 2850,
        "Stock Quantity": 35
      },
      {
        "Product Name": "CeraVe Hydrating Facial Cleanser 236ml",
        "Cost Price": 3800,
        "Selling Price": 4650,
        "Stock Quantity": 15
      },
      {
        "Product Name": "The Ordinary Niacinamide 10% Serum 30ml",
        "Cost Price": 2400,
        "Selling Price": "",
        "Stock Quantity": 40
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Product Template");
    XLSX.writeFile(workbook, "Sajawal_POS_Product_Import_Template.xlsx");
    db.logActivity("Template Downloaded", "Downloaded sample Excel import template");
  },

  parseFile: function(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (jsonRows.length < 2) {
          callback({ error: "The file is empty or missing header rows." });
          return;
        }

        const headers = jsonRows[0].map(h => String(h || "").trim().toLowerCase());
        const dataRows = jsonRows.slice(1);

        const nameIdx = headers.findIndex(h => h.includes("name") || h.includes("title") || h.includes("product"));
        const costIdx = headers.findIndex(h => h.includes("cost") || h.includes("buy"));
        const sellIdx = headers.findIndex(h => h.includes("sell") || h.includes("price") || h.includes("retail"));
        const stockIdx = headers.findIndex(h => h.includes("stock") || h.includes("qty") || h.includes("quantity"));

        const existingProducts = db.getProducts();
        const existingNames = new Set(existingProducts.map(p => p.name.trim().toLowerCase()));

        const previewItems = [];

        dataRows.forEach((row, i) => {
          if (!row || row.length === 0) return;
          const name = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : `Item #${i + 1}`;
          const cost = costIdx !== -1 ? Number(row[costIdx]) || 0 : 0;
          const sell = sellIdx !== -1 && row[sellIdx] ? Number(row[sellIdx]) : null;
          const stock = stockIdx !== -1 ? Number(row[stockIdx]) || 0 : 10;

          const isDuplicate = existingNames.has(name.toLowerCase());

          previewItems.push({
            rowNum: i + 2,
            name: name,
            cost_price: cost,
            selling_price: sell,
            stock_qty: stock,
            isDuplicate: isDuplicate
          });
        });

        ExcelImporter.parsedData = previewItems;
        callback({ success: true, items: previewItems });
      } catch (err) {
        callback({ error: "Failed to parse file: " + err.message });
      }
    };
    reader.readAsArrayBuffer(file);
  },

  commitImport: function(itemsToImport) {
    let importedCount = 0;

    itemsToImport.forEach(item => {
      db.addProduct({
        name: item.name,
        cost_price: item.cost_price,
        selling_price: item.selling_price,
        stock_qty: item.stock_qty
      });
      importedCount++;
    });

    db.logActivity("Bulk Import", `Imported ${importedCount} products via Excel/CSV`);
    return importedCount;
  },

  exportProductsToExcel: function() {
    const products = db.getProducts();
    const settings = db.getSettings();

    const dataToExport = products.map(p => ({
      "Product ID": p.id,
      "Product Name": p.name,
      "Cost Price (Rs.)": p.cost_price,
      "Selling Price (Rs.)": db.getEffectivePrice(p, settings.markup_percentage),
      "Pricing Rule": p.selling_price !== null ? "Manual Override" : `Markup ${settings.markup_percentage}%`,
      "Stock Quantity": p.stock_qty
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Product Catalog");
    XLSX.writeFile(workbook, `Sajawal_POS_Catalog_${new Date().toISOString().slice(0, 10)}.xlsx`);
    db.logActivity("Data Export", "Exported Product Catalog to Excel");
  },

  exportSalesToExcel: function(salesList = null) {
    const sales = salesList || db.getSales();

    const dataToExport = [];
    sales.forEach(sale => {
      sale.items.forEach(item => {
        dataToExport.push({
          "Invoice #": sale.invoice_number,
          "Date & Time": new Date(sale.created_at).toLocaleString(),
          "Customer Name": sale.customer_name,
          "Cashier": sale.cashier_name,
          "Item Name": item.product_name_snapshot,
          "Unit Price (Rs.)": item.unit_price_snapshot,
          "Quantity": item.quantity,
          "Line Total (Rs.)": item.line_total,
          "Invoice Subtotal (Rs.)": sale.subtotal,
          "Discount (Rs.)": sale.discount_amount,
          "Grand Total (Rs.)": sale.total,
          "Amount Paid (Rs.)": sale.amount_paid || sale.total,
          "Credit Due (Rs.)": sale.credit_amount || 0,
          "Payment Status": sale.payment_status || "Paid",
          "Payment Method": sale.payment_method,
          "Edit Status": sale.edited_at ? "Edited" : "Original"
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sales History");
    XLSX.writeFile(workbook, `Sajawal_POS_Sales_${new Date().toISOString().slice(0, 10)}.xlsx`);
    db.logActivity("Data Export", `Exported ${sales.length} sales records to Excel`);
  },

  exportCustomerCreditsToExcel: function() {
    const credits = db.getCustomerCredits();
    const dataToExport = credits.map(c => ({
      "Customer Name": c.customer_name,
      "Total Invoices": c.total_sales_count,
      "Total Purchased (Rs.)": c.total_purchased,
      "Initial Amount Paid (Rs.)": c.total_paid,
      "Total Credit Taken (Rs.)": c.total_credit,
      "Total Repayments Paid (Rs.)": c.total_repaid,
      "Remaining Credit Balance (Rs.)": c.remaining_balance,
      "Last Activity Date": new Date(c.last_activity).toLocaleString()
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Customer Credit Ledger");
    XLSX.writeFile(workbook, `Sajawal_POS_Customer_Credits_${new Date().toISOString().slice(0, 10)}.xlsx`);
    db.logActivity("Data Export", "Exported Customer Credit Ledger to Excel");
  },

  exportActivityLogToExcel: function() {
    const logs = db.getActivityLogs();
    const dataToExport = logs.map(l => ({
      "Log ID": l.id,
      "Date & Time": new Date(l.timestamp).toLocaleString(),
      "User / Cashier": l.user,
      "Action Performed": l.action,
      "Details": l.details
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "System Activity Log");
    XLSX.writeFile(workbook, `Sajawal_POS_ActivityLog_${new Date().toISOString().slice(0, 10)}.xlsx`);
    db.logActivity("Data Export", "Exported System Activity Log to Excel");
  }
};
