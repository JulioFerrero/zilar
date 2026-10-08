---
id: T-0543
title: "Effect C (HTTP): push routes (config, subscriptions, settings, test) onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; same step order, statuses and texts; every push test unchanged"
status: merged
milestone: M5
branch: task/T-0543-effect-http-push
model: auto
effort: low
depends_on: [T-0536]
estimate: 1 day
---

# T-0543: push routes on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"** (read items 8-10 too). Worked examples: `apps/server/src/groups/api.ts` (limiters before decode, injectable limiters) and `apps/server/src/pins/api.ts`. **Do not touch** the push service, store, crypto, sender or component files.

### Verified facts (do not re-derive; read each route for its exact step order, statuses, bodies and texts)
- **`apps/server/src/push/routes.ts`** (363 lines):
  - `PushRoutesDependencies` (line 36) holds `auth`, `db`, `config`, `push: PushConfig`, `adminClient`, `logger`, and the injectable `now?` and `sender?`;
  - three limiters: `subscribeLimiter` (93), `settingsLimiter` (98) and `testLimiter` (103);
  - a `requirePush()` guard answers 404 or 503 when push is not configured; read it.
- **The seven routes:**
  - `GET /push/config` (120);
  - `POST /push/subscriptions` (129), with `subscribeSchema`, which extends `WebPushSubscriptionSchema`;
  - `GET /push/subscriptions` (226);
  - `DELETE /push/subscriptions/:id` (236);
  - `GET /push/settings` (277);
  - `PUT /push/settings` (283), with `showPreviewsSchema`;
  - `POST /push/test` (303). Its order: session, then `requirePush()`, then **decode** (`body ?? {}`; failure gives 400 "subscriptionId is required"), then the **limiter** (429 "Too many test notifications, try again later"), then device lookup (404), decrypt (410 `device_gone`), send (410 on expiry with the device removed, or 502 `push_failed` with `markDeviceFailed`), then `{ sent: true }`.
  
  Keep each route's own order: some decode before their limiter and some after.
- **`WebPushSubscriptionSchema`** comes from a shared module; find its import in `routes.ts`. If it is zod and other files import it, leave that module alone and write a local Effect Schema with the same rules. Name the file in the Report.
- **`apps/server/src/app.ts`** (around line 397) mounts `app.route('/api', createPushRoutes({ auth, db, config, push: push ?? loadPushConfig({}), adminClient, logger }))`. Keep it at the same position.
- **Tests (all unchanged):** `apps/server/src/push/routes.test.ts`, the other `apps/server/src/push/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/push/api.ts`** following the recipe:
   - the same seven routes, statuses, bodies and texts, and **the same step order per route**;
   - injectable `now`, `sender` and limiters;
   - the decrypted keys and endpoint are **never logged and never returned**, as today.
2. **Effect Schema for the three bodies** (subscribe, settings, test), with the same rules and no zod left in the module.
3. **`app.ts`:** replace the push `app.route(...)` and its import with `mountEffectRoutes(...)` at the same position. Delete `push/routes.ts`, unless a file outside the Allowed files imports from it; then keep it as a re-export-only file.
4. **Success schemas** list every field the handler returns (EFFECT_GUIDE item 8). Put the side-by-side comparison in the Report.
5. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/push/routes.ts` (all of it), and the push mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/push/api.ts`, `apps/server/src/push/routes.ts`, `apps/server/src/app.ts`, `work/T-0543-effect-http-push.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push authz-sweep app.test
pnpm gate
```

### Acceptance
- Push is served by Effect `HttpApi` through the adapter, with the same answers and step order, and no zod in the module.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Done. Push is served by Effect `HttpApi` through the adapter, with identical
step order, statuses, bodies and texts. No test file was changed.

### What I did
- Created `apps/server/src/push/api.ts`: `PushApi` group (`push`, prefix
  `/api`) with the same seven routes, `createPushApi(deps)` returning
  `{ handler, routes }` via `HttpRouter.toWebHandler` (`disableLogger: true`,
  `Session` + `withErrorEnvelope` like `groups/api.ts` / `pins/api.ts`).
  Injectable `now`, `sender`, and all three limiters (`subscribeLimiter`,
  `settingsLimiter`, `testLimiter`).
- Effect Schemas replace zod for the three bodies (local schemas; the zod
  `WebPushSubscriptionSchema` stays in `apps/server/src/push/subscriptions.ts`
  because `store.ts` and other push files import its type from there):
  - `SubscribeBody`: endpoint (any-scheme URL via `isUrl` from
    `@zilar/protocol`, max 2048), `expirationTime` optional nullable number,
    `keys.{p256dh,auth}` (1..256), `userAgent` optional nullable (1..256);
    non-strict, like the old zod `.extend()`.
  - `ShowPreviewsBody`: strict `{ showPreviews: boolean }`.
  - `TestBody`: strict `{ subscriptionId: 1..256 }`.
  `struct` from `@zilar/protocol` keeps zod's mutable field types. No zod
  import remains in the module.
- `app.ts`: replaced `app.route('/api', createPushRoutes(...))` with
  `mountEffectRoutes(app, pushApi.routes, pushApi.handler)` at the same
  position.
- `push/routes.ts` is now a re-export-only file (it re-exports
  `createPushApi`, `createPushRoutes`, the rate-limit constants, the dep
  types and `PUSH_API_ROUTES` from `./api`). Kept because the push route
  tests — files outside my Allowed files — import `createPushRoutes` from it.
  The kept `createPushRoutes` serves every route through the Effect handler
  (registered without the `/api` prefix so the tests' `app.route('/api', …)`
  keeps working).

### Deviation from the recipe (deliberate, keeps answers byte-identical)
- Bodies are decoded manually inside the handlers (`request.request.json`
  with the old `.catch(() => undefined/null)` fallbacks, then
  `Schema.decodeUnknownOption`, strict via `{ onExcessProperty: 'error' }`
  for settings/test) instead of as endpoint payloads, and every limiter is
  checked inside its handler. Reason: each old route runs `requirePush()`
  BEFORE its decode and (for subscribe/settings/test) the decode BEFORE its
  limiter; framework decode + endpoint-middleware limiters cannot reproduce
  that order (e.g. push-off + invalid body must answer 404, not 400). All
  decode-failure codes/messages are the old fixed texts.
- Two Effect-4 facts applied (both verified by failing tests first):
  `Effect.catchAll` does not exist in 4.0.2 (used `catchCause`/`catchDefect`,
  the codebase's idiom); a rejection behind `yield* Effect.promise(...)`
  surfaces as a defect and does NOT throw into a surrounding `try`, so the
  node-collision retry and the test-send 410/502 branches map the defect to
  a value first (`Effect.map` + `catchDefect`).

### Side-by-side: service return fields vs success schemas (item 8)
- `GET config` returns `{ vapidPublicKey, pushJid }`; schema lists both. Same.
- `POST subscribe` returns `{ id, node, jid }`; schema lists all three. Same.
- `GET list` returns `{ devices: toPushDeviceView(...) }` =
  `{ id, userAgent, createdAt, lastUsedAt, inactive }[]`; schema lists all
  five per device. Same.
- `DELETE remove` returns `{ removed: true }`; schema `{ removed: Boolean }`. Same.
- `GET/PUT settings` return `{ showPreviews }`; schema lists it. Same.
- `POST test` returns `{ sent: true }`; schema `{ sent: Boolean }`. Same.
- No field the handlers return is omitted from any success schema; nothing
  is stripped at encode time.
- Message texts old vs new (item 10): every failure text is the old fixed
  string (`The push subscription is invalid`, `showPreviews must be a
  boolean`, `subscriptionId is required`, the three limiter texts, `Not
  found`, `Push notifications are not configured`, `Push device not found`,
  `The push device is no longer usable`, `The test notification could not be
  sent`, `Could not register the push device`). No Schema message surfaces
  anywhere, so there is no old/new diff.

### Security checklist
- Secrets: endpoint URLs and sealed keys are never logged (sync-failure logs
  carry user id + error class only) and the list view carries labels/dates
  only — unchanged, covered by the S2/labels tests.
- Deletes scoped by `(userId, id)`; unknown id and another user's device
  answer the same 404 — unchanged code path.
- Caps atomic in the store (untouched). Rate limits: subscribe limiter
  shared by add+remove, settings and test limiters — same budgets, same order.
- 401 before any decode via `Session`; exact method+path pairs exported in
  `PUSH_API_ROUTES` for the authz sweep.
- Audit: push writes no audit rows (unchanged).

### Commands (real results)
- `pnpm install`: done (13.4s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/routes.test.ts`: 9 passed.
- Same invocation for `src/push/{store,service,service.effect,config,crypto}.test.ts`: 39 passed (5 files).
- Same invocation for `src/push/{component,notification,payload,rooms,live-gate}.test.ts`: 21 passed, 1 skipped (live-gate skip pre-exists).
- Same invocation for `src/authz-sweep.test.ts src/app.test.ts`: 14 passed (2 files).
- `pnpm gate` (run 2026-10-08, same final content as committed):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (7.5s)
  PASS  format  (68.0s)
  PASS  lint  (1.4s)
  PASS  typecheck  (1.1s)
  PASS  tests @zilar/server  (1614.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed
- `apps/server/src/push/api.ts` (new)
- `apps/server/src/push/routes.ts` (re-export-only now)
- `apps/server/src/app.ts` (push mount only)
- this task file (Report + status)

No test file was modified; no file outside the Allowed files was touched.

## Review (written by Claude)

Approved (lead, 2026-10-08). Push (7 routes) is served by Effect HttpApi, with the same step order, statuses, texts and 404/503 gating. Endpoints and sealed keys are never logged or returned. createPushRoutes stays as a thin Hono wrapper for the route tests (now EFFECT_GUIDE item 11). Lead check: PushDeviceView matches toPushDeviceView field for field. The worker stalled once and was nudged to commit and gate. Pre-review clean; GATE PASS.
