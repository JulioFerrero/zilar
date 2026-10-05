export const FREE_MUSE = 'opencode/muse-spark-1.3-contributor-free';
export const PAID_MUSE = 'meta/muse-spark-1.3-contributor';

export function fallbackModel(model: string): string | undefined {
  return model === FREE_MUSE ? PAID_MUSE : undefined;
}
