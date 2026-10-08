---
id: T-0586
title: "Effect C (HTTP): GIF search, trending and the media proxy onto HttpApi; query schemas zod to Effect Schema; same order, statuses, texts, headers and SSRF checks; tests unchanged"
status: merged
milestone: M5
branch: task/T-0586-effect-http-gifs
model: auto
effort: low
depends_on: [T-0580]
estimate: 0.5 day
---

# T-0586: GIFs on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. The recipe is `docs/EFFECT_GUIDE.md` "Moving a server route module onto Effect HTTP", items 1-13. The worked examples are `apps/server/src/media/api.ts` (a query decoded by hand) and `apps/server/src/voice/api.ts` (a binary answer).

### Verified facts (do not re-derive; read each route for its exact order)
- **`apps/server/src/gifs/routes.ts`** (340 lines) has three routes. Each runs: session (401), then the provider check (**501** `gifs_unavailable` "GIF search is not configured"), then the limiter (**429** `rate_limited` "Too many GIF requests, try again later"). Then:
  1. **`GET /gifs/search`** (204):
     - decode the query with `searchQuerySchema` (41-46: strict; `q` 1 to 100 characters, `pos?` ≤ 128); failure gives 400 `invalid_request` **"Invalid GIF search"**;
     - call the provider; a non-`HttpError` failure gives 502 `gif_search_failed`;
     - log counts and duration only, **never `q`**;
     - answer with `searchBody(...)`. `nextPos` is present only when defined, and items with no media URL are dropped.
  2. **`GET /gifs/trending`** (243): the same, with `trendingQuerySchema` (48-52: strict, `pos?`) and the 400 text **"Invalid GIF request"**.
  3. **`GET /gifs/media/:token`** (279):
     - decode the token (a bad escape gives 404);
     - `issuer.verify(token, user.id)`;
     - the URL must be `https:`, with no user or password, and its host must be in `GIPHY_MEDIA_HOSTS`;
     - `resolvePublicAddress`;
     - fetch;
     - a non-2xx status, a type not in `GIF_MEDIA_TYPES`, or a throw gives 502 `gif_media_failed`;
     - every failure before the fetch is the same **404 `not_found` "GIF media not found"**;
     - success is a 200 with the bytes (`Uint8Array`, already capped by `fetchProxiedMedia`) and exactly the headers `content-type`, `content-length`, `x-content-type-options: nosniff` and `cache-control: private, max-age=86400`.
- **Strict queries:** an unknown query key must still give 400. Decode the first value of each key into a plain object, then use an Effect Schema with `onExcessProperty: 'error'`, as `media/api.ts` does.
- **`app.ts`:** `apps/server/src/app.ts:520-532` mounts `createGifsRoutes({ auth, config, logger, provider?, mediaFetcher?, now? })`. Replace it with `mountEffectRoutes(...)` at the same position. `GifsRoutesDependencies` and its `MediaFetch` stay.
- **Tests:** `apps/server/src/gifs/routes.test.ts` builds through `createApp`, so no wrapper is needed **if no test mounts the factory**. Check with grep; if one does, keep the item-11 wrapper.

  These tests stay unchanged:
  - `apps/server/src/gifs/*.test.ts`;
  - the authz sweep (`authz-sweep`);
  - `app.test`.

### What to build
1. **Create `apps/server/src/gifs/api.ts`** with the three routes:
   - the same order, statuses, texts, log fields and headers;
   - the search and trending success schemas list every field `shape` and `searchBody` produce (item 8; the optional fields stay optional);
   - the media route answers with `HttpServerResponse.uint8Array` (guide item 12) and the same 4 headers.
   
   Export `createGifsApi(deps)` and `GIFS_API_ROUTES`.
2. **`routes.ts`:**
   - keep `GifsRoutesDependencies`, `MediaFetch` and the exported helpers that other files import (check with grep);
   - remove the Hono factory, unless a test mounts it (then keep the item-11 wrapper);
   - remove zod.
3. **`app.ts`:** mount as described above.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/media/api.ts`, `apps/server/src/voice/api.ts`, `apps/server/src/gifs/routes.ts` (all of it), `apps/server/src/gifs/routes.test.ts` (lines 1-60) and `apps/server/src/app.ts` (lines 515-535).

### Allowed files
`apps/server/src/gifs/api.ts`, `apps/server/src/gifs/routes.ts`, `apps/server/src/app.ts`, `work/T-0586-effect-http-gifs.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot gifs authz-sweep app.test
pnpm gate
```

### Acceptance
- The three GIF routes are served by Effect `HttpApi`, with the same answers, headers and SSRF checks. There is no zod in `gifs/`.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Done. The three GIF routes are served by Effect `HttpApi`, tests unchanged and green.

What I did:
- Created `apps/server/src/gifs/api.ts` with `createGifsApi(deps)` and `GIFS_API_ROUTES`:
  - Same step order per route: session (401 via `Session` middleware) -> 501 `gifs_unavailable` -> limiter (429 `rate_limited`) -> decode -> provider/fetch -> answer.
  - Queries decoded manually in-handler from the raw `URLSearchParams` view (first value wins, like Hono's `c.req.query()`) with Effect Schemas under `{ onExcessProperty: 'error' }`, so unknown keys still 400. Fixed texts kept: "Invalid GIF search" (search), "Invalid GIF request" (trending).
  - Search/trending success schemas (`GifResultPage`) list every field `shape`/`searchBody` produce: `id`, `title`, `mediaToken`, `kind` (`image`|`video`), `width`, `height`, optional `sizeBytes`, optional `nextPos`. Items with no media URL are dropped before encoding.
  - Media route answers `HttpServerResponse.uint8Array` with exactly `content-type`, `content-length`, `x-content-type-options: nosniff`, `cache-control: private, max-age=86400`. All pre-fetch failures are the same 404 `not_found` "GIF media not found"; non-2xx, wrong type or throw is 502 `gif_media_failed`. SSRF checks kept: `https:` only, no user/password, host in `GIPHY_MEDIA_HOSTS`, `resolvePublicAddress` (rejects non-public), pinned fetch via shared `fetchProxiedMedia`.
  - One deviation from the plain recipe: `HttpRouter.toWebHandler(..., { routerConfig: { maxParamLength: 4096 } })`. The Effect internal router (find-my-way) caps a path segment at 100 chars by default and 404s with an empty body above it; GIF media tokens are ~192 chars (base64url payload + signature). Verified by bisecting segment length (100 matched, 160 did not) and finding `maxParamLength: 100` in the router source. Token validation still runs inside the handler.
- Rewrote `apps/server/src/gifs/routes.ts`: keeps `GifsRoutesDependencies`, `MediaFetch` (now an exported interface, same signature), `fetchProxiedMedia`, and all `GIF_*` constants. Hono factory and zod removed. No test mounted the factory (grep: only `createApp` and `fetchProxiedMedia` imports), so no item-11 wrapper.
- `apps/server/src/app.ts`: `createGifsRoutes` -> `createGifsApi` + `mountEffectRoutes` at the same position (lines 518-531).
- Service return vs schema, side by side: old `shape` returned `{ id, title, mediaToken, kind, width, height, sizeBytes? }` and `searchBody` returned `{ items, nextPos? }` — the new `GifResultItem`/`GifResultPage` list exactly those fields, all required unless marked optional (`sizeBytes`, `nextPos`).
- Message texts: old and new are identical (no generic Schema text surfaces: every decode failure maps to the fixed 400 texts; the `GifsSchemaErrors` layer only guards future endpoints).
- Security checklist: no secrets in logs (search logs counts/duration only, never `q`; request log still redacts `/api/gifs/media/:token`); token verify keeps unknown vs other-user at the same 404; limiter order unchanged (invalid queries still spend budget); all three routes covered by the authz sweep (exact routes mounted, sweep green).

Files changed: `apps/server/src/gifs/api.ts` (new), `apps/server/src/gifs/routes.ts`, `apps/server/src/app.ts`, `work/T-0586-effect-http-gifs.md`.

Commands and real results:
- `pnpm install`: ok (20.3s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot gifs`: 3 files, 27 tests passed (after the maxParamLength fix; before it, 4 media tests failed with 404 on real-length tokens).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot authz-sweep app.test`: 2 files, 14 tests passed.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, tests @zilar/server all PASS; scope: every changed file inside Allowed files.
- Single tests run while working: `gifs`, `authz-sweep app.test` as above (plus temporary debug tests, removed afterwards).

Problems: the find-my-way 100-char segment cap (above); fixed with `routerConfig.maxParamLength: 4096`, which future long-token routes should copy.

Blocked / needs a decision: none.

## Round (fix round, 2026-10-08)

Findings fixed:
- Finding 1 (should-fix, bad token escape returns empty-body 404): confirmed with a scratch test — `GET /api/gifs/media/%ZZ` returned 404 with an empty body, because the Effect router's `safeDecodeURI` rejects the malformed escape before any handler runs. Fixed in `apps/server/src/gifs/api.ts` by wrapping the `HttpRouter.toWebHandler` handler: a 404 whose path is under `/api/gifs/media/` with a non-empty token segment is re-rendered as the same `not_found` "GIF media not found" JSON envelope (with the forwarded `x-request-id`) via `HttpServerResponse.toWeb`. Verified with the scratch test: 404 `application/json` `{"error":{"code":"not_found","message":"GIF media not found","requestId":"..."}}`. No test files changed (scratch test removed after verification).

Disagreements:
- Finding 2 (nit, sync-throwing provider gives 500 not 502): left as is. `Effect.promise` lifts only the rejection; a synchronously-throwing provider violates the `Promise`-returning port contract, and a 500 for a bug is the correct branch. No code line touched for this.

Tests added: none (finding 1 verified with a temporary scratch test, removed; spec requires listed tests unchanged).

Commands and real results:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot gifs authz-sweep app.test`: 5 files, 41 passed, 0 failed.
- `pnpm gate`: **GATE PASS** — install, format, lint, typecheck, tests @zilar/server all PASS; scope: every changed file inside Allowed files.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean after 1 auto round. The packet (11:41) is newer than HEAD 9d924412.
- **No test file changed.**
- **Lead check:** the three GIF routes keep the same order, texts, SSRF checks and the 4 media headers, and there is no zod left in `gifs/`.
