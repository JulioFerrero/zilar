// Worker model ids shared by the fallback and model-schedule logic. They live
// here so fallback.ts and model-schedule.ts do not import each other.
export const FREE_MUSE = 'opencode/muse-spark-1.3-contributor-free';
export const PAID_MUSE = 'meta/muse-spark-1.3-contributor';
// T-1718: OpenCode now offers DeepSeek V4.1 Flash and GLM 5.3 Flash for free.
// The free listings start every chain, ahead of the flat-rate Go ones and the
// metered ones, so a worker or a reviewer only pays after the free listings
// run out.
export const FREE_DEEPSEEK_FLASH = 'opencode/deepseek-v4.1-flash-free';
export const FREE_GLM_FLASH = 'opencode/glm-5.3-flash-free';
// The metered DeepSeek API listing of DeepSeek V4.1 Flash.
export const DEEPSEEK_FLASH = 'deepseek/deepseek-flash';
// T-1242: the same DeepSeek V4.1 Flash through the flat-rate OpenCode Go
// subscription. Now the second step: the free listing above runs first, and
// the metered API below is the step after this one (T-1718).
export const GO_DEEPSEEK_FLASH = 'opencode-go/deepseek-v4.1-flash';
// T-1362: the flat-rate OpenCode Go listing of Muse Spark 1.3 Contributor,
// the step before the metered Meta listing.
export const GO_MUSE = 'opencode-go/muse-spark-1.3-contributor';

// Human-readable labels for escalation lines. Shared so decide.ts and
// doctor.ts name every model the same way (T-1718). An unknown id falls
// through unchanged so a stray listing still names itself.
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
