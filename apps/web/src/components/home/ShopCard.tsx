import Link from 'next/link';
import Image from 'next/image';
import type { ShopListItem } from '@/lib/catalog-types';

// Shop tile (server) → /shop/[id]. `featured` gives the Chirawa-Special treatment.
export function ShopCard({ shop, featured = false }: { shop: ShopListItem; featured?: boolean }) {
  return (
    <Link
      href={`/shop/${shop.id}`}
      className={`card-lift tap-highlight-none group flex w-44 shrink-0 flex-col rounded-2xl border bg-surface p-3 shadow-card ${
        featured ? 'border-special-border bg-gradient-to-b from-special/60 to-surface' : 'border-hairline'
      }`}
    >
      <div className="relative mb-2.5 aspect-[4/3] overflow-hidden rounded-xl bg-gradient-to-br from-surface-alt to-primary-light/50">
        {shop.logoUrl ? (
          <Image
            src={shop.logoUrl}
            alt={shop.name}
            fill
            sizes="176px"
            className="object-cover transition-transform duration-500 ease-spring group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full place-items-center text-4xl transition-transform duration-500 ease-spring group-hover:scale-110" aria-hidden>
            🏪
          </div>
        )}
        {!shop.isCurrentlyOpen && (
          <span className="absolute inset-0 grid place-items-center bg-ink/55 backdrop-blur-[2px]">
            <span className="rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-danger">
              अभी बंद है
            </span>
          </span>
        )}
        {featured && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-special-accent px-1.5 py-0.5 text-[10px] font-black tracking-wide text-white shadow-sm">
            ★ स्पेशल
          </span>
        )}
      </div>
      <p className="line-clamp-1 text-sm font-bold text-ink transition-colors group-hover:text-primary">
        {shop.name}
      </p>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
        {shop.rating.average != null && (
          <span className="inline-flex items-center gap-0.5 rounded-md bg-success/10 px-1.5 py-0.5 font-bold text-success">
            ★ {shop.rating.average}
          </span>
        )}
        <span className="inline-flex items-center gap-0.5 rounded-md bg-surface-alt px-1.5 py-0.5 font-semibold">
          ⏱ {shop.estimatedDeliveryMinutes} मिनट
        </span>
      </div>
    </Link>
  );
}
