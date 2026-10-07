import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRecoveryStuckTimer, type ActionGateway } from './gateway';

// The recovery loop's timer is now an Effect fiber. These tests cover the
// loop itself: first run after one interval, a failed tick is logged and
// the loop survives, and `close()` stops it.
function captureLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

function gatewayWith(recoverStuck: () => Promise<void>): ActionGateway {
  return {
    request: () => Promise.reject(new Error('unused')),
    onApprovalDecided: () => Promise.resolve(),
    recoverStuck,
    listActions: () => [],
  };
}

describe('action gateway recovery effect loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs after one interval, logs a failure, and survives to the next tick', async () => {
    const logger = captureLogger();
    let calls = 0;
    const handle = startRecoveryStuckTimer({
      gateway: gatewayWith(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve();
      }),
      logger,
      intervalMs: 1_000,
    });

    // Nothing runs before the first interval.
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(0);

    // The first tick fails; the failure is logged once.
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith({ err: 'Error' }, 'recoverStuck tick failed');

    // The loop keeps going after the failure.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    expect(logger.error).toHaveBeenCalledTimes(1);

    handle.close();
  });

  it('stops firing after close()', async () => {
    let calls = 0;
    const handle = startRecoveryStuckTimer({
      gateway: gatewayWith(() => {
        calls += 1;
        return Promise.resolve();
      }),
      logger: captureLogger(),
      intervalMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);

    handle.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
  });
});
