---
id: T-2120
title: "Share (web + phone): one New AI flow state in client-core (step order, name/template/model/orb/computer/machine/limits fields, create body, create-then-set-machine, partial-failure handling) used by the web useNewAiFlow and the phone use-new-ai-flow — each app keeps its UI, toasts and orb capture"
status: merged
milestone: M5
branch: task/T-2120-shared-new-ai-flow
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2120: One New AI flow for web and phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and web and phone share code. T-2093 (merged) moved the key step into `packages/client-core/src/key-check.ts`. The rest of the New AI flow is still written twice:
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts` (279 lines). `useNewAiFlow({ onClose, onCreated })` is at `:98`. Its state is at `:104-112`, the key-check wiring at `:113`, `create` at `:145` (it calls `buildCreateBody` with `defaultPersonaFor(template)`), and `primary`/`close` at `:201`/`:211`. It returns at `:224`.
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts` (260 lines). `useNewAiFlow({ onCreated })` is at `:33`. Its state is at `:41-56`, with named steps `'provider' | 'key' | 'model' | 'setup'` at `:29`. It has `catalogModels` at `:83`, `goToModel`/`advance` at `:93`/`:101`, `create(captureOrb)` at `:114` (it builds a `WizardForm` with `defaultPersonaFor(template)`), and `back`/`goToStep` at `:175`/`:181`.

Both keep the same fields (name, template, model, orb, computer mode, machine, day and month limits), the same step order, and the same create sequence: create the AI, then attach the machine, and report a partial failure.

### Steps
1. **The shared module.** Create `packages/client-core/src/new-ai-flow.ts`, exporting one React hook `useNewAiFlowState(port, options)`:
   - **What it holds:**
     - the step (one step list, `'provider' | 'key' | 'model' | 'setup'`, which web may map to its numbers);
     - the field state and their setters;
     - the catalog model list for the chosen provider;
     - advance, back and go-to-step;
     - building the create body;
     - the create sequence: create, then set the machine when one is chosen, then the partial-failure result, with a guard against double submit.
   - **The `port`** gives what differs: `createAi`, `setAiMachine` (or the shared machine-change call), `listMachines` and `getComputerOptions`.
   - **Use the T-2093 key check.** Build on `useKeyCheck` from `./key-check`, as both apps do today.
   - **Keep the app-specific parts in the apps:**
     - web toasts and its `describeAiError`;
     - the phone's `describeAisError` and its orb capture (`saveOrbAvatar`, `captureOrb`);
     - each app's sheet or dialog wiring (`onClose`).
2. **The barrel.** Add `export * from './new-ai-flow';` at the end of `packages/client-core/src/index.ts`.
3. **The apps.** Both hooks become thin wrappers over the shared hook and keep their exported names (`useNewAiFlow`, `NewAiFlow`, `NewAiStep`, `OrbParams`), so `NewAiDialog.tsx`, `OrbPicker.tsx`, `new-ai-sheet.tsx` and `orb-view.tsx` still compile. If one of those must change, keep the change to the minimum.
4. **No behaviour change** on either platform:
   - same steps, labels and defaults (persona from `defaultPersonaFor`, template `'dev'`, computer `'off'`);
   - same create and partial-failure handling;
   - same error texts.
5. **No new tests.** Report the line counts: web, phone, core and net.

### Allowed files
- `packages/client-core/src/new-ai-flow.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`
- `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/ais/new-ai/OrbPicker.tsx`
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/orb-view.tsx`
- `apps/mobile/src/components/ais/form.ts`
- `work/T-2120-shared-new-ai-flow.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 150 lower.
- **Lead check:**
  - **Web mock:** New AI runs through provider → key → model → setup and creates the AI, which appears in My AIs.
  - **Phone emulator:** the same flow in the New AI sheet.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/new-ai-flow.ts`: `useNewAiFlowState(port, options)` holds the step (`'provider' | 'key' | 'model' | 'setup'`), name/template/model/orb/computer/machine/day/month state and setters, catalog models and model options, advance/back/go-to-step, and the create sequence (create → app orb upload → machine → computer mode → partial-failure result), with a double-submit ref guard.
  - The port adds `createAi`, `updateAi`, `setAiMachine`, `listMachines` and `getComputerOptions` to the existing `KeyCheckPort`, so the hook builds on `useKeyCheck` from `./key-check`.
  - `canContinue` keeps web's strict provider readiness; `canAdvance` is the phone's looser provider rule (Continue enabled once a provider is picked, so `continueProvider` can show the fixed error).
  - Machines are filtered to `approved` in the hook (both UIs already only showed approved ones).
- Added `export * from './new-ai-flow';` to `packages/client-core/src/index.ts`.
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts` is now a wrapper over `makeAisApi(callApi)` plus `listMachines`. It keeps the numeric steps, orb PNG export and upload, the partial-failure toast, `describeAiError`, close/abandon and the existing exported names.
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts` is a wrapper over `AisApi` + `MachinesApi` + the connections API. It keeps `NewAiStep`, `OrbParams`, the orb capture (`saveOrbAvatar`), `describeAisError` and the existing fixed messages, plus the orb-sheet state.
- Removed the now-unused `buildCreateInput`/`WizardForm` from `apps/mobile/src/components/ais/form.ts`; its key-check re-exports stay (the test and `[id].tsx` use them).
- `NewAiDialog.tsx`, `OrbPicker.tsx`, `new-ai-sheet.tsx` and `orb-view.tsx` needed no changes.

Files changed:

- `packages/client-core/src/new-ai-flow.ts` (new)
- `packages/client-core/src/index.ts`
- `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`
- `apps/mobile/src/components/ais/form.ts`
- this task file

### Checks run

- `pnpm install`: Done in 12.6s, 1155 packages, no errors (one existing peer warning in `apps/mobile`).
- `pnpm gate` (from the repo root), final run:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.6s)
PASS  lint  (1.3s)
PASS  typecheck  (5.3s)
PASS  effect  (1.7s)
PASS  build @zilar/server  (1.6s)
PASS  tests @zilar/client-core  (11.8s)
PASS  tests @zilar/mobile  (4.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

- No manual web-mock or phone-emulator run (not available to me); those remain the lead checks. No new tests, as the spec says.

### Notes for the lead

Line counts (`wc -l`):

| File | Before | After |
| --- | --- | --- |
| `apps/web/src/components/ais/new-ai/useNewAiFlow.ts` | 279 | 117 |
| `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts` | 260 | 86 |
| `packages/client-core/src/new-ai-flow.ts` | — | 238 |
| **Hooks total** | **539** | **441** |
| `apps/mobile/src/components/ais/form.ts` | 19 | 12 |

- The two app hooks are **336 lines lower** (web −162, phone −174). Net, including the new shared module, is **−98** for the hooks (−105 with `form.ts`). That is below the spec's "at least 150 lower" if that number means net across shared + apps; the port/type/state declarations in the shared module account for the difference. I did not delete behaviour to reach the number.
- Behaviour notes:
  - `goToStep` refuses to move while a key check is running (the phone's existing rule); web previously allowed clicking back during a check.
  - The default orb seed is the trimmed name on both platforms; web's `OrbPicker` already trimmed its render seed, so only the default hue/rim of a whitespace-padded name differs.
  - The web orb PNG still uses the existing `Image` + canvas encoding, unchanged apart from being promise-based.
- The web port is built with the shared `makeAisApi(callApi)` rather than importing the same functions from `@/lib/api`; it is the same client instance and mock path, and avoids a second hand-written call table.

### Round 1 (fix round)

Findings fixed:

- **1 (must-fix):** the web create failure path again maps an `ApiError` with `status === 0` to the fixed `Could not create the AI` sentence before calling `describeAiError`, so an unsent create (`network_error`, `request_failed` or a status-0 `invalid_request`) no longer shows the `ApiError` message. `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`.
- **2 (should-fix):** the `setAiMachine` entry on `NewAiFlowPort` now documents its contract: the resolved value is ignored (the AIs API returns the updated AI, the machines API returns the machine id) and only a rejection counts as a partial failure. `packages/client-core/src/new-ai-flow.ts`.
- Nits 3 and 4: no code change. The `useEffect` dependency comment (3) is on a line this round did not touch; the line-count note (4) stays as reported above, with the net hooks figure of −98 (−105 with `form.ts`).

Tests added: none. The finding named no test, the Spec says "No new tests", and the Allowed files contain no test file for the web hook (the nearest existing test is the mobile key-check test that the pre-review already ran).

Gate (from the repo root) after the fixes:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (3.6s)
PASS  format  (1.6s)
PASS  lint  (2.7s)
PASS  typecheck  (22.8s)
PASS  effect  (4.3s)
PASS  build @zilar/server  (2.0s)
PASS  tests @zilar/client-core  (12.9s)
PASS  tests @zilar/mobile  (2.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

## Review (written by Claude)

Approved; the pre-review was clean after one auto round (2 nits). Net −91 overall: `packages/client-core/src/new-ai-flow.ts` (+243) replaces the duplicated flow state in the web `useNewAiFlow` (−162) and the phone `use-new-ai-flow` (−174).
- **Under the −150 target:** the worker kept every behaviour rather than cut to reach the number. Accepted.
- **One deliberate change:** stepping back while a key check runs is now blocked on the web too (the phone's rule).
- **Web mock** (`:5250`, no page errors): `/settings/ais` → New AI → OpenAI → saved key → name, GPT-4o mini, Dev → Setup (Off, no limits) → Create AI; "Night Test AI" appears in My AIs.
- **Phone emulator:** the smoke passed (`/ais`). The same flow on the phone (OpenAI → saved key → name "NightPhone", GPT-4o mini → Setup → Create AI) opens the new AI's chat, showing "gpt-4o-mini · OpenAI".
