import {
  API_URL,
  createGalenaAuthClient,
  sendSignInCode,
  signOutSession,
  verifySignInCode,
} from '../lib/auth';
import { fetchMe, updateMe } from '../lib/auth-api';
import { createSecureSessionStorage } from './secure-session-storage';
import { createAuthStore, toAuthError, type AuthApi, type AuthError } from './session-store';

const storage = createSecureSessionStorage();

const authClient = createGalenaAuthClient({
  baseURL: API_URL,
  getToken: () => storage.getToken(),
  onToken: (token) => {
    void storage.setToken(token).catch(() => undefined);
  },
});

const api: AuthApi = {
  async sendCode(email, inviteCode) {
    const result = await sendSignInCode(authClient, email, inviteCode);
    return result.error === undefined || result.error === null
      ? {}
      : { error: toAuthError(result.error) };
  },
  async verifyCode(email, otp, inviteCode) {
    const result = await verifySignInCode(authClient, email, otp, inviteCode);
    const error =
      result.error === undefined || result.error === null ? undefined : toAuthError(result.error);
    return {
      ...(error === undefined ? {} : { error }),
      ...(result.token === undefined ? {} : { token: result.token }),
    };
  },
  async signOut() {
    await signOutSession(authClient);
  },
  fetchMe: (token) => fetchMe(API_URL, token),
  updateMe: (token, name) => updateMe(API_URL, token, name),
};

/** The single app-wide session store. Screens read it through `useSession`. */
export const useAuthStore = createAuthStore({ api, storage });

/** Sends a sign-in code through the real server, carrying the invite when present. */
export async function requestSignInCode(
  email: string,
  inviteCode?: string,
): Promise<{ error?: AuthError }> {
  return api.sendCode(email, inviteCode);
}

export interface SessionView {
  me: ReturnType<typeof useAuthStore.getState>['me'];
  loading: boolean;
  status: ReturnType<typeof useAuthStore.getState>['status'];
  signOut: () => Promise<void>;
}

/** The hook the chat screens will use once they move off mock data. */
export function useSession(): SessionView {
  const status = useAuthStore((state) => state.status);
  const me = useAuthStore((state) => state.me);
  const signOut = useAuthStore((state) => state.signOut);
  return { me, loading: status === 'loading', status, signOut };
}
