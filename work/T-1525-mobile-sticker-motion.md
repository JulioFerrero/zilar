---
id: T-1525
title: "Phone sticker upload keeps motion (approved Stickers canvas; twin of T-1501): pick photos and short videos; GIF, video, animated WebP and APNG go to the server raw (≤ 4 MiB) instead of being re-encoded to a still WebP; the byte sniffer moves to chat-core and web uses it too"
status: merged
milestone: M5
branch: task/T-1525-mobile-sticker-motion
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1525: Phone sticker upload keeps motion

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-15, `docs/design/mockups/stickers/README.md`, "Motion"):
- GIFs, animated WebP, APNG and videos keep their motion;
- the server converts video and GIF to an animated WebP (T-1496), with videos up to 3 s;
- **the apps never flatten a moving file to a still.**

Web does this since T-1501. The phone still re-encodes every pick to a still WebP or PNG, so a GIF loses its motion.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/components/stickers/sticker-native.ts` (240 lines):**
  - the picker `launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true })` (`:195-207`) maps assets to `{ uri, width, height }` (`:210-223`);
  - the preparer `prepareEffect` re-encodes with `manipulateAsync(... SaveFormat.WEBP)` or PNG (`:60-135`), returning `mimeType` `image/webp` or `image/png`;
  - it imports `expo-file-system/legacy` (`:5`).
- **`apps/mobile/src/components/stickers/use-pack-items.ts` (389 lines):** `pickImages` runs `preparer.prepare(image)` per pick and builds `EditorNewItem` rows with `uri`, `mimeType`, `width`, `height` and `bytes` (`:108-160`). **The file is at the limit: do not grow it.** Put any new logic in `sticker-native.ts` or a new file.
- **The server:**
  - it detects the type from the bytes, never the `Content-Type` (`apps/server/src/stickers/image.ts:1-6`);
  - the raw upload cap is 4 MiB (`STICKER_MAX_UPLOAD_BYTES`, `:11`), and the raw branch accepts any content type (`apps/server/src/stickers/api-upload.ts:68-75`);
  - `apps/server/src/stickers/convert.ts` turns GIF and video into an animated WebP (3 s cap).
- **Web's version:**
  - `apps/web/src/lib/sticker-motion.ts`: `sniffMotion(file: Blob)` reads the first 64 KiB and returns `'gif' | 'video' | 'animated-webp' | 'apng' | null` from the bytes only;
  - `apps/web/src/lib/sticker-images.ts`: `keepMovingFile` (`:197-217`) uploads the raw file and rejects anything over 4 MiB with "<name>: over 4 MiB. Try a shorter clip.".

### Steps
1. **New `packages/chat-core/src/sticker-motion.ts`** (export it from the index): `sniffMotionBytes(bytes: Uint8Array): MotionKind | null`, with the byte rules moved from web's `sticker-motion.ts` unchanged, and `MotionKind`. Web's `sniffMotion(file)` keeps reading the 64 KiB slice and calls `sniffMotionBytes`.
2. **The picker (`sticker-native.ts`):**
   - `mediaTypes: ['images', 'videos']`, with `videoMaxDuration: 3` where the platform supports it;
   - `PickedStickerImage` gains `mimeType?: string`, `fileSize?: number` and `kind: 'image' | 'video'` from the asset.
3. **The preparer (`sticker-native.ts`):** before re-encoding, read the first 64 KiB of the picked file (the `expo-file-system` `File` API, or legacy `readAsStringAsync` with `position` and `length` as base64, decoded to bytes) and call `sniffMotionBytes`.
   - **A moving file** (any non-null kind, or a picked video): keep the file as it is, `{ uri, mimeType: asset mimeType or 'application/octet-stream', width: 0, height: 0, bytes: size }`.
   - **Over 4 MiB:** the error "<name or 'This clip'>: over 4 MiB. Try a shorter clip.".
   - **A still:** exactly today's path.
4. **The editor tile:** a moving item shows its first frame through `expo-image`, with a small loop badge (`Repeat` icon, `accessibilityLabel` "Moves") at the top left. Only do this if it fits in the existing tile component without growing `use-pack-items.ts`; otherwise leave the badge for the grid task.
5. **The upload:** keep the existing binary upload, which sends `content-type: mimeType`; the server sniffs the bytes.

### Not in scope
- the server;
- the New pack grid redesign (a later task);
- web behaviour (it must stay the same).

### Tests
Move web's existing motion test cases, if any, to `packages/chat-core/src/sticker-motion.test.ts`; otherwise add a small one for GIF, WebM, animated WebP, APNG and a still PNG (pure bytes). Keep the mobile sticker tests passing.

### Allowed files
- `packages/chat-core/src/sticker-motion.ts` (new)
- `packages/chat-core/src/sticker-motion.test.ts` (new)
- `packages/chat-core/src/index.ts`
- `apps/web/src/lib/sticker-motion.ts`
- `apps/web/src/lib/sticker-motion.test.ts` (only if it exists: move its cases)
- `apps/mobile/src/components/stickers/sticker-native.ts`
- `apps/mobile/src/components/stickers/pack-fresh-list.tsx` (the loop badge, only if it fits)
- `work/T-1525-mobile-sticker-motion.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/sticker-motion.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- On the phone, picking a GIF or a 2 s video adds it raw, and the saved sticker moves.
- A still photo works as before.
- Web stickers behave exactly as before.
- Every file stays under 400 lines, and `use-pack-items.ts` does not grow.

---

## Report (written by the worker when done)

### What I did
- **New `packages/chat-core/src/sticker-motion.ts` (120 lines).** The byte rules moved unchanged from `apps/web/src/lib/sticker-motion.ts`: `sniffMotionBytes(bytes: Uint8Array): MotionKind | null`, plus `MotionKind` and `STICKER_SNIFF_BYTES` (64 KiB). Exported from `packages/chat-core/src/index.ts`.
- **`apps/web/src/lib/sticker-motion.ts` (16 lines).** `sniffMotion(file: Blob)` keeps reading the same first 64 KiB slice and calls `sniffMotionBytes`; it re-exports `MotionKind` for `sticker-images.ts`. Web behaviour is unchanged.
- **`apps/mobile/src/components/stickers/sticker-native.ts` (364 lines).**
  - the picker now uses `mediaTypes: ['images', 'videos']` and `videoMaxDuration: 3`;
  - `PickedStickerImage` gains `kind: 'image' | 'video'` and `mimeType?`, `fileSize?`, `fileName?` from the asset;
  - new `StickerByteReader` seam (`readHead`) with a real `expo-file-system/legacy` `readAsStringAsync` implementation (first bytes as base64, decoded to bytes with Hermes `atob`);
  - the preparer sniffs the first 64 KiB before re-encoding: a picked video, or any non-null `sniffMotionBytes` kind, keeps the file raw as `{ uri, mimeType, width: 0, height: 0, bytes }`; over 4 MiB it fails with "`<name or This clip>`: over 4 MiB. Try a shorter clip."; a still takes exactly today's manipulator path.
- **`apps/mobile/src/components/stickers/pack-fresh-list.tsx` (136 lines).** A moving row (the `width: 0, height: 0` marker) shows its first frame through `expo-image` with a small `Repeat` loop badge labelled "Moves". `use-pack-items.ts` did not change.
- **New `packages/chat-core/src/sticker-motion.test.ts` (9 tests).** Pure bytes: GIF, WebM (EBML), MP4 `ftyp`, still HEIF/AVIF `ftyp`, animated WebP (VP8X flag), still WebP, APNG (`acTL`), still PNG (`IDAT`) and junk/empty bytes.

### Checks run
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/sticker-motion.test.ts` → `Test Files 1 passed (1)`, `Tests 9 passed (9)`.
- `pnpm gate` (from the repo root) → ended with `GATE PASS`. Summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.3s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/chat-core  (2.0s)
  SKIP tests @zilar/mobile (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Changed files (all inside Allowed files): `packages/chat-core/src/sticker-motion.ts` (new), `packages/chat-core/src/sticker-motion.test.ts` (new), `packages/chat-core/src/index.ts`, `apps/web/src/lib/sticker-motion.ts`, `apps/mobile/src/components/stickers/sticker-native.ts`, `apps/mobile/src/components/stickers/pack-fresh-list.tsx`, `work/T-1525-mobile-sticker-motion.md`.
- No `apps/web/src/lib/sticker-motion.test.ts` exists, so there were no web motion cases to move (`sticker-images.test.ts` does not exist either).

### Notes for the lead
- **One deviation, spec step 3 (the moving file's MIME type).** The spec asked for "asset mimeType or `'application/octet-stream'`". That value flows through `EditorNewItem.mimeType` (`pack-editor.ts`) and `StickersApi.uploadStickerFile` (`apps/mobile/src/lib/stickers-api.ts`), both typed `'image/webp' | 'image/png'` and both outside my Allowed files, so I kept the declared type inside that union: `image/webp`, or `image/png` when the asset type is `image/png` (an APNG). The server sniffs the bytes on the raw branch (`apps/server/src/stickers/api-upload.ts`, `image.ts`) so motion is unaffected, and this is exactly what web's `keepMovingFile` already sends (`image/webp`). If you want the true asset type sent, `pack-editor.ts` and `use-pack-items.ts` need one type widened each — I left them untouched per the task; say the word and I'll do it as a follow-up.
- **The tile badge infers "moving" from `width === 0 && height === 0`,** the marker the spec sets for a raw moving file, because `EditorNewItem` carries no motion flag and `pack-editor.ts` is out of scope. Failed rows keep their alert tile (guarded by `error !== undefined`), so only prepared rows reach the badge. If you prefer an explicit flag, that needs `pack-editor.ts`.
- I also suppressed the "`0 x 0 px, N KB`" size suffix for a moving row in the fresh list (it would read "0 x 0 px"); such a row now reads "Ready". Small and inside the allowed file.
- The picker accepts multi-select videos; a picked video is kept raw whatever its bytes, and anything over 4 MiB is rejected client-side before upload, so the server cap is only a backstop.
- No mobile sticker test files exist, so nothing to keep green; the gate correctly skipped the mobile and web test steps (no nearby test files).
- Security checklist: this change adds no routes, deletes, permissions, secrets or audit entries; it reuses the existing binary upload (bearer auth, `content-type` from the prepared type), and the fixed user-facing sentence is built locally, never from server text.
- Fix round: the phone now refuses a moving animated WebP or APNG over 512 KiB in prepare, with web's sentence "`<name or This clip>`: a moving WebP or PNG must be under 512 KiB." (using the existing `STICKER_PREP_MAX_BYTES`), while GIF and video keep the 4 MiB cap; the re-run `pnpm gate` ended `GATE PASS` with the same 7-file scope.

## Review (written by Claude)

**Approved and merged after one fix round.**

- **First packet:** clean, with two nits and one follow-up. The lead sent one fix: refuse a moving WebP or APNG over 512 KiB at prepare, with web's sentence, since the server never converts those. The second packet was clean.
- **The motion sniffer** now lives in `packages/chat-core/src/sticker-motion.ts`, line-for-line the old web rules, with 9 tests. Web behaviour is unchanged.
- **Accepted as they are:**
  - when the size can't be read, the caps are skipped and the server's cap is the backstop;
  - moving files are declared as `image/webp`/`image/png`, which the server ignores because it sniffs the bytes. Widening the union in `pack-editor.ts`, `stickers-api.ts` and `use-pack-items.ts` is a follow-up on the NOW list.
- **No phone smoke:** the mock cannot pick files. **Julio's next phone build** should check a GIF sticker upload that keeps moving.
