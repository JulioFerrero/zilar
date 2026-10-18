import { fallbackModel } from './fallback.js';
import {
  DEEPSEEK_FLASH,
  FREE_DEEPSEEK_FLASH,
  FREE_MUSE,
  GO_DEEPSEEK_FLASH,
  PAID_MUSE,
} from './models.js';

export { DEEPSEEK_FLASH, FREE_DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, PAID_MUSE };

// `model: auto` runs the worker on the free DeepSeek V4.1 Flash whatever the hour;
// when that listing is rate-limited, fallback.ts moves it on. `isDeepSeekPeak` stays
// exported for callers that still want the old window.

// DeepSeek peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday.
// Every other hour, including the whole weekend, is off-peak.
export function isDeepSeekPeak(now: Date): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) {
    return false;
  }
  const hour = now.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/**
 * Resolves `model: auto`; any other value comes back unchanged. Auto always picks
 * the free DeepSeek V4.1 Flash with `effort: default`; while free listings are
 * paused it starts on that listing's paid step instead.
 */
export function resolveWorkerModel(
  frontMatterModel: string,
  _now: Date,
  goPaused = false,
  freePaused = false,
): { model: string; effortOverride?: string } {
  if (frontMatterModel !== 'auto') {
    return { model: frontMatterModel };
  }
  const model = freePaused
    ? (fallbackModel(FREE_DEEPSEEK_FLASH, goPaused) ?? FREE_DEEPSEEK_FLASH)
    : FREE_DEEPSEEK_FLASH;
  return { model, effortOverride: 'default' };
}

// A session's effort: the schedule's override when it sets one, else the task's, so
// a fallback keeps the variant the session started with.
export function resolveWorkerVariant(
  frontMatterModel: string,
  taskEffort: string,
  now: Date,
  goPaused = false,
): string {
  return resolveWorkerModel(frontMatterModel, now, goPaused).effortOverride ?? taskEffort;
}
