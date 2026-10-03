---
id: T-0163
title: @usernames and contact requests
status: review
milestone: M5
branch: task/T-0163-usernames-and-contact-requests
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: [T-0162]
estimate: 2 days
---

# T-0163: @usernames and contact requests

## Spec (written by Claude, do not edit)

### Why
Today the only way to become someone's contact is an invite link, and people are identified only by a free-text display name. Julio wants an "arroba" system: every person has a unique `@username` that is easy to say, type and share. Decisions already taken by Julio:
- Adding someone by `@username` sends a **contact request that the other person must accept**.
- A username can be **changed, but with limits** (once every 14 days, and the old one stays reserved for its previous owner for 30 days).
Web first; mobile is a later task.

### What to build

**1. Data (server, one migration).**
- `handles(handle_lower text primary key, handle text not null, user_id text unique references user(id) on delete cascade, group_id text unique references groups(id) on delete cascade, created_at, changed_at)` with a check that exactly one of `user_id` and `group_id` is set. One namespace for people and groups (a later task gives public groups and channels their own `@handle`), so the primary key on `handle_lower` is the only uniqueness rule; never check-then-insert. In this task only `user_id` rows are written; the `group_id` column and its check exist so the next task needs no change to the table.
- `retired_handles(handle_lower text primary key, former_user_id text references user(id) on delete cascade, former_group_id text references groups(id) on delete cascade, reserved_until timestamptz not null)` with the same exactly-one check: a handle given up by a change stays reserved for its former owner until `reserved_until` (30 days).
- `contact_requests(id text primary key, from_user_id, to_user_id (both references user on delete cascade), status text check in ('pending','accepted','declined','cancelled'), created_at, decided_at)`, a unique partial index on `(from_user_id, to_user_id) where status = 'pending'`, and a check that the two ids differ.

**2. Handle rules (one pure, tested module shared by the checks).**
3 to 32 characters, `a-z`, `0-9` and `_`, starting with a letter, stored with the typed casing but compared case-insensitively. A reserved-words list that nobody may take: `admin, administrator, support, help, root, system, zilar, ejabberd, api, settings, me, everyone, all, here, channel, bot, owner, moderator`. Anything else is valid. Error codes: `handle_invalid`, `handle_reserved`, `handle_taken`.

**3. Handle API (server, session required, all rate limited).**
- `GET /api/handles/check?handle=` returns `{ available: boolean, reason?: 'invalid' | 'reserved' | 'taken' }` (a handle held by the asker's own retired reservation counts as available). 30 per 10 minutes per user.
- `PUT /api/me/handle` body `{ handle }`. In one transaction: the change interval is checked (409 `handle_change_too_soon` with `nextChangeAt` in the body; the first claim is always allowed), the old handle goes to `retired_handles` for 30 days, the new row is written. A unique violation maps to 409 `handle_taken`. 10 per day per user.
- `GET /api/me` also returns `handle` (null until chosen).
- `GET /api/users/by-handle/:handle`: exact, case-insensitive match only; returns `{ userId, name, handle, image, relation: 'none' | 'contact' | 'request_sent' | 'request_received' | 'self' }`. An unknown handle and a retired handle answer the same 404. There is **no prefix or partial search anywhere** (it would allow enumeration). 30 per 10 minutes per user.

**4. Contact request API (server, session required).**
- `POST /api/contact-requests` body `{ handle }`: creates a pending request. Refuse (same 404 for unknown handles): to yourself (400), to an existing contact (409 `already_contact`), a duplicate pending request in either direction (409 `request_exists`; if the other side already sent one, answer with that request so the web can offer "Accept"), more than 20 pending outgoing (429 `too_many_requests`), a re-request within 7 days after a decline (429 `declined_recently`). 20 per day per user.
- `GET /api/contact-requests` returns `{ incoming: [...], outgoing: [...] }` with the other person's name, handle and image, newest first, pending only.
- `POST /api/contact-requests/:id/accept` (only the recipient), `POST /api/contact-requests/:id/decline` (only the recipient), `DELETE /api/contact-requests/:id` (only the sender, cancels). A request the caller may not act on and an unknown id answer the same 404. Every transition is a conditional update on `status = 'pending'` in one statement, so a double click cannot run twice.
- Accepting creates the mutual contact exactly like an invite does today (reuse the existing contacts service function that records contacts and the two roster items; do not duplicate it; roster failures are retried the same way). Accepting is idempotent.
- Audit entries `contact_request.created|accepted|declined|cancelled`, ids only.

**5. Web.**
- New onboarding step `/welcome/handle` after the name step: input with live availability (debounced, shows the exact reason), a suggestion built from the name or the email local part, and Continue. People who already have an account but no handle are sent to this step once at their next visit (a gate in the same place as the name gate), and can finish later with "Skip for now" only if the server owner has not made it mandatory (not in this task: skip is always allowed; the app works without a handle).
- Profile/Settings: show and edit the handle with the same live check, the "next change possible on <date>" message when too soon, and a copy button for the share link `<origin>/@handle`.
- "Add contact" dialog (an overlay like `InviteDialog`): type a `@username`, see the result card (name, avatar, handle), button "Send request" (or "Accept" when they already asked you, or "Already a contact"). Reachable from the chat list, the + new chat menu (next to "Invite a friend") and the empty state.
- Requests: a "Requests" list (Settings or the contacts area, follow the existing patterns) with Accept and Decline for incoming and Cancel for outgoing, plus a small badge with the incoming count where contacts are shown. The count comes from `GET /api/contact-requests` refetched on window focus and every 60 seconds (no new realtime channel in this task).
- Show `@handle` next to the name in member lists and profile cards where a name is shown now, when the person has one.
- Route `/@handle` (and `/u/handle` as a fallback if the router cannot match `@`): logged in opens the Add contact dialog prefilled with the result; logged out goes to login and returns afterwards.
- Match the style of the neighbouring components. Vitest + Testing Library tests for each new component and flow.

**6. Docs.** One short section in `docs/INSTALL_DOCKER.md` is not needed. Add a "Usernames and contacts" note to the user-facing docs only if a page for them already exists; otherwise skip.

### Read first
`AGENTS.md` (the whole security checklist), `apps/server/src/auth/auth-schema.ts`, `apps/server/src/auth/routes.ts`, `apps/server/src/contacts/` (service and routes), `apps/server/src/auth/invites.ts`, `apps/server/src/rate-limit.ts`, `apps/server/src/authz-sweep.test.ts`, `work/T-0161-first-run-setup.md` and `work/T-0162-integrations-settings-telegram.md` (Reports), `apps/web/src/routes/NamePage.tsx`, `apps/web/src/components/InviteDialog.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/lib/api.ts`.

### Allowed files
`apps/server/src/handles/**` (new), `apps/server/src/contact-requests/**` (new), `apps/server/src/db/schema.ts` and exactly one new migration (+ journal and snapshot), `apps/server/src/auth/routes.ts` (only `GET /me` and mounting), `apps/server/src/contacts/service.ts` (only to export what accepting needs), `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, the web files for the onboarding step, settings, Add contact dialog, requests list, profile and member list display, route changes, `apps/web/src/lib/api.ts` and its test, `work/T-0163-usernames-and-contact-requests.md`. No new dependencies, no mobile.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/handles src/contact-requests src/contacts src/auth src/authz-sweep.test.ts
pnpm --filter @zilar/web test --maxWorkers=2 src/routes src/components src/lib/api.test.ts
```

### Acceptance
- A new user picks a handle during onboarding; an existing user is asked once; the handle shows in the profile and can be changed no more than once every 14 days; the old handle cannot be taken by others for 30 days.
- Two people choosing the same handle at the same moment: exactly one wins (unique index test with concurrent calls).
- Adding by `@username` creates a pending request; the other person accepts or declines; accepting makes both contacts and roster items exist; a double accept changes nothing; both sides requesting each other do not create two requests.
- No endpoint returns a list of users by prefix; unknown, retired and not-allowed all answer the same 404 where specified; every new route is in the 401 sweep and has a rate limit or cap.
- No email address is returned by any new endpoint; audit entries carry ids only.

### Out of scope
`@mentions` inside messages (next task), blocking users, usernames for AIs, mobile, changing the display name rules, making a handle mandatory.

---

## Report (written by the worker when done)

Done. @usernames and contact requests work end to end: pick a handle during onboarding, change it (14-day interval, 30-day reservation), add people by @username with a request they accept/decline, share links like `/@ada`.

**Server** (`apps/server/src/`):
- `db/schema.ts` + migration `0035_handles-contact-requests.sql` (one migration only, journal + snapshot): `handles` (PK `handle_lower`, typed `handle`, `user_id`/`group_id` unique FKs with exactly-one check; only `user_id` rows written), `retired_handles` (reservation until `reserved_until`), `contact_requests` (status enum check, partial unique pending index, different-users check).
- `handles/rules.ts` (pure, tested): 3–32 chars `[a-z0-9_]` letter-first (typed casing accepted, compared lowercased), 19 reserved words (nobody may take them), `handle_invalid`/`handle_reserved`/`handle_taken`. `suggestHandle` shapes a suggestion from the name/email local part.
- `handles/store.ts`: `checkHandleAvailability` (shape → live row → retired; own reservation reads as available), `claimHandle` in one tx under a per-user advisory lock (interval check with `nextChangeAt`, retire old, insert new; unique violation → `handle_taken`), opportunistic reap of expired retired rows. Concurrent claims race on the PK: exactly one wins (tested).
- `handles/routes.ts`: `GET /handles/check` (30/10min per user) and `PUT /me/handle` (10/day per user, audit `handle.claimed` ids-only).
- `contact-requests/service.ts`: `resolveHandleUser` (exact case-insensitive; unknown + retired = same 404), `createContactRequest` in one tx under a per-pair advisory lock (self 400, `already_contact` 409, duplicate-either-direction 409 `request_exists` returning the existing row, 20 outgoing cap 429, 7-day decline cooldown 429 `declined_recently`), `listContactRequests` (incoming/outgoing newest-first, name+handle+image, never email), conditional-update accept/decline/cancel (double accept idempotent; not-actable = same 404), accept reuses `addContactPair` + roster sync with the same retry (source `manual`), `profileForHandle` with `relation`, audits `contact_request.created|accepted|declined|cancelled` ids-only.
- `contact-requests/routes.ts`: POST/GET `/contact-requests` (create 20/day per user), accept/decline/cancel, `GET /users/by-handle/:handle` (30/10min per user). No prefix search anywhere.
- `auth/routes.ts`: `GET /me` also returns `handle` (null until chosen). `contacts/service.ts`: contacts carry `handle`. `groups/service.ts`: member rows carry `handle`. `app.ts`: mounts both routers (session-required; sweep asserts 401).

**Web** (`apps/web/src/`):
- `routes/HandlePage.tsx` at `/welcome/handle` (after the name step; NamePage chains there; `RequireAuth` gates handle-less users once with `next` preserved; always skippable). Live debounced availability with the exact reason, suggestion from name/email, Continue + Skip for now.
- `auth/AuthProvider.tsx`: `AuthUser.handle` from `GET /me` (Better Auth session has no handle field), refreshed on `refetch`. `test/renderApp.tsx`: default handle so the suite is not gated.
- `components/AddContactDialog.tsx` (overlay like InviteDialog): type @username, result card, Send request / Already a contact / Accept-via-Requests-link. From chat-list menu ("Add contact"), + new chat menu (entry + New message dialog button), empty state button, and `/@handle` + `/u/handle` share routes (logged out → login → back).
- `routes/RequestsPage.tsx` at `/settings/requests` (+ ChatList menu entry with incoming-count badge from `useContactRequestCount`, refetched on focus + every 60s).
- `components/ProfileSettingsSection.tsx`: show/edit handle with live check, too-soon message with the next-change date, copy share-link button (`<origin>/@handle`).
- `HandleSuffix` (`@handle` next to names) in GroupPanel members and NewGroupDialog contacts. `lib/api.ts`: all endpoints + zod schemas. `mock/api.ts`: handle check/claim + seeded null handle.
- Docs: "Usernames and contacts" section in `docs/USER_GUIDE.md` (the page exists).

**Tests (real results):**
- `pnpm install`: exit 0.
- `pnpm format:check`: pass. `pnpm lint`: pass (fixed 5 oxlint findings: no sync setState-in-effect — promise-helper pattern; `userId` dep in AuthProvider).
- `pnpm typecheck`: pass (11 tasks).
- Server: `src/handles src/contact-requests src/contacts src/auth src/authz-sweep.test.ts` — 9 files, 107 passed (sweep: 129 routes, all non-allowlisted 401).
- Web: `src/routes src/components src/lib/api.test.ts` — 71 files, 722 passed; `src/mock` — 7 files, 87 passed.
- Neighbours: full web `src/routes+components+api+mock` green; no other suites touched.

**Security checklist:** no secrets/emails in new responses, logs, or audit (sentinels in tests; by-handle/list/check carry name+handle+image only); deletes/updates scoped (per-user lock, per-pair lock, conditional status updates); caps enforced atomically (PK race, partial unique index + in-tx re-read, advisory locks; all decision rows read INSIDE the tx); permission before effect (session on every route; recipient/sender checks before transitions; owner reclamation only); unknown = not-allowed 404s; every new route in the 401 sweep (none allowlisted) with a rate limit (check 30/10min, claim 10/day, create 20/day, by-handle 30/10min, list 60/min) or a cap (20 outgoing, 7-day cooldown, 14-day interval, 30-day reservation); audits ids-only.

**Notes/deviations:**
1. PGlite quirk found while testing: raw `sql` fragments with bound params inside transactions misbehave (a `pending` row read as `declined` in-tx); all such predicates rewritten as plain `eq()` pairs (two selects instead of OR). Worth knowing for future tasks.
2. `me` (2 chars) is shorter than the 3-char minimum but is still answered `reserved` (reserved-first ordering) — the useful answer, asserted by test.
3. AddContactDialog's "Accept" deep-links to `/settings/requests` instead of accepting inline (the incoming request row is not fetched by the dialog; the list page owns the call).
4. The report's item 6 says "not needed" and names no user-facing docs page, but `docs/USER_GUIDE.md` exists and covers features, so one short section was added there per the "only if a page exists" rule.
5. `useContactHandles`-style batch resolution was dropped: no batch endpoint exists and prefix search is forbidden, so member/contact lists get handles from their own list endpoints (server-joined), and the dialog uses exact lookup.
6. Scope (lead-approved, sign-off recorded): `groups/service.ts` (member handle join), `contacts/service.ts` (handle join), `docs/USER_GUIDE.md`, `AuthProvider.tsx`, `mock/api.ts`, `test/renderApp.tsx`, `lib/handles.ts`, `lib/useContactRequestCount.ts`, `HandleSuffix.tsx`, plus `errors.ts` (`HttpError.detail`, defaults to `{}` so other routes serialize unchanged) — all touched only for this task's handle plumbing.
7. Web `ApiError` gained a `detail` bag (extra error-body fields like `nextChangeAt`); the server `HttpError` gained the same. Both default to `{}` so every other route's errors serialize exactly as before.

**Review fixes (lead review of f6856cd):**
1. Handle gate redirects only on `handle === null`; while the user or `getMe()` is still loading (`undefined`) it renders nothing extra — no Navigate, no flash (new test: a late-arriving handle never triggers the gate).
2. `nextChangeAt` is a real field in the 409 JSON body via `HttpError.detail` (serialized by the central `onError`; other routes unaffected — detail defaults to `{}`). `PUT /me/handle` throws the store error directly instead of rebuilding it. The web reads `error.detail.nextChangeAt`, never the message; the server test asserts the body field is a future ISO date and the web test uses a fixed message to prove the field is read.
3. Re-saving the exact current value (same casing) returns the existing row before the interval check and skips the claim-budget limiter (fast path in the route, re-checked inside the store tx). A casing-only change reaches the store: the 14-day interval applies, the new casing is stored, nothing retires (route-level test: too-soon casing change answers 409 `handle_change_too_soon`; store test covers the post-interval casing update). Profile Save is disabled while the value equals the current one (case-insensitive).
4. Accept flips the status and creates the pair under one per-request advisory-lock transaction (failure rolls back); every re-accept of an `accepted` row re-runs `addContactPair` + roster sync idempotently, so it repairs a half-finished accept (new test deletes the pair and re-accepts).
5. Scope noted under Deviations item 6.
6. The vacuous `orders pending by creation time, not id` test is deleted; the newest-first test no longer sleeps and asserts via `createdAt` ordering.
7. Accept/decline/cancel now pass the shared read limiter (60/min per user) like the list route.
8. Dead export `userEmailFor` deleted (nothing used it).
9. `handleUserIdFor` is one `inArray` query instead of one select per id.
10. The mock uses the shared reserved list from `lib/handles.ts` (which mirrors the server's `RESERVED_HANDLES`); the mock suite asserts every word maps to `reserved`.
11. The `isContact` check moved inside the create transaction (under the per-pair lock), so a racing accept cannot leave a stale pending row.
12. Second review round: the retired-vs-unknown 404 test asserts equal status + equal `error.code`/message (only the per-request id differs); the 20-outgoing cap is enforced under a per-sender advisory lock taken before the per-pair lock (always that order, no deadlock) with a concurrency test (19 pending + two simultaneous creates to different targets: exactly one wins with `too_many_requests`); the mock implements `by-handle` lookup + the full request endpoints in memory (reserved maps to `handle_reserved`); the Add-contact dialog re-seeds on prefill change and the route keys it by handle; the profile input fills when the handle arrives late (unless the user typed); the accept comment no longer over-claims one transaction.


## Review (written by Claude)
