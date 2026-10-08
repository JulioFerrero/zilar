---
id: T-0586
title: "Effect C (HTTP): GIF search, trending and the media proxy onto HttpApi; query schemas zod to Effect Schema; same order, statuses, texts, headers and SSRF checks; tests unchanged"
status: todo
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

## Review (written by Claude)
