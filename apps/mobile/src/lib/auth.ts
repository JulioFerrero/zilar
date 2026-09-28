import type { SuccessContext } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Header the server reads to attribute a sign-up to an invite (T-0015/T-0020). */
export const INVITE_HEADER = 'x-galena-invite';

/** Better Auth's bearer plugin exposes the session token in this response header. */
export const SET_AUTH_TOKEN_HEADER = 'set-auth-token';

export const DEFAULT_API_URL = 'http://127.0.0.1:3188';

/** Build-time server URL, read from `EXPO_PUBLIC_GALENA_API_URL` (see `spike/config.ts`). */
export function resolveApiUrl(env: Record<string, string | undefined>): string {
  const value = env['EXPO_PUBLIC_GALENA_API_URL'];
  return typeof value === 'string' && value !== '' ? value : DEFAULT_API_URL;
}

// Referenced as its own `process.env.EXPO_PUBLIC_*` expression so babel-preset-expo
// inlines it into the bundle at Metro time.
export const API_URL = resolveApiUrl({
  EXPO_PUBLIC_GALENA_API_URL: process.env.EXPO_PUBLIC_GALENA_API_URL,
});

export interface AuthClientOptions {
  baseURL: string;
  fetchImpl?: typeof fetch;
  /** Reads the persisted bearer token, so session requests are authenticated. */
  getToken?: () => string | undefined | Promise<string | undefined>;
  /** Called with the token whenever a response sets a new one (sign-in/refresh). */
  onToken?: (token: string) => void;
}

/**
 * Better Auth's React client configured for React Native: bearer tokens instead
 * of cookies, since native fetch has no persistent cookie jar. The token comes
 * from secure storage and every `set-auth-token` response updates it.
 */
export function createGalenaAuthClient(options: AuthClientOptions) {
  return createAuthClient({
    baseURL: options.baseURL,
    plugins: [emailOTPClient()],
    fetchOptions: {
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

/** The exact client type this app uses, with the email OTP plugin inferred. */
export type AuthClient = ReturnType<typeof createGalenaAuthClient>;

/**
 * The `x-galena-invite` header for the send-code and sign-in calls. Returns an
 * empty object when there is no invite (existing-user sign-in).
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

/** Sends the 6-digit sign-in code. Carries the invite header on a new sign-up. */
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
  /** The bearer token from `set-auth-token`, when the response carried one. */
  token?: string;
}

/** Verifies the code and returns the bearer token from the sign-in response. */
export async function verifySignInCode(
  client: AuthClient,
  email: string,
  otp: string,
  inviteCode?: string,
): Promise<VerifyResult> {
  let token: string | undefined;
  const result = await client.signIn.emailOtp({
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
  });
  return token === undefined ? result : { ...result, token };
}

/** Ends the server session for the current bearer token. */
export function signOutSession(client: AuthClient): ReturnType<AuthClient['signOut']> {
  return client.signOut();
}
