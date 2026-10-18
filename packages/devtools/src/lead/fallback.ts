import {
  DEEPSEEK_FLASH,
  FREE_DEEPSEEK_FLASH,
  FREE_GLM_FLASH,
  FREE_MUSE,
  GO_DEEPSEEK_FLASH,
  GO_MUSE,
  PAID_MUSE,
  isFreeListing,
} from './models.js';

export {
  DEEPSEEK_FLASH,
  FREE_DEEPSEEK_FLASH,
  FREE_GLM_FLASH,
  FREE_MUSE,
  GO_DEEPSEEK_FLASH,
  GO_MUSE,
  PAID_MUSE,
};

// Every chain starts on the free OpenCode listings, then a flat-rate Go or a metered one:
// a worker runs free DeepSeek Flash -> Go DeepSeek Flash -> metered DeepSeek -> Go Muse ->
// billed Muse; a pre-review or doctor starts on free Muse -> free GLM Flash -> Go Muse ->
// billed Muse. Go paused skips every Go step; free paused skips every free step.
export function fallbackModel(
  model: string,
  goPaused = false,
  freePaused = false,
): string | undefined {
  if (model === FREE_DEEPSEEK_FLASH) {
    return goPaused ? DEEPSEEK_FLASH : GO_DEEPSEEK_FLASH;
  }
  if (model === GO_DEEPSEEK_FLASH) {
    return DEEPSEEK_FLASH;
  }
  if (model === DEEPSEEK_FLASH || model === FREE_GLM_FLASH) {
    return goPaused ? PAID_MUSE : GO_MUSE;
  }
  if (model === FREE_MUSE) {
    return freePaused ? (goPaused ? PAID_MUSE : GO_MUSE) : FREE_GLM_FLASH;
  }
  if (model === GO_MUSE) {
    return PAID_MUSE;
  }
  // A free listing outside the modelled chain still moves to the paid Muse step, so a
  // refused session leaves the listing instead of retrying it.
  return isFreeListing(model) ? (goPaused ? PAID_MUSE : GO_MUSE) : undefined;
}
