import { describe, expect, it } from 'vitest';
import { ApiFailure, isApiFailureCode, toApiFailure } from '@/lib/effect/errors';

// The shape of `ChatApiError` / `AisApiError` / `AuthApiError` in the *-api.ts
// modules, declared here so the test does not import native-bound modules.
class ModuleApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ModuleApiError';
    this.status = status;
    this.code = code;
  }
}

class OtherApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: Record<string, unknown>;

  constructor(status: number, code: string, message: string, detail: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

describe('toApiFailure (T-0800)', () => {
  it('copies a module api error field for field and keeps the message byte-identical', () => {
    const failure = toApiFailure(new ModuleApiError(429, 'rate_limited', 'Too many requests'));

    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure._tag).toBe('ApiFailure');
    expect(failure.status).toBe(429);
    expect(failure.code).toBe('rate_limited');
    expect(failure.message).toBe('Too many requests');
    expect(failure.detail).toEqual({});
  });

  it('reads any error class by shape, not one class, and keeps a record detail', () => {
    const detail = { retryAfter: 30 };
    const failure = toApiFailure(new OtherApiError(409, 'conflict', 'Name taken', detail));

    expect(failure.status).toBe(409);
    expect(failure.code).toBe('conflict');
    expect(failure.message).toBe('Name taken');
    expect(failure.detail).toEqual(detail);
  });

  it('reads a plain object with the three fields', () => {
    const failure = toApiFailure({ status: 404, code: 'not_found', message: 'Chat not found' });

    expect(failure.status).toBe(404);
    expect(failure.code).toBe('not_found');
    expect(failure.message).toBe('Chat not found');
  });

  it('maps a network error (status 0) without changing it', () => {
    const failure = toApiFailure(
      new ModuleApiError(0, 'network_error', 'Could not reach the server'),
    );

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

  it('maps a partly shaped object, a thrown string, undefined, null and a number the same way', () => {
    const causes: ReadonlyArray<unknown> = [
      { status: '500', code: 'server_error', message: 'x' },
      { status: 500, code: 7, message: 'x' },
      { status: 500, code: 'server_error' },
      'raw server text',
      undefined,
      null,
      42,
    ];
    for (const cause of causes) {
      const failure = toApiFailure(cause);
      expect(failure.code).toBe('unknown_error');
      expect(failure.message).toBe('Something went wrong');
    }
  });
});

describe('isApiFailureCode (T-0800)', () => {
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
