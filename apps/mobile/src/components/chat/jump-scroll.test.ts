import { describe, expect, it } from 'vitest';

import { JUMP_SCROLL_RETRY_MS, startJumpScroll, type JumpScrollTimers } from './jump-scroll';

interface DeferredClock {
  timers: JumpScrollTimers;
  /** Fires every pending retry with a delay of at most `ms`, in order. */
  runUpTo: (ms: number) => void;
  pending: () => number;
}

function deferredClock(): DeferredClock {
  const pending = new Map<number, { ms: number; callback: () => void }>();
  let next = 1;
  return {
    timers: {
      setTimeout: (callback, ms) => {
        const handle = next;
        next += 1;
        pending.set(handle, { ms, callback });
        return handle;
      },
      clearTimeout: (handle) => {
        pending.delete(handle as number);
      },
    },
    runUpTo: (ms) => {
      const due = [...pending.entries()]
        .filter(([, entry]) => entry.ms <= ms)
        .sort((left, right) => left[1].ms - right[1].ms);
      for (const [handle, entry] of due) {
        pending.delete(handle);
        entry.callback();
      }
    },
    pending: () => pending.size,
  };
}

describe('startJumpScroll', () => {
  it('retries on the mount-scroll delays', () => {
    expect([...JUMP_SCROLL_RETRY_MS]).toEqual([80, 200, 400]);
  });

  it('re-resolves the index on every retry, never scrolling to a stale row', () => {
    // The deferred finding: the jump target renders at index 2, then a new
    // message arrives within 400 ms and moves it to index 3. Retry timers
    // that captured the first index would scroll to the wrong row. The
    // target is confirmed only on the last retry, so a message arriving
    // mid-retry still moves the later attempts (an early confirm would
    // clear the target and cancel the remaining retries).
    let rows = ['m1', 'm2', 'target', 'm4'];
    const scrolled: number[] = [];
    let done = 0;
    const clock = deferredClock();
    const cancel = startJumpScroll({
      findIndex: () => rows.indexOf('target'),
      scrollToIndex: (index) => scrolled.push(index),
      onDone: () => {
        done += 1;
      },
      timers: clock.timers,
    });

    expect(scrolled).toEqual([2]);
    expect(done).toBe(0);

    rows = ['m0', 'm1', 'm2', 'target', 'm4'];
    clock.runUpTo(80);
    expect(scrolled).toEqual([2, 3]);
    expect(done).toBe(0);

    rows = ['m0', 'm1', 'm2', 'm2b', 'target', 'm4'];
    clock.runUpTo(200);
    expect(scrolled).toEqual([2, 3, 4]);
    expect(done).toBe(0);

    clock.runUpTo(400);
    expect(scrolled).toEqual([2, 3, 4, 4]);
    expect(done).toBe(1);
    expect(clock.pending()).toBe(0);
    cancel();
  });

  it('confirms immediately when there are no retries', () => {
    const scrolled: number[] = [];
    let done = 0;
    const clock = deferredClock();
    const cancel = startJumpScroll({
      findIndex: () => 0,
      scrollToIndex: (index) => scrolled.push(index),
      onDone: () => {
        done += 1;
      },
      delays: [],
      timers: clock.timers,
    });
    expect(scrolled).toEqual([0]);
    expect(done).toBe(1);
    cancel();
  });

  it('never fires a retry after cancel', () => {
    let rows = ['m1', 'target'];
    const scrolled: number[] = [];
    let done = 0;
    const clock = deferredClock();
    const cancel = startJumpScroll({
      findIndex: () => rows.indexOf('target'),
      scrollToIndex: (index) => scrolled.push(index),
      onDone: () => {
        done += 1;
      },
      timers: clock.timers,
    });
    expect(scrolled).toEqual([1]);
    cancel();
    rows = ['m0', 'm1', 'target'];
    clock.runUpTo(400);
    expect(scrolled).toEqual([1]);
    expect(done).toBe(0);
  });

  it('does nothing when the target is not loaded, and keeps the target set', () => {
    const scrolled: number[] = [];
    let done = 0;
    const clock = deferredClock();
    const cancel = startJumpScroll({
      findIndex: () => -1,
      scrollToIndex: (index) => scrolled.push(index),
      onDone: () => {
        done += 1;
      },
      timers: clock.timers,
    });

    expect(scrolled).toEqual([]);
    expect(done).toBe(0);
    expect(clock.pending()).toBe(0);
    cancel();
  });

  it('skips a retry when the target disappears, and cancels the rest', () => {
    let rows = ['m1', 'target'];
    const scrolled: number[] = [];
    const clock = deferredClock();
    const cancel = startJumpScroll({
      findIndex: () => rows.indexOf('target'),
      scrollToIndex: (index) => scrolled.push(index),
      onDone: () => {},
      timers: clock.timers,
    });
    expect(scrolled).toEqual([1]);

    rows = ['m1'];
    clock.runUpTo(400);
    expect(scrolled).toEqual([1]);

    cancel();
    expect(clock.pending()).toBe(0);
  });
});
