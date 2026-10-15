---
id: T-1521
title: "AI work in topics, step 3 (docs/audit/ai-work-plan.md T3): a person marks a topic done — topics.done_at (migration 0064), PATCH /topics/:id {done}, doneAt on the topic views, contract, TopicInfo and the mock; patchTopic moves to its own file"
status: merged
milestone: M5
branch: task/T-1521-topic-done-flag
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1521: A person marks a topic done

## Spec (written by Claude, do not edit)

### Why
This is step 3 of the approved "AI work in topics" plan (`docs/audit/ai-work-plan.md` §6d and §7 T3).

An AI's own "done" already comes from its last task card (T-1505). A person also needs to mark a whole topic done. The lead decided (2026-10-15) on a topic-level flag, `topics.done_at`.
- **Who may set it:** anyone who can see the topic, the same rule as the task strip today.
- **A topic shows as done** when the flag is set and no AI is working or waiting there now.

**No UI here:** the web and mobile UIs are steps 6 and 7.

### Facts (the lead read them on main, 2026-10-15)
- **The last migration:** `apps/server/drizzle/0063_task_events_status_idx.sql`. The hand-written pattern is `apps/server/drizzle/0062_topic_follow_paused.sql`: `SET lock_timeout = '5s';--> statement-breakpoint`, then `ALTER TABLE "topics" ADD COLUMN ...`. New migrations are hand-written SQL that `migrateSql` runs (check how 0062/0063 were registered and do the same).
- **`apps/server/src/db/rows.ts` (377 lines):** `TopicRow` has `followPausedAt: Date | null` (`:88`).
- **`apps/server/src/topics/service.ts` is 392 lines.**
  - `patchTopic` (`:174-~330`), with `PatchTopicInput` at `:169`;
  - a "strip only" change (`:182-187`), which lists every field except name, glyph, visibility, archived and memberIds, is open to anyone who can see the topic (`requireVisibleTopic`); other changes need a manager;
  - the row update is `UPDATE topics SET ${sql.update(snakeCaseKeys(patch))}`.
  - `patchTopic` is imported only by `apps/server/src/topics/api.ts:43`, and called at `:149`.
- **The views:**
  - `apps/server/src/topics/views.ts` `buildTopicView` (`:95-125`) builds `TopicView`;
  - `TopicView` is in `apps/server/src/topics/access.ts` (394 lines; the interface is at `:54-80`).
- **Contract:** `packages/api-contract/src/topics.ts` has `PatchTopicPayload` (`:110-122`) and `Topic` (with T-1514's optional `activity`).
- **Client:**
  - `TopicInfo` is in `packages/chat-core/src/types.ts` (with `activity` at `:161`);
  - `topicInfoOf` is in `packages/client-core/src/store/chat-rows.ts` (397 lines).
- **Mock:**
  - `packages/mock-backend/src/domains/topics/routes.ts` (313 lines) handles PATCH in `patchTopic` (`:48`, `:100-140`);
  - `view.ts` builds the topic (`:40-62`);
  - `tables.ts` has `MockTopic`.
- **Test setup:** `apps/server/src/topics/ais.test.ts:3-10` uses `createTestContext`, `testSql`, `seedAi`, `seedGroup` and `seedUser`.

### Steps
1. **Migration `apps/server/drizzle/0064_topic_done_at.sql`:** `SET lock_timeout = '5s';--> statement-breakpoint`, then `ALTER TABLE "topics" ADD COLUMN "done_at" timestamptz;`. Register it the way 0063 is. `TopicRow` gains `doneAt: Date | null`.
2. **Split first:** move `patchTopic` and `PatchTopicInput` from `service.ts` into a new `apps/server/src/topics/patch.ts`, unchanged, and update the import in `topics/api.ts`. If anything else imports them from `service.ts`, re-export them there.
3. **`patch.ts`:**
   - `PatchTopicBody` gains `done?: boolean`;
   - `done` is a strip-only field (open to anyone who can see the topic);
   - `true` sets `doneAt = new Date()` and `false` sets `doneAt = null`. Not allowed on an archived topic (the existing rule).
   - The General topic may be marked done too.
4. **Contract:**
   - `PatchTopicPayload` gains `done: Schema.optional(Schema.Boolean)`;
   - `Topic` gains `doneAt: Schema.optional(Schema.NullOr(Schema.String))`, an ISO time, absent on older servers;
   - `TopicView` gains `doneAt: string | null`, which `buildTopicView` fills from the row.
5. **Client:**
   - `TopicInfo` gains `doneAt: string | null`, and `topicInfoOf` maps it (`?? null`);
   - fix every other `TopicInfo` literal that typecheck names, using `doneAt: null`.
   - `chat-rows.ts` must stay at or under 400 lines.
6. **Mock:**
   - `MockTopic` gains `doneAt?: string | null`;
   - PATCH handles `done` (`true` sets now as ISO, `false` clears it);
   - `view.ts` passes `doneAt` (`?? null`).
7. **One test, `apps/server/src/topics/patch.test.ts`** (permissions, set up like `ais.test.ts`):
   - a plain group member marks a public topic done, so `doneAt` is set; then un-marks it, so it is cleared;
   - a user outside the group gets the missing-topic error.

### Not in scope
- the UI;
- live notices;
- owner following;
- clearing the flag when an AI starts again. The "done only when nobody works or waits" rule is the client's to apply in steps 6 and 7.

### Allowed files
- `apps/server/drizzle/0064_topic_done_at.sql` (new)
- whatever file registers migrations, if 0063 needed one (name it in the Report)
- `apps/server/src/db/rows.ts`
- `apps/server/src/topics/service.ts`
- `apps/server/src/topics/patch.ts` (new)
- `apps/server/src/topics/patch.test.ts` (new)
- `apps/server/src/topics/api.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/views.ts`
- `apps/server/src/topics/schemas.ts`
- `packages/api-contract/src/topics.ts`
- `packages/chat-core/src/types.ts`
- `packages/client-core/src/store/chat-rows.ts`
- `packages/mock-backend/src/domains/topics/routes.ts`
- `packages/mock-backend/src/domains/topics/tables.ts`
- `packages/mock-backend/src/domains/topics/view.ts`
- any file typecheck names for a missing `doneAt` in a `TopicInfo` literal (list them in the Report)
- `work/T-1521-topic-done-flag.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/patch.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- `PATCH /api/topics/:id {"done":true}` from any member who can see the topic sets `doneAt`, and `{"done":false}` clears it.
- The topic list and single-topic responses carry `doneAt`.
- The mock does the same.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

- **Migration:** added `apps/server/drizzle/0064_topic_done_at.sql`
  (`SET lock_timeout = '5s';--> statement-breakpoint` then
  `ALTER TABLE "topics" ADD COLUMN "done_at" timestamptz;`). **No registration
  file is needed:** `_journal.json` stops at 0046 and 0047–0063 are hand-written
  SQL that `migrateSql` reads from the folder, so 0063 had no registration step
  and neither does 0064.
- **Row:** `TopicRow.doneAt: Date | null` (`apps/server/src/db/rows.ts`).
- **Split:** moved `patchTopic`, `PatchTopicInput` and the private
  `snakeCaseKeys` helper, unchanged, into the new
  `apps/server/src/topics/patch.ts`. `topics/api.ts` now imports `patchTopic`
  from `./patch`; `service.ts` imports it from `./patch` for `archiveTopic`.
  `mapXmppError` stays in `service.ts` (it is `createTopic`'s error mapper and
  `patchTopic` does not need it), so there is no import cycle.
- **Done flag:** `PatchTopicBody.done?: boolean`; `done` is strip-only (added to
  the `stripOnly` check), so anyone who can see the topic may set it. `true`
  stamps `doneAt = new Date()`, `false` clears it to `null`. The existing
  archived-topic 404 still applies; General may be marked done.
- **Views / contract:** `buildTopicView` fills `doneAt` as an ISO string or
  `null`; `TopicView` gained it; `PatchTopicPayload.done` and
  `Topic.doneAt: Schema.optional(Schema.NullOr(Schema.String))` (`api.ts` patch
  handler forwards `done`).
- **Client:** `TopicInfo.doneAt: string | null`; `topicInfoOf` maps
  `topic.doneAt ?? null`. `chat-rows.ts` is 398 lines.
- **Mock:** `MockTopic.doneAt?`, PATCH sets `new Date().toISOString()` on
  `done: true` and `null` on `false`, `view.ts` emits `doneAt ?? null`.
- **Test:** `apps/server/src/topics/patch.test.ts`: a plain member sets then
  clears the flag; an outsider gets `404 not_found`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/patch.test.ts`
  → `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- Task Checks command
  `pnpm --filter @zilar/server exec vitest run src/topics/patch.test.ts --reporter=dot --maxWorkers=2`
  → `Tests 2 passed (2)`.
- `pnpm gate` from the repo root → `GATE PASS`:
  ```
  gate: 16 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.2s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (2.5s)
  PASS  tests @zilar/client-core  (6.5s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (11.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (`format` initially failed on `service.ts`; I ran `prettier --write` on that
  one file and re-ran the gate.)

### Files changed

`apps/server/drizzle/0064_topic_done_at.sql` (new),
`apps/server/src/db/rows.ts`, `apps/server/src/topics/service.ts`,
`apps/server/src/topics/patch.ts` (new),
`apps/server/src/topics/patch.test.ts` (new), `apps/server/src/topics/api.ts`,
`apps/server/src/topics/access.ts`, `apps/server/src/topics/views.ts`,
`apps/server/src/topics/schemas.ts`, `packages/api-contract/src/topics.ts`,
`packages/chat-core/src/types.ts`,
`packages/client-core/src/store/chat-rows.ts`,
`packages/mock-backend/src/domains/topics/routes.ts`,
`packages/mock-backend/src/domains/topics/tables.ts`,
`packages/mock-backend/src/domains/topics/view.ts`,
`work/T-1521-topic-done-flag.md`.

### Notes for the lead

- **One deviation, deliberate:** the spec says `TopicView.doneAt: string | null`
  (required). Typecheck then names `apps/server/src/topics/ai-activity.test.ts`,
  whose `viewOf` helper builds a `TopicView` literal; fixing it would change a
  file outside the Allowed files and the gate's scope report would list it.
  Since the task says the gate must list nothing outside scope, I made
  `TopicView.doneAt` optional (`doneAt?: string | null`) with a comment.
  `buildTopicView` always sets it, so every list/single-topic response still
  carries `doneAt` and the acceptance holds. If you prefer the required type,
  it is a one-line change plus `doneAt: null` in that test's `viewOf`.
- `mapXmppError` stayed in `service.ts` rather than moving with `patchTopic`:
  `patchTopic`'s sync-failure catch uses `xmppUnavailable()` (unchanged), so the
  mapper is only used by `createTopic` and no re-export was needed. Nothing else
  imported `PatchTopicInput`/`patchTopic` from `service.ts` besides `api.ts`,
  which now imports from `./patch`.
- The General topic may be marked done as specified (the `isGeneral` block only
  guards visibility/archive/memberIds).
- No UI work, no live notices, no owner follow, and no clearing on AI restart
  (out of scope per the spec).

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 follow-up, for head `20f05610b`.
- **The lead read the diff:**
  - migration `0064_topic_done_at.sql` adds a nullable `done_at`, with `lock_timeout` 5 s;
  - `patchTopic` moved unchanged to `topics/patch.ts`, so `service.ts` went from 392 to 181 lines;
  - `done` is a strip-only field, so anyone who can see the topic may set it; `true` stamps now and `false` clears;
  - the views carry `doneAt` as ISO or null; the contract adds `done` (patch) and an optional `doneAt`;
  - `TopicInfo.doneAt` is mapped, and the mock handles PATCH `done`;
  - one permission test: a plain member marks and un-marks, and an outsider gets the missing-topic error.
- **Watch:** `access.ts` and `chat-rows.ts` are now 398 lines each, so the next change to either must split first.
- **Follow-up:** make `TopicView.doneAt` required once `ai-activity.test.ts`'s fixture adds it.
- **Live:** check the deploy (the migration runs at start) and that `/api/chats` still answers 401 signed out.
