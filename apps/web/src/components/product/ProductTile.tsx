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
    <div className="flex w-full flex-col rounded-lg border border-hairline bg-surface p-2.5 shadow-card">
      <Link href={`/product/${product.productId}`} className="group">
        <div className="relative mb-2 aspect-square overflow-hidden rounded-md bg-surface-alt">
          {product.imageUrl ? (
            <Image src={product.imageUrl} alt={product.name} fill sizes="144px" className="object-contain" />
          ) : (
            <div className="grid h-full place-items-center text-3xl" aria-hidden>
              🛍️
            </div>
          )}
          {disc > 0 && !outOfStock && (
            <span className="absolute left-1 top-1 rounded-full bg-success px-1.5 py-0.5 text-[10px] font-bold text-white">
              {disc}% OFF
            </span>
          )}
          {outOfStock && <StockBadge />}
        </div>

        <p className="line-clamp-2 min-h-[2.5rem] text-xs font-semibold text-ink group-hover:text-primary">
          {product.name}
        </p>
      </Link>
      {product.unit ? <p className="mt-0.5 text-xs text-ink-faint">{product.unit}</p> : null}
      {product.shopCount && product.shopCount > 1 ? (
        <p className="mt-0.5 text-[10px] text-ink-faint">{product.shopCount} दुकानों में</p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-1">
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold text-ink">{formatPaise(product.pricePaise)}</span>
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
