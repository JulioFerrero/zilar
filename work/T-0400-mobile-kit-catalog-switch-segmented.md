---
id: T-0400
title: "Mobile kit: the dev catalog shows the Switch; the kit test covers Switch and SegmentedControl presses through their props"
status: merged
milestone: M5
branch: task/T-0400-mobile-kit-catalog-switch-segmented
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0400: Switch in the catalog

## Spec (written by Claude, do not edit)

### Why
- T-0397 added the kit `Switch` but left the catalog out, to avoid a conflict.
- The T-0392 review noted that the SegmentedControl's "call `onChange` only when the value changes" guard has no test.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/switch.tsx`:**
  - `Switch({ label, value, onValueChange, disabled?, hideLabel? })`, a row of a label `Text` and the RN `Switch`;
  - its tests are in `apps/mobile/src/components/ui/switch.test.tsx`.
- **`apps/mobile/src/components/ui/segmented-control.tsx`:**
  - lines 56-60: each option's `onPress` calls `onChange(option.value)` only when `!selected`.
- **`apps/mobile/src/app/dev/kit.tsx`** renders kit sections under `SectionLabel` and already has a "Segmented control" section (T-0392) and a "State messages" section (T-0386).
- **`apps/mobile/src/components/ui/kit.test.tsx`** renders with `renderToStaticMarkup` and mocks `react-native` as strings. Element trees can also be walked by calling a component function directly and reading `props`; see the `collect` helpers in `apps/mobile/src/components/contacts/contacts.test.tsx`.

### What to build
1. **Catalog:** add a "Switch" section to `kit.tsx` with two rows holding local state: one on and one off.
2. **Test:** in `kit.test.tsx`, add a `SegmentedControl` case that calls the component as a function, finds the option elements by their `accessibilityLabel`, and calls their `onPress`. Check that:
   - pressing the selected option does not call `onChange`;
   - pressing another option calls it once with that value.

   Use a mock or direct call; change no other test.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/switch.tsx`, `apps/mobile/src/components/ui/segmented-control.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/components/ui/kit.test.tsx` and `apps/mobile/src/components/contacts/contacts.test.tsx` (the `collect` helper).

### Allowed files
`apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `work/T-0400-mobile-kit-catalog-switch-segmented.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit
pnpm gate
```

### Acceptance
- The catalog shows the Switch.
- The SegmentedControl press cases pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
1. **Catalog (`apps/mobile/src/app/dev/kit.tsx`):** imported `Switch` from `@/components/ui/switch`, added two local states (`switchOn` starting `true`, `switchOff` starting `false`) and a new "Switch" section between "Segmented control" and "Action sheet" with two rows: `Notifications` (on) and `Sounds` (off).
2. **Test (`apps/mobile/src/components/ui/kit.test.tsx`):** added a `collect` helper (same shape as `contacts.test.tsx`) that renders widgets by calling them as functions and walks the plain element tree. Added two cases to the existing `SegmentedControl` describe:
   - pressing the selected option (`One`) does not call `onChange`;
   - pressing another option (`Two`) calls `onChange` exactly once with `'two'`.
   No other test was changed.

### Files changed
- `apps/mobile/src/app/dev/kit.tsx`
- `apps/mobile/src/components/ui/kit.test.tsx`
- `work/T-0400-mobile-kit-catalog-switch-segmented.md`

### Commands and real results
- `pnpm install`: done, 1170 packages added, exit 0 (one pre-existing peer warning for `@types/react-dom`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit`: `Test Files 1 passed (1)`, `Tests 36 passed (36)`, exit 0.
- `pnpm gate` (from repo root): summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (3.1s)
  PASS  format  (72.1s)
  PASS  lint  (2.0s)
  PASS  typecheck  (19.0s)
  PASS  tests @zilar/mobile  (6.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  All changed files are inside the Allowed files.

### Problems / deviations / open questions
- None. The existing React "incorrect casing"/unknown-prop warnings from `renderToStaticMarkup` are pre-existing and unrelated.
- I did not add a Switch test: the spec asked only for the SegmentedControl press cases, and `switch.test.tsx` already covers `Switch`.

### Fix round
- Added `expect(selected).toBeDefined();` and `expect(other).toBeDefined();` before the `onPress` calls in the two SegmentedControl press cases, so a missed lookup cannot make the pressure cases pass without pressing anything.
- Re-ran `pnpm gate`; it ended with `GATE PASS`.

## Review (written by Claude)

**2026-10-06, lead:** approved after one lead fix round. The pre-review nit was real: the "selected option" press test could pass without finding the option. Both press tests now assert the lookup first. The catalog has a Switch section with an on row and an off row.
