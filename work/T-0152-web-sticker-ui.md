---
id: T-0152
title: Web sticker UI fixes (picker overlap and position, stickers page layout)
status: planned
milestone: M5
branch: task/T-0152-web-sticker-ui
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 0.5 day
---

# T-0152: Web sticker UI fixes

## Spec (written by Claude, do not edit)

### Why
Julio looked at the real web app on 2026-10-01 and the sticker UI is broken:
- The picker popup (`apps/web/src/components/StickerPanel.tsx`): the sticker grid is `grid-cols-6` with `size-[72px]` cells inside a `w-[340px]` panel (6 x 72 = 432 px plus gaps), so stickers overlap each other and the favorite stars sit on top of the neighbours. The panel is `absolute bottom-full left-0`, so it opens at the far LEFT of the message column, nowhere near the emoji button on the right of the composer.
- The Stickers page (`apps/web/src/routes/StickersPage.tsx`, route `/settings/stickers`): everything is stuck to the left edge in tiny text, full width, with no sticker thumbnails in the pack rows (a pack row only shows "lostcat, 30 stickers, Imported from Telegram" and tiny text buttons). It looks unfinished next to the rest of the app.
Both were built to work, not to look right. This task makes them look like the rest of Galena (dark theme, existing tokens and components).

### What to build
1. Picker popup: the grid must never overlap: cells are fixed square tiles that fit the panel (for example 5 columns of 56 px, or `repeat(auto-fill, minmax(64px, 1fr))` with the panel width set so it fits), with a consistent gap, the sticker image `object-contain` inside the tile, the favorite star as a small corner button that does not cover the sticker, and scrolling inside the panel. Same for the Recent and Favorites tabs and the GIF tab thumbnails (check them too).
2. Picker position: anchor the popup to the sticker/emoji button (right-aligned above the button, `right-0` of the button wrapper) and keep it inside the viewport on narrow windows (never cut off at the left or right edge). Close on Escape and on outside click (keep what already exists).
3. Stickers page: a centered column with a sensible max width (like the other settings pages; look at `NotificationsPage` and the settings pages for the pattern), readable text sizes, section cards (My packs, Discover, Favorites), pack rows with a thumbnail strip of the first 4-5 stickers, the title, the sticker count, a visibility badge (Private/Shared), and the actions as proper small buttons or a menu (Share, Edit, Move up/down, Remove from panel, Delete), the Import from Telegram and Create pack buttons in the header. Favorites show a thumbnail grid, Discover shows result cards with thumbnails and an Add button. Empty states get a short friendly sentence.
4. The pack editor / Telegram import dialogs (if they share the page) must use the same spacing and not stick to the left.
5. Keep every existing behavior and accessibility label (roles, aria-labels, test ids the tests use). Update the tests that assert layout classes; add tests for: the grid renders N tiles without overlap classes (assert the column count and tile size fit the panel width), the panel is right-anchored, the pack row renders thumbnails.
6. Verify in a real browser at 1280 px and 390 px wide (`apps/web`, dev server with `GALENA_API_URL=http://localhost:3188`), with the lostcat pack (30 stickers) that exists on the test account; describe what you saw in the Report. Do not send messages on a real account.
7. Out of scope: server, mobile, protocol, new dependencies, behavior changes.

### Read first
`AGENTS.md`, `apps/web/src/components/StickerPanel.tsx`, `StickerMessage.tsx`, `routes/StickersPage.tsx`, `routes/NotificationsPage.tsx` (layout pattern), `apps/web/src/index.css` (tokens), `work/T-0120-*.md` and `work/T-0121-*.md` Reviews for the intended behavior.

### Allowed files
`apps/web/src/components/StickerPanel*.tsx`, `apps/web/src/components/Composer.tsx` (only the picker anchoring), `apps/web/src/routes/StickersPage*.tsx`, small shared UI helpers under `apps/web/src/components/ui/` if needed, `work/T-0152-web-sticker-ui.md`. Not allowed: server, mobile, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/web test --maxWorkers=2 StickerPanel StickersPage Composer
```

### Acceptance
- No overlapping stickers in any picker tab at 1280 px and 390 px; stars never cover a sticker.
- The popup opens next to the emoji button and stays inside the viewport.
- The Stickers page is a centered column with thumbnails in every pack row and a clear action menu or buttons.
- Existing tests pass (layout assertions updated) and new ones are added.

## Report (written by the worker when done)

## Review (written by Claude)
