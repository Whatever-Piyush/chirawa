import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import type { SingleSellerSettlePayload } from '../queues';
import {
  isPayoutConfigured, ensureSellerFundAccount, createPayout, fetchPayout,
} from '../../modules/payments/razorpay.service';

/**
 * Daily seller settlement — runs at 11 AM every day.
 *
 * For each active seller:
 * 1. Find all delivered orders from the previous day
 * 2. Sum item amounts (unit_price × quantity — SNAPSHOT values)
 * 3. Create settlement record (status: pending)
 * 4. Initiate a real RazorpayX UPI payout (0.3)
 * 5. Write the ledger ONLY once the payout is actually 'processed'
 * 6. (TODO follow-up) Notify seller via FCM + SMS
 */

// RazorpayX payout statuses that are accepted but not yet settled — we record the
// payout id but do NOT mark the settlement paid or write the ledger.
const PAYOUT_IN_FLIGHT = new Set(['queued', 'pending', 'processing', 'scheduled', 'created']);

interface PayoutSeller {
  id: string; upiId: string | null; userId: string; ownerName: string;
  razorpayContactId: string | null; razorpayFundAccountId: string | null;
}

// Fields every caller must select so initiatePayout has what it needs.
const sellerPayoutSelect = {
  id: true, upiId: true, userId: true, ownerName: true,
  razorpayContactId: true, razorpayFundAccountId: true,
} as const;

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
        select: sellerPayoutSelect,
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

// Exported for unit testing the payout state machine (the money-critical path).
export async function initiatePayout(
  settlementId: string,
  seller: PayoutSeller,
  amountPaise: number,
  prisma: PrismaClient,
): Promise<void> {
  // Idempotency guard — never re-pay a settlement that's already paid, in flight,
  // or has a payout id on file. createPayout's idempotency key is the backstop.
  const current = await prisma.settlement.findUnique({
    where:  { id: settlementId },
    select: { status: true, payoutId: true },
  });
  if (!current) return;
  if (current.status === 'paid' || current.status === 'processing' || current.payoutId) {
    console.log(`↩️  Settlement ${settlementId} already ${current.status} — skipping payout`);
    return;
  }

  // No UPI on file → stays PENDING and flagged for an admin (NOT failed).
  if (!seller.upiId) {
    await prisma.settlement.update({
      where: { id: settlementId },
      data:  { status: 'pending', needsAttention: true, failureReason: 'No UPI ID on seller profile' },
    });
    console.warn(`⚠️  Seller ${seller.id} has no UPI — settlement ${settlementId} pending admin action`);
    return;
  }

  // RazorpayX not configured (dev/test). 0.2 guarantees production can't reach
  // here on placeholders. Leave pending — never fake a paid payout.
  if (!isPayoutConfigured()) {
    await prisma.settlement.update({
      where: { id: settlementId },
      data:  { failureReason: 'RazorpayX not configured — payout skipped (non-production)' },
    });
    console.log(`🧪 Payout skipped (unconfigured): settlement ${settlementId}, ₹${amountPaise / 100}`);
    return;
  }

  try {
    // Ensure a RazorpayX contact + VPA fund account, reusing cached ids.
    const { contactId, fundAccountId } = await ensureSellerFundAccount({
      contactId:       seller.razorpayContactId,
      fundAccountId:   seller.razorpayFundAccountId,
      sellerProfileId: seller.id,
      name:            seller.ownerName,
      upiId:           seller.upiId,
    });
    if (contactId !== seller.razorpayContactId || fundAccountId !== seller.razorpayFundAccountId) {
      await prisma.sellerProfile.update({
        where: { id: seller.id },
        data:  { razorpayContactId: contactId, razorpayFundAccountId: fundAccountId },
      });
    }

    const payout = await createPayout({
      fundAccountId,
      amountPaise,
      referenceId:    settlementId,
      narration:      'Bringly settlement',
      idempotencyKey: settlementId,
    });

    if (payout.status === 'processed') {
      // Money actually moved — mark paid AND write the ledger atomically.
      await prisma.$transaction([
        prisma.settlement.update({
          where: { id: settlementId },
          data:  {
            status: 'paid', paidAt: new Date(),
            payoutId: payout.payoutId, upiRef: payout.utr,
            needsAttention: false, failureReason: null,
          },
        }),
        prisma.transaction.create({
          data: {
            type:          'seller_settlement',
            amountPaise,
            referenceId:   settlementId,
            referenceType: 'settlement',
            description:   `Daily settlement payout to ${seller.upiId}`,
          },
        }),
      ]);
      console.log(`✅ Payout processed: settlement ${settlementId} → ${seller.upiId}`);
    } else if (PAYOUT_IN_FLIGHT.has(payout.status)) {
      // Accepted but not settled yet — record the payout id WITHOUT marking paid
      // or writing the ledger. A payout webhook / reconcile sweep finishes this
      // later (see worklog follow-up).
      await prisma.settlement.update({
        where: { id: settlementId },
        data:  { status: 'processing', payoutId: payout.payoutId, failureReason: null },
      });
      console.log(`⏳ Payout ${payout.status}: settlement ${settlementId} (payout ${payout.payoutId})`);
    } else {
      // rejected / cancelled / reversed / failed — flag for an admin, no ledger.
      await prisma.settlement.update({
        where: { id: settlementId },
        data:  {
          status: 'failed', payoutId: payout.payoutId,
          needsAttention: true, failureReason: `Payout ${payout.status}`,
        },
      });
      console.error(`❌ Payout ${payout.status}: settlement ${settlementId} flagged for admin`);
    }
  } catch (err) {
    // API/network failure — failed + flagged. No ledger, not paid. Safe to retry:
    // the idempotency key prevents a duplicate payout next run.
    const reason = err instanceof Error ? err.message : 'Unknown payout error';
    await prisma.settlement.update({
      where: { id: settlementId },
      data:  { status: 'failed', needsAttention: true, failureReason: reason.slice(0, 255) },
    });
    console.error(`❌ Payout error for settlement ${settlementId}:`, reason);
  }
}

/**
 * Payout reconcile sweep (completes 0.3). A payout that came back queued/processing
 * stays in settlement status 'processing' with no ledger entry. Until there's a
 * RazorpayX webhook, this periodic sweep fetches each in-flight payout's status and
 * finalizes it: processed → paid + ledger (idempotent); terminal failure → failed +
 * needsAttention. Still-in-flight payouts are left for the next sweep.
 */
export async function runPayoutReconciliation(prisma: PrismaClient): Promise<void> {
  if (!isPayoutConfigured()) return;

  const pending = await prisma.settlement.findMany({
    where:  { status: 'processing', payoutId: { not: null } },
    take:   50,
    select: { id: true, payoutId: true, netPayablePaise: true, seller: { select: { upiId: true } } },
  });
  if (pending.length === 0) return;

  for (const s of pending) {
    try {
      const payout = await fetchPayout(s.payoutId!);

      if (payout.status === 'processed') {
        // Write the ledger only once (idempotent if a prior sweep already did).
        const ledgered = await prisma.transaction.findFirst({
          where: { referenceId: s.id, referenceType: 'settlement' }, select: { id: true },
        });
        await prisma.$transaction([
          prisma.settlement.update({
            where: { id: s.id },
            data:  { status: 'paid', paidAt: new Date(), upiRef: payout.utr, needsAttention: false, failureReason: null },
          }),
          ...(ledgered ? [] : [prisma.transaction.create({
            data: {
              type: 'seller_settlement', amountPaise: s.netPayablePaise,
              referenceId: s.id, referenceType: 'settlement',
              description: `Daily settlement payout to ${s.seller.upiId ?? 'seller'}`,
            },
          })]),
        ]);
        console.log(`✅ Payout reconciled → paid: settlement ${s.id}`);
      } else if (!PAYOUT_IN_FLIGHT.has(payout.status)) {
        await prisma.settlement.update({
          where: { id: s.id },
          data:  { status: 'failed', needsAttention: true, failureReason: `Payout ${payout.status}` },
        });
        console.error(`❌ Payout reconciled → failed: settlement ${s.id} (${payout.status})`);
      }
      // else still in flight → leave for the next sweep
    } catch (err) {
      console.error(`Payout reconcile error for settlement ${s.id}:`, err);
    }
  }
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
    include: { seller: { select: sellerPayoutSelect } },
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
