---
id: T-0996
title: "Size split T44: apps/mobile/src/app/settings/stickers.tsx (691 lines) into components/stickers/{tile-size,use-stickers-panel,packs-tab,discover-tab,favorites-tab,pack-card}"
status: todo
milestone: M5
branch: task/T-0996-split-mobile-stickers-screen
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0996: Split the mobile stickers screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/stickers.tsx` is 691 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #40 (task T44). The six new files go in `apps/mobile/src/components/stickers/`:
- `tile-size.ts`, `use-stickers-panel.ts`;
- `packs-tab.tsx`, `discover-tab.tsx`, `favorites-tab.tsx`, `pack-card.tsx`.

The screen keeps the shell, the SegmentedControl, the dialogs and its default export.

- **Keep this import working:** `apps/mobile/src/app/settings/sticker-pack.tsx:16` imports `favoriteTileSize` from `./stickers`. Keep `stickers.tsx` re-exporting `favoriteTileSize` from `tile-size.ts`, and do not edit `sticker-pack.tsx`.
- **Skip both Dedup items:** they cross files.
- **Existing files:** leave the files already in `components/stickers/` as they are.

The lead runs a phone smoke of `/settings/stickers` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #40, and `apps/mobile/src/app/settings/stickers.tsx`.

### Allowed files
`apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/components/stickers/tile-size.ts`, `apps/mobile/src/components/stickers/use-stickers-panel.ts`, `apps/mobile/src/components/stickers/packs-tab.tsx`, `apps/mobile/src/components/stickers/discover-tab.tsx`, `apps/mobile/src/components/stickers/favorites-tab.tsx`, `apps/mobile/src/components/stickers/pack-card.tsx`, `work/T-0996-split-mobile-stickers-screen.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
