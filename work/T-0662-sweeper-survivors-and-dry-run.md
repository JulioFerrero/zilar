---
id: T-0662
title: "autopilot sweeper: report processes that survive SIGKILL with one LEAD: SWEEP FAILED line, and stop a dry run from arming the 5-min sweep throttle"
status: merged
milestone: M5
branch: task/T-0662-sweeper-survivors-and-dry-run
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0662: sweeper survivors and dry-run throttle

## Spec (written by Claude, do not edit)

### Why
These are the two follow-ups from T-0658's review:
- a leftover process that survives SIGKILL is dropped silently, so the lead never learns about it;
- a dry run arms the 5-minute throttle, so a real sweep in the same process can be skipped.

### Verified facts (do not re-derive)
- **`packages/devtools/src/lead/sweeper.ts`:**
  - `SweepOutcome` (about lines 136-141) has `candidates` and `stopped`;
  - `runSweep(options, deps)` (lines 188-213) returns early in a dry run. Otherwise it calls `deps.stop(picked)` and loops over the result, and `if (entry.survived) { continue; }` drops survivors (lines 202-206);
  - `sweepLine(entries)` (lines 215-222) builds `LEAD: SWEPT <n> process(es): <task>:<basename>:<m>m, …`;
  - `toSwept(row, options, basename)` (lines 173-186) maps a row to a `SweptProcess`.
- **`packages/devtools/src/lead/autopilot.ts`:**
  - `let lastSweepAt` is at line 245;
  - `maybeSweep(state, deps, dryRun, now)` (lines 251-302) returns while `now - lastSweepAt < SWEEP_INTERVAL_MS`, then sets `lastSweepAt = now` (line 265) even when `dryRun` is true;
  - it prints and logs `sweepLine(outcome.stopped)` with `console.log` and `appendLog(deps.statePath, line)` when something was stopped.
- **Tests** are in `packages/devtools/src/lead/sweeper.test.ts`, with injected `ps` and `stop` seams.

### What to build
1. **`SweepOutcome` gets `survivors: SweptProcess[]`.** `runSweep` puts each entry with `survived: true` there, built with `toSwept`, instead of dropping it. A dry run and an empty sweep return `survivors: []`.
2. **Add `export function sweepFailedLine(entries)`.** It returns `LEAD: SWEEP FAILED <n> process(es) survived SIGKILL: <task>:<basename>:<m>m, …`, in the same entry format as `sweepLine`.
3. **`maybeSweep`:**
   - when `outcome.survivors.length > 0` (and not a dry run), print and log `sweepFailedLine(...)` the same way as the SWEPT line;
   - set `lastSweepAt = now` only when `dryRun` is false;
   - a dry run never reads or arms the throttle.
4. **Tests in `sweeper.test.ts`:**
   - a stop result with one survivor puts it in `survivors` and not in `stopped`;
   - `sweepFailedLine` has the exact format;
   - a dry run returns an empty `survivors`.

   Keep every existing test unchanged.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/sweeper.ts`, `packages/devtools/src/lead/sweeper.test.ts`, `packages/devtools/src/lead/autopilot.ts` (lines 240-305).

### Allowed files
`packages/devtools/src/lead/sweeper.ts`, `packages/devtools/src/lead/sweeper.test.ts`, `packages/devtools/src/lead/autopilot.ts`, `work/T-0662-sweeper-survivors-and-dry-run.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/sweeper src/lead/autopilot
pnpm gate
```

### Acceptance
- Survivors produce one `LEAD: SWEEP FAILED` line.
- A dry run no longer arms the throttle.
- The new tests pass, and the existing ones pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### Status: review

The spec contradicted itself on the empty sweep (item 1 says it returns `survivors: []`; the acceptance says existing tests stay unchanged). Lead decided: return `survivors: []` and update the one existing assertion to add the new field.

### Problems / deviations

- Lead decision: the existing test `does not stop anything when nothing qualifies` (`packages/devtools/src/lead/sweeper.test.ts`) changed from `toEqual({ candidates: [], stopped: [] })` to `toEqual({ candidates: [], stopped: [], survivors: [] })`. That is the only existing test changed, and only to add the new field.

### What changed

- `packages/devtools/src/lead/sweeper.ts`:
  - `SweepOutcome` gets `survivors: SweptProcess[]`.
  - `runSweep` puts entries with `survived: true` into `survivors` (built with `toSwept`) instead of dropping them. Dry run and the empty sweep return `survivors: []`.
  - New `export function sweepFailedLine(entries)`, which returns `LEAD: SWEEP FAILED <n> process(es) survived SIGKILL: <task>:<basename>:<m>m, …`.
  - `sweepLine` and `sweepFailedLine` share a private `entryList` helper.
- `packages/devtools/src/lead/autopilot.ts`:
  - `maybeSweep` checks the throttle only when `!dryRun`, and sets `lastSweepAt = now` only after the dry-run return, so a dry run never arms it.
  - When `outcome.survivors.length > 0`, it prints and appends `sweepFailedLine(...)`, the same way as the SWEPT line.
  - Imports `sweepFailedLine`.
- `packages/devtools/src/lead/sweeper.test.ts`:
  - Added: survivor goes to `survivors` and not `stopped`; `sweepFailedLine` exact format; dry run returns empty `survivors`.
  - Added `sweepFailedLine` to the import list.
  - Changed only the existing empty-sweep assertion, to add `survivors: []` (see Problems / deviations).

### Commands run

- `pnpm install`: exit 0.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/sweeper src/lead/autopilot`: before the lead's decision, 42 passed, 1 failed (the empty-sweep assertion). After the change to add `survivors: []`, the final `pnpm gate` run below covers these tests.
- `pnpm gate` (final run, log in the scratchpad): exit 0.
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Round 2 (lead review): the throttle is now armed right after the throttle check, before the sweep runs (`if (!dryRun) { lastSweepAt = now; }`), so a throw from `runSweep` still arms it. The `lastSweepAt = now` after the dry-run return was removed. The sweepLine comment is back above `sweepLine`, and `entryList` has its own one-line comment. Commits 13f3a6be and 6f05bb9f. Re-run: `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/sweeper src/lead/autopilot`: 2 files, 43 tests passed. `pnpm gate`: `scope: every changed file is inside the Allowed files`, `GATE PASS`.

## Review (written by Claude)

**2026-10-09, lead:** approved. This task was the Haiku 5.5 trial, run as a Claude Code subagent with no OpenCode pre-review; the lead reviewed the diff directly.
- **What it does:** survivors of SIGKILL go to `survivors` and get one `LEAD: SWEEP FAILED` line. A dry run neither reads nor arms the throttle, and a real sweep arms it before it runs, so a `ps` failure cannot cause a retry on every tick.
- **How the work went:** round 1 stopped on a real conflict in my spec (an empty sweep returns `survivors: []`, yet the existing test had to stay unchanged). The lead decided to update that one assertion. Round 2 fixed where the throttle is armed and where a comment sat.
- **Tests and gate:** 43 tests passed, and the gate passed.
