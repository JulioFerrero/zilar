---
id: T-0292
title: "Web kit: TextInput / TextArea render the bare field when there is no label, hint or counter"
status: merged
milestone: M5
branch: task/T-0292-web-kit-field-no-wrapper
model: auto
effort: low
depends_on: [T-0291]
estimate: 0.1 day
---

# T-0292: no wrapper div for a bare field

## Spec (written by Claude, do not edit)

### Why
T-0291 kept the existing wrapping `<label>` around several fields and replaced only the `<input>` with `TextInput`. The kit always wraps the field in a `Field` `<div>`, so those labels now contain a `div`. That is not valid inside `<label>`, whose content must be phrasing content, and the pre-review flagged it.

A field with no `label`, `hint` or `counter` has nothing to wrap. It should render the bare `<input>` / `<textarea>`.

### Verified facts (do not re-derive)
- `apps/web/src/components/ui/text-input.tsx`:
  - `Field` (line 21) renders `<div className="flex flex-col gap-1.5">` with an optional `<label>`, the children, and an optional hint;
  - `TextInput` (line 75) and `TextArea` (line 120) always render `<Field …>`, with the field and an optional counter `<p>` inside.
- Kit tests: `apps/web/src/components/ui/kit.test.tsx` lines 71-110 (`describe('TextInput and TextArea')`), all with a `label`.
- Callers without a `label` prop, which will lose the wrapper:
  - `apps/web/src/routes/IntegrationsPage.tsx` (6 fields);
  - `apps/web/src/routes/ConnectionsPage.tsx` (2);
  - `apps/web/src/components/NewTopicDialog.tsx` (1);
  - `apps/web/src/components/NewGroupDialog.tsx` (title and descriptions);
  - check with `grep -rn "<TextInput\|<TextArea" apps/web/src`.

### What to build
1. In `TextInput` and `TextArea`: when `label`, `hint` and `counter` are all `undefined`, return the field element alone, with the same id, aria and class logic and no `Field` wrapper. Otherwise behave exactly as today.
2. Kit tests:
   - a bare `TextInput` renders no wrapper: its parent is the test container, or there is no `div.flex-col` around it;
   - a `TextInput` with `label` still renders the label and the wrapper.
3. Check that the callers listed above still look the same. The wrapper only held a single child, so nothing visual should change. Run their tests.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `work/T-0291-web-kit-text-input-3.md` (Report and Review).

### Allowed files
`apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `work/T-0292-web-kit-field-no-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit IntegrationsPage ConnectionsPage NewTopicDialog NewGroupDialog InviteLinksSection fixtures
pnpm gate
```

### Acceptance
- No `div` sits inside the wrapping `<label>`s from T-0291.
- Labelled fields are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/components/ui/text-input.tsx`: in both `TextInput` and `TextArea`, the field element (`<input>` / `<textarea>`) is now built once into a `field` variable with the same `id`, `aria-invalid`, `maxLength`, merged `className` and `onChange` logic. When `label`, `hint` and `counter` are all `undefined`, the function returns `field` directly, so no `Field` `<div className="flex flex-col gap-1.5">` wrapper is emitted. When any of the three is present, the previous behaviour is unchanged: `field` and the optional counter `<p>` are rendered inside `Field`. The `invalid` prop alone does not trigger the wrapper — it only affects the field's own `aria-invalid` / `border-destructive`.
- `apps/web/src/components/ui/kit.test.tsx`: added two tests to `describe('TextInput and TextArea')`:
  - a bare `TextInput` renders no wrapper: its parent is the test container and there is no `div.flex-col` in the container;
  - a labelled `TextInput` still renders a real `<label>` and keeps the `flex-col` wrapper.
- Callers without `label` (`IntegrationsPage`, `ConnectionsPage`, `NewTopicDialog`, `NewGroupDialog`, plus `InviteLinksSection` and the fixture) keep the same look: the removed wrapper held a single child, so nothing visual changes. Their tests pass.

### Files changed
- `apps/web/src/components/ui/text-input.tsx`
- `apps/web/src/components/ui/kit.test.tsx`
- `work/T-0292-web-kit-field-no-wrapper.md` (status/Report)

### Commands and real results
- `pnpm install` → Done, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit IntegrationsPage ConnectionsPage NewTopicDialog NewGroupDialog InviteLinksSection fixtures` → `Test Files 7 passed (7)`, `Tests 149 passed (149)`, exit 0.
- `pnpm gate` (repo root) summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (15.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (7.6s)
  PASS  tests @zilar/web  (18.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance
- No `div` sits inside the wrapping `<label>`s from T-0291: those callers pass no `label`/`hint`/`counter` to the kit, so the kit now returns the bare field. Verified by the new bare-field test and the passing caller tests.
- Labelled fields are unchanged: the existing label/hint/counter tests plus the new "keeps the wrapper and the label" test pass.
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed list.

### Problems / deviations
- None. Runtime `invalid` styling for a bare field is preserved (it was already on the field element, not the wrapper).

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Approved.** The pre-review was clean and there were no fix rounds.

- `TextInput` and `TextArea` now return the bare field when none of `label`, `hint` or `counter` is set, so the T-0291 wrapping labels no longer contain a `div`.
- **Nit accepted:** there is no test of a bare `TextArea`. Its code path is identical to `TextInput`'s.
