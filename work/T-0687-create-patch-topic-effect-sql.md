---
id: T-0687
title: "effect/sql: move createTopic and patchTopic in topics/service.ts onto effect/sql (patchTopic's dynamic update through sql.update with snake_case keys); topics/service.ts drops drizzle (topics slice 3b)"
status: merged
milestone: M5
branch: task/T-0687-create-patch-topic-effect-sql
model: auto
effort: low
depends_on: [T-0683]
estimate: 0.2 day
---

# T-0687: createTopic and patchTopic on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. After T-0676, T-0680 and T-0683, `topics/service.ts` uses drizzle only in `createTopic` and `patchTopic`. This finishes the file.

### Verified facts (do not re-derive)
- **`apps/server/src/topics/service.ts`** has `runSql`, and the re-reads go through `getTopic` (`topics/access.ts:95`).
- **`createTopic`** (line 230):
  - `SELECT * FROM groups WHERE id LIMIT 1`;
  - then, inside its `try`: `INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, owner_user_id, owner_ai_id, link_url, link_label, is_general, created_by)` with the values in the code; for a private topic, one `INSERT INTO topic_members (topic_id, user_id, added_by)` for every member (use `sql.insert(rows)` with snake_case keys);
  - on `catch` and on a failed room sync, two cleanup deletes, `DELETE FROM topic_members WHERE topic_id` and then `DELETE FROM topics WHERE id`. These appear twice; keep both places;
  - the re-read after the insert.
  - `mapXmppError` uses `isUniqueViolation`, which already handles `SqlError` (`apps/server/src/handles/store.ts:319-322`), so a name or localpart race still answers 409.
- **`patchTopic`** (line 330):
  - builds `patch: Partial<TopicRow>` with camelCase keys (`updatedAt` always, plus `name`, `glyph`, `kind`, `status`, `ownerUserId`, `ownerAiId`, `linkUrl`, `linkLabel`, `visibility` and `archivedAt` when set), then runs `UPDATE topics SET patch WHERE id`;
  - going private: `INSERT INTO topic_members … ON CONFLICT DO NOTHING` for each member;
  - going public: `DELETE FROM topic_members WHERE topic_id`, `SELECT role_id FROM topic_role_access WHERE topic_id`, `DELETE FROM topic_role_access WHERE topic_id` and `UPDATE topics SET approver_role_id = NULL WHERE id`;
  - then the re-read.
- **effect/sql's `sql.update(record)`** (`Statement.d.ts:326` in `effect/dist/sql`, as in `` sql`UPDATE t SET ${sql.update(obj)} WHERE id = ${id}` ``) writes the keys as given. The client sets no query-name transform, so **build a snake_case copy of `patch`** (`updatedAt` becomes `updated_at`, `ownerUserId` becomes `owner_user_id`, `ownerAiId` becomes `owner_ai_id`, `linkUrl` becomes `link_url`, `linkLabel` becomes `link_label`, `archivedAt` becomes `archived_at`; the others are unchanged).
- **Tests:** `apps/server/src/topics/topics.test.ts` (create, rename, visibility switches, archive, the name clash 409).

### What to build
1. **Rewrite every drizzle statement** in `createTopic` and `patchTopic` with `runSql`, keeping the same order, positions, errors and texts. Use `getTopic` for the re-reads.
2. **Remove** the drizzle import and any `../db/schema` import that becomes unused. `TopicRow` comes from `./access`.

### Read first
`AGENTS.md`, `apps/server/src/topics/service.ts` (lines 1-60, 225-480), `apps/server/src/handles/store.ts` (lines 315-340).

### Allowed files
`apps/server/src/topics/service.ts`, `work/T-0687-create-patch-topic-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics
pnpm gate
```

### Acceptance
- `topics/service.ts` has no drizzle import.
- The topics tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `apps/server/src/topics/service.ts`: every drizzle statement in `createTopic` and `patchTopic` is now an `effect/sql` statement through `runSql`, in the same order. The group read, topic insert, private member insert, cleanup, re-reads (`getTopic`), `UPDATE topics`, going-private insert with `ON CONFLICT DO NOTHING`, and going-public block (member delete, role select, role delete, approver reset) all keep their order and error texts.
- Removed the `drizzle-orm` import and the `../db/schema` import (both now unused). `TopicRow` still comes from `./access`. `grep` finds no `drizzle`, `db/schema`, `.db.select/insert/update/delete` or `eq(` left in the file.
- Added two small private helpers in the same file:
  - `deleteTopicRows(db, topicId)` runs `DELETE FROM topic_members WHERE topic_id`, then `DELETE FROM topics WHERE id`. It replaces the two cleanup pairs in `createTopic` (the catch and the failed room sync), so both places are kept.
  - `snakeCaseKeys(patch)` converts the camelCase `patch` keys to snake_case (`updatedAt` to `updated_at`, and so on) before `sql.update(...)`.
- Column names checked against `apps/server/src/db/schema.ts` (`topics`, `topic_members`, `topic_role_access`, `groups`): `group_id`, `room_localpart`, `owner_user_id`, `owner_ai_id`, `link_url`, `link_label`, `is_general`, `created_by`, `topic_id`, `user_id`, `added_by`, `role_id`, `approver_role_id`.
- Group read types its row inline as `{ kind: string; membersCanCreateTopics: boolean }`, so the schema import is not needed.

**Files changed**
- `apps/server/src/topics/service.ts`
- `work/T-0687-create-patch-topic-effect-sql.md` (status and this Report only)

**Commands and results**
- `pnpm install`: done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics`: 33 passed in 2 test files, 0 failed. The test files are unchanged.
- `pnpm gate` (run twice, once with output discarded, once for the summary): last run ended `GATE PASS`.
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen)`
  - `PASS format`
  - `PASS lint`
  - `PASS typecheck`
  - `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Problems and deviations**
- None against the spec. I did not change any test. `topics.test.ts` imports `and` and `eq` from `drizzle-orm` for its own queries against the real database. It does not mock drizzle, so the stop condition did not apply.

**Blocked / needs a decision**
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 3.9 min). The lead reviewed the diff directly.
- **Result:** `createTopic` uses `sql.insert` with snake_case keys for the topic and its members, and the two cleanup paths share `deleteTopicRows` (members first, then the topic). `patchTopic` turns its camelCase patch into snake_case for `sql.update`, and the going-public statements run in one `runSql`, in the same order. The re-reads go through `getTopic`. **`topics/service.ts` now has no drizzle import.** The 33 topics tests and the gate passed.
