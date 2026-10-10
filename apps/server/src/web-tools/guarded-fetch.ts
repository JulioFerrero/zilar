// T-0125: shared building blocks for the gateway-level web tools.
//
// Everything these tools return is untrusted content (a web page can say
// "ignore your instructions"). Adapters put it in `modelText` only; the
// gateway already wraps it in `<untrusted-tool-output>`, audits action
// names and args hashes only, and never logs URLs, queries or content.
// Summaries below carry host names and counts, never page content.
//
// The network path reuses the sandbox's guard: DNS resolved with
// `dnsLookup`, every address classified by `classifyIp` (private,
// loopback, link-local, 6to4, Teredo and friends refused), the request
// pinned to the validated IP with SNI/`Host` kept as the hostname.
// Redirects are never followed — a 3xx is returned as a result the model
// can retry with the new URL (same checks apply to the retry).
//
// T-0484: the guard runs as an `Effect` pipeline inside, with `Promise`
// exports at the edge (see `docs/EFFECT_GUIDE.md`). Each failure mode is a
// `Data.TaggedError`; the edge maps them to the same fixed result objects as
// before, so callers and tests are unchanged. `fetchPinned` is an
// `Effect.callback` over `https.request`: the idle timeout and the byte cap
// stay on the request, the hard overall deadline is `Effect.timeoutOrElse`,
// and interruption destroys the request.
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Data, Duration, Effect, type Effect as EffectType } from 'effect';
import { classifyIp, isIpLiteral } from '../sandbox/ip-guard';

export const WEB_FETCH_TIMEOUT_MS = 10_000;
export const WEB_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const WEB_MAX_DECODE_CHARS = 2 * 1024 * 1024;

// Only these response bodies are read. Anything else (images, PDFs,
// binaries) returns `unsupported content type <type>`. The check runs on
// the media type only (before `;`), case-insensitive.
export const WEB_ALLOWED_CONTENT_TYPES: readonly string[] = [
  'text/html',
  'text/plain',
  'application/json',
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml',
  'text/csv',
];

export type DnsLookup = (host: string) => Promise<string[]>;

export interface GuardedGetOptions {
  allowedHosts: readonly string[];
  headers?: Record<string, string>;
  resolver?: DnsLookup;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetcher?: PinnedFetcher;
}

export type PinnedFetcher = (
  url: URL,
  address: string,
  options: { headers: Record<string, string>; timeoutMs: number; maxResponseBytes: number },
) => Promise<{
  response: { status: number; rawContentType: string | null; location: string | null };
  raw: Uint8Array;
}>;

export interface GuardedBody {
  status: number;
  contentType: string | null;
  location: string | null;
  text: string;
}

// A failed get. `summary` is fixed wording only; `detail` carries text that
// came from the remote server (a redirect's `Location`) and must reach the
// model only as `modelText`, never in a summary.
export type GuardedGetResult =
  { ok: true; body: GuardedBody } | { ok: false; summary: string; detail?: string };

// Internal failure modes, one tag per category from the spec. The `Promise`
// edge maps each to exactly the `{ ok: false, summary, detail? }` object the
// old code returned; these classes never leave this module.
type BadUrlReason = 'invalid' | 'https-only' | 'credentials' | 'port';

class BadUrl extends Data.TaggedError('BadUrl')<{ readonly reason: BadUrlReason }> {}

class HostNotAllowed extends Data.TaggedError('HostNotAllowed') {}

type FetchFailureReason = 'timeout' | 'too-large' | 'failed';

class FetchFailed extends Data.TaggedError('FetchFailed')<{
  readonly reason: FetchFailureReason;
}> {}

class RedirectNotFollowed extends Data.TaggedError('RedirectNotFollowed')<{
  readonly status: number;
  readonly location: string | null;
}> {}

class StatusNotOk extends Data.TaggedError('StatusNotOk')<{ readonly status: number }> {}

class UnsupportedContentType extends Data.TaggedError('UnsupportedContentType')<{
  readonly mediaType: string | null;
}> {}

type GuardedGetError =
  | BadUrl
  | HostNotAllowed
  | FetchFailed
  | RedirectNotFollowed
  | StatusNotOk
  | UnsupportedContentType;

interface PinnedFetchResult {
  response: { status: number; rawContentType: string | null; location: string | null };
  raw: Uint8Array;
}

const resolveAll: DnsLookup = async (name) => {
  const records = await dnsLookup(name, { all: true });
  return records.map((record) => record.address);
};

// Read-only, GET only, https only. No cookies, no auth headers, no body.
export function guardedGet(rawUrl: string, options: GuardedGetOptions): Promise<GuardedGetResult> {
  return Effect.runPromise(
    guardedGetEffect(rawUrl, options).pipe(
      Effect.catchTags({
        BadUrl: (error: BadUrl) => Effect.succeed(failure(badUrlSummary(error.reason))),
        HostNotAllowed: () => Effect.succeed(failure('host not allowed')),
        FetchFailed: (error: FetchFailed) =>
          Effect.succeed(failure(fetchFailedSummary(error.reason))),
        RedirectNotFollowed: (error: RedirectNotFollowed) => Effect.succeed(redirectFailure(error)),
        StatusNotOk: (error: StatusNotOk) =>
          Effect.succeed(failure(`fetch failed with status ${error.status}`)),
        UnsupportedContentType: (error: UnsupportedContentType) =>
          Effect.succeed(failure(`unsupported content type ${error.mediaType ?? 'unknown'}`)),
      }),
    ),
  );
}

const guardedGetEffect = Effect.fnUntraced(function* (
  rawUrl: string,
  options: GuardedGetOptions,
): EffectType.fn.Return<GuardedGetResult, GuardedGetError> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return yield* new BadUrl({ reason: 'invalid' });
  }
  if (url.protocol !== 'https:') {
    return yield* new BadUrl({ reason: 'https-only' });
  }
  if (url.username !== '' || url.password !== '') {
    return yield* new BadUrl({ reason: 'credentials' });
  }
  if (url.port !== '' && url.port !== '443') {
    return yield* new BadUrl({ reason: 'port' });
  }
  const host = url.hostname.toLowerCase();
  if (host.length === 0 || isIpLiteral(host)) {
    return yield* new HostNotAllowed();
  }
  if (!options.allowedHosts.some((entry) => entry.toLowerCase() === host)) {
    return yield* new HostNotAllowed();
  }
  const resolver = options.resolver ?? resolveAll;
  const addresses = yield* Effect.tryPromise({
    try: () => resolver(host),
    catch: () => new HostNotAllowed(),
  });
  if (addresses.length === 0) {
    return yield* new HostNotAllowed();
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      return yield* new HostNotAllowed();
    }
  }
  const pinned = addresses[0] as string;
  const fetchOptions: {
    headers: Record<string, string>;
    timeoutMs: number;
    maxResponseBytes: number;
  } = {
    headers: options.headers ?? {},
    timeoutMs: options.timeoutMs ?? WEB_FETCH_TIMEOUT_MS,
    maxResponseBytes: options.maxResponseBytes ?? WEB_MAX_RESPONSE_BYTES,
  };
  const fetcher = options.fetcher;
  const pinnedFetch: EffectType.Effect<PinnedFetchResult, FetchFailed> =
    fetcher === undefined
      ? fetchPinned(url, pinned, fetchOptions)
      : Effect.tryPromise({
          try: () => fetcher(url, pinned, fetchOptions),
          catch: classifyFetchError,
        });
  // `timeoutOrElse` is the hard overall deadline: the request keeps its own
  // idle timeout, but a server that drips one byte at a time could hold the
  // connection for ever. On expiry it interrupts the fetch — the real
  // request's finalizer destroys it.
  const { response, raw } = yield* pinnedFetch.pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(fetchOptions.timeoutMs),
      orElse: () => Effect.fail(new FetchFailed({ reason: 'timeout' })),
    }),
  );
  if (response.status >= 300 && response.status < 400) {
    return yield* new RedirectNotFollowed({ status: response.status, location: response.location });
  }
  if (response.status < 200 || response.status >= 300) {
    return yield* new StatusNotOk({ status: response.status });
  }
  const mediaType = mediaTypeOf(response.rawContentType);
  if (mediaType === null || !WEB_ALLOWED_CONTENT_TYPES.includes(mediaType)) {
    return yield* new UnsupportedContentType({ mediaType });
  }
  return {
    ok: true,
    body: {
      status: response.status,
      contentType: mediaType,
      location: response.location,
      text: decodeCapped(raw),
    },
  };
});

function failure(summary: string, detail?: string): GuardedGetResult {
  return detail === undefined ? { ok: false, summary } : { ok: false, summary, detail };
}

function badUrlSummary(reason: BadUrlReason): string {
  switch (reason) {
    case 'invalid':
      return 'invalid url';
    case 'https-only':
      return 'only https urls are allowed';
    case 'credentials':
      return 'credentials in url are not allowed';
    case 'port':
      return 'explicit port is not allowed';
  }
}

function fetchFailedSummary(reason: FetchFailureReason): string {
  switch (reason) {
    case 'timeout':
      return 'fetch timed out';
    case 'too-large':
      return 'response too large';
    case 'failed':
      return 'fetch failed';
  }
}

function redirectFailure(error: RedirectNotFollowed): GuardedGetResult {
  if (error.location === null) {
    return failure(`not followed: redirect (status ${error.status})`);
  }
  return failure(
    'not followed: redirect',
    `The page redirects to ${error.location.slice(0, 2048)}. Call the tool again with that URL if you want to follow it.`,
  );
}

function classifyFetchError(error: unknown): FetchFailed {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return new FetchFailed({ reason: 'timeout' });
  }
  if (/too large|too big/i.test(message)) {
    return new FetchFailed({ reason: 'too-large' });
  }
  return new FetchFailed({ reason: 'failed' });
}

function mediaTypeOf(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const mediaType = raw.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined || mediaType.length === 0 || !mediaType.includes('/')) {
    return null;
  }
  return mediaType;
}

// Decodes the body as UTF-8 (replacing undecodable bytes) with a hard cap
// so a hostile page cannot blow up the server's memory at decode time.
export function decodeCapped(raw: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
  if (text.length <= WEB_MAX_DECODE_CHARS) {
    return text;
  }
  return text.slice(0, WEB_MAX_DECODE_CHARS);
}

function fetchPinned(
  url: URL,
  address: string,
  options: { headers: Record<string, string>; timeoutMs: number; maxResponseBytes: number },
): EffectType.Effect<PinnedFetchResult, FetchFailed> {
  const { timeoutMs, maxResponseBytes } = options;
  const headers: Record<string, string> = {
    accept: '*/*',
    connection: 'close',
    ...options.headers,
  };
  const path = `${url.pathname}${url.search}`;
  return Effect.callback<PinnedFetchResult, FetchFailed>((resume) => {
    const req = httpsRequest(
      {
        host: address,
        port: 443,
        path: path.length === 0 ? '/' : path,
        method: 'GET',
        servername: url.hostname,
        headers: {
          host: url.hostname,
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const rawContentType = Array.isArray(res.headers['content-type'])
          ? (res.headers['content-type'][0] ?? null)
          : (res.headers['content-type'] ?? null);
        const rawLocation = Array.isArray(res.headers.location)
          ? (res.headers.location[0] ?? null)
          : (res.headers.location ?? null);
        if (status >= 300 && status < 400) {
          res.resume();
          resume(
            Effect.succeed({
              response: { status, rawContentType, location: rawLocation },
              raw: new Uint8Array(0),
            }),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxResponseBytes) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resume(
            Effect.succeed({
              response: { status, rawContentType, location: rawLocation },
              raw: new Uint8Array(Buffer.concat(chunks)),
            }),
          );
        });
        res.on('error', (error: Error) => {
          resume(Effect.fail(classifyFetchError(error)));
        });
      },
    );
    // `setTimeout` on the request is an idle timeout, so a server that drips
    // one byte at a time is ended between bytes. The hard overall deadline is
    // the `Effect.timeoutOrElse` around this effect in `guardedGetEffect`.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('fetch timeout'));
    });
    req.on('timeout', () => {
      req.destroy(new Error('fetch timeout'));
    });
    req.on('error', (error: Error) => {
      resume(Effect.fail(classifyFetchError(error)));
    });
    req.end();
    // Runs when the fiber is interrupted (overall deadline or caller abort):
    // destroy the request so its socket is released.
    return Effect.sync(() => {
      req.destroy();
    });
  });
}
