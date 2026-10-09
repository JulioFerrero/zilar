---
id: T-0731
title: "B1.8: retire the Hono bridge — delete apps/server/src/effect/http.ts (mountEffectApi, mountEffectRoutes, forwardRequest); the blocks rate-limit wrappers and the effect/http tests use createEdge; machines/routes.test.ts imports SOCKET_ADDRESS_HEADER from http-core"
status: todo
milestone: M5
branch: task/T-0731-retire-hono-bridge
model: auto
effort: low
depends_on: [T-0730]
estimate: 0.15 day
---

# T-0731: retire the Hono bridge (B1.8)

## Spec (written by Claude, do not edit)

### Why
Julio wants Effect HTTP to replace Hono. Since T-0730, `createApp` returns the Effect edge (`apps/server/src/effect/edge.ts`), and `app.ts` no longer imports `effect/http.ts`. The bridge in that file now serves only three test files. This is B1.8 in `docs/audit/effect-edge-flip-plan.md` §4.

### Verified facts (do not re-derive)
- **`apps/server/src/effect/http.ts`** (79 lines) holds:
  - the Hono imports (lines 12-15);
  - `export { SOCKET_ADDRESS_HEADER } from './http-core'` (line 23);
  - `forwardRequest` and `readSocketAddress`;
  - `mountEffectApi` (line 55) and `mountEffectRoutes`.

  Run `git grep -n "effect/http'"` to list its importers; only these remain:
  - `apps/server/src/blocks/blocks.test.ts:21` imports `mountEffectRoutes`, used in two tests (about lines 344-380) that wrap `createBlocksApi({... readLimiter | writeLimiter })` in a Hono wrapper;
  - `apps/server/src/machines/routes.test.ts:7` imports `SOCKET_ADDRESS_HEADER`;
  - `apps/server/src/effect/http.test.ts:13` imports `mountEffectRoutes` and `SOCKET_ADDRESS_HEADER`. Its last test (line 188, "strips a forged socket-address header…") builds a Hono wrapper. `apps/server/src/effect/edge.test.ts:110` already covers the same behaviour on the edge.
- **`createEdge(input)`** (`apps/server/src/effect/edge.ts`) takes `{ mounts, auth: { handler }, config, logger, health: () => Promise<{ status, body }> }` and returns `{ fetch, request, routes, dispose }`. `apps/server/src/app.test.ts` (about line 55) shows a test building one directly.

### What to build
1. **`blocks/blocks.test.ts`:** in the two limiter tests, replace the Hono wrapper with `createEdge({ mounts: [blocksApi], auth: context.auth, config: context.config, logger: context.logger, health: async () => ({ status: 200, body: {} }) })`, and call `.request(...)` with the same paths and headers. Remove the `hono` and `../effect/http` imports. Keep every assertion.
2. **`machines/routes.test.ts`:** import `SOCKET_ADDRESS_HEADER` from `../effect/http-core`.
3. **`effect/http.test.ts`:**
   - delete the "strips a forged socket-address header" test; the edge test covers it;
   - import `SOCKET_ADDRESS_HEADER` from `./http-core` if it is still used;
   - rename the "still rejects a disallowed origin in Hono, before the Effect handler" test to say "at the edge" (its body already uses `testApp`, so it stays);
   - every other test stays unchanged.
4. **Delete `apps/server/src/effect/http.ts`.**
5. **Update stale comments** that name `effect/http.ts` as the Hono bridge in `apps/server/src/effect/http-core.ts`, if any. Leave `edge.ts` alone: a parallel task owns it.

### Read first
`AGENTS.md`, `apps/server/src/effect/http.ts`, `apps/server/src/effect/edge.ts` (lines 1-120 and the `createEdge` signature), `apps/server/src/app.test.ts` (lines 40-80), `apps/server/src/blocks/blocks.test.ts` (lines 1-40, 330-390), `apps/server/src/effect/http.test.ts`.

### Allowed files
`apps/server/src/effect/http.ts`, `apps/server/src/effect/http.test.ts`, `apps/server/src/effect/http-core.ts`, `apps/server/src/blocks/blocks.test.ts`, `apps/server/src/machines/routes.test.ts`, `work/T-0731-retire-hono-bridge.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/blocks src/machines/routes.test src/effect
pnpm gate
```

### Acceptance
- `apps/server/src/effect/http.ts` no longer exists.
- `git grep -n "from 'hono'\|@hono" -- 'apps/server/src/*.ts'` lists only `index.ts`, `errors.ts` and `git/*`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
