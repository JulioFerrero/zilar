---
id: T-1501
title: "Web sticker upload keeps motion (approved Stickers canvas): GIF, WebM, MP4 and MOV go to the server raw for conversion, animated WebP and APNG go as they are, never flattened to a still"
status: merged
milestone: M5
branch: task/T-1501-web-sticker-motion
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1501: Web sticker upload keeps motion

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers design on 2026-10-15 (`docs/design/mockups/stickers/README.md`, section "Rules the design set"). Its rules: GIFs, animated WebP, APNG and short videos keep their motion, and "the apps never flatten a moving file to a still".

The server already converts GIF and video to an animated WebP (T-1496). The web editor, though, still draws every picked file on a canvas, so a GIF becomes its first frame, and it does not accept videos at all. This task makes the web editor send moving files as they are.

The New pack grid redesign is a later task. **Keep today's row layout.**

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/lib/sticker-images.ts` (246 lines):**
  - `:1-11` says every file is decoded with `createImageBitmap` ("a GIF decodes to its first frame: a still") and encoded on a canvas.
  - `:19-24` `STICKER_PREP_ACCEPTED_TYPES` (png, jpeg, webp, gif);
  - `:26` `StickerPrepMime`;
  - `:64-70` `PrepResult`;
  - `:136-141` `prepareStickerImage`;
  - `:143-185` `prepareEffect` (type check `:146`, decode `:155`, size fit `:169`, encode stages `:176`);
  - `:191-238` `encodeStages`;
  - `:241-246` `formatStickerSize`.
- **`apps/web/src/components/sticker/packEditorModel.ts`:**
  - `:15-31` `PackEditorItem` (`mime` at `:22` is `'image/webp' | 'image/png'`);
  - `:50` `PACK_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'`;
  - `:100-128` `prepareItem` copies a `PrepResult` into an item.
- **`apps/web/src/components/sticker/BlobPreview.tsx:11-35`** always renders an `<img>`.
- **`apps/web/src/components/sticker/PackEditorItems.tsx:75-104`:** the row tile (`BlobPreview` at `:78`) and the size line (`formatStickerSize` at `:102`).
- **Upload:** `apps/web/src/lib/api/stickers.ts:177` `uploadStickerFile` sends the blob's raw bytes. `apps/web/src/components/sticker/usePackSave.ts:171-178` puts a failed upload's error message on the row.
- **Server:**
  - `apps/server/src/stickers/storage.ts:219-226` accepts up to 4 MiB raw (`STICKER_MAX_UPLOAD_BYTES`, `apps/server/src/stickers/image.ts:11`), then converts GIF, WebM and MP4/MOV (sniffed by magic bytes, `apps/server/src/stickers/convert.ts:33`) to an animated WebP;
  - a stored sticker is at most 512 KiB (`image.ts:8`) and 512 px a side; a video over 3 s fails with "Videos are up to 3 seconds" (`convert.ts:196-197`);
  - animated WebP and APNG are not converted, so they must already fit 512 KiB and 512 × 512.

### Steps
1. **New file `apps/web/src/lib/sticker-motion.ts`.** Export `sniffMotion(file: Blob): Promise<'gif' | 'video' | 'animated-webp' | 'apng' | null>`. It reads at most the first 64 KiB (`file.slice(0, 65536).arrayBuffer()`) and looks only at the bytes, never at the name or type:
   - `GIF87a`/`GIF89a` at 0 → `'gif'`;
   - `1A 45 DF A3` at 0 (WebM) or `ftyp` at 4 (MP4/MOV) → `'video'`;
   - `RIFF` at 0, `WEBP` at 8, `VP8X` at 12 and bit `0x02` set in byte 20 → `'animated-webp'`;
   - the PNG signature, then walk the chunks (4-byte big-endian length, 4-byte type, data, 4-byte CRC). An `acTL` chunk before the first `IDAT` → `'apng'`;
   - anything else → `null`.
   
   Keep the file short and with no dependencies.
2. **`apps/web/src/lib/sticker-images.ts`:**
   - `PrepResult` gains `motion: 'none' | 'animated' | 'video'`. `'video'` means the preview needs `<video>`; `'animated'` is a GIF, animated WebP or APNG.
   - **Accepting a file:** accept it when its type is in the list (now also `video/webm`, `video/mp4`, `video/quicktime`), or when `sniffMotion` returns a kind. Some browsers give a `.mov` an empty type. Update the unsupported-type message to name GIFs and videos.
   - **In `prepareEffect`, sniff before decoding:**
     - **`'gif'` or `'video'`:** over 4 MiB, fail with `too_large`: "`<name>`: over 4 MiB. Try a shorter clip." Otherwise return the file itself as `blob`, with no canvas, no decode and no encode: `mime: 'image/webp'` (the type the server stores), `width: 0`, `height: 0`, `bytes: file.size`, and `motion` `'video'` for a video or `'animated'` for a GIF.
     - **`'animated-webp'` or `'apng'`:**
       - over 512 KiB, fail with `too_large`: "`<name>`: a moving WebP or PNG must be under 512 KiB.";
       - otherwise decode it with `deps.decode` only to read its width and height, and release it;
       - wider or taller than 512, fail with `too_large`: "`<name>`: a moving WebP or PNG must be at most 512 × 512.";
       - otherwise return the file itself, with `mime` `'image/webp'` or `'image/png'`, its real size, and `motion: 'animated'`.
     - **`null`:** the still path, unchanged, with `motion: 'none'`.
   - **Comments:** fix the header comment (`:1-11`) and the one on `decodeWithBitmap` (`:76`) so they say moving files skip the canvas.
   - **Formatting:** add `formatStickerBytes(bytes)` ("84 KiB", "1.2 MiB"), reusing the rounding of `formatStickerSize`.
3. **`apps/web/src/components/sticker/packEditorModel.ts`:**
   - `PackEditorItem` gains `motion?: 'none' | 'animated' | 'video'`, and `prepareItem` copies it.
   - `PACK_ACCEPT` becomes `'image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,video/quicktime,.webm,.mp4,.mov'`.
4. **`apps/web/src/components/sticker/BlobPreview.tsx`:** a `video?: boolean` prop. When true, render `<video src={url} muted loop autoPlay playsInline className="max-h-16 max-w-16 object-contain" aria-label={alt} />` instead of the `<img>`. The URL lifecycle stays as it is.
5. **`apps/web/src/components/sticker/PackEditorItems.tsx`:**
   - pass `video={item.motion === 'video'}` to `BlobPreview`;
   - for an item whose `motion` is `'animated'` or `'video'`:
     - put a small loop icon, lucide `Repeat` at 14 px with `aria-label="Moves"` and `role="img"`, before the size text (the board's "Moves" badge, `docs/design/mockups/stickers/WebNewPack.dc.html:67`);
     - when `width` is 0, the size text is `formatStickerBytes(item.bytes)` instead of `formatStickerSize`.
   - Nothing else changes in the row.

### Not in scope
- the New pack grid;
- the mobile app;
- the Telegram importer;
- a client-side video duration check (the server's "Videos are up to 3 seconds" error already shows on the row).

### Tests
None: this is UI code, not crucial code (CLAUDE.md, Hard rules).

### Allowed files
- `apps/web/src/lib/sticker-motion.ts` (new)
- `apps/web/src/lib/sticker-images.ts`
- `apps/web/src/components/sticker/packEditorModel.ts`
- `apps/web/src/components/sticker/BlobPreview.tsx`
- `apps/web/src/components/sticker/PackEditorItems.tsx`
- `work/T-1501-web-sticker-motion.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Picking a GIF, a `.webm`, an `.mp4` or a `.mov` in New pack or Edit pack adds a row with the "Moves" icon. The bytes uploaded are the original file's.
- An animated WebP or APNG within 512 KiB and 512 × 512 uploads unchanged; a bigger one gets a red error row.
- A still PNG, JPEG or WebP goes through the canvas exactly as before.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

Implemented the spec on branch `task/T-1501-web-sticker-motion`:

- **New `apps/web/src/lib/sticker-motion.ts` (94 lines).** `sniffMotion(file)` reads at most
  the first 64 KiB (`file.slice(0, 65536).arrayBuffer()`) and decides from the bytes only:
  `GIF87a`/`GIF89a` → `'gif'`; EBML `1A 45 DF A3` or `ftyp` at offset 4 → `'video'`;
  RIFF/WEBP + `VP8X` at 12 + bit `0x02` in byte 20 → `'animated-webp'`; PNG signature then a
  chunk walk where an `acTL` before the first `IDAT` → `'apng'`; anything else → `null`.
- **`apps/web/src/lib/sticker-images.ts` (382 lines).** `PrepResult` now carries
  `motion: 'none' | 'animated' | 'video'`; `STICKER_PREP_ACCEPTED_TYPES` adds
  `video/webm`, `video/mp4`, `video/quicktime`; `PACK`-side file acceptance is
  type-in-list **or** a sniffed kind (so a `.mov` with an empty type works), and the
  unsupported-type sentence now names GIFs and short videos. `prepareEffect` sniffs first:
  a `gif`/`video` at most 4 MiB is returned raw (`mime: 'image/webp'`, `width/height: 0`,
  `bytes: file.size`, motion `animated`/`video`), over 4 MiB fails `too_large`; an
  animated WebP/APNG over 512 KiB fails `too_large`, otherwise it is decoded only to read
  its size (then released) and fails `too_large` over 512 × 512, else returned raw with its
  real size and `mime` `image/webp`/`image/png`; everything else takes the unchanged still
  canvas path with `motion: 'none'`. Fixed the header comment and the `decodeWithBitmap`
  comment; added `formatStickerBytes` ("84 KiB", "1.2 MiB") sharing the rounding with
  `formatStickerSize`.
- **`apps/web/src/components/sticker/packEditorModel.ts`.** `PackEditorItem.motion?`
  added and copied from `prepared.motion` in `prepareItem`; `PACK_ACCEPT` extended with
  the video types and `.webm,.mp4,.mov`.
- **`apps/web/src/components/sticker/BlobPreview.tsx`.** New `video?: boolean` prop:
  true renders `<video src={url} muted loop autoPlay playsInline className="max-h-16 max-w-16 object-contain" aria-label={alt} />`, otherwise the same `<img>`. The object-URL lifecycle is unchanged.
- **`apps/web/src/components/sticker/PackEditorItems.tsx`.** Passes
  `video={item.motion === 'video'}` to `BlobPreview`; a moving item shows a lucide `Repeat`
  icon at 14 px (`className="size-3.5"`, `role="img"`, `aria-label="Moves"`) before the size
  text, and when `width === 0` the size text is `formatStickerBytes(item.bytes)` instead of
  `formatStickerSize`. Nothing else in the row changed.

### Checks run

- `pnpm gate` (from the repo root), real output:

  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- No other command was run: there is no test file near any of the touched files, so the
  gate skipped `@zilar/web` tests (spec: this is UI code, no tests).
- Changed files: `apps/web/src/lib/sticker-motion.ts`,
  `apps/web/src/lib/sticker-images.ts`,
  `apps/web/src/components/sticker/packEditorModel.ts`,
  `apps/web/src/components/sticker/BlobPreview.tsx`,
  `apps/web/src/components/sticker/PackEditorItems.tsx`, and this task file.
- Every changed source file is under 400 lines (largest: `sticker-images.ts`, 382).

### Notes for the lead

- **One deviation, in the new file only:** `sticker-motion.ts` starts with
  `// effect-plain: a pure byte-sniffing helper (no I/O or ports); the Effect prepare flow
  in sticker-images.ts owns the async boundary.` The gate's Effect ratchet (H1) failed the
  first run because the spec asks for an `async function ... Promise<...>` with no
  dependencies; the marker is the repo's existing escape hatch for such plain helpers
  (see `apps/web/src/lib/api/sessionGone.ts`). No behavior change.
- I did not add a client-side video-duration check (out of scope): the server's
  "Videos are up to 3 seconds" error still lands on the row through the existing upload path.
- I did not verify in a browser (I cannot run the UI); the acceptance walk-through
  (GIF/WebM/MP4/MOV row with the Moves badge, animated WebP/APNG pass-through, oversize
  error rows) is covered by the changed code paths and needs Julio's live check.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 2 nits and 1 follow-up, for head `eea0e53bd`.
- **Headless check** (New pack, mock, 1280 px; a 2-frame GIF and a WebM header picked through the file input):
  - `accept` lists the video types;
  - both rows show the "Moves" loop icon and their byte size;
  - the WebM previews in a `<video>`;
  - 0 page errors.
- **Follow-ups**, for the New pack grid task, which rewrites these files:
  - an AVIF (`ftyp` brand `avif`) is sniffed as video, so the server rejects it on the row. Check the `ftyp` brand;
  - Edit pack's stored animated stickers get no "Moves" icon (`PackEditor.tsx:53`);
  - the drop-zone hint still says "GIF (first frame)".
- `sticker-images.ts` is at 384 lines: the grid task must not grow it.
