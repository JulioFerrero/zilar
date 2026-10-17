---
id: T-1853
title: "Media cards M2: GET /api/card-media/:id — session, a read limiter, the row's room must be one the caller can read (a DM card only for the AI's owner), bytes streamed with nosniff + CSP + private immutable cache; unknown and invisible answer the same 404"
status: merged
milestone: M5
branch: task/T-1853-card-media-route
model: auto
effort: default
depends_on: [T-1847]
estimate: 35 min
---

# T-1853: The card media read route (media plan M2)

## Spec (written by Claude, do not edit)

### Why
**Julio took every recommendation of `docs/plan/message-blocks-media.md` (2026-10-17).**
- **M1 (T-1847, merged)** added the `card_media` table, `CARD_MEDIA_STORAGE_DIR` and `apps/server/src/card-media/service.ts`.
- **This is M2:** the route the apps load an image or a file from. It is a permission surface, so it gets one test.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/card-media/service.ts`** exports:
  - `getCardMedia(db, id)` → `CardMediaRow | undefined`;
  - `cardMediaPath(dir, row)`.

  `CardMediaRow` has `id`, `aiId`, `roomJid`, `groupId`, `topicId`, `mime`, `size`, `name` and `storageKey`. `storageKey` is server-made, never user input.
- **The model route** is `apps/server/src/avatars/api.ts` (210 lines):
  - an `HttpApiGroup` with `HttpApiEndpoint.get('serve', '/avatars/:id', { params })`, then `.middleware(Session)` and `.prefix('/api')` (`:54-71`);
  - a read limiter via `createRateLimiter({ max, windowMs, now })` (`:106-110`), charged before the lookup (`:177-180`);
  - **the answer** is `HttpServerResponse.uint8Array(bytes, { status: 200, headers })` with these headers (`:188-198`):
    - `content-type`, `content-length`;
    - `x-content-type-options: nosniff`;
    - `content-security-policy: default-src 'none'`;
    - `cache-control: private, max-age=31536000, immutable`;
    - `etag`.
- **The room access check** is in `apps/server/src/files/api.ts:229-242`:
  - `allowedArchives(deps.db, deps.config, user.id)` (`apps/server/src/search/service.ts:77`);
  - then `resolveChatFilter(allowed, chat)` (`search/service.ts:149-163`) → `{ kind: 'room', room } | { kind: 'dm', peer } | null`;
  - `null` → 404;
  - a DM also runs `isDmBlocked(deps.db, user.id, peer)` (`apps/server/src/blocks/service.ts`) → 404.
- **The `ais` table** has an `owner` column (user id, `apps/server/drizzle/0005_clean_frightful_four.sql:10`).
- **Mounting:** `apps/server/src/app/routes-media.ts` (67 lines) builds each media API with `{ ...base, storageDir: deps.xStorageDir ?? config.X_STORAGE_DIR }` and `mounts.push(api)` (`:44-54`).

### Steps
1. **New `apps/server/src/card-media/api.ts`:** `createCardMediaApi(deps)`, following `avatars/api.ts`. One endpoint, `GET /api/card-media/:id`, with the `Session` middleware and the `/api` prefix.
   - **The read limiter:** 600 per 10 min per user, charged first; past it, 429 `rate_limited`.
   - **The row:** `getCardMedia(db, id)`. Missing → 404 `not_found` ("Not found").
   - **The access check,** as in `files/api.ts:229-242`, against `row.roomJid`:
     - `null` → 404;
     - **a `dm`** also requires `isDmBlocked` to be false **and** the caller to be the AI's owner (`SELECT owner FROM ais WHERE id = row.aiId`). Otherwise 404.
   - **The bytes:** read the file at `cardMediaPath(dir, row)`. A missing file → the same 404.
   - **The answer:** the bytes with `content-type: row.mime`, `content-length`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'`, `cache-control: private, max-age=31536000, immutable` and `etag: "<id>"`.
     - **A non-image MIME** also gets `content-disposition: attachment; filename="<row.name sanitised to [A-Za-z0-9._ -], max 100 chars>"`.
   - **Every refusal** is the same fixed 404 sentence. Never echo the id or the path.
2. **Mount** it in `routes-media.ts`: `storageDir: deps.cardMediaStorageDir ?? config.CARD_MEDIA_STORAGE_DIR`. Add the optional `cardMediaStorageDir` dep the same way the others are declared.
3. **Test (permission):** one test in `apps/server/src/card-media/api.test.ts`, reusing the server API test setup (read `avatars` or `files` API tests for how). Store one row and file in a group room with `storeCardMedia`, then check:
   - **401** without a session;
   - **404** for a signed-in non-member and for an unknown id;
   - **200** for a member, with the bytes and the `nosniff` header.
4. **Every source file stays at most 400 lines.**

### Allowed files
- `apps/server/src/card-media/api.ts`
- `apps/server/src/card-media/api.test.ts`
- `apps/server/src/app/routes-media.ts`
- `apps/server/src/app/deps.ts`
- `work/T-1853-card-media-route.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/card-media/api.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A room member** gets the bytes with the safe headers.
- **A stranger, an unknown id** and a missing file get the same 404; no session gets 401.
- **A DM card** is readable only by the AI's owner.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/card-media/api.ts`: `createCardMediaApi(deps)` with one
  `GET /api/card-media/:id` endpoint (`Session` middleware, `/api` prefix). The
  per-user read limiter (600 / 10 min) is charged before the lookup; a missing
  row, an invisible room and a missing file all answer the same fixed 404
  (`not_found`, "Not found"). Access uses `allowedArchives` +
  `resolveChatFilter` against `row.roomJid`, and a `dm` additionally requires
  `isDmBlocked` to be false and `row.aiId`'s owner to be the caller. A member
  gets the bytes with `content-type`, `content-length`, `nosniff`, CSP
  `default-src 'none'`, `cache-control: private, max-age=31536000, immutable`
  and `etag: "<id>"`; non-image MIME types also get
  `content-disposition: attachment; filename="<sanitised>"` (only
  `[A-Za-z0-9._ -]`, max 100 chars).
- Mounted it in `apps/server/src/app/routes-media.ts` with
  `storageDir: deps.cardMediaStorageDir ?? config.CARD_MEDIA_STORAGE_DIR`, and
  added the optional `cardMediaStorageDir` dependency to
  `apps/server/src/app/deps.ts`.
- Added `apps/server/src/card-media/api.test.ts`: one test that stores real
  rows/files with `storeCardMedia` in a real group room and checks 401 without
  a session, 404 for a signed-in non-member, unknown id and missing file (same
  code/message), 200 for a member with the bytes and safe headers, the
  attachment header for a PDF, and that a DM card is readable only by the AI's
  owner.
- No migrations, dependencies or changes outside the Allowed files.

### Checks run
- `pnpm --filter @zilar/server exec vitest run src/card-media/api.test.ts --maxWorkers=2 --reporter=dot`
  → 1 test file passed, 1 test passed.
  (The task's check line omits the worker cap; AGENTS.md requires
  `--maxWorkers=2`, so I used that.)
- `pnpm gate` → `GATE PASS`; summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.7s)
  PASS  lint  (1.4s)
  PASS  typecheck  (3.9s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/server  (7.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The 404 body carries the shared error envelope (`code`, `message`, per-request
  `requestId`), so the test compares `code`/`message` rather than the raw body;
  no id or path is echoed.
- A DM card is already unreachable for non-owners through `resolveChatFilter`
  (the AI JID is only a DM peer of its owner); the explicit owner query is kept
  as the spec requires and as a second gate.
- No open questions.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `3f2a91a9e`.
- **The handler:**
  - the limiter runs first;
  - the row, then `mayRead`: room access through `allowedArchives` and `resolveChatFilter`, and a DM also needs no block plus the AI's owner;
  - an unknown id, an invisible card and a missing file give the same 404;
  - the headers are `nosniff`, `default-src 'none'`, the private immutable cache and the etag;
  - a non-image is sent as an attachment with a sanitised name.
- **The test** covers 401, a stranger's 404, an unknown id's 404 and a member's 200.
- **Nit accepted:** a disk error reads as 404, which fails closed.
- **Note for M3:** `fetch_media` must store only sniffed allowlisted types (no SVG). The CSP header is the second guard.
