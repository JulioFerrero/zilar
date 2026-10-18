import { describe, expect, it } from 'vitest';
import { handleSaveMessage } from './handle-errors';

const base = { message: 'server message' };

describe('handleSaveMessage', () => {
  it('names the invalid rule', () => {
    expect(handleSaveMessage({ ...base, code: 'handle_invalid' }, 'handle')).toBe(
      'Use 3–32 characters: letters, numbers and _, starting with a letter.',
    );
  });

  it('uses the caller’s noun for reserved and taken', () => {
    expect(handleSaveMessage({ ...base, code: 'handle_reserved' }, 'username')).toBe(
      'That username is reserved. Try another.',
    );
    expect(handleSaveMessage({ ...base, code: 'handle_taken' }, 'handle')).toBe(
      'That handle was just taken. Try another.',
    );
  });

  it('shows the next-change date when it parses', () => {
    const nextChangeAt = '2026-11-01T10:00:00.000Z';
    expect(
      handleSaveMessage({ ...base, code: 'handle_change_too_soon', nextChangeAt }, 'handle'),
    ).toBe(`Next change possible on ${new Date(nextChangeAt).toLocaleDateString()}`);
  });

  it('falls back to the message when the date is missing or invalid', () => {
    expect(handleSaveMessage({ ...base, code: 'handle_change_too_soon' }, 'handle')).toBe(
      'server message',
    );
    expect(
      handleSaveMessage(
        { ...base, code: 'handle_change_too_soon', nextChangeAt: 'not a date' },
        'handle',
      ),
    ).toBe('server message');
  });

  it('maps the rate limit', () => {
    expect(handleSaveMessage({ ...base, code: 'rate_limited' }, 'handle')).toBe(
      'Too many tries — wait a little and try again.',
    );
  });

  it('leaves other codes to the caller', () => {
    expect(handleSaveMessage({ ...base, code: 'unknown_error' }, 'handle')).toBeUndefined();
  });
});
