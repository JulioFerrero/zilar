---
id: T-0324
title: "Web kit: SegmentedControl radio mode, used by the Explore kind filter and the group Visibility switch"
status: merged
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

- Added `mode?: 'tabs' | 'radio'` (default `'tabs'`) to `SegmentedControl`; radio mode renders `radiogroup`/`radio` with `aria-checked`. Keyboard, roving tabIndex, and styles unchanged.
- New `segmented-control.test.tsx`: radio roles + `aria-checked`, ArrowRight selects next, tabs mode still exposes `tab`.
- `ExplorePage`: kind pills replaced with `<SegmentedControl mode="radio" ariaLabel="Kind filter" …/>` in `div.mt-2`; `onChange` looks up the value in a typed `KIND_OPTIONS` constant (no blind cast). Removed unused `cn` import.
- `VisibilitySection`: pills replaced with `SegmentedControl mode="radio" ariaLabel="Visibility"`; `onChange` guards to `'private' | 'public'` then runs the same five setters. Removed unused `cn` import.
- `VisibilitySection.test.tsx:83`: `toHaveProperty('checked', true)` -> `getAttribute('aria-checked')` is `'true'`. Only test line changed; `kit.test.tsx` and `ExplorePage.test.tsx` untouched.
- Files changed: `ui/segmented-control.tsx`, `ui/segmented-control.test.tsx` (new), `ExplorePage.tsx`, `VisibilitySection.tsx`, `VisibilitySection.test.tsx`, this task file.
- Checks: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot segmented-control kit ExplorePage VisibilitySection` — 4 files, 65 tests, all passed. `pnpm gate` — GATE PASS (install, format, lint, typecheck, tests @zilar/web all PASS; scope: every changed file inside Allowed files).
- Security checklist: no secrets/tokens; no deletes/updates touched; no caps/uniqueness; no permission changes (presentational change only); no new routes; no audit entries.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). `SegmentedControl` gains `mode="radio"`, which renders `radiogroup` and `radio` with `aria-checked`; tabs mode is unchanged. The Explore kind filter and the group Visibility switch use it, and both narrow the string value safely without a cast. The only test change is `VisibilitySection.test.tsx:83`, which now checks `aria-checked`, as the spec allowed. The look changes from bordered pills to the well track with a raised segment. NewGroupDialog's switch follows once T-0323 merges.
