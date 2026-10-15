---
id: T-1486
title: "Mobile Markdown table columns follow the system font scale: at 1.3 a cell broke mid-word ('Mediu/m') because widths are estimated for 13 px text; the table text also takes the app's 1.4 font cap"
status: merged
milestone: M5
branch: task/T-1486-mobile-table-font-scale
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1486: Table widths follow the font scale

## Spec (written by Claude, do not edit)

### Why
On the Android emulator (mock, main) at system font scale 1.3, the Dev AI "Review summary" table breaks words mid-word: the Risk cell reads "Mediu / m", and Notes wraps to "needs a tim / test".
- The column widths are estimated for 13 px text.
- The text itself grows with the system font scale.

At scale 1.0 the same table is fine.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/components/chat/markdown-table.tsx`** (282 lines):
  - `CELL_TEXT` is 13 px (`:186`);
  - `CHAR_WIDTH = 8`, `CELL_PADDING = 16`, `MIN_COLUMN_WIDTH = 72` and `MAX_COLUMN_WIDTH = 220` (`:191-194`);
  - `columnWidths(table)` (`:197-210`) returns pixel widths with no font scale;
  - `MarkdownTable` (`:226-282`) renders each cell's text with the raw `RNText`, which has no `maxFontSizeMultiplier`.
- **`apps/mobile/src/components/ui/text.tsx:71`:** the app's `Text` defaults to `maxFontSizeMultiplier = 1.4` (T-1436). It is not exported as a constant.

### What to build
1. **`apps/mobile/src/components/ui/text.tsx`:** export `const MAX_FONT_SCALE = 1.4` and use it as the default there. Nothing else changes in that file.
2. **`markdown-table.tsx`:**
   - `MarkdownTable` reads `fontScale` from `useWindowDimensions()`, and passes `scale = Math.min(fontScale, MAX_FONT_SCALE)` to `columnWidths`;
   - `columnWidths` multiplies the estimate and both bounds (`MIN_COLUMN_WIDTH`, `MAX_COLUMN_WIDTH`) by `scale`;
   - the cell `RNText` gets `maxFontSizeMultiplier={MAX_FONT_SCALE}`;
   - one short comment on why.
3. Nothing else changes, and both files stay under 400 lines.

### Tests
None (layout).

### Allowed files
`apps/mobile/src/components/chat/markdown-table.tsx`, `apps/mobile/src/components/ui/text.tsx`, `work/T-1486-mobile-table-font-scale.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Emulator (lead):** at font scale 1.3, no word in the Dev AI table breaks mid-word, and the table scrolls sideways. At 1.0 it looks as before.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/ui/text.tsx`: added `export const MAX_FONT_SCALE = 1.4` with a one-line comment and used it as the `maxFontSizeMultiplier` default. No other change.
- `apps/mobile/src/components/chat/markdown-table.tsx`:
  - `MarkdownTable` reads `fontScale` from `useWindowDimensions()`, computes `scale = Math.min(fontScale, MAX_FONT_SCALE)` and passes it to `columnWidths`;
  - `columnWidths(table, scale)` multiplies the width estimate and both bounds (`MIN_COLUMN_WIDTH`, `MAX_COLUMN_WIDTH`) by `scale`;
  - the cell `RNText` got `maxFontSizeMultiplier={MAX_FONT_SCALE}`;
  - added one short comment on the doc block explaining why.

### Files changed
- `apps/mobile/src/components/ui/text.tsx`
- `apps/mobile/src/components/chat/markdown-table.tsx`
- `work/T-1486-mobile-table-font-scale.md`

### Commands and results
- `pnpm install`: done, 1137 packages, 1 deprecation warning (pre-existing).
- Tests: none run individually — the spec says "Tests: None (layout)"; the gate's `@zilar/mobile` suite covers the package.
- `pnpm gate` (from repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/mobile
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations from the spec
- None. The `MIN_COLUMN_WIDTH` fallback in the cell `width` (`widths[column] ?? MIN_COLUMN_WIDTH`) was left unscaled, since the spec only lists the estimate and the two bounds inside `columnWidths`; that branch is unreachable because `widths` is mapped over every header column.

### Blocked / needs a decision
- None.

### Open questions
- None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1, accepted: the unscaled fallback width is unreachable, since every row is padded to the header length.
- **Emulator, mock, APK of `0c1a92506`:**
  - at font scale 1.3, the Dev AI table keeps "Medium" whole (main broke it as "Mediu / m"), and the table scrolls sideways;
  - at 1.0, the table is identical to main.
- The emulator was reset to font scale 1.0.
