---
id: T-0560
title: "Effect C (HTTP): media gallery route (GET /media) onto the HttpApi adapter, zod query schema to Effect Schema; 501/429/400/404 order kept; MediaItem optional fields stay omitted (never null); tests unchanged"
status: todo
milestone: M5
branch: task/T-0560-effect-http-media
model: auto
effort: low
depends_on: [T-0548]
estimate: 0.5 day
---

# T-0560: media gallery on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"**, items 8-11. The worked example is `apps/server/src/topics/api.ts`. T-0558 is moving the very similar `search/routes.ts` at the same time. Do not edit that file.

### Verified facts (do not re-derive; read the whole handler)
- **`apps/server/src/media/routes.ts`** (215 lines):
  - the constants `MEDIA_RATE_LIMIT_MAX`, `MEDIA_RATE_LIMIT_WINDOW_MS`, `MEDIA_DEFAULT_LIMIT`, `MEDIA_MAX_LIMIT` and `MEDIA_TYPES`, and the type `MediaType` (lines 21-27);
  - `MediaRoutesDependencies` (38) holds `auth`, `db`, `config`, `logger`, `archive?` and `now?`;
  - `querySchema` (48) is a strict zod object `{ chat: 1..256, type?: enum MEDIA_TYPES, before?: coerced positive int, limit?: coerced int 1..MEDIA_MAX_LIMIT }`;
  - the `MediaItem` interface (58);
  - `toMediaItem` (around 111), where **absent fields are omitted from the payload and never sent as `null`**;
  - `createMediaRoutes(deps): Hono` (134), with one limiter and one route, `GET /media` (143).
- **The handler's order:**
  1. session;
  2. no archive gives **501** `media_unavailable` "Media gallery is not configured";
  3. the **limiter** gives 429 "Too many requests, try again later";
  4. decode the **query string** (400 `invalid_request` "Invalid media query");
  5. `allowedArchives`, then `resolveChatFilter`. An unknown or invisible chat gives 404 "Chat not found", and so does a blocked DM peer (`isDmBlocked`);
  6. the archive query.
  
  Keep this order.
- **The success schema must keep the omission rule.** Every optional `MediaItem` field (`url`, `name`, `size`, `mime`, `width`, `height`, `durationMs`, `waveform`, `linkUrl`, `linkHost`) is `Schema.optional(...)`, **not** `NullOr`, so an absent field stays absent in the JSON. Read the `c.json` at the end of the handler for the outer shape.
- **`apps/server/src/app.ts`** (around line 437) mounts `createMediaRoutes({ auth, db, config, logger, ...archive, ...now: searchNow })`. Keep it at the same position.
- **Tests (all unchanged):** `apps/server/src/media/routes.test.ts` builds the app with `createApp` (line 185), plus `apps/server/src/media/indexer.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/media/api.ts`** with `GET /media` on `HttpApi`:
   - the same order, statuses and texts;
   - an injectable `now` and limiter;
   - an Effect Schema for the query string, with the same rules, coercion and strictness;
   - a success schema with the omission rule above.
   
   Export `MEDIA_API_ROUTES`.
2. **`routes.ts`:** remove `createMediaRoutes` and `querySchema`, and keep the constants, types and helpers exported. Move the helpers into `api.ts` only if nothing else imports them (check with grep). If `app.ts` was the only importer of `routes.ts` and nothing is left in it, delete the file.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/topics/api.ts`, `apps/server/src/media/routes.ts` (all of it), and the media mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/media/api.ts`, `apps/server/src/media/routes.ts`, `apps/server/src/app.ts`, `work/T-0560-effect-http-media.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot media authz-sweep app.test
pnpm gate
```

### Acceptance
- The media gallery is served by Effect `HttpApi`, with the same answers and order, absent fields still omitted, and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
