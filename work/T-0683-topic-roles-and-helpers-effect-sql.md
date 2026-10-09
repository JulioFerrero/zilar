---
id: T-0683
title: "effect/sql: move setTopicRoles (advisory-lock transaction) and the topic helpers uniqueRoomLocalpart, assertNameFree, assertOwner, assertMembersAreGroupMembers in topics/service.ts onto effect/sql (topics slice 3a)"
status: merged
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

### What I did
- `apps/server/src/topics/service.ts`: `uniqueRoomLocalpart`, `assertNameFree`, `assertOwner` (the `ais` lookup only) and `assertMembersAreGroupMembers` now run through `runSql`. `setTopicRoles` reads `group_roles` with `runSql`, runs the diff in `sql.withTransaction` (advisory lock first, then the read, the inserts with `ON CONFLICT DO NOTHING`, the delete, and the approver update), and re-reads the topic with `getTopic`.
- `createTopic` and `patchTopic` are unchanged, and their drizzle calls remain.
- Removed the imports that became unused: `ais`, `groupMembers`, `groupRoles` (schema) and `and`, `inArray`, `sql` (drizzle). `eq` stays.
- Deviation: the approver update sets `updated_at = now()` (SQL) instead of a JS `new Date()`, as the spec's `updated_at = now` says.
- Column names checked against `apps/server/src/db/schema.ts`: `topics` (`group_id`, `room_localpart`, `approver_role_id`, `updated_at`), `topic_role_access` (`topic_id`, `role_id`), `group_roles` (`group_id`), `group_members` (`group_id`, `user_id`), `ais` (`id`).
- No tests were added or changed. `src/topics` and `src/roles` contain no `vi.mock`, so no drizzle mock blocked the change.

### Commands and results
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics src/roles`: 3 files, 55 tests passed. Run before the Prettier fix below (the later change is formatting only).
- First `pnpm gate`: FAIL at format. `prettier --check` flagged `apps/server/src/topics/service.ts`. Fixed with `prettier --write` on that file and one line reflowed. Prettier check passes on it now.
- Second `pnpm gate` run: its header showed the T-0685 path and 5 changed files, so pnpm resolved another root (the inherited `PWD` was the galena checkout). I did not use that run. The run below was started with `PWD` set to this worktree.
- Final `pnpm gate` (from `/Users/julio/personal-projects/zilar-T-0683`, `PWD` set to it):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.9s)
  PASS  format  (26.0s)
  PASS  lint  (2.0s)
  PASS  typecheck  (1.8s)
  PASS  tests @zilar/server  (15.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems and open questions
- None blocking. Unsure only whether reviewers want `now()` (DB clock) or a JS timestamp on the approver update; I used `now()` per the spec.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 4.8 min). The lead reviewed the diff directly.
- **Result:** `setTopicRoles` runs one `sql.withTransaction`, with the same one-argument group lock first, the live read, `sql.insert` plus `ON CONFLICT DO NOTHING`, the `IN` delete and the approver update. The four helpers keep their queries and guards, and the re-read goes through `getTopic`. The gate passed.
- **Process note:** the first gate run resolved another worktree. The worker threw that run away and re-ran here, and the lead checked the other worktree was untouched.
