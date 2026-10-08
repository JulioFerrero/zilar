---
id: T-0578
title: "Effect C (HTTP): first-run setup (GET /setup/status, POST /setup) onto HttpApi; per-IP limiter via clientIpFrom + socketAddressOf; item-11 wrapper kept for the route-shape test; zod body to Effect Schema with the same first-issue texts; transactions unchanged; tests unchanged"
status: todo
milestone: M5
branch: task/T-0578-effect-http-setup
model: auto
effort: low
depends_on: [T-0572]
estimate: 0.5 day
---

# T-0578: first-run setup on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. The recipe is `docs/EFFECT_GUIDE.md` "Moving a server route module onto Effect HTTP", items 1-12. The worked examples:
- `apps/server/src/invite-links/api.ts` (T-0566: `getClientIp` takes the Effect request, else `clientIpFrom({ forwardedFor, socketAddress: socketAddressOf(request) }, hops)`);
- `apps/server/src/machines/routes.ts` (T-0572: an item-11 wrapper that strips the client copy of `SOCKET_ADDRESS_HEADER` and stamps the socket address before forwarding).

**This task moves the HTTP layer only.** The two `deps.db.transaction(...)` blocks, `takeSetupLock`, the settings helpers and `createSetupInvite` stay drizzle and **unchanged**. They move later with the settings modules.

### Verified facts (do not re-derive)
- **`apps/server/src/setup/routes.ts`** (277 lines):
  - **`GET /setup/status`** (113): `{ needsSetup: false, mailConfigured: true }` when an admin exists, else `{ needsSetup: true, mailConfigured }`.
  - **`POST /setup`** (120), in this order:
    1. `needsSetup` false gives 404 `not_found` "Not found" (**before** the limiter);
    2. the per-IP limiter gives 429 "Too many setup attempts, try again later";
    3. the body: bad JSON counts as `null`, and a decode failure is 400 `invalid_request` with **the first issue's message**, else "Invalid request";
    4. the transaction (a non-`HttpError` failure is 500 `internal_error` "Setup failed, try again"); a null invite code is 404;
    5. the test send; on failure, a rollback transaction (a failure there only logs a warn with `errName`), then 422 `mail_send_failed` with the fixed text;
    6. the mailer swap;
    7. the audit `setup.completed`;
    8. `{ ok: true, inviteCode }`.
- **`setupSchema`** (52):
  - `resendApiKey`: trim, min 1 "resendApiKey must not be empty", max 256 "resendApiKey must be at most 256 characters";
  - `from`: trim, min 1 and max 320, with the same message pattern;
  - `adminEmail`: trim, **lowercase**, min 1, max 320, then **email** "adminEmail must be a valid email address".
  
  **These texts are what the setup page shows, so keep them byte-identical.**
  - **Pitfall found by the T-0561 pre-review:** in effect 4.0.2 the `{ message }` option on `isMinLength` and `isMaxLength` does **not** reach the issue annotations; only a `makeFilter` that returns the text does. Use `makeFilter` (or another proven way) for each message.
  - **Prove each text with a quick check in the Report.**
- **The client IP:**
  - `SetupRoutesDependencies.getClientIp` (83) is `(c: Context) => string`. **Change its type to take the Effect request**, as T-0566 did.
  - The tests pass zero-argument functions (`apps/server/src/setup/routes.test.ts:61,127,346`), so they stay assignable.
  - The default is `clientIpFrom({ forwardedFor: request.headers['x-forwarded-for'], socketAddress: socketAddressOf(request) }, deps.trustedProxyHops ?? deps.config.TRUSTED_PROXY_HOPS)`.
  - `clientIpFor` (`invite-links/routes.ts:50`) then has no importer left in `setup/`. Leave `invite-links` alone.
- **The route-shape test** (`setup/routes.test.ts:337-351`) mounts `createSetupRoutes(...)` on a `new Hono()` and expects **exactly** `GET|/api/setup/status` and `POST|/api/setup` in `routes.routes`.
  - Keep `createSetupRoutes(deps): Hono` as the item-11 wrapper: one `routes.on(method, path)` per route, like `machines/routes.ts`.
  - The wrapper deletes `SOCKET_ADDRESS_HEADER`, stamps the `getConnInfo` socket address, and forwards to the api handler.
- **The mount:** `apps/server/src/app.ts:318-330` mounts `createSetupRoutes({ auth, db, config, mailer, logger, audit, ...setup })`, where the `setup` test overrides include `getClientIp`, `sendTestCode` and `limiter`. Mount with `mountEffectRoutes(...)` at the same position with the same deps. `SetupRoutesDependencies` is imported by `app.ts:19`, so keep it exported.
- **Tests (all unchanged):** `apps/server/src/setup/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/setup/api.ts`** with the two routes:
   - the same order, statuses, texts and bodies;
   - the 404-before-429 order;
   - the Effect Schema body with the same trims, lowercase, bounds, email rule and texts;
   - the transaction code moved verbatim.
   
   Export `createSetupApi(deps)` and `SETUP_API_ROUTES`.
2. **`routes.ts`:** keep `SetupRoutesDependencies` (with the new `getClientIp` type), `SETUP_RATE_LIMIT_MAX`, `SETUP_RATE_LIMIT_WINDOW_MS` and the wrapper. Remove the zod schema and the Hono handlers.
3. **`app.ts`:** mount as described above.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/invite-links/api.ts`, `apps/server/src/machines/routes.ts`, `apps/server/src/setup/routes.ts` (all of it), `apps/server/src/setup/routes.test.ts` (lines 40-140 and 330-360) and `apps/server/src/app.ts` (lines 310-332).

### Allowed files
`apps/server/src/setup/api.ts`, `apps/server/src/setup/routes.ts`, `apps/server/src/app.ts`, `work/T-0578-effect-http-setup.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot setup authz-sweep app.test
pnpm gate
```

### Acceptance
- First-run setup is served by Effect `HttpApi`, with the same answers, texts and order, the limiter on the shared client-IP rule, and no zod in `setup/routes.ts` or `setup/api.ts`.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
