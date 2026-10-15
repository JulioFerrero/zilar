---
id: T-1469
title: "Web New AI / Add key: closing before Create or Save deletes any connection the dialog created, verified or not, including one from a check still in flight (twin of the T-1445 SF2 fix)"
status: merged
milestone: M5
branch: task/T-1469-web-close-drops-created-key
model: auto
effort: default
depends_on: [T-1459]
estimate: 0.1 day
---

# T-1469: Closing leaves no key behind

## Spec (written by Claude, do not edit)

### Why
The mobile pre-review of T-1445 found that closing the New AI sheet after a key check passed (or while it was finishing) leaves a verified connection with the user's key that nothing references. Web has the same hole.

Lead decision (2026-10-15): closing New AI or Add key **before** Create or Save removes what the dialog created. After Create or Save, the key is kept.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/ais/new-ai/useKeyCheck.ts`:** `abandon()` (`:182-189`):
  - calls `abandonKeyCheck(KEY_CHECK_API, keyState)` for the current state;
  - calls `abandonKeyCheck` on a still-pending check's result.
  - `abandonKeyCheck` (`packages/chat-core/src/connection-check.ts:101-104`) returns early for a **verified** state, so a verified, flow-created connection stays.
  - `deleteConnection` is already imported in this file.
- **`abandon()` runs only on a user close:**
  - `close` in `useNewAiFlow.ts:181-184`;
  - `close` in `apps/web/src/components/connections/AddKeyDialog.tsx:18-21`.
  - After a successful create, `NewAiDialog.tsx:43` calls the parent's `onClose` directly, and Add key's Save calls `onSaved` (`AddKeyDialog.tsx:29-31`). Neither path abandons.

### What to build
1. **In `abandon()`:**
   - when the current state has `created: true` and a `connectionId`, call `deleteConnection(connectionId)` whether verified or not (best effort, failure ignored);
   - do the same for the pending check's resolved result.
   - A saved key (`created: false`) is never deleted.
2. **Leave `editCompatible` and `chooseProvider` as they are**, and don't change `packages/chat-core`.
3. The file stays at 400 lines or fewer.

### Tests
None (web UI state). The mobile twin has tests for the same rule.

### Allowed files
`apps/web/src/components/ais/new-ai/useKeyCheck.ts`, `work/T-1469-web-close-drops-created-key.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.

---

## Report (written by the worker when done)

### What I did
Closing the New AI flow or the Add key dialog **before** Create / Save now removes
whatever the key check created, whether or not it was verified (twin of the T-1445
SF2 mobile fix). After Create or Save, nothing in `abandon()` runs, so the key is
kept.

In `apps/web/src/components/ais/new-ai/useKeyCheck.ts` I replaced the two
`abandonKeyCheck` calls inside `abandon()` with a small local helper
`dropCreatedConnection(state)`:
- it deletes the connection whenever `created: true` and `connectionId !== null`,
  regardless of `verified` (best effort: `.catch(() => {})`);
- it does nothing for a saved key (`created: false`).

`abandon()` calls it on the current `keyState` and, if a check is still in flight,
on the pending promise's resolved result (same as before, only the delete rule
changed). `abandonKeyCheck` is still imported and used by `chooseProvider`,
`editCompatible` and the in-flight-check tap, which the spec says to leave alone.
`editCompatible` and `chooseProvider` are unchanged, and `packages/chat-core` is
untouched.

### Files changed
- `apps/web/src/components/ais/new-ai/useKeyCheck.ts` (229 lines, under the 400 cap)
- `work/T-1469-web-close-drops-created-key.md` (status + this Report)

### Commands and results
- `pnpm install`: done in 9.3s (1137 packages, 1 deprecation warning: uuid@7.0.3; pre-existing peer warning for `@types/react-dom` in `apps/mobile`).
- `pnpm gate`: **GATE PASS**. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test runs: none. The spec says tests are none (web UI state), and the gate
  reported `SKIP tests @zilar/web (no nearby test files)`. I did not run any test file.

### Deviations / problems
None. The change matches the spec.

### Security checklist
Not applicable: no routes, secrets, deletes of server rows, or audit entries. The
only delete is a client call on a connection the dialog itself created.

### Open questions
None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1, follow-up 1.
- `abandon()`, which runs only on a user close, deletes any connection the dialog created, verified or not, for the current state and for an in-flight check's result.
- A saved key is never deleted.
- **Also carried on this branch:** two lead notes in `docs/LEAD_HANDOFF.md` (how to restart the autopilot, and the Metro cache pitfall).
