// Telegram sticker-pack import (T-0123, Effect conversion T-0483): fetch a
// public pack through the Telegram Bot API (`getStickerSet`, `getFile`) and
// store its static stickers as a private Zilar pack.
//
// Security shape (mirrors the GIF proxy, T-0122):
// - Only two hosts are ever contacted: `api.telegram.org` (Bot API calls)
//   and `api.telegram.org/file` (file downloads) — both HTTPS, no redirects,
//   10 s timeout, 1 MiB cap per download. The URLs are built inside the
//   client; the only caller-controlled value is the validated pack name.
// - The bot token never reaches logs, errors or responses: every message is
//   a fixed string (or carries Telegram's numeric `retry_after` only), and a
//   `scrubTokenText` pass rewrites any accidental leak before an error is
//   thrown.
//
// The network logic runs on Effect. The 10 s timeout aborts the `fetch`
// through the `AbortSignal` `Effect.tryPromise` hands it (combined with a
// timer signal), so an answer that already arrived is never preempted; a
// Telegram 429 is one explicit `Effect.sleep` and exactly one more attempt,
// never a retry schedule. The internal `Data.TaggedError` failures map to
// the same `TelegramImportError` codes and messages at the `Promise` edge,
// so the importers and the existing tests see the same client.

import { Cause, Data, Duration, Effect, type Effect as EffectType } from 'effect';

export const TELEGRAM_API_HOST = 'api.telegram.org';
export const TELEGRAM_IMPORT_TIMEOUT_MS = 10_000;
export const TELEGRAM_IMPORT_MAX_BYTES = 1024 * 1024;
// Cap on the JSON read from a Telegram Bot API method response
// (`getStickerSet`, `getFile`, `getMe`): a sticker set with 200 entries is
// tens of KiB, so anything past this is pathological and is dropped instead
// of buffered without bound — like the 1 MiB file download cap.
export const TELEGRAM_JSON_MAX_BYTES = 256 * 1024;

export type TelegramImportErrorCode =
  | 'pack_not_found'
  | 'try_later'
  | 'import_unavailable'
  | 'invalid_request'
  | 'file_too_large'
  | 'invalid_token';

export class TelegramImportError extends Error {
  readonly code: TelegramImportErrorCode;

  constructor(code: TelegramImportErrorCode, message: string) {
    super(message);
    this.name = 'TelegramImportError';
    this.code = code;
  }
}

const PACK_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Parses the import input: a bare pack name, a
 * `https://t.me/addstickers/<name>` link (query strings ignored), or a
 * `tg://addstickers?set=<name>` link. Anything else — including a name
 * that fails `^[A-Za-z0-9_]{1,64}$` — throws `invalid_request` before any
 * network request is made.
 */
export function parseTelegramPackInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '' || /[\s]/.test(trimmed)) {
    throw new TelegramImportError('invalid_request', 'Give a sticker pack link or name');
  }
  const tme = /^https?:\/\/t\.me\/addstickers\/([^\s/?#]+)/i.exec(trimmed);
  if (tme !== null) {
    // A bare path prefix is not enough: `…/FunCats/extra` or a trailing
    // query must not smuggle a second path past the name check.
    const rest = trimmed.slice(tme[0].length);
    if (rest !== '' && !rest.startsWith('?') && !rest.startsWith('#')) {
      throw new TelegramImportError('invalid_request', 'That sticker pack link is not valid');
    }
    return checkPackName(decodeURIComponentSafe(tme[1]!));
  }
  if (/^tg:\/\/addstickers(\?|$)/i.test(trimmed)) {
    const queryStart = trimmed.indexOf('?');
    const params = new URLSearchParams(queryStart === -1 ? '' : trimmed.slice(queryStart + 1));
    return checkPackName(params.get('set') ?? '');
  }
  return checkPackName(trimmed);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new TelegramImportError('invalid_request', 'That sticker pack link is not valid');
  }
}

function checkPackName(name: string): string {
  if (!PACK_NAME_PATTERN.test(name)) {
    throw new TelegramImportError('invalid_request', 'That sticker pack link is not valid');
  }
  return name;
}

export interface TelegramStickerEntry {
  /** Telegram's stable file id (never reused): stored as `source_id`. */
  sourceId: string;
  /** The opaque `file_id` needed for the `getFile` call. Never logged. */
  fileId: string;
  emoji: string | null;
  /** True for animated (`.tgs`) and video (`.webm`) stickers: skipped. */
  animated: boolean;
}

export interface TelegramStickerSet {
  name: string;
  title: string;
  isCustomEmoji: boolean;
  stickers: TelegramStickerEntry[];
}

export interface TelegramClient {
  getMe(): Promise<{ ok: boolean }>;
  getStickerSet(name: string): Promise<TelegramStickerSet>;
  downloadFile(fileId: string): Promise<Uint8Array>;
}

interface ApiCallOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

type FetchFn = typeof fetch;

// The internal failures. They are `Data.TaggedError`s so the `Promise` edge
// can map each one to its fixed `TelegramImportError`; they carry no data,
// so no Telegram text (and no token) can ride along.
class TelegramUnreachable extends Data.TaggedError('TelegramUnreachable') {}

class TelegramRateLimited extends Data.TaggedError('TelegramRateLimited') {}

class TelegramPackNotFound extends Data.TaggedError('TelegramPackNotFound') {}

class TelegramInvalidToken extends Data.TaggedError('TelegramInvalidToken') {}

class TelegramFileTooLarge extends Data.TaggedError('TelegramFileTooLarge') {}

class TelegramInvalidPath extends Data.TaggedError('TelegramInvalidPath') {}

type TelegramFailure =
  | TelegramUnreachable
  | TelegramRateLimited
  | TelegramPackNotFound
  | TelegramInvalidToken
  | TelegramFileTooLarge
  | TelegramInvalidPath;

/** The fixed message every unreachable/unknown failure reports. */
const UNREACHABLE_MESSAGE = 'Could not reach Telegram, try again later';

/** The fixed `code` and message each internal failure maps to at the edge. */
function failureToImportError(failure: TelegramFailure): {
  code: TelegramImportErrorCode;
  message: string;
} {
  switch (failure._tag) {
    case 'TelegramUnreachable':
      return { code: 'try_later', message: UNREACHABLE_MESSAGE };
    case 'TelegramRateLimited':
      return { code: 'try_later', message: 'Telegram is rate limiting imports, try again later' };
    case 'TelegramPackNotFound':
      return { code: 'pack_not_found', message: 'That Telegram sticker pack was not found' };
    case 'TelegramInvalidToken':
      return { code: 'invalid_token', message: 'Telegram rejected the bot token' };
    case 'TelegramFileTooLarge':
      return { code: 'file_too_large', message: 'A Telegram file was larger than the 1 MiB limit' };
    case 'TelegramInvalidPath':
      return { code: 'invalid_request', message: 'A Telegram file path was not usable' };
  }
}

/** Builds `https://api.telegram.org/bot<token>/<method>`. The token stays inside the client. */
function botMethodUrl(token: string, method: string): URL {
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  assertTelegramUrl(url);
  return url;
}

/** Builds `https://api.telegram.org/file/bot<token>/<filePath>`. */
function botFileUrl(token: string, filePath: string): URL {
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

function scrubTokenText(token: string, text: string): string {
  if (token !== '' && text.includes(token)) {
    return text.split(token).join('[redacted]');
  }
  return text;
}

interface TelegramApiEnvelope {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const stickerFileSchema = {
  isAnimated(value: unknown): boolean {
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return record.is_animated === true || record.is_video === true;
    }
    return false;
  },
};

function toStickerEntry(raw: unknown): TelegramStickerEntry | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const fileId = typeof record.file_id === 'string' ? record.file_id : '';
  const sourceId = typeof record.file_unique_id === 'string' ? record.file_unique_id : '';
  if (fileId === '' || sourceId === '') {
    return undefined;
  }
  const emoji = typeof record.emoji === 'string' && record.emoji !== '' ? record.emoji : null;
  return { sourceId, fileId, emoji, animated: stickerFileSchema.isAnimated(raw) };
}

function toStickerSet(name: string, raw: unknown): TelegramStickerSet {
  if (raw === null || typeof raw !== 'object') {
    throw new TelegramPackNotFound();
  }
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === 'string' && record.title !== '' ? record.title : name;
  const isCustomEmoji = record.sticker_type === 'custom_emoji';
  const rawStickers = Array.isArray(record.stickers) ? record.stickers : [];
  const stickers: TelegramStickerEntry[] = [];
  for (const entry of rawStickers) {
    const parsed = toStickerEntry(entry);
    if (parsed !== undefined) {
      stickers.push(parsed);
    }
  }
  return { name, title, isCustomEmoji, stickers };
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
const fetchCappedEffect = Effect.fnUntraced(function* (
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
const callMethodEffect = Effect.fnUntraced(function* (
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

/**
 * The real Telegram client: `fetch` only to the two hard-coded Telegram
 * URLs, no redirects, 10 s timeout, 1 MiB cap per file, 256 KiB cap per
 * method JSON envelope. Telegram's 429 (`retry_after`, capped at 5 s) is
 * retried once, then reported as `try_later`; an unknown bot token (401 on
 * any method) is `invalid_token` so the integrations page can verify a
 * pasted key; a missing pack is `pack_not_found`; no other Telegram text is
 * passed through.
 */
export function createTelegramClient(token: string, fetchFn: FetchFn = fetch): TelegramClient {
  // The `Promise` edge: map each internal failure to its fixed
  // `TelegramImportError`. The message is scrubbed defensively: the mapping
  // is fixed strings, but a future edit must not be able to leak the token.
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
        // The old `scrubbed()` catch-all: a defect must never escape as a
        // `FiberFailure` (which would carry the token-bearing URL). After
        // `catchTags` the only typed failures are the mapped
        // `TelegramImportError`s, so those pass through unchanged; every
        // other cause becomes the fixed `try_later`. Interruption belongs to
        // the caller and is rethrown unchanged.
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
    // `getMe` verifies a bot token: a 401 is `invalid_token`, anything
    // else failing is `try_later`. Only the owner-gated integrations route
    // calls this; the import flow never needs it.
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
