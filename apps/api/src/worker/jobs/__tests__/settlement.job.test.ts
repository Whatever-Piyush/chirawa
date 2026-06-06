import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the RazorpayX layer so no real payout is attempted. Factory is hoisted, so
// every named import settlement.job pulls from razorpay.service must be provided.
vi.mock('../../../modules/payments/razorpay.service', () => ({
  isPayoutConfigured:     vi.fn(() => true),
  ensureSellerFundAccount: vi.fn().mockResolvedValue({ contactId: 'cont_1', fundAccountId: 'fa_1' }),
  createPayout:           vi.fn(),
}));

import * as razorpay from '../../../modules/payments/razorpay.service';
import { initiatePayout } from '../settlement.job';

const isPayoutConfigured      = vi.mocked(razorpay.isPayoutConfigured);
const ensureSellerFundAccount = vi.mocked(razorpay.ensureSellerFundAccount);
const createPayout            = vi.mocked(razorpay.createPayout);

const SETTLEMENT_ID = 'settle_1';
const AMOUNT = 50000; // ₹500 in paise

const seller = {
  id: 'seller_1', upiId: 'seller@upi', userId: 'user_1', ownerName: 'Gaurav',
  razorpayContactId: 'cont_1', razorpayFundAccountId: 'fa_1', // cached → no create calls
};

// Fake prisma capturing the writes initiatePayout performs.
function makePrisma(current: { status: string; payoutId: string | null } | null) {
  const settlementUpdate    = vi.fn().mockResolvedValue({});
  const transactionCreate   = vi.fn().mockResolvedValue({});
  const sellerProfileUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    settlement: {
      findUnique: vi.fn().mockResolvedValue(current),
      update:     settlementUpdate,
    },
    transaction:   { create: transactionCreate },
    sellerProfile: { update: sellerProfileUpdate },
    $transaction:  vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma, settlementUpdate, transactionCreate, sellerProfileUpdate };
}

// Pull the data object from the most recent settlement.update call.
const lastUpdateData = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls[fn.mock.calls.length - 1]![0].data as Record<string, unknown>;

const pending = { status: 'pending', payoutId: null };

describe('initiatePayout (0.3 — RazorpayX payout state machine)', () => {
  beforeEach(() => {
    isPayoutConfigured.mockReturnValue(true);
    ensureSellerFundAccount.mockResolvedValue({ contactId: 'cont_1', fundAccountId: 'fa_1' });
    createPayout.mockReset();
  });

  it('marks paid AND writes the ledger only when payout status is "processed"', async () => {
    createPayout.mockResolvedValue({ payoutId: 'pout_1', status: 'processed', utr: 'UTR123' });
    const { prisma, settlementUpdate, transactionCreate } = makePrisma(pending);

    await initiatePayout(SETTLEMENT_ID, seller, AMOUNT, prisma as never);

    expect(createPayout).toHaveBeenCalledWith(expect.objectContaining({
      fundAccountId: 'fa_1', amountPaise: AMOUNT, idempotencyKey: SETTLEMENT_ID, referenceId: SETTLEMENT_ID,
    }));
    expect(lastUpdateData(settlementUpdate)).toMatchObject({ status: 'paid', payoutId: 'pout_1', upiRef: 'UTR123' });
    expect(transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'seller_settlement', amountPaise: AMOUNT, referenceId: SETTLEMENT_ID }) }),
    );
  });

  it('records processing WITHOUT paying/ledgering when payout is in flight (queued)', async () => {
    createPayout.mockResolvedValue({ payoutId: 'pout_2', status: 'queued', utr: null });
    const { prisma, settlementUpdate, transactionCreate } = makePrisma(pending);

    await initiatePayout(SETTLEMENT_ID, seller, AMOUNT, prisma as never);

    expect(lastUpdateData(settlementUpdate)).toMatchObject({ status: 'processing', payoutId: 'pout_2' });
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('marks failed + needsAttention and writes no ledger when payout is rejected', async () => {
    createPayout.mockResolvedValue({ payoutId: 'pout_3', status: 'rejected', utr: null });
    const { prisma, settlementUpdate, transactionCreate } = makePrisma(pending);

    await initiatePayout(SETTLEMENT_ID, seller, AMOUNT, prisma as never);

    expect(lastUpdateData(settlementUpdate)).toMatchObject({ status: 'failed', needsAttention: true });
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('marks failed + needsAttention and writes no ledger when the payout call throws', async () => {
    createPayout.mockRejectedValue(new Error('RazorpayX /payouts 500: server error'));
    const { prisma, settlementUpdate, transactionCreate } = makePrisma(pending);

    await initiatePayout(SETTLEMENT_ID, seller, AMOUNT, prisma as never);

    const data = lastUpdateData(settlementUpdate);
    expect(data).toMatchObject({ status: 'failed', needsAttention: true });
    expect(String(data.failureReason)).toContain('RazorpayX');
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('leaves a no-UPI seller PENDING + flagged, never failed, and never calls the payout API', async () => {
    const { prisma, settlementUpdate, transactionCreate } = makePrisma(pending);

    await initiatePayout(SETTLEMENT_ID, { ...seller, upiId: null }, AMOUNT, prisma as never);

    expect(lastUpdateData(settlementUpdate)).toMatchObject({ status: 'pending', needsAttention: true });
    expect(createPayout).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('skips the payout (stays pending, no fake paid) when RazorpayX is not configured', async () => {
    isPayoutConfigured.mockReturnValue(false);
    const { prisma, settlementUpdate, transactionCreate } = makePrisma(pending);

    await initiatePayout(SETTLEMENT_ID, seller, AMOUNT, prisma as never);

    expect(createPayout).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
    expect(lastUpdateData(settlementUpdate).status).not.toBe('paid');
  });

  it('is idempotent: does nothing if the settlement is already paid', async () => {
    const { prisma, settlementUpdate, transactionCreate } = makePrisma({ status: 'paid', payoutId: 'pout_old' });

    await initiatePayout(SETTLEMENT_ID, seller, AMOUNT, prisma as never);

    expect(createPayout).not.toHaveBeenCalled();
    expect(settlementUpdate).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('persists newly-created contact/fund-account ids onto the seller', async () => {
    createPayout.mockResolvedValue({ payoutId: 'pout_4', status: 'processed', utr: 'UTR9' });
    ensureSellerFundAccount.mockResolvedValue({ contactId: 'cont_NEW', fundAccountId: 'fa_NEW' });
    const { prisma, sellerProfileUpdate } = makePrisma(pending);

    await initiatePayout(SETTLEMENT_ID, { ...seller, razorpayContactId: null, razorpayFundAccountId: null }, AMOUNT, prisma as never);

    expect(sellerProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { razorpayContactId: 'cont_NEW', razorpayFundAccountId: 'fa_NEW' } }),
    );
  });
});
