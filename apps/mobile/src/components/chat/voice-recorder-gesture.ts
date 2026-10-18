import { Effect, Fiber } from 'effect';
import { PanResponder } from 'react-native';

import { interruptFiber } from '@/lib/effect/timers';

/** Sliding the finger this far left (negative dx, in px) while holding cancels. */
const CANCEL_SLIDE_PX = -90;
/** Sliding the finger this far up (negative dy, in px) while holding locks. */
const LOCK_SLIDE_PX = -70;

export type HoldHandlers = {
  begin: () => void;
  release: (cancel: boolean) => void;
  lock: () => void;
};
export type FlagRef = { current: boolean };
export type TickerRef = { current: Fiber.Fiber<unknown, unknown> | undefined };

// Runs `tick` every `everyMs` (first after one interval) until interrupted; a throw inside one tick is dropped, so the next still runs, like `setInterval`.
export function startTicker(everyMs: number, tick: () => void): Fiber.Fiber<unknown, unknown> {
  const safeTick = Effect.sync(tick).pipe(Effect.catchDefect(() => Effect.void));
  return Effect.runFork(Effect.sleep(everyMs).pipe(Effect.andThen(safeTick), Effect.forever));
}

export function stopTicker(ref: TickerRef): void {
  const fiber = ref.current;
  if (fiber !== undefined) {
    ref.current = undefined;
    interruptFiber(fiber);
  }
}

// The hold gesture on the mic: grant starts, release sends, a slide past `CANCEL_SLIDE_PX` or a lost touch cancels. A slide up past `LOCK_SLIDE_PX` locks once; then release neither sends nor cancels and the row's buttons end it.
export function createHoldResponder(
  handlersRef: { current: HoldHandlers },
  heldRef: FlagRef,
  cancelRef: FlagRef,
  lockedRef: FlagRef,
  setWillCancel: (value: boolean) => void,
) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // A lost touch (a permission dialog, a scroll takeover) cancels the recording instead of continuing silently.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      heldRef.current = true;
      cancelRef.current = false;
      lockedRef.current = false;
      handlersRef.current.begin();
    },
    onPanResponderMove: (_event, gesture) => {
      if (lockedRef.current) {
        return;
      }
      const willCancel = gesture.dx < CANCEL_SLIDE_PX;
      setWillCancel(willCancel);
      if (!willCancel && gesture.dy < LOCK_SLIDE_PX) {
        lockedRef.current = true;
        setWillCancel(false);
        handlersRef.current.lock();
      }
    },
    onPanResponderRelease: (_event, gesture) => {
      if (lockedRef.current) {
        return;
      }
      handlersRef.current.release(gesture.dx < CANCEL_SLIDE_PX);
    },
    onPanResponderTerminate: () => {
      if (lockedRef.current) {
        return;
      }
      handlersRef.current.release(true);
    },
  });
}
