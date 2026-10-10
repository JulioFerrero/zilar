---
id: T-0968
title: "Web mock mode stays on for the tab: decide once at page load and remember ?mock=1 in sessionStorage (dev builds only); ?mock=0 turns it off"
status: merged
milestone: M5
branch: task/T-0968-web-mock-mode-sticky
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0968: Sticky web mock mode

## Spec (written by Claude, do not edit)

### Why
The lead found this in Chrome on 2026-10-10, while checking T-0959.
- **The bug:** open `/c/dev-team%40rooms.zilar.test?mock=1`, then click My AIs in the sidebar. The page shows "Request failed (404)".
- **The cause:** in-app navigation drops `?mock=1`. `isMockMode()` (`apps/web/src/mock/gate.ts:34-36`) reads `window.location.search` on every call (`currentMockEnv`, `:25-32`), so API calls leave mock mode. Meanwhile the store, created once in `apps/web/src/store/ChatStoreProvider.tsx`, keeps the fake XMPP. The app is then half mock and half real.

### What to build
1. **`apps/web/src/mock/gate.ts`:** in a dev build only (`resolveMockMode`'s existing rule, `:15-23`):
   - `?mock=1` seen at any point turns mock mode on and saves `zilar.mock=1` in `sessionStorage`;
   - `?mock=0` turns it off and removes the key;
   - with no param, the saved value decides.

   The decision is made once per page load, at the first call, and is the same for the rest of the page's life. Wrap every `sessionStorage` access in try/catch: treat a failure as "not saved".
2. **Unchanged:**
   - a production build (`dev: false`, no `VITE_MOCK`) still returns false whatever the URL or storage says. That is the T-0063/T-0069 safety rule; keep it;
   - `VITE_MOCK=1` and `MODE === 'test'` still return true;
   - `resolveMockMode` stays pure; the storage and once-per-load logic sit around it.
3. **One test** in `apps/web/src/mock/gate.test.ts` (create it), because the production rule is a safety property. `resolveMockMode` must return false for `dev: false` with `search: '?mock=1'`, and true for dev with `?mock=1`. If the storage logic is a pure helper, also test that dev with a saved value and no param gives true, and that `?mock=0` gives false.

### Read first
`AGENTS.md`, `apps/web/src/mock/gate.ts`, and `apps/web/src/store/ChatStoreProvider.tsx`.

### Allowed files
`apps/web/src/mock/gate.ts`, `apps/web/src/mock/gate.test.ts`, `work/T-0968-web-mock-mode-sticky.md`.

### Checks
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/mock/gate.test.ts
pnpm gate
```

### Acceptance
- The Checks pass.
- The lead checks in Chrome: open `?mock=1`, then click My AIs, Profile and Settings, and every page loads from the mock. A production build ignores `?mock=1` (`pnpm --filter @zilar/web build`, then grep, as in T-0946).

---

## Report (written by the worker when done)

### What I did
Made mock mode sticky for a tab in dev builds, so in-app navigation (which
drops `?mock=1`) no longer flips the API layer back to real while the store
keeps its fake XMPP.

- `apps/web/src/mock/gate.ts`:
  - Added `saved: string | undefined` to `MockEnv`. `resolveMockMode` stays
    pure: it checks `VITE_MOCK=1`/`MODE==='test'` first, returns `false` when
    `!dev` (the T-0063/T-0069 safety rule, unchanged), then reads the URL param
    (`?mock=1` → true, `?mock=0` → false), and only when there is no param falls
    back to `saved === '1'`.
  - New dev-only storage helpers `readSavedMock`/`writeSavedMock` around the key
    `zilar.mock`; every access is wrapped in try/catch, and a failed read counts
    as "not saved".
  - `decideMockMode` applies the URL param to `sessionStorage` (only in a dev
    build, not test, and not with `VITE_MOCK=1`), then calls `resolveMockMode`.
  - `isMockMode` now decides once per page load into a module-level cache and
    returns the same value for the rest of the page's life.
  - `isMockApiEnabled` is unchanged.
- `apps/web/src/mock/gate.test.ts` (new): unit tests for the pure decision,
  including the production safety property.

I did not touch `apps/web/src/store/ChatStoreProvider.tsx`; it already calls
`isMockMode()` in both the initializer and the effect, so the once-per-load cache
is enough for the store and the API layer to agree.

### Files changed
- `apps/web/src/mock/gate.ts`
- `apps/web/src/mock/gate.test.ts` (new)
- `work/T-0968-web-mock-mode-sticky.md` (this file)

### Commands and real results
- `pnpm --filter @zilar/web exec vitest run --maxWorkers=2 --reporter=dot src/mock/gate.test.ts`
  → `Test Files 1 passed (1)`, `Tests 7 passed (7)` (same file as the Checks
  command, with the AGENTS.md worker cap added).
- `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (0.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.6s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/web  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- `MockEnv` gained a `saved` field so `resolveMockMode` can stay pure and still
  be tested with a saved value; `currentMockEnv` fills it from `sessionStorage`.
- The storage read/write is skipped in `MODE==='test'` and when `VITE_MOCK=1`, to
  keep unit tests free of storage side effects and to leave the build-time
  override alone. The spec only required "dev build only".

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** in a dev build, `?mock=1` is saved as `zilar.mock` in `sessionStorage` and `?mock=0` clears it. The decision is made once per page load.
- **The production rule holds:** the saved value is read only after `resolveMockMode`'s existing `if (!env.dev) return false`, and it is written only in dev. The new `gate.test.ts` (7 tests) covers `dev: false` with `?mock=1`, which gives false.
- **The lead checked it in Chrome:** open `?mock=1`, then click My AIs (all three AIs load), then Profile at `/settings/profile`, where the URL has no param and the page still loads from the mock.
- **Check:** the gate passed.
