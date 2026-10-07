---
id: T-0491
title: "lead watch: keyboard scroll when the cards don't fit the window height, and two columns of cards when the window is wide"
status: todo
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

## Review (written by Claude)
