---
id: T-0576
title: "Effect C (HTTP): avatars (PUT upload under a streaming cap, DELETE, GET raw bytes) onto HttpApi using guide item 12; avatar kind schema zod to Effect Schema; same 404/429/413 order, texts and response headers; tests unchanged"
status: merged
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

### What I did
- Created `apps/server/src/avatars/api.ts` with the three routes on Effect
  `HttpApi` (`createAvatarsApi(deps)`, `AVATARS_API_ROUTES`): PUT upload /
  DELETE / GET serve with the same order (PUT: session -> kind 404 ->
  ownerId decode 404 -> `checkAvatarWritePermission` -> limiter 429 ->
  declared-length 413 -> `readCapped` 413 -> JSON), statuses, texts, JSON
  bodies (`{ url }`, `{ ok: true }`) and the exact GET headers. The limiter
  runs inside the handler after the permission check; the streaming cap uses
  `Stream.runForEachWhile` over `request.request.stream` like `voice/api.ts`.
- `routes.ts`: removed the Hono factory and the old `readCapped`; keeps the
  `AvatarsRoutesDependencies` interface (re-exported so `app.ts` keeps its
  type import).
- `service.ts`: only change is `avatarOwnerKindSchema` to
  `Schema.Literals(['user','ai','group'])` with
  `AvatarKind = typeof avatarOwnerKindSchema.Type`; no zod import remains in
  the avatars module (grep confirms).
- `app.ts`: `mountEffectRoutes(app, avatarsApi.routes, avatarsApi.handler)`
  at the same position (with `logger` passed through).
- Output schema check (guide item 8): `uploadAvatar` returns
  `AvatarUploadResult = { url: string }`; `AvatarUploadView` is exactly
  `{ url: String }`. DELETE returned `{ ok: true }`; `AvatarRemoveView` is
  exactly `{ ok: Literal(true) }`. No field dropped. No generic decode text
  changed (kind/id failures are handler-side 404s, no schema-error layer).
- Path decoding finding: Hono's `c.req.param()` hands out decoded values and
  the old code decoded again. The Effect router (find-my-way in
  `effect@4.0.2/src/http/FindMyWay/internal/router.ts:350,390,981`) decodes
  path segments with `safeDecodeURIComponent` before handing params out, so
  `request.params` is likewise already decoded. Keeping `decodePathId` /
  the GET `decodeURIComponent` gives the same final id (idempotent on normal
  ids, 404 on bad escapes) — confirmed by the unchanged tests passing,
  including the `encodeURIComponent(ownerId)` calls at
  `routes.test.ts:166,178` and the full round-trips.

### Files changed
- `apps/server/src/avatars/api.ts` (new)
- `apps/server/src/avatars/routes.ts` (Hono factory + readCapped removed)
- `apps/server/src/avatars/service.ts` (kind schema zod -> Effect Schema)
- `apps/server/src/app.ts` (mount via `mountEffectRoutes`)

### Commands and real results
- `pnpm install`: ok (13.3s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot avatars`:
  1 file, 18 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot authz-sweep`:
  1 file, 5 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot app.test`:
  1 file, 9 passed.
- `pnpm gate`: PASS install (1.5s), PASS format (19.1s), PASS lint (1.0s),
  PASS typecheck (9.4s), PASS tests @zilar/server (336.8s),
  "scope: every changed file is inside the Allowed files", GATE PASS.

### Security checklist
- No secrets/tokens in logs, audit detail, errors or URLs; `logPath`
  redaction for `/api/avatars/` untouched.
- Permission check (`checkAvatarWritePermission`) runs before any effect and
  before the limiter on PUT/DELETE; GET keeps session + same-404 behavior.
- Limits enforced per request (limiter + 256 KiB streaming cap); no
  check-then-insert changes.
- 401 sweep covers all three routes (authz-sweep green); writes rate-limited.

### Deviations / open questions
- None. All listed tests unchanged and green.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (08:44) is newer than HEAD 07966e3c.
- **No test file changed.**
- **Lead check:** the upload answer matches `AvatarUploadResult` (`url`), and delete answers `{ ok: true }`. The worker showed that the Effect router decodes path params like Hono does (`FindMyWay` `safeDecodeURIComponent`), so the second decode keeps the same ids.
- **Accepted nit:** the header comment in `routes.ts:3` says the type is re-exported for `app.ts`; it is logged for a cleanup.
