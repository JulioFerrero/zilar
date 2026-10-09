---
id: T-0646
title: "Hono: delete invite-links/routes.ts; move its two interfaces into invite-links/api.ts; app.ts and invite-links.test.ts import from api.ts and http/client-ip.ts; same assertions"
status: merged
milestone: M5
branch: task/T-0646-delete-invite-links-routes
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0646: delete invite-links/routes.ts

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A11 in the T-0626 last-mile audit. `apps/server/src/invite-links/routes.ts` (77 lines) imports `hono` and `@hono/node-server/conninfo` only for an unused helper.

### Verified facts (do not re-derive)
- **`apps/server/src/invite-links/routes.ts`:**
  - imports `getConnInfo` and `type Context` from Hono;
  - defines `InviteLinksRoutesDependencies` (line 14) and `TestInviteLinksOverrides` (line 33);
  - `clientIpFor(trustedProxyHops)` (line 50), which nothing imports;
  - `trustedClientIp`, a pass-through to `../http/client-ip`;
  - `socketAddress(c)`;
  - re-exports `INVITE_LINK_TOKEN_HEX_LENGTH` from `./service` (line 77), which nothing imports through `routes`.
- **The only references** (`git grep`):
  - `apps/server/src/app.ts:45`: `import type { TestInviteLinksOverrides } from './invite-links/routes';`, used at `app.ts:73` and `app.ts:75`;
  - `apps/server/src/invite-links/api.ts:32`: `import type { InviteLinksRoutesDependencies } from './routes';`, used at `api.ts:203`;
  - `apps/server/src/invite-links/invite-links.test.ts:26`: `import { trustedClientIp } from './routes';`, used in the test at about lines 552-563.
- **`apps/server/src/http/client-ip.ts:12`** exports the same `trustedClientIp`. `http/client-ip.test.ts` already asserts the same values.

### What to build
1. **Move both interfaces into `apps/server/src/invite-links/api.ts`, unchanged:**
   - `InviteLinksRoutesDependencies` becomes `InviteLinksApiDependencies`; update `createInviteLinksApi`'s parameter type at line 203.
   - `TestInviteLinksOverrides` keeps its name.
   - Move the type imports they need (`HttpServerRequest`, `Logger`, `AuditRecorder`, `Auth`, `ServerConfig`, `ServerDatabase`, `EjabberdAdminClient`, `RateLimiter`), skipping any that `api.ts` already has. Drop the import from `./routes`.
2. **`apps/server/src/app.ts:45`:** import `TestInviteLinksOverrides` from `./invite-links/api`. If `app.ts` already imports from `./invite-links/api`, merge it into that line. Nothing else in `app.ts` changes.
3. **`invite-links.test.ts:26`:** import `trustedClientIp` from `../http/client-ip`. The test body and its assertions stay unchanged.
4. **Delete** `apps/server/src/invite-links/routes.ts`. Then `git grep -n "invite-links/routes\|from './routes'" apps/server/src/invite-links apps/server/src/app.ts` must show nothing.

### Read first
`AGENTS.md`, `apps/server/src/invite-links/routes.ts`, `apps/server/src/invite-links/api.ts` (lines 1-60 and 195-250), `apps/server/src/app.ts` (lines 40-80), `apps/server/src/invite-links/invite-links.test.ts` (lines 1-30 and 550-565).

### Allowed files
`apps/server/src/invite-links/routes.ts`, `apps/server/src/invite-links/api.ts`, `apps/server/src/invite-links/invite-links.test.ts`, `apps/server/src/app.ts`, `work/T-0646-delete-invite-links-routes.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/invite-links
pnpm gate
```

### Acceptance
- `invite-links/routes.ts` is gone, and no file under `apps/server/src/invite-links` imports `hono`.
- The invite-links tests pass with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, tests and gate green.

### What I did
- Deleted `apps/server/src/invite-links/routes.ts` (the unused Hono helper module).
- Moved both interfaces into `apps/server/src/invite-links/api.ts`:
  - `InviteLinksRoutesDependencies` → `InviteLinksApiDependencies` (bodies unchanged), and updated the `createInviteLinksApi(deps: ...)` parameter to the new name.
  - `TestInviteLinksOverrides` kept its name and body.
  - Added the type imports the interfaces need (`AuditRecorder`, `Auth`, `ServerConfig`, `ServerDatabase`, `EjabberdAdminClient`); reused the existing `Logger`, `HttpServerRequest` and `RateLimiter` imports. Removed `import type { InviteLinksRoutesDependencies } from './routes';`.
- `apps/server/src/app.ts`: merged the import into `import { createInviteLinksApi, type TestInviteLinksOverrides } from './invite-links/api';`. Nothing else changed.
- `apps/server/src/invite-links/invite-links.test.ts`: changed `trustedClientIp` import from `./routes` to `../http/client-ip`. Tests and assertions untouched.

### Files changed
- `apps/server/src/invite-links/routes.ts` (deleted)
- `apps/server/src/invite-links/api.ts`
- `apps/server/src/invite-links/invite-links.test.ts`
- `apps/server/src/app.ts`
- `work/T-0646-delete-invite-links-routes.md` (report + status)

### Commands and results
- `pnpm install`: done in 12.1s (1173 packages; pre-existing peer/version warnings only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/invite-links`: **1 file passed, 21 tests passed** (14.44s).
- `git rm apps/server/src/invite-links/routes.ts`: `rm 'apps/server/src/invite-links/routes.ts'`.
- `git grep -n "invite-links/routes\|from './routes'" apps/server/src/invite-links apps/server/src/app.ts`: no matches (exit 1).
- `git grep -n "hono" apps/server/src/invite-links`: no matches (exit 1).
- `pnpm gate` (from repo root): `gate exit: 0`; summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (24.8s)
  PASS  lint  (1.6s)
  PASS  typecheck  (11.0s)
  PASS  tests @zilar/server  (12.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- None. All interfaces were moved unchanged apart from the rename the spec asked for.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 36ea10ee, the current HEAD.
- **Lead check:**
  - `routes.ts` is deleted;
  - the interfaces moved to `api.ts`;
  - `app.ts` and the test change one import line each;
  - there is no hono import left in `invite-links/`.
