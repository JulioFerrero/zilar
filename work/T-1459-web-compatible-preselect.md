---
id: T-1459
title: "Web New AI / Add key: choosing a provider clears Base URL and Name, and OpenAI-compatible never preselects a saved connection, so an AI can't be wired to an old endpoint (twin of the T-1445 fix)"
status: merged
milestone: M5
branch: task/T-1459-web-compatible-preselect
model: auto
effort: default
depends_on: [T-1454]
estimate: 0.1 day
---

# T-1459: OpenAI-compatible never reuses an old endpoint

## Spec (written by Claude, do not edit)

### Why
The mobile pre-review of T-1445 found a must-fix that the web shares:
1. Pick OpenAI-compatible and type Base URL `Y`.
2. Go back, pick another provider, then pick OpenAI-compatible again.
3. The saved compatible connection for URL `X` is preselected as verified while the screen shows `Y`.

The AI is then created on `X`.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/ais/new-ai/useKeyCheck.ts`:**
  - `chooseProvider(id)` (`:110-124`) preselects the newest active connection with `connection.provider === id` (`:112-119`), whatever its base URL;
  - it never clears `baseUrl` or `compatibleName` (their state is declared near `:69`).
- **Callers:** both the New AI dialog and the Add key dialog use it.

### What to build
1. In `chooseProvider`, clear `baseUrl` and `compatibleName` on every provider choice.
2. For `openai-compatible`, never preselect a saved connection: the key state starts empty and unverified. Every other provider keeps the newest-active preselect.
3. The file stays at 400 lines or fewer.

### Tests
None (web UI state). The mobile twin has the test.

### Allowed files
`apps/web/src/components/ais/new-ai/useKeyCheck.ts`, `work/T-1459-web-compatible-preselect.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- In `apps/web/src/components/ais/new-ai/useKeyCheck.ts`, `chooseProvider(id)` now:
  1. clears `baseUrl` and `compatibleName` on every provider choice (`setBaseUrl('')`, `setCompatibleName('')`), so an endpoint typed for one provider never carries over to the next;
  2. never preselects a saved connection when `id === 'openai-compatible'`: the `saved` lookup is skipped, so `keyState` starts `{ connectionId: null, created: false, verified: false }` and `usingSavedKey` is `false`. Every other provider keeps the existing newest-active preselect.
- No other logic changed. `setKeyState({ connectionId: saved?.id ?? null, created: false, verified: saved !== null })` now naturally yields empty/unverified for compatible and the saved connection for the others.
- File length after the change: 221 lines (limit 400).

### Files changed
- `apps/web/src/components/ais/new-ai/useKeyCheck.ts`
- `work/T-1459-web-compatible-preselect.md`

### Commands run
- `pnpm install` — done in 14s, no errors (peer-dependency warnings only, pre-existing).
- Single tests: none. The spec says "Tests: None (web UI state)" and the touched package (`@zilar/web`) has no nearby test files.
- `pnpm gate` (repo root) — EXIT=0, summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.0s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Problems / deviations
- None. No dependencies added, no tests added (UI state, per the spec; the mobile twin carries the test).

### Open questions
- None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- `chooseProvider` clears Base URL and Name, and OpenAI-compatible no longer preselects a saved connection.
- Every other provider keeps the newest-active preselect.

