---
id: T-0525
title: "Effect C (HTTP): pins, roles and audit routes onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; every route test unchanged"
status: todo
milestone: M5
branch: task/T-0525-effect-http-pins-roles-audit
model: auto
effort: low
depends_on: [T-0514]
estimate: 0.5 day
---

# T-0525: pins, roles and audit on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP".** Worked examples: `apps/server/src/handles/api.ts`, `apps/server/src/blocks/api.ts` and `apps/server/src/directory/api.ts`. This task moves three more small modules. Do not touch any `service.ts`.

### Verified facts (do not re-derive)
- **`apps/server/src/pins/routes.ts`** (83 lines). A `writeLimiter` gives 429 `rate_limited` `'Too many pins, try again later'`.
  - **`GET /pins`:** session, then decode `listQuerySchema` from the query (400 `invalid_request` with zod `issues[0].message ?? 'Invalid request'`), then `{ pins }`.
  - **`POST /pins`:** session, then **the limiter before the decode**, then `createPinBodySchema`, then **201** with the pin.
  - **`DELETE /pins/:id`:** session, limiter, then the unpinned pin.
  
  `app.ts:382`: `createPinsRoutes({ auth, db, config, audit: auditRecorder })`.
- **`apps/server/src/roles/routes.ts`** (118 lines), all under `/groups/:id/roles`:
  - `GET` gives `{ roles }`;
  - `POST` (body decode) gives **201** with the role;
  - `PATCH /:roleId` renames;
  - **`DELETE /:roleId` answers 204 with no body;**
  - `PUT /:roleId/members` sets the members.
  
  Decode errors are 400 `invalid_request` with the zod issue message. `app.ts:379`: `createRolesRoutes({ auth, db, config, adminClient, logger, audit: auditRecorder })`. **The `groups` module still owns the other `/groups/...` routes on Hono, so mount exact routes only.**
- **`apps/server/src/audit/routes.ts`** (66 lines): `GET /audit`, with a strict query of `groupId`, `aiId`, `limit` (coerced int, 1 to `MAX_AUDIT_LIST_LIMIT`) and `before`.
  - Any decode failure gives 400 with the **fixed** text `'Invalid audit query'`.
  - Not exactly one of groupId or aiId gives 400 `'Provide exactly one of groupId or aiId'`.
  - A service `Error('Invalid cursor')` gives 400 `'Invalid cursor'`.
  
  `app.ts:511`: `createAuditRoutes({ auth, db })`.
- **Tests (all unchanged):** `apps/server/src/pins/routes.test.ts`, `apps/server/src/pins/service.test.ts`, `apps/server/src/roles/roles.test.ts`, `apps/server/src/audit/routes.test.ts`, `apps/server/src/audit/service.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **One `api.ts` per module** (`pins/api.ts`, `roles/api.ts`, `audit/api.ts`) following the recipe, with:
   - the same paths, methods, status codes (201, and 204 with an empty body) and bodies;
   - **the same step order per route** (note that pins POST checks the limiter before the decode);
   - injectable limiters and `now` where the routes had them;
   - exact-route mounts.
2. **Effect Schema for the bodies and queries**, with no zod import left:
   - keep every text a test asserts byte-identical, and the fixed audit texts;
   - for generic messages that no test asserts, use Schema's message and list the old and new texts in the Report;
   - the audit `limit` is coerced from a string the same way (`Schema.NumberFromString` plus an int check and range).
3. **`app.ts`:** replace the three `app.route(...)` lines and their imports with `mountEffectRoutes(...)`, and delete the three `routes.ts` files. If a test imports something from one, keep that export in the new `api.ts` and say so.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe and the Schema facts), `apps/server/src/effect/http.ts`, `apps/server/src/handles/api.ts`, `apps/server/src/blocks/api.ts`, and the three `routes.ts` files.

### Allowed files
`apps/server/src/pins/api.ts`, `apps/server/src/pins/routes.ts`, `apps/server/src/roles/api.ts`, `apps/server/src/roles/routes.ts`, `apps/server/src/audit/api.ts`, `apps/server/src/audit/routes.ts`, `apps/server/src/app.ts`, `work/T-0525-effect-http-pins-roles-audit.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot pins roles audit authz-sweep app.test
pnpm gate
```

### Acceptance
- The three modules are served by Effect `HttpApi` through the adapter, with the same answers, and have no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
