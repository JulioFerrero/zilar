---
id: T-0525
title: "Effect C (HTTP): pins, roles and audit routes onto the HttpApi adapter (T-0498 recipe), zod to Effect Schema; every route test unchanged"
status: merged
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

### What I did

Moved `pins`, `roles` and `audit` from Hono onto the Effect `HttpApi` adapter,
following the T-0498 recipe in `docs/EFFECT_GUIDE.md` and the worked examples
(`handles/api.ts`, `blocks/api.ts`, `directory/api.ts`, `contact-requests/api.ts`).

- **`pins/api.ts`** — group `pins`, prefix `/api`:
  - `GET /pins`: session → `ListPinsQuery` decode → `{ pins }`.
  - `POST /pins`: session → **write limiter before the payload decode** (an
    endpoint middleware, like the old route) → `CreatePinBody` decode → 201 with
    the pin (`HttpServerResponse.jsonUnsafe(pin, { status: 201 })`).
  - `DELETE /pins/:id`: session → write limiter → the unpinned pin.
  - Errors keep the old 429 `Too many pins, try again later`.
  - Injectable `now` and `writeLimiter` kept; `serviceDeps()` unchanged.
- **`roles/api.ts`** — group `roles`, prefix `/api`, only the five exact
  `/groups/:id/roles...` paths (`groups` still owns the rest):
  - `GET` → `{ roles }`; `POST` → 201 role; `PATCH /:roleId` → renamed role;
    `DELETE /:roleId` → **204 empty body** (`HttpApiSchema.NoContent`);
    `PUT /:roleId/members` → the role.
  - Payloads are strict (`HttpApi.PayloadParseOptions: { onExcessProperty:
    'error' }`), matching zod `.strict()`.
- **`audit/api.ts`** — group `audit`, prefix `/api`:
  - `GET /audit` with a strict query (`groupId`, `aiId`, `limit`,
    `before`). `limit` is `Schema.NumberFromString.check(isInt(),
    isBetween({ minimum: 1, maximum: MAX_AUDIT_LIST_LIMIT }))` — the same
    JS number coercion as `z.coerce.number()`.
  - Fixed texts kept byte-identical: `'Invalid audit query'` on any decode
    failure, `'Provide exactly one of groupId or aiId'`, and `'Invalid cursor'`
    for a service `Error('Invalid cursor')`. An unknown scope still answers an
    empty page, never 404.
- **`app.ts`**: the three `app.route('/api', ...)` lines became
  `createPinsApi` / `createRolesApi` / `createAuditApi` plus
  `mountEffectRoutes(...)`; the three imports swapped to the new `api.ts` files.
- **No zod** is left in the three modules; only the services (`pins/service.ts`,
  `roles/service.ts`, `audit/service.ts`) keep their existing zod, untouched.

### Files changed (8; all in Allowed files)

- `apps/server/src/pins/api.ts` (new)
- `apps/server/src/pins/routes.ts` (deleted)
- `apps/server/src/roles/api.ts` (new)
- `apps/server/src/roles/routes.ts` (deleted)
- `apps/server/src/audit/api.ts` (new)
- `apps/server/src/audit/routes.ts` (kept — see deviation)
- `apps/server/src/app.ts` (imports + three mounts)
- `work/T-0525-effect-http-pins-roles-audit.md` (status + this report)

### Deviation from the spec (one, with the reason)

The spec says "delete the three `routes.ts` files … If a test imports something
from one, keep that export in the new `api.ts` and say so". The unchanged,
listed `apps/server/src/audit/routes.test.ts` does:

```ts
import { createAuditRoutes } from './routes';
auditApp.route('/api', createAuditRoutes({ auth: context.auth, db: context.db }));
```

Deleting `audit/routes.ts` would break that import, and the test cannot pass
unchanged. So I kept `createAuditRoutes` **in `audit/api.ts`** (as the spec
allows) and left `apps/server/src/audit/routes.ts` as a two-line re-export shim.
`createAuditRoutes` builds the Effect mount and registers the module routes
relative to the caller's `/api` mount, so the unchanged test passes. Pins and
roles `routes.ts` are deleted; their tests go through `testApp`/`app.ts`.

Two consequences worth stating:

- `createAuditRoutes` needs a pino `Logger` for the session/error layers, but the
  test passes only `{ auth, db }`. It falls back to a lazily-created silent pino
  logger; production `app.ts` uses `createAuditApi` with the real logger.
- `RolesApiDependencies.logger` is typed as pino `Logger` (not `InviteLogger`)
  because the Effect session/error layers need the full logger. `app.ts` already
  passes the pino logger, and the roles service still receives an
  `InviteLogger`-compatible value.

### Schema messages (spec point 2)

`pins` and `roles` decode failures use the Effect Schema message
(`error.cause.message`); no listed test asserts those strings. Old vs new
(representative, probed with `Schema.decodeUnknownSync`):

- missing key: zod `Required` → Effect `Missing key`
- empty string: zod `String must contain at least 1 character(s)` → Effect
  `Expected a value with a length of at least 1`
- excess key: zod `Unrecognized key: "x"` → Effect's excess-property message

`audit` keeps its fixed texts (above), and the pins 429 text is unchanged.

### Commands and real results

- `pnpm install` → Done in 20s, no changes.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot audit/routes.test.ts`
  → 1 file, 11 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot pins.test.ts roles/roles.test.ts`
  → 2 files, 32 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot authz-sweep app.test`
  → 2 files, 14 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot pins roles audit authz-sweep app.test`
  (the Checks command) → 6 files, 77 tests passed.
- `pnpm gate` (first run) → `FAIL format` (prettier on the 3 new `api.ts`
  files), `scope: every changed file is inside the Allowed files`.
- `pnpm exec prettier --write apps/server/src/audit/api.ts apps/server/src/pins/api.ts apps/server/src/roles/api.ts`
  → 3 files rewritten (formatting only).
- `pnpm gate` (final) →
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (23.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (11.6s)
  PASS  tests @zilar/server  (748.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Security checklist

- Session middleware runs before every decode and handler (401 before body).
- Pins writes stay rate-limited (limiter runs before decode, as before); roles
  writes keep their service-side caps/atomic transactions; no new route is
  unprotected (the sweep passes and prints `/api/pins`, `/api/groups/:id/roles*`
  and `/api/audit` at 401).
- Delete/update scoping, 404 uniform answers and id-only audit entries are in the
  untouched services.
- No request-log change: the Effect router logger stays `disableLogger: true`.

### Open questions

- The task's test list names `apps/server/src/pins/routes.test.ts`, which does
  not exist; the real pins test is `pins.test.ts`. I ran `pins` (both
  `pins.test.ts` and `pins/service.test.ts`) and they pass. No action needed, but
  noting it.
- If you prefer `audit/routes.ts` gone entirely, the only path is changing the
  import in `audit/routes.test.ts` (currently outside Allowed files).

## Review (written by Claude)

Approved (lead, 2026-10-08). pins, roles and audit are served by Effect HttpApi through the adapter. Step order is kept (pins writes check the limiter before decode), the fixed audit texts are byte-identical, 204s have empty bodies, and no zod is left in the modules. audit/routes.ts stays as a re-export because its unchanged test imports it. Pre-review clean, 0 nits.
