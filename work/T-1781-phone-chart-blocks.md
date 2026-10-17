---
id: T-1781
title: "Cards pass phone: the bars (05), line (06) and gauge (07) blocks, drawn exactly like PhoneNumbers.dc.html with react-native-svg, reusing chat-core's chart math, with catalog examples"
status: merged
milestone: M5
branch: task/T-1781-phone-chart-blocks
model: auto
effort: default
depends_on: [T-1771]
estimate: 45 min
---

# T-1781: Phone chart blocks

## Spec (written by Claude, do not edit)

### Why
This is the phone twin of T-1771 (merged), for Julio's 2026-10-17 "cards for any request".

### Facts (read by the lead on 2026-10-17)
- **The board:** `docs/design/mockups/blocks/PhoneNumbers.dc.html`: `05 · BAR CHART` at `:104-123`, `06 · LINE CHART` at `:124-145` and `07 · GAUGE` at `:146-172`. Phone sizes are in `docs/design/mockups/blocks/README.md:20-40`. D24 only.
- **The schemas:** `BarsBlockSchema`, `LineBlockSchema` and `GaugeBlockSchema` (`packages/protocol/src/blocks-numbers.ts:165,183,200`).
- **The shared math (T-1771),** in `packages/chat-core/src/block-charts.ts`, exported from `@zilar/chat-core`: `compactNumber` (`:21`), `barHeights` (`:35`, which clamps negatives), `linePath` (`:48`) and `gaugeArc` (`:73`). Use them.
- **The web twin, to match its behaviour:** `apps/web/src/components/message/blocks/BarsBlock.tsx`, `LineBlock.tsx` and `GaugeBlock.tsx`. They draw:
  - the bars with a highlighted `current`;
  - the line with an area, the time labels and compact bounds;
  - the gauge ring with its value, caption and `detail`;
  - and they fall back to an aria label.
- **The existing phone sparkline:** the phone already draws one in `number-block.tsx` (same folder). Copy how it uses `react-native-svg`.
- **The seam (T-1767):** `apps/mobile/src/components/chat/blocks/chart-blocks.tsx` exports `CHART_KINDS` (an empty set) and `renderChartBlock(block, _showHeading)`, which returns `null`.
- **The catalog:** `EXAMPLES` in `apps/mobile/src/mock/dev-blocks-screen.tsx`.

### Steps
1. New `bars-block.tsx`, `line-block.tsx` and `gauge-block.tsx` in `apps/mobile/src/components/chat/blocks/`, drawn to the phone board with `react-native-svg`.
   - Each sets `accessibilityRole="image"` and an `accessibilityLabel` with the title and value, or "Bar chart" / "Line chart" when both are missing.
2. **`chart-blocks.tsx`:** set `CHART_KINDS` to the three kinds and return the components.
3. **Rounding:** `compactNumber` in `packages/chat-core/src/block-charts.ts` must round values under 1,000 to at most 2 decimals (`79.123` gives `79.12`, `950` gives `950`). Add a case to the existing chat-core test if there is one for this file; otherwise no test.
4. **The catalog:** **append** three examples (05, 06, 07) at the **end** of `EXAMPLES`. Use real-sized values for the line (`79100`–`82300`).
5. **No new tests** except step 3's. Keep every file at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/blocks/bars-block.tsx`
- `apps/mobile/src/components/chat/blocks/line-block.tsx`
- `apps/mobile/src/components/chat/blocks/gauge-block.tsx`
- `apps/mobile/src/components/chat/blocks/chart-blocks.tsx`
- `apps/mobile/src/mock/dev-blocks-screen.tsx`
- `packages/chat-core/src/block-charts.ts`
- `work/T-1781-phone-chart-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `bars`, `line` and `gauge` render on the phone like the board.
- The bounds read `79.1k`.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `bars-block.tsx`, `line-block.tsx` and `gauge-block.tsx` in
  `apps/mobile/src/components/chat/blocks/`, drawn to
  `docs/design/mockups/blocks/PhoneNumbers.dc.html` with `react-native-svg`, reusing
  chat-core's math (`barHeights`, `linePath`, `gaugeArc`, `compactNumber`):
  - **05 bars:** a 120 px track with the peak at 87%, the `current` column on the
    light key gradient with a brighter value and label, and the board's 6/3 px radii.
  - **06 line:** the board's 260×110 viewBox with three dashed gridlines, a faint
    area fill, compact bounds on the right (`82.3k`/`79.1k`) and the time labels.
  - **07 gauge:** the 76 px ring (80 viewBox, r 32, 9 px stroke, round cap) with the
    percent inside, and the label, value, caption and detail beside it.
  - Each sets `accessibilityRole="image"` on the chart surface; bars/line fall back to
    `Bar chart`/`Line chart` when title and value are both missing, the gauge uses
    `<label>, <n> percent used` like the web twin.
- `chart-blocks.tsx`: `CHART_KINDS` is now `bars`/`line`/`gauge` and
  `renderChartBlock` returns the three components (passing `showHeading` to bars/line).
- `packages/chat-core/src/block-charts.ts`: `compactNumber` now rounds values under
  1,000 to at most 2 decimals.
- `dev-blocks-screen.tsx`: appended the 05, 06 and 07 examples at the end of
  `EXAMPLES`; the line uses real-sized points (`79100`–`82300`), so the bounds read
  `79.1k` and `82.3k`.

### Checks run

- `pnpm install`: `Done in 15.4s` (pre-existing peer warning: `@types/react-dom`
  19.3.0 wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm exec tsx -e "…compactNumber…"` in `packages/chat-core`:
  `79.12 | 950 | 82.3k | 79.1k | -79.13 | 0`.
- `pnpm gate` (first run): `FAIL format` on `bars-block.tsx` and `line-block.tsx`
  only; ran `pnpm exec prettier --write` on those two files.
- `pnpm gate` (final run) summary lines:
 ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.1s)
  PASS  lint  (1.5s)
  PASS  typecheck  (4.9s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/chat-core  (2.0s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: no test file exists for `block-charts.ts`, and the
  spec says to add a case only if one exists.

### Notes for the lead

- Step 3: no test was added because there is no existing chat-core test for
  `block-charts.ts` (confirmed by grep for `compactNumber`/`barHeights`/`linePath`/
  `gaugeArc` in `*.test.ts`/`*.test.tsx`); the spec allows this.
- Deviations, all to match the phone board: the line omits the web twin's end marker
  dot (the phone board draws none, `PhoneNumbers.dc.html:129-132`); bars/line hide
  their title and value row when `showHeading` is false (the card has its own header),
  like `StatsBlock`; the gauge ignores `showHeading` because its label is required and
  part of the row. The gauge percent is a React Native `Text` overlaid on the `Svg`
  (the codebase has no `SvgText` usage), so it uses the loaded Geist Mono.
- Files changed (7, all inside Allowed files): the three new block files,
  `chart-blocks.tsx`, `dev-blocks-screen.tsx`, `packages/chat-core/src/block-charts.ts`
  and this task file.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `e5145a8db`. The session was interrupted at 01:22 UTC and resumed by the lead at 08:20; the work was committed after the gate passed.
- **`CHART_KINDS`** holds bars, line and gauge. The three components use react-native-svg with the shared `barHeights`, `linePath`, `gaugeArc` and `compactNumber`, each with an accessibility label and a fallback.
- `compactNumber` now rounds values under 1,000 to 2 decimals (the T-1771 nit).
- Three examples are appended to the catalog.
- **The emulator check is still to do** (Julio is at the PC this morning).

