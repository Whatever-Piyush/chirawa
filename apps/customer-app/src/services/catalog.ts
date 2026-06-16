// Thin, typed wrappers over the catalog API + a mapper to ProductCardData.
// Centralizes the shapes used by the home/category surfaces so each section
// doesn't re-cast `unknown` on its own.
import { api } from './api.service';
import type { ProductCardData } from '../components/product/ProductCard';

export interface ShopRating {
  average: number | null;
  count:   number;
}

export interface ApiShop {
  id:                       string;
  name:                     string;
  description:              string | null;
  estimatedDeliveryMinutes: number;
  isCurrentlyOpen:          boolean;
  isFeatured:               boolean;
  rating?:                  ShopRating;
}

export interface ApiProduct {
  id:          string;
  name:        string;
  pricePaise:  number;
  mrpPaise:    number | null;
  unit:        string | null;
  imageUrl:    string | null;
  images?:     string[];          // all card images (swipeable carousel)
  inStock:     boolean;
  shopId:      string;
  shopName:    string;
  hasVariants?: boolean;
}

export interface ApiCategory {
  name:         string;
  sortOrder:    number;
  productCount: number;
  imageUrl:     string | null;
}

export interface ApiVariant {
  id:         string;
  name:       string;
  pricePaise: number;
  mrpPaise:   number | null;
  inStock:    boolean;
}

export interface ApiProductDetail {
  id:          string;
  name:        string;
  description: string | null;
  pricePaise:  number;
  mrpPaise:    number | null;
  unit:        string | null;
  inStock:     boolean;
  shopId:      string;
  shopName:    string;
  imageUrl:    string | null;
  images:      string[];
  attributes?: { label: string; value: string }[];   // Shelf Life, Flavour, Type… (added in Phase 3)
  variants:    ApiVariant[];
  related:     ApiProduct[];
}

export async function fetchShops(): Promise<ApiShop[]> {
  const data = await api.getShops();
  return Array.isArray(data) ? (data as ApiShop[]) : [];
}

export async function fetchProducts(params?: { category?: string; limit?: number }): Promise<ApiProduct[]> {
  const data = await api.getProducts(params);
  return Array.isArray(data) ? (data as ApiProduct[]) : [];
}

export async function fetchCategories(): Promise<ApiCategory[]> {
  const data = await api.getCategories();
  return Array.isArray(data) ? (data as ApiCategory[]) : [];
}

// Raw shape from GET /catalog/products/:id (price/stockStatus are raw fields).
interface RawProductDetail {
  id: string; name: string; description: string | null;
  price: number; mrpPaise: number | null; unit: string | null;
  stockStatus: string; shopId: string; shopName: string;
  imageUrl: string | null; images: string[] | null;
  variants: Array<{ id: string; name: string; price: number; mrpPaise: number | null; inStock: boolean }> | null;
  related: Array<{
    id: string; name: string; price: number; mrpPaise: number | null;
    unit: string | null; stockStatus: string; imageUrl: string | null;
  }> | null;
}

export async function fetchProductDetail(productId: string): Promise<ApiProductDetail> {
  const d = (await api.getProduct(productId)) as RawProductDetail;
  return {
    id:          d.id,
    name:        d.name,
    description: d.description,
    pricePaise:  d.price,
    mrpPaise:    d.mrpPaise,
    unit:        d.unit,
    inStock:     d.stockStatus === 'available',
    shopId:      d.shopId,
    shopName:    d.shopName,
    imageUrl:    d.imageUrl,
    images:      d.images ?? [],
    variants: (d.variants ?? []).map((v) => ({
      id:         v.id,
      name:       v.name,
      pricePaise: v.price,
      mrpPaise:   v.mrpPaise,
      inStock:    v.inStock,
    })),
    related: (d.related ?? []).map((r) => ({
      id:         r.id,
      name:       r.name,
      pricePaise: r.price,
      mrpPaise:   r.mrpPaise,
      unit:       r.unit,
      imageUrl:   r.imageUrl,
      inStock:    r.stockStatus === 'available',
      shopId:     d.shopId,
      shopName:   d.shopName,
    })),
  };
}

export function toProductCard(p: ApiProduct): ProductCardData {
  // Prefer the full images array; fall back to the single imageUrl.
  const images = p.images && p.images.length > 0
    ? p.images
    : (p.imageUrl ? [p.imageUrl] : []);
  return {
    productId:   p.id,
    name:        p.name,
    pricePaise:  p.pricePaise,
    mrpPaise:    p.mrpPaise,
    weightLabel: p.unit,
    imageUrl:    p.imageUrl,
    images,
    hasVariants: p.hasVariants ?? false,
  };
}

// ─── Aggregated "one store" feed (Catalog Engine Phase 4) ────────────────────
// GET /catalog/feed returns AggTile[] — one tile per master at the lowest
// in-stock price, shop identity hidden. Each tile maps onto the existing
// ProductCardData so the Home cards need zero new shape. `productId` is the
// cheapest representative SKU; adding it to the cart lets the Phase-5 checkout
// resolver re-route to the concrete lowest-price in-stock shop.
export interface AggTile {
  masterId:   string | null;   // null = passthrough (no approved master)
  productId:  string;          // cheapest representative product → cart
  name:       string;          // canonical (master) name
  imageUrl:   string | null;   // canonical R2 WebP
  pricePaise: number;          // lowest in-stock price among carrying shops
  mrpPaise:   number | null;
  unit:       string | null;
  brand:      string | null;
  shopCount:  number;          // identity hidden, count only
}

// One aggregated tile → a ProductCard. The feed gives a single canonical image,
// so `images` is a 1-length array (the card's carousel dots stay hidden).
export function toFeedCard(t: AggTile): ProductCardData {
  return {
    productId:   t.productId,
    name:        t.name,
    pricePaise:  t.pricePaise,
    mrpPaise:    t.mrpPaise,
    weightLabel: t.unit,
    imageUrl:    t.imageUrl,
    images:      t.imageUrl ? [t.imageUrl] : [],
    hasVariants: false,   // an aggregated tile is a single representative SKU
  };
}

export async function fetchFeed(): Promise<ProductCardData[]> {
  const data = await api.getFeed();
  const tiles = Array.isArray(data) ? (data as AggTile[]) : [];
  return tiles.map(toFeedCard);
}

// Daily Essentials (TOP_SELLING_SKUS.md): the curated everyday top-selling SKUs,
// already ordered + lowest-priced by the backend. Same AggTile → ProductCard map.
export async function fetchDailyEssentials(): Promise<ProductCardData[]> {
  const data = await api.getDailyEssentials();
  const tiles = Array.isArray(data) ? (data as AggTile[]) : [];
  return tiles.map(toFeedCard);
}

// ─── Bestsellers cluster cards (image-1 / 1.md) ──────────────────────────────
// GET /catalog/bestsellers → one entry per category with up to 4 sample product
// image URLs (the 2×2 cluster). Eggs excluded + no counts server-side.
export interface BestsellerCluster {
  name:   string;
  images: string[];   // up to 4 R2 image URLs
}

export async function fetchBestsellers(): Promise<BestsellerCluster[]> {
  const data = await api.getBestsellers();
  return Array.isArray(data) ? (data as BestsellerCluster[]) : [];
}

// Per-category sample images for the home tiles (image-2 / 2.md): a
// { [categoryName]: imageUrl[] } map (up to 3 each). Tolerant of a non-object.
export async function fetchCategoryImages(): Promise<Record<string, string[]>> {
  const data = await api.getCategoryImages();
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, string[]>)
    : {};
}
