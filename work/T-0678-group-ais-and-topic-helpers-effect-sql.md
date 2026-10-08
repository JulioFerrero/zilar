---
id: T-0678
title: "effect/sql: move addGroupAi and the three group-topic helpers (syncGroupTopicRooms, emitDroppedGroupTopicAis, archiveDrainedPrivateTopics) in groups/service.ts onto effect/sql"
status: todo
milestone: M5
branch: task/T-0678-group-ais-and-topic-helpers-effect-sql
model: auto
effort: low
depends_on: [T-0670]
estimate: 0.2 day
---

# T-0678: group AIs and group-topic helpers on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. T-0670 moved `removeGroupAi`. This is the next slice of `groups/service.ts`.

### Verified facts (do not re-derive)
- **`apps/server/src/groups/service.ts`** already has a private `runSql` (line 42) and the effect/sql imports (T-0670). `removeGroupAi` uses `sql.withTransaction` with the XMPP call inside it through `Effect.tryPromise({ try, catch: (error) => error })`, under a `try/catch` that calls `mapXmppError`. **Copy that shape.**
- **`addGroupAi` (line 952)**, after the checks:
  - drizzle reads: the `group_ais` existence select (`group_id`, `ai_id`, `LIMIT 1`), then `SELECT user_id FROM group_members WHERE group_id`, then `SELECT ai_id FROM group_ais WHERE group_id` (for the `MAX_GROUP_MEMBERS` count);
  - the transaction: `adminClient.setAffiliation(group.roomLocalpart, ai.jid, 'member')`, then `INSERT INTO group_ais (group_id, ai_id, added_by) … ON CONFLICT (group_id, ai_id) DO NOTHING`, under `try/catch` with `mapXmppError`;
  - for a channel, it reads the General topic: `SELECT * FROM topics WHERE group_id AND is_general = true LIMIT 1`.
- **`syncGroupTopicRooms` (line 1343):** `SELECT * FROM topics WHERE group_id`.
- **`emitDroppedGroupTopicAis` (line 1367):** the same topics read, then for each private, non-General, unarchived topic, `topic_ais` join `ais` (`ai_id`, `owner`, `status`) where `topic_id`.
- **`archiveDrainedPrivateTopics` (line 1394):** the same topics read; a per-topic `count(*)` of `topic_members` (use `count(*)::int` or `Number(...)`); and `UPDATE topics SET archived_at = now, updated_at = now WHERE id`.
- **`SELECT * FROM topics` returns `TopicRow`** through the camelCase transform, exactly as `getTopic` does (`apps/server/src/topics/access.ts:95-104`).
- **Tests:** `apps/server/src/groups/groups.test.ts` ("AIs in groups" at line 825 on, plus the membership and topic tests) and `apps/server/src/topics/topics.test.ts`.

### What to build
1. **Rewrite the drizzle statements** in these four functions with `runSql` and effect/sql, keeping the same order, filters, errors and texts. The `addGroupAi` transaction becomes `sql.withTransaction`, with the XMPP call through `Effect.tryPromise`.
2. **Change no other function.** Keep the drizzle imports the rest of the file still uses.

### Read first
`AGENTS.md`, `apps/server/src/groups/service.ts` (lines 1-60, 940-1130, 1335-1420), `apps/server/src/topics/access.ts` (lines 85-105).

### Allowed files
`apps/server/src/groups/service.ts`, `work/T-0678-group-ais-and-topic-helpers-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/groups.test src/topics/topics.test
pnpm gate
```

### Acceptance
- The four functions have no drizzle calls.
- The groups and topics tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
