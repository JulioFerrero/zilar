---
id: T-0688
title: "effect/sql: move createGroup (group + members + General topic + handle claim + room calls in one transaction) and patchGroup's update in groups/service.ts onto effect/sql; groups/service.ts drops drizzle (groups slice 5)"
status: todo
milestone: M5
branch: task/T-0688-create-patch-group-effect-sql
model: auto
effort: low
depends_on: [T-0686]
estimate: 0.25 day
---

# T-0688: createGroup and patchGroup on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. After T-0670, T-0678, T-0682 and T-0686, `groups/service.ts` uses drizzle only in `createGroup` and `patchGroup`. This finishes the file.

### Verified facts (do not re-derive)
- **`apps/server/src/groups/service.ts`** has `runSql` and the `removeGroupAi` and `addGroupAi` model: XMPP calls inside `sql.withTransaction` go through `Effect.tryPromise({ try, catch: (error) => error })`, under the `try/catch` that calls `mapXmppError`.
- **`patchGroup`** (line 250) runs one conditional `UPDATE groups SET … WHERE id`, built from these optional keys: `membersCanCreateTopics`, `listenerEnabled`, `listenerEagerness` and the `background` fields (`backgroundPreset`, `backgroundImageId`, `backgroundDim`). Build a snake_case object (`members_can_create_topics`, `listener_enabled`, `listener_eagerness`, `background_preset`, `background_image_id`, `background_dim`) and use `sql.update(obj)` (`effect/dist/sql/Statement.d.ts:326`). The client sets no query-name transform.
- **`createGroup`** (line 311): one `db.transaction` that runs, in order:
  1. `INSERT INTO groups (id, room_localpart, title, created_by, kind, description[, visibility = 'public'])`;
  2. `INSERT INTO group_members` for the owner row (role `owner`) and one row per member (role `member`); use `sql.insert(rows)`;
  3. `INSERT INTO topics` for the General topic, with `name 'General'`, `glyph 'G'`, the same `room_localpart`, `visibility 'public'`, `kind 'chat'`, `status 'open'`, `is_general true` and `created_by`;
  4. for a public group:
     - `SELECT * FROM handles WHERE handle_lower LIMIT 1` (taken gives `HttpError(409, 'handle_taken', …)`);
     - `SELECT * FROM retired_handles WHERE handle_lower LIMIT 1`. If `reserved_until` is in the future and `former_group_id` differs, throw 409 `handle_taken`; otherwise `DELETE FROM retired_handles WHERE handle_lower`;
     - `INSERT INTO handles (handle_lower, handle, user_id = NULL, group_id, created_at, changed_at)`, where a unique violation becomes the same 409 (use `isUniqueViolation`, already imported; it handles `SqlError`, `handles/store.ts:319`);
  5. `adminClient.createRoom(...)`, then `roomCreated = true`;
  6. the owner `setAffiliation`;
  7. a member `setAffiliation` for each member.

  The outer `catch` destroys the room if it was created, then calls `mapXmppError`.
- **Inside the transaction,** throw an `HttpError` with `Effect.fail(new HttpError(…))`, so the caller sees the same object. Compare `reserved_until` with `new Date(row.reservedUntil).getTime()`, so it works whether the client returns a `Date` or a string.
- **Tests:** `apps/server/src/groups/*.test.ts` (create group and channel, public handle, a taken or retired handle, rollback when XMPP fails) and `apps/server/src/handles/*.test.ts`.

### What to build
1. **Rewrite `patchGroup`'s update and the whole `createGroup` transaction** with `runSql` and `sql.withTransaction`: the same steps in the same order, the same errors and texts, and the same room cleanup.
2. **Remove** the drizzle import and the `../db/schema` imports that become unused (`GroupRow` and the other types may still need the table types).

### Read first
`AGENTS.md`, `apps/server/src/groups/service.ts` (lines 1-60, 245-470, plus `removeGroupAi` and `addGroupAi`), `apps/server/src/handles/store.ts` (lines 315-340).

### Allowed files
`apps/server/src/groups/service.ts`, `work/T-0688-create-patch-group-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups src/handles
pnpm gate
```

### Acceptance
- `groups/service.ts` has no drizzle import.
- The groups and handles tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
