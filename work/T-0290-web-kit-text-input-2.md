---
id: T-0290
title: "Web kit migration 14: New group and invite-link fields use the kit TextInput / TextArea"
status: merged
milestone: M5
branch: task/T-0290-web-kit-text-input-2
model: auto
effort: low
depends_on: [T-0288]
estimate: 0.3 day
---

# T-0290: kit TextInput, batch 2

## Spec (written by Claude, do not edit)

### Why
T-0288 put the first four fields on the kit `TextInput`. The lead checked them in the browser: the recessed well and the focus outline look right. This batch covers two components whose fields use other patterns.

### Verified facts (do not re-derive)
- **Kit** (`apps/web/src/components/ui/text-input.tsx`):
  - `TextInput` and `TextArea` take all native props plus `label?`, `hint?`, `invalid?` and `counter?`;
  - with `label`, they render a `<label htmlFor>` above the field in a `flex flex-col gap-1.5` wrapper;
  - `className` goes to the field itself; `TextArea` adds `min-h-20`;
  - a native `aria-label` passed through overrides the visible label as the accessible name.
- **`apps/web/src/components/NewGroupDialog.tsx`:**
  - line 203: title `<input>` with `aria-label={nameLabel}` and no visible label, `autoFocus`, `maxLength={100}`, class `mt-3 w-full rounded-lg border …`;
  - line 213: `<textarea>` channel description, `aria-label="Channel description"`, `rows={2}`, `resize-none`;
  - lines 273-288: `<label htmlFor="new-group-handle">Handle</label>` plus `<input id="new-group-handle" … aria-label="Group handle">`;
  - line 300: `<textarea>` group description, `aria-label="Group description"`, `resize-none`.
  - Checkboxes (line 182) and radios (line 245) stay as they are.
- **`apps/web/src/components/InviteLinksSection.tsx`** lines 151-184: three `<label className="flex flex-col gap-1 text-[13px]"><span className="text-muted-foreground">Visible text</span><input … aria-label="…" /></label>` blocks:
  - "Label (optional, up to 60 characters)", `aria-label="Link label"`;
  - "Expires in (hours, optional)", `aria-label="Expiry in hours"`;
  - "Max uses (optional)", `aria-label="Max uses"`.
  - The last two sit side by side in a `flex gap-2` row inside `flex-1` labels.
- Tests: `apps/web/src/components/NewGroupDialog.test.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`. Other tests that render `InviteLinksSection` through `GroupPanel` may query these names.

### What to build
1. **`aria-label`-only fields** (NewGroupDialog title and both textareas) become `<TextInput aria-label=…>` or `<TextArea aria-label=… rows={2} className="resize-none min-h-0">` with no `label`. The top margin moves to a wrapper `div` if needed.
2. **The `label htmlFor` + input pair** (NewGroupDialog handle) becomes `<TextInput id="new-group-handle" label="Handle" aria-label="Group handle" …>`.
3. **The three wrapped-label blocks** (InviteLinksSection) become `<TextInput label="<visible text>" aria-label="<same aria-label as today>" …>`.
   - The two side-by-side fields stay side by side: put a `flex-1 min-w-0` wrapper `div` around each.
   - The visible label is now the kit's `text-[14px] font-medium`. That is accepted.
4. Keep every value, handler, `maxLength`, `inputMode`, `autoFocus`, placeholder, accessible name and behaviour.
5. **Tests:**
   - existing tests keep passing; if a test elsewhere breaks only because of markup, list it in the Report as BLOCKED instead of editing it;
   - add one `well-surface` assertion per test file.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `work/T-0288-web-kit-text-input-1.md` (Report), the two components and their tests.

### Allowed files
`apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewGroupDialog.test.tsx`, `apps/web/src/components/InviteLinksSection.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`, `work/T-0290-web-kit-text-input-2.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot NewGroupDialog InviteLinksSection GroupPanel Channels
pnpm gate
```

### Acceptance
- In the two files, the only raw `<input` elements left are `type="checkbox"` and `type="radio"`, and no raw `<textarea>` is left.
- Accessible names and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/components/NewGroupDialog.tsx`:
  - Title field (`aria-label={nameLabel}`, no visible label) → `<TextInput autoFocus value={title} maxLength={100} … aria-label={nameLabel}>` inside a `<div className="mt-3">` (old input's top margin).
  - Channel description `<textarea aria-label="Channel description">` → `<TextArea rows={2} className="min-h-0 resize-none">` inside a `<div className="mt-2">`.
  - Handle `label htmlFor` + `<input>` pair → `<TextInput id="new-group-handle" label="Handle" … aria-label="Group handle">` inside a `<div className="mt-3">` (old label's top margin).
  - Group description `<textarea aria-label="Group description">` → `<TextArea rows={2} className="min-h-0 resize-none">` inside a `<div className="mt-2">`.
  - Checkboxes (members) and radios (visibility) are untouched.
- `apps/web/src/components/InviteLinksSection.tsx`: the three wrapped-label blocks became `<TextInput label="…" aria-label="…">` (kept `value`, `onChange`, `maxLength`, `inputMode`, `placeholder`). The two side-by-side fields are each wrapped in `<div className="min-w-0 flex-1">` so they stay side by side.
- Kept every value, handler, `maxLength`, `inputMode`, `autoFocus`, placeholder and accessible name (`aria-label`) unchanged.
- Tests: added one `well-surface` assertion per test file (`NewGroupDialog.test.tsx` on `Group name`, `InviteLinksSection.test.tsx` on `Link label`). No other test file needed editing.

### Files changed
- `apps/web/src/components/NewGroupDialog.tsx`
- `apps/web/src/components/NewGroupDialog.test.tsx`
- `apps/web/src/components/InviteLinksSection.tsx`
- `apps/web/src/components/InviteLinksSection.test.tsx`
- `work/T-0290-web-kit-text-input-2.md` (status/Report)

### Commands and real results
- `pnpm install` → Done, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot NewGroupDialog InviteLinksSection GroupPanel Channels` → 4 files passed, 41 tests passed, exit 0.
- `pnpm gate` (repo root) summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (6.6s)
  PASS  tests @zilar/web  (16.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance
- `grep '<input|<textarea'` in the two components now only finds the two `type="checkbox"` / `type="radio"` inputs; no raw `<textarea>` remains. Verified.
- Accessible names (`Group name`, `Group handle`, `Group description`, `Link label`, `Expiry in hours`, `Max uses`, `Channel name`, `Channel description`) and behaviour are unchanged; the existing tests pass.

### Problems / deviations
- None. No files outside the Allowed list were touched.
- Deviations: `TextArea` gets `className="min-h-0 resize-none"` (kit's default `min-h-20` removed) as the spec asked; the visible labels in `InviteLinksSection` now use the kit's `text-[14px] font-medium` instead of the old `text-[13px]` muted span. Accepted by the spec.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Approved.** Clean pre-review, 0 nits, no fix rounds.
- The only raw inputs left are the member checkboxes and the visibility radios.
- Accessible names are kept.
- The textareas use `min-h-0 resize-none`.
