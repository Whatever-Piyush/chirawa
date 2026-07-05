'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { browserApi } from '@/lib/api/browser';
import { catalog, type ProductDetail } from '@/lib/catalog-types';
import { useGuestCart } from '@/context/GuestCartContext';
import { cartKey } from '@/lib/cart';
import { formatPaise } from '@/lib/format';
import { PriceBlock } from '@/components/product/PriceBlock';

// Purchase island: variant selection + guest-cart control. The ISR page can be
// up to 60s stale, so this re-checks stock/price on mount (SSR data as
// initialData → no flash) and the UI follows the fresh values.
export function ProductPurchase({ initial }: { initial: ProductDetail }) {
  const { quantities, addItem, setQuantity } = useGuestCart();
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(
    initial.variants[0]?.id,
  );

  const { data } = useQuery({
    queryKey: ['product', initial.id],
    queryFn: () => catalog.product(browserApi, initial.id),
    initialData: initial,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const detail = data ?? initial;

  const variant = detail.variants.find((v) => v.id === selectedVariantId);
  const effPrice = variant ? variant.price : detail.price;
  const effMrp = variant ? variant.mrpPaise : detail.mrpPaise;
  const effInStock = variant ? variant.inStock : detail.stockStatus === 'available';

  const qty = quantities[cartKey(detail.id, selectedVariantId)] ?? 0;
  const add = () =>
    addItem({
      productId: detail.id,
      name: detail.name,
      imageUrl: detail.imageUrl,
      pricePaise: effPrice,
      shopId: detail.shopId,
      ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
    });

  return (
    <div className="mt-3">
      <span
        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
          effInStock ? 'bg-success-light text-success' : 'bg-danger-light text-danger'
        }`}
      >
        {effInStock ? 'स्टॉक में है' : 'स्टॉक में नहीं'}
      </span>

      {detail.variants.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {detail.variants.map((v) => {
            const sel = v.id === selectedVariantId;
            return (
              <button
                key={v.id}
                type="button"
                disabled={!v.inStock}
                onClick={() => setSelectedVariantId(v.id)}
                className={`tap-highlight-none rounded-xl border-2 px-3.5 py-2 text-sm font-semibold transition-all duration-200 ease-spring active:scale-95 ${
                  sel
                    ? 'scale-[1.03] border-primary bg-primary-light text-primary shadow-card'
                    : 'border-hairline bg-surface text-ink-muted hover:border-primary/50'
                } disabled:opacity-40`}
              >
                {v.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <PriceBlock pricePaise={effPrice} mrpPaise={effMrp} />
      </div>

      <div className="mt-4">
        {!effInStock ? (
          <div className="grid h-12 w-full place-items-center rounded-xl bg-ink-faint/40 text-md font-bold text-white">
            स्टॉक में नहीं
          </div>
        ) : qty > 0 ? (
          <div className="flex h-12 w-full items-center justify-between rounded-xl bg-primary px-2 font-bold text-white">
            <button
              type="button"
              onClick={() => setQuantity(detail.id, qty - 1, selectedVariantId)}
              aria-label="कम करें"
              className="grid h-full w-12 place-items-center text-xl"
            >
              −
            </button>
            <span className="text-lg tabular-nums">{qty}</span>
            <button
              type="button"
              onClick={add}
              aria-label="और जोड़ें"
              className="grid h-full w-12 place-items-center text-xl"
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={add}
            className="tap-highlight-none h-12 w-full rounded-xl bg-primary text-md font-bold text-white shadow-primary transition-all duration-300 ease-spring hover:bg-primary-dark hover:shadow-glow active:scale-[0.98]"
          >
            🧺 कार्ट में डालें · {formatPaise(effPrice)}
          </button>
        )}
      </div>
    </div>
  );
}
