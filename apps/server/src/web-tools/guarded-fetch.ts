// The guard for the gateway-level web tools. Everything they return is untrusted
// content: adapters put it in `modelText` only, and a summary carries host names
// and counts, never page content.
//
// DNS is resolved and every address classified (private, loopback, link-local,
// 6to4, Teredo refused), then the request is pinned to the validated IP with
// SNI/`Host` kept. Redirects are never followed; a 3xx is a result the model can
// retry with the new URL.
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Data, Duration, Effect, type Effect as EffectType } from 'effect';
import { classifyIp, isIpLiteral } from '@zilar/desk/egress/ip-guard';

export class FetchFailed extends Data.TaggedError('FetchFailed')<{
  readonly reason: FetchFailureReason;
}> {}

export type PinnedFetchResult = {
  response: { status: number; rawContentType: string | null; location: string | null };
  raw: Uint8Array;
};

export function classifyFetchError(error: unknown): FetchFailed {
  return new FetchFailed({ reason: classifyFetchFailureReason(error) });
}

// `fetchPinned` GETs one validated address with SNI/`Host` kept as the hostname;
// `FetchFailed` is the request's failure mode.
export function fetchPinned(
  url: URL,
  address: string,
  options: {
    headers: Record<string, string>;
    timeoutMs: number;
    maxResponseBytes: number;
    truncateAtMax: boolean;
  },
): EffectType.Effect<PinnedFetchResult, FetchFailed> {
  const { timeoutMs, maxResponseBytes, truncateAtMax } = options;
  const headers: Record<string, string> = {
    accept: '*/*',
    connection: 'close',
    ...options.headers,
  };
  const path = `${url.pathname}${url.search}`;
  return Effect.callback<PinnedFetchResult, FetchFailed>((resume) => {
    // The body end, a truncation, a stream error and a request error race here.
    let settled = false;
    const succeed = (result: PinnedFetchResult): void => {
      if (!settled) {
        settled = true;
        resume(Effect.succeed(result));
      }
    };
    const failWith = (error: unknown): void => {
      if (!settled) {
        settled = true;
        resume(Effect.fail(classifyFetchError(error)));
      }
    };
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
          succeed({
            response: { status, rawContentType, location: rawLocation },
            raw: new Uint8Array(0),
          });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        let stopped = false;
        const body = (): PinnedFetchResult => ({
          response: { status, rawContentType, location: rawLocation },
          raw: new Uint8Array(Buffer.concat(chunks)),
        });
        res.on('data', (chunk: Buffer) => {
          if (settled || stopped) {
            return;
          }
          if (total + chunk.length > maxResponseBytes) {
            if (truncateAtMax) {
              // The `<head>` is in the first few KB; the rest is not needed.
              chunks.push(chunk.subarray(0, maxResponseBytes - total));
              succeed(body());
              req.destroy();
              return;
            }
            stopped = true;
            req.destroy(new Error('response too large'));
            return;
          }
          total += chunk.length;
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (!stopped) {
            succeed(body());
          }
        });
        res.on('error', (error: Error) => {
          failWith(error);
        });
      },
    );
    // An idle timeout only; the hard deadline is the `timeoutOrElse` in `guardedGetEffect`.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('fetch timeout'));
    });
    req.on('timeout', () => {
      req.destroy(new Error('fetch timeout'));
    });
    req.on('error', (error: Error) => {
      failWith(error);
    });
    req.end();
    // Interruption destroys the request, so its socket is released.
    return Effect.sync(() => {
      req.destroy();
    });
  });
}

export const WEB_FETCH_TIMEOUT_MS = 10_000;
export const WEB_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// Anything else (images, PDFs, binaries) returns an unsupported type. The check
// runs on the media type only (before `;`), case-insensitive.
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
  /**
   * Skips the exact-host allowlist only. Every other guard stays, so a caller
   * fetching a user-supplied URL still cannot reach the LAN.
   */
  anyPublicHost?: boolean;
  headers?: Record<string, string>;
  resolver?: DnsLookup;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /**
   * Reaching the byte cap returns what was read as a success instead of
   * `too-large`. Link previews use it: the `<head>` is in the first few KB.
   */
  truncateAtMax?: boolean;
  /**
   * Replaces the default allowlist. Link preview images pass image types only, so
   * an SVG or an HTML page is refused.
   */
  allowedContentTypes?: readonly string[];
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
  bytes: Uint8Array;
}

// `summary` is fixed wording; `detail` carries remote text (a redirect's
// `Location`) and reaches the model only as `modelText`.
export type GuardedGetResult =
  { ok: true; body: GuardedBody } | { ok: false; summary: string; detail?: string };

// Internal only: the `Promise` edge maps each to a fixed result object.
class BadUrl extends Data.TaggedError('BadUrl')<{ readonly reason: BadUrlReason }> {}

class HostNotAllowed extends Data.TaggedError('HostNotAllowed') {}

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
        RedirectNotFollowed: (error: RedirectNotFollowed) =>
          Effect.succeed(redirectFailure(error.status, error.location)),
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
  if (
    options.anyPublicHost !== true &&
    !options.allowedHosts.some((entry) => entry.toLowerCase() === host)
  ) {
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
    truncateAtMax: boolean;
  } = {
    headers: options.headers ?? {},
    timeoutMs: options.timeoutMs ?? WEB_FETCH_TIMEOUT_MS,
    maxResponseBytes: options.maxResponseBytes ?? WEB_MAX_RESPONSE_BYTES,
    truncateAtMax: options.truncateAtMax === true,
  };
  const fetcher = options.fetcher;
  const pinnedFetch: EffectType.Effect<PinnedFetchResult, FetchFailed> =
    fetcher === undefined
      ? fetchPinned(url, pinned, fetchOptions)
      : Effect.tryPromise({
          try: () => fetcher(url, pinned, fetchOptions),
          catch: classifyFetchError,
        });
  // The hard overall deadline: a server dripping one byte at a time could hold
  // the idle-timeout request forever. Expiry interrupts and destroys it.
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
  const allowedTypes = options.allowedContentTypes ?? WEB_ALLOWED_CONTENT_TYPES;
  if (mediaType === null || !allowedTypes.includes(mediaType)) {
    return yield* new UnsupportedContentType({ mediaType });
  }
  return {
    ok: true,
    body: {
      status: response.status,
      contentType: mediaType,
      location: response.location,
      text: decodeCapped(raw),
      bytes: raw,
    },
  };
});

// effect-plain: pure guard helpers; no guard state, no request
export const WEB_MAX_DECODE_CHARS = 2 * 1024 * 1024;

export type BadUrlReason = 'invalid' | 'https-only' | 'credentials' | 'port';

export type FetchFailureReason = 'timeout' | 'too-large' | 'failed';

export function badUrlSummary(reason: BadUrlReason): string {
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

export function fetchFailedSummary(reason: FetchFailureReason): string {
  switch (reason) {
    case 'timeout':
      return 'fetch timed out';
    case 'too-large':
      return 'response too large';
    case 'failed':
      return 'fetch failed';
  }
}

export function classifyFetchFailureReason(error: unknown): FetchFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return 'timeout';
  }
  if (/too large|too big/i.test(message)) {
    return 'too-large';
  }
  return 'failed';
}

export interface GuardedFailure {
  ok: false;
  summary: string;
  detail?: string;
}

export function failure(summary: string, detail?: string): GuardedFailure {
  return detail === undefined ? { ok: false, summary } : { ok: false, summary, detail };
}

export function redirectFailure(status: number, location: string | null): GuardedFailure {
  if (location === null) {
    return failure(`not followed: redirect (status ${status})`);
  }
  return failure(
    'not followed: redirect',
    `The page redirects to ${location.slice(0, 2048)}. Call the tool again with that URL if you want to follow it.`,
  );
}

/** The media type before `;`, lowercased; `null` when it is missing or malformed. */
export function mediaTypeOf(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const mediaType = raw.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined || mediaType.length === 0 || !mediaType.includes('/')) {
    return null;
  }
  return mediaType;
}

// UTF-8 with a hard cap, so a hostile page cannot blow up memory at decode time.
export function decodeCapped(raw: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
  if (text.length <= WEB_MAX_DECODE_CHARS) {
    return text;
  }
  return text.slice(0, WEB_MAX_DECODE_CHARS);
}
