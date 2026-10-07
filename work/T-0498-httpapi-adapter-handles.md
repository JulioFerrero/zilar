---
id: T-0498
title: "Effect F4 + P1: Effect HttpApi mounted under Hono (strangler adapter, session middleware, identical error JSON) — the handles module moved onto it, its Hono-level tests unchanged"
status: merged
milestone: M5
branch: task/T-0498-httpapi-adapter-handles
model: auto
effort: low
depends_on: [T-0495]
estimate: 1 day
---

# T-0498: the HttpApi adapter, piloted on handles

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's own HTTP server replaces Hono entirely. Plan `docs/audit/effect-everywhere-plan.md`:
- §2.1 is the strangler: mount Effect `HttpApi` handlers under Hono one module at a time, then flip the edge to `@effect/platform-node` and remove Hono;
- §4.2 F4 is the adapter and harness;
- §4.3 P1 is the first module.

This task does both F4 and P1 with the small `handles` module. **The proof is that `apps/server/src/handles/handles.test.ts` passes unchanged** through the new handlers.

### Verified facts (do not re-derive)
- **`apps/server/src/app.ts` `createApp`** (from line 207):
  - `new Hono` (line 245);
  - `requestId()` middleware (line 259);
  - the request log middleware (lines 261-283), which logs `logPath(c.req.path)` so join tokens never reach the log;
  - CORS on `/api/*` (lines 285-291) and the unsafe-method origin guard (lines 293-299), which throws `HttpError(403, 'forbidden', 'Origin is not allowed')`;
  - better-auth `app.all('/api/auth/*', …)` (line 301);
  - the routers `app.route('/api', create…Routes(...))`, with handles at line 323: `createHandlesRoutes({ auth, db, audit: auditRecorder })`;
  - `/health` (line 601), `notFound` (line 616);
  - **`onError` (from line 623): an `HttpError` becomes JSON `{ error: { ...detail, code, message, requestId } }`** with its status.
- **`apps/server/src/errors.ts`:** `HttpError(status, code, message, detail = {})`.
- **`apps/server/src/auth/session.ts:6-12`:** `requireSession(auth, headers)` calls `auth.api.getSession({ headers })` and throws `HttpError(401, 'unauthorized', 'Authentication required')`.
- **`apps/server/src/handles/routes.ts`** is a Hono router:
  - zod `checkQuerySchema` (`handle` 1..64, `kind` user|group optional) and a strict `claimBodySchema`;
  - two rate limiters (check: 30 per 10 min; claim: 10 per 24 h; injectable, with a `now` seam);
  - it calls the `apps/server/src/handles/store.ts` Promise functions (`checkHandleAvailability`, `checkGroupHandleAvailability`, `claimHandle`, `handleForUser`, `reapExpiredRetiredHandles`);
  - the deps are `{ auth, db, audit?, now?, checkLimiter?, claimLimiter? }`.
  
  Tests: `apps/server/src/handles/handles.test.ts` and `apps/server/src/handles/rules.test.ts`.
- **Effect 4 HTTP** (in the installed `effect` 4.0.0, exports `effect/http` and `effect/http-api`):
  - `http-api/HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, `HttpApiMiddleware`, `HttpApiSecurity`, `HttpApiTest`;
  - `http/HttpRouter.d.ts:752` `toWebHandler(appLayer, …)`, which turns a router layer into a `(Request) => Promise<Response>` fetch handler;
  - `http/HttpEffect.d.ts:156` `fromWebHandler`.
  
  Docs: `docs/effect-reference/LLMS.md` "Building HttpApi servers".
- **The runtime and logger** come from T-0495 (merged before this task starts): `apps/server/src/effect/runtime.ts` (`makeServerRuntime`) and `apps/server/src/effect/logger.ts` (`makePinoLoggerLayer`).

### What to build
1. **`apps/server/src/effect/http.ts`, the strangler adapter:**
   - **`mountEffectApi(app, prefix, webHandler)`** mounts a fetch handler from `toWebHandler` under Hono (`app.all(prefix + '/*', …)` or exact paths), passing `c.req.raw`. Hono's existing middleware still runs first: request id, the log line, CORS and the origin guard.
   - **The request id** reaches the Effect side through a header that Hono sets (for example `x-request-id` on the forwarded `Request`). Error bodies carry it.
   - **A `Session` HttpApiMiddleware or security** calls `auth.api.getSession({ headers })` and fails with an error that renders exactly like `HttpError(401, 'unauthorized', 'Authentication required')`.
   - **One error encoding:** any handler failure carrying `{ status, code, message, detail? }` renders as `{ error: { ...detail, code, message, requestId } }` with that status, **byte-identical** to `onError`. Unknown defects render as today's 500 branch: read `onError` and copy its exact body.
2. **`apps/server/src/handles/api.ts`:** the handles endpoints as an `HttpApiGroup`, with the same methods, paths, query and body rules and status codes as `routes.ts`.
   - **Schema** replaces zod for the query and body. Invalid input must give **the same status and error body** as today's zod path; read how `routes.ts` turns a zod failure into an `HttpError` and match it.
   - **Rate limiters:** the same limiters and the same `now` seam, through deps.
   - **Handlers** call the existing `store.ts` functions (drizzle stays for now; the DB rewrite is a separate lane).
   - **Audit:** the same audit calls.
3. **`apps/server/src/app.ts`:** replace line 323's `app.route('/api', createHandlesRoutes(...))` with the adapter mount for the handles paths. **Nothing else in `app.ts` changes.** Delete `apps/server/src/handles/routes.ts`, or keep it exporting the constants that tests import; check what `handles.test.ts` imports and keep those exports working.
4. **Tests:**
   - `apps/server/src/handles/handles.test.ts` and `apps/server/src/handles/rules.test.ts` pass **unchanged**. That is the acceptance proof. If one cannot, stop and report BLOCKED with the exact diff in behaviour; do not edit it.
   - Add `apps/server/src/effect/http.test.ts` covering:
     - the error envelope for a custom error and for a defect;
     - 401 without a session;
     - the request id carried into the body;
     - an origin-guard rejection still coming from Hono for an Effect-mounted path.
5. **Write the recipe** for moving the next module as a "Recipe" section in your Report. The lead copies it into the guide.

### Read first
`AGENTS.md`, `docs/audit/effect-everywhere-plan.md` §2.1 and §4, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md` (HttpApi), `apps/server/src/app.ts:200-330` and `:600-660`, `apps/server/src/errors.ts`, `apps/server/src/auth/session.ts`, `apps/server/src/handles/` (all files), `apps/server/src/effect/runtime.ts`, `apps/server/src/effect/logger.ts`.

### Allowed files
`apps/server/src/effect/http.ts`, `apps/server/src/effect/http.test.ts`, `apps/server/src/handles/api.ts`, `apps/server/src/handles/routes.ts`, `apps/server/src/app.ts`, `work/T-0498-httpapi-adapter-handles.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles src/effect
pnpm gate
```

### Acceptance
- An Effect `HttpApi` adapter is mounted under Hono, with session middleware and an error envelope identical to `onError`.
- The handles module runs on it, and `handles.test.ts` and `rules.test.ts` are unchanged and green.
- A recipe for the next modules is in the Report.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### Round 2 (fix round)

PREREVIEW findings fixed, one commit each (all in the Allowed files):

- **Finding 1 (must-fix) — excess claim-body keys.** The claim endpoint is annotated `HttpApi.PayloadParseOptions: { onExcessProperty: 'error' }`, so `{ handle, extra }` fails the `HandleClaimBody` decode with `400 invalid_request` again. Commit `T-0498: fix finding 1 - reject excess claim-body keys`.
- **Finding 2 (should-fix) — invalid-claim message.** On a failed payload decode the schema-error layer re-reads the cached request body and runs the original zod `claimBodySchema` only to reproduce `issues[0].message` (`Unrecognized key: "extra"`, `Invalid input: expected string, received undefined`, ...). The body is still decoded by Effect `Schema`; zod runs only on the already-failed path. Commit `T-0498: fix finding 2 - restore the legacy zod invalid-claim message`.
- **Finding 3 (should-fix) — limiter before validation.** A `HandlesCheckRateLimit` middleware runs after `Session` and before the query decode, so an invalid `GET /api/handles/check` query still spends the 30-per-10-min budget, matching the old `checkLimiter.allow` -> `safeParse` order. The handler no longer calls the check limiter. Commit `T-0498: fix finding 3 - charge the check budget before query validation`.
- **Finding 4 (should-fix) — session-store failure envelope.** `sessionLayer(auth, logger)` catches a `getSession` defect and renders the `app.onError` 500 branch (log + `{ error: { code: 'internal_error', ... } }`) instead of Effect's default defect path. Commit `T-0498: fix finding 4 - render session store failures through the error envelope`.
- **Finding 5 (nit)** — `requestIdOf`'s absent-header fallback is not on a line this round changed and mounted requests always carry Hono's header, so it is left as is.

Tests added to `apps/server/src/effect/http.test.ts` (one per behaviour fix): an excess-key claim body answers the legacy 400 message; a missing `handle` keeps the legacy message; 35 invalid check queries still hit 429; an auth-store rejection renders 500 and logs once. `handles.test.ts` and `rules.test.ts` are still unchanged.

`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles src/effect` — **5 files, 38 tests passed**.

`pnpm gate` (repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (20.1s)
PASS  lint  (0.8s)
PASS  typecheck  (9.9s)
PASS  tests @zilar/server  (292.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The exact-message shim is handles-specific; the recipe's step 2 still applies, and a later module decides its own legacy-message parity.

### What I did

- **`apps/server/src/effect/http.ts` (new)** — the strangler adapter:
  - `Session` `HttpApiMiddleware.Service` + `CurrentUser` service and `sessionLayer(auth, logger)`. An absent session short-circuits with `HttpError(401, 'unauthorized', 'Authentication required')` *before* query/body decoding, exactly like `requireSession`.
  - `httpErrorResponse(requestId, error)` / `failureResponse(logger, requestId, cause)` render the two `app.onError` branches byte-for-byte: `{ error: { ...detail, code, message, requestId } }` for an `HttpError`, `{ error: { code: 'internal_error', message: 'Internal server error', requestId } }` + `logger.error({ err, requestId }, 'unhandled request error')` otherwise.
  - `withErrorEnvelope(effect, logger, requestId)` catches defects (`catchDefect`, so typed failures and interruption pass through) and renders the envelope.
  - `mountEffectApi(app, prefix, webHandler)` (prefix wildcard, the literal spec signature) and `mountEffectRoutes(app, routes, webHandler)` (exact method + path). `forwardRequest` clones `c.req.raw` and sets `x-request-id` from Hono's `requestId` variable.
- **`apps/server/src/handles/api.ts` (new)** — the handles module as an `HttpApi` group (`.prefix('/api')`):
  - Effect `Schema` replaces the two zod schemas; a `layerSchemaErrorTransform` middleware maps a query decode failure to the old `200 { available: false, reason: 'invalid' }` and a payload decode failure to `400 invalid_request`.
  - Same limiters/`now` seam/audit calls/status codes as `routes.ts`; handlers call the same `store.ts` Promise functions through `Effect.promise`.
  - Returns `{ handler, routes }` where `routes` are the exact `GET /api/handles/check` and `PUT /api/me/handle` pairs.
- **`apps/server/src/effect/http.test.ts` (new)** — error envelope for an `HttpError` (with `detail`), the defect/500 branch with the log assertion, 401 without a session, the request id in the body, a store `HttpError` end-to-end, and the Hono origin-guard 403 for an Effect-mounted path.
- **`apps/server/src/app.ts`** — only line 323 changed: `app.route('/api', createHandlesRoutes(...))` -> `createHandlesApi(...)` + `mountEffectRoutes(app, handlesApi.routes, handlesApi.handler)` (imports updated).
- **`apps/server/src/handles/routes.ts`** — deleted. Nothing imported it (only `app.ts` did), so no constant re-export was needed.

### Why `mountEffectRoutes` instead of the prefix wildcard

The `app.routes` table is what the authz sweep walks. A wildcard mount registers `ALL /api/handles/*`, which (a) the sweep actualizes to `GET /api/handles/x` and the Effect router answers 404, and (b) hides both routes from the "every `/api` route answers 401" check. Mounting the exact method + path keeps `app.routes` identical to the old `app.route('/api', ...)` output, so both sweep tests stay meaningful. The spec allows "`app.all(prefix + '/*', …)` or exact paths"; `mountEffectApi` is implemented for the wildcard form too, but no module should use it without checking the sweep.

### Deviations and caveats

- **Invalid-claim-body message (fixed in round 2).** The schema-error middleware reproduces the old zod `issues[0].message` by running the original `claimBodySchema` on the cached body when the payload decode fails; the payload decode itself stays on Effect `Schema`. Status, code and message match today's zod path.
- **Claim-body strictness (fixed in round 2).** The claim endpoint annotates `HttpApi.PayloadParseOptions: { onExcessProperty: 'error' }`, so `{ handle, extra }` fails the decode like the old `.strict()`.
- **Layer lifetime.** `HttpRouter.toWebHandler` builds the layer immediately and returns a `dispose`, but Hono's `createApp` has no lifecycle hook, so each app builds a handler and never disposes it. `HttpServer.layerServices` (Path/HttpPlatform/FileSystem/Etag) holds no long-lived resource; the edge flip (plan §4.4 step 8) owns the runtime and disposal. Flagging it rather than inventing a shutdown seam.
- **Router logging.** `toWebHandler(..., { disableLogger: true })` — its default logger prints full `http.url` (query included), which would bypass Hono's redacted-path logging; Hono still logs the request.

### Commands and real results

- `pnpm install` — done, 0 errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles src/effect` — **5 files passed, 34 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot authz-sweep app.test` — **2 files passed, 14 tests passed** (the mounted routes appear in the sweep and answer 401).
- `pnpm gate` (repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (28.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (7.8s)
  PASS  tests @zilar/server  (322.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- `handles.test.ts` and `rules.test.ts` were **not edited** and pass unchanged.

### Recipe: moving the next module onto the adapter

1. **Group.** In `<module>/api.ts` create `HttpApiGroup.make('<id>').add(<endpoints>).middleware(Session).prefix('/api')` and `HttpApi.make('<id>').add(group)`. The `/api` prefix is required: the adapter forwards `c.req.raw` unchanged, so the Effect router sees the full Hono path.
2. **Schemas.** Replace the zod query/payload schemas with `Schema.Struct`s. Add a module-local `HttpApiMiddleware.Service` and provide it with `HttpApiMiddleware.layerSchemaErrorTransform(service, transform)`; map `error.kind === 'Query'` (or the module's "invalid is a 200" case) to the old success body and every other kind to `failureResponse(logger, requestId, new HttpError(400, 'invalid_request', 'Invalid request'))`, reading `requestId` via `yield* HttpServerRequest.HttpServerRequest`.
3. **Auth.** Add `.middleware(Session)` for session-required modules; read the user with `const user = yield* CurrentUser`.
4. **Handlers.** Lift every Promise/DB call with `Effect.promise` (rejections become defects) and wrap each body in `withErrorEnvelope(effect, logger, requestIdOf(request.request))`. Return the plain success value; return `httpErrorResponse(requestId, new HttpError(...))` for a deliberate error. Keep rate limiters, `now` and audit calls identical.
5. **Layer.** `HttpApiBuilder.group(api, '<id>', (handlers) => handlers.handle(...))` -> `HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer), Layer.provide(sessionLayer(auth, logger)), Layer.provide(schemaErrorLayer(logger)))` -> `HttpRouter.toWebHandler(layer.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })`.
6. **Mount.** Export `{ handler, routes }` with the exact `{ method, path }` pairs (full `/api/...` path), then in `app.ts` replace the old `app.route('/api', create...Routes(...))` line with `mountEffectRoutes(app, mount.routes, mount.handler)`.
7. **Proof.** Run the module's existing Hono-level test file unchanged. If it cannot pass, stop and report BLOCKED (this is the P1 gate for the whole server bulk).
8. **Gotchas.** `effect/http` is a barrel of module namespaces: the service tag is `HttpServerRequest.HttpServerRequest` and the response type is `HttpServerResponse.HttpServerResponse`. Hono's `x-request-id` reaches Effect only because `mountEffectRoutes`/`mountEffectApi` clone the request and set the header. `toWebHandler`'s own logger must stay off (full URLs).

### Blocked / needs a decision

None. The two matching deviations above (zod message text, excess-property strictness) are recorded; no decision needed to proceed.

### Security checklist

- Session is enforced by middleware before any parsing; the sweep proves both routes answer 401 unauthenticated.
- Errors carry ids only (`code`, fixed `message`, `requestId`, and `detail` for `nextChangeAt`); no store/provider text leaks.
- The defect branch logs the error object through pino's existing redaction, same as `app.onError`.
- The claim path is rate-limited; the store's atomic claim/interval rules are untouched.
- The router's unredacted URL logger is disabled.

## Review (written by Claude)

Approved (lead, 2026-10-07). P1 gate passed.
- **The adapter** (`effect/http.ts`): a Session middleware (401 before decode) and an error envelope identical to `onError` for both branches. Routes are mounted per method and path, so the authz sweep keeps seeing them. The request id is forwarded, and the router logger is off because it would log full URLs.
- **handles** runs as an HttpApi group, and `handles.test.ts` and `rules.test.ts` are unchanged and green.
- **Accepted shims:** the old zod claim schema runs only to reproduce the legacy error message; it goes when zod leaves the server. The web handler is never disposed (no lifecycle hook until the edge flip).
- **Recipe:** copied into `docs/EFFECT_GUIDE.md` by the lead.
