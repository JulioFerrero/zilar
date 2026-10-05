import { describe, expect, it } from 'vitest';
import { DEFAULT_INVITE_MAX_USES, DEFAULT_INVITE_TTL_DAYS } from './invites';
import { parseInviteCliArgs } from './invite-cli';

describe('parseInviteCliArgs', () => {
  it('applies the documented defaults', () => {
    expect(parseInviteCliArgs([])).toEqual({
      uses: DEFAULT_INVITE_MAX_USES,
      days: DEFAULT_INVITE_TTL_DAYS,
    });
  });

  it('parses space-separated flags', () => {
    expect(parseInviteCliArgs(['--uses', '5', '--days', '30'])).toEqual({ uses: 5, days: 30 });
  });

  it('parses equals-separated flags', () => {
    expect(parseInviteCliArgs(['--uses=2', '--days=3'])).toEqual({ uses: 2, days: 3 });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseInviteCliArgs(['--nope'])).toThrow(/Unknown argument/);
  });

  it('rejects a missing value', () => {
    expect(() => parseInviteCliArgs(['--uses'])).toThrow(/Missing value/);
  });

  it('rejects out-of-range values', () => {
    expect(() => parseInviteCliArgs(['--uses', '0'])).toThrow();
    expect(() => parseInviteCliArgs(['--days', '9999'])).toThrow();
  });
});
