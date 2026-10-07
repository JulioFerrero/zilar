---
id: T-0460
title: "Backgrounds C (server): upload, list, serve (owner only) and delete background images; deleting clears prefs that use it"
status: todo
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
`apps/server/src/stickers/image.ts`, `apps/server/src/stickers/image.test.ts`, `apps/server/src/backgrounds/service.ts`, `apps/server/src/backgrounds/routes.ts`, `apps/server/src/backgrounds/routes.test.ts`, `apps/server/src/config.ts`, `apps/server/src/index.ts`, `apps/server/src/app.ts`, `deploy/docker-compose.yml`, `work/T-0460-server-background-images.md`.

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

## Review (written by Claude)
