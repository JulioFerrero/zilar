import { Duration, Effect, type Effect as EffectType } from 'effect';
import {
  TELEGRAM_API_HOST,
  TELEGRAM_IMPORT_MAX_BYTES,
  TELEGRAM_IMPORT_TIMEOUT_MS,
  TELEGRAM_JSON_MAX_BYTES,
  TelegramFileTooLarge,
  TelegramInvalidToken,
  TelegramPackNotFound,
  TelegramRateLimited,
  TelegramUnreachable,
  type TelegramFailure,
} from './errors';
import type { TelegramApiEnvelope } from './set';

export interface ApiCallOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export type FetchFn = typeof fetch;

/** Builds `https://api.telegram.org/bot<token>/<method>`. The token stays inside the client. */
function botMethodUrl(token: string, method: string): URL {
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  assertTelegramUrl(url);
  return url;
}

/** Builds `https://api.telegram.org/file/bot<token>/<filePath>`. */
export function botFileUrl(token: string, filePath: string): URL {
  const url = new URL(`https://api.telegram.org/file/bot${token}/${filePath}`);
  assertTelegramUrl(url);
  return url;
}

// The request allowlist: HTTPS to `api.telegram.org` only. With plain
// `fetch` the default is to follow redirects, so the client follows none —
// a redirect (even to the same host) is refused instead of chased.
function assertTelegramUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== TELEGRAM_API_HOST) {
    throw new TelegramUnreachable();
  }
}

// One `fetch` under the 10 s timeout. The timer aborts the request through
// the `AbortSignal` handed to `fetch` — combined with the signal
// `Effect.tryPromise` hands in, which fires if the effect itself is
// interrupted. A fetch that refuses the abort still runs to completion,
// exactly like the old `AbortController`, so the timeout never preempts a
// response that already arrived.
const requestEffect = Effect.fnUntraced(function* (
  url: URL,
  fetchFn: FetchFn,
  timeoutMs: number,
): EffectType.fn.Return<Response, TelegramUnreachable> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return yield* Effect.tryPromise({
    try: (signal) =>
      fetchFn(url.toString(), {
        signal: AbortSignal.any([signal, controller.signal]),
        redirect: 'manual',
      }),
    catch: () => new TelegramUnreachable(),
  }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timer))));
});

// Drains a refused response so the connection is not left half-read. The
// body is not needed; a drain failure is swallowed like the old `.catch`.
const discardBody = (response: Response): EffectType.Effect<void> =>
  Effect.promise(() =>
    response.arrayBuffer().then(
      () => undefined,
      () => undefined,
    ),
  );

// The file-download read: no body means empty, and passing the cap cancels
// the reader and signals `file_too_large` (the importer skips and counts it).
async function readDownloadBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  if (body === null) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new TelegramUnreachable();
      });
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new TelegramFileTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

// Reads one Telegram Bot API method envelope (`getStickerSet`, `getFile`,
// `getMe`) with the 256 KiB cap: past it the head alone is pathological, so
// the response is dropped as `try_later` instead of buffered without bound.
async function readEnvelopeBody(response: Response): Promise<TelegramApiEnvelope> {
  const body = response.body;
  if (body === null) {
    // No stream (undici already buffered it): cap the buffered text itself.
    const text = await response.text().catch(() => {
      throw new TelegramUnreachable();
    });
    if (new TextEncoder().encode(text).byteLength > TELEGRAM_JSON_MAX_BYTES) {
      throw new TelegramUnreachable();
    }
    return parseTelegramEnvelope(text);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new TelegramUnreachable();
      });
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > TELEGRAM_JSON_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new TelegramUnreachable();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseTelegramEnvelope(new TextDecoder().decode(merged));
}

// Parses one already-bounded envelope body. Telegram's error text never
// passes through: a non-JSON answer is a transport failure, not content.
function parseTelegramEnvelope(text: string): TelegramApiEnvelope {
  try {
    return JSON.parse(text) as TelegramApiEnvelope;
  } catch {
    throw new TelegramUnreachable();
  }
}

const readEnvelopeEffect = Effect.fnUntraced(function* (
  response: Response,
): EffectType.fn.Return<TelegramApiEnvelope, TelegramUnreachable> {
  return yield* Effect.tryPromise({
    try: () => readEnvelopeBody(response),
    catch: () => new TelegramUnreachable(),
  });
});

// `fetch` with a timeout that reads at most `maxBytes`: aborts as soon as
// the cap is passed, so a large file never has to fit in memory twice.
export const fetchCappedEffect = Effect.fnUntraced(function* (
  url: URL,
  fetchFn: FetchFn,
  options: ApiCallOptions,
): EffectType.fn.Return<Uint8Array, TelegramFailure> {
  const timeoutMs = options.timeoutMs ?? TELEGRAM_IMPORT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? TELEGRAM_IMPORT_MAX_BYTES;
  const response = yield* requestEffect(url, fetchFn, timeoutMs);
  if (response.status >= 300 && response.status < 400) {
    yield* discardBody(response);
    return yield* new TelegramUnreachable();
  }
  if (response.status < 200 || response.status >= 300) {
    yield* discardBody(response);
    return yield* new TelegramUnreachable();
  }
  return yield* Effect.tryPromise({
    try: () => readDownloadBody(response, maxBytes),
    catch: (error) => (error instanceof TelegramFileTooLarge ? error : new TelegramUnreachable()),
  });
});

// One method call with the redirect refusal and the status mapping. A 429
// with a positive `retry_after` is returned as a retry signal when
// `allowRetry` is set; every other refusal fails typed.
type CallOutcome =
  | { readonly kind: 'result'; readonly value: unknown }
  | { readonly kind: 'retry'; readonly retryAfterMs: number };

const invokeEffect = Effect.fnUntraced(function* (
  url: URL,
  fetchFn: FetchFn,
  allowRetry: boolean,
): EffectType.fn.Return<CallOutcome, TelegramFailure> {
  const response = yield* requestEffect(url, fetchFn, TELEGRAM_IMPORT_TIMEOUT_MS);
  if (response.status >= 300 && response.status < 400) {
    yield* discardBody(response);
    return yield* new TelegramUnreachable();
  }
  const envelope = yield* readEnvelopeEffect(response);
  if (envelope.ok) {
    return { kind: 'result', value: envelope.result };
  }
  // A 401 means the bot token itself is unknown: report it distinctly so
  // the integrations page can verify a pasted key before storing it.
  if (response.status === 401 || envelope.error_code === 401) {
    return yield* new TelegramInvalidToken();
  }
  const retryAfter =
    typeof envelope.parameters?.retry_after === 'number'
      ? Math.min(Math.max(envelope.parameters.retry_after, 0), 5)
      : undefined;
  if (response.status === 429 && allowRetry && retryAfter !== undefined && retryAfter > 0) {
    return { kind: 'retry', retryAfterMs: retryAfter * 1000 };
  }
  if (response.status === 429) {
    return yield* new TelegramRateLimited();
  }
  if (response.status === 400 || envelope.error_code === 400) {
    return yield* new TelegramPackNotFound();
  }
  return yield* new TelegramUnreachable();
});

// The single retry after a 429: exactly one more attempt after `retry_after`
// (capped at 5 s), no further retry even if Telegram answers 429 again.
export const callMethodEffect = Effect.fnUntraced(function* (
  token: string,
  fetchFn: FetchFn,
  method: string,
  params: Record<string, string>,
): EffectType.fn.Return<unknown, TelegramFailure> {
  const url = yield* Effect.try({
    try: () => botMethodUrl(token, method),
    catch: () => new TelegramUnreachable(),
  });
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const first = yield* invokeEffect(url, fetchFn, true);
  if (first.kind === 'result') {
    return first.value;
  }
  yield* Effect.sleep(Duration.millis(first.retryAfterMs));
  const second = yield* invokeEffect(url, fetchFn, false);
  if (second.kind === 'retry') {
    return yield* new TelegramRateLimited();
  }
  return second.value;
});
