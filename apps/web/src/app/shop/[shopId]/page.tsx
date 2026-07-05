import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ApiError } from '@chirawa/api-client';
import { publicServerApi } from '@/lib/api/server';
import { catalog, type ShopDetail, type ShopDetailProduct } from '@/lib/catalog-types';
import { ProductTile, type TileProduct } from '@/components/product/ProductTile';
import { ShopCard } from '@/components/home/ShopCard';
import { Section, Rail } from '@/components/home/sections';

// ISR: shop storefronts revalidate every 60s. force-cache keeps the api-client's
// plain fetches cacheable so the page stays static (same idiom as the home page).
export const revalidate = 60;
export const fetchCache = 'force-cache';

type Params = Promise<{ shopId: string }>;

// Shop ids are UUIDs. Reject junk ids up front: a clean 404 instead of
// forwarding arbitrary strings to the backend (whose detail lookup 500s on
// malformed UUIDs).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pre-render every known shop at build time; unknown/new ids render on demand
// (dynamicParams default). Build tolerates a down backend.
export async function generateStaticParams(): Promise<{ shopId: string }[]> {
  try {
    const shops = await catalog.shops(publicServerApi);
    return shops.map((s) => ({ shopId: s.id }));
  } catch {
    return [];
  }
}

// Fetches are memoized per render (same URL, force-cache), so metadata + page
// sharing this helper costs one backend call.
async function fetchShop(shopId: string): Promise<ShopDetail | null> {
  if (!UUID_RE.test(shopId)) return null;
  try {
    return await catalog.shop(publicServerApi, shopId);
  } catch (e) {
    if (e instanceof ApiError && e.statusCode === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { shopId } = await params;
  const shop = await fetchShop(shopId).catch(() => null);
  // Root layout's title template appends "· Bringly".
  if (!shop) return { title: 'दुकान', robots: { index: false } };

  const description =
    shop.description ??
    `${shop.name}, चिरावा से किराना ऑर्डर करें — ${shop.estimatedDeliveryMinutes} मिनट में डिलीवरी, नकद भुगतान।`;
  return {
    title: shop.name,
    description,
    alternates: { canonical: `/shop/${shop.id}` },
    openGraph: { title: `${shop.name} · Bringly`, description, type: 'website' },
  };
}

function visibleProducts(shop: ShopDetail): { category: string; products: ShopDetailProduct[] }[] {
  return [...shop.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      category: c.name,
      products: [...c.products]
        .filter((p) => p.stockStatus !== 'hidden')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((c) => c.products.length > 0);
}

function toTile(p: ShopDetailProduct, shopId: string): TileProduct {
  return {
    productId: p.id,
    name: p.name,
    pricePaise: p.price,
    mrpPaise: p.mrpPaise,
    imageUrl: p.imageUrl,
    unit: p.unit,
    shopId,
    inStock: p.stockStatus === 'available',
  };
}

// Store + ItemList JSON-LD. `<`-escape guards against `</script>` breakout
// from seller-controlled strings (names/descriptions).
function jsonLd(shop: ShopDetail, flat: ShopDetailProduct[]): string {
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'Store',
      name: shop.name,
      ...(shop.description ? { description: shop.description } : {}),
      address: {
        '@type': 'PostalAddress',
        streetAddress: shop.address,
        addressLocality: 'Chirawa',
        addressRegion: 'Rajasthan',
        addressCountry: 'IN',
      },
      geo: { '@type': 'GeoCoordinates', latitude: shop.lat, longitude: shop.lng },
      openingHours: `${shop.openTime}-${shop.closeTime}`,
      ...(shop.rating.average != null && shop.rating.count > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: shop.rating.average,
              reviewCount: shop.rating.count,
            },
          }
        : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: flat.slice(0, 24).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.name,
          url: `/product/${p.id}`,
          ...(p.imageUrl ? { image: p.imageUrl } : {}),
          offers: {
            '@type': 'Offer',
            price: (p.price / 100).toFixed(2),
            priceCurrency: 'INR',
            availability:
              p.stockStatus === 'available'
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
          },
        },
      })),
    },
  ];
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

// Other featured shops as a link rail — the web analogue of the app's two-pane
// shop rail (each rail item is its own indexable ISR page instead of an
// in-place swap).
async function FeaturedShopsRail({ activeShopId }: { activeShopId: string }) {
  let shops: Awaited<ReturnType<typeof catalog.specials>> = [];
  try {
    shops = await catalog.specials(publicServerApi);
  } catch {
    return null;
  }
  const others = shops.filter((s) => s.id !== activeShopId);
  if (others.length === 0) return null;

  return (
    <Section title="दूसरी स्पेशल दुकानें">
      <Rail>
        {others.map((s) => (
          <ShopCard key={s.id} shop={s} featured />
        ))}
      </Rail>
    </Section>
  );
}

export default async function ShopPage({ params }: { params: Params }) {
  const { shopId } = await params;
  const shop = await fetchShop(shopId);
  if (!shop) notFound();

  const grouped = visibleProducts(shop);
  const flat = grouped.flatMap((g) => g.products);

  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 pb-28">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(shop, flat) }}
      />

      {/* Shop header */}
      <section className="rounded-xl border border-hairline bg-surface p-4 shadow-card sm:p-5">
        <div className="flex items-start gap-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-alt">
            {shop.logoUrl ? (
              <Image src={shop.logoUrl} alt={shop.name} fill sizes="64px" className="object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-3xl" aria-hidden>
                🏪
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-heavy leading-tight text-ink">{shop.name}</h1>
            {shop.description ? (
              <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{shop.description}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
              {shop.rating.average != null && shop.rating.count > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded bg-success/10 px-1.5 py-0.5 font-semibold text-success">
                  ★ {shop.rating.average} ({shop.rating.count})
                </span>
              )}
              <span>⏱ {shop.estimatedDeliveryMinutes} मिनट में डिलीवरी</span>
              <span>🕒 {shop.openTime}–{shop.closeTime}</span>
            </div>
            <p className="mt-1 truncate text-xs text-ink-faint">📍 {shop.address}</p>
          </div>
        </div>

        {!shop.isCurrentlyOpen && (
          <div className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm font-semibold text-danger">
            दुकान अभी बंद है — {shop.openTime} से {shop.closeTime} तक खुली रहती है। आप सामान देख
            सकते हैं।
          </div>
        )}
      </section>

      {/* Products, grouped by shop category */}
      {grouped.length === 0 ? (
        <div className="grid place-items-center py-20 text-center">
          <p className="text-4xl" aria-hidden>
            📦
          </p>
          <p className="mt-2 text-sm text-ink-muted">अभी यहाँ कोई सामान नहीं है</p>
        </div>
      ) : (
        grouped.map((group) => (
          <Section key={group.category} title={group.category}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {group.products.map((p) => (
                <ProductTile key={p.id} product={toTile(p, shop.id)} />
              ))}
            </div>
          </Section>
        ))
      )}

      <FeaturedShopsRail activeShopId={shop.id} />
    </div>
  );
}
