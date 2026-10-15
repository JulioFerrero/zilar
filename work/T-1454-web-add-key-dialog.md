---
id: T-1454
title: "Web Connections page adds keys with the New AI provider and key steps: a shared useKeyCheck hook and an Add key dialog replace AddConnectionForm; Zilar shows disabled (not hidden) when cloud desks are off"
status: merged
milestone: M5
branch: task/T-1454-web-add-key-dialog
model: auto
effort: default
depends_on: [T-1444]
estimate: 0.5 day
---

# T-1454: Web Add key dialog

## Spec (written by Claude, do not edit)

### Why
The approved New AI design (`docs/design/mockups/new-ai/README.md`; boards `Main.dc.html`, `Compatible.dc.html` and `Key.dc.html`) has one way to add a provider key:
- the searchable models.dev provider list;
- OpenAI-compatible with Base URL and Name;
- a checked key field with a lock, a show toggle, a green dot when verified and "Get one ↗".

T-1444 built it inside the New AI dialog. The Connections page still uses the old inline `AddConnectionForm`, so this task gives both one shared piece.

There is also T-1444's follow-up: the Setup step hides Zilar when cloud desks are off. The spec asked for it shown but disabled.

### Facts (the lead read them on main, 2026-10-15)
- **The New AI steps:** `apps/web/src/components/ais/new-ai/ProviderStep.tsx` and `KeyStep.tsx` each take `{ flow: NewAiFlow }`.
  - `useNewAiFlow` (`apps/web/src/components/ais/new-ai/useNewAiFlow.ts`) is **exactly 400 lines**.
  - It holds the provider choice, the compatible fields, the key state and the key check (`checkKey` / `abandonKeyCheck` from `@zilar/chat-core`, with `KEY_CHECK_API` around `:70` and the call at `:168`), plus the model, orb, setup and create state.
- **The Connections page:** `apps/web/src/routes/ConnectionsPage.tsx` (354 lines) renders `AddConnectionForm` inline when `showForm` is set (`:110-117`, with `onCancel` and `onSaved` → `refresh()`). It imports `providerLabel` from that file (`:6`).
  - `apps/web/src/components/connections/AddConnectionForm.tsx` is 185 lines.
- **The segmented control:** `apps/web/src/components/ui/segmented-control.tsx`'s `SegmentedOption` has no `disabled`. `apps/web/src/components/ais/new-ai/SetupStep.tsx:7-13` drops the Zilar option when `cloudAvailable` is false.

### What to build
1. **New `apps/web/src/components/ais/new-ai/useKeyCheck.ts`:** move the provider choice, the compatible fields, the key field state and the `checkKey` / `abandonKeyCheck` logic out of `useNewAiFlow`.
   - `useNewAiFlow` uses it, and shrinks.
   - `ProviderStep` and `KeyStep` take the `useKeyCheck` result (`{ keys }` or similar) instead of the whole flow.
   - The New AI behaviour stays exactly the same.
2. **New `apps/web/src/components/connections/AddKeyDialog.tsx`:** a kit `Dialog` with `size="lg"` and the title "Add key".
   - A `DialogStepper` with Provider · Key;
   - `ProviderStep`, then `KeyStep`;
   - the footer is Back (on Key) plus the one primary: Continue, then **Save**;
   - Save is enabled once the key is verified, and closes the dialog and calls `onSaved` (the connection already exists after `checkKey`);
   - closing before Save calls `abandonKeyCheck`.
   - No Cancel key, no subtitles.
3. **`ConnectionsPage.tsx`:** the add action opens `AddKeyDialog` instead of the inline form, and `onSaved` refreshes the list.
   - Delete `AddConnectionForm.tsx` once nothing imports it.
   - Move `providerLabel` to wherever the page needs it: `providerLabel` from `@zilar/chat-core` exists (`packages/chat-core/src/ai-providers.ts:53`).
4. **The segmented control:** `SegmentedOption` gets optional `disabled` (rendered muted, not selectable, `aria-disabled`). `SetupStep.tsx` shows Zilar disabled when cloud is off, instead of hiding it.
5. Every file stays at 400 lines or fewer.

### Tests
None (UI). The key-check tests live in chat-core.

### Allowed files
- `apps/web/src/components/ais/new-ai/useKeyCheck.ts`, `apps/web/src/components/ais/new-ai/useNewAiFlow.ts`, `apps/web/src/components/ais/new-ai/ProviderStep.tsx`, `apps/web/src/components/ais/new-ai/KeyStep.tsx`, `apps/web/src/components/ais/new-ai/SetupStep.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`
- `apps/web/src/components/connections/AddKeyDialog.tsx`, `apps/web/src/components/connections/AddConnectionForm.tsx` (delete)
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/ui/segmented-control.fixture.tsx`
- `work/T-1454-web-add-key-dialog.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead opens Settings → Connections → Add key headless in mock mode, and walks the New AI flow again.

---

## Report (written by the worker when done)

### What I did
1. **New `apps/web/src/components/ais/new-ai/useKeyCheck.ts`** (204 lines): the provider choice, the OpenAI-compatible fields, the key field state and the `checkKey` / `abandonKeyCheck` logic moved out of `useNewAiFlow`. It owns the `listConnections` and `getAiCatalog` queries (both only fed the provider choice), and exposes the raw `catalog` so the flow can still read the models. Options `onProviderChange` (the flow drops its model draft) and `onVerified` (the flow moves to the Model step) keep New AI's exact behaviour. `abandon()` is the close-time cleanup; `continueKey()` runs the check.
2. **`useNewAiFlow.ts`** (400 → 250 lines): now calls `useKeyCheck` and keeps only step, name, model, orb, computer and limits state. `providerChoices`, `providerId`, `chooseProvider`, `isCompatible`, the compatible fields, `key`, `keyVerified`, `keyError`, `keyPlaceholder`, `keyPage`, `checkingKey` and `baseUrlReachable` are no longer re-exported; the flow returns `keys` so the shell can hand it to the steps. `KEY_CHECK_API` and `catalogViewOf` moved to `useKeyCheck.ts`.
3. **`ProviderStep.tsx` / `KeyStep.tsx`**: take `{ keys: KeyCheck }` instead of `{ flow: NewAiFlow }`. `NewAiDialog.tsx` now renders `<ProviderStep keys={flow.keys} />` and `<KeyStep keys={flow.keys} />`.
4. **New `apps/web/src/components/connections/AddKeyDialog.tsx`** (86 lines): kit `Dialog` with `size="lg"`, title "Add key", a 2-step `DialogStepper` (Provider · Key), `ProviderStep` then `KeyStep`. Footer is Back (on Key only) plus one primary: "Continue" on Provider, and on Key "Continue" (runs the check) becoming "Save" once the key is verified. Save closes and calls `onSaved`; closing before Save calls `keys.abandon()`. No Cancel key and no subtitles.
5. **`ConnectionsPage.tsx`** (354 → 349 lines): the add action (`Add a connection` button and the empty-state action) opens `AddKeyDialog`; `onSaved` closes it and calls `refresh()`. Removed the inline form and its wrapper. `providerLabel` now imported from `@zilar/chat-core`.
6. **Deleted `apps/web/src/components/connections/AddConnectionForm.tsx`** (`git rm`); grep shows no remaining code importer (only `work/*` docs and the mobile `add-connection-form.tsx`, which is a separate file).
7. **`segmented-control.tsx`**: `SegmentedOption` gained optional `disabled`. A disabled option renders muted (`text-subtle-foreground opacity-50`), has `disabled` + `aria-disabled`, and is skipped by Arrow Left/Right/Home/End. `segmented-control.fixture.tsx` gained a `Disabled` example.
8. **`SetupStep.tsx`**: the Zilar option stays with `disabled: !cloudAvailable` instead of being dropped.
9. Every touched source file is ≤ 400 lines (largest: `ConnectionsPage.tsx` 349).

### Commands and results
- `pnpm install` — done, 1137 packages, 1 peer warning (`@types/react-dom` vs `@types/react`, pre-existing in `apps/mobile`).
- `pnpm exec prettier --write <my 11 files>` — only `AddKeyDialog.tsx` needed reformatting; the rest unchanged.
- `pnpm gate` (from the repo root) — ended `GATE PASS`. It ran twice, once after the code and once after this Report was written; both were green. The committed-tree run:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.7s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the task says "None (UI)", the change touches no tested shared logic, and the gate skipped `@zilar/web` tests (no nearby test files). I did not run the mobile or chat-core suites.

### Files changed
Added: `apps/web/src/components/ais/new-ai/useKeyCheck.ts`, `apps/web/src/components/connections/AddKeyDialog.tsx`. Deleted: `apps/web/src/components/connections/AddConnectionForm.tsx`. Modified: `useNewAiFlow.ts`, `ProviderStep.tsx`, `KeyStep.tsx`, `SetupStep.tsx`, `NewAiDialog.tsx`, `ConnectionsPage.tsx`, `ui/segmented-control.tsx`, `ui/segmented-control.fixture.tsx`, `work/T-1454-web-add-key-dialog.md`.

### Notes / deviations
- The `Add key` dialog's Key step has no separate trigger for the key check beyond the primary: on Key the primary is "Continue" (checks, per the New AI board's Key step) and becomes "Save" once verified, matching "Continue, then Save". No deviation was made from the spec's named behaviour, but the spec did not spell this transition out; I chose it because "Save is enabled once the key is verified" needs the check to run on Continue.
- `useKeyCheck` owns the `listConnections` and `getAiCatalog` queries because the provider choice needs both; `useNewAiFlow` reads `keys.catalog` for the model list, so no query is duplicated. This is a judgement call, not stated in the spec.
- I did not run the app headless in mock mode (the acceptance is the lead's); the mock backend already serves `/api/connections` and the catalog, which the New AI flow used before.

### Blocked / needs a decision
None.

### Round 2 (fix round)
- **Finding 1 (should-fix, AddKeyDialog Enter bypasses `providerReady`)**: fixed in `AddKeyDialog.tsx`. `primary()`'s `step === 0` branch now returns early when `!keys.providerReady`, so pressing Enter in the shell form no longer advances to Key with an unset provider or an empty Base URL/Name. The Continue button's `disabled` gate and this guard now agree.
- **Tests added/adjusted**: none. The finding names no test, and the change is UI inside `AddKeyDialog.tsx`; per AGENTS.md ("UI code gets no tests") no test applies. This remains covered by the lead's headless mock-mode check.
- **Gate**: `pnpm gate` from the repo root ended `GATE PASS` (install / format / lint / typecheck / effect PASS, tests @zilar/web SKIP, scope clean, size clean). No single test files were run.

### Round 3 (fix round)
- **Finding 1 (should-fix, a Base URL/Name edit after a passed check orphans the created key)**: fixed in `useKeyCheck.ts` — `editCompatible` now deletes the connection itself when `keyState.verified && keyState.created && keyState.connectionId !== null` (`void deleteConnection(...).catch(() => {})`, best effort) and keeps `abandonKeyCheck` otherwise; a saved key (`created: false`) is never deleted. No test added (UI hook, spec says tests live in chat-core); gate still `GATE PASS`.

## Review (written by Claude)
Lead, 2026-10-15: approved after 1 auto round and 1 lead round (a Base URL or Name edit after a passed check now deletes the flow-created key). Pre-review CLEAN.
- The lead walked Settings → Connections → Add a connection headless in mock mode:
  - Add key opens with Provider · Key;
  - Google ✓, then a key with a verified green dot;
  - the footer is Back plus Save, with one close key.
- `AddConnectionForm` is gone, and Zilar now shows disabled when cloud is off.
- Not in scope: the Connections page itself still shows an "active" word badge and a subtitle. It goes on the canvas list.
