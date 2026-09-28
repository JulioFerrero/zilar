/**
 * Reads the persisted bearer session token for the chat API calls. The
 * `expo-secure-store` import is dynamic so this module can be loaded under
 * Vitest (Node), which cannot import the native module.
 */
export async function getSessionToken(): Promise<string | undefined> {
  const { createSecureSessionStorage } = await import('../auth/secure-session-storage');
  return createSecureSessionStorage().getToken();
}
