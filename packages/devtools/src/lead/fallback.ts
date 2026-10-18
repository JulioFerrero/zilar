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

// T-1718: every chain now starts on the free OpenCode listings and only then
// touches a flat-rate Go or a metered listing. A worker (`model: auto`) runs
// on the free DeepSeek Flash first, moves to the Go DeepSeek Flash when it
// hits its limit, then the metered DeepSeek API, then the Go Muse, and only a
// fourth failure reaches the billed Meta Muse. A pre-review or the doctor
// starts on the free Muse, moves to the free GLM Flash, then the Go Muse, then
// the billed Muse. Each quota error applies one step of the chain.
//
// T-1421: while Go is paused the chain skips every Go listing, so the free
// DeepSeek Flash and the free GLM Flash go straight to their metered step
// (the DeepSeek API and the paid Muse).
//
// T-1942: while the free listings are paused (a gateway refusal) the chain must
// never step onto another free listing. The free Muse then goes straight to the
// Go Muse (or the paid Muse while Go is paused), not to the free GLM Flash.
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
  // T-1942: a free listing outside the modelled chain (`opencode/beam-free`,
  // `opencode-go/beam-free`) still moves to the paid Muse step, so a refused
  // session leaves the listing instead of retrying it in place. `paidStep`
  // cannot be called here because it delegates back to this function.
  return isFreeListing(model) ? (goPaused ? PAID_MUSE : GO_MUSE) : undefined;
}
