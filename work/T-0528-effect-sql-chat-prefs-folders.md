---
id: T-0528
title: "Effect C1: chat-prefs/service.ts and chat-folders/service.ts on effect/sql (same caps, same per-user advisory lock, same seeding race backstop, same answers); signatures unchanged, every test unchanged"
status: merged
milestone: M5
branch: task/T-0528-effect-sql-chat-prefs-folders
model: auto
effort: low
depends_on: [T-0510]
estimate: 0.5 day
---

# T-0528: chat-prefs and chat-folders services on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server service onto effect/sql"**, with `apps/server/src/pins/service.ts`, `apps/server/src/blocks/service.ts` and `apps/server/src/contact-requests/service.ts` as examples. T-0520 moves the **routes** of these two modules to Effect HTTP in parallel. It does not touch `service.ts`, and you do not touch `routes.ts` or `api.ts`.

### Verified facts (do not re-derive)
- **`apps/server/src/chat-prefs/service.ts`** (373 lines; the drizzle import is at line 1):
  - **`requireChatAccess(db, …)`** (line 122) answers 404 `not_found` `'Chat not found'` on four paths. It is also imported by `apps/server/src/pins/access.ts:8`, so keep its signature.
  - **`listChatPrefs(db, userId)`** (line 209).
  - **`putChatPref(db, input)`** (line 230) runs in this order:
    1. read the existing row;
    2. merge the fields;
    3. `resolveBackgroundFields` (400 `'Choose a preset or an image'`, `'Dim needs an image'`, `'Unknown background image'`, around lines 191-203);
    4. **delete the row and return `null` when everything is back to its default;**
    5. when there is no existing row, the 200-row cap (`CHAT_PREFS_MAX_ROWS`, 409 `too_many_prefs`);
    6. when pinning newly, the 20-pin cap (`CHAT_PREFS_MAX_PINNED`, 409 `too_many_pins`);
    7. the insert `onConflictDoUpdate` on `(user_id, chat_jid)` with `returning`.
    
    **There is no transaction today; keep it that way.**
  - **`getChatBackgroundDefault`** (313) and **`putChatBackgroundDefault`** (333, upsert).
  - The exported constants and types (`CHAT_BACKGROUND_PRESET_IDS`, which `groups/routes.ts` imports, plus `ChatPrefRow`, `ChatPrefView` and `toChatPrefView`) stay. `ChatPrefRow` may stay a type-only import from `../db/schema`.
- **`apps/server/src/chat-folders/service.ts`** (327 lines; the drizzle import is at line 2):
  - every exported function (`listChatFolders` 139, `createChatFolder` 163, `updateChatFolder` 218, `reorderChatFolders` 260, `deleteChatFolder` 295) runs in **one transaction under `pg_advisory_xact_lock(hashtext('chat-folders:' + userId))`**;
  - **`ensureSeeded(tx, userId, now)`** (around line 98) seeds Personal and AIs once. It re-reads inside the transaction, and **the `chat_folder_seeds` insert `onConflictDoNothing` is the race backstop**;
  - the folder cap gives 409 `folder_limit` `'You can have up to 20 folders.'` (line 173);
  - `FolderTransaction` (line 92) is a drizzle type: replace it with the effect/sql equivalent.
- **Tests (all unchanged):** `apps/server/src/chat-prefs/chat-prefs.test.ts`, `apps/server/src/chat-folders/chat-folders.test.ts`, `apps/server/src/pins/routes.test.ts` (it uses `requireChatAccess` through `pins/access.ts`) and `apps/server/src/groups/*.test.ts` (backgrounds).

### What to build
1. **Both service files on effect/sql**, following the recipe:
   - the same exported functions, signatures (`db: ServerDatabase` stays the runtime key) and return values;
   - the same step order, caps, errors and conflict handling;
   - **`chat-folders`: the same advisory lock statement in `sql.withTransaction`, and the same seeding backstop;**
   - the same column values: check how array or JSON columns (`include_types`, `include_chats`, `exclude_chats`) and timestamps decode through `apps/server/src/effect/sql.ts`, and keep the view shapes identical;
   - no `drizzle-orm` import left in these two files.
2. **No caller changes.** If one is needed, stop and report BLOCKED.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/effect/sql.ts`, `apps/server/src/blocks/service.ts`, then both service files in full and the two schema tables in `apps/server/src/db/schema.ts`.

### Allowed files
`apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-folders/service.ts`, `work/T-0528-effect-sql-chat-prefs-folders.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot chat-prefs chat-folders pins groups
pnpm gate
```

### Acceptance
- Both services run on effect/sql with the same answers, locks and caps, and have no `drizzle-orm` import.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Both services now run every query on the `effect/sql` client registered for the
database, following the recipe in `docs/audit/effect-sql-migration.md` §(a) and
the `blocks/service.ts` shape. Exported signatures, return values, step order,
caps, errors and conflict handling are unchanged; the routes and `api.ts` were
not touched.

- `apps/server/src/chat-prefs/service.ts`: `requireChatAccess` (and its
  `canSeeRoomJid`/`canDm` helpers), `listChatPrefs`, `putChatPref`, the shared
  `resolveBackgroundFields`, `getChatBackgroundDefault` and
  `putChatBackgroundDefault` are on tagged-template SQL. `putChatPref` keeps
  the same seven steps and still runs with **no transaction**. The upsert uses
  `ON CONFLICT (user_id, chat_jid) DO UPDATE ... RETURNING *`; the background
  default uses `ON CONFLICT (user_id) DO UPDATE ... RETURNING` the three
  columns. `ChatPrefRow` stays a type-only import from `../db/schema`, and
  `ChatPrefView`/`toChatPrefView` are unchanged. `canSeeTopic` (drizzle) is
  still called through `topics/access` with a `SELECT *` topic row.
- `apps/server/src/chat-folders/service.ts`: all five exported functions run in
  `sql.withTransaction`, each starting with the same raw
  `SELECT pg_advisory_xact_lock(hashtext('chat-folders:' + userId))`.
  `ensureSeeded` re-reads inside the transaction and keeps the
  `chat_folder_seeds` `ON CONFLICT DO NOTHING` race backstop. `FolderTransaction`
  is gone. The 409 `folder_limit`, 404 `not_found` and 400 `invalid_request`
  failures are raised as `Effect.fail(HttpError)` inside the transaction, so the
  transaction rolls back and the rejection reaches the route unchanged.
- Both files have **no `drizzle-orm` import**. `chat-prefs` imports only types
  from `../db/schema`; `chat-folders` likewise.

### Deviations / notes

- **Array columns:** `@effect/sql-pg` throws
  `Cannot infer the type of an empty array` when a JS `[]` is bound (checked in
  `PgConnection.inferParameter`), and the `@effect/sql-pg` typed-parameter
  objects are not understood by the PGlite driver used in tests. So
  `include_types`/`include_chats`/`exclude_chats` are written through
  `ARRAY[...]::text[]` (`ARRAY[]::text[]` for an empty list) with only scalar
  string placeholders. Same stored values, works on both drivers.
- `sortByPosition` now receives `[...rows]` copies because `effect/sql` returns
  read-only arrays; the sort itself is unchanged.

### Commands run and results

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot chat-prefs/chat-prefs.test.ts chat-folders/chat-folders.test.ts`
  → 2 files passed, 27 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot pins groups`
  → 3 files passed, 90 tests passed.
- `pnpm gate` (repo root) — summary lines:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (24.5s)
PASS  lint  (0.7s)
PASS  typecheck  (10.8s)
PASS  tests @zilar/server  (368.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The only changed files are the two services and this task file, all inside the
Allowed files. No caller, route, test or `api.ts` change was needed.

## Review (written by Claude)


Approved (lead, 2026-10-08). chat-prefs and chat-folders services run on effect/sql with the same caps, the same per-user advisory lock in all five folder functions, the same seeding backstop, and putChatPref with no transaction. Arrays are encoded as ARRAY[...]::text[] and round-trip in the tests. No drizzle-orm import left. Pre-review clean; nit (a redundant spread before sortByPosition) accepted.
