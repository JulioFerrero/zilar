---
id: T-1475
title: "Mobile Add key sheet: the Provider step chip shows the chosen provider's name (\"✓ DeepSeek\"), as the New AI sheet and web do, not \"✓ Provider\""
status: merged
milestone: M5
branch: task/T-1475-add-key-chip-provider-name
model: auto
effort: default
depends_on: [T-1473]
estimate: 0.05 day
---

# T-1475: Provider name on the Add key chip

## Spec (written by Claude, do not edit)

### Why
In the lead's emulator walk of T-1473 (2026-10-15), after the Provider step the Add key sheet's first chip reads "✓ Provider". The New AI sheet shows "✓ DeepSeek", and web's Add key dialog passes the provider text to its stepper (`apps/web/src/components/connections/AddKeyDialog.tsx:44`).

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/components/connections/add-key-sheet.tsx`** (91 lines): the steps are a constant, `STEPS` = Provider, Key (`:13-16`), passed to `StepTrack` (`:79-85`).
- **The New AI sheet** builds its provider label as the choice's label, else the id, else "Provider" (`apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx:38-41`), and uses it once a provider is chosen (`:48-52`).

### What to build
1. In `add-key-sheet.tsx`, build the steps in the component:
   - the Provider step's label is `keys.providerChoices.find((choice) => choice.id === keys.providerId)?.label ?? keys.providerId ?? 'Provider'` once a provider is chosen, and "Provider" before that;
   - Key stays "Key".
2. Nothing else changes.

### Tests
None (UI).

### Allowed files
`apps/mobile/src/components/connections/add-key-sheet.tsx`, `work/T-1475-add-key-chip-provider-name.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.

---

## Report (written by the worker when done)

### What I did
Built the Add key sheet's steps in the component instead of the module-level `STEPS` constant, so the Provider chip shows the chosen provider's name (`✓ DeepSeek`) like the New AI sheet and web do:
- Removed `const STEPS: StepTrackStep[] = [...]` (old `:13-16`).
- Added, inside `AddKeySheet`: `providerLabel = keys.providerChoices.find((choice) => choice.id === keys.providerId)?.label ?? keys.providerId ?? 'Provider'`, then `steps` with `{ value: 'provider', label: keys.providerId === null ? 'Provider' : providerLabel }` and `{ value: 'key', label: 'Key' }`. Before a provider is chosen `providerId` is `null`, so the label is `Provider`.
- Passed `steps={steps}` to `StepTrack` (was `steps={STEPS}`).
This mirrors the New AI sheet (`apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx:38-52`). Nothing else changed.

### Files changed
- `apps/mobile/src/components/connections/add-key-sheet.tsx`
- `work/T-1475-add-key-chip-provider-name.md`

### Commands run and results
- `pnpm install`: Done in 10.2s (deps already present, no errors).
- No single test file was run: the change is UI-only and the spec lists no tests.
- `pnpm gate`: exited 0, ended with `GATE PASS`:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (5.4s)
  PASS  effect  (2.0s)
  PASS  tests @zilar/mobile  (2.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The two changed files are exactly the Allowed files.

### Problems / deviations
None. The spec's label expression and the `providerId === null` guard are equivalent (`?? 'Provider'` already covers `null`); I kept the explicit guard to match the New AI sheet it is copied from.

### Open questions / Blocked
None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0. On the emulator, Add key → DeepSeek → Continue shows "✓ DeepSeek" on the first chip.
