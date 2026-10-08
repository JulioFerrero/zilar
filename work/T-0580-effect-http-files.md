---
id: T-0580
title: "Effect C (HTTP): GET /files (member-only upload proxy with Range) onto HttpApi; the upstream body is STREAMED to the client (never buffered); same 501/429/400/404/502 order, texts and passthrough headers; item-11 wrapper for the test mount; zod query to Effect Schema; tests unchanged"
status: merged
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

Done. `GET /api/files` is served by Effect `HttpApi`, with the same order,
statuses, texts, logs and headers, and the upstream body is streamed through
without buffering.

What I did:
- Created `apps/server/src/files/api.ts`: `createFilesApi(deps)` plus
  `FILES_API_ROUTES` (`GET /api/files`). The handler keeps the exact step
  order: session (via `.middleware(Session)` + `CurrentUser`, 401 first),
  501 `files_unavailable` "Files are not configured", 429 `rate_limited`
  "Too many requests, try again later", strict hand-decoded query
  (`Schema.Struct({ chat: 1..256, url: 1..2048 })` over the raw
  `URLSearchParams` view, first value wins, `onExcessProperty: 'error'`;
  failure gives 400 `invalid_request` "Invalid file query"), then the 404
  `not_found` "File not found" resolutions (`toInternalUploadUrl` null,
  `allowedArchives`/`resolveChatFilter` null, blocked DM), the drizzle
  `findFileRow` moved as is (with on-demand `indexChat` and the warn-only
  failure log carrying `userId` and the error name), then the upstream fetch
  with only the caller's `Range` header and a 30s timeout (throw gives a warn
  log and 502 `file_unavailable` "The file could not be loaded"), and finally
  200/206/416 answered with `passthroughHeaders(...)` vs the same 502 for any
  other status. `passthroughHeaders` and `encodeRfc5987` are verbatim copies.
  The deps type `FilesRoutesDependencies` and the constants
  `FILES_RATE_LIMIT_MAX` / `FILES_RATE_LIMIT_WINDOW_MS` /
  `FILES_FETCH_TIMEOUT_MS` live here (no zod anywhere).
- The streamed answer is `HttpServerResponse.raw(upstream.body, { status,
  headers })`. Proof it does not buffer: `raw` wraps the passed value as-is
  as a `Raw` body ("pass through a body value already understood by the
  underlying runtime, such as a Web `Response`, `Blob`, or `ReadableStream`,
  for later platform conversion" —
  `node_modules/.pnpm/effect@4.0.2/node_modules/effect/dist/http/HttpServerResponse.d.ts`,
  `raw` docs), and the web conversion for a `Raw` body that is not a
  `Response` builds the answer directly as `new Response(body.body, ...)`
  (same package, `dist/http/HttpServerResponse.js`, `toWeb`, `case "Raw"`),
  so the upstream web `ReadableStream` flows into the client response
  untouched. `HttpApiBuilder` also returns a handler-returned
  `HttpServerResponse` untouched (`dist/http-api/HttpApiBuilder.js`,
  `if (Response.isHttpServerResponse(response)) { return response; }`).
- Rewrote `apps/server/src/files/routes.ts` as the item-11 wrapper:
  re-exports the deps type, constants, `createFilesApi` and
  `FILES_API_ROUTES`, and keeps `createFilesRoutes(deps): Hono` registering
  each pair from `FILES_API_ROUTES` on a `new Hono()` (path minus `/api`)
  and forwarding `context.req.raw` to `api.handler`.
- `apps/server/src/app.ts`: replaced
  `app.route('/api', createFilesRoutes(...))` with `mountEffectRoutes(app,
  filesApi.routes, filesApi.handler)` at the same position.
- Tests: `apps/server/src/files/*.test.ts` (14 tests), the authz sweep and
  `app.test` all pass unchanged (no test file touched).

Files changed (all inside Allowed files):
- `apps/server/src/files/api.ts` (new)
- `apps/server/src/files/routes.ts` (wrapper + re-exports)
- `apps/server/src/app.ts` (mount)
- `work/T-0580-effect-http-files.md` (this report)

Commands and real results:
- `pnpm install`: done (14.5s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files/routes.test.ts`: first run 8 passed, 6 failed — all 500s on the success path because I had imported `HttpServer` but not `HttpServerResponse` (`ReferenceError: HttpServerResponse is not defined`, found via a temporary repro test that printed the logged defect; repro deleted afterwards). After adding the import: 14 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot files authz-sweep app.test`: 3 files, 28 tests, all passed.
- `pnpm gate` (first run): GATE FAIL on format only (`apps/server/src/files/routes.ts`); fixed with `prettier --write` on my own files. Second run: `PASS install (frozen) (4.3s)`, `PASS format (46.5s)`, `PASS lint (1.0s)`, `PASS typecheck (0.9s)`, `PASS tests @zilar/server (828.7s)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

Deviations: none. The success schema question (guide item 8) does not apply:
the endpoint declares no payload/query/success schema, and the raw
`HttpServerResponse` (status + headers + stream) is returned untouched, so
nothing is stripped.

Security checklist: session check first (401 before any decode); unknown and
invisible chats answer the same 404; only the `Range` header crosses into
ejabberd; logs carry ids and error names only; the limiter (600/min) is
checked before the query decode, as before.

Open questions: none.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (09:34) is newer than HEAD e9e598d6.
- **No test file changed.**
- **Lead check:**
  - the upstream body is passed as is with `HttpServerResponse.raw(upstream.body, ...)` (`api.ts:297`), and nothing reads it with `.text()` or `.arrayBuffer()`;
  - the 30-second fetch timeout is kept;
  - only `Range` is sent to ejabberd, and the response headers go through the same allowlist.
