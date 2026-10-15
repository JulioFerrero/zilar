---
id: T-1536
title: "Phone: send several files at once (approved PhoneFiles board; twin of web T-1512): the Files picker takes several, a new pick adds to the staged files (up to 10), the strip shows 72 px tiles (photo previews; file tiles with icon, extension and size), the placeholder reads 'Add a caption', the send key says 'Send N files'; photos go as one album, every other file as its own message"
status: merged
milestone: M5
branch: task/T-1536-mobile-several-files
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1536: Phone sends several files at once

## Spec (written by Claude, do not edit)

### Why
Julio approved the "several files" boards on 2026-10-15. Read `docs/design/mockups/empty-chat/README.md` and `PhoneFiles.dc.html`. Web shipped as T-1512.

**Before sending,** the composer shows one 72 px tile per staged file:
- a photo shows the image;
- any other file shows an icon, the extension and the size;
- each tile has a remove key.

Then come the Attach key, "Add a caption", and one Send key ("Send 4 files"). **In the chat,** the photos go as one album, and every other file goes as its own file message.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/lib/attachment-picker.ts` (357 lines):**
  - `pickImageOrVideoEffect` already allows 10 (`:165-167`);
  - `pickFileEffect` calls `DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })` and keeps only `assets[0]` (`:197-220`);
  - `pickedFromAssets(inputs)` builds a several-file result (used at `:176`); `withRealSize` builds a single one;
  - results carry `files: PickedFile[]`.
- **`apps/mobile/src/components/chat/composer-media.ts` (304 lines):**
  - a pick **replaces** the staged files: `setPicks(result.files)` (`:140`); the gallery tab does the same (`:281`);
  - `albumIdForPicks` (`:74-79`) gives an album id only when **every** pick is an image (2..10, `ALBUM_MAX` at `:63`);
  - `sendPicked` (`:211-234`) sends each pick in order, with the caption and reply on the first;
  - `canSend` is at `:150`.
- **`apps/mobile/src/components/chat/composer-picked-strip.tsx` (175 lines):**
  - one file keeps `PickedPreviewRow`; several use `PickedStripRow` (`:77-109`) with 64 px thumbs (`THUMB_SIZE`, `:16`);
  - a non-image shows only an icon;
  - the remove key is `bg-black/70` (`:96-105`);
  - `isImageName` is at `:163`.
- **`apps/mobile/src/components/chat/composer.tsx` (307 lines):** `pickedPreviews` maps `uri`, `name` and `size` (`:199-203`), the placeholder comes from `composerPlaceholder(title)` (`:196`), and `<ComposerInputRow placeholder=…>` is at `:255`.
- **`apps/mobile/src/components/chat/composer-input-row.tsx` (184 lines):** the send key's `accessibilityLabel` is `editing ? 'Save edit' : 'Send message'` (`:156`).
- **`classifyMobileFile(file)`** returns `'image' | 'file'` (`apps/mobile/src/lib/attachments.ts:60`).

### Steps
1. **`attachment-picker.ts`, `pickFileEffect`:** pass `multiple: true` and build the result from every asset through `pickedFromAssets` (keeping the size reads). The result stays the same shape.
2. **`composer-media.ts`:**
   - **Staging:** a pick (and the gallery tab's stage) **appends** to the staged files instead of replacing them. Past 10, keep the first 10 and show "You can send up to 10 files at once." in the existing attach error.
   - **Sending:** when two or more staged files are images, those images share one album id, with `index` counted among the images and `count` the image count. Every other file sends as its own message. **Changed by the lead after review (2026-10-15):** albums group only consecutive messages (`packages/chat-core/src/messages.ts:31-36`), so when an album applies (2+ images), all staged images send first in pick order as the one album, then every other file in pick order. With fewer than 2 images, pick order stays. The caption and reply ride the first message **sent**. This matches web T-1541, now on main (`apps/web/src/components/composer/useComposerAttachments.ts`, `sendPending`).
   - **`albumIdForPicks`:** replace or adapt it.
   - Keep the file under 400 lines.
3. **`composer-picked-strip.tsx`, `PickedStripRow`** (two or more files), after the board:
   - 72 px tiles (`gap: 10`), `rounded-[10px]` with `border-edge`;
   - **a photo:** `cover`;
   - **any other file:** `bg-surface`, centred in a column: `FileText` 18 px muted, the extension in uppercase (mono 10 px, 500), and the size (mono 10 px, muted; "1.2 MB", with no "sending with your message"). Set `accessibilityLabel` to "<name>, <size>".
   - **The remove key:** 20 px round at the top right, `bg-black/80`, `X` 11 px.
   
   One staged file keeps today's single row.
4. **`composer.tsx` and `composer-input-row.tsx`:** with one or more staged files, the placeholder is "Add a caption". With two or more, the send key's `accessibilityLabel` is "Send N files". Otherwise both stay as they are.
5. **Every file stays under 400 lines.**

### Not in scope
- web;
- the server;
- the in-app gallery tab's own layout.

### Tests
None new. Keep `apps/mobile/src/components/chat/attach/gallery-reader.test.ts` passing.

### Allowed files
- `apps/mobile/src/lib/attachment-picker.ts`
- `apps/mobile/src/components/chat/composer-media.ts`
- `apps/mobile/src/components/chat/composer-picked-strip.tsx`
- `apps/mobile/src/components/chat/composer.tsx`
- `apps/mobile/src/components/chat/composer-input-row.tsx`
- `work/T-1536-mobile-several-files.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Picking two photos, then a PDF, stages three tiles: two photo tiles and a PDF tile with "PDF" and its size.
- The placeholder reads "Add a caption", and the send key is labelled "Send 3 files".
- Sending puts the two photos in one album bubble and the PDF in its own file message, with the caption on the first item.
- The lead checks this by reading the code; the mock phone cannot pick files.

---

## Report (written by the worker when done)

### What I did

**1. `apps/mobile/src/lib/attachment-picker.ts`** — `pickFileEffect` now calls
`DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true })` and
builds the result from every selected asset through `pickedFromAssets` (so every file
keeps the real-size read, the size rules and the photo downscale). The result shape is
unchanged; the first asset stays in `file`.

**2. `apps/mobile/src/components/chat/composer-media.ts`** —
- Replaced `albumIdForPicks` / `ALBUM_MAX` with `MAX_STAGED_FILES = 10`,
  `MAX_FILES_MESSAGE = 'You can send up to 10 files at once.'`, a `pickedImages` filter
  and `appendPicks`, which appends a pick to the staged files and keeps the first ten
  with an `overflow` flag.
- Staging now appends instead of replacing, in the sheet pick, the mock demo pick and
  the Gallery tab's `stageFiles`; on overflow the first ten stay and the existing
  attach error shows the cap sentence.
- `sendPicked` now gives one album id to the staged images when there are two or more,
  with `index` counted among the images and `count` the image count; a single image
  and every non-image send as their own message. Order is the pick order and the
  caption + reply ride the first item (mirrors web T-1512).

**3. `apps/mobile/src/components/chat/composer-picked-strip.tsx`** — `PickedStripRow`
now renders 72 px tiles (`gap: 10`, `rounded-[10px]`, `border-edge`): a photo is shown
`cover` (via `classifyMobileFile`, with an icon fallback), any other file is a
`bg-surface` column with `FileText` 18 px muted, the upper-case extension
(`font-mono-medium` 10 px, `#d4d4d4`) and `formatFileSize(size)` (mono 10 px,
`text-subtle-foreground`, no "sending with your message"). The file tile's
`accessibilityLabel` is "<name>, <size>". The remove key is 20 px round, `bg-black/80`,
`X` 11 px. One staged file keeps today's single row (64 px thumb) unchanged.
`PickedPreview` gained an optional `mimeType` so the strip can tell a photo from a file.

**4. `apps/mobile/src/components/chat/composer.tsx`** — `pickedPreviews` now also maps
`mimeType`; with one or more staged files the placeholder is "Add a caption", otherwise
`composerPlaceholder(title)`. Passes `stagedCount={media.picks.length}` to the input row.

**5. `apps/mobile/src/components/chat/composer-input-row.tsx`** — new `stagedCount`
prop; the send key's `accessibilityLabel` is "Send N files" when two or more files are
staged, otherwise the existing "Send message"/"Save edit".

Deviations: none from the spec. The mock-mode demo pick also appends (it is a pick and
staging now appends everywhere); not mentioned in the spec, called out here.

### Checks run

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/chat/attach/gallery-reader.test.ts`
  → 4 passed (1 file), 497 ms.
- `pnpm gate` (from the repo root) summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (1.3s)
  PASS  typecheck  (3.6s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 6 changed files are the 5 Allowed source files plus this task file. No file
  outside the Allowed files.

### Notes for the lead

- Acceptance is verified by reading the code, since the mock phone cannot pick files
  (as the spec says). Picking two photos (library, `image/*` → `classifyMobileFile`
  `image`) then a PDF (document picker, `application/pdf` → `file`) stages three tiles,
  the two photos as images and the PDF as a PDF tile with its size; the placeholder is
  "Add a caption" and the send key reads "Send 3 files"; sending puts the two photos in
  one album (`count: 2`, indices 0/1) and the PDF in its own message, caption on the
  first photo.
- The 10-file cap is a staging cap (sheet pick, gallery stage, demo pick): past it the
  first ten stay and the attach error reads "You can send up to 10 files at once.". The
  album cap (two or more images) is separate and unchanged in practice.
- Unknown size on a file tile shows no size line and the accessibility label is just
  the name (there is no size to name).
- `sendPicked` sends all staged images first as one album (with two or more images,
  `index` counted among the images and `count` the image count), then every other file
  in pick order; with fewer than two images the pick order is kept and no album marker
  is set. `removePick` also clears the attach error.

### Round 2 (fix round)

**Finding 1 (must-fix) — `sendPicked` reordered mixed picks.** Fixed in
`composer-media.ts`: replaced the images-first split (`pickedImages` + two loops) with
`attachmentSends(picks)`, which walks the staged files in pick order and gives each
*consecutive* run of two or more images one shared album id (`index` counted within the
run, `count` the run length); a lone image and every other file send without an album
marker. `sendPicked` now calls `onSendAttachment` on that plan in order, so the caption
and reply ride the first *staged* item (spec step 2: "the send order stays the pick
order, and the caption and reply ride the first item"). For `[PDF, photoA, photoB]` the
send is now PDF, then A+B as one album with the caption on the PDF (the first pick),
matching the web twin's `staged.forEach` order.

**Finding 2 (nit)** — the `h-[72px] w-[72px]` / `TILE_SIZE` duplication in
`composer-picked-strip.tsx` was left untouched: it is not on a line this fix changes.

Tests added: none. The spec says "Tests: None new", and the nearest test path
(`apps/mobile/src/components/chat/`) is not in the Allowed files; adding a
`composer-media.test.ts` would sit outside the task's Allowed files. Followed the
T-1529 round precedent and flagged it here instead.

`pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/chat/attach/gallery-reader.test.ts`
→ 4 passed (1 file).

`pnpm gate` → **GATE PASS**: `PASS install, format, lint, typecheck, effect, tests @zilar/mobile`;
`scope: every changed file is inside the Allowed files`; `migration`, `images`, `size` pass.

### Round 3 (lead fix round)

The lead overruled pre-review finding 1: spec step 2 was updated, and `attachmentSends`
now sends all staged images first as one album (2+ images, `index` among the images,
`count` the image count), then every other file in pick order; with fewer than two images
the pick order is kept with no album marker, and the caption/reply ride the first message
sent. Finding 2 (nit) stays untouched.

`pnpm gate` → **GATE PASS**: `PASS install, format, lint, typecheck, effect, tests @zilar/mobile`;
`scope: every changed file is inside the Allowed files`; `migration`, `images`, `size` pass.

## Review (written by Claude)

**Approved and merged** after three rounds.

- **First packet:** clean.
- **Round 1, from the lead:** albums group only consecutive messages (`packages/chat-core/src/messages.ts:31-36`), so photo, PDF, photo split into two albums of one. The fix: photos first, then files. It also cleared the attach error on remove.
- **The autopilot's pre-review then asked to restore pick order** (one album per consecutive run of photos), against the old spec text. The lead overruled it, updated spec step 2 in this worktree, and sent round 3.
- **Final `attachmentSends`** (read by the lead):
  - with 2+ images, all images first as one album (`index` among the images, `count` = the number of images), then the other files, each in pick order;
  - with fewer than 2 images, pick order and no marker;
  - the caption and reply on the first message sent.
  
  This matches web T-1541.
- **Also read:** `multiple: true` on the Files picker; staging appends up to 10, with "You can send up to 10 files at once."; 72 px tiles (ext and size for files); "Add a caption"; "Send N files".
- **No phone smoke:** the mock can't pick files. **Julio's next phone build:** pick 2 photos and a PDF and send.
