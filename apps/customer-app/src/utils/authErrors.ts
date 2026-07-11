import { ApiError } from '@chirawa/api-client';

// Maps a thrown auth-call error to user-facing copy. Transport failures and
// rate limits get localized strings; server business errors keep their own
// message (already written for this audience — attempt counts, lockouts),
// with a localized generic fallback.
export function mapAuthError(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 0 || err.code === 'NETWORK_TIMEOUT') return t('auth.networkError');
    if (err.statusCode === 429) return t('auth.tooManyRequests');
    return err.message || t('common.error');
  }
  // RN fetch rejects with TypeError('Network request failed') when offline.
  if (err instanceof Error && /network request failed/i.test(err.message)) {
    return t('auth.networkError');
  }
  return err instanceof Error && err.message ? err.message : t('common.error');
}
