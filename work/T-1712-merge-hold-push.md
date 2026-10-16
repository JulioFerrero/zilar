---
id: T-1712
title: "lead merge --hold (merge locally, no push) + lead push (push main once) + lead batch merge pushes once at the end — so a batch of merges is one deploy instead of one restart per task (Julio 2026-10-16: restarts must stop; batch deploys until the stack split)"
status: merged
milestone: M5
branch: task/T-1712-merge-hold-push
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1712: One deploy per batch of merges

## Spec (written by Claude, do not edit)

### Why
Every push to `main` redeploys the whole stack and restarts the server, so each `lead merge` is a restart. On 2026-10-16 Julio said the restarts must stop. Until the stack split (`docs/deploy/zero-downtime-plan.md` Phase 2), the lead batches merges and pushes once. The tool needs a way to merge without pushing.

### Facts (the lead read them on 2026-10-16)
- **`packages/devtools/src/lead/merge.ts`** (272 lines):
  - `MergeOptions` is at `:22-47`;
  - after the squash commit and the `same` check (`:241-253`), it pushes at `:255-258` (`options.runner.run(options.root, ['push', '-q', 'origin', 'main'])`, throwing `MergeError('push of main failed; the merge is local only')`);
  - then it stops the worktree processes, removes the worktree and deletes the branch (`:259-271`).
- **`packages/devtools/src/lead/cli/merge.ts`** (88 lines):
  - `runMerge(positional, args)` (`:42-72`) reads `--summary` and `--skip-gate` and calls `mergeTask({...})`;
  - `runBatch` (`:74-88`) dispatches `lead batch check|merge`.
- **`packages/devtools/src/lead/batch/merge.ts`:** `runBatchMerge` (`:63` on) calls `deps.merge({...})` once per task. Each of those pushes today.
- **`packages/devtools/src/lead/cli.ts`** (71 lines) dispatches the commands (`:46-61`, `merge` at `:46-47`); its help text is in `./cli/help.js`.
- **`packages/devtools/src/lead/merge.test.ts:210`** holds 'rebases, squashes to one commit, boards, pushes, and cleans up'.

### Steps
1. **`merge.ts`:** add `push?: boolean` to `MergeOptions`, with a comment where the default is true. When it's `false`, skip the push block and keep everything else, cleanup included.
2. **`cli/merge.ts`:**
   - `runMerge` passes `push: false` when `args` includes `--hold`, and then prints `${task} merged (held: run \`lead push\` to deploy)`;
   - add `runPush()`, which runs `git push -q origin main` in the repo root with the same `RealGitRunner`. It throws on failure and prints `main pushed` on success.
3. **`batch/merge.ts`:** `runBatchMerge` merges each task with `push: false`, then pushes once after the loop through `deps.git.run(deps.root, ['push', '-q', 'origin', 'main'])`. A failed push throws a `BatchError` that names the merged tasks.
4. **`cli.ts`:** add `push` to the dispatch, and add `--hold` and `push` to the help text in `cli/help.ts`.
5. **Test:** in `merge.test.ts`, one case where `push: false` leaves `origin/main` behind local `main`, and the worktree and branch are still cleaned up.

### Allowed files
- `packages/devtools/src/lead/merge.ts`
- `packages/devtools/src/lead/merge.test.ts`
- `packages/devtools/src/lead/cli/merge.ts`
- `packages/devtools/src/lead/cli/help.ts`
- `packages/devtools/src/lead/cli.ts`
- `packages/devtools/src/lead/batch/merge.ts`
- `work/T-1712-merge-hold-push.md`

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/lead/merge.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`lead merge T-X --summary "…" --hold`** merges without pushing.
- **`lead push`** pushes `main`.
- **`lead batch merge`** pushes once.
- **The new test passes.**

---

## Report (written by the worker when done)

### What I did

- `packages/devtools/src/lead/merge.ts`: added `push?: boolean` to `MergeOptions`, with a comment saying it defaults to true. Wrapped the `push -q origin main` block in `if (options.push !== false)`. Everything after it (stop worktree processes, remove worktree, delete branch, drop from state) runs unchanged.
- `packages/devtools/src/lead/cli/merge.ts`: `runMerge` reads `--hold` and passes `push: false`; when held it prints `${task} merged (held: run \`lead push\` to deploy)`, otherwise `${task} merged`. Added `runPush()`, which runs `git push -q origin main` in the repo root with a `RealGitRunner`, throws `Error('push of main failed')` on failure and prints `main pushed`.
- `packages/devtools/src/lead/batch/merge.ts`: `runBatchMerge` merges each task with `push: false`, then pushes once after the loop with `deps.git.run(deps.root, ['push', '-q', 'origin', 'main'])`. A failed push throws `BatchError('push of main failed; merged locally: <tasks>')`.
- `packages/devtools/src/lead/cli.ts`: dispatch `push` to `runPush`.
- `packages/devtools/src/lead/cli/help.ts`: documented `[--hold]` on `merge` and added the `push` command line.
- `packages/devtools/src/lead/merge.test.ts`: added a happy-path case `leaves origin/main behind when push is false, but still cleans up`: after `mergeTask({...options, push: false})` origin/main still points at the pre-merge commit while local main moved, and the worktree is removed, the branch is deleted and the state entry is dropped.

### Checks run

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/merge.test.ts` → Test Files 1 passed (1), Tests 23 passed (23).
- `pnpm gate` → GATE PASS. Summary lines:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.1s)
PASS  typecheck  (2.4s)
PASS  effect  (0.7s)
PASS  tests @zilar/devtools  (13.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- No deviations from the spec; no new dependencies.
- `lead push` was not run against a real remote (it would push `main`); it is covered by reading the code and by the held-merge unit test, not by an end-to-end push.
- The existing `MergeError('squash result differs …; nothing pushed')` message stays accurate: nothing is pushed on that path in either mode.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, plus 1 nit and 1 follow-up.
  - **Nit:** a batch that fails mid-loop leaves the earlier merges unpushed without naming them. Accepted: `lead push` recovers it.
  - **Follow-up:** the lead docs still say "merge always pushes". The lead updates `docs/LEAD_HANDOFF.md` itself, since that's a docs edit.
- **The change:**
  - `push?: boolean` in `MergeOptions`, defaulting to true;
  - `--hold` on `lead merge`;
  - a new `lead push`;
  - `lead batch merge` now pushes once, after the loop.
- **The tests:** the lead ran `merge.test.ts` in the worktree: 23 tests passed.

