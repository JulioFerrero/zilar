---
id: T-0244
title: "Mobile: block and unblock people, Blocked people screen, and the 'blocked' relation no longer breaks profile lookups"
status: planned
milestone: M5
branch: task/T-0244-mobile-block-users
model: deepseek/deepseek-flash
effort: default
depends_on: [T-0171, T-0239]
estimate: 0.6 day
---

# T-0244: Mobile block users

## Spec (written by Claude, do not edit)

### Why
Block users, mobile part. The server (T-0171) and the web (T-0235, T-0239) are done. Julio also wants this task as a trial of `deepseek/deepseek-flash` against Muse on a real task.

**Live bug:** since T-0171 the server's by-handle lookup answers `relation: 'blocked'` for people I blocked. The mobile parser rejects any relation it does not know (`apps/mobile/src/lib/contacts-api.ts` lines 99-107), so on the phone, looking up someone I blocked fails.

### Verified facts (do not re-derive)
- **Server routes** (T-0171, `apps/server/src/blocks/routes.ts`), all session-required, rate limited 30 writes per 10 minutes:
  - PUT `/api/blocks/:userId` → `{ blocked: true }`;
  - DELETE `/api/blocks/:userId` → `{ blocked: false }`;
  - GET `/api/blocks` → `{ blocked: [{ userId, name, handle: string | null, image: string | null, jid: string | null }] }`.
  - Errors: 404 `not_found` (unknown user), 400 `invalid_request` (yourself), 429 `rate_limited`. Sending a contact request to someone I blocked → 409 `blocked`.
- **Web reference** (same behaviour; copy the sentences): `apps/web/src/components/ContactProfileRow.tsx` (Block behind an inline confirm "Block {name}? They are not told. You won't see their contact requests.", Unblock on a blocked profile, 409 `blocked` → "Unblock this person first.", 429 → "Too many tries — wait a little and try again.") and `apps/web/src/routes/BlockedPage.tsx` (list, `@handle` only when not null, "Could not unblock. Try again.").
- **Mobile client** `apps/mobile/src/lib/contacts-api.ts`:
  - `ContactRelation` at line 15;
  - `ContactsApi` interface at lines 61-68;
  - `isRelation` at lines 99-107;
  - `request()` helper at lines 219-247 (`ContactsApiError` keeps `status` and `code`);
  - `createContactsApi` at line 278.
  - There is no zod; type guards validate the boundary.
- Mock: `apps/mobile/src/components/contacts/contacts-mock.ts` (`createMockContactsApi`, line 108). Picker hook: `apps/mobile/src/components/contacts/use-contacts-api.ts`.
- Card: `apps/mobile/src/components/contacts/profile-card.tsx`, `ProfileCardActionRow` (lines 98-190, one action per relation). It is used by `apps/mobile/src/app/u/[handle].tsx` (line 203), `apps/mobile/src/components/contacts/people-search-result.tsx` (line 72) and `apps/mobile/src/components/contacts/add-contact-sheet.tsx` (line 220).
- Screen pattern: `apps/mobile/src/app/settings/requests.tsx` (`RequireAuth`, `useContactsApi`, loading/ready/error states, `IconButton` back, lucide icons).
- **Do not touch** the settings hub (`apps/mobile/src/app/settings/index.tsx`, `apps/mobile/src/lib/settings-items.ts`): T-0233 is moving them right now. Link the new screen from the Contact requests screen instead.

### What to build
1. **Client** (`contacts-api.ts`): add `'blocked'` to `ContactRelation` and to `isRelation`. Add `BlockedPerson { userId, name, handle: string | null, image: string | null, jid: string | null }`. Add `blockUser(userId)`, `unblockUser(userId)` and `listBlockedUsers()` to `ContactsApi` and `createContactsApi`, with type-guarded parsing. Mirror them in `contacts-mock.ts` with an in-memory list (unknown id → 404, yourself → 400).
2. **Card** (`profile-card.tsx`):
   - `ProfileCardActionRow` gets `onBlock` and `onUnblock`.
   - For `relation === 'blocked'`: the line "You blocked this person." and an Unblock button.
   - For every other relation except `self`: a small muted "Block" text button under the actions, which opens an inline confirm with the web sentence. The confirm has a danger Block (lucide `Ban` icon) and Cancel.
   - Errors are fixed sentences (copy the web ones above).
   - Wire it in `people-search-result.tsx` and `u/[handle].tsx`. After success, update the shown profile's relation (`blocked` / `none`), the same way the other actions update it.
   - `add-contact-sheet.tsx` only needs to compile with the new props: pass the handlers if it is simple, otherwise leave Block out there and say so in your Report.
3. **Screen** `apps/mobile/src/app/settings/blocked.tsx` (new): "Blocked people".
   - Rows have avatar, name, and muted `@handle` only when not null, plus Unblock.
   - Also an empty state "You have not blocked anyone.", loading and error states, and the unblock error "Could not unblock. Try again.".
   - Same structure as `requests.tsx`.
4. **Link:** at the bottom of `apps/mobile/src/app/settings/requests.tsx`, add a row "Blocked people" (lucide `Ban` icon, chevron) that pushes `/settings/blocked`.
5. **Tests:**
   - `contacts-api.test.ts`: `'blocked'` parses; the three new calls send the right method and path and parse the bodies; a null `handle`/`jid` passes; a bad body is rejected.
   - The card test (extend the existing contacts test file): the blocked relation shows Unblock; Block → confirm → `blockUser` called; 409 `blocked` sentence; 429 sentence.
   - `apps/mobile/src/components/contacts/blocked-screen.test.tsx` (new; tests may not live under `src/app`): list, null handle without `@`, unblock removes the row, unblock failure sentence, empty state.
   - Mock: blocking twice is idempotent.

### Read first
`AGENTS.md`, `apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/routes/BlockedPage.tsx`, `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/components/contacts/profile-card.tsx`, `apps/mobile/src/components/contacts/contacts-mock.ts`, `apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/lib/routes-dir.test.ts`.

### Allowed files
`apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/contacts-api.test.ts`, `apps/mobile/src/components/contacts/**`, `apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/app/settings/blocked.tsx` (new), `apps/mobile/src/app/settings/requests.tsx`, `work/T-0244-mobile-block-users.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot contacts-api contacts blocked-screen
pnpm gate
```

### Acceptance
- Looking up someone I blocked works on the phone and shows Unblock.
- I can block from the profile card (with a confirm) and unblock from the card or the Blocked people screen. Every error is a fixed sentence.
- No server, web or settings-hub change. Icons only, no emoji. `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Hiding blocked people's messages on mobile (next task), the settings hub row (after T-0233 merges), ejabberd enforcement.

---

## Report (written by the worker when done)

## Review (written by Claude)
