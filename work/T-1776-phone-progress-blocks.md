---
id: T-1776
title: "Cards pass phone: the progress (09), timeline (10) and countdown (11) blocks, drawn exactly like PhoneProgress.dc.html, reusing chat-core's countdownParts/ratioPercent, with catalog examples"
status: merged
milestone: M5
branch: task/T-1776-phone-progress-blocks
model: auto
effort: default
depends_on: [T-1772]
estimate: 40 min
---

# T-1776: Phone progress, timeline and countdown blocks

## Spec (written by Claude, do not edit)

### Why
This is the phone twin of T-1772 (merged), for Julio's 2026-10-17 "cards for any request". Web and phone ship together.

### Facts (read by the lead on 2026-10-17)
- **The board:** `docs/design/mockups/blocks/PhoneProgress.dc.html`: `09 · PROGRESS` at `:63-78`, `10 · TIMELINE` at `:79-109` and `11 · COUNTDOWN` at `:110-128`. Phone text is 15/21 (`docs/design/mockups/blocks/README.md:20-40`). D24 only: `docs/design/ui-style.md`.
- **The schemas:** `ProgressBlockSchema`, `TimelineBlockSchema` and `CountdownBlockSchema` (`packages/protocol/src/blocks-progress.ts:35,46,74`).
- **The shared logic (T-1772):** `countdownParts(targetAt, nowMs)` and `ratioPercent(ratio)` in `packages/chat-core/src/block-progress.ts:24,40`, exported from `@zilar/chat-core` (`index.ts:21`). Use them and don't re-implement them.
- **The web twin, to match its behaviour:** `apps/web/src/components/message/blocks/CountdownBlock.tsx`. It ticks every second while mounted, and once past it shows a muted "Started" line.
- **The seam (T-1767):** `apps/mobile/src/components/chat/blocks/progress-blocks.tsx` exports `PROGRESS_KINDS` (an empty set) and `renderProgressBlock(block, _showHeading)`, which returns `null`.
- **The patterns to copy:** `status-block.tsx` and `checklist-block.tsx` in the same folder, which draw their own heading when `showHeading`.
- **The catalog:** `EXAMPLES` in `apps/mobile/src/mock/dev-blocks-screen.tsx`.

### Steps
1. New `progress-block.tsx`, `timeline-block.tsx` and `countdown-block.tsx` in `apps/mobile/src/components/chat/blocks/`, drawn to the phone board.
   - The countdown ticks once a second while mounted. **Stop the interval once `past`** (the web pre-review nit, so it isn't repeated here) and show the muted "Started" line.
2. **`progress-blocks.tsx`:** set `PROGRESS_KINDS` to the three kinds and return the components, passing `showHeading` through like the status block does.
3. **The catalog:** **append** three examples (09, 10, 11) at the **end** of `EXAMPLES`, with the board's sample content. The countdown's `targetAt` is computed relative to now, so it ticks.
4. **No tests.** Keep every file at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/blocks/progress-block.tsx`
- `apps/mobile/src/components/chat/blocks/timeline-block.tsx`
- `apps/mobile/src/components/chat/blocks/countdown-block.tsx`
- `apps/mobile/src/components/chat/blocks/progress-blocks.tsx`
- `apps/mobile/src/mock/dev-blocks-screen.tsx`
- `work/T-1776-phone-progress-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `progress`, `timeline` and `countdown` render on the phone like the board.
- The countdown ticks and stops once past.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added the three phone renderers, drawn from `docs/design/mockups/blocks/PhoneProgress.dc.html`:
  - `apps/mobile/src/components/chat/blocks/progress-block.tsx` — 09 · PROGRESS: the icon/label/percent heading, the 8 px recessed track with the light fill (`ratioPercent`), and the detail/note row. The heading (including the percent) is hidden when `showHeading` is false, like the status block.
  - `apps/mobile/src/components/chat/blocks/timeline-block.tsx` — 10 · TIMELINE: the heading, then one row per step with the done/current/todo marker, the light connector after a done step and the dark one otherwise, the label (bold current, muted todo), the mono `at` and the optional `detail`.
  - `apps/mobile/src/components/chat/blocks/countdown-block.tsx` — 11 · COUNTDOWN: the heading, the recessed day/hour/min/sec tiles (`countdownParts`), the optional note, and the muted "Started" line once `past`. The `now` ticks once a second as an Effect fiber (the `progress-card.tsx` pattern, not a bare interval) and the interval stops (the fiber is interrupted) the moment `past` turns true.
- `progress-blocks.tsx`: `PROGRESS_KINDS` is now the three kinds, and `renderProgressBlock` returns the components and passes `showHeading` through.
- `dev-blocks-screen.tsx`: appended the 09, 10 and 11 examples at the end of `EXAMPLES` with the board's sample content. The countdown's `targetAt` is `Date.now() + 2h 14m 09s` at load, so the example ticks.

### Checks run
- `pnpm install`: done in 16.4 s (frozen lockfile).
- `pnpm gate` (repo root, final run):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.6s)
  PASS  typecheck  (4.6s)
  PASS  effect  (2.1s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No tests: the spec says "No tests", the change is UI only and the gate reports no nearby test files for `@zilar/mobile`.

### Notes for the lead
- First gate run failed on `format` (one file) and `typecheck` (a `width: string` style not assignable to `DimensionValue`); both are fixed and the final run above is green.
- The heading row includes the percent on progress and the label on the countdown, so when a card already draws a header (`showHeading` false) those values are not repeated, matching the status/checklist pattern the spec points to. The board is the source for the sizes (head 14/500 `#a1a1a1`, percent mono 14 `#ededed`, detail/note 13 `#8a8a8a`, countdown note 13 `#a1a1a1`, tiles `#0c0c0c` with the D24 well recipe).
- The `Started` line has no board example (the phone board has no past state); I copied the web twin's muted word at the phone body size (13 px, `#8a8a8a`).
- Not verified on a device: this is UI only and the lead's phone smoke covers it.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `f64d86f51`. The review was rerun on paid Muse.
- `PROGRESS_KINDS` holds the three kinds, and the three components follow `PhoneProgress.dc.html`.
- The countdown uses `countdownParts`, ticks through an Effect fiber, and **stops once past** (`ticking` false, `countdown-block.tsx:50-62`), with a muted "Started" line.
- Three catalog examples are appended.
- **The emulator check of `zilar://dev/blocks` is still to do.** It runs with the other phone twins tonight.
