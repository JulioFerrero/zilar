import { Exit, Schema } from 'effect';
import { importPKCS8, SignJWT } from 'jose';
import type { ServerConfig } from '../config';

// Mints and caches a GitHub App installation access token. The token is held
// here, in the server, and injected by the proxy per request; it never reaches
// the AI. The App private key is used only to sign the short-lived JWT that
// GitHub exchanges for an installation token.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';

// GitHub issues installation tokens that live one hour by default (up to 24 h).
// Re-mint once the remaining life drops below this window rather than waiting
// for the token to expire mid-request.
const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;

// GitHub caps App JWTs at 10 minutes; leave a minute of headroom.
const JWT_TTL_SECONDS = 9 * 60;

// Every mint failure is wrapped in this type. Its message never carries the App
// private key, the installation id or the JWT, whatever the upstream echoed.
export class GitTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitTokenError';
  }
}

const InstallationTokenSchema = Schema.Struct({
  token: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  expires_at: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

export interface GitHubAppTokenClientOptions {
  appId: string;
  privateKey: string;
  installationId: string;
  apiBaseUrl?: string;
  refreshWindowMs?: number;
  fetch?: FetchLike;
  now?: () => Date;
}

export interface GitHubAppTokenClient {
  getToken(): Promise<string>;
}

export function createGitHubAppTokenClient(
  options: GitHubAppTokenClientOptions,
): GitHubAppTokenClient {
  const { appId, privateKey, installationId } = options;
  const apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_GITHUB_API_BASE_URL).replace(/\/+$/, '');
  const refreshWindowMs = options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  let cached: { token: string; expiresAt: Date } | null = null;

  async function mintJwt(): Promise<string> {
    const key = await importPKCS8(privateKey, 'RS256');
    const nowSeconds = Math.floor(now().getTime() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(appId)
      .setIssuedAt(nowSeconds - 60)
      .setExpirationTime(nowSeconds + JWT_TTL_SECONDS)
      .sign(key);
  }

  async function mint(): Promise<{ token: string; expiresAt: Date }> {
    let response: Response;
    try {
      const jwt = await mintJwt();
      response = await fetchImpl(
        `${apiBaseUrl}/app/installations/${installationId}/access_tokens`,
        {
          method: 'POST',
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${jwt}`,
            'x-github-api-version': '2022-11-28',
          },
        },
      );
    } catch {
      throw new GitTokenError('could not mint a GitHub installation access token');
    }

    if (!response.ok) {
      throw new GitTokenError(
        `GitHub refused the installation access token (HTTP ${response.status})`,
      );
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      throw new GitTokenError('GitHub token response was not JSON');
    }

    const parsed = Schema.decodeUnknownExit(InstallationTokenSchema)(body);
    if (!Exit.isSuccess(parsed)) {
      throw new GitTokenError('GitHub token response had an unexpected shape');
    }

    const expiresAt = new Date(parsed.value.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new GitTokenError('GitHub token response had an invalid expiry');
    }

    return { token: parsed.value.token, expiresAt };
  }

  function isFresh(expiresAt: Date): boolean {
    return expiresAt.getTime() - now().getTime() > refreshWindowMs;
  }

  return {
    async getToken(): Promise<string> {
      if (cached !== null && isFresh(cached.expiresAt)) {
        return cached.token;
      }
      const fresh = await mint();
      cached = fresh;
      return fresh.token;
    },
  };
}

// Builds the client from the server config. Throws when the App is not
// configured, so a missing secret fails at startup rather than on first use.
export function createGitHubAppTokenClientFromConfig(
  config: Pick<
    ServerConfig,
    'GITHUB_APP_ID' | 'GITHUB_APP_PRIVATE_KEY' | 'GITHUB_APP_INSTALLATION_ID'
  >,
  fetchImpl: FetchLike = fetch,
): GitHubAppTokenClient {
  const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID } = config;
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !GITHUB_APP_INSTALLATION_ID) {
    throw new Error('GitHub App is not configured');
  }
  return createGitHubAppTokenClient({
    appId: GITHUB_APP_ID,
    privateKey: GITHUB_APP_PRIVATE_KEY,
    installationId: GITHUB_APP_INSTALLATION_ID,
    fetch: fetchImpl,
  });
}
