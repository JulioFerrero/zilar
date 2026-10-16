---
id: T-1770
title: "Cards pass web: the stats (03) and table (04) blocks, drawn exactly like WebNumbers.dc.html, in the data group renderer"
status: merged
milestone: M5
branch: task/T-1770-web-data-blocks
model: auto
effort: default
depends_on: [T-1767]
estimate: 35 min
---

# T-1770: Web stats and table blocks

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-17) wants cards that work for any request. The server already accepts every kind (`packages/protocol/src/blocks.ts:51-77`), but web draws only six. This task draws **03 stat tiles** and **04 table**.

### Facts (read by the lead on 2026-10-17)
- **The board:** `docs/design/mockups/blocks/WebNumbers.dc.html`: `03 · STAT TILES` at `:111-129` and `04 · TABLE` at `:130-149`. The shared card chrome and type rules are in its `<style>` and in `docs/design/mockups/blocks/README.md:20-40`. D24 only: `docs/design/ui-style.md`.
- **The schemas:** `StatsBlockSchema` (`packages/protocol/src/blocks-numbers.ts:124-140`) and `TableBlockSchema` (`:141-164`). Read their exact fields; `ratio` is 0–1 and the rest are pre-formatted strings.
- **The seam (T-1767):** `apps/web/src/components/message/blocks/DataBlocks.tsx` exports `renderDataBlock(block)`, whose switch returns `null` for `stats` and `table`. `BlockCard.tsx` already routes both kinds there.
- **The patterns to copy:** `FigureBlock.tsx` (57 lines: tabular mono numbers, right-aligned) and `NumberBlock.tsx` (61) in the same folder. `BlockCard.fixture.tsx` (184 lines) is the Cosmos fixture shape.

### Steps
1. New `StatsBlock.tsx` and `TableBlock.tsx` in `apps/web/src/components/message/blocks/`, drawn to the board's exact sizes, colours and spacing (read the board's inline styles):
   - **stats:** the optional title, then 1–6 tiles in the board's grid. Each tile has a label and a value, plus a thin ratio bar when `ratio` is set.
   - **table:** the optional title, then a header row and the rows. Numbers are mono, tabular and right-aligned like the board; if `total` is set, the last row is a total row. A table wider than the card scrolls inside its own `overflow-x: auto` box.
2. **`DataBlocks.tsx`:** return the two components from its switch.
3. **A new Cosmos fixture,** `apps/web/src/components/message/blocks/DataBlocks.fixture.tsx`: a `BlockCard` with the board's own sample content for each kind, so the lead can screenshot it next to the board.
4. **No tests** (UI). Keep every file at most 400 lines. Use lucide only for icons, never emoji.

### Allowed files
- `apps/web/src/components/message/blocks/StatsBlock.tsx`
- `apps/web/src/components/message/blocks/TableBlock.tsx`
- `apps/web/src/components/message/blocks/DataBlocks.tsx`
- `apps/web/src/components/message/blocks/DataBlocks.fixture.tsx`
- `work/T-1770-web-data-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A `blocks` card with `stats` or `table` renders on web like the board.
- The fixture shows both.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

New `StatsBlock.tsx` and `TableBlock.tsx`, wired into `DataBlocks.tsx`'s switch, plus a
`DataBlocks.fixture.tsx` with the board's own samples. No tests (UI, per the spec).

- **`StatsBlock.tsx` (03 · STAT TILES):** the optional title row (lucide `Server` icon, 13/500
  `#a1a1a1`, like the board's `.head`), then the board's fixed two-column tile grid
  (`repeat(2, minmax(0,1fr))`, 8 px gap). Each tile is the board's inner surface (`#101010`,
  `#1f1f1f` border, 12 px radius, 10/12 padding, 6 px gap): label 12 px `#a1a1a1`, value 18/24
  mono tabular left-aligned, and, when `ratio` is set, the recessed 6 px track
  (`#0c0c0c` + the board's inset shadow) with the raised light fill
  (`linear-gradient(180deg,#f5f5f5,#b5b5b5)`) at `ratio × 100%`. A tile without a `ratio` keeps a
  6 px spacer so the row heights stay even, exactly like the board's `<span style="height:6px">`.
- **`TableBlock.tsx` (04 · TABLE):** the optional title row (no icon, like the board's `.head`),
  then a CSS grid with the first column `1fr` and the rest `auto`, 18 px column gap. Header cells
  are 12 px `#8a8a8a` over a `#232323` rule; data cells have `#1c1c1c` rules and 6 px vertical
  padding; every column after the first is right-aligned mono tabular. With `total: true` the last
  row is the total row (6 px top padding, semibold in its first and last cells, no rule under it).
  The grid sits in an `overflow-x-auto` box with `min-w-max`, so a table wider than the card
  scrolls inside its own box instead of stretching the card.
- **`DataBlocks.tsx`:** the switch now returns `<StatsBlock block={block} />` and
  `<TableBlock block={block} />` instead of `null`.
- **`DataBlocks.fixture.tsx`:** two Cosmos entries on the boards' `#0a0a0a` page —
  `03 · STAT TILES` (chat.zilar.app; CPU 23%, Memory 3.1 / 8 GB, Disk 41%, Uptime 12 d; time
  10:30) and `04 · TABLE` (AI spend this week, the board's four columns and four rows including
  the Total row; time Sun 20:00).

### Checks run

```bash
pnpm install   # Done in 22.8s using pnpm v10.32.1
pnpm gate      # from the repo root
```

`pnpm gate` summary:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.8s)
PASS  lint  (1.3s)
PASS  typecheck  (5.5s)
PASS  effect  (1.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No test file was touched, so no single test file was run (the spec says no tests for this UI task);
`pnpm gate` skipped `@zilar/web` tests for the same reason. Every changed file is inside the
Allowed files.

### Notes for the lead

- **Table column convention:** the payload carries no column type, so I read the board's own
  convention: the first column is the row label (left-aligned) and every later column is a
  pre-formatted number (mono, tabular, right-aligned). Say the word if a table should support a
  left-aligned text column elsewhere.
- **Icons:** the `stats` title row draws a lucide `Server` glyph to match the board's 03 server-rack
  header; the `table` title row draws no icon, matching the board's 04 header.
- **Not rendered in a browser:** I did not run Cosmos or take a screenshot; the fixture is there for
  your screenshot next to `WebNumbers.dc.html`. The gate is the only check I ran.
- No deviations from the spec. Files changed: the four Allowed files plus this task file (status and
  this Report).

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `10e172687`.
- I took Cosmos screenshots of `DataBlocks.fixture` (03 and 04) and compared them with `WebNumbers.dc.html:111-149`. They match:
  - **stats:** the 2-column tile grid, 12px labels, 18px mono tabular values, and the 6px ratio track;
  - **table:** the header row in `#8a8a8a`, the `#1c1c1c` row rules, mono right-aligned columns, and a bold total.
- The only difference is the font. Cosmos falls back from Geist Mono, which the board loads.

