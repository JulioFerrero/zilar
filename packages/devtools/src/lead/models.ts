export const FREE_MUSE = 'opencode/muse-spark-1.3-contributor-free';
export const PAID_MUSE = 'meta/muse-spark-1.3-contributor';
// The free listings start every chain, ahead of the flat-rate Go and the metered
// ones, so a worker or reviewer only pays after the free listings run out.
export const FREE_DEEPSEEK_FLASH = 'opencode/deepseek-v4.1-flash-free';
export const FREE_GLM_FLASH = 'opencode/glm-5.3-flash-free';
export const DEEPSEEK_FLASH = 'deepseek/deepseek-flash';
// The same DeepSeek V4.1 Flash through the flat-rate OpenCode Go subscription, the
// step after the free listing and before the metered API.
export const GO_DEEPSEEK_FLASH = 'opencode-go/deepseek-v4.1-flash';
// The flat-rate OpenCode Go listing of Muse, the step before the metered Meta listing.
export const GO_MUSE = 'opencode-go/muse-spark-1.3-contributor';

// A free listing is any of the three known ones plus any `opencode/*-free` or
// `opencode-go/*-free` listing; here so free-pause and fallback avoid a cycle.
const FREE_LISTING = /^opencode(-go)?\/.*-free$/;

export function isFreeListing(model: string): boolean {
  return (
    model === FREE_MUSE ||
    model === FREE_DEEPSEEK_FLASH ||
    model === FREE_GLM_FLASH ||
    FREE_LISTING.test(model)
  );
}

// Human-readable labels for escalation lines; an unknown id falls through unchanged.
export function modelLabel(model: string): string {
  if (model === FREE_DEEPSEEK_FLASH) {
    return 'free DeepSeek flash';
  }
  if (model === GO_DEEPSEEK_FLASH) {
    return 'Go DeepSeek flash';
  }
  if (model === DEEPSEEK_FLASH) {
    return 'DeepSeek flash (API)';
  }
  if (model === FREE_MUSE) {
    return 'free Muse';
  }
  if (model === FREE_GLM_FLASH) {
    return 'free GLM flash';
  }
  if (model === GO_MUSE) {
    return 'Go Muse';
  }
  if (model === PAID_MUSE) {
    return 'paid Muse';
  }
  return model;
}
