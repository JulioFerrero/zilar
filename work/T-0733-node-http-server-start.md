---
id: T-0733
title: "B1.6: start the server on @effect/platform-node — createEdge also exposes its HttpRouter layer; index.ts serves it with HttpRouter.serve + NodeHttpServer.layer on its own node:http server (graceful shutdown kept); @hono/node-server removed from apps/server"
status: todo
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
`apps/server/src/index.ts`, `apps/server/src/effect/edge.ts`, `apps/server/src/effect/edge-node.test.ts`, `apps/server/package.json`, `pnpm-lock.yaml`, `work/T-0733-node-http-server-start.md`.

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

## Review (written by Claude)
