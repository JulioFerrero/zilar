---
id: T-0235
title: "Web: block and unblock people, and a Blocked people page (block users part 1b)"
status: planned
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

## Review (written by Claude)
