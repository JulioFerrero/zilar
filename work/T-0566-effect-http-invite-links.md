---
id: T-0566
title: "Effect C (HTTP): group invite links (create, list, revoke, join preview, join) onto the HttpApi adapter using socketAddressOf + clientIpFrom for the per-IP join limiter; zod to Effect Schema; same order, texts and 404 invalid_link; tests unchanged"
status: todo
milestone: M5
branch: task/T-0566-effect-http-invite-links
model: auto
effort: low
depends_on: [T-0563]
estimate: 1 day
---

# T-0566: invite links on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"**, items 8-11. The worked examples are `apps/server/src/groups/api.ts` and `apps/server/src/topics/api.ts`.

This module waited for the client IP. **T-0563 added it:**
- `forwardRequest` stamps `x-zilar-socket-address`, and a client copy is always stripped;
- `socketAddressOf(request)` lives in `apps/server/src/effect/http.ts`;
- `clientIpFrom({ forwardedFor, socketAddress }, hops)` lives in `apps/server/src/http/client-ip.ts`.

**Do not touch** `invite-links/service.ts`.

### Verified facts (do not re-derive; read each route for its exact order, statuses and texts)
- **`apps/server/src/invite-links/routes.ts`** (about 250 lines after T-0563):
  - `InviteLinksRoutesDependencies` (line 32) holds `auth`, `db`, `config`, `adminClient`, `logger`, `audit?`, `now?`, `getClientIp?: (c: Context) => string`, `trustedProxyHops?` and `joinLimiters?: { user, ip, preview? }`;
  - `TestInviteLinksOverrides` (51) holds the same test seams; `app.ts` passes it through `setTestAppInviteLinks`;
  - `createLinkSchema` and `tokenSchema` (64 hex characters) are the zod schemas;
  - `createInviteLinksRoutes` (92) has three limiters: `userJoinLimiter`, `ipJoinLimiter` and `previewLimiter`.
- **The five routes:**
  - `POST /groups/:id/invite-links` (124). Session, then the body (a decode failure is 400 `invalid_request` with the first issue's message), then `createInviteLink`. It answers **201** with the link, **including the one-time token**;
  - `GET /groups/:id/invite-links` (149) answers `{ links }`, and tokens are never returned;
  - `DELETE /groups/:id/invite-links/:linkId` (157) answers **204**, and is idempotent;
  - `GET /join/:token` (167). Session, then the **preview limiter** (429 "Too many join attempts, try again later"), then the token check (404 `invalid_link` "This invite link is invalid or has expired"), then the preview;
  - `POST /join/:token` (182). Session, then the **token check** (404 `invalid_link`), then the **user limiter**, then the **IP limiter** (both 429 with the same text), then `joinByInviteLink`.
- **Keep the module-level exports** `clientIpFor`, `trustedClientIp` and `INVITE_LINK_TOKEN_HEX_LENGTH`:
  - `apps/server/src/setup/routes.ts:37` imports `clientIpFor`;
  - `apps/server/src/invite-links/invite-links.test.ts:26` imports `trustedClientIp`.
- **The client IP in the Effect handler:** `deps.getClientIp ?? clientIpFrom({ forwardedFor: request.headers['x-forwarded-for'], socketAddress: socketAddressOf(request) }, deps.trustedProxyHops ?? config.TRUSTED_PROXY_HOPS)`.
  - Change the **type** of `getClientIp` (in both dependency interfaces) to take the Effect request instead of a Hono `Context`.
  - The tests pass zero-argument functions (`getClientIp: () => '10.9.9.9'`, at `invite-links.test.ts:696` and `730`), and those stay assignable.
- **`apps/server/src/app.ts:371-382`** mounts `createInviteLinksRoutes({ …, ...testInviteLinksOverrides })`, after directory and groups and before roles. Keep it at the same position.
- **Tests (all unchanged):** `apps/server/src/invite-links/*.test.ts` (built through `createApp`, line 840), `apps/server/src/groups/*.test.ts`, the setup tests, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/invite-links/api.ts`** with the five routes on `HttpApi`:
   - the same statuses (201 and 204), bodies, audit calls, texts and **step order** above;
   - limiter-before-decode where it applies, using endpoint middleware as in `groups/api.ts`;
   - Effect Schema for the create body and the token, with no zod in the module;
   - success schemas listing every field the service returns, with the field-by-field comparison in the Report. The token appears only in the 201 create response.
   
   Export `INVITE_LINKS_API_ROUTES`.
2. **`routes.ts`:** keep the dependency and override types (with the new `getClientIp` type), `clientIpFor`, `trustedClientIp` and `INVITE_LINK_TOKEN_HEX_LENGTH`. Remove the zod schemas and the Hono factory, unless a test mounts the factory directly (check with grep). If one does, keep it as the item-11 wrapper.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position, passing the overrides as before.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts` (`socketAddressOf`), `apps/server/src/http/client-ip.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/invite-links/routes.ts` (all of it), `apps/server/src/invite-links/invite-links.test.ts` (lines 680-860), and `apps/server/src/app.ts` (lines 360-390).

### Allowed files
`apps/server/src/invite-links/api.ts`, `apps/server/src/invite-links/routes.ts`, `apps/server/src/app.ts`, `work/T-0566-effect-http-invite-links.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot invite-links groups setup authz-sweep app.test
pnpm gate
```

### Acceptance
- Invite links are served by Effect `HttpApi`, with the same answers and order, the per-IP limiter fed by the real socket address or the trusted proxy hop, and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
