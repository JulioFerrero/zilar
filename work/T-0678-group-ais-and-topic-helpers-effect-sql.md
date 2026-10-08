---
id: T-0678
title: "effect/sql: move addGroupAi and the three group-topic helpers (syncGroupTopicRooms, emitDroppedGroupTopicAis, archiveDrainedPrivateTopics) in groups/service.ts onto effect/sql"
status: merged
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

### What was done
All statements in the four functions of `apps/server/src/groups/service.ts` now run through `runSql` / effect/sql. No other function was changed.
- `addGroupAi`: the existence check, the member and AI count reads, and the General-topic read (channel feed) use `sql` tagged templates. The add transaction is `sql.withTransaction`, with `setAffiliation` inside `Effect.tryPromise({ try, catch: (error) => error })` and the `INSERT ... ON CONFLICT (group_id, ai_id) DO NOTHING` in the same transaction. The whole block is still under `try/catch` with `mapXmppError`. The feed read stays inside the best-effort `try` as before.
- `syncGroupTopicRooms`, `emitDroppedGroupTopicAis`, `archiveDrainedPrivateTopics`: the topics read goes through a new private helper `groupTopicRows` (`SELECT * FROM topics`, typed `TopicRow`, returned as a mutable copy). The per-topic AI join (`topic_ais` join `ais`), the `count(*)::int` of `topic_members`, and the `UPDATE topics SET archived_at, updated_at` use `sql`. The UPDATE passes one JS `new Date()` for both columns, the same convention as `removeGroupAi`, not SQL `now()`.
- Imports: added `type TopicRow` from `../topics/access`; removed `topicAis`, which became unused.

### Files changed
- `apps/server/src/groups/service.ts`
- `work/T-0678-group-ais-and-topic-helpers-effect-sql.md` (status and this Report)

### Commands and results
- `pnpm install`: done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/groups.test src/topics/topics.test`: 2 files passed, 88 tests passed, 0 failed.
- First `pnpm gate`: GATE FAIL at typecheck (`src/groups/service.ts(1356,3)`: `sql` returns a readonly array, so `groupTopicRows` could not return `TopicRow[]`). Fixed by copying the rows into a mutable array.
- Second `pnpm gate` (final), exit 0:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server (28.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Acceptance check: no `db.select / db.insert / db.update / db.delete / db.transaction / tx.` call is left inside `addGroupAi`, `syncGroupTopicRooms`, `emitDroppedGroupTopicAis`, or `archiveDrainedPrivateTopics`.

### Deviations and notes
- The four functions still call helpers that use drizzle internally, all outside the Allowed files, and I left them as they are: `requireGroup`, `getMembership`, `findOwnedAi`, `getGroupDetail`, `syncTopicRoom`, `aiMayBeInTopic`, `topicRoleHolderIds`.
- The tests do not mock drizzle; they use drizzle only for setup, so no stop was needed.
- A first gate run wrote its log one directory above the worktree. I deleted that file. The final log is in the scratchpad, not in the worktree.

### Blocked / needs a decision
None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 4.4 min). The lead reviewed the diff directly.
- **Result:** the `addGroupAi` transaction follows the `removeGroupAi` shape (the XMPP call through `Effect.tryPromise` inside `sql.withTransaction`, then `ON CONFLICT (group_id, ai_id) DO NOTHING`), and the reads are the same. A shared `groupTopicRows` helper reads the topics with `SELECT *`. The count uses `count(*)::int`, and the archive timestamps use a JS `Date`, as the old code did. The gate passed.
