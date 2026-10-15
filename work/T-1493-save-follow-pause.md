---
id: T-1493
title: "An AI's Stop pause on a followed topic is saved (Julio, 2026-10-15): topics.follow_paused_at, loaded at gateway start, so a restart or deploy never resumes following on its own"
status: merged
milestone: M5
branch: task/T-1493-save-follow-pause
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1493: Save the Stop pause

## Spec (written by Claude, do not edit)

### Why
T-1448 has an AI that owns a topic follow it. Stop pauses following until the AI is @mentioned or reassigned. The pause lives only in memory, so every restart, and so every deploy, quietly resumes following. Julio decided on 2026-10-15 that the pause is saved.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/agents/gateway/topic-follow.ts`** (102 lines):
  - `pausedFollows` (`:29-31`) is a `Map<aiId, Set<roomLocalpart>>`, in memory only;
  - `pauseFollow` (`:80-85`), `resumeFollow` (`:88-97`) and `isFollowPaused` (`:100-102`) are synchronous and take no database handle;
  - the header comment (`:5-6`) and `:29-30` say a restart clears every pause.
- **Callers:**
  - `stop.ts:40` calls `pauseFollow`;
  - `group-ingest.ts:161` calls `resumeFollow` on a mention, and `:203`, `:212` call `isFollowPaused` on the message path;
  - `apps/server/src/topics/service.ts:283` calls `resumeFollow` when an AI owner is assigned.
- **The `topics` table:**
  - `owner_ai_id` is in `TopicRow` (`apps/server/src/db/rows.ts:77-96`; the file has 376 lines);
  - `topics/service.ts` (390 lines) builds `patch` at `:252` and sets `ownerAiId` at `:259`, then writes it at `:274`.
- **Migrations are hand-written SQL in `apps/server/drizzle/`.**
  - The newest is `0061_user_time_zone.sql`, whose first line is `SET lock_timeout = '5s';--> statement-breakpoint`.
  - Follow `AGENTS.md` "Migrations: expand/contract".
- **Gateway start:** `apps/server/src/leader/start.ts` `start()` (`:195-…`) calls `startGatewayWork()` (`:173-183`).
- **The tests** in `apps/server/src/agents/gateway/topic-follow.test.ts` run on the test database (`test-support/seed`). "pauses on Stop, and a mention queues a turn and resumes following" (`:199`) covers the in-memory pause.

### What to build
1. **New migration `apps/server/drizzle/0062_topic_follow_paused.sql`:**
   - the `SET lock_timeout` line exactly as in 0061;
   - then `ALTER TABLE "topics" ADD COLUMN "follow_paused_at" timestamptz;`
   - `rows.ts` `TopicRow` gains `followPausedAt: Date | null;`.
2. **`topic-follow.ts`:** keep `pausedFollows` as the in-memory copy, so `isFollowPaused` stays synchronous, and save every change to the database.
   - **`initTopicFollow(db)`** stores `db` for the module, then loads `SELECT owner_ai_id, room_localpart FROM topics WHERE follow_paused_at IS NOT NULL AND owner_ai_id IS NOT NULL AND archived_at IS NULL` into `pausedFollows`.
   - **`pauseFollow`** updates memory first, as today. Then, when `db` is set, it runs `UPDATE topics SET follow_paused_at = now() WHERE room_localpart = … AND owner_ai_id = …` and returns that promise. Callers keep `void`; tests await it.
   - **`resumeFollow`** updates memory, then `UPDATE topics SET follow_paused_at = NULL WHERE room_localpart = … AND owner_ai_id = … AND follow_paused_at IS NOT NULL`, returning the promise in the same way.
   - **A failed write** is caught and logged with the module's existing logging pattern, or a returned rejection the callers already `void`. It must never throw into the message path.
   - Rewrite the two comments (`:5-6`, `:29-30`) to say the pause is saved.
3. **`topics/service.ts`:** where `patch.ownerAiId` is set (`:259`), also set `patch.followPausedAt = null`, so a new owner never inherits an old pause. One line.
4. **`leader/start.ts`:** in `start()`, before `startGatewayWork()`, `await initTopicFollow(db)`. If it fails, log it and carry on, so a load failure never blocks start.
5. **One test** in `topic-follow.test.ts`, since this is the message pipeline: "a Stop pause survives a restart".
   - Stop the owner AI in its followed room.
   - Clear the in-memory state (add and export a small reset helper used only by tests).
   - Call `initTopicFollow(db)` again.
   - A plain human message queues nothing, and an @mention resumes following and clears `follow_paused_at`.
6. Keep every source file at most 400 lines.

### Allowed files
- `apps/server/drizzle/0062_topic_follow_paused.sql`
- `apps/server/src/db/rows.ts`
- `apps/server/src/agents/gateway/topic-follow.ts`
- `apps/server/src/agents/gateway/topic-follow.test.ts`
- `apps/server/src/topics/service.ts`
- `apps/server/src/leader/start.ts`
- `work/T-1493-save-follow-pause.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/topic-follow.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and the new test passes.
- **After the deploy, the lead checks the live database:** the migration is applied, and `topics.follow_paused_at` exists.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/drizzle/0062_topic_follow_paused.sql`** (new): the `SET lock_timeout = '5s';--> statement-breakpoint` first line copied from `0061`, then `ALTER TABLE "topics" ADD COLUMN "follow_paused_at" timestamptz;` (expand only: a nullable column, nothing dropped or renamed).
- **`apps/server/src/db/rows.ts`**: `TopicRow` gained `followPausedAt: Date | null;` (after `ownerAiId`).
- **`apps/server/src/agents/gateway/topic-follow.ts`**:
  - `pausedFollows` stays the synchronous in-memory copy, so `isFollowPaused` is unchanged and still synchronous.
  - New module-level `pauseDb`, set by **`initTopicFollow(database)`**, which also loads `SELECT owner_ai_id, room_localpart FROM topics WHERE follow_paused_at IS NOT NULL AND owner_ai_id IS NOT NULL AND archived_at IS NULL` into `pausedFollows`.
  - **`pauseFollow`** sets memory first, then (when `pauseDb` is set) runs `UPDATE topics SET follow_paused_at = now() WHERE room_localpart = … AND owner_ai_id = …`; it now returns `Promise<void>` instead of `void`. **`resumeFollow`** clears memory, then runs the `… SET follow_paused_at = NULL … AND follow_paused_at IS NOT NULL` update, also returning the promise (it keeps the old early return when memory has no entry, so a mention in a never-paused room still does no write).
  - A failed write is swallowed and logged, never thrown into the message path (`saveFollowChange` + `logNotSaved`; details under "Notes").
  - New **`resetTopicFollowStateForTests()`** clears the memory set (and owner cache and `pauseDb`) so a test can reload the way a restart does; no server code calls it.
  - The two stale comments (header, `pausedFollows`) now say the pause is saved and reloaded.
- **`apps/server/src/topics/service.ts`**: where `patch.ownerAiId` is set, `patch.followPausedAt = null` is set too, so a new owner never inherits the old owner's pause.
- **`apps/server/src/leader/start.ts`**: `start()` now `await initTopicFollow(db)` before `startGatewayWork()`, with a `.catch` that logs `saved topic follow pauses failed to load` and carries on.
- **`apps/server/src/agents/gateway/topic-follow.test.ts`**: new test **"a Stop pause survives a restart"**: start (`initTopicFollow`) → Stop (asserts the row's `follow_paused_at` is set) → `resetTopicFollowStateForTests()` + `initTopicFollow(db)` (the restart) → a plain human message queues nothing → an `@mention` queues a turn and clears `follow_paused_at`. Two small poll helpers were added because the pause/resume writes are fire-and-forget; the describe's `afterEach` also resets the module state so the other tests in the file stay isolated.

Deviations from the spec (all small, none change the plan):
- The spec left the failure handling as "caught and logged with the module's existing logging pattern, or a returned rejection the callers already `void`". `topic-follow.ts` has **no** logger, and the callers (`stop.ts`, `group-ingest.ts`, `topics/service.ts`) are **outside the Allowed files**, so I could not pass one in or change them. I chose the first option and log through Effect's own logger (`Effect.logWarning`), the same mechanism `effect/sql.ts` uses for its swallowed background failure. The returned promise never rejects, so `void`ing it in the existing callers is safe.
- `runSql` throws synchronously when a database has no registered runtime (only reachable in tests, or a disposed runtime); that path is caught too (`Effect.runSync(logNotSaved(...))`) so it can never throw into `stopTurn`/the message path.
- I did not touch `apps/server/src/topics/ais.ts` or `apps/server/src/groups/ais.ts`, which clear `owner_ai_id` when an owner is removed and leave a stale `follow_paused_at` behind. That is harmless: the reload requires `owner_ai_id IS NOT NULL`, and both writes name the owner, so a stale timestamp cannot reload a pause or clear another topic. Those files are outside the Allowed list.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow.test.ts` — **13 passed** (1 file), including the new "a Stop pause survives a restart". Run twice, both green.
- `pnpm gate` (from the repo root); the run below is the final one, after the last edit:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (0.7s)
PASS  typecheck  (0.9s)
PASS  effect  (0.4s)
PASS  tests @zilar/server  (6.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The 7 changed files are the 5 Allowed sources, the new migration and this task file. No file outside the Allowed list.

### Notes for the lead

- The migration is hand-written and tested only through PGlite (the server test suite migrates from `apps/server/drizzle/`). The acceptance item "the migration is applied and `topics.follow_paused_at` exists" needs your live-database check after the deploy; I did not touch any database.
- Two races the spec did not ask me to close, both pre-existing in shape and out of scope: (1) if a mention arrives while the Stop's fire-and-forget `UPDATE` is still in flight, the resume update can land first and leave the row paused while memory says following (a later restart would then reload the pause); (2) a follower process that runs `topics/service.ts` without `initTopicFollow` has `pauseDb` undefined, but the `patch.followPausedAt = null` write in that same service call still clears the row, which is why the spec asked for it.
- `Effect.catchCause` (Effect 4.0.4) is what swallows both typed `SqlError`s and defects; `catchAllCause` does not exist in this version.

### Round 1 (fix round, 2026-10-15)

**Finding 1 (should-fix) — fixed.** The new restart test's zero-turn assertion could pass for the wrong reason. At HEAD the plain-message call already had `await`, but the paused room short-circuits and `handleRoomIncoming` returns `undefined`, so the await was a no-op: had the reload silently failed, the code would take the async `followOwnedTopic` path, the promise would be awaited but the turn is queued through `Effect.runFork`, so `turns` could still be 0 at the assertion. `topic-follow.test.ts` now captures the return value and asserts `expect(pending).toBeUndefined()` before awaiting, which pins the paused short-circuit: a broken reload returns `followOwnedTopic`'s promise and fails deterministically.

**Finding 2 (nit) — not touched.** AGENTS-style instruction for this round: do not touch nits unless in a line already changed. Finding 1 changes only the test file, so `initTopicFollow` in `topic-follow.ts` is left as is (the reviewer noted no current caller hits it).

**Findings 3 and 4 (follow-ups) — not touched.** Both need files outside the Allowed list (`topics/ais.ts`, `groups/ais.ts`) or caller sequencing the spec accepted; unchanged.

Tests: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/topic-follow.test.ts` — 13 passed (1 file). Mutation check: temporarily skipping the reload loop in `initTopicFollow` made the new test fail at `expect(pending).toBeUndefined()` ("Received: Promise {}"), confirming the assertion is meaningful; the file was reverted before the gate.

Gate: `pnpm gate` — GATE PASS (install, format, lint, typecheck, effect, tests @zilar/server all PASS; scope, migration, images, size PASS). 7 changed files against main, all inside the Allowed files.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean after 1 auto round for head `4fa9d4b87`, with 1 nit and 2 follow-ups.
- **The code follows the spec:**
  - migration 0062 adds `topics.follow_paused_at` behind a 5 s lock timeout. 0061 also shipped as a lone SQL file, so nothing else is needed to pick it up;
  - `initTopicFollow` loads only paused rows with an owner AI that are not archived, and `start.ts` logs a failed load instead of blocking start;
  - pause and resume write through, scoped by room and owner AI, and never throw into the message path;
  - `patchTopic` clears the pause when the owner changes;
  - the restart test reloads the pause.
- **Left as they are (rare, harmless today):**
  - the nit, an async rejection after the runtime is disposed;
  - F1: removing the owner AI keeps a stale `follow_paused_at`, which the reload ignores;
  - F2: a Stop and a mention a few milliseconds apart can save out of order.
- **After the deploy:** the lead checks that the live database has the column.

