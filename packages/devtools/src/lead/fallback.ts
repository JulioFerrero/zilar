import { DEEPSEEK_FLASH } from './model-schedule.js';

export const FREE_MUSE = 'opencode/muse-spark-1.3-contributor-free';
export const PAID_MUSE = 'meta/muse-spark-1.3-contributor';

export function fallbackModel(model: string): string | undefined {
  // T-0245: DeepSeek flash (`model: auto` off-peak) falls back in place to the
  // billed Muse on a rate limit or outage, exactly like the free Muse.
  return model === FREE_MUSE || model === DEEPSEEK_FLASH ? PAID_MUSE : undefined;
}
