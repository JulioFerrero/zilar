---
id: T-0576
title: "Effect C (HTTP): avatars (PUT upload under a streaming cap, DELETE, GET raw bytes) onto HttpApi using guide item 12; avatar kind schema zod to Effect Schema; same 404/429/413 order, texts and response headers; tests unchanged"
status: todo
milestone: M5
branch: task/T-0576-effect-http-avatars
model: auto
effort: low
depends_on: [T-0573]
estimate: 0.5 day
---

# T-0576: avatars on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **Follow `docs/EFFECT_GUIDE.md` "Moving a server route module onto Effect HTTP", items 1-12.** Item 12 (T-0573) covers binary bodies: read `request.request.stream` with `Stream.runForEachWhile` under a cap, and answer with `HttpServerResponse.uint8Array(bytes, { headers })`. The worked example is `apps/server/src/voice/api.ts`, which has a `readCapped` over an Effect `Stream`.

### Verified facts (do not re-derive; read each route for its exact order and texts)
- **`apps/server/src/avatars/routes.ts`** (169 lines) has three routes:
  1. **`PUT /avatars/:kind/:ownerId`** (98):
     1. session;
     2. the kind decode (an unknown kind is 404 `not_found` "Avatar not found");
     3. `decodePathId(ownerId)` (a bad escape is the same 404);
     4. **`checkAvatarWritePermission` before the limiter**, so a stranger cannot burn the owner's budget;
     5. the limiter (429 "Too many avatar uploads, try again later");
     6. a declared `content-length` above `AVATAR_MAX_BYTES` gives 413 `avatar_too_large` "The picture is larger than 256 KiB";
     7. `readCapped`, where passing the cap gives the same 413;
     8. it answers `uploadAvatar(...)` as JSON.
  2. **`DELETE /avatars/:kind/:ownerId`** (125): session, the kind decode (404), `deleteAvatar`, then `{ ok: true }`.
  3. **`GET /avatars/:id`** (141): session, then `decodeURIComponent(id)` (a bad escape is 404), then `readAvatarFile`; a missing file is 404. It answers the raw bytes with **these headers, exactly**:
     - `content-type: file.mime`;
     - `content-length`;
     - `x-content-type-options: nosniff`;
     - `content-security-policy: default-src 'none'`;
     - `cache-control: private, max-age=31536000, immutable`;
     - `etag: "<id>"`.
- **Path decoding:** Hono's `c.req.param()` hands out decoded values, and the old code calls `decodeURIComponent` again on them. **Check what the Effect router gives for path params** (raw or decoded) **and keep the same final id** for the encoded ids that `apps/server/src/avatars/routes.test.ts:166,178` sends with `encodeURIComponent`. Say in the Report what you found.
- **`apps/server/src/avatars/service.ts:24-25`:** `avatarOwnerKindSchema = z.enum(['user','ai','group'])` and `type AvatarKind` from `z.infer`. Its only importer is `routes.ts` (check with grep).
  - Convert it to `Schema.Literals([...])`, with `AvatarKind` as the same union.
  - **This is the only change allowed in `service.ts`.** Leave no zod import there if this was its only zod use; check first.
- **The mount:** `apps/server/src/app.ts:485-496` mounts `createAvatarsRoutes({ auth, db, config, storageDir, audit, now?, uploadLimiter? })`. The only importer of `createAvatarsRoutes` is `app.ts`; the tests use `createApp` (`avatars/routes.test.ts:6,142`). Mount with `mountEffectRoutes(...)` at the same position, and remove the Hono factory.
- **Tests (all unchanged):** `apps/server/src/avatars/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/avatars/api.ts`** with the three routes:
   - the same order, statuses, texts, JSON bodies and GET headers;
   - the limiter after the permission check;
   - the streaming cap as in `voice/api.ts`.
   
   Export `createAvatarsApi(deps)` and `AVATARS_API_ROUTES`.
2. **`routes.ts`:** keep `AvatarsRoutesDependencies` if `app.ts` needs the type. Remove the Hono factory and the old `readCapped`.
3. **`service.ts`:** only the kind schema and its type, as described above.
4. **`app.ts`:** mount as described above.
5. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe, items 1-12), `apps/server/src/voice/api.ts`, `apps/server/src/avatars/routes.ts`, `apps/server/src/avatars/service.ts` (lines 1-60), `apps/server/src/avatars/routes.test.ts` (lines 130-190) and `apps/server/src/app.ts` (lines 480-500).

### Allowed files
`apps/server/src/avatars/api.ts`, `apps/server/src/avatars/routes.ts`, `apps/server/src/avatars/service.ts`, `apps/server/src/app.ts`, `work/T-0576-effect-http-avatars.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot avatars authz-sweep app.test
pnpm gate
```

### Acceptance
- Avatars are served by Effect `HttpApi`, with the same answers, headers, order and streaming cap, and no zod in the avatars module.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
