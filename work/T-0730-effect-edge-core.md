---
id: T-0730
title: "B1.3b: the Effect edge — new effect/edge.ts builds the whole HTTP edge with effect/http (request id, masked request log, CORS + origin guard on /api, better-auth passthrough, the 36 module mounts, /health, 404, error envelope) via HttpRouter.toWebHandler; createApp returns it ({ fetch, request, routes }) instead of a Hono app"
status: merged
milestone: M5
branch: task/T-0730-effect-edge-core
model: auto
effort: default
depends_on: [T-0717]
estimate: 1 day
---

# T-0730: the Effect edge core (B1.3b)

## Spec (written by Claude, do not edit)

### Why
Julio wants Effect HTTP to replace Hono. Every API module is already an Effect `HttpApi`, but the outer edge in `apps/server/src/app.ts` is still a Hono app. This task is B1.3 in `docs/audit/effect-edge-flip-plan.md` §4. It uses architecture A (§2.1): the edge dispatches to the existing module web handlers, and **the modules do not change**. The behaviour seen from outside must stay exactly the same; the 827 `.request(` test calls are the parity check.

### Verified facts (do not re-derive)
- **`apps/server/src/app.ts`** (after T-0717), in this order:
  - `app.use('*', requestId())` (Hono: it uses an inbound `X-Request-Id` when it is ≤255 chars and matches `[\w\-=]`, otherwise `crypto.randomUUID()`, and sets the response header; `node_modules/hono/dist/middleware/request-id/request-id.js`);
  - a request-log middleware: pino `logger.info({ method, path: logPath(path), requestId, status, durationMs }, 'request')`, logged also when the request throws, with `statusFor(error)` (lines ~267-289, helpers at :701-726);
  - `cors({ origin: config.WEB_ORIGINS, credentials: true })` on `/api/*`, with Hono defaults: `allowMethods` GET, HEAD, PUT, POST, DELETE, PATCH; preflight answers 204 and echoes the request headers; `Vary: Origin` (`node_modules/hono/dist/middleware/cors/index.js`);
  - the origin guard on `/api/*`: throws `HttpError(403, 'forbidden', 'Origin is not allowed')` when an `Origin` is present, the method is in `UNSAFE_METHODS` (:207), and the origin is not in `allowedOrigins(config)` (:728, which is `WEB_ORIGINS` + the `PUBLIC_URL` origin + the `BETTER_AUTH_URL` origin);
  - `app.all('/api/auth/*', (c) => auth.handler(c.req.raw))`;
  - `const mounts: EffectApiMount[]` with 36 entries (T-0717), mounted with `mountEffectRoutes`;
  - `GET /health` (body `{ ok, name: 'zilar-server', version, commit, protocolVersion, db }`, 200 or 503, using `isDatabaseUp`);
  - `notFound`: 404 `{ error: { code: 'not_found', message: 'Not found', requestId } }`;
  - `onError`: an `HttpError` gives `{ error: { ...detail, code, message, requestId } }` with its status; anything else is logged with `logger.error({ err, requestId }, 'unhandled request error')` and gives 500 `internal_error` / `Internal server error`.
- **`apps/server/src/effect/http.ts`** `forwardRequest` (the bridge) gives each module request:
  - an `x-request-id` header (`REQUEST_ID_HEADER`) with the edge's id;
  - an `x-zilar-socket-address` header (`SOCKET_ADDRESS_HEADER`, from `effect/http-core.ts`), after stripping any inbound one, with the socket address or `'unknown'`.

  The modules read both (`requestIdOf`, `socketAddressOf`). The edge must set both the same way. Take the socket address from `HttpServerRequest.remoteAddress` (an `Option`; `'unknown'` when it is none). Read `forwardRequest` and `readSocketAddress` to match them exactly.
- **effect 4.0.2 HTTP pieces,** checked by T-0689 (paths in the plan §2 table):
  - `HttpRouter.add` (`HttpRouter.d.ts:230`, `'*'` method allowed);
  - `HttpRouter.middleware` with `{ global: true }` (:593, :622);
  - `HttpRouter.toWebHandler(layer, { disableLogger: true })` returns `{ handler, dispose }` (:752-769);
  - `HttpServerRequest.toWeb` (`HttpServerRequest.d.ts:315`) and `HttpServerResponse.fromWeb` (`HttpServerResponse.d.ts:949`);
  - `HttpMiddleware.cors` (`HttpMiddleware.d.ts:135`).
- **`index.ts:401`** calls `serve({ fetch: app.fetch, port })` from `@hono/node-server`. It stays (B1.6 replaces it later), so the edge must expose `fetch(request: Request): Promise<Response>`.
- **Tests use the returned app as:**
  - `app.request(pathOrUrl, init?)` (827 sites) and `TestApp = ReturnType<typeof createApp>` (`test-support.ts:361`);
  - `app.routes` (`authz-sweep.test.ts:79`, `{ method, path }`, with method `ALL` for `/api/auth/*`);
  - `app.route('/test', createTestRoutes())` in `app.test.ts:57`, the only Hono-only use.

### What to build
1. **Add `apps/server/src/effect/edge.ts`** with `export function createEdge(input): ZilarEdge`.
   - **Input:** `{ mounts, auth, config, logger, health }`, where `health()` returns the `/health` status and body that `app.ts` computes today.
   - **Output:** `ZilarEdge = { fetch(request: Request): Promise<Response>; request(input: string | URL | Request, init?: RequestInit): Promise<Response>; routes: ReadonlyArray<{ method: string; path: string }>; dispose(): Promise<void> }`.
   - **`request`** resolves a relative path against `http://localhost`, as Hono's `app.request` does, then calls `fetch`.
   - **`routes`** lists, in order: `ALL /api/auth/*`, every mount route, and `GET /health`.
   - Build it with `HttpRouter` and `HttpRouter.toWebHandler`, with the behaviours above in the same order:
     - the request id;
     - the masked request log (move `logPath`, `statusFor`, `durationSince`, `allowedOrigins` and `UNSAFE_METHODS` here from `app.ts`);
     - CORS and the origin guard on `/api/*` only;
     - `/api/auth/*` straight to `auth.handler(webRequest)`;
     - each mount route: convert to web, add the two forwarded headers, call `mount.handler`, then `fromWeb`;
     - `/health`, the 404 catch-all, and the error envelope (same bodies, same `x-request-id` response header on **every** response, errors and 404 included).
   - If the router would let a mount route and `/api/auth/*` clash, keep Hono's precedence: `/api/auth/*` first.
2. **`app.ts`:** `createApp` builds the same modules and `mounts`, then returns `createEdge({ ... })`.
   - Delete the Hono app, its middleware and the `mountEffectRoutes` loop.
   - Keep `effectMountsOf`, keyed by the returned edge.
   - Keep the `AppDependencies` signature.
3. **`app.test.ts`:** replace `createTestRoutes()` and `app.route('/test', …)` with a test that builds `createEdge` directly. Give it one extra mount whose web handler throws the same errors (`HttpError` 409, with detail, with hostile detail, and a plain `Error`), and keep every assertion of those tests.
4. **Add `apps/server/src/effect/edge.test.ts`** with parity tests:
   - an inbound valid `x-request-id` is echoed, and an invalid one is replaced;
   - a CORS preflight `OPTIONS /api/me` with an allowed origin answers 204 with `access-control-allow-origin` and `access-control-allow-credentials: true`, and a disallowed origin gets no allow-origin header;
   - a `POST` with a disallowed `Origin` answers 403 `forbidden`;
   - the request log masks `/api/join/<token>`;
   - a module request carries `x-zilar-socket-address: unknown` when there is no socket, even if the client sent one.
5. **Do not change** `effect/http.ts`, the bridge tests (`blocks/blocks.test.ts`, `machines/routes.test.ts`, `effect/http.test.ts`), `index.ts` or any module. If `authz-sweep.test.ts` or `test-support.ts` need a type-only change for the new return type, make it there and say so in the Report.

### Read first
`AGENTS.md`, `docs/audit/effect-edge-flip-plan.md` (§1-§3), `apps/server/src/app.ts`, `apps/server/src/effect/http.ts`, `apps/server/src/effect/http-core.ts`, `apps/server/src/app.test.ts`, `apps/server/src/authz-sweep.test.ts` (lines 1-100), `apps/server/src/test-support.ts` (lines 355-450), `apps/server/src/effect/node-server.test.ts` (an effect/http router that works).

### Allowed files
`apps/server/src/effect/edge.ts`, `apps/server/src/effect/edge.test.ts`, `apps/server/src/app.ts`, `apps/server/src/app.test.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/server/src/test-support.ts`, `work/T-0730-effect-edge-core.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/edge.test src/app.test src/authz-sweep.test src/auth src/handles
pnpm gate
```

### Acceptance
- `app.ts` imports nothing from `hono` or `@hono/*`.
- The whole server suite passes in the gate with no test changes beyond the files listed above.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Built the Effect edge core: new `apps/server/src/effect/edge.ts` with
`createEdge({ mounts, auth, config, logger, health })` returning
`ZilarEdge = { fetch, request, routes, dispose }`, built from one
`HttpRouter.use(router => router.add('*', '/*', respond))` layer via
`HttpRouter.toWebHandler(layer, { disableLogger: true })`.
`createApp` (`apps/server/src/app.ts`) now builds the same 36 module mounts
and delegates to `createEdge`; the Hono app, its middleware and the
`mountEffectRoutes` loop are deleted, and `app.ts` imports nothing from
`hono` or `@hono/*`. `index.ts` is untouched (`serve({ fetch: app.fetch })`
keeps working). No module, bridge, or `effect/http-core.ts` file was changed.

Behaviour parity, in the same order as before:
- Request id: accepts an inbound `x-request-id` when non-empty, <=255 chars
  and matching `[\w\-=]`, else `crypto.randomUUID()`; set as the
  `X-Request-Id` response header on every response (errors and 404 included).
- Masked request log: pino `logger.info({ method, path: logPath(path),
  requestId, status, durationMs }, 'request')`, also for throws (with
  `statusFor`). `logPath`, `statusFor`, `durationSince`, `allowedOrigins`,
  `UNSAFE_METHODS` moved from `app.ts` to `edge.ts`.
- CORS + origin guard on `/api` and `/api/*` only: allowed request origins
  echoed with `Access-Control-Allow-Origin`, credentials always `true`,
  preflight `OPTIONS` answers 204 here echoing `Access-Control-Request-Headers`
  with `Vary: Origin` (+ `Vary: Access-Control-Request-Headers` when echoed);
  unsafe methods with a disallowed `Origin` answer 403 `forbidden` first.
  `allowMethods` is `GET, HEAD, PUT, POST, DELETE, PATCH` as Hono's default
  (its default list also had `QUERY`, which no route uses; exact-requested
  header values were not asserted anywhere in the suite).
- `/api/auth` + `/api/auth/*` go straight to `auth.handler(webRequest)`,
  checked before any mount route (Hono's precedence).
- Each mount route dispatches by exact method plus case-sensitive strict
  path match with `:param` segments (Hono semantics; find-my-way is
  case-insensitive and ignores trailing slashes, so matching is by hand).
  The web request gets `x-request-id` and a re-stamped
  `x-zilar-socket-address` header (client-forged value stripped; socket
  address from `HttpServerRequest.remoteAddress`, `'unknown'` when none),
  then `mount.handler`, then `HttpServerResponse.fromWeb`.
- `/health` (GET only, like Hono's `app.get`), the 404 `not_found` catch-all,
  and the error envelope (`HttpError` -> status + `{ ...detail, code,
  message, requestId }`; anything else logged via `logger.error({ err,
  requestId }, 'unhandled request error')` -> 500 `internal_error`).
  Thrown `HttpError`s are recovered via `Effect.catchCause` +
  `Cause.squash` (effect 4.0.2 has no `Cause.defects`/`Effect.catchAllCause`;
  that cost one debug round).

Files changed (all inside Allowed files):
- `apps/server/src/effect/edge.ts` (new): the edge, helpers, types.
- `apps/server/src/effect/edge.test.ts` (new): 8 parity tests (request-id
  echo/replace, preflight allow/disallow, 403 origin guard, join-token log
  masking, socket-address `unknown`, route-manifest order).
- `apps/server/src/app.ts`: `createApp` returns `ZilarEdge`, keeps the
  `AppDependencies` signature and `effectMountsOf` (now keyed by the edge).
- `apps/server/src/app.test.ts`: `createTestRoutes`/`app.route` replaced by
  a `createEdge`-based throwing mount; all assertions kept.
- `apps/server/src/authz-sweep.test.ts`: type-only change (`SweepApp` is now
  `Pick<ZilarEdge, 'request' | 'routes'>`, throwaway Hono app replaced by a
  `createEdge` app); `test-support.ts` needed no change (`TestApp =
  ReturnType<typeof createApp>` still works).

Deviations from the spec:
- `request` accepts a `URL` too (`string | URL | Request`), matching Hono's
  `input.toString()` handling; relative paths resolve against
  `http://localhost` exactly like Hono's `app.request`.
- No `HttpRouter.middleware`/`HttpMiddleware.cors` layers: one dispatch
  function implements id/log/CORS/guard/dispatch uniformly (avoids ~250
  `HttpRouter.add` layer fragments and keeps ordering explicit).
- Known Hono edge-case differences, none covered by the suite:
  `OPTIONS /health` 404s instead of Hono's 404-with-CORS-headers
  (non-`/api`); trailing-slash and case variants 404 instead of Hono's
  redirect/strict handling. (HEAD-as-GET was fixed in round 3.)

Commands (real results):
- `pnpm install`: done (20.7s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/effect/edge.test.ts`: 8 passed.
- `... src/app.test.ts src/effect/edge.test.ts`: 18 passed.
- `... src/authz-sweep.test.ts`: 5 passed.
- `... src/auth src/handles`: 9 files, 99 passed.
- `pnpm gate`: GATE PASS — PASS install (frozen), format, lint, typecheck,
  tests @zilar/server; "scope: every changed file is inside the Allowed
  files". Single tests I ran while working: edge (8), app (10), sweep (5),
  auth+handles (99).

Security checklist: bearer tokens (`/api/join/`, `/api/invites/`,
`/api/gifs/media/`, `/api/avatars/`) only reach the log masked; no new
routes (404 catch-all and 403 guard only); deletes/updates scoping
unchanged (modules untouched); audit entries untouched.

### Round 2 (fix round, 2026-10-09)

Findings fixed:
- Finding 1 (must-fix, socket address always `'unknown'`): `fetch` now
  accepts the optional `serve({ fetch })` bindings as a second argument,
  reads `incoming.socket.remoteAddress` from them (same read and same
  `'unknown'` fallback as the old Hono edge's `getConnInfo`), and carries
  it into the dispatch through a `SocketAddressOverride` context tag
  (`toWebHandler` merges the per-request context, so `Effect.serviceOption`
  sees it). `forwardEdgeRequest` now takes the resolved address string;
  direct callers (`request`, tests) keep the `'unknown'` fallback. New test:
  "carries the serve bindings socket address into the module request"
  passes forged header + bindings and asserts the module saw `203.0.113.7`.

Disagreements (code left as is):
- Finding 2 (should-fix, `OPTIONS /api/auth/*` must reach better-auth): the
  premise does not hold. I ran the old stack (Hono + its cors middleware +
  an `app.all('/api/auth/*')` stub): `OPTIONS` answered 204 with the CORS
  headers and the auth handler was hit 0 times; `POST` reached it once.
  Hono's cors middleware short-circuits every preflight before routing, so
  the edge answering 204 for `OPTIONS /api/auth/*` is exact parity, not a
  regression. Added a locking test instead: "answers OPTIONS /api/auth/*
  with 204 before better-auth" (204 + allow-origin header + auth handler
  hit 0 times).
- Nits 3-6: untouched per the round instructions (none is on a line I
  changed: `CORS_ALLOW_METHODS`, `void origin`, the `EffectApiRoute`
  re-export, and the sweep probe bodies are all outside this round's edits).

Tests added: 2 in `apps/server/src/effect/edge.test.ts` (now 10 tests).

Commands (real results, round 2):
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/effect/edge.test.ts`: 10 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/effect/edge.test src/app.test src/authz-sweep.test src/auth
  src/handles`: 11 files, 119 passed.
- `pnpm gate` (first run): GATE FAIL on typecheck — the spec's
  `fetch(request: Request)` type rejected the bindings second argument in
  the new test. Fixed by widening `ZilarEdge.fetch` to
  `(request: Request, bindings?: ServeBindings)` (exported structural
  interface; still assignable everywhere the spec shape is used, and
  `serve({ fetch })` passes the real bindings at runtime).
- `pnpm gate` (second run): GATE PASS — PASS install (frozen), format,
  lint, typecheck, tests @zilar/server; "scope: every changed file is
  inside the Allowed files".

### Round 3 (fix round, 2026-10-09)

Findings fixed:
- Finding 1 (must-fix, HEAD on GET routes 404s): dispatch now routes
  `HEAD` as `GET` (`routeMethod`), matching Hono's `#dispatch`
  (`hono-base.js:280`: `if (method === "HEAD")` re-dispatches as GET).
  The body strip needs no code: the Effect runtime already does it
  (`HttpEffect.js:215`: `const withoutBody = request.method === "HEAD"`).
  Logging, the preflight check and the origin guard keep the raw method.
  Mount matching (`route.method !== routeMethod`) and the `/health` check
  use `routeMethod`. New test: "answers HEAD on a GET route with 200 and
  an empty body" (`HEAD /health` -> 200, empty body, `x-request-id` set).
- Nits 2-4: untouched per the round instructions (none is on a line I
  changed: `CORS_ALLOW_METHODS`, the `origin !== undefined` guard, and
  the auth `forwardEdgeRequest` are all outside this round's edits).

Tests added: 1 in `apps/server/src/effect/edge.test.ts` (now 11 tests).

Commands (real results, round 3):
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/effect/edge.test.ts`: 11 passed.
- `pnpm gate`: GATE PASS — PASS install (frozen), format, lint,
  typecheck, tests @zilar/server; "scope: every changed file is inside
  the Allowed files". Single tests I ran while working: edge (11),
  full check `src/effect/edge.test src/app.test src/authz-sweep.test
  src/auth src/handles` (11 files, 120 passed).

status: review

## Review (written by Claude)

**2026-10-09, lead:** approved after 2 automatic rounds (packet head f47f245c).
- **Round 1** fixed the production socket address: it is now read from the `serve()` bindings, because `toWebHandler` never sets `remoteAddress`.
- **Round 2** fixed HEAD parity: HEAD is routed as GET with an empty body.
- `createApp` now returns the Effect edge (`effect/edge.ts`), and `app.ts` has no Hono import. The suite and the gate pass.
- **Accepted nits, for the follow-up sweep:**
  - CORS allow-methods should match Hono's `GET,HEAD,PUT,POST,DELETE,PATCH,QUERY`;
  - an empty `Origin` should not be a 403;
  - send the raw request to `auth.handler`;
  - remove the dead `void origin;` and the unused re-export.
- **Still on Hono:** `index.ts` (`serve`, B1.6) and the bridge in `effect/http.ts` (B1.8).
