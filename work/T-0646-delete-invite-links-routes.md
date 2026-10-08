---
id: T-0646
title: "Hono: delete invite-links/routes.ts; move its two interfaces into invite-links/api.ts; app.ts and invite-links.test.ts import from api.ts and http/client-ip.ts; same assertions"
status: todo
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

## Review (written by Claude)
