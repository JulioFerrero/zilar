---
id: T-1478
title: "Web message bubble never grows wider than its column: at 390 px an AI reply with a code block or table stretched the bubble past the screen edge and clipped its text; cap it at min(560px, 100%)"
status: merged
milestone: M5
branch: task/T-1478-web-bubble-max-width
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1478: The bubble fits its column

## Spec (written by Claude, do not edit)

### Why
In the lead's headless sweep at 390 px (web mock, Dev AI chat, 2026-10-15), the "Review summary" reply bubble is wider than the screen:
- its right border is off-screen;
- the paragraph ("The checkout fix is ready; …") and the quote ("… would not merge toda") are cut at the screen edge;
- the code line `pnpm --filter @zilar/web exec vitest run --cove…` and the table run off-screen instead of scrolling inside their own box.

The page itself does not scroll sideways, because an ancestor clips it, so the text is simply lost.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/MessageBubble.tsx`** (399 lines):
  - the bubble is `relative flex flex-col` with `own ? 'max-w-[520px]' : 'max-w-[560px]'` (`:300-302`);
  - it sits in a `flex min-w-0 flex-col items-start|items-end` column (`:235`).
  - With `items-start`, the bubble is fit-content, and nothing caps it at the column width.
- **`apps/web/src/index.css`:** `.md pre` (`:470-484`) and `.md table` (`:560-566`) already have `max-width: 100%` and `overflow-x: auto`.
  - Their percentage only resolves when the bubble's own width is definite, so today the code block's `white-space: pre` min-content width sets the bubble width.

### What to build
1. In `MessageBubble.tsx:302`, cap the bubble at its column: `max-w-[min(520px,100%)]` (own) and `max-w-[min(560px,100%)]` (others), plus `min-w-0`, so long code lines and tables scroll inside their own boxes.
2. Nothing else changes. The file must not grow past 400 lines (it is at 399, so change classes in place).

### Tests
None (layout).

### Allowed files
`apps/web/src/components/MessageBubble.tsx`, `work/T-1478-web-bubble-max-width.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- In the lead's headless check at 390 px, the Dev AI review bubble keeps its right border on screen, its text wraps, and the code block and table scroll inside.

---

## Report (written by the worker when done)

### What I did
- In `apps/web/src/components/MessageBubble.tsx:300-302`, capped the bubble at its column and added `min-w-0`:
  - before: `'relative flex flex-col'` + `own ? 'max-w-[520px]' : 'max-w-[560px]'`
  - after: `'relative flex min-w-0 flex-col'` + `own ? 'max-w-[min(520px,100%)]' : 'max-w-[min(560px,100%)]'`
- Nothing else changed. The file is still 399 lines (classes changed in place).

### Files changed
- `apps/web/src/components/MessageBubble.tsx`
- `work/T-1478-web-bubble-max-width.md` (status + this Report)

### Commands and results
- `pnpm install`: Done in 12.3s using pnpm v10.32.1.
- `pnpm gate`: `GATE PASS` — see summary below.
- Tests: none run individually. `pnpm gate` reported `SKIP tests @zilar/web (no nearby test files)`; the task says "Tests: None (layout)".

Gate summary lines:
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (4.5s)
PASS  effect  (0.8s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Problems / deviations
- None. Change matches the spec exactly (both `max-w` values from `:302` and `min-w-0` from `:301`).
- I did not run the lead's headless 390 px check; that is the lead's acceptance step.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0. In the headless check at 390 px, the Dev AI review bubble keeps its right border on screen, the paragraph and quote wrap, and the code line scrolls inside its own box.
