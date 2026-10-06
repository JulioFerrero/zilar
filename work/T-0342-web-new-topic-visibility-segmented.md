---
id: T-0342
title: "Web kit migration: the New topic dialog's \"Who can see it\" picker uses SegmentedControl (radio mode)"
status: merged
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

### What I did
- Replaced the hand-rolled `role="group"`/`aria-pressed` Public/Private picker in `NewTopicDialog.tsx` with the kit `<SegmentedControl mode="radio" ariaLabel="Who can see it" options={[Public, Private]} value={visibility} onChange={…}>`, narrowing `next` to `TopicVisibility` (`if (next !== 'public' && next !== 'private') return;`), copying `NewGroupDialog.tsx:233-246`. Option order stays Public then Private.
- Kept the visible "Who can see it" heading and the hint paragraph text unchanged. The heading's `id="new-topic-visibility"` was removed because it only existed to be the `aria-labelledby` target of the deleted group; the kit control exposes its own `aria-label`. This is the only deviation from "unchanged" (visible text is identical).
- Updated both test queries from `getByRole('button', { name: 'Private' })` to `getByRole('radio', { name: 'Private' })`.
- Added a test `uses a radio group for visibility (T-0342)`: the `radiogroup` named "Who can see it" exists, Public is `aria-checked="true"` by default, Private is `false`, clicking Private flips the checked state and shows the private hint "Only the people you pick…".
- No `aria-pressed` remains in the visibility picker (only the Type chips keep `aria-pressed`, unchanged per spec).

### Files changed
- `apps/web/src/components/NewTopicDialog.tsx`
- `apps/web/src/components/NewTopicDialog.test.tsx`
- `work/T-0342-web-new-topic-visibility-segmented.md`

### Commands and results
- `pnpm install` — success.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot NewTopicDialog` — 1 file passed, 6 tests passed.
- `pnpm gate` — first run `GATE FAIL` at `format` (`apps/web/src/components/NewTopicDialog.test.tsx` needed Prettier wrapping); ran `pnpm exec prettier --write apps/web/src/components/NewTopicDialog.test.tsx` and re-ran. Final run:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (11.3s)
PASS  lint  (0.9s)
PASS  typecheck  (6.9s)
PASS  tests @zilar/web  (16.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Problems / open questions
None. Only the task's three Allowed files changed.

## Review (written by Claude)

**Approved** (pre-review clean, 1 nit accepted). "Who can see it" is now the kit `SegmentedControl` in radio mode, with the same order, narrowing and hint. The nit: the visible label `<span>` is no longer tied to the control. The radiogroup keeps the same accessible name through `ariaLabel`, so this is polish only. The new test checks the default checked state and the private hint.
