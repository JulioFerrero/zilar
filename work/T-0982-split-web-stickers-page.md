---
id: T-0982
title: "Size split T35: apps/web/src/routes/StickersPage.tsx (765 lines) into components/sticker/{pageActions,PackThumbs,PackRows,FavoriteRow}; one PackRowShell"
status: todo
milestone: M5
branch: task/T-0982-split-web-stickers-page
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0982: Split `StickersPage.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/routes/StickersPage.tsx` is 765 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #31 (task T35): `components/sticker/pageActions.ts`, `sticker/PackThumbs.tsx`, `sticker/PackRows.tsx`, `sticker/FavoriteRow.tsx`, under `apps/web/src/`. The route keeps the page and every export it has today.

- **In scope:** the in-file Dedup. `AddedPackRow` and `DiscoverPackRow` become one `PackRowShell`, and each keeps its own buttons and texts.
- **Shared folder:** T-0981 splits `PackEditor.tsx` into the same new `components/sticker/` folder at the same time. Touch only your own file names.

The lead checks the stickers page in Chrome in mock mode: your packs, discover, adding and removing a pack, and favorites.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #31, and `apps/web/src/routes/StickersPage.tsx`.

### Allowed files
`apps/web/src/routes/StickersPage.tsx`, `apps/web/src/components/sticker/pageActions.ts`, `apps/web/src/components/sticker/PackThumbs.tsx`, `apps/web/src/components/sticker/PackRows.tsx`, `apps/web/src/components/sticker/FavoriteRow.tsx`, `work/T-0982-split-web-stickers-page.md`.

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
