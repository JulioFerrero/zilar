import {
  type ActiveSource,
  type FrameScheduler,
  SMOOTH_CATCH_UP_MS,
  SMOOTH_MIN_CHARS_PER_SECOND,
  type SmoothTextOptions,
  safeCut,
} from '@zilar/chat-core';
import { useSmoothText } from '@zilar/client-core';

export { SMOOTH_CATCH_UP_MS, SMOOTH_MIN_CHARS_PER_SECOND, safeCut, useSmoothText };
export type { ActiveSource, FrameScheduler, SmoothTextOptions };
