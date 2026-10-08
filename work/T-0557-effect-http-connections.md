---
id: T-0557
title: "Effect C (HTTP): provider-key connections routes (list, create, test, delete) onto the HttpApi adapter, zod to Effect Schema; keys never in responses or logs; createConnectionsRoutes stays as a thin Hono wrapper for the tests; tests unchanged"
status: merged
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

Done. Connections are served by Effect `HttpApi`; all listed tests pass unchanged; `pnpm gate` ends with GATE PASS with every changed file inside the Allowed files.

### What I did
- **Created `apps/server/src/connections/api.ts`**: the four routes (`GET /connections`, `POST /connections`, `POST /connections/:id/test`, `DELETE /connections/:id`) on `HttpApiGroup('connections')` + `Session` middleware with the `/api` prefix, exported as `createConnectionsApi` with `CONNECTIONS_API_ROUTES`. Same statuses (201 on create, 204 on delete via `HttpApiSchema.NoContent`, 503 gating via `requireCipher` before everything, 404 before 429 on test), same bodies and texts (`Invalid JSON body` for non-JSON, `Invalid connection request` for schema violations, `Too many key tests, try again in a minute`, `Connection not found`, `connection_in_use` bare count, `key_unreadable`), same step order (cipher before decode on create; session, cipher, owned lookup, limiter, decrypt, probe on test). No zod in the module: `ConnectionProvider` is a local Effect Schema with the same literals as `PROVIDER_IDS` (`ProviderIdSchema` stays zod in `./providers` — only `routes.ts` imported it, nothing else does). Success schemas list every field of `PublicConnection` (`id`, `provider`, `label`, `status`, `createdAt` via `Schema.Date`); the encrypted key is not one of them. The create body decodes manually in the handler (`decodeUnknownOption` with `{ onExcessProperty: 'error' }`, so strict `.strict()` behavior holds — the `status: 'revoked'` test still 400s). Probe throws are caught as defects, logged with `redactKey(message, key)` plus ids only, and answered `{ ok: false, message: 'The provider could not be reached' }`. No key reaches any response, log or error text (verified by the existing redaction tests). Injectable `now`, `probe`, `testLimiter` (new `ConnectionsApiDependencies`).
- **`apps/server/src/connections/routes.ts`**: thin wrapper (item 11) — keeps the constants, dependency/logger types, and `createConnectionsRoutes(deps): Hono` which builds `createConnectionsApi` and registers each pair from `CONNECTIONS_API_ROUTES` minus the `/api` prefix. `app.ts:30` still imports `type ConnectionsLogger` from `./connections/routes`, unchanged.
- **`apps/server/src/app.ts`**: mounts `createConnectionsApi(...)` via `mountEffectRoutes` at the same position (replacing `app.route('/api', createConnectionsRoutes(...))`).
- No changes to `connections/service.ts`, `connections/crypto.ts`, `connections/probe.ts`. No new dependencies. Tests unchanged.

### Side-by-side check (item 8)
`PublicConnection` = `{ id, provider, label, status, createdAt }`; `ConnectionView` schema = `{ id: String, provider: ConnectionProvider, label: NullOr(String), status: Literals(['active','revoked']), createdAt: Date }`. Every field listed; `encryptedKey` never leaves the service layer. List uses `Schema.Array(ConnectionView)` like `contacts/api.ts`.

### Decode texts (item 10)
Old zod path texts kept byte-identical by manual decode: non-JSON body → `400 invalid_request 'Invalid JSON body'`; schema violation → `400 invalid_request 'Invalid connection request'`. No test asserts these texts; the strict-field test only asserts the 400 status.

### Commands and real results
- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/connections/routes.test.ts`: 16 passed. (One fix on the way: `Schema.Union` needs the array form `Schema.Union([...])` — varargs throws `members.map is not a function`.)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot connections ais authz-sweep app.test`: 9 files passed, 2 skipped; 141 tests passed, 3 skipped.
- `pnpm gate` (from repo root): `gate: 4 changed file(s) against main` / `PASS install (frozen) (1.7s)` / `PASS format (25.1s)` / `PASS lint (0.9s)` / `PASS typecheck (10.1s)` / `PASS tests @zilar/server (488.1s)` / `scope: every changed file is inside the Allowed files` / `GATE PASS`. (First gate run failed `format` on the new `api.ts`; fixed with `prettier --write` on that file only, then the full gate passed. A later duplicate `pnpm gate` re-run timed out at 900s without output — the completed run above is the result I report.)

### Security checklist
- Keys never reach responses (views omit the key; tests assert), logs (ids only; probe errors redacted) or error texts (fixed strings).
- Deletes/updates scoped by `(id, owner)` in `findOwnedConnection`/`deleteConnectionRow`; unknown and foreign ids answer the same 404.
- Test limiter keyed per user, checked after the 404 lookup; nothing has an effect before the session check.
- New routes carry the same 401 sweep coverage via exact `mountEffectRoutes` pairs (authz-sweep green).

### Problems / deviations / open questions
None. One note: the wrapper passes the Hono request through `api.handler(context.req.raw)`; the Effect session layer reads the session from headers, and Hono's `/api/*` middleware (CORS, origin guard, request log) still runs before it since the mount is exact method+path pairs on the same app.

### Round 2 (fix round, PREREVIEW findings)
- Finding 1 (must-fix, defect logger level): fixed. `defectLogger.error` now forwards to `deps.logger.error` when present and falls back to `warn` only for the warn-only route-test fake. Supporting change: `ConnectionsLogger` gained optional `error?`. Commit `T-0557: fix finding 1 - defect logger keeps error level on real logger` (only `apps/server/src/connections/api.ts` touched).
- Finding 2 (should-fix, `catchCause` → `catchAll`): NOT applied — disagreement, see below. Code left as it is.
- Finding 3 (nit, `ConnectionProvider` drift vs `PROVIDER_IDS`): no code change per the "do not touch nits" rule; the existing comment on the schema (`api.ts:84-85`) already points at `PROVIDER_IDS`.
- No test was added or changed: the spec requires tests unchanged, test files are outside Allowed files, and the existing suite covers the fix path (the warn-only fake in `routes.test.ts:40-51` exercises the fallback branch; production passes the real pino logger via `app.ts`).

### Disagreements
- Finding 2 asks to replace `Effect.catchCause` with `Effect.catchAll` on `request.request.json`, claiming `catchCause` swallows interruption and diverges from `push/api.ts:311`. Both premises are wrong: (a) `push/api.ts:311-313` itself uses `Effect.catchCause(() => Effect.succeed<unknown>(undefined))` — the connections code already matches the worked example; (b) `request.request.json` surfaces a body-parse failure as a defect (die), not a typed failure — `catchAll` only catches typed failures, so applying the suggested fix turns every create POST into a 500 `internal_error` (verified: 13 of 16 tests in `routes.test.ts` fail with `catchAll`, including create → 500 instead of 201; all 16 pass with `catchCause`). The current `catchCause` is load-bearing and must stay.

### Round 2 commands and real results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/connections/routes.test.ts`: 16 passed (after finding-1 fix; intermediate `catchAll` experiment reverted as above).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot connections ais authz-sweep app.test`: 9 files passed, 2 skipped; 141 tests passed, 3 skipped.
- `pnpm gate` (from repo root, backgrounded after a foreground run timed out at 900s with no output): `gate: 4 changed file(s) against main` / `PASS install (frozen) (7.9s)` / `PASS format (142.3s)` / `PASS lint (1.7s)` / `PASS typecheck (1.5s)` / `PASS tests @zilar/server (1699.3s)` / `scope: every changed file is inside the Allowed files` / `GATE PASS`, exit 0.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean after 1 automatic round.
  - The defect logger keeps the `error` level.
  - The `catchCause` finding was withdrawn, because `push/api.ts` uses the same pattern.
  - The packet was written after HEAD 69ffd265 and quotes the fixed code.
- **No test file changed.**
- **Lead check:** `ConnectionView` lists exactly the 5 `PublicConnection` fields, so the encrypted key cannot be in a response. `createdAt` uses `Schema.Date`, as groups, ais and approvals do.
