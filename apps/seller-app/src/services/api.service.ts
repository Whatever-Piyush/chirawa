import { StorageService } from './storage.service';
import { DEV_HOST } from '../config/devHost';

const BASE_URL = __DEV__
  ? `http://${DEV_HOST}:3000/api/v1`
  : 'https://api.chirawa.in/api/v1';

// ── Auth callbacks ──────────────────────────────────────────────────────────
// Wired from AuthContext so refresh outcomes propagate into React state.

let onAuthFailure:    (() => void) | null                  = null;
let onTokenRefreshed: ((accessToken: string) => void) | null = null;

export function setAuthFailureHandler(fn: (() => void) | null): void {
  onAuthFailure = fn;
}
export function setTokenRefreshedHandler(
  fn: ((accessToken: string) => void) | null,
): void {
  onTokenRefreshed = fn;
}

// ── Single-flight refresh ───────────────────────────────────────────────────
// Prevents N parallel 401s from triggering N refresh calls.

let isRefreshing = false;
let refreshWaiters: Array<(token: string | null) => void> = [];

async function refreshAccessToken(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise<string | null>((resolve) => refreshWaiters.push(resolve));
  }
  isRefreshing = true;

  try {
    const refreshToken = await StorageService.getRefreshToken();
    if (!refreshToken) return null;

    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;

    const data = await res.json() as {
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
    };

    await StorageService.setTokens(data.tokens);
    onTokenRefreshed?.(data.tokens.accessToken);

    refreshWaiters.forEach((cb) => cb(data.tokens.accessToken));
    refreshWaiters = [];
    return data.tokens.accessToken;
  } catch {
    refreshWaiters.forEach((cb) => cb(null));
    refreshWaiters = [];
    return null;
  } finally {
    isRefreshing = false;
  }
}

// ── Core request: 401 → refresh → retry once ───────────────────────────────

async function request<T>(
  method: string, path: string,
  body?: unknown, token?: string | null,
): Promise<T> {
  const doFetch = (authToken: string | null | undefined): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return fetch(`${BASE_URL}${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch(token);

  // Only attempt refresh for authenticated calls (caller passed a token)
  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      await StorageService.clearTokens();
      onAuthFailure?.();
      throw new Error('Session expired');
    }
    res = await doFetch(newToken);
    if (res.status === 401) {
      // Even the fresh token is rejected — session is truly gone
      await StorageService.clearTokens();
      onAuthFailure?.();
      throw new Error('Session expired');
    }
  }

  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((data['message'] as string) ?? 'Something went wrong');
  return data as T;
}

export const SellerApi = {
  sendOtp:  (phone: string) =>
    request('POST', '/auth/send-otp', { phone }),

  verifyOtp: (phone: string, otp: string) =>
    request<{ tokens: { accessToken: string; refreshToken: string }; requiresPin: boolean }>
    ('POST', '/auth/verify-otp', { phone, otp }),

  setPin: (pin: string, token: string) =>
    request('POST', '/auth/set-pin', { pin, confirmPin: pin }, token),

  // The seller's own shop — authoritative identity + open state (Seller Sprint 0).
  // Resolves from the seller profile, so a new seller with zero orders still gets
  // their shop (fixes the inventory dead-end that inferred shopId from orders[0]).
  getMyShop: (token: string) =>
    request<MyShop>('GET', '/sellers/me/shop', undefined, token),

  // Seller opens / closes their store (flips Shop.isOpen).
  setShopOpen: (isOpen: boolean, token: string) =>
    request<MyShop>('PATCH', '/sellers/me/shop/open', { isOpen }, token),

  getOrders: (token: string) =>
    request<unknown[]>('GET', '/orders', undefined, token),

  acceptOrder: (orderId: string, token: string) =>
    request('POST', `/orders/${orderId}/accept`, {}, token),

  rejectOrder: (orderId: string, reason: string, token: string) =>
    request('POST', `/orders/${orderId}/reject`, { reason }, token),

  markPreparing: (orderId: string, token: string) =>
    request('POST', `/orders/${orderId}/preparing`, {}, token),

  markReady: (orderId: string, token: string) =>
    request('POST', `/orders/${orderId}/ready`, {}, token),

  getShopProducts: (shopId: string, token: string) =>
    request<unknown>('GET', `/catalog/shops/${shopId}`, undefined, token),

  updateStock: (productId: string, stockStatus: string, token: string) =>
    request('PATCH', `/catalog/products/${productId}/stock`, { stockStatus }, token),

  // ── Scan → autocomplete → toggle (Catalog Engine Phase 3) ───────────────────
  // Barcode scan lookup → prefill. Unknown barcode triggers a server-side live
  // OFF lookup that bootstraps a needs_review master.
  getMasterByBarcode: (barcode: string, token: string) =>
    request<MasterLookupResult>('GET', `/catalog/master/${encodeURIComponent(barcode)}`, undefined, token),

  // "I stock this": idempotent upsert keyed by (shopId, barcode). A re-scan
  // updates rather than duplicates — what the offline queue relies on.
  stockThis: (input: StockThisInput, token: string) =>
    request<{ id: string; created: boolean }>('POST', '/catalog/products/stock-this', input, token),

  // Report a wrong product image → re-gates the linked master to needs_review.
  reportProductImage: (productId: string, reason: string | undefined, token: string) =>
    request<{ reported: boolean }>('POST', `/catalog/products/${productId}/report-image`, reason ? { reason } : {}, token),

  // ── Inventory CRUD (Phase 1.1–1.3 / 1.5) — money in paise ────────────────────
  createProduct: (input: ProductInput, token: string) =>
    request<{ id: string }>('POST', '/catalog/products', input, token),

  updateProduct: (productId: string, input: Partial<Omit<ProductInput, 'shopId'>>, token: string) =>
    request<{ id: string }>('PATCH', `/catalog/products/${productId}`, input, token),

  deleteProduct: (productId: string, token: string) =>
    request('DELETE', `/catalog/products/${productId}`, undefined, token),

  setStockQty: (productId: string, stockQty: number, token: string) =>
    request('PATCH', `/catalog/products/${productId}/stock-qty`, { stockQty }, token),

  createCategory: (shopId: string, name: string, token: string) =>
    request<{ id: string; name: string }>('POST', '/catalog/categories', { shopId, name }, token),

  // Bulk CSV import (Phase 1.4). Multipart upload (not the JSON helper). The file
  // object is the React Native FormData shape ({ uri, name, type }).
  importProductsCsv: async (shopId: string, file: { uri: string; name: string }, token: string): Promise<ImportReport> => {
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name || 'products.csv', type: 'text/csv' } as unknown as Blob);
    const res = await fetch(`${BASE_URL}/catalog/products/import?shopId=${encodeURIComponent(shopId)}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` }, // no Content-Type — RN sets the multipart boundary
      body:    form,
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error((data['message'] as string) ?? 'Import fail hua');
    return data as unknown as ImportReport;
  },

  registerDeviceToken: (fcmToken: string, token: string) =>
    request('POST', '/notifications/register-token', { token: fcmToken, platform: 'android' }, token),

  // Seller dashboard (Chunk 8.4 / 8.5)
  getSalesSummary: (token: string) =>
    request<SalesSummary>('GET', '/sellers/me/sales-summary', undefined, token),

  getSettlements: (token: string) =>
    request<SettlementsResponse>('GET', '/sellers/me/settlements', undefined, token),
};

export interface MyShop {
  id: string; name: string; isOpen: boolean; openTime: string; closeTime: string;
}

export interface ProductInput {
  shopId:      string;
  name:        string;
  pricePaise:  number;
  mrpPaise?:   number;
  unit?:       string;
  categoryId?: string;
  stockQty?:   number;
}

// Scan flow (Phase 3).
export interface MasterPrefill {
  id: string; barcode: string; name: string; brand: string | null;
  unit: string | null; mrpPaise: number | null; imageUrl: string | null; status: string;
}
export interface MasterLookupResult {
  found: boolean; source: 'master' | 'off_live' | null; master: MasterPrefill | null;
}
export interface StockThisInput {
  shopId: string; barcode: string; name: string; pricePaise: number;
  masterId?: string; mrpPaise?: number; unit?: string; categoryId?: string;
  stockQty?: number; imageUrl?: string;
}

export interface ImportReport {
  created: number; updated: number; skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

export interface SalesWindow { orders: number; valuePaise: number }
export interface SalesSummary {
  shopName: string;
  today: SalesWindow;
  week:  SalesWindow;
  month: SalesWindow;
  bestSeller: { productName: string; quantity: number } | null;
}
export interface SettlementPeriod {
  id: string; periodDate: string; totalOrders: number;
  totalProductPaise: number; platformFeePaise: number;
  netPayablePaise: number; status: string; paidAt: string | null;
}
export interface SettlementsResponse {
  settlements: SettlementPeriod[];
  current: { orders: number; totalProductPaise: number; platformFeePaise: number; netPayablePaise: number };
}
