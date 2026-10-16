---
id: T-1707
title: "Routines every minute (Julio 2026-10-16): interval floor 60 → 1 minute, daily prompt-run cap 24 → 1440 per AI, a routine whose last run is still queued or running is not run again, and routine.schedule gets a neutral example plus the schedule rules within the registry's 200-character limit (T-1704 crashed prod by going over it)"
status: merged
milestone: M5
branch: task/T-1707-minute-routines
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1707: Routines can run every minute

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-16) wants routines as often as every minute, and chose a cap of 1440 prompt runs per AI per day.

T-1704 tried to put the schedule rules into `routine.schedule`'s description. It went over the registry's 200-character limit (`apps/server/src/actions/registry.ts:146`, `ADAPTER_DESCRIPTION_MAX_LENGTH = 200`, checked at `:189-193`), so the server crashed at start and prod was down until the revert (`f57785344`). This task redoes that text within the limit.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/routines/schedule.ts`:**
  - `:11-12` (comment): `{ kind: 'interval', everyMinutes: number }` with `60 <= everyMinutes <= 10 080: nothing runs more often than hourly.`;
  - `:16`: `export const MIN_INTERVAL_MINUTES = 60;`;
  - `:38-42`: the filter text `everyMinutes must be at least ${MIN_INTERVAL_MINUTES}`.
- **`apps/server/src/routines/execute-prompt.ts:36-38`:** the comment "At most this many prompt runs per AI per UTC day…", then `export const MAX_PROMPT_RUNS_PER_DAY = 24;`.
- **`apps/server/src/routines/execute-prompt.test.ts:162-185`** ('skips without calling the runner once the day is at the cap') inserts a hard-coded `24` at `:170`.
- **`apps/server/src/routines/scheduler.ts`** (326 lines):
  - ticks every 30 s (`:58`) and claims at most `maxPerTick` (5) due rows (`:60`);
  - `claimDue` (`:222` on) advances `next_run_at` **before** the run;
  - claimed runs wait in `queue` (`:67`) for the pool (`pump`, `MAX_CONCURRENT_RUNS`);
  - `runOne` (`:95-128`) executes one, and `tick()` (`:149-154`) does `queue.push(...claimed); pump();`;
  - **nothing stops a routine from being claimed again while its previous run is still queued or running.** With a 1-minute schedule and AI turns that take minutes, runs would pile up.
- **`apps/server/src/tools/routine-adapters.ts:87-96`:** `routineScheduleAdapter`. The `description` today is 197 characters, and the `argsExample` is the "Morning prices" daily 08:00 Europe/Madrid case, which the AI copied word for word in Julio's test.
- **`apps/server/src/actions/args-example.test.ts`** builds the real registry, including `routine.schedule` (`:11-18`, `:48-51`, `buildRegistry(adapters)` must not throw). It is the test that catches an over-long description.

### Steps
1. **`schedule.ts`:**
   - set `MIN_INTERVAL_MINUTES = 1`;
   - update the `:11-12` comment to `1 <= everyMinutes <= 10 080` (drop "nothing runs more often than hourly").
2. **`execute-prompt.ts`:** set `MAX_PROMPT_RUNS_PER_DAY = 1440` and keep its comment true. In `execute-prompt.test.ts:170`, use the imported constant instead of `24`.
3. **`scheduler.ts`: no overlap.**
   - Keep a `Set<string>` of routine ids that are queued or running.
   - In `tick()`, a claimed routine whose id is in the set is not queued: its claim already advanced `next_run_at`, so that slot is simply skipped. Log it at `info` with `routineId`.
   - Add the id when it's queued, and remove it in `runOne`'s completion (the existing `.finally` in `pump`).
   - Keep the file under 400 lines.
4. **`routine-adapters.ts`:**
   - set `description` to exactly:

     `Schedule a routine here (needs approval): a prompt you run and answer, or a saved tool whose result is posted. Use the exact schedule asked for: daily HH:MM in an IANA zone, or every 1-10080 min.`
   - set `argsExample` to exactly:

     `{"title":"Release notes digest","schedule":{"kind":"interval","everyMinutes":120},"prompt":"Summarise the release notes posted in this chat since the last run."}`
5. **Tests** (routines are billed AI turns, so they count as money):
   - in `apps/server/src/routines/scheduler.test.ts`, add one case: a due routine whose previous run is still running (block the run function on a promise) isn't run a second time on the next tick;
   - run the four test files below, **including `args-example.test.ts`**: it must pass, since it's the check that keeps the server booting.

### Allowed files
- `apps/server/src/routines/schedule.ts`
- `apps/server/src/routines/execute-prompt.ts`
- `apps/server/src/routines/execute-prompt.test.ts`
- `apps/server/src/routines/scheduler.ts`
- `apps/server/src/routines/scheduler.test.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `packages/chat-core/src/routines.ts`
- `work/T-1707-minute-routines.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/actions/args-example.test.ts src/routines/scheduler.test.ts src/routines/execute-prompt.test.ts src/tools/routine-schedule-prompt.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The new limits:** `everyMinutes: 1` is accepted and `0` is refused, and the daily cap is 1440.
- **No overlap:** a routine never has two runs queued or running at once.
- **`args-example.test.ts` passes,** so the registry builds with the new description (200 characters or fewer).

---

## Report (written by the worker when done)

### What I did

- `apps/server/src/routines/schedule.ts`: `MIN_INTERVAL_MINUTES` 60 → 1; the header comment now reads `1 <= everyMinutes <= 10 080` (dropped "nothing runs more often than hourly"). The `everyMinutes must be at least …` filter text follows the constant automatically.
- `apps/server/src/routines/execute-prompt.ts`: `MAX_PROMPT_RUNS_PER_DAY` 24 → 1440. The comment above it still holds ("At most this many prompt runs per AI per UTC day …"), so it is unchanged.
- `apps/server/src/routines/execute-prompt.test.ts`: the cap test now seeds the imported `MAX_PROMPT_RUNS_PER_DAY` instead of a hard-coded `24` (import changed from `import type` to `import { MAX_PROMPT_RUNS_PER_DAY, type PromptRunner }`).
- `apps/server/src/tools/routine-adapters.ts`: set `routine.schedule`'s `description` to the exact string from the spec (195 characters, under the registry's 200 limit) and `argsExample` to the exact interval example (161 characters). Both verified by `args-example.test.ts`.
- `apps/server/src/routines/scheduler.ts`: added a `Set<string>` `inFlight` of routine ids with a claimed run queued or in flight. `tick()` now skips and `logger.info`s (with `routineId`) a claimed routine whose id is already in the set — its claim already advanced `next_run_at`, so that slot is dropped — and adds the id when it queues. `pump()`'s `.finally` removes the id when the run completes. Added `info` to `RoutineLogger`. File is 341 lines, under 400.
- `apps/server/src/routines/scheduler.test.ts`: `captureLogger` now also collects `info`; `seedRoutine` takes an optional `everyMinutes` (default 60); added one test: a routine due every minute whose first run is blocked on a promise is not run again on the next tick (only one runner call, one post).

### Checks run

- Single test run (the four files named in Checks):
  `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/args-example.test.ts src/routines/scheduler.test.ts src/routines/execute-prompt.test.ts src/tools/routine-schedule-prompt.test.ts`
  → `Test Files 4 passed (4)`, `Tests 35 passed (35)`, duration 9.76s.
- `pnpm gate` (from the repo root) → `GATE PASS`. Summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/server  (6.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 7 changed files are exactly the 6 allowed source files plus `work/T-1707-minute-routines.md`.

### Notes for the lead

- I added `info` to the `RoutineLogger` interface (required, not optional) so `tick()` can log the skip. The production caller (`leader/start.ts`) passes pino's `Logger`, which already has `info`; the only other construction site is the test helper, which I updated. No other file needed a change.
- No deviations from the spec. I did not touch any file outside the Allowed list.
- Acceptance: `everyMinutes: 1` is accepted (the new scheduler test both parses it and runs it via `claimDue`); `0` is refused by the filter `value >= MIN_INTERVAL_MINUTES` (`MIN_INTERVAL_MINUTES = 1`). The daily cap is 1440. `args-example.test.ts` passes, so the registry builds with the new 195-character description.

### Fix round 1 (the lead)

- **Item 1 — `packages/chat-core/src/routines.ts`:** `parseSchedule`'s interval branch now accepts `everyMinutes >= 1` (was `>= 60`), so a 1–59 minute routine reads as `every N minutes` instead of the `on a schedule` fallback. Web (`apps/web/src/lib/routines.ts`) and mobile re-export this helper from `@zilar/chat-core`, so the one change covers both. Added `packages/chat-core/src/routines.ts` to the Allowed files (commit `60d8bb82a`).
- **Item 2 — `apps/server/src/routines/execute-prompt.ts:7`:** the header comment now reads `1440/day` (was `24/day`) (commit `243083945`).
- `pnpm gate` after both: `GATE PASS`, 8 changed files, `scope: every changed file is inside the Allowed files`, with `PASS  tests @zilar/chat-core` and `PASS  tests @zilar/server`.

## Review (written by Claude)

**Approved and merged.** Julio's request on 2026-10-16: routines every minute, with a cap of 1440 a day.

- **Pre-review:**
  - first pass: clean, plus one follow-up and one nit. The chat-core display guard still required 60 or more minutes, and a comment still said 24/day;
  - both went back in fix round 1 and were fixed;
  - second pass: clean.
- **The change:**
  - `MIN_INTERVAL_MINUTES` drops to 1 and `MAX_PROMPT_RUNS_PER_DAY` rises to 1440;
  - the scheduler's `inFlight` set skips a routine whose last run is still queued or running;
  - `routine.schedule` gets a 195-character description with the schedule rules and the neutral "Release notes digest" example.
- **The tests:** the lead ran the 4 test files in the worktree: 35 tests passed, including `args-example.test.ts`, the check that the server boots.
