/**
 * Jump-to-message scroll retries (T-0138 follow-up), kept UI-free next to
 * the list so it can be unit-tested in Node: `MessageList` only wires its
 * `FlatList` ref and entries to this.
 *
 * A search hit lands on a row that may still be settling (images, layout),
 * so the list scrolls immediately and retries a few times. Every attempt
 * re-resolves the index through `findIndex`: a message arriving within
 * 400 ms of the jump moves every row below it, so a captured index would
 * scroll to a stale row.
 */

/** The retry delays, mirroring the mount scroll above the jump effect. */
export const JUMP_SCROLL_RETRY_MS: readonly number[] = [80, 200, 400];

/** A clock seam so tests can drive the retries deterministically. */
export interface JumpScrollTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultTimers: JumpScrollTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Scrolls to the jump target now and on each retry delay, then calls
 * `onDone` (the list clears its jump target so a later message with the
 * same id does not re-scroll). Returns a cancel for the effect cleanup.
 * When the target is not loaded yet nothing scrolls and `onDone` never
 * fires, so the target stays set for the next render.
 */
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
  const attempt = (): void => {
    const index = input.findIndex();
    if (index !== -1) {
      input.scrollToIndex(index);
    }
  };
  attempt();
  const handles = (input.delays ?? JUMP_SCROLL_RETRY_MS).map((ms) =>
    timers.setTimeout(attempt, ms),
  );
  input.onDone();
  return () => {
    for (const handle of handles) {
      timers.clearTimeout(handle);
    }
  };
}
