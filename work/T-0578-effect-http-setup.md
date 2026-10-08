---
id: T-0578
title: "Effect C (HTTP): first-run setup (GET /setup/status, POST /setup) onto HttpApi; per-IP limiter via clientIpFrom + socketAddressOf; item-11 wrapper kept for the route-shape test; zod body to Effect Schema with the same first-issue texts; transactions unchanged; tests unchanged"
status: merged
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

Done. First-run setup is served by Effect `HttpApi`; all listed tests pass unchanged; `pnpm gate` ends with GATE PASS and every changed file is inside the Allowed files.

What I did:
- Created `apps/server/src/setup/api.ts`: `SetupGroup` (`GET /setup/status`, `POST /setup`, no `Session` middleware — public routes) with `.prefix('/api')`, `SetupApi`, `SETUP_API_ROUTES`, and `createSetupApi(deps)`. Step order kept exactly: needsSetup 404 -> per-IP limiter 429 -> manual body decode 400 -> drizzle transaction verbatim (moved code, `takeSetupLock` + re-check + `saveMailSettings` + `createSetupInvite`) -> test send -> rollback transaction on send failure (warn with `errName` only, then 422 `mail_send_failed`) -> mailer swap -> `setup.completed` audit (ids only) -> `{ ok: true, inviteCode }`.
- Body decode runs manually in the handler (`request.request.json` with bad-JSON-as-`null`, `Schema.decodeUnknownResult`), so the limiter still runs before the decode. First-issue texts via one `makeFilter` per field (T-0561 pitfall: `{ message }` on `isMinLength`/`isMaxLength` doesn't reach annotations in effect 4.0.2) and a `firstMessage` walk (Composite-first-child / Pointer / Filter / inner `InvalidValue` message annotation), fallback "Invalid request". `adminEmail` is `Schema.Trim` + `decodeTo` lowercase transform (T-0506 recipe) before the checks; email rule is zod v4's practical `z.email()` pattern.
- Rewrote `apps/server/src/setup/routes.ts` as the item-11 wrapper: keeps `SetupRoutesDependencies` (with `getClientIp` now taking the Effect request, as T-0566), re-exports the rate-limit constants from `./api`, registers one `routes.on(method, path)` per `SETUP_API_ROUTES` entry, strips `SOCKET_ADDRESS_HEADER` and stamps the `getConnInfo` socket address. No zod, no Hono handlers left.
- `apps/server/src/app.ts`: replaced `app.route('/api', createSetupRoutes(...))` with `mountEffectRoutes(app, setupApi.routes, setupApi.handler)` at the same position with the same deps. `SetupRoutesDependencies` still imported from `./setup/routes`.

Files changed: `apps/server/src/setup/api.ts` (new), `apps/server/src/setup/routes.ts`, `apps/server/src/app.ts`, `work/T-0578-effect-http-setup.md`.

Commands and real results:
- `pnpm install`: ok (19.4s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot setup/routes.test.ts`: 16 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot setup/`: 23 passed (2 files).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot setup authz-sweep app.test`: 4 files, 37 tests, all passed.
- Throwaway end-to-end proof (temporary test, since deleted): POST /api/setup answered byte-identical first-issue texts for all 7 custom messages (`resendApiKey must not be empty`, `resendApiKey must be at most 256 characters`, `from must not be empty`, `from must be at most 320 characters`, `adminEmail must not be empty`, `adminEmail must be at most 320 characters`, `adminEmail must be a valid email address`) plus 200 for `ADMIN@EXAMPLE.COM` (lowercase path). 1 passed, then removed.
- `pnpm gate`: `PASS install (frozen) (2.6s)`, `PASS format (42.6s)`, `PASS lint (1.2s)`, `PASS typecheck (1.0s)`, `PASS tests @zilar/server (882.0s)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. (First gate run failed format on my 2 files — fixed with prettier on those files; second failed lint — removed 2 unused imports and 3 useless regex escapes; the regex is verified identical to zod's on 10 sample addresses.)

Problems / deviations:
- `Schema.decodeUnknownEither` does not exist in effect 4.0.2; used `Schema.decodeUnknownResult` instead — its failure is a `SchemaError` wrapper, so the message walk reads `decoded.failure.issue` (found by dumping the real tree; initial version read `.failure` directly and fell back to "Invalid request").
- `await` is illegal inside `Effect.gen`; the send and rollback use the `Effect.promise(...).pipe(map/catchDefect)` outcome pattern from `machines/api.ts`.
- Success schemas list every returned field (`SetupStatus`: needsSetup, mailConfigured; `SetupResult`: ok, inviteCode) — side-by-side check per guide item 8.

Security checklist: secrets never logged (rollback warn carries `errName` only; 422 text is fixed); transaction + advisory lock + in-lock re-check unchanged; 404-before-429 order kept; wrapper strips client-forged socket header; audit carries ids only; no new routes (same two, covered by the authz sweep allowlist).

Open questions: none.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 0 findings. The packet (09:36) is newer than HEAD f7f7b485.
- **No test file changed.**
- **Lead check:**
  - the step order is kept: 404, 429, 400, then the transaction with the lock, the test send, the rollback, and an audit with ids only;
  - the client IP comes from the Effect request.
- **Follow-up:** `clientIpFor` in `invite-links/routes.ts` is now unused.
