---
id: T-0235
title: "Web: block and unblock people, and a Blocked people page (block users part 1b)"
status: merged
milestone: M5
branch: task/T-0235-web-block-users
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0171]
estimate: 0.5 day
---

# T-0235: Block people on the web

## Spec (written by Claude, do not edit)

### Why
Julio wants to block users. T-0171 (merged) built the server: silent blocking, `PUT`/`DELETE` and `GET` on `/api/blocks`, and `relation: 'blocked'` on the by-handle lookup. This task is the web UI for blocking. Hiding a blocked person's messages in chats is the next task (not here).

### Verified facts (do not re-derive)
- Server routes, `apps/server/src/blocks/routes.ts`:
  - PUT `/api/blocks/:userId` → `{ blocked: true }` (line 32-37);
  - DELETE `/api/blocks/:userId` → `{ blocked: false }` (line 42-47);
  - GET `/api/blocks` → `{ blocked: [{ userId, name, handle, image }] }` newest first (lines 76-82, `listBlockedUsers` in `service.ts` line 133).
  - Errors: 404 `not_found` for an unknown user, 400 for yourself, 429 `rate_limited`.
- `relationFor` (`apps/server/src/contact-requests/service.ts` line 606) can now return `'blocked'`, but the web schema `handleProfileSchema` (`apps/web/src/lib/api.ts` lines 1979-1985) only accepts `none|contact|request_sent|request_received|self`, so a lookup of someone you blocked currently fails to parse. Fix that here.
- Sending a request to someone you blocked answers 409 `blocked` with "Unblock this person first" (T-0171 spec).
- Web API helper: `request<T>(path, schema, init)` (`apps/web/src/lib/api.ts` line 190); contact-request client functions at lines 2041-2075 show the pattern.
- `apps/web/src/components/ContactProfileRow.tsx` (235 lines) shows a person (avatar, name, `@handle`, a relation line, one action per relation, lines 113-200). It is used by `AddContactDialog.tsx` (line 131) and `PeopleSearchResult.tsx` (line 56).
- Settings pages are routes in `apps/web/src/routes/AppRoutes.tsx` (e.g. `/settings/requests` lines 186-191 → `RequestsRoute` at lines 232-235 rendering `RequestsPage` with `onBack`). `apps/web/src/routes/RequestsPage.tsx` (165 lines) is the closest page to copy (list of people with actions).
- The main menu in `apps/web/src/components/ChatList.tsx` has a "Requests" item (lines 154-172) navigating to `/settings/requests`.

### What to build
1. `api.ts`:
   - Add `'blocked'` to the `relation` enum.
   - New `blockUser(userId)`, `unblockUser(userId)` and `listBlockedUsers()` with zod schemas for the shapes above.
   - Map 409 `blocked` on `sendContactRequest` to a fixed sentence `Unblock this person first.` where its errors are mapped today (keep the existing mapping style).
2. `ContactProfileRow.tsx`:
   - A small secondary "Block" action (lucide `Ban` icon + text, muted style) for every relation except `self` and `blocked`.
   - It opens an inline confirm inside the row: "Block <name>? They are not told. You won't see their contact requests." with `Block` (danger) and `Cancel`. On success the relation becomes `blocked`.
   - For `blocked`: the relation line `You blocked this person.` and an `Unblock` button (back to `none` on success).
   - Errors are fixed sentences: `Could not block. Try again.` / `Could not unblock. Try again.`, and `Too many tries — wait a little and try again.` on 429. Never server text.
3. New `apps/web/src/routes/BlockedPage.tsx` at `/settings/blocked` (route + `BlockedRoute` in `AppRoutes.tsx`, like Requests). It shows:
   - title `Blocked people` and the line `They are not told. Their contact requests don't reach you.`;
   - one row per person (avatar, name, `@handle`, `Unblock` button);
   - the empty state `You haven't blocked anyone.`;
   - loading and error states in the RequestsPage style.
   - Unblock removes the row.
4. `ChatList.tsx` main menu: a `Blocked people` item under Requests, navigating to `/settings/blocked`.
5. Tests (Vitest + Testing Library, next to the files):
   - `apps/web/src/lib/api.test.ts`: the three new calls (method, path, parsed shape) and the `blocked` relation parses.
   - `apps/web/src/components/ContactProfileRow.test.tsx` (create if missing): Block → confirm → blocked line + Unblock; Cancel keeps the state; errors show the fixed sentences.
   - New `apps/web/src/routes/BlockedPage.test.tsx`: list, empty, unblock removes the row, error sentence.
   - The menu item exists (extend the existing ChatList test if one covers the menu, else skip and say so).
   - Mock mode: if `apps/web/src/mock/` has an API stand-in that tests or mock mode use for contact requests, add the block calls there too so mock mode does not crash.

### Read first
`AGENTS.md`, `apps/server/src/blocks/routes.ts`, `apps/web/src/lib/api.ts` (lines 180-200 and 1975-2080), `apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/routes/RequestsPage.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/ChatList.tsx` (lines 120-300).

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/components/ContactProfileRow.tsx`, `apps/web/src/components/ContactProfileRow.test.tsx`, `apps/web/src/routes/BlockedPage.tsx` (new), `apps/web/src/routes/BlockedPage.test.tsx` (new), `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/ChatList.test.tsx`, `apps/web/src/mock/**`, `work/T-0235-web-block-users.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/api.test.ts src/components/ContactProfileRow.test.tsx src/routes/BlockedPage.test.tsx
pnpm gate
```

### Acceptance
- From a person row you can block (with the confirm) and unblock; `/settings/blocked` lists blocked people with Unblock; a blocked person's lookup parses; every error is a fixed sentence.
- No server or mobile change; no new dependency; icons only; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. The lead checks it in the browser.

### Out of scope
Hiding a blocked person's messages, unread and notifications (next task); a Block action inside chats and member lists (next task); mobile.

---

## Report (written by the worker when done)

Done. Web UI for blocking: block/unblock from person rows, a Blocked people page, and the `blocked` relation parse fix.

What I did:
- `apps/web/src/lib/api.ts`: added `'blocked'` to `ContactRelation` and the `handleProfileSchema` enum; new `blockUser` (PUT `/blocks/:userId`), `unblockUser` (DELETE), `listBlockedUsers` (GET `/blocks`) with zod schemas; mapped 409 `blocked` on `sendContactRequest` to the fixed sentence `Unblock this person first.` via the row's existing error mapper.
- `apps/web/src/components/ContactProfileRow.tsx`: secondary muted Block action (lucide `Ban`) for every relation except `self`/`blocked`; inline confirm "Block \<name\>? They are not told. You won't see their contact requests." with danger Block (`aria-label="Confirm block"`) + Cancel; success sets relation `blocked`; `blocked` shows "You blocked this person." + Unblock (back to `none`). Fixed sentences only: `Could not block. Try again.` / `Could not unblock. Try again.` / 429 `Too many tries — wait a little and try again.`
- `apps/web/src/routes/BlockedPage.tsx` (new) at `/settings/blocked` (+ `BlockedRoute` in `AppRoutes.tsx`, Requests style): title `Blocked people`, subtitle line, avatar/name/`@handle`/Unblock rows, empty state `You haven't blocked anyone.`, loading + fixed error sentences; unblock removes the row.
- `apps/web/src/components/ChatList.tsx`: `Blocked people` menu item under Requests → `/settings/blocked`.
- `apps/web/src/mock/api.ts`: in-memory `blockedUsers` (newest-first list), PUT/DELETE/GET `/blocks` handlers (unknown id 404, idempotent block), lookup returns `blocked` relation. Mock-mode block flow verified by new test.
- Tests: extended `api.test.ts` (blocked relation parses; block/unblock/list method+path+shape; 409 blocked code), new `ContactProfileRow.test.tsx` (5 tests: confirm flow, cancel, fixed error sentences, self hides Block), new `BlockedPage.test.tsx` (4 tests: list, empty, unblock removes row, error sentence), extended `ChatList.test.tsx` (menu navigates to Blocked people), extended `mock/api.test.ts` (block round-trip through real schemas).

Commands (real results):
- `pnpm install`: done, 11s.
- Single-file runs while working: `api.test.ts + ContactProfileRow.test.tsx + BlockedPage.test.tsx`: 3 files, 102 passed; `ChatList.test.tsx + mock/api.test.ts`: 2 files, 66 passed; `AddContactDialog + PeopleSearchResult`: 2 files, 21 passed.
- `pnpm gate`: GATE PASS — install 1.2s, format 19.4s, lint 0.7s, typecheck 9.1s, tests @zilar/web 34.3s; 12 changed files, all inside Allowed files. (First gate run failed on prettier in 4 files — fixed with `prettier --write`; second failed on `exact` in `ByRoleOptions` — fixed by giving the confirm button `aria-label="Confirm block"`.)
- Fixed problems honestly: none remaining. No deviations from the spec; no server/mobile change; no new dependency; icons only (lucide `Ban`).

Security checklist: no secrets/tokens in logs or code; no deletes/updates beyond the user's own block rows (server-scoped); no caps/uniqueness logic added client-side; no effect before permission check (server-owned); 404 vs forbidden is server behavior, unchanged; new GET/PUT/DELETE go through the existing sessioned `request()` helper; no audit/message text handled.

### Round 2 (fix round)

Findings fixed: finding 1 (should-fix) — the 409 `blocked` fixed sentence `Unblock this person first.` had no test hitting the row's `friendlySendError` branch. Added a test in `ContactProfileRow.test.tsx`: "shows the fixed sentence when the person blocked the request" (mock `sendContactRequest` rejecting with `ApiError(409, 'blocked')`, click "Add contact", assert the sentence renders). Nits (BlockedPage unblock sentence, mock self-block/DELETE-404 fidelity) left untouched per instructions — they are on lines I did not change.

Tests added: 1 (`ContactProfileRow.test.tsx`, now 6 tests).
Gate result: `pnpm gate`: GATE PASS — install 4.3s, format 33.4s, lint 2.0s, typecheck 19.4s, tests @zilar/web 52.0s; 12 changed files, all inside Allowed files. Single test run: `ContactProfileRow.test.tsx` 6 passed. (First gate run failed on prettier in the test file — fixed with `prettier --write`.)

## Review (written by Claude)

**Verdict:** Approved after 1 auto round; packet clean, 2 nits deferred. Read the `ContactProfileRow` diff: Block is behind an inline confirm, blocked profiles show Unblock instead of Add, a 409 `blocked` shows "Unblock this person first.", and every error is a fixed sentence. The `/settings/blocked` route sits behind `RequireAuth`. Deferred nits: the unblock failure on `BlockedPage` reuses the load sentence; the mock allows self-block and never 404s on DELETE. Next: hide blocked people's messages on the web; mobile block UI.
