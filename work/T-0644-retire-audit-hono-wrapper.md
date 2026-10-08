---
id: T-0644
title: "Hono: retire the audit item-11 wrapper (createAuditRoutes in audit/api.ts plus the audit/routes.ts shim); routes.test.ts calls createAuditApi(...).handler; audit/api.ts drops Hono; same assertions"
status: todo
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

## Review (written by Claude)
