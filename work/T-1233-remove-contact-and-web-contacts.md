---
id: T-1233
title: "TG-8 + SG-6: DELETE /api/contacts/:userId removes the contact pair in both directions and both roster items, and the web gets a Contacts page (Settings → Contacts: list, open the DM, Remove with a confirm, copy my profile link)"
status: merged
milestone: M5
branch: task/T-1233-remove-contact-and-web-contacts
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1233: Remove a contact, and a web Contacts page

## Spec (written by Claude, do not edit)

### Why
It's item 8 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4) and SG-6 of `docs/audit/social-graph-audit.md` (`:121-127`, plan row 3 at `:285`). Nobody can remove a contact:
- the contacts contract has only `GET /contacts` (`packages/api-contract/src/contacts.ts:23`);
- there's no contacts page on the web.

The block flow already does the same removal (T-1158):
- it deletes the pair in both directions (`apps/server/src/blocks/service.ts:151-153`);
- it then removes both roster items, best effort (`removeBlockRosterItems`, `apps/server/src/blocks/roster.ts:47-72`).

### What to build
1. **Contract** (`packages/api-contract/src/contacts.ts`): add `HttpApiEndpoint.delete('remove', '/contacts/:userId')`, which answers 204.
2. **Server** (`apps/server/src/contacts/service.ts` plus `api.ts`):
   - add `removeContact(db, userId, targetId)`: delete both `contacts` rows in one statement, exactly the shape of `blocks/service.ts:151-153`;
   - after it, call the roster helper. **Reuse `removeBlockRosterItems`**: move it to a shared name, or wrap it, keeping blocks working; cite what you did;
   - a target that isn't a contact answers 404;
   - write-rate-limit it the way the blocks API is (cite where);
   - wire `adminClient` in by changing the one-line `createContactsApi({ auth, db, config, logger })` at `apps/server/src/app.ts:284` to also pass `adminClient`. **Net zero lines in `app.ts`** (it's 583 lines and must not grow);
   - write one audit entry with ids only, like the block audit.
3. **Web Contacts page:** a new `apps/web/src/routes/ContactsPage.tsx` at `/settings/contacts` (register it next to `/settings/blocked`, `apps/web/src/routes/AppRoutes.tsx:219`), linked from the same settings menu that links Blocked people (find it in `apps/web/src/components/chatList/ChatListMenu.tsx` and cite it). The page:
   - lists contacts from `client.contacts.list()` (`apps/web/src/lib/api/chats.ts:94`), with the ball avatar or photo, name and @handle, sorted by name;
   - opens the DM when a row is clicked (`/c/<jid>`);
   - gives each row a menu with **Remove contact**, which shows an in-page confirm (no `window.confirm`), calls the new route, drops the row, and refreshes the chat list through the store's existing refresh (cite it);
   - has a **Copy my profile link** button at the top: the same link the profile page shows (find it and cite it);
   - follows the existing settings pages for its layout (copy `BlockedPage.tsx`'s structure) and uses no emoji.
4. **Test** (permissions), 1, in a new `apps/server/src/contacts/contacts.test.ts` following `apps/server/src/blocks/blocks.test.ts`: after A removes B, neither A's nor B's list contains the other, and removing again answers 404.

### Read first
`AGENTS.md`, `docs/audit/social-graph-audit.md:115-130`, `packages/api-contract/src/contacts.ts`, `apps/server/src/contacts/api.ts`, `apps/server/src/contacts/service.ts`, `apps/server/src/blocks/service.ts`, `apps/server/src/blocks/roster.ts`, `apps/server/src/blocks/api.ts`, `apps/server/src/blocks/blocks.test.ts`, `apps/web/src/routes/BlockedPage.tsx` and `apps/web/src/routes/AppRoutes.tsx`.

### Allowed files
`packages/api-contract/src/contacts.ts`, `apps/server/src/contacts/**`, `apps/server/src/blocks/roster.ts`, `apps/server/src/blocks/service.ts`, `apps/server/src/app.ts` (the one line only), `apps/web/src/routes/ContactsPage.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/lib/api/**`, `work/T-1233-remove-contact-and-web-contacts.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/contacts/contacts.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- `app.ts` keeps its line count.
- Every touched file stays at most 400 lines.
- **The lead's checks:**
  - on the local web mock, the page lists contacts and Remove asks first;
  - after deploy, the remove route answers 404 for a user id that isn't a contact.

---

## Report (written by the worker when done)

**Status: complete.** All Checks pass; `pnpm gate` ends with `GATE PASS`.

### What I did

**1. Contract (`packages/api-contract/src/contacts.ts`).** Added
`HttpApiEndpoint.delete('remove', '/contacts/:userId', { params: { userId },
success: HttpApiSchema.NoContent })`. The write budget is a new
`ContactsWriteRateLimit` tag. Because `packages/api-contract/src/middleware.ts`
(where every other rate-limit tag lives) is **outside the Allowed files**, the
tag is declared in `contacts.ts` itself and its layer is provided by
`rateLimitLayer(ContactsWriteRateLimit, …)` in `contacts/api.ts` — the same
shape and order as `BlocksWriteRateLimit` (`blocks/api.ts:112`).

**2. Server.**
- `contacts/service.ts`: `removeContact(deps, userId, targetId)` deletes both
  `contacts` rows in one statement with `RETURNING user_id`, exactly the shape
  of `blocks/service.ts:151-153` (`blockUser`); an empty `RETURNING` (not a
  contact in either direction) answers 404 **before** roster removal or audit.
  After the commit it writes one audit entry `contact.removed` with ids only
  (`actorUserId`, `subjectId`), like the block audit (`blocks/service.ts:52-65`),
  then calls the shared roster helper. A single `DELETE … WHERE (a,b) OR (b,a)`
  keeps it atomic (no check-then-delete).
- Roster helper reuse: I moved the helper to a shared name —
  `removeBlockRosterItems` → **`removePairRosterItems`** (and
  `RemoveBlockRosterInput` → `RemovePairRosterInput`, `BlockRosterLogger` →
  `RosterLogger`), with neutral warn texts, in `apps/server/src/blocks/roster.ts`.
  `blocks/service.ts` now calls `removePairRosterItems`. Because
  `apps/server/src/blocks/blocks.test.ts` imports the old name and is **outside
  the Allowed files**, `roster.ts` keeps `export const removeBlockRosterItems =
  removePairRosterItems` so that test keeps working unchanged. `contacts/service.ts`
  imports `removePairRosterItems`.
- Rate limit: `CONTACTS_WRITE_RATE_LIMIT_MAX = 30`,
  `CONTACTS_WRITE_RATE_LIMIT_WINDOW_MS = 10 min`, mirroring
  `BLOCK_WRITE_RATE_LIMIT_{MAX,WINDOW_MS}` (`blocks/api.ts:25-28`).
- **app.ts stays at 583 lines and only its one line changed**:
  `createContactsApi({ auth, db, config, logger, adminClient })`. I did **not**
  pass `audit` there: adding `audit: auditRecorder` makes that line 105 chars,
  over the repo's `printWidth: 100`, so Prettier would wrap it to 8 lines and
  grow app.ts. Instead `contacts/api.ts` builds the recorder itself —
  `createAuditRecorder({ db: deps.db, logger: deps.logger })`, the exact call
  app.ts uses at `app.ts:253` — with `audit` still injectable for tests. So the
  audit entry is written in production and app.ts' line count is unchanged.

**3. Web.**
- New `apps/web/src/routes/ContactsPage.tsx` at `/settings/contacts`, registered
  next to `/settings/blocked` in `AppRoutes.tsx` (eager import + `ContactsRoute`
  wrapper, mirroring `BlockedPage`/`BlockedRoute`).
- Linked from the same settings menu as Blocked people:
  `ChatListMenu.tsx`, one added `<NavMenuItem to="/settings/contacts"
  label="Contacts" />` right after the "Blocked people" entry (nothing reordered).
- The page lists `getContacts()` (`lib/api/chats.ts:93`, which wraps
  `client.contacts.list()`), avatar (ball or photo via `Avatar`), name and
  `@handle`, sorted by name; the row body opens the DM at `/c/<jid>`; each row's
  menu has **Remove contact**, which shows an in-page confirm (no
  `window.confirm`), calls the new route, drops the row and refreshes the chat
  list through the store's existing action `storeApi.getState().refreshChats()`
  (the one `JoinRoute`/`ContactProfileRow` call). Layout copies `BlockedPage.tsx`
  (SettingsShell + `SETTINGS_COLUMN` + `Card`); no emoji (lucide `MoreHorizontal`).
- **Copy my profile link** at the top uses the same URL the profile page shows:
  `` `${window.location.origin}/@${encodeURIComponent(handle)}` ``
  (`ProfileSettingsSection.tsx:134-137`, the "Copy share link" button).
- New API fn `removeContact(userId)` added in `apps/web/src/lib/api/chats.ts`
  (`client.contacts.remove({ params: { userId } })`). The page imports it from
  `@/lib/api/chats` directly, because the barrel `apps/web/src/lib/api.ts` is a
  **sibling** of the Allowed `apps/web/src/lib/api/**`.

**4. Test.** `apps/server/src/contacts/contacts.test.ts` (service level, like
`blocks.test.ts`): after A removes B, neither list contains the other and both
roster items were removed, and a second remove rejects with 404 `not_found`.

### Files changed
- `packages/api-contract/src/contacts.ts`
- `apps/server/src/contacts/service.ts`, `apps/server/src/contacts/api.ts`, `apps/server/src/contacts/contacts.test.ts` (new)
- `apps/server/src/blocks/roster.ts`, `apps/server/src/blocks/service.ts`
- `apps/server/src/app.ts` (one line)
- `apps/web/src/routes/ContactsPage.tsx` (new), `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/lib/api/chats.ts`

### Commands run (real results)
- `pnpm install` — Done in 11.3s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/contacts/contacts.test.ts` — **1 passed (1 file)**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/blocks/blocks.test.ts` — **3 passed (1 file)** (roster refactor did not break blocks).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` — **5 passed**; the new `DELETE /api/contacts/:userId` answers 401 unauthenticated.
- `pnpm gate` summary:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (5.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Security checklist
- Delete is scoped to the pair (`WHERE (user_id=a AND contact_user_id=b) OR (…b,a)`).
- One atomic statement, no check-then-delete.
- Not-a-contact and unknown-user both answer the same 404; nothing runs before it.
- New route is write-rate-limited and covered by the 401 sweep.
- Audit entry carries ids only (`contact.removed`).

### Deviations / notes for the lead
- The rate-limit tag lives in `contacts.ts`, not `middleware.ts` (out of scope).
- The roster helper was renamed to `removePairRosterItems` and the old
  `removeBlockRosterItems` name is kept only as an alias for `blocks.test.ts`
  (out of scope).
- The audit recorder is built inside `contacts/api.ts` rather than passed from
  app.ts, to keep app.ts at 583 lines (see above).
- `packages/mock-backend/src/domains/contacts/routes.ts` serves only
  `GET /contacts` and is **outside the Allowed files**, so in local mock mode the
  page lists contacts and the Remove confirm renders, but confirming a removal is
  not persisted by the mock backend. The web page itself is exercised by the
  lead's mock check (list + "Remove asks first").

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit, 1 follow-up).**
- **Server:**
  - the remove route deletes both `contacts` rows and then both roster items, through the shared roster helper that blocks now also use;
  - it answers 404 for a non-contact and is write-rate-limited, with an ids-only audit entry;
  - `app.ts` changes by one line, net zero.
- **Lead's check on the local web mock (`/settings/contacts`):**
  - 8 contacts, sorted, with ball avatars;
  - the row menu offers "Remove contact", and the in-page confirm reads "Remove Ana? They stay in your chats; you stop being contacts.";
  - Cancel works;
  - the "Copy my profile link" button is hidden because the mock user has no handle (`ContactsPage.tsx:41-45`).
  - I didn't confirm a remove: the mock has no DELETE route (follow-up).
- **Follow-ups:**
  - nit: an empty card shows above the empty state after the last contact is removed (`ContactsPage.tsx:75`);
  - add the DELETE to the mock backend (`packages/mock-backend/src/domains/contacts/routes.ts`).
- **After deploy:** live-check that the remove route answers 404 for a user who isn't a contact (a fetch from the health page).
