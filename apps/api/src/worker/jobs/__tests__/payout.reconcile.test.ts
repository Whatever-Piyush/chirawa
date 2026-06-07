import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../modules/payments/razorpay.service', () => ({
  isPayoutConfigured: vi.fn(() => true),
  fetchPayout:        vi.fn(),
  ensureSellerFundAccount: vi.fn(),
  createPayout:       vi.fn(),
}));

import * as razorpay from '../../../modules/payments/razorpay.service';
import { runPayoutReconciliation } from '../settlement.job';

const isPayoutConfigured = vi.mocked(razorpay.isPayoutConfigured);
const fetchPayout        = vi.mocked(razorpay.fetchPayout);

function makePrisma(opts: { ledgered?: boolean } = {}) {
  const settlementUpdate = vi.fn().mockResolvedValue({});
  const transactionCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    settlement: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'set_1', payoutId: 'pout_1', netPayablePaise: 50000, seller: { upiId: 'shop@upi' } },
      ]),
      update: settlementUpdate,
    },
    transaction: {
      findFirst: vi.fn().mockResolvedValue(opts.ledgered ? { id: 'txn_old' } : null),
      create:    transactionCreate,
    },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma, settlementUpdate, transactionCreate };
}

describe('runPayoutReconciliation (0.3 follow-up)', () => {
  beforeEach(() => { isPayoutConfigured.mockReturnValue(true); fetchPayout.mockReset(); });

  it('finalizes a processed payout to paid and writes the ledger once', async () => {
    fetchPayout.mockResolvedValue({ status: 'processed', utr: 'UTR9' });
    const p = makePrisma();
    await runPayoutReconciliation(p.prisma as never);

    expect(p.settlementUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'set_1' }, data: expect.objectContaining({ status: 'paid', upiRef: 'UTR9' }),
    }));
    expect(p.transactionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'seller_settlement', amountPaise: 50000, referenceId: 'set_1' }),
    }));
  });

  it('does not double-write the ledger if one already exists', async () => {
    fetchPayout.mockResolvedValue({ status: 'processed', utr: 'UTR9' });
    const p = makePrisma({ ledgered: true });
    await runPayoutReconciliation(p.prisma as never);
    expect(p.transactionCreate).not.toHaveBeenCalled();
  });

  it('marks a terminally-failed payout failed + needsAttention, no ledger', async () => {
    fetchPayout.mockResolvedValue({ status: 'reversed', utr: null });
    const p = makePrisma();
    await runPayoutReconciliation(p.prisma as never);
    expect(p.settlementUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'set_1' }, data: expect.objectContaining({ status: 'failed', needsAttention: true }),
    }));
    expect(p.transactionCreate).not.toHaveBeenCalled();
  });

  it('leaves a still-in-flight payout untouched', async () => {
    fetchPayout.mockResolvedValue({ status: 'processing', utr: null });
    const p = makePrisma();
    await runPayoutReconciliation(p.prisma as never);
    expect(p.settlementUpdate).not.toHaveBeenCalled();
  });

  it('skips entirely when RazorpayX is not configured', async () => {
    isPayoutConfigured.mockReturnValue(false);
    const p = makePrisma();
    await runPayoutReconciliation(p.prisma as never);
    expect(p.prisma.settlement.findMany).not.toHaveBeenCalled();
  });
});
