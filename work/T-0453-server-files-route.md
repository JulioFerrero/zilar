---
id: T-0453
title: "Upload lock 1 (server): GET /api/files?chat=&url= streams an upload file only to members of a chat that holds it (Range supported)"
status: merged
milestone: M5
branch: task/T-0453-server-files-route
model: auto
effort: low
depends_on: [T-0452]
estimate: 0.5 day
---

# T-0453: the authenticated file route

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/upload-auth-plan.md`, task 1, with the changes in §7. Julio chose option (a): files are served through the server after a session and membership check.

This task adds the route only. Nothing uses it yet: web and mobile switch to it later, and Caddy blocks direct GETs at the end.

### Verified facts (do not re-derive)
- **The pattern to copy is `apps/server/src/media/routes.ts`:**
  - deps (`MediaRoutesDependencies`, line 37) include `auth`, `db`, `config`, `logger`, `archive?` and `now?`;
  - the session is checked with `requireSession`;
  - with no archive the route answers 501;
  - it is rate-limited with `createRateLimiter`;
  - `allowedArchives` and `resolveChatFilter` answer 404 for an unknown or invisible chat (lines 181-186), and `isDmBlocked` (line 111) gives 404 for a blocked DM (line 187);
  - `archiveOwner` and `chatJid` are derived at lines 191-192;
  - `indexChat({ archive, db, archiveOwner, chatJid, scope: filter, now })` runs in a try/catch that logs only ids and the error name (lines 196-209).
- **`mediaItems`** (`apps/server/src/db/schema.ts:1231`) has `archiveOwner`, `chatJid`, `kind`, `url` (the public upload URL as sent), `mime`, `name` and `deleted`.
- **`toInternalUploadUrl(raw, config)`** (`apps/server/src/voice-transcription/routes.ts:423-446`) returns ejabberd's internal URL for a same-origin `/upload/...` URL, and `null` for anything else.
- **Mounting:** `createMediaRoutes` is mounted at `apps/server/src/app.ts:394-403`, with `archive` and `searchNow`.
- **Tests:** `apps/server/src/media/routes.test.ts` builds the archive fake and seeds `mediaItems` and archive rows; copy its setup.

### What to build
1. **New `apps/server/src/files/routes.ts`:** `createFilesRoutes(deps)`, with the same deps shape as the media routes plus an optional `fetchImpl` (default `fetch`) for tests. It adds `GET /files?chat=<jid>&url=<upload URL>`:
   1. **Session** with `requireSession` (401). No archive gives 501 `files_unavailable`.
   2. **Rate limit** of 600 per minute per user (429). Images load many at once.
   3. **Validation** with zod, strict: `chat` is 1-256 characters and `url` is 1-2048. `toInternalUploadUrl(url, deps.config)` must not be null; otherwise 404 `not_found` "File not found".
   4. **The chat** resolves exactly as in `/api/media`. An unknown, invisible or blocked chat gives 404 "File not found". **The same 404 for every refusal.**
   5. **The lookup:** a `mediaItems` row with that `archiveOwner`, `chatJid` and `url`, `deleted = false`, and kind not `link`. On a miss, run `indexChat` once (wrapped like the media route) and look again. Still no row gives 404.
   6. **The fetch:** the internal URL with `deps.fetchImpl`, a 30 s timeout (`AbortSignal.timeout`), and the request's `Range` header (only that header).
      - When the upstream answers 200 or 206, stream its body back with the same status, plus only these headers: `Content-Type` (else the row's `mime`, else `application/octet-stream`), `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag` and `Last-Modified`. Always add `Cache-Control: private, max-age=3600` and `X-Content-Type-Options: nosniff`. A `file` kind also gets `Content-Disposition: attachment` with the row's `name` RFC 5987-encoded, or `file` when there is none.
      - Upstream 416 passes through. Any other upstream status, or a network error, gives 502 `file_unavailable` with a fixed message.
   7. **Never log** URLs, names or bodies; log only ids and the error name.
2. **`apps/server/src/app.ts`:** mount `createFilesRoutes({ auth, db, config, logger, archive?, now? })` next to the media routes, the same way.
3. **New `apps/server/src/files/routes.test.ts`:**
   - **Refusals:**
     - 401 signed out;
     - 501 without an archive;
     - 404 for: a URL from another origin, a chat the caller cannot see, a URL not in that chat (it exists in another chat), a retracted row (`deleted`) and a blocked DM.
   - **Serving:**
     - a member gets 200, the bytes, the content type and `Cache-Control: private`;
     - a just-sent file (archive row only, no `mediaItems` row) is found after the on-demand index;
     - a `Range: bytes=0-3` request gets the upstream 206 with `Content-Range`, and the fake fetch received exactly that Range;
     - a forwarded copy (the same URL in two chats): a member of only the target chat gets 200 through the target chat, and 404 through the source chat.
   - **Errors:** an upstream 500 gives 502.
   - **Rate limit:** the 601st request in a minute gives 429. Use the injected `now`.

### Read first
`AGENTS.md`, `docs/audit/upload-auth-plan.md` §3(a), §4 and §7, `apps/server/src/media/routes.ts`, `apps/server/src/media/routes.test.ts`, `apps/server/src/voice-transcription/routes.ts:415-446`, `apps/server/src/db/schema.ts:1231-1270`, `apps/server/src/app.ts:385-405`.

### Allowed files
`apps/server/src/files/routes.ts`, `apps/server/src/files/routes.test.ts`, `apps/server/src/app.ts`, `work/T-0453-server-files-route.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot files/routes
pnpm gate
```

### Acceptance
- `GET /api/files` serves an upload file, with Range support, only to a signed-in member of a chat whose non-retracted message holds that URL. Every refusal is the same 404.
- Nothing is logged but ids.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Implemented `GET /api/files?chat=<jid>&url=<upload URL>` per spec.

What I did:
- New `apps/server/src/files/routes.ts`: `createFilesRoutes({ auth, db, config, logger, archive?, now?, fetchImpl? })` mirroring `media/routes.ts` (session via `requireSession`, 501 `files_unavailable` without archive, 600/min/user rate limit, strict zod query `chat` 1-256 / `url` 1-2048, same chat resolution via `allowedArchives` + `resolveChatFilter` + `isDmBlocked`, `indexChat` retry wrapped with ids-only warn log). `mediaItems` lookup matches `archiveOwner` + `chatJid` + `url` + `deleted = false` + kind not `link`. Same-origin check via `toInternalUploadUrl`; every refusal is 404 `not_found` "File not found". Upstream fetch uses `fetchImpl` (default `fetch`), `AbortSignal.timeout(30_000)`, forwards only the `Range` header. 200/206 stream back with same status and only `Content-Type` (upstream, else row mime, else `application/octet-stream`), `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`, `Last-Modified`, plus `Cache-Control: private, max-age=3600` and `X-Content-Type-Options: nosniff`; `file` kind adds `Content-Disposition: attachment` with RFC 5987-encoded name (or `file`). 416 passes through; any other upstream status or network error is 502 `file_unavailable` with a fixed message. Logs carry only `userId` and the error name.
- `apps/server/src/app.ts`: mounted `createFilesRoutes` next to the media routes (same archive/`searchNow` wiring). The authz sweep picks it up automatically (session check first, so unauthenticated answers 401).
- New `apps/server/src/files/routes.test.ts`: 13 tests covering all spec cases (401, 501, all six 404 refusals, 200 serving with byte/type/`Cache-Control: private` + internal-URL assertion, on-demand index of a just-sent file, Range 206 with `Content-Range` and exact Range forwarding, forwarded-copy target-200/source-404, upstream-500 to 502, 600-requests-then-429). Tests build the files routes directly with an injected fake fetch so no request touches the network; the fake records the fetched URL and Range header.

Files changed: `apps/server/src/files/routes.ts` (new), `apps/server/src/files/routes.test.ts` (new), `apps/server/src/app.ts` (mount only), `work/T-0453-server-files-route.md` (this report).

Commands and real results:
- `pnpm install`: ok (13.6s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot files/routes`: first run 10 failed / 3 passed — all failures were 500s because the bare test Hono app had no `HttpError` handler; added an `onError` mirroring `app.ts`. Second run: 13 passed. Final targeted run after the typecheck fix was covered by the gate run below.
- `pnpm exec prettier --write` on the two new files (gate's format check flagged them).
- `pnpm gate`: GATE PASS — install, format, lint, typecheck all PASS; tests @zilar/server PASS (253.4s); "scope: every changed file is inside the Allowed files". Gate reports 4 changed files against main (the 3 code files + this task file).

Problems / deviations:
- One typecheck error (`HeadersInit` not in scope under this tsconfig): typed the fake fetch init as `{ headers?: Record<string, string> }`.
- Validation failures (missing/oversized params) answer 400 `invalid_request`, matching the media route's convention; the spec only names 404 for the refusal cases, and 400 is not a refusal of an existing file.

Security checklist: no secrets/URLs/names/bodies in logs (only `userId` + error name); lookups always scoped by `(archiveOwner, chatJid)`; unknown and invisible chats share one 404; route is session-first (401 sweep covers it via the app mount); rate limit 600/min/user on the read route.

## Review (written by Claude)

Approved (lead, 2026-10-07). GET /api/files?chat=&url= checks the session (401) and archive (501) and is rate-limited (600/min). It resolves the chat like /api/media, looks the URL up in that chat's non-retracted media_items rows, and on a miss indexes the chat once. It streams the internal ejabberd URL with only the Range header, passes 200/206/416 through with a header allowlist plus Cache-Control: private and nosniff, and turns anything else into a fixed 502. Every refusal is the same 404, and the logs carry ids only. Nit accepted: a malformed query gives 400, the same as /api/media. For the cutover task: check that Caddy access logs do not record the url query.
