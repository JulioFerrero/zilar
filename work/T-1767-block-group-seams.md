---
id: T-1767
title: "Cards pass prep: one dispatch point per block group on web and phone (data, charts, progress, content), with empty group renderers, so four group tasks can add the remaining display kinds in parallel without touching BlockCard"
status: merged
milestone: M5
branch: task/T-1767-block-group-seams
model: auto
effort: default
depends_on: [T-1755, T-1756]
estimate: 25 min
---

# T-1767: Block group seams

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-17): cards must work for any request, not only the prices example. The protocol already validates all 25 kinds (`packages/protocol/src/blocks.ts:51-77`), but web and phone draw only six. Four parallel tasks will add the display kinds:
- **data:** `stats`, `table`;
- **charts:** `bars`, `line`, `gauge`;
- **progress:** `progress`, `timeline`, `countdown`;
- **content:** `weather`, `event`.

Each would otherwise edit the same switch in `BlockCard`. This task adds one dispatch point per group, so each group task touches only its own files. **No visible change:** the group renderers return `null` for now, exactly like today's `default`.

### Facts (read by the lead on 2026-10-17)
- **Web:** `apps/web/src/components/message/blocks/BlockCard.tsx` (95 lines). `renderBlock(block)` switches on the six kinds and returns `null` in `default` (`:13-30`). A `null` node is filtered out (`:41-45`).
- **Phone:** `apps/mobile/src/components/chat/blocks/block-card.tsx` (121 lines).
  - `RENDERED: ReadonlySet<Block['kind']>` lists the six kinds (`:16-23`).
  - `BlockBody({ block, showHeading })` switches on the six and returns `null` in `default` (`:57-74`).
  - Read the rest of the file for where `RENDERED` is used.
- **The kind types** come from `@zilar/protocol`: `Block` and each `*Block` type, for example `StatsBlock` and `TableBlock` (`packages/protocol/src/blocks-numbers.ts`, `blocks-progress.ts`, `blocks-content.ts`).

### Steps
1. **Web:** create four group files in `apps/web/src/components/message/blocks/`: `DataBlocks.tsx`, `ChartBlocks.tsx`, `ProgressBlocks.tsx` and `ContentBlocks.tsx`.
   - Each exports one function, for example `renderDataBlock(block: Extract<Block, { kind: 'stats' | 'table' }>): ReactNode`.
   - Each has a `switch` over its kinds that returns `null` for now, with a comment naming the board it will follow:
     - data and charts: `docs/design/mockups/blocks/WebNumbers.dc.html`;
     - progress: `WebProgress.dc.html`;
     - content: `WebContent.dc.html`.
2. **Web `BlockCard.tsx`:** add one `case` group per family to `renderBlock` (`case 'stats': case 'table': return renderDataBlock(block);`, and so on). `default` keeps returning `null`.
3. **Phone:** the same four files in `apps/mobile/src/components/chat/blocks/` (`data-blocks.tsx`, `chart-blocks.tsx`, `progress-blocks.tsx`, `content-blocks.tsx`).
   - Each exports a render function taking `(block, showHeading: boolean)`, plus a `ReadonlySet<Block['kind']>` of the kinds it draws, **empty for now** (for example `DATA_KINDS`).
   - Boards: `PhoneNumbers.dc.html`, `PhoneProgress.dc.html` and `PhoneContent.dc.html`.
4. **Phone `block-card.tsx`:** `RENDERED` becomes the six existing kinds plus the four group sets, and `BlockBody` routes each family to its group function. A group task then adds its kinds to its own set and nothing else.
5. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/web/src/components/message/blocks/DataBlocks.tsx`
- `apps/web/src/components/message/blocks/ChartBlocks.tsx`
- `apps/web/src/components/message/blocks/ProgressBlocks.tsx`
- `apps/web/src/components/message/blocks/ContentBlocks.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/blocks/data-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/chart-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/progress-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/content-blocks.tsx`
- `work/T-1767-block-group-seams.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Web and phone each have the four group files and one dispatch per family.
- Nothing renders differently yet.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Added one dispatch seam per block family on both apps, with no visible change.

**Web** (`apps/web/src/components/message/blocks/`):
- New `DataBlocks.tsx`, `ChartBlocks.tsx`, `ProgressBlocks.tsx`, `ContentBlocks.tsx`. Each exports one `render*Block(block)` function typed `Extract<Block, { kind: ... }>` and returns `ReactNode`; each `switch` returns `null` for now with a comment naming its board (`WebNumbers.dc.html` for data and charts, `WebProgress.dc.html`, `WebContent.dc.html`).
- `BlockCard.tsx`: added the four group `case` groups to `renderBlock` (`stats`/`table`, `bars`/`line`/`gauge`, `progress`/`timeline`/`countdown`, `weather`/`event`). `default` still returns `null`.

**Phone** (`apps/mobile/src/components/chat/blocks/`):
- New `data-blocks.tsx`, `chart-blocks.tsx`, `progress-blocks.tsx`, `content-blocks.tsx`. Each exports a `render*Block(block, _showHeading)` function (the `showHeading` parameter is declared for the group tasks but unused now, so it is underscore-prefixed) plus an empty `ReadonlySet<Block['kind']>` (`DATA_KINDS`, `CHART_KINDS`, `PROGRESS_KINDS`, `CONTENT_KINDS`). Boards: `PhoneNumbers.dc.html` for data and charts, `PhoneProgress.dc.html`, `PhoneContent.dc.html`.
- `block-card.tsx`: `RENDERED` is now the six existing kinds plus the four group sets (all empty, so the set is unchanged), and `BlockBody` routes each family to its group function.

No tests added (UI). All new files are well under 400 lines.

### Checks run

- `pnpm install` — Done in 13.9s (only pre-existing `@types/react-dom` peer warning).
- `pnpm gate` (from repo root) — summary lines:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.7s)
  PASS  lint  (1.3s)
  PASS  typecheck  (6.0s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No single test file was run: both touched packages are UI-only and the gate reported no nearby test files (the spec marks the change UI, no tests).

### Notes for the lead

- The phone group renderers take `(block, showHeading)`; they now accept `_showHeading` because the parameter is not used yet. A group task renaming it to `showHeading` is the only change it needs in its own file.
- `RENDERED` and every dispatch is in place; a group task only adds its kinds to its own set (phone) and fills in its own `switch` (both apps). Nothing else changes in `BlockCard`.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `c4a45cc9e`.
- Web has `DataBlocks`, `ChartBlocks`, `ProgressBlocks` and `ContentBlocks`, each returning `null`, and `BlockCard.renderBlock` routes each family to them.
- The phone has the four twins with empty kind sets. `RENDERED` spreads them and `BlockBody` routes each family, so nothing renders differently.
- **Lead miss:** the spec listed only `weather` and `event` for content, but `place` (21, no map) belongs there too. T-1773 (web) and its phone twin add the `place` case to the routing.

