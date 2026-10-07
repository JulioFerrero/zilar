---
id: T-0460
title: "Backgrounds C (server): upload, list, serve (owner only) and delete background images; deleting clears prefs that use it"
status: merged
milestone: M5
branch: task/T-0460-server-background-images
model: auto
effort: low
depends_on: [T-0458]
estimate: 0.6 day
---

# T-0460: background image storage and routes

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §4 and §8, task C. T-0458 created the `chat_backgrounds` table and lets prefs point at an image id. This task adds the files and the routes. The pattern is the avatar code.

**A personal background image is readable by its owner only.** The group-background read for members comes later, in task F.

### Verified facts (do not re-derive)
- **Avatar pattern:**
  - `apps/server/src/avatars/service.ts`:
    - `extensionFor` and `avatarUrlFor` (lines 29-35);
    - `checkAvatarBytes` (lines 65-93) uses the shared probe and rejects animated images;
    - the upload (lines 164-240) writes a `randomUUID()` file, swaps the row inside a `pg_advisory_xact_lock` transaction, and removes the old file best-effort with `rm(..., { force: true })`.
  - `apps/server/src/avatars/routes.ts`:
    - `readCapped` (line 36);
    - PUT (lines 98-123): session, a permission check, the rate limiter, a content-length pre-check, then `readCapped`;
    - GET (lines 141-166): session, the same 404 for an unknown id or a missing file, and the headers `content-type`, `content-length`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'`, `cache-control: private, max-age=31536000, immutable` and `etag`.
- **The shared probe** is `probeStickerBytes(bytes)` in `apps/server/src/stickers/image.ts:264-282`. It caps bytes at `STICKER_MAX_BYTES` 512 KiB (line 8). `checkDimensions` (lines 143-156) caps each side at `STICKER_MAX_DIMENSION` 512 (line 9) and the decoded size at `STICKER_MAX_DECODED_BYTES` 4 MiB (line 12). A 2048 px wallpaper does not pass as-is.
- **Config and startup:**
  - `AVATAR_STORAGE_DIR` is at `apps/server/src/config.ts:68-72`;
  - `index.ts:105-108` runs `resolveStorageDir` and `ensureWritableDir`, and the dirs are listed for `warnOnContainerLayerStorage` at lines 116-119;
  - the avatars mount is at `apps/server/src/app.ts:445-456`, with the test override `avatarStorageDir` (lines 148 and 223).
- **Deploy:** `deploy/docker-compose.yml:148` sets `AVATAR_STORAGE_DIR: /data/avatars` on the `avatar-data` volume (line 213).
- **Schema:** `chatBackgrounds` (T-0458) has `id`, `userId`, `mime`, `width`, `height`, `bytes`, `storageKey`, `createdAt`. `chatPrefs` and `chatBackgroundDefaults` reference it with `ON DELETE set null`. A pref whose image is nulled **keeps its `backgroundDim`**, which then fails "Dim needs an image" on any later write (the T-0458 pre-review follow-up).

### What to build
1. **`apps/server/src/stickers/image.ts`:** give `probeStickerBytes` an optional second parameter `limits?: { maxBytes?: number; maxDimension?: number; maxDecodedBytes?: number }`, defaulting to today's constants. Thread it into `checkDimensions` and the PNG and WebP parsers. Sticker and avatar behaviour must not change.
2. **New `apps/server/src/backgrounds/service.ts`:**
   - **Constants:** `BACKGROUND_MAX_BYTES = 1024 * 1024`, `BACKGROUND_MAX_SIDE = 2048`, `BACKGROUND_MIN_SIDE = 64`, `BACKGROUND_MAX_PER_USER = 20`, and an upload rate of 20 per hour.
   - **`backgroundUrlFor(id)`** returns `/api/backgrounds/<id>`.
   - **`checkBackgroundBytes`:** the probe with `{ maxBytes: 1 MiB, maxDimension: 2048, maxDecodedBytes: 2048*2048*4 }`. Reject animated images and sides under 64.
   - **`uploadBackground(deps, userId, bytes)`:**
     - check the count under a `pg_advisory_xact_lock(hashtext('background:' + userId))` transaction; at the cap it gives 409 `too_many_backgrounds`;
     - write `<uuid>.<ext>` and insert the row;
     - on a DB failure, remove the file;
     - return `{ id, url, width, height }`.
   - **`listBackgrounds(db, userId)`** returns them newest first.
   - **`readBackgroundFile(deps, id, userId)`:** an unknown id, another user's image or a missing file all give `null`.
   - **`deleteBackground(deps, id, userId)`**, in one transaction:
     - update `chatPrefs` and `chatBackgroundDefaults` rows of that user that reference the id, setting `backgroundImageId = null` and `backgroundDim = null`;
     - delete `chatPrefs` rows of that user now back at all defaults (mutedUntil null, archived false, pinnedAt null, all three background fields null);
     - delete `chatBackgroundDefaults` rows with all three fields null;
     - delete the image row.

     After the commit, `rm` the file best-effort. An unknown or foreign id gives `false`.
3. **New `apps/server/src/backgrounds/routes.ts`,** `createBackgroundsRoutes({ auth, db, storageDir, now?, uploadLimiter? })`:
   - `POST /backgrounds`: a raw body with the avatar's content-length pre-check and `readCapped`, then 413, 400 or 409 errors with fixed messages. Returns 201 with JSON.
   - `GET /backgrounds` returns `{ backgrounds: [{ id, url, width, height, createdAt }] }`.
   - `GET /backgrounds/:id` serves the bytes with exactly the avatar GET headers. An unknown or foreign id gives the same 404 "Background not found".
   - `DELETE /backgrounds/:id` returns 204. An unknown or foreign id gives the same 404.
   - **Every route** requires a session.
4. **Config, startup and mount:**
   - `BACKGROUND_STORAGE_DIR` with default `./data/backgrounds`, next to `AVATAR_STORAGE_DIR`, with the same comment style;
   - `index.ts`: resolve and ensure it, and add it to `warnOnContainerLayerStorage`;
   - `app.ts`: mount it like the avatars, with a `backgroundStorageDir` test override.
5. **`deploy/docker-compose.yml`:** on `server`, set `BACKGROUND_STORAGE_DIR: /data/avatars/backgrounds`. It reuses the existing `avatar-data` volume, so no new volume is needed. Add a comment saying so.
6. **Tests:**
   - **New `apps/server/src/backgrounds/routes.test.ts`,** with a temp dir:
     - a 1200x800 PNG uploads and is served back with the headers;
     - another user gets 404 for it;
     - an animated WebP gives 400;
     - 3000 px gives 400 or 413;
     - over 1 MiB gives 413;
     - the 21st upload gives 409;
     - the list is newest first;
     - DELETE removes the file and the row;
     - a `chat_prefs` row with that image and dim 40 is reset (both fields null);
     - a pref row holding only that background is deleted;
     - a pref row that is also archived stays, with the background cleared;
     - the default row is cleared;
     - 401 when signed out.
   - **In `apps/server/src/stickers/image.test.ts`,** add one case: custom limits accept a 1024 px PNG that the default limits refuse.

### Read first
`AGENTS.md`, `docs/audit/chat-backgrounds-plan.md` §4 and §8, `apps/server/src/avatars/service.ts`, `apps/server/src/avatars/routes.ts`, `apps/server/src/avatars/routes.test.ts` (fixtures), `apps/server/src/stickers/image.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/db/schema.ts` (`chatBackgrounds`, `chatPrefs`, `chatBackgroundDefaults`), `apps/server/src/config.ts:60-75`, `apps/server/src/index.ts:95-125`, `apps/server/src/app.ts:140-230` and `:440-460`.

### Allowed files
`apps/server/src/stickers/image.ts`, `apps/server/src/stickers/image.test.ts`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/backgrounds/routes.ts`, `apps/server/src/backgrounds/routes.test.ts`, `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/index.ts`, `apps/server/src/app.ts`, `deploy/docker-compose.yml`, `work/T-0460-server-background-images.md`.

If any other test breaks (for example a config snapshot test), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot backgrounds stickers/image avatars
pnpm gate
```

### Acceptance
- Owners upload (still PNG or WebP, at most 1 MiB, 64-2048 px, at most 20 per user), list, read and delete their background images. Anyone else gets the same 404.
- Deleting clears `backgroundImageId` and `backgroundDim` everywhere they are used, and drops rows that end up all-default.
- Production stores the files on the existing avatar volume.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status: review.** Feature complete; `pnpm gate` ends `GATE PASS` (see below).
The first pass was blocked by the full-config snapshots in
`apps/server/src/config.test.ts`; the lead then added that file to the Allowed
files and I updated it (see the follow-up section).

### What I did
- `apps/server/src/stickers/image.ts`: added `StickerProbeLimits` and threaded an
  optional second `limits` parameter through `probeStickerBytes`, `parsePng`,
  `parseWebp` and `checkDimensions`. Unset fields keep today's sticker
  constants, so sticker and avatar behaviour is unchanged.
- New `apps/server/src/backgrounds/service.ts`: constants (`BACKGROUND_MAX_BYTES`
  1 MiB, `BACKGROUND_MAX_SIDE` 2048, `BACKGROUND_MIN_SIDE` 64,
  `BACKGROUND_MAX_PER_USER` 20, upload rate 20/hour), `backgroundUrlFor`,
  `checkBackgroundBytes` (wallpaper limits; rejects animated images and sides
  under 64), `uploadBackground` (count read + insert under
  `pg_advisory_xact_lock(hashtext('background:' + userId))`, file removed on
  failure), `listBackgrounds` (newest first), `readBackgroundFile` (unknown id,
  foreign id and missing file all return `null`) and `deleteBackground` (one
  transaction: nulls `backgroundImageId` + `backgroundDim` on the user's prefs and
  defaults, deletes rows back at all defaults, deletes the image row, then `rm`s
  the file best-effort; unknown/foreign returns `false`).
- New `apps/server/src/backgrounds/routes.ts`: `POST /backgrounds` (201; raw body
  with the avatar content-length pre-check + `readCapped`, 413/400/409),
  `GET /backgrounds`, `GET /backgrounds/:id` (exact avatar GET headers),
  `DELETE /backgrounds/:id` (204). Every route requires a session; unknown and
  foreign ids answer the same 404 "Background not found".
- `apps/server/src/config.ts`: `BACKGROUND_STORAGE_DIR` default
  `./data/backgrounds`, next to `AVATAR_STORAGE_DIR`.
- `apps/server/src/index.ts`: resolve + `ensureWritableDir` for it, and add it to
  `warnOnContainerLayerStorage`.
- `apps/server/src/app.ts`: `backgroundStorageDir` / `backgroundNow` /
  `backgroundUploadLimiter` test overrides and the route mount.
- `deploy/docker-compose.yml`: `BACKGROUND_STORAGE_DIR: /data/avatars/backgrounds`
  with a comment that it reuses the existing `avatar-data` volume.
- `apps/server/src/stickers/image.test.ts`: one case — a 1024 px PNG refused by
  the default limits is accepted with custom limits.
- `apps/server/src/backgrounds/routes.test.ts`: the 13 cases listed in the spec.
- `apps/server/src/config.test.ts`: added `BACKGROUND_STORAGE_DIR` to the two
  full-config `toEqual` expectations and a defaults/parse/empty test mirroring
  the avatar one.

The plan section §8.4 says a personal background image is read by its owner only
(not a capability URL, unlike avatars); the read route is scoped to
`row.userId === user.id` accordingly.

### Commands I ran (real results)
- `pnpm install` — Done; `pnpm-lock.yaml` unchanged.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot backgrounds stickers/image avatars`
  — **3 files passed, 46 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot config.test`
  — **3 files passed, 67 tests passed** (before the `config.test.ts` fix the two
  full-config snapshots failed, each missing the new key).
- `pnpm gate` summary lines:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (13.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (6.9s)
  PASS  tests @zilar/server  (237.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (The first `pnpm gate` of the session stopped at `format`; after
  `prettier --write` on the files it flagged, later runs reached the tests.
  Before the `config.test.ts` fix the gate was red only on those two snapshots.)

### Follow-up after the blocked report
The lead approved option 1 and added `apps/server/src/config.test.ts` to the
Allowed files. I added `BACKGROUND_STORAGE_DIR: './data/backgrounds'` to the two
full-config `toEqual` expectations and a defaults/parse/empty test mirroring the
`AVATAR_STORAGE_DIR` one. No other file changed.

### Acceptance status
- Upload / list / read / delete, owner-only 404, caps and formats: implemented,
  covered by the passing focused tests.
- Delete clears `backgroundImageId`/`backgroundDim` and drops all-default rows:
  implemented, covered by the passing focused tests.
- Production stores files on the existing avatar volume: compose updated.
- `pnpm gate` ends `GATE PASS` with no out-of-scope files: **yes** — the scope
  line reports every changed file inside the Allowed files.

## Review (written by Claude)

Approved (lead, 2026-10-07). Routes POST, GET (list), GET :id and DELETE :id under /backgrounds, all with a session. Reads and deletes are scoped by (id, userId), with the same 404. Images are still PNG or WebP, at most 1 MiB, 64-2048 px, 20 per user, with the cap held under an advisory lock. Delete nulls the image id and dim on prefs and defaults and drops all-default rows. The probe got optional limits; sticker and avatar behaviour is unchanged. Production uses BACKGROUND_STORAGE_DIR=/data/avatars/backgrounds on the existing volume. Lead widened Allowed files for config.test.ts. Nits accepted: the write sits inside the transaction, the etag uses the raw param, and the missing-file 404 is untested.
