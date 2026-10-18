---
id: T-2095
title: "Gate fix: the task-ID comment check diffs against the merge base, not the tip of main, so a branch is not failed for comments other merged tasks removed"
status: merged
milestone: M5
branch: task/T-2095-gate-comment-merge-base
model: deepseek/deepseek-flash
effort: default
estimate: 15 min
---

# T-2095: Comment check from the merge base

## Spec (written by Claude, do not edit)

### Why
T-2091's worker found a false failure. Once local `main` moves ahead of a branch's start, the comment check added in T-2088 sees lines that other tasks removed from main as "added" on the branch, and fails the gate for comments the branch never touched.

### Facts (read by the lead on 2026-10-18 at `9ca690ca3`)
- **The bug.** `packages/devtools/src/gate/cli.ts:149-152`, `commentReport(root, base)`, runs `git diff -U0 <base> -- apps packages`: the tip of `base` against the working tree.
- **The right pattern.** `changedFiles` (`cli.ts:84-86`) already diffs from the merge base: `git diff --name-only <base>...HEAD`, plus the uncommitted `git diff --name-only HEAD`.

### Steps
1. In `commentReport`, diff from the merge base and keep uncommitted changes: compute `git merge-base <base> HEAD` with the existing `run` helper, then run `git diff -U0 <mergeBase> -- apps packages`. That compares against the working tree, so uncommitted edits are still checked.
2. Change nothing else. No new test; the pure `taskIdComments` is unchanged and already tested.

### Allowed files
- `packages/devtools/src/gate/cli.ts`
- `work/T-2095-gate-comment-merge-base.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes on this branch.

---

## Report (written by the worker when done)

### What I did

`commentReport` in `packages/devtools/src/gate/cli.ts` now resolves the merge base with `git merge-base <base> HEAD` through the existing `run` helper and diffs `git diff -U0 <mergeBase> -- apps packages`. That still compares against the working tree, so uncommitted edits are checked, but lines other merged tasks removed on the base no longer appear as additions. I extended the function's comment with the reason for the merge base. No other code changed and no test was added, per the spec.

### Checks run

- `pnpm install`: done in 24s.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts`: 1 file passed, 51 tests passed.
- `pnpm gate`: `gate: 2 changed file(s) against main`; PASS install (frozen), format, lint, typecheck, effect, build @zilar/server, tests @zilar/devtools; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

### Notes for the lead

Changed files: `packages/devtools/src/gate/cli.ts` and this task file. Nothing blocked.

## Review (written by Claude)

Approved. `commentReport` now diffs from `git merge-base <base> HEAD` against the working tree, so the lines other tasks removed on main no longer count as additions, and uncommitted edits are still checked. The change is two lines.
