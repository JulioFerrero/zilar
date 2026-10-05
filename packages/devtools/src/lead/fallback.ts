import { DEEPSEEK_FLASH, FREE_MUSE, PAID_MUSE } from './models.js';

export { DEEPSEEK_FLASH, FREE_MUSE, PAID_MUSE };

export function fallbackModel(model: string): string | undefined {
  // T-0245: DeepSeek flash (`model: auto` off-peak) falls back in place to the
  // billed Muse on a rate limit or outage, exactly like the free Muse.
  return model === FREE_MUSE || model === DEEPSEEK_FLASH ? PAID_MUSE : undefined;
}
