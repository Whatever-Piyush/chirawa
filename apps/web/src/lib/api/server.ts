import 'server-only';
import { ChirawaApiClient, type TokenStorage } from '@chirawa/api-client';
import { readAuthCookies, writeAuthCookies, clearAuthCookies } from './cookies';

// REST base — INCLUDES /api/v1 (see .env.example / plan §2). Falls back to the
// dev backend origin so RSC public reads work without a .env.local.
export const BACKEND_API_BASE = (
  process.env.BACKEND_API_BASE ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');

// Cookie-backed token storage. Reads the CURRENT request's cookies via
// next/headers; setTokens/clearTokens write them (only valid in a route handler
// / server action — public RSC reads never invoke these).
function cookieTokenStorage(): TokenStorage {
  return {
    getAccessToken: async () => (await readAuthCookies()).accessToken,
    getRefreshToken: async () => (await readAuthCookies()).refreshToken,
    setTokens: async (tokens) => {
      await writeAuthCookies(tokens);
    },
    clearTokens: async () => {
      await clearAuthCookies();
    },
  };
}

/**
 * Request-scoped server api-client. Create fresh per call so it binds to the
 * current request's cookies:
 *   - RSC (public catalog): `await serverApi().getShops()` — no token needed.
 *   - Route handlers (verify-otp/logout): can also mint/rotate cookies.
 */
export function serverApi(): ChirawaApiClient {
  return new ChirawaApiClient(BACKEND_API_BASE, cookieTokenStorage());
}

// Token-free client for PUBLIC catalog/search reads in RSC. It never touches
// cookies(), so pages using it stay statically renderable (ISR). Safe as a
// singleton — it holds no per-request state for public reads.
const noopStorage: TokenStorage = {
  getAccessToken: async () => null,
  getRefreshToken: async () => null,
  setTokens: async () => {},
  clearTokens: async () => {},
};

export const publicServerApi = new ChirawaApiClient(BACKEND_API_BASE, noopStorage);
