---
id: T-1364
title: "Lead tool: `lead launch T-XXXX --base <ref>` creates the task worktree from an older commit (for model evals that replay solved tasks) and commits the task file from main into it"
status: todo
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

## Review (written by Claude)
