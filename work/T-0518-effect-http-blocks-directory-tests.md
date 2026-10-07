---
id: T-0518
title: "Effect C (HTTP) follow-up: blocks limiter tests target the Effect mount, legacy createBlocksRoutes deleted; directory 400 and limiter paths get through-app tests"
status: todo
milestone: M5
branch: task/T-0518-effect-http-blocks-directory-tests
model: auto
effort: low
depends_on: [T-0514]
estimate: 0.3 day
---

# T-0518: tests for the blocks and directory Effect paths

## Spec (written by Claude, do not edit)

### Why
T-0514 (merged) moved blocks, contacts and directory onto Effect `HttpApi`, with every test unchanged. Its pre-review found two gaps that need test edits, which that task was not allowed to make:
1. **The two injected-limiter tests in `blocks.test.ts` still mount the legacy Hono `createBlocksRoutes`,** which is no longer what serves traffic. So the Effect read limiter (and the injected write limiter) are untested on the real path.
2. **The directory's Effect query-decode 400 and its limiter exhaustion have no through-app test.**

**This task may change tests**, only as described below.

### Verified facts (do not re-derive)
- **`apps/server/src/blocks/blocks.test.ts`:** around line 297, `it('refuses reads after the injected read limiter is exhausted', …)` builds `createBlocksRoutes({ …, readLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }) })`. Around line 326, `it('refuses writes after the injected limiter is exhausted', …)` does the same for writes.
- **`apps/server/src/blocks/routes.ts`** still holds the legacy Hono factory, and `apps/server/src/blocks/api.ts` re-exports or keeps `createBlocksRoutes` (around lines 239-287). Its header comment (lines 1-4) says "the deleted Hono router", which is stale.
- **`apps/server/src/blocks/api.ts`** exports the Effect mount (`createBlocksApi`, returning `{ handler, routes }`). `apps/server/src/effect/http.ts` has `mountEffectRoutes`. `apps/server/src/handles/handles.test.ts` and `apps/server/src/effect/http.test.ts` show how a test builds a Hono app with an Effect mount.
- **`apps/server/src/directory/api.ts`:** the query-decode 400 transform is around lines 125-136, and the limiter is injectable. **The tests** for directory are in `apps/server/src/groups/visibility.test.ts`; T-0514's Report lists the old and new 400 message texts.

### What to build
1. **Rewrite the two blocks limiter tests** to build the app through the **Effect mount**: `createBlocksApi({ …, readLimiter / writeLimiter injected })`, then `mountEffectRoutes`, or `testApp` with the limiters injected if it supports that. Keep each test's name, scenario and assertions (first call ok, second gives 429 `rate_limited`).
2. **Delete the legacy `createBlocksRoutes`** and `apps/server/src/blocks/routes.ts` once nothing imports them. Fix the stale header comment in `blocks/api.ts`.
3. **Add to `apps/server/src/groups/visibility.test.ts`,** through the full app:
   - `GET /api/directory?kind=bogus` gives 400 with `code: 'invalid_request'` and the message T-0514 chose;
   - an overlong `q` (101 characters) gives 400;
   - the directory limiter exhausted (inject a `max: 1` limiter if the test app allows it; otherwise call it `DIRECTORY_RATE_LIMIT_MAX + 1` times) gives 429.
4. **No other test changes.** Every other test passes unchanged.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/blocks/api.ts`, `apps/server/src/blocks/routes.ts`, `apps/server/src/blocks/blocks.test.ts:280-360`, `apps/server/src/directory/api.ts`, `apps/server/src/groups/visibility.test.ts`, `apps/server/src/effect/http.test.ts`.

### Allowed files
`apps/server/src/blocks/blocks.test.ts`, `apps/server/src/blocks/api.ts`, `apps/server/src/blocks/routes.ts`, `apps/server/src/groups/visibility.test.ts`, `apps/server/src/test-support.ts`, `work/T-0518-effect-http-blocks-directory-tests.md`.

`test-support.ts` may change only to let a test inject limiters, and only if that is needed.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot blocks groups/visibility authz-sweep
pnpm gate
```

### Acceptance
- The blocks limiter tests exercise the Effect mount, and the legacy factory is gone.
- The directory's 400 and 429 paths are tested through the app.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
