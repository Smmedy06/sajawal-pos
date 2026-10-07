/* Single-Store Initial Configuration for Sajawal POS */

const DEFAULT_SETTINGS = {
  business_name: "Sajawal POS",
  business_address: "Shop # 14, Commercial Market, MM Alam Road, Gulberg III, Lahore",
  business_phone: "+92 321 4829100",
  currency_symbol: "Rs.",
  markup_percentage: 20, // Default 20% markup rule
  printer_width_mm: 80,  // 80mm thermal receipt
  printer_name: "POS-80 Thermal Printer",
  cashier_name: "Sajawal Khan"
};

// Production default: BLANK DATABASE FOR CLIENT PRODUCTION USE
const INITIAL_PRODUCTS = [];
const INITIAL_SALES = [];
const INITIAL_ACTIVITY_LOG = [];
const INITIAL_DRAFTS = [];
const INITIAL_REPAYMENTS = [];

// Optional Mock Dataset for Testing & Demonstration
const TEST_MOCK_PRODUCTS = [
  {
    id: "PROD-101",
    name: "Maybelline Lash Sensational Mascara",
    cost_price: 2200,
    selling_price: 2850,
    stock_qty: 35,
    created_at: "2026-07-01T10:00:00Z"
  },
  {
    id: "PROD-102",
    name: "Huda Beauty Nude Eyeshadow Palette",
    cost_price: 14500,
    selling_price: 18500,
    stock_qty: 8,
    created_at: "2026-07-01T10:30:00Z"
  },
  {
    id: "PROD-103",
    name: "The Ordinary Niacinamide 10% Serum 30ml",
    cost_price: 2400,
    selling_price: null,
    stock_qty: 42,
    created_at: "2026-07-02T08:00:00Z"
  },
  {
    id: "PROD-104",
    name: "CeraVe Hydrating Facial Cleanser 236ml",
    cost_price: 3800,
    selling_price: 4650,
    stock_qty: 15,
    created_at: "2026-07-02T09:00:00Z"
  },
  {
    id: "PROD-105",
    name: "MAC Velvet Teddy Matte Lipstick",
    cost_price: 5800,
    selling_price: 7200,
    stock_qty: 20,
    created_at: "2026-07-03T11:00:00Z"
  }
];

const TEST_MOCK_SALES = [
  {
    id: "INV-1001",
    invoice_number: "INV-1001",
    created_at: "2026-08-05T11:30:00Z",
    edited_at: null,
    subtotal: 7500,
    discount_type: "flat",
    discount_value: 0,
    discount_amount: 0,
    total: 7500,
    amount_paid: 7500,
    credit_amount: 0,
    payment_status: "Paid",
    payment_method: "Cash",
    customer_name: "Walk-in Customer",
    cashier_name: "Sajawal Khan",
    items: [
      {
        product_id: "PROD-101",
        product_name_snapshot: "Maybelline Lash Sensational Mascara",
        unit_price_snapshot: 2850,
        cost_price_snapshot: 2200,
        quantity: 1,
        line_total: 2850
      },
      {
        product_id: "PROD-104",
        product_name_snapshot: "CeraVe Hydrating Facial Cleanser 236ml",
        unit_price_snapshot: 4650,
        cost_price_snapshot: 3800,
        quantity: 1,
        line_total: 4650
      }
    ]
  }
];

const TEST_MOCK_LOGS = [
  {
    id: "ACT-1001",
    timestamp: "2026-08-05T11:30:00Z",
    user: "Sajawal Khan",
    action: "Sale Completed",
    details: "Invoice INV-1001 created for Rs. 7,500 via Cash"
  }
];
