---
id: T-0602
title: "Effect C (HTTP), stickers part B: the sticker upload (multipart or raw bytes, capped) and the sticker file GET move onto the stickers HttpApi; the Hono factory and its mount go away; upload emoji check off zod; same order, statuses, texts and headers; tests unchanged"
status: todo
milestone: M5
branch: task/T-0602-effect-http-stickers-binary
model: auto
effort: low
depends_on: [T-0582]
estimate: 1 day
---

# T-0602: the sticker upload and file routes on Effect HTTP (part B)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono. T-0582 (part A) moved the 12 JSON sticker routes to `apps/server/src/stickers/api.ts`. This task moves the last two, the binary ones. The recipe is `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP":
- item 12 covers binary bodies, `request.request.stream` with `Stream.runForEachWhile`, and `HttpServerResponse.uint8Array`;
- the worked examples are `apps/server/src/voice/api.ts` and `apps/server/src/avatars/api.ts` (an upload plus a file GET).

### Verified facts (do not re-derive; read both routes for their exact order)
**`apps/server/src/stickers/routes.ts`** (212 lines) now holds only:

1. **`POST /sticker-packs/:id/stickers`** (115-186). The order:
   1. session (401);
   2. the upload limiter, 429 `rate_limited` "Too many sticker uploads, try again later";
   3. then, by `content-type`:
      - **multipart:**
        - `formData()`; a failure or a missing `file` gives 400 `invalid_request` "The upload must carry one file";
        - a declared `content-length` above `STICKER_MAX_BYTES + 64 KiB` gives 413 `sticker_too_large` "The sticker is larger than 512 KiB";
        - a file above `STICKER_MAX_BYTES` gives the same 413;
        - the `emoji` field (a non-empty string) is checked with `uploadFormSchema` (zod, line 92: strict, `emoji?` ≤ 8). A failure gives 400 with the first issue message, else "Invalid request";
      - **raw bytes:**
        - a declared `content-length` above `STICKER_MAX_BYTES` gives 413;
        - `readCapped` (59-90) **stops reading as soon as the cap is passed**, so a large body never sits fully in memory, and that gives 413;
        - the `x-emoji` header, if it contains `%`, is percent-decoded from at most its first 64 characters; a bad escape gives 400 "The emoji header is not valid";
   4. `uploadSticker(serviceDeps, decodePathId(id), user.id, bytes, { emoji? })` answers **201** with the sticker JSON.
2. **`GET /stickers/:stickerId/file`** (188-209):
   - session;
   - percent-decode the id; a bad escape gives 404 `not_found` "Sticker not found";
   - `readStickerFile`; a missing sticker gives the same 404;
   - 200 with the bytes and exactly these headers: `content-type` (`file.mime`), `content-length`, `x-content-type-options: nosniff`, `content-disposition: inline`, `cache-control: public, max-age=31536000, immutable`, and `content-security-policy: default-src 'none'; sandbox`.

**Other facts:**
- **`StickersRoutesDependencies`** (19-38), the exported rate-limit constants, and the upload limiter built from `deps.uploadLimiter ?? createRateLimiter(...)` (106-112) are used by `stickers/api.ts` and `app.ts`. Check with grep; keep every export that has an importer.
- **The mount:** `apps/server/src/app.ts:477-479` mounts the Effect api, then `app.route('/api', createStickersRoutes(stickersDeps))`. After this task, **only** the Effect mount remains, unless a test mounts the Hono factory directly. Check with grep; if one does, keep an item-11 wrapper for it.
- **The upload limiter must be the same instance per app** as today: one per `createStickersApi` call, built once and not per request.
- **The emoji check** becomes Effect Schema, or a plain check with the same text. Read what zod's message for `max(8)` is today, and keep it byte-identical **if a test pins it** (check `apps/server/src/stickers/*.test.ts`); otherwise say in the Report which text you kept.
- **`stickers/api.ts`** keeps its legacy zod block (142-165). That block reproduces exact 400 texts and **stays out of scope**.
- **Multipart in Effect:** read how `apps/server/src/avatars/api.ts` takes its upload, and do the same. If it uses the web `Request`'s `formData()`, that is fine. Keep the 64 KiB slack check on the declared length **before** reading the form.
- **Tests (all unchanged):**
  - `apps/server/src/stickers/*.test.ts` (uploads, caps, emoji, file headers);
  - the authz sweep (`authz-sweep`);
  - `app.test`.

### What to build
1. **Add the two routes to `stickers/api.ts`**, with the same order, statuses, texts and headers, the streaming cap on raw bodies, and the same 201 body (item 8: list every field of the upload result).
2. **`routes.ts`:**
   - remove the Hono factory, `readCapped` (move it into `api.ts` if you reuse it) and zod;
   - keep the deps interface and the constants, or move them to `api.ts` and re-export them from `routes.ts`, so importers stay unchanged.
3. **`app.ts`:** remove the Hono mount at line 479, and its import if it becomes unused.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe, items 8, 11 and 12), `apps/server/src/avatars/api.ts`, `apps/server/src/voice/api.ts`, `apps/server/src/stickers/routes.ts`, `apps/server/src/stickers/api.ts` (lines 1-200) and `apps/server/src/app.ts` (lines 465-480).

### Allowed files
`apps/server/src/stickers/api.ts`, `apps/server/src/stickers/routes.ts`, `apps/server/src/app.ts`, `work/T-0602-effect-http-stickers-binary.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot stickers authz-sweep app.test
pnpm gate
```

### Acceptance
- All 14 sticker routes are served by Effect `HttpApi`, and the Hono sticker mount is gone.
- Upload caps, texts and file headers are unchanged.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
