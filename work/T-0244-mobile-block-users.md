---
id: T-0244
title: "Mobile: block and unblock people, Blocked people screen, and the 'blocked' relation no longer breaks profile lookups"
status: merged
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

Status: review. Branch: `task/T-0244-mobile-block-users`.

### What I did

- `contacts-api.ts`: added `'blocked'` to `ContactRelation` and `isRelation`; added
  `BlockedPerson { userId, name, handle: string | null, image: string | null, jid: string | null }`;
  added `blockUser` (PUT `/api/blocks/:userId`), `unblockUser` (DELETE same) and
  `listBlockedUsers` (GET `/api/blocks`) to `ContactsApi`/`createContactsApi` with type-guarded
  parsers (`parseBlockResult`, `parseBlockedPerson`, `parseBlockedList`; a non-array or a row
  without `userId`/`name` is rejected as `invalid_response`).
- `contacts-mock.ts`: in-memory blocked list. Seed adds `u-eve` (`relation: 'blocked'`) so the fix
  is visible in mock mode. `blockUser` is idempotent, 404s an unknown id, 400s `u-me`, flips the
  profile relation; `unblockUser` is idempotent and flips back to `none`; `listBlockedUsers`
  returns a copy. `sendContactRequest` on a blocked profile now throws 409 `blocked`.
- `add-contact.ts`: added the missing `blocked` case to `addContactSendFailure` ->
  "Unblock this person first." (previously it fell through to the raw server message, which
  broke the fixed-sentences rule).
- `blocks.ts` (new): UI-free `blockFailure`/`unblockFailure`/`blockedLoadFailure` (429 ->
  "Too many tries — wait a little and try again."), `performBlock` and `performUnblock`
  (success callbacks; failures return sentences, never throw).
- `profile-card.tsx`: `ProfileCard` owns the inline confirm (`useState`, reset on a new
  `userId`, like the add-contact sheet) and gets `onBlock`/`onUnblock`.
  `ProfileCardActionRow` stays presentational and gets `name`, `blockConfirming`, `onStartBlock`,
  `onCancelBlock`, `onBlock`, `onUnblock`. Blocked relation -> "You blocked this person." +
  Unblock. Every other relation but `self` gets the muted "Block" text button; the confirm uses
  the web sentence with a danger Block (lucide `Ban`) and Cancel.
- Wired the handlers in `u/[handle].tsx`, `use-people-search.ts` (used by
  `people-search-result.tsx`) and `add-contact-sheet.tsx`; on success the shown relation becomes
  `blocked`/`none`, on failure the inline sentence is shown.
- `settings/blocked.tsx` (new): "Blocked people", same structure as `requests.tsx`
  (`RequireAuth`, `useContactsApi`, loading/ready/error, back `IconButton`, `Avatar`), rows with
  avatar, name and muted `@handle` only when not null plus Unblock, empty state "You have not
  blocked anyone.", load error with Retry, unblock failure "Could not unblock. Try again.".
- `settings/requests.tsx`: added a bottom "Blocked people" row (lucide `Ban`, chevron) pushing
  `/settings/blocked`. Did not touch the settings hub.

### Tests

- `contacts-api.test.ts`: `'blocked'` parses; PUT/DELETE/GET of the block routes and their
  bodies; null `handle`/`jid` pass; malformed list and malformed block result reject.
- `contacts.test.tsx`: blocked relation shows Unblock; Block appears on every non-self relation;
  confirm shows the web sentence and "Confirm block"/"Cancel the block"; Block press calls
  `onStartBlock`, Confirm calls `onBlock`; `performBlock` calls `blockUser` and maps 429 /
  fallback sentences; 409 `blocked` send maps to "Unblock this person first.".
- `blocked-screen.test.tsx` (new): list, null handle without `@`, empty, loading, load error with
  Retry, inline unblock failure; `performUnblock` removes the row on success and keeps it on
  failure (plus the 429 sentence).
- `contacts-mock.test.ts`: blocking twice is idempotent, unblock flips back, unknown id 404,
  yourself 400, blocked lookup parses.
- `people-search.test.ts` and `requests-screen.test.tsx`: updated the expected labels (Block added)
  and the fake APIs; the requests screen shows the Blocked people link.

### Commands (real results)

- `pnpm install` — done, no errors.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/contacts-api.test.ts src/components/contacts/contacts.test.tsx src/components/contacts/contacts-mock.test.ts`
  — 3 files, 57 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/contacts/blocked-screen.test.tsx src/components/contacts/people-search.test.ts src/components/contacts/requests-screen.test.tsx`
  — 3 files, 39 tests passed.
- `pnpm gate` (first run) — FAIL on format for 2 of my files; I ran
  `pnpm exec prettier --write` on exactly those two.
- `pnpm gate` (final) — GATE PASS:
  - `PASS install (frozen) (4.1s)`, `PASS format (20.1s)`, `PASS lint (0.8s)`,
    `PASS typecheck (8.6s)`, `PASS tests @zilar/mobile (1.9s)`
  - `gate: 18 changed file(s) against main`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations from the spec

- `ProfileCardActionRow` also received `name`, `blockConfirming`, `onStartBlock` and
  `onCancelBlock`. The mobile suite renders components directly (no React Native testing library),
  so the confirm state lives in `ProfileCard` and the row stays presentational, matching the
  existing `AlwaysAllowedRow` confirm pattern. `onBlock`/`onUnblock` are as the spec asks.
- `add-contact-sheet.tsx` was simple enough, so I wired Block/Unblock there too (not just
  compile).
- The mock seeds a blocked `u-eve` profile/list so the default mock shows the fixed behaviour.
- Fixed the missing `blocked` case in the send-error mapper (needed for the card's 409 sentence;
  without it the app would have shown raw server text).

### Blocked / needs a decision

None.

### Round 2 (pre-review fixes)

Fixed finding 1 (should-fix): the inline block confirm reopened after block → unblock.
`profile-card.tsx` now resets `confirmingBlock` when the profile's `userId` **or** `relation`
changes (new `shouldResetBlockConfirm` predicate), so a successful block or unblock closes the
confirm instead of leaving state `true` that reappears when the relation flips back to `none`.

- Tests added in `contacts.test.tsx`: a relation change (none → blocked and blocked → none)
  drops the confirm, the same relation keeps it, and a different person drops it.
- Finding 2 (blocked-screen avatar image) is a nit outside the Allowed files and in lines I did
  not change, so it is left as-is. No must-fix findings.
- Commands (real results):
  - `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot contacts-api contacts blocked-screen`
    → 6 files, 98 passed.
  - `pnpm gate` → GATE PASS (`PASS install (frozen)`, `PASS format`, `PASS lint`,
    `PASS typecheck`, `PASS tests @zilar/mobile`; 18 changed files, every one inside the Allowed
    files). The first gate run failed format on my changed test file; I ran
    `pnpm exec prettier --write` on exactly that file and reran.

## Review (written by Claude)

**Verdict:** Approved after 1 auto round. This was the first task on `deepseek/deepseek-flash` (Julio's trial).
- Round 1 pre-review: 0 must-fix, 1 should-fix: the block confirm reopened after a block and then an unblock. It was fixed by resetting the confirm on a person or relation change (`shouldResetBlockConfirm`).
- The second pre-review is clean.
- It fixed the live `'blocked'` lookup bug and handles a null handle and jid.
- It found and fixed the missing 409 `blocked` sentence in `add-contact.ts`, and wired the add-contact sheet too.

| | First pass | Fix round | Total |
| --- | --- | --- | --- |
| Time | 7.5 min | 1.7 min | 9.2 min |
| Steps | 75 | 22 | 97 |
| Speed | 148 tok/s | | |
| Cost (off-peak) | $0.076 | $0.017 | $0.093 |

Same review count as the Muse web twin T-0235 (1 should-fix in round 1).

Not yet seen on a device. Follow-ups:
- the "Blocked people" row in the settings hub;
- hiding blocked people's messages on mobile;
- Avatar has no image prop, so the screen shows initials (shared with requests).
