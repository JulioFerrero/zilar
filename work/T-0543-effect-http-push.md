---
id: T-0543
title: "Effect C (HTTP): push routes (config, subscriptions, settings, test) onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; same step order, statuses and texts; every push test unchanged"
status: todo
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

## Review (written by Claude)
