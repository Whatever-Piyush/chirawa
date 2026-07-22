'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { GuestCartItem } from '@/lib/cart';
import { useGuestCart } from '@/context/GuestCartContext';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { formatPaise } from '@/lib/format';

// One guest-cart line: image + name link to the PDP, stepper, line total, remove.
export function CartLine({ item }: { item: GuestCartItem }) {
  const { addItem, setQuantity, removeItem } = useGuestCart();

  const bump = () =>
    addItem({
      productId: item.productId,
      name: item.name,
      imageUrl: item.imageUrl,
      pricePaise: item.pricePaise,
      ...(item.variantId ? { variantId: item.variantId } : {}),
      ...(item.shopId ? { shopId: item.shopId } : {}),
    });

  return (
    <div className="flex items-center gap-3 border-b border-divider py-3 last:border-b-0">
      <Link
        href={`/product/${item.productId}`}
        className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-hairline bg-surface-alt"
      >
        {item.imageUrl ? (
          <Image src={item.imageUrl} alt={item.name} fill sizes="64px" className="object-contain p-1" />
        ) : (
          <span className="grid h-full place-items-center text-2xl" aria-hidden>
            🛍️
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={`/product/${item.productId}`} className="line-clamp-2 text-sm font-semibold text-ink">
          {item.name}
        </Link>
        <p className="mt-0.5 text-xs text-ink-muted">{formatPaise(item.pricePaise)}</p>
        <button
          type="button"
          onClick={() => removeItem(item.productId, item.variantId)}
          className="mt-1 text-xs font-semibold text-danger hover:underline"
        >
          हटाएं
        </button>
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <QtyStepper
          size="sm"
          quantity={item.quantity}
          onIncrement={bump}
          onDecrement={() => setQuantity(item.productId, item.quantity - 1, item.variantId)}
        />
        <span className="text-sm font-bold text-ink">
          {formatPaise(item.quantity * item.pricePaise)}
        </span>
      </div>
    </div>
  );
}
