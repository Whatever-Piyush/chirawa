import { StorageService } from './storage.service';

const DEV_HOST = '192.168.1.4'; // Update to your Mac's LAN IP
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

async function request<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  const doFetch = (authToken: string | null | undefined): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  };

  let res = await doFetch(token);

  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      await StorageService.clearTokens();
      onAuthFailure?.();
      throw new Error('Session expired');
    }
    res = await doFetch(newToken);
    if (res.status === 401) {
      await StorageService.clearTokens();
      onAuthFailure?.();
      throw new Error('Session expired');
    }
  }

  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((data['message'] as string) ?? 'Something went wrong');
  return data as T;
}

export const RiderApi = {
  sendOtp:  (phone: string) => request('POST', '/auth/send-otp', { phone }),
  verifyOtp: (phone: string, otp: string) =>
    request<{ tokens: { accessToken: string; refreshToken: string }; requiresPin: boolean }>
    ('POST', '/auth/verify-otp', { phone, otp }),
  setPin: (pin: string, token: string) => request('POST', '/auth/set-pin', { pin, confirmPin: pin }, token),

  setAvailability: (status: 'online' | 'offline', token: string) =>
    request('PATCH', '/delivery/availability', { status }, token),
  getAvailability: (token: string) =>
    request<{ status: string }>('GET', '/delivery/availability', undefined, token),
  getActiveDelivery: (token: string) =>
    request<unknown>('GET', '/delivery/active', undefined, token),
  pickup: (orderId: string, token: string) =>
    request('POST', `/delivery/orders/${orderId}/pickup`, {}, token),
  startDelivery: (orderId: string, token: string) =>
    request('POST', `/delivery/orders/${orderId}/start-delivery`, {}, token),
  collectCod: (orderId: string, amountPaise: number, token: string) =>
    request('POST', `/orders/${orderId}/cod-collected`, { amountPaise }, token),
  getMyOrders: (token: string) =>
    request<unknown[]>('GET', '/orders', undefined, token),

  registerDeviceToken: (fcmToken: string, token: string) =>
    request('POST', '/notifications/register-token', { token: fcmToken, platform: 'android' }, token),
};
