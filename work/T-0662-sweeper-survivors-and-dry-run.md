---
id: T-0662
title: "autopilot sweeper: report processes that survive SIGKILL with one LEAD: SWEEP FAILED line, and stop a dry run from arming the 5-min sweep throttle"
status: todo
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

## Review (written by Claude)
