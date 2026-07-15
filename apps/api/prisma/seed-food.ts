import 'dotenv/config';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

// ─── Food module seed (Food.md §11.5, Appendix A) ─────────────────────────────
// Seeds the SIX launch restaurants in their decided manual order:
//   1. Aura · 2. Bits & Bites · 3. Dark Park · 4. Foodies · 5. Goggle Cafe ·
//   6. Rishivan (Amul Store)
//
// Menus:
//   • Rishivan (Amul Store) — REAL menu, transcribed verbatim from the two
//     menu-card photos received 2026-07-08 (Crispy Corner · Special Rabdi ·
//     Slush · Classic/Premium Ice Cream Scoops · Ice Cream Shakes). Prices are
//     exactly as printed.
//   • The other five — ⚠️ PROVISIONAL menus (owner-approved placeholders for
//     launch): typical items at sensible Chirawa prices. Each restaurant MUST
//     review + correct these at onboarding — items can be edited here and
//     re-seeded (idempotent upserts), and sold-out toggling is self-serve in
//     the seller app's Restaurant tab.
//
// Re-running is always safe: stable UUIDs → upserts.
//
// Run: pnpm --filter @chirawa/api db:seed:food

const prisma = new PrismaClient();

// Stable UUID derivation — same helper convention as prisma/seeds/shops.ts, so
// the same logical row always upserts to the same id.
function stableUuid(seed: string): string {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '5' + h.slice(13, 16),
    variant + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

interface SeedRestaurant {
  key:          string; // stable-id seed
  name:         string;
  cuisine:      string;
  description:  string;
  displayOrder: number;
  lat:          string;
  lng:          string;
  address:      string;
  openTime:     string;
  closeTime:    string;
  prepTimeMinutes: number;
}

// Coordinates cluster around Chirawa town (same convention as the shop seed).
const RESTAURANTS: SeedRestaurant[] = [
  {
    key: 'food:aura', name: 'Aura', cuisine: 'Cafe · Fast Food',
    description: 'Chirawa ka cozy cafe — snacks, shakes aur zyada',
    displayOrder: 1, lat: '28.24010000', lng: '75.64010000',
    address: 'Station Road, Chirawa', openTime: '11:00', closeTime: '22:00', prepTimeMinutes: 20,
  },
  {
    key: 'food:bits-and-bites', name: 'Bits & Bites', cuisine: 'Fast Food · Snacks',
    description: 'Burgers, pizza aur chatpata street-style khana',
    displayOrder: 2, lat: '28.24120000', lng: '75.64120000',
    address: 'Main Market, Chirawa', openTime: '11:00', closeTime: '22:00', prepTimeMinutes: 20,
  },
  {
    key: 'food:dark-park', name: 'Dark Park', cuisine: 'Cafe · Continental',
    description: 'Late-evening cafe vibes — coffee, maggi, sandwiches',
    displayOrder: 3, lat: '28.24230000', lng: '75.64230000',
    address: 'Bus Stand Road, Chirawa', openTime: '12:00', closeTime: '22:00', prepTimeMinutes: 25,
  },
  {
    key: 'food:foodies', name: 'Foodies', cuisine: 'North Indian · Chinese',
    description: 'Family restaurant — thali se noodles tak',
    displayOrder: 4, lat: '28.24340000', lng: '75.64340000',
    address: 'Jhunjhunu Road, Chirawa', openTime: '11:00', closeTime: '22:00', prepTimeMinutes: 25,
  },
  {
    key: 'food:goggle-cafe', name: 'Goggle Cafe', cuisine: 'Cafe · Beverages',
    description: 'Chai, coffee aur quick bites ka adda',
    displayOrder: 5, lat: '28.24450000', lng: '75.64450000',
    address: 'College Road, Chirawa', openTime: '10:00', closeTime: '22:00', prepTimeMinutes: 15,
  },
  {
    // ⚠️ RISHIVAN_MENU_PENDING — menu image not yet received (Food.md App. A).
    key: 'food:rishivan', name: 'Rishivan (Amul Store)', cuisine: 'Ice Cream · Dairy · Snacks',
    description: 'Amul ice-cream parlour — scoops, shakes aur dairy treats',
    displayOrder: 6, lat: '28.24560000', lng: '75.64560000',
    address: 'Amul Store, Main Market, Chirawa', openTime: '10:00', closeTime: '22:00', prepTimeMinutes: 15,
  },
];

interface SeedMenuSection {
  category: string;
  items: Array<{ name: string; pricePaise: number; isVeg?: boolean; description?: string }>;
}

// ── RISHIVAN (Amul Store) — REAL menu, verbatim from the menu-card photos ─────
// Received 2026-07-08. Amul parlour — fully vegetarian. Prices exactly as
// printed on the card (₹ × 100 = paise). Do not "fix" apparent oddities (e.g.
// Chocolate at ₹59 under Premium) — that is what the physical card says.
const RISHIVAN_MENU: SeedMenuSection[] = [
  {
    category: 'Crispy Corner',
    items: [
      { name: 'Special Cheese Chilli Paneer Tandoori Burger', pricePaise: 11_000, isVeg: true },
      { name: 'Healthy Paneer Masala Burger',                 pricePaise: 12_900, isVeg: true },
      { name: 'Healthy Paneer Burger with Special Spread & Masala', pricePaise: 14_900, isVeg: true },
      { name: 'Classic Fries',        pricePaise: 8_900,  isVeg: true },
      { name: 'Peri Peri Fries',      pricePaise: 9_900,  isVeg: true },
      { name: 'Masti Dahi Tikki',     pricePaise: 8_900,  isVeg: true },
      { name: 'Masala Paneer Nuggets', pricePaise: 8_900, isVeg: true },
      { name: 'Cheese Corn Nuggets',  pricePaise: 8_900,  isVeg: true },
      { name: 'Cheese Onion Nuggets', pricePaise: 8_900,  isVeg: true },
      { name: 'Margherita Pizza',     pricePaise: 25_900, isVeg: true },
      { name: 'Tandoori Cheese Paneer Pizza', pricePaise: 31_900, isVeg: true },
    ],
  },
  {
    category: 'Special Rabdi',
    items: [
      { name: 'Special Rabdi (Small)',        pricePaise: 5_900,  isVeg: true },
      { name: 'Special Rabdi (Big)',          pricePaise: 11_900, isVeg: true },
      { name: 'Special Rabdi with Ice Cream', pricePaise: 11_900, isVeg: true },
    ],
  },
  {
    category: 'Slush',
    items: [
      { name: 'Mango Slush',       pricePaise: 6_900, isVeg: true },
      { name: 'Pineapple Slush',   pricePaise: 6_900, isVeg: true },
      { name: 'Litchi Slush',      pricePaise: 6_900, isVeg: true },
      { name: 'Strawberry Slush',  pricePaise: 6_900, isVeg: true },
      { name: 'Mixed Berry Slush', pricePaise: 6_900, isVeg: true },
      { name: 'Jamun Slush',       pricePaise: 6_900, isVeg: true },
      { name: 'Guava Slush',       pricePaise: 6_900, isVeg: true },
    ],
  },
  {
    category: 'Classic Ice Cream Scoops',
    items: [
      { name: 'Vanilla Scoop',       pricePaise: 5_900, isVeg: true },
      { name: 'Tuti Fruity Scoop',   pricePaise: 5_900, isVeg: true },
      { name: 'Butterscotch Scoop',  pricePaise: 5_900, isVeg: true },
      { name: 'American Nuts Scoop', pricePaise: 5_900, isVeg: true },
      { name: 'Strawberry Scoop',    pricePaise: 5_900, isVeg: true },
      { name: 'Alfanso Mango Scoop', pricePaise: 5_900, isVeg: true },
      { name: 'Chocolate Scoop',     pricePaise: 5_900, isVeg: true },
    ],
  },
  {
    category: 'Premium Ice Cream Scoops',
    items: [
      { name: 'Premium Chocolate Scoop', pricePaise: 5_900, isVeg: true },
      { name: 'Shahi Anjeer Scoop',      pricePaise: 7_900, isVeg: true },
      { name: 'Paan Nawabi Scoop',       pricePaise: 7_900, isVeg: true },
      { name: 'Royal Kesar Pista Scoop', pricePaise: 7_900, isVeg: true },
      { name: 'Black Currant Scoop',     pricePaise: 7_900, isVeg: true },
      { name: 'Choco Chips Scoop',       pricePaise: 7_900, isVeg: true },
      { name: 'Rajbhog Scoop',           pricePaise: 7_900, isVeg: true },
      { name: 'Special Sundae with Toppings', pricePaise: 14_900, isVeg: true },
    ],
  },
  {
    category: 'Ice Cream Shakes',
    items: [
      { name: 'Cold Coffee',            pricePaise: 9_900,  isVeg: true },
      { name: 'Butterscotch Shake',     pricePaise: 12_900, isVeg: true },
      { name: 'Chocolate Shake',        pricePaise: 12_900, isVeg: true },
      { name: 'Paan Nawabi Shake',      pricePaise: 12_900, isVeg: true },
      { name: 'Black Currant Shake',    pricePaise: 12_900, isVeg: true },
      { name: 'Oreo Chocolate Shake',   pricePaise: 14_900, isVeg: true },
      { name: 'Kitkat Chocolate Shake', pricePaise: 14_900, isVeg: true },
      { name: 'Special Oreo + Kitkat Fusion Shake', pricePaise: 15_900, isVeg: true },
    ],
  },
];

// ── ⚠️ PROVISIONAL menus for the other five (owner-approved placeholders) ─────
// Typical small-town café/fast-food items at sensible Chirawa prices. Every
// restaurant must review + correct these at onboarding; sold-out toggling is
// self-serve in the seller app, price edits happen here + re-seed.
const MENUS: Record<string, SeedMenuSection[]> = {
  'food:rishivan': RISHIVAN_MENU,

  'food:aura': [
    {
      category: 'Snacks',
      items: [
        { name: 'Veg Grilled Sandwich',    pricePaise: 7_900,  isVeg: true },
        { name: 'Cheese Grilled Sandwich', pricePaise: 9_900,  isVeg: true },
        { name: 'Veg Burger',              pricePaise: 8_900,  isVeg: true },
        { name: 'Cheese Burger',           pricePaise: 10_900, isVeg: true },
        { name: 'French Fries',            pricePaise: 8_900,  isVeg: true },
        { name: 'Peri Peri Fries',         pricePaise: 9_900,  isVeg: true },
        { name: 'Masala Maggi',            pricePaise: 6_900,  isVeg: true },
        { name: 'Cheese Maggi',            pricePaise: 8_900,  isVeg: true },
        { name: 'Veg Pizza (7 inch)',      pricePaise: 14_900, isVeg: true },
      ],
    },
    {
      category: 'Beverages',
      items: [
        { name: 'Cold Coffee',     pricePaise: 9_900,  isVeg: true },
        { name: 'Oreo Shake',      pricePaise: 12_900, isVeg: true },
        { name: 'Chocolate Shake', pricePaise: 11_900, isVeg: true },
      ],
    },
  ],

  'food:bits-and-bites': [
    {
      category: 'Burgers & Wraps',
      items: [
        { name: 'Aloo Tikki Burger', pricePaise: 5_900,  isVeg: true },
        { name: 'Veg Cheese Burger', pricePaise: 9_900,  isVeg: true },
        { name: 'Veg Wrap',          pricePaise: 8_900,  isVeg: true },
        { name: 'Paneer Wrap',       pricePaise: 11_900, isVeg: true },
      ],
    },
    {
      category: 'Chinese & Momos',
      items: [
        { name: 'Veg Chowmein',        pricePaise: 7_900,  isVeg: true },
        { name: 'Paneer Chowmein',     pricePaise: 10_900, isVeg: true },
        { name: 'Veg Momos (8 pc)',    pricePaise: 6_900,  isVeg: true },
        { name: 'Paneer Momos (8 pc)', pricePaise: 9_900,  isVeg: true },
        { name: 'Fried Momos (8 pc)',  pricePaise: 8_900,  isVeg: true },
        { name: 'Veg Spring Roll',     pricePaise: 9_900,  isVeg: true },
      ],
    },
    {
      category: 'Sides',
      items: [
        { name: 'French Fries',    pricePaise: 7_900, isVeg: true },
        { name: 'Masala Lemonade', pricePaise: 4_900, isVeg: true },
      ],
    },
  ],

  'food:dark-park': [
    {
      category: 'Cafe Bites',
      items: [
        { name: 'Peri Peri Paneer Sandwich', pricePaise: 11_900, isVeg: true },
        { name: 'Corn Cheese Sandwich',      pricePaise: 9_900,  isVeg: true },
        { name: 'Garlic Bread',              pricePaise: 9_900,  isVeg: true },
        { name: 'Cheese Garlic Bread',       pricePaise: 12_900, isVeg: true },
        { name: 'Nachos with Cheese',        pricePaise: 11_900, isVeg: true },
        { name: 'Veg Maggi',                 pricePaise: 6_900,  isVeg: true },
      ],
    },
    {
      category: 'Pasta',
      items: [
        { name: 'Red Sauce Pasta',   pricePaise: 14_900, isVeg: true },
        { name: 'White Sauce Pasta', pricePaise: 16_900, isVeg: true },
      ],
    },
    {
      category: 'Coffee & Desserts',
      items: [
        { name: 'Cold Coffee',             pricePaise: 9_900,  isVeg: true },
        { name: 'Hot Coffee',              pricePaise: 5_900,  isVeg: true },
        { name: 'Chocolate Brownie',       pricePaise: 8_900,  isVeg: true },
        { name: 'Brownie with Ice Cream',  pricePaise: 12_900, isVeg: true },
      ],
    },
  ],

  'food:foodies': [
    {
      category: 'Main Course',
      items: [
        { name: 'Paneer Butter Masala', pricePaise: 18_900, isVeg: true },
        { name: 'Dal Makhani',          pricePaise: 15_900, isVeg: true },
        { name: 'Dal Tadka',            pricePaise: 12_900, isVeg: true },
        { name: 'Veg Thali',            pricePaise: 14_900, isVeg: true },
        { name: 'Boondi Raita',         pricePaise: 4_900,  isVeg: true },
      ],
    },
    {
      category: 'Rice & Breads',
      items: [
        { name: 'Jeera Rice',        pricePaise: 9_900,  isVeg: true },
        { name: 'Plain Rice',        pricePaise: 7_900,  isVeg: true },
        { name: 'Veg Fried Rice',    pricePaise: 11_900, isVeg: true },
        { name: 'Paneer Fried Rice', pricePaise: 14_900, isVeg: true },
        { name: 'Butter Naan',       pricePaise: 3_500,  isVeg: true },
        { name: 'Tandoori Roti',     pricePaise: 1_500,  isVeg: true },
      ],
    },
    {
      category: 'Chinese',
      items: [
        { name: 'Veg Manchurian', pricePaise: 12_900, isVeg: true },
        { name: 'Chilli Paneer',  pricePaise: 16_900, isVeg: true },
      ],
    },
  ],

  'food:goggle-cafe': [
    {
      category: 'Chai & Coffee',
      items: [
        { name: 'Masala Chai',         pricePaise: 2_500, isVeg: true },
        { name: 'Special Kulhad Chai', pricePaise: 3_900, isVeg: true },
        { name: 'Hot Coffee',          pricePaise: 4_900, isVeg: true },
        { name: 'Cold Coffee',         pricePaise: 8_900, isVeg: true },
        { name: 'Lemon Ice Tea',       pricePaise: 6_900, isVeg: true },
      ],
    },
    {
      category: 'Quick Bites',
      items: [
        { name: 'Veg Sandwich',    pricePaise: 5_900, isVeg: true },
        { name: 'Cheese Sandwich', pricePaise: 7_900, isVeg: true },
        { name: 'Bun Maska',       pricePaise: 3_900, isVeg: true },
        { name: 'Poha',            pricePaise: 3_900, isVeg: true },
        { name: 'Vada Pav',        pricePaise: 3_500, isVeg: true },
        { name: 'Maggi',           pricePaise: 5_500, isVeg: true },
        { name: 'Cheese Maggi',    pricePaise: 7_500, isVeg: true },
      ],
    },
  ],
};

async function seedMenu(
  restaurantId: string,
  restaurantKey: string,
  menu: SeedMenuSection[],
): Promise<number> {
  let count = 0;
  for (let c = 0; c < menu.length; c++) {
    const section = menu[c]!;
    const categoryId = stableUuid(`${restaurantKey}:cat:${section.category}`);
    await prisma.menuCategory.upsert({
      where:  { id: categoryId },
      update: { name: section.category, sortOrder: c + 1, isActive: true },
      create: { id: categoryId, restaurantId, name: section.category, sortOrder: c + 1 },
    });
    for (let i = 0; i < section.items.length; i++) {
      const item = section.items[i]!;
      const itemId = stableUuid(`${restaurantKey}:item:${item.name}`);
      await prisma.menuItem.upsert({
        where:  { id: itemId },
        update: {
          name: item.name, pricePaise: item.pricePaise, sortOrder: i + 1,
          isVeg: item.isVeg ?? null, description: item.description ?? null,
          menuCategoryId: categoryId, isAvailable: true,
        },
        create: {
          id: itemId, restaurantId, menuCategoryId: categoryId,
          name: item.name, pricePaise: item.pricePaise, sortOrder: i + 1,
          isVeg: item.isVeg ?? null, description: item.description ?? null,
        },
      });
      count++;
    }
  }
  return count;
}

async function main(): Promise<void> {
  // Deliberately NOT guarded by assertSeedableEnvironment (RC1): that guard
  // exists to keep DEMO accounts (well-known OTP phones) out of production.
  // This seed is REAL production content — restaurants + menus only, creates
  // zero users/credentials, and every write is an idempotent upsert — and it
  // MUST run on the production DB at launch.
  console.log(`🍽️  Seeding Food module — 6 launch restaurants + menus… (NODE_ENV=${process.env.NODE_ENV ?? 'development'})`);

  for (const r of RESTAURANTS) {
    const id = stableUuid(r.key);
    await prisma.restaurant.upsert({
      where:  { id },
      update: {
        name: r.name, cuisine: r.cuisine, description: r.description,
        displayOrder: r.displayOrder, address: r.address,
        openTime: r.openTime, closeTime: r.closeTime,
        prepTimeMinutes: r.prepTimeMinutes, isActive: true,
      },
      create: {
        id, name: r.name, cuisine: r.cuisine, description: r.description,
        displayOrder: r.displayOrder, lat: r.lat, lng: r.lng, address: r.address,
        openTime: r.openTime, closeTime: r.closeTime,
        prepTimeMinutes: r.prepTimeMinutes,
      },
    });

    const menu = MENUS[r.key];
    const seeded = menu ? await seedMenu(id, r.key, menu) : 0;
    const marker = r.key === 'food:rishivan' ? ' (REAL — from menu card)' : ' (provisional — restaurant to confirm)';
    console.log(`   ${r.displayOrder}. ${r.name} — ${seeded} menu items${seeded > 0 ? marker : ''}`);
  }

  console.log('✅ Food seed complete. Rishivan menu is verbatim; other five are provisional.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => void prisma.$disconnect());
