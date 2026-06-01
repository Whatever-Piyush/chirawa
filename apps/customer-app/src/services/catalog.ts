// Thin, typed wrappers over the catalog API + a mapper to ProductCardData.
// Centralizes the shapes used by the home/category surfaces so each section
// doesn't re-cast `unknown` on its own.
import { api } from './api.service';
import type { ProductCardData } from '../components/product/ProductCard';

export interface ApiShop {
  id:                       string;
  name:                     string;
  description:              string | null;
  estimatedDeliveryMinutes: number;
  isCurrentlyOpen:          boolean;
  isFeatured:               boolean;
}

export interface ApiProduct {
  id:          string;
  name:        string;
  pricePaise:  number;
  mrpPaise:    number | null;
  unit:        string | null;
  imageUrl:    string | null;
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
  return {
    productId:   p.id,
    name:        p.name,
    pricePaise:  p.pricePaise,
    mrpPaise:    p.mrpPaise,
    weightLabel: p.unit,
    imageUrl:    p.imageUrl,
    hasVariants: p.hasVariants ?? false,
  };
}
