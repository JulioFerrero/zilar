---
id: T-0324
title: "Web kit: SegmentedControl radio mode, used by the Explore kind filter and the group Visibility switch"
status: todo
milestone: M5
branch: task/T-0324-web-segmented
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0324: SegmentedControl, radio mode

## Spec (written by Claude, do not edit)

### Why
The kit `SegmentedControl` (`apps/web/src/components/ui/segmented-control.tsx`) has no app users. Explore's kind filter and the group Visibility switch hand-roll the same choice as bordered pills over sr-only radios. Those are choices, not tabs, so the kit needs a radio mode.

### Verified facts (do not re-derive)
- **`SegmentedControl`** (lines 1-83):
  - props: `options: { value, label, count? }[]`, `value`, `onChange(value: string)` and `ariaLabel`;
  - it renders `role="tablist"` with `role="tab"` buttons, `aria-selected` and a roving `tabIndex`;
  - ArrowLeft and ArrowRight (wrapping), Home and End move and select.
  - Its tests are in `apps/web/src/components/ui/kit.test.tsx`, which other running tasks also edit. **Do not edit `kit.test.tsx`**; put the new tests in a new file.
- **Explore** (`apps/web/src/components/ExplorePage.tsx:163-191`): `role="radiogroup" aria-label="Kind filter"`, with options all, group and channel (labels All, Groups and Channels) and `setKind(option.value)`. `cn` is imported at line 9.
- **Visibility** (`apps/web/src/components/VisibilitySection.tsx:128-161`):
  - `role="radiogroup" aria-label="Visibility"`, with options private and public (labels Private and Public);
  - its `onChange` runs five setters: `setPicked`, `setCheck({ state: 'idle' })`, `setError(undefined)`, `setSaved(false)` and `setConfirmingPrivate(false)`.

  `cn` is imported at line 6.
- **Tests:**
  - `apps/web/src/components/ExplorePage.test.tsx:101` clicks `getByRole('radio', { name: 'Channels' })`;
  - `apps/web/src/components/VisibilitySection.test.tsx` clicks `getByRole('radio', { name: … })` at lines 84, 98, 111 and 137;
  - line 83 asserts `toHaveProperty('checked', true)`, which only a native input has.
- `NewGroupDialog.tsx` has the same Visibility switch, but another running task edits that file; **leave it** for a later task.

### What to build
1. **`SegmentedControl`:** add an optional `mode?: 'tabs' | 'radio'` (default `'tabs'`, unchanged).
   - In radio mode, render `role="radiogroup"` and `role="radio"` buttons with `aria-checked`, instead of `aria-selected`.
   - The keyboard, the roving tabIndex and the look stay the same.
2. **New file `apps/web/src/components/ui/segmented-control.test.tsx`:**
   - radio mode exposes `radiogroup` and `radio` roles with `aria-checked`;
   - ArrowRight selects the next option;
   - tabs mode still exposes `tab`.
3. **Explore:** replace lines 163-191 with `<SegmentedControl mode="radio" ariaLabel="Kind filter" options={…} value={kind} onChange={…} />`, wrapped in a `div className="mt-2"`. Narrow the string back to the kind type safely: look it up in the options and do not cast blindly.
4. **Visibility:** replace lines 128-161 with `SegmentedControl mode="radio" ariaLabel="Visibility"`. Its `onChange` runs the same five setters.
5. **`VisibilitySection.test.tsx:83`:** change the assertion to `getAttribute('aria-checked')` being `'true'`. That is the only test line that may change.
6. Remove `cn` imports that become unused.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/segmented-control.tsx`, the two call sites and their tests.

### Allowed files
`apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/ui/segmented-control.test.tsx`, `apps/web/src/components/ExplorePage.tsx`, `apps/web/src/components/VisibilitySection.tsx`, `apps/web/src/components/VisibilitySection.test.tsx`, `work/T-0324-web-segmented.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot segmented-control kit ExplorePage VisibilitySection
pnpm gate
```

### Acceptance
- Explore and the group Visibility section use `SegmentedControl` in radio mode; no sr-only radio pills are left in those two files.
- `kit.test.tsx` passes unchanged. ExplorePage tests pass unchanged; VisibilitySection tests pass with only line 83 changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
