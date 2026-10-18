// Telegram sticker-pack import: fetch a public pack through the Bot API and
// store its stickers as a private Zilar pack. Only `api.telegram.org` and its
// file host are contacted, over HTTPS, no redirects, 10 s timeout, 1 MiB per
// download; URLs are built inside the client and the only caller value is
// the validated pack name. The bot token never reaches logs, errors or
// responses: messages are fixed strings and a scrub pass rewrites leaks. A
// 429 is one sleep and one retry.
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
