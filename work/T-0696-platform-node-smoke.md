---
id: T-0696
title: "B1.2: add @effect/platform-node 4.0.2 to apps/server and a smoke test that NodeHttpServer serves one HttpRouter route on a random port (no app change)"
status: merged
milestone: M5
branch: task/T-0696-platform-node-smoke
model: auto
effort: low
depends_on: [T-0689]
estimate: 0.1 day
---

# T-0696: @effect/platform-node and a smoke test (B1.2)

## Spec (written by Claude, do not edit)

### Why
Julio wants Effect HTTP to replace Hono. To start the server without `@hono/node-server`, B1.6 in `docs/audit/effect-edge-flip-plan.md` needs `NodeHttpServer`, which comes from `@effect/platform-node`. The lead decided (plan §5, D1) to add `@effect/platform-node@4.0.2`. This task adds it and proves it works with our `effect` version. **The app does not use it yet.**

### Verified facts (do not re-derive)
- **`apps/server/package.json`:** `dependencies` start at line 14, with `@effect/sql-pg` and `@effect/sql-pglite` pinned at `4.0.2` (:15-16) and `effect` at `^4.0.2` (:25).
- **`npm view @effect/platform-node@4.0.2`:**
  - peer `effect ^4.0.2`;
  - deps `undici ^8.11.2` and `@effect/platform-node-shared ^4.0.2`;
  - exports `"./*": "./dist/*.js"`, so modules import as `@effect/platform-node/NodeHttpServer`. Check the real module names in `node_modules/@effect/platform-node/dist/` after the install.
- **`HttpRouter`** and the other HTTP modules come from `effect/http` (see `apps/server/src/effect/http.ts:14`).

### What to build
1. **Add the dependency** with `pnpm --filter @zilar/server add @effect/platform-node@4.0.2`. Pin it exactly, as the sql packages are. Commit `package.json` and `pnpm-lock.yaml`.
2. **Add `apps/server/src/effect/node-server.test.ts`:**
   - build a tiny `HttpRouter` with one `GET /ping` that answers JSON `{ ok: true }`;
   - serve it with `NodeHttpServer.layer(() => createServer(), { port: 0 })` (or the 4.0.2 equivalent you find in the `.d.ts`);
   - read the bound port from the `HttpServer` service (`address`);
   - `fetch` `/ping`, and assert 200 and the body;
   - also assert that a request's `remoteAddress` is set (log it in the handler and return it in the body), because B1.5 relies on it;
   - shut the server down when the test ends (a scoped layer, `Effect.scoped`, or `ManagedRuntime.dispose`).

   Keep it under about 60 lines, and cite the `.d.ts` lines you used in the Report.
3. **No other file changes.**

### Read first
`AGENTS.md`, `docs/audit/effect-edge-flip-plan.md` (§2, §4 B1.2), `apps/server/src/effect/http.ts` (lines 1-50), and, once the install is done, the NodeHttpServer type definitions in the installed package's dist folder.

### Allowed files
`apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/src/effect/node-server.test.ts`, `work/T-0696-platform-node-smoke.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/node-server.test
pnpm gate
```

### Acceptance
- The dependency is pinned at `4.0.2`, and the lockfile is updated.
- The smoke test passes and leaves no open handle (vitest exits on its own).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Added `@effect/platform-node` pinned exactly at `4.0.2` to `apps/server` (same pin style as the `@effect/sql-*` packages). The lockfile updated.
- Added `apps/server/src/effect/node-server.test.ts`: one `GET /ping` `HttpRouter` route served by `NodeHttpServer.layer(() => createServer(), { port: 0 })`. The handler returns `{ ok: true, remoteAddress }` (read from `HttpServerRequest.remoteAddress`), logs it at debug level, and the test `fetch`es `/ping`, asserting `200`, `ok: true` and a non-empty string `remoteAddress`.
- The test reads the bound port from the `HttpServer` service (`address`) and disposes the server with `ManagedRuntime.dispose()` in a `finally`, so no handle stays open and vitest exits on its own.
- No app code changed; nothing imports the new package except this test.

### `.d.ts` lines cited
- `node_modules/.pnpm/@effect+platform-node@4.0.2_.../dist/NodeHttpServer.d.ts`: `layer` :111 (`Layer.Layer<HttpServer | NodeServices | HttpPlatform | Etag.Generator, ServeError>`); `make` :52-58 with `address` :57.
- `.../dist/NodeHttpIncomingMessage.d.ts`: `get remoteAddress(): Option.Option<string>` :53.
- `node_modules/.pnpm/effect@4.0.2/node_modules/effect/dist/http/HttpRouter.d.ts`: `add` :230; `serve` :718 (options incl. `disableLogger`/`disableListenLog`).
- `.../effect/dist/net/NetAddress.d.ts`: `InetAddressV4.port` :186, `InetAddressV6.port` :201, `SocketAddress` union :236.

### Files changed
- `apps/server/package.json` (one dependency line).
- `pnpm-lock.yaml`.
- `apps/server/src/effect/node-server.test.ts` (new, 56 lines).
- `work/T-0696-platform-node-smoke.md` (status + this Report).

### Commands and real results
- `pnpm install`: done in 12.3s; the pre-existing `@types/react-dom` peer warning is unrelated.
- `pnpm --filter @zilar/server add @effect/platform-node@4.0.2`: done in 5.9s; `package.json` line added as `"@effect/platform-node": "4.0.2"`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/node-server.test`: `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- `pnpm gate` (final):
  ```
  PASS  install (frozen)  (1.6s)
  PASS  format  (19.4s)
  PASS  lint  (0.7s)
  PASS  typecheck  (4.0s)
  PASS  tests @zilar/server  (1.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- The spec said "serve it with `NodeHttpServer.layer(() => createServer(), { port: 0 })` (or the 4.0.2 equivalent)". The installed 4.0.2 `layer` takes `(evaluate: LazyArg<Http.Server>, options)`, so the call is exactly that.
- The spec said "read the bound port from the `HttpServer` service (`address`)" and "shut the server down when the test ends (a scoped layer, `Effect.scoped`, or `ManagedRuntime.dispose`)". I used `ManagedRuntime` + `dispose`, and `Layer.provideMerge` (not `Layer.provide`) so the `HttpServer` service stays in the runtime context for the port read.
- The handler does `Effect.logDebug('ping handled', { remoteAddress })`; debug is below the default Info log level, so it does not print during the test, and the same value is asserted from the response body.
- First two gate runs failed typecheck while I fixed the service type annotation; the final run is green. No out-of-scope files were ever listed.

### Blocked / needs a decision
None.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head d347500a). `@effect/platform-node` is pinned at `4.0.2` and the lockfile is updated. The smoke test serves `GET /ping` through `HttpRouter.serve` and `NodeHttpServer.layer` on port 0, reads the port from `HttpServer.address`, checks that `remoteAddress` is set (B1.5 relies on it), and disposes the runtime.
