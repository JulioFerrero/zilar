---
id: T-0515
title: "Effect C (HTTP): contact-requests routes (6 endpoints + users/by-handle) onto the HttpApi adapter; contact-requests tests unchanged"
status: merged
milestone: M5
branch: task/T-0515-effect-http-contact-requests
model: auto
effort: low
depends_on: [T-0498]
estimate: 0.5 day
---

# T-0515: contact requests on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono. T-0498 (merged) built the adapter. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP".**

T-0514 moves `blocks`, `contacts` and `directory` in parallel. This task moves `contact-requests`; it does not touch `service.ts`.

### Verified facts (do not re-derive)
- **`apps/server/src/handles/api.ts`** (T-0498) is the worked example, including **the strict body plus the legacy zod message shim**: `HttpApi.PayloadParseOptions: { onExcessProperty: 'error' }`, with the schema-error middleware rebuilding the old `issues[0].message`. `apps/server/src/effect/http.ts` holds `Session`, `CurrentUser`, `sessionLayer`, `withErrorEnvelope`, `httpErrorResponse`, `failureResponse` and `mountEffectRoutes`.
- **`apps/server/src/contact-requests/routes.ts`** (176 lines):
  - **the exported constants:** `CONTACT_REQUEST_CREATE_RATE_LIMIT_MAX`/`_WINDOW_MS`, `CONTACT_REQUEST_READ_RATE_LIMIT_MAX`/`_WINDOW_MS` and `BY_HANDLE_RATE_LIMIT_MAX`/`_WINDOW_MS` (lines 25-30). No other file imports them;
  - **`createBodySchema`** is `z.object({ handle: z.string().min(1).max(64) }).strict()` (line 32);
  - **three injectable limiters** (create, read, by-handle).
- **The routes:**
  - **`POST /contact-requests`** (line 96):
    - session, then the create limiter (`HttpError(429, 'rate_limited', 'Too many attempts, try again later')`);
    - the JSON body (an unreadable body becomes `null`), then a strict parse; failure gives `HttpError(400, 'invalid_request', issues[0].message ?? 'Invalid request')`;
    - then `createContactRequest(service(), user.id, handle)`. **It answers 200 `{ request, incoming: true }` when `reverseOf` is set, else 201 `{ request }`.**
  - **`GET /contact-requests`** (123), **`POST /contact-requests/:id/accept`** (133), **`POST /contact-requests/:id/decline`** (144) and **`DELETE /contact-requests/:id`** (155) each check the session, then their limiter, then call the service.
  - **`GET /users/by-handle/:handle`** (167) uses the by-handle limiter.
- **`apps/server/src/app.ts`:** the mount is `app.route('/api', createContactRequestsRoutes({ auth, db, config, adminClient, audit: auditRecorder }))` (around lines 326-329, right after the handles mount).
- **The tests** (all must pass unchanged): `apps/server/src/contact-requests/contact-requests.test.ts`, `apps/server/src/blocks/blocks.test.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/server/src/app.test.ts`.

### What to build
1. **`apps/server/src/contact-requests/api.ts`** following the recipe:
   - the same paths, methods, statuses (**including the 200 versus 201 split on `POST`**) and bodies;
   - the same limiter order;
   - injectable limiters and `now`;
   - the same exported constants;
   - exact-route mounts.
2. **The `POST` body:** strict (an excess key gives 400). The 400 message text must be **byte-identical** to today's zod `issues[0].message` for the cases the tests cover; reuse the handles shim pattern.
3. **`app.ts`:** replace the one mount with `mountEffectRoutes(...)`. Nothing else changes. Delete `routes.ts`.
4. **Tests:** the tests listed above pass **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/handles/api.ts`, `apps/server/src/contact-requests/routes.ts`.

### Allowed files
`apps/server/src/contact-requests/api.ts`, `apps/server/src/contact-requests/routes.ts`, `apps/server/src/app.ts`, `work/T-0515-effect-http-contact-requests.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot contact-requests blocks authz-sweep app.test
pnpm gate
```

### Acceptance
- `contact-requests` is served by Effect `HttpApi` through the adapter, with identical answers.
- The listed tests are unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Moved `contact-requests` onto the Effect `HttpApi` adapter, following `docs/EFFECT_GUIDE.md` ("Moving a server route module onto Effect HTTP") and `apps/server/src/handles/api.ts` as the worked example.

- Added `apps/server/src/contact-requests/api.ts`:
  - group `contactRequests`, `.prefix('/api')`, `.middleware(Session)` then `.middleware(ContactRequestsSchemaErrors)`;
  - the 6 endpoints with the same methods and paths, and six exact routes in `CONTACT_REQUESTS_API_ROUTES`;
  - the same exported rate-limit constants (`CONTACT_REQUEST_CREATE_*`, `CONTACT_REQUEST_READ_*`, `BY_HANDLE_*`) and injectable `now` / `createLimiter` / `readLimiter` / `byHandleLimiter`;
  - the same limiter order: `Session`, then each endpoint's limiter as an endpoint middleware that runs **before** decode (so an invalid create body still spends the create budget), then the service call;
  - `POST /contact-requests` body strict via `HttpApi.PayloadParseOptions: { onExcessProperty: 'error' }`, with the legacy zod schema kept only to rebuild `issues[0].message` (same shim pattern as handles);
  - the 200-vs-201 split answered with raw `HttpServerResponse.jsonUnsafe` (200 `{ request, incoming: true }` when `reverseOf` is set, else 201 `{ request }`); every service `HttpError` goes through `withErrorEnvelope` unchanged.
- `apps/server/src/app.ts`: replaced the one `app.route('/api', createContactRequestsRoutes(...))` mount with `createContactRequestsApi({ ..., logger })` + `mountEffectRoutes(app, ...)`; changed the import to `./contact-requests/api`.
- Deleted `apps/server/src/contact-requests/routes.ts` (`git rm`).
- Tests unchanged.

### Files changed

- `apps/server/src/contact-requests/api.ts` (new)
- `apps/server/src/contact-requests/routes.ts` (deleted)
- `apps/server/src/app.ts` (import + mount only)
- `work/T-0515-effect-http-contact-requests.md` (this report / status)

### Commands and real results

- `pnpm install` — done, 1171 packages, 19s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot contact-requests/contact-requests.test.ts` — **1 file passed, 15 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot blocks authz-sweep app.test` — **3 files passed, 28 tests passed** (includes the 401 sweep, which now sees the 6 exact mounted routes).
- `pnpm gate` (first run) — `FAIL format` on the new `api.ts` only (`scope: every changed file is inside the Allowed files`). Ran `pnpm exec prettier --write apps/server/src/contact-requests/api.ts`, then:
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (29.3s)
  PASS  lint  (1.6s)
  PASS  typecheck  (12.9s)
  PASS  tests @zilar/server  (513.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes / deviations

- No deviation from the spec. `logger` was added to the new API's dependency object (required by `sessionLayer`/`withErrorEnvelope`); `app.ts` already had `logger` in scope, so no other call sites changed.
- The only schema failure path in this module is the create payload; the group's schema-error middleware rebuilds the legacy zod message from the cached body like handles. Path params are `Schema.String`, so they cannot fail decode.

### Blocked / needs a decision

None.

## Review (written by Claude)

Approved (lead, 2026-10-08). contact-requests is served by Effect HttpApi through the adapter: the same seven endpoints, the 200 or 201 split on POST, a strict body with the legacy message, and the same limiter order. app.ts changes only the mount; the tests are unchanged and the gate passed. Pre-review clean.
