---
id: T-1237
title: "TG-8 mobile: Settings → Contacts screen lists your contacts (avatar, name, @handle), tap opens the DM, a Remove contact action with an in-screen confirm calls the T-1233 remove route; a Share my profile button uses Share.share; plus the mock backend's DELETE /contacts/:userId so the flow works in mock mode on web and mobile"
status: merged
milestone: M5
branch: task/T-1237-mobile-contacts-screen
model: auto
effort: default
depends_on: [T-1233]
estimate: 0.4 day
---

# T-1237: Mobile Contacts screen

## Spec (written by Claude, do not edit)

### Why
It's item 8 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4). T-1233 (merged) added the contract's `remove` endpoint (`packages/api-contract/src/contacts.ts:38-41`) and the web page (`apps/web/src/routes/ContactsPage.tsx`; read it, since mobile must behave the same). Mobile has no contacts screen.
- **Settings rows:** live in `apps/mobile/src/lib/settings-items.ts` ("Blocked people" at `:88-95`), with icons mapped in `apps/mobile/src/app/(tabs)/settings.tsx:52-53`.
- **The list call:** contacts are listed by `getContacts` (`apps/mobile/src/lib/chat-api.ts:181`).
- **The other calls:** block, unblock and requests live in `apps/mobile/src/lib/contacts-api.ts:72-82,123-144`, and the screens reach them through `apps/mobile/src/components/contacts/use-contacts-api.ts`, which also picks the mock backend.
- **The model screen:** `apps/mobile/src/app/settings/blocked.tsx` (205 lines). Copy its layout, loading, error line and per-row action; `performUnblock` is in `apps/mobile/src/components/contacts/blocks.ts`.

### What to build
1. **`contacts-api.ts`:** add `listContacts()` and `removeContact(userId)` to `ContactsApi` and `createContactsApi`, using `client.contacts.list()` and `client.contacts.remove({ params: { userId } })`.
2. **The new screen, `apps/mobile/src/app/settings/contacts.tsx`:**
   - **Rows:** one per contact, sorted by name, showing the ball avatar or photo (the same avatar component the blocked screen or chat list uses; cite it), the name and the @handle.
   - **Tapping a row** opens the DM (the same route the chat list uses for a DM; cite it).
   - **Remove:** each row has a "Remove" action that shows an in-screen confirm, worded as on the web: "Remove <name>? They stay in your chats; you stop being contacts." It has Remove (danger) and Cancel, and no `Alert.alert`. On success the row drops; a failure shows one line and keeps the row.
   - **Share my profile:** a button at the top, shown only when the user has a handle, sends the same `https://<host>/@handle` link the web uses through `Share.share` (as in `apps/mobile/src/components/chat/new-chat-button.tsx:82`).
   - **The empty state:** "No contacts yet.", with no empty card above it.
3. **Settings:** add a "Contacts" row (subtitle "People you can chat with.") before "Blocked people" in the `account` group, with an icon from `lucide-react-native` mapped in `settings.tsx` (`Users`).
4. **The mock backend:** add the DELETE contacts route to `packages/mock-backend/src/domains/contacts/routes.ts`. It drops the pair from the mock store and answers 204, or 404 when the user isn't a contact, so Remove works in mock mode on web and mobile.
5. **The web nit from T-1233** (`apps/web/src/routes/ContactsPage.tsx:75`): the card renders on `people.length > 0` while the empty state keys on `visibleCount`, so an empty card shows after the last contact is removed. Key the card on the same count.
6. **No tests** (UI and mock).

### Read first
`AGENTS.md`, `work/T-1233-remove-contact-and-web-contacts.md` (the Report and the Review), `apps/web/src/routes/ContactsPage.tsx`, `apps/mobile/src/app/settings/blocked.tsx`, `apps/mobile/src/components/contacts/blocks.ts`, `apps/mobile/src/components/contacts/use-contacts-api.ts`, `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/app/(tabs)/settings.tsx` and `packages/mock-backend/src/domains/contacts/routes.ts`.

### Allowed files
`apps/mobile/src/app/settings/contacts.tsx`, `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/components/contacts/**`, `packages/mock-backend/src/domains/contacts/**`, `apps/web/src/routes/ContactsPage.tsx`, `work/T-1237-mobile-contacts-screen.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every touched file stays at most 400 lines.
- **The lead's check on the emulator (mock build):**
  - Settings shows Contacts;
  - the list renders, and tapping a row opens the DM;
  - Remove asks, then drops the row.

---

## Report (written by the worker when done)

**Status: complete.** All Checks pass; `pnpm gate` ends with `GATE PASS`.

### What I did

**1. `contacts-api.ts`** (`apps/mobile/src/lib/contacts-api.ts`): added `listContacts()`
(`client.contacts.list()`) and `removeContact(userId)` (`client.contacts.remove({ params: { userId } })`)
to `ContactsApi`/`createContactsApi`, and re-exported the contract's `Contact` row type.

**2. New screen** (`apps/mobile/src/app/settings/contacts.tsx`, 292 lines), copying
`blocked.tsx`'s layout, loading/error lines and per-row action:
- rows sorted by name, one per contact, with the ball/photo `Avatar` from
  `@/components/chat/avatar` (the one `blocked.tsx:18` and the chat list use) plus name and `@handle`;
- tapping a row opens the DM through the chat list's own route,
  `router.push({ pathname: '/chat/[id]', params: { id } })` (`app/(tabs)/index.tsx:140`), with the contact's JID;
- each row's **Remove** shows an in-screen confirm worded as on the web —
  "Remove {name}? They stay in your chats; you stop being contacts." — with Remove (destructive) and Cancel,
  no `Alert.alert`; success drops the row, failure shows one fixed line and keeps it;
- **Share my profile** at the top only when the caller has a handle, sending the same
  `https://<host>/@<handle>` link the web shares (`ContactsPage.tsx:42-45`) through
  `Share.share` (as in `components/chat/new-chat-button.tsx:82`);
- the empty state is exactly "No contacts yet.", and the card renders only when rows remain
  (no empty card above it).

**3. Settings** (`apps/mobile/src/lib/settings-items.ts`, `app/(tabs)/settings.tsx`): one
"Contacts" row (subtitle "People you can chat with.", icon `contacts`, href `/settings/contacts`,
group `account`) placed **before** "Blocked people" as the spec asks, plus `contacts: Users` in
`HUB_ICONS`. No other entry was reordered or reformatted.

**4. Mock backend** (`packages/mock-backend/src/domains/contacts/`): `routes.ts` now also serves
`DELETE /contacts/:userId`; a new `state.ts` augments `MockData` with a removed-id table
(`removedContactIds`, `isContact`, `removeContact`) so `GET /contacts` leaves a removed person out
and `DELETE` answers 204, or 404 for an id that is not a contact (unknown or already removed). The
domain's `index.ts` wires `createContactsState`. The table follows `avatars/state.ts`'s inline
module-augmentation shape (a separate `tables.ts` would not be pulled into the mobile/web programs).

**5. Web nit** (`apps/web/src/routes/ContactsPage.tsx:75`): the card now keys on `visibleCount`
instead of `people.length`, so no empty card shows after the last contact is removed.

**6. No tests** (UI and mock), per the spec.

### Files changed
- `packages/mock-backend/src/domains/contacts/routes.ts`, `index.ts`, `state.ts` (new)
- `apps/mobile/src/app/settings/contacts.tsx` (new), `apps/mobile/src/components/contacts/contacts.ts` (new)
- `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/web/src/routes/ContactsPage.tsx`

### Commands run (real results)
- `pnpm install` — Done in 13.1s.
- `pnpm gate` summary:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.6s)
  PASS  lint  (0.6s)
  PASS  typecheck  (10.5s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/mobile  (2.6s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (A first `pnpm gate` run failed typecheck because the module augmentation lived in an
  un-imported `tables.ts`; moving it into `state.ts` fixed it.)
- One single test file was not applicable (no test covers these files); the gate ran the mobile
  package's nearest tests (`tests @zilar/mobile`, PASS).
- Mock route sanity check (throwaway script run with the repo's `tsx`, not committed): 8 contacts,
  `DELETE /api/contacts/u-ana` → 204, list then has 7 and no Ana, second delete → 404, unknown id → 404.

### Deviations / notes for the lead
- The registry file's own doc says "append at the end", but the spec says to put Contacts **before**
  Blocked people; I followed the spec and inserted one entry (no existing entry reordered).
- The share host is the literal `https://chat.zilar.app` because the mobile app has no web-origin
  constant (`web-link.ts:13`; `app.json:33` maps `/@`). The session's `Me` carries no handle, so the
  screen reads it from `GET /me` via `useProfileApi`; a failed lookup only hides the button.
- Follow-up (outside Allowed files): `web-link.ts`'s `SETTINGS_PAGES` does not include `contacts`, so
  a `chat.zilar.app/settings/contacts` deep link opened on mobile falls back to `/settings`.
- The mock `GET /contacts` still returns no `handle` (unchanged behavior), so in mock mode the rows
  show name + avatar without `@handle`; the real server sends the handle.

### Security checklist
- The remove route already exists server-side (T-1233): pair-scoped delete, atomic, 404 for a
  non-contact, write-rate-limited, ids-only audit. This task adds no server route.
- The mobile Remove sends only `userId` in the path; no secret reaches a share link or a log (the
  share link carries the public `@handle` only).
- The mock DELETE is scoped to the one contact id and answers the same 404 for unknown and removed.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 follow-up).**
- **The lead's emulator check** (mock build of this branch, `SMOKE PASS`):
  - Contacts lists 8 people with ball avatars and a Remove button each;
  - Remove shows the in-screen confirm ("Remove Ana? They stay in your chats; you stop being contacts.") with Remove and Cancel;
  - confirming drops the row (through the new mock DELETE);
  - tapping a row opens the DM by `person.jid` (`contacts.tsx:196`). In the mock, "Dev-1"'s JID is the Dev AI DM (`JIDS.dev1`, `threads/dev-ai.ts`), so it opened Dev AI. That's mock data, not the screen.
- **The web nit from T-1233** (the empty card after the last contact) is fixed in `ContactsPage.tsx`.
- **Follow-up:** the deep link `chat.zilar.app/settings/contacts` isn't in `SETTINGS_PAGES` (`apps/mobile/src/lib/web-link.ts:16-26`).
