import { Context, Effect, Fiber } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLifetime } from './lifetime';

function lifetime() {
  return makeLifetime(Context.empty());
}

describe('Lifetime (core)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a forked task at once and returns its fiber', async () => {
    const rt = lifetime();
    const seen: string[] = [];
    const fiber = rt.fork(Effect.sync(() => seen.push('ran')));
    expect(seen).toEqual(['ran']);
    await Effect.runPromise(Fiber.await(fiber));
    rt.closeStore();
  });

  it('forkKeyed returns the fiber, and awaiting it sees the task finish', async () => {
    const rt = lifetime();
    const done = vi.fn();
    const fiber = rt.forkKeyed('boot', Effect.sleep(500).pipe(Effect.andThen(Effect.sync(done))));
    expect(rt.has('boot')).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    await Effect.runPromise(Fiber.await(fiber));
    expect(done).toHaveBeenCalledTimes(1);
    rt.closeStore();
  });

  it('ending the store runs its finalizers once and leaves no timer behind', async () => {
    const rt = lifetime();
    const finalized = vi.fn();
    rt.onStoreClose(Effect.sync(finalized));
    const session = rt.beginSession();
    session.onClose(Effect.sync(finalized));
    rt.forkKeyed('k', Effect.sleep(1_000));
    session.fork(Effect.sleep(2_000));
    expect(vi.getTimerCount()).toBe(2);

    rt.closeStore();
    rt.closeStore();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(finalized).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a closed session reads as closed, and a new one is open', () => {
    const rt = lifetime();
    const first = rt.beginSession();
    expect(first.isOpen()).toBe(true);
    const second = rt.beginSession();
    expect(first.isOpen()).toBe(false);
    expect(second.isOpen()).toBe(true);
    expect(rt.isStoreOpen()).toBe(true);

    rt.closeStore();
    expect(second.isOpen()).toBe(false);
    expect(rt.isStoreOpen()).toBe(false);
  });

  it('a session finalizer runs when a newer session replaces it, not the store ones', async () => {
    const rt = lifetime();
    const sessionDone = vi.fn();
    const storeDone = vi.fn();
    rt.onStoreClose(Effect.sync(storeDone));
    rt.beginSession().onClose(Effect.sync(sessionDone));
    rt.beginSession();
    await vi.advanceTimersByTimeAsync(0);
    expect(sessionDone).toHaveBeenCalledTimes(1);
    expect(storeDone).not.toHaveBeenCalled();
    rt.closeStore();
  });

  it('does not run a rollback handler for an interrupted fiber', async () => {
    const rt = lifetime();
    const catchCause = vi.fn();
    const catchError = vi.fn();
    rt.fork(Effect.never.pipe(Effect.catchCause(() => Effect.sync(catchCause))));
    rt.fork(Effect.never.pipe(Effect.catch(() => Effect.sync(catchError))));
    const session = rt.beginSession();
    session.fork(Effect.never.pipe(Effect.catchCause(() => Effect.sync(catchCause))));
    rt.beginSession();
    rt.closeStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(catchCause).not.toHaveBeenCalled();
    expect(catchError).not.toHaveBeenCalled();
  });

  it('a failing task is logged and does not stop the others', async () => {
    const rt = lifetime();
    const ran = vi.fn();
    rt.fork(Effect.fail('boom'));
    rt.fork(Effect.sync(ran));
    await vi.advanceTimersByTimeAsync(0);
    expect(ran).toHaveBeenCalledTimes(1);
    rt.closeStore();
  });
});
