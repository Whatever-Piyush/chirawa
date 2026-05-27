const DEV_HOST = '192.168.1.4'; // Update to your Mac's LAN IP
const BASE_URL = __DEV__
  ? `http://${DEV_HOST}:3000/api/v1`
  : 'https://api.chirawa.in/api/v1';

async function request<T>(
  method: string, path: string,
  body?: unknown, token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
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

  registerDeviceToken: (fcmToken: string, token: string) =>
    request('POST', '/notifications/register-token', { token: fcmToken, platform: 'android' }, token),
};
