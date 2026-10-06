---
id: T-0292
title: "Web kit: TextInput / TextArea render the bare field when there is no label, hint or counter"
status: todo
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

## Review (written by Claude)
