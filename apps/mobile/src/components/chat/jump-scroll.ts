/** A jump lands on a row that may still settle, so it retries; every attempt
 *  re-resolves the index, because a message can shift the rows below it. */

import { Effect, Fiber } from 'effect';

import { interruptFiber } from '@zilar/client-core';

export const JUMP_SCROLL_RETRY_MS: readonly number[] = [80, 200, 400];

export interface JumpScrollTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

// Each retry is a fiber that sleeps; clearing it interrupts the fiber.
const defaultTimers: JumpScrollTimers = {
  setTimeout: (callback, ms) =>
    Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(callback)))),
  clearTimeout: (handle) => {
    interruptFiber(handle as Fiber.Fiber<void>);
  },
};

/** Scrolls now and on each retry delay, confirming on the LAST retry so a
 *  message arriving mid-retry still re-scrolls. */
export function startJumpScroll(input: {
  findIndex: () => number;
  scrollToIndex: (index: number) => void;
  onDone: () => void;
  delays?: readonly number[];
  timers?: JumpScrollTimers;
}): () => void {
  const noop = (): void => {};
  if (input.findIndex() === -1) {
    return noop;
  }
  const timers = input.timers ?? defaultTimers;
  const delays = input.delays ?? JUMP_SCROLL_RETRY_MS;
  let cancelled = false;
  const attempt = (confirm: boolean): void => {
    if (cancelled) {
      return;
    }
    const index = input.findIndex();
    if (index !== -1) {
      input.scrollToIndex(index);
      if (confirm) {
        input.onDone();
      }
    }
  };
  attempt(delays.length === 0);
  const handles = delays.map((ms, position) =>
    timers.setTimeout(() => attempt(position === delays.length - 1), ms),
  );
  return () => {
    cancelled = true;
    for (const handle of handles) {
      timers.clearTimeout(handle);
    }
  };
}
