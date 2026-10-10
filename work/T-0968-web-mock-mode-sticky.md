---
id: T-0968
title: "Web mock mode stays on for the tab: decide once at page load and remember ?mock=1 in sessionStorage (dev builds only); ?mock=0 turns it off"
status: todo
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

## Review (written by Claude)
