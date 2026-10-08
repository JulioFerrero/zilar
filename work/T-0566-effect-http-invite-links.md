---
id: T-0566
title: "Effect C (HTTP): group invite links (create, list, revoke, join preview, join) onto the HttpApi adapter using socketAddressOf + clientIpFrom for the per-IP join limiter; zod to Effect Schema; same order, texts and 404 invalid_link; tests unchanged"
status: merged
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

### What I did
- Created `apps/server/src/invite-links/api.ts`: the five routes as an Effect `HttpApi` group (`invite-links`, prefix `/api`) with the same methods, paths, statuses, bodies, audit calls, texts and step order as the deleted Hono router. Moved `serviceDeps`, the three limiters and the client-IP resolver here.
- `routes.ts`: dropped zod (`createLinkSchema`, `tokenSchema`), `createInviteLinksRoutes` and the Hono factory. Kept `InviteLinksRoutesDependencies`, `TestInviteLinksOverrides`, `clientIpFor` (still Hono-typed; only `setup/routes.ts` uses it now), `trustedClientIp` and the `INVITE_LINK_TOKEN_HEX_LENGTH` re-export. Changed `getClientIp` in both interfaces to `(request: HttpServerRequest.HttpServerRequest) => string`.
- `app.ts`: replaced the `app.route('/api', createInviteLinksRoutes(...))` call with `createInviteLinksApi(...)` + `mountEffectRoutes(...)` at the same position (after groups, before roles).
- No test mounts `createInviteLinksRoutes` directly (grep), so no item-11 wrapper was needed.

### Step order
- `POST /groups/:id/invite-links`: Session → payload decode (group schema-error middleware → 400 `invalid_request`) → `createInviteLink` → 201. Body is strict via `HttpApi.PayloadParseOptions { onExcessProperty: 'error' }`.
- `GET /groups/:id/invite-links`: Session → list → `{ links }`.
- `DELETE /groups/:id/invite-links/:linkId`: Session → revoke → 204 (`HttpServerResponse.empty`).
- `GET /join/:token`: Session → **preview limiter as endpoint middleware** (before the token check) → token shape check (404 `invalid_link`, via `Schema.decodeUnknownOption`) → preview.
- `POST /join/:token`: Session → token shape check (404 `invalid_link`) → user limiter → IP limiter (both 429) → join. Because endpoint middleware runs before the handler, the token check that must precede the limiters lives in the handler; the GET limiter that must precede the token check is endpoint middleware.
- Client IP: `deps.getClientIp ?? (request) => clientIpFrom({ forwardedFor: request.headers['x-forwarded-for'], socketAddress: socketAddressOf(request) }, deps.trustedProxyHops ?? config.TRUSTED_PROXY_HOPS)`.

### Success-schema field-by-field comparison (guide item 8)
- `CreatedInviteLink` (service) `{ id, token, url }` → `Schema.Struct { id: String, token: String, url: String }`. 3/3. Token appears only here (201).
- `InviteLinkView` (service) `{ id, label: string|null, tokenHint, uses: number, maxUses: number|null, expiresAt: string|null, revoked: boolean, createdAt: string }` → `{ id: String, label: NullOr(String), tokenHint: String, uses: Number, maxUses: NullOr(Number), expiresAt: NullOr(String), revoked: Boolean, createdAt: String }`. 8/8.
- List body `{ links: InviteLinkView[] }` → `{ links: Array(InviteLinkView) }`. 1/1.
- `JoinPreview` (service) `{ groupTitle, memberCount, alreadyMember, groupId?, kind }` → `{ groupTitle: String, memberCount: Number, alreadyMember: Boolean, groupId: optional(String), kind: Literals(['group','channel']) }`. 5/5; `groupId` stays absent for non-members (service omits the key).
- `JoinByLinkResult` (service) `{ groupId, alreadyMember }` → `{ groupId: String, alreadyMember: Boolean }`. 2/2.
- Revoke returns `void` → `success: Schema.Void`, answered 204.

### Message-text comparison (guide item 10)
- 404: unchanged byte-for-byte via the service's `toInvalidLink()` (`invalid_link` / "This invite link is invalid or has expired").
- 429: unchanged "Too many join attempts, try again later".
- 400 create-body: old zod used the first issue's message (`parsed.error.issues[0]?.message ?? 'Invalid request'`); now Effect Schema's first message via the schema-error middleware (`error.cause.message || 'Invalid request'`). The fallback text is identical; the per-field wording differs. No test asserts that wording — the body-validation tests assert only the 400 status (`invite-links.test.ts:148-153`), which stays green.

### Files changed
`apps/server/src/invite-links/api.ts` (new), `apps/server/src/invite-links/routes.ts`, `apps/server/src/app.ts`, this task file. All inside the Allowed files.

### Commands and real results
- `pnpm install`: "Done" (40.2s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot invite-links`: 1 file, **21 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups setup authz-sweep app.test`: 6 files, **117 passed**.
- `pnpm --filter @zilar/server typecheck`: passed (after the logger fix below).
- `pnpm gate` (first run): **GATE FAIL** — 7 `@zilar/server` typecheck errors in `api.ts`: `InviteLogger` (the old minimal `{ warn }` deps type) is not assignable to the pino `Logger` the Effect envelope/session need.
- `pnpm gate` (after fix): **GATE PASS** — install, format, lint, typecheck and `tests @zilar/server` all PASS, "scope: every changed file is inside the Allowed files".

### Deviations
- Widened `InviteLinksRoutesDependencies.logger` from `InviteLogger` to pino `Logger`. Required by the Effect adapter (envelope + `sessionLayer`), and matches the migrated `topics/api.ts` and `groups/api.ts`; a pino `Logger` is assignable to the service's `InviteLogger`, so `serviceDeps` still typechecks and no test changes. The override interface has no logger field, so it was untouched.
- `clientIpFor` is kept Hono-typed (spec: keep it; `setup/routes.ts` still calls it). The invite-links handlers use `socketAddressOf` + `clientIpFrom` directly.

### Security checklist
- The one-time token is returned only in the 201 create body; list never returns it, and the token never reaches the new limiter/audit path. Existing service audit entries still carry ids/hint only.
- Per-IP join limiter is fed by the edge-stamped socket address (client value stripped in `forwardRequest`), or the trusted-proxy hop from `x-forwarded-for`.
- All five routes require `Session`, so the authz sweep sees them and they answer 401 unauthenticated.
- No new writes and no change to caps/transactions (service untouched).

### Open questions
None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** 0 must-fix, 2 nits accepted. The packet (07:34) is newer than HEAD 3e2c3d2e.
  1. The decode texts of the 400 differ from zod, which item 10 allows because no test asserts them.
  2. `logger` is a pino `Logger`, as in groups and topics.
- **No test file changed.**
- **Lead check:** the output schemas list every field of the service types `InviteLinkView`, `CreatedInviteLink`, `JoinPreview` (with `groupId` optional) and `JoinByLinkResult`, and the token is only in the 201 create answer.
- **The per-IP limiter** reads `clientIpFrom({ forwardedFor, socketAddress: socketAddressOf(request) }, hops)`.
