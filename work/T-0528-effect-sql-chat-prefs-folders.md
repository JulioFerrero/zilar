---
id: T-0528
title: "Effect C1: chat-prefs/service.ts and chat-folders/service.ts on effect/sql (same caps, same per-user advisory lock, same seeding race backstop, same answers); signatures unchanged, every test unchanged"
status: todo
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

## Review (written by Claude)
