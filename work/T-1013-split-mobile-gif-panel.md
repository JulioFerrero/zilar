---
id: T-1013
title: "Size split T95: apps/mobile/src/components/chat/gif-panel.tsx (461 lines) into chat/{gif-cells,gif-paging,gif-panel-sheet}"
status: merged
milestone: M5
branch: task/T-1013-split-mobile-gif-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1013: Split the mobile GIF panel

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/gif-panel.tsx` is 461 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #91 (task T95): `components/chat/gif-cells.tsx`, `chat/gif-paging.ts`, `chat/gif-panel-sheet.tsx`, under `apps/mobile/src/`. `gif-panel.tsx` keeps the panel and every export it has today.

- **Move unchanged:** move the code as it is, and skip the Dedup. `panel-sheet.tsx` is shared with `sticker-panel.tsx`, so it crosses files.

The lead runs a phone smoke of the composer's GIF tab in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #91, and `apps/mobile/src/components/chat/gif-panel.tsx`.

### Allowed files
`apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/components/chat/gif-cells.tsx`, `apps/mobile/src/components/chat/gif-paging.ts`, `apps/mobile/src/components/chat/gif-panel-sheet.tsx`, `work/T-1013-split-mobile-gif-panel.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

**What I did.** Move-only split of `apps/mobile/src/components/chat/gif-panel.tsx` (461 lines) into the three files the plan entry (`docs/audit/size-plan.md` §2.2 #91) names, following `docs/audit/split-rules.md`. The moved code is unchanged and `gif-panel.tsx` stays the barrel that keeps `GifPanel` and re-exports every name it exported before.

I skipped the entry's **Dedup** (`runUntilCleanup` + a shared `PanelSheet` into `chat/panel-sheet.tsx`), as the spec says: it is shared with `sticker-panel.tsx`, so it crosses files and belongs to a separate F task. Consequences:

- `runUntilCleanup` and `cancelWait` stay in `gif-panel.tsx`, next to their only caller (`GifPanel`). The plan's `gif-cells.tsx` range (23–103) listed them only because the dedup would have moved `runUntilCleanup` out; they are not a cell concern, so moving them would be a new cross-module export with no dedup benefit.
- `GifPanelProps` is now `export`ed from `gif-panel.tsx` so `gif-panel-sheet.tsx` can type `GifSheet` as `GifPanelProps & { onClose }`, the composition it had. This adds one **type** export; no value export or kind changed.
- `fetchGifPageEffect` is newly `export`ed from `gif-paging.ts` so `GifPanel` can use the Effect (it was module-private). It is not re-exported by the barrel, so the public surface is unchanged.

**Files changed** (all inside the Allowed files):

| File | Lines | Contents |
| --- | --- | --- |
| `apps/mobile/src/components/chat/gif-panel.tsx` | 461 → **292** | keeps `GifPanel` and the private `runUntilCleanup` / `cancelWait`; barrel re-exports |
| `apps/mobile/src/components/chat/gif-cells.tsx` | **70** | `CELL_ASPECT`, `isPanelGifUrl`, `GifCell` |
| `apps/mobile/src/components/chat/gif-paging.ts` | **69** | `fetchGifPage`, `fetchGifPageEffect`, `probeGifsAvailability`, `probeGifsAvailabilityEffect` |
| `apps/mobile/src/components/chat/gif-panel-sheet.tsx` | **47** | `GifSheet` (+ local `GifSheetProps`) |
| `work/T-1013-split-mobile-gif-panel.md` | — | status + this Report |

Every new file and the barrel are ≤ 400 lines; no `max-lines` warning. `sticker-panel.tsx` and every file outside the Allowed files are untouched.

**Export list, before and after** (`grep -E "^export"`; old = `git show HEAD:apps/mobile/src/components/chat/gif-panel.tsx`):

```
old (gif-panel.tsx)                          new (barrel + moved files)
export function isPanelGifUrl(...)      →    gif-cells.tsx:       export function isPanelGifUrl(...)
export function GifCell(...)            →    gif-cells.tsx:       export function GifCell(...)
export function GifPanel(...)           →    gif-panel.tsx:       export function GifPanel(...)
export const fetchGifPage = ...         →    gif-paging.ts:       export const fetchGifPage = ...
export const probeGifsAvailability = …  →    gif-paging.ts:       export const probeGifsAvailability = ...
export function GifSheet(...)           →    gif-panel-sheet.tsx: export function GifSheet(...)
                                             + export type GifPanelProps = { ... }   (added type, see above)
                                             gif-paging.ts also exports fetchGifPageEffect (internal before)
```

Barrel re-export lines:

```
export { GifCell, isPanelGifUrl } from './gif-cells';
export { fetchGifPage, probeGifsAvailability } from './gif-paging';
export { GifSheet } from './gif-panel-sheet';
```

The six original value names are all still exported from `apps/mobile/src/components/chat/gif-panel.tsx`, with the same names and kinds. Only `GifPanelProps` (type) is added.

**Importers.** Only two files import the module, by the unchanged path:

- `apps/mobile/src/components/chat/emoji-sheet.tsx` → `GifPanel`
- `apps/mobile/src/components/chat/composer-sheet.ts` → `probeGifsAvailability`

Both still resolve through the barrel. `gif-panel-sheet.tsx` imports `GifPanel` from `./gif-panel`, so the barrel and the sheet form a cycle (`gif-panel → gif-panel-sheet → gif-panel`); it is safe because `GifPanel` is a hoisted `function` declaration referenced only inside the `GifSheet` component body, never at module-evaluation time. No importer changed.

**Effect ratchet.** No `// effect-plain:` marker was needed and none was added: `gif-paging.ts` and `gif-panel.tsx` import `effect` as a value → kind `effect`; `gif-cells.tsx` and `gif-panel-sheet.tsx` hit no hard or weak signal (`expo-image` is not in the H9 list) → kind `plain`. Gate printed `PASS effect`.

**Commands run (real results).**

- `pnpm install` — resolved 1262, reused 1141, added 1; done in 17.3s. One pre-existing peer warning: `@types/react-dom` wants `@types/react@^19.3.0` (found 19.2.18).
- `pnpm gate` (from the repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.8s)
PASS  lint  (1.2s)
PASS  typecheck  (4.4s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

I ran no single test file: `apps/mobile/src/components/chat/` holds no test for these sources, no test imports the module, and per the split rules this is UI code that gets no tests; the gate selected no nearby tests.

**Deviations from the spec.** Only the skipped Dedup (the spec asks for it) plus the one added `GifPanelProps` type export. No behaviour change and no other file touched.

**Security checklist.** Not applicable: presentation-only move, no data, routes, storage, permissions or logging.

**Blocked / needs a decision.** None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `gif-panel.tsx` (461 lines) is now 292 lines, plus `gif-cells`, `gif-paging` and `gif-panel-sheet`. The code moved unchanged.
- **The lead's phone smoke** (mock build, Ana's chat): Emoji › GIFs shows the search box, six cells ("Send 🐱 dancing" and the rest) and "Powered by Giphy". The cell images are blank because the mock has no media.
- **Check:** the gate passed.
