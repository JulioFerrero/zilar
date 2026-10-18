import { Effect } from 'effect';
import type { SuccessContext } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const INVITE_HEADER = 'x-zilar-invite';

/** Better Auth's bearer plugin exposes the session token in this response header. */
export const SET_AUTH_TOKEN_HEADER = 'set-auth-token';

export const DEFAULT_API_URL = 'http://127.0.0.1:3188';

export function resolveApiUrl(env: Record<string, string | undefined>): string {
  const value = env['EXPO_PUBLIC_ZILAR_API_URL'];
  return typeof value === 'string' && value !== '' ? value : DEFAULT_API_URL;
}

// Its own `process.env.EXPO_PUBLIC_*` expression, so babel-preset-expo inlines it at Metro time.
export const API_URL = resolveApiUrl({
  EXPO_PUBLIC_ZILAR_API_URL: process.env.EXPO_PUBLIC_ZILAR_API_URL,
});

export interface AuthClientOptions {
  baseURL: string;
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined | Promise<string | undefined>;
  onToken?: (token: string) => void;
}

/**
 * Bearer tokens instead of cookies: the client omits credentials and every `set-auth-token` response updates the stored token.
 */
export function createZilarAuthClient(options: AuthClientOptions) {
  return createAuthClient({
    baseURL: options.baseURL,
    plugins: [emailOTPClient()],
    fetchOptions: {
      // Cookies must never be sent: the native jar keeps a stale session cookie and, with no `Origin`, each request would answer 403 MISSING_OR_NULL_ORIGIN.
      credentials: 'omit' as const,
      ...(options.fetchImpl === undefined ? {} : { customFetchImpl: options.fetchImpl }),
      ...(options.getToken === undefined
        ? {}
        : { auth: { type: 'Bearer' as const, token: options.getToken } }),
      onSuccess: (context: SuccessContext) => {
        const token = context.response.headers.get(SET_AUTH_TOKEN_HEADER);
        if (token !== null && token !== '') {
          options.onToken?.(token);
        }
      },
    },
  });
}

export type AuthClient = ReturnType<typeof createZilarAuthClient>;

/**
 * Empty when there is no invite (existing-user sign-in).
 */
export function inviteFetchOptions(inviteCode: string | undefined): {
  headers?: Record<string, string>;
} {
  return inviteCode === undefined || inviteCode === ''
    ? {}
    : { headers: { [INVITE_HEADER]: inviteCode } };
}

export interface AuthRequestResult {
  error?: unknown;
}

export function sendSignInCode(
  client: AuthClient,
  email: string,
  inviteCode?: string,
): ReturnType<AuthClient['emailOtp']['sendVerificationOtp']> {
  return client.emailOtp.sendVerificationOtp({
    email,
    type: 'sign-in',
    fetchOptions: inviteFetchOptions(inviteCode),
  });
}

export interface VerifyResult extends AuthRequestResult {
  token?: string;
}

// The token is captured per call, so two verifications never share a value.
const verifySignInCodeEffect = (
  client: AuthClient,
  email: string,
  otp: string,
  inviteCode?: string,
): Effect.Effect<VerifyResult> =>
  Effect.suspend(() => {
    let token: string | undefined;
    return Effect.map(
      Effect.promise(() =>
        client.signIn.emailOtp({
          email,
          otp,
          fetchOptions: {
            ...inviteFetchOptions(inviteCode),
            onSuccess: (context: SuccessContext) => {
              const value = context.response.headers.get(SET_AUTH_TOKEN_HEADER);
              if (value !== null && value !== '') {
                token = value;
              }
            },
          },
        }),
      ),
      (result) => (token === undefined ? result : { ...result, token }),
    );
  });

export function verifySignInCode(
  client: AuthClient,
  email: string,
  otp: string,
  inviteCode?: string,
): Promise<VerifyResult> {
  return Effect.runPromise(verifySignInCodeEffect(client, email, otp, inviteCode));
}

export function signOutSession(client: AuthClient): ReturnType<AuthClient['signOut']> {
  return client.signOut();
}
