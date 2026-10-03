---
id: T-0198
title: Lead tooling: the autopilot overwrites state written by lead launch and lead merge during a tick
status: planned
milestone: M5
branch: task/T-0198-lead-state-lost-writes
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0197]
estimate: 0.5 day
---

# T-0198: Lead tooling: the autopilot overwrites state written during a tick

## Spec (written by Claude, do not edit)

### Why
On 2026-10-04 `lead launch T-0197` printed its session id, but `~/.zilar-lead/state.json` had no `T-0197` entry afterwards, so the autopilot never supervised that worker. Cause, read in the code: `tickOnce` loads the whole state at the start of a tick (`packages/devtools/src/lead/autopilot.ts:173`), spends seconds on network calls, then saves the whole object back (`autopilot.ts:271`). Anything another command wrote in between is lost: a new task from `lead launch` (`launch.ts:188-197`), a `prereview` record from `lead prereview` (`cli.ts:102-117`), or a task `lead merge` dropped (`cli.ts:190-194`) comes back.

### What to build
1. In `packages/devtools/src/lead/state.ts` add `updateState(statePath, mutate: (state: StateFile) => void): StateFile`. It loads the file, applies `mutate`, saves with the existing atomic `saveState`, and returns the new state. Every write goes through it, so the read happens right before the write.
2. `tickOnce` (`autopilot.ts`): keep loading the state at the start to decide what to do, but collect each processed task's new record in a `Map<string, TaskRecord>` instead of writing into `state.tasks`. At the end (not in dry run), call `updateState` and, for each task in the map, write the record ONLY if the fresh file still has that task AND its `sessionId` equals the `sessionId` the tick started with. A task that was merged (gone) or relaunched (new session) during the tick keeps what the file says.
3. Use `updateState` in `launch.ts` (`launchTask`), in `cli.ts` `runPrereview` and in the `dropFromState` of `runMerge`. No behaviour change there other than the fresh read.
4. Tests (Vitest, real temp files like `state.test.ts`): (a) a tick that runs while another writer adds a task keeps both (simulate by making the fake client's `listMessages` write a new task into the state file through `updateState` before resolving); (b) a tick does not resurrect a task that was deleted during the tick; (c) a tick does not overwrite a task whose `sessionId` changed during the tick; (d) `updateState` on a missing file starts from the empty state. Use the fakes the existing `autopilot.test.ts` uses.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/state.ts`, `state.test.ts`, `autopilot.ts` (`tickOnce`, lines 167-273), `autopilot.test.ts`, `launch.ts` (`launchTask`), `cli.ts` (`runPrereview`, `runMerge`).

### Allowed files
`packages/devtools/src/lead/state.ts`, `state.test.ts`, `autopilot.ts`, `autopilot.test.ts`, `launch.ts`, `cli.ts`, `work/T-0198-lead-state-lost-writes.md`.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/devtools test --maxWorkers=2 src/lead
pnpm gate
```

### Acceptance
- The three race tests fail on the old code (say in the Report that you checked this by running them before the fix) and pass after.
- No other test changes; `pnpm gate` ends with GATE PASS.

### Out of scope
File locks, a database, any change to what the autopilot decides.

---

## Report (written by the worker when done)

## Review (written by Claude)
