---
id: T-1775
title: "Cards pass phone: the stats (03) and table (04) blocks, drawn exactly like PhoneNumbers.dc.html, in the phone data group renderer, with catalog examples"
status: merged
milestone: M5
branch: task/T-1775-phone-data-blocks
model: auto
effort: default
depends_on: [T-1767]
estimate: 35 min
---

# T-1775: Phone stats and table blocks

## Spec (written by Claude, do not edit)

### Why
This is the phone twin of T-1770, for Julio's 2026-10-17 "cards for any request". Web and phone ship every user-facing change together.

### Facts (read by the lead on 2026-10-17)
- **The board:** `docs/design/mockups/blocks/PhoneNumbers.dc.html`: `03 · STAT TILES` at `:68-86` and `04 · TABLE` at `:87-103`. Phone text is 15/21 and the key size is 40 px (`docs/design/mockups/blocks/README.md:20-40`). D24 only: `docs/design/ui-style.md`.
- **The schemas:** `StatsBlockSchema` (`packages/protocol/src/blocks-numbers.ts:124-140`) and `TableBlockSchema` (`:141-164`).
- **The seam (T-1767):** `apps/mobile/src/components/chat/blocks/data-blocks.tsx` exports `DATA_KINDS` (an empty set) and `renderDataBlock(block, _showHeading)`, which returns `null`. `block-card.tsx` already spreads `DATA_KINDS` into `RENDERED` and routes both kinds.
- **The pattern to copy:** `figure-block.tsx` (65 lines) in the same folder: tabular mono numbers with NativeWind classes and `@/components/ui/text`.
- **The catalog:** the hidden dev catalog `apps/mobile/src/mock/dev-blocks-screen.tsx` (190 lines) lists `EXAMPLES` (`:22-…`), rendered at `zilar://dev/blocks`.

### Steps
1. New `stats-block.tsx` and `table-block.tsx` in `apps/mobile/src/components/chat/blocks/`, drawn to the phone board:
   - **stats:** the tiles in the board's grid, with a thin ratio bar when `ratio` is set;
   - **table:** a header row and the rows, with numbers mono, tabular and right-aligned, and a total row when `total` is set. A table wider than the card scrolls horizontally inside its own `ScrollView horizontal`.
2. **`data-blocks.tsx`:** set `DATA_KINDS` to `stats` and `table`, rename `_showHeading` to `showHeading` if you use it, and return the two components.
3. **The catalog:** **append** two examples (`03 · STAT TILES` and `04 · TABLE`) at the **end** of `EXAMPLES` in `dev-blocks-screen.tsx`, with the board's sample content.
4. **No tests.** Keep every file at most 400 lines. Use lucide only for icons.

### Allowed files
- `apps/mobile/src/components/chat/blocks/stats-block.tsx`
- `apps/mobile/src/components/chat/blocks/table-block.tsx`
- `apps/mobile/src/components/chat/blocks/data-blocks.tsx`
- `apps/mobile/src/mock/dev-blocks-screen.tsx`
- `work/T-1775-phone-data-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `stats` and `table` render on the phone like the board.
- The catalog shows both.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Filled the phone data group with the two bodies from `PhoneNumbers.dc.html` and
added both to the dev catalog.

**New `apps/mobile/src/components/chat/blocks/stats-block.tsx` (79 lines).** 03 · STAT TILES:
tiles laid out two per row (a lone last tile keeps the board's half width); each tile is the
board's `#101010` / `#1f1f1f` 12 px inner surface with a 12 px `#a1a1a1` label and the 18/24
mono value, over a 6 px D24 well track (`docs/design/ui-style.md:111-113`) whose light key
gradient fill (`#f5f5f5`→`#b5b5b5`) is `ratio × 100 %` wide when `ratio` is set, and an empty
6 px spacer when it is not (the board keeps every tile the same height, `:79`).

**New `apps/mobile/src/components/chat/blocks/table-block.tsx` (93 lines).** 04 · TABLE:
the header row and the body rows, built **column by column**, so a column is as wide as its
widest cell and all rows stay aligned without measuring. Column one is the label column; every
other column is mono, tabular and right-aligned. Header cells are 12 px `#8a8a8a` with a
`#232323` bottom rule; body cells are 14 px with a `#1c1c1c` bottom rule (each cell carries its
own rule, so the line breaks at the 14 px column gaps exactly as the board's grid does). The
whole grid sits in its own `ScrollView horizontal` (`contentContainerStyle={{ flexGrow: 1 }}`),
and the label column `grow shrink-0`, so a short table fills the card and a wide one scrolls.

**`data-blocks.tsx` (24 lines).** `DATA_KINDS` is now `stats` and `table`; `_showHeading` is
renamed `showHeading` (it is used) and `renderDataBlock` returns the two components.

**`dev-blocks-screen.tsx` (232 lines).** Appended two examples at the **end** of `EXAMPLES`,
`03 · STAT TILES` (`10:30`) and `04 · TABLE` (`Sun 20:00`), with the board's sample content —
the same four tiles with `ratio` 0.23/0.39/0.41 and no bar on Uptime, and the AI-spend table
with its `Total` row and `total: true`. Nothing else in the file was touched or reordered.

No tests (UI, spec says none). All files are well under 400 lines.

### Checks run

- `pnpm install` — Done in 21.9s using pnpm v10.32.1.
- `pnpm gate` (from repo root) — summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (1.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (5.8s)
  PASS  effect  (1.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: the change is phone UI only and the gate reported no nearby test
  files (`SKIP tests @zilar/mobile`).
- I did not run the app or screenshot the catalog; the render was checked against the board by
  reading the markup, not visually.

### Notes for the lead

- **I did not run the app, so "renders like the board" is a code-level claim, not a screenshot.**
  The lead's phone smoke is the real check.
- **`total` semantics (assumption, please align web/phone).** `rows` are pre-formatted
  `NumberText` strings, so a renderer cannot sum them (the board's own total, `241 / 2.3M /
  $1.50`, is authored text). I read `total: true` as "the last row **is** the total row" and draw
  it with the board's total styling: `pt-[7px]`, 14 px, no bottom rule, first and last cell
  `font-semibold` (`PhoneNumbers.dc.html:96`). The catalog example follows that: the `Total` row
  is the last row and `total: true`. If T-1770's web twin computes a total instead, one of the
  two must change — a protocol comment would settle it.
- **`showHeading` is used.** When the card has no header and the block carries its own `title`,
  both blocks draw a 14 px / `#a1a1a1` / 500 title row, the same shape `ChecklistBlock` uses. The
  catalog examples use a card-level title (like the board), so the board's look is unchanged.
- The board's stat-tile header icon is a server-rack glyph with no matching name in
  `BlockIconSchema`; the catalog example uses `activity` for `chat.zilar.app`.
- Only the exact four Allowed code files plus this task file changed (gate `scope` line); nothing
  in `block-card.tsx` or the sibling group files was touched.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `0fb4abab2`.
- `DATA_KINDS` = `stats` and `table`. `stats-block.tsx` and `table-block.tsx` follow `PhoneNumbers.dc.html:68-103`: the tile grid with a ratio track, and the table with its rules and a total.
- The two catalog examples are appended at the end of `EXAMPLES`.
- **The pre-review follow-up is resolved:** the web twin (T-1770, merged) also draws `total` as "the last row is the total, bold in its first and last cells", so both apps agree.
- **The emulator screenshot of `zilar://dev/blocks` against the board is still to do.** It must happen before the next APK. There's no emulator while Julio is at the PC.
