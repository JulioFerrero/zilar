---
id: T-0498
title: "Effect F4 + P1: Effect HttpApi mounted under Hono (strangler adapter, session middleware, identical error JSON) — the handles module moved onto it, its Hono-level tests unchanged"
status: todo
milestone: M5
branch: task/T-0498-httpapi-adapter-handles
model: auto
effort: low
depends_on: [T-0495]
estimate: 1 day
---

# T-0498: the HttpApi adapter, piloted on handles

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's own HTTP server replaces Hono entirely. Plan `docs/audit/effect-everywhere-plan.md`:
- §2.1 is the strangler: mount Effect `HttpApi` handlers under Hono one module at a time, then flip the edge to `@effect/platform-node` and remove Hono;
- §4.2 F4 is the adapter and harness;
- §4.3 P1 is the first module.

This task does both F4 and P1 with the small `handles` module. **The proof is that `apps/server/src/handles/handles.test.ts` passes unchanged** through the new handlers.

### Verified facts (do not re-derive)
- **`apps/server/src/app.ts` `createApp`** (from line 207):
  - `new Hono` (line 245);
  - `requestId()` middleware (line 259);
  - the request log middleware (lines 261-283), which logs `logPath(c.req.path)` so join tokens never reach the log;
  - CORS on `/api/*` (lines 285-291) and the unsafe-method origin guard (lines 293-299), which throws `HttpError(403, 'forbidden', 'Origin is not allowed')`;
  - better-auth `app.all('/api/auth/*', …)` (line 301);
  - the routers `app.route('/api', create…Routes(...))`, with handles at line 323: `createHandlesRoutes({ auth, db, audit: auditRecorder })`;
  - `/health` (line 601), `notFound` (line 616);
  - **`onError` (from line 623): an `HttpError` becomes JSON `{ error: { ...detail, code, message, requestId } }`** with its status.
- **`apps/server/src/errors.ts`:** `HttpError(status, code, message, detail = {})`.
- **`apps/server/src/auth/session.ts:6-12`:** `requireSession(auth, headers)` calls `auth.api.getSession({ headers })` and throws `HttpError(401, 'unauthorized', 'Authentication required')`.
- **`apps/server/src/handles/routes.ts`** is a Hono router:
  - zod `checkQuerySchema` (`handle` 1..64, `kind` user|group optional) and a strict `claimBodySchema`;
  - two rate limiters (check: 30 per 10 min; claim: 10 per 24 h; injectable, with a `now` seam);
  - it calls the `apps/server/src/handles/store.ts` Promise functions (`checkHandleAvailability`, `checkGroupHandleAvailability`, `claimHandle`, `handleForUser`, `reapExpiredRetiredHandles`);
  - the deps are `{ auth, db, audit?, now?, checkLimiter?, claimLimiter? }`.
  
  Tests: `apps/server/src/handles/handles.test.ts` and `apps/server/src/handles/rules.test.ts`.
- **Effect 4 HTTP** (in the installed `effect` 4.0.0, exports `effect/http` and `effect/http-api`):
  - `http-api/HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, `HttpApiMiddleware`, `HttpApiSecurity`, `HttpApiTest`;
  - `http/HttpRouter.d.ts:752` `toWebHandler(appLayer, …)`, which turns a router layer into a `(Request) => Promise<Response>` fetch handler;
  - `http/HttpEffect.d.ts:156` `fromWebHandler`.
  
  Docs: `docs/effect-reference/LLMS.md` "Building HttpApi servers".
- **The runtime and logger** come from T-0495 (merged before this task starts): `apps/server/src/effect/runtime.ts` (`makeServerRuntime`) and `apps/server/src/effect/logger.ts` (`makePinoLoggerLayer`).

### What to build
1. **`apps/server/src/effect/http.ts`, the strangler adapter:**
   - **`mountEffectApi(app, prefix, webHandler)`** mounts a fetch handler from `toWebHandler` under Hono (`app.all(prefix + '/*', …)` or exact paths), passing `c.req.raw`. Hono's existing middleware still runs first: request id, the log line, CORS and the origin guard.
   - **The request id** reaches the Effect side through a header that Hono sets (for example `x-request-id` on the forwarded `Request`). Error bodies carry it.
   - **A `Session` HttpApiMiddleware or security** calls `auth.api.getSession({ headers })` and fails with an error that renders exactly like `HttpError(401, 'unauthorized', 'Authentication required')`.
   - **One error encoding:** any handler failure carrying `{ status, code, message, detail? }` renders as `{ error: { ...detail, code, message, requestId } }` with that status, **byte-identical** to `onError`. Unknown defects render as today's 500 branch: read `onError` and copy its exact body.
2. **`apps/server/src/handles/api.ts`:** the handles endpoints as an `HttpApiGroup`, with the same methods, paths, query and body rules and status codes as `routes.ts`.
   - **Schema** replaces zod for the query and body. Invalid input must give **the same status and error body** as today's zod path; read how `routes.ts` turns a zod failure into an `HttpError` and match it.
   - **Rate limiters:** the same limiters and the same `now` seam, through deps.
   - **Handlers** call the existing `store.ts` functions (drizzle stays for now; the DB rewrite is a separate lane).
   - **Audit:** the same audit calls.
3. **`apps/server/src/app.ts`:** replace line 323's `app.route('/api', createHandlesRoutes(...))` with the adapter mount for the handles paths. **Nothing else in `app.ts` changes.** Delete `apps/server/src/handles/routes.ts`, or keep it exporting the constants that tests import; check what `handles.test.ts` imports and keep those exports working.
4. **Tests:**
   - `apps/server/src/handles/handles.test.ts` and `apps/server/src/handles/rules.test.ts` pass **unchanged**. That is the acceptance proof. If one cannot, stop and report BLOCKED with the exact diff in behaviour; do not edit it.
   - Add `apps/server/src/effect/http.test.ts` covering:
     - the error envelope for a custom error and for a defect;
     - 401 without a session;
     - the request id carried into the body;
     - an origin-guard rejection still coming from Hono for an Effect-mounted path.
5. **Write the recipe** for moving the next module as a "Recipe" section in your Report. The lead copies it into the guide.

### Read first
`AGENTS.md`, `docs/audit/effect-everywhere-plan.md` §2.1 and §4, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md` (HttpApi), `apps/server/src/app.ts:200-330` and `:600-660`, `apps/server/src/errors.ts`, `apps/server/src/auth/session.ts`, `apps/server/src/handles/` (all files), `apps/server/src/effect/runtime.ts`, `apps/server/src/effect/logger.ts`.

### Allowed files
`apps/server/src/effect/http.ts`, `apps/server/src/effect/http.test.ts`, `apps/server/src/handles/api.ts`, `apps/server/src/handles/routes.ts`, `apps/server/src/app.ts`, `work/T-0498-httpapi-adapter-handles.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles src/effect
pnpm gate
```

### Acceptance
- An Effect `HttpApi` adapter is mounted under Hono, with session middleware and an error envelope identical to `onError`.
- The handles module runs on it, and `handles.test.ts` and `rules.test.ts` are unchanged and green.
- A recipe for the next modules is in the Report.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
