'use client';

import Link from 'next/link';
import { useGuestCart } from '@/context/GuestCartContext';
import { formatPaise } from '@/lib/format';

// Floating cart capsule → /cart. Hidden while the guest cart is empty (and
// during SSR / before hydration, so there's no flash or hydration mismatch).
export function CartCapsule() {
  const { count, subtotalPaise, ready } = useGuestCart();
  if (!ready || count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <Link
        href="/cart"
        className="flex w-full max-w-md items-center justify-between gap-3 rounded-full bg-primary px-5 py-3 text-white shadow-primary transition-transform hover:scale-[1.01]"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-6 min-w-[1.5rem] place-items-center rounded-full bg-white/25 px-1.5 text-xs tabular-nums">
            {count}
          </span>
          {count === 1 ? '1 आइटम' : `${count} आइटम`}
        </span>
        <span className="flex items-center gap-2 text-sm font-bold">
          {formatPaise(subtotalPaise)}
          <span aria-hidden>कार्ट देखें →</span>
        </span>
      </Link>
    </div>
  );
}
