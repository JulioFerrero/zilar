import { DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, PAID_MUSE } from './models.js';

export { DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, PAID_MUSE };

// T-1242: `model: auto` runs on OpenCode Go's DeepSeek V4.1 Flash first. When
// Go hits its subscription limit the worker moves in place to the metered
// DeepSeek API, and a second failure moves it to the billed Muse. The free
// Muse still goes straight to the billed Muse. Each quota error applies one
// step of the chain.
export function fallbackModel(model: string): string | undefined {
  if (model === GO_DEEPSEEK_FLASH) {
    return DEEPSEEK_FLASH;
  }
  return model === FREE_MUSE || model === DEEPSEEK_FLASH ? PAID_MUSE : undefined;
}
