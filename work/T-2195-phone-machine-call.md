---
id: T-2195
title: "Phone: setting an AI's home machine uses the shared contract call; the hand-written phone request and lib/machines-api.ts go; no behaviour change"
status: merged
milestone: M5
branch: task/T-2195-phone-machine-call
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2195: Phone uses the shared AI-machine call

## Spec (written by Claude, do not edit)

### Why
`docs/ARCHITECTURE.md`: "Never write a second hand-written client in an app." The phone still sends `PUT /api/ais/:id/machine` through its own `rawRequest` (fetch, token, error mapping, decoding: about 50 lines). The contract already has this endpoint, and client-core already has the call the web uses.

### Facts (the lead read these on 2026-10-19)
1. `packages/api-contract/src/ais.ts:231-235`: `assignMachine`, `PUT /ais/:id/machine`. It answers with `PublicAi`, which carries `machineId` (`:93`).
2. `packages/client-core/src/ais-api.ts:128-135`: `makeAisApi(call).setAiMachine(aiId, machineId): Promise<PublicAi>`. The web uses it (`apps/web/src/lib/api/ais.ts:33`, `AiPanel.tsx:227`).
3. `packages/client-core/src/settings-api.ts:66` and `:120`: the shared `makeMachinesApi(call)` and `MachinesApi`.
4. `apps/mobile/src/lib/machines-api.ts` (84 lines) adds `setAiMachine` to the shared machines API through a hand-written `rawRequest` that returns `machineId`. Its importers:
   - `apps/mobile/src/app/ais/[id].tsx:16`, `:346`, `:424`, `:449` and `applyMachineChange` at `:661-680`, which expects `Promise<string | null>`;
   - `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx:40`, `:486`, `:492-493`;
   - `apps/mobile/src/components/machines/use-machines-list.ts:6`, `:13`.
5. The same two files also call `useApi(makeAisApi)` twice for one API:
   - `ais/[id].tsx:344-345` (`api` and `connectionsApi`);
   - `new-ai-sheet.tsx:485` and `:487`.

### Steps
1. Delete `apps/mobile/src/lib/machines-api.ts`. Each importer takes `makeMachinesApi` and `MachinesApi` from `@zilar/client-core` instead; `useApi` already accepts a maker that takes only `call`.
2. `ais/[id].tsx`:
   - `applyMachineChange` takes the AIs API (`api` from `useApi(makeAisApi)`) and calls `api.setAiMachine(aiId, next)`, mapping the answer to its `machineId`, so the picker shows the server's value exactly as now;
   - drop the second `useApi(makeAisApi)` and use `api` where `connectionsApi` is used.
3. `new-ai-sheet.tsx`:
   - `setAiMachine` comes from `api` (the AIs API) and `listMachines` from the shared machines API;
   - drop the second `useApi(makeAisApi)`.
4. Error text stays the same: `describeMachinesError` already takes any `ApiError`.
5. Change no other behaviour, and add no tests.

### Allowed files
- `apps/mobile/src/lib/machines-api.ts` (delete)
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/machines/use-machines-list.ts`
- `apps/mobile/src/components/machines/mutations.ts` (its `MachinesApi` type import at `:3`; the lead added it at 07:35)
- `work/T-2195-phone-machine-call.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git grep -n "lib/machines-api" -- apps` finds nothing.
- Phone emulator, mock mode, checked by the lead: Edit Dev-1 shows the Computer picker and the machines, and changing the home machine sticks. Settings → Machines lists the machines. The New AI sheet opens.
- Product lines are at least 50 lower.

---

## Report (written by the worker when done)

### What I did

- Deleted `apps/mobile/src/lib/machines-api.ts`: its hand-written `rawRequest` (fetch,
  token, error mapping, decoding) is gone.
- `apps/mobile/src/app/ais/[id].tsx`: `applyMachineChange` now takes the AIs API
  (`ReturnType<typeof makeAisApi>`) and calls the shared `api.setAiMachine`, mapping the
  `PublicAi` answer to `fresh.machineId ?? null` so the picker still shows the server's
  value. Dropped the second `useApi(makeAisApi)`; the connections query uses `api`.
  `machinesApi` now comes from the shared `makeMachinesApi`.
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`: the flow port spreads the
  AIs `api` (so `setAiMachine` comes from it) and takes `listMachines` from the shared
  machines API. Dropped the second `useApi(makeAisApi)`.
- `apps/mobile/src/components/machines/use-machines-list.ts`: uses the shared
  `makeMachinesApi`.
- `apps/mobile/src/components/machines/mutations.ts`: `MachinesApi` type now comes from
  `@zilar/client-core` (the lead added this file to Allowed files).
- Error text is unchanged (`describeMachinesError` still handles the failure), and no
  tests were added, per the spec.

### Commands and results

- `pnpm install` — completed successfully.
- `pnpm gate` — first run failed only on `format` (`apps/mobile/src/app/ais/[id].tsx`);
  ran `pnpm exec prettier --write` on that file and reran. Second run:
  ```text
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.7s)
  PASS  lint  (1.6s)
  PASS  typecheck  (5.5s)
  PASS  effect  (1.7s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (3.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  WARN  size: apps/mobile/src/app/ais/[id].tsx: 741 lines (main 743); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  WARN  size: apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx: 627 lines (main 628); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
- `git grep -n "lib/machines-api" -- apps` — no output (nothing found).
- `git diff main --numstat` on the five files — net **-87 lines** (84 of them the deleted
  module), so the product-line target is met.

### Files changed

- `apps/mobile/src/lib/machines-api.ts` (deleted, 84 lines)
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/machines/use-machines-list.ts`
- `apps/mobile/src/components/machines/mutations.ts`
- `work/T-2195-phone-machine-call.md`

### Deviations from the spec

- None. The one file missing from the original Allowed list (`mutations.ts`) was added by
  the lead before this work, and only its type import changed.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −85.

**What changed:**
- `apps/mobile/src/lib/machines-api.ts` is gone (its hand-written `PUT /ais/:id/machine` request).
- Edit AI and the New AI sheet set the home machine with client-core's `makeAisApi().setAiMachine`, the contract's `assignMachine` call the web already uses. The picker shows the answer's `machineId`.
- The machines list and its mutations take the shared `makeMachinesApi` and `MachinesApi` from client-core.
- The duplicate `useApi(makeAisApi)` calls went.

**Phone emulator smoke passed:**
- the AIs tab, Settings → Machines, and Edit Dev-1;
- switching the home machine from dev-mac to the platform greys out Machine and Auto ("Pick a machine first"); switching back to dev-mac turns them on again;
- the New AI sheet opens.
