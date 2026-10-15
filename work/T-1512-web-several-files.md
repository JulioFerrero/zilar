---
id: T-1512
title: "Web: send several files at once (approved canvas WebFiles): a mixed pick stages up to 10 files as 72 px tiles (photo previews, file tiles with icon, extension and size, each removable); Send sends photos as one album and each other file as its own message"
status: merged
milestone: M5
branch: task/T-1512-web-several-files
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1512: Web composer sends several files at once

## Spec (written by Claude, do not edit)

### Why
Julio approved the "several files" boards on 2026-10-15. Read `docs/design/mockups/empty-chat/README.md` and `WebFiles.dc.html`; the boards ride on T-1511's branch, so if they are not on main yet, read them in `/Users/julio/personal-projects/zilar-T-1511/docs/design/mockups/empty-chat/`.

**Before sending,** the composer shows one 72 px tile per file:
- photos show the image;
- other files show an icon, the extension and the size;
- each tile has a remove key.

Then comes "Add a caption" and one Send key ("Send 4 files"). **In the chat,** the photos go as one album, and every other file goes as its own file message.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/composer/useComposerAttachments.ts` (381 lines):**
  - `acceptFiles` (`:115-145`) stages several files only when all of them are images (up to `MAX_ALBUM_PHOTOS = 10`, `:29`). A mixed pick, or any non-image, stages **only the first file** (`:123-131`);
  - `refusal(file)` (`:35-44`) refuses an empty or oversized file;
  - `sendPending` (`:321-345`) already sends every staged file in order through `store.sendAttachment`. Only images get the album marker (`count` counts images), and the caption and reply ride the first file;
  - `ALBUM_TOO_MANY` is "You can send up to 10 photos at once." (`:32`).
- **`apps/web/src/components/composer/AttachmentStrip.tsx` (59 lines):**
  - one file keeps the single `AttachmentPreview` row;
  - several files show 64 px thumbnails; a non-image shows only its size (`:43-46`). The remove key is `bg-black/70` (`:48-55`).
- **`classify(file)`** returns `'image' | 'file'` (`apps/web/src/lib/attachments.ts:41`); `formatFileSize` is in the same file.
- **The send key** is in `apps/web/src/components/composer/ComposerControls.tsx:247-255`, with `aria-label` "Save edit" or "Send message". The controls receive `attachments` (`:37`, `:46`, `:58`).

### What to build
1. **`useComposerAttachments.ts`, `acceptFiles`:**
   - any pick of up to 10 files is staged in pick order, each with `kind: classify(file)`;
   - any refused file stops the pick with its error, as today;
   - more than 10 keeps the first 10 and shows "You can send up to 10 files at once." (rename the constant's text);
   - a single file behaves exactly as today;
   - the media dialog rule stays: it opens only when the pick is media and every file is media.
   - Keep the file under 400 lines.
2. **`AttachmentStrip.tsx`, for two or more files:** a row of 72 px tiles (`gap-2.5`, horizontal scroll when it overflows).
   - **Photos:** the preview, `object-cover`, `rounded-[10px] border border-edge`.
   - **Other files:** `bg-surface border border-edge rounded-[10px]`, centred in a column: a lucide `FileText` (18 px, muted), the extension in uppercase (mono 10 px, 500), and the size (mono 10 px, muted, `formatFileSize`). Use `role="img"` and `aria-label="<name>, <size>"`.
   - **The remove key:** 20 px round at the top right (`bg-black/80`, `X` 11 px), `aria-label="Remove <name>"`, as today.
3. **`ComposerControls.tsx`:** with two or more staged files, the send key's `aria-label` is `Send <n> files`. Otherwise it stays as today.
4. **Sending:** the existing `sendPending` order stays. Photos go as one album when there are two or more; each other file is its own message; the caption and reply ride the first.

### Not in scope
- the mobile app;
- the send dialog's layout;
- upload limits.

### Tests
None: UI only. The message pipeline (`sendAttachment`) is unchanged.

### Allowed files
- `apps/web/src/components/composer/useComposerAttachments.ts`
- `apps/web/src/components/composer/AttachmentStrip.tsx`
- `apps/web/src/components/composer/ComposerControls.tsx`
- `work/T-1512-web-several-files.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In `?mock=1`, picking two images, a PDF and a ZIP shows four 72 px tiles (two photos, two file tiles with PDF/ZIP and their sizes), each removable.
- The send key reads "Send 4 files".
- Sending posts one album of two photos and two file messages.
- One file behaves as before.

---

## Report (written by the worker when done)

### What I did

- `apps/web/src/components/composer/useComposerAttachments.ts`: rewrote `acceptFiles`
  so any pick of up to 10 files is staged in pick order, each tagged
  `kind: classify(file)` (photos and other files together). A refused (empty or
  oversized) file stops the pick with its error, checking every chosen file. More
  than 10 keeps the first 10 and shows the cap error. A single file behaves as
  before, and the media dialog only opens when the pick is a media pick and every
  file is media. Renamed `MAX_ALBUM_PHOTOS` → `MAX_FILES` and `ALBUM_TOO_MANY` →
  `TOO_MANY_FILES`, with the text "You can send up to 10 files at once." (the cap
  is no longer about photos only). `sendPending` is unchanged: photos still go as
  one album when there are two or more, each other file is its own message, and
  the caption and reply ride the first.
- `apps/web/src/components/composer/AttachmentStrip.tsx`: for two or more files,
  a horizontal scroller (`gap-2.5`) of 72 px tiles. Photos render the preview with
  `object-cover` and `rounded-[10px] border border-edge`; other files show a
  `bg-surface` tile with a lucide `FileText` (18 px, `text-muted-foreground`), the
  upper-case extension (mono 10 px, 500, `text-[#d4d4d4]`) and the size
  (mono 10 px, `text-subtle-foreground`, `formatFileSize`), with `role="img"` and
  `aria-label="<name>, <size>"`. The remove key is a 20 px round button at the top
  right (`bg-black/80`, `X` 11 px, `aria-label="Remove <name>"`). One file still
  uses `AttachmentPreview`.
- `apps/web/src/components/composer/ComposerControls.tsx`: with two or more staged
  files the Send key's `aria-label` is `Send <n> files`; otherwise it stays
  "Save edit" / "Send message" as before.

### Checks run

- `pnpm install`: done in 14.9s (only the pre-existing `@types/react-dom` peer
  warning, no errors).
- Single tests: none run — the web package has no nearby test files for these
  UI-only changes (gate reports "SKIP tests @zilar/web (no nearby test files)").
- `pnpm gate` (repo root):
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)  (1.8s)`
  - `PASS  format  (1.3s)`
  - `PASS  lint  (1.1s)`
  - `PASS  typecheck  (4.4s)`
  - `PASS  effect  (1.1s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead

- No tests were added: UI only, and the message pipeline (`sendAttachment`) is
  unchanged, per the spec.
- Two small naming deviations inside an Allowed file: `MAX_ALBUM_PHOTOS` and
  `ALBUM_TOO_MANY` were renamed to `MAX_FILES` / `TOO_MANY_FILES`, because the cap
  and message now cover every file, not photos only. The message text is the one
  the spec asks for.
- Color choice: the spec calls the file tile's size "muted", but the approved
  `WebFiles.dc.html` board uses `#8a8a8a` for the size, which is this app's
  `text-subtle-foreground`; the icon uses `#a1a1a1` (`text-muted-foreground`) and
  the extension `#d4d4d4` (no token; same hardcoded value already used in
  `ComposerControls` and `EditBar`). I matched the approved board.
- The tile row keeps the previous `overflow-x-auto` container and remove-key
  offsets, only `gap-2` → `gap-2.5` and 64 px → 72 px, as the spec lists.

### Blocked / needs a decision

None.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 2 cosmetic nits, for head `b72e1eae4`.
- **Headless check** (mock, Marta's DM, 1280 px; two PNGs, a PDF and a ZIP picked through the general file input):
  - four 72 px tiles: two photo previews, plus PDF "1.3 KB" and ZIP "800 B" file tiles;
  - four remove keys;
  - the send key reads "Send 4 files";
  - no dialog opened, 0 page errors.
- **Not checked:** the album and the separate file messages after Send (the existing `sendPending` loop is unchanged).
- **Follow-up:** the board's "Add a caption" placeholder while files are staged; it still reads "Message Marta". Do it with the phone twin.

