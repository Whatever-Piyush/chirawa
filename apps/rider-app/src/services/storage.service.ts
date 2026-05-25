import * as SecureStore from 'expo-secure-store';
import type { AuthTokens } from '@chirawa/types';
const KEYS = { ACCESS_TOKEN: 'rider_access_token', REFRESH_TOKEN: 'rider_refresh_token' };
export const StorageService = {
  getAccessToken:  () => SecureStore.getItemAsync(KEYS.ACCESS_TOKEN),
  getRefreshToken: () => SecureStore.getItemAsync(KEYS.REFRESH_TOKEN),
  async setTokens(tokens: AuthTokens) {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.ACCESS_TOKEN,  tokens.accessToken),
      SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, tokens.refreshToken),
    ]);
  },
  async clearTokens() {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
    ]);
  },
};
