import { createSign } from 'node:crypto';
import { Exit, Schema } from 'effect';

// The FCM HTTP v1 access token, minted from a service account without
// `firebase-admin` (native-push-plan.md §2.2). The flow is one RS256 JWT and
// one OAuth2 token exchange: the claim set is fixed and small, so 30 lines of
// `node:crypto` beat a large transitive client library. The service account's
// `private_key` never reaches a log, an error or a thrown value.

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TOKEN_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const JWT_LIFETIME_SECONDS = 3600;
// Refresh early: the token is dropped `CACHE_MARGIN_SECONDS` before Google's
// own expiry so a send never races the clock.
const CACHE_MARGIN_SECONDS = 300;

export interface FcmServiceAccount {
  clientEmail: string;
  privateKey: string;
}

export interface FcmFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Injected so tests never touch Google; the default is global `fetch`. */
export type FcmFetch = (url: string, init: FcmFetchInit) => Promise<Response>;

export interface FcmTokenProvider {
  token(): Promise<string>;
}

export interface FcmTokenProviderInput {
  serviceAccount: FcmServiceAccount;
  fetch?: FcmFetch;
  /** Injected clock in epoch seconds; defaults to the wall clock. */
  now?: () => number;
}

// Carries a fixed sentence and the HTTP status only. The request assertion,
// the access token and the private key are never put on the error.
export class FcmTokenError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'FcmTokenError';
    this.status = status;
  }
}

const tokenResponseSchema = Schema.Struct({
  access_token: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  expires_in: Schema.Number,
});

// One RS256 JWT: `header.claims` signed with the service account's private
// key. `exp - iat` is exactly one hour, the value Google's flow expects.
function signAssertion(serviceAccount: FcmServiceAccount, issuedAt: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: serviceAccount.clientEmail,
      scope: TOKEN_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + JWT_LIFETIME_SECONDS,
    }),
  );
  const signingInput = `${header}.${claims}`;
  let signature: Buffer;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    signature = signer.sign(serviceAccount.privateKey);
  } catch {
    // The underlying OpenSSL error could echo key material: replace it.
    throw new FcmTokenError('FCM service account private key could not sign the request');
  }
  return `${signingInput}.${base64url(signature)}`;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

// The provider caches one token and collapses concurrent refreshes into one
// exchange. `token()` never rejects with the service account: a failed
// exchange is an `FcmTokenError` carrying only the status.
export function createFcmTokenProvider(input: FcmTokenProviderInput): FcmTokenProvider {
  const fetchImpl: FcmFetch = input.fetch ?? ((url, init) => fetch(url, init));
  const now = input.now ?? (() => Math.floor(Date.now() / 1000));

  let cached: { accessToken: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function refresh(): Promise<string> {
    const issuedAt = now();
    const assertion = signAssertion(input.serviceAccount, issuedAt);
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!response.ok) {
      throw new FcmTokenError(
        `FCM token request failed (HTTP ${response.status})`,
        response.status,
      );
    }
    const raw: unknown = await response.json().catch(() => null);
    const exit = Schema.decodeUnknownExit(tokenResponseSchema)(raw);
    if (!Exit.isSuccess(exit)) {
      throw new FcmTokenError('FCM token response was malformed');
    }
    cached = {
      accessToken: exit.value.access_token,
      expiresAt: issuedAt + Math.max(0, exit.value.expires_in - CACHE_MARGIN_SECONDS),
    };
    return cached.accessToken;
  }

  return {
    token: () => {
      if (cached !== null && now() < cached.expiresAt) {
        return Promise.resolve(cached.accessToken);
      }
      if (inFlight === null) {
        inFlight = refresh().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
