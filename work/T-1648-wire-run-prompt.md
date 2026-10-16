---
id: T-1648
title: "Scheduled AI jobs step 5b: the leader's routine scheduler gets runPrompt wired to the live agent gateway's runScheduledTurn (offline while no gateway), so a prompt routine actually runs; nothing creates prompt routines yet"
status: merged
milestone: M5
branch: task/T-1648-wire-run-prompt
model: auto
effort: default
depends_on: [T-1647]
estimate: 20 min
---

# T-1648: Wire runPrompt to the gateway

## Spec (written by Claude, do not edit)

### Why
This is scheduled AI jobs, plan `docs/plan/scheduled-ai-jobs.md` §2.2 and §4 task 5 (T-1614).
- **T-1645:** the routine executor has an optional `runPrompt` port.
- **T-1647:** `AgentGateway.runScheduledTurn` runs a routine's turn on the AI's own queue.

**This task connects them in production,** the same way `post` reaches `postToChat` today.

### Facts (the lead read them on 2026-10-16 — re-check line numbers after T-1647)
- **`apps/server/src/startup/components.ts`** (304 lines): the `post` closure (`:80-92`) reads `running.gateway` and returns `false` while it's `null`, else `gateway.postToChat(...)`. Later `running.gateway = gateway;` (`:243`), and `createLeaderWork({ …, toolRunner, post, … })` (`:261-273`).
- **`apps/server/src/startup/lifecycle.ts:29`:** `gateway: Pick<AgentGateway, 'stop' | 'postToChat' | 'stopTurn'> | null;`
- **`apps/server/src/leader/start.ts`:** the deps have `post: BuildToolAdaptersDeps['post']` (`:46`), and `buildRoutineScheduler({ db, routinesEnabled, …toolRunner, audit, logger, post: deps.post })` (`:210-217`).
- **`apps/server/src/routines/wiring.ts`** (59 lines): `BuildRoutineSchedulerDeps` (`:17-31`) and `createRoutineScheduler({ db, runTool, post, audit, logger })` (`:50-56`).
- **`apps/server/src/routines/execute-prompt.ts`:** `PromptRunner` and `PromptRunOutcome` (T-1645). `ScheduledRunOutcome` is in the gateway contracts (T-1647); both use the same six names.

### Steps
1. **`lifecycle.ts:29`:** add `'runScheduledTurn'` to the `Pick`.
2. **`components.ts`:** next to `post`, add a `runPrompt: PromptRunner` closure. It returns `'offline'` while `running.gateway` is `null`, else `gateway.runScheduledTurn(input)`. Pass it into `createLeaderWork`.
3. **`leader/start.ts`:** add `runPrompt: PromptRunner` to the deps, and pass it to `buildRoutineScheduler`.
4. **`routines/wiring.ts`:** add optional `runPrompt?: PromptRunner` to `BuildRoutineSchedulerDeps`, and pass it to `createRoutineScheduler` (the option exists since T-1645).
5. **A type check:** if `ScheduledRunOutcome` and `PromptRunOutcome` differ in any member, fix the closure, not the types.
6. **No new test.** Wiring is covered by typecheck. Run the routine and leader tests that exist.

### Allowed files
- `apps/server/src/startup/components.ts`
- `apps/server/src/startup/lifecycle.ts`
- `apps/server/src/leader/start.ts`
- `apps/server/src/routines/wiring.ts`
- `work/T-1648-wire-run-prompt.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/scheduler.test.ts src/routines/execute-prompt.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **In production, the scheduler's `runPrompt` reaches `runScheduledTurn`.**
- **The gate passes.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

Wired the routine scheduler's `runPrompt` port to the live agent gateway's
`runScheduledTurn`, the same way `post` reaches `postToChat`.

- `apps/server/src/startup/lifecycle.ts`: added `'runScheduledTurn'` to the
  `gateway` `Pick` on `RunningServer`.
- `apps/server/src/startup/components.ts`: added a `runPrompt: PromptRunner`
  closure next to `post`; it returns `'offline'` while `running.gateway` is
  `null`, else forwards to `gateway.runScheduledTurn(input)`. Passed `runPrompt`
  into `createLeaderWork`. Added the `PromptRunner` type import.
- `apps/server/src/leader/start.ts`: added required `runPrompt: PromptRunner` to
  `LeaderWorkDeps` and passed `runPrompt: deps.runPrompt` into
  `buildRoutineScheduler`.
- `apps/server/src/routines/wiring.ts`: added optional `runPrompt?: PromptRunner`
  to `BuildRoutineSchedulerDeps` and forwarded it (conditionally, when present)
  to `createRoutineScheduler`; added the `PromptRunner` type import.

Type check (spec step 5): `PromptRunOutcome` and `ScheduledRunOutcome` are the
same six members (`replied`, `failed`, `stopped`, `limited`, `offline`,
`not_in_room`), and `PromptRunner`'s input matches `ScheduledTurnInput` exactly
(`aiId`, `groupId: string | null`, `topicId: string | null`, `routineId`,
`title`, `prompt`). So the closure forwards directly; no type was changed. No new
test was written (spec step 6); wiring is covered by typecheck.

### Checks run

- `pnpm install`: done, 1137 packages reused/added, `Done in 14.7s` (one
  pre-existing peer-dependency warning in `apps/mobile`).
- `pnpm --filter @zilar/server exec vitest run src/routines/scheduler.test.ts
  src/routines/execute-prompt.test.ts --maxWorkers=2 --reporter=dot`:
  `Test Files 2 passed (2)`, `Tests 8 passed (8)`.
- `pnpm gate`: `GATE PASS`. Summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.3s)`
  - `PASS  format  (0.8s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (6.4s)`
  - `PASS  effect  (3.6s)`
  - `PASS  tests @zilar/server  (17.3s)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead

- Only the 4 allowed source files plus this task file changed; the gate's
  `scope` line confirms every changed file is inside the Allowed files.
- Every touched source file stays within 400 lines.
- Production path: `createLeaderWork` always receives the `runPrompt` closure
  from `components.ts`, so `buildRoutineScheduler`→`createRoutineScheduler` now
  gets `runPrompt` and `executePromptRoutine` reaches `runScheduledTurn` once the
  gateway exists; while `running.gateway` is `null` it resolves `'offline'`, so
  the run is recorded `skipped`. Nothing creates prompt routines yet, as stated.
- No security-relevant surface: the port is only called by the leader's
  scheduler, never from the network; no secrets are logged or added.

## Review (written by Claude)

**Approved and merged.** This is scheduled AI jobs step 5b.

- **Pre-review:** clean, 2 nits (style, and comment wording).
- **The wiring:** `components.ts` builds a `runPrompt` closure (`offline` while `running.gateway` is null, else `runScheduledTurn`) and passes it through `createLeaderWork` → `buildRoutineScheduler` → `createRoutineScheduler`. `lifecycle.ts`'s `Pick` gains `runScheduledTurn`.
- **The tests:** the lead ran `scheduler` and `execute-prompt`: 8 passed.
- **With this, a prompt routine runs end to end on live.** T-1649 (the card that creates one) merges right after.
