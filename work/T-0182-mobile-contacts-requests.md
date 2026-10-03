---
id: T-0182
title: Mobile: find people by @handle, profile card and contact requests
status: planned
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

## Review (written by Claude)
