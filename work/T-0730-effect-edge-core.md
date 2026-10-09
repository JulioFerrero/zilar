---
id: T-0730
title: "B1.3b: the Effect edge — new effect/edge.ts builds the whole HTTP edge with effect/http (request id, masked request log, CORS + origin guard on /api, better-auth passthrough, the 36 module mounts, /health, 404, error envelope) via HttpRouter.toWebHandler; createApp returns it ({ fetch, request, routes }) instead of a Hono app"
status: todo
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

## Review (written by Claude)
