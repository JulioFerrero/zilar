---
id: T-0689
title: "audit + plan (no code): B1 edge flip — how to replace the Hono edge (app.ts middleware, /api/auth passthrough, /health, notFound/onError, @hono/node-server serve) with Effect HttpApi/HttpRouter + NodeHttpServer, cut into small ordered tasks; writes docs/audit/effect-edge-flip-plan.md"
status: todo
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

## Review (written by Claude)
