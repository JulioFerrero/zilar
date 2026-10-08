---
id: T-0683
title: "effect/sql: move setTopicRoles (advisory-lock transaction) and the topic helpers uniqueRoomLocalpart, assertNameFree, assertOwner, assertMembersAreGroupMembers in topics/service.ts onto effect/sql (topics slice 3a)"
status: todo
milestone: M5
branch: task/T-0683-topic-roles-and-helpers-effect-sql
model: auto
effort: low
depends_on: [T-0680]
estimate: 0.15 day
---

# T-0683: topic roles and helpers on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. After T-0676 and T-0680, `topics/service.ts` still uses drizzle in `createTopic`, `patchTopic` (a later task), `setTopicRoles` and four helpers. This task takes `setTopicRoles` and the helpers.

### Verified facts (do not re-derive)
- **`apps/server/src/topics/service.ts`** has a private `runSql` (T-0676) and uses `getTopic` for re-reads.
- **`setTopicRoles` (line 762):**
  - `SELECT * FROM group_roles WHERE group_id`;
  - then a `deps.db.transaction` that runs, in order:
    1. `SELECT pg_advisory_xact_lock(hashtext(${topic.groupId}))` (one argument, the group id; keep it exactly);
    2. `SELECT role_id FROM topic_role_access WHERE topic_id`;
    3. if any were added, `INSERT INTO topic_role_access (topic_id, role_id)` for each one with `ON CONFLICT DO NOTHING`;
    4. if any were removed, `DELETE FROM topic_role_access WHERE topic_id AND role_id IN removed`;
    5. if the approver changed, `UPDATE topics SET approver_role_id, updated_at = now WHERE id`;
    6. return `{ added, removed }`;
  - then the topic re-read (`select().from(topics)`).
- **The helpers:**
  - `uniqueRoomLocalpart` (line 92): `SELECT id FROM topics WHERE room_localpart LIMIT 1` inside its retry loop;
  - `assertNameFree` (about line 146): `SELECT * FROM topics WHERE group_id`, with the clash check in JS;
  - `assertOwner` (about line 164): `SELECT id FROM ais WHERE id LIMIT 1`;
  - `assertMembersAreGroupMembers` (about line 200): `SELECT user_id FROM group_members WHERE group_id AND user_id IN`, guarded by the existing empty-list return.
- **The recipe:**
  - `sql.withTransaction`;
  - a multi-row insert through `sql.insert(rows)` (see `apps/server/src/roles/service.ts:563`), with snake_case keys;
  - lists through `sql.in(list)`;
  - camelCased result names;
  - `SELECT * FROM topics` gives `TopicRow` (`topics/access.ts:95`).
- **Tests:** `apps/server/src/topics/topics.test.ts` and `apps/server/src/roles/*.test.ts` (topic roles).

### What to build
1. **Rewrite these five functions' drizzle statements** with `runSql`, with the same order, conditions and errors. The transaction becomes `sql.withTransaction`, with the lock as its first statement. Use `getTopic` for the re-read.
2. **Leave `createTopic` and `patchTopic` alone,** and keep the drizzle imports they still need.

### Read first
`AGENTS.md`, `apps/server/src/topics/service.ts` (lines 1-60, 88-220, 755-835), `apps/server/src/roles/service.ts` (lines 550-575).

### Allowed files
`apps/server/src/topics/service.ts`, `work/T-0683-topic-roles-and-helpers-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics src/roles
pnpm gate
```

### Acceptance
- The five functions have no drizzle calls.
- The topics and roles tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
