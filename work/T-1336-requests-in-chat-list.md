---
id: T-1336
title: "Contact requests in the chat list on mobile and web: each incoming request is a row at the top of the list (avatar, name, @handle, 'wants to add you') with inline Accept and Decline; accepting opens the new chat; more than 3 collapse into 'See all N requests'"
status: merged
milestone: M5
branch: task/T-1336-requests-in-chat-list
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1336: Requests in the chat list

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: "the accept and contact request need a rework, needs to show in the list of chats or something because it is quite hidden." He had to dig to accept @claude_test.
- **Mobile:** requests are reachable only from the search results (`apps/mobile/src/app/(tabs)/index.tsx:143-147` → `onOpenRequests`, used by `apps/mobile/src/components/chat/chat-search-results.tsx:38-161`) and from Settings → Contact requests (`apps/mobile/src/app/settings/requests.tsx`, 277 lines).
- **Web:** one small row, "Contact requests (N)", at the top of the list (`apps/web/src/components/chatList/ContactRequestsRow.tsx`, using `useContactRequestCount`) that links to `/settings/requests` (`apps/web/src/routes/RequestsPage.tsx`, 192 lines).
- The API: `acceptContactRequest(id)` / `declineContactRequest(id)` (`apps/mobile/src/lib/contacts-api.ts:79-80`; web has the same calls, used by `RequestsPage.tsx`; contract in `packages/api-contract/src/contact-requests.ts`).

### What to build, on both platforms
1. **Request rows at the top of the chat list:** in All chats and Personal, not in the AIs folder, and above pinned chats. One row per **incoming** pending request, styled like a chat row:
   - `EntityAvatar` (T-1334), the name, and a subtitle "@handle wants to add you";
   - on the right, two compact buttons: **Accept** (accent) and a **Decline** icon (X, with an accessible label).
   - Tapping the row body opens the person's profile (`/u/<handle>` mobile, the existing web profile or add-contact route; cite it).
2. **Accept:**
   - calls the existing accept, removes the row, refreshes the chat list and contacts;
   - shows a toast "<name> added", and opens the DM, or puts it at the top of the list if opening isn't possible (say which);
   - on error, keeps the row and shows the error inline.
3. **Decline:** asks no question; it removes the row and shows a toast "Declined" with **Undo** for 5 s. Only call decline after the undo window, or call it straight away if undo isn't possible with the API; say which.
4. **More than 3 pending:** show 3 rows plus "See all N requests", which opens the existing requests page.
5. **Freshness:** the list refreshes requests on focus/app-foreground and on the existing poll (`useContactRequestCount`, or the mobile equivalent; cite it). A new request appears without a restart.
6. **Web:** the new rows replace the old single `ContactRequestsRow`.
7. **Sizes:** every file at 400 lines or fewer; put the rows in new files (`apps/mobile/src/components/chat/request-rows.tsx`, `apps/web/src/components/chatList/RequestRows.tsx`). **No UI tests.** If you add or change accept/decline client logic (permissions), you may add one small test next to it.

### Read first
`AGENTS.md`, the files above, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/lib/useContactRequestCount.ts`.

### Allowed files
`apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/components/chat/request-rows.tsx`, `apps/mobile/src/components/chat/chat-list*.tsx`, `apps/mobile/src/components/chat/chat-search-results.tsx`, `apps/mobile/src/lib/contacts-api.ts`, `apps/mobile/src/lib/use-contact-requests.ts`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/chatList/ContactRequestsRow.tsx`, `apps/web/src/components/chatList/RequestRows.tsx`, `apps/web/src/lib/useContactRequestCount.ts`, `apps/web/src/lib/useContactRequests.ts`, `packages/mock-backend/src/domains/contact-requests/seed.ts`, `work/T-1336-requests-in-chat-list.md`. (Lead, 2026-10-13: the seed file was added after the worker's question.)

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check** on the web mock and the Android mock build (the mock has requests; cite where they are seeded or add one to the mock if none):
  - rows appear at the top;
  - Accept opens or adds the chat;
  - Decline removes the row with Undo.

---

## Report (written by the worker when done)

### What I did

Contact requests now show as chat-style rows at the top of the chat list on both
platforms (All chats and Personal, never the AIs folder), replacing the old
single "Contact requests (N)" link.

**Mobile**
- `apps/mobile/src/lib/use-contact-requests.ts` (new): loads the incoming list,
  then refetches every 60 s and on app-foreground (`AppState`, the same seam as
  `use-client-version.ts`). Runs through `useAction`/`Effect`.
- `apps/mobile/src/components/chat/request-rows.tsx` (new): `ContactRequestRows`
  renders up to 3 incoming rows (`EntityAvatar`, name, "@handle wants to add
  you"), an accent **Accept** button and a **Decline** X `IconButton` (labelled).
  Tapping the row body opens the profile (`/u/[handle]`,
  `apps/mobile/src/app/u/[handle].tsx`). More than 3 adds "See all N requests" →
  `/settings/requests`. Accept calls the existing accept, hides the row, toasts
  "<name> added" (through the screen `Toast`), calls `reloadChats()` and opens
  the DM by resolving the contact JID from `api.listContacts()` →
  `/chat/[id]`. Decline hides the row and starts a 5 s Undo window; the decline
  only reaches the server when the timer fires (or immediately on unmount).
  Errors keep the row and show a fixed sentence inline.
- `apps/mobile/src/components/chat/chat-list-page.tsx` /
  `chat-list.tsx`: the rows render as the `FlatList` header, gated by the folder
  (`folder === undefined || folder.includeTypes.includes('dm')`), so not in AIs.
- `apps/mobile/src/app/(tabs)/index.tsx`: owns the screen `Toast` state and
  passes `onRequestsToast` down.

**Web**
- `apps/web/src/lib/useContactRequests.ts` (new): the list-twin of
  `useContactRequestCount` (focus refresh + 60 s poll), exposing `reload`.
- `apps/web/src/components/chatList/RequestRows.tsx` (new): `RequestRows` does
  the same rows/accept/decline/“See all” as mobile, using `EntityAvatar`,
  `Button`, `useToast` and `Link` to `/u/:handle` (web profile route,
  `AppRoutes.tsx:264`). Accept calls `refreshChats()` and opens
  `/c/:jid` resolved from `getContacts()`. DMs open the same way
  `NewMessageDialog` does (`NewMessageDialog.tsx`).
- `apps/web/src/components/chatList/ContactRequestsRow.tsx`: now a one-line
  re-export of `RequestRows` (see deviation 1).

**Mock**
- `packages/mock-backend/src/domains/contact-requests/seed.ts` (added to the
  Allowed files by the lead): seeds **two** incoming pending requests to the mock
  user, from `u-handle-nora` (Nora) and `u-handle-theo` (Theo).

  I did **not** add people to `data/people.ts`: every person there counts as a
  contact (`packages/mock-backend/src/domains/contacts/routes.ts`, `contactsOf`),
  so a real seed person would read as a request from an existing contact. The
  senders are instead the mock's existing synthetic strangers,
  `u-handle-<name>`, resolved by `handleProfileForId`
  (`packages/mock-backend/src/domains/handles/check.ts:98`), which stay off the
  contacts list. The rows use the contract shape
  `MockContactRequest = ContactRequestRow`
  (`packages/mock-backend/src/domains/contact-requests/tables.ts:8`), i.e. the
  contract's `ContactRequestRow` (`packages/api-contract/src/contact-requests.ts:27`).
  Their ids are `cr-seed-1`/`cr-seed-2` so `nextContactRequestId` (which starts
  at `cr-1`) never clobbers them. I checked the mock answers
  `incoming: ['cr-seed-2:Theo@theo', 'cr-seed-1:Nora@nora']`.

  Note for the mock check: the mock only flips the request status on accept; it
  does not provision the DM (no chats seed for a stranger), so **Accept** removes
  the row and shows "<name> added" but the mock opens no chat. The real server
  provisions the DM for every contact (T-0182), which is what the row code
  relies on.

Behaviour notes: Accept refreshes the chat list and contacts and opens the DM
when its id is known, otherwise the refreshed list shows it at the top. Decline
cannot be undone through the API, so I used the deferred-call option the spec
allows: the row disappears at once and the decline is sent after the 5 s window
(Undo cancels it).

### Commands and results

- `pnpm install` → done (resolved 1273, added dependencies).
- Single tests: none run. There is no test next to the changed files and AGENTS
  says UI code gets no tests; the mobile `lib/` tests the gate picked passed.
- Seed check (a throwaway tsx script, run once and deleted):
  `createMockBackend().http('/api/contact-requests')` →
  `incoming: [ 'cr-seed-2:Theo@theo', 'cr-seed-1:Nora@nora' ]`.

`pnpm gate` (first run) → **GATE FAIL**
- `FAIL lint`: `apps/mobile/src/lib/use-contact-requests.ts:29` `react(refs):
  Cannot access refs during render` (a render-time `apiRef.current = api`).
- `scope`: 1 file outside the Allowed files:
  `apps/web/src/components/chatList/ChatListBody.tsx`.

`pnpm gate` (second run, before the seed) → **GATE PASS** (9 files).

`pnpm gate` (final, with the seed) → **GATE PASS**
```
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.6s)
PASS  typecheck  (1.9s)
PASS  effect  (0.6s)
PASS  tests @zilar/mobile  (1.7s)
SKIP tests @zilar/mock-backend (no nearby test files)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Deviations from the spec

1. **`ChatListBody.tsx` is outside the Allowed files**, but it is where the old
   `ContactRequestsRow` was rendered, so replacing it needed an edit there. To
   stay inside scope I left `ChatListBody.tsx` untouched and made
   `ContactRequestsRow.tsx` (allowed) re-export `RequestRows`; the existing
   import keeps working and now renders the new rows. If you prefer
   `ChatListBody` to import `RequestRows` directly, add it to the Allowed files
   and I will do that.
2. Folder gating uses `includeTypes.includes('dm')` rather than the literal id
   `default-personal`, so a renamed/custom DM folder still shows requests and
   the AIs folder never does.
3. Both new row components carry an `// effect-plain:` marker (they are
   presentational, the contacts api modules own the transport; the only local
   async is the undo timer), matching the `link-preview-card.tsx` precedent.

### Blocked / needs a decision

None. The lead approved the mock seed (the task file now lists
`packages/mock-backend/src/domains/contact-requests/seed.ts` under Allowed
files), it is committed with the work, and the gate is green.

### Round (fix round, 2026-10-13)

- **Finding 1 (should-fix) — fixed.** Web `RequestRows.tsx` and mobile
  `request-rows.tsx` now write the freshly fetched contacts into the store
  (`useChatStoreApi().setState({ contacts })`) right after accept succeeds, so
  the new contact reaches the pickers (`NewMessageDialog`, group add) and the
  mobile DM resolver without a restart. Committed as
  `T-1336: fix finding 1 - refresh the contacts store after accept`.
- **Finding 2 (should-fix) — not changed, see Disagreements.**
- Tests added: none. The fix is UI plumbing inside the row components; the
  spec says "No UI tests" and AGENTS.md says UI code gets no tests, and neither
  finding names a test. Mobile has no component-test renderer dependency, so a
  render test is only possible on web.
- `pnpm gate` → **GATE PASS** (summary above: install, format, lint, typecheck,
  effect, tests @zilar/mobile all PASS; web/mock-backend skipped "no nearby test
  files"; scope clean). No single test files apply: no test sits next to either
  changed file.

### Disagreements

- **Finding 2 ("Web accept shows raw server error text") does not hold for the
  file it names.** `apps/web/src/components/chatList/RequestRows.tsx` has no
  `friendlyError`; its accept and decline failures already use the fixed
  sentences `ACCEPT_FAILED` ("Could not accept that request. Try again.") and
  `DECLINE_FAILED` ("Could not decline that request. Try again."), and the
  post-accept `getContacts()` failure is swallowed. I checked
  `git show 40b902bd7:apps/web/src/components/chatList/RequestRows.tsx | grep -n
  "friendlyError\|error.message"` (no match) and `grep -n "message\|friendlyError"
  apps/web/src/components/chatList/RequestRows.tsx` (no match); the file is
  unchanged since it was added. The `friendlyError(...) => error.message` the
  finding quotes is in `apps/web/src/routes/RequestsPage.tsx:184-191`, which the
  finding itself says is outside scope. Nothing in scope shows raw server text,
  so I left the code as it is, per the brief.

### Round (fix round 2, 2026-10-13)

- **Finding 1 (should-fix) — fixed.** Mobile accept no longer renders the
  failure string from `performRequestAction` (which can be raw server text for a
  generic `ContactsApiError`). `request-rows.tsx` now maps every accept failure
  to the fixed sentence `ACCEPT_FAILED` ("Could not accept that request. Try
  again."), the same string web already uses.
- **Finding 2 (should-fix) — fixed.** Both `decline()` implementations committed
  only the latest decline: a second decline inside the 5 s window cleared the
  first timer and overwrote the pending slot, so the first call was never sent
  and its row stayed hidden while the server still held the request. Now a new
  decline flushes any earlier pending decline at once (`commitDecline(previous)`)
  before installing the new undo window, so no decline is dropped. Undo still
  covers the most recent decline; the earlier one is already committed.
- **Finding 3 (nit) — not changed.** It sits in the `busyId`/`finally` lines,
  which this round does not touch, so per the brief it is left alone.
- Tests: none added. Both fixes live in the row components (React state and
  timers); the spec says "No UI tests", AGENTS.md says UI code gets no tests, and
  neither finding names a test. Extracting a pure helper for finding 2 would be a
  larger refactor with no named coverage, so it was not done.
- `pnpm gate` → **GATE PASS**
  ```
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.5s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (1.5s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 2 auto rounds (2 follow-ups); the packet is current for `6b5d7622`.**
- **Lead's checks:**
  - web mock (headless): Theo and Nora rows at the top with Accept and ✕; Accept removes the row; Decline removes it and shows Undo;
  - Android mock build: the same rows at the top of All chats; Decline shows "Declined · Undo".
- **Mock limit:** the mock doesn't provision a DM on accept, so "accept opens the chat" can't show there. The real server provisions it (T-0182), and Julio checks it on his phone.
