import { DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, PAID_MUSE } from './models.js';

export { DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, PAID_MUSE };

// T-0245, revised by T-1242: a task may say `model: auto` in its front matter.
// The lead then runs the worker on OpenCode Go's DeepSeek V4.1 Flash at every
// hour. OpenCode Go is a flat-rate subscription, so DeepSeek's peak-hour price
// no longer decides anything and the free Muse no longer covers any hours.
// `isDeepSeekPeak` stays exported for callers that still want the old window.
// Pre-reviews and the doctor never use this; they stay on Muse.

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

// Resolves `model: auto` for the given moment. Any other value comes back
// unchanged so explicit models keep working exactly as before. The moment no
// longer matters: Go is flat-rate, so auto always picks the Go DeepSeek Flash
// with `effort: default` (T-1242). While Go is paused (T-1421) auto starts on
// the metered DeepSeek API instead, still at `default`.
export function resolveWorkerModel(
  frontMatterModel: string,
  _now: Date,
  goPaused = false,
): { model: string; effortOverride?: string } {
  if (frontMatterModel !== 'auto') {
    return { model: frontMatterModel };
  }
  return goPaused
    ? { model: DEEPSEEK_FLASH, effortOverride: 'default' }
    : { model: GO_DEEPSEEK_FLASH, effortOverride: 'default' };
}

// The reasoning effort a worker session runs at: the schedule's override when
// it sets one (`model: auto` -> Go needs `default`), otherwise the task's
// effort. Launch and every in-place model switch call this so a fallback keeps
// the variant the session started with instead of dropping back to the raw
// task effort (T-1242 finding 1).
export function resolveWorkerVariant(
  frontMatterModel: string,
  taskEffort: string,
  now: Date,
  goPaused = false,
): string {
  return resolveWorkerModel(frontMatterModel, now, goPaused).effortOverride ?? taskEffort;
}
