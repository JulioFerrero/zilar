// effect-plain: the splash gate is a module-level promise with one cap timer; it owns no I/O or ports and is set from the store and read from a React effect.
// The splash waits for the cached chat list and messages, so the first frame is not a skeleton that swaps a few frames later. The cap keeps a signed-out start (which never marks) from hanging it.

let painted = false;
let resolvePainted: (() => void) | undefined;

const paintedOnce = new Promise<void>((resolve) => {
  resolvePainted = resolve;
});

export function markCachePainted(): void {
  if (painted) {
    return;
  }
  painted = true;
  resolvePainted?.();
  resolvePainted = undefined;
}

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
