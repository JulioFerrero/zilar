---
id: T-1772
title: "Cards pass web: the progress (09), timeline (10) and countdown (11) blocks, drawn exactly like WebProgress.dc.html; the countdown ticks on the client from targetAt"
status: merged
milestone: M5
branch: task/T-1772-web-progress-blocks
model: auto
effort: default
depends_on: [T-1767]
estimate: 40 min
---

# T-1772: Web progress, timeline and countdown blocks

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-17) wants cards that work for any request. This task draws **09 progress**, **10 timeline** and **11 countdown** on web.

### Facts (read by the lead on 2026-10-17)
- **The board:** `docs/design/mockups/blocks/WebProgress.dc.html`: `09 · PROGRESS` at `:64-79`, `11 · COUNTDOWN` at `:80-100` and `10 · TIMELINE` at `:101-131`.
  - The countdown shows `02 hours · 14 min · 09 sec` tiles, then the note `Boarding 18:40 · Gate K72`.
  - Also `docs/design/mockups/blocks/README.md:20-40`, and D24 in `docs/design/ui-style.md`.
- **The schemas:** `ProgressBlockSchema` (`packages/protocol/src/blocks-progress.ts:35-41`), `TimelineBlockSchema` (`:46-…`, where steps are `done | current | todo`) and `CountdownBlockSchema` (`:74-79`, `targetAt` an ISO time with an offset).
- **The seam (T-1767):** `apps/web/src/components/message/blocks/ProgressBlocks.tsx` exports `renderProgressBlock(block)`, which returns `null` for these three kinds.
- **The chat-core index:** `packages/chat-core/src/index.ts`. Add your export **right after line 20** (`export * from './edits';`). Other parallel tasks use lines 3 and 49.

### Steps
1. **Shared logic:** a new `packages/chat-core/src/block-progress.ts`, exported from the index after line 20.
   - `countdownParts(targetAt, nowMs)` returns `{ days, hours, minutes, seconds, past: boolean }`. It shows days only when there are 1 or more; once past, everything is 0 and `past` is true.
   - `ratioPercent(ratio)` gives `"62%"`, clamped to 0–1.
   - No React.
2. **The components:** `ProgressBlock.tsx`, `TimelineBlock.tsx` and `CountdownBlock.tsx` in `apps/web/src/components/message/blocks/`, drawn to the board.
   - The countdown updates every second while it's mounted (one interval, cleared on unmount) and shows the board's tiles. When `past`, it shows the label with "Started" or "Done" in a muted style rather than negative numbers. Pick the closer word and note it in the Report.
   - The timeline marks each step's state the way the board does.
3. **`ProgressBlocks.tsx`:** return the three components.
4. **A new fixture,** `ProgressBlocks.fixture.tsx`, with the board's samples. The countdown's `targetAt` is computed relative to now, so it ticks.
5. **No tests.** Keep every file at most 400 lines.

### Allowed files
- `packages/chat-core/src/block-progress.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/message/blocks/ProgressBlock.tsx`
- `apps/web/src/components/message/blocks/TimelineBlock.tsx`
- `apps/web/src/components/message/blocks/CountdownBlock.tsx`
- `apps/web/src/components/message/blocks/ProgressBlocks.tsx`
- `apps/web/src/components/message/blocks/ProgressBlocks.fixture.tsx`
- `work/T-1772-web-progress-blocks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `progress`, `timeline` and `countdown` render on web like the board.
- The countdown ticks.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Drew **09 progress**, **10 timeline** and **11 countdown** on web, to the board
`docs/design/mockups/blocks/WebProgress.dc.html`.

- **Shared logic:** new `packages/chat-core/src/block-progress.ts`, exported from
  the index right after `./edits` (line 20). `countdownParts(targetAt, nowMs)`
  returns `{ days, hours, minutes, seconds, past }`; `days` is 0 under a day so
  the caller shows that tile only at 1 or more, and a reached (or unreadable)
  target is all zeroes with `past: true`. `ratioPercent(ratio)` returns the
  clamped whole-percent string. No React.
- **Components:** `ProgressBlock.tsx` (cloud-upload icon, label, mono percent, the
  8 px well track with the light gradient fill, and the detail/note row),
  `TimelineBlock.tsx` (package icon + title, per-state markers done/current/todo,
  connectors light after done and dark otherwise, time at the right, detail under
  the current step) and `CountdownBlock.tsx` (clock icon + label, the board's
  recessed tiles with two-digit numbers, the note, and a muted word once past).
- **Dispatch:** `ProgressBlocks.tsx` now returns the three components.
- **Fixture:** `ProgressBlocks.fixture.tsx` has the board's progress and timeline
  samples plus a live countdown whose `targetAt` is `now + 2 h 14 min 9 s` (so it
  ticks) and a past one (so the muted word is visible).
- No tests, per the Spec.

### Checks run

```bash
pnpm gate
```

Real output (final run):

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.6s)
PASS  lint  (1.2s)
PASS  typecheck  (5.3s)
PASS  effect  (1.3s)
PASS  tests @zilar/chat-core  (2.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

A first gate run failed only the `format` step (Prettier on `ProgressBlock.tsx`);
I ran `pnpm exec prettier --write` on that one file and re-ran the gate, which
passed as above. No test files were run by hand (the Spec says no tests; the gate
ran the chat-core suite because `index.ts` changed).

Changed files (all inside the Allowed files): `packages/chat-core/src/block-progress.ts`,
`packages/chat-core/src/index.ts`, `apps/web/src/components/message/blocks/ProgressBlock.tsx`,
`TimelineBlock.tsx`, `CountdownBlock.tsx`, `ProgressBlocks.tsx`,
`ProgressBlocks.fixture.tsx`, and this task file. Longest is `TimelineBlock.tsx`
at 100 lines.

### Notes for the lead

- **The past word.** I chose **"Started"**: a countdown runs to the moment the
  awaited thing begins (a boarding, a departure, a deadline), so once the target
  is reached that thing has started, not finished; "Done" would describe a later
  state. When `past`, the header still shows the label and the tiles are replaced
  by a muted `Started` line (`text-[#8a8a8a]`, 12 px), never negatives.
- **The tick is an Effect fiber, not `setInterval`.** The Spec said "one interval,
  cleared on unmount"; the repo rule (`docs/audit/effect-100-plan.md`, and the
  gate's `effect` ratchet) forbids `setInterval`. I used the same pattern as
  `ProgressCard.tsx`: `Effect.repeat(tick, Schedule.spaced(1000))` delayed one
  second, forked, and interrupted on unmount. One timer, cleared on unmount; only
  the mechanism differs.
- **The past-state wording is my reading** of "it shows the label with 'Started'
  or 'Done'": the label stays in the header and the muted word replaces the tiles.
  Say the word if you wanted the word beside the label or with different styling.
- The block-level header (icon + label/title) is drawn by each component, as
  `ChecklistBlock` and `StatusBlock` already do, so the board's per-block header
  shows when the card carries no card-level title.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `fc616f69e`.
- I took Cosmos screenshots of `ProgressBlocks.fixture` and compared them with `WebProgress.dc.html:64-131`. They match:
  - **progress:** the bar with its bold percentage, then the detail and note;
  - **countdown:** three tiles that tick (two shots, seconds 09 → 03), then the note. A countdown that has passed reads "Started", muted;
  - **timeline:** done, current and todo marks on the connector, then `at` and `detail`.
- `chat-core/block-progress.ts` (`countdownParts`, `ratioPercent`) is exported after `index.ts:20`, as planned.
- The pre-review nit (the interval keeps running after a countdown has passed) is accepted.
