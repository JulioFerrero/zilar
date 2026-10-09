import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { ApiFailure } from '@/lib/effect/errors';
import { runWeb } from '@/lib/effect/runtime';

describe('fromApi (T-0759)', () => {
  it('succeeds with the value the call resolves to', async () => {
    const value = await Effect.runPromise(fromApi(() => Promise.resolve({ id: 'u1' })));

    expect(value).toEqual({ id: 'u1' });
  });

  it('fails with an ApiFailure that mirrors a rejected ApiError', async () => {
    const effect = fromApi(() => Promise.reject(new ApiError(404, 'not_found', 'Chat not found')));

    const failure = await Effect.runPromise(Effect.flip(effect));
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure.status).toBe(404);
    expect(failure.code).toBe('not_found');
    expect(failure.message).toBe('Chat not found');
  });

  it('fails with unknown_error when the call throws something else', async () => {
    const failure = await Effect.runPromise(
      Effect.flip(fromApi(() => Promise.reject(new TypeError('secret internals')))),
    );

    expect(failure.code).toBe('unknown_error');
    expect(failure.message).toBe('Something went wrong');
    expect(failure.message).not.toContain('secret internals');
  });

  it('aborts the signal when the Effect is interrupted', async () => {
    let observed: AbortSignal | undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const call = (signal: AbortSignal) => {
      observed = signal;
      markStarted();
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by the caller')));
      });
    };
    const controller = new AbortController();
    const run = Effect.runPromise(fromApi(call), { signal: controller.signal });

    await started;
    controller.abort();
    await run.catch(() => undefined);

    expect(observed?.aborted).toBe(true);
  });
});

describe('runWeb (T-0759)', () => {
  it('runs a trivial Effect and resolves its value', async () => {
    await expect(runWeb(Effect.succeed(3))).resolves.toBe(3);
  });
});
