import 'client-only';
import { ChirawaApiClient, type TokenStorage } from '@chirawa/api-client';

// The browser never holds tokens: it talks ONLY to the same-origin BFF, which
// injects the Bearer from the httpOnly cookie and refreshes server-side. So the
// storage is a no-op and the baseUrl points at /api/bff. Same-origin fetch sends
// the httpOnly cookies automatically (credentials default to 'same-origin').
const noopStorage: TokenStorage = {
  getAccessToken: async () => null,
  getRefreshToken: async () => null,
  setTokens: async () => {},
  clearTokens: async () => {},
};

export const browserApi = new ChirawaApiClient('/api/bff', noopStorage);

// When the BFF ultimately returns 401 (server-side refresh failed), send the
// user to login preserving where they were. Task 11/12 refine this (router +
// guest-cart handling); a hard redirect is the safe default for now.
if (typeof window !== 'undefined') {
  browserApi.onAuthFailure = () => {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  };
}
