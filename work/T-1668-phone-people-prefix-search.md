---
id: T-1668
title: "Phone chat-list search finds people by name or @username prefix (parity audit gap 1): a People section from GET /users/search for any 3+ character query, like web's usePeopleSearch; the exact @handle card stays; the shared mock backend answers /users/search"
status: merged
milestone: M5
branch: task/T-1668-phone-people-prefix-search
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1668: People search by name on the phone

## Spec (written by Claude, do not edit)

### Why
On web, typing 3+ characters in the chat-list search shows people whose name or `@username` starts with the query (`apps/web/src/lib/usePeopleSearch.ts`). On the phone, people search only runs for an exact `@handle` (`apps/mobile/src/components/contacts/people-search.ts:40-58`). So typing "ada" finds nobody (`docs/audit/parity-2026-10-16.md`, gap 1).

### Facts (the lead read them on 2026-10-16)
- **The contract:** `HttpApiEndpoint.get('search', '/users/search', { query: UserSearchQuery, success: UserSearchResult })` with a rate limit (`packages/api-contract/src/contact-requests.ts:144-147`).
  - Web calls it as `client.contactRequests.search({ query: { q } })` and gets `{ entries: HandleProfile[] }`, up to 10 (`apps/web/src/lib/api/people.ts:58-64`).
- **Web hook** (`apps/web/src/lib/usePeopleSearch.ts:40-120`):
  - `normalizePeopleQuery` (trim, strip one leading `@`, lowercase);
  - idle under `PEOPLE_SEARCH_MIN_LENGTH` (3);
  - a debounce of `PEOPLE_SEARCH_DEBOUNCE_MS`;
  - only the latest query writes state;
  - a 429 gives `rate_limited`, any other failure `error`.
  - Read the file for the constants' source and reuse the shared ones when they live in a package.
- **Phone:**
  - `apps/mobile/src/lib/contacts-api.ts` (154 lines): `ContactsApi` (`:75-89`), built in `createContactsApi` (`:130-…`) with `runApi(client.contactRequests.byHandle(…))` (`:137`);
  - `apps/mobile/src/app/(tabs)/index.tsx` (236 lines): `const peopleSearch = peopleHandleFor(search) !== null;` (`:126`);
  - `apps/mobile/src/components/chat/chat-search-results.tsx` (179 lines): renders `<PeopleSearchResult …>` when `peopleSearch` (`:95-105`), then the "Chats" section (`:106-…`).
  - **Keep** the existing exact `@handle` card (`apps/mobile/src/components/contacts/people-search-result.tsx`, `people-search.ts`, `use-people-search.ts`) for `@` queries.
- **Mock:** `packages/mock-backend/src/domains/contact-requests/routes.ts` (160 lines) answers `GET users/by-handle/:handle` (`:46-54`, with `byHandle` at `:110-116` using `handleProfile(data, handle)`). It doesn't answer `users/search`.

### Steps
1. **`contacts-api.ts`:** add `searchUsers(q: string): Promise<HandleProfile[]>` to `ContactsApi`, implemented as `runApi(client.contactRequests.search({ query: { q } })).then((body) => [...body.entries])`.
2. **New `apps/mobile/src/components/contacts/use-people-prefix-search.ts`:** web's hook rules for the phone, with the states `idle | loading | results(entries) | rate_limited | error`. Use the phone's Effect helpers the way `use-people-search.ts` does (read it). Normalise as web does.
3. **New `apps/mobile/src/components/contacts/people-list-section.tsx`:**
   - a "People" section header, then one row per entry: avatar (the existing contact/profile avatar component; read `contact-row.tsx` and reuse it if it fits), name and `@handle`;
   - tapping a row opens `/u/[handle]`;
   - a muted line for loading ("Searching…"), no results ("No people found."), rate limited ("Too many searches, try again in a few minutes.") and error ("Could not search people. Try again.");
   - render nothing while idle.
4. **`chat-search-results.tsx`:** when the query doesn't qualify for the exact `@handle` card (`peopleSearch` false), render `PeopleListSection` above "Chats", fed by the new hook with the search text.
5. **Mock:** in `packages/mock-backend/src/domains/contact-requests/routes.ts`, answer `GET users/search?q=` with up to 10 seeded people (excluding the current user) whose handle or name starts with the normalised `q`, as `{ entries: HandleProfile[] }`. Build each entry the way `byHandle` builds its profile.
6. **Keep each file within 400 lines. No tests** (UI).

### Allowed files
- `apps/mobile/src/lib/contacts-api.ts`
- `apps/mobile/src/components/contacts/use-people-prefix-search.ts`
- `apps/mobile/src/components/contacts/people-list-section.tsx`
- `apps/mobile/src/components/chat/chat-search-results.tsx`
- `packages/mock-backend/src/domains/contact-requests/routes.ts`
- `work/T-1668-phone-people-prefix-search.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Typing 3+ characters without `@` in the phone chat-list search shows a People section** of matching people; tapping one opens their profile.
- **`@handle` still shows the exact card.**
- **Mock mode answers the search.**

---

## Report (written by the worker when done)

### What I did

Phone people prefix search (parity audit gap 1), mirroring web's `usePeopleSearch`:

- `apps/mobile/src/lib/contacts-api.ts`: added `searchUsers(q): Promise<HandleProfile[]>` to `ContactsApi`, implemented as `runApi(client.contactRequests.search({ query: { q } })).then((body) => [...body.entries])`.
- New `apps/mobile/src/components/contacts/use-people-prefix-search.ts`: the phone twin of web's `usePeopleSearch`, built on the phone's `useAction` + `fromApi` helpers (`apps/mobile/src/lib/effect/`). States `idle | loading | results | rate_limited | error`; `normalizePeopleQuery` (trim, strip one leading `@`, lowercase); idle under 3 characters; a `PEOPLE_SEARCH_DEBOUNCE_MS` debounce; only the latest query writes state; 429 → `rate_limited`, anything else → `error`.
- New `apps/mobile/src/components/contacts/people-list-section.tsx`: the "People" header, one row per entry (`EntityAvatar` + name + `@handle`), tap → `/u/[handle]`; muted lines "Searching…", "No people found.", "Too many searches, try again in a few minutes.", "Could not search people. Try again."; renders nothing while idle.
- `apps/mobile/src/components/chat/chat-search-results.tsx`: when `peopleSearch` is false, `PeopleListSection` renders above the "Chats" section. The exact `@handle` card (`PeopleSearchResult`) is unchanged.
- `packages/mock-backend/src/domains/contact-requests/routes.ts`: `GET /users/search?q=` answers up to 10 seeded people (excluding the current user) whose handle or name starts with the normalised `q`, as `{ entries: HandleProfile[] }`; each entry is built with `handleProfile(data, handle)`, the same call `byHandle` uses. Under 3 characters it answers `{ entries: [] }`.

### Checks run

- `pnpm install` (frozen): passed, 14.1s.
- `pnpm gate` from the repo root: **GATE PASS**. Summary lines:
  - `gate: 6 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mobile (1.9s)`
  - `SKIP tests @zilar/mock-backend (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
- No new tests: the task says "No tests (UI)", and no test file was added or changed. The first gate run failed only on `format` for my two new files; I ran `prettier --write` on those two and the re-run was green.

### Notes for the lead

- **Pre-review fixes (follow-up commit):** the prefix search now uses web's 300 ms debounce via a local `PEOPLE_PREFIX_DEBOUNCE_MS = 300` (the exact `@handle` flow keeps the shared 900 ms `PEOPLE_SEARCH_DEBOUNCE_MS`); and the mock lowercases `person.handle` before its prefix check, matching the name branch.
- **Debounce constant:** the prefix search uses web's 300 ms value locally; the shared `PEOPLE_SEARCH_DEBOUNCE_MS` from `@zilar/chat-core` (900 ms) stays on the exact-handle lookup. `PEOPLE_SEARCH_MIN_LENGTH` (3) has no shared constant, so it is local, like web's.
- **Mock matching:** only seeded people that have a handle are returned (the five humans; the seed AIs have no handle and cannot form a `HandleProfile`). Matching is handle prefix OR name prefix, per step 5. Entries go through `handleProfile`, so their `userId` is the same synthetic value `byHandle` returns for that handle (e.g. `u-handle-luis`), which keeps the mock self-consistent; tapping still opens `/u/<handle>`.
- **Rate limit:** the mock does not implement the `/users/search` rate limit, so the phone's `rate_limited` line is only reachable against the real server, not in mock mode. That is a mock limitation, not a change in behaviour.
- **Not verified live:** I did not run the phone UI or a manual smoke test; acceptance rests on the gate (typecheck/lint/tests) and code review.

## Review (written by Claude)

**Approved and merged.** This is parity gap 1 (people half; public groups not included).

- **Pre-review:** clean after one fix round. The prefix search now uses web's 300 ms debounce (the exact `@handle` lookup keeps 900 ms), and the mock lowercases handles.
- **The change:**
  - `ContactsApi.searchUsers` → `GET /users/search`;
  - `usePeoplePrefixSearch`: 3+ characters, latest query only, 429 → rate-limited line;
  - `PeopleListSection` shows avatar, name and @handle rows that open `/u/<handle>`, above "Chats" whenever the text isn't an exact `@handle`;
  - the shared mock answers `/users/search`.
- **Follow-up, recorded:** mock identities from by-handle/search (`u-handle-*`) differ from the seed ids (`u-luis`); unify them in `packages/mock-backend` `domains/handles/check.ts`. This is the same mock quirk the lead hit in T-1664's QA.
- **Still to check:** the emulator check is in the next phone QA pass, with T-1669 and T-1670.
- **This commit also carries T-1667's missing Review.**

