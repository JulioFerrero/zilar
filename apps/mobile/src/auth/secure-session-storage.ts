import * as SecureStore from 'expo-secure-store';

import type { SessionStorage } from './session-storage';

/** SecureStore key. One session token per install, cleared on sign-out. */
export const SESSION_TOKEN_KEY = 'zilar.session-token';

/**
 * The session token lives in the OS keychain/keystore via SecureStore, never in
 * plain AsyncStorage, which is unencrypted and readable by other apps' backups.
 */
export function createSecureSessionStorage(): SessionStorage {
  return {
    async getToken() {
      const value = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
      return value === null || value === '' ? undefined : value;
    },
    async setToken(token) {
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
    },
    async clearToken() {
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    },
  };
}
