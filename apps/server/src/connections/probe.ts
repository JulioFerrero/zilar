import { Data, Duration, Effect } from 'effect';
import { catalogBaseUrl } from '../ai/catalog';
import { redactSecrets } from '../ai/http';
import { createPinnedFetch } from './pinned-fetch';
import type { ProviderId } from './providers';

// Each provider gets one cheap GET that returns 2xx only when the key is valid.
// The key goes only to the provider's own API, never stored or returned, and
// every outcome message is fixed so an echo of the key cannot reach the client.

export type ProbeOutcome = { ok: true } | { ok: false; message: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ProviderProbe {
  /** `baseUrl` is used by the compatible path only; `provider` may be a catalog id. */
  testKey(provider: string, key: string, baseUrl?: string | null): Promise<ProbeOutcome>;
}

const PROBE_TIMEOUT_MS = 10_000;

interface Endpoint {
  buildUrl: (key: string, baseUrl: string | null) => string;
  buildHeaders: (key: string) => Record<string, string>;
}

const ENDPOINTS: Record<ProviderId, Endpoint> = {
  openai: {
    buildUrl: () => 'https://api.openai.com/v1/models',
    buildHeaders: (key) => ({ authorization: `Bearer ${key}` }),
  },
  anthropic: {
    buildUrl: () => 'https://api.anthropic.com/v1/models',
    buildHeaders: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  google: {
    buildUrl: (key) =>
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    buildHeaders: () => ({}),
  },
  deepseek: {
    buildUrl: () => 'https://api.deepseek.com/models',
    buildHeaders: (key) => ({ authorization: `Bearer ${key}` }),
  },
  xai: {
    buildUrl: () => 'https://api.x.ai/v1/models',
    buildHeaders: (key) => ({ authorization: `Bearer ${key}` }),
  },
  openrouter: {
    buildUrl: () => 'https://openrouter.ai/api/v1/models',
    buildHeaders: (key) => ({ authorization: `Bearer ${key}` }),
  },
  github: {
    buildUrl: () => 'https://api.github.com/rate_limit',
    buildHeaders: (key) => ({
      authorization: `Bearer ${key}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    }),
  },
  'openai-compatible': {
    buildUrl: (_key, baseUrl) => `${baseUrl ?? ''}/models`,
    buildHeaders: (key) => ({ authorization: `Bearer ${key}` }),
  },
};

// A catalog provider probes exactly like the user's own OpenAI-compatible
// endpoint, through the pinned fetch.
function usesCompatiblePath(provider: string): boolean {
  return (
    provider === 'openai-compatible' ||
    catalogBaseUrl(provider) !== null ||
    !Object.hasOwn(ENDPOINTS, provider)
  );
}

function endpointFor(provider: string): Endpoint {
  return usesCompatiblePath(provider)
    ? ENDPOINTS['openai-compatible']
    : ENDPOINTS[provider as ProviderId];
}

// Internal only: it never reaches a caller, it becomes the "unreachable" outcome.
class ProbeUnreachable extends Data.TaggedError('ProbeUnreachable') {}

function outcomeFor(response: Response): ProbeOutcome {
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'The provider rejected the key' };
  }
  if (response.status === 429) {
    return {
      ok: false,
      message: 'The provider is rate-limiting this key. Try again in a minute.',
    };
  }
  if (response.ok) {
    return { ok: true };
  }
  return { ok: false, message: 'The provider returned an unexpected response' };
}

// For a custom endpoint only a 2xx means the key works; a 401/403 is a bad key,
// and everything else is "unreachable".
function outcomeForCustom(response: Response): ProbeOutcome {
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'The provider rejected the key' };
  }
  if (response.ok) {
    return { ok: true };
  }
  return { ok: false, message: 'The provider is unreachable' };
}

// The effect has no error channel; the fetch gets the abort signal.
export function testKeyEffect(
  fetchImpl: FetchLike,
): (provider: string, key: string, baseUrl: string | null) => Effect.Effect<ProbeOutcome> {
  return Effect.fnUntraced(function* (
    provider: string,
    key: string,
    baseUrl: string | null,
  ): Effect.fn.Return<ProbeOutcome> {
    const endpoint = endpointFor(provider);
    const probe = Effect.tryPromise({
      try: (signal) =>
        fetchImpl(endpoint.buildUrl(key, baseUrl), {
          method: 'GET',
          headers: endpoint.buildHeaders(key),
          signal,
        }),
      catch: () => new ProbeUnreachable(),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(PROBE_TIMEOUT_MS),
        orElse: () => Effect.fail(new ProbeUnreachable()),
      }),
    );
    // The message carries no detail from the error object: a URL could echo the
    // key back (Google puts it in the query).
    const mapOutcome = usesCompatiblePath(provider) ? outcomeForCustom : outcomeFor;
    return yield* probe.pipe(
      Effect.map(mapOutcome),
      Effect.catchTag('ProbeUnreachable', () =>
        Effect.succeed<ProbeOutcome>({ ok: false, message: 'The provider is unreachable' }),
      ),
    );
  });
}

export function createProviderProbe(fetchImpl: FetchLike = fetch): ProviderProbe {
  return {
    testKey(provider, key, baseUrl = null) {
      // Only the pinned fetch calls a custom endpoint; it re-resolves every probe.
      if (usesCompatiblePath(provider)) {
        if (baseUrl === null || baseUrl === '') {
          return Promise.resolve({ ok: false, message: 'The provider is unreachable' });
        }
        return Effect.runPromise(testKeyEffect(createPinnedFetch(baseUrl))(provider, key, baseUrl));
      }
      return Effect.runPromise(testKeyEffect(fetchImpl)(provider, key, baseUrl));
    },
  };
}

// The shared helper's `sk-` rule also catches credential-shaped echoes.
export function redactKey(message: string, key: string): string {
  return redactSecrets(message, [key]);
}
