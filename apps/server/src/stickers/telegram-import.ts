// Telegram sticker-pack import (T-0123): fetch a public pack through the
// Telegram Bot API (`getStickerSet`, `getFile`) and store its static
// stickers as a private Galena pack.
//
// Security shape (mirrors the GIF proxy, T-0122):
// - Only two hosts are ever contacted: `api.telegram.org` (Bot API calls)
//   and `api.telegram.org/file` (file downloads) — both HTTPS, no redirects,
//   10 s timeout, 1 MiB cap per download. The URLs are built inside the
//   client; the only caller-controlled value is the validated pack name.
// - The bot token never reaches logs, errors or responses: every message is
//   a fixed string (or carries Telegram's numeric `retry_after` only), and a
//   `scrubToken` pass rewrites any accidental leak before an error is thrown.

export const TELEGRAM_API_HOST = 'api.telegram.org';
export const TELEGRAM_IMPORT_TIMEOUT_MS = 10_000;
export const TELEGRAM_IMPORT_MAX_BYTES = 1024 * 1024;

export type TelegramImportErrorCode =
  'pack_not_found' | 'try_later' | 'import_unavailable' | 'invalid_request' | 'file_too_large';

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
  getStickerSet(name: string): Promise<TelegramStickerSet>;
  downloadFile(fileId: string): Promise<Uint8Array>;
}

interface ApiCallOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

type FetchFn = typeof fetch;

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
    throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
  }
}

// `fetch` with a timeout that reads at most `maxBytes`: aborts as soon as
// the cap is passed, so a large file never has to fit in memory twice.
async function fetchCapped(
  url: URL,
  fetchFn: FetchFn,
  options: ApiCallOptions,
): Promise<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? TELEGRAM_IMPORT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? TELEGRAM_IMPORT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchFn(url.toString(), { signal: controller.signal, redirect: 'manual' });
  } catch (error) {
    clearTimeout(timer);
    throw scrubbed(error);
  }
  clearTimeout(timer);
  if (response.status >= 300 && response.status < 400) {
    await response.arrayBuffer().catch(() => {});
    throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
  }
  if (response.status < 200 || response.status >= 300) {
    await response.arrayBuffer().catch(() => {});
    throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
  }
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
        throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
      });
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        // A signal, not a fatal error: the importer skips and counts an
        // oversized file like any file that fails validation.
        throw new TelegramImportError(
          'file_too_large',
          'A Telegram file was larger than the 1 MiB limit',
        );
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

// Any error that escapes the network layer is replaced by a fixed message:
// Telegram's error text (and the token-bearing URL) must never reach the
// caller. Only `TelegramImportError` (already scrubbed) passes through.
function scrubbed(error: unknown): TelegramImportError {
  if (error instanceof TelegramImportError) {
    return error;
  }
  return new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
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
    throw new TelegramImportError('pack_not_found', 'That Telegram sticker pack was not found');
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

/**
 * The real Telegram client: `fetch` only to the two hard-coded Telegram
 * URLs, no redirects, 10 s timeout, 1 MiB cap per file. Telegram's 429
 * (`retry_after`, capped at 5 s) is retried once, then reported as
 * `try_later`; a missing pack is `pack_not_found`; no other Telegram text
 * is passed through.
 */
export function createTelegramClient(token: string, fetchFn: FetchFn = fetch): TelegramClient {
  async function callMethod(method: string, params: Record<string, string>): Promise<unknown> {
    const url = botMethodUrl(token, method);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEGRAM_IMPORT_TIMEOUT_MS);
    try {
      response = await fetchFn(url.toString(), { signal: controller.signal, redirect: 'manual' });
    } catch (error) {
      clearTimeout(timer);
      throw scrubbed(error);
    }
    clearTimeout(timer);
    if (response.status >= 300 && response.status < 400) {
      await response.arrayBuffer().catch(() => {});
      throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
    }
    let envelope: TelegramApiEnvelope;
    try {
      envelope = (await response.json()) as TelegramApiEnvelope;
    } catch {
      throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
    }
    if (envelope.ok) {
      return envelope.result;
    }
    const retryAfter =
      typeof envelope.parameters?.retry_after === 'number'
        ? Math.min(Math.max(envelope.parameters.retry_after, 0), 5)
        : undefined;
    if (response.status === 429 && retryAfter !== undefined && retryAfter > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return callMethodOnce(url);
    }
    if (response.status === 429) {
      throw new TelegramImportError(
        'try_later',
        'Telegram is rate limiting imports, try again later',
      );
    }
    if (response.status === 400 || envelope.error_code === 400) {
      throw new TelegramImportError('pack_not_found', 'That Telegram sticker pack was not found');
    }
    throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
  }

  // The single retry after a 429: exactly one more attempt, no further
  // retry even if Telegram answers 429 again.
  async function callMethodOnce(url: URL): Promise<unknown> {
    assertTelegramUrl(url);
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEGRAM_IMPORT_TIMEOUT_MS);
    try {
      response = await fetchFn(url.toString(), { signal: controller.signal, redirect: 'manual' });
    } catch (error) {
      clearTimeout(timer);
      throw scrubbed(error);
    }
    clearTimeout(timer);
    if (response.status >= 300 && response.status < 400) {
      await response.arrayBuffer().catch(() => {});
      throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
    }
    let envelope: TelegramApiEnvelope;
    try {
      envelope = (await response.json()) as TelegramApiEnvelope;
    } catch {
      throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
    }
    if (envelope.ok) {
      return envelope.result;
    }
    if (response.status === 400 || envelope.error_code === 400 || response.status === 429) {
      if (response.status === 400 || envelope.error_code === 400) {
        throw new TelegramImportError('pack_not_found', 'That Telegram sticker pack was not found');
      }
      throw new TelegramImportError(
        'try_later',
        'Telegram is rate limiting imports, try again later',
      );
    }
    throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
  }

  return {
    async getStickerSet(name: string): Promise<TelegramStickerSet> {
      try {
        const result = await callMethod('getStickerSet', { name });
        return toStickerSet(name, result);
      } catch (error) {
        if (error instanceof TelegramImportError) {
          throw error;
        }
        throw new TelegramImportError(
          'try_later',
          // The token is scrubbed defensively: the messages above are fixed
          // strings, but a future edit must not be able to leak it.
          scrubTokenText(token, 'Could not reach Telegram, try again later'),
        );
      }
    },

    async downloadFile(fileId: string): Promise<Uint8Array> {
      try {
        const info = (await callMethod('getFile', { file_id: fileId })) as Record<
          string,
          unknown
        > | null;
        const filePath =
          info !== null && typeof info === 'object' && typeof info.file_path === 'string'
            ? info.file_path
            : '';
        if (filePath === '' || filePath.includes('..')) {
          throw new TelegramImportError('invalid_request', 'A Telegram file path was not usable');
        }
        return await fetchCapped(botFileUrl(token, filePath), fetchFn, {});
      } catch (error) {
        if (error instanceof TelegramImportError) {
          throw error;
        }
        throw new TelegramImportError('try_later', 'Could not reach Telegram, try again later');
      }
    },
  };
}
