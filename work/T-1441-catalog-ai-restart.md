---
id: T-1441
title: "A catalog provider connection can back an AI right after a server restart: provisioning passes the stored base URL to isLlmProvider (T-1429 follow-up)"
status: merged
milestone: M5
branch: task/T-1441-catalog-ai-restart
model: auto
effort: default
depends_on: [T-1429]
estimate: 0.1 day
---

# T-1441: Catalog connections after a restart

## Spec (written by Claude, do not edit)

### Why
This is T-1429's follow-up. `isLlmProvider(provider, hasBaseUrl = false)` (`apps/server/src/connections/providers.ts:22-27`) knows a models.dev catalog provider only through an in-memory map. That map is empty after a restart until something loads the catalog. A connection that already stores a `base_url` must count as an LLM provider without the map.

### Facts (the lead read them on main)
- `apps/server/src/ais/provisioning.ts` (312 lines) calls `isLlmProvider(connection.provider)` at `:36` (create) and `:250` (switching an AI's connection), without the second argument.
- `connection` comes from `findOwnedConnection` (`apps/server/src/connections/service.ts:119-134`), a `SELECT *` row that carries the connection's base URL. Check the exact field name in `ConnectionRow`.

### What to build
- At both call sites, pass the stored base URL check: `isLlmProvider(connection.provider, <row base url> !== null)`.
- Add a test where an AI is created with a catalog connection (a provider id the map doesn't know, with a stored base URL), and it succeeds.

### Tests
The one above, in the nearest existing provisioning test file (`apps/server/src/ais/provisioning.test.ts`).

### Allowed files
`apps/server/src/ais/provisioning.ts`, `apps/server/src/ais/provisioning.test.ts`, `work/T-1441-catalog-ai-restart.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ais/provisioning --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- The new test passes.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/ais/provisioning.ts`: at both call sites (`createAi` :36, `changeAiModel` :250) the second argument of `isLlmProvider` now passes the stored base URL check: `isLlmProvider(connection.provider, connection.baseUrl !== null)`. `connection` is a `ConnectionRow` (a `SELECT *` from `provider_connections`) whose field is `baseUrl: string | null` (`connections/service.ts:10,17,41`, `db/rows.ts`), so a catalog provider whose in-memory `catalogBaseUrl` map is cold after a restart still counts as an LLM provider when the connection stores a base URL.
- `apps/server/src/ais/provisioning.test.ts`: extended the `addConnection` helper with an optional `baseUrl` (inserted into `base_url`) and added the test `creates an AI from a catalog connection with a stored base URL and a cold map`. It calls `resetCatalogCache()` to mimic a restart (the 24 h catalog cache and the compatible base URL map are dropped), stores a `together` connection with `https://api.together.xyz/v1`, and asserts `POST /api/ais` answers 201 with the AI `active` and one `ais`/`ai_limits` row. Updated the file header comment.

### Files changed
- `apps/server/src/ais/provisioning.ts`
- `apps/server/src/ais/provisioning.test.ts`
- `work/T-1441-catalog-ai-restart.md`

All three inside the Allowed files.

### Commands run and results
- `pnpm install`: done in 12.9s (`Done in 12.9s using pnpm v10.32.1`).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/provisioning`: `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm gate` (repo root): `gate: 3 changed file(s) against main`; PASS install (frozen), format, lint, typecheck, effect, tests @zilar/server (5.7s); `scope: every changed file is inside the Allowed files`; ended `GATE PASS`.

### Problems / deviations
- None. No new dependencies, no changes outside the Allowed files. The `changeAiModel` call site is not separately exercised by a new test, but it shares the same one-line change; the existing model-swap path in the first test still passes.

### Blocked / needs a decision
- None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1.
- Both `isLlmProvider` calls in provisioning pass the stored base URL.
- The provisioning tests (4) pass locally.
