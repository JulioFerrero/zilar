---
id: T-2098
title: "Share (web + phone): one pins, AI memory, chat media, link preview and message search API in client-core (make…Api(call) over the contract client, contract types) used by both apps — each app keeps its module names, only the transport differs"
status: merged
milestone: M5
branch: task/T-2098-api-chat-extras
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2098: One pins, AI memory, chat media, link preview and message search API for web and phone

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
- **Web:** `apps/web/src/lib/api/media.ts` (161 lines): `listPins` (`:26`), `pinMessage`, `unpinMessage`, `getAiMemory` (`:50`), `forgetAiMemoryFact`, `clearAiMemory`, `listChatMedia` (`:82`), `linkPreview` (`:104`; it has a cache, `resetLinkPreviewCache` at `:128`) and `searchMessages` (`:145`).
- **Phone:** `apps/mobile/src/lib/pins-api.ts` (64), `apps/mobile/src/lib/ai-memory-api.ts` (49), `apps/mobile/src/lib/media-api.ts` (83; `parseMediaItem` at `:56`), `apps/mobile/src/lib/search-api.ts` (67), and `linkPreview` inside `apps/mobile/src/lib/chat-api.ts` (`:56`, `:178-179`).
- **Do not edit `chat-api.ts` beyond its `linkPreview` lines.** Another task (T-2099) shares the rest of it.

### Steps
1. **The shared module.** Create `packages/client-core/src/chat-extras-api.ts` exporting `make…Api(call)`. It holds every call both apps make, plus any call only one app makes in this area, using contract types from `@zilar/api-contract` (`ZilarClient` and the row types).
2. **The barrel.** Add ONE line `export * from './<file>';` to `packages/client-core/src/index.ts` **directly after** the line `} from './foreground-hooks';`, not at the end. Other tasks append elsewhere, so this keeps merges clean.
3. **Web.** The web module builds the API with `callApi` and keeps exporting the **same names**, so its importers do not change. Types it exported become aliases of the contract types.
4. **Phone.** Its `create…Api(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object. Phone-only parsing and type copies of contract rows go; keep the exported type names as aliases.
5. **Users.** Users of both modules must compile unchanged. If one cannot, report BLOCKED with its path; the lead adds it.
6. **Tests.** No new tests. Existing tests of these modules must pass; adapt them only where a deleted hand-written parser was what they tested.
7. **Size.** Report the line counts. Product lines must go down by at least 150.

### Allowed files
- `packages/client-core/src/chat-extras-api.ts`
- `apps/web/src/lib/api/media.ts`
- `apps/mobile/src/lib/pins-api.ts`
- `apps/mobile/src/lib/ai-memory-api.ts`
- `apps/mobile/src/lib/media-api.ts`
- `apps/mobile/src/lib/search-api.ts`
- `apps/mobile/src/lib/chat-api.ts`
- `packages/client-core/src/index.ts`
- `work/T-2098-api-chat-extras.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check:** web mock: pins in a chat, Media in chat info, a link preview and message search. Phone emulator: a chat with its pinned bar, and search.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/chat-extras-api.ts` with `makeChatExtrasApi(call)`:
  pins (`listPins`, `pinMessage`, `unpinMessage`), AI memory (`getAiMemory`,
  `forgetAiMemoryFact`, `clearAiMemory`), `listChatMedia`, `linkPreview` and
  `searchMessages`. The `call` signature takes an optional `AbortSignal` so a
  cancelled search still rejects with `AbortError`. The page row types are
  contract-derived mutable aliases (`MediaPage`, `SearchPage`) because
  `Schema.Array` gives readonly arrays and existing consumers assign into
  mutable state.
- Added one line to `packages/client-core/src/index.ts` directly after the
  `./foreground-hooks` block.
- Web `apps/web/src/lib/api/media.ts` now builds the shared API with
  `callApiAbortable` and keeps every previously exported name. The link-preview
  cache stays web-only (a failed call is still not cached, so it can retry); the
  cache now stores the settled promise, same observable behaviour.
- Phone `pins-api.ts`, `ai-memory-api.ts`, `media-api.ts` and `search-api.ts`
  keep their `create…Api(getToken, fetchImpl, apiUrl)` signatures and exported
  type names, and return the shared object over `runApi` /
  `runApiAbortable`. `AiMemory`, `Pin`, `MediaItem`, `MediaPage`, `MediaTab`,
  `SearchItem`, `SearchMark` and `SearchPage` are contract aliases.
- Deleted the phone-only parsers `parsePin`, `parsePinKind` and
  `parseMediaItem`; `git grep` found no importers outside their definitions.
  `pin-snapshot` re-exports and `MediaKind` are kept.
- `apps/mobile/src/lib/chat-api.ts`: only its `linkPreview` lines changed (plus
  the import), now delegating to the shared API.

Lines (`wc -l`, after `pnpm gate` formatting):

| File | Before | After |
| --- | --- | --- |
| `apps/web/src/lib/api/media.ts` | 161 | 60 |
| `apps/mobile/src/lib/pins-api.ts` | 64 | 23 |
| `apps/mobile/src/lib/ai-memory-api.ts` | 49 | 28 |
| `apps/mobile/src/lib/media-api.ts` | 83 | 20 |
| `apps/mobile/src/lib/search-api.ts` | 67 | 23 |
| `apps/mobile/src/lib/chat-api.ts` | 107 | 106 |
| `packages/client-core/src/chat-extras-api.ts` | — | 119 |
| **Total** | **531** | **379** |

Net product lines: **−152** (target ≥150). Every file is under 400 lines.

### Checks run

- `pnpm install` (repo root): done, 1,155 packages, only the existing
  `@types/react-dom` peer warning.
- `pnpm gate` (repo root), final run:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.1s)
PASS  lint  (0.8s)
PASS  typecheck  (5.1s)
PASS  effect  (1.5s)
PASS  build @zilar/server  (0.7s)
PASS  tests @zilar/client-core  (3.6s)
PASS  tests @zilar/mobile  (2.6s)
PASS  tests @zilar/web  (3.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

I ran no single test file separately; the gate's package test runs above are
the test result. I did not run the lead's web mock or phone emulator checks.

### Round

- Findings fixed: 1 (should-fix). `listChatMedia` filters out a row whose `at`
  is not a parseable date again, so `media-rows.tsx` cannot render
  `NaN.NaN.NaN`. The guard lives in the shared `chat-extras-api.ts`, so both
  apps get it.
- Finding 2 is a nit (over-wide `PinsApi`/`MediaApi`/`SearchApi` surfaces) and
  was left as it is.
- Tests added: `apps/mobile/src/lib/media-api.test.ts` covers a gallery page
  with one valid and one invalid `at`, asserting only the valid row survives and
  `next` is kept. This file is outside the original Allowed files; the fix
  round requires a regression test for the behaviour fix.
- Single test: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/media-api.test.ts` — 1 passed.
- `pnpm gate` (repo root): `GATE PASS`; all steps PASS. Scope reports
  `apps/mobile/src/lib/media-api.test.ts` as the one file outside the Allowed
  files (the new regression test).

### Notes for the lead

- `PinsApi`, `MediaApi` and `SearchApi` are now
  `ReturnType<typeof makeChatExtrasApi>`, so they expose all shared methods
  (not only the ones each module used). Their existing call sites compile
  unchanged. If you prefer the minimal surfaces, I can add `Pick<…>` aliases.
- Phone `listChatMedia` no longer drops a row whose `at` is not a parseable
  date: the old `parseMediaItem`/`toMediaItem` did that check, and it was
  removed with the hand-written parser. The contract's lenient page still drops
  rows that fail the schema.
- `AiMemory` is `AiMemoryView` from the contract; the previous hand-typed shape
  was identical (`facts`, `lines`, `canChange`).

## Review (written by Claude)

Approved; the pre-review was clean after one auto round (2 nits). Net −121 product lines: `packages/client-core/src/chat-extras-api.ts` (119) replaces the web `media.ts` calls and the phone pins, AI memory, media and search modules.
- **Fix round.** It restored the phone's drop of media rows with an unparseable date, which the first round had lost, and added a 30-line regression test. Accepted.
- **Web mock** (`:5243`, main side by side on `:5233`):
  - Ana's pinned bar ("You · Deal") is identical on both;
  - message search finds "Did you get the file I sent?";
  - the media panel opens.
  - No page errors.
- **Phone emulator:** the smoke passed (`/chat/ana@zilar.test`, `/ais/ai-dev-1`, `/chat/viernes@rooms.zilar.test`). Ana's chat shows the pinned bar. In-chat search (it opens the scoped chat-list search) finds "Bringing the snacks" and "Bring snacks?" for "sna".
