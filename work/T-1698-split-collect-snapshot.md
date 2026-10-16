---
id: T-1698
title: "Size split of packages/devtools/src/lead/collect-snapshot.ts (391 lines): move the worktree git cache (WorktreeGit, GitCache, its schemas, loadGitCache, saveGitCache, lastCommitMs, commitsAhead, readWorktreeGit) into a new lead/worktree-git.ts and re-export the public names so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1698-split-collect-snapshot
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1698: Split the worktree git cache out of collect-snapshot.ts

## Spec (written by Claude, do not edit)

### Why
`packages/devtools/src/lead/collect-snapshot.ts` is 391 of 400 lines, so the lead's snapshot and watch can't gain a field. The worktree git cache is a self-contained block, shared with `lead watch`.

### Facts (the lead read them on 2026-10-16)
- **`collect-snapshot.ts`:**
  - imports `:1-19` (`fs`, `path`, `Result`/`Schema`, `currentHead`/`type GitRunner` from `./git.js`, …);
  - `SnapshotDeps :20`, `MessageCacheEntry :37`, `MessageCache :42` and `listSessionMessages :44`;
  - **the cache block:**
    - the comment `// Everything buildView and collectSnapshot need from one worktree …` (`:60-63`);
    - `export interface WorktreeGit :64` and `export type GitCache :75`;
    - `const worktreeGitSchema :77` and `const gitCacheFileSchema :87`;
    - `export function loadGitCache(file) :96` and `export function saveGitCache(file, cache) :128`;
  - then `iso :140`, `ageSince :144` and `readFields :148` (these stay);
  - then more of the cache block: `lastCommitMs :157`, `commitsAhead :163` and `export function readWorktreeGit(runner, worktree, cache?) :168-216` (with its comment);
  - then `fileMtimeMs :218`, `activeTasks :226`, `queuedTasks :304`, `parseMergedLog :331`, `mergedToday :358` and `collectSnapshot :383`.
- **Importers:**
  - `packages/devtools/src/lead/watch/cli.ts:8` (`import { loadGitCache, saveGitCache } from '../collect-snapshot.js';`);
  - `packages/devtools/src/lead/watch/collect.ts:7-13` (types `GitCache`, `MessageCache`, `WorktreeGit` and more from `../collect-snapshot.js`);
  - `packages/devtools/src/lead/cli/commands.ts:10` (only `collectSnapshot`).
- **The folder `packages/devtools/src/lead/`** has `git.ts`, `snapshot.ts` and `collect-snapshot.ts`, but no `worktree-git.ts`.

### Steps
1. **Create `packages/devtools/src/lead/worktree-git.ts`** with the cache block moved **word for word**, comments included: `WorktreeGit`, `GitCache`, both schemas, `loadGitCache`, `saveGitCache`, `lastCommitMs`, `commitsAhead` and `readWorktreeGit`.
   - Export the names that were exported.
   - Bring the imports they need. It must not import from `./collect-snapshot.js`.
2. **`collect-snapshot.ts`:**
   - import what it uses from `./worktree-git.js`;
   - add `export { loadGitCache, readWorktreeGit, saveGitCache, type GitCache, type WorktreeGit } from './worktree-git.js';` so both `watch/` importers keep working unchanged;
   - drop the imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `packages/devtools/src/lead/worktree-git.ts`
- `packages/devtools/src/lead/collect-snapshot.ts`
- `work/T-1698-split-collect-snapshot.md`

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- **`collect-snapshot.ts` is about 270 lines,** and `worktree-git.ts` holds the block unchanged.
- **The devtools tests pass,** and `lead status` and `lead snapshot` still run.

---

## Report (written by the worker when done)

### What I did

- Created `packages/devtools/src/lead/worktree-git.ts` and moved the worktree git
  cache block into it word for word, comments included: `WorktreeGit`, `GitCache`,
  `worktreeGitSchema`, `gitCacheFileSchema`, `loadGitCache`, `saveGitCache`,
  `lastCommitMs`, `commitsAhead` and `readWorktreeGit`. Exported names stay
  exported. The file imports only `node:fs`, `Result`/`Schema` from `effect`, and
  `currentHead`/`GitRunner` from `./git.js` — it does not import from
  `./collect-snapshot.js`.
- `packages/devtools/src/lead/collect-snapshot.ts`: imports `readWorktreeGit` and
  the `GitCache` type from `./worktree-git.js`, and re-exports
  `loadGitCache, readWorktreeGit, saveGitCache, type GitCache, type WorktreeGit`
  so `lead/watch/cli.ts` and `lead/watch/collect.ts` keep working unchanged.
- Dropped the imports the move made unused: `Result`/`Schema` from `effect` and
  `currentHead` from `./git.js` (`type GitRunner` is still used).
- Pure move: no behaviour change, no new tests. `collect-snapshot.ts` is now 252
  lines (was 391) and `worktree-git.ts` is 144 lines.

Files changed:
- `packages/devtools/src/lead/worktree-git.ts` (new)
- `packages/devtools/src/lead/collect-snapshot.ts`
- `work/T-1698-split-collect-snapshot.md`

### Checks run

- `pnpm gate` (final run): **GATE PASS**.
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.9s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.1s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/devtools  (21.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No unit test covers `collect-snapshot.ts` or `worktree-git.ts`; the gate's
  `typecheck` step is what proves the re-export contract and both `watch/`
  importers still resolve.
- Earlier gate runs (before the final one) failed **only** on
  `src/lead/merge.test.ts > ...` with `Test timed out in 5000ms`. That file does
  not import the moved module and is unrelated to this change: it spawns git
  subprocesses and hits Vitest's default 5s timeout while the shared machine was
  loaded (load average ~30 from other worktrees/projects running vitest). Evidence:
  `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/merge.test.ts`
  gave `21 failed | 1 passed` on default timeout under that load, while a single
  test run with `--testTimeout=60000` passed (`1 passed | 21 skipped`, 5.47s).
  The final `pnpm gate` passed with no code change in between, confirming the
  failures were environmental.

### Notes for the lead

- Scope respected: only the three Allowed files were touched; gate reports no
  files outside scope.
- I did not run `pnpm format`/`lint`/`typecheck` one by one; `pnpm gate` ran them
  once at the end. I ran `pnpm install` first as instructed.
- No deviations from the spec. Line count is 252 rather than "about 270" because
  the block moved out is ~144 lines; nothing else in the file changed.

## Review (written by Claude)

**Approved and merged.** A pure size split of the lead's snapshot tooling.

- **Pre-review:** clean; 1 nit, accepted: the Report says 252 lines, but `wc` gives 258.
- **The lead's check:** the removed lines equal `worktree-git.ts` exactly; the re-export keeps `watch/cli.ts` and `watch/collect.ts` unchanged.
- **Result:** `collect-snapshot.ts` drops from 391 to 258 lines.

