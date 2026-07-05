import Link from 'next/link';
import Image from 'next/image';
import type { ShopListItem } from '@/lib/catalog-types';

// Shop tile (server) → /shop/[id]. `featured` gives the Chirawa-Special treatment.
export function ShopCard({ shop, featured = false }: { shop: ShopListItem; featured?: boolean }) {
  return (
    <Link
      href={`/shop/${shop.id}`}
      className={`flex w-44 shrink-0 flex-col rounded-lg border bg-surface p-3 shadow-card ${
        featured ? 'border-special-border' : 'border-hairline'
      }`}
    >
      <div className="relative mb-2 aspect-[4/3] overflow-hidden rounded-md bg-surface-alt">
        {shop.logoUrl ? (
          <Image src={shop.logoUrl} alt={shop.name} fill sizes="176px" className="object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-3xl" aria-hidden>
            🏪
          </div>
        )}
        {!shop.isCurrentlyOpen && (
          <span className="absolute inset-0 grid place-items-center bg-black/50 text-xs font-bold text-white">
            बंद है
          </span>
        )}
        {featured && (
          <span className="absolute left-1 top-1 rounded-full bg-special-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
            स्पेशल
          </span>
        )}
      </div>
      <p className="line-clamp-1 text-sm font-bold text-ink">{shop.name}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
        {shop.rating.average != null && (
          <span className="inline-flex items-center gap-0.5 rounded bg-success/10 px-1 font-semibold text-success">
            ★ {shop.rating.average}
          </span>
        )}
        <span>{shop.estimatedDeliveryMinutes} मिनट</span>
      </div>
    </Link>
  );
}
