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
  PricingPreviewRequest,
  PricingPreviewResponse,
  OrderDetailResponse,
  CreateAddressRequest,
  AddressResponse,
  SearchResponse,
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

export class ChirawaApiClient {
  private readonly baseUrl: string;
  private tokenStorage: TokenStorage;
  private isRefreshing = false;
  private refreshSubscribers: Array<(token: string) => void> = [];

  constructor(baseUrl: string, tokenStorage: TokenStorage) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.tokenStorage = tokenStorage;
  }

  // ─── Core Request Handler ────────────────────────────────────────────────

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

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Handle 401 — try refresh, then retry original request
    if (response.status === 401 && requiresAuth) {
      const newToken = await this.refreshAccessToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryResponse = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return this.parseResponse<T>(retryResponse);
      }
      // Refresh failed — clear tokens, let app handle redirect to login
      await this.tokenStorage.clearTokens();
      throw new ApiError(401, 'Session expired. Please login again.', 'SESSION_EXPIRED');
    }

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    // 204 No Content (e.g. DELETE /cart) — no body to parse
    if (response.status === 204) return undefined as T;

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const message = typeof data['message'] === 'string' ? data['message'] : 'Something went wrong';
      const code = typeof data['code'] === 'string' ? data['code'] : undefined;
      throw new ApiError(response.status, message, code);
    }

    return data as T;
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (this.isRefreshing) {
      // Queue this request until refresh completes
      return new Promise((resolve) => {
        this.refreshSubscribers.push(resolve);
      });
    }

    this.isRefreshing = true;

    try {
      const refreshToken = await this.tokenStorage.getRefreshToken();
      if (!refreshToken) return null;

      const response = await this.request<RefreshTokenResponse>(
        'POST',
        '/auth/refresh',
        { refreshToken } satisfies RefreshTokenRequest,
        false,
      );

      await this.tokenStorage.setTokens(response.tokens);
      this.refreshSubscribers.forEach((cb) => cb(response.tokens.accessToken));
      this.refreshSubscribers = [];
      return response.tokens.accessToken;
    } catch {
      this.refreshSubscribers = [];
      return null;
    } finally {
      this.isRefreshing = false;
    }
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

  // ─── Cart ────────────────────────────────────────────────────────────────

  async getCart(): Promise<CartResponse> {
    return this.request<CartResponse>('GET', '/cart');
  }

  async addToCart(data: AddToCartRequest): Promise<CartResponse> {
    return this.request<CartResponse>('POST', '/cart/items', data);
  }

  async updateCartItem(productId: string, quantity: number): Promise<CartResponse> {
    return this.request<CartResponse>('PUT', `/cart/items/${productId}`, { quantity });
  }

  async clearCart(): Promise<void> {
    return this.request<void>('DELETE', '/cart');
  }

  // ─── Addresses ───────────────────────────────────────────────────────────

  async createAddress(data: CreateAddressRequest): Promise<AddressResponse> {
    return this.request<AddressResponse>('POST', '/users/me/addresses', data);
  }

  async getAddresses(): Promise<AddressResponse[]> {
    return this.request<AddressResponse[]>('GET', '/users/me/addresses');
  }

  // ─── Pricing ─────────────────────────────────────────────────────────────

  async getPricingPreview(data: PricingPreviewRequest): Promise<PricingPreviewResponse> {
    return this.request<PricingPreviewResponse>('POST', '/pricing/preview', data);
  }

  // ─── Orders ──────────────────────────────────────────────────────────────

  async placeOrder(data: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    return this.request<PlaceOrderResponse>('POST', '/orders', data);
  }

  async getOrder(orderId: string): Promise<OrderDetailResponse> {
    return this.request<OrderDetailResponse>('GET', `/orders/${orderId}`);
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

  // ─── Search ──────────────────────────────────────────────────────────────

  async search(query: string): Promise<SearchResponse> {
    return this.request<SearchResponse>(
      'GET',
      `/search?q=${encodeURIComponent(query)}&limit=20`,
      undefined,
      false, // public endpoint — no auth required
    );
  }
}