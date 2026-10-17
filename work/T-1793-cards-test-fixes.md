---
id: T-1793
title: "Cards live-test fixes: tables right-align only numeric columns (web + phone, shared chat-core helper); the card guide sends prices/rates/temperatures over time to line, bars only for amounts from zero"
status: merged
milestone: M5
branch: task/T-1793-cards-test-fixes
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1793: Fixes from the live cards test

## Spec (written by Claude, do not edit)

### Why
The lead's live test on 2026-10-17 sent about 20 varied requests to Deepseek in "ai test › cards test" and found two general problems:
1. **The table:** in a La Liga table, the text column "Team" was right-aligned like the numbers. Both renderers right-align **every column after the first**.
2. **The bars:** an EUR/USD week (1.118–1.125) drawn as `bars` looks flat, because bars scale from 0. A trend in a price, rate or temperature belongs in `line`.

### Facts (read by the lead on 2026-10-17)
- **Web:** `apps/web/src/components/message/blocks/TableBlock.tsx` (59 lines). The comment at `:5` says the first column is the label and the rest are numbers; `NUMBER = 'text-right font-mono tabular-nums'` (`:12`) is used for every column after the first.
- **Phone:** `apps/mobile/src/components/chat/blocks/table-block.tsx` (93 lines) does the same with `HEADER_NUM`, `CELL_NUM` and `TOTAL_NUM` (`:12-17`), described at `:32-33`.
- **Shared helpers:** chat-core block helpers live in `packages/chat-core/src/` (`block-charts.ts`, `block-progress.ts`, `block-content.ts`), and `index.ts` exports them.
- **The guide:** `apps/server/src/message-blocks/guide.ts` (94 lines) maps shapes to kinds at `:49` (`'| a value per category | \`bars\` |'`); the `bars` and `line` shape lines are at `:77-78`.

### Steps
1. **A new `packages/chat-core/src/block-table.ts`** with `numericColumns(columns: readonly string[], rows: readonly (readonly string[])[]): boolean[]`. A column is numeric when every non-empty cell matches a formatted number: optional sign, optional currency symbol, digits with `.`, `,` or spaces, then an optional `%` or a short unit of up to 4 letters (`8`, `-0.66%`, `$81,719.29`, `300 ml`, `1 pinch` → not numeric). An empty column is not numeric. Export it from `index.ts`.
2. **Web `TableBlock.tsx` and phone `table-block.tsx`:** use `numericColumns` for the header and the cells. Numeric columns stay right-aligned, mono and tabular; the others are left-aligned in the body font. The `total` row keeps its bold rule.
3. **`guide.ts`:** make the shape map say that `bars` compares amounts or counts across categories (it starts from 0), and that a value over time (a price, rate, temperature or score) is `line` with `points`. Add one rule line: "Never use bars for a trend of close values; use line."
4. **No tests** (UI and the guide text; the guide test only checks that every kind is present). Keep every file at most 400 lines.

### Allowed files
- `packages/chat-core/src/block-table.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/message/blocks/TableBlock.tsx`
- `apps/mobile/src/components/chat/blocks/table-block.tsx`
- `apps/server/src/message-blocks/guide.ts`
- `work/T-1793-cards-test-fixes.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A table's text columns are left-aligned and its number columns right-aligned, on web and phone.
- The guide steers trends to `line`.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **New `packages/chat-core/src/block-table.ts`**: `numericColumns(columns, rows)` returns one flag per column. A column is numeric only when every non-empty cell is a formatted number (optional sign/currency symbol, digits with `.`, `,` or spaces, optional `%` or a unit of up to 4 letters). Empty cells are ignored, and a column with no filled cell is text. Exported from `packages/chat-core/src/index.ts`.
- **Web `TableBlock.tsx`**: computes `numericColumns` once and applies `NUMBER` (`text-right font-mono tabular-nums`) only to numeric header/body cells; other columns keep the body font and left alignment. The total row's bold first/last cell rule is unchanged.
- **Phone `table-block.tsx`**: same helper drives `HEADER_NUM`/`CELL_NUM`/`TOTAL_NUM` vs `HEADER`/`CELL`/`TOTAL` per column, and `TABULAR` is applied only to numeric cells; the total-row edge bold rule is unchanged. The component comment now says a column is numeric, not "every column after the first".
- **`guide.ts`**: the shape map now says `bars` is for "amounts or counts compared across categories (it starts from 0)" and `line` is for "a value over time: a price, rate, temperature or score". Added the rule line "Never use bars for a trend of close values; use `line`." (as its own paragraph after the shape table, so the table stays intact).
- No tests added (UI and guide text, per the spec).

### Checks run

- `pnpm install` → `Done in 16.9s using pnpm v10.32.1`.
- `cd apps/server && pnpm exec vitest run src/message-blocks/guide.test.ts --reporter=dot` → `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- One-off sanity check of the helper with `tsx` (no file added): columns `Team, P, GD, Pts, Empty` with values `8`, `-0.66%`, `$81,719.29`, `300 ml`, `1 pinch` and a blank column → `[ false, true, true, true, false ]`.
- First `pnpm gate`: `PASS install`, `FAIL format` (prettier wanted to reformat my two renderer files). I ran `pnpm exec prettier --write` on exactly those two files, then reran the gate:
```text
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.6s)
PASS  lint  (1.3s)
PASS  typecheck  (8.7s)
PASS  effect  (1.0s)
PASS  tests @zilar/chat-core  (2.5s)
SKIP tests @zilar/mobile (no nearby test files)
PASS  tests @zilar/server  (2.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Detection is deliberately conservative: placeholders like `—` or `n/a`, scores like `2-1`, and cells with more than one word after the digits (`1 pinch`) count as text, so such a column stays left-aligned. Currency amounts, percentages, signed numbers with thousand separators, short units (`300 ml`) and temperatures (`18°`, `21 °C`, `-3°F`) are numeric.
- Deviation: none. I did not run the apps visually; the gate and the helper check above are the evidence.

### Fix round (2026-10-17)

- **Degree units**: the suffix in `packages/chat-core/src/block-table.ts` now accepts `°` with up to one letter alongside `%` and the 1–4 letter unit; the comment lists `18°`, `21 °C` and `-3°F`. Checked with a one-off `tsx` call: `18°`, `21 °C`, `-3°F`, `8`, `300 ml` → `true`; `1 pinch`, `Girona` → `false`.
- **Web comment**: `TableBlock.tsx` now says alignment is per column via `numericColumns` — number columns right-aligned, mono, tabular; text columns left-aligned in the body font.
- Two commits: `92428b129 T-1793: accept degree units in numeric columns`, `c866ee0b0 T-1793: reword stale table alignment comment`.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `e0a454c64`, after one lead fix round (degree units, plus the stale comment).
- **Cosmos `04 · TABLE`:** the text column "AI" is left-aligned in the body font, and Turns, Tokens and Cost are right-aligned in mono. The Total row stays bold. This matches `WebNumbers.dc.html`.
- **`numericColumns`:** a mixed column like the recipe's "Amount" (`1 pinch`, `a little`) now reads as text and is left-aligned, which is the intended conservative rule.
- **The guide** steers trends to `line`.
- `pnpm gate` after both commits:
```text
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.6s)
PASS  lint  (1.0s)
PASS  typecheck  (3.3s)
PASS  effect  (0.6s)
PASS  tests @zilar/chat-core  (1.8s)
SKIP tests @zilar/mobile (no nearby test files)
PASS  tests @zilar/server  (2.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```


