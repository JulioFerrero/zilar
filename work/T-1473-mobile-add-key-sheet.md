---
id: T-1473
title: "Mobile Connections: Add key becomes the two-step kit sheet (Provider → Key) on a shared use-key-check hook extracted from the New AI flow, the twin of web T-1454; the old inline add form goes"
status: merged
milestone: M5
branch: task/T-1473-mobile-add-key-sheet
model: auto
effort: default
depends_on: [T-1445, T-1471]
estimate: 0.5 day
---

# T-1473: Mobile Add key sheet

## Spec (written by Claude, do not edit)

### Why
- **Parity with web T-1454:** web Connections adds a key through the same two-step dialog as New AI (`apps/web/src/components/connections/AddKeyDialog.tsx`, on the shared hook `apps/web/src/components/ais/new-ai/useKeyCheck.ts`, 229 lines). Mobile still shows the old inline `AddConnectionForm`.
- **File size:** the mobile New AI hook is at the 400-line limit, so its key-check part has to move out anyway. The design is the approved New AI canvas (Provider and Key steps).

### Facts (the lead read them on main `abb548cfe`, 2026-10-15)
- **`apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`** is 400 lines. Its key-check state:
  - `providerId`, `baseUrl`, `connectionName`, `providerError`, `keyValue`, `showKey` (`:75-80`);
  - `keyState` plus `keyStateRef` (`:81-82`), `keyMessage`, `checking` (`:87-88`);
  - `checkToken`, `keyCheckRef`, `closedRef` (`:104-107`).
- **It loads** connections, the catalog, options and machines in one `Promise.allSettled` (`:112-123`), and builds `choices` from the catalog and connections (`:138`).
- **The steps read the key-check fields from `flow`:**
  - `provider-step.tsx` reads `flow.providerChoices`, `providerId`, `selectProvider`, `isCompatible`, `baseUrl`, `setBaseUrl`, `keyVerified`, `connectionName`, `setConnectionName` and `providerError`;
  - `key-step.tsx` reads `flow.keyPageUrl`, `keyValue`, `setKeyValue`, `keyPlaceholder`, `showKey`, `toggleShowKey`, `keyVerified` and `keyMessage`.
- **`apps/mobile/src/app/settings/connections.tsx`** (137 lines) renders `AddConnectionForm` inline when `showForm` (`:122-130`). On save it prepends the created connection and hides the form.
  - `showForm` and `setShowForm` live in `apps/mobile/src/components/connections/use-connections.ts:30,149,157`.
  - `apps/mobile/src/components/connections/add-connection-form.tsx` (211 lines) and `save-connection.ts` (54 lines) are imported only by that path.
- **Web's dialog behaviour** (`AddKeyDialog.tsx:14-35`, `:52-80`):
  - Continue on Provider; on Key, Continue checks the key, and once it is verified the primary reads Save, and Save closes and refreshes;
  - Back returns to Provider;
  - closing before Save abandons, which deletes a connection the dialog created, verified or not (T-1469).

### What to build
1. **`apps/mobile/src/components/connections/use-key-check.ts`:** move the key-check state, refs and logic out of `use-new-ai-flow.ts` into this hook, mirroring web `useKeyCheck`.
   - It loads connections and the catalog.
   - It exposes choices, provider fields, key fields, `continueKey`/check, `keyVerified`, `connectionId`, `catalog` and `abandon`.
   - **Every T-1445 rule is kept as it is:**
     - compatible never preselects;
     - an edit after a check resets or deletes;
     - a provider switch deletes a flow-created verified key;
     - the double-tap guards;
     - a saved key is never deleted.
   - `use-new-ai-flow.ts` composes it, exposes it as `flow.keys`, and keeps the create guard: a close during Create does not discard (T-1445's last fix). It reads models from `keys.catalog` and loads only options and machines itself.
2. **The steps** `provider-step.tsx` and `key-step.tsx` take `keys` (the key-check hook's return) instead of `flow`. `new-ai-sheet.tsx` passes `flow.keys`.
3. **`apps/mobile/src/components/connections/add-key-sheet.tsx`:** a kit `BottomSheet` titled "Add key", with a `StepTrack` (Provider, Key), the two steps, and the footer Back plus primary.
   - Its behaviour is exactly web's: Continue → check → Save.
   - Closing before Save abandons; Save calls `onSaved`.
4. **`connections.tsx`:** the header's Add, and the empty state's "Add a connection", open the sheet. `onSaved` reloads the list.
   - Delete `add-connection-form.tsx` and `save-connection.ts`.
   - Drop `showForm` from `use-connections.ts`.
5. **Every file stays at 400 lines or fewer.** `use-new-ai-flow.ts` must shrink.

### Tests
- Keys are crucial code, so the existing tests stay.
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.test.ts` keeps passing. Move a test with the helper it covers if the helper moves, into `apps/mobile/src/components/connections/use-key-check.test.ts`.
- No new UI tests.

### Allowed files
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`, `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.test.ts`
- `apps/mobile/src/components/ais/new-ai/provider-step.tsx`, `apps/mobile/src/components/ais/new-ai/key-step.tsx`, `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/connections/use-key-check.ts`, `apps/mobile/src/components/connections/use-key-check.test.ts`, `apps/mobile/src/components/connections/add-key-sheet.tsx`
- `apps/mobile/src/components/connections/add-connection-form.tsx`, `apps/mobile/src/components/connections/save-connection.ts`, `apps/mobile/src/components/connections/use-connections.ts`, `apps/mobile/src/app/settings/connections.tsx`
- `work/T-1473-mobile-add-key-sheet.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/components/ais/new-ai src/components/connections --reporter=dot
pnpm gate
```

### Acceptance
- The gate and the tests pass.
- **The lead's emulator walk:**
  - Connections → Add key → DeepSeek → key → Save adds a row;
  - closing after a check leaves no new row;
  - New AI still walks end to end.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/components/connections/use-key-check.ts`: the key-check state, refs and logic moved out of `use-new-ai-flow.ts`, the twin of web `useKeyCheck`. It loads connections (active LLM ones) and the catalog, and exposes `providerChoices`, the provider/compatible fields (`providerId`, `selectProvider`, `providerReady`, `continueProvider`, `isCompatible`, `baseUrl`, `setBaseUrl`, `connectionName`, `setConnectionName`, `providerError`), the key fields (`keyValue`, `setKeyValue`, `showKey`, `toggleShowKey`, `keyPlaceholder`, `keyPageUrl`, `keyMessage`, `keyVerified`, `checking`), `connectionId`, `catalog`, `continueKey`, `abandon`, and `providerSelection` (moved here, with its tests).
- Every T-1445 rule is carried over unchanged: compatible never preselects; a Base URL/Name edit drops the flow-made connection and restarts the key; a provider switch deletes a flow-created verified key; `keyCheckRef`/`checkToken` double-tap and stale-check guards; `discardCreatedKey` never deletes a saved key (`created: false`).
- `use-new-ai-flow.ts` now composes the hook, exposes it as `flow.keys`, reads models from `keys.catalog`, and loads only options and machines itself. It keeps the T-1445 create guard: `keys.beginCreate()` before the POST, `keys.finishCreate(true)` on success (claims the key for the AI), `keys.finishCreate(false)` on failure (drops the key only if the sheet was closed mid-create). The hook owns the unmount cleanup and the `closed`/`creating` refs, so a close during Create does not discard.
- `provider-step.tsx` / `key-step.tsx` now take `keys: KeyCheck` instead of `flow`; `new-ai-sheet.tsx` passes `flow.keys` and reads `flow.keys.providerChoices` / `flow.keys.providerId`.
- Added `apps/mobile/src/components/connections/add-key-sheet.tsx`: a kit `BottomSheet` titled "Add key", a two-segment `StepTrack` (Provider, Key), the two shared steps, and a footer Back + primary. Behaviour mirrors web `AddKeyDialog`: Continue → check, once verified the primary reads Save; Save `claim()`s the key (so the dismissal that follows does not delete it) and calls `onSaved`; closing before Save `abandon()`s.
- `connections.tsx`: header Add and the empty-state "Add a connection" open the sheet; the list renders when there is at least one row; `onSaved` closes and reloads. The sheet is remounted per open via `key={addSession}` (like New AI).
- Deleted `add-connection-form.tsx` and `save-connection.ts`; dropped `showForm`/`setShowForm` from `use-connections.ts`.

### Files changed
- `apps/mobile/src/components/connections/use-key-check.ts` (new), `use-key-check.test.ts` (new), `add-key-sheet.tsx` (new)
- `apps/mobile/src/components/connections/add-connection-form.tsx` (deleted), `save-connection.ts` (deleted), `use-connections.ts`
- `apps/mobile/src/components/ais/new-ai/use-new-ai-flow.ts`, `use-new-ai-flow.test.ts`, `provider-step.tsx`, `key-step.tsx`, `new-ai-sheet.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `work/T-1473-mobile-add-key-sheet.md`

### Commands and results
- `pnpm --filter @zilar/mobile exec vitest run src/components/ais/new-ai src/components/connections --reporter=dot --maxWorkers=2` → `Test Files 2 passed (2)`, `Tests 18 passed (18)`.
- `pnpm gate` (from repo root) summary lines:
  - `gate: 13 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck (3.9s)`
  - `PASS  effect (0.8s)`
  - `PASS  tests @zilar/mobile (1.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Deviations / notes
- The hook exposes the provider choices as `providerChoices` (the name the mobile steps and flow already used) rather than web's `choices`; the spec's "exposes choices" is met.
- `use-key-check.ts` exposes three extra actions beyond the listed set — `continueProvider`, `beginCreate`, `finishCreate`, `claim` — so the sheet's provider validation and the flow's create guard stay in their callers. `abandon` is as listed.
- `use-connections.ts`: the spec said drop `showForm`; I also dropped `setConnections` from the returned object, since its only caller (the deleted add form) is gone and it is not read anywhere else. The state itself is still used internally by Remove.
- Tests: only the `providerSelection` describe moved to `use-key-check.test.ts` (the helper moved). The `@/components/ais/form` helper tests stayed in `use-new-ai-flow.test.ts` because those helpers stayed in `form.ts`; that file still passes.
- The first `pnpm gate` run failed only on `format` for the new hook; I ran Prettier on the touched files and the second run was `GATE PASS`.

### Blocked / needs a decision
- None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- `use-new-ai-flow.ts` went from 400 to 261 lines, with the key-check logic in `connections/use-key-check.ts` (243). All 18 key tests are kept (16 plus 2 moved) and pass.
- **Emulator (mock):**
  - Connections → Add key → DeepSeek → key → check (green dot, primary "Save") → Save adds the row;
  - xAI → key verified → close → after a focus reload there is no xAI row (the verified key was deleted);
  - New AI still walks end to end (Google → Robin → Create lands in the chat).
- **Nit for a later batch:** the done Provider chip reads "✓ Provider". New AI and web show the provider's name.
