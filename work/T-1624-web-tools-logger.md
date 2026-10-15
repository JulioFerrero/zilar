---
id: T-1624
title: "web.price failure lines use the server's pino logger, not console.warn: thread an optional logger through BuildWebToolsAdaptersDeps → WebToolsState from startup/components.ts (T-1616 follow-up)"
status: merged
milestone: M5
branch: task/T-1624-web-tools-logger
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1624: Web tools log through the server logger

## Spec (written by Claude, do not edit)

### Why
T-1616 added one line per `web.price` provider failure, but it writes with `console.warn(JSON.stringify(…))` (`apps/server/src/web-tools/price-adapter.ts:42`), because the web tools had no logger. These lines skip pino's levels, redaction and format. This was T-1616's pre-review follow-up.

### Facts (the lead read them on 2026-10-16, main after T-1623)
- **`apps/server/src/web-tools/shared.ts`** (141 lines):
  - `BuildWebToolsAdaptersDeps` (`:34-40`): `rateLimitNow?`, `dnsLookup?`, `fetcher?`, `searchProviderName?`, `searchProvider?`;
  - `WebToolsState` (`:42-48`); `createWebToolsState(deps)` (`:50`).
- **`apps/server/src/web-tools/adapters.ts:39-40`:** `buildWebToolsAdapters(deps: BuildWebToolsAdaptersDeps = {})`.
- **`apps/server/src/startup/components.ts:129-132`:** `buildWebToolsAdapters({ searchProviderName: config.WEB_SEARCH_PROVIDER })`. `logger` is in scope (`:43`).
- **`apps/server/src/web-tools/price-adapter.ts:42`:** the `console.warn` line.

### Steps
1. **Add `logger?: { warn: (fields: Record<string, unknown>, message: string) => void }`** to `BuildWebToolsAdaptersDeps` and `WebToolsState`. Default it to a no-op when it's missing, so tests need no logger.
2. **Pass `logger`** from `startup/components.ts` into `buildWebToolsAdapters`.
3. **In `price-adapter.ts`,** replace the `console.warn` line with `state.logger.warn({ action: 'web.price', host, status }, 'web tool provider failed')`. Keep the same fields, never content.
4. **Change nothing else.**

### Tests
None new. Existing web-tools tests must pass.

### Allowed files
- `apps/server/src/web-tools/shared.ts`
- `apps/server/src/web-tools/price-adapter.ts`
- `apps/server/src/startup/components.ts`
- `work/T-1624-web-tools-logger.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/web-tools/adapters.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`git grep console. -- apps/server/src/web-tools` finds nothing outside tests.**

---

## Report (written by the worker when done)

### What I did
- Added `WebToolsLogger` (`warn(fields, message)`) to `shared.ts` and threaded it as
  optional `logger` on `BuildWebToolsAdaptersDeps`, non-optional on `WebToolsState`
  via `createWebToolsState(deps)`, defaulting to a no-op `{ warn: () => {} }` so tests
  need no logger.
- `startup/components.ts`: pass the in-scope pino `logger` into
  `buildWebToolsAdapters({ searchProviderName, logger })`.
- `price-adapter.ts`: `warnFetchFailure` now takes `state` and emits
  `state.logger.warn({ action: 'web.price', host, status }, 'web tool provider failed')`.
  Same three fields, no URL/symbol/content. Both call sites updated.
- Changed nothing else. No new tests (none new in spec; existing web-tools tests pass).
- Wrapped the `state.logger.warn(...)` call across lines by hand after the first gate
  failed Prettier; no other formatting changes.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/web-tools/adapters.test.ts`
  → `Test Files 1 passed (1)`, `Tests 20 passed (20)`.
- Acceptance: `git grep -n "console\." -- apps/server/src/web-tools` → no matches (exit 1).
- `pnpm gate` (repo root, after the Prettier line-wrap fix):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.9s)
  PASS  lint  (1.6s)
  PASS  typecheck  (6.5s)
  PASS  effect  (2.2s)
  PASS  tests @zilar/server  (5.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (The first gate run failed `format` on the long `warn` line only; fixed and re-ran to the pass above.)

### Notes for the lead
- `WebToolsLogger` is exported from `shared.ts` but not re-exported from `adapters.ts`;
  nothing needed the name. Say the word if you want it surfaced.
- Logger is wired only on the production path in `startup/components.ts`; tests and
  `args-example.test.ts` call `buildWebToolsAdapters()` with no logger and get the no-op.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit.
- **The change:** an optional logger is threaded through `BuildWebToolsAdaptersDeps` → `WebToolsState`, a no-op by default, and passed from startup. `git grep console. -- apps/server/src/web-tools` finds nothing outside tests.
