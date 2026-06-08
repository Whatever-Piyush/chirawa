import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';

// ─── Idempotency helper ───────────────────────────────────────────────────────
// Category / Product / ProductImage have no natural unique key in the schema
// (only `id`). To make this seed safely re-runnable we derive a *stable* UUID
// from a string seed, so the same logical row always upserts to the same id.
// Shop ids are themselves stable across runs because shops upsert by their
// unique `sellerId`, so `cat:<shopId>:<name>` stays constant run-to-run.
function stableUuid(seed: string): string {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '5' + h.slice(13, 16),          // version nibble
    variant + h.slice(17, 20),      // RFC-4122 variant
    h.slice(20, 32),
  ].join('-');
}

// Canonical display order for the 8 categories. Note: the schema's Category
// model has no emoji/color columns and categories are per-shop, so only name +
// sortOrder are persisted (the home category grid is hardcoded client-side).
const CATEGORY_SORT: Record<string, number> = {
  'Grocery & Kitchen': 1,
  'Dairy & Bread':     2,
  'Snacks & Drinks':   3,
  'Veggies & Fruits':  4,
  'Dry Fruits & Nuts': 5,
  'Bakery':            6,
  'Sauces & Spreads':  7,
  'Sweets & Mithai':   8,
};

// Products carry no images by design — the customer card renders a clean
// branded placeholder when a product has no ProductImage rows. Only fresh
// mithai shops and real-world brand names populate the catalog.
interface SeedProduct {
  name:       string;
  unit:       string;
  pricePaise: number;
  mrpPaise:   number;
  category:   string;
}

interface SeedShop {
  phone:     string;
  ownerName: string;
  shopName:  string;
  address:   string;
  lat:       string;
  lng:       string;
  featured?: boolean;   // true → shown in the "Chirawa Special" surface
  products:  SeedProduct[];
}

// ── Product → shop placement ──────────────────────────────────────────────────
// Shops 1-5 are general/kirana stores stocked with common, famous-brand packed
// goods spread across all 8 categories. Shops 6-10 are the local mithai shops
// (featured) selling fresh, made-to-order sweets and saag-rotta.
const SHOPS: SeedShop[] = [
  {
    phone: '9001110001', ownerName: 'Ramesh Kumar',
    shopName: 'Shop 1 — General Store',
    address: 'Main Bazar, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.23900000', lng: '75.63900000',
    products: [
      // Grocery & Kitchen — atta, rice, oil, ghee, dal, masala, tea, coffee
      { name: 'Aashirvaad Select Atta',           unit: '5 kg',   pricePaise: 28500, mrpPaise: 32000, category: 'Grocery & Kitchen' },
      { name: 'Fortune Chakki Fresh Atta',        unit: '5 kg',   pricePaise: 24500, mrpPaise: 27000, category: 'Grocery & Kitchen' },
      { name: 'India Gate Classic Basmati Rice',  unit: '1 kg',   pricePaise: 9500,  mrpPaise: 11000, category: 'Grocery & Kitchen' },
      { name: 'Daawat Rozana Basmati Rice',       unit: '1 kg',   pricePaise: 8500,  mrpPaise: 9500,  category: 'Grocery & Kitchen' },
      { name: 'Fortune Sunflower Oil',            unit: '1 L',    pricePaise: 15500, mrpPaise: 18000, category: 'Grocery & Kitchen' },
      { name: 'Saffola Gold Edible Oil',          unit: '1 L',    pricePaise: 17500, mrpPaise: 19500, category: 'Grocery & Kitchen' },
      { name: 'Dhara Kachi Ghani Mustard Oil',    unit: '1 L',    pricePaise: 16500, mrpPaise: 18000, category: 'Grocery & Kitchen' },
      { name: 'Amul Pure Ghee',                   unit: '1 L',    pricePaise: 62000, mrpPaise: 65000, category: 'Grocery & Kitchen' },
      { name: 'Patanjali Cow Desi Ghee',          unit: '1 L',    pricePaise: 60000, mrpPaise: 63000, category: 'Grocery & Kitchen' },
      { name: 'Tata Salt Iodised',                unit: '1 kg',   pricePaise: 2800,  mrpPaise: 3000,  category: 'Grocery & Kitchen' },
      { name: 'Madhur Pure Sugar',                unit: '1 kg',   pricePaise: 4500,  mrpPaise: 5000,  category: 'Grocery & Kitchen' },
      { name: 'Tata Sampann Toor Dal',            unit: '1 kg',   pricePaise: 14000, mrpPaise: 16000, category: 'Grocery & Kitchen' },
      { name: 'Tata Sampann Moong Dal',           unit: '500 g',  pricePaise: 9000,  mrpPaise: 10000, category: 'Grocery & Kitchen' },
      { name: 'Tata Sampann Chana Dal',           unit: '500 g',  pricePaise: 5800,  mrpPaise: 6500,  category: 'Grocery & Kitchen' },
      { name: 'Rajdhani Besan',                   unit: '1 kg',   pricePaise: 8500,  mrpPaise: 9500,  category: 'Grocery & Kitchen' },
      { name: 'Tata Tea Gold',                    unit: '250 g',  pricePaise: 14000, mrpPaise: 15500, category: 'Grocery & Kitchen' },
      { name: 'Brooke Bond Red Label Tea',        unit: '250 g',  pricePaise: 13000, mrpPaise: 14500, category: 'Grocery & Kitchen' },
      { name: 'Bru Instant Coffee',               unit: '50 g',   pricePaise: 16500, mrpPaise: 18000, category: 'Grocery & Kitchen' },
      { name: 'Nescafé Classic Coffee',           unit: '50 g',   pricePaise: 19000, mrpPaise: 21000, category: 'Grocery & Kitchen' },
      { name: 'MDH Garam Masala',                 unit: '100 g',  pricePaise: 8000,  mrpPaise: 8500,  category: 'Grocery & Kitchen' },
      { name: 'Everest Turmeric (Haldi) Powder',  unit: '200 g',  pricePaise: 7000,  mrpPaise: 7500,  category: 'Grocery & Kitchen' },
      { name: 'Catch Red Chilli Powder',          unit: '100 g',  pricePaise: 5500,  mrpPaise: 6000,  category: 'Grocery & Kitchen' },
      { name: 'MDH Kitchen King Masala',          unit: '100 g',  pricePaise: 7500,  mrpPaise: 8000,  category: 'Grocery & Kitchen' },
      // Bakery — cake, rusk, cookies
      { name: 'Britannia Fruit Cake',             unit: '100 g',  pricePaise: 4500,  mrpPaise: 5000,  category: 'Bakery' },
      { name: 'Britannia Premium Bake Rusk',      unit: '200 g',  pricePaise: 4000,  mrpPaise: 4500,  category: 'Bakery' },
      { name: 'Parle Rusk Elaichi',               unit: '200 g',  pricePaise: 3500,  mrpPaise: 4000,  category: 'Bakery' },
      { name: 'Unibic Choco Chip Cookies',        unit: '75 g',   pricePaise: 4000,  mrpPaise: 4500,  category: 'Bakery' },
      { name: "McVitie's Digestive Biscuits",     unit: '250 g',  pricePaise: 8500,  mrpPaise: 9500,  category: 'Bakery' },
    ],
  },
  {
    phone: '9001110002', ownerName: 'Suresh Gupta',
    shopName: 'Shop 2 — Kirana Store',
    address: 'Station Road, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.24010000', lng: '75.64010000',
    products: [
      // Snacks & Drinks — chips, namkeen, biscuits, noodles, cereals, drinks
      { name: "Lay's Classic Salted",             unit: '52 g',   pricePaise: 2000,  mrpPaise: 2000,  category: 'Snacks & Drinks' },
      { name: "Lay's India's Magic Masala",       unit: '52 g',   pricePaise: 2000,  mrpPaise: 2000,  category: 'Snacks & Drinks' },
      { name: "Lay's American Cream & Onion",      unit: '52 g',   pricePaise: 2000,  mrpPaise: 2000,  category: 'Snacks & Drinks' },
      { name: 'Kurkure Masala Munch',             unit: '90 g',   pricePaise: 2000,  mrpPaise: 2000,  category: 'Snacks & Drinks' },
      { name: 'Bingo! Mad Angles Masala',         unit: '66 g',   pricePaise: 2000,  mrpPaise: 2000,  category: 'Snacks & Drinks' },
      { name: "Haldiram's Aloo Bhujia",           unit: '200 g',  pricePaise: 6500,  mrpPaise: 7500,  category: 'Snacks & Drinks' },
      { name: "Haldiram's Bhujia Sev",            unit: '200 g',  pricePaise: 6500,  mrpPaise: 7500,  category: 'Snacks & Drinks' },
      { name: 'Bikaji Bikaneri Bhujia',           unit: '200 g',  pricePaise: 6000,  mrpPaise: 7000,  category: 'Snacks & Drinks' },
      { name: 'Parle-G Gold Biscuits',            unit: '250 g',  pricePaise: 3000,  mrpPaise: 3500,  category: 'Snacks & Drinks' },
      { name: 'Britannia Good Day Cashew',        unit: '200 g',  pricePaise: 4500,  mrpPaise: 5000,  category: 'Snacks & Drinks' },
      { name: 'Britannia Marie Gold',             unit: '250 g',  pricePaise: 3500,  mrpPaise: 4000,  category: 'Snacks & Drinks' },
      { name: 'Cadbury Oreo Vanilla',             unit: '120 g',  pricePaise: 3500,  mrpPaise: 4000,  category: 'Snacks & Drinks' },
      { name: 'Sunfeast Dark Fantasy Choco Fills',unit: '75 g',   pricePaise: 4000,  mrpPaise: 4500,  category: 'Snacks & Drinks' },
      { name: 'Maggi 2-Minute Masala Noodles',    unit: '70 g',   pricePaise: 1500,  mrpPaise: 1500,  category: 'Snacks & Drinks' },
      { name: 'Maggi Masala Noodles (4-pack)',    unit: '280 g',  pricePaise: 5600,  mrpPaise: 6000,  category: 'Snacks & Drinks' },
      { name: 'Sunfeast YiPPee! Magic Masala',    unit: '70 g',   pricePaise: 1500,  mrpPaise: 1500,  category: 'Snacks & Drinks' },
      { name: "Kellogg's Corn Flakes",            unit: '475 g',  pricePaise: 19000, mrpPaise: 21000, category: 'Snacks & Drinks' },
      { name: 'Coca-Cola',                        unit: '750 ml', pricePaise: 4000,  mrpPaise: 4500,  category: 'Snacks & Drinks' },
      { name: 'Pepsi',                            unit: '750 ml', pricePaise: 4000,  mrpPaise: 4500,  category: 'Snacks & Drinks' },
      { name: 'Sprite',                           unit: '750 ml', pricePaise: 4000,  mrpPaise: 4500,  category: 'Snacks & Drinks' },
      { name: 'Thums Up',                         unit: '750 ml', pricePaise: 4000,  mrpPaise: 4500,  category: 'Snacks & Drinks' },
      { name: 'Maaza Mango Drink',                unit: '600 ml', pricePaise: 4000,  mrpPaise: 4000,  category: 'Snacks & Drinks' },
      { name: 'Frooti Mango Drink',               unit: '250 ml', pricePaise: 2000,  mrpPaise: 2000,  category: 'Snacks & Drinks' },
      { name: 'Real Mixed Fruit Juice',           unit: '1 L',    pricePaise: 11000, mrpPaise: 12000, category: 'Snacks & Drinks' },
      { name: 'Bisleri Mineral Water',            unit: '1 L',    pricePaise: 2000,  mrpPaise: 2000,  category: 'Snacks & Drinks' },
    ],
  },
  {
    phone: '9001110003', ownerName: 'Mahesh Sharma',
    shopName: 'Shop 3 — Daily Needs',
    address: 'Purani Mandi, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.24120000', lng: '75.64120000',
    products: [
      // Dry Fruits & Nuts — famous packed brands
      { name: 'Happilo California Almonds',        unit: '200 g',  pricePaise: 22000, mrpPaise: 25000, category: 'Dry Fruits & Nuts' },
      { name: 'Happilo Premium Whole Cashews',     unit: '200 g',  pricePaise: 24000, mrpPaise: 27000, category: 'Dry Fruits & Nuts' },
      { name: 'Nutraj Walnut Kernels',             unit: '200 g',  pricePaise: 30000, mrpPaise: 34000, category: 'Dry Fruits & Nuts' },
      { name: 'Happilo Roasted Pistachios',        unit: '200 g',  pricePaise: 32000, mrpPaise: 36000, category: 'Dry Fruits & Nuts' },
      { name: 'Happilo Black Raisins',             unit: '200 g',  pricePaise: 9000,  mrpPaise: 10000, category: 'Dry Fruits & Nuts' },
      { name: 'Vedaka Golden Raisins (Kishmish)',  unit: '200 g',  pricePaise: 8000,  mrpPaise: 9000,  category: 'Dry Fruits & Nuts' },
      { name: 'Kimia Dates (Khajoor)',             unit: '500 g',  pricePaise: 12000, mrpPaise: 14000, category: 'Dry Fruits & Nuts' },
      { name: 'Nutraj Dried Figs (Anjeer)',        unit: '200 g',  pricePaise: 24000, mrpPaise: 27000, category: 'Dry Fruits & Nuts' },
      { name: 'Tata Sampann Mixed Dry Fruits',     unit: '200 g',  pricePaise: 18000, mrpPaise: 21000, category: 'Dry Fruits & Nuts' },
    ],
  },
  {
    phone: '9001110004', ownerName: 'Dinesh Saini',
    shopName: 'Shop 4 — Fresh Mart',
    address: 'Nehru Colony, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.24230000', lng: '75.64230000',
    products: [
      // Veggies & Fruits — fresh daily produce
      { name: 'Fresh Tomatoes',        unit: '500 g', pricePaise: 2500, mrpPaise: 3000, category: 'Veggies & Fruits' },
      { name: 'Onion',                 unit: '1 kg',  pricePaise: 3500, mrpPaise: 4000, category: 'Veggies & Fruits' },
      { name: 'Potato',                unit: '1 kg',  pricePaise: 3000, mrpPaise: 3500, category: 'Veggies & Fruits' },
      { name: 'Fresh Banana',          unit: '6 pcs', pricePaise: 3500, mrpPaise: 4000, category: 'Veggies & Fruits' },
      { name: 'Green Chilli',          unit: '100 g', pricePaise: 1500, mrpPaise: 1800, category: 'Veggies & Fruits' },
      { name: 'Shimla Apple',          unit: '4 pcs', pricePaise: 8000, mrpPaise: 9500, category: 'Veggies & Fruits' },
      { name: 'Carrot',                unit: '500 g', pricePaise: 3000, mrpPaise: 3500, category: 'Veggies & Fruits' },
      { name: 'Fresh Ginger',          unit: '100 g', pricePaise: 2000, mrpPaise: 2500, category: 'Veggies & Fruits' },
      { name: 'Coriander (Dhaniya)',   unit: '100 g', pricePaise: 1500, mrpPaise: 2000, category: 'Veggies & Fruits' },
      { name: 'Lemon',                 unit: '250 g', pricePaise: 2500, mrpPaise: 3000, category: 'Veggies & Fruits' },
      { name: 'Cauliflower',           unit: '1 pc',  pricePaise: 3000, mrpPaise: 3500, category: 'Veggies & Fruits' },
      { name: 'Capsicum',              unit: '250 g', pricePaise: 3000, mrpPaise: 3500, category: 'Veggies & Fruits' },
      // Dairy & Bread — famous brands
      { name: 'Amul Taaza Toned Milk',          unit: '1 L',    pricePaise: 6200,  mrpPaise: 6500,  category: 'Dairy & Bread' },
      { name: 'Amul Gold Full Cream Milk',      unit: '500 ml', pricePaise: 3500,  mrpPaise: 3700,  category: 'Dairy & Bread' },
      { name: 'Mother Dairy Toned Milk',        unit: '1 L',    pricePaise: 6000,  mrpPaise: 6400,  category: 'Dairy & Bread' },
      { name: 'Amul Butter',                    unit: '100 g',  pricePaise: 5800,  mrpPaise: 6200,  category: 'Dairy & Bread' },
      { name: 'Amul Cheese Slices',             unit: '200 g',  pricePaise: 12000, mrpPaise: 13500, category: 'Dairy & Bread' },
      { name: 'Amul Malai Paneer',              unit: '200 g',  pricePaise: 9500,  mrpPaise: 10500, category: 'Dairy & Bread' },
      { name: 'Mother Dairy Paneer',            unit: '200 g',  pricePaise: 9000,  mrpPaise: 10000, category: 'Dairy & Bread' },
      { name: 'Amul Masti Dahi',                unit: '400 g',  pricePaise: 4000,  mrpPaise: 4500,  category: 'Dairy & Bread' },
      { name: 'Mother Dairy Classic Dahi',      unit: '400 g',  pricePaise: 4000,  mrpPaise: 4500,  category: 'Dairy & Bread' },
      { name: 'Britannia Brown Bread',          unit: '400 g',  pricePaise: 4500,  mrpPaise: 5000,  category: 'Dairy & Bread' },
      { name: 'Britannia Whole Wheat Bread',    unit: '400 g',  pricePaise: 5000,  mrpPaise: 5500,  category: 'Dairy & Bread' },
      { name: 'Farm Fresh Eggs',                unit: '6 pcs',  pricePaise: 7200,  mrpPaise: 8000,  category: 'Dairy & Bread' },
      { name: 'Amul Fresh Cream',               unit: '250 ml', pricePaise: 7500,  mrpPaise: 8000,  category: 'Dairy & Bread' },
      { name: 'Nestlé Milkmaid',                unit: '400 g',  pricePaise: 13500, mrpPaise: 15000, category: 'Dairy & Bread' },
      { name: 'Amul Lassi',                     unit: '250 ml', pricePaise: 2500,  mrpPaise: 2500,  category: 'Dairy & Bread' },
    ],
  },
  {
    phone: '9001110005', ownerName: 'Rajesh Agarwal',
    shopName: 'Shop 5 — Super Store',
    address: 'Sabzi Mandi, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.24340000', lng: '75.64340000',
    products: [
      // Sauces & Spreads — famous brands
      { name: 'Kissan Fresh Tomato Ketchup',      unit: '500 g',  pricePaise: 9500,  mrpPaise: 11000, category: 'Sauces & Spreads' },
      { name: 'Maggi Hot & Sweet Tomato Sauce',   unit: '415 g',  pricePaise: 13500, mrpPaise: 14500, category: 'Sauces & Spreads' },
      { name: 'Del Monte Tomato Ketchup',         unit: '950 g',  pricePaise: 14000, mrpPaise: 15500, category: 'Sauces & Spreads' },
      { name: 'Veeba Classic Mayonnaise',         unit: '250 g',  pricePaise: 9000,  mrpPaise: 10000, category: 'Sauces & Spreads' },
      { name: 'Fun Foods Veg Mayonnaise',         unit: '250 g',  pricePaise: 8500,  mrpPaise: 9500,  category: 'Sauces & Spreads' },
      { name: 'Kissan Mixed Fruit Jam',           unit: '500 g',  pricePaise: 13500, mrpPaise: 15000, category: 'Sauces & Spreads' },
      { name: 'Nutella Hazelnut Spread',          unit: '290 g',  pricePaise: 33000, mrpPaise: 36000, category: 'Sauces & Spreads' },
      { name: 'Sundrop Peanut Butter',            unit: '462 g',  pricePaise: 22000, mrpPaise: 24500, category: 'Sauces & Spreads' },
      { name: 'Pintola Natural Peanut Butter',    unit: '500 g',  pricePaise: 25000, mrpPaise: 28000, category: 'Sauces & Spreads' },
      { name: "Ching's Secret Schezwan Chutney",  unit: '250 g',  pricePaise: 9000,  mrpPaise: 10000, category: 'Sauces & Spreads' },
      { name: 'Dabur Honey',                      unit: '500 g',  pricePaise: 19500, mrpPaise: 21500, category: 'Sauces & Spreads' },
      { name: 'Saffola Honey',                    unit: '500 g',  pricePaise: 21000, mrpPaise: 23000, category: 'Sauces & Spreads' },
      // Sweets & Mithai — famous packed brands
      { name: "Haldiram's Soan Papdi",            unit: '250 g',  pricePaise: 8500,  mrpPaise: 9500,  category: 'Sweets & Mithai' },
      { name: "Haldiram's Gulab Jamun (Tin)",     unit: '1 kg',   pricePaise: 22000, mrpPaise: 24000, category: 'Sweets & Mithai' },
      { name: 'Bikaji Soan Papdi',                unit: '250 g',  pricePaise: 8000,  mrpPaise: 9000,  category: 'Sweets & Mithai' },
      { name: 'Gits Gulab Jamun Mix',             unit: '200 g',  pricePaise: 7000,  mrpPaise: 8000,  category: 'Sweets & Mithai' },
      { name: 'MTR Badam Feast Mix',              unit: '200 g',  pricePaise: 16000, mrpPaise: 18000, category: 'Sweets & Mithai' },
    ],
  },
  {
    phone: '9001110006', ownerName: 'Maturam Halwai',
    shopName: 'Maturam Misthan Bhandar', featured: true,
    address: 'Purani Mandi, Chirawa, Jhunjhunu 333026',
    lat: '28.24450000', lng: '75.64450000',
    products: [
      { name: 'Fresh Jalebi',    unit: '250 g', pricePaise: 6000, mrpPaise: 6500,  category: 'Sweets & Mithai' },
      { name: 'Besan Ladoo',     unit: '250 g', pricePaise: 8000, mrpPaise: 9000,  category: 'Sweets & Mithai' },
      { name: 'Motichoor Ladoo', unit: '250 g', pricePaise: 9000, mrpPaise: 10000, category: 'Sweets & Mithai' },
      { name: 'Gulab Jamun',     unit: '6 pcs', pricePaise: 6000, mrpPaise: 6500,  category: 'Sweets & Mithai' },
    ],
  },
  {
    phone: '9001110007', ownerName: 'Lal Chand',
    shopName: 'Lal Chand Misthan Bhandar', featured: true,
    address: 'Main Bazar, Chirawa, Jhunjhunu 333026',
    lat: '28.24560000', lng: '75.64560000',
    products: [
      { name: 'Kaju Barfi', unit: '250 g', pricePaise: 18000, mrpPaise: 20000, category: 'Sweets & Mithai' },
      { name: 'Milk Cake',  unit: '250 g', pricePaise: 15000, mrpPaise: 17000, category: 'Sweets & Mithai' },
      { name: 'Soan Papdi', unit: '200 g', pricePaise: 9000,  mrpPaise: 10000, category: 'Sweets & Mithai' },
      { name: 'Balushahi',  unit: '250 g', pricePaise: 7000,  mrpPaise: 8000,  category: 'Sweets & Mithai' },
    ],
  },
  {
    phone: '9001110008', ownerName: 'Mukesh Sharma',
    shopName: 'Sharma Saag Rotta Shop', featured: true,
    address: 'Bazar Road, Chirawa, Jhunjhunu 333026',
    lat: '28.24670000', lng: '75.64670000',
    products: [
      { name: 'Sarson ka Saag',  unit: '200 g', pricePaise: 4500, mrpPaise: 5000, category: 'Sweets & Mithai' },
      { name: 'Makki ki Roti',   unit: '2 pcs', pricePaise: 3000, mrpPaise: 3500, category: 'Sweets & Mithai' },
      { name: 'Bajra Roti',      unit: '2 pcs', pricePaise: 2500, mrpPaise: 3000, category: 'Sweets & Mithai' },
      { name: 'Mixed Dal Tadka', unit: '200 g', pricePaise: 5000, mrpPaise: 5500, category: 'Sweets & Mithai' },
    ],
  },
  {
    phone: '9001110009', ownerName: 'Nahar Singh',
    shopName: 'Nahar Singh Misthan Bhandar', featured: true,
    address: 'Station Road, Chirawa, Jhunjhunu 333026',
    lat: '28.24780000', lng: '75.64780000',
    products: [
      { name: 'Ghewar Special', unit: '1 pc',  pricePaise: 8000, mrpPaise: 9000, category: 'Sweets & Mithai' },
      { name: 'Imarti',         unit: '250 g', pricePaise: 6500, mrpPaise: 7500, category: 'Sweets & Mithai' },
      { name: 'Khurma',         unit: '250 g', pricePaise: 6500, mrpPaise: 7500, category: 'Sweets & Mithai' },
      { name: 'Mawa Kachori',   unit: '4 pcs', pricePaise: 6000, mrpPaise: 7000, category: 'Sweets & Mithai' },
    ],
  },
  {
    phone: '9001110010', ownerName: 'Bikaner Sweets',
    shopName: 'Bikaneri Misthan Bhandar', featured: true,
    address: 'Nehru Colony, Chirawa, Jhunjhunu 333026',
    lat: '28.24890000', lng: '75.64890000',
    products: [
      { name: 'Bikaneri Bhujia',  unit: '200 g', pricePaise: 8000, mrpPaise: 9000, category: 'Sweets & Mithai' },
      { name: 'Mathri',           unit: '200 g', pricePaise: 5500, mrpPaise: 6500, category: 'Sweets & Mithai' },
      { name: 'Namkeen Mix',      unit: '200 g', pricePaise: 5000, mrpPaise: 6000, category: 'Sweets & Mithai' },
      { name: 'Chakki Mungfali',  unit: '200 g', pricePaise: 4500, mrpPaise: 5500, category: 'Sweets & Mithai' },
    ],
  },
];

/**
 * Seeds 10 seller accounts, their shops, per-shop categories, and products.
 * Fully idempotent: users upsert by phone, profiles by userId, shops by
 * sellerId, and categories/products by deterministic stable UUIDs.
 * Products carry no images — any previously-seeded ProductImage rows are
 * cleared so re-running this seed removes product pictures everywhere.
 * Does NOT touch any pre-existing shops/sellers/products.
 */
export async function seedShops(prisma: PrismaClient): Promise<void> {
  // All seller dev logins use OTP 123456; PIN is bcrypt("123456").
  const pinHash = await bcrypt.hash('123456', 12);

  let shopCount = 0;
  let categoryCount = 0;
  let productCount = 0;

  for (const s of SHOPS) {
    // 1) Seller user (by unique phone)
    const user = await prisma.user.upsert({
      where:  { phone: s.phone },
      update: { role: 'seller', isActive: true },
      create: { phone: s.phone, role: 'seller', isActive: true },
    });

    // 2) Seller profile (by unique userId)
    const profile = await prisma.sellerProfile.upsert({
      where:  { userId: user.id },
      update: { ownerName: s.ownerName, pinHash },
      create: { userId: user.id, ownerName: s.ownerName, pinHash },
    });

    // 3) Shop (by unique sellerId) — id stays stable across runs
    const featured = s.featured ?? false;
    const shop = await prisma.shop.upsert({
      where:  { sellerId: profile.id },
      update: { name: s.shopName, address: s.address, lat: s.lat, lng: s.lng, isActive: true, isOpen: true, isFeatured: featured },
      create: { sellerId: profile.id, name: s.shopName, address: s.address, lat: s.lat, lng: s.lng, isActive: true, isOpen: true, isFeatured: featured },
    });
    shopCount++;

    // 4) Categories used by this shop's products (deterministic ids)
    const uniqueCategories = [...new Set(s.products.map((p) => p.category))];
    const categoryIdByName = new Map<string, string>();
    for (const name of uniqueCategories) {
      const id = stableUuid(`cat:${shop.id}:${name}`);
      const sortOrder = CATEGORY_SORT[name] ?? 99;
      await prisma.category.upsert({
        where:  { id },
        update: { name, sortOrder, isActive: true },
        create: { id, shopId: shop.id, name, sortOrder },
      });
      categoryIdByName.set(name, id);
      categoryCount++;
    }

    // 5) Products (deterministic ids) — no images by design
    for (let i = 0; i < s.products.length; i++) {
      const p = s.products[i];
      const productId = stableUuid(`prod:${shop.id}:${p.name}`);
      const categoryId = categoryIdByName.get(p.category)!;

      await prisma.product.upsert({
        where:  { id: productId },
        update: {
          name: p.name, price: p.pricePaise, mrpPaise: p.mrpPaise,
          unit: p.unit, categoryId, stockStatus: 'available',
          isActive: true, sortOrder: i,
        },
        create: {
          id: productId, shopId: shop.id, categoryId, name: p.name,
          price: p.pricePaise, mrpPaise: p.mrpPaise, unit: p.unit,
          stockStatus: 'available', isActive: true, sortOrder: i,
        },
      });

      // Products are imageless — drop any images left from earlier seeds.
      await prisma.productImage.deleteMany({ where: { productId } });
      productCount++;
    }
  }

  console.log(`  ✅ Shops seeded: ${shopCount} shops, ${categoryCount} categories, ${productCount} products (no product images)`);
}
