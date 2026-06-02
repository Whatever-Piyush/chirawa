import { PrismaClient } from '@prisma/client';
import { seedSearchAliases } from './seeds/search-aliases';
import { seedShops } from './seeds/shops';
import { seedZones } from './seeds/zones';
import { seedRiders } from './seeds/riders';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // ── Fee Rule v1 ────────────────────────────────────────────────────────────
  // All amounts in paise. Distances in metres for precision.
  await prisma.feeRule.upsert({
    where: { version: 1 },
    update: {},
    create: {
      version: 1,
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null, // Currently active
      createdBy: '00000000-0000-0000-0000-000000000000',
      ruleDefinition: {
        bands: [
          {
            label: 'long_distance',
            conditionDistanceMetresGt: 4000,
            feePaise: 2500,
          },
          {
            label: 'short_low_cart',
            conditionDistanceMetresLte: 4000,
            conditionCartPaiseLt: 10000,
            feePaise: 2000,
          },
          {
            label: 'short_mid_cart',
            conditionDistanceMetresLte: 4000,
            conditionCartPaiseGte: 10000,
            conditionCartPaiseLte: 30000,
            feePaise: 1500,
          },
          {
            label: 'short_high_cart',
            conditionDistanceMetresLte: 4000,
            conditionCartPaiseGt: 30000,
            feePaise: 1000,
          },
        ],
      },
    },
  });
  console.log('  ✅ Fee rule v1 created');

  // ── Loyalty Tiers ──────────────────────────────────────────────────────────
  const tiers = [
    {
      name: 'bronze',
      minOrders: 0,
      maxOrders: 9,
      walletBonusPct: 0,
      description: 'Starting tier for all new customers',
    },
    {
      name: 'silver',
      minOrders: 10,
      maxOrders: 29,
      walletBonusPct: 10,
      description: '10% bonus on referral credits',
    },
    {
      name: 'gold',
      minOrders: 30,
      maxOrders: null,
      walletBonusPct: 20,
      description: '20% bonus on referral credits + priority support',
    },
  ];

  for (const tier of tiers) {
    await prisma.loyaltyTier.upsert({
      where: { name: tier.name },
      update: {},
      create: tier,
    });
  }
  console.log('  ✅ Loyalty tiers created (bronze / silver / gold)');

  // ── App Config ─────────────────────────────────────────────────────────────
  const configs = [
    { key: 'referral_reward_paise', value: '3000' },         // ₹30
    { key: 'referral_referee_reward_paise', value: '3000' },  // ₹30
    { key: 'referral_monthly_cap', value: '10' },             // 10 referrals/month max
    { key: 'daily_referral_credit_cap_paise', value: '500000' }, // ₹5000/day
    { key: 'cod_float_cap_paise', value: '200000' },          // ₹2000 rider COD cap
    { key: 'order_cancel_window_seconds', value: '120' },     // 2 min cancel window
    { key: 'otp_expiry_seconds', value: '300' },              // 5 min OTP
    { key: 'rider_accept_window_seconds', value: '60' },      // 60s to accept order
    { key: 'max_otp_per_phone_per_hour', value: '3' },
    { key: 'max_otp_per_phone_per_day', value: '10' },
    { key: 'max_otp_per_ip_per_hour', value: '20' },
    { key: 'app_name', value: 'Chirawa' },
    { key: 'support_phone', value: '9999999999' },            // Update before launch
    { key: 'maintenance_mode', value: 'false' },
  ];

  for (const config of configs) {
    await prisma.appConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }
  console.log('  ✅ App config seeded (14 keys)');

  // ── Promotions ───────────────────────────────────────────────────────────
  // FIRSTORDER: free delivery on a customer's first order (auto-applied at
  // checkout for anyone with zero prior orders). value_paise is informational
  // for free_delivery — the discount equals the actual delivery fee.
  await prisma.promoCode.upsert({
    where:  { code: 'FIRSTORDER' },
    update: { type: 'free_delivery', isActive: true, minCartPaise: 9900, maxUsesPerUser: 1 },
    create: {
      code:           'FIRSTORDER',
      type:           'free_delivery',
      valuePaise:     1000,   // ₹10 — typical delivery fee (informational)
      minCartPaise:   9900,   // ₹99 minimum order
      maxUsesPerUser: 1,
      isActive:       true,
    },
  });
  console.log('  ✅ Promo seeded (FIRSTORDER — free first delivery)');

  // ── Search Aliases ─────────────────────────────────────────────────────────
  await seedSearchAliases(prisma);

  // ── Shops, Categories & Products ─────────────────────────────────────────────
  await seedShops(prisma);

  await seedZones(prisma);

  await seedRiders(prisma);

  // ── Summary counts ───────────────────────────────────────────────────────────
  const [shops, categories, products] = await Promise.all([
    prisma.shop.count(),
    prisma.category.count(),
    prisma.product.count(),
  ]);
  console.log(`  📊 Totals now in DB → shops: ${shops}, categories: ${categories}, products: ${products}`);

  console.log('\n✅ Database seeded successfully!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
