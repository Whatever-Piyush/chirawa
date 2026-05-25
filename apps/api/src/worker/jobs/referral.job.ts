import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import type { UnlockReferralPayload } from '../queues';

/**
 * Referral credit unlock — triggered when referred user's first order is delivered.
 *
 * Flow:
 * 1. Find referral redemption for this user
 * 2. Check this is their first qualifying delivered order
 * 3. Unlock ₹30 wallet credit for both referrer + referred
 * 4. Update redemption status to 'completed'
 * 5. Update referral code total uses count
 */
export async function processUnlockReferral(
  job: Job<UnlockReferralPayload>,
  prisma: PrismaClient,
): Promise<void> {
  const { orderId, referredUserId } = job.data;

  // Check if this is the referred user's first delivered order
  const deliveredCount = await prisma.order.count({
    where: {
      customerId: referredUserId,
      status:     'delivered',
    },
  });

  // Only unlock on first delivery
  if (deliveredCount !== 1) return;

  const redemption = await prisma.referralRedemption.findUnique({
    where: { referredUserId },
    include: { referralCode: { select: { ownerUserId: true, id: true } } },
  });

  if (!redemption) return;
  if (redemption.refereeCreditStatus === 'credited') return; // Already processed

  const REFERRAL_CREDIT_PAISE = 3000; // ₹30 each

  // Get config from DB (allows changing amount without code deploy)
  const config = await prisma.appConfig.findUnique({
    where: { key: 'referral_reward_paise' },
  });
  const creditAmount = config ? parseInt(config.value, 10) : REFERRAL_CREDIT_PAISE;

  // Credit referee (new user)
  await prisma.$transaction([
    prisma.customerProfile.update({
      where: { userId: referredUserId },
      data:  { walletBalance: { increment: creditAmount } },
    }),
    prisma.walletTransaction.create({
      data: {
        userId:      referredUserId,
        amountPaise: creditAmount,
        type:        'referral',
        description: 'Referral credit — pehle order ke liye!',
        orderId,
        isLocked:    false,
        unlockedAt:  new Date(),
      },
    }),
    prisma.transaction.create({
      data: {
        type:          'referral_credit',
        amountPaise:   creditAmount,
        referenceId:   redemption.id,
        referenceType: 'referral',
        description:   `Referee credit for user ${referredUserId}`,
      },
    }),
    prisma.referralRedemption.update({
      where: { id: redemption.id },
      data:  { refereeCreditStatus: 'credited', qualifyingOrderId: orderId },
    }),
  ]);

  // Credit referrer
  const referrerId = redemption.referralCode.ownerUserId;

  await prisma.$transaction([
    prisma.customerProfile.update({
      where: { userId: referrerId },
      data:  { walletBalance: { increment: creditAmount } },
    }),
    prisma.walletTransaction.create({
      data: {
        userId:      referrerId,
        amountPaise: creditAmount,
        type:        'referral',
        description: 'Referral reward — aapke code se koi join hua!',
        isLocked:    false,
        unlockedAt:  new Date(),
      },
    }),
    prisma.transaction.create({
      data: {
        type:          'referral_credit',
        amountPaise:   creditAmount,
        referenceId:   redemption.id,
        referenceType: 'referral',
        description:   `Referrer credit for user ${referrerId}`,
      },
    }),
    prisma.referralRedemption.update({
      where: { id: redemption.id },
      data:  { referrerCreditStatus: 'credited' },
    }),
    // Increment total uses on referral code
    prisma.referralCode.update({
      where: { id: redemption.referralCode.id },
      data:  { totalUses: { increment: 1 } },
    }),
  ]);

  console.log(`🎁 Referral unlocked: ₹${creditAmount / 100} each for ${referrerId} and ${referredUserId}`);
}
