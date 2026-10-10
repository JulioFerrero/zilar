import { Effect, Fiber } from 'effect';
import { PanResponder } from 'react-native';

/** Sliding the finger this far left (negative dx, in px) while holding cancels. */
const CANCEL_SLIDE_PX = -90;

export type HoldHandlers = { begin: () => void; release: (cancel: boolean) => void };
export type FlagRef = { current: boolean };
export type TickerRef = { current: Fiber.Fiber<unknown, unknown> | undefined };

/**
 * Runs `tick` every `everyMs` (the first run after one interval) until the fiber is
 * interrupted. A throw inside one tick is dropped, so the next tick still runs
 * (as with `setInterval`).
 */
export function startTicker(everyMs: number, tick: () => void): Fiber.Fiber<unknown, unknown> {
  const safeTick = Effect.sync(tick).pipe(Effect.catchDefect(() => Effect.void));
  return Effect.runFork(Effect.sleep(everyMs).pipe(Effect.andThen(safeTick), Effect.forever));
}

export function stopTicker(ref: TickerRef): void {
  const fiber = ref.current;
  if (fiber !== undefined) {
    ref.current = undefined;
    Effect.runFork(Fiber.interrupt(fiber));
  }
}

/**
 * The hold gesture on the mic: grant starts, release sends, a slide past
 * `CANCEL_SLIDE_PX` or a lost touch cancels. Built outside the component so
 * the handlers may read refs (they only run in touch events).
 */
export function createHoldResponder(
  handlersRef: { current: HoldHandlers },
  heldRef: FlagRef,
  cancelRef: FlagRef,
  setWillCancel: (value: boolean) => void,
) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // The system (a permission dialog, a scroll takeover) must not steal the
    // touch silently: a lost touch cancels the recording.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      heldRef.current = true;
      cancelRef.current = false;
      handlersRef.current.begin();
    },
    onPanResponderMove: (_event, gesture) => {
      setWillCancel(gesture.dx < CANCEL_SLIDE_PX);
    },
    onPanResponderRelease: (_event, gesture) => {
      handlersRef.current.release(gesture.dx < CANCEL_SLIDE_PX);
    },
    onPanResponderTerminate: () => {
      handlersRef.current.release(true);
    },
  });
}
