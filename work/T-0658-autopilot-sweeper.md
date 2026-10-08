---
id: T-0658
title: "autopilot: a sweeper every 5 min stops leftover vitest/tsc/turbo processes that run in a zilar-T-* worktree longer than 25 min, or in the worktree of a blocked task; one LEAD: SWEPT line per sweep that killed something"
status: merged
milestone: M5
branch: task/T-0658-autopilot-sweeper
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0658: autopilot process sweeper

## Spec (written by Claude, do not edit)

### Why
Leftover test processes have overloaded the machine twice:
- a Vitest fork ran at 100% CPU for 50 minutes;
- orphaned test runs kept going for 2 hours after their worker stopped.

The autopilot should find and stop them by itself.

### Verified facts (do not re-derive)
- **`packages/devtools/src/lead/processes.ts`:**
  - `stopWorktreeProcesses(candidates, deps)` (line 195) sends SIGTERM, waits, then SIGKILL, and reports `{ pid, command, survived }`;
  - `executableBasename(command)` is at line 85;
  - `findProcessesInWorktree(worktree, deps)` (line 130) finds processes by cwd (`lsof`) or command line (`ps`), and skips `deps.currentPid` and `deps.parentPid` (`leadProcessIds()` at line 284).
- **`packages/devtools/src/lead/autopilot.ts`:**
  - `tickOnce(deps, options)` (line 235) runs every `POLL_MS = 15_000` (line 28), from `runAutopilot` (line 550);
  - escalations are printed with `console.log(action.line)` and `appendLog(deps.statePath, action.line)` (lines 125-130);
  - `AutopilotDeps` (lines 31-37) has `client`, `runner`, `statePath`, `promptsDirPath` and `repoRoot`;
  - each task record has a `worktree`. `readTaskInfo(record.worktree, task)` returns the task file's `status` (used at line 306).
- **`packages/devtools/src/gate/plan.ts:33-34`:** `TESTS_TIMEOUT_MS` is 20 min and `STEP_TIMEOUT_MS` is 10 min. The gate kills its own steps on timeout, so a test or typecheck process older than 25 min is a leftover.

### What to build
1. **A new module, `packages/devtools/src/lead/sweeper.ts`, with pure functions and injected seams:**
   - `parsePsElapsed(output)` parses `ps -axo pid=,etime=,command=` lines (`etime` is `[[dd-]hh:]mm:ss`) into `{ pid, elapsedMs, command }`.
   - `sweepCandidates(rows, { worktreeRoots, blockedWorktrees, maxAgeMs, protectedPids })` returns the rows to stop. A row qualifies only if all of these hold:
     - its command line contains `vitest`, `tsc`, `tsgo` or `turbo`;
     - its command line contains a path under one of `worktreeRoots` (the `../zilar-T-*` directories);
     - it is older than `maxAgeMs` (25 min), **or** it runs in a worktree listed in `blockedWorktrees`, at any age.

     Never a pid in `protectedPids`. Never a process whose command line contains `opencode`.
2. **In `autopilot.ts`:**
   - run the sweep at most once every 5 min (keep the last sweep time in memory);
   - take the worktrees from the state's task records, and treat as blocked those whose task-file status is `blocked`;
   - stop the candidates with `stopWorktreeProcesses`;
   - when it stopped at least one, print and log one line: `LEAD: SWEPT <n> process(es): <task>:<basename>:<minutes>m, …`;
   - in dry-run mode, list them and stop nothing.
3. **Tests in a new `packages/devtools/src/lead/sweeper.test.ts`:**
   - `etime` parsing, including `mm:ss`, `hh:mm:ss` and `d-hh:mm:ss`;
   - an old vitest in a worktree is picked;
   - a young one is not, unless its worktree is blocked;
   - an `opencode` process is never picked;
   - a process outside the worktrees is never picked;
   - protected pids are never picked.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/processes.ts`, `packages/devtools/src/lead/autopilot.ts` (lines 1-60, 110-140, 235-320 and 540-564), `packages/devtools/src/gate/plan.ts` (lines 30-40).

### Allowed files
`packages/devtools/src/lead/sweeper.ts`, `packages/devtools/src/lead/sweeper.test.ts`, `packages/devtools/src/lead/autopilot.ts`, `work/T-0658-autopilot-sweeper.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/sweeper src/lead/autopilot
pnpm gate
```

### Acceptance
- The sweeper tests pass, and the autopilot tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Added `packages/devtools/src/lead/sweeper.ts`:
  - `parsePsElapsed(output)` parses `ps -axo pid=,etime=,command=` lines (`[[dd-]hh:]mm:ss`) into `{ pid, elapsedMs, command }`; malformed times are skipped.
  - `sweepCandidates(rows, { worktreeRoots, blockedWorktrees, maxAgeMs, protectedPids })` returns the rows to stop: command must contain `vitest`/`tsc`/`tsgo`/`turbo`, must mention a known worktree at a path/token boundary (`zilar-T-0099` never matches `zilar-T-00990`), and must be at least `maxAgeMs` old or run in a blocked worktree. Protected pids and any command containing `opencode` are never picked.
  - `runSweep(options, deps)` orchestrates with injected `ps`/`stop` seams; `defaultSweepDeps()` uses a real `ps` and `stopWorktreeProcesses`. `sweepLine(entries)` builds `LEAD: SWEPT <n> process(es): <task>:<basename>:<minutes>m, …` from basenames only (never full command lines).
- Wired it into `autopilot.ts`:
  - `tickOnce` runs `maybeSweep` once per tick, throttled to once every 5 min via an in-memory `lastSweepAt`.
  - Worktrees come from the state's task records; records whose task file says `status: blocked` are passed as `blockedWorktrees`.
  - A sweep that stopped at least one process prints one `LEAD: SWEPT …` line and appends it to the lead log; dry-run prints `DRY: LEAD: SWEPT …` and stops nothing.
  - The lead's own pids (`leadProcessIds()`) are always protected; sweep errors are logged and never break the task loop.
- Added `packages/devtools/src/lead/sweeper.test.ts` (16 tests): etime parsing for `mm:ss`, `hh:mm:ss`, `d-hh:mm:ss`; old vitest picked; young vitest not picked unless its worktree is blocked; `opencode` never picked; process outside the worktrees never picked; protected pids never picked; plus `runSweep` stop/task-mapping, dry-run and survivor cases, and `sweepLine` formatting.

### Files changed
- `packages/devtools/src/lead/sweeper.ts` (new)
- `packages/devtools/src/lead/sweeper.test.ts` (new)
- `packages/devtools/src/lead/autopilot.ts`
- `work/T-0658-autopilot-sweeper.md`

### Deviation from the spec
- `AutopilotDeps` gained one optional field, `sweeper?: SweepDeps`. The real `defaultSweepDeps()` is injected in `runAutopilot`, not in `tickOnce`. This keeps the existing `tickOnce` tests unchanged and guarantees they never shell out or kill anything (the spec's acceptance requires the autopilot tests to pass unchanged, and it says the sweeper must run at most once every 5 min — this satisfies both). No change to `cli.ts` was needed: `runAutopilotCommand` already calls `runAutopilot`.

### Commands I ran
- `pnpm install` → Done in 12.9s (only peer-dependency warnings).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/sweeper src/lead/autopilot` → 2 test files passed, 40 tests passed.
- `pnpm exec prettier --write packages/devtools/src/lead/{sweeper.test.ts,sweeper.ts,autopilot.ts}` → reformatted `sweeper.test.ts` only (first gate run failed format on it).
- `pnpm gate` → `GATE PASS`. Summary lines:
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  tests @zilar/devtools`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Open questions
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 14f81dbe, the current HEAD.
- **Lead check:** the sweep only picks vitest, tsc, tsgo and turbo processes inside `zilar-T-*` worktrees that are older than 25 min (or in a blocked worktree), and never `opencode` or the lead pids.
- **Nits:**
  - a process that survives SIGKILL is not logged; the next sweep retries it;
  - the throttle is armed by a dry run.
  Both are minor; follow-up only.
