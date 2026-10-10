---
id: T-0989
title: "Size split T49: apps/web/src/components/StickerPanel.tsx (634 lines) into components/sticker/{StickerThumb,FavoriteStar,emoji,StickerGrid}; one toChoice and one favoriteFrom"
status: merged
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

### What I did
Split `apps/web/src/components/StickerPanel.tsx` (634 lines) into the four files the
plan entry names. `StickerPanel.tsx` stays the component (tabs, queries, emoji tab,
all exports); the moved pieces are imported from `./sticker/`.

- `sticker/StickerThumb.tsx`: `StickerThumb` plus the two small sync-edge storage
  helpers `readStoredRecents` and `panelStorage` (plan range 63–105).
- `sticker/FavoriteStar.tsx`: `FavoriteStar`.
- `sticker/emoji.ts`: `COMMON_EMOJI`.
- `sticker/StickerGrid.tsx`: the whole Stickers tab body (pack tab strip, tile grid,
  hover preview, manage link), plus its own `preview` state and `TILE_PX` layout
  constant (see Deviations).
- `StickerPanel.tsx`: tab state, queries, emoji tab; imports the moved pieces.
  `StickerChoice` and `StickerPanelProps` stay here, so importers
  (`ComposerControls.tsx`, `useComposerAttachments.ts`) are untouched.

In-file Dedup applied:
- `toChoice(source: Sticker | RecentStickerEntry)` (narrowed on `'stickerId' in source`)
  replaces the three-branch `StickerChoice` mapping in `activeStickers`.
- `favoriteFrom(choice)` replaces the `Sticker` built in both `applyFavorite` and
  `undoFavorite`.

No behaviour change otherwise. No deps added.

### Files changed
- `apps/web/src/components/StickerPanel.tsx` (634 → 334)
- `apps/web/src/components/sticker/StickerThumb.tsx` (new, 53)
- `apps/web/src/components/sticker/FavoriteStar.tsx` (new, 59)
- `apps/web/src/components/sticker/emoji.ts` (new, 32)
- `apps/web/src/components/sticker/StickerGrid.tsx` (new, 206)

All new files and the barrel are under 400 lines. The files already in
`components/sticker/` were not touched.

### Export diff (`grep -E "^export"`)
Before (old `StickerPanel.tsx`):
```
export interface StickerChoice
export interface StickerPanelProps
export function StickerPanel
```
After — barrel `StickerPanel.tsx` (unchanged names/kinds):
```
export interface StickerChoice
export interface StickerPanelProps
export function StickerPanel
```
Added by the new files (imported by the barrel, not exported from it):
```
StickerThumb.tsx   export function StickerThumb; export function readStoredRecents; export function panelStorage
FavoriteStar.tsx   export function FavoriteStar
emoji.ts           export const COMMON_EMOJI
StickerGrid.tsx    export interface StickerGridProps; export function StickerGrid
```

### Commands run
- `pnpm install` → `Done in 37.1s` (peer-dep warning for `@types/react-dom` only).
- `pnpm --filter @zilar/web build` → `✓ built in 1.09s` (only the pre-existing
  "chunks larger than 500 kB" warning).
- `pnpm gate` (from repo root):
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.6s)
PASS  lint  (0.8s)
PASS  typecheck  (3.8s)
PASS  effect  (0.8s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
No individual test file was run: the panel is UI code with no test near it (rule 5;
gate skipped the package's tests because no nearby test files exist). No
`// effect-plain:` marker was needed — the ratchet passed.

### Deviations from the spec
- The plan's literal `StickerGrid.tsx (475–631)` range did not include the grid's
  local hover state (`preview`) or the `TILE_PX` layout constant (old lines 236 and
  374–380). I moved them into `StickerGrid.tsx` because both are used only there and
  passing them as props would have been artificial. Code is otherwise moved
  unchanged.
- `readStoredRecents` and `panelStorage` went into `StickerThumb.tsx` exactly as the
  plan range 63–105 specifies, even though they are not thumbnail-related.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `StickerPanel.tsx` (634 lines) is now 334 lines, plus `sticker/{StickerThumb,FavoriteStar,emoji,StickerGrid}`, the largest `StickerGrid.tsx` at 206. One `toChoice` and one `favoriteFrom` replace the copies.
- **The lead checked it in Chrome at `?mock=1`, in Marta's chat:**
  - the sticker panel opens with the Stickers, GIFs and Emoji tabs and the Recent, Cats, Moods, star and + pack tabs;
  - starring a Cats sticker puts it in favorites, and unstarring it gives "No favorites yet";
  - tapping a sticker sends it: a 🐱 bubble appears, and Marta moves to the top of the list.
- **Check:** the gate passed, and so did the web build.
