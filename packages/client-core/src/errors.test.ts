import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { runApiAbortable } from './api-effect';
import { ApiFailure, isApiFailureCode, toApiFailure } from './errors';

class ApiErrorLike {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly detail: Record<string, unknown>,
  ) {}
}

describe('toApiFailure', () => {
  it('keeps the fields of an ApiError-like class instance', () => {
    const failure = toApiFailure(
      new ApiErrorLike(409, 'conflict', 'Already exists', { field: 'name' }),
    );
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure.status).toBe(409);
    expect(failure.code).toBe('conflict');
    expect(failure.message).toBe('Already exists');
    expect(failure.detail).toEqual({ field: 'name' });
  });

  it('accepts a plain look-alike object', () => {
    const failure = toApiFailure({ status: 404, code: 'not_found', message: 'Missing' });
    expect(failure.status).toBe(404);
    expect(failure.code).toBe('not_found');
    expect(failure.message).toBe('Missing');
    expect(failure.detail).toEqual({});
  });

  it('turns a plain Error into a generic failure and keeps no thrown text', () => {
    const failure = toApiFailure(new Error('secret detail'));
    expect(failure.status).toBe(0);
    expect(failure.code).toBe('unknown_error');
    expect(failure.message).toBe('Something went wrong');
    expect(failure.detail).toEqual({});
  });

  it('turns null into a generic failure', () => {
    expect(toApiFailure(null).code).toBe('unknown_error');
  });

  it('replaces a non-record detail with an empty record', () => {
    expect(
      toApiFailure({ status: 500, code: 'boom', message: 'Boom', detail: 'text' }).detail,
    ).toEqual({});
  });

  it('matches a failure by code', () => {
    const failure = new ApiFailure({ status: 403, code: 'forbidden', message: 'No', detail: {} });
    expect(isApiFailureCode('forbidden')(failure)).toBe(true);
    expect(isApiFailureCode('not_found')(failure)).toBe(false);
  });
});

describe('runApiAbortable', () => {
  it('rejects with an AbortError when the signal is already aborted, and never runs the effect', async () => {
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    const effect = Effect.sync(() => {
      ran = true;
      return 'value';
    });
    await expect(runApiAbortable(effect, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(ran).toBe(false);
  });

  it('rejects with an AbortError when the signal fires during the effect', async () => {
    const controller = new AbortController();
    let started = false;
    const effect = Effect.promise(
      () =>
        new Promise<string>((resolve) => {
          started = true;
          controller.abort();
          setTimeout(() => resolve('value'), 0);
        }),
    );
    await expect(runApiAbortable(effect, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(started).toBe(true);
  });

  it('rejects with an AbortError when the signal fires before the value is returned', async () => {
    const controller = new AbortController();
    const effect = Effect.sync(() => {
      queueMicrotask(() => controller.abort());
      return 'value';
    });
    await expect(runApiAbortable(effect, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('keeps a normal failure', async () => {
    const failure = new ApiFailure({ status: 500, code: 'boom', message: 'Boom', detail: {} });
    await expect(runApiAbortable(Effect.fail(failure))).rejects.toBe(failure);
  });

  it('returns the value when the signal never fires', async () => {
    await expect(runApiAbortable(Effect.succeed(7), new AbortController().signal)).resolves.toBe(7);
  });
});
