// effect-plain: the splash gate is a module-level promise with one cap timer; it owns no I/O or ports and is set from the store and read from a React effect.
// T-1915: the splash waits for the cached chat list and cached messages.
// A cold start reads both from files after the primary font is ready, so the
// first frame used to be the chat skeleton (or an empty list) that swapped for
// real content a few frames later. The store marks the paint when those reads
// settle; the root layout keeps the splash up until then, capped so a
// signed-out start (which never marks) cannot hang it.

let painted = false;
let resolvePainted: (() => void) | undefined;

const paintedOnce = new Promise<void>((resolve) => {
  resolvePainted = resolve;
});

/** Records that the cached list and messages are in the store; the first call wins. */
export function markCachePainted(): void {
  if (painted) {
    return;
  }
  painted = true;
  resolvePainted?.();
  resolvePainted = undefined;
}

/** Resolves once the caches are painted, or after `capMs`, whichever comes first. */
export function waitForCachePaint(capMs: number): Promise<void> {
  if (painted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, capMs);
    void paintedOnce.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
