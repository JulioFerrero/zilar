---
id: T-1148
title: "Web + server: Telegram-style people search — the chat-list search shows people whose @username or name starts with the query (3+ chars, top 10, rate-limited, blocked users hidden) and up to 5 public groups, as compact rows; replaces the exact-@handle-only lookup"
status: merged
milestone: M5
branch: task/T-1148-people-prefix-search
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1148: People search by prefix

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: the @username search only finds someone when you type the exact username, and its UI is poor. He chose Telegram-style search: the main chat-list search also shows people and public groups whose @username or name **starts with** what you type, from 3 characters, up to 10 results, rate-limited.

**What the lead read:**
- **The chat-list search** shows a People section only when the query starts with `@` (`apps/web/src/components/chatList/ChatListBody.tsx:103`, `<PeopleSearchResult query={search} />`).
  - `apps/web/src/components/PeopleSearchResult.tsx` (70 lines) renders one bordered `ContactProfileRow` card (`apps/web/src/components/ContactProfileRow.tsx`, 345 lines, `:150` is the card).
  - The hook is `apps/web/src/lib/usePeopleSearch.ts` (149 lines). `handleOf` (`:26-31`) needs a leading `@`, and it calls `lookupByHandle` (`apps/web/src/lib/api/people.ts:54-56`).
- **The exact lookup:**
  - **Contract:** `contactRequests.byHandle` `GET /users/by-handle/:handle` returns `HandleProfile { userId, name, handle, image, relation }` (`packages/api-contract/src/contact-requests.ts:91-97`, `:127-130`).
  - **Rate limit:** `ContactRequestByHandleRateLimit` (`packages/api-contract/src/middleware.ts:182-186`), 30 per 10 minutes (`apps/server/src/contact-requests/api.ts:48-49`).
  - **Server:** `profileForHandle` (`apps/server/src/contact-requests/reads.ts:109-155`) reads `handles h JOIN "user" u` on `h.handle_lower`, hides a user who blocked the viewer (same 404), and adds `relationFor` (`reads.ts:71`).
- **Public groups:** search already exists as `directory.search` `GET /directory?q=` (`packages/api-contract/src/directory.ts:48-51`). The web calls it as `searchDirectory({ q })` (`apps/web/src/lib/api/groups.ts:257`). A `/@handle` URL opens a user or group (`apps/web/src/routes/AppRoutes.tsx:238`).

### What to build
1. **The contract:** add `contactRequests.search`, `GET /users/search`, to `packages/api-contract/src/contact-requests.ts`.
   - Query: `{ q: string, 1 to 64 chars }`. Success: `{ entries: HandleProfile[] }`.
   - Middleware: a new `UserSearchRateLimit` class in `middleware.ts`, next to `ContactRequestByHandleRateLimit`.
2. **The server:** a new `apps/server/src/contact-requests/search.ts` with `searchUsers(db, viewerId, q)`.
   - **Normalize:** trim, strip one leading `@`, lowercase. Fewer than 3 characters returns `[]`.
   - **Escape** `%`, `_` and `\` for LIKE.
   - **Match** only users who have a handle (like Telegram):
     - `h.handle_lower LIKE q || '%'`, or
     - `lower(u.name) LIKE q || '%'`, or
     - `lower(u.name) LIKE '% ' || q || '%'` (the start of any word).
   - **Exclude** the viewer, and anyone who blocked the viewer (`user_blocks`, as in `reads.ts`).
   - **Order:** exact handle first, then handle prefix, then name; then `u.name`. `LIMIT 10`.
   - **Relation:** add `relation` with `relationFor`.
   - **Handler:** wire it in `apps/server/src/contact-requests/api.ts` with its own limiter, 120 per 10 minutes (export `USER_SEARCH_RATE_LIMIT_MAX` and `USER_SEARCH_RATE_LIMIT_WINDOW_MS`).
   - **Logs:** never the query.
3. **The web API:** `searchUsers(q)` in `apps/web/src/lib/api/people.ts`, exported through `apps/web/src/lib/api.ts` like `lookupByHandle`.
4. **The hook:** `usePeopleSearch` takes any query.
   - It strips one leading `@`, stays idle under 3 characters, debounces 300 ms and calls `searchUsers`.
   - States: `idle`, `loading`, `results` (a list), `rate_limited`, `error`.
   - Drop `handleOf`'s `@` requirement. A stale response for an older query is ignored.
5. **The UI** (`PeopleSearchResult.tsx`, renamed in place or kept; your choice; keep it at most 150 lines):
   - **People section:** a "People" label, then up to 10 **compact rows** in the chat-list row style: no border card, avatar 40px, name, `@handle` muted below, hover background.
     - Clicking a row expands that one person's existing `ContactProfileRow` card in place, with its actions (message, add, request sent). A second click collapses it.
     - No results: show nothing when the query had no `@`. With `@`, show the existing "No one with that username." line.
   - **Public groups section:** for 3+ characters, below People, up to 5 rows from `searchDirectory({ q })`: avatar, title, `@handle · N members`. A click navigates to `/@<handle>`. On an error the section is hidden, with no message.
   - **In `ChatListBody.tsx:103`:** render the sections for any query of 3+ characters (after stripping `@`), not only `@`-queries.
6. **Tests** (permissions), in `apps/server/src/contact-requests/contact-requests.test.ts`, following its setup, with at most 3:
   - handle-prefix and name-word-prefix matches are returned, the viewer is excluded, and the limit is 10;
   - a user who blocked the viewer is not returned;
   - a query under 3 characters, after stripping `@`, returns `[]`.
7. **Mobile is out of scope** (web first).

### Read first
`AGENTS.md`, every file named above (`reads.ts`, `api.ts`, `contact-requests.test.ts`, `usePeopleSearch.ts`, `PeopleSearchResult.tsx`, `ContactProfileRow.tsx:140-230`, `ChatListBody.tsx:90-110`, `people.ts`, `groups.ts:250-270`) and `docs/EFFECT_GUIDE.md` (the HttpApi patterns).

### Allowed files
`packages/api-contract/src/contact-requests.ts`, `packages/api-contract/src/middleware.ts`, `apps/server/src/contact-requests/search.ts`, `apps/server/src/contact-requests/api.ts`, `apps/server/src/contact-requests/contact-requests.test.ts`, `apps/web/src/lib/api/people.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/usePeopleSearch.ts`, `apps/web/src/components/PeopleSearchResult.tsx`, `apps/web/src/components/chatList/ChatListBody.tsx`, `work/T-1148-people-prefix-search.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/contact-requests/contact-requests.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on a local stack:**
  - typing `jul` in the chat-list search lists `@julio` and others whose name or handle starts with "jul";
  - a click expands the profile card;
  - public groups matching the query show below.

---

## Report (written by the worker when done)

**Status:** review

### What I did
- **Contract** (`contact-requests.ts`, `middleware.ts`): added `contactRequests.search` (`GET /api/users/search`) with `UserSearchQuery` (`q` 1..64) → `{ entries: HandleProfile[] }`, plus the new `UserSearchRateLimit` middleware tag next to `ContactRequestByHandleRateLimit`.
- **Server** (`search.ts`, new): `searchUsers(db, viewerId, q)` trims, strips one leading `@` and lowercases; fewer than 3 characters returns `[]`; escapes `%`, `_` and the escape char for LIKE; matches handle prefix OR name prefix OR the start of any name word; excludes the viewer and anyone who blocked the viewer; orders exact handle → handle prefix → name, then `u.name`; `LIMIT 10`; adds `relation` with `relationFor`. Wired the `search` handler into `api.ts` with its own limiter (`USER_SEARCH_RATE_LIMIT_MAX = 120`, `USER_SEARCH_RATE_LIMIT_WINDOW_MS = 10 min`). The query is never logged (the edge logs the path only).
- **Web API** (`api/people.ts`, `api.ts`): `searchUsers(q)` returning `{ entries }`, exported like `lookupByHandle`.
- **Hook** (`usePeopleSearch.ts`): `usePeopleSearch` now accepts any query — strips one leading `@`, stays idle under 3 characters, debounces 300 ms, states `idle` / `loading` / `results` / `rate_limited` / `error`, and drops a response for an older query. Added `useGroupSearch` for the public-groups section.
- **UI** (`PeopleSearchResult.tsx`): a "People" label, then up to 10 compact chat-list-style rows (no border card, 40px avatar, name, muted `@handle`, hover background). A click expands that person's existing `ContactProfileRow` card in place; a second click collapses it. Empty results show nothing without `@`, and the existing "No one with that username." with `@`. Below, a "Public groups" section of up to 5 rows (avatar, title, `@handle · N members`) that navigate to `/@<handle>`; hidden on error. `ChatListBody.tsx` renders the sections for any 3+ character query after stripping `@`, not only `@`-queries.
- **Tests**: 3 added to `contact-requests.test.ts` (prefix + name-word matches / viewer excluded / cap 10; a user who blocked the viewer is not returned; under 3 characters after stripping `@` returns `[]`).

### Files changed
`packages/api-contract/src/contact-requests.ts`, `packages/api-contract/src/middleware.ts`, `apps/server/src/contact-requests/search.ts` (new), `apps/server/src/contact-requests/api.ts`, `apps/server/src/contact-requests/contact-requests.test.ts`, `apps/web/src/lib/api/people.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/usePeopleSearch.ts`, `apps/web/src/components/PeopleSearchResult.tsx`, `apps/web/src/components/chatList/ChatListBody.tsx`, `work/T-1148-people-prefix-search.md`.

### Commands and results
- `pnpm install` → done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/contact-requests/contact-requests.test.ts` → 8 passed (1 file).
- `pnpm --filter @zilar/server exec vitest run src/contact-requests/contact-requests.test.ts --reporter=dot` (the task's Checks) → 8 passed (1 file).
- `pnpm gate` → `GATE PASS`. Summary:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (4.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- A first gate run failed on format for `apps/web/src/lib/usePeopleSearch.ts`; I ran `pnpm exec prettier --write` on that one file, and the next gate passed. No check was disabled.

### Deviations / notes
- `usePeopleSearch` no longer exports `PEOPLE_SEARCH_DEBOUNCE_MS` or returns `lookupNow`; neither had a consumer (mobile uses its own `PEOPLE_SEARCH_DEBOUNCE_MS` from `@zilar/chat-core`), and the spec sets the debounce to 300 ms (was 900).
- The outgoing `q` is capped at 64 characters (contract max) for people and 100 for the directory, so a very long query never fails decode.
- I did not touch the mock backend (outside Allowed files), so standalone mock mode will not answer `/api/users/search`; the live-stack acceptance is unaffected.

### Not verified here
- I did not run a local stack; the lead's live check (typing `jul` lists `@julio` and others, a click expands the card, groups show below) is not verified by me.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The endpoint:** `GET /api/users/search` (`searchUsers`) matches only users who have a handle, on the handle prefix or the start of any name word.
  - **Escaping:** LIKE-escaped. **Excluded:** the viewer, and anyone who blocked the viewer. **Order:** exact handle, then handle prefix, then name. **Limit:** 10.
  - **Rate limit:** its own limiter.
  - **The normalizer** only trims and lowercases (`@zilar/protocol` `normalizeHandle`), so names with spaces work.
- **The web:** the chat-list search shows compact People rows for any query of 3+ characters (a click expands the existing profile card), plus up to 5 public groups.
- **Size:** `PeopleSearchResult.tsx` is 149 lines.
- **Tests:** the lead ran the server tests in the branch: 8 of 8.
- **Still to do:** the live check after the deploy.
