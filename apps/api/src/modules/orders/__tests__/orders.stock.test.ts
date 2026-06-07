import { describe, it, expect, vi } from 'vitest';
import { decrementStockOrThrow } from '../orders.service';
import { BusinessRuleError } from '../../../shared/errors/app-errors';

// Fake transaction client. `decrementCount` controls whether the conditional
// (gte) decrement matched a row (1) or not (0 = untracked or insufficient).
function makeTx(opts: { decrementCount: number; product?: { stockQty: number | null; name: string } | null }) {
  const updateMany = vi.fn(async (args: { data?: { stockQty?: { decrement?: number } } }) => {
    // The decrement call carries data.stockQty.decrement; the status-flip call doesn't.
    if (args.data?.stockQty?.decrement != null) return { count: opts.decrementCount };
    return { count: 0 };
  });
  const findUnique = vi.fn().mockResolvedValue(opts.product ?? null);
  return { tx: { product: { updateMany, findUnique } }, updateMany, findUnique };
}

describe('decrementStockOrThrow (Phase 1.5 oversell protection)', () => {
  it('decrements a tracked product with enough stock and tries the sold-out flip', async () => {
    const { tx, updateMany } = makeTx({ decrementCount: 1 });
    await decrementStockOrThrow(tx as never, [{ productId: 'p1', quantity: 3 }]);

    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'p1', stockQty: { gte: 3 } },
      data:  { stockQty: { decrement: 3 } },
    }));
    // After a successful decrement, flip to out_of_stock IF it hit zero.
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'p1', stockQty: 0 },
      data:  { stockStatus: 'out_of_stock' },
    }));
  });

  it('skips untracked products (stockQty null) without throwing', async () => {
    const { tx, findUnique } = makeTx({ decrementCount: 0, product: { stockQty: null, name: 'Atta' } });
    await expect(decrementStockOrThrow(tx as never, [{ productId: 'p1', quantity: 5 }])).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalled();
  });

  it('rejects the order when a tracked product has insufficient stock', async () => {
    const { tx } = makeTx({ decrementCount: 0, product: { stockQty: 2, name: 'Amul Milk' } });
    await expect(decrementStockOrThrow(tx as never, [{ productId: 'p1', quantity: 5 }]))
      .rejects.toBeInstanceOf(BusinessRuleError);
  });
});
