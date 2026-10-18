---
id: T-2096
title: "Share (web + phone): one AIs and connections API in client-core (make…Api(call) over the contract client, contract types) used by both apps — each app keeps its module names, only the transport differs"
status: merged
milestone: M5
branch: task/T-2096-api-ais
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2096: One AIs and connections API for web and phone

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
- **Web:** `apps/web/src/lib/api/ais.ts` (229 lines). The AI and connection calls run from `listAis` (`:47`) to `replaceConnectionKey` (`~:178`): `getAi`, `getAiCatalog`, `getComputerOptions`, `createAi`, `updateAi`, `deleteAi`, `stopAi`, `resumeAi`, `stopAiTurn`, `setAiMachine`, `listConnections`, `createConnection`, `testConnection` and `deleteConnection`. The approvals calls after them stay in web for now.
- **Phone:** `apps/mobile/src/lib/ais-api.ts` (186) and `apps/mobile/src/lib/connections-api.ts` (86).
  - `ais-api.ts` hand-declares `PublicAi`, `Connection`, `CreateAiInput` and `UpdateAiInput` (`:16-77`), which the contract already has as `PublicAi` and `ConnectionView`. It also has `buildCreateBody` (`:95`) and `createAisApi(getToken, fetchImpl, apiUrl)` (`:127`).

### Steps
1. **The shared module.** Create `packages/client-core/src/ais-api.ts` exporting `make…Api(call)`. It holds every call both apps make, plus any call only one app makes in this area, using contract types from `@zilar/api-contract` (`ZilarClient` and the row types).
2. **The barrel.** Add ONE line `export * from './<file>';` to `packages/client-core/src/index.ts` **directly after** the line `} from './people-handle-search';`, not at the end. Other tasks append elsewhere, so this keeps merges clean.
3. **Web.** The web module builds the API with `callApi` and keeps exporting the **same names**, so its importers do not change. Types it exported become aliases of the contract types.
4. **Phone.** Its `create…Api(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object. Phone-only parsing and type copies of contract rows go; keep the exported type names as aliases.
5. **Users.** Users of both modules must compile unchanged. If one cannot, report BLOCKED with its path; the lead adds it.
6. **Tests.** No new tests. Existing tests of these modules must pass; adapt them only where a deleted hand-written parser was what they tested.
7. **Size.** Report the line counts. Product lines must go down by at least 150.

### Allowed files
- `packages/client-core/src/ais-api.ts`
- `apps/web/src/lib/api/ais.ts`
- `apps/mobile/src/lib/ais-api.ts`
- `apps/mobile/src/lib/connections-api.ts`
- `packages/client-core/src/index.ts`
- `work/T-2096-api-ais.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check:** web mock: `/settings/ais` lists the three AIs and the Connections page lists keys. Phone emulator: `/ais` and `/settings/connections`.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/ais-api.ts` exporting `makeAisApi(call)`. It holds every AI and
  connection call both apps make plus the web-only `getAi` and `setAiMachine`: `listAis`, `getAi`,
  `getAiCatalog`, `getComputerOptions`, `createAi`, `updateAi`, `deleteAi`, `stopAi`, `resumeAi`,
  `stopAiTurn`, `setAiMachine`, `listConnections`, `createConnection`, `testConnection`,
  `deleteConnection`, `replaceConnectionKey`. Trimming, the provider check and the shared input
  types (`CreateAiInput`, `UpdateAiInput`, `CreateConnectionInput`, `ConnectionTestResult`,
  `PublicAi`, `Connection`) live there once.
- Added one line `export * from './ais-api';` to `packages/client-core/src/index.ts`, directly
  after the `} from './people-handle-search';` export.
- Web (`apps/web/src/lib/api/ais.ts`): builds `const api = makeAisApi(callApi)` and destructures
  the same function names as before, so importers are unchanged. Exported types are re-exported
  from `@zilar/client-core`. The approvals code after `replaceConnectionKey` is untouched.
- Phone (`apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/lib/connections-api.ts`): both
  `create…Api(getToken, fetchImpl, apiUrl)` keep their signatures, build the client and return
  `makeAisApi((call) => runApi(call(client)))`. Deleted the hand-written `PublicAi`/`Connection`
  copies, `toPublicAi`, and the unused `buildCreateBody` and `buildCreateConnectionBody`. Exported
  type names are kept as aliases (`PublicAi`, `Connection`, `ProviderConnection`, `AiTemplate`,
  `AiLimits`, `CreateAiInput`, `UpdateAiInput`, `CreateConnectionInput`,
  `ConnectionTestResult`).
- No user of either module needed a change. No new tests.
- Size (raw `wc -l`): before `229 + 186 + 86 = 501`; after `90 + 47 + 35 + 168 = 340` plus
  one barrel line, so **160 lines down**.

### Checks run

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/connections/use-key-check.test.ts`
  → 1 file, 2 tests passed.
- `pnpm gate`:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (1.3s)
PASS  lint  (1.3s)
PASS  typecheck  (6.8s)
PASS  effect  (1.1s)
PASS  build @zilar/server  (1.3s)
PASS  tests @zilar/client-core  (3.5s)
PASS  tests @zilar/mobile  (3.0s)
PASS  tests @zilar/web  (6.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Notes for the lead

- Deviation: `ConnectionTestResult` in the shared module is the local structurally wider
  `{ ok: boolean; message?: string }` rather than an alias of the contract's discriminated union.
  `apps/web/src/components/connections/ConnectionRow.tsx` reads `state.value.message` after only
  checking `.ok`, which the contract union rejects with `ok: true`; that file is outside this
  task's Allowed files, so I kept the compatible shape.
- `PublicAi` stays a mutable mapped alias of the contract `PublicAi` (as web already had), so
  existing state updates like `{ ...ai, machineId }` still typecheck on both apps.
- The phone `AisApi` and `ConnectionsApi` interfaces still declare only the methods each screen
  used; the shared object carries the superset, which is assignable.
- No secrets printed or logged; `createConnection` keeps sending the key only in the POST body.


## Review (written by Claude)

Approved; the pre-review was clean (1 nit). Net −160: `packages/client-core/src/ais-api.ts` (168) replaces the hand-written web and phone AI and connection calls and the phone's copies of the contract types.
- **Web mock** (`:5235`): `/settings/ais` lists Dev-1, QA-1 and Marketing AI with their states, and `/settings/connections` lists the three keys. No page errors.
- **Phone emulator smoke**: `/ais`, `/settings/connections` and `/ais/ai-dev-1` all PASS; the AIs screenshot shows the three AIs with their costs and states.
- **Deviation accepted:** `ConnectionTestResult` stays `{ ok; message? }`, because web `ConnectionRow` reads `.message` after checking only `.ok`.
