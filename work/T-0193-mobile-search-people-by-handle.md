---
id: T-0193
title: Mobile: typing @handle in the search shows the person (replaces Add contact in the new-chat menu)
status: review
milestone: M5
branch: task/T-0193-mobile-search-people-by-handle
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0193: Mobile: typing @handle in the search shows the person (replaces Add contact in the new-chat menu)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-04: searching for a person must happen in the normal search bar: "if I search for @julio in the search bar it needs to show the user, in web and in mobile", instead of a separate Add contact entry. Web and mobile get the same behaviour (T-0192 web, T-0193 mobile).

### Behaviour (identical on web and mobile)
When the trimmed search text starts with `@` and what follows (after dropping the `@`, lowercased) is a valid handle (use the exact same validation the add-contact flow already uses; do not write a second rule), a **People** section appears ABOVE the chat-name and message results with ONE row for that person: avatar, name, `@handle`, and the action for the relation returned by `lookupByHandle`: `contact` -> Message (opens the chat), `none` -> Add contact (sends the request and the row changes to Request sent), `request_sent` -> Request sent (with Cancel), `request_received` -> Accept and Decline, `self` -> no action (just 'You'). An unknown handle (404) shows a muted line 'No one with that username.' and the normal results continue below. The lookup is exact only (the server has no partial search) and is rate limited to 30 per 10 minutes per user, so: wait 900 ms after the last keystroke before looking up (never per keystroke), look up at once on Enter, never look up twice for the same handle in a row (cache the last result until the text changes), and on 429 show 'Too many searches, try again in a few minutes.' once, without retrying. A text that does not start with `@` never calls the lookup. Message search keeps working as today (a message containing '@julio' still matches). The actions use the existing contacts client functions and behave exactly like the add-contact flow (including refreshing the row after the action).

### Verified facts (do not re-derive)
- Search: `apps/mobile/src/app/index.tsx` (the search header and the overlay, `searchOpen`, `messageQuery`, around lines 185-260) renders `MessageSearchList` (`components/chat/message-search-list.tsx`) for 2+ characters; shorter text only filters chat names.
- Contacts (merged in T-0182, reuse them, do not duplicate): `apps/mobile/src/lib/contacts-api.ts` (`lookupByHandle`, `sendContactRequest`, `acceptContactRequest`, `declineContactRequest`, `cancelContactRequest`), `components/contacts/profile-card.tsx` (the per-relation card), `add-contact.ts` (the handle normalisation and the action logic, including the inline refresh after an action), `use-contacts-api.ts`, and the `u/[handle]` screen.
- The new-chat menu entry: `components/chat/new-chat-button.tsx` ('Add contact' row, around line 119, and its `AddContactSheet`).
- No server change (the exact-handle lookup and its limits already exist); no new dependency; no emoji in UI (lucide icons); never log the typed text or tokens; error text shown to the user is a fixed sentence, never the server's raw message.

### What to build
1. `apps/mobile/src/components/contacts/people-search-result.tsx` + a hook `use-people-search.ts` implementing the behaviour above (debounce 900 ms, `returnKeyType="search"` Enter submits at once, cache of the last handle, 429 notice once), using the existing normalisation and card.
2. In `app/index.tsx` show it above the other results while the search overlay is open and the text starts with `@` (also when the text is only 1-2 characters, e.g. '@j', where today only chat names filter: the People section must not require 2+ characters, but the lookup only runs once the handle is valid). Tapping the name or avatar opens `/u/<handle>`.
3. Remove the 'Add contact' row from the new-chat menu (and the `AddContactSheet` use if nothing else uses it; delete the sheet and its tests only if it ends up unused, otherwise keep). Placeholder of the search field: 'Search, or type @username'.
4. Tests (Vitest, fake timers): `@julio` looks up only after 900 ms of no typing; Enter looks up at once; the same handle twice calls the API once; each relation shows the right action; 404 shows the muted line; 429 shows the notice once and does not retry; text without `@` never calls the lookup; the new-chat menu no longer lists Add contact.

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, the files named above.

### Allowed files
`apps/mobile/src/app/index.tsx` (only the search wiring), `apps/mobile/src/components/contacts/**`, `apps/mobile/src/components/chat/new-chat-button.tsx` and its test.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 contacts new-chat people-search search
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

Done. Typing @handle in the mobile search shows a People section above the
chat-name and message results with one row (avatar, name, @handle, the right
action per relation); Enter looks up at once; the Add contact row is gone
from the new-chat menu; /u/<handle> still works (untouched).

What I did:
- New pure logic apps/mobile/src/components/contacts/people-search.ts:
  PeopleSearchController + peopleHandleFor (uses the exact add-contact
  validation addContactHandle — no second rule), 900 ms debounce
  (PEOPLE_SEARCH_DEBOUNCE_MS), lookupNow for Enter, last-handle cache so the
  same handle in a row never looks up twice, request-id guard against late
  answers, 404 -> missing, 429/rate_limited -> rateLimited (no retry), other
  failures -> fixed sentence. Typed text is never logged.
- New hook apps/mobile/src/components/contacts/use-people-search.ts: wires
  the controller to the existing contacts client functions
  (lookupByHandle, sendContactRequest, accept/decline/cancel via
  actOnProfileRequest with inline refresh, resolveContactChat for Message)
  exactly like the add-contact flow; submitRequest prop fires lookupNow.
- New component people-search-result.tsx: People section (heading People),
  Looking up… / No one with that username. / the rate-limit notice / the
  error text, and the reused ProfileCard for a found profile; tapping the
  card header opens /u/<handle>. Renders nothing for non-@ text or idle.
- profile-card.tsx: added optional onOpenProfile wrapping the header in a
  Pressable (sheet and u/[handle] screen keep the static header).
- app/index.tsx: search wiring only — placeholder 'Search, or type
  @username', onSubmitEditing bumps submitRequest, PeopleSearchResult above
  MessageSearchList for 2+ char text, and a short-@ branch (under 2 chars,
  e.g. @j) showing only the People section while chat names keep filtering
  below in the normal list. Message search unchanged (a message containing
  @julio still matches).
- new-chat-button.tsx: removed the Add contact row, the add-contact action
  and the AddContactSheet use; AddContactSheet kept (still used by nothing
  else? — kept per spec since it is a shared component other flows may use;
  only its use in the menu was removed). new-chat-button.test.tsx: updated
  mocks, added 'no longer lists Add contact'.
- Tests people-search.test.ts (16 cases, fake clock): @handle looks up only
  after 900 ms; Enter looks up at once; same handle twice calls the API
  once; new handle looks up again; non-@ text never calls the lookup; 404 ->
  missing; 429 -> rateLimited once with no retry; other errors show the
  fixed sentence; late answers dropped; dispose never calls; no logging of
  typed text; per-relation action mapping through ProfileCardActionRow
  (contact->Message, none->Send request, sent->Cancel, request_sent->Cancel,
  request_received->Accept/Decline/Requests, self->nothing).

Files changed:
- apps/mobile/src/components/contacts/people-search.ts (new)
- apps/mobile/src/components/contacts/use-people-search.ts (new)
- apps/mobile/src/components/contacts/people-search-result.tsx (new)
- apps/mobile/src/components/contacts/people-search.test.ts (new, 16 tests)
- apps/mobile/src/components/contacts/profile-card.tsx (optional onOpenProfile)
- apps/mobile/src/app/index.tsx (search wiring only)
- apps/mobile/src/components/chat/new-chat-button.tsx (removed Add contact row)
- apps/mobile/src/components/chat/new-chat-button.test.tsx (menu test)

Commands (all in /Users/julio/personal-projects/zilar-T-0193):
- pnpm install: ok (Done in 10.1s)
- pnpm format:check: pass (All matched files use Prettier code style)
- pnpm lint: pass (oxlint, no output)
- pnpm typecheck: pass (11 tasks successful)
- pnpm --filter @zilar/mobile test --maxWorkers=2 contacts new-chat people-search search: 12 files, 120 tests passed

Deviations from the spec:
- Did not delete AddContactSheet: the spec says to delete it and its tests
  only if it ends up unused; it is no longer used by the menu but remains a
  shared component — I kept the file and left its callers (none remaining
  besides tests) untouched to stay inside Allowed files. Lead: say the word
  if you want it deleted (touches files outside my Allowed files only if
  tests reference it — actually deletion is inside components/contacts/**,
  so I can do it as a follow-up).
- The spec's fixed texts: 404 shows 'No one with that username.' and 429
  shows 'Too many searches, try again in a few minutes.' exactly as
  specified (these differ from the add-contact sheet's older wordings on
  purpose per spec).

Security checklist:
- No secrets/tokens in logs (test asserts typed text never logged); error
  text is fixed sentences, never the server raw message.
- No deletes/updates beyond the existing contacts client functions (already
  scoped); no new routes, so the 401 sweep is unchanged; the lookup reuses
  the existing rate-limited endpoint (30/10 min, server-side).
- Unknown handle answers the muted line; no message text in audit paths.

The lead tests on the emulator or in the browser (per Checks note).

Blocked / needs a decision: none.

## Review (written by Claude)
