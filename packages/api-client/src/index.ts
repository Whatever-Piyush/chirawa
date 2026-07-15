import type {
  AuthTokens,
  SendOtpRequest,
  SendOtpResponse,
  VerifyOtpRequest,
  VerifyOtpResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  CartResponse,
  AddToCartRequest,
  PlaceOrderRequest,
  PlaceOrderResponse,
  VerifyPaymentResponse,
  PricingPreviewRequest,
  PricingPreviewResponse,
  OrderDetailResponse,
  CreateAddressRequest,
  AddressResponse,
  ReverseGeocodeResult,
  PlacePrediction,
  PlaceDetailsResult,
  SearchResponse,
  SearchSuggestResponse,
  SearchFilters,
  LoyaltyResponse,
  MeResponse,
  UpdateMyProfileRequest,
  FoodRestaurantsResponse,
  FoodRestaurantDetail,
  FoodCartView,
  AddFoodCartItemRequest,
  FoodCheckoutPreview,
  PlaceFoodOrderRequest,
  PlaceFoodOrderResponse,
  VerifyFoodPaymentRequest,
  VerifyFoodPaymentResponse,
  FoodOrderSummary,
  FoodOrderDetail,
} from '@chirawa/types';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type TokenStorage = {
  getAccessToken: () => Promise<string | null>;
  getRefreshToken: () => Promise<string | null>;
  setTokens: (tokens: AuthTokens) => Promise<void>;
  clearTokens: () => Promise<void>;
};

// Abort in-flight requests after this long — mobile radios routinely black-hole
// a request without ever erroring, which froze screens awaiting a fetch that
// would never settle.
const REQUEST_TIMEOUT_MS = 15_000;

export class ChirawaApiClient {
  private readonly baseUrl: string;
  private tokenStorage: TokenStorage;
  private isRefreshing = false;
  // Resolved with the new token on refresh success, or null on failure — a
  // failed refresh must still settle every queued request (they previously
  // hung forever because failure dropped the subscribers without resolving).
  private refreshSubscribers: Array<(token: string | null) => void> = [];

  // Invoked once the session is unrecoverable (refresh failed / still 401 after retry).
  // Apps wire this to signOut() so the navigator returns to the login screen.
  public onAuthFailure: (() => void) | null = null;

  constructor(baseUrl: string, tokenStorage: TokenStorage) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.tokenStorage = tokenStorage;
  }

  // ─── Core Request Handler ────────────────────────────────────────────────

  // fetch with an abort timeout. RN's fetch never times out on its own; a
  // black-holed request otherwise leaves the screen waiting forever.
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new ApiError(0, 'Request timed out. Check your connection and try again.', 'NETWORK_TIMEOUT');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    requiresAuth = true,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requiresAuth) {
      const token = await this.tokenStorage.getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, init);

    // Handle 401 — try refresh, then retry original request
    if (response.status === 401 && requiresAuth) {
      const newToken = await this.refreshAccessToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryInit: RequestInit = { method, headers };
        if (body !== undefined) retryInit.body = JSON.stringify(body);
        const retryResponse = await this.fetchWithTimeout(`${this.baseUrl}${path}`, retryInit);
        if (retryResponse.status === 401) {
          // Retry with fresh token still rejected — treat as session expired
          await this.tokenStorage.clearTokens();
          this.onAuthFailure?.();
          throw new ApiError(401, 'Session expired. Please login again.', 'SESSION_EXPIRED');
        }
        return this.parseResponse<T>(retryResponse);
      }
      // Refresh failed — clear tokens, signal the app, throw
      await this.tokenStorage.clearTokens();
      this.onAuthFailure?.();
      throw new ApiError(401, 'Session expired. Please login again.', 'SESSION_EXPIRED');
    }

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    // 204 No Content (e.g. DELETE /cart) — no body to parse
    if (response.status === 204) return undefined as T;

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      // Standard error shape: { success: false, error: { code, message } }.
      // Falls back to legacy top-level { message, code } for safety.
      const errObj =
        data['error'] && typeof data['error'] === 'object'
          ? (data['error'] as Record<string, unknown>)
          : data;
      const message =
        typeof errObj['message'] === 'string' ? errObj['message'] : 'Something went wrong';
      const code = typeof errObj['code'] === 'string' ? errObj['code'] : undefined;
      throw new ApiError(response.status, message, code);
    }

    return data as T;
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (this.isRefreshing) {
      // Queue this request until refresh completes (resolves with null on failure)
      return new Promise((resolve) => {
        this.refreshSubscribers.push(resolve);
      });
    }

    this.isRefreshing = true;

    let newToken: string | null = null;
    try {
      const refreshToken = await this.tokenStorage.getRefreshToken();
      if (refreshToken) {
        const response = await this.request<RefreshTokenResponse>(
          'POST',
          '/auth/refresh',
          { refreshToken } satisfies RefreshTokenRequest,
          false,
        );
        await this.tokenStorage.setTokens(response.tokens);
        newToken = response.tokens.accessToken;
      }
    } catch {
      newToken = null;
    } finally {
      // ALWAYS settle every queued waiter — success or failure — so no request
      // hangs on a failed refresh. Snapshot first: a callback could re-enter.
      const waiters = this.refreshSubscribers;
      this.refreshSubscribers = [];
      this.isRefreshing = false;
      waiters.forEach((cb) => cb(newToken));
    }
    return newToken;
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  async sendOtp(data: SendOtpRequest): Promise<SendOtpResponse> {
    return this.request<SendOtpResponse>('POST', '/auth/send-otp', data, false);
  }

  async verifyOtp(data: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    const response = await this.request<VerifyOtpResponse>('POST', '/auth/verify-otp', data, false);
    await this.tokenStorage.setTokens(response.tokens);
    return response;
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>('POST', '/auth/logout');
    } finally {
      await this.tokenStorage.clearTokens();
    }
  }

  // ─── Catalog ─────────────────────────────────────────────────────────────

  async getShops(): Promise<unknown> {
    return this.request('GET', '/catalog/shops', undefined, false);
  }

  async getShop(shopId: string): Promise<unknown> {
    return this.request('GET', `/catalog/shops/${shopId}`, undefined, false);
  }

  async getProducts(params?: { category?: string; limit?: number }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request('GET', `/catalog/products${suffix}`, undefined, false);
  }

  async getProduct(productId: string): Promise<unknown> {
    return this.request('GET', `/catalog/products/${productId}`, undefined, false);
  }

  // Aggregated "one store" feed — one tile per product at the lowest in-stock
  // price, shop hidden (Catalog Engine Phase 4).
  async getFeed(): Promise<unknown> {
    return this.request('GET', '/catalog/feed', undefined, false);
  }

  // Daily Essentials — the curated everyday top-selling SKUs for Chirawa
  // (TOP_SELLING_SKUS.md): a view over the aggregated feed, ordered by frequency.
  async getDailyEssentials(): Promise<unknown> {
    return this.request('GET', '/catalog/daily-essentials', undefined, false);
  }

  // Chirawa Specials — featured shops shown WITH branding (Catalog Engine Phase
  // 6). Their menu is the existing getShop(shopId).
  async getSpecials(): Promise<unknown> {
    return this.request('GET', '/catalog/specials', undefined, false);
  }

  // Public CC-BY-SA image credits (Open Food Facts attribution, Phase 7).
  async getCredits(): Promise<{ count: number; license: string; data: Array<{ name: string; imageAttribution: string | null }> }> {
    return this.request('GET', '/catalog/credits', undefined, false);
  }

  // "Request this item" demand capture (Phase 6). Auth required; a valid barcode
  // links the matching master so admin demand + restock-notify can group it.
  async requestItem(data: {
    rawText?: string; barcode?: string; masterId?: string;
    pincode?: string; notifyOnRestock?: boolean;
  }): Promise<{ id: string; masterId: string | null; message: string }> {
    return this.request('POST', '/catalog/requests', data);
  }

  async getCategories(): Promise<unknown> {
    return this.request('GET', '/catalog/categories', undefined, false);
  }

  // Bestsellers cluster cards — up to 4 sample product images per category
  // (image-1 design), eggs excluded, no counts. Powers the Home Bestsellers grid.
  async getBestsellers(): Promise<unknown> {
    return this.request('GET', '/catalog/bestsellers', undefined, false);
  }

  // Per-category sample product images (up to 3 each) for the home category tiles
  // (image-2 design). Returns a { [categoryName]: imageUrl[] } map.
  async getCategoryImages(): Promise<unknown> {
    return this.request('GET', '/catalog/category-images', undefined, false);
  }

  // ─── Seller scan → autocomplete → toggle (Catalog Engine Phase 3) ─────────

  // Scan lookup → { found, source, master }. Unknown barcode triggers a one-shot
  // live OFF lookup server-side that bootstraps a needs_review master.
  async getMasterByBarcode(barcode: string): Promise<unknown> {
    return this.request('GET', `/catalog/master/${encodeURIComponent(barcode)}`);
  }

  // "I stock this": idempotent upsert keyed by (shopId, barcode). Re-scanning the
  // same item updates rather than duplicates — safe for the offline-sync queue.
  async stockThis(data: {
    shopId: string; barcode: string; name: string; pricePaise: number;
    masterId?: string; mrpPaise?: number; unit?: string; categoryId?: string;
    stockQty?: number; imageUrl?: string;
  }): Promise<{ id: string; created: boolean }> {
    return this.request('POST', '/catalog/products/stock-this', data);
  }

  // Report a wrong product image → re-gates the linked master to needs_review.
  async reportProductImage(productId: string, reason?: string): Promise<unknown> {
    return this.request('POST', `/catalog/products/${productId}/report-image`, reason ? { reason } : {});
  }

  // Seller-scoped image upload (multipart). Pass a React Native file descriptor
  // ({ uri, name, type }). Server normalizes + re-hosts and returns { url }.
  async uploadProductImage(file: { uri: string; name: string; type: string }): Promise<{ url: string }> {
    const form = new FormData();
    // RN FormData accepts a { uri, name, type } object for file parts.
    form.append('file', file as unknown as Blob);

    const headers: Record<string, string> = {};
    const token = await this.tokenStorage.getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // No Content-Type header — let fetch set the multipart boundary.
    const response = await fetch(`${this.baseUrl}/catalog/upload-image`, { method: 'POST', headers, body: form });
    return this.parseResponse<{ url: string }>(response);
  }

  // ─── Cart ────────────────────────────────────────────────────────────────

  async getCart(): Promise<CartResponse> {
    return this.request<CartResponse>('GET', '/cart');
  }

  async addToCart(data: AddToCartRequest & { variantId?: string }): Promise<CartResponse> {
    return this.request<CartResponse>('POST', '/cart/items', data);
  }

  async updateCartItem(
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<CartResponse> {
    return this.request<CartResponse>('PUT', `/cart/items/${productId}`, {
      quantity,
      ...(variantId ? { variantId } : {}),
    });
  }

  async clearCart(): Promise<void> {
    return this.request<void>('DELETE', '/cart');
  }

  // ─── Delivery tracking ─────────────────────────────────────────────────────

  // Last-known rider location for the live tracking map (initial paint + fallback).
  async getRiderLocation(
    orderId: string,
  ): Promise<{ location: { lat: number; lng: number; ageMs: number } | null }> {
    return this.request('GET', `/delivery/orders/${orderId}/rider-location`);
  }

  // ─── Profile ─────────────────────────────────────────────────────────────

  async getMe(): Promise<MeResponse> {
    return this.request<MeResponse>('GET', '/users/me');
  }

  async updateMyProfile(data: UpdateMyProfileRequest): Promise<MeResponse> {
    return this.request<MeResponse>('PUT', '/users/me', data);
  }

  // ─── Loyalty ─────────────────────────────────────────────────────────────

  async getLoyalty(): Promise<LoyaltyResponse> {
    return this.request<LoyaltyResponse>('GET', '/users/me/loyalty');
  }

  // ─── Addresses ───────────────────────────────────────────────────────────

  async createAddress(data: CreateAddressRequest): Promise<AddressResponse> {
    return this.request<AddressResponse>('POST', '/users/me/addresses', data);
  }

  async updateAddress(id: string, data: Partial<CreateAddressRequest>): Promise<AddressResponse> {
    return this.request<AddressResponse>('PUT', `/users/me/addresses/${id}`, data);
  }

  async getAddresses(): Promise<AddressResponse[]> {
    return this.request<AddressResponse[]>('GET', '/users/me/addresses');
  }

  async deleteAddress(id: string): Promise<void> {
    await this.request<void>('DELETE', `/users/me/addresses/${id}`);
  }

  async setDefaultAddress(id: string): Promise<void> {
    await this.request<{ message: string }>('PATCH', `/users/me/addresses/${id}/default`);
  }

  // Coordinates → cleaned address (Plus-Code-free). The Geocoding key stays on the
  // backend; this just relays lat/lng and receives the parsed result.
  async reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
    return this.request<ReverseGeocodeResult>('POST', '/geo/reverse', { lat, lng });
  }

  // Place search — Chirawa-restricted autocomplete. `sessionToken` (UUID v4) must
  // be the same for a search session's autocomplete calls + its final placeDetails.
  async autocompletePlaces(q: string, sessionToken: string): Promise<PlacePrediction[]> {
    return this.request<PlacePrediction[]>('POST', '/geo/autocomplete', { q, sessionToken });
  }

  // Resolve a chosen prediction → coordinates + a clean (Plus-Code-free) address.
  async placeDetails(placeId: string, sessionToken: string): Promise<PlaceDetailsResult | null> {
    return this.request<PlaceDetailsResult | null>('POST', '/geo/place', { placeId, sessionToken });
  }

  // ─── Pricing ─────────────────────────────────────────────────────────────

  async getPricingPreview(data: PricingPreviewRequest): Promise<PricingPreviewResponse> {
    return this.request<PricingPreviewResponse>('POST', '/pricing/preview', data);
  }

  // ─── Orders ──────────────────────────────────────────────────────────────

  async placeOrder(data: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    return this.request<PlaceOrderResponse>('POST', '/orders', data);
  }

  // Called after the Razorpay checkout sheet returns a successful payment.
  // The server re-verifies the signature before marking the order paid.
  async verifyPayment(
    orderId: string,
    data: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ): Promise<VerifyPaymentResponse> {
    return this.request<VerifyPaymentResponse>('POST', `/payments/verify/${orderId}`, data);
  }

  async cancelOrder(orderId: string, reason?: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      'DELETE',
      `/orders/${orderId}`,
      reason ? { reason } : undefined,
    );
  }

  async getOrder(orderId: string): Promise<OrderDetailResponse> {
    return this.request<OrderDetailResponse>('GET', `/orders/${orderId}`);
  }

  // Unified view of an aggregated order (Catalog Engine Phase 5): combined totals
  // + one status across the per-shop child orders the cart was split into. The
  // groupId comes back on placeOrder's response when the cart spanned >1 shop.
  async getOrderGroup(groupId: string): Promise<{
    groupId: string;
    status: string;
    subtotal: number;
    deliveryFee: number;
    discount: number;
    totalAmount: number;
    orders: Array<{
      id: string;
      shopName: string;
      status: string;
      totalAmount: number;
      items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; subtotal: number }>;
    }>;
  }> {
    return this.request('GET', `/orders/group/${groupId}`);
  }

  async getMyOrders(params?: { page?: number; limit?: number }): Promise<OrderDetailResponse[]> {
    let path = '/orders';
    if (params) {
      const q = new URLSearchParams();
      if (params.page  !== undefined) q.set('page',  String(params.page));
      if (params.limit !== undefined) q.set('limit', String(params.limit));
      const qs = q.toString();
      if (qs) path += `?${qs}`;
    }
    return this.request<OrderDetailResponse[]>('GET', path);
  }

  async rateOrder(orderId: string, rating: number, comment?: string): Promise<void> {
    await this.request<void>(
      'POST',
      `/orders/${orderId}/rating`,
      comment && comment.length > 0 ? { rating, comment } : { rating },
    );
  }

  // Change a placed order's delivery address (allowed only before pickup).
  async updateOrderAddress(orderId: string, addressId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>('PATCH', `/orders/${orderId}/delivery-address`, { addressId });
  }

  // Set/update the receiver's name + phone for a placed order (before pickup).
  async updateOrderReceiver(
    orderId: string, name: string, phone: string,
  ): Promise<{ message: string; receiverName: string; receiverPhone: string }> {
    return this.request<{ message: string; receiverName: string; receiverPhone: string }>(
      'PATCH', `/orders/${orderId}/receiver`, { name, phone },
    );
  }

  // ─── Food Delivery Module (Food.md §7) — isolated /food/* namespace ──────
  // Completely separate from the marketplace cart/orders methods above: the
  // food cart is its own server-side cart, food orders their own pipeline.

  async getFoodRestaurants(): Promise<FoodRestaurantsResponse> {
    return this.request<FoodRestaurantsResponse>('GET', '/food/restaurants', undefined, false);
  }

  async getFoodRestaurant(restaurantId: string): Promise<FoodRestaurantDetail> {
    return this.request<FoodRestaurantDetail>('GET', `/food/restaurants/${restaurantId}`, undefined, false);
  }

  async getFoodCart(): Promise<FoodCartView> {
    return this.request<FoodCartView>('GET', '/food/cart');
  }

  // Throws ApiError with code FOOD_CART_DIFFERENT_RESTAURANT (409) when the
  // cart is bound to another restaurant — the conflict bottom-sheet keys on it.
  async addFoodCartItem(data: AddFoodCartItemRequest): Promise<FoodCartView> {
    return this.request<FoodCartView>('POST', '/food/cart/items', data);
  }

  async updateFoodCartItem(menuItemId: string, quantity: number): Promise<FoodCartView> {
    return this.request<FoodCartView>('PUT', `/food/cart/items/${menuItemId}`, { quantity });
  }

  // [Start New Order] — explicit, user-confirmed clear (never automatic).
  async clearFoodCart(): Promise<void> {
    await this.request<void>('DELETE', '/food/cart');
  }

  async getFoodCheckoutPreview(): Promise<FoodCheckoutPreview> {
    return this.request<FoodCheckoutPreview>('GET', '/food/checkout/preview');
  }

  async placeFoodOrder(data: PlaceFoodOrderRequest): Promise<PlaceFoodOrderResponse> {
    return this.request<PlaceFoodOrderResponse>('POST', '/food/orders', data);
  }

  async verifyFoodPayment(
    foodOrderId: string,
    data: VerifyFoodPaymentRequest,
  ): Promise<VerifyFoodPaymentResponse> {
    return this.request<VerifyFoodPaymentResponse>('POST', `/food/orders/${foodOrderId}/verify-payment`, data);
  }

  async getFoodOrders(params?: { page?: number; limit?: number }): Promise<FoodOrderSummary[]> {
    let path = '/food/orders';
    if (params) {
      const q = new URLSearchParams();
      if (params.page  !== undefined) q.set('page',  String(params.page));
      if (params.limit !== undefined) q.set('limit', String(params.limit));
      const qs = q.toString();
      if (qs) path += `?${qs}`;
    }
    return this.request<FoodOrderSummary[]>('GET', path);
  }

  async getFoodOrder(foodOrderId: string): Promise<FoodOrderDetail> {
    return this.request<FoodOrderDetail>('GET', `/food/orders/${foodOrderId}`);
  }

  async cancelFoodOrder(
    foodOrderId: string,
    reason?: string,
  ): Promise<{ foodOrderId: string; status: string; message: string }> {
    return this.request('DELETE', `/food/orders/${foodOrderId}`, reason ? { reason } : undefined);
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  async search(query: string, filters: SearchFilters = {}): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query, limit: '20' });
    if (filters.category) params.set('category', filters.category);
    if (filters.shopId)   params.set('shopId', filters.shopId);
    if (filters.minPrice != null) params.set('minPrice', String(filters.minPrice));
    if (filters.maxPrice != null) params.set('maxPrice', String(filters.maxPrice));
    if (filters.inStock) params.set('inStock', 'true');
    if (filters.sort && filters.sort !== 'relevance') params.set('sort', filters.sort);
    return this.request<SearchResponse>(
      'GET',
      `/search?${params.toString()}`,
      undefined,
      false, // public endpoint — no auth required
    );
  }

  // Lightweight autocomplete for the search dropdown — tiny payload, Redis-cached.
  async suggest(query: string): Promise<SearchSuggestResponse> {
    const params = new URLSearchParams({ q: query });
    return this.request<SearchSuggestResponse>(
      'GET',
      `/search/suggest?${params.toString()}`,
      undefined,
      false, // public endpoint — no auth required
    );
  }

  // ─── Notifications ───────────────────────────────────────────────────────

  async registerDeviceToken(data: {
    token:     string;
    platform?: 'android' | 'ios';
  }): Promise<void> {
    await this.request<{ message: string }>(
      'POST',
      '/notifications/register-token',
      { token: data.token, platform: data.platform ?? 'android' },
    );
  }

  async unregisterDeviceToken(): Promise<void> {
    await this.request<void>('DELETE', '/notifications/register-token');
  }
}