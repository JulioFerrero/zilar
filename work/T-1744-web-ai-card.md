---
id: T-1744
title: "Web work card matches the boards (twin of T-1739): full title up to two lines, a finished card is one line with a chevron instead of a separate View steps row"
status: merged
milestone: M5
branch: task/T-1744-web-ai-card
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1744: The web work card, as drawn

## Spec (written by Claude, do not edit)

### Why
T-1739 rebuilds the phone work card to match the approved boards after Julio's test on 2026-10-16 ("in the design looks so nice … in the app is ugly"). Every user-facing change ships on web too. The boards are:
- `docs/design/mockups/routines/WebRoutineAsk.dc.html`: the finished card is one line, "✓ Check the prices 0:06 ›";
- `docs/design/mockups/ai-work/Main.dc.html`: the working card has the title, the timer and Stop on one line, with the steps under it.

Open them in a browser and match them.

### Facts (the lead read them on 2026-10-16)
- **`apps/web/src/components/ProgressCard.tsx`** (249 lines):
  - the card is `bubble-in min-w-[220px]` (`:182`);
  - the title is `min-w-0 flex-1 truncate` (`:170-172`), so it's cut to one line;
  - a finished card of the viewer's own AI adds a separate bordered "View steps" row with a chevron (`:237-246`, `viewSteps` at `:150-165`, which sets `?steps=<task_id>`);
  - when there are no steps but a title, the stage repeats under it (`:226-229`).

### Steps
1. **The title:** `line-clamp-2` instead of `truncate`, so a long title wraps to two lines and never cuts at one.
2. **A finished card** (not working) is one clickable line: the state icon, the title, the duration and a `ChevronRight`.
   - Clicking it runs `viewSteps` when `canViewSteps`, and toggles the steps otherwise.
   - Remove the separate "View steps" row. Keep `aria-expanded` and an accessible label ("View steps").
3. **A working card** stays as it is: title, timer and Stop, with the steps under it.
4. **Keep the stage line** under the title only while working.
5. **No tests** (UI). Keep the file under 400 lines.

### Allowed files
- `apps/web/src/components/ProgressCard.tsx`
- `work/T-1744-web-ai-card.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A finished card on web** is one line with a chevron, as on `WebRoutineAsk.dc.html`.
- **Long titles** wrap to two lines.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did
Reworked `apps/web/src/components/ProgressCard.tsx` to match the boards
(`docs/design/mockups/routines/WebRoutineAsk.dc.html` for a finished card,
`docs/design/mockups/ai-work/Main.dc.html` for a working one):

1. Title is now `line-clamp-2` instead of `truncate`, so a long title wraps to
   two lines and only then ellipsizes.
2. A finished card is one line: state icon, title, duration and a `ChevronRight`.
   Clicking it calls `viewSteps` when `canViewSteps` (the viewer's own AI opens
   the Steps panel), otherwise it toggles the inline checklist. The separate
   bordered "View steps" row is gone.
   - The line stays a `<button>` only when it can act (`canViewSteps || steps`);
     a finished card with neither is still one plain line, but without a chevron
     so it does not promise an action it cannot do.
   - `aria-expanded` is kept, and the finished line carries the accessible label
     "View steps".
3. A working card is unchanged: title, ticking timer and Stop on the top line,
   steps under it.
4. The `stage`/`detail` fallback (a card with no steps, e.g. an old server) now
   renders only while the card is working.
5. No tests added (UI); the file is 258 lines, under 400.

### Checks run
- `pnpm gate` (from the repo root), final run:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (1.8s)
  PASS  lint  (2.7s)
  PASS  typecheck  (11.1s)
  PASS  effect  (2.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first run failed only on `format` for the new file; I fixed it with
  `pnpm exec prettier --write` on that one file (no logic change), then re-ran
  the gate to the pass above.
- No single-file tests were run: the gate reports no nearby test files for
  `@zilar/web` and the spec says no tests.

### Notes for the lead
- I read both mockups and matched them in code; I did not start a dev server to
  eyeball it in the browser (that needs a running app and a server). The visual
  smoke is the lead's/Julio's check.
- Deviation to confirm: the chevron shows only when the finished line can act.
  A finished card with no steps and no `task_id` renders as one plain line with
  no chevron rather than a dead affordance. The common finished card (steps
  present, and/or the viewer's own AI) shows the chevron as drawn.

## Review (written by Claude)

- **Accepted at `10d7ecf26`.** The pre-review is clean and the packet is current.
- **Checked against `WebRoutineAsk.dc.html`:**
  - the title clamps to two lines instead of truncating;
  - a finished card is one clickable line with a chevron, opening the Steps panel for the viewer's own AI and toggling the checklist otherwise;
  - the separate "View steps" row is gone;
  - the stage line shows only while working.
- **The deviation is accepted:** no chevron on a finished line that can't act.
- **Not rendered by the lead:** it needs the web app with data. It gets checked live after the deploy.
