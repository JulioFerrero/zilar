// Worker model ids shared by the fallback and model-schedule logic. They live
// here so fallback.ts and model-schedule.ts do not import each other.
export const FREE_MUSE = 'opencode/muse-spark-1.3-contributor-free';
export const PAID_MUSE = 'meta/muse-spark-1.3-contributor';
// The metered DeepSeek API listing of DeepSeek V4.1 Flash.
export const DEEPSEEK_FLASH = 'deepseek/deepseek-flash';
// T-1242: the same DeepSeek V4.1 Flash through the flat-rate OpenCode Go
// subscription. Auto workers run there first; the metered API above is the
// first fallback.
export const GO_DEEPSEEK_FLASH = 'opencode-go/deepseek-v4.1-flash';
