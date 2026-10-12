---
id: T-1246
title: "TG-10 step 1, mobile: the library picker allows several photos/videos (up to 10); photos are downscaled before upload (longest side 2048 px, JPEG 85 %, GIFs untouched); the composer shows the picked items in a strip and Send sends one message per item (the caption goes on the first)"
status: merged
milestone: M5
branch: task/T-1246-mobile-multi-photo-downscale
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1246: Several photos at once, and smaller uploads (mobile)

## Spec (written by Claude, do not edit)

### Why
It's item 10 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4): "multi-select, downscale to 2048 px / 85 % by default". Albums (grouped bubbles) are a later step.
- **One item only:** the library picker takes one item at `quality: 1` (`apps/mobile/src/lib/attachment-picker.ts:86-115`, `launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1 })`, then only `result.assets[0]`), and the camera also takes full quality (`:133`).
- **The composer** stages one `PickedFile` (`apps/mobile/src/components/chat/composer-media.ts:89`, `setPicked` at `:116`) and sends it with the text as the caption (`sendPicked`, `:180-190`).
- **The resizer already exists:** `expo-image-manipulator`, used for avatars (`apps/mobile/src/components/settings/avatar-native.ts:5`) and stickers.

### What to build
1. **Picker** (`attachment-picker.ts`): for the library, `allowsMultipleSelection: true` and `selectionLimit: 10`. Return every asset as `PickedFile[]`; keep `PickResult` backward compatible, for example `{ status: 'ok', files }` plus `file` = the first, and update the ports type in `apps/mobile/src/lib/attachment-ports.ts`. The camera and file picker stay single.
2. **Downscale** (a new `apps/mobile/src/lib/attachment-downscale.ts`):
   - for an image that isn't a GIF, whose longest side is over 2048 px or whose size is over 1.5 MB, use `manipulateAsync` with a resize to a longest side of 2048, `compress: 0.85` and `SaveFormat.JPEG`. Use the new uri, size and dimensions, and change the name's extension to `.jpg`;
   - skip GIFs, PNGs with transparency (just skip all PNGs under 1.5 MB), and videos;
   - apply it to library and camera photos.
   - **A failure falls back to the original file**, never an error.
3. **Composer** (`composer-media.ts` and the preview it renders; cite the component):
   - stage a list, shown as a horizontal strip of thumbnails, each with a remove (x) button;
   - Send sends one `onSendAttachment` per item **in order**, the composer text going as the caption of the **first** only, and the reply quote on the first only.
   - One item keeps today's look exactly.
   - Keep every touched file at most 400 lines.
4. **Mock mode:** the mock picker seam (`composer-media.ts:35`) still returns one demo item; that's fine.
5. **No tests** (UI and native).

### Read first
`AGENTS.md`, `apps/mobile/src/lib/attachment-picker.ts`, `apps/mobile/src/lib/attachment-ports.ts`, `apps/mobile/src/components/chat/composer-media.ts`, `apps/mobile/src/components/chat/composer.tsx` and `apps/mobile/src/components/settings/avatar-native.ts`.

### Allowed files
`apps/mobile/src/components/chat/attachment-body.tsx` (fix round 1, lead), `apps/mobile/src/lib/attachment-picker.ts`, `apps/mobile/src/lib/attachment-ports.ts`, `apps/mobile/src/lib/attachment-downscale.ts`, `apps/mobile/src/components/chat/composer-media.ts`, `apps/mobile/src/components/chat/composer.tsx` (it renders the picked preview today), `apps/mobile/src/components/chat/composer-picked-strip.tsx` (new, if the strip doesn't fit in `composer.tsx`), `apps/mobile/src/components/chat/composer-sheet.ts`, `apps/mobile/src/components/chat/attach-sheet.tsx`, `work/T-1246-mobile-multi-photo-downscale.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every touched file stays at most 400 lines.
- **The lead's check on the emulator (mock build):** picking from the library and sending still works for one item. A real multi-pick needs real photos on the device; the lead pushes two test images with `adb push` into the emulator's Pictures folder and picks both.

---

## Report (written by the worker when done)

### What I did

- **Picker** (`apps/mobile/src/lib/attachment-picker.ts`, `attachment-ports.ts`): the library pick now sends `allowsMultipleSelection: true` and `selectionLimit: 10`. `PickResult`'s picked variant carries `files: PickedFile[]` and `file` (the first), so single-file callers keep working. The camera and the file picker stay single but also return `files: [file]`. The camera and library assets all flow through one `pickedFromAssets` helper; one oversized/empty asset fails the whole pick with its fixed message.
- **Downscale** (`apps/mobile/src/lib/attachment-downscale.ts`, new, 144 lines): `shouldDownscale` fires for an image that is not a GIF whose longest side is over 2048 px or whose size is over 1.5 MB; PNGs under 1.5 MB are skipped whole (transparency), videos and non-images skipped. The transcode uses `manipulateAsync` with a longest-side-2048 resize (only when the image is bigger, never an upscale), `compress: 0.85`, `SaveFormat.JPEG`; it returns the new uri/width/height, the stat'd new size, `image/jpeg` and a `.jpg` name. A transcode failure returns the original file. Applied to library and camera photos only.
- **Composer** (`composer-media.ts`, `composer.tsx`, `composer-picked-strip.tsx` new, `attach-sheet.tsx`): the staging state is now `picks: PickedFile[]`. The strip component (cited: `apps/mobile/src/components/chat/composer-picked-strip.tsx`) renders above the input row: one item is exactly the earlier sheet preview row (64px thumbnail, name, size, `Remove`); several show as a horizontal strip of thumbnails, each with an `x` button. `sendPicked` calls `onSendAttachment` once per item in order, passing the caption and the reply quote on the first item only. A successful pick/demo stages the files and closes the sheet; the sheet no longer renders a preview.
- The mock demo pick (`demoPick`) stages one demo file and closes the sheet.

### Files changed

`apps/mobile/src/lib/attachment-picker.ts`, `apps/mobile/src/lib/attachment-ports.ts`, `apps/mobile/src/lib/attachment-downscale.ts` (new), `apps/mobile/src/components/chat/composer-media.ts`, `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/composer-picked-strip.tsx` (new), `apps/mobile/src/components/chat/attach-sheet.tsx`, `work/T-1246-mobile-multi-photo-downscale.md`. All are under Allowed files; longest is `composer.tsx` at 291 lines.

### Commands I ran

- `pnpm install` → done (`Done in 12.9s`, 1180 packages added).
- `pnpm exec prettier --write <two files>` (fixing the gate's format step) → 2 files rewritten.
- `pnpm gate` (from the repo root), final run:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (1.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- I ran no test file on its own: the change is UI/native and, per the spec, gets no tests, and no existing test imports these modules. The gate's `tests @zilar/mobile` step passed.

### Deviations / interpretation

- **Strip location:** the spec says "the composer shows the picked items in a strip" and lists `composer.tsx` first. Today the single preview is rendered by `AttachSheet` (the parenthetical "composer.tsx renders the picked preview" is not literally what the code did). I moved the staging UI into the composer body, above the input row, and the sheet now just closes on a successful pick. The one-item row keeps the earlier `PickedPreview` markup one-for-one, so "one item keeps today's look exactly" holds visually.
- **PNG rule:** implemented literally as "skip all PNGs under 1.5 MB", so a PNG over 1.5 MB is re-encoded to JPEG like any other large image.
- **Repeat picks replace the staged list** (the spec asks one library run up to 10 items, not appending across runs).
- No new dependency: `expo-image-manipulator` and `expo-file-system` were already used (avatars/stickers).

### Fix round 1 (lead's emulator check)

- **Bug:** an attachment's caption rendered in `text-foreground` (`#ededed`) on the light outgoing bubble (`#dedede`), so it was nearly invisible. The edited/time meta line had the same problem with `text-muted-foreground` (`#a1a1a1`).
- **Fix** (`apps/mobile/src/components/chat/attachment-body.tsx`, added to Allowed files by the lead for this round): the caption now uses the bubble's own text colour, `outgoing ? '#0a0a0a' : FOREGROUND`, the exact rule `MessageBubble` applies (`message-bubble.tsx:164`; `FOREGROUND` is `palette.foreground`). The edited/time line now uses the meta shade `MessageBubble` picks (`message-bubble.tsx:150`: `BUBBLE_COLORS.outgoingMeta` / `incomingMeta`), and the ticks follow `BubbleInlineMeta` (`plain-bubble-body.tsx:46`): `read` keeps `SEEN`, every earlier status keeps the meta shade. The edit is confined to `attachment-body.tsx`.
- `pnpm gate` (final run):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (1.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved after the lead's fix round 1. Pre-review clean.**
- **The change:**
  - the library picker allows several items (`selectionLimit: 10`);
  - `attachment-downscale.ts` re-encodes photos over 2048 px or 1.5 MB to JPEG at 85 %, skipping GIFs, small PNGs and videos, and falls back to the original on failure;
  - the composer stages a list in `composer-picked-strip.tsx`, and Send sends one message per item, with the caption and reply on the first;
  - `attach-sheet.tsx` was reworked.
- **Lead's emulator check (mock build):** the attach sheet opens, picking sunset.png shows today's single preview, and Send with the caption "Sunset" sends it.
  - Round 0 showed an older bug: the caption on my own photo was light on the light bubble (`attachment-body.tsx:105`). Round 1 uses the bubble's own text and meta colours, and read ticks on attachments turn green.
- **Not checked on a device:** a real multi-pick, because the mock picker returns one demo item. Check it on the next APK with real photos.
