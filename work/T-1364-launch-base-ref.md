---
id: T-1364
title: "Lead tool: `lead launch T-XXXX --base <ref>` creates the task worktree from an older commit (for model evals that replay solved tasks) and commits the task file from main into it"
status: merged
milestone: M5
branch: task/T-1364-launch-base-ref
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1364: launch --base

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14, wants a model quality test: the same solved tasks are replayed by about 12 models from the commit before each fix, and the lead grades the results against the known answer. `lead launch` always branches from `main` (`packages/devtools/src/lead/launch.ts:168-176`). At an old commit the task file (which lives on `main`) doesn't exist in the worktree.

### What to build
1. **`packages/devtools/src/lead/launch.ts`:** an optional `base` argument, default `'main'`, used in the `git worktree add … -b <branch> <base>` call. When `base` is not `main`:
   - copy the task file (`readTaskFrontMatter(...).file`, read from the main checkout) into the same relative path in the new worktree;
   - then `git add` it and commit it there with the message `<task>: eval spec`;
   - fail clearly if the copy or the commit fails.
2. **`packages/devtools/src/lead/cli.ts`:** `launch <T-XXXX> [--extra-rules <file>] [--base <ref>]`. Validate that `<ref>` resolves (`git rev-parse --verify <ref>^{commit}`) before creating anything. Update the help line.
3. **Nothing else changes.** The default path (no `--base`) must behave exactly as today.
4. **Tests:** none required; at most one small test in the existing `launch` test file if one exists. Every file stays at most 400 lines. **`cli.ts` is 419 lines now:** keep the change net-neutral or smaller there, by moving the launch arg parsing into `launch.ts` if needed.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/launch.ts`, `packages/devtools/src/lead/cli.ts`, `packages/devtools/src/lead/task-file.ts`.

### Allowed files
`packages/devtools/src/lead/launch.ts`, `packages/devtools/src/lead/cli.ts`, `packages/devtools/src/lead/launch.test.ts`, `work/T-1364-launch-base-ref.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's dry check:** `lead launch T-XXXX --base <sha>` on an eval spec creates a worktree at `<sha>` plus one commit containing the spec.

---

## Report (written by the worker when done)

### What I did

Added an optional `--base <ref>` to `lead launch`.

- `packages/devtools/src/lead/launch.ts`
  - New `LaunchOptions` (`task`, `extraRulesFile`, `base`) and exported `parseLaunchArgs(args)`, moved out of `cli.ts` to keep that file net-smaller. A value flag with no value (or followed by another `--flag`) throws `--x needs a value`.
  - `launchTask` now takes `(options, deps)`. It validates an explicit `base` with `git rev-parse --verify <base>^{commit}` in the main checkout and throws `--base <ref> does not resolve to a commit` before creating anything. The `git worktree add … -b <branch>` call uses `base ?? 'main'`.
  - When the base is not `main`, `commitEvalSpec` copies `work/<task file>` from the main checkout into the same relative path in the new worktree, `git add`s it and commits it with `<task>: eval spec`. Copy, stage and commit failures each throw a clear error. The default path (no `--base`) is byte-for-byte the old behaviour: no extra git call, no copy, no commit.
- `packages/devtools/src/lead/cli.ts`
  - `runLaunch(args)` uses `parseLaunchArgs`; no other command touched. Help line updated to `launch <T-XXXX> [--extra-rules <file>] [--base <ref>]`. `flagValue` is still used by the other commands.
  - Line count: 419 → 415 (net smaller, as the spec asked).

### Files changed

- `packages/devtools/src/lead/launch.ts`
- `packages/devtools/src/lead/cli.ts`
- `work/T-1364-launch-base-ref.md` (this file)

No `launch.test.ts`: the spec says no test is required and no `launch` test file existed.

### Commands and real results

- `pnpm install` — done (14.4s), no errors.
- `pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts --help` — prints the new `--base <ref>` line.
- One throwaway script (in the temp dir, not in the repo) built a scratch git repo with an old commit that lacks the task file and a `main` that has it, then called `launchTask` directly with a fake client. Real output:
  - `base: worktree true`, `base: spec copied true`, `base: subject T-0099: eval spec`, `base: prev subject old commit without the task file`, `base: head is old true`, `base: branch task/T-0099-demo`, `base: tracked work/T-0099-demo.md`
  - `plain: head is main true`, `plain: subject add the task files on main` (no eval-spec commit)
  - `bad base: --base does-not-exist does not resolve to a commit`
- `pnpm gate` — from the repo root, full summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/devtools  (10.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No files outside the Allowed files.

### Deviations, problems, open questions

- Deviations: `launchTask`'s signature is now `(options, deps)` instead of `(task, extraRulesFile, deps)`; only `cli.ts` called it (no test file did), so nothing else changed. The spec allowed moving launch arg parsing into `launch.ts`.
- `--base main` (explicit) is validated but takes the default path (no eval-spec commit), which matches "when base is not `main`".
- No open questions.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (3 nits); the packet is current for `4fb2a2b0`.** `--base` is verified first, the default path is unchanged, and the spec is copied and committed into the worktree.
