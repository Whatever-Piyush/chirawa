import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { publicServerApi } from '@/lib/api/server';
import { catalog, type FeedTile } from '@/lib/catalog-types';
import { ProductTile, type TileProduct } from '@/components/product/ProductTile';
import { ShopCard } from '@/components/home/ShopCard';
import { Reveal } from '@/components/ui/Reveal';
import { RailScroller } from '@/components/ui/RailScroller';

// ─── Layout helpers (also reused by shop/product pages) ─────────────────────
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Reveal>
      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-2">
          <h2 className="flex items-center gap-2.5 text-xl font-heavy tracking-tight text-ink">
            <span className="h-6 w-1.5 rounded-full bg-brand-gradient" aria-hidden />
            {title}
          </h2>
          {action}
        </div>
        {children}
      </section>
    </Reveal>
  );
}

export function Rail({ children }: { children: ReactNode }) {
  return <RailScroller>{children}</RailScroller>;
}

function tileFromFeed(t: FeedTile): TileProduct {
  return {
    productId: t.productId,
    name: t.name,
    pricePaise: t.pricePaise,
    mrpPaise: t.mrpPaise,
    imageUrl: t.imageUrl,
    unit: t.unit,
    shopCount: t.shopCount,
  };
}

// ─── Category grid (getCategories + getCategoryImages) ──────────────────────
export async function CategoryGrid() {
  let categories: Awaited<ReturnType<typeof catalog.categories>> = [];
  let images: Record<string, string[]> = {};
  try {
    [categories, images] = await Promise.all([
      catalog.categories(publicServerApi),
      catalog.categoryImages(publicServerApi),
    ]);
  } catch {
    return null;
  }
  if (categories.length === 0) return null;

  return (
    <Section title="श्रेणियाँ">
      <div id="categories" className="grid grid-cols-4 gap-x-3 gap-y-4 sm:grid-cols-6 lg:grid-cols-8">
        {categories.map((c) => {
          const img = images[c.name]?.[0] ?? c.imageUrl;
          return (
            <Link
              key={c.name}
              href={`/search?category=${encodeURIComponent(c.name)}`}
              className="tap-highlight-none group flex flex-col items-center gap-2"
            >
              <div className="relative h-16 w-16 overflow-hidden rounded-full bg-gradient-to-br from-primary-light to-special ring-2 ring-transparent transition-all duration-300 ease-spring group-hover:-translate-y-1 group-hover:shadow-lift group-hover:ring-primary/60 sm:h-20 sm:w-20">
                {img ? (
                  <Image
                    src={img}
                    alt={c.name}
                    fill
                    sizes="(min-width: 640px) 80px, 64px"
                    className="object-cover transition-transform duration-500 ease-spring group-hover:scale-110"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-2xl" aria-hidden>
                    🛒
                  </div>
                )}
              </div>
              <span className="line-clamp-2 text-center text-xs font-semibold text-ink transition-colors group-hover:text-primary">
                {c.name}
              </span>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Daily Essentials (getDailyEssentials) ──────────────────────────────────
export async function DailyEssentials() {
  let tiles: FeedTile[] = [];
  try {
    tiles = await catalog.dailyEssentials(publicServerApi);
  } catch {
    return null;
  }
  if (tiles.length === 0) return null;

  return (
    <Section title="रोज़मर्रा का सामान">
      <Rail>
        {tiles.map((t) => (
          <div key={t.productId} className="w-36 shrink-0">
            <ProductTile product={tileFromFeed(t)} />
          </div>
        ))}
      </Rail>
    </Section>
  );
}

// ─── Nearby shops (getShops) ────────────────────────────────────────────────
export async function NearbyShops() {
  let shops: Awaited<ReturnType<typeof catalog.shops>> = [];
  try {
    shops = await catalog.shops(publicServerApi);
  } catch {
    return null;
  }
  if (shops.length === 0) return null;

  return (
    <Section title="आस-पास की दुकानें">
      <Rail>
        {shops.map((s) => (
          <ShopCard key={s.id} shop={s} />
        ))}
      </Rail>
    </Section>
  );
}

// ─── Chirawa Specials (getSpecials — featured shops, WITH branding) ─────────
export async function ChirawaSpecials() {
  let shops: Awaited<ReturnType<typeof catalog.specials>> = [];
  try {
    shops = await catalog.specials(publicServerApi);
  } catch {
    return null;
  }
  if (shops.length === 0) return null;

  return (
    <Section title="चिरावा स्पेशल">
      <Rail>
        {shops.map((s) => (
          <ShopCard key={s.id} shop={s} featured />
        ))}
      </Rail>
    </Section>
  );
}

// ─── Bestsellers (getBestsellers — category cluster cards) ──────────────────
export async function Bestsellers() {
  let clusters: Awaited<ReturnType<typeof catalog.bestsellers>> = [];
  try {
    clusters = await catalog.bestsellers(publicServerApi);
  } catch {
    return null;
  }
  if (clusters.length === 0) return null;

  return (
    <Section title="बेस्टसेलर">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {clusters.map((cluster) => (
          <Link
            key={cluster.name}
            href={`/search?category=${encodeURIComponent(cluster.name)}`}
            className="card-lift tap-highlight-none group rounded-xl border border-hairline bg-surface p-3 shadow-card"
          >
            <div className="grid grid-cols-2 gap-1.5">
              {cluster.images.slice(0, 4).map((url, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-lg bg-surface-alt">
                  <Image
                    src={url}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-contain transition-transform duration-500 ease-spring group-hover:scale-105"
                  />
                </div>
              ))}
            </div>
            <p className="mt-2.5 flex items-center justify-between text-sm font-bold text-ink">
              {cluster.name}
              <span className="text-ink-faint transition-transform duration-300 group-hover:translate-x-1 group-hover:text-primary" aria-hidden>
                →
              </span>
            </p>
          </Link>
        ))}
      </div>
    </Section>
  );
}

// ─── For-You feed (getFeed — aggregated "one store" tiles) ──────────────────
export async function ForYouFeed() {
  let tiles: FeedTile[] = [];
  try {
    tiles = await catalog.feed(publicServerApi);
  } catch {
    return null;
  }
  if (tiles.length === 0) return null;

  return (
    <Section title="आपके लिए">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {tiles.slice(0, 24).map((t) => (
          <div key={t.productId} className="w-full">
            <ProductTile product={tileFromFeed(t)} />
          </div>
        ))}
      </div>
    </Section>
  );
}
