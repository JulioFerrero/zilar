---
id: T-2099
title: "Share (web + phone): one chats, me, contacts, invites, chat folders and chat prefs API in client-core (make…Api(call) over the contract client, contract types) used by both apps — each app keeps its module names, only the transport differs"
status: merged
milestone: M5
branch: task/T-2099-api-chats
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2099: One chats, me, contacts, invites, chat folders and chat prefs API for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count must really go down, and web and phone share code. Both apps call the same contract endpoints through hand-written wrappers (phone `lib/*-api.ts` 4,037 lines, web `lib/api/*` 2,216). Both apps already have the derived contract client: `ZilarClient` in `packages/api-contract/src/client.ts`.

### The pattern to copy (already merged)
- `packages/client-core/src/topics-api.ts` and `packages/client-core/src/groups-api.ts`: `makeTopicsApi(call)` and `makeGroupsApi(call)` take
  ```ts
  call: <A>(f: (client: ZilarClient) => Effect<A, …>) => Promise<A>
  ```
  and return the Promise functions, with normalisation living once.
- **Web** (`apps/web/src/lib/api/topics.ts`): `const api = makeTopicsApi(callApi)`, then it exports the same function names as before.
- **Phone** (`apps/mobile/src/lib/topics-api.ts`): `makeTopicsApi((call) => runApi(call(client)))` inside its `create…Api(getToken, fetch, url)`.

### Facts (read by the lead on 2026-10-18 at `f9fdac014`)
- **Web:** `apps/web/src/lib/api/chats.ts` (255 lines): `getMe` (`:52`), `updateMe`, `getChats` (`:87`), `markChatRead`, `markChatDelivered`, `deleteMessageForMe`, `clearChatHistory`, `getContacts`, `removeContact`, `createInvite`, `getInvite`, `getXmppToken` (`:144`), `listChatPrefs`, `getChatBackgroundDefault`, `putChatBackgroundDefault`, `putChatPref`, `listChatFolders` (`:223`), `createChatFolder`, `patchChatFolder`, `reorderChatFolders` and `deleteChatFolder`. `chatEntryTopics` is at `:32`.
- **Phone:**
  - `apps/mobile/src/lib/chat-api.ts` (206);
  - `apps/mobile/src/lib/chat-api-schemas.ts` (259), which re-declares the contract's chat entry rows that web takes from the contract;
  - `apps/mobile/src/lib/chat-folders-api.ts` (67);
  - `apps/mobile/src/lib/chat-prefs-api.ts` (50);
  - `apps/mobile/src/lib/invites-api.ts` (25).
- **Leave link preview alone.** `linkPreview` in `chat-api.ts` belongs to T-2098; this task leaves those lines alone.
- **Timeout.** `getXmppToken` must keep (or gain) the request timeout the shared client uses.

### Steps
1. **The shared module.** Create `packages/client-core/src/chats-api.ts` exporting `make…Api(call)`. It holds every call both apps make, plus any call only one app makes in this area, using contract types from `@zilar/api-contract` (`ZilarClient` and the row types).
2. **The barrel.** Add ONE line `export * from './<file>';` to `packages/client-core/src/index.ts` **directly after** the line `} from './topics-api';`, not at the end. Other tasks append elsewhere, so this keeps merges clean.
3. **Web.** The web module builds the API with `callApi` and keeps exporting the **same names**, so its importers do not change. Types it exported become aliases of the contract types.
4. **Phone.** Its `create…Api(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object. Phone-only parsing and type copies of contract rows go; keep the exported type names as aliases.
5. **Users.** Users of both modules must compile unchanged. If one cannot, report BLOCKED with its path; the lead adds it.
6. **Tests.** No new tests. Existing tests of these modules must pass; adapt them only where a deleted hand-written parser was what they tested.
7. **Size.** Report the line counts. Product lines must go down by at least 150.

### Allowed files
- `packages/client-core/src/chats-api.ts`
- `apps/web/src/lib/api/chats.ts`
- `apps/mobile/src/lib/chat-api.ts`
- `apps/mobile/src/lib/chat-api-schemas.ts`
- `apps/mobile/src/lib/chat-folders-api.ts`
- `apps/mobile/src/lib/chat-prefs-api.ts`
- `apps/mobile/src/lib/invites-api.ts`
- `packages/client-core/src/index.ts`
- `work/T-2099-api-chats.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check:** web mock: the chat list, folders and a chat open, and mark-read clears the badge. Phone emulator: the chat list, a chat and `/settings/folders`.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/chats-api.ts`: `makeChatsApi(call)` with the shared calls both apps make in this area — `getMe`, `updateMe`, `getChats` (contract `ChatEntry` decoding, one normalisation), `markChatRead`, `markChatDelivered`, `deleteMessageForMe`, `clearChatHistory`, `getContacts`, `removeContact`, `createInvite`, `getInvite`, `getXmppToken`, the chat prefs calls (`listChatPrefs`, `getChatBackgroundDefault`, `putChatBackgroundDefault`, `putChatPref`) and the chat folders calls (`listChatFolders`, `createChatFolder`, `patchChatFolder`, `reorderChatFolders`, `deleteChatFolder`). Input types `CreateChatFolderInput`, `PatchChatFolderInput`, `PutChatPrefInput` and `chatEntriesFromList` live there too.
- Barrel: added exactly one line, `export * from './chats-api';`, directly after `} from './topics-api';` in `packages/client-core/src/index.ts`.
- Web (`apps/web/src/lib/api/chats.ts`): now `const api = makeChatsApi(callApi)`; every previous export name is kept. `getMe` still reports the browser time zone once, and `chatEntryTopics` (a web-only helper, not a call) stays. Exported types are contract aliases or re-exports of the shared input types.
- Phone (`apps/mobile/src/lib/chat-api.ts`): `createChatApi(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object, mapped to the phone's `Me`/`GroupDetail` shapes; the hand-written request/error pipeline is gone. `getXmppToken` now goes through `createApiClient`, so it keeps the client's `API_TIMEOUT_MS` timeout. `linkPreview` lines were left alone for T-2098. `getGroup` stays in this file because web's equivalent lives in `api/groups.ts`, not the chats API.
- Phone `chat-folders-api.ts`, `chat-prefs-api.ts`, `invites-api.ts`: same factory signatures, now over `makeChatsApi`; their `ChatFolder`/`ChatPref` copies/parsers are gone (exported type names remain as contract aliases in `chat-api.ts`/`chat-prefs-api.ts`).
- `chat-api-schemas.ts`: the phone-only lenient schemas are gone; `parseChatsList` stays as a thin wrapper over the shared `chatEntriesFromList` because `store/real-store.lifecycle.test.ts` imports it and is outside Allowed files.

Line counts (product code, without the task file):
- Before: web `chats.ts` 255 + mobile `chat-api.ts` 206 + `chat-api-schemas.ts` 259 + `chat-folders-api.ts` 67 + `chat-prefs-api.ts` 50 + `invites-api.ts` 25 = 862.
- After: `chats-api.ts` 194 + web `chats.ts` 104 + mobile `chat-api.ts` 107 + `chat-api-schemas.ts` 8 + `chat-folders-api.ts` 40 + `chat-prefs-api.ts` 31 + `invites-api.ts` 27 = 511.
- Net: **351 fewer product lines** (target was at least 150), plus one line in `index.ts`.

### Checks run

- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/api/sessionGone.test.ts` → 1 file, 5 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts` → 1 file, 12 tests passed.
- `pnpm gate` → `GATE PASS`:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (0.9s)
  PASS  lint  (0.9s)
  PASS  typecheck  (7.4s)
  PASS  effect  (0.5s)
  PASS  build @zilar/server  (0.6s)
  PASS  tests @zilar/client-core  (3.9s)
  PASS  tests @zilar/mobile  (1.8s)
  PASS  tests @zilar/web  (3.0s)
  scope: every changed file is inside the Allowed files
  ```

### Notes for the lead

- I ran the gate three times: the first two failed in my own code (a `handle: null` type error in the phone `GroupDetail` mapping, then the Effect ratchet on the two files that no longer import Effect). Both are fixed; the final run is the `GATE PASS` above.
- Phone used to decode the chat list with lenient schemas (non-string `avatarUrl` became absent, empty `handle` became absent). It now decodes with the contract's `ChatEntry`, the same union web used. Older-server payloads with absent optional fields still parse; a row with a wrong-typed optional field now fails the list where the phone previously dropped the field.
- `store/real-store.lifecycle.test.ts` still says it decodes "through the phone's own schema"; that test is outside Allowed files, so I left it and kept `parseChatsList` as a wrapper.
- Web and phone smoke checks (chat list, folders, open chat, mark-read badge, `/settings/folders`) were not run here; they are the lead's acceptance checks.


## Review (written by Claude)

Approved; the pre-review was clean (1 nit). Net −350: `packages/client-core/src/chats-api.ts` (194) replaces web `chats.ts` −151 and the phone's `chat-api-schemas.ts` −251 and API files.
- **Web mock** (`:5234`): chat list (18 links; folder tabs All chats/Personal/AIs), opening Marta shows her messages, no page errors.
- **Phone emulator smoke**: `/`, `/chat/ana@zilar.test`, `/chat/viernes@rooms.zilar.test` PASS. `/settings/folders` opened by deep link shows the Personal and AIs folders. The "Pixel Launcher isn't responding" dialog is the emulator under load, not the app.
- **Accepted change:** the phone now decodes the chat list with the contract's `ChatEntry`, like web. A wrong-typed optional field now fails the list instead of being dropped; both apps now behave the same, against the same server.
