import { StickersApiError } from '../../lib/stickers-api';

/**
 * The pure parts of the Telegram import sheet (T-0207): the error-to-state
 * mapping and the count sentences, tested without rendering. Copy follows
 * `docs/design/briefs/T-0207-telegram-import.md` section 6 exactly.
 */

export const EMPTY_INPUT_ERROR = 'Paste a pack link or name first.';
export const INVALID_LINK_ERROR = 'That does not look like a Telegram sticker pack link or name.';
export const PACK_NOT_FOUND_ERROR = 'That Telegram sticker pack was not found.';
export const CUSTOM_EMOJI_ERROR = 'Custom emoji sets cannot be imported as sticker packs.';
export const TRY_LATER_ERROR = 'Telegram is busy. Try again later.';
export const RATE_LIMITED_ERROR = 'Too many imports. Try again in an hour.';
export const PACK_LIMIT_ERROR = 'You have reached the limit of 100 packs.';
export const GENERIC_IMPORT_ERROR = 'The import failed. Try again.';

export type TelegramImportSheetState =
  { kind: 'form'; error: string } | { kind: 'not-set-up' } | { kind: 'token-rejected' };

/** Maps an import failure to its sheet state (never server text). */
export function telegramImportFailure(error: unknown): TelegramImportSheetState {
  if (error instanceof StickersApiError) {
    if (error.status === 501 || error.code === 'import_unavailable') {
      return { kind: 'not-set-up' };
    }
    if (error.code === 'token_invalid') {
      return { kind: 'token-rejected' };
    }
    if (error.status === 429 || error.code === 'rate_limited') {
      return { kind: 'form', error: RATE_LIMITED_ERROR };
    }
    switch (error.code) {
      case 'invalid_request':
        return { kind: 'form', error: INVALID_LINK_ERROR };
      case 'pack_not_found':
        return { kind: 'form', error: PACK_NOT_FOUND_ERROR };
      case 'custom_emoji_unsupported':
        return { kind: 'form', error: CUSTOM_EMOJI_ERROR };
      case 'try_later':
        return { kind: 'form', error: TRY_LATER_ERROR };
      case 'pack_limit':
        return { kind: 'form', error: PACK_LIMIT_ERROR };
      default:
        return { kind: 'form', error: GENERIC_IMPORT_ERROR };
    }
  }
  return { kind: 'form', error: GENERIC_IMPORT_ERROR };
}

export function importedCountLine(imported: number): string {
  return imported === 1 ? '1 sticker added' : `${imported} stickers added`;
}

export function skippedAnimatedLine(skippedAnimated: number): string {
  return skippedAnimated === 1
    ? '1 animated sticker was skipped'
    : `${skippedAnimated} animated stickers were skipped`;
}

export function skippedInvalidLine(skippedInvalid: number): string {
  return skippedInvalid === 1
    ? '1 file was skipped as invalid'
    : `${skippedInvalid} files were skipped as invalid`;
}
