---
id: T-0863
title: "Server HTTP foundation: shared runSql, SchemaErrors middleware, rate-limit factory, handler helper, derived route manifests — pattern applied to blocks and roles"
status: todo
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
`apps/server/src/effect/sql.ts`, `apps/server/src/effect/http-core.ts`, `apps/server/src/effect/edge.ts`, `apps/server/src/effect/rate-limit-middleware.ts`, `apps/server/src/effect/*.test.ts`, `apps/server/src/blocks/**`, `apps/server/src/roles/**`, `apps/server/src/routines/db.ts`, `apps/server/src/routines/*.ts`, `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/server/src/routes-manifest.test.ts`, `work/T-0863-server-http-helpers.md`.

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

## Review (written by Claude)
