import { FREE_MUSE } from './fallback.js';

// T-0245: a task may say `model: auto` in its front matter. The lead then
// picks the worker model from DeepSeek's peak hours: flash is cheap off-peak,
// and the peak hours double its price, so the free Muse covers them instead.
// Pre-reviews and the doctor never use this; they stay on Muse.
export const DEEPSEEK_FLASH = 'deepseek/deepseek-flash';

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
// unchanged so explicit models keep working exactly as before.
export function resolveWorkerModel(
  frontMatterModel: string,
  now: Date,
): { model: string; effortOverride?: string } {
  if (frontMatterModel !== 'auto') {
    return { model: frontMatterModel };
  }
  if (isDeepSeekPeak(now)) {
    return { model: FREE_MUSE };
  }
  return { model: DEEPSEEK_FLASH, effortOverride: 'default' };
}
