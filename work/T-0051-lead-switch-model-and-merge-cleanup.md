---
id: T-0051
title: lead CLI — `switch-model` to move a task to another model (quota fallback), and `merge` stops processes left in the worktree
status: planned
milestone: M2
branch: task/T-0051-lead-switch-model
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0038]
estimate: 0.5 day
---

# T-0051: `lead switch-model` and merge cleanup

## Spec (written by Claude, do not edit)

### Goal

Two gaps in the lead's supervision tool (`packages/devtools/src/lead/`).

1. **Quota fallback.** When OpenCode Go runs out (a 402 or quota error), Julio wants the running tasks to continue on MiniMax M3 (`minimax-coding-plan/MiniMax-M3`). Today the autopilot can only retry the same model every 10 minutes. `launch` refuses an existing worktree, so there's no way to move a task to another model. Add **`lead switch-model <T-XXXX> <provider/model>`**. It opens a **new** session with the new model **in the same worktree**, tells it to continue, and points the state at it.
2. **Stale processes after a merge.** Dev servers or Metro started inside a task's worktree kept running after the merge. Two stale servers once made every AI answer twice. `lead merge` must stop the processes that are still running from inside the worktree before it removes it.

### Read first
- `AGENTS.md` (mandatory)
- `packages/devtools/src/lead/`: `cli.ts`, `launch.ts` (and its `LaunchDeps`, `assertNotV4Pro`, `splitModel`, rules loading), `client.ts` (the `OpencodeClient` interface and its fake), `state.ts`, `merge.ts`, `prompts.ts`, `task-file.ts`, and their tests
- `packages/devtools/prompts/resume.md` and `worker.md`

### Allowed files
- `packages/devtools/src/lead/**` (source and tests)
- `packages/devtools/prompts/switch.md` (new)
- `work/T-0051-lead-switch-model-and-merge-cleanup.md`

**Not allowed:** anything else, including `docs/**` (the lead updates the playbook) and the task files and the board.

### Allowed dependencies
None: Node built-ins and zod only, as the rest of `lead`.

### What to build

**1. `lead switch-model <T-XXXX> <provider/model> [--extra-rules <file>]`**
- Check:
  - the task is tracked in the state and has a worker record;
  - its worktree exists;
  - the model string is `provider/model` (reuse `splitModel`);
  - it isn't V4 Pro (reuse `assertNotV4Pro`).
  Refuse with a clear error otherwise.
- Interrupt the old session, and ignore an error if it's already idle.
- Create a new session exactly as `launch` does:
  - the same title format plus ` [<model>]`;
  - agent `build`;
  - the same rules (`rules.json`, plus the extra rules if given);
  - `directory` = the existing worktree.
  Extract the shared part of `launch` into a helper rather than copying it.
- Send the prompt from the new `prompts/switch.md`, with the placeholders `TASK`, `TASK_FILE`, `WORKTREE`, `BRANCH`. It says:
  - the task moved from another model, and the work so far is committed or in the worktree;
  - read the task file and `git status` / `git log` / `git diff`, then continue from where it stopped;
  - follow `AGENTS.md`, finish the Spec, run the Checks, fill the Report, set `status: review`, and commit.
- Update the task's state record:
  - the new `sessionId` and `model`;
  - reset the per-session counters or timestamps (nudges, quota retries, stall tracking, pre-review markers) so the autopilot treats it as a fresh session;
  - keep `startedAt`, and add `switchedAt`.
  Use the state helpers, with zod validation as today.
- Print `T-XXXX <newSessionId> <model>`.
- It must **not** edit the task file (the lead updates `model:` in the spec itself) and must not touch git.
- Add it to the CLI help text.
- Tests, with the fake client and a temp state and temp dirs, like the existing tests:
  - the happy path: the old session is interrupted, the new session has the right model, directory and rules, the prompt has no unfilled placeholders, and the state is updated;
  - refusals: an unknown task, a missing worktree, a bad model string, V4 Pro;
  - interrupting an already idle session doesn't fail the switch.

**2. `merge` stops processes left in the worktree.**
- Before `git worktree remove`, find the processes whose **current working directory** or **command line** is inside the worktree path. On macOS, `lsof -a -d cwd -Fpn` for cwd plus `ps -Ao pid=,command=` is fine. Put it behind an injectable seam so tests don't run real commands.
- Send them `SIGTERM`, wait up to 5 s for them to exit, then `SIGKILL` the rest. Print one line per stopped process: pid and the first 80 characters of the command. Never print environment variables.
- **Safety (must):**
  - Match on the exact worktree path plus a trailing `/`, or an exact cwd match, so `galena-T-0047` never matches `galena-T-00470`.
  - Never kill the current process or its parent.
  - Never kill processes outside the worktree. Test with look-alike paths and the main repo path.
- Tests: matching (cwd and command), the look-alike paths, skipping self and parent, TERM then KILL through fake timers or an injected clock, and the order (stop before the worktree removal).

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/devtools
```

Don't run `lead launch`, `lead merge`, `lead switch-model` or the autopilot against the real state (`~/.galena-lead`) or real sessions. Tests only.

### Acceptance criteria
- [ ] Every check above passes.
- [ ] `switch-model` works as specified, shares code with `launch`, and doesn't touch git or task files.
- [ ] `merge` stops only the worktree's processes, before removing it, with the safety tests.
- [ ] Only the Allowed files changed.

## Report (written by the worker when done)

## Review (written by Claude)
