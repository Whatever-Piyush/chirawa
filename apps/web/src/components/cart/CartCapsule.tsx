'use client';

import Link from 'next/link';
import { useGuestCart } from '@/context/GuestCartContext';
import { formatPaise } from '@/lib/format';

// Floating cart capsule → /cart. Hidden while the guest cart is empty (and
// during SSR / before hydration). Sits above the mobile bottom nav.
export function CartCapsule() {
  const { count, subtotalPaise, ready } = useGuestCart();
  if (!ready || count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[4.5rem] z-40 flex justify-center px-4 pb-safe md:bottom-4">
      <Link
        href="/cart"
        className="tap-highlight-none pointer-events-auto flex w-full max-w-md animate-pop items-center justify-between gap-3 rounded-full bg-primary px-5 py-3 text-white shadow-glow transition-all duration-300 ease-spring hover:scale-[1.02] hover:bg-primary-dark active:scale-[0.99]"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span
            key={count}
            className="grid h-6 min-w-[1.5rem] animate-pop place-items-center rounded-full bg-white/25 px-1.5 text-xs font-bold tabular-nums"
          >
            {count}
          </span>
          {count === 1 ? '1 आइटम' : `${count} आइटम`}
        </span>
        <span className="flex items-center gap-2 text-sm font-bold">
          {formatPaise(subtotalPaise)}
          <span className="transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden>
            कार्ट देखें →
          </span>
        </span>
      </Link>
    </div>
  );
}
