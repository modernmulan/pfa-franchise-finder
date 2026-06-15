/* =====================================================================
   data.js — Franchise catalog + seeded area profiles
   ---------------------------------------------------------------------
   CATALOG figures are from the PFA demo seed table (PRD §10): real,
   PH-market figures sourced from franchisor pages and PH franchise
   directories. They are ESTIMATES that vary by package, store size,
   location, and year, so the UI presents them as ranges with an
   "as of" date. Unconfirmed figures are left null and shown as
   "On request" rather than guessed.
   ===================================================================== */

/* Category metadata: label + colour used for pins, chips and avatars */
const CATEGORIES = {
  "food-cart":     { label: "Food cart",        color: "#e8590c", emoji: "🍢" },
  "coffee":        { label: "Coffee",           color: "#8a5a2b", emoji: "☕" },
  "milktea":       { label: "Milk tea",         color: "#b07d62", emoji: "🧋" },
  "beverage":      { label: "Beverage",         color: "#0ca678", emoji: "🥤" },
  "dessert":       { label: "Dessert",          color: "#e64980", emoji: "🧇" },
  "pizza":         { label: "Pizza",            color: "#f08c00", emoji: "🍕" },
  "fastfood":      { label: "Fast food",        color: "#e03131", emoji: "🍔" },
  "convenience":   { label: "Convenience",      color: "#1971c2", emoji: "🏪" },
  "pharmacy":      { label: "Pharmacy",         color: "#2f9e44", emoji: "💊" },
  "service-bills": { label: "Bills Payment",     color: "#7048e8", emoji: "🧾" },
  "personal-care": { label: "Personal care",    color: "#d6336c", emoji: "💅" },
  "fuel":          { label: "Fuel retail",      color: "#495057", emoji: "⛽" },
  "laundry":       { label: "Laundry",          color: "#1098ad", emoji: "🧺" },
  "education":     { label: "Education",         color: "#2b8a3e", emoji: "📚" },
};

/* Budget bands used by the filter */
const BUDGET_BANDS = {
  "u250":   { min: 0,        max: 250000 },
  "250-500":{ min: 250000,   max: 500000 },
  "500-1m": { min: 500000,   max: 1000000 },
  "1m-5m":  { min: 1000000,  max: 5000000 },
  "5m-10m": { min: 5000000,  max: 10000000 },
  "10m+":   { min: 10000000, max: Infinity },
};

/* Brands offered in more than one store format. Anything not listed runs in
   just its single `format`. The investment range already spans the cheapest
   (cart/kiosk) to the priciest (café / in-line) package. */
const BRAND_FORMATS = {
  "siomai-king": ["cart", "kiosk"],
  "toktok": ["cart", "kiosk"],
  "santinos": ["kiosk", "cart"],
  "johann-coffee": ["kiosk", "cart"],
  "fruitas": ["kiosk", "cart"],
  "belgian-waffles": ["kiosk", "cart"],
  "potato-corner": ["cart", "kiosk", "inline"],
  "macao-tea": ["inline", "kiosk"],
  "pickup-coffee": ["kiosk", "cart", "inline"],
};
function brandFormats(b) { return BRAND_FORMATS[b.id] || [b.format]; }

/* ---------------------------------------------------------------------
   FRANCHISE CATALOG
   targetTier: who the price-point / customer skews to. "mass" | "mid" | "premium"
   format:     "cart" | "kiosk" | "inline" | "standalone"
   ownership:  "owner" (owner-operated) | "passive" (manager / semi-passive)
   logoDomain: used to fetch a real brand logo (emoji fallback if it fails)
   --------------------------------------------------------------------- */
const CATALOG = [
  {
    id: "siomai-king", name: "Siomai King", category: "food-cart",
    franchiseFee: 12000, investMin: 150000, investMax: 240000,
    royalty: "None", space: "2 to 4 sqm (cart)", format: "cart", ownership: "owner",
    targetTier: "mass", logoDomain: "siomaiking.com.ph",
    description: "High-volume siomai and rice-meal food cart. No royalty and no renewal fee, one of the lowest-overhead carts in the market.",
    notes: "No royalty and no renewal fee. Makati-based franchisor.",
    website: "https://siomaiking.com.ph", source: "Franchisor page / Franchise.ph", asOf: "2026-06",
  },
  {
    id: "toktok", name: "TokTok", category: "food-cart",
    franchiseFee: 16880, investMin: 59000, investMax: 289000,
    royalty: "None", space: "2 to 6 sqm (cart)", format: "cart", ownership: "owner",
    targetTier: "mass", logoDomain: null,
    description: "Low-capital snack cart with multiple package tiers. Quick payback profile makes it a popular first franchise.",
    notes: "Low capital, quick payback.",
    website: null, source: "PH franchise directories", asOf: "2026-06",
  },
  {
    id: "santinos", name: "Santino's Supreme Slice", category: "pizza",
    franchiseFee: 50000, investMin: 70000, investMax: 100000,
    royalty: "None", space: "4 to 8 sqm (kiosk)", format: "kiosk", ownership: "owner",
    targetTier: "mass", logoDomain: null,
    description: "Big-slice pizza kiosk at an entry-level price. Under ₱100K all-in for a small footprint.",
    notes: "Entry-level food kiosk.",
    website: null, source: "PH franchise directories", asOf: "2026-06",
  },
  {
    id: "johann-coffee", name: "Johann Coffee & Beverages", category: "coffee",
    franchiseFee: 90000, investMin: 90000, investMax: 100000,
    royalty: "On request", space: "4 to 10 sqm (kiosk)", format: "kiosk", ownership: "owner",
    targetTier: "mid", logoDomain: null,
    description: "Entry-level coffee and beverage kiosk for under ₱100K, a low-cost way into the café category.",
    notes: "Entry-level coffee.",
    website: null, source: "PH franchise directories", asOf: "2026-06",
  },
  {
    id: "fruitas", name: "Fruitas", category: "beverage",
    franchiseFee: null, investMin: 290000, investMax: 450000,
    royalty: "On request", space: "6 to 12 sqm (kiosk)", format: "kiosk", ownership: "owner",
    targetTier: "mid", logoDomain: "fruitas.ph",
    description: "Fresh-fruit drinks and shakes kiosk from an established listed F&B group. Cost-efficient package with a strong mall presence.",
    notes: "Cost-efficient package. Publicly listed group.",
    website: "https://www.fruitas.ph", source: "Franchisor / Fruitas Holdings", asOf: "2026-06",
  },
  {
    id: "belgian-waffles", name: "Famous Belgian Waffles", category: "dessert",
    franchiseFee: null, investMin: 300000, investMax: 500000,
    royalty: "On request", space: "6 to 12 sqm (kiosk)", format: "kiosk", ownership: "owner",
    targetTier: "mass", logoDomain: "famousbelgianwaffles.ph",
    description: "Belgian-style waffle dessert kiosk with a well-known mall footprint and a loyal mall-goer following.",
    notes: "",
    website: "https://famousbelgianwaffles.ph", source: "Franchisor page", asOf: "2026-06",
  },
  {
    id: "potato-corner", name: "Potato Corner", category: "food-cart",
    franchiseFee: 150000, investMin: 325000, investMax: 550000,
    royalty: "6% of monthly gross", space: "Minimum 6 sqm", format: "cart", ownership: "owner",
    targetTier: "mass", logoDomain: "potatocorner.com",
    description: "Flavoured fries, the iconic PH mall cart. Strong brand pull, with ROI commonly cited around 30 months.",
    notes: "ROI around 30 months. Min 6 sqm. Royalty 6%.",
    website: "https://www.potatocorner.com", source: "Franchisor franchising page", asOf: "2026-06",
  },
  {
    id: "macao-tea", name: "Macao Imperial Tea", category: "milktea",
    franchiseFee: null, investMin: 800000, investMax: 1500000,
    royalty: "On request", space: "20 to 40 sqm (café)", format: "inline", ownership: "owner",
    targetTier: "mid", logoDomain: "macaoimperialtea.com",
    description: "Café-format milk tea brand under the Fredley Group. Sit-down footprint with premium milk-tea positioning.",
    notes: "Café-format milk tea, Fredley Group.",
    website: null, source: "Fredley Group / directories", asOf: "2026-06",
  },
  {
    id: "generika", name: "Generika Drugstore", category: "pharmacy",
    franchiseFee: null, investMin: 700000, investMax: 1200000,
    royalty: "On request", space: "20 to 40 sqm", format: "inline", ownership: "passive",
    targetTier: "mass", logoDomain: "generika.com.ph",
    description: "Affordable-generics pharmacy chain. A healthcare staple with strong relevance in both urban and rural areas.",
    notes: "Healthcare. Urban and rural relevance.",
    website: "https://generika.com.ph", source: "Franchisor page", asOf: "2026-06",
  },
  {
    id: "bayad-center", name: "Bayad Center", category: "service-bills",
    franchiseFee: 350000, investMin: 600000, investMax: 850000,
    royalty: "On request", space: "15 to 30 sqm", format: "inline", ownership: "passive",
    targetTier: "mass", logoDomain: "bayad.com",
    description: "Multi-biller bills-payment outlet. Recurring foot traffic from utility and government payments.",
    notes: "Franchise fee ₱350K plus VAT. Around ₱600K bond plus ₱250K setup.",
    website: "https://bayad.com", source: "Franchisor page", asOf: "2026-06",
  },
  {
    id: "lay-bare", name: "Lay Bare", category: "personal-care",
    franchiseFee: null, investMin: 2200000, investMax: 3300000,
    royalty: "On request", space: "40 to 80 sqm", format: "inline", ownership: "passive",
    targetTier: "mid", logoDomain: "laybarewaxing.com",
    description: "Waxing and personal-care salon chain. Loyal repeat clientele, with ROI commonly cited at 24 to 36 months.",
    notes: "ROI 24 to 36 months.",
    website: "https://laybarewaxing.com", source: "Franchisor page", asOf: "2026-06",
  },
  {
    id: "7-eleven", name: "7-Eleven", category: "convenience",
    franchiseFee: null, investMin: 3500000, investMax: 5000000,
    royalty: "Gross-profit share", space: "60 to 120 sqm", format: "standalone", ownership: "passive",
    targetTier: "mid", logoDomain: "7-eleven.com.ph",
    description: "24/7 convenience retail. High foot traffic and established systems, but capital and operations intensive.",
    notes: "24/7 format, high foot traffic.",
    website: "https://www.7-eleven.com.ph", source: "Franchisor page", asOf: "2026-06",
  },
  {
    id: "petron-shell", name: "Petron / Shell Station", category: "fuel",
    franchiseFee: null, investMin: 3000000, investMax: 6000000,
    royalty: "On request", space: "Lot required", format: "standalone", ownership: "passive",
    targetTier: "mid", logoDomain: "petron.com",
    description: "Fuel-retail station. Requires land, permits, and significant capital, best on high-vehicle-traffic corridors.",
    notes: "Requires land and permits. Fee varies.",
    website: null, source: "Franchisor pages", asOf: "2026-06",
  },
  {
    id: "jollibee", name: "Jollibee", category: "fastfood",
    franchiseFee: null, investMin: 35000000, investMax: 55000000,
    royalty: "Royalty plus marketing fee", space: "150 to 300 sqm", format: "standalone", ownership: "passive",
    targetTier: "mass", logoDomain: "jollibee.com.ph",
    description: "The Philippines' flagship fast-food brand. Premium capital requirement and highly selective on sites and franchisees.",
    notes: "Premium, high capital.",
    website: "https://www.jollibeefranchising.com", source: "JFC franchising page", asOf: "2026-06",
  },
  {
    id: "mcdonalds", name: "McDonald's", category: "fastfood",
    franchiseFee: null, investMin: 30000000, investMax: 50000000,
    royalty: "Royalty plus rent plus marketing", space: "150 to 300 sqm", format: "standalone", ownership: "passive",
    targetTier: "mid", logoDomain: "mcdonalds.com.ph",
    description: "Global fast-food franchise. From around ₱30M all-in, with rigorous franchisee selection and a multi-year commitment.",
    notes: "Premium, high capital.",
    website: "https://www.mcdonalds.com.ph", source: "Franchisor page", asOf: "2026-06",
  },

  {
    id: "bos-coffee", name: "Bo's Coffee", category: "coffee",
    franchiseFee: null, investMin: 5000000, investMax: 9000000,
    royalty: "On request", space: "60 to 120 sqm", format: "inline", ownership: "passive",
    targetTier: "premium", logoDomain: null,
    description: "Homegrown specialty coffee chain with a full café format. Established brand with a loyal, higher-spend clientele.",
    notes: "", website: null, source: "PH franchise directories", asOf: "2026-06",
  },
  {
    id: "pickup-coffee", name: "Pickup Coffee", category: "coffee",
    franchiseFee: null, investMin: 2500000, investMax: 4500000,
    royalty: "On request", space: "15 to 40 sqm", format: "kiosk", ownership: "passive",
    targetTier: "mid", logoDomain: null,
    description: "Fast-growing grab-and-go coffee brand with compact, high-turnover stores and aggressive nationwide expansion.",
    notes: "", website: null, source: "PH franchise directories", asOf: "2026-06",
  },
  {
    id: "mang-inasal", name: "Mang Inasal", category: "fastfood",
    franchiseFee: null, investMin: 25000000, investMax: 35000000,
    royalty: "Royalty plus marketing fee", space: "150 to 350 sqm", format: "standalone", ownership: "passive",
    targetTier: "mass", logoDomain: null,
    description: "Grilled-chicken fast-food chain under the Jollibee group. Strong mass-market pull, premium capital and selective franchising.",
    notes: "", website: null, source: "JFC franchising / directories", asOf: "2026-06",
  },
  {
    id: "red-ribbon", name: "Red Ribbon", category: "dessert",
    franchiseFee: null, investMin: 15000000, investMax: 25000000,
    royalty: "Royalty plus marketing fee", space: "80 to 150 sqm", format: "standalone", ownership: "passive",
    targetTier: "mass", logoDomain: null,
    description: "Bakeshop and cake chain under the Jollibee group. Go-to brand for celebrations; high capital, standalone format.",
    notes: "", website: null, source: "JFC franchising / directories", asOf: "2026-06",
  },
  {
    id: "tgp", name: "The Generics Pharmacy", category: "pharmacy",
    franchiseFee: 150000, investMin: 1200000, investMax: 2500000,
    royalty: "On request", space: "15 to 30 sqm", format: "inline", ownership: "passive",
    targetTier: "mass", logoDomain: null,
    description: "The country's largest generics drugstore network. Affordable-medicine positioning with very wide reach.",
    notes: "", website: null, source: "Franchisor / directories", asOf: "2026-06",
  },
  {
    id: "k2-pharmacy", name: "K2 Pharmacy", category: "pharmacy",
    franchiseFee: null, investMin: 800000, investMax: 1800000,
    royalty: "On request", space: "15 to 30 sqm", format: "inline", ownership: "passive",
    targetTier: "mass", logoDomain: null,
    description: "Community drugstore franchise with an affordable startup. Healthcare retail for neighbourhood markets.",
    notes: "", website: null, source: "PH franchise directories", asOf: "2026-06",
  },
  {
    id: "seaoil", name: "SEAOIL", category: "fuel",
    franchiseFee: null, investMin: 5000000, investMax: 15000000,
    royalty: "On request", space: "Lot required", format: "standalone", ownership: "passive",
    targetTier: "mid", logoDomain: null,
    description: "Independent fuel-retail brand. Requires land and permits; best on high-vehicle-traffic corridors.",
    notes: "", website: null, source: "Franchisor / directories", asOf: "2026-06",
  },
  {
    id: "uncle-johns", name: "Uncle John's", category: "convenience",
    franchiseFee: null, investMin: 2000000, investMax: 4000000,
    royalty: "On request", space: "40 to 80 sqm", format: "inline", ownership: "passive",
    targetTier: "mid", logoDomain: null,
    description: "Convenience and quick-meal store, often paired with fuel stations. 24/7 grab-and-go format.",
    notes: "", website: null, source: "PH franchise directories", asOf: "2026-06",
  },
  {
    id: "kumon", name: "Kumon", category: "education",
    franchiseFee: null, investMin: 500000, investMax: 1000000,
    royalty: "Per-student royalty", space: "40 to 80 sqm", format: "inline", ownership: "owner",
    targetTier: "mid", logoDomain: null,
    description: "Global after-school maths and reading program. Owner-operated learning centre with recurring tuition revenue.",
    notes: "", website: null, source: "Franchisor / directories", asOf: "2026-06",
  },
  {
    id: "ama", name: "AMA Education", category: "education",
    franchiseFee: null, investMin: 3000000, investMax: 8000000,
    royalty: "On request", space: "Standalone / floor", format: "standalone", ownership: "passive",
    targetTier: "mid", logoDomain: null,
    description: "Computer-learning and tertiary education brand. Larger-format campus with an established curriculum.",
    notes: "", website: null, source: "PH franchise directories", asOf: "2026-06",
  },
];

/* ---------------------------------------------------------------------
   AREA PROFILES (seeded demo data)
   incomeTier / customer skew: "mass" | "mid" | "premium"
   *Pop / *traffic levels: 0..1
   population / ageLabel feed the AI reco summary
   --------------------------------------------------------------------- */
const AREAS = {
  "angeles city": {
    name: "Angeles City, Pampanga",
    center: [15.1450, 120.5887], zoom: 15,
    population: "around 460,000 residents",
    ageLabel: "a young, student and worker-heavy crowd (median age about 27), plus steady tourist flow",
    demographics: { incomeTier: "mid", daytimePop: 0.85, residential: 0.7, student: 0.8, tourist: 0.7 },
    traffic: { foot: 0.8, vehicle: 0.85, transit: 0.6 },
    blurb: "a dense commercial and entertainment district with a strong daytime and night economy",
    distribution: {
      "food-cart": 14, "coffee": 10, "milktea": 13, "beverage": 7, "dessert": 6,
      "pizza": 4, "fastfood": 11, "convenience": 12, "pharmacy": 8,
      "service-bills": 5, "personal-care": 7, "fuel": 4, "education": 3,
    },
    anchors: [
      { name: "SM City Clark area", type: "mall",   off: [0.010, -0.004] },
      { name: "Marquee Mall",       type: "mall",   off: [-0.008, 0.012] },
      { name: "Holy Angel University", type: "school", off: [0.003, -0.009] },
      { name: "Nepo Center",        type: "office", off: [-0.004, -0.006] },
      { name: "Rafael Lazatin Hospital", type: "hospital", off: [0.007, 0.008] },
      { name: "Dau Terminal",       type: "transit", off: [0.012, 0.010] },
    ],
  },

  "makati cbd": {
    name: "Makati CBD",
    center: [14.5547, 121.0244], zoom: 15,
    population: "a daytime population well over 1 million workers",
    ageLabel: "office professionals roughly 25 to 45 with high spending power",
    demographics: { incomeTier: "premium", daytimePop: 0.98, residential: 0.5, student: 0.3, tourist: 0.5 },
    traffic: { foot: 0.95, vehicle: 0.7, transit: 0.85 },
    blurb: "the country's premier business district with very high daytime office population and premium price tolerance",
    distribution: {
      "food-cart": 6, "coffee": 18, "milktea": 14, "beverage": 9, "dessert": 7,
      "pizza": 6, "fastfood": 16, "convenience": 18, "pharmacy": 11,
      "service-bills": 8, "personal-care": 11, "fuel": 2, "education": 3,
    },
    anchors: [
      { name: "Greenbelt",      type: "mall",   off: [0.002, 0.002] },
      { name: "Glorietta",      type: "mall",   off: [0.004, -0.003] },
      { name: "Ayala Triangle", type: "office", off: [0.000, -0.001] },
      { name: "RCBC Plaza",     type: "office", off: [-0.005, 0.004] },
      { name: "Makati Med",     type: "hospital", off: [0.006, 0.006] },
      { name: "Ayala MRT",      type: "transit", off: [0.001, -0.005] },
    ],
  },

  "quezon city": {
    name: "Quezon City",
    center: [14.6760, 121.0437], zoom: 14,
    population: "around 2.96 million residents",
    ageLabel: "students and young families spanning roughly 18 to 40",
    demographics: { incomeTier: "mid", daytimePop: 0.8, residential: 0.85, student: 0.85, tourist: 0.3 },
    traffic: { foot: 0.7, vehicle: 0.9, transit: 0.8 },
    blurb: "the largest LGU by population, a mix of universities, residential pockets, malls and transit corridors",
    distribution: {
      "food-cart": 13, "coffee": 11, "milktea": 15, "beverage": 7, "dessert": 6,
      "pizza": 4, "fastfood": 13, "convenience": 13, "pharmacy": 9,
      "service-bills": 6, "personal-care": 7, "fuel": 5, "education": 4,
    },
    anchors: [
      { name: "SM North EDSA",  type: "mall",   off: [0.012, -0.010] },
      { name: "Trinoma",        type: "mall",   off: [0.010, -0.008] },
      { name: "UP Diliman",     type: "school", off: [-0.006, -0.012] },
      { name: "Eton Centris",   type: "office", off: [-0.004, -0.004] },
      { name: "St. Luke's QC",  type: "hospital", off: [0.006, 0.010] },
      { name: "Quezon Ave MRT", type: "transit", off: [-0.003, -0.006] },
    ],
  },
};

/* Aliases so common typings resolve to seeded cities */
const AREA_ALIASES = {
  "angeles": "angeles city",
  "makati": "makati cbd",
  "makati city": "makati cbd",
  "qc": "quezon city",
  "diliman": "quezon city",
};
