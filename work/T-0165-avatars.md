---
id: T-0165
title: Profile pictures for people, AIs, groups and channels
status: planned
milestone: M5
branch: task/T-0165-avatars
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: [T-0164]
estimate: 2 days
---

# T-0165: Profile pictures for people, AIs, groups and channels

## Spec (written by Claude, do not edit)

### Why
Julio wants profile pictures for people, AIs, groups and channels. The display side already exists: `avatarUrl` flows from the server (`contacts/service.ts` reads `user.image`, `chats/routes.ts` forwards it) into the web `Avatar` component, which falls back to initials. What is missing is everything before it: there is no way to upload, store or serve a picture, and groups and AIs have no avatar at all. The server has no image-processing library and none must be added, so the browser crops and resizes and the server only validates and stores.

### What to build

**1. Data and storage (server, one migration).**
- `avatars(id text primary key (random uuid), owner_kind text not null check in ('user','ai','group'), owner_id text not null, mime text not null check in ('image/webp','image/png'), width int, height int, bytes int, storage_key text not null, created_at)`, unique on `(owner_kind, owner_id)`: one picture per owner. A channel is a group.
- Files live on disk under `AVATAR_STORAGE_DIR` (default `/data/avatars`), named by a random `<uuid>.<ext>` (never user input), reusing the storage helpers the stickers use (`resolveStorageDir`, `ensureWritableDir`, the empty-directory warning pattern). Add the variable to `config.ts` with the same rules as `STICKER_STORAGE_DIR`.
- Deploy: a persistent volume `avatar-data` mounted at that path in `deploy/docker-compose.yml` and `deploy/coolify/docker-compose.yml`, owned correctly for the non-root server user like the sticker volume. If `deploy/zilar backup` and `restore` enumerate volumes, include the new one and extend the existing shell test.
- Do not touch Better Auth's `user` table. The avatar is read by joining `avatars` at read time; `avatarUrl` is `/api/avatars/<id>`, and for a user without a row it falls back to the existing `user.image` value.

**2. Validation (reuse, do not duplicate).** Export what is needed from `stickers/image.ts` (magic-byte detection and header parsing, no new dependency). Accept only `image/webp` and `image/png`, **static only** (reject animated WebP and APNG), at most 256 KB, the image must be square with a side between 64 and 512 pixels, and the decoded size must stay under the existing decompression-bomb limit. The type comes from the magic bytes, never from the client's header or file name.

**3. API (server, session required, rate limited, audit with ids only).**
- `PUT /api/avatars/:kind/:ownerId` with the raw image bytes as the body: replaces the owner's picture and deletes the old file in the same flow (write the new file first, swap the row in one statement, then remove the old file; a failure never leaves the owner without a picture). Returns `{ url }`.
- `DELETE /api/avatars/:kind/:ownerId`: removes the row and the file; idempotent.
- `GET /api/avatars/:id`: streams the file with the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: private, max-age=31536000, immutable` (the id changes on every replacement, so immutable is safe) and an `ETag`. The id is a random unguessable uuid and a signed-in session is required; document in a comment that the URL is a capability for signed-in users, so private-group pictures are not listed anywhere but are not secret from someone who is handed the exact URL.
- Who may change which picture: a person only their own; a group or channel only its owner or an admin of that group; an AI only the person who owns or created that AI (follow how the AI routes decide this today). Anyone else, an unknown owner and a wrong kind answer the same 404.
- Rate limit: 10 uploads per hour per user. Every response for AIs, groups, channels, group members, contacts and `GET /api/me` that already carries a name gets `avatarUrl` when a picture exists (omit the field when none, like today).

**4. Web.**
- A reusable `AvatarUploader`: choose a file (or drop one), a crop dialog with a circular mask, a zoom slider and drag to position, an exported **256 × 256 WebP** (PNG if the browser cannot encode WebP) made with a canvas, a clear error for files that are not images or are too large to load, Save with a busy state, and Remove. No new dependency; write the crop maths as small pure functions with tests.
- Used in: the profile settings (people), the group and channel settings for owners and admins (groups and channels), and the AI settings for the AI's owner (AIs). Where the new group or channel creation dialogs exist, the picture can be set afterwards in settings; do not add it to creation.
- Check every place that renders the `Avatar` for a person, AI, group or channel (chat list items, chat header, member lists, topic rows, search results, group cards) and make sure it receives `avatarUrl` and falls back to initials when there is none.
- Tests (Vitest and Testing Library) for the uploader states, the crop maths, and one display test per kind.

**5. Docs.** One short paragraph in `docs/INSTALL_DOCKER.md` on the `avatar-data` volume and that backups include it (if they do).

### Read first
`AGENTS.md` (whole security checklist), `work/T-0120-*.md` (stickers storage), `apps/server/src/stickers/image.ts`, `service.ts` and `routes.ts` (file storage and serving patterns), `apps/server/src/contacts/service.ts`, `apps/server/src/chats/routes.ts`, the AI routes, `apps/server/src/config.ts` (`STICKER_STORAGE_DIR`), `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/zilar` (backup), the web `Avatar` component and the places listed above, `apps/web/src/lib/api.ts`.

### Allowed files
`apps/server/src/avatars/**` (new), `apps/server/src/stickers/image.ts` (only to export helpers), `apps/server/src/contacts/service.ts`, `apps/server/src/chats/routes.ts`, the AI and group service or route files only to attach `avatarUrl` and to expose the owner check, `apps/server/src/auth/routes.ts` (only `GET /me`), `apps/server/src/config.ts` and its test, `apps/server/src/db/schema.ts` and exactly one new migration (+ journal and snapshot), `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/zilar` and `deploy/tests/**` (volume list only), `docs/INSTALL_DOCKER.md`, the web files for the uploader, settings pages and every avatar display, `apps/web/src/lib/api.ts` and its test, `work/T-0165-avatars.md`. No new dependencies, no mobile.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/avatars src/stickers src/config.test.ts src/contacts src/chats src/authz-sweep.test.ts
pnpm --filter @zilar/web test --maxWorkers=2 src/components src/routes src/lib/api.test.ts
sh deploy/tests/storage-safety.test.sh
```

### Acceptance
- A person, an AI (by its owner), a group and a channel (by owner or admin) can each set, replace and remove a picture; it shows in the chat list, header, member lists and search results, with initials as the fallback.
- A file that is not WebP or PNG, is animated, is not square, is outside 64 to 512 pixels, claims a huge decoded size or is over 256 KB is refused with a clear message and nothing is stored (tests for each, plus a PNG whose extension or `Content-Type` lies).
- A replacement never leaves an owner without a picture, even if the old file cannot be removed; the old file is gone afterwards; concurrent uploads for the same owner end with exactly one row (unique index).
- The restore and backup test still passes with the new volume; the server starts when the directory is missing and creates it.
- Every new route is in the 401 sweep, rate limited, with the same 404 for unknown and not-allowed; audit entries carry ids only.

### Out of scope
Animated avatars, per-chat wallpapers, XMPP vCard avatars for other clients, mobile, server-side resizing or any image library, orphan-file sweeps beyond deleting on replace and remove.

---

## Report (written by the worker when done)

## Review (written by Claude)
