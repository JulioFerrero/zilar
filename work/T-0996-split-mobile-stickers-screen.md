---
id: T-0996
title: "Size split T44: apps/mobile/src/app/settings/stickers.tsx (691 lines) into components/stickers/{tile-size,use-stickers-panel,packs-tab,discover-tab,favorites-tab,pack-card}"
status: merged
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

### What I did

Split `apps/mobile/src/app/settings/stickers.tsx` (691 lines) per `docs/audit/size-plan.md` §2.2 #40, following `docs/audit/split-rules.md`. Code was moved unchanged; the only edits were import/prop plumbing needed to pass state and callbacks from the screen into the new modules. The barrel keeps the shell, the `SegmentedControl`, the two dialogs and the default export, and still re-exports `favoriteTileSize`, so `apps/mobile/src/app/settings/sticker-pack.tsx` (line 16, not edited) keeps working.

New files:
- `components/stickers/tile-size.ts` — `favoriteTileSize` (moved unchanged) and `packCountLabel` (plan range 67–73 covers both helpers).
- `components/stickers/use-stickers-panel.ts` — the `StickerTab` type, the page-status state, session-token fork, `reload`, `loadDiscover`, `openTab`, the `run` guard, `addPack`, `askRemove`/`confirmRemove`, `movePack`, `unstar`, `openImport`, and the derived `busy`, `panelIds`, `tile`, `meId`.
- `components/stickers/packs-tab.tsx`, `discover-tab.tsx`, `favorites-tab.tsx` — the three tab bodies, now presentational with callbacks as props.
- `components/stickers/pack-card.tsx` — `PackCard` moved unchanged.

The two **Dedup** items were skipped as the spec says (they cross files: a shared `use-session-token.ts` and ending the cross-screen `from './stickers'` import). Existing files in `components/stickers/` were left untouched.

### Files changed

- `apps/mobile/src/app/settings/stickers.tsx` (modified, barrel + shell)
- `apps/mobile/src/components/stickers/tile-size.ts` (new)
- `apps/mobile/src/components/stickers/use-stickers-panel.ts` (new)
- `apps/mobile/src/components/stickers/packs-tab.tsx` (new)
- `apps/mobile/src/components/stickers/discover-tab.tsx` (new)
- `apps/mobile/src/components/stickers/favorites-tab.tsx` (new)
- `apps/mobile/src/components/stickers/pack-card.tsx` (new)
- `work/T-0996-split-mobile-stickers-screen.md` (this report)

### `wc -l` (old and new)

```
 691  apps/mobile/src/app/settings/stickers.tsx   (old, main)
 193  apps/mobile/src/app/settings/stickers.tsx   (new barrel)
  14  apps/mobile/src/components/stickers/tile-size.ts
 313  apps/mobile/src/components/stickers/use-stickers-panel.ts
 140  apps/mobile/src/components/stickers/packs-tab.tsx
 124  apps/mobile/src/components/stickers/discover-tab.tsx
  70  apps/mobile/src/components/stickers/favorites-tab.tsx
  76  apps/mobile/src/components/stickers/pack-card.tsx
```

Every new file and the barrel are ≤ 400 lines.

### Export diff (`grep -E "^export"`)

Old file (`git show main:apps/mobile/src/app/settings/stickers.tsx`):
```
export default function StickersScreen() {
export function favoriteTileSize(windowWidth: number): number {
```

Barrel plus new files (after):
```
apps/mobile/src/app/settings/stickers.tsx:export { favoriteTileSize } from '@/components/stickers/tile-size';
apps/mobile/src/app/settings/stickers.tsx:export default function StickersScreen() {
apps/mobile/src/components/stickers/tile-size.ts:export function favoriteTileSize(windowWidth: number): number {
apps/mobile/src/components/stickers/tile-size.ts:export function packCountLabel(count: number): string {
apps/mobile/src/components/stickers/use-stickers-panel.ts:export type StickerTab = 'packs' | 'discover' | 'favorites';
apps/mobile/src/components/stickers/use-stickers-panel.ts:export const DISCOVER_ERROR = 'Could not load shared packs.';
apps/mobile/src/components/stickers/use-stickers-panel.ts:export function useStickersPanel() {
apps/mobile/src/components/stickers/packs-tab.tsx:export function PacksTab({
apps/mobile/src/components/stickers/discover-tab.tsx:export function DiscoverTab({
apps/mobile/src/components/stickers/favorites-tab.tsx:export function FavoritesTab({
apps/mobile/src/components/stickers/pack-card.tsx:export function PackCard({
```

The barrel keeps the same two public names as before (`default`, `favoriteTileSize`). The extra exports are internal to the new modules (`packCountLabel`, `StickerTab`, `DISCOVER_ERROR`, the tabs, the hook, `PackCard`) and no file outside the task imported them before.

### Commands run (real results)

- `pnpm install` — done, 20.4s (one pre-existing peer warning: `@types/react-dom` vs `@types/react`).
- `pnpm gate` (from the repo root) — **GATE PASS**. Summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.9s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed `format` on `favorites-tab.tsx`; I ran `prettier --write` on that one file (it only collapsed one JSX line) and re-ran the gate, which passed.
- Single test files: none run. `apps/mobile` has no test files near this change (`grep` found no `*.test.*` referencing stickers); the gate skipped `@zilar/mobile` tests for the same reason. Per `split-rules.md` item 5, no tests were added or edited.

### Effect ratchet (item 6)

`PASS effect`, no `// effect-plain:` marker added. `use-stickers-panel.ts` imports `effect` as a value, so it classifies `effect`; the tab/presentational files and `tile-size.ts` hold no hard or weak signals, so they classify `plain`.

### Deviations from the spec

- `packCountLabel` moved to `tile-size.ts` (the plan gives that file lines 67–73, which include it) and is exported so `pack-card.tsx` can use it; it was never a barrel export, so the barrel's public surface is unchanged.
- `DISCOVER_ERROR` is exported from `use-stickers-panel.ts` and imported by `discover-tab.tsx`, so the error string is not duplicated between the hook (which sets it) and the tab (which shows it as the default title).
- Both Dedup items skipped, as the spec requires.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `settings/stickers.tsx` (691 lines) is now 193 lines, plus `components/stickers/{tile-size,use-stickers-panel,packs-tab,discover-tab,favorites-tab,pack-card}`, the largest `use-stickers-panel.ts` at 313. `favoriteTileSize` is still exported for `sticker-pack.tsx`.
- **The nit:** `discover-tab` imports a constant from the hook module. Harmless.
- **The lead's phone smoke** (mock build, `/settings/stickers`):
  - My packs shows New pack, Import from Telegram, and Cats and Moods with reorder and Remove;
  - moving Cats down puts Moods first;
  - Discover lists Cats and Moods with Remove, and Party with Add.
- **Check:** the gate passed.
