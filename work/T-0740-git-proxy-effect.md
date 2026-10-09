---
id: T-0740
title: "A12: git proxy off Hono — proxy.ts exposes a plain Web handler, new git/api.ts wraps it as an Effect HttpRouter mount (createGitApi → EffectApiMount), git/routes.ts deleted, proxy.test.ts drives the mount; still not mounted in app.ts"
status: merged
milestone: M5
branch: task/T-0740-git-proxy-effect
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0740: the git proxy on Effect (A12)

## Spec (written by Claude, do not edit)

### Why
Julio chose "convert to Effect" for `git/*` on 2026-10-09. The git proxy is the last code that imports Hono (`docs/audit/effect-last-mile.md`, task A12), and B1.9 ("delete Hono") waits for it. **Behaviour is unchanged, and the proxy stays unmounted:** `app.ts` does not change.

### Verified facts (do not re-derive)
- **`apps/server/src/git/routes.ts`** (8 lines) is `createGitRoutes(deps)`: `new Hono()` plus `routes.all('*', createGitProxyHandler(deps))`. Nothing outside `git/` imports it (`git grep "git/routes"` prints nothing).
- **`apps/server/src/git/proxy.ts`:**
  - line 1 imports `type { Context, Handler } from 'hono'`;
  - `createGitProxyHandler(deps): Handler` (line 135) reads `c.req.url`, `c.req.method`, `c.req.raw.arrayBuffer()`, `c.req.raw.body` and `c.req.raw.headers`;
  - it throws `HttpError(403, 'push_rejected', …)` for refused pushes and returns the upstream `fetch` `Response` (lines 141-177);
  - everything above line 135 is free of Hono.
- **`apps/server/src/git/proxy.test.ts`:** builds a Hono app with an `onError` that maps `HttpError` (lines 28-40) and calls `app.request(...)` (lines 76-187).
- **The module pattern:** `apps/server/src/pins/api.ts:197-300` has `createPinsApi(deps): EffectApiMount`, with `HttpRouter.toWebHandler(..., { disableLogger: true })` at lines 274-277. `EffectApiMount` is `{ handler: (request: Request) => Promise<Response>, routes }` (`apps/server/src/effect/http-core.ts:151-154`).
- **The envelope:** `failureResponse` and `httpErrorResponse` (`apps/server/src/effect/http-core.ts:92-129`) render an `HttpError` as the shared error envelope; `requestIdOf(request)` is at line 76.
- **The edge matcher** (`apps/server/src/effect/edge.ts:95-104`) only matches routes with the same segment count and `:param` segments. It has no wildcard, so a catch-all `/git/*` cannot be mounted on the edge today. Mounting is out of scope.
- **Web conversion helpers:** `HttpServerRequest.toWeb` (`node_modules/effect/dist/http/HttpServerRequest.d.ts:315`) and `HttpServerResponse.fromWeb` (`HttpServerResponse.d.ts:949`).

### What to build
1. **`git/proxy.ts`:** replace `createGitProxyHandler(deps): Handler` with `createGitProxy(deps): (request: Request) => Promise<Response>`, a plain Web handler. Read `request.url`, `request.method`, `request.arrayBuffer()`, `request.body` and `request.headers`. Keep every check, header strip, error and forward exactly as it is, and still throw `HttpError` on a refused push. Remove the Hono import.
2. **New `git/api.ts`:** `createGitApi(deps: GitProxyDependencies & { logger: Logger }): EffectApiMount`. It is an Effect `HttpRouter` with one catch-all route for every method under the path prefix (default `/git/*`). The route does three things:
   - converts the `HttpServerRequest` to a Web `Request` with `HttpServerRequest.toWeb`;
   - awaits `createGitProxy(deps)` and returns `HttpServerResponse.fromWeb(response)`;
   - renders a thrown `HttpError` or a defect through `failureResponse(logger, requestIdOf(request), error)`.

   Build the handler with `HttpRouter.toWebHandler(..., { disableLogger: true })`, as `pins/api.ts` does. Set `routes: []`, with a comment saying the edge has no wildcard routes (`edge.ts:95-104`), so this mount is not wired into `app.ts`.
3. **Delete `git/routes.ts`.**
4. **`git/proxy.test.ts`:** drop Hono and drive `createGitApi(...).handler(new Request(...))` with the same cases and assertions. Refused pushes must still return 403 with code `push_rejected` in the envelope. Keep the fake `fetch` and the token client.
5. **Check:** `git grep -n "from 'hono'" -- apps/server/src` must print nothing.

### Read first
`AGENTS.md`, `apps/server/src/git/proxy.ts`, `apps/server/src/git/routes.ts`, `apps/server/src/git/proxy.test.ts`, `apps/server/src/pins/api.ts` (lines 1-20 and 255-300), `apps/server/src/effect/http-core.ts` (lines 70-155), `docs/EFFECT_GUIDE.md` (sections "The Promise boundary rule" and "Typed errors and the fixed HTTP mapping").

### Allowed files
`apps/server/src/git/proxy.ts`, `apps/server/src/git/api.ts`, `apps/server/src/git/routes.ts`, `apps/server/src/git/proxy.test.ts`, `work/T-0740-git-proxy-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/git
pnpm gate
```

### Acceptance
- `git grep -n "from 'hono'" -- apps/server/src` prints nothing.
- Every `git/` test passes, with the same number of cases as before. Record the count before you change anything.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What changed**
- `apps/server/src/git/proxy.ts`: the Hono import is gone. `createGitProxyHandler(deps): Handler` is now `createGitProxy(deps): GitProxy`, where `export type GitProxy = (request: Request) => Promise<Response>`. It reads `request.url`, `request.method`, `request.arrayBuffer()`, `request.body` and `request.headers`. Checks, header stripping, the `push_rejected` 403s and the upstream forward are unchanged.
- `apps/server/src/git/api.ts` (new): `createGitApi(deps: GitProxyDependencies & { logger: Logger }): EffectApiMount`. It is one `HttpRouter.add('*', '/git/*', …)` catch-all. The handler runs `HttpServerRequest.toWeb` (`Effect.orDie`), then `createGitProxy`, then `HttpServerResponse.fromWeb`, all inside `withErrorEnvelope(…, logger, requestIdOf(request))`. It is built with `HttpRouter.toWebHandler(…, { disableLogger: true })`. `routes: []`, with a comment pointing at `effect/edge.ts:95-104`.
- `apps/server/src/git/routes.ts`: deleted (`git rm`).
- `apps/server/src/git/proxy.test.ts`: no Hono. It builds `createGitApi({ …, logger: pino({ level: 'silent' }) })` and sends `api.handler(new Request(url, init))`. The 8 cases and their assertions are unchanged; fake `fetch` and token client are kept.
- One addition beyond the spec: `gitRoutePath` throws if the prefix does not start with `/`, using a small `isRoutePath` type guard, because `HttpRouter` path types require a leading `/`.

**Commands and results**
- Before the change, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/git`: 3 files, 22 tests passed.
- After the change, the same command: 3 files, 22 tests passed. Same count.
- `git grep -n "from 'hono'" -- apps/server/src`: no output, exit 1 (no match).
- `pnpm exec prettier --write` on the 3 changed files: all unchanged.
- `pnpm gate` (run from the worktree root, branch `task/T-0740-git-proxy-effect`):
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Problems and deviations**
- None found. `app.ts` is not touched and the git proxy is still not mounted.
- The 403 envelope now comes from `failureResponse`, so it also carries `requestId` (empty in these tests). The old Hono test handler rendered only `code` and `message`. The tests assert `code` only.

**Open questions**
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Julio chose "convert". Worker: Haiku 5.5, in one round (about 2.5 min). The lead reviewed the diff directly.
- **`proxy.ts`:** now a plain Web handler, with the same checks, header strip, errors and forward.
- **`git/api.ts`:** an Effect `HttpRouter` catch-all through `withErrorEnvelope`, with `routes: []` because the proxy is not mounted.
- **`git/routes.ts`:** deleted. `git grep "from 'hono'"` in `apps/server/src` prints nothing.
- **Tests:** 22 before and 22 after, and the gate passed.
- **Unrequested but harmless:** a guard that the path prefix starts with `/`.
- **Next:** B1.9 (drop the `hono` dependency) is unblocked.
