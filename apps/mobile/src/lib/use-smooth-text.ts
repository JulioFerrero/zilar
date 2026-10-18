import {
  type ActiveSource,
  type FrameScheduler,
  SMOOTH_CATCH_UP_MS,
  SMOOTH_MIN_CHARS_PER_SECOND,
  type SmoothTextOptions,
  safeCut,
} from '@zilar/chat-core';
import { useSmoothText } from '@zilar/client-core';

/**
 * The phone adapter around the shared reveal. It only re-exports: the caller
 * passes `AppState` as an `ActiveSource` and Reanimated's reduce-motion flag as
 * `reducedMotion` (see `useBubbleReveal`), which `SmoothTextReveal` already
 * handles without React Native imports.
 */
export { SMOOTH_CATCH_UP_MS, SMOOTH_MIN_CHARS_PER_SECOND, safeCut, useSmoothText };
export type { ActiveSource, FrameScheduler, SmoothTextOptions };
