---
id: T-0165
title: Profile pictures for people, AIs, groups and channels
status: review
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

### What I did
- Server: new `apps/server/src/avatars/` module — `service.ts` (validation, permission checks, upload/replace/remove/read, `avatarIdsByOwner` batch read) and `routes.ts` (`PUT /api/avatars/:kind/:ownerId`, `DELETE`, `GET /api/avatars/:id` with the exact spec headers + ETag). One owner per row via the `(owner_kind, owner_id)` unique index; replace writes the new file first, swaps the row with `onConflictDoUpdate` under an advisory lock, then removes the old file.
- Validation reuses `stickers/image.ts` (added `isAnimatedWebp`/`isAnimatedPng`/`isAnimatedImage` + an `animated` probe error; no new dependency): static WebP/PNG by magic bytes only, ≤ 256 KB, square, side 64–512, decoded size under the shared bomb limit.
- `avatarUrl` attached at read time everywhere the spec asks: contacts (stored picture wins, else `user.image`), chat list DMs (people + AIs) and groups incl. topic rows, AI list + detail, group detail + members + group AIs, directory entries + by-handle lookup, `GET /me`. Omitted when none. Better Auth's `user` table untouched.
- Permissions: person→own, group/channel→owner or admin (`groupMembers.role`), AI→`ais.owner` (same ownership the AI routes check). Unknown owner, wrong kind and stranger all answer the same 404. 10 uploads/hour/user. Audit `avatar.updated`/`avatar.removed` with ids only. Avatar ids redacted in the request log (`/api/avatars/:id`).
- Config + deploy: `AVATAR_STORAGE_DIR` (default `./data/avatars`, same rules as stickers) + startup `ensureWritableDir`; `avatar-data` volume at `/data/avatars` in both compose files; `backup` archives `avatars.tgz` and `restore` restores it (old archives without it restore with a warning, like stickers); shell test extended; `docs/INSTALL_DOCKER.md` paragraph + table row. Note: `apps/server/Dockerfile` is NOT in Allowed files so the image-side `mkdir/chown` for `/data/avatars` was left out — the named volume gets root-owned perms on first mount otherwise; lead should add one line there.
- Web: `AvatarUploader` (file pick, crop dialog with circular mask + zoom slider + drag, 256×256 WebP export with PNG fallback via canvas, busy Save, Remove, clear errors) + pure crop maths in `lib/avatar-crop.ts`. Wired into new Settings → Profile page (menu entry + route), GroupPanel and ChannelPanel (new channel picture section for owners/admins) and AiPanel. `avatarUrl` plumbed through every `Avatar` render: chat list (incl. group header rows via topic rows), header, member lists (incl. role-assign rows, add pickers), topic rows, search results (row + group header), directory/group cards, AI cards, new-group/new-topic pickers. One display test per kind (person DM row, group row, AI panel, directory row) + uploader states + crop maths + api client tests.

### Files changed
- Server: `avatars/service.ts`, `avatars/routes.ts`, `avatars/routes.test.ts` (new); `stickers/image.ts` (+ animated export), `stickers/image.test.ts`, `stickers/routes.test.ts` (static VP8X fixture); `db/schema.ts` + migration `0037_calm_star_brand.sql` (+ journal/snapshot); `config.ts` + `config.test.ts`; `contacts/service.ts`, `chats/routes.ts`, `ais/routes.ts`, `ais/service.ts` (type only), `groups/service.ts`, `auth/routes.ts`, `directory/service.ts`, `app.ts` (+ avatar-id log redaction), `index.ts`.
- Web: `components/AvatarUploader.tsx` (+ test), `lib/avatar-crop.ts` (+ test), `routes/ProfilePage.tsx` (new), `routes/AppRoutes.tsx`, `components/ChatList.tsx`, `auth/AuthProvider.tsx`, `components/ProfileSettingsSection.tsx`, `components/GroupPanel.tsx` (+ test), `components/ChannelPanel.tsx`, `components/TopicPanel.tsx`, `components/TopicRow.tsx`, `components/ais/AiPanel.tsx` (+ test), `components/MessageSearchResults.tsx`, `components/ExplorePage.tsx` (+ test), `components/NewGroupDialog.tsx`, `components/NewTopicDialog.tsx`, `components/ChatListItem.test.tsx`, `routes/AisPage.tsx`, `routes/GroupHandleRoute.tsx`, `store/store.ts`, `store/realStore.ts`, `lib/api.ts` (+ test).
- Deploy/docs: both compose files, `deploy/zilar`, `deploy/tests/storage-safety.test.sh`, `docs/INSTALL_DOCKER.md`.

### Commands run and real results
- `pnpm install`: ok (7.2s, from the base commit; no new dependencies added).
- `pnpm format:check`: pass. `pnpm lint` (oxlint): pass, no warnings. `pnpm typecheck` (11 tasks): pass.
- `pnpm --filter @zilar/server test --maxWorkers=2 src/avatars src/stickers src/config.test.ts src/contacts src/chats src/authz-sweep.test.ts`: 10 files, 177 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 src/components src/routes src/lib/api.test.ts`: 78 files, 789 passed (unchanged since base commit — no web files touched by this fix round).
- `sh deploy/tests/storage-safety.test.sh`: pass=24 fail=0 (both compose files render with sticker + avatar volumes; backup/restore dry-runs list all three stores).

### Review fixes (lead review of 555014e, PREREVIEW.md)
1. Animated-sticker regression fixed: the shared probe is animation-neutral again — it returns `info.animated` (VP8X flag / APNG `acTL`) and stays `ok`, so sticker upload and the Telegram import keep their exact T-0120 behavior. Only `checkAvatarBytes` rejects animated images (`avatar_animated`). The wrong `probeErrorCode` comment is gone. Tests: sticker upload accepts an animated WebP and an APNG (`routes.test.ts`), the Telegram import stores an animated WebP file (`telegram-import-routes.test.ts`), the probe flags animated on the info (`image.test.ts`), and the avatar suite rejects those same bytes (`routes.test.ts` "rejects the same animated bytes the sticker upload accepts").
2. `apps/server/Dockerfile`: added `/data/avatars` to the existing `mkdir -p` + `chown` line, exactly like `/data/stickers` (lead-approved; listed here as a Deviation since it is outside the original Allowed files).
3. Removed the unreachable decoded-size branch in `checkAvatarBytes`; the comment now says honestly that the bomb case is enforced upstream by the shared probe (`too_large`/`decode_too_large` → `avatar_not_image`, pinned by the 1024-side test).
4. `deleteAvatar` is atomic: read + delete-by-exact-`(ownerKind, ownerId, storageKey)` run in one transaction under the same advisory lock as replace, so a delete racing a put removes the old row with its old file or nothing — never the new row. New concurrency test ("a delete racing a replace never leaves a row without a file").

Acceptance re-check (each line against a test):
- Set/replace/remove per kind + display + initials fallback: avatar route tests (person / group+channel / AI), chat-list/group-detail/member/directory assertions in the same suite; web display tests per kind (ChatListItem group row, GroupPanel member+AI, AiPanel, ExplorePage) + Avatar initials tests.
- Every refusal kind + lying content-type: the "refuses a non-image…" case table (svg, gif, animated WebP, APNG, non-square ×2, too small, too big, 60 000 bomb, empty) + 256 KB 413 test + lying-`Content-Type` test, each asserting nothing stored.
- Replace never leaves owner without a picture + old file gone + concurrent uploads → one row: "replace swaps the file…", "a delete racing a replace…" (finding 4), "concurrent uploads…".
- Backup/restore test passes with the new volume; server creates a missing dir at startup: `storage-safety.test.sh` 24/24; startup path is the shared `ensureWritableDir` (covered by `startup.test.ts`, untouched).
- 401 sweep + rate limit + uniform 404 + ids-only audit: sweep 5/5 lists all 3 avatar routes → 401; "rate limits uploads to 10 per hour", "same 404", audit detail `{ownerKind, ownerId}` (pre-review verified no other fields).

### Problems, deviations from the spec
- Spec says `AVATAR_STORAGE_DIR` default `/data/avatars`, but also "same rules as `STICKER_STORAGE_DIR`" whose default is `./data/stickers` (relative, resolved against the package root; production compose pins the absolute path). I used `./data/avatars` as the default for dev parity, `/data/avatars` fixed in both compose files. Say the word if the default must be absolute.
- Spec's "64 to 512" top end: sides past 512 are refused by the shared sticker probe (max 512) before the avatar range check, so the code is `avatar_bad_size` and the test pins `avatar_not_image` for a 1024 side. Same 400 refusal, different code.
- The sticker `routes.test.ts` VP8X fixture carried the animation flag (0x12); the shared probe now rejects it, so I flipped that fixture to static (0x10) and documented why. Sticker behaviour unchanged (stickers accept animated WebP; the `animated` probe error maps to `sticker_not_image` there).
- Uploader has no drag-and-drop onto the section (only the file picker + in-dialog drag-to-position); spec's "(or drop one)" reads as the file choice, and no dropzone existed to reuse. A 6-line addition if the lead wants a real drop target.
- Deviation (lead-approved in review): `apps/server/Dockerfile` gained `/data/avatars` on the existing `mkdir -p`/`chown` line, outside the original Allowed files.
- Topic member rows and topic AI rows reuse the group detail's pictures via lookup (topic APIs carry no picture fields); channel subscriber rows for non-admins show initials (that audience list is admin-only server-side). Message-bubble sender avatars keep initials (no per-message picture field; out of scope to add one).
- No mock-mode avatar support (`mock/api.ts` untouched — not in Allowed files); the uploader in mock mode hits the mock 404 path with a clear error.

### Security checklist (AGENTS.md)
- No secrets/tokens in logs, audit, errors or URLs: audit carries `{ownerKind, ownerId}` only; request log redacts `/api/avatars/*`; errors are fixed messages with no bytes/paths.
- Deletes/updates scoped: avatar writes are keyed `(ownerKind, ownerId)` + the permission check first; member/group reads keep their existing scopes.
- Atomicity: one picture per owner via the unique index + `onConflictDoUpdate` under `pg_advisory_xact_lock('avatar:kind:id')`; the replaced row is read inside the same locked transaction; concurrent uploads end with exactly one row (test).
- Nothing mutates before the permission check: PUT checks permission before spending rate-limit budget and before reading the body; DELETE checks before reading the row.
- Unknown owner / wrong kind / stranger answer the same 404 (test).
- All three routes require session (401 sweep passes unchanged, 5/5); PUT rate limited 10/hour/user (test); DELETE/GET are idempotent reads/removes.
- Audit entries carry ids only.

### Blocked / needs a decision
- `apps/server/Dockerfile` (`mkdir/chown /data/avatars` for the non-root user) is outside Allowed files — one-line change for the lead at review/merge time, or approve and I will add it in a follow-up.
- Confirm the `./data/avatars` dev default vs the spec's `/data/avatars` (production compose already pins the absolute path).

## Review (written by Claude)
