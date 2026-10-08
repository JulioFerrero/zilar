---
id: T-0577
title: "Effect C (HTTP): background images (POST upload under a streaming cap, GET list, GET raw bytes, DELETE) onto HttpApi using guide item 12; same 429/413/404 order, texts, 201/204 and image headers; tests unchanged"
status: todo
milestone: M5
branch: task/T-0577-effect-http-backgrounds
model: auto
effort: low
depends_on: [T-0573]
estimate: 0.5 day
---

# T-0577: background images on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono. **Follow `docs/EFFECT_GUIDE.md` "Moving a server route module onto Effect HTTP", items 1-12.** Item 12 covers binary bodies, and the worked example is `apps/server/src/voice/api.ts`, which reads under a cap with `Stream.runForEachWhile` and answers with `HttpServerResponse.uint8Array`.

### Verified facts (do not re-derive; read each route for its exact texts)
- **`apps/server/src/backgrounds/routes.ts`** (154 lines) has four routes:
  1. **`POST /backgrounds`** (91):
     1. session;
     2. **the limiter first** (429 "Too many background uploads, try again later");
     3. a declared `content-length` above `BACKGROUND_MAX_BYTES` gives 413 `background_too_large` "The background image is larger than 1 MiB";
     4. `readCapped`, where passing the cap gives the same 413;
     5. it answers **201** with `uploadBackground(...)` (`BackgroundUploadResult`: `id`, `url`, `width`, `height`, at `apps/server/src/backgrounds/service.ts:124`).
     
     Errors thrown by the service (the probe errors and the per-user cap) keep their status and text.
  2. **`GET /backgrounds`** (108) answers `{ backgrounds: listBackgrounds(db, user.id) }`, where each item is a `BackgroundView` (`id`, `url`, `width|null`, `height|null`, `createdAt` string; `service.ts:39`). The success schema lists every field (item 8).
  3. **`GET /backgrounds/:id`** (116):
     - session, then `decodePathId(id)` (a bad escape is 404 `not_found` "Background not found"), then `readBackgroundFile(deps, id, user.id)`; a missing file is the same 404;
     - it answers the raw bytes with **exactly these headers**:
       - `content-type: file.mime`;
       - `content-length`;
       - `x-content-type-options: nosniff`;
       - `content-security-policy: default-src 'none'`;
       - `cache-control: private, max-age=31536000, immutable`;
       - `etag: "<the id param as received>"`.
  4. **`DELETE /backgrounds/:id`** (139): session, then `decodePathId`, then `deleteBackground`; `false` gives 404, success gives **204**.
- **Path decoding:** Hono's `c.req.param()` is already decoded, and the old code decodes it again. **Check what the Effect router gives** (raw or decoded) and keep the same final id and etag for the test inputs. If T-0576 (avatars) has merged by then, copy its finding and its helper. Say in the Report what you did.
- **The mount:** `apps/server/src/app.ts:500-510` mounts `createBackgroundsRoutes({ auth, db, storageDir, now?, uploadLimiter? })`. The only importer is `app.ts`; the tests use `createApp` (check with grep). Mount with `mountEffectRoutes(...)` at the same position, and remove the Hono factory and the old `readCapped`.
- **Tests (all unchanged):** `apps/server/src/backgrounds/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/backgrounds/api.ts`** with the four routes, keeping the same order, statuses, texts, JSON bodies and GET headers. Export `createBackgroundsApi(deps)` and `BACKGROUNDS_API_ROUTES`.
2. **`routes.ts`:** keep `BackgroundsRoutesDependencies` if `app.ts` needs the type; remove the rest.
3. **`app.ts`:** mount as described above.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe, items 1-12), `apps/server/src/voice/api.ts`, `apps/server/src/backgrounds/routes.ts`, `apps/server/src/backgrounds/service.ts` (lines 30-140) and `apps/server/src/app.ts` (lines 495-512).

### Allowed files
`apps/server/src/backgrounds/api.ts`, `apps/server/src/backgrounds/routes.ts`, `apps/server/src/app.ts`, `work/T-0577-effect-http-backgrounds.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot backgrounds authz-sweep app.test
pnpm gate
```

### Acceptance
- Background images are served by Effect `HttpApi`, with the same answers, headers, order and streaming cap.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
