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

// Canonical display order for the 8 categories (PART 1 of the spec). Note: the
// schema's Category model has no emoji/color columns and categories are
// per-shop, so only name + sortOrder are persisted (decision: seed name +
// sortOrder only — the home category grid is hardcoded client-side).
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

const img = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=400&h=400&fit=crop&q=80`;

const SWEET_IMG  = img('1548365328-8c6db3220e4d');
const SAAG_IMG   = img('1585937421612-70a008356fbe');
const BHUJIA_IMG = img('1599490659213-e2b9527bd087');

interface SeedProduct {
  name:       string;
  unit:       string;
  pricePaise: number;
  mrpPaise:   number;
  category:   string;
  imageUrl:   string;
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
// The spec's PART 3 is internally inconsistent ("assign to Shop 1 unless
// specified" vs. category headers that name Shops 2-5). We follow the category
// headers + PART 2 so every shop is meaningfully populated. To concentrate
// everything on Shop 1 instead, just move the product blocks below.
const SHOPS: SeedShop[] = [
  {
    phone: '9001110001', ownerName: 'Ramesh Kumar',
    shopName: 'Shop 1 — General Store',
    address: 'Main Bazar, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.23900000', lng: '75.63900000',
    products: [
      // Grocery & Kitchen
      { name: 'Aashirvaad Select Atta', unit: '5 kg',  pricePaise: 28500, mrpPaise: 32000, category: 'Grocery & Kitchen', imageUrl: img('1574323347407-f5e1ad6d020b') },
      { name: 'Amul Taaza Toned Milk',  unit: '1 L',   pricePaise: 6200,  mrpPaise: 6500,  category: 'Grocery & Kitchen', imageUrl: img('1563636619-e9143da7973b') },
      { name: 'Tata Salt Iodised',      unit: '1 kg',  pricePaise: 2800,  mrpPaise: 3000,  category: 'Grocery & Kitchen', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Rock_salt_%28halitite%29_%28Billianwala_Salt_Member%2C_Salt_Range_Formation%2C_Ediacaran_to_Lower_Cambrian%3B_Khewra_Salt_Mine%2C_Salt_Range%2C_Pakistan%29_14.jpg/330px-Rock_salt_%28halitite%29_%28Billianwala_Salt_Member%2C_Salt_Range_Formation%2C_Ediacaran_to_Lower_Cambrian%3B_Khewra_Salt_Mine%2C_Salt_Range%2C_Pakistan%29_14.jpg' },
      { name: 'Fortune Sunflower Oil',  unit: '1 L',   pricePaise: 15500, mrpPaise: 18000, category: 'Grocery & Kitchen', imageUrl: img('1474979266404-7eaacbcd87c5') },
      { name: 'India Gate Basmati Rice',unit: '1 kg',  pricePaise: 9500,  mrpPaise: 11000, category: 'Grocery & Kitchen', imageUrl: img('1586201375761-83865001e31c') },
      { name: 'Tata Tea Gold',          unit: '250 g', pricePaise: 11500, mrpPaise: 13000, category: 'Grocery & Kitchen', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Chai_In_Sakora.jpg/330px-Chai_In_Sakora.jpg' },
      { name: 'MDH Garam Masala',       unit: '100 g', pricePaise: 5500,  mrpPaise: 6000,  category: 'Grocery & Kitchen', imageUrl: img('1596040033229-a9821ebd058d') },
      { name: 'Patanjali Desi Ghee',    unit: '500 ml',pricePaise: 28000, mrpPaise: 31000, category: 'Grocery & Kitchen', imageUrl: img('1589985270826-4b7bb135bc9d') },
      { name: 'Moong Dal Dhuli',        unit: '500 g', pricePaise: 6500,  mrpPaise: 7200,  category: 'Grocery & Kitchen', imageUrl: img('1515543904379-3d757afe72e4') },
      { name: 'Chana Dal',              unit: '500 g', pricePaise: 5800,  mrpPaise: 6500,  category: 'Grocery & Kitchen', imageUrl: img('1515543904379-3d757afe72e4') },
      // Bakery
      { name: 'Britannia Cake Slice',   unit: '60 g',  pricePaise: 2000,  mrpPaise: 2200,  category: 'Bakery', imageUrl: img('1578985545062-69928b1d9587') },
      { name: 'Khari Biscuit',          unit: '200 g', pricePaise: 3500,  mrpPaise: 4000,  category: 'Bakery', imageUrl: img('1558961363-fa8fdf82db35') },
      { name: 'Sweet Bun',              unit: '2 pcs', pricePaise: 3000,  mrpPaise: 3500,  category: 'Bakery', imageUrl: img('1509440159596-0249088772ff') },
    ],
  },
  {
    phone: '9001110002', ownerName: 'Suresh Gupta',
    shopName: 'Shop 2 — Kirana Store',
    address: 'Station Road, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.24010000', lng: '75.64010000',
    products: [
      // Snacks & Drinks
      { name: "Lay's Classic Salted",   unit: '26 g',  pricePaise: 2000, mrpPaise: 2000, category: 'Snacks & Drinks', imageUrl: img('1558961363-fa8fdf82db35') },
      { name: "Haldiram's Aloo Bhujia", unit: '200 g', pricePaise: 6500, mrpPaise: 7500, category: 'Snacks & Drinks', imageUrl: img('1599490659213-e2b9527bd087') },
      { name: 'Parle-G Biscuits',       unit: '250 g', pricePaise: 2000, mrpPaise: 2200, category: 'Snacks & Drinks', imageUrl: img('1558961363-fa8fdf82db35') },
      { name: 'Kurkure Masala Munch',   unit: '90 g',  pricePaise: 3500, mrpPaise: 4000, category: 'Snacks & Drinks', imageUrl: 'https://upload.wikimedia.org/wikipedia/en/thumb/e/e5/Kurkure_Logo.png/330px-Kurkure_Logo.png' },
      { name: 'Maggi 2-Minute Noodles', unit: '70 g',  pricePaise: 1400, mrpPaise: 1500, category: 'Snacks & Drinks', imageUrl: img('1612927601601-6638404737ce') },
      { name: 'Coca-Cola',              unit: '750 ml',pricePaise: 4500, mrpPaise: 5000, category: 'Snacks & Drinks', imageUrl: img('1554866585-cd94860890b7') },
      { name: 'Frooti Mango Drink',     unit: '200 ml',pricePaise: 2000, mrpPaise: 2000, category: 'Snacks & Drinks', imageUrl: img('1600271886742-f049cd451bba') },
    ],
  },
  {
    phone: '9001110003', ownerName: 'Mahesh Sharma',
    shopName: 'Shop 3 — Daily Needs',
    address: 'Purani Mandi, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.24120000', lng: '75.64120000',
    products: [
      // Dry Fruits & Nuts
      { name: 'Premium Cashews',  unit: '100 g', pricePaise: 8500,  mrpPaise: 10000, category: 'Dry Fruits & Nuts', imageUrl: img('1536816579748-4ecb3f03d72a') },
      { name: 'Almonds',          unit: '100 g', pricePaise: 9000,  mrpPaise: 10500, category: 'Dry Fruits & Nuts', imageUrl: img('1574226516831-e1dff420e562') },
      { name: 'Raisins (Kishmish)',unit: '200 g',pricePaise: 7500,  mrpPaise: 8500,  category: 'Dry Fruits & Nuts', imageUrl: img('1576673442511-7e39b6545c87') },
      { name: 'Walnuts',          unit: '100 g', pricePaise: 9500,  mrpPaise: 11000, category: 'Dry Fruits & Nuts', imageUrl: img('1606923829579-0cb981a83e2e') },
      { name: 'Mixed Dry Fruits', unit: '200 g', pricePaise: 15000, mrpPaise: 17500, category: 'Dry Fruits & Nuts', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/DriedfruitS.jpg/330px-DriedfruitS.jpg' },
    ],
  },
  {
    phone: '9001110004', ownerName: 'Dinesh Saini',
    shopName: 'Shop 4 — Fresh Mart',
    address: 'Nehru Colony, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.24230000', lng: '75.64230000',
    products: [
      // Veggies & Fruits
      { name: 'Fresh Tomatoes', unit: '500 g', pricePaise: 2500, mrpPaise: 3000, category: 'Veggies & Fruits', imageUrl: img('1546094096-0df4bcaaa337') },
      { name: 'Onion',          unit: '1 kg',  pricePaise: 3500, mrpPaise: 4000, category: 'Veggies & Fruits', imageUrl: img('1508747703725-719777637510') },
      { name: 'Potato',         unit: '1 kg',  pricePaise: 3000, mrpPaise: 3500, category: 'Veggies & Fruits', imageUrl: img('1518977676601-b53f82aba655') },
      { name: 'Fresh Banana',   unit: '6 pcs', pricePaise: 3500, mrpPaise: 4000, category: 'Veggies & Fruits', imageUrl: img('1571771894821-ce9b6c11b08e') },
      { name: 'Green Chilli',   unit: '100 g', pricePaise: 1500, mrpPaise: 1800, category: 'Veggies & Fruits', imageUrl: img('1588252303782-cb80119abd6d') },
      { name: 'Fresh Apple',    unit: '4 pcs', pricePaise: 8000, mrpPaise: 9500, category: 'Veggies & Fruits', imageUrl: img('1567306226416-28f0efdc88ce') },
      { name: 'Carrot',         unit: '500 g', pricePaise: 3000, mrpPaise: 3500, category: 'Veggies & Fruits', imageUrl: img('1598170845058-32b9d6a5da37') },
      { name: 'Fresh Ginger',   unit: '100 g', pricePaise: 2000, mrpPaise: 2500, category: 'Veggies & Fruits', imageUrl: img('1615485500704-8e990f9900f7') },
      // Dairy & Bread
      { name: 'Amul Butter',           unit: '100 g', pricePaise: 5800,  mrpPaise: 6200,  category: 'Dairy & Bread', imageUrl: img('1589985270826-4b7bb135bc9d') },
      { name: 'Amul Dahi',             unit: '400 g', pricePaise: 4000,  mrpPaise: 4500,  category: 'Dairy & Bread', imageUrl: img('1563636619-e9143da7973b') },
      { name: 'Britannia Brown Bread', unit: '400 g', pricePaise: 4500,  mrpPaise: 5000,  category: 'Dairy & Bread', imageUrl: img('1509440159596-0249088772ff') },
      { name: 'Farm Fresh Eggs',       unit: '6 pcs', pricePaise: 7200,  mrpPaise: 8000,  category: 'Dairy & Bread', imageUrl: img('1587486913049-53fc88980cfc') },
      { name: 'Amul Cheese Slices',    unit: '200 g', pricePaise: 12000, mrpPaise: 13500, category: 'Dairy & Bread', imageUrl: img('1486297678162-eb2a19b0a32d') },
    ],
  },
  {
    phone: '9001110005', ownerName: 'Rajesh Agarwal',
    shopName: 'Shop 5 — Super Store',
    address: 'Sabzi Mandi, Chirawa, Jhunjhunu, Rajasthan 333026',
    lat: '28.24340000', lng: '75.64340000',
    products: [
      // Sauces & Spreads
      { name: 'Kissan Tomato Ketchup',  unit: '500 g', pricePaise: 9500, mrpPaise: 11000, category: 'Sauces & Spreads', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Ketchup_20160918_181342_%28cropped%29.jpg/330px-Ketchup_20160918_181342_%28cropped%29.jpg' },
      { name: 'Maggi Hot & Sweet Sauce',unit: '400 g', pricePaise: 7500, mrpPaise: 8500,  category: 'Sauces & Spreads', imageUrl: img('1565299624946-b28f40a0ae38') },
    ],
  },
  {
    phone: '9001110006', ownerName: 'Maturam Halwai',
    shopName: 'Maturam Misthan Bhandar', featured: true,
    address: 'Purani Mandi, Chirawa, Jhunjhunu 333026',
    lat: '28.24450000', lng: '75.64450000',
    products: [
      { name: 'Fresh Jalebi',    unit: '250 g', pricePaise: 6000, mrpPaise: 6500,  category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Basavanagudi_Kadalekai_Parishe_%282025%29_Bangalore_%2886%29.jpg/330px-Basavanagudi_Kadalekai_Parishe_%282025%29_Bangalore_%2886%29.jpg' },
      { name: 'Besan Ladoo',     unit: '250 g', pricePaise: 8000, mrpPaise: 9000,  category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Laddu_Sweet.JPG/330px-Laddu_Sweet.JPG' },
      { name: 'Motichoor Ladoo', unit: '250 g', pricePaise: 9000, mrpPaise: 10000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Laddu_Sweet.JPG/330px-Laddu_Sweet.JPG' },
      { name: 'Gulab Jamun',     unit: '6 pcs', pricePaise: 6000, mrpPaise: 6500,  category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Bowl_of_Gulab_Jamuns.jpg/330px-Bowl_of_Gulab_Jamuns.jpg' },
    ],
  },
  {
    phone: '9001110007', ownerName: 'Lal Chand',
    shopName: 'Lal Chand Misthan Bhandar', featured: true,
    address: 'Main Bazar, Chirawa, Jhunjhunu 333026',
    lat: '28.24560000', lng: '75.64560000',
    products: [
      { name: 'Kaju Barfi', unit: '250 g', pricePaise: 18000, mrpPaise: 20000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Kaju_katli_sweet.jpg/330px-Kaju_katli_sweet.jpg' },
      { name: 'Milk Cake',  unit: '250 g', pricePaise: 15000, mrpPaise: 17000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Koderma_Kalakand.jpg/330px-Koderma_Kalakand.jpg' },
      { name: 'Soan Papdi', unit: '200 g', pricePaise: 9000,  mrpPaise: 10000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Son_papadi.jpg/330px-Son_papadi.jpg' },
      { name: 'Balushahi',  unit: '250 g', pricePaise: 7000,  mrpPaise: 8000,  category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Home_made_makkhan_bada.jpg/330px-Home_made_makkhan_bada.jpg' },
    ],
  },
  {
    phone: '9001110008', ownerName: 'Mukesh Sharma',
    shopName: 'Sharma Saag Rotta Shop', featured: true,
    address: 'Bazar Road, Chirawa, Jhunjhunu 333026',
    lat: '28.24670000', lng: '75.64670000',
    products: [
      { name: 'Sarson ka Saag',  unit: '200 g', pricePaise: 4500, mrpPaise: 5000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Saagroti.jpg/330px-Saagroti.jpg' },
      { name: 'Makki ki Roti',   unit: '2 pcs', pricePaise: 3000, mrpPaise: 3500, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Makki_Di_Roti.JPG/330px-Makki_Di_Roti.JPG' },
      { name: 'Bajra Roti',      unit: '2 pcs', pricePaise: 2500, mrpPaise: 3000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Bhakri_1.jpg/330px-Bhakri_1.jpg' },
      { name: 'Mixed Dal Tadka', unit: '200 g', pricePaise: 5000, mrpPaise: 5500, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/3_types_of_lentil.png/330px-3_types_of_lentil.png' },
    ],
  },
  {
    phone: '9001110009', ownerName: 'Nahar Singh',
    shopName: 'Nahar Singh Misthan Bhandar', featured: true,
    address: 'Station Road, Chirawa, Jhunjhunu 333026',
    lat: '28.24780000', lng: '75.64780000',
    products: [
      { name: 'Ghewar Special', unit: '1 pc',  pricePaise: 8000, mrpPaise: 9000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Ghevar_with_Malai_Topping.jpg/330px-Ghevar_with_Malai_Topping.jpg' },
      { name: 'Imarti',         unit: '250 g', pricePaise: 6500, mrpPaise: 7500, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/JalebiIndia.jpg/330px-JalebiIndia.jpg' },
      { name: 'Khurma',         unit: '250 g', pricePaise: 6500, mrpPaise: 7500, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Gujhia.JPG/330px-Gujhia.JPG' },
      { name: 'Mawa Kachori',   unit: '4 pcs', pricePaise: 6000, mrpPaise: 7000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Rajasthani_Raj_Kachori.jpg/330px-Rajasthani_Raj_Kachori.jpg' },
    ],
  },
  {
    phone: '9001110010', ownerName: 'Bikaner Sweets',
    shopName: 'Bikaneri Misthan Bhandar', featured: true,
    address: 'Nehru Colony, Chirawa, Jhunjhunu 333026',
    lat: '28.24890000', lng: '75.64890000',
    products: [
      { name: 'Bikaneri Bhujia',  unit: '200 g', pricePaise: 8000, mrpPaise: 9000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Shop_selling_Bikaneri_bhujia_in_Jaipur.jpg/330px-Shop_selling_Bikaneri_bhujia_in_Jaipur.jpg' },
      { name: 'Mathri',           unit: '200 g', pricePaise: 5500, mrpPaise: 6500, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Mathri.JPG/330px-Mathri.JPG' },
      { name: 'Namkeen Mix',      unit: '200 g', pricePaise: 5000, mrpPaise: 6000, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Sev_2013-12-01_16-57.jpg/330px-Sev_2013-12-01_16-57.jpg' },
      { name: 'Chakki Mungfali',  unit: '200 g', pricePaise: 4500, mrpPaise: 5500, category: 'Sweets & Mithai', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Arachis_hypogaea_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-163.jpg/330px-Arachis_hypogaea_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-163.jpg' },
    ],
  },
];

/**
 * Seeds 10 seller accounts, their shops, per-shop categories, and products.
 * Fully idempotent: users upsert by phone, profiles by userId, shops by
 * sellerId, and categories/products/images by deterministic stable UUIDs.
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

    // 5) Products + their single ProductImage (deterministic ids)
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

      const imageId = stableUuid(`img:${productId}`);
      await prisma.productImage.upsert({
        where:  { id: imageId },
        update: { url: p.imageUrl, sortOrder: 0 },
        create: { id: imageId, productId, url: p.imageUrl, sortOrder: 0 },
      });
      productCount++;
    }
  }

  console.log(`  ✅ Shops seeded: ${shopCount} shops, ${categoryCount} categories, ${productCount} products`);
}
