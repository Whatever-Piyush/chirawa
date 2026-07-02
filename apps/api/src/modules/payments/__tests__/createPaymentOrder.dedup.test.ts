import { describe, it, expect, vi, beforeEach } from 'vitest';

// F-1 regression: createPaymentOrder must reuse an existing pending payment instead of
// creating a second pending row. The duplicate row used to break capture, because
// markOrderPaid writes one razorpayPaymentId across ALL pending rows of an order and
// Payment.razorpayPaymentId is @unique → a 2nd row caused a unique-violation 500.

// Phase 5: these tests exercise the ONLINE payment flow — run them with the
// COD-only launch flag flipped on (the guard's own tests: cod-only.guard.test.ts).
vi.mock('../../../config/features', () => ({
  onlinePaymentsEnabled: () => true,
}));
vi.mock('../razorpay.service', () => ({
  isRazorpayConfigured:   vi.fn(() => false),                       // dev-mock by default
  createRazorpayOrder:    vi.fn(async (_amt: number, oid: string) => ({ id: `rzp_created_${oid}` })),
  verifyPaymentSignature: vi.fn(() => true),
  createRefund:           vi.fn(),
  fetchPaymentsByOrderId: vi.fn(),
}));
vi.mock('../../../shared/events/event-bus', () => ({
  emitOrderStatusChanged: vi.fn(),
  emitNewOrderForSeller:  vi.fn(),
}));

import * as razorpay from '../razorpay.service';
import { createPaymentsService } from '../payments.service';

const isCfg = vi.mocked(razorpay.isRazorpayConfigured);
const createRzp = vi.mocked(razorpay.createRazorpayOrder);

interface PayRow {
  id: string; orderId: string; razorpayOrderId: string | null; razorpayPaymentId: string | null;
  status: string; amountPaise: number; refundedPaise: number; method: string | null;
  capturedAt: Date | null; createdAt: number;
}

// Stateful in-memory Prisma double. Crucially, payment.updateMany enforces the
// razorpay_payment_id UNIQUE constraint exactly like Postgres — so a 2nd pending row
// genuinely reproduces the F-1 500 (see "two pending rows" test).
function makeDb(seedPayments: Partial<PayRow>[] = []) {
  let seq = 0;
  const orders = new Map<string, any>([
    ['order_1', {
      id: 'order_1', customerId: 'cust_1', status: 'pending_payment', totalAmount: 28500,
      shopId: 'shop_1', shop: { id: 'shop_1', seller: { id: 'sp_1', userId: 'seller_user_1' } },
    }],
  ]);
  const payments: PayRow[] = seedPayments.map((p) => ({
    id: p.id ?? `seed_${++seq}`, orderId: p.orderId ?? 'order_1',
    razorpayOrderId: p.razorpayOrderId ?? 'order_DEV_seed', razorpayPaymentId: p.razorpayPaymentId ?? null,
    status: p.status ?? 'pending', amountPaise: p.amountPaise ?? 28500, refundedPaise: p.refundedPaise ?? 0,
    method: p.method ?? null, capturedAt: p.capturedAt ?? null, createdAt: ++seq,
  }));
  const txns: any[] = [];

  const assertUniquePayId = () => {
    const ids = payments.map((p) => p.razorpayPaymentId).filter((x): x is string => x != null);
    if (new Set(ids).size !== ids.length) {
      throw new Error('Unique constraint failed on the fields: (`razorpay_payment_id`)');
    }
  };
  const matchPay = (where: any, p: PayRow) =>
    (where.orderId === undefined || p.orderId === where.orderId) &&
    (where.id === undefined || p.id === where.id) &&
    (where.status === undefined || p.status === where.status) &&
    (where.razorpayOrderId === undefined ||
      (where.razorpayOrderId?.not === null ? p.razorpayOrderId != null : p.razorpayOrderId === where.razorpayOrderId));

  const payment = {
    create: vi.fn(async ({ data }: any) => {
      const row: PayRow = {
        id: `pay_${++seq}`, refundedPaise: 0, razorpayPaymentId: null, method: null, capturedAt: null,
        createdAt: ++seq, ...data,
      };
      payments.push(row); assertUniquePayId(); return { ...row };
    }),
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      let rows = payments.filter((p) => matchPay(where, p));
      if (orderBy?.createdAt === 'desc') rows = rows.slice().sort((a, b) => b.createdAt - a.createdAt);
      return rows[0] ? { ...rows[0] } : null;
    }),
    findMany: vi.fn(async ({ where }: any) => payments.filter((p) => matchPay(where ?? {}, p)).map((p) => ({ ...p }))),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = payments.filter((p) => matchPay(where, p));
      rows.forEach((r) => Object.assign(r, data));
      assertUniquePayId();                       // mimic the @unique enforcement on write
      return { count: rows.length };
    }),
  };
  const order = {
    findUnique: vi.fn(async ({ where }: any) => { const o = orders.get(where.id); return o ? { ...o } : null; }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const o = orders.get(where.id);
      if (o && (where.status === undefined || o.status === where.status)) { Object.assign(o, data); return { count: 1 }; }
      return { count: 0 };
    }),
  };
  const orderStatusHistory = { create: vi.fn(async ({ data }: any) => data) };
  const transaction = { create: vi.fn(async ({ data }: any) => { txns.push(data); return data; }) };
  const orderItem = { findMany: vi.fn(async () => []) };
  const db: any = { payment, order, orderStatusHistory, transaction, orderItem };
  db.$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(db) : Promise.all(arg)));

  return { db, payments, orders, txns };
}

describe('F-1: createPaymentOrder dedupes the pending payment row', () => {
  beforeEach(() => { isCfg.mockReturnValue(false); createRzp.mockClear(); });

  it('repeated calls return the SAME payment and create only ONE pending row', async () => {
    const { db, payments } = makeDb();
    const svc = createPaymentsService(db);

    const first  = await svc.createPaymentOrder('order_1', 'cust_1');
    const second = await svc.createPaymentOrder('order_1', 'cust_1');
    const third  = await svc.createPaymentOrder('order_1', 'cust_1');

    expect(first.razorpayOrderId).toBeTruthy();
    expect(second.razorpayOrderId).toBe(first.razorpayOrderId);   // same payment
    expect(third.razorpayOrderId).toBe(first.razorpayOrderId);
    expect(db.payment.create).toHaveBeenCalledTimes(1);           // no second create
    expect(payments.filter((p) => p.status === 'pending')).toHaveLength(1);   // exactly one pending row
  });

  it('when POST /orders already created the payment, it reuses that row (no new create)', async () => {
    const { db, payments } = makeDb([{ id: 'p_place', razorpayOrderId: 'order_DEV_place', status: 'pending' }]);
    const svc = createPaymentsService(db);

    const res = await svc.createPaymentOrder('order_1', 'cust_1');

    expect(res.razorpayOrderId).toBe('order_DEV_place');
    expect(db.payment.create).not.toHaveBeenCalled();
    expect(payments).toHaveLength(1);                             // still one row
  });

  it('reuses without calling Razorpay even when the gateway is configured', async () => {
    isCfg.mockReturnValue(true);
    const { db } = makeDb([{ id: 'p_place', razorpayOrderId: 'rzp_order_existing', status: 'pending' }]);
    const svc = createPaymentsService(db);

    const res = await svc.createPaymentOrder('order_1', 'cust_1');

    expect(res.razorpayOrderId).toBe('rzp_order_existing');
    expect(res.isDev).toBe(false);
    expect(createRzp).not.toHaveBeenCalled();                    // no duplicate Razorpay order
    expect(db.payment.create).not.toHaveBeenCalled();
  });
});

describe('F-1: verify flow', () => {
  beforeEach(() => { isCfg.mockReturnValue(false); });

  it('still passes with a SINGLE pending row — order is captured and marked paid', async () => {
    const { db, payments, orders, txns } = makeDb([
      { id: 'p1', razorpayOrderId: 'rzp_order_1', status: 'pending', amountPaise: 28500 },
    ]);
    const svc = createPaymentsService(db);

    const res = await svc.verifyClientPayment('order_1', 'cust_1', 'rzp_order_1', 'pay_rzp_1', 'sig');

    expect(res.success).toBe(true);
    expect(orders.get('order_1').status).toBe('paid');
    const p = payments.find((x) => x.id === 'p1')!;
    expect(p.status).toBe('captured');
    expect(p.razorpayPaymentId).toBe('pay_rzp_1');
    expect(txns.some((t) => t.type === 'customer_payment')).toBe(true);
  });

  it('REGRESSION GUARD: two pending rows (the F-1 condition) break capture with the unique violation', async () => {
    // This is exactly the state the dedup fix prevents. Kept to prove the mock reproduces
    // F-1 and that "one pending row" (above) is what makes verify succeed.
    const { db } = makeDb([
      { id: 'p1', razorpayOrderId: 'rzp_order_1',  status: 'pending' },
      { id: 'p2', razorpayOrderId: 'order_DEV_dup', status: 'pending' },   // the duplicate row
    ]);
    const svc = createPaymentsService(db);

    await expect(
      svc.verifyClientPayment('order_1', 'cust_1', 'rzp_order_1', 'pay_rzp_1', 'sig'),
    ).rejects.toThrow(/Unique constraint failed on the fields: \(`razorpay_payment_id`\)/);
  });
});
