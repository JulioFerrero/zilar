---
id: T-1509
title: "Web New/Edit pack as a sticker grid (approved Stickers canvas WebNewPack): header Create/Save, name + Private/Shared row, 'Stickers n / 120', square tiles with emoji, loop and status badges, a dashed Add tile, a tile popover (emoji, move, remove)"
status: merged
milestone: M5
branch: task/T-1509-web-new-pack-grid
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-1509: Web pack editor as a sticker grid

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers design on 2026-10-15. Read `docs/design/mockups/stickers/README.md`, then `WebNewPack.dc.html`. New pack, in short:
- **Header:** Back, "New pack", and a primary Create.
- **One row:** Name, and Private · Shared.
- **"Stickers"** with a mono count ("7 / 120").
- **A grid of square tiles,** ending in a dashed **Add** tile. Each tile shows:
  - its emoji (or a muted "+" when it has none);
  - a loop badge when it moves;
  - a spinner while it uploads or converts;
  - or a red error tile with a remove key.
- **Clicking a tile** opens a popover with emoji choices, Move left / Move right, and Remove.

T-1501 already made moving files keep their motion (`item.motion`). This task replaces the row list with that grid.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/routes/StickersPage.tsx`:** editing (`:112-130`) and creating (`:136-150`) each wrap `PackEditor` in a `SettingsShell` with a title and subtitle, inside `SETTINGS_COLUMN`.
- **`SettingsShell`** (`apps/web/src/components/SettingsShell.tsx`, T-1503) now has an optional `subtitle` and an optional `action` slot at the right of the title row.
- **`apps/web/src/components/PackEditor.tsx` (218 lines)** holds the items state:
  - `removeItem`, `moveByIndex` and `moveItem(key, -1 | 1)` (`:118-126`);
  - `setEmoji`, `retryItem` and `usePackSave` (`:128-160`);
  - it renders `PackEditorForm`, `PackEditorItems`, the progress and error text, and the Create pack/Save and Cancel buttons (`:168-217`). Save is disabled while busy, while preparing, while any row has an error, or, in create mode, with no ready item (`:208-210`).
- **`apps/web/src/components/sticker/PackEditorForm.tsx` (142 lines):** the title `TextInput`, a `SegmentedControl` (Private / "Shared on this server"), and a drop zone with a hidden file input (`accept` is `PACK_ACCEPT`), and the hint "PNG, JPEG, WebP or GIF (first frame)…". It also mounts the preparation batches.
- **`apps/web/src/components/sticker/PackEditorItems.tsx` (210 lines):** a `SortableList` of rows (drag, Up/Down, retry, emoji `TextInput`, remove), with `BlobPreview` or the server `<img>`, the "Moves" icon and the size line.
- **The kit:**
  - `SegmentedOption` takes an optional `icon` (`apps/web/src/components/ui/segmented-control.tsx:6-11`);
  - the Base UI `Popover` pattern is in `apps/web/src/components/ais/new-ai/OrbPicker.tsx:31-50`;
  - `IconButton` (36 px);
  - `STICKERS_MAX_PER_PACK = 120` (`packages/api-contract/src/stickers.ts:26`).
- **The sniffer:** `apps/web/src/lib/sticker-motion.ts` (T-1501) treats any `ftyp` box as video, so an AVIF photo is sent raw and the server rejects it (T-1501 Review).
- **Size:** `apps/web/src/lib/sticker-images.ts` is 384 lines. Do not grow it.

### What to build
1. **Header (`PackEditor.tsx`):** `PackEditor` renders its own `SettingsShell`:
   - the title is "New pack" or "Edit pack", with no subtitle, and `onBack={onCancel}`;
   - `action` is the primary `Button` "Create" (create mode) or "Save" (edit mode), with today's disabled rule;
   - drop the bottom Create pack/Save and Cancel buttons;
   - progress and form errors stay under the grid.
   - In `StickersPage.tsx`, render `PackEditor` directly, without the extra `SettingsShell`.
2. **Form (`PackEditorForm.tsx`):**
   - one row (stacked under 480 px): the "Name" label with its `TextInput` (`flex-1`), and the `SegmentedControl` with Private (`Lock` icon) and Shared (`Globe` icon), about 220 px wide;
   - remove the visibility hint and the drop-zone box. The hidden file input stays, opened by the Add tile; the whole editor area still accepts dropped files;
   - then a line with "Stickers" (13 px, muted) and the count `n / 120` in mono.
3. **The grid (`PackEditorItems.tsx`):** `grid grid-cols-4 gap-2.5 sm:grid-cols-6`. Each item is a square tile (`aspect-square rounded-[14px] border border-border bg-surface`) with the picture centred at 72%: `BlobPreview` (video when `motion === 'video'`) or the server `<img>`.
   - **Badges:**
     - the emoji at the bottom right, in a 24 px round badge; with no emoji, a muted `Plus` there, `aria-label="No emoji"`;
     - a "Moves" badge at the top left (20 px, radius 6, `Repeat` 12 px) when `motion` is not `'none'`.
   - **Uploading:** the picture at 35% opacity and a centred `Loader2` that spins, `aria-label="Uploading"`.
   - **Error:**
     - a red border (`border-danger/60`), the picture at 40%, a centred `CircleAlert`, and `aria-label` set to the error message;
     - a 24 px remove key at the top right (`aria-label="Remove"`);
     - clicking the tile opens the popover with the error text, "Try again" (the existing retry) and Remove.
   - **The last cell is a dashed Add tile:** `border-dashed`, `Plus` icon, the text "Add", `aria-label="Add photos, GIFs or videos"`. It opens the file picker and is hidden at 120 stickers.
   - Drop the drag-sort, the Up/Down buttons, the size line and the per-row emoji input.
4. **New `apps/web/src/components/sticker/TilePopover.tsx`,** opened by clicking a tile (a Base UI `Popover` like `OrbPicker`, 300 px wide):
   - **Emoji:** 8 buttons in a row. The current emoji comes first when set, then from 😀 😂 😍 😎 👍 🙌 🔥 ❤️; the pressed one has `aria-pressed`. "More emoji" shows a one-emoji `TextInput` (`takeSingleEmoji`) for any other;
   - **then a divider, then:**
     - Move left and Move right (`IconButton`, `ChevronLeft`/`ChevronRight`, disabled at the ends; they use `moveItem`);
     - a spacer;
     - Remove sticker (`IconButton`, `Trash2`, red).
   - The open tile gets a white ring (`ring-2 ring-foreground`).
5. **`apps/web/src/lib/sticker-motion.ts`:** an `ftyp` box counts as video only when its major brand (bytes 8-11) is not one of `avif`, `avis`, `heic`, `heix`, `heim`, `heis`, `hevc`, `mif1` or `msf1`. Otherwise it returns `null`, and the file goes down the still path, where the browser decodes it or reports it.

### Not in scope
- the My packs / Discover tabs and drag (a later task);
- the mobile app;
- the server.
- Stored stickers in Edit pack get no loop badge: the wire `Sticker` has no animated flag.

### Tests
None (UI, CLAUDE.md Hard rules).

### Allowed files
- `apps/web/src/components/PackEditor.tsx`
- `apps/web/src/components/sticker/PackEditorForm.tsx`
- `apps/web/src/components/sticker/PackEditorItems.tsx`
- `apps/web/src/components/sticker/TilePopover.tsx` (new)
- `apps/web/src/components/sticker/packEditorModel.ts`
- `apps/web/src/components/sticker/BlobPreview.tsx` (lead-approved for the GIF/video preview fix)
- `apps/web/src/lib/sticker-motion.ts`
- `apps/web/src/routes/StickersPage.tsx`
- `work/T-1509-web-new-pack-grid.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `/settings/stickers?mock=1`, then Create pack, at 1280 and 390 px:
  - the header has Back, "New pack" and Create;
  - the name and Private/Shared share one row;
  - "Stickers 0 / 120";
  - a dashed Add tile.
- **Picking files:**
  - two images and a GIF add three tiles, the GIF with the loop badge;
  - a tile opens the popover; setting an emoji shows it on the tile;
  - Move right reorders the tiles, and Remove drops one.
- Create works as before.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

- **`apps/web/src/components/PackEditor.tsx`** now renders its own `SettingsShell`: title "New pack" (create) / "Edit pack" (edit), no subtitle, `onBack={onCancel}`, and the primary action button "Create" / "Save" in the header using the previous disabled rule (`busy || preparing > 0 || errorCount > 0 || (packId === undefined && readyCount === 0)`). The bottom Create pack/Save and Cancel buttons are gone; the progress and form-error lines stay under the grid. It wraps the body in `SETTINGS_COLUMN` and the whole column accepts dropped files (`onDragOver`/`onDrop` → `addFiles`). It owns the hidden file input's ref and passes it to the form and a `onPickFiles` opener to the grid.
- **`apps/web/src/components/sticker/PackEditorForm.tsx`** is now one row (stacked under 480 px via `min-[480px]:`) with the "Name" `TextInput` (`flex-1`) and a 220 px `SegmentedControl` (Private with `Lock`, Shared with `Globe`). The visibility hint and the drop-zone box are gone; the hidden file input stays (ref from the editor) and a "Stickers" line shows the mono `{count} / 120` (from `STICKERS_MAX_PER_PACK`).
- **`apps/web/src/components/sticker/PackEditorItems.tsx`** is now `grid grid-cols-4 gap-2.5 sm:grid-cols-6` of tiles ending in a dashed Add tile (`Plus` + "Add", `aria-label="Add photos, GIFs or videos"`, opens the picker, hidden at 120). Drag-sort, Up/Down, the size line and the per-row emoji input are removed.
- **New `apps/web/src/components/sticker/TilePopover.tsx`** renders each tile (a `Popover.Trigger` inside an `<li>`): the picture centred at 72% (`inset-[14%]` wrapper, opacity 35% while uploading, 40% on error), the loop "Moves" badge (`Repeat`) when `motion` is set and not `'none'`, the 24 px round emoji badge (muted `Plus`, `aria-label="No emoji"`, when empty), a centred spinning `Loader2` (`aria-label="Uploading"`), a red border + `CircleAlert` + a 24 px top-right remove key on error. Clicking opens a 300 px Base UI popover (like `OrbPicker`) with the 8-cell emoji row, a one-emoji `TextInput` behind "More emoji", and, after a divider, Move left/right (`moveItem`, disabled at the ends) and a red Remove sticker. The open tile gets `ring-2 ring-foreground`.
- **`apps/web/src/lib/sticker-motion.ts`**: an `ftyp` box is video only when its major brand (bytes 8-11) is outside the still set (`avif`, `avis`, `heic`, `heix`, `heim`, `heis`, `hevc`, `mif1`, `msf1`); those brands return `null` so the file goes down the still path.
- **`apps/web/src/routes/StickersPage.tsx`**: the editing and creating branches now render `PackEditor` directly, without the extra `SettingsShell`.
- **`apps/web/src/components/sticker/packEditorModel.ts`**: removed `isEmojiLike`, which became dead code once the per-row emoji input it validated was dropped (nothing else in the repo imports it).

**Follow-up fix (lead review): the GIF/video tile was a broken image.** `BlobPreview` created its object URL in a `useState` initializer and revoked it in an effect cleanup. Under React StrictMode (which this app uses) the effects run setup → cleanup → setup, so the cleanup revoked the one and only URL and the second setup did nothing: the `<img>`/`<video>` kept a dead `blob:` (a still only survived because its canvas blob had already decoded). The URL is now created on mount, and the cleanup **defers** the revoke by a microtask, which the next setup cancels; a real unmount has no setup after it, so the revoke stands. This keeps the URL alive while shown and still revokes on unmount.

### Checks run

- `pnpm install`: 17 workspace projects, "Done"; only the pre-existing `@types/react-dom` peer warning.
- `pnpm gate` (from the repo root), final run:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/sticker/blobPreview.scratch.test.tsx` (throwaway, deleted afterwards): `1 passed` with the fix, `1 failed` with the pre-fix effect restored.
- No single test file was kept: this is UI code (task says "Tests: None"). To verify the fix the lead asked for, I wrote a throwaway `BlobPreview` test under `apps/web/src/components/sticker/` and ran it, then deleted it (it is not committed): with the fix `1 passed`, and with the pre-fix effect restored the same test `1 failed`, so it does detect the broken URL. No committed test file was added.
- I did not start the dev server or a browser (no daemons/background runs), so the 1280 px / 390 px visual acceptance and the live GIF-tile check are the lead's headless smoke.

### Notes for the lead

- **Emoji row interpretation:** the mock's popover is `grid-cols-8` with the last cell being "More emoji" (search icon), while the spec text says "8 buttons in a row" and "More emoji" separately. I read "8 buttons in a row" as the row's cell count, so the row is 7 emoji + "More emoji" = 8 cells, matching the mock exactly; the current emoji comes first when set, then the pool (😀 😂 😍 😎 👍 🙌 🔥 ❤️) fills the rest. If the intent was 8 emoji plus a ninth "More emoji" cell, say so and I'll change it.
- The spec's "picture centred at 72%" does not fit `BlobPreview`'s fixed `max-h-16 max-w-16` (64 px), and `BlobPreview.tsx` is not in the Allowed files. I kept it and sized the picture with a wrapper (`inset-[14%]`, i.e. 72%) plus descendant overrides (`[&_img]:size-full [&_img]:max-h-none …`). Same wrapper covers the server `<img>`.
- The hidden file input stays in `PackEditorForm` as the spec says; the editor passes its ref down so the Add tile can open it. The file input itself is visually hidden (`sr-only`) and reached only through the Add tile.
- Everything else (save/create flow, `usePackSave`, the wire `Sticker` shape) is untouched; stored stickers in Edit get no loop badge because the wire `Sticker` has no animated flag, as the spec notes.
- Per your review I added `apps/web/src/components/sticker/BlobPreview.tsx` to the Allowed files list (it was the fix site) so the gate's scope check passes. If a lead-approved file should be tracked another way, tell me and I'll adjust.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 3 nits, for head `19b0a9a1f`, after one lead fix round.
- **Headless check (mock, dark, 1280 and 390 px):**
  - "New pack" has Create in the header, then Name with the Private/Shared switch, "Stickers 3 / 120", and the tile grid with the dashed Add tile;
  - the tile popover holds the emoji row, and choosing one updates the tile;
  - no horizontal scroll, 0 page errors.
- **The fix round:** a real animated GIF now renders in its tile with the motion mark. The probe read the tile's `<img>`: `naturalWidth` 96, and `fetch(src)` returned 200 `image/gif`. Before the fix it was a broken image, a bug on main since T-1501.
- **Scope:** adding `BlobPreview.tsx` to the Allowed files was approved by the lead in the fix prompt.

