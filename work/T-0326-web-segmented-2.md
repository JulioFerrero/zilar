---
id: T-0326
title: "Web kit: New group Visibility and sticker pack visibility on SegmentedControl"
status: todo
milestone: M5
branch: task/T-0326-web-segmented-2
model: auto
effort: low
depends_on: [T-0324]
estimate: 0.2 day
---

# T-0326: SegmentedControl, batch 2

## Spec (written by Claude, do not edit)

### Why
T-0324 added `SegmentedControl mode="radio"` and moved Explore and the group panel's Visibility switch to it. The last two raw radio groups on web are the New group dialog's Visibility and the sticker pack editor's "Who can find this pack". Read the T-0324 Report and Review first.

### Verified facts (do not re-derive)
- **`SegmentedControl`** (`apps/web/src/components/ui/segmented-control.tsx`):
  - props: `options: { value, label, count? }[]`, `value`, `onChange(value: string)`, `ariaLabel` and `mode?: 'tabs' | 'radio'`;
  - radio mode renders `role="radiogroup"` and `role="radio"` buttons with `aria-checked`.
  - Usage with safe narrowing: `apps/web/src/components/VisibilitySection.tsx`, around line 128.
- **`apps/web/src/components/NewGroupDialog.tsx:232-263`:**
  - `role="radiogroup" aria-label="Visibility"`, with options private and public (labels Private and Public);
  - its `onChange` runs `setVisibility(option.value)`, `setCheck({ state: 'idle' })` and `setError(undefined)`.
  - `cn` is imported at line 11 and used only at line 241.
- **`apps/web/src/components/NewGroupDialog.test.tsx`:**
  - line 40 asserts `getByRole('radio', { name: 'Private' })` `toHaveProperty('checked', true)`, which only a native input has;
  - lines 52 and 74 click radios by name.
- **`apps/web/src/components/PackEditor.tsx`:**
  - lines 431-456: `<fieldset disabled={busy}>` with the legend "Who can find this pack";
  - lines 433-450: two native radios, `private` labelled "Private" and `server` labelled "Shared on this server", calling `setVisibility(…)`;
  - then a hint `<p>`.

  A disabled fieldset also disables the `<button>`s inside it. `PackEditor.test.tsx` has no test of this switch.

### What to build
1. **NewGroupDialog:**
   - replace lines 232-263 with `<SegmentedControl mode="radio" ariaLabel="Visibility" …>` inside a `div className="mt-1"`;
   - `onChange` narrows to `'private' | 'public'` and runs the same three setters;
   - remove the `cn` import.
2. **`NewGroupDialog.test.tsx:40`:** assert `getAttribute('aria-checked')` is `'true'`. That is the only test line that may change.
3. **PackEditor:**
   - replace lines 433-450 with `<SegmentedControl mode="radio" ariaLabel="Who can find this pack" options={[{ value: 'private', label: 'Private' }, { value: 'server', label: 'Shared on this server' }]} …>`;
   - narrow safely;
   - keep the fieldset, the legend and the hint.
4. **New test in `apps/web/src/components/PackEditor.test.tsx`:**
   - clicking "Shared on this server" switches the hint to "Shared packs can be found and added by anyone on this server.";
   - the radio's `aria-checked` becomes `'true'`.

### Read first
`AGENTS.md`, `work/T-0324-web-segmented.md` (Report and Review), `apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/VisibilitySection.tsx:120-150`, and the two call sites with their tests.

### Allowed files
`apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewGroupDialog.test.tsx`, `apps/web/src/components/PackEditor.tsx`, `apps/web/src/components/PackEditor.test.tsx`, `work/T-0326-web-segmented-2.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot NewGroupDialog PackEditor
pnpm gate
```

### Acceptance
- No `type="radio"` is left in `apps/web/src` outside tests.
- NewGroupDialog tests pass with only line 40 changed, and the new PackEditor test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
