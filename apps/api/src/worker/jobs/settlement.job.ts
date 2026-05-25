import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import type { SingleSellerSettlePayload } from '../queues';

/**
 * Daily seller settlement — runs at 11 AM every day.
 *
 * For each active seller:
 * 1. Find all delivered orders from the previous day
 * 2. Sum item amounts (unit_price × quantity — SNAPSHOT values)
 * 3. Create settlement record
 * 4. Initiate UPI payout via Razorpay Payouts (or mock in dev)
 * 5. Log to transactions ledger
 * 6. Notify seller via FCM + SMS
 */

export async function runDailySettlement(prisma: PrismaClient): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log(`💰 Running daily settlement for ${yesterday.toDateString()}`);

  // Get all shops with delivered orders yesterday
  const shops = await prisma.shop.findMany({
    where: { isActive: true },
    include: {
      seller: {
        select: { id: true, upiId: true, userId: true },
      },
    },
  });

  let settled = 0;
  let skipped = 0;

  for (const shop of shops) {
    try {
      const orders = await prisma.order.findMany({
        where: {
          shopId:      shop.id,
          status:      'delivered',
          deliveredAt: { gte: yesterday, lt: today },
        },
        include: {
          items: { select: { unitPrice: true, quantity: true } },
        },
      });

      if (orders.length === 0) { skipped++; continue; }

      // Check idempotency — skip if already settled
      const existing = await prisma.settlement.findUnique({
        where: {
          sellerId_periodDate: {
            sellerId:   shop.sellerId,
            periodDate: yesterday,
          },
        },
      });
      if (existing) { skipped++; continue; }

      // Calculate total from ORDER ITEM SNAPSHOTS — never products.price
      const totalProductPaise = orders.reduce((sum, order) =>
        sum + order.items.reduce((s, item) => s + (item.unitPrice * item.quantity), 0), 0,
      );

      // Create settlement record
      const settlement = await prisma.settlement.create({
        data: {
          sellerId:         shop.sellerId,
          shopId:           shop.id,
          periodDate:       yesterday,
          totalOrders:      orders.length,
          totalProductPaise,
          platformFeePaise: 0, // No platform fee in V1
          netPayablePaise:  totalProductPaise,
          status:           'pending',
        },
      });

      // Initiate payout
      await initiatePayout(settlement.id, shop.seller, totalProductPaise, prisma);
      settled++;

    } catch (err) {
      console.error(`Settlement failed for shop ${shop.id}:`, err);
    }
  }

  console.log(`✅ Settlement done — settled: ${settled}, skipped: ${skipped}`);
}

async function initiatePayout(
  settlementId: string,
  seller: { id: string; upiId: string | null; userId: string },
  amountPaise: number,
  prisma: PrismaClient,
): Promise<void> {
  // Dev mode — log mock payout
  if (!seller.upiId) {
    console.log(`⚠️  No UPI ID for seller ${seller.id} — skipping payout`);
    await prisma.settlement.update({
      where: { id: settlementId },
      data:  { status: 'failed' },
    });
    return;
  }

  console.log(`📤 [DEV PAYOUT] Seller ${seller.id}: ₹${amountPaise / 100} → ${seller.upiId}`);

  // In production: call Razorpay Payouts API here
  // const payout = await razorpayX.payouts.create({...});

  // Mark as paid
  await prisma.settlement.update({
    where: { id: settlementId },
    data:  { status: 'paid', paidAt: new Date(), upiRef: `DEV_${Date.now()}` },
  });

  // Log to financial ledger (append-only)
  await prisma.transaction.create({
    data: {
      type:          'seller_settlement',
      amountPaise,
      referenceId:   settlementId,
      referenceType: 'settlement',
      description:   `Daily settlement payout to ${seller.upiId}`,
    },
  });
}

// ── Process single seller settle job ─────────────────────────────────────────
export async function processSingleSellerSettle(
  job: Job<SingleSellerSettlePayload>,
  prisma: PrismaClient,
): Promise<void> {
  const { sellerProfileId, shopId, periodDate } = job.data;

  const orders = await prisma.order.findMany({
    where: {
      shopId,
      status:      'delivered',
      deliveredAt: {
        gte: new Date(periodDate),
        lt:  new Date(new Date(periodDate).getTime() + 86400000),
      },
    },
    include: { items: true },
  });

  if (!orders.length) return;

  const shop = await prisma.shop.findUniqueOrThrow({
    where:   { id: shopId },
    include: { seller: { select: { id: true, upiId: true, userId: true } } },
  });

  const totalProductPaise = orders.reduce((sum, order) =>
    sum + order.items.reduce((s, item) => s + (item.unitPrice * item.quantity), 0), 0,
  );

  const settlement = await prisma.settlement.upsert({
    where: {
      sellerId_periodDate: {
        sellerId:   sellerProfileId,
        periodDate: new Date(periodDate),
      },
    },
    update: {},
    create: {
      sellerId:         sellerProfileId,
      shopId,
      periodDate:       new Date(periodDate),
      totalOrders:      orders.length,
      totalProductPaise,
      platformFeePaise: 0,
      netPayablePaise:  totalProductPaise,
      status:           'pending',
    },
  });

  if (settlement.status === 'pending') {
    await initiatePayout(settlement.id, shop.seller, totalProductPaise, prisma);
  }
}
