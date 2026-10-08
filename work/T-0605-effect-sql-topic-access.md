---
id: T-0605
title: "effect/sql: the 15 drizzle reads in topics/access.ts (topic by id, memberships, visible topics with role access, member counts, owner names, topic AIs) move to effect/sql; rows keep their drizzle shapes (TopicRow, GroupMemberRow); same visibility, counts and order; tests unchanged"
status: todo
milestone: M5
branch: task/T-0605-effect-sql-topic-access
model: auto
effort: low
depends_on: [T-0596]
estimate: 1 day
---

# T-0605: the topic access reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. `apps/server/src/topics/access.ts` is the core visibility module: about 25 files call it. It runs 15 drizzle reads.

The lead checked that **no caller passes a drizzle transaction** to these functions: grep finds no `tx`, `txDb` or `trx` argument, on one line or split across two. So every read can move to the per-database effect/sql runtime.

### Verified facts (do not re-derive; read each function)
**The reads** (`apps/server/src/topics/access.ts`):

| Line | Query | Notes |
| --- | --- | --- |
| 82 | `getTopic`: `SELECT * FROM topics WHERE id LIMIT 1` | gives `TopicRow` or `null` |
| 91-95 | `getGroupMembership`: `SELECT * FROM group_members WHERE group_id AND user_id LIMIT 1` | the full row |
| 104-108 | a topic member check | `LIMIT 1` |
| 171 | `visibleTopics`: `SELECT * FROM topics WHERE group_id` | |
| 183-196 | the private topics the user is a member of | `inArray`; **guard against an empty id list**, as the code does today |
| 183-196 | the private topics reached through a role (`topic_role_access` join `group_member_roles`) | same guard |
| 265-267 | `count(*)` of `group_members` | |
| 274-276 | the `topic_members` ids | |
| 292-295 | `resolveOwnerName`: `SELECT id, name FROM "user" WHERE id LIMIT 1` | **`user` is reserved, so quote it**; only `id` and `name`, no timestamps |
| 303-306 | the AI owner name | |
| 367-370 | `aiMayBeInTopic` | |
| 392-395 | `allowedTopicAiIds`: `topic_ais` join `ais` (`ai_id`, `owner`, `status`) | |
| 401-403 | the topic member ids | |
| 411-413 | the group member ids | |
| 426-429 | `listTopicAis`: `topic_ais` join `ais` (`id`, `name`) | |

**Imports:** drizzle (line 1) and the tables (4-13). After T-0596, the zod import at line 2 is already gone; this task depends on T-0596.

**Rows.** Effect/sql maps snake_case to camelCase (`transformResultNames: snakeToCamel`, `apps/server/src/effect/sql.ts`). Type the full rows as `TopicRow` and the `group_members` row type (type-only imports; check what the file names them). The `topics` and `group_members` timestamps are timestamptz (`Date`); check `db/schema.ts`. **`count(*)` is bigint**, so cast it with `::int` or keep `Number(...)` as the code does.

**Order.** Keep each query's existing `ORDER BY`. Where the drizzle query has none, add none: callers that sort, sort in JS.

**The sql runtime:** a local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`, as in `apps/server/src/agents/gateway/db.ts`.

**Tests (all unchanged):**
- `apps/server/src/topics/*.test.ts`;
- `apps/server/src/roles/*.test.ts`;
- `apps/server/src/approvals/*.test.ts`;
- `apps/server/src/routines/*.test.ts`;
- `apps/server/src/push/*.test.ts`;
- `apps/server/src/audit/*.test.ts`;
- the authz sweep (`authz-sweep`).

### What to build
1. Move the 15 reads to effect/sql with the same rows, nulls, counts and visibility decisions. Every exported function keeps its signature.
2. `topics/access.ts` ends with no value import from `drizzle-orm` or `db/schema`.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/topics/access.ts` (all of it), `apps/server/src/agents/gateway/db.ts` and `apps/server/src/effect/sql.ts`.

### Allowed files
`apps/server/src/topics/access.ts`, `work/T-0605-effect-sql-topic-access.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot topics roles approvals routines push audit authz-sweep
pnpm gate
```

### Acceptance
- `topics/access.ts` reads through effect/sql with the same answers.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
