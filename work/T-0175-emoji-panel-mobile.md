---
id: T-0175
title: Mobile: one emoji button opens a panel with Emoji, Stickers and GIFs tabs (like web)
status: planned
milestone: M5
branch: task/T-0175-emoji-panel-mobile
model: meta/muse-spark-1.3-contributor
effort: medium
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

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/composer.tsx`, `sticker-panel.tsx`, `gif-panel.tsx` and their tests, `apps/web/src/components/StickerPanel.tsx` (the model for tabs and emoji), `docs/design/ui-style.md`.

### Allowed files
`apps/mobile/src/components/chat/composer.tsx`, `sticker-panel.tsx`, `gif-panel.tsx`, new files `apps/mobile/src/components/chat/emoji-*.tsx|ts` and `apps/mobile/src/lib/emoji-data.ts`, and their tests, `work/T-0175-emoji-panel-mobile.md`. Do not touch the voice recorder files (`voice-recorder.tsx`, `voice-message.tsx`, `voice-*.ts`); another change is editing them.

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

## Review (written by Claude)
