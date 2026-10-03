---
id: T-0175
title: Mobile: one emoji button opens a panel with Emoji, Stickers and GIFs tabs (like web)
status: review
milestone: M5
branch: task/T-0175-emoji-panel-mobile
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 1 day
---

# T-0175: Mobile emoji panel with Emoji, Stickers and GIFs tabs

## Spec (written by Claude, do not edit)

### Why
Julio, testing the Android build: "the emoji button is the only one needed, the emojis, stickers and GIFs need to be inside the same popup instead of 3 different buttons". Today the mobile composer row has Smile (emoji, does nothing), Sticker and GIF buttons, each opening its own sheet. The web already has one panel with tabs (`apps/web/src/components/StickerPanel.tsx`: tabs Stickers / GIFs / Emoji, the GIFs tab hidden when the provider is off). Mobile gets the same shape.

### What to build
1. **One button.** In `apps/mobile/src/components/chat/composer.tsx` remove the Sticker and GIF buttons; the Smile button opens ONE bottom sheet. The row becomes: Attach, text field, Smile, then Send or the mic.
2. **One sheet with tabs** `Emoji | Stickers | GIFs` (Emoji first and selected by default; remember the last tab for the session). The Stickers tab shows what `sticker-panel.tsx` shows today (pack strip with Recent, grid, pick sends, manage link, retry state) and the GIFs tab what `gif-panel.tsx` shows today (search, trending, infinite scroll, pick sends, rate-limit and unavailable states). Refactor those two into tab-body components that the new sheet hosts; keep their behaviour and their existing tests passing (adjust only imports and names). The GIFs tab is hidden when the GIF provider is off (reuse the existing availability probe, as web does) and a tab that disappears under the active tab falls back to the first visible one.
3. **Emoji tab.** A grid of common emoji grouped by category (smileys, gestures and people, hearts, animals, food, activities, travel, objects, symbols), with a category strip on top and a Recent row (last 24 used, kept in the same storage seam the sticker recents use). The list lives in a new `apps/mobile/src/lib/emoji-data.ts` (about 250 emoji, plain Unicode strings, no new dependency). Tapping an emoji inserts it at the caret in the composer text (track the TextInput selection with `onSelectionChange`; with no known selection append at the end) and does NOT close the sheet, so several can be added; the sheet closes with its handle, a tap outside, or the back button, as the other sheets do.
4. **Sizing.** The sheet takes about half of the screen height and never hides the text field's current line; on Android with the keyboard open it replaces the keyboard (dismiss the keyboard when it opens, and closing it with a tap on the field brings the keyboard back).
5. **Tests (Vitest, same style as the existing panel tests):** the composer row has exactly one emoji-related button and no Sticker or GIF buttons; the panel shows the three tabs; the GIFs tab is hidden when the probe says off; picking an emoji inserts it at a given caret and at the end when there is no selection; a pick of a sticker and of a GIF still sends (reuse the existing assertions); recents are updated and capped at 24.

### Implementation hints from the lead (read this; a first worker lost two hours without writing code)
Work in this order and **commit after each step**: (1) `apps/mobile/src/lib/emoji-data.ts` plus its test; (2) the emoji tab body component plus its test; (3) the tabbed sheet hosting the three tab bodies; (4) the composer change (one button, caret tracking); (5) the sticker grid spacing, GIF-tab hiding and composer height fixes listed under "Addenda"; (6) checks and Report. Write code from the first minutes. Do not explore beyond the files under "Read first".
- **Do not hunt for icons.** These lucide-react-native icons are verified to exist in this repo: `Smile, Hand, Heart, PawPrint, Pizza, Trophy, Plane, Lightbulb, Hash, Clock, Sticker, Film, Search, Utensils, Dumbbell, Car, Shapes, ThumbsUp, Leaf, Music, Flag, Gamepad2`. Import them from `lucide-react-native` as `composer.tsx` does. Suggested category icons: smileys `Smile`, gestures and people `Hand`, hearts `Heart`, animals `PawPrint`, food `Pizza`, activities `Trophy`, travel `Plane`, objects `Lightbulb`, symbols `Hash`, recent `Clock`; tabs: Emoji `Smile`, Stickers `Sticker`, GIFs `Film`.
- A real sheet pattern already exists: copy how `attach-sheet.tsx` builds its bottom sheet (Modal, handle, safe area); do not invent a new one.
- Keyboard: call `Keyboard.dismiss()` from `react-native` when the sheet opens; back button via the Modal's `onRequestClose`.
- Tests render with `react-dom/server` and mocked `react-native` (see `sticker-panel.test.tsx`); there is no React Native testing library, so pin logic in pure functions (emoji insertion at a caret, recents cap at 24, grid cell size, field height) and test those.

### Addenda from Julio's phone test (2026-10-03), also in scope
1. **Sticker grid spacing is wrong** inside the sheet (uneven gaps, crowded items). Fix `sticker-panel.tsx`: 5 columns, equal cell size computed from the sheet width, equal gaps, padding like the other sheets. Pin the cell-size computation with a test.
2. **The GIFs tab must not make the panel vanish**: when the GIF provider is off the tab is hidden and the sheet stays open on the first visible tab. Test it.
3. **Lucide icons for every control; emoji characters only as emoji content** in the grid and the Recent row.
4. **The composer well is about twice as tall as it should be** (a big empty gap above the buttons and the placeholder; one empty line should be about 52 px: a 36 px field plus 8 px padding top and bottom). Probable cause in `composer.tsx`: `onContentSizeChange` sets the field height to `contentSize.height + 16`, but on Android the reported content height already includes the field's `py-2` padding, so it is counted twice. Make the sizing a small pure function `fieldHeightFor(contentHeight)`, unit-test it for 1, 2 and 8 lines and the cap, and make an empty one-line field exactly `MIN_INPUT_HEIGHT`. The voice recorder file must not be edited, but you may change how the composer lays it out.

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/composer.tsx`, `sticker-panel.tsx`, `gif-panel.tsx` and their tests, `apps/web/src/components/StickerPanel.tsx` (the model for tabs and emoji), `docs/design/ui-style.md`.

### Allowed files
`apps/mobile/src/components/chat/composer.tsx`, `composer-gifs.test.tsx`, `composer-layout.test.ts`, `sticker-panel.tsx`, `gif-panel.tsx`, new files `apps/mobile/src/components/chat/emoji-*.tsx|ts` and `apps/mobile/src/lib/emoji-data.ts`, and their tests, `work/T-0175-emoji-panel-mobile.md`. Do not touch the voice recorder files (`voice-recorder.tsx`, `voice-message.tsx`, `voice-*.ts`); another change is editing them.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 composer sticker gif emoji
```

### Acceptance
- One emoji button; tapping it opens one sheet with working Emoji, Stickers and GIFs tabs.
- Existing sticker and GIF behaviour is unchanged (their tests pass).
- Emoji pick inserts at the caret and the sheet stays open.
- No new dependency.

### Out of scope
Skin-tone variants, emoji search, animated emoji, the web composer.

---

## Report (written by the worker when done)

### What I did
Built the one-button mobile emoji panel with Emoji | Stickers | GIFs tabs, plus the three addenda (sticker grid spacing, GIF-tab hiding, composer height).
- `apps/mobile/src/lib/emoji-data.ts` (new): 9 categories (~270 emoji, plain Unicode), `insertEmojiAtCaret`, `rememberRecentEmoji`/`readRecentEmoji` (cap 24), `EMOJI_RECENTS_STORAGE` + `readStoredEmojiRecents`/`persistEmojiRecent` on the same memory-backend seam as sticker recents. Test: `emoji-data.test.ts` (6 tests).
- `apps/mobile/src/components/chat/emoji-tab.tsx` (new): category strip with Lucide icons (Recent `Clock`, smileys `Smile`, people `Hand`, hearts `Heart`, animals `PawPrint`, food `Pizza`, activities `Trophy`, travel `Plane`, objects `Lightbulb`, symbols `Hash`), 8-column grid, empty-recents copy. Test: `emoji-tab.test.tsx` (5 tests).
- `apps/mobile/src/components/chat/emoji-sheet.tsx` (new): one half-height (`h-[50%]`) sheet with tab row (Lucide `Smile`/`Sticker`/`Film` + labels), `resolveSheetTab` fallback to first visible tab, hosts `EmojiTab`/`StickerGrid`/`GifPanel`. Test: `emoji-sheet.test.tsx` (9 tests incl. cell-size math and GIF-hidden fallback).
- `sticker-panel.tsx`: extracted `StickerGrid` body (unchanged behaviour; `StickerPanel` now wraps it, so existing tests pass unedited); 5 equal columns via `stickerCellSize(sheetWidth)` measured with `onLayout` (default 360), equal 8px gaps, 16px side padding; sheet is now half-height like the others. `useWindowDimensions` was dropped because the existing sticker test mocks `react-native` without it (that test file is outside Allowed files, so the component had to adapt).
- `gif-panel.tsx`: `GifSheet` sheet height aligned to `h-[50%]` (one line).
- `composer.tsx`: removed Sticker and GIF row buttons (row is now Attach, field, Smile, Send/mic); Smile opens the sheet with `Keyboard.dismiss()`; caret tracked via `onSelectionChange`; `pickEmoji` inserts at caret and keeps sheet open; session-remembered tab + emoji category state; GIF availability probe still feeds `gifsVisible`; `fieldHeightFor(contentHeight)` replaces the `+16` double-padding sizing.
- Tests updated (all in Allowed files): `composer-gifs.test.tsx` (one-button row, caret wiring, `fieldHeightFor` 1/2/8-line + cap + NaN, GIF-tab visibility now asserted through the sheet wiring), `composer-layout.test.ts` (comment now says Attach/field/emoji share the row).

### Files changed
`apps/mobile/src/lib/emoji-data.ts` + `.test.ts` (new), `components/chat/emoji-tab.tsx` + `.test.tsx` (new), `components/chat/emoji-sheet.tsx` + `.test.tsx` (new), `components/chat/composer.tsx`, `sticker-panel.tsx`, `gif-panel.tsx`, `composer-gifs.test.tsx`, `composer-layout.test.ts`, this task file.

### Commands and real results
- `pnpm install`: ok (6.9s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 composer sticker gif emoji`: 16 files, 111 tests, all passed.
- `pnpm format:check`: pass (after `prettier --write` on touched files).
- `pnpm lint`: pass. `pnpm typecheck`: pass (11 tasks ok).
- Icon check: all suggested lucide-react-native exports exist (`Smile`, `Hand`, `Heart`, `PawPrint`, `Pizza`, `Trophy`, `Plane`, `Lightbulb`, `Hash`, `Clock`, `Sticker`, `Film`); no new dependency added.

### Deviations / notes
- The T-0148-era composer tests asserted a standalone GIFs row button; the spec removes that button, so I retargeted those three assertions to the sheet's GIFs tab (same availability semantics). Existing `sticker-panel.test.tsx` / `gif-panel.test.tsx` pass unedited.
- Sheet height: `h-[50%]` (spec: "about half"). The pack strip is a plain row (not horizontally scrollable) — same as before; many packs could overflow, pre-existing behaviour.
- Security checklist: no secrets/URLs logged; emoji recents validated on read (string, ≤16 chars, cap 24); sticker/GIF URL trust checks untouched; no new routes.

### Blocked / needs a decision
None.

## Review (written by Claude)
