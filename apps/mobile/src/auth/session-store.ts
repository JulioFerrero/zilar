import { createBoundStore, type UseBoundStore } from '../store/atomStore';

import type { Me } from '../lib/auth-api';
import type { SessionStorage } from './session-storage';

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

/** A normalized auth failure, so screens don't depend on the client's error type. */
export interface AuthError {
  code?: string;
  message?: string;
  status?: number;
}

/** The network calls the session store needs. Injected so tests use fakes. */
export interface AuthApi {
  sendCode(email: string, inviteCode?: string): Promise<{ error?: AuthError }>;
  verifyCode(
    email: string,
    otp: string,
    inviteCode?: string,
  ): Promise<{ error?: AuthError; token?: string }>;
  signOut(): Promise<void>;
  fetchMe(token: string): Promise<Me>;
  updateMe(token: string, name: string): Promise<Me>;
}

export interface SignInInput {
  email: string;
  otp: string;
  inviteCode?: string;
}

export type SignInOutcome = { ok: true; me: Me } | { ok: false; error: AuthError };

export interface AuthStore {
  status: AuthStatus;
  me: Me | null;
  /** Restores a persisted session on start; no token means guest. */
  bootstrap(): Promise<void>;
  /** Verifies the code, persists the token and loads the profile. */
  signIn(input: SignInInput): Promise<SignInOutcome>;
  /** Saves the display name through `PATCH /api/me`. */
  setName(name: string): Promise<{ ok: boolean; error?: AuthError }>;
  /** Ends the remote session and clears the stored token. */
  signOut(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Maps any thrown value or client error into the small `AuthError` shape. */
export function toAuthError(error: unknown): AuthError {
  if (!isRecord(error)) {
    return {};
  }
  const result: AuthError = {};
  if (typeof error['code'] === 'string') result.code = error['code'];
  if (typeof error['message'] === 'string') result.message = error['message'];
  if (typeof error['status'] === 'number') result.status = error['status'];
  return result;
}

function isUnauthorized(error: unknown): boolean {
  return isRecord(error) && error['status'] === 401;
}

export function createAuthStore(deps: {
  api: AuthApi;
  storage: SessionStorage;
}): UseBoundStore<AuthStore> {
  const { api, storage } = deps;

  return createBoundStore<AuthStore>((set) => ({
    status: 'loading',
    me: null,

    async bootstrap() {
      let token: string | undefined;
      try {
        token = await storage.getToken();
      } catch {
        token = undefined;
      }
      if (token === undefined) {
        set({ status: 'guest', me: null });
        return;
      }
      try {
        const me = await api.fetchMe(token);
        set({ status: 'authenticated', me });
      } catch (error) {
        if (isUnauthorized(error)) {
          await storage.clearToken().catch(() => undefined);
        }
        set({ status: 'guest', me: null });
      }
    },

    async signIn(input) {
      const result = await api.verifyCode(input.email, input.otp, input.inviteCode);
      if (result.error !== undefined || result.token === undefined) {
        return { ok: false, error: result.error ?? { code: 'missing_token' } };
      }
      await storage.setToken(result.token);
      try {
        const me = await api.fetchMe(result.token);
        set({ status: 'authenticated', me });
        return { ok: true, me };
      } catch (error) {
        await storage.clearToken().catch(() => undefined);
        return { ok: false, error: toAuthError(error) };
      }
    },

    async setName(name) {
      const token = await storage.getToken();
      if (token === undefined) {
        return { ok: false, error: { code: 'unauthorized' } };
      }
      try {
        const me = await api.updateMe(token, name);
        set({ me });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: toAuthError(error) };
      }
    },

    async signOut() {
      try {
        await api.signOut();
      } catch {
        // Signing out locally must always succeed, even when offline.
      } finally {
        await storage.clearToken().catch(() => undefined);
        set({ status: 'guest', me: null });
      }
    },
  }));
}
