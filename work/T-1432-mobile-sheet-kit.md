---
id: T-1432
title: "Mobile sheet kit for the approved design: BottomSheet on the D24 panel with header keys and a sticky footer; StepTrack; light-key choice control; SelectSheet with trailing dot and pinned footer item"
status: merged
milestone: M5
branch: task/T-1432-mobile-sheet-kit
model: auto
effort: default
depends_on: []
estimate: 0.7 day
---

# T-1432: Mobile sheet kit

## Spec (written by Claude, do not edit)

### Why
Julio approved the New AI design on 2026-10-15. Canvas: https://claude.ai/artifact/WMbGfFmbgAHeuEKKHvBg2k. Its bottom row, "Phone · …", has the exact phone values in inline styles.

He asked that phone sheets fit their content ("why use all the screen? … the drawer can adapt to the content"). The mobile New AI flow (a later task) is built from these parts. The design is D24 only (`docs/design/ui-style.md`, `docs/design/mockups/Mobile.dc.html`).

### Facts (the lead read them on main)
- **`apps/mobile/src/components/ui/bottom-sheet.tsx` (106 lines, TrueSheet 3.11.16):**
  - it already sizes to its content (`detents={['auto']}`, `:78`, comment `:41`);
  - it uses `backgroundColor={palette.surface}` (`:80`) and `cornerRadius={16}` (`:81`);
  - its inner view is `border-t border-border-strong bg-surface px-4 pt-6` (`:92`);
  - the title renders inside the `ScrollView` (`:56-63`), and there is no footer slot.
- **`apps/mobile/src/components/ui/segmented-control.tsx`** is 74 lines.
- **`apps/mobile/src/components/ui/select-sheet.tsx`** (121 lines) shows a search field once the list is long (`:22`). Props are at `:33-38`.
- **`apps/mobile/src/lib/depth.ts`** exports the D24 key, well and segment recipes from `@zilar/ui-tokens` (`:11-22` and on).
- **Other kit files:** `apps/mobile/src/components/ui/icon-button.tsx` (42 lines) and `apps/mobile/src/components/ui/button.tsx` (126 lines).

### What to build (values from the canvas phone boards)
1. **`BottomSheet`:**
   - **Panel:** `palette.panel` (#0a0a0a) with a 1px top `palette.border` (#1f1f1f), radius 16, and the grabber 36×4 `#333`.
   - **Header row:** optional `onBack` (a left dark key, 36 px, radius 12, `ChevronLeft`), the title (17/600, tracking −0.02em), and optional `headerRight` (for example the close key or the Shuffle and Reset keys).
   - **Footer:** a new `footer` prop renders **outside** the scroll view, sticky, with a 1px top `palette.border` and padding `12 16 max(inset,34)`. Keep it above the keyboard (`KeyboardAvoidingView` or TrueSheet's keyboard handling).
   - **Height:** the sheet keeps `detents={['auto']}` so it hugs its content, with a cap so a long body scrolls inside.
   - Every existing caller keeps working unchanged.
2. **`StepTrack`** (new `apps/mobile/src/components/ui/step-track.tsx`):
   - a segmented well with 34 px segments, radius 7, 12/500;
   - the current step uses the raised segment;
   - a done step shows a check icon 11 plus its `value` (muted) and is pressable;
   - later steps are subtle;
   - `accessibilityLabel="Step 2 of 4: Key"`.
3. **Choice control:** `SegmentedControl` gains `tone?: 'tab' | 'choice'`.
   - With `choice`, the selected option is the light key: the primary gradient and shadow from `lib/depth.ts`, dark text.
   - Options take an optional icon (15 px), shown inline with the label; the row is 40 px, 13/500, and stays the same weight when selected.
4. **`SelectSheet`:**
   - each option can carry `dot?: 'online'` (8 px `palette.online`);
   - add an optional pinned `footerOption` (with a plus icon) after a hairline;
   - rows are 48 px with a hairline `#1a1a1a` divider;
   - the selected row is `palette.surfaceRaised` plus a check;
   - the search placeholder is a prop (for example "Search 195 providers");
   - the list is capped at about 7 rows and scrolls.
5. **Dev kit:** add the new parts to `apps/mobile/src/mock/dev-kit-screen.tsx`.

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/components/ui/step-track.tsx`, `apps/mobile/src/components/ui/segmented-control.tsx`, `apps/mobile/src/components/ui/select-sheet.tsx`
- `apps/mobile/src/lib/depth.ts`, `apps/mobile/src/mock/dev-kit-screen.tsx`
- `work/T-1432-mobile-sheet-kit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The existing sheets still open and size to their content.
- The dev kit screen shows the new parts.
- Every file stays at 400 lines or fewer.

The lead runs a phone smoke of the dev kit.

---

## Report (written by the worker when done)

### What I did

Read the approved boards under `docs/design/mockups/new-ai/` on `main` (`Mobile`, `PhoneKey`,
`PhoneModel`, `PhoneOrb`, `PhoneSetup`, `PhoneCompatible`) and copied their inline values.

1. **`BottomSheet`** — panel is now `palette.panel` with a `border-border` top hairline, radius 16,
   and a 36×4 `#333` grabber (`grabberOptions`, `adaptive: false`). The title moved out of the
   `ScrollView` into a header row (`pt-[22px]` to clear the native grabber, `px-4`): optional
   `onBack` (a 36 px dark key with `ChevronLeft`, radius 12), the title (17/600, `tracking-[-0.02em]`),
   then optional `headerRight`. A new `footer` prop renders as a sibling under the `ScrollView`
   (outside it), with a `border-border` top hairline and padding `12 16 max(inset,34)`; the
   `ScrollView` has `flexShrink: 1` so a long body scrolls between the fixed header and footer.
   Still `detents={['auto']}` capped by `maxContentHeight`. All existing callers keep their props
   (`closeLabel`, `title`, `maxHeightClassName`, `children`); `title` now renders in the header.
2. **`StepTrack`** (new `step-track.tsx`) — a well track (`p-[3px]`, `gap-0.5`, `borderColor #1a1a1a`)
   with 34 px, radius 7, 12/500 segments. The current step is the raised `segment`; a done step
   shows an 11 px `Check` plus its value in `muted-foreground` and is pressable when `onStepPress`
   is given; later steps are `subtle-foreground` and inert. The current segment's `key` carries the
   selected state (gradient-swap pitfall). Container announces `Step N of M: <label>`.
3. **`SegmentedControl`** — added `tone?: 'tab' | 'choice'` (default `tab`, so existing callers are
   unchanged) and an optional per-option `icon` (15 px). With `choice` the selected option is
   `primaryKey` from `lib/depth.ts` with `text-accent-foreground`; rows are 40 px, 13/500, icons
   inline, and the weight stays the same when selected.
4. **`SelectSheet`** — options gained `dot?: 'online'` (an 8 px `bg-online` dot); new props
   `searchPlaceholder` (default `Filter…`) and `footerOption` (`{ label, onPress }`, a pinned row
   with a `Plus` icon under a hairline). Rows are 48 px with a `#1a1a1a` divider, the selected row is
   `palette.surfaceRaised` plus a check, and the list caps at 7 rows (`maxHeight: 336`) and scrolls.
5. **Dev kit** — added Choice control, Step track and Select sheet sections, plus a "Bottom sheet
   with header and footer" sheet that uses `onBack`, `headerRight`, `footer` and a `StepTrack`.

`lib/depth.ts` was in the Allowed files but needed no change: I reused the existing `primaryKey`,
`segment` and `well` recipes. No tests (the spec says UI gets none).

### Files changed

- `apps/mobile/src/components/ui/bottom-sheet.tsx`
- `apps/mobile/src/components/ui/step-track.tsx` (new)
- `apps/mobile/src/components/ui/segmented-control.tsx`
- `apps/mobile/src/components/ui/select-sheet.tsx`
- `apps/mobile/src/mock/dev-kit-screen.tsx`
- `work/T-1432-mobile-sheet-kit.md`

### Commands

- `pnpm install` — done (14.6s), no lockfile change.
- `pnpm gate` (from the repo root):
  - `gate: 6 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.0s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (3.5s)`
  - `PASS  effect  (0.7s)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run: the change is UI only and the gate reports no nearby test files.

### Deviations / notes

- The board's `.choice` in `PhoneModel.dc.html` is 38 px / 14, while `PhoneSetup.dc.html`'s `.opt` is
  40 px / 13. The spec says 40 px, 13/500, so I used the spec values.
- The board's `.sel` uses a reduced shadow; the spec says to use "the primary gradient and shadow
  from `lib/depth.ts`", so the selected choice uses the full `primaryKey`.
- `title` now renders in the header instead of inside the scroll view. Existing sheets still open and
  hug their content; this is the intended redesign, not a caller change.
- Keyboard: the footer relies on TrueSheet's native keyboard handling (as the spec allows) rather
  than a `KeyboardAvoidingView`. I did not smoke-test it on a device.

### Open questions

None.

### Round 2 (fix round against `PREREVIEW.md`, commit `0573e1e`)

**Findings fixed**

- **Finding 1 (should-fix)** — `segmented-control.tsx`: unselected `tab` options lost
  `font-medium`. The label weight is now unconditional (`text-[13px] font-medium`), so both
  `tab` and `choice` keep the old all-medium look and the spec's "same weight when selected"
  holds for `choice` too. Commit `98c836bd0`.
- **Finding 2 (should-fix)** — `bottom-sheet.tsx`: the header row rendered unconditionally, so
  a sheet with no `title`/`onBack`/`headerRight` (e.g. `topic-info-sheet.tsx`) gained an empty
  ~36pt block and an empty header node. It now renders only when one of those three props is
  present. When it is absent the `ScrollView` takes the `pt-[22px]` that the header used, so the
  content still clears the native grabber (this is the only extra change beyond the finding and it
  keeps the no-header sheets looking as they did before). Commit `a6f9e3b54`.
- **Finding 3** — nit (trailing hairline in `select-sheet.tsx`): left as is, per the round rules
  (no nit unless it sits in a line already changed).

**Tests added:** none. This is a UI-only, presentational change: the task Spec says
"Tests: None (UI)", AGENTS.md says "UI code gets no tests; the lead's phone smoke and Julio's live
checks cover it", and the Allowed files name no test path, so a new `*.test.tsx` would sit outside
the allowed scope. There is also no component-render harness in `@zilar/mobile` (only pure-logic
tests; no `@testing-library/react-native` or `react-test-renderer`), so a render test would need a
dependency the project forbids adding. No test commands were run.

**Gate:** `pnpm gate` from the repo root, after both fixes:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (0.9s)
PASS  typecheck  (3.2s)
PASS  effect  (0.5s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Disagreements

None. Both should-fix findings were correct; the only judgement call is the `pt-[22px]` fallback
under finding 2, noted above.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 1 auto round, nit 1.
- Phone smoke PASS on a cold emulator (the first run hit an emulator System UI hang, not the app).
- The chat list and a long-press sheet render on the D24 panel, hugging their content.
- `/dev/kit` is dev-build only, so the new parts (BottomSheet header and footer, StepTrack, choice tone, SelectSheet dot and footer) get their visual check in the mobile New AI flow task.
