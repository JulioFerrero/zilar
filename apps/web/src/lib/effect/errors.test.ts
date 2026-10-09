import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { ApiFailure, isApiFailureCode, toApiFailure } from '@/lib/effect/errors';

describe('toApiFailure (T-0759)', () => {
  it('copies an ApiError field for field and keeps the message byte-identical', () => {
    const detail = { nextChangeAt: '2026-10-09T10:00:00Z', retryAfter: 30 };
    const apiError = new ApiError(429, 'rate_limited', 'Too many requests, slow down', detail);

    const failure = toApiFailure(apiError);

    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure._tag).toBe('ApiFailure');
    expect(failure.status).toBe(429);
    expect(failure.code).toBe('rate_limited');
    expect(failure.message).toBe('Too many requests, slow down');
    expect(failure.detail).toEqual(detail);
  });

  it('maps a network ApiError (status 0) without changing it', () => {
    const failure = toApiFailure(new ApiError(0, 'network_error', 'Could not reach the server'));

    expect(failure.status).toBe(0);
    expect(failure.code).toBe('network_error');
    expect(failure.message).toBe('Could not reach the server');
  });

  it('maps an unknown throw to unknown_error and never puts its text in the message', () => {
    const failure = toApiFailure(new Error('db password is hunter2 at 10.0.0.5'));

    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure.status).toBe(0);
    expect(failure.code).toBe('unknown_error');
    expect(failure.message).toBe('Something went wrong');
    expect(failure.message).not.toContain('hunter2');
    expect(failure.detail).toEqual({});
  });

  it('maps a thrown string and undefined the same way', () => {
    for (const cause of ['raw server text', undefined, null, 42]) {
      const failure = toApiFailure(cause);
      expect(failure.code).toBe('unknown_error');
      expect(failure.message).toBe('Something went wrong');
    }
  });
});

describe('isApiFailureCode (T-0759)', () => {
  it('matches only the failure with that code', () => {
    const matches = isApiFailureCode('not_found');

    expect(
      matches(new ApiFailure({ status: 404, code: 'not_found', message: 'x', detail: {} })),
    ).toBe(true);
    expect(
      matches(new ApiFailure({ status: 409, code: 'conflict', message: 'x', detail: {} })),
    ).toBe(false);
  });
});
