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

// Canonical display order for every category. Note: the schema's Category
// model has no emoji/color columns and categories are per-shop, so only name +
// sortOrder are persisted (the home category grid is hardcoded client-side).
const CATEGORY_SORT: Record<string, number> = {
  'Grocery & Kitchen':  1,
  'Dairy & Bread':      2,
  'Snacks & Drinks':    3,
  'Veggies & Fruits':   4,
  'Dry Fruits & Nuts':  5,
  'Bakery':             6,
  'Sauces & Spreads':   7,
  'Sweets & Mithai':    8,
  // Beauty & Personal Care sub-categories
  'Bath & Body':        9,
  'Hair Care':          10,
  'Skin & Face':        11,
  'Beauty & Cosmetics': 12,
  'Feminine Hygiene':   13,
  'Baby Care':          14,
  'Health & Pharma':    15,
  'Sexual Wellness':    16,
  // Household Essentials sub-categories
  'Home & Lifestyle':      17,
  'Cleaners & Repellents': 18,
  'Electronics':           19,
  'Stationery & Games':    20,
};

// Products carry no images by design — the customer card renders a clean
// branded placeholder when a product has no ProductImage rows.
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

// ── Dark-store model ──────────────────────────────────────────────────────────
// The app is a dark store: the customer browses by category and never sees which
// store an everyday item ships from. So the entire general catalog (grocery,
// dairy, snacks, beauty, …) lives in ONE invisible store ("Chirawa Store").
// The only shops surfaced to the customer are the featured Chirawa Special
// halwai/mithai shops below. Earlier per-area shops are retired (see
// RETIRED_PHONES) so they disappear from the catalog on re-seed.
const DARK_STORE_PRODUCTS: SeedProduct[] = [
  // ── Grocery & Kitchen ──────────────────────────────────────────────────────
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

  // ── Dairy & Bread ──────────────────────────────────────────────────────────
  { name: 'Amul Taaza Toned Milk',            unit: '1 L',    pricePaise: 6200,  mrpPaise: 6500,  category: 'Dairy & Bread' },
  { name: 'Amul Gold Full Cream Milk',        unit: '500 ml', pricePaise: 3500,  mrpPaise: 3700,  category: 'Dairy & Bread' },
  { name: 'Mother Dairy Toned Milk',          unit: '1 L',    pricePaise: 6000,  mrpPaise: 6400,  category: 'Dairy & Bread' },
  { name: 'Amul Butter',                      unit: '100 g',  pricePaise: 5800,  mrpPaise: 6200,  category: 'Dairy & Bread' },
  { name: 'Amul Cheese Slices',               unit: '200 g',  pricePaise: 12000, mrpPaise: 13500, category: 'Dairy & Bread' },
  { name: 'Amul Malai Paneer',                unit: '200 g',  pricePaise: 9500,  mrpPaise: 10500, category: 'Dairy & Bread' },
  { name: 'Mother Dairy Paneer',              unit: '200 g',  pricePaise: 9000,  mrpPaise: 10000, category: 'Dairy & Bread' },
  { name: 'Amul Masti Dahi',                  unit: '400 g',  pricePaise: 4000,  mrpPaise: 4500,  category: 'Dairy & Bread' },
  { name: 'Mother Dairy Classic Dahi',        unit: '400 g',  pricePaise: 4000,  mrpPaise: 4500,  category: 'Dairy & Bread' },
  { name: 'Britannia Brown Bread',            unit: '400 g',  pricePaise: 4500,  mrpPaise: 5000,  category: 'Dairy & Bread' },
  { name: 'Britannia Whole Wheat Bread',      unit: '400 g',  pricePaise: 5000,  mrpPaise: 5500,  category: 'Dairy & Bread' },
  { name: 'Farm Fresh Eggs',                  unit: '6 pcs',  pricePaise: 7200,  mrpPaise: 8000,  category: 'Dairy & Bread' },
  { name: 'Amul Fresh Cream',                 unit: '250 ml', pricePaise: 7500,  mrpPaise: 8000,  category: 'Dairy & Bread' },
  { name: 'Nestlé Milkmaid',                  unit: '400 g',  pricePaise: 13500, mrpPaise: 15000, category: 'Dairy & Bread' },
  { name: 'Amul Lassi',                       unit: '250 ml', pricePaise: 2500,  mrpPaise: 2500,  category: 'Dairy & Bread' },

  // ── Snacks & Drinks ────────────────────────────────────────────────────────
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

  // ── Veggies & Fruits ───────────────────────────────────────────────────────
  { name: 'Fresh Tomatoes',                   unit: '500 g',  pricePaise: 2500,  mrpPaise: 3000,  category: 'Veggies & Fruits' },
  { name: 'Onion',                            unit: '1 kg',   pricePaise: 3500,  mrpPaise: 4000,  category: 'Veggies & Fruits' },
  { name: 'Potato',                           unit: '1 kg',   pricePaise: 3000,  mrpPaise: 3500,  category: 'Veggies & Fruits' },
  { name: 'Fresh Banana',                     unit: '6 pcs',  pricePaise: 3500,  mrpPaise: 4000,  category: 'Veggies & Fruits' },
  { name: 'Green Chilli',                     unit: '100 g',  pricePaise: 1500,  mrpPaise: 1800,  category: 'Veggies & Fruits' },
  { name: 'Shimla Apple',                     unit: '4 pcs',  pricePaise: 8000,  mrpPaise: 9500,  category: 'Veggies & Fruits' },
  { name: 'Carrot',                           unit: '500 g',  pricePaise: 3000,  mrpPaise: 3500,  category: 'Veggies & Fruits' },
  { name: 'Fresh Ginger',                     unit: '100 g',  pricePaise: 2000,  mrpPaise: 2500,  category: 'Veggies & Fruits' },
  { name: 'Coriander (Dhaniya)',              unit: '100 g',  pricePaise: 1500,  mrpPaise: 2000,  category: 'Veggies & Fruits' },
  { name: 'Lemon',                            unit: '250 g',  pricePaise: 2500,  mrpPaise: 3000,  category: 'Veggies & Fruits' },
  { name: 'Cauliflower',                      unit: '1 pc',   pricePaise: 3000,  mrpPaise: 3500,  category: 'Veggies & Fruits' },
  { name: 'Capsicum',                         unit: '250 g',  pricePaise: 3000,  mrpPaise: 3500,  category: 'Veggies & Fruits' },

  // ── Dry Fruits & Nuts ──────────────────────────────────────────────────────
  { name: 'Happilo California Almonds',        unit: '200 g',  pricePaise: 22000, mrpPaise: 25000, category: 'Dry Fruits & Nuts' },
  { name: 'Happilo Premium Whole Cashews',     unit: '200 g',  pricePaise: 24000, mrpPaise: 27000, category: 'Dry Fruits & Nuts' },
  { name: 'Nutraj Walnut Kernels',             unit: '200 g',  pricePaise: 30000, mrpPaise: 34000, category: 'Dry Fruits & Nuts' },
  { name: 'Happilo Roasted Pistachios',        unit: '200 g',  pricePaise: 32000, mrpPaise: 36000, category: 'Dry Fruits & Nuts' },
  { name: 'Happilo Black Raisins',             unit: '200 g',  pricePaise: 9000,  mrpPaise: 10000, category: 'Dry Fruits & Nuts' },
  { name: 'Vedaka Golden Raisins (Kishmish)',  unit: '200 g',  pricePaise: 8000,  mrpPaise: 9000,  category: 'Dry Fruits & Nuts' },
  { name: 'Kimia Dates (Khajoor)',             unit: '500 g',  pricePaise: 12000, mrpPaise: 14000, category: 'Dry Fruits & Nuts' },
  { name: 'Nutraj Dried Figs (Anjeer)',        unit: '200 g',  pricePaise: 24000, mrpPaise: 27000, category: 'Dry Fruits & Nuts' },
  { name: 'Tata Sampann Mixed Dry Fruits',     unit: '200 g',  pricePaise: 18000, mrpPaise: 21000, category: 'Dry Fruits & Nuts' },

  // ── Bakery ─────────────────────────────────────────────────────────────────
  { name: 'Britannia Fruit Cake',             unit: '100 g',  pricePaise: 4500,  mrpPaise: 5000,  category: 'Bakery' },
  { name: 'Britannia Premium Bake Rusk',      unit: '200 g',  pricePaise: 4000,  mrpPaise: 4500,  category: 'Bakery' },
  { name: 'Parle Rusk Elaichi',               unit: '200 g',  pricePaise: 3500,  mrpPaise: 4000,  category: 'Bakery' },
  { name: 'Unibic Choco Chip Cookies',        unit: '75 g',   pricePaise: 4000,  mrpPaise: 4500,  category: 'Bakery' },
  { name: "McVitie's Digestive Biscuits",     unit: '250 g',  pricePaise: 8500,  mrpPaise: 9500,  category: 'Bakery' },

  // ── Sauces & Spreads ───────────────────────────────────────────────────────
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

  // ── Sweets & Mithai (packed brands) ────────────────────────────────────────
  { name: "Haldiram's Soan Papdi",            unit: '250 g',  pricePaise: 8500,  mrpPaise: 9500,  category: 'Sweets & Mithai' },
  { name: "Haldiram's Gulab Jamun (Tin)",     unit: '1 kg',   pricePaise: 22000, mrpPaise: 24000, category: 'Sweets & Mithai' },
  { name: 'Bikaji Soan Papdi',                unit: '250 g',  pricePaise: 8000,  mrpPaise: 9000,  category: 'Sweets & Mithai' },
  { name: 'Gits Gulab Jamun Mix',             unit: '200 g',  pricePaise: 7000,  mrpPaise: 8000,  category: 'Sweets & Mithai' },
  { name: 'MTR Badam Feast Mix',              unit: '200 g',  pricePaise: 16000, mrpPaise: 18000, category: 'Sweets & Mithai' },

  // ════════════════════ BEAUTY & PERSONAL CARE ════════════════════════════════
  // ── Bath & Body ────────────────────────────────────────────────────────────
  { name: 'Pears Pure & Gentle Soap',         unit: '125 g',  pricePaise: 5500,  mrpPaise: 6000,  category: 'Bath & Body' },
  { name: 'Dove Cream Beauty Bathing Bar',    unit: '100 g',  pricePaise: 6200,  mrpPaise: 7000,  category: 'Bath & Body' },
  { name: 'Lux Soft Touch Soap',              unit: '100 g',  pricePaise: 3800,  mrpPaise: 4200,  category: 'Bath & Body' },
  { name: 'Lifebuoy Total 10 Soap',           unit: '125 g',  pricePaise: 4200,  mrpPaise: 4800,  category: 'Bath & Body' },
  { name: 'Dettol Original Soap',             unit: '125 g',  pricePaise: 4800,  mrpPaise: 5500,  category: 'Bath & Body' },
  { name: 'Santoor Sandal & Turmeric Soap',  unit: '100 g',  pricePaise: 3500,  mrpPaise: 4000,  category: 'Bath & Body' },
  { name: 'Cinthol Original Soap',           unit: '100 g',  pricePaise: 3500,  mrpPaise: 4000,  category: 'Bath & Body' },
  { name: 'Nivea Body Lotion',               unit: '200 ml', pricePaise: 27500, mrpPaise: 30000, category: 'Bath & Body' },
  { name: 'Vaseline Intensive Care Lotion',  unit: '200 ml', pricePaise: 22000, mrpPaise: 24500, category: 'Bath & Body' },
  { name: 'Dove Deeply Nourishing Body Wash',unit: '250 ml', pricePaise: 24500, mrpPaise: 27000, category: 'Bath & Body' },
  { name: "Pond's Dreamflower Talc",          unit: '200 g',  pricePaise: 13500, mrpPaise: 15000, category: 'Bath & Body' },

  // ── Hair Care ──────────────────────────────────────────────────────────────
  { name: 'Dove Intense Repair Shampoo',          unit: '340 ml', pricePaise: 33000, mrpPaise: 37000, category: 'Hair Care' },
  { name: 'Head & Shoulders Anti-Dandruff Shampoo', unit: '340 ml', pricePaise: 35000, mrpPaise: 39000, category: 'Hair Care' },
  { name: 'Sunsilk Black Shine Shampoo',          unit: '340 ml', pricePaise: 28000, mrpPaise: 31000, category: 'Hair Care' },
  { name: 'Clinic Plus Strong & Long Shampoo',    unit: '175 ml', pricePaise: 11000, mrpPaise: 12000, category: 'Hair Care' },
  { name: 'TRESemmé Keratin Smooth Shampoo',      unit: '340 ml', pricePaise: 39000, mrpPaise: 43000, category: 'Hair Care' },
  { name: "L'Oréal Paris Smooth Conditioner",     unit: '175 ml', pricePaise: 22000, mrpPaise: 25000, category: 'Hair Care' },
  { name: "L'Oréal Casting Crème Gloss Hair Colour", unit: '1 pc', pricePaise: 47500, mrpPaise: 52000, category: 'Hair Care' },
  { name: 'Parachute Coconut Hair Oil',           unit: '200 ml', pricePaise: 9500,  mrpPaise: 10500, category: 'Hair Care' },
  { name: 'Dabur Amla Hair Oil',                  unit: '200 ml', pricePaise: 11000, mrpPaise: 12500, category: 'Hair Care' },
  { name: 'Indulekha Bringha Hair Oil',           unit: '100 ml', pricePaise: 39000, mrpPaise: 43000, category: 'Hair Care' },
  { name: 'Bajaj Almond Drops Hair Oil',          unit: '200 ml', pricePaise: 14000, mrpPaise: 15500, category: 'Hair Care' },

  // ── Skin & Face ────────────────────────────────────────────────────────────
  { name: 'Nivea Soft Light Moisturiser',         unit: '100 ml', pricePaise: 22500, mrpPaise: 25000, category: 'Skin & Face' },
  { name: "Pond's Super Light Gel",               unit: '50 g',   pricePaise: 19000, mrpPaise: 21000, category: 'Skin & Face' },
  { name: 'Garnier Bright Complete Face Wash',    unit: '100 g',  pricePaise: 19500, mrpPaise: 22000, category: 'Skin & Face' },
  { name: 'Himalaya Purifying Neem Face Wash',    unit: '100 ml', pricePaise: 16500, mrpPaise: 18000, category: 'Skin & Face' },
  { name: 'Lakmé Sun Expert SPF 50 Sunscreen',    unit: '50 ml',  pricePaise: 27500, mrpPaise: 30000, category: 'Skin & Face' },
  { name: 'Cetaphil Gentle Skin Cleanser',        unit: '125 ml', pricePaise: 32500, mrpPaise: 36000, category: 'Skin & Face' },
  { name: 'Mamaearth Vitamin C Face Wash',        unit: '100 ml', pricePaise: 24900, mrpPaise: 27500, category: 'Skin & Face' },
  { name: 'Olay Natural White Day Cream',         unit: '50 g',   pricePaise: 28500, mrpPaise: 32000, category: 'Skin & Face' },
  { name: 'Nivea Men Dark Spot Face Wash',        unit: '100 ml', pricePaise: 19900, mrpPaise: 22500, category: 'Skin & Face' },

  // ── Beauty & Cosmetics ─────────────────────────────────────────────────────
  { name: 'Lakmé 9to5 Primer + Matte Lipstick',   unit: '1 pc',   pricePaise: 49900, mrpPaise: 55000, category: 'Beauty & Cosmetics' },
  { name: 'Maybelline Colossal Kajal',            unit: '1 pc',   pricePaise: 22500, mrpPaise: 25000, category: 'Beauty & Cosmetics' },
  { name: 'Maybelline Fit Me Foundation',         unit: '30 ml',  pricePaise: 47500, mrpPaise: 52500, category: 'Beauty & Cosmetics' },
  { name: 'Lakmé Rose Face Powder Compact',       unit: '1 pc',   pricePaise: 26500, mrpPaise: 29500, category: 'Beauty & Cosmetics' },
  { name: 'SUGAR Matte As Hell Crayon Lipstick',  unit: '1 pc',   pricePaise: 49900, mrpPaise: 54900, category: 'Beauty & Cosmetics' },
  { name: 'Insight Cosmetics Liquid Eyeliner',    unit: '1 pc',   pricePaise: 14900, mrpPaise: 17500, category: 'Beauty & Cosmetics' },
  { name: 'Maybelline Lifter Lip Gloss',          unit: '1 pc',   pricePaise: 52500, mrpPaise: 57500, category: 'Beauty & Cosmetics' },
  { name: 'Makeup Blending Brush',                unit: '1 pc',   pricePaise: 19900, mrpPaise: 24900, category: 'Beauty & Cosmetics' },

  // ── Feminine Hygiene ───────────────────────────────────────────────────────
  { name: 'Whisper Ultra Soft Sanitary Pads (XL+)', unit: '30 pcs', pricePaise: 39900, mrpPaise: 44900, category: 'Feminine Hygiene' },
  { name: 'Stayfree Secure XL Sanitary Pads',       unit: '20 pcs', pricePaise: 19500, mrpPaise: 21500, category: 'Feminine Hygiene' },
  { name: 'Sofy Antibacteria XL Sanitary Pads',     unit: '20 pcs', pricePaise: 20500, mrpPaise: 22500, category: 'Feminine Hygiene' },
  { name: 'Veet Hair Removal Cream',                unit: '100 g',  pricePaise: 19900, mrpPaise: 22500, category: 'Feminine Hygiene' },
  { name: 'Clean & Dry Intimate Wash',              unit: '90 ml',  pricePaise: 16500, mrpPaise: 18500, category: 'Feminine Hygiene' },

  // ── Baby Care ──────────────────────────────────────────────────────────────
  { name: 'Pampers All-Round Protection Pants (M)', unit: '30 pcs', pricePaise: 49900, mrpPaise: 56900, category: 'Baby Care' },
  { name: 'Huggies Wonder Pants (M)',               unit: '32 pcs', pricePaise: 47900, mrpPaise: 54900, category: 'Baby Care' },
  { name: "Johnson's Baby Powder",                  unit: '200 g',  pricePaise: 14500, mrpPaise: 16000, category: 'Baby Care' },
  { name: "Johnson's Baby Lotion",                  unit: '200 ml', pricePaise: 17500, mrpPaise: 19500, category: 'Baby Care' },
  { name: 'Himalaya Gentle Baby Soap',              unit: '75 g',   pricePaise: 4500,  mrpPaise: 5000,  category: 'Baby Care' },
  { name: 'Mamaearth Deeply Nourishing Baby Wash',  unit: '200 ml', pricePaise: 24900, mrpPaise: 27900, category: 'Baby Care' },
  { name: 'Cerelac Wheat Apple (Stage 1)',          unit: '300 g',  pricePaise: 28500, mrpPaise: 31000, category: 'Baby Care' },
  { name: 'Baby Feeding Sipper Cup',                unit: '1 pc',   pricePaise: 19900, mrpPaise: 24900, category: 'Baby Care' },

  // ── Health & Pharma (OTC) ──────────────────────────────────────────────────
  { name: 'ON Gold Standard 100% Whey',             unit: '1 kg',   pricePaise: 339900, mrpPaise: 379900, category: 'Health & Pharma' },
  { name: 'Dabur Honitus Cough Syrup',              unit: '100 ml', pricePaise: 11500,  mrpPaise: 13000,  category: 'Health & Pharma' },
  { name: 'Vicks VapoRub',                          unit: '50 ml',  pricePaise: 18000,  mrpPaise: 20000,  category: 'Health & Pharma' },
  { name: 'Volini Pain Relief Spray',               unit: '60 g',   pricePaise: 27500,  mrpPaise: 30500,  category: 'Health & Pharma' },
  { name: 'Digene Antacid Gel (Mint)',              unit: '200 ml', pricePaise: 14500,  mrpPaise: 16000,  category: 'Health & Pharma' },
  { name: 'Electral ORS Powder (Orange)',           unit: '21.8 g', pricePaise: 2200,   mrpPaise: 2500,   category: 'Health & Pharma' },
  { name: 'Dettol Antiseptic Liquid',               unit: '250 ml', pricePaise: 15500,  mrpPaise: 17500,  category: 'Health & Pharma' },
  { name: 'Savlon Hand Sanitizer',                  unit: '100 ml', pricePaise: 5500,   mrpPaise: 6500,   category: 'Health & Pharma' },
  { name: 'Revital H Multivitamin',                 unit: '30 caps',pricePaise: 33500,  mrpPaise: 37500,  category: 'Health & Pharma' },
  { name: '3-Ply Protective Face Mask',             unit: '10 pcs', pricePaise: 9900,   mrpPaise: 12900,  category: 'Health & Pharma' },

  // ── Sexual Wellness ────────────────────────────────────────────────────────
  { name: 'Durex Extra Time Condoms',               unit: '10 pcs', pricePaise: 29900, mrpPaise: 33500, category: 'Sexual Wellness' },
  { name: 'Manforce Extra Dotted Condoms',          unit: '10 pcs', pricePaise: 19900, mrpPaise: 22500, category: 'Sexual Wellness' },
  { name: 'Skore Not Out Condoms',                  unit: '10 pcs', pricePaise: 17900, mrpPaise: 19900, category: 'Sexual Wellness' },

  // ════════════════════ HOUSEHOLD ESSENTIALS ══════════════════════════════════
  // ── Home & Lifestyle ───────────────────────────────────────────────────────
  { name: 'Trident Cotton Double Bedsheet',         unit: '1 pc',   pricePaise: 79900,  mrpPaise: 99900,  category: 'Home & Lifestyle' },
  { name: 'Bombay Dyeing Bath Towel',               unit: '1 pc',   pricePaise: 39900,  mrpPaise: 49900,  category: 'Home & Lifestyle' },
  { name: 'Milton Thermosteel Water Bottle',        unit: '1 L',    pricePaise: 64900,  mrpPaise: 79900,  category: 'Home & Lifestyle' },
  { name: 'Cello Storage Container Set',            unit: '3 pcs',  pricePaise: 44900,  mrpPaise: 59900,  category: 'Home & Lifestyle' },
  { name: 'Borosil Glass Tumbler Set',             unit: '6 pcs',  pricePaise: 54900,  mrpPaise: 69900,  category: 'Home & Lifestyle' },
  { name: 'Prestige Non-Stick Frying Pan',         unit: '1 pc',   pricePaise: 89900,  mrpPaise: 119900, category: 'Home & Lifestyle' },
  { name: 'Pigeon Stainless Steel Lunch Box',      unit: '1 pc',   pricePaise: 34900,  mrpPaise: 44900,  category: 'Home & Lifestyle' },
  { name: 'Artificial Indoor Plant with Pot',      unit: '1 pc',   pricePaise: 29900,  mrpPaise: 39900,  category: 'Home & Lifestyle' },
  { name: 'Wonderchef Kitchen Knife',              unit: '1 pc',   pricePaise: 24900,  mrpPaise: 34900,  category: 'Home & Lifestyle' },

  // ── Cleaners & Repellents ──────────────────────────────────────────────────
  { name: 'Surf Excel Matic Front Load Powder',    unit: '1 kg',   pricePaise: 18500,  mrpPaise: 21000,  category: 'Cleaners & Repellents' },
  { name: 'Ariel Matic Liquid Detergent',          unit: '1 L',    pricePaise: 24500,  mrpPaise: 27500,  category: 'Cleaners & Repellents' },
  { name: 'Vim Dishwash Gel (Lemon)',              unit: '500 ml', pricePaise: 11000,  mrpPaise: 12500,  category: 'Cleaners & Repellents' },
  { name: 'Harpic Power Plus Toilet Cleaner',      unit: '1 L',    pricePaise: 19500,  mrpPaise: 22000,  category: 'Cleaners & Repellents' },
  { name: 'Lizol Disinfectant Floor Cleaner',      unit: '975 ml', pricePaise: 19900,  mrpPaise: 22500,  category: 'Cleaners & Repellents' },
  { name: 'Colin Glass Cleaner',                   unit: '500 ml', pricePaise: 9900,   mrpPaise: 11000,  category: 'Cleaners & Repellents' },
  { name: 'Comfort Fabric Conditioner',            unit: '860 ml', pricePaise: 19900,  mrpPaise: 22500,  category: 'Cleaners & Repellents' },
  { name: 'Scotch-Brite Scrub Pad',               unit: '3 pcs',  pricePaise: 6500,   mrpPaise: 7500,   category: 'Cleaners & Repellents' },
  { name: 'Good Knight Gold Flash Refill',         unit: '45 ml',  pricePaise: 7500,   mrpPaise: 8500,   category: 'Cleaners & Repellents' },
  { name: 'All Out Ultra Mosquito Refill',         unit: '45 ml',  pricePaise: 7500,   mrpPaise: 8500,   category: 'Cleaners & Repellents' },
  { name: 'HIT Cockroach Killer Spray',            unit: '400 ml', pricePaise: 21500,  mrpPaise: 24000,  category: 'Cleaners & Repellents' },
  { name: 'Odonil Air Freshener Blocks',           unit: '50 g',   pricePaise: 6500,   mrpPaise: 7500,   category: 'Cleaners & Repellents' },

  // ── Electronics ────────────────────────────────────────────────────────────
  { name: 'boAt Airdopes 141 Earbuds',             unit: '1 pc',   pricePaise: 129900, mrpPaise: 249900, category: 'Electronics' },
  { name: 'boAt Rockerz 450 Headphones',           unit: '1 pc',   pricePaise: 149900, mrpPaise: 299900, category: 'Electronics' },
  { name: 'Bajaj Majesty Steam Iron',              unit: '1 pc',   pricePaise: 89900,  mrpPaise: 119900, category: 'Electronics' },
  { name: 'Mi Power Bank 10000mAh',                unit: '1 pc',   pricePaise: 99900,  mrpPaise: 129900, category: 'Electronics' },
  { name: 'Syska 9W LED Bulb',                     unit: '1 pc',   pricePaise: 9900,   mrpPaise: 14900,  category: 'Electronics' },
  { name: 'Duracell AA Batteries',                 unit: '4 pcs',  pricePaise: 19900,  mrpPaise: 24900,  category: 'Electronics' },
  { name: 'Ambrane USB-C Fast Charging Cable',     unit: '1 pc',   pricePaise: 19900,  mrpPaise: 39900,  category: 'Electronics' },
  { name: 'Portronics Extension Board (4 Socket)', unit: '1 pc',   pricePaise: 54900,  mrpPaise: 79900,  category: 'Electronics' },

  // ── Stationery & Games ─────────────────────────────────────────────────────
  { name: 'UNO Card Game',                         unit: '1 pc',   pricePaise: 19900,  mrpPaise: 24900,  category: 'Stationery & Games' },
  { name: 'Ludo Board Game',                       unit: '1 pc',   pricePaise: 24900,  mrpPaise: 34900,  category: 'Stationery & Games' },
  { name: 'Classmate Spiral Notebook',             unit: '1 pc',   pricePaise: 6500,   mrpPaise: 7500,   category: 'Stationery & Games' },
  { name: 'Nataraj HB Pencils',                    unit: '10 pcs', pricePaise: 5000,   mrpPaise: 6000,   category: 'Stationery & Games' },
  { name: 'Cello Gel Pens (Blue)',                 unit: '5 pcs',  pricePaise: 10000,  mrpPaise: 12500,  category: 'Stationery & Games' },
  { name: 'Faber-Castell Colour Pencils',          unit: '12 pcs', pricePaise: 11500,  mrpPaise: 13500,  category: 'Stationery & Games' },
  { name: 'Camlin Geometry Box',                   unit: '1 pc',   pricePaise: 12500,  mrpPaise: 14900,  category: 'Stationery & Games' },
  { name: 'Fevicol MR Adhesive',                   unit: '100 g',  pricePaise: 4500,   mrpPaise: 5000,   category: 'Stationery & Games' },
  { name: 'Playing Cards Deck',                    unit: '1 pc',   pricePaise: 5900,   mrpPaise: 7900,   category: 'Stationery & Games' },
];

// Phones of the legacy per-area stores that no longer exist in the dark-store
// model. Their shops are deactivated on seed so the catalog drops them.
const RETIRED_PHONES = ['9001110002', '9001110003', '9001110004', '9001110005', '9001110011'];

const SHOPS: SeedShop[] = [
  // ── The single invisible dark store (whole everyday catalog + beauty) ───────
  {
    phone: '9001110001', ownerName: 'Chirawa Store',
    shopName: 'Chirawa Store',
    address: 'Main Bazar, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.23900000', lng: '75.63900000',
    products: DARK_STORE_PRODUCTS,
  },
  // ── Chirawa Special — the only shops the customer actually sees ─────────────
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
 * Seeds the dark store + the featured Chirawa Special shops, their per-shop
 * categories, and products. Fully idempotent: users upsert by phone, profiles
 * by userId, shops by sellerId, and categories/products by deterministic stable
 * UUIDs. Products carry no images — any previously-seeded ProductImage rows are
 * cleared. Legacy per-area shops (RETIRED_PHONES) are deactivated so the
 * dark-store model leaves only one hidden store + the visible mithai shops.
 * Does NOT touch any pre-existing shops/sellers/products outside this seed set.
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

  // ── Retire legacy per-area stores (dark-store migration) ────────────────────
  // Deactivate their shops so getProducts/getCategories (which filter on
  // shop.isActive) stop returning anything from them. No destructive deletes.
  let retiredCount = 0;
  for (const phone of RETIRED_PHONES) {
    const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (!user) continue;
    const profile = await prisma.sellerProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!profile) continue;
    const res = await prisma.shop.updateMany({
      where: { sellerId: profile.id },
      data:  { isActive: false, isOpen: false, isFeatured: false },
    });
    retiredCount += res.count;
  }

  console.log(`  ✅ Shops seeded: ${shopCount} shops (1 dark store + ${shopCount - 1} Chirawa Special), ${categoryCount} categories, ${productCount} products (no images); ${retiredCount} legacy shop(s) retired`);
}
