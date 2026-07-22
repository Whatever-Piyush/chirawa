import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '@chirawa/api-client';
import { publicServerApi } from '@/lib/api/server';
import {
  catalog,
  type ProductDetail,
  type ProductListItem,
  type RelatedProduct,
} from '@/lib/catalog-types';
import { ProductTile, type TileProduct } from '@/components/product/ProductTile';
import { Gallery } from '@/components/product/Gallery';
import { ProductPurchase } from '@/components/product/ProductPurchase';
import { Section } from '@/components/home/sections';

// On-demand ISR: no pre-built params (catalog is large/changing), each PDP is
// rendered on first hit and revalidated every 60s. The purchase island
// re-checks stock/price client-side on top of this.
export const revalidate = 60;
export const fetchCache = 'force-cache';

export function generateStaticParams(): { productId: string }[] {
  return [];
}

type Params = Promise<{ productId: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchProduct(productId: string): Promise<ProductDetail | null> {
  if (!UUID_RE.test(productId)) return null;
  try {
    return await catalog.product(publicServerApi, productId);
  } catch (e) {
    if (e instanceof ApiError && e.statusCode === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { productId } = await params;
  const p = await fetchProduct(productId).catch(() => null);
  // Root layout's title template appends "· Bringly".
  if (!p) return { title: 'प्रोडक्ट', robots: { index: false } };

  const description =
    p.description ??
    `${p.name}${p.unit ? ` (${p.unit})` : ''} — ${p.shopName}, चिरावा से मिनटों में मंगवाएँ। डिलीवरी पर नकद भुगतान।`;
  return {
    title: p.name,
    description,
    alternates: { canonical: `/product/${p.id}` },
    openGraph: {
      title: `${p.name} · Bringly`,
      description,
      type: 'website',
      ...(p.imageUrl ? { images: [p.imageUrl] } : {}),
    },
  };
}

// Attribute chips arrive untyped from the backend (`attributes?: unknown[]`);
// keep only well-formed {label, value} string pairs.
function attrChips(attrs: unknown[] | undefined): { label: string; value: string }[] {
  if (!Array.isArray(attrs)) return [];
  return attrs.filter(
    (a): a is { label: string; value: string } =>
      typeof a === 'object' &&
      a !== null &&
      typeof (a as { label?: unknown }).label === 'string' &&
      typeof (a as { value?: unknown }).value === 'string',
  );
}

function relatedToTile(r: RelatedProduct, shopId: string): TileProduct {
  return {
    productId: r.id,
    name: r.name,
    pricePaise: r.price,
    mrpPaise: r.mrpPaise,
    imageUrl: r.imageUrl,
    unit: r.unit,
    shopId,
    inStock: r.stockStatus === 'available',
  };
}

function listToTile(p: ProductListItem): TileProduct {
  return {
    productId: p.id,
    name: p.name,
    pricePaise: p.pricePaise,
    mrpPaise: p.mrpPaise,
    imageUrl: p.imageUrl,
    unit: p.unit,
    shopId: p.shopId,
    inStock: p.inStock,
  };
}

// Product JSON-LD. `<`-escape guards against `</script>` breakout from
// seller-controlled strings.
function jsonLd(p: ProductDetail): string {
  const images = p.images.length > 0 ? p.images : p.imageUrl ? [p.imageUrl] : [];
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: p.id,
    ...(p.description ? { description: p.description } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    offers: {
      '@type': 'Offer',
      url: `/product/${p.id}`,
      price: (p.price / 100).toFixed(2),
      priceCurrency: 'INR',
      availability:
        p.stockStatus === 'available'
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: p.shopName },
    },
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

// "You might also like" — cross-shop rail (the app fetches products limit 6).
async function AlsoLike({ excludeId }: { excludeId: string }) {
  let items: ProductListItem[] = [];
  try {
    items = await catalog.products(publicServerApi, { limit: 7 });
  } catch {
    return null;
  }
  const tiles = items.filter((p) => p.id !== excludeId).slice(0, 6);
  if (tiles.length === 0) return null;

  return (
    <Section title="ये भी पसंद आ सकता है">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map((p) => (
          <ProductTile key={p.id} product={listToTile(p)} />
        ))}
      </div>
    </Section>
  );
}

export default async function ProductPage({ params }: { params: Params }) {
  const { productId } = await params;
  const product = await fetchProduct(productId);
  if (!product) notFound();

  const images = product.images.length > 0 ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const chips = [
    ...(product.unit ? [{ label: 'मात्रा', value: product.unit }] : []),
    ...attrChips(product.attributes),
  ];

  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 pb-28">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(product) }} />

      <div className="grid gap-6 md:grid-cols-2">
        <Gallery images={images} name={product.name} />

        <div>
          <h1 className="text-xxl font-heavy leading-tight text-ink">{product.name}</h1>
          {product.unit ? <p className="mt-1 text-md text-ink-muted">{product.unit}</p> : null}

          {chips.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {chips.map((c, i) => (
                <div
                  key={`${c.label}-${i}`}
                  className="min-w-24 shrink-0 rounded-lg border border-hairline bg-surface px-3 py-2"
                >
                  <p className="text-xxs text-ink-faint">{c.label}</p>
                  <p className="truncate text-sm font-semibold text-ink">{c.value}</p>
                </div>
              ))}
            </div>
          )}

          <ProductPurchase initial={product} />

          {/* Sold by → shop storefront (web has shop browsing; Task 7) */}
          <Link
            href={`/shop/${product.shopId}`}
            className="mt-5 flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3"
          >
            <span className="text-xl" aria-hidden>
              🏪
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-ink">{product.shopName}</span>
              <span className="block text-xs text-ink-muted">सभी प्रोडक्ट देखें</span>
            </span>
            <span className="text-ink-faint" aria-hidden>
              ›
            </span>
          </Link>

          <div className="mt-3 flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3">
            <span className="text-xl" aria-hidden>
              🔄
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">आसान रिप्लेसमेंट</span>
              <span className="block text-xs text-ink-muted">खराब या गलत आइटम के लिए</span>
            </span>
          </div>

          {product.description ? (
            <div className="mt-5">
              <h2 className="text-lg font-bold text-ink">इस प्रोडक्ट के बारे में</h2>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-muted">
                {product.description}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {product.related.length > 0 && (
        <Section title="मिलते-जुलते प्रोडक्ट">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {product.related.map((r) => (
              <ProductTile key={r.id} product={relatedToTile(r, product.shopId)} />
            ))}
          </div>
        </Section>
      )}

      <AlsoLike excludeId={product.id} />
    </div>
  );
}
