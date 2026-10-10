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
//
// The code lives in `./telegram/`: `pack-input` parses the pack link,
// `errors` holds the codes and the token scrub, `set` parses a sticker set,
// `transport` does the capped reads, and `client` wires them together.
export {
  TELEGRAM_API_HOST,
  TELEGRAM_IMPORT_MAX_BYTES,
  TELEGRAM_IMPORT_TIMEOUT_MS,
  TELEGRAM_JSON_MAX_BYTES,
  TelegramImportError,
  type TelegramImportErrorCode,
} from './telegram/errors';
export { parseTelegramPackInput } from './telegram/pack-input';
export type { TelegramClient, TelegramStickerEntry, TelegramStickerSet } from './telegram/set';
export { createTelegramClient } from './telegram/client';
