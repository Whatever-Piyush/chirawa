'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useGuestCart } from '@/context/GuestCartContext';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { StockBadge } from '@/components/product/StockBadge';
import { formatPaise, discountPercent } from '@/lib/format';
import { cartKey } from '@/lib/cart';

// Normalized tile input — home shelves (feed/essentials) and shop/search pages
// all map their data to this shape.
export type TileProduct = {
  productId: string;
  name: string;
  pricePaise: number;
  mrpPaise?: number | null;
  imageUrl: string | null;
  unit?: string | null;
  shopId?: string;
  shopCount?: number; // aggregated feed: "carried by N shops"
  inStock?: boolean; // undefined = assume available (feed tiles are in-stock by construction)
};

// Client island: product tile with an optimistic guest-cart stepper.
// Image + name link to the PDP; the stepper stays outside the link.
export function ProductTile({ product }: { product: TileProduct }) {
  const { quantities, addItem, setQuantity } = useGuestCart();
  const qty = quantities[cartKey(product.productId)] ?? 0;
  const disc = discountPercent(product.pricePaise, product.mrpPaise);
  const outOfStock = product.inStock === false;

  const add = () =>
    addItem({
      productId: product.productId,
      name: product.name,
      imageUrl: product.imageUrl,
      pricePaise: product.pricePaise,
      ...(product.shopId ? { shopId: product.shopId } : {}),
    });

  return (
    <div className="card-lift flex w-full flex-col rounded-2xl border border-hairline bg-surface p-2.5 shadow-card">
      <Link href={`/product/${product.productId}`} className="tap-highlight-none group">
        <div className="relative mb-2 aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-surface-alt to-primary-light/40">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              sizes="144px"
              className="object-contain p-1 transition-transform duration-500 ease-spring group-hover:scale-110"
            />
          ) : (
            <div className="grid h-full place-items-center text-3xl transition-transform duration-500 ease-spring group-hover:scale-110" aria-hidden>
              🛍️
            </div>
          )}
          {disc > 0 && !outOfStock && (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-success px-1.5 py-0.5 text-[10px] font-black tracking-wide text-white shadow-sm">
              {disc}% OFF
            </span>
          )}
          {outOfStock && <StockBadge />}
        </div>

        <p className="line-clamp-2 min-h-[2.5rem] text-xs font-semibold leading-snug text-ink transition-colors group-hover:text-primary">
          {product.name}
        </p>
      </Link>
      {product.unit ? <p className="mt-0.5 text-xs text-ink-faint">{product.unit}</p> : null}
      {product.shopCount && product.shopCount > 1 ? (
        <p className="mt-0.5 text-[10px] text-ink-faint">🏪 {product.shopCount} दुकानों में</p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-1">
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-black text-ink">{formatPaise(product.pricePaise)}</span>
          {disc > 0 && product.mrpPaise != null ? (
            <span className="text-[11px] text-ink-faint line-through">{formatPaise(product.mrpPaise)}</span>
          ) : null}
        </div>
        <QtyStepper
          size="sm"
          quantity={qty}
          onIncrement={add}
          onDecrement={() => setQuantity(product.productId, qty - 1)}
          disabled={outOfStock}
        />
      </div>
    </div>
  );
}
