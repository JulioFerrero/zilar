import { Data, Duration, Effect } from 'effect';
import { redactSecrets } from '../ai/litellm-client';
import type { ProviderId } from './providers';

// "Test key" probe. Each provider gets one cheap GET that returns 2xx only when
// the key is valid. The key is sent only to the provider's own API, never
// stored or returned, and the outcome message is a fixed, sanitised string so
// the key (or any provider echo of it) can never reach the client or the log.

export type ProbeOutcome = { ok: true } | { ok: false; message: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ProviderProbe {
  testKey(provider: ProviderId, key: string): Promise<ProbeOutcome>;
}

const PROBE_TIMEOUT_MS = 10_000;

interface Endpoint {
  buildUrl: (key: string) => string;
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
};

// A failed or timed-out fetch. Internal only: it never reaches a caller, it is
// turned into the "unreachable" outcome below.
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

// Every outcome is a value, so the effect has no error channel. The fetch
// receives the Effect abort signal, which fires when the probe is interrupted.
export function testKeyEffect(
  fetchImpl: FetchLike,
): (provider: ProviderId, key: string) => Effect.Effect<ProbeOutcome> {
  return Effect.fnUntraced(function* (
    provider: ProviderId,
    key: string,
  ): Effect.fn.Return<ProbeOutcome> {
    const endpoint = ENDPOINTS[provider];
    const probe = Effect.tryPromise({
      try: (signal) =>
        fetchImpl(endpoint.buildUrl(key), {
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
    // Unreachable is a distinct, honest answer: not a false failure of the key
    // and not a false success. The message carries no detail from the error
    // object because a URL (Google puts the key in the query) could echo the
    // key back.
    return yield* probe.pipe(
      Effect.map(outcomeFor),
      Effect.catchTag('ProbeUnreachable', () =>
        Effect.succeed<ProbeOutcome>({ ok: false, message: 'The provider is unreachable' }),
      ),
    );
  });
}

export function createProviderProbe(fetchImpl: FetchLike = fetch): ProviderProbe {
  const probeKey = testKeyEffect(fetchImpl);
  return {
    testKey(provider, key) {
      return Effect.runPromise(probeKey(provider, key));
    },
  };
}

// Redacts a key from a message, reusing the AI module's helper. The `sk-` rule
// in that helper also catches credential-shaped keys the provider may echo.
export function redactKey(message: string, key: string): string {
  return redactSecrets(message, [key]);
}
