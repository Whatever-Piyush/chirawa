import { browserApi } from '@/lib/api/browser';
import type { GuestCartItem } from '@/lib/cart';

// Replays the guest cart into the server cart after login (plan §4 step 3).
// Per-line and tolerant: an out-of-stock/deleted product must not sink the
// rest. Caller clears the guest cart when at least everything replayable
// merged (failed lines are gone products — nothing to preserve).
export async function replayGuestCart(
  items: GuestCartItem[],
): Promise<{ merged: number; failed: number }> {
  let merged = 0;
  let failed = 0;

  for (const line of items) {
    try {
      await browserApi.addToCart({
        productId: line.productId,
        quantity: line.quantity,
        ...(line.variantId ? { variantId: line.variantId } : {}),
      });
      merged += 1;
    } catch {
      failed += 1;
    }
  }

  // Reconcile: server cart is now the source of truth.
  try {
    await browserApi.getCart();
  } catch {
    // Non-fatal — the cart page refetches anyway.
  }

  return { merged, failed };
}
