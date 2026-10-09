---
id: T-0696
title: "B1.2: add @effect/platform-node 4.0.2 to apps/server and a smoke test that NodeHttpServer serves one HttpRouter route on a random port (no app change)"
status: todo
milestone: M5
branch: task/T-0696-platform-node-smoke
model: auto
effort: low
depends_on: [T-0689]
estimate: 0.1 day
---

# T-0696: @effect/platform-node and a smoke test (B1.2)

## Spec (written by Claude, do not edit)

### Why
Julio wants Effect HTTP to replace Hono. To start the server without `@hono/node-server`, B1.6 in `docs/audit/effect-edge-flip-plan.md` needs `NodeHttpServer`, which comes from `@effect/platform-node`. The lead decided (plan §5, D1) to add `@effect/platform-node@4.0.2`. This task adds it and proves it works with our `effect` version. **The app does not use it yet.**

### Verified facts (do not re-derive)
- **`apps/server/package.json`:** `dependencies` start at line 14, with `@effect/sql-pg` and `@effect/sql-pglite` pinned at `4.0.2` (:15-16) and `effect` at `^4.0.2` (:25).
- **`npm view @effect/platform-node@4.0.2`:**
  - peer `effect ^4.0.2`;
  - deps `undici ^8.11.2` and `@effect/platform-node-shared ^4.0.2`;
  - exports `"./*": "./dist/*.js"`, so modules import as `@effect/platform-node/NodeHttpServer`. Check the real module names in `node_modules/@effect/platform-node/dist/` after the install.
- **`HttpRouter`** and the other HTTP modules come from `effect/http` (see `apps/server/src/effect/http.ts:14`).

### What to build
1. **Add the dependency** with `pnpm --filter @zilar/server add @effect/platform-node@4.0.2`. Pin it exactly, as the sql packages are. Commit `package.json` and `pnpm-lock.yaml`.
2. **Add `apps/server/src/effect/node-server.test.ts`:**
   - build a tiny `HttpRouter` with one `GET /ping` that answers JSON `{ ok: true }`;
   - serve it with `NodeHttpServer.layer(() => createServer(), { port: 0 })` (or the 4.0.2 equivalent you find in the `.d.ts`);
   - read the bound port from the `HttpServer` service (`address`);
   - `fetch` `/ping`, and assert 200 and the body;
   - also assert that a request's `remoteAddress` is set (log it in the handler and return it in the body), because B1.5 relies on it;
   - shut the server down when the test ends (a scoped layer, `Effect.scoped`, or `ManagedRuntime.dispose`).

   Keep it under about 60 lines, and cite the `.d.ts` lines you used in the Report.
3. **No other file changes.**

### Read first
`AGENTS.md`, `docs/audit/effect-edge-flip-plan.md` (§2, §4 B1.2), `apps/server/src/effect/http.ts` (lines 1-50), and, once the install is done, the NodeHttpServer type definitions in the installed package's dist folder.

### Allowed files
`apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/src/effect/node-server.test.ts`, `work/T-0696-platform-node-smoke.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/node-server.test
pnpm gate
```

### Acceptance
- The dependency is pinned at `4.0.2`, and the lockfile is updated.
- The smoke test passes and leaves no open handle (vitest exits on its own).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
