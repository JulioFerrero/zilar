---
id: T-0342
title: "Web kit migration: the New topic dialog's \"Who can see it\" picker uses SegmentedControl (radio mode)"
status: todo
milestone: M5
branch: task/T-0342-web-new-topic-visibility-segmented
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0342: New topic visibility on SegmentedControl

## Spec (written by Claude, do not edit)

### Why
`NewTopicDialog` still hand-rolls a two-option segmented control for "Who can see it", using `aria-pressed` buttons. The same choice in `NewGroupDialog` and in `VisibilitySection` already uses the kit `SegmentedControl` in radio mode (T-0324, T-0326), and the kit ignores a click on the active option (T-0330).

### Verified facts (do not re-derive)
- **`apps/web/src/components/NewTopicDialog.tsx`:**
  - line 46: `const [visibility, setVisibility] = useState<TopicVisibility>('public');`
  - lines 252-285: the label `<span id="new-topic-visibility">Who can see it</span>`, then a `role="group" aria-labelledby="new-topic-visibility"` `well-surface grid grid-cols-2` div, holding two `aria-pressed` buttons, Public and Private (`raised-segment` when active), then the hint paragraph;
  - the Type chips above it (lines 228-250) are wrapping chips; leave them as they are.
- **`apps/web/src/components/ui/segmented-control.tsx`:**
  - props `options: {value,label,count?}[]`, `value`, `onChange(value: string)`, `ariaLabel` and `mode?: 'tabs'|'radio'`;
  - radio mode renders `role="radiogroup"`, with options as `role="radio"`.
- **The example to copy:** `apps/web/src/components/NewGroupDialog.tsx:233-246`. Its `onChange` narrows the string (`if (next !== 'private' && next !== 'public') return;`).
- **`apps/web/src/components/NewTopicDialog.test.tsx:43` and `:99`:** `screen.getByRole('button', { name: 'Private' })`. With radio mode this becomes `getByRole('radio', { name: 'Private' })`.

### What to build
1. Replace the hand-rolled group with `<SegmentedControl mode="radio" ariaLabel="Who can see it" options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} value={visibility} onChange={…} />`.
   - Narrow `next` to `TopicVisibility` the way `NewGroupDialog` does.
   - Keep the visible "Who can see it" label and the hint paragraph unchanged.
   - Keep the option order: Public, then Private.
2. Update the two test queries to `getByRole('radio', { name: 'Private' })`.
3. Add one test: the "Who can see it" radiogroup has Public checked by default (`aria-checked="true"`), and clicking Private shows the private hint ("Only the people you pick…").

### Read first
`AGENTS.md`, `apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/NewGroupDialog.tsx:225-250`, `apps/web/src/components/NewTopicDialog.tsx:220-300` and `apps/web/src/components/NewTopicDialog.test.tsx`.

### Allowed files
`apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/NewTopicDialog.test.tsx`, `work/T-0342-web-new-topic-visibility-segmented.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot NewTopicDialog
pnpm gate
```

### Acceptance
- No `aria-pressed` remains in the visibility picker.
- Tests pass, including the new one.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
