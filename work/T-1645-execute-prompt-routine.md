---
id: T-1645
title: "Scheduled AI jobs step 5a: the routine executor runs a prompt routine through a new optional runPrompt port — same AI/room preflight, an atomic 24-runs-per-AI-per-UTC-day cap, and replied→ok / failed→failure (3rd pauses) / stopped, limited, offline, not_in_room→skipped; the port is not wired yet"
status: merged
milestone: M5
branch: task/T-1645-execute-prompt-routine
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1645: Execute a prompt routine (scheduler side)

## Spec (written by Claude, do not edit)

### Why
This is scheduled AI jobs, plan `docs/plan/scheduled-ai-jobs.md` §2.2, §2.4, §2.5 and §4 task 5 (T-1614). So far:
- **T-1638** added `routines.kind`/`prompt` and the `routine_prompt_runs (ai_id, day, count)` table;
- **T-1641** added `createPromptRoutine`.

**This task makes the executor run a prompt routine through a port.** Wiring the port to the AI gateway is a later task. Until then the port is absent in production, and a prompt routine is recorded `skipped`.

### Facts (the lead read them on 2026-10-16, main after T-1641)
- **`apps/server/src/routines/execute.ts`** (204 lines):
  - `ExecuteRoutinePorts { runTool; post }` (`:62-72`);
  - `ExecuteRoutineOptions` (`:78-89`);
  - `executeRoutine(ports, row, options)` (`:97-…`):
    - step 1 (`:108-126`): the AI must be `active` (`SELECT status FROM ais`), and a topic routine needs `isAiInTopicRoom`; otherwise `markSkipped`;
    - step 2 (`:128-134`): T-1638's `toolId === null` → `pauseForFailures(..., true)`.
- **`apps/server/src/routines/outcomes.ts`** (169 lines):
  - `markSkipped(db, options, row, at, startedAt)` (`:44`) and `markOk(...)` (`:63`);
  - `recordFailure(db, options, ports, row, at, startedAt)` (`:85`): the 3rd consecutive failure pauses with `paused_reason 'failures'` and posts `FAILURE_PAUSE_NOTICE(title)` through `ports.post`.
- **`apps/server/src/routines/scheduler.ts`** (305 lines):
  - `CreateRoutineSchedulerOptions { db; runTool; post; audit; logger; … }` (`:30-43`);
  - the run call is `executeRoutine({ runTool: options.runTool, post: options.post }, row, {...})` (`:104`).
- **`apps/server/src/routines/preflight.ts`** has `isAiInTopicRoom` (`:27`).
- **Tests to copy for setup:** `apps/server/src/routines/execute.test.ts:3-10`.

### Steps
1. **New file `apps/server/src/routines/execute-prompt.ts`:**
   - `export type PromptRunOutcome = 'replied' | 'failed' | 'stopped' | 'limited' | 'offline' | 'not_in_room';`
   - `export type PromptRunner = (input: { aiId: string; groupId: string | null; topicId: string | null; routineId: string; title: string; prompt: string }) => Promise<PromptRunOutcome>;`
   - `export const MAX_PROMPT_RUNS_PER_DAY = 24;`
   - `export async function claimPromptRun(db, aiId: string, at: Date): Promise<boolean>`: one atomic statement, true when a slot was taken. The day is `at`'s UTC date (`YYYY-MM-DD`).
     ```sql
     INSERT INTO routine_prompt_runs (ai_id, day, count) VALUES ($aiId, $day, 1)
     ON CONFLICT (ai_id, day) DO UPDATE SET count = routine_prompt_runs.count + 1
     WHERE routine_prompt_runs.count < 24
     RETURNING count
     ```
   - `export async function executePromptRoutine(ports, row, options, at, startedAt): Promise<void>`. In order:
     1. if `ports.runPrompt` is undefined or `row.prompt` is null: `markSkipped` and one `options.logger.warn({ routineId, aiId }, 'prompt routine skipped: no runner')`, ids only;
     2. if `!(await claimPromptRun(...))`: `markSkipped` and a warn line with ids only (`'prompt routine skipped: daily cap'`), without calling the runner;
     3. call `ports.runPrompt({...})`, and if it throws, treat it as `'failed'`;
     4. map the outcome: `'replied'` → `markOk`; `'failed'` → `recordFailure`; the rest → `markSkipped`.
2. **`execute.ts`:**
   - add `runPrompt?: PromptRunner` to `ExecuteRoutinePorts` (comment: the AI gateway's scheduled turn, absent until wired);
   - in `executeRoutine`, **after step 1** (the same AI/room preflight for both kinds) and **before step 2**: `if (row.kind === 'prompt') { await executePromptRoutine(ports, row, options, at, startedAt); return; }`;
   - keep T-1638's null-`toolId` branch for a malformed tool row, and update its comment.
3. **`scheduler.ts`:** add optional `runPrompt?: ExecuteRoutinePorts['runPrompt']` to `CreateRoutineSchedulerOptions`, and pass it in the ports object at `:104`. No other scheduler change.
4. **Tests** in a new `apps/server/src/routines/execute-prompt.test.ts` (permissions/money area), with the `execute.test.ts` setup. Seed a prompt routine row directly (`kind 'prompt'`, `prompt 'hi'`, no tool) and cover:
   - `replied` → `last_status 'ok'`, failures 0;
   - `stopped` → `'skipped'`, failures unchanged;
   - three `failed` runs → paused with `paused_reason 'failures'`, and `post` called once with the notice;
   - with today's count at 24, the runner isn't called and the run is `'skipped'`;
   - no `runPrompt` port → `'skipped'`;
   - an inactive AI → `'skipped'` without calling the runner.
5. **Change nothing else:** no gateway, no wiring, no adapter.

### Allowed files
- `apps/server/src/routines/execute-prompt.ts`
- `apps/server/src/routines/execute-prompt.test.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/scheduler.ts`
- `work/T-1645-execute-prompt-routine.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/execute-prompt.test.ts src/routines/execute.test.ts src/routines/scheduler.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The six test cases pass.**
- **Tool routines are unchanged.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

Implemented the prompt-routine executor path exactly as specified:

- **New `apps/server/src/routines/execute-prompt.ts`** (121 lines): `PromptRunOutcome`, `PromptRunner` (the optional AI-gateway scheduled turn), `MAX_PROMPT_RUNS_PER_DAY = 24`, `claimPromptRun` (one atomic `INSERT … ON CONFLICT (ai_id, day) DO UPDATE … WHERE count < 24 RETURNING count`, day = `at`'s UTC `YYYY-MM-DD`), and `executePromptRoutine`. The path is: no port or no prompt → `skipped` + one ids-only warn; cap reached → `skipped` + ids-only warn without calling the runner; run the port (a throw counts as `'failed'`); `replied` → `markOk`, `failed` → `recordFailure` (the 3rd pauses, one fixed notice), every other outcome → `markSkipped`.
- **`execute.ts`**: added optional `runPrompt?: PromptRunner` to `ExecuteRoutinePorts`; inserted `if (row.kind === 'prompt') { await executePromptRoutine(...); return; }` after the shared AI/room preflight (step 1) and before step 2; kept T-1638's null-`toolId` branch and updated its comment to describe a malformed tool row. Header comment notes prompt routines branch after step 1.
- **`scheduler.ts`**: added optional `runPrompt` to `CreateRoutineSchedulerOptions` and passed it into the ports object. This needed a conditional spread (`options.runPrompt === undefined ? {} : { runPrompt: options.runPrompt }`) because the repo sets `exactOptionalPropertyTypes: true`.
- **New `apps/server/src/routines/execute-prompt.test.ts`** (229 lines): the six required cases, seeding a `kind='prompt'` row directly with `seedUser`/`seedAi` and the `execute.test.ts` setup.

Files changed (all inside Allowed files):
- `apps/server/src/routines/execute-prompt.ts` (new)
- `apps/server/src/routines/execute-prompt.test.ts` (new)
- `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/scheduler.ts`
- `work/T-1645-execute-prompt-routine.md`

### Checks run

Single test files while working (quiet reporter, worker cap):
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/execute-prompt.test.ts` → **Test Files 1 passed, Tests 6 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/execute.test.ts src/routines/scheduler.test.ts` → **Test Files 2 passed, Tests 3 passed** (tool routines unchanged).

`pnpm gate` from the repo root (after one `prettier --write` on the two new files):
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.9s)
PASS  lint  (1.3s)
PASS  typecheck  (4.2s)
PASS  effect  (1.0s)
PASS  tests @zilar/server  (7.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
Line counts: `execute-prompt.ts` 121, `execute-prompt.test.ts` 229, `execute.ts` 222, `scheduler.ts` 315 — all under 400.

### Notes for the lead

- The cap statement matches the spec's SQL but binds the limit from `MAX_PROMPT_RUNS_PER_DAY` (`WHERE routine_prompt_runs.count < ${MAX_PROMPT_RUNS_PER_DAY}`) instead of a literal `24`, so the constant and the query cannot drift. The cap is enforced atomically in one statement (no check-then-insert).
- Tests do not cover all six outcomes individually — the spec's list asks for `replied`, `stopped`, three `failed`, cap, no-port and inactive-AI; `'limited'`, `'offline'` and `'not_in_room'` map to the same `markSkipped` branch as `'stopped'`, which is covered.
- No gateway, wiring or adapter added, as required by step 5. The port stays absent in production, so a prompt routine is recorded `skipped` until a later task wires it.

## Review (written by Claude)

**Approved and merged.** This is scheduled AI jobs step 5a.

- **Pre-review:** clean, 2 test-coverage nits.
- **How a prompt routine runs:** it shares step 1 (the AI is active and in the room), then `executePromptRoutine` takes over:
  1. with no port, `skipped` plus an id-only warning;
  2. the atomic daily claim (`ON CONFLICT … WHERE count < 24`) — when the cap is reached, `skipped` and the runner isn't called;
  3. then `replied` → ok, `failed` (or a throw) → `recordFailure` (the 3rd pauses with the notice), and the rest → skipped.
- **`scheduler.ts`** passes an optional `runPrompt`.
- **The tests:** the lead ran `execute-prompt`, `execute` and `scheduler`: 9 passed.
- **Accepted:** a run that comes back `offline` or `not_in_room` still uses one of the 24 daily slots.

