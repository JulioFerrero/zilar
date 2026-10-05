import { describe, expect, it } from 'vitest';

import { StickersApiError } from '../../lib/stickers-api';

import {
  CUSTOM_EMOJI_ERROR,
  EMPTY_INPUT_ERROR,
  GENERIC_IMPORT_ERROR,
  importedCountLine,
  INVALID_LINK_ERROR,
  PACK_LIMIT_ERROR,
  PACK_NOT_FOUND_ERROR,
  RATE_LIMITED_ERROR,
  skippedAnimatedLine,
  skippedInvalidLine,
  telegramImportFailure,
  TRY_LATER_ERROR,
} from './telegram-import';

describe('telegramImportFailure', () => {
  it('switches import_unavailable to the not-set-up state', () => {
    expect(
      telegramImportFailure(new StickersApiError(501, 'import_unavailable', 'no token')),
    ).toEqual({ kind: 'not-set-up' });
  });

  it('switches token_invalid to the token-rejected state', () => {
    expect(telegramImportFailure(new StickersApiError(409, 'token_invalid', 'rejected'))).toEqual({
      kind: 'token-rejected',
    });
  });

  it('maps the rate limit by status and by code', () => {
    expect(telegramImportFailure(new StickersApiError(429, 'rate_limited', 'slow'))).toEqual({
      kind: 'form',
      error: RATE_LIMITED_ERROR,
    });
    expect(telegramImportFailure(new StickersApiError(429, 'request_failed', 'slow'))).toEqual({
      kind: 'form',
      error: RATE_LIMITED_ERROR,
    });
  });

  it('maps every code to its fixed sentence', () => {
    const cases: Array<[string, string]> = [
      ['invalid_request', INVALID_LINK_ERROR],
      ['pack_not_found', PACK_NOT_FOUND_ERROR],
      ['custom_emoji_unsupported', CUSTOM_EMOJI_ERROR],
      ['try_later', TRY_LATER_ERROR],
      ['pack_limit', PACK_LIMIT_ERROR],
    ];
    for (const [code, sentence] of cases) {
      expect(telegramImportFailure(new StickersApiError(400, code, 'server text'))).toEqual({
        kind: 'form',
        error: sentence,
      });
    }
  });

  it('maps anything else, including network errors, to the generic sentence', () => {
    expect(telegramImportFailure(new StickersApiError(500, 'internal_error', 'boom'))).toEqual({
      kind: 'form',
      error: GENERIC_IMPORT_ERROR,
    });
    expect(telegramImportFailure(new StickersApiError(0, 'network_error', 'down'))).toEqual({
      kind: 'form',
      error: GENERIC_IMPORT_ERROR,
    });
    expect(telegramImportFailure(new Error('down'))).toEqual({
      kind: 'form',
      error: GENERIC_IMPORT_ERROR,
    });
    expect(telegramImportFailure(null)).toEqual({ kind: 'form', error: GENERIC_IMPORT_ERROR });
  });

  it('keeps the empty-field sentence exported for the sheet', () => {
    expect(EMPTY_INPUT_ERROR).toBe('Paste a pack link or name first.');
  });
});

describe('count sentences', () => {
  it('uses the singular and plural added forms', () => {
    expect(importedCountLine(1)).toBe('1 sticker added');
    expect(importedCountLine(0)).toBe('0 stickers added');
    expect(importedCountLine(5)).toBe('5 stickers added');
  });

  it('uses the singular and plural skipped forms', () => {
    expect(skippedAnimatedLine(1)).toBe('1 animated sticker was skipped');
    expect(skippedAnimatedLine(3)).toBe('3 animated stickers were skipped');
    expect(skippedInvalidLine(1)).toBe('1 file was skipped as invalid');
    expect(skippedInvalidLine(2)).toBe('2 files were skipped as invalid');
  });
});
