import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortsTest } from './ports';
import { makeLifetime } from './runtime';
import { readPorts } from './ports';

function lifetime() {
  return makeLifetime(readPorts(PortsTest()));
}

describe('Lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a forked task at once, so its synchronous part runs inline', () => {
    const rt = lifetime();
    const seen: string[] = [];
    rt.fork(Effect.sync(() => seen.push('ran')));
    expect(seen).toEqual(['ran']);
    rt.closeStore();
  });

  it('closing the store interrupts every fiber and leaves no timer behind', async () => {
    const rt = lifetime();
    const fired = vi.fn();
    rt.forkKeyed('a', Effect.sleep(1_000).pipe(Effect.andThen(Effect.sync(fired))));
    const session = rt.beginSession();
    session.fork(Effect.sleep(2_000).pipe(Effect.andThen(Effect.sync(fired))));
    expect(vi.getTimerCount()).toBe(2);

    rt.closeStore();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).not.toHaveBeenCalled();
    expect(rt.session()).toBeUndefined();
  });

  it('a task with the same key replaces the running one, and cancel stops it', async () => {
    const rt = lifetime();
    const fired = vi.fn();
    rt.forkKeyed('k', Effect.sleep(1_000).pipe(Effect.andThen(Effect.sync(() => fired('first')))));
    rt.forkKeyed('k', Effect.sleep(1_000).pipe(Effect.andThen(Effect.sync(() => fired('second')))));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fired.mock.calls).toEqual([['second']]);

    rt.forkKeyed('k', Effect.sleep(1_000).pipe(Effect.andThen(Effect.sync(() => fired('third')))));
    expect(rt.has('k')).toBe(true);
    rt.cancel('k');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fired).toHaveBeenCalledTimes(1);
    rt.closeStore();
  });

  it('a new session closes the previous one and keeps the store fibers', async () => {
    const rt = lifetime();
    const fired = vi.fn();
    rt.forkKeyed(
      'store',
      Effect.sleep(1_000).pipe(Effect.andThen(Effect.sync(() => fired('store')))),
    );
    const first = rt.beginSession();
    first.fork(Effect.sleep(1_000).pipe(Effect.andThen(Effect.sync(() => fired('first')))));
    const second = rt.beginSession();
    expect(rt.session()).toBe(second);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fired.mock.calls).toEqual([['store']]);
    rt.closeStore();
  });

  it('a failing task is logged and does not stop the others', async () => {
    const rt = lifetime();
    // The default logger writes the failure to stdout; keep the test output clean.
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fired = vi.fn();
    rt.fork(Effect.die(new Error('boom')));
    rt.fork(Effect.sync(fired));
    expect(fired).toHaveBeenCalledTimes(1);
    expect(out.mock.calls.join('')).toContain('chat store task failed');
    out.mockRestore();
    rt.closeStore();
  });
});
