---
id: T-1505
title: "AI work in topics, step 1 (docs/audit/ai-work-plan.md T1): per-topic AI activity read model — working from the gateway, waiting from pending approvals, done from the last task card — plus the card-end log row and its index"
status: merged
milestone: M5
branch: task/T-1505-ai-activity-read-model
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-1505: Per-topic AI activity read model

## Spec (written by Claude, do not edit)

### Why
Julio approved "AI work in topics" on 2026-10-15 (`docs/design/mockups/ai-work/README.md`). Nobody sets a topic status by hand any more. Each AI in a topic is one of:
- **working:** it is running a turn there;
- **waiting:** it has a pending approval there;
- **done:** its last task card there finished `done`;
- **idle**.

The plan is `docs/audit/ai-work-plan.md`; this task is its §7 step 1 (design in §6a). It also covers the lead's decisions in the T-1500 Review (`work/T-1500-ai-work-audit.md`): the in-memory gateway is the "working" source, and "done" is per AI. This task builds only the server read model. Wiring it into the topic list is the next task.

### Facts (the lead read them on main, 2026-10-15)
- **Running turns:** `AiSession.roomBusy: Set<string>` is "Rooms with a turn in flight", keyed by bare room JID (`apps/server/src/agents/gateway/contracts.ts:228-229`). It is set at `apps/server/src/agents/gateway/group-ingest.ts:273` and cleared at `:305`.
- **The gateway:** `apps/server/src/agents/gateway.ts` (310 lines) keeps `sessions = new Map<string, AiSession>()` keyed by AI id (`:64`), and returns `{ start, stop, reconcile, size, aiIds, postToChat, stopTurn }` (`:301-309`).
  - The routes reach the gateway lazily through `getGateway: () => TurnStopper | null` (`apps/server/src/ais/api.ts:62`).
  - `TurnStopper` lives in the import-free `apps/server/src/agents/gateway/stop-types.ts:6-8`.
- **Pending approvals:** an `approvals` row has `ai_id`, `group_id`, `topic_id` (nullable), `status` and `expires_at` (`apps/server/src/approvals/service.ts:104-137`). The pending read model treats a past-due `pending` row as expired (`apps/server/src/approvals/queries.ts:251-263`). The gateway gives a group without a General topic row `topicId: ''` (`apps/server/src/agents/gateway/db.ts:179`), so a room approval can have `topic_id` NULL.
- **The task card:**
  - its terminal state is decided in `finishProgressEffect` (`apps/server/src/agents/gateway/live.ts:155-186`), which calls `finishTaskCard` with `state: 'done' | 'failed' | 'stopped'`;
  - the turn's session log already writes one `status` row per reported stage there (`live.ts:109`, `log?.append('status', { stage })`);
  - only a stop is logged today (`apps/server/src/agents/turn-stop.ts:26`, `{ stage: 'stopped' }`), so nothing records that a card finished `done`.
- **The task log:** `agent_task_events` (`apps/server/drizzle/0060_agent_task_events.sql`: `chat_jid`, `ai_id`, `kind`, `at`, `data` jsonb). It is indexed on `(task_id, seq)` and `at` only. The last migration is `apps/server/drizzle/0062_topic_follow_paused.sql`.

### Steps (one commit each)
1. **Log the card's end.** In `finishProgressEffect` (`apps/server/src/agents/gateway/live.ts`), when a card is open and gets closed, append one session-log row: `log?.append('status', { stage: 'card_' + state })`, which gives `card_done`, `card_failed` or `card_stopped`. Use the same `log` as `:109`. A turn with no card logs nothing new.
2. **The index.** Add `apps/server/drizzle/0063_task_events_status_idx.sql`:
   ```sql
   SET lock_timeout = '5s';--> statement-breakpoint
   CREATE INDEX IF NOT EXISTS "agent_task_events_status_idx" ON "agent_task_events" ("chat_jid", "ai_id", "at") WHERE "kind" = 'status';
   ```
   No `rows.ts` change: it is only an index.
3. **The gateway accessor:**
   - in `apps/server/src/agents/gateway/stop-types.ts`, add an import-free `export interface TurnWatcher { runningAiIds: (roomJid: string) => string[] }`;
   - in `apps/server/src/agents/gateway.ts`, return `runningAiIds(roomJid)`: the ids of the live sessions whose `roomBusy` has that bare room JID.
4. **The read model, new file `apps/server/src/topics/ai-activity.ts`:**
   - Export `type AiActivityState = 'working' | 'waiting' | 'done'` and `topicAiActivity(deps: { db; getGateway: () => TurnWatcher | null }, topics: ReadonlyArray<{ topicId: string; groupId: string; roomJid: string; isGeneral: boolean }>): Promise<Map<string, Array<{ aiId: string; state: AiActivityState }>>>`, keyed by `topicId`. An AI that is idle is left out.
   - **At most two queries for the whole batch,** never one per topic:
     - **waiting:** `pending` approvals with `expires_at > now()` and `topic_id` in the batch, grouped by `(topic_id, ai_id)`. Rows with `topic_id IS NULL` count for the General topic of their `group_id` (`isGeneral`);
     - **done:** for each `(chat_jid, ai_id)` with `chat_jid` in the batch's room JIDs, the latest `status` row whose `data->>'stage'` starts with `card_`. The AI is done when that stage is `card_done`. Use `DISTINCT ON (chat_jid, ai_id) … ORDER BY chat_jid, ai_id, at DESC`, so the new index serves it.
   - **working:** `getGateway()?.runningAiIds(roomJid)`. A null gateway means nobody is working.
   - **One state per AI:** working wins over waiting, which wins over done.
   - Any failed read is best-effort: treat it as empty and never throw.
5. **One test,** `apps/server/src/topics/ai-activity.test.ts`, against the test database the other `apps/server/src/topics/*.test.ts` files use, with a fake gateway. It checks:
   - a running AI is `working`, even if it also has a pending approval;
   - an AI with a pending approval is `waiting`, and an expired one is not;
   - an AI whose latest `card_*` row is `card_done` is `done`, and a later `card_failed` makes it idle;
   - a NULL-topic approval counts for the General topic;
   - one call answers two topics.

### Not in scope
- the topic list or contract (step 2);
- live notices;
- the person's "mark done";
- the UI.

### Allowed files
- `apps/server/src/agents/gateway/live.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway/stop-types.ts`
- `apps/server/drizzle/0063_task_events_status_idx.sql` (new)
- `apps/server/src/topics/ai-activity.ts` (new)
- `apps/server/src/topics/ai-activity.test.ts` (new)
- `work/T-1505-ai-activity-read-model.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/ai-activity.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A closed task card logs `card_done`, `card_failed` or `card_stopped`.
- `topicAiActivity` answers a batch of topics in at most two queries plus the gateway call, with working over waiting over done.
- The migration applies on an empty database.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

All five spec steps, one commit:

1. **Card-end log row** — `apps/server/src/agents/gateway/live.ts`: in
   `finishProgressEffect`, right after the "card is open and being closed" guard,
   appended `log?.append('status', { stage: `card_${state}` })`, so a closed card
   writes `card_done` / `card_failed` / `card_stopped`. A turn with no card still
   logs nothing new.
2. **Index** — added `apps/server/drizzle/0063_task_events_status_idx.sql`
   exactly as specified (lock timeout first, partial index on
   `(chat_jid, ai_id, at) WHERE kind = 'status'`). No `rows.ts` change.
3. **Gateway accessor** — `apps/server/src/agents/gateway/stop-types.ts`: added the
   import-free `TurnWatcher { runningAiIds }`. `apps/server/src/agents/gateway.ts`:
   the gateway now returns `runningAiIds(roomJid)`, the ids of the live sessions
   whose `roomBusy` holds that room.
4. **Read model** — new `apps/server/src/topics/ai-activity.ts` with
   `AiActivityState`, `topicAiActivity(deps, topics)` keyed by `topicId`. Two
   reads for the whole batch plus the gateway call: pending+unexpired approvals
   (`topic_id` in the batch, plus NULL-topic rows of the batch's General groups)
   and, per `(chat_jid, ai_id)`, the latest `card_*` status row via
   `DISTINCT ON … ORDER BY chat_jid, ai_id, at DESC`. One state per AI, working
   over waiting over done; idle AIs are left out. Each read is best-effort
   (`try/catch`, empty on failure) and never throws.
5. **Test** — new `apps/server/src/topics/ai-activity.test.ts` against the test
   database with a fake gateway. It covers: running beats a pending approval;
   waiting for a live approval and not for an expired one; `card_done` → done;
   a later `card_failed` → idle; and one call answering two topics.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ai-activity.test.ts`
  → `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
  (Ran the AGENTS.md form with the worker cap; the task's `exec vitest run …` is
  the same file/reporter.)
- `pnpm gate` (from the repo root) → **GATE PASS**:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (14.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first two gate runs failed on formatting (my two new files) and then on
  typecheck (`sql<Row>` returns a readonly array); both fixed, then the run above
  passed. No files outside the Allowed files; every changed file is under 400
  lines.

### Notes for the lead

- **Deviation: the "NULL-topic approval counts for the General topic" test is
  impossible under the current schema, so I did not write it.** A room approval
  cannot have `topic_id IS NULL`: migration
  `apps/server/drizzle/0022_topic-scope-backfill.sql` backfills every
  group-scoped NULL topic to the group's General topic (`:12-15`) and then adds
  `approvals_topic_scope_check CHECK (("group_id" IS NULL) = ("topic_id" IS NULL))`
  (`:50-57`), so `group_id` set + `topic_id` NULL is rejected. `createApprovalEffect`
  also requires a real topic that belongs to the group
  (`apps/server/src/approvals/service.ts:83-89`). My first attempt to seed that
  row failed with `violates check constraint "approvals_topic_scope_check"`. I
  kept the defensive NULL-topic branch in the read model exactly as the spec asks
  (`row.topicId ?? generalTopics.get(row.groupId)`), but it is dead code under
  today's schema. I replaced the missing bullet with a test that pins the real
  invariant: a DM-scoped approval (both `group_id` and `topic_id` NULL) is
  attributed to no topic. Tell me whether to drop the branch or keep it pending a
  schema change — the spec's "Facts" bullet ("a room approval can have `topic_id`
  NULL") does not hold against the migrations.
- **`AgentGateway` return type**: `runningAiIds` had to be declared somewhere for
  the object literal to typecheck, and `AgentGateway` lives in
  `apps/server/src/agents/gateway/contracts.ts`, which is not an Allowed file. I
  widened the factory's return type to `AgentGateway & TurnWatcher` in
  `gateway.ts` instead, and imported `TurnWatcher` from `./gateway/stop-types`.
  This is additive: every existing `AgentGateway` consumer still typechecks, and
  the app/route wiring that will read it is step 2.
- `topicAiActivity` returns per-topic entries in insertion order (done, then
  waiting, then working); the test sorts before comparing. Say if you want a
  stable order baked in.
- No dependencies added, no writes, no route changes, so the security checklist
  items (scoping, caps, 404 parity, rate limits) do not apply to this read-only
  addition.

### Round 1 (fix round)

Findings source: `PREREVIEW.md`.

**Fixed**
- **Finding 1 (must-fix): `sql.in([])` rendered `IN ()` and silently dropped
  every `waiting` state for a general-free batch.** `loadPendingApprovals`
  (`apps/server/src/topics/ai-activity.ts`) now adds the
  `OR (topic_id IS NULL AND group_id IN …)` branch only when the batch has a
  General topic, and composes the scope with `sql.or([...])` instead of a literal
  `IN ()`. New test in `ai-activity.test.ts`: `answers a batch with no General
  topic, keeping its waiting state` — batch = the Second topic only, one live
  pending approval → `waiting`.
  - Single test run:
    `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ai-activity.test.ts`
    → `Test Files 1 passed (1)`, `Tests 7 passed (7)`.

**Not fixed here (each fixes a file outside the Allowed files)**
- **Finding 2 (should-fix): two rows on the stop path.** Confirmed by reading the
  code: on a stop, `finishProgressQuietly` (`apps/server/src/agents/turn-stop.ts:26`,
  pre-existing T-1426, not an Allowed file) appends `{ stage: 'stopped' }`, then
  `finishProgressEffect` (`live.ts:165`) appends `{ stage: 'card_stopped' }`. The
  `card_stopped` row is the one T-1505's spec step 1 asks for; deleting the
  redundant `stopped` row is a one-line change in `turn-stop.ts`, outside this
  task's Allowed files. I left both rows and record the duplication as
  intentional until that follow-up, which is the second resolution PREREVIEW's
  finding 2 offers: the read model filters `LIKE 'card_%'` and
  `DISTINCT ON … at DESC` picks `card_stopped`, so the activity answer is correct
  today; the only cost is the duplicate stop row.
- **Finding 3 (should-fix, spec fit): `AgentGateway & TurnWatcher` has no typed
  consumer.** Also out of scope: `runningAiIds` would have to be declared on
  `AgentGateway` (`apps/server/src/agents/gateway/contracts.ts`) or the lazy
  handle widened in `apps/server/src/ais/api.ts`, both outside the Allowed files.
  As PREREVIEW's finding 3 says, the read model takes its own `TurnWatcher` dep
  and is unaffected; step 2 ("wiring it into the topic list") owns the wiring and
  the type. Recorded as a follow-up for step 2, not reworked here.

**Nit left untouched**
- **Finding 4 (nit): `LIKE 'card_%'` (`ai-activity.ts:179`).** The line is not one
  this round changes, and the finding itself says it is not worth a round on its
  own, so per the fix-round rule ("do not touch nits unless they are in a line you
  already change") I left it as-is.

**Gate:** `pnpm gate` from the repo root → **GATE PASS**:
```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.7s)
PASS  typecheck  (2.9s)
PASS  effect  (0.5s)
PASS  tests @zilar/server  (11.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
`status` stays `review`.

### Round 2 (fix round)

Findings source: `PREREVIEW.md` (round 2).

**Fixed**
- **Finding 1 (should-fix): the gateway call escaped the best-effort
  contract.** `topicAiActivity` (`apps/server/src/topics/ai-activity.ts:92-105`)
  now wraps the `deps.getGateway()` call and the `runningAiIds` scan in a
  `try/catch`, matching the two DB reads: a throwing gateway (or getter) logs
  nobody working instead of rejecting the whole answer and losing the
  waiting/done states already gathered. The `working` map is cleared on failure,
  so a throw reads as empty rather than as a partial scan. New test in
  `ai-activity.test.ts`: `treats a throwing gateway as nobody working instead of
  failing the read` — a live approval in the Second topic plus a `card_done` row
  in the General room resolve to `waiting` and `done` while a throwing gateway
  returns no `working`.
  - Single test run:
    `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ai-activity.test.ts`
    → `Test Files 1 passed (1)`, `Tests 8 passed (8)`.

**Nit left untouched**
- **Finding 2 (nit): `LIKE 'card_%'` (`ai-activity.ts:186`).** Not a line this
  round changes (the fix is at the gateway block above it), and the finding says
  it is not worth a round on its own, so per the fix-round rule I left it as-is.

**Follow-ups (unchanged from PREREVIEW)**: the duplicate stop row in
`turn-stop.ts:26` and typing `runningAiIds` on `AgentGateway` / the lazy handle
are both outside the Allowed files; step 2 owns the wiring.

**Gate:** `pnpm gate` from the repo root → **GATE PASS**:
```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.7s)
PASS  typecheck  (2.3s)
PASS  effect  (0.4s)
PASS  tests @zilar/server  (12.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
`status` stays `review`.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 nit, for head `f455dc801`, after 2 automatic fix rounds.
- **The lead read the diff:**
  - `finishProgressEffect` logs `card_<state>` only when a card closes;
  - `runningAiIds(roomJid)` scans the live sessions' `roomBusy`;
  - `topicAiActivity` makes two batched queries plus the gateway call, each one best-effort;
  - 8 database tests;
  - `0063` is index-only with `lock_timeout`.
- **Live table:** read-only check, `agent_task_events` has 0 rows and is 40 kB, so the index build is instant.
- **Nit accepted:** `LIKE 'card_%'`, where `_` matches any character; no writer produces such a stage.
- **Follow-ups for step 2:**
  - type `runningAiIds` on the gateway handle the routes get;
  - the old `{ stage: 'stopped' }` row next to `card_stopped` is harmless.
