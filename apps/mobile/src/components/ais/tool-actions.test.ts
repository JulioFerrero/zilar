import { describe, expect, it } from 'vitest';

import { ToolsApiError } from '@/lib/tools-api';

import {
  CHANGE_FORBIDDEN_MESSAGE,
  DELETE_FAILED_MESSAGE,
  MAX_RUN_INPUT_BYTES,
  REVERT_FAILED_MESSAGE,
  RUN_FAILED_MESSAGE,
  RUN_FORBIDDEN_MESSAGE,
  RUN_INPUT_INVALID_MESSAGE,
  RUN_INPUT_TOO_BIG_MESSAGE,
  RUN_RATE_LIMITED_MESSAGE,
  RUN_UNAVAILABLE_MESSAGE,
  changeErrorMessage,
  fetchCountText,
  parseRunInput,
  runErrorMessage,
} from './tool-actions';

describe('parseRunInput', () => {
  it('sends no input for empty text', () => {
    expect(parseRunInput('')).toEqual({ ok: true });
    expect(parseRunInput('   ')).toEqual({ ok: true });
  });

  it('parses valid JSON', () => {
    expect(parseRunInput('{"city": "Madrid"}')).toEqual({ ok: true, input: { city: 'Madrid' } });
  });

  it('rejects invalid JSON', () => {
    expect(parseRunInput('{city}')).toEqual({ ok: false, message: RUN_INPUT_INVALID_MESSAGE });
  });

  it('accepts exactly 4096 bytes and rejects 4097 bytes', () => {
    expect(MAX_RUN_INPUT_BYTES).toBe(4096);
    const exact = `"${'a'.repeat(4094)}"`;
    expect(new TextEncoder().encode(exact).length).toBe(4096);
    expect(parseRunInput(exact)).toEqual({ ok: true, input: 'a'.repeat(4094) });
    expect(parseRunInput(`"${'a'.repeat(4095)}"`)).toEqual({
      ok: false,
      message: RUN_INPUT_TOO_BIG_MESSAGE,
    });
  });

  it('counts a multi-byte character by its UTF-8 length', () => {
    const text = `"${'é'.repeat(2047)}"`;
    expect(new TextEncoder().encode(text).length).toBe(4096);
    expect(parseRunInput(text).ok).toBe(true);
    expect(parseRunInput(`"${'é'.repeat(2048)}"`)).toEqual({
      ok: false,
      message: RUN_INPUT_TOO_BIG_MESSAGE,
    });
  });
});

describe('runErrorMessage', () => {
  it('maps 429 to the rate limit line', () => {
    expect(runErrorMessage(new ToolsApiError(429, 'rate_limited', 'Too many'))).toBe(
      RUN_RATE_LIMITED_MESSAGE,
    );
  });

  it('maps 403 and 404 to the forbidden line', () => {
    expect(runErrorMessage(new ToolsApiError(403, 'forbidden', 'no'))).toBe(RUN_FORBIDDEN_MESSAGE);
    expect(runErrorMessage(new ToolsApiError(404, 'not_found', 'no'))).toBe(RUN_FORBIDDEN_MESSAGE);
  });

  it('maps 501 to the unavailable line', () => {
    expect(runErrorMessage(new ToolsApiError(501, 'runner_unavailable', 'no'))).toBe(
      RUN_UNAVAILABLE_MESSAGE,
    );
  });

  it('maps anything else to the generic line and never the server text', () => {
    expect(runErrorMessage(new ToolsApiError(500, 'boom', 'server exploded'))).toBe(
      RUN_FAILED_MESSAGE,
    );
    expect(runErrorMessage(new Error('server exploded'))).toBe(RUN_FAILED_MESSAGE);
  });
});

describe('changeErrorMessage', () => {
  it('maps 403 and 404 to the forbidden line', () => {
    expect(
      changeErrorMessage(new ToolsApiError(403, 'forbidden', 'no'), REVERT_FAILED_MESSAGE),
    ).toBe(CHANGE_FORBIDDEN_MESSAGE);
    expect(
      changeErrorMessage(new ToolsApiError(404, 'not_found', 'no'), DELETE_FAILED_MESSAGE),
    ).toBe(CHANGE_FORBIDDEN_MESSAGE);
  });

  it('uses the fallback for anything else', () => {
    expect(
      changeErrorMessage(new ToolsApiError(500, 'boom', 'server exploded'), REVERT_FAILED_MESSAGE),
    ).toBe(REVERT_FAILED_MESSAGE);
    expect(changeErrorMessage(new Error('server exploded'), DELETE_FAILED_MESSAGE)).toBe(
      DELETE_FAILED_MESSAGE,
    );
  });
});

describe('fetchCountText', () => {
  it('uses fetch for 1 and fetches otherwise', () => {
    expect(fetchCountText(1)).toBe('1 fetch');
    expect(fetchCountText(0)).toBe('0 fetches');
    expect(fetchCountText(2)).toBe('2 fetches');
  });
});
