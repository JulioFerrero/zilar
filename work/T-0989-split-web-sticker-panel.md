---
id: T-0989
title: "Size split T49: apps/web/src/components/StickerPanel.tsx (634 lines) into components/sticker/{StickerThumb,FavoriteStar,emoji,StickerGrid}; one toChoice and one favoriteFrom"
status: todo
milestone: M5
branch: task/T-0989-split-web-sticker-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0989: Split `StickerPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/StickerPanel.tsx` is 634 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #45 (task T49). The new files go in `apps/web/src/components/sticker/`, which T-0981 and T-0982 created: `StickerThumb.tsx`, `FavoriteStar.tsx`, `emoji.ts` and `StickerGrid.tsx`. Leave the files already in that folder as they are. `StickerPanel.tsx` keeps the tab state, the queries, the emoji tab and every export it has today.

The in-file Dedup is in scope:
- one `toChoice` for the three-branch mapping in `activeStickers`;
- one `favoriteFrom(choice)` for `applyFavorite` and `undoFavorite`.

The lead checks it in Chrome in mock mode: the composer's sticker panel, with its tabs, sending a sticker, and starring and unstarring one.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #45, and `apps/web/src/components/StickerPanel.tsx`.

### Allowed files
`apps/web/src/components/StickerPanel.tsx`, `apps/web/src/components/sticker/StickerThumb.tsx`, `apps/web/src/components/sticker/FavoriteStar.tsx`, `apps/web/src/components/sticker/emoji.ts`, `apps/web/src/components/sticker/StickerGrid.tsx`, `work/T-0989-split-web-sticker-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

## Review (written by Claude)
