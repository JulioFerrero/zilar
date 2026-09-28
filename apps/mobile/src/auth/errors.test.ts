import { describe, expect, it } from 'vitest';

import { errorMessageFor, isEmailValid } from './errors';

describe('errorMessageFor', () => {
  it('maps a wrong code', () => {
    expect(errorMessageFor({ code: 'INVALID_OTP' })).toBe('Wrong code');
    expect(errorMessageFor({ code: 'OTP_EXPIRED' })).toBe('Wrong code');
  });

  it('maps the rate limit', () => {
    expect(errorMessageFor({ code: 'TOO_MANY_ATTEMPTS' })).toBe(
      'Too many attempts, try again later',
    );
    expect(errorMessageFor({ status: 429 })).toBe('Too many attempts, try again later');
  });

  it('falls back for anything else', () => {
    expect(errorMessageFor(undefined)).toBe('Something went wrong. Try again.');
    expect(errorMessageFor({ code: 'network_error' })).toBe('Something went wrong. Try again.');
  });
});

describe('isEmailValid', () => {
  it('accepts a normal address and rejects junk', () => {
    expect(isEmailValid('you@example.com')).toBe(true);
    expect(isEmailValid(' you@example.com ')).toBe(true);
    expect(isEmailValid('you@example')).toBe(false);
    expect(isEmailValid('you example.com')).toBe(false);
  });
});
