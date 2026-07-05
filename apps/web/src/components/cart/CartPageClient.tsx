'use client';

import Link from 'next/link';
import { useGuestCart } from '@/context/GuestCartContext';
import { CartLine } from '@/components/cart/CartLine';
import { formatPaise } from '@/lib/format';

// Guest-cart review page. "Proceed" targets /login?next=/checkout while there
// is no session infra; once middleware gating lands (Task 11) this flips to
// /checkout and the middleware owns the redirect.
export function CartPageClient() {
  const { items, ready, count, subtotalPaise, clear } = useGuestCart();

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-6">
        <div className="h-40 animate-pulse rounded-xl bg-surface-alt" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-content place-items-center px-4 py-24 text-center">
        <div>
          <p className="text-5xl" aria-hidden>
            🧺
          </p>
          <h1 className="mt-4 text-xl font-heavy text-ink">आपकी कार्ट खाली है</h1>
          <p className="mt-1 text-sm text-ink-muted">किसी दुकान से आइटम जोड़ें</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
          >
            खरीदारी करें
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 pb-28">
      <div className="mb-3 flex items-end justify-between">
        <h1 className="text-xl font-heavy text-ink">
          आपकी कार्ट <span className="text-sm font-medium text-ink-muted">({count} आइटम)</span>
        </h1>
        <button
          type="button"
          onClick={clear}
          className="text-xs font-semibold text-danger hover:underline"
        >
          कार्ट साफ़ करें
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr,20rem] md:items-start">
        {/* Lines */}
        <div className="rounded-xl border border-hairline bg-surface px-4 py-1 shadow-card">
          {items.map((item) => (
            <CartLine key={`${item.productId}::${item.variantId ?? ''}`} item={item} />
          ))}
        </div>

        {/* Bill */}
        <div className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
          <h2 className="text-md font-bold text-ink">बिल</h2>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">उप-कुल</dt>
              <dd className="font-semibold text-ink">{formatPaise(subtotalPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">डिलीवरी शुल्क</dt>
              <dd className="text-xs text-ink-faint">चेकआउट पर तय होगा</dd>
            </div>
          </dl>
          <div className="mt-3 flex justify-between border-t border-divider pt-3 text-md font-bold text-ink">
            <span>कुल</span>
            <span>{formatPaise(subtotalPaise)}</span>
          </div>

          <Link
            href="/login?next=/checkout"
            className="mt-4 block rounded-xl bg-primary py-3 text-center text-md font-bold text-white shadow-primary transition-colors hover:bg-primary-dark"
          >
            चेकआउट करें
          </Link>
          <p className="mt-2 text-center text-xs text-ink-faint">💵 डिलीवरी पर नकद भुगतान</p>
        </div>
      </div>
    </div>
  );
}
