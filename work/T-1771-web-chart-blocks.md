---
id: T-1771
title: "Cards pass web: the bars (05), line (06) and gauge (07) blocks, drawn exactly like WebNumbers.dc.html, with the scaling math shared in chat-core"
status: merged
milestone: M5
branch: task/T-1771-web-chart-blocks
model: auto
effort: default
depends_on: [T-1767]
estimate: 45 min
---

# T-1771: Web chart blocks

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-17) wants cards that work for any request. This task draws **05 bar chart**, **06 line chart** and **07 gauge** on web. The math goes into chat-core, so the phone twin draws the same shapes.

### Facts (read by the lead on 2026-10-17)
- **The board:** `docs/design/mockups/blocks/WebNumbers.dc.html`: `06 · LINE CHART` at `:68-90`, `07 · GAUGE` at `:91-110` and `05 · BAR CHART` at `:150-180` (SVG paths and sizes inline). The chart `aria-label` example is at `:73`. Also `docs/design/mockups/blocks/README.md:20-40`, and D24 in `docs/design/ui-style.md`.
- **The schemas:** `BarsBlockSchema` (`packages/protocol/src/blocks-numbers.ts:165-182`), `LineBlockSchema` (`:183-199`) and `GaugeBlockSchema` (`:200-…`). Numbers by contract: `series[].value`, `points[]`, `min`/`max` and `ratio`. Everything else is a display string.
- **The existing shared math:** `packages/chat-core/src/blocks.ts` (82 lines) has `sparklinePath(points, width, height, pad)`, which `NumberBlock.tsx` uses.
- **The seam (T-1767):** `apps/web/src/components/message/blocks/ChartBlocks.tsx` exports `renderChartBlock(block)`, which returns `null` for `bars`, `line` and `gauge`.
- **The chat-core index:** `packages/chat-core/src/index.ts`. Add your export **right after line 3** (`export * from './format-duration';`). Other parallel tasks add theirs after lines 20 and 49, so the merges don't collide.

### Steps
1. **Shared math:** a new `packages/chat-core/src/block-charts.ts`, exported from the index after line 3.
   - `barHeights(series, maxHeight)` scales the values to heights, with a 0-safe max;
   - `linePath(points, width, height, min?, max?)` honours the optional bounds (reuse `sparklinePath`'s rounding);
   - `gaugeArc(ratio, radius)` returns the SVG arc `d` for the board's gauge sweep, clamped to 0–1.
   - No React.
2. **The components:** `BarsBlock.tsx`, `LineBlock.tsx` and `GaugeBlock.tsx` in `apps/web/src/components/message/blocks/`, drawn to the board, with the `current` bar highlighted, the labels under the line chart, and the value and caption under the gauge.
   - Each chart has an `aria-label` saying the title and the main value. Colour is never the only signal.
3. **`ChartBlocks.tsx`:** return the three components.
4. **A new fixture,** `apps/web/src/components/message/blocks/ChartBlocks.fixture.tsx`, with the board's sample data.
5. **No tests** (UI and view math; the plan has no tests here). Keep every file at most 400 lines.

### Allowed files
- `packages/chat-core/src/block-charts.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/message/blocks/BarsBlock.tsx`
- `apps/web/src/components/message/blocks/LineBlock.tsx`
- `apps/web/src/components/message/blocks/GaugeBlock.tsx`
- `apps/web/src/components/message/blocks/ChartBlocks.tsx`
- `apps/web/src/components/message/blocks/ChartBlocks.fixture.tsx`
- `work/T-1771-web-chart-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `bars`, `line` and `gauge` render on web like the board.
- The math lives in chat-core for the phone twin.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Shared math in chat-core (`packages/chat-core/src/block-charts.ts`, exported from the index right after `format-duration`):

- `barHeights(series, maxHeight)` scales values to heights with a 0-safe peak (`Math.max(..., 0)`; an all-zero series gives zero heights, never a divide-by-zero).
- `linePath(points, width, height, min?, max?)` draws the `M/L` path, honouring the optional bounds and clamping points that fall outside them to the box; a flat series sits on the mid-line. Same 1-decimal rounding as `sparklinePath`.
- `gaugeArc(ratio, radius)` draws the gauge sweep as an `A` arc from 12 o'clock clockwise, clamped to 0–1; the path is centred on the origin (the renderer translates it), and ratio 1 becomes two half arcs (a single 360° arc is degenerate).

The three components, drawn from `docs/design/mockups/blocks/WebNumbers.dc.html`:

- `BarsBlock.tsx` (05): header with title + value, the dark raised columns with the `current` one on the light key gradient, and the same gradient's brighter value/label text so the highlight is never colour alone. Peak drawn at 87% of the 120 px track, as in the board.
- `LineBlock.tsx` (06): header, three dashed quarter gridlines, faint area fill, the `#ededed` 1.6 px line, an end marker, the min/max bound labels (`pt-14`/`pb-12` like the board) and the time labels underneath.
- `GaugeBlock.tsx` (07): the `#0c0c0c` well track and the `#ededed` value arc (9 px, round cap) in an 80 px box, the ratio percent as the ring text, and the label, mono value and caption beside it.

Each chart carries an `aria-label` with its title and main value (the gauge follows the board: `Daily limit, 62 percent used`).

`ChartBlocks.tsx` now returns the three components; `ChartBlocks.fixture.tsx` renders each on the boards' `#0a0a0a` page with the board's sample data (messages per day; BTC 24 h; the daily limit gauge).

### Checks run

- `pnpm gate` (from the repo root, final run with the code as committed):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.9s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.7s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/chat-core  (2.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says no tests (UI and view math), and `@zilar/web` has no nearby tests.

### Notes for the lead

- **Bound labels on the line chart.** The board shows `82.3k`/`79.1k` but the schema only carries `min`/`max` as numbers, so I label the axis with the raw `min`/`max` numbers and only when both are given (otherwise the line keeps the full width). The spec only asked for "the labels under the line chart" (the time labels); I added the bound labels because the board draws them and the fields exist. Say the word if you'd rather drop them or format them differently.
- **`gaugeArc` coordinate system.** It returns the arc centred on `(0,0)` and `GaugeBlock` wraps it in `translate(40 40)`. That lets the renderer keep the board's 80 px box (a 32 px radius with a 9 px stroke clips in a 64 px box). The phone twin must translate the same way.
- **`GaugeBlock` ignores the optional `detail` field** (the board has no line for it and the spec asked for "the value and caption"); if it's meant to show, tell me where.
- Files changed: `packages/chat-core/src/block-charts.ts` (new, 66 lines), `packages/chat-core/src/index.ts` (one export line after `format-duration`), `apps/web/src/components/message/blocks/{BarsBlock,LineBlock,GaugeBlock}.tsx` (new), `ChartBlocks.tsx`, `ChartBlocks.fixture.tsx` (new), and this task file. Every file is inside the Allowed files.
- No dependencies added. Only prettier was run on my own files (not the repo) before the gate; the gate itself ran everything once.

### Round 2 (lead fix round)

- **1. Compact bound labels.** Added `compactNumber(n)` to `block-charts.ts` (one decimal, no trailing `.0`, sign kept: `950`→`950`, `79100`→`79.1k`, `1234567`→`1.2M`, `2.5e9`→`2.5B`) and used it for the line chart's bound labels. The fixture now uses the real `79100`/`82300` (points scaled to match). Commit `f9c7b0ad4`.
- **2. Gauge `detail`.** `GaugeBlock` draws `detail` as one more muted 12 px line under the caption (the fixture shows it too). Commit `b46958cbd`. This supersedes the round-1 note above that said `detail` is ignored.
- **3. Negative bars.** `barHeights` clamps values `<= 0` to zero height; the bar's label still shows the real value.
- **4. aria fallback.** Bars fall back to `"Bar chart"` and the line to `"Line chart"` when both `title` and `value` are absent.
- 3 and 4 share commit `36f2bfbef` (one commit for the pair, as asked).
- The first gate run failed `@zilar/web#typecheck`: `compactNumber(block.max)` was `number | undefined`. Fixed by narrowing to a `bounds` object in `LineBlock.tsx`, squashed into commit `f9c7b0ad4` with a fixup rebase.
- `pnpm gate` after all of the above:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.4s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.7s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/chat-core  (1.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- This Report note is committed after the gate and changes no code (`work/` is outside the gate's format and scope checks).

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `fc9906011`. The review was rerun on paid Muse after the free one failed at start.
- **Round 1:** I took Cosmos screenshots of the three fixtures and compared them with `WebNumbers.dc.html`. They match:
  - the bars with a highlighted `current`;
  - the line with its area, labels and end marker;
  - the gauge ring with its percentage, value and caption.
- **Round 2:**
  - `compactNumber` (`79100` gives `79.1k`, M and B as well) is used for the line bounds;
  - the gauge draws `detail`;
  - negative bars clamp to a height of 0;
  - the charts fall back to an aria-label.
- **Follow-up nit:** `compactNumber` prints values under 1,000 unrounded (`79.123`). Round them to 2 places when the phone twin reuses it.

