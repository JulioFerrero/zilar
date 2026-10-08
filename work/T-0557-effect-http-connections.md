---
id: T-0557
title: "Effect C (HTTP): provider-key connections routes (list, create, test, delete) onto the HttpApi adapter, zod to Effect Schema; keys never in responses or logs; createConnectionsRoutes stays as a thin Hono wrapper for the tests; tests unchanged"
status: todo
milestone: M5
branch: task/T-0557-effect-http-connections
model: auto
effort: low
depends_on: [T-0548]
estimate: 0.5 day
---

# T-0557: connections on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"**, items 8-11; item 11 is the thin Hono wrapper for tests that mount the factory directly. The worked examples are `apps/server/src/topics/api.ts` and `apps/server/src/push/api.ts` (the wrapper). **These routes carry provider API keys.** A key never appears in a response, a log line or an error text, the same as today. **Do not touch** `connections/service.ts`, `connections/crypto.ts` or `connections/probe.ts`.

### Verified facts (do not re-derive; read each route for its exact step order, statuses and texts)
- **`apps/server/src/connections/routes.ts`** (175 lines):
  - `CONNECTION_TEST_RATE_LIMIT_MAX` and `CONNECTION_TEST_RATE_LIMIT_WINDOW_MS` (lines 20-21);
  - `ConnectionsRoutesDependencies` (23) holds `auth`, `db`, `logger`, `cipher?`, `probe?` and `now?`. **Without `cipher`, every route answers 503.** Read `requireCipher`;
  - `ConnectionsLogger` (36);
  - `CreateConnectionSchema` (around 45): a **strict** `{ provider: ProviderIdSchema, key: trimmed 1..16384, label?: trimmed 1..256 }`. The key is trimmed;
  - `createConnectionsRoutes` (52), with `testLimiter` (62).
- **The four routes:**
  - `GET /connections` (79);
  - `POST /connections` (85);
  - `POST /connections/:id/test` (101). Its order: session, then cipher (503), then the owned connection (404 "Connection not found"), then the **limiter after the lookup** (429 "Too many key tests, try again in a minute"), then decrypt (500 `key_unreadable`, with a log carrying only ids), then the probe. It answers `{ ok: true }`, `{ ok: false, message }`, or, on a throw, a log with `redactKey(message, key)` and `{ ok: false, message: 'The provider could not be reached' }`;
  - `DELETE /connections/:id` (144), which answers **204**.
- **`ProviderIdSchema`:** find its import. If it is zod and other files import it, leave it alone and write a local Effect Schema with the same literals.
- **`apps/server/src/app.ts`** (around line 601) mounts `createConnectionsRoutes({ auth, db, logger: connections?.logger ?? logger, ...cipher, ...probe })`. Keep it at the same position. `app.ts:30` also imports `type ConnectionsLogger`; keep that type exported.
- **Tests (all unchanged):**
  - `apps/server/src/connections/routes.test.ts` builds the app through `createApp` (lines 67 and 79), and **also mounts `createConnectionsRoutes` directly** (line 461). It imports the two rate-limit constants and the factory from `./routes` (lines 17-21);
  - the other `apps/server/src/connections/*.test.ts`, `apps/server/src/ais/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/connections/api.ts`** with the four routes on `HttpApi`:
   - the same statuses (204 on delete, 503 gating), bodies, texts and **step order** (the limiter after the 404);
   - injectable `now`, `probe` and limiter;
   - an Effect Schema body with the same rules and strictness, and no zod in the module;
   - success schemas listing every field of the public connection view (item 8). The encrypted key is not one of them.
   
   Export `CONNECTIONS_API_ROUTES`.
2. **`routes.ts`:** keep the constants, the dependency and logger types, and `createConnectionsRoutes(deps): Hono` as the thin wrapper (item 11). Remove the zod schema and the old handlers.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/push/api.ts`, `apps/server/src/connections/routes.ts` (all of it), `apps/server/src/connections/routes.test.ts` (lines 1-90 and 450-500), and the connections mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/connections/api.ts`, `apps/server/src/connections/routes.ts`, `apps/server/src/app.ts`, `work/T-0557-effect-http-connections.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot connections ais authz-sweep app.test
pnpm gate
```

### Acceptance
- Connections are served by Effect `HttpApi`, with the same answers, step order and 503 gating, no key leaked, and no zod.
- The tests are unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
