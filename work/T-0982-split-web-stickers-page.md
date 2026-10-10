---
id: T-0982
title: "Size split T35: apps/web/src/routes/StickersPage.tsx (765 lines) into components/sticker/{pageActions,PackThumbs,PackRows,FavoriteRow}; one PackRowShell"
status: merged
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

Status: done. Split `apps/web/src/routes/StickersPage.tsx` (765 lines) along the
`docs/audit/split-rules.md` rules. The route keeps the page and every export it
had before; the moved code is unchanged except the planned Dedup.

### Files (with `wc -l`)

Old:

- `apps/web/src/routes/StickersPage.tsx`: 765 (main, before the change)

New:

- `apps/web/src/routes/StickersPage.tsx`: 319 (barrel + page)
- `apps/web/src/components/sticker/pageActions.ts`: 207
- `apps/web/src/components/sticker/PackThumbs.tsx`: 55
- `apps/web/src/components/sticker/PackRows.tsx`: 184
- `apps/web/src/components/sticker/FavoriteRow.tsx`: 30

Every file is under the 400-line limit.

### Exports before and after (`grep -E "^export"`)

Before (`git show HEAD:apps/web/src/routes/StickersPage.tsx`):

```
228:export interface PackRowThumb {
484:export { SETTINGS_COLUMN };
486:export function StickersPage() {
```

After (barrel + new files):

```
apps/web/src/routes/StickersPage.tsx:37:export { SETTINGS_COLUMN };
apps/web/src/routes/StickersPage.tsx:38:export type { PackRowThumb } from '@/components/sticker/PackThumbs';
apps/web/src/routes/StickersPage.tsx:40:export function StickersPage() {
apps/web/src/components/sticker/pageActions.ts:19:export type PageStatus = 'loading' | 'ready' | 'error';
apps/web/src/components/sticker/pageActions.ts:22:export interface PageSetters {
apps/web/src/components/sticker/pageActions.ts:29:export interface MoveRequest {
apps/web/src/components/sticker/pageActions.ts:38:export function failureText(failure: ApiFailure, fallback: string): string {
apps/web/src/components/sticker/pageActions.ts:43:export const loadPanel = (
apps/web/src/components/sticker/pageActions.ts:59:export const loadDiscover = (
apps/web/src/components/sticker/pageActions.ts:68:export const refreshPanel = (setters: PageSetters): Effect.Effect<void> =>
apps/web/src/components/sticker/pageActions.ts:77:export const searchPacks = (query: string, setters: PageSetters): Effect.Effect<void> =>
apps/web/src/components/sticker/pageActions.ts:87:export const toggleVisibility = (pack: StickerPack, setters: PageSetters): Effect.Effect<void> => {
apps/web/src/components/sticker/pageActions.ts:123:export const addToPanel = (packId: string, setters: PageSetters): Effect.Effect<void> =>
apps/web/src/components/sticker/pageActions.ts:132:export const removeFromPanel = (packId: string, setters: PageSetters): Effect.Effect<void> =>
apps/web/src/components/sticker/pageActions.ts:141:export const deletePack = (packId: string, setters: PageSetters): Effect.Effect<void> =>
apps/web/src/components/sticker/pageActions.ts:155:export const unstarSticker = (stickerId: string, setters: PageSetters): Effect.Effect<void> =>
apps/web/src/components/sticker/pageActions.ts:193:export const movePack = (
apps/web/src/components/sticker/FavoriteRow.tsx:7:export function FavoriteRow({ sticker, setters }: { sticker: Sticker; setters: PageSetters }) {
apps/web/src/components/sticker/PackRows.tsx:19:export function MyPackRow({
apps/web/src/components/sticker/PackRows.tsx:136:export function AddedPackRow({ pack, setters }: { pack: StickerPack; setters: PageSetters }) {
apps/web/src/components/sticker/PackRows.tsx:154:export function DiscoverPackRow({
apps/web/src/components/sticker/PackThumbs.tsx:3:export interface PackRowThumb {
apps/web/src/components/sticker/PackThumbs.tsx:9:export function PackThumbs({ thumbs }: { thumbs: PackRowThumb[] }) {
apps/web/src/components/sticker/PackThumbs.tsx:34:export function thumbsOf(pack: StickerPack): PackRowThumb[] {
apps/web/src/components/sticker/PackThumbs.tsx:41:export type VisibilityBadge = 'Shared' | 'Private';
apps/web/src/components/sticker/PackThumbs.tsx:43:export function VisibilityBadge({ label }: { label: VisibilityBadge }) {
```

The route still exports exactly what it did before: `PackRowThumb` (type),
`SETTINGS_COLUMN` and `StickersPage`. The extra names in the new modules are the
helpers each module now needs to share; no file outside the task's own files
changed, so importers are untouched.

### Dedup (in-file)

`AddedPackRow` and `DiscoverPackRow` had identical thumbnail/title/count markup.
Both now render through one `PackRowShell` (buttons passed as `children`); each
keeps its own buttons and texts (`Remove`, and `Add`/`Remove`). `MyPackRow`
keeps its own markup as the plan says. ~23 duplicated lines collapsed.

### Effect ratchet

`pageActions.ts` imports `Effect` as a value, so it is an `effect` file;
`PackThumbs.tsx`, `PackRows.tsx` and `FavoriteRow.tsx` are pure JSX with no
hard signal, so they classify `plain`. No `// effect-plain:` marker was needed;
the gate's `effect` step passed.

### Commands run (real results)

- `pnpm install`: done in 11.8s.
- `pnpm --filter @zilar/web build`: `✓ built in 1.03s` (no errors).
- `pnpm gate` from the repo root: ended `GATE PASS`.

Gate summary lines:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.2s)
PASS  lint  (1.2s)
PASS  typecheck  (5.8s)
PASS  effect  (2.3s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test files were run: no test file is near the change
(`SKIP tests @zilar/web (no nearby test files)`), and UI code gets no tests.

### Deviations / open questions

None. No new dependencies. No files outside Allowed files.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `StickersPage.tsx` (765 lines) is now 319 lines, plus `components/sticker/{pageActions,PackThumbs,PackRows,FavoriteRow}`. One `PackRowShell` serves the added and the discover rows.
- **The lead checked it in Chrome on `/settings/stickers?mock=1`:**
  - My packs, Discover and Favorites show;
  - Remove on Moods in Discover drops it from My packs and shows Add;
  - Add brings it back.
- **Seen on main too:** the mock thumbnails are broken images that show their emoji alt text. That is the mock media gap from wave 2.
- **Check:** the gate passed, and so did the web build.
