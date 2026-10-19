---
id: T-2125
title: "Share (web + phone): one directory, public join, group visibility and handles API in client-core (make…Api(call) over the contract client, contract types) used by both apps — each app keeps its module names, only the transport differs"
status: merged
milestone: M5
branch: task/T-2125-api-directory
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2125: One directory, public join, group visibility and handles API for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count must really go down, and web and phone share code. Both apps call the same contract endpoints through hand-written wrappers (phone `lib/*-api.ts` still 2,756 lines after T-2096 to T-2099, web `lib/api/*` 1,031). Both apps already have the derived contract client: `ZilarClient` in `packages/api-contract/src/client.ts`.

### The pattern to copy (already merged)
- `packages/client-core/src/topics-api.ts` and `packages/client-core/src/groups-api.ts`: `makeTopicsApi(call)` and `makeGroupsApi(call)` take
  ```ts
  call: <A>(f: (client: ZilarClient) => Effect<A, …>) => Promise<A>
  ```
  and return the Promise functions, with normalisation living once.
- **Web** (`apps/web/src/lib/api/topics.ts`): `const api = makeTopicsApi(callApi)`, then it exports the same function names as before.
- **Phone** (`apps/mobile/src/lib/topics-api.ts`): `makeTopicsApi((call) => runApi(call(client)))` inside its `create…Api(getToken, fetch, url)`.

### Facts (read by the lead on 2026-10-18 at `3994b925b`)
- **Web directory:** `apps/web/src/lib/api/groups.ts:123-175` uses the contract client. It has `searchDirectory` `:136` (`client.directory.search`), `lookupGroupByHandle` `:149` (`client.directory.byHandle`), `joinPublicGroup` `:156` (`client.groups.join`), `setGroupVisibility` `:162` (`client.groups.patch`) and `checkGroupHandle` `:173`.
- **Web handles:** `apps/web/src/lib/api/people.ts:19-37`: `checkHandleKind` `:23` (`client.handles.check`), `checkHandle` `:32` and `claimHandle` `:36` (`client.handles.claim`).
- **Phone directory:** `apps/mobile/src/lib/directory-api.ts` (255 lines).
  - It hand-declares `DirectoryEntry`, `DirectoryPage`, `PublicJoinResult`, `GroupVisibilityState` and `HandleCheck` at `:14-61`; `packages/api-contract/src/directory.ts:20,33` and `handles.ts:23` already export these.
  - It has its own Schemas at `:74-110` and a raw-`fetch` `requestEffect` at `:114`, used by `joinPublicGroup` `:220`, `getGroupVisibility` `:228` and `setGroupVisibility` `:236`. The contract endpoints for these are `client.groups.join` (`packages/api-contract/src/groups.ts:210`) and `client.groups.patch`.
  - `createDirectoryApi` is at `:160`.
- **Phone profile:** `apps/mobile/src/lib/profile-api.ts` (334 lines) calls raw `fetch` with its own Schemas (`:61-110`):
  - `getMe` `:280`: the same call as `getMe` in `packages/client-core/src/chats-api.ts:87`;
  - `checkHandle` `:284` and `claimHandle` `:288`: the contract has `client.handles.check` and `client.handles.claim` (`packages/api-contract/src/handles.ts:44,48`);
  - `uploadAvatar` `:300` and `removeAvatar` `:330`: the binary avatar PUT stays phone-specific.
- **Phone importers** that must compile unchanged:
  - of `directory-api`: `app/at/[handle].tsx`, `app/explore.tsx`, `components/chat/use-group-visibility.ts`, `components/chat/visibility-fields.tsx`, `components/chat/visibility-sheet.tsx`, `components/directory/explore-helpers.ts`, `components/directory/handle-helpers.ts`, `components/directory/use-directory-api.ts`;
  - of `profile-api`: `app/(tabs)/settings.tsx`, `app/me.tsx`, `components/profile/profile-view.tsx`, `components/settings/avatar-native.ts`, `components/settings/use-profile-api.ts`, `components/settings/use-profile-avatar.ts`, `components/settings/use-profile-settings.ts`.
- **Errors:** `ProfileApiError` (`profile-api.ts:44`) carries `nextChangeAt` for `handle_change_too_soon`. Keep that behaviour: read it from the contract error the same way the web does in `apps/web/src/lib/api/people.ts`, or keep the phone parser `parseApiErrorBody` `:117` if the contract error lacks the field.

### Steps
1. **The shared module.** Create `packages/client-core/src/directory-api.ts` exporting `make…Api(call)`. It holds every call both apps make, plus any call only one app makes in this area, using contract types from `@zilar/api-contract` (`ZilarClient` and the row types).
2. **The barrel.** Add ONE line `export * from './<file>';` to `packages/client-core/src/index.ts` **directly after** the line `export * from './chats-api';`, not at the end. Other tasks append elsewhere, so this keeps merges clean.
3. **Web.** The web module builds the API with `callApi` and keeps exporting the **same names**, so its importers do not change. Types it exported become aliases of the contract types.
4. **Phone.** Its `create…Api(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object. Phone-only parsing and type copies of contract rows go; keep the exported type names as aliases.
5. **Users.** Users of both modules must compile unchanged. If one cannot, report BLOCKED with its path; the lead adds it.
6. **Tests.** No new tests. Existing tests of these modules must pass; adapt them only where a deleted hand-written parser was what they tested.
7. **Size.** Report the line counts. Product lines must go down by at least 150.

### Allowed files
- `packages/client-core/src/directory-api.ts`
- `apps/web/src/lib/api/groups.ts`
- `apps/web/src/lib/api/people.ts`
- `apps/mobile/src/lib/directory-api.ts`
- `apps/mobile/src/lib/profile-api.ts`
- `apps/mobile/src/components/directory/use-directory-api.ts`
- `apps/mobile/src/components/settings/use-profile-api.ts`
- `apps/mobile/src/lib/directory-api.test.ts`
- `apps/mobile/src/lib/profile-api.test.ts`
- `packages/client-core/src/index.ts`
- `work/T-2125-api-directory.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check:** web mock: `/explore` lists groups, a public group opens by handle, the group visibility switch saves, and Settings → Username checks a handle; phone emulator: `/explore`, `/me` and the visibility sheet.

---

## Report (written by the worker when done)

### What I did

- Created `packages/client-core/src/directory-api.ts` with two factories over the caller's `call`:
  - `makeDirectoryApi(call)`: `searchDirectory`, `lookupGroupByHandle`, `joinPublicGroup`,
    `getGroupVisibility`, `setGroupVisibility`, `checkGroupHandle`.
  - `makeHandlesApi(call)`: `checkHandleKind`, `checkHandle`, `claimHandle`.
  It owns the normalisation both apps had copied: empty search fields dropped, an absent
  visibility read as private with no handle, a handle outside 1..64 answered locally as
  `invalid`, and the visibility patch built once.
- Added `export * from './directory-api';` to `packages/client-core/src/index.ts` directly
  after `export * from './chats-api';`.
- Web: `apps/web/src/lib/api/groups.ts` now builds the directory API with
  `makeDirectoryApi(callApi)` and keeps the same exported names
  (`searchDirectory`, `lookupGroupByHandle`, `joinPublicGroup`, `setGroupVisibility`,
  `checkGroupHandle`); its `DirectoryPage`, `SearchDirectoryInput`, `PublicJoinResult` and
  `DirectoryEntry` exports are re-exports of the shared types. `apps/web/src/lib/api/people.ts`
  builds `makeHandlesApi(callApi)` and keeps `checkHandleKind`, `checkHandle`, `claimHandle`.
- Phone: `apps/mobile/src/lib/directory-api.ts` keeps `createDirectoryApi(getToken, fetch, url)`
  and its exported type names, now aliases of the shared types; the hand-written Schemas,
  error mapping and raw `fetch` for directory/join/visibility are gone. The only extra code is
  the `setGroupVisibility` wrapper that keeps the phone interface `Promise<void>`.
- Phone: `apps/mobile/src/lib/profile-api.ts` keeps `createProfileApi`, `ProfileApiError`,
  `parseApiErrorBody` and `avatarPutPath`; `getMe` uses `makeChatsApi`, `checkHandle` and
  `claimHandle` use `makeHandlesApi`. `ApiError` is converted back to `ProfileApiError`, and
  `nextChangeAt` is read from `error.detail` and date-validated as before. The avatar PUT and
  DELETE stay on the phone-specific binary path.
- No new tests: neither `apps/mobile/src/lib/directory-api.test.ts` nor
  `apps/mobile/src/lib/profile-api.test.ts` exists in the repo, and the modules they would
  cover had none. The existing package suites pass under the gate.

Product line counts (changed files, before → after):

| File | Before | After |
| --- | ---: | ---: |
| `apps/web/src/lib/api/groups.ts` | 175 | 137 |
| `apps/web/src/lib/api/people.ts` | 109 | 90 |
| `apps/mobile/src/lib/directory-api.ts` | 255 | 57 |
| `apps/mobile/src/lib/profile-api.ts` | 334 | 193 |
| `packages/client-core/src/directory-api.ts` | 0 | 123 |
| `packages/client-core/src/index.ts` | 73 | 74 |
| **Total** | **946** | **674** |

Net: **272 product lines fewer** (target: at least 150).

### Checks run

- `pnpm install`: completed, "Done in 35.5s using pnpm v10.32.1".
- `pnpm gate` (final): **GATE PASS**
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (3.0s)
  PASS  format  (0.9s)
  PASS  lint  (1.7s)
  PASS  typecheck  (0.7s)
  PASS  effect  (0.7s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/client-core  (8.5s)
  PASS  tests @zilar/mobile  (3.5s)
  PASS  tests @zilar/web  (8.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- Earlier gate runs failed and were fixed inside scope: unused type imports (lint), a readonly
  `DirectoryPage` contract array not assignable to the web's mutable state (typecheck), and the
  Effect ratchet asking for an `// effect-plain:` marker in the now Effect-free mobile
  directory module. The final run above is the passing one.

### Notes for the lead

- One behavioural detail: phone `getGroupVisibility` now decodes the contract `GroupDetail`
  through `client.groups.detail` instead of the two-field parser. The mock backend rows are
  typed `GroupDetail`, so mock mode and the real server both satisfy it; an older server that
  omitted `visibility`/`handle` still reads as private/null because both contract fields are
  optional.
- `buildVisibilityBody` was exported only for the old phone parser and had no importers; it is
  gone with the parser. `checkHandlePath` and `avatarFileName` in `profile-api.ts` were also
  unused and were removed; `parseApiErrorBody` stays because `avatar-native.ts` uses it.
- No dependencies added, no files touched outside Allowed files, no deviations from the spec.

## Review (written by Claude)

Approved; the pre-review was clean (0 nits). Net −272: `packages/client-core/src/directory-api.ts` (123) replaces the web's directory, public-join, visibility and handle calls (`lib/api/groups.ts`, `people.ts`) and the phone's `directory-api.ts` and `profile-api.ts` hand-written parsers.

**Web mock** (`:5254`, no page errors):
- `/explore` lists the public groups and channels, and searching "acme" narrows to Acme Announcements;
- `/@acme` shows Open and `/@neighbors` shows "Join the group";
- Dev team → Settings → Visibility → Public, handle `devteam9` reports "is available", and Save shows "Saved." with the share link;
- Settings → Profile checks a username.

**Phone emulator:** the smoke passed (`/explore`, `/me`, `/settings/profile`).
- The username field reports "@brandnew55 is available".
- Group info (`g-devteam`) → Settings → Visibility reads Private. Public plus `devteam9` saves ("Saved.", Copy share link), and reopening the sheet reads back Public / devteam9 through the new `groups.detail` read.
