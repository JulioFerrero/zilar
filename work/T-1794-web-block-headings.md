---
id: T-1794
title: "Cards live-test fixes 2 (web): block headings hide under a card header like the phone (no repeated title), and a wide table shows a right-edge fade and keeps its last row clear of the scrollbar"
status: merged
milestone: M5
branch: task/T-1794-web-block-headings
model: auto
effort: default
depends_on: [T-1793]
estimate: 35 min
---

# T-1794: Web block headings and wide tables

## Spec (written by Claude, do not edit)

### Why
The lead's live cards test on 2026-10-17 found two web problems:
1. **Repeated titles:** cards repeat their title. The card header says "Earth vs Mars" and the table under it says "Earth vs Mars" again; a checklist did the same.
   - The phone already hides a block's own heading when the card has a header.
   - The board does the same: `docs/design/mockups/blocks/Main.dc.html:74-77`. Its "Morning briefing" card has one header, and its checklist shows no title of its own.
   - Web always draws the block heading.
2. **Wide tables:** a table wider than the card scrolls sideways, but nothing shows that it is cut, and the overlay scrollbar covers the last row.

### Facts (read by the lead on 2026-10-17)
- **Phone, the rule to copy:**
  - `apps/mobile/src/components/chat/blocks/block-card.tsx:65-93`: `BlockBody({ block, showHeading })` passes `showHeading` to the checklist and status blocks and to `renderDataBlock`, `renderChartBlock`, `renderProgressBlock` and `renderContentBlock`.
  - `:135` renders `<BlockBody block={block} showHeading={!hasHeader} />`.
  - The phone renderers use it like this: `table-block.tsx:50` (`showHeading && block.title !== undefined`), `bars-block.tsx:37` and `line-block.tsx:33` (`showHeading && (block.title !== undefined || block.value !== undefined)`), plus `stats-block.tsx:64`, `checklist-block.tsx:54`, `timeline-block.tsx:47`, `status-block.tsx:36` and `countdown-block.tsx:38-43`.
- **Web:**
  - `apps/web/src/components/message/blocks/BlockCard.tsx:17-48`: `renderBlock(block)` has no heading flag. `hasHeader` is computed at `:63`.
  - The web renderers always draw the title: `ChecklistBlock.tsx:26`, `TimelineBlock.tsx:50`, `StatusBlock.tsx:28`, `StatsBlock.tsx:18-21`, `BarsBlock.tsx:25`, `LineBlock.tsx:32` and `TableBlock.tsx:25-29`.
  - The group renderers are `DataBlocks.tsx`, `ChartBlocks.tsx`, `ProgressBlocks.tsx` and `ContentBlocks.tsx`.
- **Web table:** `TableBlock.tsx:33-34` wraps the grid in `<div className="min-w-0 overflow-x-auto">` with a `min-w-max` grid. The card is `max-w-[380px]` (`BlockCard.tsx:89`). The card surface is `#141414`.

### Steps
1. **Headings:** give the web renderers the same `showHeading` flag as their phone twins, and hide the same parts.
   - `renderBlock(block, showHeading)` in `BlockCard.tsx`, called with `!hasHeader`.
   - The group render functions pass it through.
   - Every web renderer whose phone twin takes `showHeading` takes it too: checklist, status, stats, table, bars, line, timeline, countdown, plus any other the phone file lists.
   - Content kinds (link, place, event, weather) keep their own title, because it's their content.
   - Fixtures need no change; a fixture without a card header still shows the block titles.
2. **Wide table** (`TableBlock.tsx`):
   - Measure whether the grid overflows its scroll box: `scrollWidth > clientWidth`, with a `ResizeObserver`, updated on scroll.
   - While it overflows:
     - add `pb-[8px]` inside the scroll box, so an overlay scrollbar never covers the last row;
     - show a 24 px right-edge fade from transparent to `#141414` over the box. It's pointer-events none, and it hides once the box is scrolled to the end.
   - A table that fits looks exactly as it does today.
3. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/web/src/components/message/blocks/DataBlocks.tsx`
- `apps/web/src/components/message/blocks/ChartBlocks.tsx`
- `apps/web/src/components/message/blocks/ProgressBlocks.tsx`
- `apps/web/src/components/message/blocks/ContentBlocks.tsx`
- `apps/web/src/components/message/blocks/ChecklistBlock.tsx`
- `apps/web/src/components/message/blocks/TimelineBlock.tsx`
- `apps/web/src/components/message/blocks/StatusBlock.tsx`
- `apps/web/src/components/message/blocks/StatsBlock.tsx`
- `apps/web/src/components/message/blocks/BarsBlock.tsx`
- `apps/web/src/components/message/blocks/LineBlock.tsx`
- `apps/web/src/components/message/blocks/TableBlock.tsx`
- `apps/web/src/components/message/blocks/CountdownBlock.tsx`
- `apps/web/src/components/message/blocks/ProgressBlock.tsx`
- `work/T-1794-web-block-headings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A card with a header shows no repeated block heading, the same as the phone and the board.
- A card without a header still shows its block titles.
- A table wider than the card shows a right-edge fade, and its last row stays clear of the scrollbar.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

**Headings (same rule as the phone):**
- `BlockCard.tsx`: `renderBlock(block, showHeading)` now takes the flag and is called with
  `!hasHeader` (computed before the block list). It passes the flag to checklist, status and
  the four group renderers, mirroring `block-card.tsx` on the phone.
- `DataBlocks.tsx`, `ChartBlocks.tsx`, `ProgressBlocks.tsx`: the group functions take
  `showHeading` and pass it to their renderers (bars/line only for charts; the gauge block has
  no heading row on the phone and was left unchanged).
- `ContentBlocks.tsx`: takes `_showHeading` exactly like the phone, and link/place/event/
  weather keep their own title because it is their content.
- Renderers now hide the same parts as their phone twins:
  - `ChecklistBlock.tsx`: the whole title + "done of total" row.
  - `StatusBlock.tsx`: the whole title row.
  - `TimelineBlock.tsx`: the whole title row.
  - `CountdownBlock.tsx`: the label row (tiles stay).
  - `ProgressBlock.tsx`: the label + percent row (bar, detail and note stay).
  - `StatsBlock.tsx`: the title row only when `title` is set.
  - `TableBlock.tsx`: the title row only when `title` is set.
  - `BarsBlock.tsx`, `LineBlock.tsx`: the title/value row when either is set.
- Cards without a header still get `showHeading: true`, so fixtures without a card header keep
  their block titles.

**Wide table (`TableBlock.tsx`):**
- The scroll box now sits in a `relative` wrapper and is measured: `scrollWidth > clientWidth`
  with a `ResizeObserver` on the box and on the grid, plus an `onScroll` handler that updates
  `atEnd`.
- While it overflows, the scroll box gets `pb-[8px]` (keeps the last row clear of an overlay
  scrollbar) and a 24 px `pointer-events-none` right-edge fade
  (`from-transparent to-[#141414]`, `aria-hidden`) is drawn over it. The fade disappears when
  `scrollLeft + clientWidth` reaches the end.
- A table that fits gets neither the padding nor the fade, so it looks as before.

No tests were added: UI-only change, as the spec says. All edited files are well under 400 lines.

### Checks run

- `pnpm install` — done, 17.4 s, one pre-existing peer warning (`@types/react-dom` wants
  `@types/react@^19.3.0`, found 19.2.18 in `apps/mobile`); no failure.
- First `pnpm gate`: FAIL only on `format` (`TableBlock.tsx` needed Prettier); scope/size/
  migration/images all passed.
- `pnpm exec prettier --write apps/web/src/components/message/blocks/TableBlock.tsx` — fixed.
- Final `pnpm gate` from the repo root:

```
gate: 15 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.5s)
PASS  lint  (1.2s)
PASS  typecheck  (4.4s)
PASS  effect  (1.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run, because this change has no nearby tests (gate reported
`SKIP tests @zilar/web`).

### Notes for the lead

- I did not open the web app in a browser, so the two visual outcomes (no repeated heading,
  fade over a wide table) are verified against the code and the phone/board behaviour, not by
  a live screen. Worth one look in the lead's live cards check.
- The fade is 24 px and sits inside the card's `#141414` surface, hiding only while the grid
  overflows and the box is not scrolled to the end.
- `GaugeBlock.tsx` was deliberately not touched: its phone twin does not take `showHeading`,
  and it is outside Allowed files.
- No deviations from the Spec, no open questions.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `496aac2a9`.
- **Cosmos `BlockCard` (All examples) and `ProgressBlocks`:**
  - headerless cards keep their block titles ("Groceries 2 of 5", "Services", "Parcel 4417", the countdown and progress titles);
  - the Morning briefing, which has a header, hides the checklist heading, as in `Main.dc.html:74-77`;
  - nothing else moved.
- **The table:** a `ResizeObserver` and a scroll listener drive the 8 px padding and the right-edge fade only while the table overflows.
- **The live check** of the fade waits for the next deploy (the Earth vs Mars card in "cards test").
