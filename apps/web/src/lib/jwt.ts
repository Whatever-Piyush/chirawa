// Decode (NOT verify) a JWT payload. The web tier can't verify signatures (the
// secret lives in the backend) and doesn't need to: these cookies are httpOnly
// and were minted by our own auth routes, and every real API call is verified
// by the backend. This decode only drives UI session state.

export interface JwtSessionClaims {
  sub?: string;
  role?: string;
  exp?: number; // seconds since epoch
}

export function decodeJwtPayload(token: string): JwtSessionClaims | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as JwtSessionClaims;
  } catch {
    return null;
  }
}

export function isExpired(claims: JwtSessionClaims, skewSeconds = 30): boolean {
  return typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
}
