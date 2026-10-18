---
id: T-1946
title: "Phone emoji panel like Telegram/WhatsApp: one continuous scroll of every emoji with a category bar that follows it, search behind an icon, D24 segmented tabs, even spacing (twin of T-1945)"
status: merged
milestone: M5
branch: task/T-1946-phone-emoji-panel
model: deepseek/deepseek-flash
effort: default
depends_on: []
estimate: 50 min
---

# T-1946: Phone emoji panel

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "the emoji part needs a little rework with the margins, spacing, etc and if i scroll needs to show all the emoji down and the categories just scroll up or down … closest parity with telegram or discord or whatsapp … make sure all the ui follows the same style and flow".

**What the lead saw on the emulator (1080×2400) on main:**
- the panel shows **one category at a time**, so the category tabs swap the grid;
- the tabs (Emoji | Stickers | GIFs), the search field and the category strip take half of the 300 dp panel, so only about 3½ rows of emoji show;
- the tabs, search, strip and grid each sit at a different inset;
- neither the tabs nor the category strip shows which item is selected.

T-1945 is the web twin. Both must end up with the same layout, icons and order.

### Facts (read by the lead on 2026-10-18)
- **`apps/mobile/src/components/chat/emoji-sheet.tsx`** (156 lines):
  - `PANEL_HEIGHT = 300` (`:15`);
  - the panel is `mt-1.5 border-t border-border bg-surface px-4 pt-3` (`:110`);
  - the tab row is hand-made `Pressable`s with no selected look (`:113-129`);
  - it renders `EmojiTab` with `recents`, `activeCategory` and `onSelectCategory` (`:131-138`).
- **`apps/mobile/src/components/chat/emoji-tab.tsx`** (180 lines):
  - `SearchField` in `p-2` (`:89-97`);
  - a horizontal `ScrollView` category strip, Recent first (`:98-131`);
  - **one** `ScrollView` grid of the active category only, with `EMOJI_GRID_COLUMNS = 8` (`:63`, `:132-160`);
  - the icons are `CATEGORY_ICONS` (`:26-37`).
- **`apps/mobile/src/components/chat/composer-sheet.ts`** keeps `emojiRecents` and `emojiCategory` for the session (`:98-101`). The recents rule is in `apps/mobile/src/lib/emoji-data.ts:37-46`.
- **`apps/mobile/src/components/ui/segmented-control.tsx`:** `SegmentedControl({ options: {value,label,icon?}[], value, onChange })` (`:9-46`), the D24 segmented control in a 40 px row. Web's panel already uses its twin.
- **`react-native` `FlatList`** is already used for long lists (`apps/mobile/src/components/chat/message-list.tsx:308`). No new dependency.

### Steps
1. **`emoji-sheet.tsx`:**
   - `PANEL_HEIGHT = 320`.
   - Panel padding `px-3 pt-2`, one 12 dp inset for every row.
   - Replace the hand-made tab row with `SegmentedControl`, using the same three options and icons (Emoji | Stickers | GIFs, GIFs only when visible) and `pb-2` under it.
2. **New `apps/mobile/src/components/chat/emoji-rows.ts`** (pure, about 60 lines):
   - `buildEmojiRows(recents, columns)` returns a flat list of items: `{ kind: 'header'; key; category: 'recent' | EmojiCategoryId; label }` or `{ kind: 'row'; key; category; glyphs: string[] }`.
   - The "Recently used" section comes first when `recents` is non-empty, then the nine `EMOJI_CATEGORIES` with their labels, with the glyphs chunked by `columns`.
   - It also returns `headerIndex: Record<category, number>`.
   - Add a `buildSearchRows(results, columns)` for the search results (rows only).
3. **`emoji-tab.tsx`, from top to bottom:**
   - **The category bar:** one row, 36 dp high, with 11 equal buttons spread across the width (`flex-row justify-between`, no horizontal scroll):
     - a **Search** icon (lucide `Search`) first, then **Recent** (only when there are recents), then the nine categories;
     - the active button has `bg-surface-raised` and an 8 dp radius, with its icon in the foreground color. The others use the muted icon color;
     - each has an `accessibilityLabel`, and the active one `accessibilityState={{ selected: true }}`.
   - **Search:** tapping the Search icon swaps the bar for the `SearchField` in the same row, focused, with a close (X) that clears the query and brings the bar back. A non-empty query shows `buildSearchRows` results, or "No emoji found.".
   - **The grid:** one `FlatList` over `buildEmojiRows(recents, 8)`.
     - Fixed item heights: a header is 28 dp (12/600, muted, `px-1`), and a row is one cell, where cell = (list width ÷ 8).
     - Use them in `getItemLayout`, with `initialNumToRender` about 10 and `windowSize` 5.
     - Cells are `Pressable`s with a 28 px glyph and `active:bg-surface-raised` at 8 dp radius.
   - **The bar follows the scroll:** `onViewableItemsChanged` sets the active category to the first viewable item's category, and calls `onSelectCategory` so the composer remembers it.
   - **Tapping a category** scrolls to its header with `scrollToIndex({ index: headerIndex[cat], animated: false })` and sets it active at once.
   - **Opening the panel** with a remembered category starts there (`initialScrollIndex`).
   - **A pick** still calls `onPick`, and the composer still records the recent. A new recent doesn't reorder the list while it's open; the list rebuilds on the next open.
   - Keep each file at 400 lines or fewer. Move the bar into a new `apps/mobile/src/components/chat/emoji-category-bar.tsx` if needed.
4. **No tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/emoji-sheet.tsx`
- `apps/mobile/src/components/chat/emoji-tab.tsx`
- `apps/mobile/src/components/chat/emoji-rows.ts`
- `apps/mobile/src/components/chat/emoji-category-bar.tsx`
- `apps/mobile/src/components/chat/composer-sheet.ts`
- `work/T-1946-phone-emoji-panel.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **On the emulator:** the panel shows the D24 segmented tabs Emoji | Stickers | GIFs with the selected one raised.
- **The bar:** one category bar with Search first and the active category highlighted.
- **The grid:** at least 4 full rows of 8 emoji, evenly spaced, with every row at the same 12 dp inset.
- **Scrolling** runs through Recently used and all nine categories with headers, and the highlighted category follows.
- **Tapping** a category jumps to it.
- **Search** opens in place and closes back to the bar.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/components/chat/emoji-sheet.tsx`: raised `PANEL_HEIGHT` to 320, moved the panel to one `px-3 pt-2` inset, and replaced the hand-made tab row with the D24 `SegmentedControl` (Emoji | Stickers | GIFs, GIFs only while visible), with `pb-2` under it.
- New `apps/mobile/src/components/chat/emoji-rows.ts`: pure `buildEmojiRows(recents, columns)` returning the flat header/row list plus `headerIndex`, and `buildSearchRows(results, columns)` for category-less search rows. Recently used comes first when non-empty; the nine categories follow with their labels and 8-column rows.
- New `apps/mobile/src/components/chat/emoji-category-bar.tsx`: one 36 dp row of equal buttons — Search, Recent when recents exist, then the nine categories. The active button is `bg-surface-raised` at an 8 dp radius with a foreground icon; the rest are muted. Each has an `accessibilityLabel`, the active one `accessibilityState={{ selected: true }}`.
- `apps/mobile/src/components/chat/emoji-tab.tsx`: one `FlatList` over every category with a 28 dp header per section and square cells (`width ÷ 8`), `getItemLayout`, `initialNumToRender={10}`, `windowSize={5}`. The bar follows the first viewable item through `onViewableItemsChanged` (which also calls `onSelectCategory`), tapping a category jumps to `headerIndex[category]` and activates it at once, and opening starts at the remembered category via `initialScrollIndex`. Search swaps the bar for a focused `SearchField` in the same row with a close (X) that clears the query and restores the bar; results render through `buildSearchRows`, and an empty result shows "No emoji found.".
- Recents are frozen at mount: a pick still calls `onPick` and the composer records it, but the open list does not reorder; the next open rebuilds from the stored recents.
- Fix round (emulator crash on Search): the search results list and the all-categories list now carry distinct keys (`emoji-search` / `emoji-all`), so React Native mounts a fresh list instead of reusing one instance and dropping `onViewableItemsChanged` (the "Changing onViewableItemsChanged nullability on the fly" invariant). `handleViewableItemsChanged` remains a stable empty-dependency `useCallback`, and closing search remounts the full list at the current section through `initialScrollIndex` (its scroll position may reset).
- `apps/mobile/src/components/chat/composer-sheet.ts` needed no change: it already keeps `emojiRecents` and `emojiCategory`, and the new tab calls `onSelectCategory` while scrolling, so the remembered category follows.
- No tests added (UI-only task, per the spec).

### Checks run

- `pnpm install` — done (18.8s), lockfile unchanged.
- `pnpm exec prettier --write` on the four touched source files — reformatted `emoji-tab.tsx`.
- `pnpm gate` (final run) — **GATE PASS**:

```text
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (1.0s)
PASS  typecheck  (3.3s)
PASS  effect  (0.4s)
PASS  tests @zilar/mobile  (1.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No standalone test files were run: no test targets this UI, and the spec says no tests (the gate ran the mobile package tests).

### Notes for the lead

- I could not run the emulator here, so the visual acceptance items (4+ full rows, bar following, jump-on-tap, search in place) are unverified by me; they need the lead's phone smoke. The layout math at a 360 dp width gives a ~336 dp list and a ~220 dp grid, about 5 rows of 8.
- The same `EmojiTab` also backs the message actions picker (`message-actions-sheet.tsx`, recents `[]`), so that picker gets the new bar/search layout too. I did not edit that file; it is outside the Allowed files.
- The bar hides Recent when there are no recents, so it draws 10 buttons then; 11 with recents.
- Search no longer shows category headers (rows only, per spec). Clearing the query returns to the active category rather than the top.
- `pnpm gate` first failed on Prettier (one file) and then on an oxlint immutability error from a `let offset` accumulator; both were fixed within scope, and the final run above is green.

## Review (written by Claude)

**Approved and merged.** Checked by the lead on the Android emulator (mock build of `a4349f6ca`, 1080×2400):
- **The panel:** D24 segmented tabs Emoji | Stickers | GIFs with Emoji raised, and one category bar (Search, then Recent when there are recents, then the nine categories).
- **The grid:** 8 per row at one inset, with 4 full rows visible under a section header.
- **The bar follows the scroll:** six swipes moved it to People. Tapping **Flags** jumped to the Flags header with Flags active.
- **Search:** "heart" gave 34 results, with the panel above the keyboard. ✕ closes back to the list.
- **Recently used:** after picking 😀 and reopening, the panel shows "Recently used" first with the clock active.

**Fix round 1 (the lead's):** a must-fix crash. Typing in search hit "Changing onViewableItemsChanged nullability on the fly is not supported", because the two `FlatList`s in one ternary had no keys. `key="emoji-search"` / `key="emoji-all"` fixed it, and it was re-checked on the emulator.

The pre-review was clean with 0 findings. `emoji-tab.tsx` is 275 lines.

