# The B1 edge flip: audit and ordered plan

Status: plan (T-0689), 2026-10-09. Written by a worker from the code, not from
memory. Every claim about our code cites `file:line`; every Effect export was
checked in the installed package before it is named. No code was changed.

Scope (from `docs/audit/effect-last-mile.md:398`, item B1): replace the Hono
edge (`app.ts` middleware, the `/api/auth` passthrough, `/health`,
`notFound`/`onError` and `@hono/node-server` `serve`) with Effect
`HttpApi`/`HttpRouter` + a Node server, and delete the Hono bridge in
`apps/server/src/effect/http.ts`. This task only writes this plan.

Effect paths below are under `apps/server/node_modules/effect/`, a symlink to
`node_modules/.pnpm/effect@4.0.2/node_modules/effect/` (checked: `ls -la
apps/server/node_modules/effect` inside the repo). All Effect lines were read
from `effect/dist/**` there. `effect@4.0.2` is declared at
`apps/server/package.json:25`.

## 0. Verified environment

- `effect@4.0.2` is installed and has `dist/http/` and `dist/http-api/`
  (`ls node_modules/.pnpm/effect@4.0.2/node_modules/effect/dist/`).
- `NodeHttpServer` does **not** exist anywhere under `effect/dist/`
  (`rg -l "NodeHttpServer" effect/dist` returns nothing), and
  `@effect/platform-node` is **not installed** (`ls
  apps/server/node_modules/@effect/` lists only `sql-pg` and `sql-pglite`).
  `@effect/platform-node@4.0.2` does exist on npm (registry dist-tag `latest =
  4.0.2`, checked via the npm registry API). Adding it is a decision for Julio
  (§5, D1).
- `@hono/node-server` is imported at `apps/server/src/index.ts:1` and
  `apps/server/src/effect/http.ts:16`; `hono` (the framework) at
  `apps/server/src/app.ts:2-4`, `apps/server/src/git/routes.ts`, and four test
  files.

---

## 1. Inventory: every Hono feature the edge uses

All line numbers are `apps/server/src/app.ts` unless stated otherwise.
`createApp` builds the root app and returns
`Hono<{ Variables: RequestIdVariables }>` (`app.ts:245`).

| # | Hono feature | Location | Notes |
| - | ------------ | -------- | ----- |
| 1 | `requestId()` middleware (`hono/request-id`, imported `app.ts:4`) | `app.ts:264` | Hono default: reads a valid inbound `X-Request-Id`, else `crypto.randomUUID()`, sets `c.set('requestId')` and the response header (verified in `node_modules/.pnpm/hono@*/node_modules/hono/dist/middleware/request-id/request-id.js`). |
| 2 | Request-log middleware (pino `info`, masked path, duration, status) | `app.ts:266-288` | Fields from `logPath` `app.ts:706-717`, `durationSince` `app.ts:696-698`, `statusFor` `app.ts:692-694`. |
| 3 | `cors({ origin: config.WEB_ORIGINS, credentials: true })` on `/api/*` | `app.ts:290-296` | `hono/cors`, imported `app.ts:3`. |
| 4 | Origin guard: 403 on unsafe methods with a disallowed `Origin`, `/api/*` | `app.ts:298-304` | `UNSAFE_METHODS` `app.ts:206`; `allowedOrigins` `app.ts:719-724` (adds `PUBLIC_URL` and `BETTER_AUTH_URL` origins). |
| 5 | better-auth passthrough `app.all('/api/auth/*', c => auth.handler(c.req.raw))` | `app.ts:306` | Returns better-auth's raw `Response` (cookies, redirects). |
| 6 | `mountEffectRoutes(app, X.routes, X.handler)` calls | `app.ts:308-608` | **36 calls** (`rg -c "mountEffectRoutes\(" app.ts` = 36). Each mounts one module's exact `{method, path}` pairs. |
| 7 | `GET /health` | `app.ts:610-623` | `isDatabaseUp` `app.ts:667-674`, `withTimeout` `app.ts:676-690`; 200 / 503. |
| 8 | `app.notFound(...)` | `app.ts:625-630` | `{ error: { code: 'not_found', message, requestId } }`, 404. |
| 9 | `app.onError(...)` | `app.ts:632-662` | `HttpError` → status + `{ error: { ...detail, code, message, requestId } }`; else log + 500 `internal_error`. |
| 10 | Server start `serve({ fetch: app.fetch, port })` | `apps/server/src/index.ts:401` | `serve` imported `index.ts:1`; `app` built `index.ts:265`. |
| 11 | Shutdown on the `serve` return value | `apps/server/src/index.ts:501-542` | `server.close()` `:518`, `closeAllConnections` guard `:520-522`; grace/force timers `index.ts:496-497`. |

### 1.1 The bridge file

`apps/server/src/effect/http.ts` (214 lines) is **both** the Hono bridge and the
shared error/session core. It cannot simply be deleted.

Hono-bridge-only:
- `forwardRequest` `:162-172` (strips and re-stamps the socket header),
- `readSocketAddress` `:176-183` (`getConnInfo` from
  `@hono/node-server/conninfo`, imported `:16`),
- `mountEffectApi` `:190-199` (defined, **never called**; `rg -n
  "mountEffectApi" apps/server/src` finds only the definition),
- `mountEffectRoutes` `:206-214` (called 36× by `app.ts` and 3× across 2 test
  files).

Shared by module `api.ts` files (shipped via this file; counts from the
import lists of non-test files):
- `withErrorEnvelope` `:135` (36), `requestIdOf` `:80` (36), `sessionLayer`
  `:49` (35), `Session` `:42` (35), `EffectApiRoute`/`EffectApiMount`
  `:147-158` (36), `CurrentUser` `:33` (34), `failureResponse` `:114` (25),
  `httpErrorResponse` `:96` (18), `socketAddressOf` `:88` (3),
  `REQUEST_ID_HEADER` `:24` (1), `SOCKET_ADDRESS_HEADER` `:25`.

So the flip must **split** the file: keep the error/session helpers (moved to a
Hono-free module) and replace only the Hono bridge.

### 1.2 Hono outside `app.ts` (server, non-test)

- `apps/server/src/errors.ts:1` — type-only `ContentfulStatusCode` from
  `hono/utils/http-status`; `HttpError.status` is typed by it (`errors.ts:4`).
  The audit row at `effect-last-mile.md:400` says this moves with B1.
- `apps/server/src/git/proxy.ts:1` — type-only `Context, Handler`.
- `apps/server/src/git/routes.ts` — `new Hono()`; `createGitRoutes` is called
  only from `apps/server/src/git/proxy.test.ts:38`, **not mounted** anywhere in
  production (`rg -n "createGitRoutes|createGitProxyHandler" apps/server/src`
  has no non-test caller). This is task A12 (`effect-last-mile.md:380`).

### 1.3 Tests that bind to the Hono edge

- **`.request(` call sites:** 827 across
  `apps/server/src/**/*.test.ts` (`rg -o "\.request\(" --glob '*.test.ts' | wc
  -l` = 827).
- **App construction:** 33 test files mention `createApp`; 63 test files
  mention `createApp` or `testApp(`. `TestApp = ReturnType<typeof createApp>`
  and `testApp(context)` are at `apps/server/src/test-support.ts:352-362`;
  `signUpWithInvite` drives `app.request` at `test-support.ts:392` and `:398`.
- **Tests importing `hono`:** 4 files — `app.test.ts:1`,
  `authz-sweep.test.ts:2-3`, `blocks/blocks.test.ts:7` + dynamic
  `import('hono')` at `:301` and `:323`, `git/proxy.test.ts:5`.
- **`app.routes` consumers:** `authz-sweep.test.ts:79`, `:151`, `:170` (the
  sweep enumerates `app.routes`; the allowlist-existence and
  no-silently-skipped assertions depend on it).
- **`app.route` / `app.onError` consumers:** `app.test.ts:49` mounts
  `createTestRoutes()` (a `Hono`) at `/test`, and `app.test.ts:10-27` throws
  `HttpError`s through Hono's `onError`; `authz-sweep.test.ts:204-214` builds a
  throwaway `Hono` to prove the sweep catches an unprotected route.
- **Bridge helpers in tests:** `effect/http.test.ts` imports
  `mountEffectRoutes`/`socketAddressOf`/`withErrorEnvelope` (`:13-18`) and
  `blocks/blocks.test.ts:309` and `:331` call `mountEffectRoutes` on a Hono
  wrapper.
- **`x-request-id` assertions:** 2 test files (`app.test.ts:137-142`,
  `effect/http.test.ts:79,95,129,165`).

### 1.4 Modules the edge mounts (shape to preserve)

Each module exports `{ handler, routes }` where `handler: (request: Request) =>
Promise<Response>` and `routes` is the `{method, path}` list
(`effect/http.ts:147-158`). Example: `apps/server/src/handles/api.ts:250-255`.
All 36 modules import from the bridge (`./effect/http`, `../effect/http` or
`../../effect/http`).

---

## 2. Target: which Effect module replaces each feature

All exports verified in the installed `effect@4.0.2`.

| Hono feature | Replacement | Verified path |
| ------------ | ----------- | ------------- |
| Build the edge router | `HttpRouter.add(method, path, effect)` + `HttpRouter.layer` | `effect/dist/http/HttpRouter.d.ts:230`, `:266`; `PathInput` (`"*"` allowed) `:357` |
| Request id | a small custom `HttpRouter.middleware` mirroring Hono (`X-Request-Id` inbound or `crypto.randomUUID()`), applied **globally** via `{ global: true }`; store the id as a request header so modules keep reading `requestIdOf` unchanged | `HttpRouter.middleware` `HttpRouter.d.ts:593` (global option `:622-624`) |
| Request log (masked) | custom global middleware calling pino; reuse the **same** `logPath` mask; keep `disableLogger: true` on module routers | `HttpMiddleware.logger` `HttpMiddleware.d.ts:103`; `HttpRouter.disableLogger` `HttpRouter.d.ts:692` |
| CORS on `/api/*` | `HttpMiddleware.cors({ allowedOrigins, credentials: true })` provided to the `/api` route layer (or `HttpRouter.cors` layer) | `HttpMiddleware.cors` `HttpMiddleware.d.ts:135`; `HttpRouter.cors` `HttpRouter.d.ts:660` |
| Origin guard | custom `HttpRouter.middleware` checking method + `Origin` against the same `allowedOrigins`, provided to the `/api` layer | `HttpRouter.middleware` `HttpRouter.d.ts:593` |
| better-auth passthrough | `HttpRouter.add('*', '/api/auth/*', (request) => Effect.promise(() => auth.handler(HttpServerRequest.toWeb(request))))` | `HttpServerRequest.toWeb` `HttpServerRequest.d.ts:315` |
| `/health` | `HttpRouter.add('GET', '/health', ...)` reusing `isDatabaseUp` | `HttpRouter.add` `HttpRouter.d.ts:230` |
| notFound | a catch-all `HttpRouter.add('*', '/*', ...)` returning the same `not_found` JSON | `HttpRouter.add` `HttpRouter.d.ts:230` |
| onError | a global `HttpRouter.middleware` that renders `failureResponse`/`httpErrorResponse` for anything the module envelopes miss | `HttpRouter.middleware` `HttpRouter.d.ts:593` |
| Server start | `HttpRouter.serve(rootLayer, { middleware })` requires an `HttpServer`; provide `NodeHttpServer.layer(createServer, { port })` from `@effect/platform-node`, run with `NodeRuntime.runMain` | `HttpRouter.serve` `HttpRouter.d.ts:718`; `HttpServer.serve` `HttpServer.d.ts:73`; **NodeHttpServer absent — add `@effect/platform-node@4.0.2`** |
| Socket address | read `HttpServerRequest.remoteAddress` (`Option<string>`); the Node server fills it, so no header forging and no `getConnInfo` | `HttpIncomingMessage.remoteAddress` `effect/dist/http/HttpIncomingMessage.d.ts:59` |
| Module dispatch | keep each module's `{ handler, routes }`; the edge converts Effect ⇄ Web per route: `HttpServerRequest.toWeb` in, `HttpServerResponse.fromWeb` out | `HttpServerRequest.toWeb` `HttpServerRequest.d.ts:315`; `HttpServerResponse.fromWeb` `HttpServerResponse.d.ts:949` |
| Test handler | `HttpRouter.toWebHandler(rootLayer, { disableLogger: true })` returns `{ handler, dispose }` with `handler: (Request) => Promise<Response>` | `HttpRouter.toWebHandler` `HttpRouter.d.ts:752`, return `:767-769` |

### 2.1 Chosen architecture (why keep the per-module web handlers)

The 36 modules already build their own `HttpApi` + `HttpRouter.toWebHandler` and
return a web `handler` (`handles/api.ts:241-255`). Two options:

- **(A, chosen) Edge router that dispatches to the existing module web
  handlers.** Build one `HttpRouter` layer; add each module route pair mapped to
  `HttpServerRequest.toWeb` → module `handler` → `HttpServerResponse.fromWeb`.
  The 36 modules do not change; the edge stops using Hono. This is the smallest
  step that satisfies B1 and is fully covered by the existing tests.
- **(B, later) Merge the 36 `HttpApi` layers into one router.** Cleaner long
  term, but it forces every module to export its layer and changes every
  module-level test wrapper (the `mountEffectRoutes` wrappers in
  `blocks/blocks.test.ts`, `machines/routes.test.ts`, `effect/http.test.ts`).
  Out of B1's scope; record as a follow-up, not a blocker.

### 2.2 How the socket address is read without the Hono bridge

Today the only reason for `SOCKET_ADDRESS_HEADER` is that Hono's
`getConnInfo(context)` is the only socket source (`effect/http.ts:176-183`), and
`forwardRequest` re-stamps it (`effect/http.ts:168-170`). With
`NodeHttpServer.layer`, `HttpServerRequest.remoteAddress` is already the real
socket address (`HttpIncomingMessage.d.ts:59`); `machines/api.ts`,
`invite-links/api.ts`, `setup/api.ts` and their `clientIpFrom` calls
(`apps/server/src/http/client-ip.ts:34`) read it directly. The
`SOCKET_ADDRESS_HEADER` strip-then-set logic becomes unnecessary and is deleted.

### 2.3 How tests call the app afterwards

Yes — a `fetch`-style handler can stay. `HttpRouter.toWebHandler` already yields
`handler(request: Request): Promise<Response>` (`HttpRouter.d.ts:767-769`), and
Hono's `app.fetch` had exactly that first-argument shape. Concretely, `createApp`
returns an object exposing:

- `fetch(request: Request): Promise<Response>` — the Effect handler;
- a thin `request(input: string | Request, init?: RequestInit)` compatibility
  method that builds a `Request` and calls `fetch`.

With that shim, **all 827 `.request(` call sites and `signUpWithInvite`
(`test-support.ts:392,398`) compile and pass unchanged**. Only the tests that use
Hono-only features change: `app.test.ts` (`app.route`, `createTestRoutes`,
`app.onError`), `authz-sweep.test.ts` (`app.routes`), and the 3 bridge tests
(`effect/http.test.ts`, `blocks/blocks.test.ts` rate-limit wrappers,
`machines/routes.test.ts` socket wrapper).

---

## 3. Risks

1. **Error envelope and status parity.** Two encoders must stay byte-identical:
   `app.onError` (`app.ts:632-662`) and the module `withErrorEnvelope` /
   `httpErrorResponse` / `failureResponse` (`effect/http.ts:96,114,135`). Watch
   the `detail`-first spread so `code`/`message`/`requestId` cannot be
   overridden (`app.ts:638-645`, `effect/http.ts:100-110`), the 500 body
   (`app.ts:652-661`), and the `not_found` body (`app.ts:625-630`).
   `errors.ts:1` `ContentfulStatusCode` must move off Hono (`effect-last-mile.md:400`)
   — replace with a numeric status union or `HttpStatus`; keep
   `HttpError.status` working for the `statusFor` log (`app.ts:692-694`).
2. **Streaming.** SSE drafts return `HttpServerResponse.stream(frames.pipe(
   Stream.encodeText), …)` (`drafts/api.ts:113`); the file proxy streams via
   `HttpServerResponse.raw(upstream.body, …)` (`files/api.ts:301`); gif, voice,
   avatar and sticker bodies are `uint8Array` (`gifs/api.ts:424`,
   `voice/api.ts:118`, `avatars/api.ts:195`, `stickers/api.ts:798`). The Effect
   ⇄ Web conversion must not buffer:
   `HttpServerRequest.toWeb` and `HttpServerResponse.fromWeb` preserve the body
   stream (`HttpServerRequest.d.ts:304-317`, `HttpServerResponse.d.ts:949`). A
   regression test that reads a draft stream incrementally is required.
3. **Multipart (stickers, avatars, backgrounds).** Parsing happens inside the
   `HttpApi` handler (`HttpServerRequest` multipart), before/behind the module
   `toWebHandler`. The edge must forward the request body as a stream, not a
   buffered string; `toWeb` satisfies this. Re-run the sticker/avatar upload
   tests.
4. **better-auth cookies and redirects.** `auth.handler(c.req.raw)` returns a raw
   `Response` (`app.ts:306`) with `Set-Cookie` (possibly several) and redirects.
   `HttpServerResponse.fromWeb` copies status and headers; verify multi
   `Set-Cookie` and redirect bodies survive. `signUpWithInvite`
   (`test-support.ts:403-413`) reads `getSetCookie()` and `set-auth-token`, so
   the OTP sign-up test is the canary.
5. **Request-log masking.** Tokens must never reach logs: `logPath`
   (`app.ts:706-717`) masks `/api/join/`, `/api/gifs/media/`, `/api/avatars/`,
   `/api/invites/`. The Effect edge logger must call the **same** function; do
   not let `HttpRouter`'s own logger run (`disableLogger: true`, as modules
   already do, e.g. `handles/api.ts:252`). A sentinel test asserts a raw token
   appears in neither log nor body.
6. **Authz sweep loses `app.routes`.** The sweep enumerates `app.routes`
   (`authz-sweep.test.ts:79,151,170`); Effect `HttpRouter` does not expose the
   same list. The edge must export the assembled route manifest (concatenate
   each module's `.routes` plus `/health` and `/api/auth/*`) and the sweep must
   consume it. Keep the "no stale allowlist entry" and "no silently skipped
   route" assertions.
7. **Request-id semantics.** Hono accepts a valid inbound `X-Request-Id`
   (verified source). If the Effect middleware only generates, a client that
   sends one would see it echoed in the log but not the response, changing
   behavior. Mirror Hono: accept an inbound value ≤255 chars matching
   `[\w\-=]`, else `crypto.randomUUID()`.
8. **`NodeHttpServer` is a new dependency.** It is not installed (§0). Until
   Julio approves D1, B1.6 (server start) is blocked; B1.1-B1.5 and B1.7 can
   proceed and be tested with `HttpRouter.toWebHandler`.

---

## 4. Ordered task list

Every task leaves the server working. Size is S (<½ day), M (½–1 day), L (>1
day). "Parallel" = may run alongside the others in its group.

| ID | Task | Files | Tests | Size | Parallel |
| -- | ---- | ----- | ----- | :-: | :------: |
| B1.1 | **Split `effect/http.ts`.** Move the shared helpers (`CurrentUser`, `Session`, `sessionLayer`, `withErrorEnvelope`, `httpErrorResponse`, `failureResponse`, `requestIdOf`, `socketAddressOf`, `REQUEST_ID_HEADER`, route types) into a Hono-free module (e.g. `effect/http-core.ts`); leave the Hono bridge alone. Update the 36 module imports. No behavior change; existing tests pass. | `effect/http.ts`, new `effect/http-core.ts`, 36 `*/api.ts` | `effect/http.test.ts` unchanged | M | start here |
| B1.2 | **Add `@effect/platform-node@4.0.2`** and a smoke test that `NodeHttpServer.layer` serves one `HttpRouter` route (requests blocked on D1). | `apps/server/package.json`, a small test | new test | S | blocked on D1 |
| B1.3 | **Effect edge core.** New `effect/edge.ts`: `HttpRouter` layer that mounts the 36 module web handlers via `toWeb`/`fromWeb`, plus `/health`, the better-auth passthrough, notFound and the global error envelope. `createApp` returns `{ fetch, request }` built from `HttpRouter.toWebHandler`. | `effect/edge.ts`, `app.ts` | rewrite `app.test.ts`; `effect/http.test.ts` | L | core |
| B1.4 | **CORS + origin guard** as Effect middleware on `/api/*`, same `allowedOrigins`. | `effect/edge.ts` | origin-guard coverage (from `effect/http.test.ts:175-186`) | S | after B1.3 |
| B1.5 | **Socket address via `remoteAddress`.** Drop `SOCKET_ADDRESS_HEADER`/`getConnInfo`/`forwardRequest`; read `request.remoteAddress` at `machines/api.ts`, `invite-links/api.ts`, `setup/api.ts`. | `effect/edge.ts`, those `api.ts`, `effect/http.ts` | `machines/routes.test.ts` socket case | S | after B1.3 |
| B1.6 | **Server start on Effect.** Replace `serve(...)` (`index.ts:401`) with `HttpRouter.serve` + `NodeHttpServer.layer` + `NodeRuntime.runMain`; rework shutdown (`index.ts:501-542`). | `index.ts` | none (manual smoke) | M | blocked on D1 |
| B1.7 | **Authz-sweep route manifest.** Export the edge's route list; rewrite the sweep to iterate it. | `effect/edge.ts`/`app.ts`, `authz-sweep.test.ts` | `authz-sweep.test.ts` | S | after B1.3 |
| B1.8 | **Retire the Hono bridge and wrappers.** Delete `mountEffectApi`/`mountEffectRoutes`/`forwardRequest` and update the wrappers. | `effect/http.ts`, `blocks/blocks.test.ts`, `machines/routes.test.ts`, `effect/http.test.ts` | those 3 | S | after B1.5, B1.7 |
| B1.9 | **Delete Hono.** Drop `hono` + `@hono/node-server`, move `errors.ts:1` off `ContentfulStatusCode`. **Depends on A12** (`git/routes.ts`/`git/proxy.ts` still import Hono). | `apps/server/package.json`, `errors.ts`, `git/*` | full server suite | S | after A12 |

Parallelism: B1.1 first (it de-risks every later task). Then B1.3 (core) and, if
D1 is approved, B1.2 and B1.6. B1.4, B1.5 and B1.7 can run in parallel once
B1.3 lands. B1.8 and B1.9 are serial tails.

---

## 5. Decisions for Julio

- **D1 — add `@effect/platform-node@4.0.2`?** The spec named `NodeHttpServer`,
  but it is not in the installed `effect` package, and `@effect/platform-node`
  is not a dependency (§0). B1.6 needs it (or, alternatively, keep
  `@hono/node-server` purely as the Node listener, which keeps the `@hono/`
  dependency and forces a custom socket-address path). Recommendation: add the
  dependency; it is the package the installed Effect version expects
  (`effect@4.0.2` / `@effect/platform-node@4.0.2`). AGENTS.md forbids new
  dependencies without a decision, so B1.6 is blocked until this is answered.
- **D2 — A12 ordering.** B1.9 ("delete Hono") cannot complete while
  `git/routes.ts` imports the Hono class. Confirm B1.9 lands after A12, or that
  A12 is pulled into the same batch.
- **D3 — architecture A vs B (§2.1).** Recommendation: A for B1 (no module
  changes), with B as a recorded follow-up. Confirm, since B is the "pure"
  end state and changes module/test shape.
