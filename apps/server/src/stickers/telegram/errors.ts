import { Data } from 'effect';

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

// The internal failures. They are `Data.TaggedError`s so the `Promise` edge
// can map each one to its fixed `TelegramImportError`; they carry no data,
// so no Telegram text (and no token) can ride along.
export class TelegramUnreachable extends Data.TaggedError('TelegramUnreachable') {}

export class TelegramRateLimited extends Data.TaggedError('TelegramRateLimited') {}

export class TelegramPackNotFound extends Data.TaggedError('TelegramPackNotFound') {}

export class TelegramInvalidToken extends Data.TaggedError('TelegramInvalidToken') {}

export class TelegramFileTooLarge extends Data.TaggedError('TelegramFileTooLarge') {}

export class TelegramInvalidPath extends Data.TaggedError('TelegramInvalidPath') {}

export type TelegramFailure =
  | TelegramUnreachable
  | TelegramRateLimited
  | TelegramPackNotFound
  | TelegramInvalidToken
  | TelegramFileTooLarge
  | TelegramInvalidPath;

/** The fixed message every unreachable/unknown failure reports. */
export const UNREACHABLE_MESSAGE = 'Could not reach Telegram, try again later';

/** The fixed `code` and message each internal failure maps to at the edge. */
export function failureToImportError(failure: TelegramFailure): {
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

export function scrubTokenText(token: string, text: string): string {
  if (token !== '' && text.includes(token)) {
    return text.split(token).join('[redacted]');
  }
  return text;
}
