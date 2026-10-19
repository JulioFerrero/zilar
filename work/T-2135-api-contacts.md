---
id: T-2135
title: "Share (web + phone): one contacts, contact requests and blocks API in client-core (make…Api(call) over the contract client, contract types) used by both apps — each app keeps its module names, only the transport differs"
status: merged
milestone: M5
branch: task/T-2135-api-contacts
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2135: One contacts, contact requests and blocks API for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count must really go down, and web and phone share code. Both apps call the same contract endpoints through hand-written wrappers (phone `lib/*-api.ts` still 1677 lines, web `lib/api/*` 833). Both apps already have the derived contract client: `ZilarClient` in `packages/api-contract/src/client.ts`.

### The pattern to copy (already merged)
- `packages/client-core/src/topics-api.ts` and `packages/client-core/src/groups-api.ts`: `makeTopicsApi(call)` and `makeGroupsApi(call)` take
  ```ts
  call: <A>(f: (client: ZilarClient) => Effect<A, …>) => Promise<A>
  ```
  and return the Promise functions, with normalisation living once.
- **Web** (`apps/web/src/lib/api/topics.ts`): `const api = makeTopicsApi(callApi)`, then it exports the same function names as before.
- **Phone** (`apps/mobile/src/lib/topics-api.ts`): `makeTopicsApi((call) => runApi(call(client)))` inside its `create…Api(getToken, fetch, url)`.

### Facts (read by the lead on 2026-10-19 at `e4a868766`)
- **Web:** `apps/web/src/lib/api/people.ts:33-90` holds hand-written calls, each `callApi((client) => client.contactRequests.…)` or `client.blocks.…`:
  - `lookupByHandle`, `searchUsers` (returns `{ entries }`), `sendContactRequest`;
  - `listContactRequests`, `acceptContactRequest`, `declineContactRequest`, `cancelContactRequest`;
  - `blockUser`, `unblockUser`, `listBlockedUsers`.

  Lines 18-19 already use the shared `makeHandlesApi`.
- **Phone:** `apps/mobile/src/lib/contacts-api.ts:116-134` (`createContactsApi`) holds the same calls, with `searchUsers` returning a plain array.
  - Lines 9-62 hand-copy the contract row types: `HandleProfile`, `ContactRequestView`, `ContactRequestRow`, `BlockedPerson` and the others; `@zilar/api-contract` exports them.
  - `listContacts` and `removeContact` (lines 131-133) duplicate `packages/client-core/src/chats-api.ts:132-136`.
  - Keep the phone helpers `normalizeHandleInput`, `domainOfJid` and `contactChatId` (lines 84-110) where they are.
- **The return-shape difference:** web `searchUsers` returns `{ entries }` and phone returns an array. The shared function returns one shape. Each app module keeps its old shape for its importers, with a one-line adapter at most.
- `apps/mobile/src/components/contacts/use-contacts-api.ts` keeps its signature (`useContactsApi()` returns `{ api, mock }`).

### Steps
1. **The shared module.** Create `packages/client-core/src/contacts-api.ts` exporting `make…Api(call)`. It holds every call both apps make, plus any call only one app makes in this area, using contract types from `@zilar/api-contract` (`ZilarClient` and the row types).
2. **The barrel.** Add ONE line `export * from './<file>';` to `packages/client-core/src/index.ts` **directly after** the line `export * from './directory-api';`, not at the end. Other tasks append elsewhere, so this keeps merges clean.
3. **Web.** The web module builds the API with `callApi` and keeps exporting the **same names**, so its importers do not change. Types it exported become aliases of the contract types.
4. **Phone.** Its `create…Api(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object. Phone-only parsing and type copies of contract rows go; keep the exported type names as aliases.
5. **Users.** Users of both modules must compile unchanged. If one cannot, report BLOCKED with its path; the lead adds it.
6. **Tests.** No new tests. Existing tests of these modules must pass; adapt them only where a deleted hand-written parser was what they tested.
7. **Size.** Report the line counts. Product lines must go down by at least 90.

### Allowed files
- `apps/web/src/lib/api/people.ts`
- `apps/mobile/src/lib/contacts-api.ts`
- `apps/mobile/src/components/contacts/use-contacts-api.ts`
- `packages/client-core/src/contacts-api.ts`
- `packages/client-core/src/index.ts`
- `work/T-2135-api-contacts.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 90 lower.
- **Lead check:** web: Settings → Contacts (requests list, accept), add a contact by @handle, search, block and unblock from a profile; phone: the same on /settings/contacts and the new-chat search.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/contacts-api.ts` with `makeContactsApi(call)`: `lookupByHandle`, `searchUsers`, `sendContactRequest`, `listContactRequests`, `accept/decline/cancelContactRequest`, `blockUser`, `unblockUser`, `listBlockedUsers`, plus `listContacts`/`removeContact` reused from `makeChatsApi` instead of copying its requests. Types are contract aliases, with `ContactRelation` mapped to the contract `HandleRelation` and `CreatedContactRequest` built from `ContactRequestResult`.
- Added `export * from './contacts-api';` directly after `export * from './directory-api';` in `packages/client-core/src/index.ts`.
- Web `apps/web/src/lib/api/people.ts` now builds the API with `makeContactsApi(callApi)` and exports the same function names as before. `searchUsers` keeps its `{ entries }` shape. Exported types, including `HandleCheck`/`HandleCheckReason`, are contract/shared aliases.
- Phone `apps/mobile/src/lib/contacts-api.ts` keeps `createContactsApi(getToken, fetchImpl, apiUrl)` and its exported type names. The hand-copied row types and hand-written calls are gone; `searchUsers` keeps its array shape through a one-line adapter. `normalizeHandleInput`, `domainOfJid` and `contactChatId` stay in place.
- No new tests.

Line counts (product code, without the task file):
- Before: web `people.ts` 90 + mobile `contacts-api.ts` 134 = 224.
- After: `packages/client-core/src/contacts-api.ts` 58 + web `people.ts` 23 + mobile `contacts-api.ts` 52 = 133.
- Net: **91 fewer product lines**, plus the one required barrel line in `index.ts` (90 including it).

### Checks run

- No single-file tests were run: these two modules have no dedicated tests. `pnpm gate` ran the `@zilar/client-core`, `@zilar/mobile` and `@zilar/web` test suites.
- `pnpm gate` → `GATE PASS`:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.4s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/client-core  (2.2s)
  PASS  tests @zilar/mobile  (1.4s)
  PASS  tests @zilar/web  (3.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

### Notes for the lead

- Web and phone return shapes stay as they were: web `searchUsers` returns `{ entries }`, phone returns `HandleProfile[]`.
- `listContacts`/`removeContact` come from the shared chats API through `makeChatsApi`, so those requests exist once.
- The live web and phone acceptance checks were not run here; they are the lead's checks.


## Review (written by Claude)

Approved; the pre-review was clean (0 nits). Net −90: `packages/client-core/src/contacts-api.ts` (58) holds the handle lookup, people search, contact requests and block calls once. The web's `people.ts` and the phone's `contacts-api.ts` use it; the phone's hand-copied row types are now contract aliases, and its contacts list and remove come from the shared chats API.

**Web mock** (`:5255`, no page errors):
- `/settings/requests` lists Theo and Nora, and Accept removes Theo;
- `/settings/contacts` lists 8 contacts, and `/settings/blocked` is empty;
- searching "@mar" gives the same result as main;
- Marta's panel → Block → confirm turns the button into Unblock, and Unblock turns it back.

**Phone emulator:** the smoke passed (`/settings/contacts`, `/settings/requests`, `/settings/blocked`), and Accept on Theo takes it from 2 pending to 1.
