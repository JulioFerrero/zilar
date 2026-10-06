---
id: T-0400
title: "Mobile kit: the dev catalog shows the Switch; the kit test covers Switch and SegmentedControl presses through their props"
status: todo
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

## Review (written by Claude)
