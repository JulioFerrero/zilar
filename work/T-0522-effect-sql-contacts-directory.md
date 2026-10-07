---
id: T-0522
title: "Effect C1: contacts/service.ts and directory/service.ts on effect/sql (same queries, same order, same answers); signatures unchanged, every test unchanged"
status: todo
milestone: M5
branch: task/T-0522-effect-sql-contacts-directory
model: auto
effort: low
depends_on: [T-0510]
estimate: 0.5 day
---

# T-0522: contacts and directory services on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle. `pins` and `blocks` (T-0510) are done, and contact-requests (T-0519) is in review. **The recipe is in `docs/audit/effect-sql-migration.md` §(a)**, with `apps/server/src/pins/service.ts` and `apps/server/src/blocks/service.ts` as the examples (`sqlRuntimeFor(db).runPromise`, `SqlClient`, and rows through `transformResultNames` in `apps/server/src/effect/sql.ts`).

### Verified facts (do not re-derive)
- **`apps/server/src/contacts/service.ts`** (259 lines; drizzle import at line 1). **None of its functions runs inside a caller's transaction.** Each takes `db: ServerDatabase` and is called with the plain db:
  - **`addContactPair(db, input)`** (line 37): returns early when `userId === contactUserId`; otherwise inserts both directions in one statement, `onConflictDoNothing`. It is called from `apps/server/src/contact-requests/service.ts` (accept) and from `setUpContactsFromInvite`.
  - **`listContacts(db, userId, domain)`** (line 61): contacts in `asc` order, with avatars through `avatarIdsByOwner` (`apps/server/src/avatars/service.ts`, still drizzle; keep calling it with `db`). It is called from `apps/server/src/contacts/api.ts:66` and `apps/server/src/chats/routes.ts`.
  - **`syncRoster(db, adminClient, domain, userId)`** (line 121): pending rows, then `adminClient.addRosterItem`, then marks them `roster_synced`. Called from `xmpp/routes.ts`, `contact-requests/service.ts` and `setUpContactsFromInvite`.
  - **`refreshRosterNicknames(...)`** (line 173), called from `auth/routes.ts`.
  - **`setUpContactsFromInvite(db, adminClient, domain, input)`** (line 227): `findInviteByCode` (from `auth/invites`; it stays drizzle and keeps being called with `db`), then an insert into `user_invites` `onConflictDoNothing`, then `addContactPair` and two `syncRoster` calls. Called from `auth/auth.ts:170`.
  - Constants `ROSTER_GROUP`, `UNNAMED_CONTACT_NAME` and `ContactSource` are imported elsewhere and stay exported.
- **`apps/server/src/directory/service.ts`** (269 lines; drizzle import at line 7):
  - **`searchDirectory(db, viewerId, input)`** (line 78) uses:
    - `ilike` on the handle **or** the title, with `escapeLike(raw) + '%'`;
    - a `(createdAt, id)` keyset cursor (`lt` / `eq`+`lt`);
    - `orderBy(desc(createdAt), desc(id))` and `limit(DIRECTORY_PAGE_SIZE + 1)`;
    - then `countMembers`, `membershipsOf` and `avatarIdsByOwner`.
  - **`publicGroupForHandle(db, viewerId, handle)`** (line 192).
  - Its helpers are `countMembers` and `membershipsOf`.
- **Tests (all unchanged):** `apps/server/src/contacts/contacts.test.ts`, `apps/server/src/groups/visibility.test.ts` (directory and by-handle), `apps/server/src/contact-requests/contact-requests.test.ts`, `apps/server/src/chats/chats.test.ts` and the auth sign-up tests that hit invites (`apps/server/src/auth/*.test.ts`).

### What to build
1. **Both service files on effect/sql**, following the recipe:
   - the same exported functions, signatures (`db: ServerDatabase` stays the key for `sqlRuntimeFor(db)`) and return values;
   - the same SQL semantics: conflict-do-nothing, the `ilike` with the same escaping, the keyset order, the `+1` page probe, and the same counts;
   - no drizzle imports left in these two files.
   
   Calls into other modules that are still on drizzle (`avatarIdsByOwner`, `findInviteByCode`) stay as they are.
2. **No caller changes** are needed. If one is, stop and report BLOCKED.
3. **Tests:** every test listed above passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/effect/sql.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/blocks/service.ts`, then both service files in full.

### Allowed files
`apps/server/src/contacts/service.ts`, `apps/server/src/directory/service.ts`, `work/T-0522-effect-sql-contacts-directory.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot contacts groups/visibility contact-requests chats auth
pnpm gate
```

### Acceptance
- Both services run on effect/sql with the same answers, and have no drizzle imports.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
