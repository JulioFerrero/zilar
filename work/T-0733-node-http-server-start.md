---
id: T-0733
title: "B1.6: start the server on @effect/platform-node — createEdge also exposes its HttpRouter layer; index.ts serves it with HttpRouter.serve + NodeHttpServer.layer on its own node:http server (graceful shutdown kept); @hono/node-server removed from apps/server"
status: merged
milestone: M5
branch: task/T-0733-node-http-server-start
model: auto
effort: default
depends_on: [T-0732]
estimate: 0.5 day
---

# T-0733: start the server on NodeHttpServer (B1.6)

## Spec (written by Claude, do not edit)

### Why
Julio wants Effect HTTP to replace Hono. The edge is Effect (T-0730), but `index.ts` still starts it with Hono's Node adapter. This is B1.6 in `docs/audit/effect-edge-flip-plan.md` §4, with the D1 decision: `@effect/platform-node@4.0.2`, added and smoke-tested in T-0696. Under `NodeHttpServer`, `HttpServerRequest.remoteAddress` is the real socket address, so the `serve()`-bindings workaround is no longer needed.

### Verified facts (do not re-derive)
- **`apps/server/src/index.ts`:**
  - line 1 is `import { serve } from '@hono/node-server'`;
  - line 401: `const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => logger.info({ port: info.port }, 'zilar-server listening'))`;
  - the background jobs start after that (runner hub, gateway, sweepers);
  - `shutdown()` (about lines 503-540) calls `server.close(cb)`, then `server.closeIdleConnections()` and, after `CONNECTION_GRACE_MS`, `server.closeAllConnections()`, because SSE draft streams never end on their own; `FORCE_EXIT_MS` caps it, and the other components stop afterwards.
- **`apps/server/src/effect/edge.ts`:**
  - `createEdge` builds `appLayer = HttpRouter.use((router) => router.add('*', '/*', respond)).pipe(Layer.provide(HttpServer.layerServices))` (about line 440) and `HttpRouter.toWebHandler(appLayer, …)`;
  - the dispatch takes the socket address from the `SocketAddressOverride` service (set from the `serve()` bindings in `fetch`), else `request.remoteAddress`, else `'unknown'` (about lines 334-339);
  - `ZilarEdge` is `{ fetch, request, routes, dispose }`;
  - HEAD is routed as GET, and the comment near line 305 relies on `toWebHandler` stripping the body.
- **`apps/server/src/effect/node-server.test.ts`** (T-0696) is a working pattern:
  - `HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 })))`;
  - run with `ManagedRuntime.make`, then read the port from `HttpServer.address`, then `runtime.dispose()`;
  - imports: `NodeHttpServer` from `@effect/platform-node`; `HttpRouter`, `HttpServer`, … from `effect/http`.
- **`apps/server/package.json:18`** has `"@hono/node-server": "^2.1.1"`, and `index.ts` is its only importer (`git grep -n "@hono/node-server"`). `hono` itself stays, because `git/*` still uses it (A12).

### What to build
1. **`edge.ts`:** add `layer` to `ZilarEdge`, the same `appLayer` the web handler uses, so a Node server can serve it. Keep the `SocketAddressOverride` path for `fetch` callers (tests); under `NodeHttpServer` the existing fallback to `request.remoteAddress` applies. Check that HEAD still returns an empty body under Node (Node's `http` omits the body for HEAD) and fix the comment.
2. **`index.ts`:**
   - keep a reference to the server: `const httpServer = createServer()` (`node:http`);
   - build `const serverRuntime = ManagedRuntime.make(HttpRouter.serve(app.layer, { disableLogger: true, disableListenLog: true }).pipe(Layer.provideMerge(NodeHttpServer.layer(() => httpServer, { port: config.PORT }))))`;
   - start it before the background jobs (for example `await serverRuntime.runPromise(HttpServer.HttpServer)`, reading the port from `address`);
   - log `{ port }, 'zilar-server listening'` exactly as today;
   - in `shutdown()`, keep the same idle/all-connections dropping on `httpServer`, then `await serverRuntime.dispose()` in place of `server.close`, with the same grace and force-exit timers, and the same order for the other components;
   - remove the `@hono/node-server` import. If `index.ts` cannot use top-level await, wrap the start in the file's existing async style and say so in the Report.
3. **`apps/server/package.json`:** remove `@hono/node-server` (`pnpm --filter @zilar/server remove @hono/node-server`), and commit the lockfile.
4. **Add `apps/server/src/effect/edge-node.test.ts`:** serve a `createEdge` (one test mount plus a health stub) through `NodeHttpServer` on port 0, then check:
   - `GET /health` gives 200;
   - `HEAD /health` gives 200 with an empty body;
   - the test mount sees `socketAddressOf` equal to a loopback address (`127.0.0.1`, `::1` or `::ffff:127.0.0.1`), not `'unknown'`;
   - a mount whose response body is a `ReadableStream` (enqueue `a`, wait 100 ms, enqueue `b`, close) gives the client `a` before `b` is enqueued, so streaming (the SSE drafts) is not buffered;
   - dispose the runtime at the end.

### Read first
`AGENTS.md`, `apps/server/src/index.ts` (lines 1-80, 380-549), `apps/server/src/effect/edge.ts`, `apps/server/src/effect/node-server.test.ts`, `apps/server/src/effect/edge.test.ts` (lines 1-40, 100-140), `docs/audit/effect-edge-flip-plan.md` (§3 risks).

### Allowed files
`apps/server/src/index.ts`, `apps/server/src/effect/edge.ts`, `apps/server/src/effect/edge-node.test.ts`, `apps/server/src/effect/node-serve.ts` (lead, round 2), `apps/runner/src/e2e.test.ts` (lead, round 2), `apps/server/package.json`, `pnpm-lock.yaml`, `work/T-0733-node-http-server-start.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect
pnpm gate
```

### Acceptance
- `git grep -n "@hono/node-server" -- apps/server` prints nothing.
- The new Node test passes and exits on its own.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.
- The Report shows that the gate's typecheck covers `index.ts` (it is in the server tsconfig's `include`), with the exact line from `apps/server/tsconfig.json`.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/effect/edge.ts`: added `layer` to `ZilarEdge` (the same
  `appLayer` the web handler uses, typed
  `Layer.Layer<never, unknown, HttpRouter.HttpRouter>`), returned as
  `layer: appLayer`. Kept the `SocketAddressOverride` path for `fetch`
  callers. Updated the HEAD comment: under `toWebHandler` the Effect
  `HttpEffect` layer strips the body; under `NodeHttpServer` Node's `http`
  omits the body for HEAD itself.
- `apps/server/src/index.ts`: removed the `@hono/node-server` import; the
  server now starts with `const httpServer = createServer()` (`node:http`)
  plus `ManagedRuntime.make(HttpRouter.serve(app.layer,
  { disableLogger: true, disableListenLog: true }).pipe(Layer.provideMerge(
  NodeHttpServer.layer(() => httpServer, { port: config.PORT }))))`, reads
  the bound port from `HttpServer.HttpServer` address, and logs
  `{ port }, 'zilar-server listening'` exactly as before. `shutdown()` keeps
  `closeIdleConnections()` / `closeAllConnections()` with the same
  `CONNECTION_GRACE_MS` / `FORCE_EXIT_MS` timers on `httpServer`, then
  `await serverRuntime.dispose()` in place of `server.close`, with the same
  order for the other components. No wrapper was needed: `index.ts` already
  uses top-level await (`await runMigrations(db)`).
- `apps/server/package.json` + `pnpm-lock.yaml`: removed `@hono/node-server`
  via `pnpm --filter @zilar/server remove @hono/node-server`.
- Added `apps/server/src/effect/edge-node.test.ts`: serves a `createEdge`
  (probe mount, streaming mount, health stub) through `NodeHttpServer` on
  port 0 and checks `GET /health` 200, `HEAD /health` 200 with empty body,
  the probe seeing a loopback address (`127.0.0.1`/`::1`/`::ffff:127.0.0.1`),
  a `ReadableStream` body (`a`, wait, `b`, close) arriving incrementally,
  and a client-forged socket-address header being ignored; disposes the
  runtime and the edge at the end.

### Files changed
`apps/server/src/index.ts`, `apps/server/src/effect/edge.ts`,
`apps/server/src/effect/edge-node.test.ts` (new), `apps/server/package.json`,
`pnpm-lock.yaml`, `work/T-0733-node-http-server-start.md`.

### Commands and real results
- `pnpm install`: done (13.4s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/edge-node.test.ts`: 3 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect`: 8 files, 45 tests, all passed.
- `git grep -n "@hono/node-server" -- apps/server`: prints nothing (exit 1).
- `pnpm --filter @zilar/server typecheck` (`tsc --noEmit`): exit 0. The
  gate's typecheck covers `index.ts`: `apps/server/tsconfig.json` has
  `"include": ["src", "drizzle.config.ts", "../../packages/xmpp-core/src/types/xmpp.d.ts"]`.
- `pnpm gate`: GATE FAIL. Summary lines:
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `FAIL typecheck`,
  `scope: every changed file is inside the Allowed files`, `GATE FAIL`.
  The single typecheck error is in `apps/runner/src/e2e.test.ts:28`, which
  is outside my Allowed files (see Blocked below).

### Blocked / needs a decision
Removing `@hono/node-server` (spec item 3, required by acceptance) breaks
`apps/runner/src/e2e.test.ts:28`, which dynamically imports
`@zilar/server/node_modules/@hono/node-server/dist/index.mjs` to serve a
test app (`loadServe()`, used at line 66 with `appWithOnline.fetch`). That
file is outside my Allowed files, so I did not touch it. The repo-wide
`tsc --noEmit` in `@zilar/runner` now fails with TS2307 (Cannot find
module), and that is the only gate failure: install, format, lint pass,
and `@zilar/server` typecheck passes on its own. Question for the lead:
either (a) expand this task's scope to `apps/runner/src/e2e.test.ts` and
tell me the preferred replacement (e.g. serve `app.layer` via
`NodeHttpServer` on port 0, mirroring `edge-node.test.ts`), or (b) move
that fix to a follow-up task and accept this branch landing with the
runner typecheck red. I recommend (a); the fix is small and keeps the gate
green.

### Round 2 (lead option a: shared helper)
- New `apps/server/src/effect/node-serve.ts`: `serveEdgeOnNode(edge:
  Pick<ZilarEdge, 'layer'>, { port, connectionGraceMs? })` builds
  `createServer()` + `ManagedRuntime.make(HttpRouter.serve(edge.layer,
  …).pipe(Layer.provideMerge(NodeHttpServer.layer(…))))`, reads the port
  from `HttpServer.address`, and returns `{ httpServer, port, close() }`;
  `close()` drops idle connections at once, live ones after the grace, then
  disposes the runtime. The grace constant stays in `index.ts`
  (`CONNECTION_GRACE_MS`, moved above the serve call) and is passed in.
- `index.ts` now calls `serveEdgeOnNode(app, { port: config.PORT,
  connectionGraceMs: CONNECTION_GRACE_MS })` with the same log line
  (`{ port }, 'zilar-server listening'`) and the same shutdown order/timers
  (`closeNodeServer()` in place of the inline close + dispose).
- `apps/runner/src/e2e.test.ts`: deleted `loadServe`, its comment, the
  `@hono/node-server` dynamic import and the manual listen-wait; serves
  `appWithOnline` with `serveEdgeOnNode(appWithOnline, { port: 0 })`
  (imported from `@zilar/server/src/effect/node-serve.ts`), uses the
  returned port, and calls `closeHttp()` in `cleanup`. All assertions kept.
- `edge-node.test.ts` serves through the helper too.
- Checks: `src/effect` 8 files / 45 tests passed; `src/e2e.test.ts`
  (runner) 1 passed; `pnpm gate` ends with GATE PASS:
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS tests @zilar/runner`, `PASS tests @zilar/server`,
  `scope: every changed file is inside the Allowed files`, `GATE PASS`.
  Commits this round: `e071f998` (helper), `f775ac10` (index.ts),
  `af172dea` (runner e2e), `8a98f9f6` (edge-node test).

### Security checklist (unchanged in round 2: the helper moves the same
start/stop code, logs only the port, and keeps the header strip)
- No secrets/tokens in logs or errors; the new code logs only the port.
- No deletes/updates, caps, permissions, or audit entries touched.
- No new routes; the served layer is the same `appLayer` as the web handler.
- The forged socket-address header is still stripped at the edge; under
  Node the address comes from the real socket (covered by the new test).

## Review (written by Claude)

**2026-10-09, lead:** approved after one lead decision round. The pre-review was clean, with 2 comment nits (packet head 202057a5).
- **Round 1** stopped correctly: the runner e2e imported `@hono/node-server` from the server's `node_modules`.
- **Round 2:** a shared `serveEdgeOnNode` in `effect/node-serve.ts` now starts and stops the server. It is used by `index.ts`, the runner e2e and `edge-node.test.ts`.
- **Shutdown:** the order (idle, grace, all, dispose) and the timers are unchanged. The lead checked that the `NodeHttpServer` finalizer skips `close()` once the server stops listening (`NodeHttpServer.js:61`), so the double close is safe.
- **Result:** `@hono/node-server` is gone, and Hono is now used only by `git/*` (A12).
- **Accepted nits:** the stale `serve()` wording in two comments (`index.ts:452,479` and `edge.ts:341`).
