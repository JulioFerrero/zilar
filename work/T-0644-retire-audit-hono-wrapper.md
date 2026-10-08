---
id: T-0644
title: "Hono: retire the audit item-11 wrapper (createAuditRoutes in audit/api.ts plus the audit/routes.ts shim); routes.test.ts calls createAuditApi(...).handler; audit/api.ts drops Hono; same assertions"
status: merged
milestone: M5
branch: task/T-0644-retire-audit-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0644: retire the audit Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A10 in the T-0626 last-mile audit. After this task, `audit/api.ts` no longer imports Hono.

### Verified facts (do not re-derive)
- **`apps/server/src/audit/api.ts`:**
  - imports `Hono` (line 19) and `RequestIdVariables` (line 20);
  - defines `AuditRoutesDependencies` (lines 138-142: `auth`, `db`, `logger?`), a cached silent logger `defaultLogger()` (lines 210-215) and `createAuditRoutes` (lines 217-235), which builds `createAuditApi` and mounts it with `/api` stripped through `mountEffectRoutes`;
  - its header comment (lines 6-8) explains the factory.
- **`apps/server/src/audit/routes.ts`** is a 5-line shim: `export { createAuditRoutes, type AuditRoutesDependencies } from './api';`.
- **The only users** (`git grep`):
  - `apps/server/src/audit/routes.test.ts:23` imports from `./routes`. In `beforeEach` (about lines 77-84) it builds `auditApp = new Hono()` with an `onError` that renders `HttpError`, and mounts `createAuditRoutes({ auth, db })` under `/api`.
  - `auditApp` is declared as `Hono` at about line 70 and used about 5 times, with full `${TEST_BASE_URL}/api/audit...` URLs.
  - `apps/server/src/app.ts:15` imports only `createAuditApi`. **Do not touch `app.ts`.**

### What to build
1. **In `routes.test.ts`:**
   - `auditApp` becomes `{ request(url, init) }`, calling `createAuditApi({ auth, db, logger: pino({ level: 'silent' }) }).handler(new Request(url, init))`;
   - drop the Hono `onError`;
   - import `createAuditApi` from `./api`;
   - remove the imports that are now unused (`Hono`, perhaps `HttpError`).
   - **Every assertion stays.** If one fails only because of error rendering, stop and report it in Blocked.
2. **In `audit/api.ts`:**
   - delete `AuditRoutesDependencies`, `defaultLogger` and `createAuditRoutes`;
   - remove the imports that are now unused (`Hono`, `RequestIdVariables`, and `pino` and `mountEffectRoutes` if nothing else uses them);
   - shorten the header comment at lines 6-8 accordingly.
3. **Delete** `apps/server/src/audit/routes.ts`. Then `git grep -n "createAuditRoutes\|audit/routes'" apps` must show nothing in code. List any doc comment outside the Allowed files under Follow-ups.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/audit/api.ts`, `apps/server/src/audit/routes.ts`, `apps/server/src/audit/routes.test.ts` (lines 1-100).

### Allowed files
`apps/server/src/audit/api.ts`, `apps/server/src/audit/routes.ts`, `apps/server/src/audit/routes.test.ts`, `work/T-0644-retire-audit-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/audit/routes
pnpm gate
```

### Acceptance
- `audit/routes.ts` is gone, `audit/api.ts` has no `hono` import, and the audit route tests pass with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**

1. `apps/server/src/audit/api.ts`
   - Removed the `Hono` and `hono/request-id` (`RequestIdVariables`) imports, the `pino` value import (now `import type { Logger } from 'pino'`), and `mountEffectRoutes` from the `../effect/http` import (all only used by the deleted wrapper).
   - Deleted `AuditRoutesDependencies`, the cached `silentLogger`/`defaultLogger()`, and `createAuditRoutes`.
   - Shortened the header comment to describe the Effect module only (no more Hono wrapper).
   - Kept `createAuditApi`, `AuditApiDependencies`, `AUDIT_API_ROUTES`, `HttpError` and every other import actually used.
2. `apps/server/src/audit/routes.test.ts`
   - Dropped the `Hono` import, the `HttpError` import (only used by the removed `onError`) and the `./routes` import; added `import { pino } from 'pino'` and import `createAuditApi` from `./api`.
   - `auditApp` is now `{ request(input, init) }` backed by `createAuditApi({ auth, db, logger: pino({ level: 'silent' }) }).handler(new Request(input, init))`; `auditApp = new Hono()`, the `onError` and `auditApp.route('/api', …)` are gone.
   - The `request` helper signature/URLs (`${TEST_BASE_URL}/api/audit…`) and **every assertion are unchanged**; the `createAuditApi` group already carries the `/api` prefix, so the absolute URLs still match.
3. Deleted `apps/server/src/audit/routes.ts`.
4. `git grep -n "createAuditRoutes\|audit/routes'" apps` → no matches (exit 1). No doc comment outside the Allowed files needed updating.

**Files changed**: `apps/server/src/audit/api.ts`, `apps/server/src/audit/routes.test.ts`, `apps/server/src/audit/routes.ts` (deleted), `work/T-0644-retire-audit-hono-wrapper.md`.

**Commands and real results**

- `pnpm install` → `Done in 18s` (one pre-existing peer-dep warning in `apps/mobile` for `@types/react-dom`, unrelated).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/audit/routes` → `Test Files 1 passed (1)`, `Tests 11 passed (11)`.
- `pnpm gate` → summary:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (21.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (13.3s)
  PASS  tests @zilar/server  (16.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Problems / deviations**: none. Every assertion stayed; no error-rendering failure appeared, so no Blocked entry was needed. `app.ts` was not touched.

**Security checklist**: no new routes, writes, logging, deletes or secrets; this is a pure retirement of a compatibility wrapper, so the checklist is unaffected.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet head is aa2b8838, the current HEAD.
- **Lead check:**
  - the wrapper and the shim are deleted;
  - `audit/api.ts` has no hono import;
  - no `expect` line changed.
- **Nit:** the comment at `api.ts:4` is accurate, because `app.ts` mounts the API with `mountEffectRoutes`; no change.
