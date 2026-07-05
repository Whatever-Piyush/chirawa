'use client';

import Link from 'next/link';
import type { SearchResponse, SearchProductResult, SearchShopResult } from '@chirawa/types';
import { ProductTile, type TileProduct } from '@/components/product/ProductTile';

function toTile(p: SearchProductResult): TileProduct {
  return {
    productId: p.id,
    name: p.name,
    pricePaise: p.pricePaise,
    imageUrl: p.imageUrl,
    shopId: p.shopId,
    inStock: p.inStock,
  };
}

function ShopRow({ shop }: { shop: SearchShopResult }) {
  return (
    <Link
      href={`/shop/${shop.id}`}
      className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3"
    >
      <span className="text-xl" aria-hidden>
        🏪
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink">{shop.name}</span>
        <span className="block truncate text-xs text-ink-muted">{shop.address}</span>
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xxs font-bold ${
          shop.isOpen ? 'bg-success-light text-success' : 'bg-danger-light text-danger'
        }`}
      >
        {shop.isOpen ? 'खुला है' : 'बंद है'}
      </span>
    </Link>
  );
}

export function ResultsGrid({ result }: { result: SearchResponse }) {
  const { products, shops, total, query } = result;

  if (products.length === 0 && shops.length === 0) {
    return (
      <div className="grid place-items-center py-20 text-center">
        <p className="text-4xl" aria-hidden>
          😕
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">&lsquo;{query}&rsquo; नहीं मिला</p>
        <Link href="/" className="mt-2 text-sm font-semibold text-primary hover:underline">
          दुकानों में जाकर देखें
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      {shops.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-heavy text-ink">दुकानें</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {shops.map((s) => (
              <ShopRow key={s.id} shop={s} />
            ))}
          </div>
        </section>
      )}

      {products.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-heavy text-ink">
            सामान <span className="text-sm font-medium text-ink-muted">({total} परिणाम)</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {products.map((p) => (
              <ProductTile key={p.id} product={toTile(p)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
