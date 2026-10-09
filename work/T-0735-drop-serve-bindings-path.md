---
id: T-0735
title: "cleanup after B1.6: remove the now-dead serve({ fetch })-bindings socket path from effect/edge.ts (ServeBindings, SocketAddressOverride, fetch's second parameter) and its test; fix the stale serve() comments in index.ts, edge.ts, node-serve.ts and the web Dockerfile package list"
status: todo
milestone: M5
branch: task/T-0735-drop-serve-bindings-path
model: auto
effort: low
depends_on: [T-0733, T-0734]
estimate: 0.1 day
---

# T-0735: drop the dead bindings path

## Spec (written by Claude, do not edit)

### Why
Since T-0733, `index.ts` serves the edge's router layer on `NodeHttpServer` through `serveEdgeOnNode` (`apps/server/src/effect/node-serve.ts`). There, `HttpServerRequest.remoteAddress` is the real socket. The `serve({ fetch })`-bindings path added in T-0730 round 1 now has no production caller. **This task removes it and fixes the comments that still describe `serve()`. Behaviour stays the same.**

### Verified facts (do not re-derive)
- **`apps/server/src/effect/edge.ts`:**
  - the bindings machinery: `SocketAddressOverride` (line 45), `ServeBindings` (line 52), `socketAddressOfBindings` (line 60) and their comment block (about lines 36-66);
  - `ZilarEdge.fetch: (request, bindings?: ServeBindings)` (line 91);
  - the dispatch reads `Effect.serviceOption(SocketAddressOverride)` before `request.remoteAddress` (about lines 341-347);
  - `fetch` builds a request context from the bindings (about lines 458-467).
- **`apps/server/src/effect/edge.test.ts:154-190`** ("carries the serve bindings socket address into the module request") is the only test of that path. `apps/server/src/effect/edge-node.test.ts` covers the real socket under Node.
- **Stale comments:**
  - `apps/server/src/index.ts:143,452,479` ("after `serve()`") and `:408-409`;
  - `apps/server/src/effect/node-serve.ts:5`;
  - `apps/server/src/effect/edge.ts:41,49,97-98,341,458-460`;
  - `apps/web/Dockerfile:30-32`, where the package list omits `@zilar/ui-tokens` (added by T-0734).

### What to build
1. **`edge.ts`:**
   - delete `SocketAddressOverride`, `ServeBindings` and `socketAddressOfBindings`;
   - `fetch` becomes `(request: Request) => Promise<Response>`;
   - the dispatch uses `Option.getOrElse(request.remoteAddress, () => 'unknown')`;
   - keep the forged-header stripping exactly as it is;
   - update the comments to say: the socket address is the Node server's `remoteAddress`, or `'unknown'` when there is no socket (web-handler callers such as tests).
2. **`edge.test.ts`:** delete the bindings test. Keep the other tests.
3. **Comments only:** in `index.ts` (say "after the edge server is listening") and in `node-serve.ts`. In `apps/web/Dockerfile`, add `@zilar/ui-tokens` to the package list comment. No code change in these three files.

### Read first
`AGENTS.md`, `apps/server/src/effect/edge.ts`, `apps/server/src/effect/edge.test.ts` (lines 100-200), `apps/server/src/effect/node-serve.ts`, `apps/server/src/index.ts` (lines 135-150, 400-490), `apps/web/Dockerfile`.

### Allowed files
`apps/server/src/effect/edge.ts`, `apps/server/src/effect/edge.test.ts`, `apps/server/src/effect/node-serve.ts`, `apps/server/src/index.ts`, `apps/web/Dockerfile`, `work/T-0735-drop-serve-bindings-path.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect src/app.test src/machines/routes.test
pnpm gate
```

### Acceptance
- `git grep -n "ServeBindings\|SocketAddressOverride\|serve({ fetch })\|after \`serve()\`" -- apps/server/src` prints nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
