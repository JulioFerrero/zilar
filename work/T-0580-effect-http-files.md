---
id: T-0580
title: "Effect C (HTTP): GET /files (member-only upload proxy with Range) onto HttpApi; the upstream body is STREAMED to the client (never buffered); same 501/429/400/404/502 order, texts and passthrough headers; item-11 wrapper for the test mount; zod query to Effect Schema; tests unchanged"
status: todo
milestone: M5
branch: task/T-0580-effect-http-files
model: auto
effort: low
depends_on: [T-0573]
estimate: 1 day
---

# T-0580: the file proxy on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. The recipe is `docs/EFFECT_GUIDE.md` "Moving a server route module onto Effect HTTP", items 1-12. The worked examples:
- `apps/server/src/media/api.ts` (T-0560): the same session → 501 → 429 → query → chat-filter → index-on-demand flow, with the query decoded by hand from the raw search params;
- `apps/server/src/voice/api.ts` (T-0573): raw responses with custom headers;
- `apps/server/src/push/api.ts`: the item-11 wrapper.

**New in this task: a streamed response body.** Files can be large, so the upstream body must flow through and **must never be read into memory**.

### Verified facts (do not re-derive)
- **`apps/server/src/files/routes.ts`** (about 200 lines) has one route, **`GET /files`**. The order:
  1. session;
  2. no archive gives 501 `files_unavailable` "Files are not configured";
  3. the limiter gives 429 "Too many requests, try again later";
  4. the strict query `{ chat: 1..256, url: 1..2048 }`; a failure gives 400 `invalid_request` "Invalid file query";
  5. `toInternalUploadUrl` returning null gives 404 `not_found` "File not found";
  6. `allowedArchives` and `resolveChatFilter`: null gives 404; a blocked DM gives 404;
  7. `findFileRow`; if missing, `indexChat` (a failure only logs a warn with `userId` and the error name) and look again; still missing gives 404;
  8. the upstream fetch with **only** the caller's `Range` header and a 30-second timeout; a throw gives a warn log and 502 `file_unavailable` "The file could not be loaded";
  9. an upstream status of 200, 206 or 416 answers that status with `upstream.body` streamed and `passthroughHeaders(...)`; any other status gives the same 502.
- **`passthroughHeaders`:**
  - `content-type` comes from upstream, else the row mime, else `application/octet-stream`;
  - it copies `content-length`, `content-range`, `accept-ranges`, `etag` and `last-modified` when present;
  - it adds `cache-control: private, max-age=3600` and `x-content-type-options: nosniff`;
  - for `kind === 'file'` it adds `content-disposition: attachment; filename*=UTF-8''<rfc5987>`.
  
  **Keep it and `encodeRfc5987` verbatim.**
- **The streamed answer:** return the upstream web `ReadableStream` without buffering. For example:
  - `HttpServerResponse.raw(upstream.body, { status, headers })`, if the adapter's `toWebHandler` passes a web body through;
  - or `HttpServerResponse.stream(Stream.fromReadableStream(...))` with the same status and headers.
  
  **Prove it does not buffer:** add a short note in the Report, quoting the effect source line you relied on. If neither works without buffering, **stop and report BLOCKED**.
- **The DB lookup `findFileRow` stays drizzle**, moved as is. This task is HTTP only.
- **Deps:** `FilesRoutesDependencies` holds `auth`, `db`, `config`, `logger`, `archive?`, `now?` and `fetchImpl?`. The exports `FILES_RATE_LIMIT_MAX`, `FILES_RATE_LIMIT_WINDOW_MS` and `FILES_FETCH_TIMEOUT_MS` stay.
- **Mounts:**
  - `apps/server/src/app.ts:441-451` uses `app.route('/api', createFilesRoutes(...))`. Change it to `mountEffectRoutes(...)` at the same position;
  - **`apps/server/src/files/routes.test.ts:176` mounts `createFilesRoutes(...)` directly** with `fetchImpl` and `now`, so keep `createFilesRoutes(deps): Hono` as the item-11 wrapper.
- **Tests (all unchanged):** `apps/server/src/files/*.test.ts` (14 tests), the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/files/api.ts`:**
   - the route with the same order, statuses, texts, logs and headers;
   - the query decoded by hand from the raw search params, strict with first value wins, as `media/api.ts` does;
   - the streamed body.
   
   Export `createFilesApi(deps)` and `FILES_API_ROUTES`.
2. **`routes.ts`:** the item-11 wrapper, the deps type and the constants. Remove the zod.
3. **`app.ts`:** mount as described above.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/media/api.ts`, `apps/server/src/voice/api.ts`, `apps/server/src/push/api.ts` (the wrapper), `apps/server/src/files/routes.ts` (all of it), `apps/server/src/files/routes.test.ts` (lines 150-200) and `apps/server/src/app.ts` (lines 436-452).

### Allowed files
`apps/server/src/files/api.ts`, `apps/server/src/files/routes.ts`, `apps/server/src/app.ts`, `work/T-0580-effect-http-files.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot files authz-sweep app.test
pnpm gate
```

### Acceptance
- `GET /api/files` is served by Effect `HttpApi`, with the same answers, headers and order, a streamed body (not buffered, proven in the Report), and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
