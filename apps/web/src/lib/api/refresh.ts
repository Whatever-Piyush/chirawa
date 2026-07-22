// Server-side refresh against the backend — shared by the BFF proxy and the
// socket-token route. Never runs in the browser.

const BACKEND_API_BASE = (
  process.env.BACKEND_API_BASE ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');

export const UPSTREAM_TIMEOUT_MS = 15_000;

export interface RotatedTokens {
  accessToken: string;
  refreshToken: string;
}

export async function refreshTokens(refreshToken: string): Promise<RotatedTokens | null> {
  try {
    const r = await fetch(`${BACKEND_API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { tokens?: Partial<RotatedTokens> };
    const t = data.tokens;
    return t?.accessToken && t?.refreshToken
      ? { accessToken: t.accessToken, refreshToken: t.refreshToken }
      : null;
  } catch {
    return null;
  }
}
