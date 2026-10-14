import { DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, GO_MUSE, PAID_MUSE } from './models.js';

export { DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, GO_MUSE, PAID_MUSE };

// T-1362: `model: auto` runs on OpenCode Go's DeepSeek V4.1 Flash first. When
// Go hits its subscription limit the worker moves in place to the metered
// DeepSeek API, then to the flat-rate Go Muse, and only a third failure moves
// it to the billed Meta Muse. The free Muse goes to the Go Muse next, then to
// the billed one. Each quota error applies one step of the chain.
//
// T-1421: while Go is paused the chain skips every Go listing, so the DeepSeek
// API and the free Muse both go straight to the paid Muse.
export function fallbackModel(model: string, goPaused = false): string | undefined {
  if (model === GO_DEEPSEEK_FLASH) {
    return DEEPSEEK_FLASH;
  }
  if (model === DEEPSEEK_FLASH || model === FREE_MUSE) {
    return goPaused ? PAID_MUSE : GO_MUSE;
  }
  return model === GO_MUSE ? PAID_MUSE : undefined;
}
