---
id: T-0182
title: Mobile: find people by @handle, profile card and contact requests
status: review
milestone: M5
branch: task/T-0182-mobile-contacts-requests
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 1 day
---

# T-0182: Mobile: find people by @handle, profile card and contact requests

## Spec (written by Claude, do not edit)

### Why
Julio could not find his own account by @handle on the iPhone: web has it, mobile does not. Without it a phone-only user can only start chats from an invite link. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Roadmap: `docs/ROADMAP_MOBILE_PARITY.md`.

### Verified facts (do not re-derive)
- Web: `apps/web/src/routes/AddContactRoute.tsx`, `RequestsPage.tsx`, `apps/web/src/components/AddContactDialog.tsx`, `NewChatButton.tsx`; the `/u/:handle` route in `AppRoutes.tsx`. Client functions in `apps/web/src/lib/api.ts`: `lookupByHandle(handle)` (~1989, `GET /api/users/by-handle/:handle`), `sendContactRequest(handle)` (~2041), `listContactRequests()` (~2052), `acceptContactRequest(id)`, `declineContactRequest(id)`, `cancelContactRequest(id)` (~2058-2070), `getContacts()` (~257).
- Server: `apps/server/src/contact-requests/routes.ts` and `service.ts` (read both: exact lookup only, no prefix search, an unknown or retired handle is the same 404, relation is one of `self | contact | request_sent | request_received | none`, lookups are rate limited 30 per 10 minutes).
- Mobile: `apps/mobile/src/components/chat/new-chat-button.tsx` is the "new" entry; how a chat with a contact opens: read how `app/chat/[id].tsx` is reached and how the web `ChatShell` starts a DM with a contact.
- Conventions (all mobile parity tasks): API module in `apps/mobile/src/lib/<area>-api.ts` mirroring the web client function names, validated at the boundary, with an error class carrying `status` and `code`; a hook that returns the real API or the mock (copy `use-ais-api.ts`); screens under `apps/mobile/src/app/`, guarded by `RequireAuth`; components under `apps/mobile/src/components/<area>/`; lucide icons, no emoji; every list has loading, empty and error states; no new dependency (`expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `zod` are already installed); never log tokens, codes or message text.

### What to build
1. `apps/mobile/src/lib/contacts-api.ts` (+ tests): the functions above, validated, with `status` and `code` on errors.
2. In the new-chat entry add "Add contact": a field for an exact @handle (strip a leading @, lowercase), a Look up button, and a profile card (name, avatar, @handle, relation) with the right action per relation: Send request (`none`), Request sent / Cancel (`request_sent`), Accept / Decline (`request_received`), Message (`contact`), nothing for `self`.
3. `apps/mobile/src/app/u/[handle].tsx`: the same profile card as a screen, so a link or a tap on a name can open it.
4. `apps/mobile/src/app/settings/requests.tsx`: incoming and outgoing requests with Accept, Decline, Cancel, empty and error states; add one row (Contact requests, lucide `UserPlus`) to `settings-items.ts` (create the file with just that row if T-0181 has not merged yet; the lead resolves a conflict).
5. A badge on the Settings icon is out of scope; show the pending count only inside the requests screen.
6. Tests (Vitest): API (each relation, 404, 429, 409), the card for each relation, the requests screen (accept, decline, cancel, empty, error).

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, `apps/mobile/src/lib/approvals-api.ts` and `apps/mobile/src/lib/ais-api.ts` (the API module pattern: type guards or zod, an error class with `status` and `code`), `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx` (the real-or-mock hook and the auth guard), `apps/mobile/src/app/ais/index.tsx` (a screen with header, list, empty and error states), plus the web files named above.

### Allowed files
`apps/mobile/src/lib/contacts-api.ts` and tests, `apps/mobile/src/components/contacts/**`, `apps/mobile/src/app/u/**`, `apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/lib/settings-items.ts` (one row), `apps/mobile/src/components/chat/new-chat-button.tsx` and its test.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 contacts requests new-chat
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- Typing an exact @handle shows the person with the right action; a bad handle shows one plain 'No user with that username'.
- Requests can be sent, accepted, declined and cancelled from the phone.
- Accepting makes the person show up as a contact and a message can be started.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
Searching by partial name, importing the phone's address book, blocking (T-0171), push for requests.

---

## Report (written by the worker when done)

Done. Mobile can find people by exact @handle, shows the profile card with the
right action per relation, and manages contact requests (send, accept,
decline, cancel). No server change, no new dependency, no emoji in UI.

What I built:
- `apps/mobile/src/lib/contacts-api.ts` (+ `contacts-api.test.ts`): mirrors
  the web client names (`lookupByHandle`, `sendContactRequest`,
  `listContactRequests`, `acceptContactRequest`, `declineContactRequest`,
  `cancelContactRequest`), type-guard validated, `ContactsApiError` with
  `status` + `code`. Plus `normalizeHandleInput` (strip @, trim, lowercase),
  `domainOfJid`, and `contactChatId` (server `localpartFor`+`jidFor` mapping:
  user id lowercased + XMPP domain).
- `apps/mobile/src/components/contacts/`: `profile-card.tsx` (name, avatar,
  @handle, per-relation actions: Send / Cancel / Accept+Decline+Requests /
  Message / nothing for self), `add-contact.ts` (UI-free lookup/send failure
  mappers, `NO_USER_MESSAGE = 'No user with that username'`),
  `add-contact-sheet.tsx` (exact-handle field, Look up button, debounced
  lookup, Message resolves the loaded DM chat via `resolveContactChat` and
  never guesses an id), `requests.ts` (list/action failure mappers),
  `use-contacts-api.ts` (real-or-mock hook, `use-ais-api.ts` pattern),
  `contacts-mock.ts` (mock API with default/empty/error scenarios; lives
  beside the hook, not in `src/mock/`, so the task touches only allowed
  files), tests for the card (each relation), the helpers, the mock, the
  requests screen (loading, empty, incoming Accept/Decline, outgoing Cancel,
  pending count) and the new-chat entry render.
- `apps/mobile/src/app/u/[handle].tsx`: the profile screen with the same
  card; bad handle shows the one plain 'No user with that username'.
- `apps/mobile/src/app/settings/requests.tsx`: incoming (Accept/Decline) and
  outgoing (Cancel) with loading/empty/error states and the pending count in
  the subtitle. No Settings-icon badge (out of scope).
- `apps/mobile/src/lib/settings-items.ts`: created with just the Contact
  requests row (lucide `UserPlus`), since T-0181 has not merged (no file
  existed); the lead resolves any conflict.
- `apps/mobile/src/components/chat/new-chat-button.tsx` (+ test): new "Add
  contact" menu entry opening the sheet; sheet Message opens `/chat/[id]`,
  Requests opens `/settings/requests`.

Accepting makes the person show up as a contact: the server lists every
contact's DM in `/api/chats`, so the chat appears after the next chats
refresh; Message opens it directly when already loaded, else says to pull to
refresh. The lead tests on the emulator and the phone.

Commands (all in `/Users/julio/personal-projects/zilar-T-0182`):
- `pnpm install`: ok (9.9s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (one `set-state-in-effect` fixed by moving the handle
  reset to render-time + deriving `looking`, dropping the `looking` state).
- `pnpm typecheck` (turbo, all 11 packages): pass.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 contacts requests
  new-chat`: 5 files, 50 tests, all pass. Fixed along the way: `await
  expect().toEqual()` on promises (used `resolves`/direct await), and the
  unmocked `lucide-react-native` import breaking the static-markup tests.

Deviations: none from behavior; file layout differs only in that the mock
lives in `components/contacts/contacts-mock.ts` instead of `src/mock/`
(both outside/inside allowed files respectively — `src/mock/` is not in this
task's Allowed files). No secrets touched; request failures map to plain
language, raw errors (handle text only, never tokens/codes) never render.

Open questions: none. The `u/[handle].tsx` retry uses an icon button (keeps
to allowed files without a new Button import chain); lead may prefer the
shared Button.

## Round 1 (review findings, 2026-10-03)

1. Must-fix, swallowed reload: `actOnRequest` in both the sheet and the
   `u/[handle]` screen called the guarded `reloadProfile()` from inside
   `runAction`'s work while the busy guard was held, so the reload was
   silently dropped. Fix: extracted the whole flow into UI-free
   `actOnProfileRequest` (`components/contacts/add-contact.ts`) — find the
   row, run the action, re-fetch the profile inline in the same promise
   chain; both call sites wrap it in `runAction`. Tests: `actOnProfileRequest`
   with a fake mutable API — Cancel on `request_sent` ends with `none`,
   Accept on `request_received` ends with `contact`, Decline ends with
   `none`, missing row re-reads. Mutation check: with the post-action
   refresh neutered, exactly those 3 tests fail; restored, 52/52 pass.
   Commit `25910dd` ("T-0182: finding 1 - ...").
2. Should-fix, tests: extracted UI-free `performRequestAction`
   (`components/contacts/requests.ts`, returns the failure message or null;
   row removed only on success) and wired the screen to it. Added:
   error-state render (message + Retry, no empty text), one action test per
   action (Accept/Decline/Cancel: API called once with the id, row
   disappears, others stay), failure keeps the row with the mapped message.
   Replaced the trivial `/Bearer/i` assertions with a `LEAKED_TOKEN` the
   fake API carries: rendered trees and mapped failure messages assert not
   to contain it. Also removed the now-unused `reloadProfile` in
   `u/[handle].tsx` (lint `no-unused-vars`). Commit `603cd21`
   ("T-0182: finding 2 - ...").
3. Nit: `u/[handle].tsx` retry button now uses `RefreshCw` like the requests
   screen (went in with finding 1's commit).

Final checks: `pnpm exec prettier --check` on all touched files: pass (the
only `format:check` failure repo-wide is the pre-existing untracked
`PREREVIEW.md`, not mine, left alone). `pnpm lint`: pass. `pnpm typecheck`
(11 packages): pass. `pnpm --filter @zilar/mobile test --maxWorkers=2
contacts requests new-chat`: 5 files, 60 tests, all pass. Status stays
review.

## Review (written by Claude)
