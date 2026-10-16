---
id: T-1754
title: "Topic people S4a: public topics get real members (writes only) - creator joins their public topic, going public keeps topic_members, backfill migration 0069 for existing public topics"
status: merged
milestone: M5
branch: task/T-1754-topic-members-backfill
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1754: Public topics get real members (the write half)

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-10-16 that **a new public topic includes nobody until people join**:
- any group member sees it under "Other topics" and can read and join it;
- private stays invite only;
- **General stays everyone**.

The design is `docs/design/mockups/topic-people/README.md` ("Round 2"). Today a public topic has **no** `topic_members` rows: its people are implied to be the whole group.

This task is the **write half**:
- public topics get real `topic_members` rows;
- existing public topics are backfilled with their group's current members, so nobody loses a topic.

It changes **no read**, so nothing visible changes yet. The reads switch in a later task (S4b).

### Facts (read by the lead on 2026-10-16)
- **`topic_members`** is `(topic_id, user_id, added_by, added_at)` (`apps/server/drizzle/0018_lethal_warhawk.sql:1-8`).
- **`createTopic`** (`apps/server/src/topics/service.ts`, 182 lines):
  - it builds `memberIds` and rejects them for a non-private topic (`:61-68`);
  - it inserts `topic_members` **only** `if (visibility === 'private')` (`:104-118`).
- **`patchTopic`** (`apps/server/src/topics/patch.ts`, 247 lines): when a topic goes public, it runs `DELETE FROM topic_members WHERE topic_id = …` (`:206`). It also clears roles and the approver (`:200-215`); keep that part.
- **Migrations** are hand-written SQL files in `apps/server/drizzle/`, run in order by `migrateSql` (`apps/server/src/db/migrate.ts:8-19`).
  - The newest is `0068_routine_last_message.sql`. It starts with `SET lock_timeout = '5s';--> statement-breakpoint`, and statements are split by `--> statement-breakpoint`.
  - A backfill to copy is `apps/server/drizzle/0022_topic-scope-backfill.sql` (a header comment, idempotent statements).
  - `apps/server/drizzle/meta/` hasn't changed since the switch to hand-written SQL; don't touch it.
- **The tables:**
  - `topics` has `group_id`, `visibility` ('public' or 'private'), `is_general`, `archived_at` and `created_by`;
  - `group_members` has `group_id`, `user_id` and `role`.
- **Rows:** `apps/server/src/db/rows.ts` (379 lines) has `GroupMemberRow` at `:60-66` and no shared `TopicMemberRow`.
- **Test setup to copy:** `apps/server/src/topics/patch.test.ts:1-60`:
  - a `depsFor(context)` that builds `TopicServiceDeps` from `createTestContext`;
  - `seedGroup` and `seedUser`;
  - a `seedPublicTopic` helper.

### Steps
1. **Migration:** a new `apps/server/drizzle/0069_topic-members-backfill.sql`.
   - A header comment: what it does, why (Julio's rule), and that it's idempotent.
   - Then `SET lock_timeout = '5s';--> statement-breakpoint`.
   - Then one `INSERT INTO "topic_members" ("topic_id", "user_id", "added_by") SELECT t."id", gm."user_id", t."created_by" FROM "topics" t JOIN "group_members" gm ON gm."group_id" = t."group_id" WHERE t."visibility" = 'public' AND t."is_general" IS FALSE AND t."archived_at" IS NULL ON CONFLICT DO NOTHING;`
   - The column names are verified: `topic_members.added_by` is `NOT NULL` (`0018_lethal_warhawk.sql:1-7`), and `topics.created_by` references `user.id` (`0018:37`).
2. **`createTopic`:** for a **public** topic, insert the creator's own `topic_members` row (`added_by` = the creator), in the same place as the private insert.
   - A private topic keeps today's insert.
   - `memberIds` stays private-only (keep the 400).
3. **`patchTopic`:** stop deleting `topic_members` when a topic goes public. Those rows become its member list.
   - Keep clearing the roles and the approver.
   - Update the comment above it (`:198-200`) to say direct members stay as the public topic's members.
4. **`rows.ts`:** add `export interface TopicMemberRow { topicId: string; userId: string; addedBy: string; addedAt: Date }` next to `GroupMemberRow`, with a one-line comment.
5. **Tests (2, the membership rule)** in a new `apps/server/src/topics/public-members.test.ts`, with the setup copied from `patch.test.ts`:
   - `createTopic` of a public topic leaves exactly one `topic_members` row: the creator;
   - a private topic with two members that `patchTopic` switches to public still has both `topic_members` rows.

### Allowed files
- `apps/server/drizzle/0069_topic-members-backfill.sql`
- `apps/server/src/topics/service.ts`
- `apps/server/src/topics/patch.ts`
- `apps/server/src/db/rows.ts`
- `apps/server/src/topics/public-members.test.ts`
- `work/T-1754-topic-members-backfill.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics/public-members.test.ts src/topics/patch.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- New public topics get their creator as a member.
- Going public keeps the members.
- Migration 0069 backfills every existing non-General public topic with its group's members.
- No read changes. The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did
Implemented the write half of "public topics get real members" (S4a):
1. Added `apps/server/drizzle/0069_topic-members-backfill.sql`: header comment
   (what/why/idempotent), `SET lock_timeout = '5s';--> statement-breakpoint`, then the
   single `INSERT ... SELECT` that gives every existing non-General, non-archived public
   topic its group's current members (`added_by` = `topics.created_by`), with
   `ON CONFLICT DO NOTHING`.
2. `createTopic` (`apps/server/src/topics/service.ts`): replaced the private-only insert
   with one insert whose rows are the invited `memberIds` for a private topic and only
   the creator (`[input.actorId]`) for a public one. `memberIds` stays private-only (the
   400 is unchanged).
3. `patchTopic` (`apps/server/src/topics/patch.ts`): removed the
   `DELETE FROM topic_members` on going public, so the direct members become the public
   topic's members. Roles and the approver are still cleared; the comment above was
   updated.
4. `apps/server/src/db/rows.ts`: added `TopicMemberRow` next to `GroupMemberRow` with a
   one-line comment.
5. Added `apps/server/src/topics/public-members.test.ts` (setup copied from
   `patch.test.ts`) with the two membership-rule tests.

No reads changed.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/public-members.test.ts src/topics/patch.test.ts`
  → `Test Files 2 passed (2)`, `Tests 4 passed (4)` (6.76s).
- `pnpm gate` (repo root) → ended with `GATE PASS`; summary lines:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (1.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.9s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/server  (12.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

The vitest global setup migrates a fresh PGlite database per run
(`test-global-setup.ts`), so migration 0069 was executed successfully during the test
run above — the SQL is valid and applies cleanly.

### Notes for the lead
- The private insert keeps its original no-`ON CONFLICT` form; a freshly created topic id
  cannot collide, so this is unchanged behaviour.
- Migration idempotency: a public topic that already has rows (e.g. a private→public patch
  under the new code) keeps them because of `ON CONFLICT DO NOTHING`.
- Allowed files honoured; nothing outside scope changed.

## Review (written by Claude)

- **Accepted at `44023e82c`.** It's clean, with 1 follow-up. The lead ran `public-members.test.ts` and `patch.test.ts`: 4 pass.
- **Migration 0069** is a single idempotent `INSERT … SELECT … ON CONFLICT DO NOTHING` for non-General, non-archived public topics, behind `lock_timeout`.
- **`createTopic`** inserts the creator for a public topic; the private insert is unchanged, and the rollback path (`deleteTopicRows`) covers the new row.
- **`patchTopic`** keeps the members when a topic goes public.
- **The follow-up** (two `TopicMemberRow` shapes, `gateway/db.ts:65`) goes into S4b, which edits that file anyway.
- **A deploy gap the lead closes in S4b.**
  - Until S4b switches the reads, public topics still read as "the whole group". Anyone who joins a group between this deploy and S4b's would be missing from existing public topics' rows.
  - S4b re-runs the same backfill as migration 0070. It's idempotent, and nobody can leave a topic before S5.
