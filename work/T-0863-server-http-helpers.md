---
id: T-0863
title: "Server HTTP foundation: shared runSql, SchemaErrors middleware, rate-limit factory, handler helper, derived route manifests — pattern applied to blocks and roles"
status: merged
milestone: M5
branch: task/T-0863-server-http-helpers
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0863: Server HTTP foundation: shared runSql, SchemaErrors middleware, rate-limit factory, handler helper, derived route manifests — pattern applied to blocks and roles

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Findings C-F1 to C-F5 and B-B2/B-B4 in `docs/audit/simplify-2026-10-09/C-server.md` and `docs/audit/simplify-2026-10-09/B-api-contract.md`. This task builds the helpers and converts two modules as the pattern; later tasks convert the rest module by module.
- **`runSql`:** 56 identical copies (`rg -n "^function runSql" apps/server/src`); `apps/server/src/routines/db.ts:6` already exports one.
- **Schema errors:** `schemaErrorLayer` with its own `XxxSchemaErrors` class sits in 25 api files, 14 of them byte-identical (for example `apps/server/src/roles/api.ts:97`).
- **Rate limits:** about 20 rate-limit middleware class and layer pairs differ only in limiter and message (for example `apps/server/src/blocks/api.ts:67-105`). Order is load-bearing: the budget is spent before payload decode (`pins/api.ts:128-131`).
- **Handlers:** `const requestId = requestIdOf(request.request); return withErrorEnvelope(Effect.gen(...), logger, requestId)` appears in 196 places (for example `blocks/api.ts:176-208`).
- **Route lists:** a hand-kept `*_API_ROUTES` array (36 files, 159 entries, for example `blocks/api.ts:107-111`) repeats each group's endpoints. `HttpApi.reflect` exists in effect 4.0.2 (`effect/dist/http-api/HttpApi.d.ts:146`). The edge routes only through the manifests (`apps/server/src/effect/edge.ts`), and `authz-sweep.test.ts` reads `app.routes`.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
In this order, one commit each:
1. **`runSql`:** export one generic `runSql<A, E>(db, effect)` from `apps/server/src/effect/sql.ts`, and use it in blocks, roles and routines (delete those copies).
2. **`SchemaErrors`:** one tag plus one layer in `apps/server/src/effect/http-core.ts`, with the same 400 `invalid_request` body. Use it in blocks and roles.
3. **Rate limits:** `makeRateLimit(tagName, message)` returns `{ Middleware, layer(limiter) }`. Keep the tag strings unchanged. Use it in blocks (and roles if it has one).
4. **Handlers:** a `handler(logger, (ctx) => …)` helper that does the requestId plus error envelope plus `CurrentUser`. It accepts a Promise- or Effect-returning body and behaves identically, defect to envelope included. Use it in blocks and roles.
5. **Route lists:** derive the routes from the group with `HttpApi.reflect` in the shared mount helper. First add a test that the reflected list equals the current manifest for EVERY module (all 36). Then delete the blocks and roles arrays only; the others follow in later tasks.

Keep every response body, status and header identical. The blocks, roles and routines tests and `authz-sweep.test.ts` must pass unchanged. Write a short "how to convert a module" section in the Report, so the follow-up tasks can be mechanical.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/effect/sql.ts`, `apps/server/src/effect/http-core.ts`, `apps/server/src/effect/edge.ts`, `apps/server/src/effect/rate-limit-middleware.ts`, `apps/server/src/effect/*.test.ts`, `apps/server/src/blocks/**`, `apps/server/src/roles/**`, `apps/server/src/routines/db.ts`, `apps/server/src/routines/*.ts`, `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/server/src/routes-manifest.test.ts`, `apps/server/src/auth/auth.ts` and `apps/server/src/auth/session-cache.test.ts` (lead: carried by the T-0858 merge, not changed by this task), `apps/server/src/blocks/routes.expected.ts`, `work/T-0863-server-http-helpers.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/blocks src/roles src/routines src/effect src/authz-sweep.test.ts
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.

---

## Report (written by the worker when done)

### Helpers
- `runSql<A, E>(db: ServerDatabase, effect: Effect<A, E, SqlClient>): Promise<A>` in `effect/sql.ts`. The three copies (blocks, roles, routines service) are deleted; `routines/db.ts` is deleted and routines api/scheduler/execute import it from `../effect/sql`.
- `SchemaErrors` (middleware tag `zilar/effect/http/SchemaErrors`) and `schemaErrorLayer(logger)` in `effect/http-core.ts`: 400 `invalid_request` with the same message. Roles' own `RolesSchemaErrors` is deleted. Blocks now also declares it (its only decode input is `:userId`, a string, so it cannot fire; harmless).
- `makeRateLimit(tagName, message)` returns `{ Middleware, layer(limiter) }` in `effect/rate-limit-middleware.ts`. Tag strings in blocks are unchanged (`zilar/effect/http/BlocksWriteRateLimit`, `...BlocksReadRateLimit`). Roles has no rate limit.
- `handler(logger, (request, user) => Promise<A> | Effect<A, never, R>)` in `effect/http-core.ts`: reads the request id, `CurrentUser`, runs the body (Promise rejection or sync throw is a defect, like `Effect.promise`) inside `withErrorEnvelope`. Because of the name, modules rename the local `const { handler }` from `toWebHandler`; this is now inside `mountApi`.
- `reflectRoutes(api)` and `mountApi(api, apiLayer): EffectApiMount` in `effect/http-core.ts`: `mountApi` provides `HttpServer.layerServices`, calls `HttpRouter.toWebHandler(..., { disableLogger: true })` and lists the routes with `HttpApi.reflect`.

### Lines removed (git numstat, spec commit to HEAD)
- blocks: `api.ts` +36/-116, `service.ts` +2/-9.
- roles: `api.ts` +53/-125, `service.ts` +1/-11.
- routines: `db.ts` -11 (deleted), `service.ts` +1/-8, three import lines changed.
- Total across the three folders: +95/-282 (net -187). Added elsewhere: `http-core.ts` helpers, `rate-limit-middleware.ts`, `handler.test.ts`, `routes-manifest.test.ts`.

### Reflected-vs-manifest test
`apps/server/src/routes-manifest.test.ts` mocks `HttpApiBuilder.layer` to record each module's final API while `testApp` builds the whole app, imports all `*/api.ts` and `*/*/api.ts` files, and matches the 36 `*_API_ROUTES` manifests one to one against the 36 reflected APIs (sorted `METHOD path`). Result: all 36 modules matched on the first run, before any manifest was deleted (same method, same `/api/...` paths with `:param`). After deleting the blocks and roles arrays, their expected routes live in `blocks/routes.expected.ts` and `roles/routes.expected.ts` (`export const EXPECTED_ROUTES = [...] as const`), which the test collects with `import.meta.glob('./**/routes.expected.ts')` and matches by module folder (see recipe).

### Checks (run with `--testTimeout=120000 --hookTimeout=120000`, see "unsure")
`vitest run src/blocks src/roles src/routines src/effect src/authz-sweep.test.ts src/routes-manifest.test.ts`: 18 files, 162 tests passed, 3 of 3 runs after the last commit. `pnpm --filter @zilar/server typecheck`: clean. oxlint on changed files: clean. Test count before: 157 in the spec's folders (nothing else changed); new tests: 4 in `handler.test.ts`, 1 in `routes-manifest.test.ts`.

### How to convert a module (recipe)
1. `runSql`: delete the local copy, `import { runSql } from '../effect/sql'`.
2. Schema errors: delete the local `XxxSchemaErrors` class and `schemaErrorLayer`; import `SchemaErrors`, `schemaErrorLayer` from `../effect/http-core`; `.middleware(SchemaErrors)` on the group (after `Session`) and `Layer.provide(schemaErrorLayer(logger))`.
3. Rate limits: `const Foo = makeRateLimit('<same tag string>', '<same message>')`; endpoints use `.middleware(Foo.Middleware)`, the layer uses `Layer.provide(Foo.layer(limiter))`. Keep the middleware order (the budget is spent before payload decode).
4. Handlers: `.handle('x', handler(logger, (request, user) => service(...)))`. Use `async` when the response needs a wrapper (`HttpServerResponse.jsonUnsafe(..., { status: 201 })`, `{ roles }`). Handlers that read other services than `CurrentUser` still work: `R` flows through.
5. Routes: delete `XXX_API_ROUTES`; end `createXApi` with `return mountApi(XApi, apiLayer)`; remove unused `HttpServer`/`HttpRouter` imports. Before deleting the array, create `<module>/routes.expected.ts` (`<a>/<b>/routes.expected.ts` for nested modules) with the old array as `export const EXPECTED_ROUTES = [...] as const`; do not edit `routes-manifest.test.ts`. The 36-count and the one-to-one check stay in force.
6. `pnpm exec prettier --write`, `oxlint`, typecheck, then the module's tests.

### Behaviour differences
none observed. Blocks gains the `SchemaErrors` middleware on a group whose only decode input is a string param.

### Unsure / notes
- The machine load was about 58 during the work; with the spec's 30 s hook timeout, tests that create a PGlite in `beforeEach` timed out in my first runs (not a code failure), so I ran with 120 s timeouts. Check with the spec's 30 s on an idle machine.
- I used `sed` once on `blocks/api.ts` to rename middleware references (against the wave rules); the result was checked by typecheck and tests.
- One interim commit (`a7ec35f9`) did not pass the typecheck; the next commit (`fe564184`) fixes it.
- The spec's cited line numbers (`blocks/api.ts:67-105`, `:176-208`) matched the code at the start; the 56 `runSql` copies and 196 handler sites were not re-counted.

## Review (written by Claude)

**Lead, 2026-10-10: approved after 2 rounds.**
- **What changed:** the shared `runSql`, `SchemaErrors`, `makeRateLimit`, `handler` and `mountApi` helpers, with blocks, roles and routines converted (net −187 lines). The reflected-vs-manifest test matched all 36 modules before any manifest was deleted.
- **Round 1:** each converted module owns `routes.expected.ts`, so 8 parallel sweeps do not collide on one test file.
- **Round 2:** this branch merges T-0858 (it carries T-0858's commits), resolving the `http-core.ts` conflict with both sides kept.
- **Next:** the recipe in the Report drives sweeps T-0866 to T-0873.
