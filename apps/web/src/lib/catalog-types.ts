import type { ChirawaApiClient } from '@chirawa/api-client';

// Typed shapes for the catalog list/detail endpoints, which the api-client
// returns as `unknown` (no DTOs yet — plan §2). Ported verbatim from the backend
// response builders in apps/api/src/modules/catalog/{catalog,aggregation}.service.ts.
//
// NOTE: field names differ per endpoint (matching the backend): getShop products
// use `price` (paise), getProducts uses `pricePaise`, getProductDetail uses `price`.
// This file has NO runtime imports (type-only) so it's safe in server + client.

export type StockStatus = 'available' | 'out_of_stock' | 'hidden';

export interface ShopRating {
  average: number | null;
  count: number;
}

// GET /catalog/shops (and /catalog/specials → the isFeatured subset)
export interface ShopListItem {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  openTime: string;
  closeTime: string;
  isOpen: boolean;
  isFeatured: boolean;
  estimatedDeliveryMinutes: number;
  address: string;
  lat: number;
  lng: number;
  isCurrentlyOpen: boolean;
  rating: ShopRating;
}

// GET /catalog/shops/:id
export interface ShopDetailProduct {
  id: string;
  name: string;
  description: string | null;
  price: number; // paise
  mrpPaise: number | null;
  unit: string;
  stockStatus: StockStatus;
  imageUrl: string | null;
  sortOrder: number;
}
export interface ShopDetailCategory {
  id: string;
  name: string;
  sortOrder: number;
  products: ShopDetailProduct[];
}
export interface ShopDetail {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  address: string;
  lat: number;
  lng: number;
  isCurrentlyOpen: boolean;
  openTime: string;
  closeTime: string;
  estimatedDeliveryMinutes: number;
  rating: ShopRating;
  categories: ShopDetailCategory[];
}

// GET /catalog/products
export interface ProductListItem {
  id: string;
  name: string;
  pricePaise: number;
  mrpPaise: number | null;
  unit: string;
  stockStatus: StockStatus;
  inStock: boolean;
  hasVariants: boolean;
  imageUrl: string | null;
  images: string[];
  shopId: string;
  shopName: string;
}

// GET /catalog/products/:id
export interface ProductVariant {
  id: string;
  name: string;
  price: number; // paise
  mrpPaise: number | null;
  inStock: boolean;
}
export interface RelatedProduct {
  id: string;
  name: string;
  price: number; // paise
  mrpPaise: number | null;
  unit: string;
  stockStatus: StockStatus;
  imageUrl: string | null;
}
export interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  price: number; // paise
  mrpPaise: number | null;
  unit: string;
  stockStatus: StockStatus;
  shopId: string;
  shopName: string;
  imageUrl: string | null;
  images: string[];
  attributes?: unknown[];
  variants: ProductVariant[];
  related: RelatedProduct[];
}

// GET /catalog/feed and /catalog/daily-essentials (aggregated "one store" tiles)
export interface FeedTile {
  masterId: string | null;
  productId: string; // representative (cheapest in-stock) product
  name: string;
  imageUrl: string | null;
  pricePaise: number;
  mrpPaise: number | null;
  unit: string | null;
  brand: string | null;
  shopCount: number;
}
export type EssentialTile = FeedTile;

// GET /catalog/categories
export interface CategorySummary {
  name: string;
  sortOrder: number;
  productCount: number;
  imageUrl: string | null;
}

// GET /catalog/bestsellers
export interface BestsellerCluster {
  name: string;
  images: string[];
}

// GET /catalog/category-images → { [categoryName]: url[] }
export type CategoryImageMap = Record<string, string[]>;

// ─── Typed catalog reads ────────────────────────────────────────────────────
// Dependency-injected so the same helpers serve both sides: pass serverApi()
// (RSC) or browserApi (client). Applies the shapes above to the api-client's
// `unknown` returns. `ChirawaApiClient` is a type-only import (erased at runtime).
export const catalog = {
  shops: async (api: ChirawaApiClient): Promise<ShopListItem[]> =>
    (await api.getShops()) as ShopListItem[],
  specials: async (api: ChirawaApiClient): Promise<ShopListItem[]> =>
    (await api.getSpecials()) as ShopListItem[],
  shop: async (api: ChirawaApiClient, id: string): Promise<ShopDetail> =>
    (await api.getShop(id)) as ShopDetail,
  products: async (
    api: ChirawaApiClient,
    opts?: { category?: string; limit?: number },
  ): Promise<ProductListItem[]> => (await api.getProducts(opts)) as ProductListItem[],
  product: async (api: ChirawaApiClient, id: string): Promise<ProductDetail> =>
    (await api.getProduct(id)) as ProductDetail,
  feed: async (api: ChirawaApiClient): Promise<FeedTile[]> =>
    (await api.getFeed()) as FeedTile[],
  dailyEssentials: async (api: ChirawaApiClient): Promise<EssentialTile[]> =>
    (await api.getDailyEssentials()) as EssentialTile[],
  categories: async (api: ChirawaApiClient): Promise<CategorySummary[]> =>
    (await api.getCategories()) as CategorySummary[],
  bestsellers: async (api: ChirawaApiClient): Promise<BestsellerCluster[]> =>
    (await api.getBestsellers()) as BestsellerCluster[],
  categoryImages: async (api: ChirawaApiClient): Promise<CategoryImageMap> =>
    (await api.getCategoryImages()) as CategoryImageMap,
} as const;
