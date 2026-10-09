import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schedule } from './timers';

describe('schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once after the delay', async () => {
    const run = vi.fn();
    schedule(1000, run);
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs inside the timer tick, like setTimeout', () => {
    const run = vi.fn();
    schedule(1000, run);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancel stops it and drops the pending timer at once', async () => {
    const run = vi.fn();
    const cancel = schedule(1000, run);
    expect(vi.getTimerCount()).toBe(1);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
  });

  it('cancel twice, or after it fired, is harmless', async () => {
    const run = vi.fn();
    const cancel = schedule(1000, run);
    cancel();
    cancel();
    const fired = vi.fn();
    const cancelFired = schedule(10, fired);
    await vi.advanceTimersByTimeAsync(10);
    expect(fired).toHaveBeenCalledTimes(1);
    cancelFired();
    cancelFired();
    expect(run).not.toHaveBeenCalled();
  });

  // The rethrow is a fake-clock `setTimeout`, so it surfaces from the call
  // that advances the clock (the same place a throwing `setTimeout` callback
  // surfaces in these tests) and never reaches vitest's unhandled-error report.
  it('surfaces a throwing run as an uncaught exception and keeps later timers working', async () => {
    const boom = new Error('boom');
    schedule(10, () => {
      throw boom;
    });
    const later = vi.fn();
    schedule(20, later);
    await expect(vi.advanceTimersByTimeAsync(15)).rejects.toBe(boom);
    expect(later).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('a run may cancel another timer', async () => {
    const other = vi.fn();
    const cancelOther = schedule(20, other);
    schedule(10, cancelOther);
    await vi.advanceTimersByTimeAsync(30);
    expect(other).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a run may cancel its own timer, then continue and schedule again', async () => {
    const calls: string[] = [];
    let cancel = schedule(10, () => {
      cancel();
      calls.push('first');
      cancel = schedule(10, () => calls.push('second'));
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual(['first', 'second']);
  });
});
