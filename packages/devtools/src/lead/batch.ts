// `lead batch check` combines the branches of a wave of tasks on one worktree,
// runs install, typecheck, lint, prettier --check and every package's tests without stopping at the
// first failure, and writes one fix file per task that owns a failure.
// `lead batch merge` then merges a checked wave task by task without a gate.
// Every side effect (git, commands, files, clock) goes through `BatchDeps`, so
// the tests run on fakes.

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
