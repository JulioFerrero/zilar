---
id: T-2121
title: "Share (web + phone): one tools, routines and approvals API in client-core (make…Api(call) over the contract client, contract types) used by both apps — each app keeps its module names, only the transport differs"
status: merged
milestone: M5
branch: task/T-2121-api-tools
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2121: One tools, routines and approvals API for web and phone

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
- **Web tools and routines:** `apps/web/src/lib/tools.ts` (105 lines). It has `listTopicToolDetails` `:19`, `listGroupToolDetails` `:25`, `listAiToolDetails` `:31`, `getToolDetail` `:36`, `listToolVersions` `:41`, `getToolVersion` `:46`, `listToolRuns` `:51`, `revertTool` `:57`, `runToolNow` `:63`, `deleteTool` `:69`, `listMyRoutines` `:74`, `listAiRoutines` `:80`, `listGroupRoutines` `:86`, `pauseRoutine` `:92`, `resumeRoutine` `:98` and `deleteRoutine` `:103`. It already uses contract types (`:15`).
- **Web approvals:** in `apps/web/src/lib/api/ais.ts`: `getApproval` `:52`, `listApprovals` `:56`, `decideApproval` `:61`, `listAiApprovalRules` `:78`, `listGroupApprovalRules` `:83` and `revokeApprovalRule` `:88`.
- **Phone tools and routines:** `apps/mobile/src/lib/tools-api.ts` (212 lines). It hand-declares `ToolListItem`, `ToolDetail`, `ToolVersion`, `ToolVersionDetail`, `ToolRun`, `ToolRunResult` and `Routine` at `:10-106`; these are copies of `packages/api-contract/src/tools.ts:7-51` and `routines.ts:7`. It declares the `ToolsApi`, `ToolDetailsApi`, `RoutineActionsApi` and `ToolActionsApi` interfaces at `:108-150`, and `createToolsApi` at `:151`.
- **Phone approvals:** `apps/mobile/src/lib/approvals-api.ts` (145 lines). It hand-declares `PublicApproval` and `ApprovalRule` (copies of `packages/api-contract/src/approvals.ts:35,64`), plus `buildDecisionBody` `:66` and `createApprovalsApi` `:110`.
- **Phone importers** that must compile unchanged:
  - of `tools-api`: `app/settings/routines.tsx`, `components/ais/routines-section.tsx`, `components/ais/tool-detail-body.tsx`, `components/ais/tool-detail-loader.tsx`, `components/ais/tools-section.tsx`, `components/ais/use-routine-actions.ts`, `components/ais/use-tools-api.ts`, `components/group-info/tools-page.tsx`;
  - of `approvals-api`: `app/settings/approvals.tsx`, `components/approvals/always-allowed-row.tsx`, `components/approvals/rows.ts`, `components/chat/approval-card.tsx`, `components/chat/use-approvals-api.ts`, `components/group-info/allowed-page.tsx`.

### Steps
1. **The shared module.** Create `packages/client-core/src/tools-api.ts` exporting `make…Api(call)`. It holds every call both apps make, plus any call only one app makes in this area, using contract types from `@zilar/api-contract` (`ZilarClient` and the row types).
2. **The barrel.** Add ONE line `export * from './<file>';` to `packages/client-core/src/index.ts` **directly after** the line `export * from './ais-api';`, not at the end. Other tasks append elsewhere, so this keeps merges clean.
3. **Web.** The web module builds the API with `callApi` and keeps exporting the **same names**, so its importers do not change. Types it exported become aliases of the contract types.
4. **Phone.** Its `create…Api(getToken, fetchImpl, apiUrl)` keeps its signature and returns the shared object. Phone-only parsing and type copies of contract rows go; keep the exported type names as aliases.
5. **Users.** Users of both modules must compile unchanged. If one cannot, report BLOCKED with its path; the lead adds it.
6. **Tests.** No new tests. Existing tests of these modules must pass; adapt them only where a deleted hand-written parser was what they tested.
7. **Size.** Report the line counts. Product lines must go down by at least 150.

### Allowed files
- `packages/client-core/src/tools-api.ts`
- `apps/web/src/lib/tools.ts`
- `apps/web/src/lib/api/ais.ts`
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/lib/approvals-api.ts`
- `apps/mobile/src/components/ais/use-tools-api.ts`
- `apps/mobile/src/components/chat/use-approvals-api.ts`
- `apps/mobile/src/components/approvals/rows.ts`
- `apps/mobile/src/components/approvals/rows.test.ts`
- `apps/mobile/src/lib/tools-api.test.ts`
- `apps/mobile/src/lib/approvals-api.test.ts`
- `packages/client-core/src/index.ts`
- `work/T-2121-api-tools.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check:** web mock: an AI's Tools and Routines sections list items, `/settings/approvals` lists the pending approval and approving it works; phone emulator: the same three screens.

---

## Report (written by the worker when done)

### What I did
- Added `packages/client-core/src/tools-api.ts` with `makeToolsApi(call)` and `makeApprovalsApi(call)`, holding every tools, routines and approvals call both apps make (including phone-only topic routines/tools and approval-rule reads). All types come from `@zilar/api-contract`; the contract's decoding defaults already supply `aiName`, `alwaysEligible`, `topicId` and `topicName`, so the hand-written normalisers are gone.
- Added `export * from './tools-api';` to the client-core barrel directly after `export * from './ais-api';`.
- Web `lib/tools.ts` now builds `makeToolsApi(callApi)` and re-exports the same function names via destructuring aliases; `lib/api/ais.ts` builds `makeApprovalsApi(callApi)` and keeps `getApproval`, `listApprovals`, `decideApproval`, `listAiApprovalRules`, `listGroupApprovalRules`, `revokeApprovalRule` plus the two legacy schema aliases.
- Phone `lib/tools-api.ts` and `lib/approvals-api.ts` keep their `create…Api(getToken, fetchImpl, apiUrl)` signatures and return the shared objects. The type copies are replaced with contract aliases; the exported interface names (`AiToolsApi`, `ToolsApi`, `ToolDetailsApi`, `ToolActionsApi`, `RoutineActionsApi`, `MyRoutinesApi`, `ApprovalsApi`) are derived from the shared return types, and the small literal types are derived from contract rows. No importer changed.
- Removed phone-only `toPublicApproval`/`toApprovalRule` and the unused `buildDecisionBody`.

Line counts (product lines, before → after):
- `apps/web/src/lib/tools.ts`: 105 → 34
- `apps/web/src/lib/api/ais.ts`: 90 → 58
- `apps/mobile/src/lib/tools-api.ts`: 212 → 52
- `apps/mobile/src/lib/approvals-api.ts`: 145 → 25
- new `packages/client-core/src/tools-api.ts`: 122
- Total: 552 → 291, **261 lines lower** (target was at least 150).

### Checks run
- `pnpm install` → done, install succeeded (peer-dependency warning about `@types/react-dom`/`@types/react` that already exists on main).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/approvals/rows.test.ts` → 1 test file passed, 3 tests passed.
- `pnpm gate` → **GATE PASS**:
  ```text
  PASS  install (frozen)  (2.2s)
  PASS  format  (0.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (6.2s)
  PASS  effect  (1.2s)
  PASS  build @zilar/server  (0.9s)
  PASS  tests @zilar/client-core  (5.1s)
  PASS  tests @zilar/mobile  (2.1s)
  PASS  tests @zilar/web  (6.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
  Earlier gate runs failed on prettier formatting (2 files), one unused import (`ToolRunResult`), and a missing local import for `ApprovalDecision`/`ApprovalStatus` in web `ais.ts`; each was fixed, then the gate passed as above.

### Notes for the lead
- No new tests were added, per the spec. The shared module has no direct test file in the allowed list; the existing mobile approvals tests and all package tests in the gate pass.
- Live UI acceptance (web mock Tools/Routines/approvals screens and the phone emulator) was **not** run by me; only typecheck, build and tests were run.
- The shared approvals API lives in `tools-api.ts` because the Allowed files list only that one new client-core file; it exports both `makeToolsApi` and `makeApprovalsApi`.
- The response shapes are unchanged: phone consumers still receive the contract rows with the same fields, and the contract client already applies the defaults the removed normalisers applied.

## Review (written by Claude)

Approved; the pre-review was clean (2 nits). Net −260 product lines: `packages/client-core/src/tools-api.ts` (122) replaces the hand-written types and calls in the phone's `tools-api.ts` and `approvals-api.ts` and the web's `lib/tools.ts` and approvals calls.
- **Behaviour note:** approval rows now carry `topicId` and `topicName` on the phone too. Its only user, `always-allowed-row.tsx`, already handles a missing value.
- **Web mock** (`:5249`, no page errors):
  - `/settings/approvals` lists "Merge PR #42", and Approve shows "Approved merge_pull_request";
  - `/settings/routines` lists Morning prices (running) and Standup notes (paused);
  - Dev team → Group info → Tools and routines lists the prices v2 and notes v2 tools and the routine.
- **Phone emulator:** the smoke passed (`/settings/approvals`, `/settings/routines`, `/ais/ai-dev-1`); tapping ✓ on the approval shows "Approved once".
