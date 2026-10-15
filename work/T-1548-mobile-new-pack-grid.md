---
id: T-1548
title: "Phone New/Edit pack as one sticker grid (approved Stickers canvas PhoneNewPack; twin of web T-1509): saved and new stickers in one grid of square tiles with the emoji badge, a Moves badge, failed and preparing states, a dashed Add tile last; tapping a tile opens a small sheet (emoji, retry, remove); 'Stickers n / 120' label"
status: merged
milestone: M5
branch: task/T-1548-mobile-new-pack-grid
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1548: Phone pack editor as one grid

## Spec (written by Claude, do not edit)

### Why
Julio approved the Stickers design on 2026-10-15. Read `docs/design/mockups/stickers/README.md` and `PhoneNewPack.dc.html`. Web shipped this as T-1509.

The board shows one grid of all the pack's stickers as square tiles:
- each tile has its emoji in a corner badge;
- a "Moves" badge for animated ones;
- a spinner while a video converts;
- a warning for a failed one ("Too long: videos are up to 3 seconds");
- a dashed "Add" tile last.

Above the grid sits the label "Stickers" with a mono "7 / 120".

Today the phone shows two lists:
- the saved grid with an Add tile and a Remove key per sticker;
- under it, the new stickers as rows with an emoji field, Retry and Remove.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/app/settings/sticker-pack.tsx` (177 lines):**
  - the name field, `PackVisibilityField`, then `PackSavedGrid` (`:110-123`) and `PackFreshList` (`:124-130`), then `PackActions`;
  - `editor` comes from `use-pack-editor.ts` and provides `count`, `visibleSaved`, `fresh`, `pickImages`, `removeSaved`, `changeEmoji`, `retryItem`, `removeFresh`, `packFull`, `preparing`, `saving` and `skippedNote`;
  - `tile` is computed in the screen.
- **`apps/mobile/src/components/stickers/pack-saved-grid.tsx` (118 lines):**
  - `flex-row flex-wrap gap-2` tiles of size `tile` (`:36-62`);
  - the emoji under the image (`:50-53`);
  - "Remove sticker" (`:57-60`);
  - the Add tile "Add sticker images" (`:69-73`).
- **`apps/mobile/src/components/stickers/pack-fresh-list.tsx` (136 lines):**
  - the rows of `EditorNewItem`;
  - `isMoving(item)` (`:16-18`);
  - the error branch (`:49-53`);
  - the props `onEmojiChange(key, value)`, `onRetry(key)` and `onRemove(key)`.
- **`ActionSheet`** is in `apps/mobile/src/components/ui/action-sheet.tsx`.
- **The pack cap** is `MAX_PACK_STICKERS = 120` (`apps/mobile/src/components/stickers/pack-editor.ts:9`); `packFull` uses it.
- **The route param** is `id` (`apps/mobile/src/components/stickers/use-pack-editor.ts:81`).

### Steps
1. **New `apps/mobile/src/components/stickers/pack-grid.tsx`:** one `flex-row flex-wrap` grid of `tile`-size squares (radius 12, `bg-surface border border-edge`). It shows the saved stickers first, then the new items, then the Add tile.
   - **Saved sticker:** the image (`expo-image`, as today) and its emoji in a 20 px badge at the lower right.
   - **New item:**
     - ready: its image with the emoji badge (or a `Smile` placeholder when it has none) and, when `isMoving`, a `Repeat` badge at the top left (`accessibilityLabel` "Moves");
     - preparing: a spinner (`accessibilityLabel` "Preparing");
     - error: a `TriangleAlert` with the error as its `accessibilityLabel`.
   - **Add tile:** dashed border, `Plus` and "Add", with `accessibilityLabel` "Add photos, GIFs or videos". It calls `pickImages`, and is disabled when `packFull`, `preparing` or `saving`.
2. **New `apps/mobile/src/components/stickers/pack-tile-sheet.tsx`:** tapping any sticker tile opens an `ActionSheet` holding the sticker at 96 px, then:
   - **for a new item:** an "Emoji" text field (one emoji, through `changeEmoji`); "Try again" when it failed (`retryItem`); "Remove" (red; `removeFresh`);
   - **for a saved sticker:** "Remove" (red; `removeSaved`).
3. **`sticker-pack.tsx`:**
   - replace `PackSavedGrid` and `PackFreshList` with a label row ("Stickers", plus the mono "`count` / 120") and `PackGrid`;
   - keep the name, visibility, actions and confirms;
   - keep `skippedNote` as a muted line under the grid.
4. **Delete `pack-saved-grid.tsx` and `pack-fresh-list.tsx`** once nothing imports them.
5. **Every file stays under 400 lines.**

### Not in scope
- reordering stickers;
- web;
- the server;
- the large page title (a separate follow-up).

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/components/stickers/pack-grid.tsx` (new)
- `apps/mobile/src/components/stickers/pack-tile-sheet.tsx` (new)
- `apps/mobile/src/components/stickers/pack-saved-grid.tsx` (delete)
- `apps/mobile/src/components/stickers/pack-fresh-list.tsx` (delete)
- `work/T-1548-mobile-new-pack-grid.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock, `/settings/sticker-pack?id=11111111-1111-4111-8111-111111111111`** (Cats): "Stickers 6 / 120" and one grid of 6 square tiles with emoji badges, then the dashed Add tile.
- No Remove words on the tiles.

---

## Report (written by the worker when done)

### What I did

Phone New/Edit pack is now one sticker grid, the mobile twin of the shipped web T-1509. Changed files (all under 400 lines):

- **New `apps/mobile/src/components/stickers/pack-grid.tsx` (155 lines):** one `flex-row flex-wrap` grid of `tile`-size squares (`rounded-[12px] border border-edge bg-surface`), saved stickers first, then the new items, then a spinner per preparing image, then the dashed Add tile last.
  - **Saved sticker:** the `expo-image` image (same-origin guarded, as today) with its emoji in a 20 px round badge at the lower right (no badge when the sticker has no emoji).
  - **New item:** ready shows the image (local URI through `expo-image`) with the emoji badge, or a muted `Smile` when it has none, plus a `Repeat` "Moves" badge at the top left when `isMoving` (`width === 0 && height === 0`, checked after the error, as `pack-fresh-list` did); a failed row shows a `TriangleAlert` on a `border-danger/60` tile and its `accessibilityLabel` is the row's fixed error sentence.
  - **Add tile:** dashed `border-border-strong`, `Plus` + "Add", `accessibilityLabel` "Add photos, GIFs or videos", calls `pickImages`, disabled when `packFull || preparing > 0 || saving`.
  - Every tile is a `Pressable` whose `accessibilityLabel` is its emoji (else `Sticker n`) and which reports a `PackTileSelection` to the screen. The tiles carry no Remove key or Remove text.
- **New `apps/mobile/src/components/stickers/pack-tile-sheet.tsx` (118 lines):** the `ActionSheet` a tile opens, holding the sticker at 96 px (`h-24 w-24` box, `expo-image`), then the controls. The target is resolved from the live `visibleSaved`/`fresh` lists by id/key at render time, so an emoji change is reflected and a removed row makes the sheet close itself. For a new item: an "Emoji" `TextField` (`maxLength` 8, `changeEmoji`), "Try again" after an `uploadFailed` (`retryItem`), then "Remove" (destructive, `removeFresh`); for a saved sticker: "Remove" (`removeSaved`). All actions are disabled while saving.
- **`apps/mobile/src/app/settings/sticker-pack.tsx` (200 lines):** `PackSavedGrid` + `PackFreshList` are replaced by a label row ("Stickers" + `font-mono` "`count` / `MAX_PACK_STICKERS`") and `PackGrid`, with `skippedNote` kept as a muted line under the grid; `PackTileSheet` is rendered under the grid and holds the selection state (`useState`, cleared on Remove). Name, visibility, actions and both confirms are untouched.
- **Deleted `pack-saved-grid.tsx` (118 lines) and `pack-fresh-list.tsx` (136 lines)** — nothing imports them.

### Checks run

- `pnpm install` (from the repo root): "Done in 18.1s", no errors.
- `pnpm gate` (from the repo root), second and final run:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.8s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- The first `pnpm gate` run failed only `format` (unformatted `pack-grid.tsx`); I ran `pnpm exec prettier --write` on that one file (as the gate output instructed) and re-ran `pnpm gate`: GATE PASS. `prettier --check` on the three touched files: all clean.
- No single test file was run: `apps/mobile/src/components/stickers/` has no test file and the task says "Tests: None (UI)". The gate step reports `SKIP tests @zilar/mobile (no nearby test files)`.
- I did not start the dev server or a simulator, so the live phone acceptance (mock pack `11111111-…`, "Stickers 6 / 120", the grid and the tile sheet) is the lead's smoke.

### Notes for the lead

- **Notes dropped with the two components.** The spec's step 3 lists what survives ("keep the name, visibility, actions and confirms; keep `skippedNote`"), so I dropped `PackSavedGrid`'s create-mode hint ("Pick PNG, JPEG, WebP or GIF images…"), its pack-full line ("This pack is full…") and its "Preparing N images…" note, matching the approved mock (which shows none of them) and web T-1509. The Add tile's disabled state plus the "120 / 120" count still signal a full pack. Say the word if the pack-full line should come back as a muted line under the grid.
- **The preparing spinner tiles** are an addition the spec does not name: the editor counts images still preparing (`preparing`) but creates no row until one is ready, so I render one spinner tile per preparing image between the new items and the Add tile (the mock's "Converting video" tile). This is the only reading that shows a spinner tile at all.
- **"Try again" is shown only for `uploadFailed`**, not for `failed-prepare`: `retryItem` (in `use-pack-items.ts`, outside the Allowed files) just flips the row back to `ready`, which is right for a file that was prepared but failed to upload, but for a `failed-prepare` row it would re-upload the raw, unprepared pick. That matches the old `PackFreshList`, which showed Retry only for `uploadFailed`. The `failed-prepare` tile still opens the sheet and can be removed.
- **"One emoji"** is enforced with the existing `maxLength={8}` + `changeEmoji` slice, as the old inline emoji field did; mobile has no `takeSingleEmoji` helper (web does).
- **Dead export left behind:** `formatPreparedSize` in `apps/mobile/src/components/stickers/pack-editor.ts` had `pack-fresh-list.tsx` as its only caller and is now unused. `pack-editor.ts` is not in my Allowed files, so I left it; remove it in a follow-up if you want.
- The 120 literal in the skipped note ("Only 120 stickers fit in a pack") is unchanged user copy; only the count row reads `MAX_PACK_STICKERS`.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 nits and 1 follow-up.
- **Phone smoke** (`/settings/sticker-pack?id=1111…`, Cats, mock): PASS. The screenshot shows "Stickers" with a mono "6 / 120", one grid of 6 square tiles each with its emoji badge at the lower right, then the dashed "Add" tile. There are no Remove words on the tiles. Tile art is blank in mock mode, by Julio's choice.
- **The tile sheet** was read in the code (the smoke cannot tap): Emoji, "Try again" for a failed item, and a red Remove.
- **Follow-ups for the phone stickers polish task:**
  - the board's segmented Private/Shared switch, in place of today's two cards with hints;
  - the large page title and leaner actions;
  - the dead `formatPreparedSize` export in `pack-editor.ts`.
