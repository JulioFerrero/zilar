---
id: T-1299
title: "AI failure logs carry a failure class and no provider free text (AI-22); routines: the tick no longer blocks while runs are in flight, a run more than 1 h late is skipped instead of firing, and a post that fails during a reconnect is retried once (AI-18); tested"
status: merged
milestone: M5
branch: task/T-1299-ai-logs-routines
model: auto
effort: default
depends_on: [T-1290]
estimate: 0.4 day
---

# T-1299: AI failure classes; routine timing

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md`:
- **AI-22** (P2, `:321`): failure logs carry `toRedactedError(err)` (`apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/dm-turn.ts`), whose message holds the provider's error text (`apps/server/src/agents/tool-loop.ts`). Some provider errors quote parts of the request, and there's no `kind` field to count failures by.
- **AI-18** (P2, `:287`):
  - a tick claims at most 5 routines and runs them 2 at a time, and it skips the next tick while busy (`apps/server/src/routines/scheduler.ts`);
  - after an outage, an overdue routine runs once on start even when it's 8 hours late;
  - a post during the AI's reconnect returns false and the run is `skipped`.

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **AI-22:**
   - failure logs carry a `kind` (the existing `mapFailureToReply` classes: key rejected, budget, rate limited, timeout, provider error, other; cite them) and the HTTP status if there is one;
   - **no** provider free text. Keep the free text out of logs entirely, or keep only its first 80 characters after redaction, and say which in the Report.
2. **AI-18:**
   - the tick claims and starts due runs without waiting for the previous tick's runs (keep the concurrency limit of 2, through a queue);
   - a run more than 1 hour past its scheduled time is marked `missed` (or the existing status that fits; cite it) and its next run is scheduled, with no post;
   - a post that fails because the AI's session is reconnecting is retried once after 30 s before being marked `skipped`.
3. **Tests,** up to 3, in the nearest routines or agents tests (cite them):
   - an 8-hour-late run is marked missed with no post;
   - a failed post is retried once;
   - a failure log has `kind` and no provider text.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (`:287-300`, `:321-330`), `apps/server/src/routines/scheduler.ts`, `apps/server/src/agents/tool-loop.ts` and the dm-turn files above.

### Allowed files
`apps/server/src/routines/*.ts`, `apps/server/src/agents/**/*.ts`, `work/T-1299-ai-logs-routines.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines src/agents --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines. No migration.

---

## Report (written by the worker when done)

### What I did

**AI-22 — failure logs carry a class, no provider text.**
- Confirmed the finding on `main`: `apps/server/src/agents/dm-turn.ts:132` and
  `apps/server/src/agents/gateway/dm-turn.ts:322-325` logged `redactError` /
  `toRedactedError`, whose message is the provider's error text (built in
  `tool-loop.ts:262-265,290-294`). Not fixed before this task.
- Added `apps/server/src/agents/failure-class.ts`: `classifyFailure(error)`
  returns `{ kind, status }`, and `failureLogFields(error)` returns
  `{ kind }` or `{ kind, status }` (status only when there is one). The kinds
  mirror the `mapFailureToReply` branches in `tool-exec.ts`: `budget`,
  `key_rejected`, `rate_limited`, `model_not_found`, `context_too_long`,
  `other`, plus a split of the DB-less branch into `timeout` (the request ran
  out of time) and `provider_error` (an HTTP status that matches no class
  above). `mapFailureToReply` now switches on `classifyFailure(...).kind`, so
  the reply text and the log class can never drift (the existing
  `reply.test.ts` mapping test still passes unchanged).
- Every model-failure log now carries `{ kind, status?, aiId }` and **no
  provider free text** (chosen: keep the free text out entirely, not 80
  chars): `agents/dm-turn.ts`, `agents/dm-tool-turn.ts` (2 sites),
  `agents/group-turn.ts` (3 sites) and `agents/gateway/dm-turn.ts`. Send
  failures still log the (redacted) XMPP error; only the model-failure lines
  changed.

**AI-18 — routines: non-blocking tick, missed late runs, one post retry.**
- Confirmed the finding: `scheduler.ts` skipped a tick while runs were in
  flight (`running` guard at the old `:60`) and ran an arbitrarily late run.
- `routines/scheduler.ts`: the `running` guard is gone. `tick()` now claims
  due rows (still `maxPerTick` per tick, oldest first, compare-and-set) and
  enqueues them; a queue drains at `MAX_CONCURRENT_RUNS = 2` (both across a
  tick and across overlapping ticks). Added `MISSED_AFTER_LATE_MS = 3_600_000`:
  a row more than 1 h past `next_run_at` is claimed, recorded
  `last_status = 'skipped'`, `last_run_at` set, `next_run_at` advanced, logged
  `routine run missed: more than 1 h late; next run scheduled`, and **not
  run** (no post, no tool call). Existing `'skipped'` is the status that
  fits: `RoutineLastStatus` is `'ok' | 'error' | 'skipped'`
  (`routines/schemas.ts:23`) and `RoutineRow.lastStatus`
  (`db/rows-agents.ts:131`, outside this task's Allowed files) has no
  `'missed'`; the spec forbids a migration, so no new status was added.
  Added `whenIdle()` to the handle so tests can await the queue.
- `routines/execute.ts`: step 5 retries the post once after
  `POST_RETRY_DELAY_MS = 30_000` (new `sleep`/`postRetryDelayMs` options, real
  `setTimeout` by default) before `markSkipped`.

**Tests (3, as asked).**
- `routines/scheduler.test.ts` — an 8-hour-late run is recorded `skipped`
  (missed) with no post while the on-time run still runs and posts.
- `routines/execute.test.ts` — a post that answers `false` is retried once
  after `POST_RETRY_DELAY_MS`, then the run records `ok`.
- `agents/reply.test.ts` — a 401 turn logs `kind: 'key_rejected'`,
  `status: 401`, and the provider's message (which quotes request content)
  never appears in any log field.

### Files changed
- `apps/server/src/agents/failure-class.ts` (new)
- `apps/server/src/agents/tool-exec.ts`
- `apps/server/src/agents/reply.ts`, `apps/server/src/agents/reply.test.ts`
- `apps/server/src/agents/dm-turn.ts`, `apps/server/src/agents/dm-tool-turn.ts`,
  `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/routines/scheduler.ts`, `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/scheduler.test.ts` (new),
  `apps/server/src/routines/execute.test.ts` (new)
- `work/T-1299-ai-logs-routines.md`

### Commands and real results
- `pnpm install` — done, resolved 1271 packages.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/scheduler.test.ts src/routines/execute.test.ts` — 2 files, 2 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts` — 1 file, 7 tests passed.
- `pnpm --filter @zilar/server exec vitest run src/routines src/agents --reporter=dot` — 6 files, 26 tests passed.
- `pnpm exec prettier --write <changed files>` — first gate run failed on format; this fixed it.
- `pnpm gate` — `GATE PASS`; `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`; `scope: every
  changed file is inside the Allowed files`; `migration: every added migration
  continues from the base`. No files outside scope. One intermediate gate run
  failed (format, then an unused `virtualKey` after removing its only read);
  both were fixed in scope.

### Deviations / notes
- The `kind` set is a superset of the one named in the spec: it keeps the
  actual `mapFailureToReply` branches (`model_not_found`, `context_too_long`)
  and adds `timeout` / `provider_error` by splitting `other`.
- A missed run reuses `last_status = 'skipped'` (see above); the UI shows
  "skipped", not a new "missed" value, because the row type is out of scope.
- The tick still claims at most `maxPerTick` (5) per sweep rather than
  looping until nothing is due; the queue now lets every sweep claim while
  runs are in flight, which is what the task asks (the tick no longer waits).
- No migrations, no new dependencies.

### Open questions
- None blocking. If the lead prefers the UI to read "missed", that needs a
  small change to `db/rows-agents.ts` + `routines/schemas.ts` + `wire.ts`
  (outside this task's Allowed files).

### Round (fix round)

Findings fixed:
- **Finding 1 (should-fix) — queued runs fire without re-checking lateness.**
  Lateness is now re-checked when the pool dequeues a run, not only at claim
  time. `ClaimedRoutine` became `{ row, dueAt }`, where `dueAt` is the
  `next_run_at` the claim was due at (before the claim advanced it). `pump()`
  passes the whole claimed item to `runOne`, which compares `now()` against
  `dueAt`; a run more than `MISSED_AFTER_LATE_MS` late is recorded
  `last_status = 'skipped'` with `last_run_at`, no post and no tool call, via
  the new `markQueuedMissed` helper (which does not advance `next_run_at`
  again — the claim already did). Files:
  `apps/server/src/routines/scheduler.ts`.

Nits (2–5) left as-is: per the round rules nits are optional and they are not
in lines this fix changed.

Tests added:
- `apps/server/src/routines/scheduler.test.ts` — "marks a run missed when it
  goes stale waiting in the queue": three routines claim in one tick; two hold
  the 2-slot pool while the third waits, the clock jumps 2 h, then the queued
  run is recorded `skipped` with no post (posts = 2, none is the queued title)
  and its `next_run_at` is the value the claim set (not advanced again).

Commands and real results:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/scheduler.test.ts`
  — 1 file, 2 tests passed.
- `pnpm gate` — `GATE PASS`; `PASS install (frozen)`, `PASS format`,
  `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`;
  `scope: every changed file is inside the Allowed files`; `migration: every
  added migration continues from the base`.

No migrations, no new dependencies.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (3 nits).**
- **AI-22:** failure logs carry `{ kind, status?, aiId }`, with the provider free text left out entirely.
- **AI-18:** the tick doesn't block, runs more than 1 h late are marked missed, and a post is retried once.
- **Lead's checks after the rebase:** server `src/routines` and `src/agents` vitest: 27 tests pass. server tsc: 0 errors. `group-turn.ts` is exactly 400 lines.
