---
id: T-0191
title: Mobile: sticker pack editor (create, rename, visibility, add and remove stickers, delete)
status: merged
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

### What I did
Built the mobile sticker pack editor per the spec and brief §1-9:
- `lib/stickers.ts`: `StickerPack` gains optional `ownerId`, `visibility`, `importedFrom`.
- `lib/stickers-api.ts`: `parseStickerPack` reads the new fields (wrong types ignored, pack still returned); `StickersApi` + real client gain `createStickerPack`, `patchStickerPack`, `deleteStickerPack` (returns `{ warning }`), `deletePackSticker`, `uploadStickerFile` (raw binary POST, `content-type` = image type, percent-encoded `x-emoji`, errors become `StickersApiError` with `status`/`code`). The binary upload is an injected seam defaulting to the `expo-file-system` binary upload, so tests never touch native modules.
- `components/stickers/sticker-native.ts` (new): picker (multi-select, images only, no editing), preparer (fit inside 512x512, WebP quality steps `[0.92, 0.8, 0.7, 0.6, 0.5]` then one PNG try; a WebP throw goes straight to PNG), size reader — all injectable like `avatar-native.ts`.
- `components/stickers/pack-editor.ts` (new): pure helpers — count, fit-take, row/form error sentences (brief §6 verbatim), `512 x 380 px, 94 KB` size line, lookup-kind split, and the `runSavePack` loop (create-first-once, then patch, deletions, sequential uploads; partial failure keeps per-row Retry and the created id via `onCreated`).
- `app/settings/sticker-pack.tsx` (new): editor screen, create mode without `id`, edit mode with `?id=`, all brief copy/states/modals (name, visibility radios with imported lock, grid + add tile, new-sticker rows with emoji wells, progress line, Save/Cancel, delete section, discard modal).
- `app/settings/stickers.tsx`: `New pack` pill in the My packs heading row; `Edit` pill + `Private`/`Shared`/`Imported` subtitle on packs whose `ownerId` equals `me.id`. Nothing else changed.
- `stickers-mock.ts`: mock gains the five editor methods backed by in-memory state (uploads kept, 120-cap enforced with `pack_full`).

### Files changed
`apps/mobile/src/lib/stickers.ts`, `apps/mobile/src/lib/stickers-api.ts`, `apps/mobile/src/lib/stickers-api.test.ts`, `apps/mobile/src/components/stickers/stickers-mock.ts`, `apps/mobile/src/components/stickers/stickers-mock.test.ts`, `apps/mobile/src/components/stickers/sticker-native.ts` (new), `apps/mobile/src/components/stickers/sticker-native.test.ts` (new), `apps/mobile/src/components/stickers/pack-editor.ts` (new), `apps/mobile/src/components/stickers/pack-editor.test.ts` (new), `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (new), `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx` (new), `apps/mobile/src/app/settings/stickers.tsx`, this task file.

### Commands and real results
- `pnpm install`: ok (10.3s). It touched `pnpm-lock.yaml` (added `bufferutil` peer); I reverted that file since it is outside Allowed files.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers sticker-pack sticker-native pack-editor`: 11 files, 101 tests, all passed.
- `pnpm gate` from repo root: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- Single tests I ran while working: `stickers-api.test.ts` + `pack-editor.test.ts` + `sticker-native.test.ts` (36 passed), then `pack-editor.test.ts` alone after adding the save loop (11 passed), then the sticker-pack screen test file (7 passed).

### Problems / deviations
- `accessibilityRole="status"` is not a valid RN role, so the upload-progress line uses `accessibilityLiveRegion="polite"` on a wrapping View instead (same as `handle-field.tsx`).
- The editor loads via `useFocusEffect` (not `useEffect`) to satisfy the `set-state-in-effect` lint rule and to match `stickers.tsx`; the brief's focus-reload note still holds.
- Preparer accepts the first WebP save when the size reader returns `undefined` (unknown size is not an empty file), mirroring the avatar flow.
- The save `onRow` callback reuses its `error` param to carry the uploaded sticker id on the `uploaded` path (typed, no `any`).
- Screen tests drive `sticker-pack.tsx` through a `useState`-forcing mock (the `stickers-screen.test.tsx` pattern); save orchestration itself is tested directly against `runSavePack` plus the mock.

### Security checklist
- Bearer token only in request headers, never logged; error lines show only the brief's fixed sentences, never server text.
- No deletes/updates outside the pack id scope; no new routes, no caps implemented client-side beyond the 120-fit take (server enforces `pack_limit`/`pack_full` atomically).
- No secrets read or committed; no checks disabled.

### Blocked / needs a decision
None.

### Round 2 (fix round, PREREVIEW.md: must-fix=1, should-fix=0, nit=4)
- Finding 2 (must-fix, stuck retry after partial save): fixed. The deletion loop in `runSavePack` now treats a 404/`not_found` delete as success (the sticker is already gone), so a retry after a partial save converges; other delete errors still fail the save and are retried. Decision recorded: treat-404-on-delete-as-success (the PREREVIEW's first option).
- Findings 1, 3, 4, 5 are nits on lines outside this fix: left untouched per instructions.
- Tests added: `pack-editor.test.ts` — "treats a 404 delete as success so a retry after a partial save converges" (delete throws 404 `not_found`, outcome ok, `onRemovedFlushed` runs).
- Single tests: `src/components/stickers/pack-editor.test.ts`: 12 passed.
- `pnpm gate` from repo root: PASS install (frozen), PASS format, PASS lint, PASS typecheck, PASS tests @zilar/mobile, scope clean, GATE PASS.

### Round 3 (fix round, PREREVIEW.md: must-fix=1, should-fix=2, nit=2)
- Finding 1 (must-fix, removing an uploaded new row orphans it on the server): fixed. `removeFresh` in `sticker-pack.tsx` now queues any removed row that already has a `stickerId` into `removedIds` (both modes, matching web `PackEditor.removeItem`), and `runSavePack` in `pack-editor.ts` runs the deletion loop in create-mode retries too (previously edit-only), so the next Save deletes it. The fire-and-forget `deletePackSticker(...).catch(() => undefined)` is gone.
- Finding 2 (should-fix, create-mode button never reads `Save` after a partial save): fixed. `runSavePack` returns `created` on the partial outcome as well; the screen stores it in `createdPackIdRef`/`createdTitleRef`/`createdVisibilityRef` plus a `createdPackId` state, and the label/`changed`/`saveDisabled` now derive from `isCreate = packId === undefined && createdPackId === undefined`, so the button reads `Save` after the first partial save (brief §5). State (not a ref read during render) so the `react(refs)` lint rule holds.
- Finding 3 (should-fix, no test for the delete-with-warning-modal flow): fixed. Screen tests now cover the verbatim §8 modal body (`The pack and its files are deleted. ... no longer loads a sticker.`) and the failure sentence (`Could not delete the pack. Try again.`); the flow itself runs through a new `runDeletePack` helper in `pack-editor.ts` (success -> close + back, failure -> fixed sentence, modal stays open), covered by two `runDeletePack` unit tests.
- Finding 4 (nit, fail-open editor load gate): fixed within the touched `load` block — a pack with an `ownerId` now shows `forbidden` even while `me` is still `null` (one-line condition change, same line already edited).
- Finding 5 (nit, mock pack id reuse): fixed. `createStickerPack` in `stickers-mock.ts` mints from a monotonic `mockPackCounter` instead of `panel.length + 1`, plus a `create-delete-create never collides` test.
- Tests added: `pack-editor.test.ts` — "returns the created pack on a partial failure so the retry keeps one pack", "deletes a removed upload on the create-mode retry instead of orphaning it", `runDeletePack` success/failure; `sticker-pack-screen.test.tsx` — verbatim delete warning modal, delete-failure sentence; `stickers-mock.test.ts` — fresh id after delete.
- Single tests: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers sticker-pack sticker-native pack-editor`: 11 files, 109 passed.
- `pnpm gate` from repo root: PASS install (frozen), PASS format, PASS lint, PASS typecheck, PASS tests @zilar/mobile, scope clean, GATE PASS.
- Disagreements: none.

### Lead round (fix round, PREREVIEW.md: should-fix=2, nit=0)
- Finding 1 (should-fix, picker errors are silent): fixed. The Add handler in `sticker-pack.tsx` now routes a `{ status: 'error', message }` picker result into `setFormError(result.message)` (the `DENIED_MESSAGE` / `PICK_FAILED_MESSAGE` from `sticker-native.ts`), which renders in the existing `formError` line. `cancelled` still shows nothing.
- Finding 2 (should-fix, visibility radios use literal colours): fixed. Both radio `Pressable`s now use theme classes (`border-border-strong bg-surface-raised` when selected, `border-border bg-surface` otherwise); `style` keeps only `opacity`. `grep -n "#[0-9a-fA-F]\{6\}" apps/mobile/src/app/settings/sticker-pack.tsx` prints nothing.
- Tests added: `sticker-pack-screen.test.tsx` — "shows the picker denied sentence after Add fails" (error picker result -> exact `Zilar needs access...` sentence shown) and "shows no form sentence when the picker is cancelled". Test note: the picker seam is captured through the Add tile's `onPress` (the `Pressable` mock), and the `vi.mock` factory cannot close over module-scope state, so the forced result is synced via `globalThis.__forcedPickerResult`.
- The Add handler also snapshots `activePicker`/`activePreparer`/`slotsLeft` into locals so the pressed callback cannot read a stale closure.
- Single tests: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers sticker-pack sticker-native pack-editor`: 11 files, 111 passed.
- `pnpm gate` from repo root: PASS install (frozen), PASS format, PASS lint, PASS typecheck, PASS tests @zilar/mobile, scope clean, GATE PASS.
- Disagreements: none.

## Review (written by Claude)

**Verdict:** Approved after two automatic rounds and one lead round. The phone gets the sticker pack editor (`/settings/sticker-pack`): name, Private or Shared on this server, add stickers (prepared to WebP or PNG within 512 px and 512 KiB), remove, save, delete, opened from `New pack` and from a pack's Edit on the Stickers screen. The lead round fixed what the automatic rounds missed: a denied or failed photo picker now shows its sentence instead of doing nothing, and the visibility radios use theme classes instead of literal hex (no hex left in the file). Emulator (AVD galena, signed in as the test user, live server): `pnpm phone:smoke` PASS on both routes, but its screenshots only showed the boot spinner because the emulator's DNS had failed; after a restart with working DNS the lead opened Stickers, then New pack, and checked the screen against the brief (header, name field, the two radios with icons, sticker grid with the dashed Add tile and `0 / 120`, the format hint, Create pack disabled until valid, Cancel) and that tapping Shared moves the selection and the raised background. Picking real images was not tested (no images on the emulator). Accepted nits: two mock and hygiene points from the last pre-review.
