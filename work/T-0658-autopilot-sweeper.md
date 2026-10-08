---
id: T-0658
title: "autopilot: a sweeper every 5 min stops leftover vitest/tsc/turbo processes that run in a zilar-T-* worktree longer than 25 min, or in the worktree of a blocked task; one LEAD: SWEPT line per sweep that killed something"
status: todo
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

## Review (written by Claude)
