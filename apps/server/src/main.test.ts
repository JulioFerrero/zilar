import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { healthSnapshot } from './health-status';
import { emptyRunning, stopServer } from './main';

describe('stopServer', () => {
  it('marks draining, waits, then steps down before closing HTTP', async () => {
    const order: string[] = [];
    let drainingAtStepDown = false;
    const running = {
      ...emptyRunning(),
      drainMs: 40,
      leader: {
        stepDown: async () => {
          drainingAtStepDown = healthSnapshot().draining;
          order.push('stepDown');
        },
        close: async () => {
          order.push('close-lock');
        },
      },
      closeHttp: async () => {
        order.push('closeHttp');
      },
    };

    const started = Date.now();
    await Effect.runPromise(stopServer(running));
    const elapsed = Date.now() - started;

    expect(order).toEqual(['stepDown', 'closeHttp', 'close-lock']);
    // The drain waits before stepping down.
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(drainingAtStepDown).toBe(true);
  });
});
