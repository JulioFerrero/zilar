---
id: T-0191
title: Mobile: sticker pack editor (create, rename, visibility, add and remove stickers, delete)
status: planned
milestone: M5
branch: task/T-0191-mobile-sticker-editor-telegram
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0187]
estimate: 1.5 day
---

# T-0191: Mobile sticker pack editor

## Spec (written by Claude, do not edit)

### Why
Julio's product direction: people make their own sticker packs. Web has `PackEditor`; the phone can only add, remove and reorder packs (T-0187). Julio, 2026-10-03: "implement all the features we have in web into the mobile app". The Telegram import is a separate task (T-0207) that comes after this one.

### Design
Follow `docs/design/briefs/T-0191-sticker-editor.md` exactly for layout, sizes, icons, copy, states and error sentences. Where this spec and the brief disagree, the spec wins.

### Verified facts (do not re-derive)
- Web client (`apps/web/src/lib/api.ts`): `createStickerPack({ title, visibility? })` POST `/sticker-packs` (line 1372); `patchStickerPack(id, { title?, visibility?, order? })` PATCH `/sticker-packs/:id` (line 1505); `deleteStickerPack(id)` DELETE `/sticker-packs/:id` returning `{ warning }` (line 1516); `deletePackSticker(packId, stickerId)` DELETE `/sticker-packs/:id/stickers/:stickerId` returning `{ ok }` (line 1526); `uploadStickerFile(packId, blob, emoji?)` POST `/sticker-packs/:id/stickers` with the RAW bytes as body, `Content-Type` = the image type, optional header `x-emoji` = `encodeURIComponent(emoji)`, returning one sticker (line 1541). The web pack shape is `stickerPackSchema` (line 1347): `id, ownerId, title, visibility ('private'|'server'), importedFrom?, stickers, createdAt, updatedAt`.
- Server (`apps/server/src/stickers/`): only `image/webp` and `image/png` are stored, at most 512 KiB and 512 px per side (`image.ts` lines 8-9); 100 packs per person (`pack_limit`), 120 stickers per pack (`pack_full`) (`service.ts` lines 20-21); error codes `sticker_too_large` (413), `sticker_empty`, an unsupported-file code from `probeErrorCode`, `imported_private`, `not_found`. Creating a pack also puts it on the creator's panel (same transaction), so do nothing extra. There is NO route to get one pack by id: the editor finds it in `listStickerPacks()` by id (the panel list); not found there means "This pack was not found."
- The web prepares each image before upload (`apps/web/src/lib/sticker-images.ts`): fit inside 512 x 512 keeping the ratio, encode WebP at quality steps `[0.92, 0.8, 0.7, 0.6, 0.5]` until it is at most 512 KiB, then one PNG try. Mirror this on the phone with `expo-image-manipulator` (`manipulateAsync` with `resize` and `{ format: SaveFormat.WEBP, compress: q }`, then `SaveFormat.PNG`); if a WEBP save throws, go straight to the PNG try.
- Mobile today: `StickerPack` in `apps/mobile/src/lib/stickers.ts` (lines 10-14) has only `id, title, stickers`; `parseStickerPack` in `apps/mobile/src/lib/stickers-api.ts` (line 80) builds it; `StickersApi` (line 102) lists the client functions; the mock is `apps/mobile/src/components/stickers/stickers-mock.ts`; the Stickers screen is `apps/mobile/src/app/settings/stickers.tsx` (My packs heading at line 322, the row `Remove` at line 376, colors from `@/lib/colors` as `ICON[scheme]`, `ACCENT[scheme]`, `MUTED_FOREGROUND[scheme]`, `FOREGROUND[scheme]`).
- The avatar flow is the pattern to copy for picking, resizing, size reading and binary upload: `apps/mobile/src/components/settings/avatar-native.ts` (transcoder lines 94-112, `createAvatarSizeReader` lines 114-127 with `LegacyFileSystem.getInfoAsync`, picker from line 130 with `ImagePicker.launchImageLibraryAsync`, uploader `createAvatarFileUploader` from line 211: `new File(uri).upload(url, { httpMethod, uploadType: UploadType.BINARY_CONTENT, headers: { 'content-type', authorization: 'Bearer ' + token } })`), and its test `apps/mobile/src/components/settings/avatar-native.test.ts` shows how to mock `expo-image-manipulator`.
- The signed-in user is `useAuthStore((state) => state.me)`, with `me.id` (`apps/mobile/src/app/settings/index.tsx` line 58).

### What to build
1. `StickerPack` gains optional `ownerId?: string`, `visibility?: 'private' | 'server'`, `importedFrom?: string`; `parseStickerPack` reads them when present (wrong types are ignored, the pack is still returned). The sticker panel keeps working unchanged.
2. `StickersApi` + the real client + the mock gain: `createStickerPack`, `patchStickerPack`, `deleteStickerPack` (returns the warning), `deletePackSticker`, and `uploadStickerFile(packId, file: { uri: string; mimeType: 'image/webp' | 'image/png' }, emoji?: string)` (POST, raw binary, headers as on web; errors become the module's error class with `status` and `code`). Put the native upload, the picker (multi-select, images only, no editing) and the preparation (section above) in a new `apps/mobile/src/components/stickers/sticker-native.ts`, injectable like `avatar-native.ts` so tests never touch native modules. The mock keeps uploads in memory.
3. `apps/mobile/src/app/settings/sticker-pack.tsx`: the editor of the brief, create mode without `id`, edit mode with `?id=`. Edit order on Save: patch title/visibility, then deletions, then uploads one by one (web order). Create mode: create first; on partial upload failure keep the created pack id so a retry never creates a second pack.
4. `stickers.tsx`: the `New pack` pill in the My packs heading row, and the `Edit` pill plus the `Private`/`Shared`/`Imported` subtitle on packs whose `ownerId` equals `me.id` (brief section 1). Nothing else on that screen changes.
5. Tests (Vitest): the API additions (paths, methods, headers incl. percent-encoded `x-emoji`, error mapping); the preparation steps (WebP steps then PNG, a too-big result is an error, a WEBP throw falls back to PNG) with a mocked manipulator and size reader; the editor (create with two images, edit rename, remove a saved sticker on Save, a failed upload shows Retry and does not create a second pack, delete with the warning modal, every error code maps to the brief's sentence); the Stickers screen shows `Edit` only on your own packs.

### Read first
`AGENTS.md`, `docs/design/briefs/T-0191-sticker-editor.md`, `docs/design/ui-style.md`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/stickers.ts` (lines 1-40), `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/settings/avatar-native.ts`, `apps/web/src/components/PackEditor.tsx`, `apps/web/src/lib/sticker-images.ts`.

### Allowed files
`apps/mobile/src/lib/stickers.ts`, `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/stickers-api.test.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/stickers/stickers-mock.test.ts`, `apps/mobile/src/components/stickers/sticker-native.ts` (new), `apps/mobile/src/components/stickers/sticker-native.test.ts` (new), `apps/mobile/src/components/stickers/pack-editor.ts` (new, pure helpers if you need them), `apps/mobile/src/components/stickers/pack-editor.test.ts` (new), `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (new), `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx` (new), `apps/mobile/src/app/settings/stickers.tsx`, `work/T-0191-mobile-sticker-editor-telegram.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers sticker-pack sticker-native pack-editor
pnpm gate
```
The lead checks the screens on the Android emulator (`pnpm phone:smoke`) before merging.

### Acceptance
- A pack can be created with photos from the library, renamed, switched between private and shared, have stickers removed and added, and be deleted after the warning; imported packs cannot be shared.
- Every image is prepared to the server's limits before upload; every error shows the brief's fixed sentence, never server text.
- No emoji in app chrome, no new dependency, no server change; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The Telegram import (T-0207), reordering stickers inside a pack, editing the emoji of a saved sticker, `addStickerFavorite`.

---

## Report (written by the worker when done)

## Review (written by Claude)
