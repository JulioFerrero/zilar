---
id: T-0192
title: Web: typing @handle in the search bar shows the person (replaces Add contact in the new-chat menu)
status: review
milestone: M5
branch: task/T-0192-web-search-people-by-handle
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0192: Web: typing @handle in the search bar shows the person (replaces Add contact in the new-chat menu)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-04: searching for a person must happen in the normal search bar: "if I search for @julio in the search bar it needs to show the user, in web and in mobile", instead of a separate Add contact entry. Web and mobile get the same behaviour (T-0192 web, T-0193 mobile).

### Behaviour (identical on web and mobile)
When the trimmed search text starts with `@` and what follows (after dropping the `@`, lowercased) is a valid handle (use the exact same validation the add-contact flow already uses; do not write a second rule), a **People** section appears ABOVE the chat-name and message results with ONE row for that person: avatar, name, `@handle`, and the action for the relation returned by `lookupByHandle`: `contact` -> Message (opens the chat), `none` -> Add contact (sends the request and the row changes to Request sent), `request_sent` -> Request sent (with Cancel), `request_received` -> Accept and Decline, `self` -> no action (just 'You'). An unknown handle (404) shows a muted line 'No one with that username.' and the normal results continue below. The lookup is exact only (the server has no partial search) and is rate limited to 30 per 10 minutes per user, so: wait 900 ms after the last keystroke before looking up (never per keystroke), look up at once on Enter, never look up twice for the same handle in a row (cache the last result until the text changes), and on 429 show 'Too many searches, try again in a few minutes.' once, without retrying. A text that does not start with `@` never calls the lookup. Message search keeps working as today (a message containing '@julio' still matches). The actions use the existing contacts client functions and behave exactly like the add-contact flow (including refreshing the row after the action).

### Verified facts (do not re-derive)
- Search box: `apps/web/src/components/SearchBar.tsx` writes `store.search`; results render in `apps/web/src/components/ChatList.tsx` (chat-name matches, then `MessageSearchResults` when the text has 2+ characters, around lines 455-470).
- The add-contact flow to reuse (do not duplicate): `apps/web/src/components/AddContactDialog.tsx` (lookup with `lookupByHandle`, one view per relation, `sendContactRequest`), the client functions in `apps/web/src/lib/api.ts` (`lookupByHandle` ~1989, `sendContactRequest` ~2041, `acceptContactRequest`, `declineContactRequest`, `cancelContactRequest` ~2058-2070). `/u/:handle` (`AddContactRoute.tsx`) keeps using the dialog and stays.
- The new-chat menu entry: `apps/web/src/components/NewChatButton.tsx` (`onAddContact`, around line 214) and its use in `ChatList.tsx` (`addContactOpen`).
- No server change (the exact-handle lookup and its limits already exist); no new dependency; no emoji in UI (lucide icons); never log the typed text or tokens; error text shown to the user is a fixed sentence, never the server's raw message.

### What to build
1. Extract the per-relation profile row/actions of `AddContactDialog` into a small shared component (for example `ContactProfileRow.tsx`) used by BOTH the dialog and the new People section, so there is one implementation.
2. `apps/web/src/components/PeopleSearchResult.tsx` + a hook `usePeopleSearch(query)` that implements the behaviour above (debounce, Enter, cache, 429 notice). Render it in `ChatList.tsx` above the other results when the search text starts with `@`. Enter in the search box (the existing `zilar:search-enter` event) triggers the lookup at once.
3. Remove the 'Add contact' entry from the new-chat menu (`NewChatButton.tsx`, and the `onAddContact` wiring in `ChatList.tsx`). The dialog component stays because `/u/:handle` uses it. Update the empty-state or menu copy if it mentions Add contact; add the placeholder hint 'Search, or type @username' to the search box.
4. Tests (Vitest, Testing Library, fake timers): `@julio` shows the row only after 900 ms of no typing; Enter looks up at once; the same handle twice calls the API once; each relation shows the right action; 404 shows the muted line; 429 shows the notice once and does not retry; text without `@` never calls `lookupByHandle`; the new-chat menu no longer has Add contact.

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, the files named above.

### Allowed files
`apps/web/src/components/SearchBar.tsx`, `ChatList.tsx`, `NewChatButton.tsx`, `AddContactDialog.tsx`, the new `ContactProfileRow.tsx`, `PeopleSearchResult.tsx`, `usePeopleSearch.ts` and the tests of these files.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/web test --maxWorkers=2 ChatList SearchBar NewChatButton AddContact PeopleSearch ContactProfileRow
```
Say in the Report that the lead tests on the emulator or in the browser.

### Acceptance
- Typing `@julio` in the search shows the person with the right action; Enter looks up at once; no lookup per keystroke; a bad handle shows one plain line.
- The new-chat menu no longer has Add contact; `/u/<handle>` still works.
- Existing search (chat names, messages) behaves as before.

### Out of scope
Partial or fuzzy people search (the server has none), searching by name or email, blocking.

---

## Report (written by the worker when done)
- What: `@handle` in the web search bar now shows a People section above chat/message results with one shared profile row (avatar, name, @handle, per-relation action). Removed Add contact from the main menu, the new-chat menu, the New message dialog, and the empty state; placeholder is now "Search, or type @username". `/u/:handle` and `/@handle` still use the dialog.
- New files: `apps/web/src/components/ContactProfileRow.tsx` (shared row; contact -> Message to `/c/<userId>`, none -> Add contact -> Request sent, request_sent -> Cancel, request_received -> Accept/Decline, self -> "That's you."; errors are fixed sentences, nothing raw; row keyed by userId so a new handle remounts), `apps/web/src/components/PeopleSearchResult.tsx`, `apps/web/src/lib/usePeopleSearch.ts` (900 ms debounce, Enter via `zilar:search-enter`, last-handle cache, 429 -> "Too many searches, try again in a few minutes." once with no retry, 404 -> "No one with that username.", invalid shape / non-@ text never calls the API, reuses `isValidHandleShape`), `apps/web/src/components/PeopleSearchResult.test.tsx` (10 tests).
- Changed: `AddContactDialog.tsx` (uses the shared row + "Go to Requests" link for request_received; lookup text unchanged), `ChatList.tsx` (People section render, removed Add contact wiring), `NewChatButton.tsx` (removed menu entry, dialog, onAddContact prop; New message dialog now points at the search bar), `SearchBar.tsx` (placeholder), `AddContactDialog.test.tsx` (updated to new button/link copy).
- Deviation: Message action navigates to `/c/<userId>` (DM by contact id) since chats carry no per-contact user id; lead to confirm this matches the DM route. Accept/Decline/Cancel resolve the request id via `listContactRequests` matching `other.userId` (the lookup returns no request id).
- Security checklist: no typed text or tokens logged; fixed user-facing error sentences only; no deletes/updates outside existing contact-request endpoints (scoped by request id server-side); 429 respected with no retry; no new routes, so no 401 sweep gap; no audit entries with message text.
- Checks: `pnpm format:check` pass; `pnpm lint` pass; `pnpm typecheck` pass (11 tasks ok); `pnpm --filter @zilar/web test --maxWorkers=2 ChatList SearchBar NewChatButton AddContact PeopleSearch ContactProfileRow` -> 6 files, 62 tests, all pass. The lead tests on the emulator or in the browser.
- Open: none; `/u/<handle>` and `/@handle` covered by existing HandleGate/GroupHandleRoute tests (untouched files, not re-run here).

## Round 1 (pre-review fixes)
- Fixed finding 1 (must-fix): Message now resolves the DM via `store.contacts` (userId -> jid) and opens `/c/<encoded chatJid>`; no DM yet shows only the "You're already contacts." line (verified: `apps/server/src/chats/routes.ts:82` sets `chatJid: contact.jid`, `ChatShell` matches `store.chats` by id). Tests: Message click navigates to the DM route (Routes stub asserts "chat open"); no-DM case asserts no Message button.
- Fixed finding 2: People section moved above the empty-state/chat-name groups (verified it renders even when the filter empties the list, since the old position inside the non-empty branch hid it).
- Fixed findings 3,4,5,6,10 with one rewrite of `usePeopleSearch.ts`: request id drops stale responses; cache set on success/404/429 (Enter never refires the same handle); generic error clears the cache so Enter retries; a different handle after a 429 is always attempted; no setState inside a setState updater; invalid shapes render the muted "No one with that username." line without calling the API. Tests added: different-handle-after-429, retry-after-error, stale-lookup guard, invalid-shape muted line.
- Fixed nits 7,8,9 on touched lines: deleted unused `friendlyContactError` export; removed dead `onAddContact` prop/button from `EmptyState.tsx` (not in Allowed files but the finding required it; ChatList/ChatShell callers updated); error renders below the row (column layout).
- Also fixed: `AddContactDialog.test.tsx` uses `importOriginal` mock + store-backed Message test; removed unused `Link` import flagged by lint.
- Disagreements: none.
- Gate: `pnpm gate` does not exist in this worktree (no `gate` script in root package.json, no `gate` binary on PATH); ran the equivalent instead — `prettier --check` on all touched files: pass; `pnpm lint`: pass; `pnpm typecheck` (11 tasks): pass; `pnpm --filter @zilar/web test --maxWorkers=2 ChatList SearchBar NewChatButton AddContact PeopleSearch ContactProfileRow`: 6 files, 68 tests, all pass. (`pnpm format:check` repo-wide flags only the lead-owned untracked PREREVIEW.md, which I must not touch.) The lead tests on the emulator or in the browser.

## Review (written by Claude)
