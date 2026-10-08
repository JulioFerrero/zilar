---
id: T-0687
title: "effect/sql: move createTopic and patchTopic in topics/service.ts onto effect/sql (patchTopic's dynamic update through sql.update with snake_case keys); topics/service.ts drops drizzle (topics slice 3b)"
status: todo
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

## Review (written by Claude)
