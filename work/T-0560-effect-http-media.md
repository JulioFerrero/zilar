---
id: T-0560
title: "Effect C (HTTP): media gallery route (GET /media) onto the HttpApi adapter, zod query schema to Effect Schema; 501/429/400/404 order kept; MediaItem optional fields stay omitted (never null); tests unchanged"
status: merged
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

Moved `GET /media` onto the Effect `HttpApi` adapter (recipe items 8-11),
following `push/api.ts` (manual in-handler query decode) and `audit/api.ts`
(`NumberFromString` query coercion, `createXRoutes` compat factory).

What changed:
- `apps/server/src/media/api.ts` (new): `GET /media` as `HttpApi` group
  `media` with `Session` middleware, `MediaSchemaErrors` layer and `/api`
  prefix; exports `MEDIA_API_ROUTES` (`GET /api/media`) and `createMediaApi`.
  Step order kept: 401 (Session) → 501 `media_unavailable` "Media gallery is
  not configured" → 429 `rate_limited` "Too many requests, try again later"
  → 400 `invalid_request` "Invalid media query" → 404 `not_found`
  "Chat not found" (unknown/invisible chat and blocked DM alike) → archive
  query. The query is decoded manually from `request.originalUrl` via
  `URLSearchParams` (first value wins, like Hono's `c.req.query()`) with
  `Schema.decodeUnknownOption(MediaQuery, { onExcessProperty: 'error' })`,
  because the limiter must run before the decode. `now` and the limiter are
  injectable (`MediaApiDependencies.limiter`). `indexChat` failures log
  `{ userId, err: errorName }` and still answer stored rows. No zod remains.
- `apps/server/src/media/routes.ts`: `createMediaRoutes`/`querySchema` and
  the Hono handler removed; keeps the constants, `MediaType`/`MediaItem`/
  `MediaRoutesDependencies` exports (re-exported from `./api`) plus a
  `createMediaRoutes` compat factory forwarding to the Effect handler
  (nothing else imports the moved helpers — verified with grep).
- `apps/server/src/app.ts`: mounts `createMediaApi(...)` with
  `mountEffectRoutes` at the same position.
- No test file touched.

MediaItem output comparison (old `toMediaItem` vs new — identical code,
moved verbatim): `messageId`, `chat`, `at` (ISO from `atMicros`), `senderName`,
`kind` always present; each of `url`, `name`, `size`, `mime`, `width`,
`height`, `durationMs`, `waveform`, `linkUrl`, `linkHost` is spread only when
the row value is non-null, so absent fields stay absent. The success schema
`MediaItemView` declares every optional field as `Schema.optional(...)`, never
`NullOr`; the handler returns `{ items, next }` with `next: string | null`,
matching the old `c.json({ items, next })`. Tests assert `linkUrl` absent via
`toBeUndefined` (routes.test.ts:378) and exact `toEqual` link payloads — all
green. Query-schema equivalence: `chat` 1..256, `type` in MEDIA_TYPES,
`before` coerced positive int, `limit` coerced int 1..100, strict (excess key
fails); decode-failure text stays the fixed "Invalid media query" (old and
new texts identical, so no text change to list).

Commands and real results:
- `pnpm install`: ok (40.5s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/media/routes.test.ts`: 10 passed.
- `... src/media/indexer.test.ts`: 15 passed.
- `... authz-sweep`: 5 passed.
- `... app.test`: 9 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot media app.test`: 3 files, 34 passed.
- `pnpm gate`: GATE PASS — install (5.5s), format (111.2s), lint (1.4s),
  typecheck (1.6s), tests @zilar/server (1683.6s); "scope: every changed file
  is inside the Allowed files". Two intermediate gate failures were fixed:
  prettier formatting on the two new/rewritten files, and the compat factory's
  `new Hono()` typed as `Hono<{ Variables: RequestIdVariables }>`.

Problems: none remaining. Deviations: none — `routes.ts` was kept (not
deleted) because the spec keeps its constants/types exported and other trees
reference the module path (web `api.ts` comment cites it as the wire
contract).

Security checklist: 401 before any decode (Session middleware); 501/404
indistinguishability for unknown vs invisible chats preserved; rate limit
(30/min/user) checked before decode; no secrets in logs (ids + error name
only); success schema lists every `MediaItem` field; route covered by the
exact-route mount so the 401 sweep sees it (authz-sweep green).

Lead review fixes (one commit each): `api.ts` limit check now uses
`MEDIA_MAX_LIMIT` instead of the literal 100 (`471c3421`); the unused
`createMediaRoutes` compat factory is deleted along with the now-unimported
`media/routes.ts` shim (`c60c6951`) — grep confirmed nothing imports
`createMediaRoutes` or any other `media/routes` export. `pnpm --filter
@zilar/server test --maxWorkers=2 --reporter=dot media authz-sweep app.test`:
4 files, 39 passed. `pnpm gate`: GATE PASS — install (4.3s), format (83.4s),
lint (1.5s), typecheck (33.9s), tests @zilar/server (1317.6s); "scope: every
changed file is inside the Allowed files".

status: review

## Review (written by Claude)

**2026-10-08, lead:** approved after 1 lead fix round, in which the limit uses `MEDIA_MAX_LIMIT` and the unused `media/routes.ts` shim was deleted.
- **Pre-review:** clean. The packet (07:56) is newer than HEAD 5ede3f9a.
  - Parity was checked against main.
  - Coercion was probed on 16 inputs.
  - Optional fields stay omitted, never null.
- **No test file changed.**
- **Follow-up:** the stale comment at `apps/web/src/lib/api.ts:1116` goes to the stale-comments cleanup.
