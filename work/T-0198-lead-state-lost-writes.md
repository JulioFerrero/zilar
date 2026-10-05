---
id: T-0198
title: Lead tooling: the autopilot overwrites state written by lead launch and lead merge during a tick
status: merged
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
`packages/devtools/src/lead/state.ts`, `state.test.ts`, `autopilot.ts`, `autopilot.test.ts`, `launch.ts`, `cli.ts`, `switch-model.ts`, `switch-model.test.ts` (added by the lead in round 3: it writes the state with the same old pattern, lines 75 and 152), `work/T-0198-lead-state-lost-writes.md`.

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

### What I did
Fixed the lost-write race between the autopilot tick and the other lead
commands, exactly per spec:
1. `state.ts`: added `updateState(statePath, mutate)` — loads fresh,
   applies `mutate`, saves via the existing atomic `saveState`, returns the
   new state (`packages/devtools/src/lead/state.ts`).
2. `autopilot.ts` `tickOnce`: still loads state at tick start to decide, but
   per-task results now collect into a `Map<string, TaskRecord>` plus an
   `initialSessions` map of tick-start `sessionId`s. At the end (non-dry-run)
   one `updateState` writes each record back only if the fresh file still has
   that task AND its `sessionId` matches the tick-start value. Merged (gone)
   or relaunched (new session) tasks keep what the file says.
3. `launch.ts` `launchTask`, `cli.ts` `runPrereview` and the `dropFromState`
   of `runMerge`: all write through `updateState` (fresh read right before
   the write). `runPrereview` now re-checks the task exists in the fresh file
   instead of mutating the stale in-memory record. No behaviour change beyond
   the fresh read.
4. Tests: three race tests in `autopilot.test.ts` (concurrent writer via
   `updateState` inside a wrapped fake `listMessages`: added task kept,
   deleted task not resurrected, relaunched session not overwritten) and one
   `updateState`-on-missing-file test in `state.test.ts`. All use the existing
   `FakeOpenCodeClient` and real temp files.

### Files changed
- `packages/devtools/src/lead/state.ts` (`updateState`)
- `packages/devtools/src/lead/autopilot.ts` (`tickOnce` merge via `updateState`)
- `packages/devtools/src/lead/launch.ts` (`launchTask` via `updateState`)
- `packages/devtools/src/lead/cli.ts` (`runPrereview`, `dropFromState` via `updateState`)
- `packages/devtools/src/lead/autopilot.test.ts` (3 race tests)
- `packages/devtools/src/lead/state.test.ts` (1 `updateState` test)
- `work/T-0198-lead-state-lost-writes.md` (this Report, status)

### Race tests fail-before / pass-after
I wrote the 4 tests first and ran them against the unfixed `tickOnce`:
`src/lead/autopilot.test.ts src/lead/state.test.ts` → 3 failed, 16 passed
(the 3 race tests failed with the concurrent write lost / task resurrected /
`ses_worker` overwriting `ses_relaunched`; the `updateState` missing-file
test passed since `updateState` itself was already added). After the fix, the
same files pass fully, and the whole `src/lead` suite passes.

### Commands and real results
- `pnpm install --frozen-lockfile`: exit 0 (Done in 7.1s).
- `pnpm format:check`: first run flagged `state.ts`; fixed with
  `pnpm exec prettier --write` on the 6 touched source/test files; re-run:
  "All matched files use Prettier code style!".
- `pnpm lint`: first run failed on an unused `log` spy variable in the new
  resurrect test; removed it; re-run: exit 0 (11 tasks successful).
- `pnpm typecheck`: exit 0 (11 tasks successful).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 src/lead`:
  Test Files 15 passed (15), Tests 378 passed (378). No other tests changed.
- `pnpm gate` (final): PASS install (frozen), PASS format, PASS lint,
  PASS typecheck, PASS tests @zilar/devtools, then GATE PASS.
  Note: the gate's scope section lists 5 files "outside the Allowed files"
  (`autopilot.ts`, `autopilot.test.ts`, `cli.ts`, `launch.ts`,
  `state.test.ts`). That is a matcher artifact, not scope creep: the task's
  Allowed files name those files by bare basename (e.g. `autopilot.ts`),
  which the gate turns into `^autopilot\.ts(/.*)?$` and therefore cannot
  match `packages/devtools/src/lead/autopilot.ts`; only the one full-path
  token (`packages/devtools/src/lead/state.ts`) matches. Every file I
  changed maps 1:1 onto an Allowed-files entry.

### Security checklist
- No secrets, tokens, or message text touched; state holds ids/bookkeeping only.
- `runPrereview` guards on the fresh record existing before writing prereview data.
- Tick merge is per-task and session-pinned; deletes/relaunches are never undone.
- No new routes, caps, or audit paths; no behaviour change to what the autopilot decides.

### Deviations / open questions
None. No new dependencies. Did not touch `AGENTS.md`, `BOARD.md`, or other tasks.

### Round 2 — pre-review findings (PREREVIEW.md @ c474504)
Pre-review verdict: Approve, 0 must-fix, 1 should-fix, 2 nits.

### Disagreements
- Finding 1 (should-fix, `switch-model.ts` still does load-then-`saveState`
  across network calls): I agree it is the same lost-write class, but I did
  not fix it — `switch-model.ts` is outside this task's Allowed files and the
  pre-reviewer explicitly marks it "follow-up, not a merge-blocker". Fixing it
  here would violate the Allowed-files constraint. Needs a follow-up task
  adding `switch-model.ts` to scope (filing it is the lead's call).
- Finding 2 (nit, `runPrereview` success log overclaims when the task vanished
  mid-command) and finding 3 (nit, same-task same-session field clobber
  mid-tick): left as-is per the "do not touch nits" rule; the reviewer
  confirms the new behaviour is preferable to the old in both cases and the
  verdict is Approve.

No code changed in this round; no new tests (no behaviour fix to cover).
- `pnpm gate` (re-run after this Report edit): PASS install (frozen),
  PASS format, PASS lint, PASS typecheck, PASS tests @zilar/devtools, GATE PASS
  (same scope-note artifact as Round 1: 5 Allowed-files basenames the gate's
  regex cannot match against nested paths; no file outside the task scope).

### Round 3 — pre-review re-verification (PREREVIEW.md @ 0a4c8c1)
Round-2 pre-review re-verified the prior findings against the unchanged code:
same 0 must-fix, same should-fix (switch-model.ts follow-up, explicitly not a
merge-blocker and outside Allowed files), same 2 nits. Verdict: Approve.
No code changed; disagreements from Round 2 stand unchanged.
- `pnpm gate` (re-run after this Report edit): PASS install (frozen),
  PASS format, PASS lint, PASS typecheck, PASS tests @zilar/devtools, GATE PASS
  (same scope-note artifact: 5 Allowed-files basenames listed outside;
  no file outside the task scope).

### Round 4 — switch-model.ts brought into scope (lead instruction)
The lead added `switch-model.ts` and `switch-model.test.ts` to Allowed files
and asked for the pre-review should-fix to be fixed:
- `switch-model.ts`: the final write now goes through `updateState` — re-read
  right before writing, update only this task's record, and only when the
  fresh file still has the task with the session id the switch started from
  (a merge or relaunch mid-switch keeps what the file says). The reset itself
  (`resetRecordForSwitch`) is unchanged; the base record now comes from the
  fresh read instead of the stale tick-start snapshot. No other behaviour change.
- `switch-model.test.ts`: one new race test in the style of the autopilot
  race tests — a wrapped fake `tryInterrupt` adds T-0100 via `updateState`
  mid-switch; both T-0100 and the switched T-0099 record survive.
- Fail-before checked: with the source fix stashed, the new test fails
  (`expected undefined to be 'ses_other'` — T-0100 lost); with the fix,
  the whole `src/lead` suite passes: 15 files, 379 tests.
- `pnpm gate`: PASS install, PASS format, PASS lint, PASS typecheck,
  PASS tests @zilar/devtools, GATE PASS (scope lists 7 Allowed-files
  basenames as "outside" — the same gate regex artifact as before; every
  changed file maps onto an Allowed-files entry).

## Review (written by Claude)

**Verdict:** Approved and merged after three rounds. Every state write now goes through `updateState`, which reads the file right before writing; the autopilot's end-of-tick write keeps a task only if it still exists with the same session. The lead's spec missed `switch-model.ts`, the other writer with the old pattern: two automatic rounds were wasted on it because the worker was right not to touch a file outside its scope (fixed in the loop by T-0199); the lead widened the scope in round 3 and the worker fixed it with a race test. Pre-review clean. Accepted nits: a write by another command in the same session during a tick (a manual `lead prereview`) can still be overwritten by the tick; `lead prereview` and `switch-model` log success even when the task disappeared mid-command. The gate's scope report listed five files as outside the Allowed files: they are the short names in the lead's spec (`state.test.ts` instead of the full path), a false alarm; the lead now writes full paths.
