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
  id:         string;
  name:       string;
  pricePaise: number;
  mrpPaise:   number | null;
  unit:       string | null;
  imageUrl:   string | null;
  inStock:    boolean;
  shopId:     string;
  shopName:   string;
}

export interface ApiCategory {
  name:         string;
  sortOrder:    number;
  productCount: number;
  imageUrl:     string | null;
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

export function toProductCard(p: ApiProduct): ProductCardData {
  return {
    productId:   p.id,
    name:        p.name,
    pricePaise:  p.pricePaise,
    mrpPaise:    p.mrpPaise,
    weightLabel: p.unit,
    imageUrl:    p.imageUrl,
  };
}
