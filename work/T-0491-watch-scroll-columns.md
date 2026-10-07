---
id: T-0491
title: "lead watch: keyboard scroll when the cards don't fit the window height, and two columns of cards when the window is wide"
status: merged
milestone: M5
branch: task/T-0491-watch-scroll-columns
model: auto
effort: low
depends_on: []
estimate: 0.35 day
---

# T-0491: lead watch, scrolling and two columns

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "the lead watch of workers, i cant scroll or anything and the vertical space is limited so i cant see all the workers". He picked two changes: **keyboard scroll** and **two columns when wide**.

His watcher runs in a 64x30 Ghostty window, and 9 workers run now. Each card is about 7 lines, so only about 3 fit. The app uses the terminal's alternate screen, so the terminal's own scrollback does not help.

### Verified facts (do not re-derive)
All files are in `packages/devtools/src/lead/`.
- **`watch-app.tsx`:**
  - **`WatchApp({ view, updatedAgoSecs, columns?, clock?, icons? })`** (lines 486-515) reads the width from `useStdout().stdout.columns`. It renders `Header`, then one `TaskCard` per `view.entries` entry, then `EmptyCard` when empty, then `Footer`. It does **not** read `stdout.rows`.
  - **`TaskCard({ entry, width, compact, icons })`** (lines 377-441) renders a top border, the title, the `StepTracker`, an optional `LiveStepLine` (when `entry.running && entry.step !== null`) or a waiting line (when `entry.needsLead`), the idle or speed line, the `FilesLine` and a bottom border. Each line is a `Line` of `Seg`s built for an exact `width`.
  - **`Header`** (from line 327) is a bordered box with a counts line. **`Footer`** (lines 454-479) shows "q quit · main · updated N s ago", or "refresh failed, retrying".
  - **`WatchLive`** (from line 517) holds the view state, refreshes every `REFRESH_INTERVAL_MS`, and handles input with `useInput`: `q` and Ctrl-C quit (lines 524-531, active only when `isRawModeSupported`).
- **`watch-format.ts`** holds the pure helpers: `COMPACT_WIDTH = 50` (cards narrower than this drop the tracker bars and file names), `truncate`, `trackerStep`, and so on.
- **Tests:**
  - `watch-app.test.tsx` uses `ink-testing-library` `render` and strips ANSI;
  - `describe('WatchApp width')` checks that every line fits within the width;
  - `watch-format.test.ts` covers the pure helpers.

### What to build
1. **Pure helpers in `watch-format.ts`, with unit tests:**
   - `cardHeight(entry)`: the exact number of lines a `TaskCard` renders for that entry.
   - `layoutColumns(width)`: returns 2 when `width >= TWO_COLUMN_MIN_WIDTH`, otherwise 1. Export `TWO_COLUMN_MIN_WIDTH = 100`, so each column stays at least 50, the full card. The two column widths are `floor((width - 1) / 2)` and the rest, with a 1-column gap.
   - `visibleSlice(rowHeights, offset, availableRows)`: given the heights of each card row (in two-column mode a row is a pair of cards, and its height is the larger of the two), the first row index `offset`, and the rows available, returns `{ start, end, hiddenAbove, hiddenBelow }`. It shows as many whole rows as fit, and **always at least one row**.
2. **`WatchApp`:**
   - read `stdout.rows`, and accept a new optional `rows` prop for tests, like `columns`;
   - available rows = rows − the header height − 1 for the footer;
   - group the entries into rows of 1 or 2 cards (`layoutColumns`);
   - render only `visibleSlice`;
   - render two cards side by side with Ink `<Box flexDirection="row">`. Each card gets its column width, and `compact` is decided per column width;
   - accept a new optional `scroll` prop (the row offset, default 0);
   - **the footer** shows `↑ N more` and/or `↓ N more` (dim) before the existing text when cards are hidden. Keep the footer within the width (truncate).
   
   With no `rows` known (a non-TTY), render everything as today.
3. **`WatchLive`: scroll state.**
   - Keys: `↑` / `k` up one row; `↓` / `j` down one row; PageUp / PageDown or `u` / `d` one page; Home / `g` top; End / `G` bottom.
   - Clamp the offset whenever the entries, the rows or the columns change, so it never points past the end.
   - `q` and Ctrl-C keep quitting.
   - Re-render on terminal resize. Ink's `useStdout` resize already triggers a re-render; check that rows are re-read.
   - Update the footer help to `q quit · ↑↓ scroll`, only when something is hidden.
4. **Tests (`watch-app.test.tsx`):**
   - **One column:**
     - 9 entries at `rows=30` and `columns=64` render fewer cards plus `↓ N more`, where N is correct;
     - with `scroll` set to the end, it shows `↑ N more` and the last card;
     - every line still fits the width (extend the width test to two-column widths, for example 100 and 140).
   - **Two columns:** at `columns=120`, two task ids appear on the same output line.
   - **Keys:** pressing `j` in `WatchLive` moves the view, using `ink-testing-library`'s `stdin.write`.
   - **Existing tests** pass. Rendering without `rows` stays unchanged.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/watch-app.tsx`, `packages/devtools/src/lead/watch-format.ts`, `packages/devtools/src/lead/watch-app.test.tsx`, `packages/devtools/src/lead/watch-format.test.ts`.

### Allowed files
`packages/devtools/src/lead/watch-app.tsx`, `packages/devtools/src/lead/watch-app.test.tsx`, `packages/devtools/src/lead/watch-format.ts`, `packages/devtools/src/lead/watch-format.test.ts`, `work/T-0491-watch-scroll-columns.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot lead/watch
pnpm gate
```

### Acceptance
- In a 64x30 window with 9 workers, the watch shows the cards that fit, a `↓ N more` hint, and scrolls with the arrows or j/k.
- At 100 columns or more, the cards show in two columns.
- Nothing overflows the width.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

**`watch-format.ts` (pure helpers):**
- Added `TWO_COLUMN_MIN_WIDTH = 100`, `cardHeight(entry)`, `layoutColumns(width)`, `columnWidths(width, count)` and `visibleSlice(rowHeights, offset, availableRows)` returning `{ start, end, hiddenAbove, hiddenBelow }`.
- `cardHeight` mirrors `TaskCard`'s render exactly: 5 base lines + 1 when `(running && step !== null) || needsLead` + 1 when `files.length > 0`.
- `visibleSlice` clamps an out-of-range `offset` to the last row and always includes at least one row.
- Added `columnWidths` as a small extra pure helper (the spec described the two widths but did not name a function); it gives `floor((width - 1) / 2)` and the rest with a 1-column gap, also used by the tests.

**`watch-app.tsx`:**
- `WatchApp` now accepts `rows` and `scroll` and reads `stdout.rows`. Available rows = `rows - HEADER_ROWS(3) - 1` (footer). Entries are grouped into rows of `layoutColumns(width)` and rendered through `visibleSlice`; the two-column row is a `<Box flexDirection="row" gap={1}>` with each card in a column of its own width, so `compact` is decided per column width.
- `Footer` takes optional `hiddenAbove`/`hiddenBelow`, prefixes `↑ N more`/`↓ N more` and, when anything is hidden, shows `q quit · ↑↓ scroll` before the branch/updated text; the whole string is truncated to the width.
- `WatchLive` holds `scroll`, handles `↑`/`k`, `↓`/`j`, PageUp/`u`, PageDown/`d`, Home/`g`, End/`G`, keeps `q`/Ctrl-C quitting, and passes the clamped offset to `WatchApp`. It re-reads `stdout.rows`/`columns` each render (Ink re-renders on resize). The clamp is derived during render (`scrollOffset = min(scroll, maxOffset)`) rather than in a `setState` effect, because the repo lint rule `react(set-state-in-effect)` rejects the effect form; the visible offset still never points past the end.
- With no known `rows` (non-TTY) `WatchApp` renders the old single-column, un-sliced layout, exactly as before.

**Tests:** unit tests for the four helpers; app tests for one-column slicing + `↓ 5 more`, end-of-list + `↑ 8 more` + last card, two-column widths 100/140 still fitting every line, two ids on one line at 120 columns, and a `WatchLive` test that presses `j` through a fake stdin and sees the view move (`↑ 1 more`, T-0005 visible, T-0001 gone).

### Files changed
`packages/devtools/src/lead/watch-format.ts`, `packages/devtools/src/lead/watch-format.test.ts`, `packages/devtools/src/lead/watch-app.tsx`, `packages/devtools/src/lead/watch-app.test.tsx`, `work/T-0491-watch-scroll-columns.md`.

### Commands and real results
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot lead/watch` → `Test Files 3 passed (3)`, `Tests 121 passed (121)`.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot lead/watch-format` → 26 passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot lead/watch-app` → 53 passed.
- `pnpm gate` (repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (4.9s)
  PASS  format  (83.4s)
  PASS  lint  (1.7s)
  PASS  typecheck  (18.5s)
  PASS  tests @zilar/devtools  (36.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (An earlier `pnpm gate` run failed lint with `react(set-state-in-effect)`; fixed by deriving the clamp during render, re-ran and it passed.)

### Deviations / notes
- Added `columnWidths` as an extra exported helper; not named in the spec, but it keeps the width math pure and unit-testable.
- Two-column layout only activates when `rows` is known (a real TTY, or the `rows` test prop). The spec's "with no `rows` known render everything as today" makes the legacy path single-column, so the existing tests are unchanged. In the real app `stdout.rows` is always set.
- Scrolling clamps by deriving the offset during render instead of `setState` in an effect (lint rule); the state can hold a stale value after the row count shrinks, but the displayed offset and every key press are clamped.

### Blocked / needs a decision
None.

## Review (written by Claude)

Approved (lead, 2026-10-07). The watch fits cards to the window height with an up/down "N more" footer, scrolls with arrows, j/k, u/d and g/G, and shows two columns at 100+ columns; nothing overflows the width. Nits accepted: a refresh failure hides the more-hints; at exactly 100 columns the left card is compact; the hints count rows in two-column mode.
