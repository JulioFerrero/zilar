---
id: T-2201
title: "Lead CLI: remove the unused `lead batch` command and its folder (837 lines); every other command unchanged"
status: merged
milestone: M5
branch: task/T-2201-remove-lead-batch
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-2201: Remove `lead batch`

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: remove it. `lead batch` ran the Claude-subagent waves of 10-09. Workers went back to OpenCode on 10-10, and the command has not been used since.

### Facts (the lead read these on 2026-10-19)
1. `packages/devtools/src/lead/batch/` has 6 files and 837 lines: `check.ts` 372, `merge.ts` 138, `parsers.ts` 144, `text.ts` 27, `types.ts` 78, `wave.ts` 78. It has no test files.
2. Only `packages/devtools/src/lead/cli.ts` imports from it (`:10-13`). The batch wiring in `cli.ts`:
   - the command helper returning `CommandResult` (`:417`);
   - `readPackages` (`:441-466`);
   - `realBatchDeps` (`:469-491`);
   - `realBatchMergeDeps` (`:493-…`);
   - `runBatch` (`:590-602`);
   - the two help lines (`:622-624`);
   - the dispatch branch (`:666-667`).
3. `cli.ts:454` and `:457` use `isRecord` from `batch/parsers.ts`, inside `readPackages`.

### Steps
1. Delete the folder `packages/devtools/src/lead/batch/`.
2. In `cli.ts`, delete the batch imports, `runBatch`, the dispatch branch and the help lines. Then delete every helper that only the batch code used (`readPackages`, `realBatchDeps`, `realBatchMergeDeps`, the command helper). Check each with `git grep -n "<name>" -- packages/devtools` first. If anything else still needs `isRecord`, define it once in `cli.ts`.
3. Change no other command. `lead status`, `spec-check`, `launch`, `merge`, `push`, `reply`, `watch` and `autopilot` must work exactly as before.
4. Report the line count of `cli.ts` before and after.

### Allowed files
- `packages/devtools/src/lead/batch/` (delete all six files)
- `packages/devtools/src/lead/cli.ts`
- `work/T-2201-remove-lead-batch.md`

### Checks
```bash
pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts status
pnpm gate
```

### Acceptance
- The gate passes.
- `lead status` prints the task table, and `lead batch` now gives the unknown-command usage.
- `git grep -n "lead/batch\|from './batch" -- packages` finds nothing.
- Lines are at least 850 lower (the folder plus the `cli.ts` wiring).

---

## Report (written by the worker when done)

**What I did**
- Deleted `packages/devtools/src/lead/batch/` (all six files, 837 lines).
- Removed the batch imports, `runShell`, `testArgsOf`, `readPackages`, `realBatchDeps`, `realBatchMergeDeps`, `runBatch`, the two `batch` help lines and the `batch` dispatch branch from `cli.ts`.
- `isRecord` was only used by `readPackages`, so no replacement is needed in `cli.ts`.
- Removed the now-unused `spawn` and `node:os` imports.

**Files changed**
- `packages/devtools/src/lead/batch/check.ts`, `merge.ts`, `parsers.ts`, `text.ts`, `types.ts`, `wave.ts` (deleted)
- `packages/devtools/src/lead/cli.ts` (689 lines before, 556 after; -133)
- `work/T-2201-remove-lead-batch.md` (status/report)

**Commands and real results**
- `pnpm install`: done in 22.9s.
- `pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts status`: printed the task table (T-2200, T-2201, T-2202, "Go paused until 2026-10-27").
- `pnpm exec tsx src/lead/cli.ts batch`: `lead: unknown command "batch" (try: lead --help)`, exit 1.
- `git grep -n "lead/batch\|from './batch" -- packages`: no matches.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/merge.test.ts`: 23 passed.
- `pnpm gate` (first run): GATE FAIL — six `merge.test.ts` tests timed out at 5000ms (machine load). The same file passed on its own, and the next gate run passed.
- `pnpm gate` (second run):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.7s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.7s)
  PASS  build @zilar/server  (0.9s)
  PASS  tests @zilar/devtools  (34.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  WARN  size: packages/devtools/src/lead/cli.ts: 556 lines (main 689); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- Total removal: 837 folder lines + 133 `cli.ts` lines = 970, above the 850 target.

**Deviations / notes**
- `packages/devtools/src/lead/merge.ts:92` still has a comment mentioning `batch merge`. It is outside my Allowed files, so I left it unchanged; it is now a stale reference and can be cleaned up in a later task.

**Open questions**
- None.

## Review (written by Claude)

Approved; the pre-review was clean, with 1 follow-up. Net −970.

**Removed** (Julio's call on 10-19):
- the `lead/batch/` folder (837 lines);
- the batch wiring in `cli.ts`: `runBatch`, the package reader, the batch deps, the help lines and the dispatch.

**Checked from the branch:** `lead status` prints the task table, and `lead batch` now exits with the unknown-command usage.

**Follow-up:** `packages/devtools/src/lead/merge.ts:92` still mentions "batch merge" in a comment. It goes with the next devtools task.
