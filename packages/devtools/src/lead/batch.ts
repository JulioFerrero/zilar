// `lead batch check` combines a wave's branches on one worktree, runs install,
// typecheck, lint, prettier and every package's tests without stopping, and writes one
// fix file per task that owns a failure; `lead batch merge` merges the wave one task
// at a time without a gate. Side effects go through `BatchDeps`.

export { runBatchCheck } from './batch/check.js';
export type { BatchMergeDeps, BatchMergeResult } from './batch/merge.js';
export { runBatchMerge } from './batch/merge.js';
export {
  parseLintErrors,
  parsePrettierFiles,
  parseTypecheckErrors,
  parseVitestFailures,
} from './batch/parsers.js';
export { realBatchDeps, realBatchMergeDeps, testArgsOf } from './batch/real.js';
export { BatchError } from './batch/types.js';
export type {
  BatchDeps,
  BatchPackage,
  CheckResult,
  CommandResult,
  Failure,
  TaskOutcome,
} from './batch/types.js';
export { ownerOf, waveWorktree } from './batch/wave.js';
