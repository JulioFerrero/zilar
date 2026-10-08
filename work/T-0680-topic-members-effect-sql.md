---
id: T-0680
title: "effect/sql: move listTopicMembers, addTopicMember and removeTopicMember in topics/service.ts onto effect/sql (topics slice 2 of 3)"
status: merged
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

**What I did** (only `apps/server/src/topics/service.ts` changed)
- `listTopicMembers`: the public-topic query, the direct `topic_members` query, the `"user"` `IN` query (via `sql.in`) and the `group_members` query are now `runSql` statements. The T-0116 comment and the JS filter/sort are unchanged.
- `addTopicMember`: the insert is an `INSERT ... ON CONFLICT DO NOTHING` through `runSql`; the re-read is `getTopic`.
- `removeTopicMember`: the existence select, the delete, the `remaining` select and the drained `UPDATE topics SET archived_at, updated_at` are `runSql` statements. Timestamps are passed as `new Date().toISOString()`.
- Removed the now-unused `user` import from `../db/schema`. The drizzle imports `and`, `eq`, `inArray`, `sql` and the other schema tables are still used by other functions, so they stay.
- `effect/sql` returns a readonly array, so the public-branch sort now sorts a copy (`[...rows].sort`). The first gate run caught this in typecheck (TS2339). Prettier then reflowed one line in the same file.

**Commands run**
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/topics.test`: 32 passed, 0 failed (before the sort fix, which only changed the sort's receiver).
- `pnpm gate` (final run, exit 0):
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Deviations / notes**
- Acceptance says "the three functions have no drizzle calls". The three function bodies have no drizzle query builder calls left (no `.select`, `.insert`, `.delete` or `.update` on `deps.db`). They still call helpers that use drizzle internally: `requireVisibleTopic`, `requireManagedTopic`, `getGroupMembership`, `canSeeTopic`, `canManageTopic` (in `access.ts`) and `topicRoleHolderIds` (in `roles/service`). The spec says to change no other function and those files are not in Allowed files, so I left them.
- Unsure: whether the acceptance wording means those helper calls too. If it does, it needs a follow-up task in `access.ts` and `roles/service`.
- The `topics.test.ts` file is unchanged and uses drizzle only for its own setup, not for mocks.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 4.8 min). The lead reviewed the diff directly: the same reads and writes, the empty-ids guard kept before `sql.in`, and the re-read through `getTopic`. The gate passed.
- **Note:** the helpers it calls (`requireVisibleTopic`, `getGroupMembership`, `topicRoleHolderIds`) live in other modules and were out of scope.
