import { Cause, Duration, Effect, type Effect as EffectType } from 'effect';
import {
  TELEGRAM_API_HOST,
  TELEGRAM_IMPORT_MAX_BYTES,
  TELEGRAM_IMPORT_TIMEOUT_MS,
  TELEGRAM_JSON_MAX_BYTES,
  TelegramFileTooLarge,
  TelegramImportError,
  TelegramInvalidPath,
  TelegramInvalidToken,
  TelegramPackNotFound,
  TelegramRateLimited,
  TelegramUnreachable,
  UNREACHABLE_MESSAGE,
  failureToImportError,
  scrubTokenText,
  type TelegramFailure,
} from './errors';
import {
  toStickerSet,
  type TelegramApiEnvelope,
  type TelegramClient,
  type TelegramStickerSet,
} from './set';

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

// The request allowlist: HTTPS to `api.telegram.org` only. `fetch` follows
// redirects by default, so none are followed — a redirect, even to the same
// host, is refused.
function assertTelegramUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== TELEGRAM_API_HOST) {
    throw new TelegramUnreachable();
  }
}

// One `fetch` under the 10 s timeout: the timer aborts through the
// `AbortSignal`, combined with the one `Effect.tryPromise` hands in for
// interruption. A fetch that refuses the abort runs to completion, so the
// timeout never preempts an answer that already arrived.
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

const discardBody = (response: Response): EffectType.Effect<void> =>
  Effect.promise(() =>
    response.arrayBuffer().then(
      () => undefined,
      () => undefined,
    ),
  );

// The file download: no body means empty, and passing the cap cancels the
// reader and signals `file_too_large`.
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

// Reads one Bot API method envelope with the 256 KiB cap: past it the
// response is pathological and dropped as `try_later` instead of buffered.
async function readEnvelopeBody(response: Response): Promise<TelegramApiEnvelope> {
  const body = response.body;
  if (body === null) {
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

// Parses one bounded envelope; a non-JSON answer is a transport failure, and
// Telegram's error text never passes through.
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

// `fetch` with a timeout that reads at most `maxBytes`, aborting as soon as
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

// One method call with the redirect refusal and the status mapping; a 429
// with a positive `retry_after` is a retry signal when `allowRetry` is set.
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

// Exactly one more attempt after `retry_after` (capped at 5 s), no further
// retry even on another 429.
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

/** The real Telegram client: `fetch` only to the two hard-coded HTTPS URLs,
 * no redirects, 10 s timeout, 1 MiB per file and 256 KiB per method
 * envelope. A 429 retries once, then `try_later`; 401 is `invalid_token`; a
 * missing pack is `pack_not_found`; no other Telegram text passes through. */
export function createTelegramClient(token: string, fetchFn: FetchFn = fetch): TelegramClient {
  // The `Promise` edge maps each internal failure to its fixed
  // `TelegramImportError`; the message is scrubbed defensively.
  const toImportError = (failure: TelegramFailure): TelegramImportError => {
    const info = failureToImportError(failure);
    return new TelegramImportError(info.code, scrubTokenText(token, info.message));
  };

  const runClient = <A>(effect: EffectType.Effect<A, TelegramFailure>): Promise<A> =>
    Effect.runPromise(
      effect.pipe(
        Effect.catchTags({
          TelegramUnreachable: (error: TelegramUnreachable) => Effect.fail(toImportError(error)),
          TelegramRateLimited: (error: TelegramRateLimited) => Effect.fail(toImportError(error)),
          TelegramPackNotFound: (error: TelegramPackNotFound) => Effect.fail(toImportError(error)),
          TelegramInvalidToken: (error: TelegramInvalidToken) => Effect.fail(toImportError(error)),
          TelegramFileTooLarge: (error: TelegramFileTooLarge) => Effect.fail(toImportError(error)),
          TelegramInvalidPath: (error: TelegramInvalidPath) => Effect.fail(toImportError(error)),
        }),
        // A defect must never escape as a `FiberFailure` (which would carry the
        // token-bearing URL); after `catchTags` every other cause becomes the fixed
        // `try_later`, while interruption is rethrown unchanged.
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          if (Cause.squash(cause) instanceof TelegramImportError) {
            return Effect.failCause(cause);
          }
          return Effect.fail(
            new TelegramImportError('try_later', scrubTokenText(token, UNREACHABLE_MESSAGE)),
          );
        }),
      ),
    );

  return {
    // `getMe` verifies a bot token: 401 is `invalid_token`, anything else
    // `try_later`. Only the owner-gated integrations route calls it.
    getMe(): Promise<{ ok: boolean }> {
      return runClient(callMethodEffect(token, fetchFn, 'getMe', {}).pipe(Effect.as({ ok: true })));
    },

    getStickerSet(name: string): Promise<TelegramStickerSet> {
      return runClient(
        Effect.gen(function* () {
          const result = yield* callMethodEffect(token, fetchFn, 'getStickerSet', { name });
          return yield* Effect.try({
            try: () => toStickerSet(name, result),
            catch: (error) =>
              error instanceof TelegramPackNotFound ? error : new TelegramUnreachable(),
          });
        }),
      );
    },

    downloadFile(fileId: string): Promise<Uint8Array> {
      return runClient(
        Effect.gen(function* () {
          const info = (yield* callMethodEffect(token, fetchFn, 'getFile', {
            file_id: fileId,
          })) as Record<string, unknown> | null;
          const filePath =
            info !== null && typeof info === 'object' && typeof info.file_path === 'string'
              ? info.file_path
              : '';
          if (filePath === '' || filePath.includes('..')) {
            return yield* new TelegramInvalidPath();
          }
          const url = yield* Effect.try({
            try: () => botFileUrl(token, filePath),
            catch: () => new TelegramUnreachable(),
          });
          return yield* fetchCappedEffect(url, fetchFn, {});
        }),
      );
    },
  };
}
