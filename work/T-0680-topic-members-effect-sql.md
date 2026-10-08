---
id: T-0680
title: "effect/sql: move listTopicMembers, addTopicMember and removeTopicMember in topics/service.ts onto effect/sql (topics slice 2 of 3)"
status: todo
milestone: M5
branch: task/T-0680-topic-members-effect-sql
model: auto
effort: low
depends_on: [T-0676]
estimate: 0.15 day
---

# T-0680: topic members on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. T-0676 moved the topic-AI functions, and this is the second slice of `topics/service.ts`.

### Verified facts (do not re-derive)
- **`apps/server/src/topics/service.ts`** has a private `runSql` (added by T-0676, just above `emitDroppedTopicAis`) and the effect/sql imports. The topic re-reads use `getTopic(deps.db, id)` (`topics/access.ts:95`).
- **`listTopicMembers(deps, topicId, userId)`** (line 484):
  - for a public topic: `group_members` join `"user"` (`user_id`, `name`) where `group_id`, sorted in JS;
  - for a private topic: `SELECT user_id FROM topic_members WHERE topic_id` in parallel with `topicRoleHolderIds`; then `SELECT id AS user_id, name FROM "user" WHERE id IN ids` (only when ids is non-empty) and `SELECT user_id FROM group_members WHERE group_id`; then the JS filter and sort.
- **`addTopicMember`** (line 531): `INSERT INTO topic_members (topic_id, user_id, added_by) … ON CONFLICT DO NOTHING`, then the re-read `select().from(topics)`.
- **`removeTopicMember`** (line 568): the `topic_members` existence select (`topic_id`, `user_id`, `LIMIT 1`), the delete, the `remaining` select (`user_id` where `topic_id`), and when drained `UPDATE topics SET archived_at = now, updated_at = now WHERE id`.
- **Recipe:**
  - result names come back camelCased (`user_id` becomes `userId`);
  - write `"user"` quoted;
  - lists go through `sql.in(ids)`;
  - timestamps go in as `${new Date().toISOString()}`.
- **Tests:** `apps/server/src/topics/topics.test.ts` (the member tests at about lines 198-420).

### What to build
1. **Rewrite the drizzle statements** in these three functions with `runSql`, keeping the same filters, the same order and every text. Use `getTopic` for the re-read in `addTopicMember`.
2. **Change no other function,** and keep the drizzle imports that `createTopic`, `patchTopic`, `setTopicRoles` and the helpers still use.

### Read first
`AGENTS.md`, `apps/server/src/topics/service.ts` (lines 1-60, 480-680).

### Allowed files
`apps/server/src/topics/service.ts`, `work/T-0680-topic-members-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/topics.test
pnpm gate
```

### Acceptance
- The three functions have no drizzle calls.
- The topics tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
