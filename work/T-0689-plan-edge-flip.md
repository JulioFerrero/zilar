---
id: T-0689
title: "audit + plan (no code): B1 edge flip — how to replace the Hono edge (app.ts middleware, /api/auth passthrough, /health, notFound/onError, @hono/node-server serve) with Effect HttpApi/HttpRouter + NodeHttpServer, cut into small ordered tasks; writes docs/audit/effect-edge-flip-plan.md"
status: merged
milestone: M5
branch: task/T-0689-plan-edge-flip
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0689: the edge-flip plan (B1)

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with Effect HTTP replacing Hono. Every API module now runs on Effect `HttpApi`, but the outer edge is still Hono, and that is audit item B1 in `docs/audit/effect-last-mile.md`. B1 is too big for one task, so the lead needs a plan cut into small ordered tasks first. **This task writes only the plan. It changes no code.**

### Verified facts (do not re-derive)
- **`apps/server/src/app.ts`** (728 lines) builds a Hono app:
  - `requestId()` (line 264);
  - a request-log middleware that logs the path with `/api/join/<token>` masked (lines 266-288);
  - `cors({ origin: config.WEB_ORIGINS, credentials: true })` on `/api/*` (lines 290-296);
  - an origin guard that answers 403 on unsafe methods (lines 298-304);
  - `app.all('/api/auth/*', (c) => auth.handler(c.req.raw))`, the better-auth passthrough (line 306);
  - about 30 `mountEffectRoutes(app, X.routes, X.handler)` calls (lines 308-511);
  - then `/health`, `notFound` and `onError` (about lines 610-640).
- **`apps/server/src/effect/http.ts`** (214 lines): `mountEffectRoutes` and `mountEffectApi` bridge Hono to the Effect handlers. `SOCKET_ADDRESS_HEADER` and `REQUEST_ID_HEADER` carry the socket address and request id across that bridge.
- **`apps/server/src/index.ts:1`** imports `serve` from `@hono/node-server`, and line 401 calls `serve({ fetch: app.fetch, port })`. Later code relies on the server object (lines 441, 468, 519).
- **Hono is also used by** `git/proxy.ts` and `git/routes.ts` (A12, Julio's call; out of scope) and by tests: `app.test.ts`, the authz sweep, and every `createApp(...).request(...)` test.
- **Effect 4.0.2 is installed.** The HTTP modules are `effect/http` and `effect/http-api`; check `node_modules/effect/dist/http*/` for `HttpRouter`, `HttpMiddleware` and `NodeHttpServer` (or the platform-node package, if one is installed).

### What to build
Write `docs/audit/effect-edge-flip-plan.md` with these sections:
1. **Inventory:** every Hono feature the edge uses, each with `file:line`, plus every test helper that relies on `app.request(...)` or the Hono `Context`, with counts.
2. **Target:**
   - which Effect modules replace each feature (request id, logging, CORS, the origin guard, the better-auth passthrough, `/health`, notFound/onError, the server start);
   - how the socket address is read without the Hono bridge;
   - how tests call the app afterwards. Say whether a `fetch`-style handler such as `app.fetch(new Request(...))` can stay, so that most tests do not change.

   Verify each named Effect export in `node_modules`, with its path.
3. **Risks:**
   - error envelope and status parity;
   - streaming (drafts SSE, file proxy, voice);
   - multipart (stickers, avatars);
   - better-auth cookies and redirects;
   - the request-log masking.
4. **An ordered task list:** small tasks, each with its files, tests and size, and each leaving the server working. Mark what can run in parallel.
5. **Decisions for Julio,** if any.

### Read first
`AGENTS.md`, `apps/server/src/app.ts`, `apps/server/src/effect/http.ts`, `apps/server/src/index.ts` (lines 1-60 and 380-549), `docs/audit/effect-last-mile.md` (the B1 row), `docs/EFFECT_GUIDE.md`.

### Allowed files
`docs/audit/effect-edge-flip-plan.md`, `work/T-0689-plan-edge-flip.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan exists with all five sections, and every claim cites `file:line` or a verified `node_modules` path.
- No code changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/effect-edge-flip-plan.md` with all five required sections
(Inventory, Target, Risks, ordered task list, Decisions). **No code changed** —
the only other edit is this task file. Every claim cites `file:line` or a path
verified in the installed `node_modules`.

Key findings the plan is built on:

- `effect@4.0.2` is installed; `HttpRouter`, `HttpMiddleware`,
  `HttpServer.serve`, `HttpRouter.toWebHandler`, `HttpServerRequest.toWeb` and
  `HttpServerResponse.fromWeb` all exist and were read in
  `apps/server/node_modules/effect/dist/**`.
- **`NodeHttpServer` is not in the installed `effect` package** (`rg -l
  "NodeHttpServer" effect/dist` returns nothing) and `@effect/platform-node` is
  **not installed** (`apps/server/node_modules/@effect/` has only `sql-pg` and
  `sql-pglite`). `@effect/platform-node@4.0.2` exists on npm (registry
  `latest = 4.0.2`), so B1.6 (server start) needs a dependency decision (plan
  §5, D1).
- `effect/http.ts` is **both** the Hono bridge and the shared error/session
  core used by all 36 modules, so the plan splits it instead of deleting it.
- The edge mounts **36** modules (`rg -c "mountEffectRoutes\(" app.ts` = 36),
  and there are **827** `.request(` call sites across server tests. A
  `fetch`-style handler plus a `request()` shim keeps all 827 unchanged; only
  the Hono-only tests (`app.test.ts`, `authz-sweep.test.ts`) and 3 bridge tests
  must change.
- `authz-sweep.test.ts` enumerates `app.routes`, which Effect `HttpRouter` does
  not expose, so the plan adds a route manifest export.

### Files changed

- `docs/audit/effect-edge-flip-plan.md` (new).
- `work/T-0689-plan-edge-flip.md` (status + this Report).

All inside the task's Allowed files.

### Commands and real results

- `pnpm install` — completed, `Done in 12.3s using pnpm v10.32.1` (one
  `@types/react` peer warning in `apps/mobile`, pre-existing).
- `pnpm gate` (repo root) — summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (48.8s)
  PASS  lint  (1.7s)
  PASS  typecheck  (1.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  (The same `GATE PASS` with the same 2-file scope was seen on the first run
  too; the numbers above are the final run.)
- No single test file was run: this task touches no code and no test file, so
  AGENTS.md's "nearest tests" have nothing to run (the gate shows no test step
  for a docs-only change).

### Deviations from the spec

- The spec says `app.ts` is 728 lines with "about 30 `mountEffectRoutes`
  calls"; the file is 724 lines with **36** calls. The plan cites the real
  numbers.
- The spec's shutdown line numbers for `index.ts` (441, 468, 519) are stale;
  the real shutdown block is `index.ts:501-542`. The plan cites the real lines.

### Blocked / needs a decision

Not blocked — the plan is complete. Three decisions are recorded in the plan
§5 and carried here:

- **D1:** approve adding `@effect/platform-node@4.0.2` for `NodeHttpServer`
  (B1.6 needs it), or choose to keep `@hono/node-server` as the raw listener.
- **D2:** confirm B1.9 ("delete Hono") lands after A12, since
  `git/routes.ts` still imports the Hono class.
- **D3:** confirm architecture A (edge dispatches to the existing per-module web
  handlers) for B1, with B (merge all `HttpApi` layers) as a follow-up.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 3cf65ff9). It had 2 doc nits: `machines/api.ts` calls `socketAddressOf` directly, and the count is 37 imports, not 36. The lead fixes them on main.

**Lead decisions (Julio asleep; he had asked for Effect HTTP in place of Hono):**
- **D1:** add `@effect/platform-node@4.0.2`. It exists and its peer is `effect ^4.0.2`.
- **D2:** B1.9 waits for A12, which stays Julio's call.
- **D3:** architecture A for B1; B is a recorded follow-up.
