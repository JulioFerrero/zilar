---
id: T-0323
title: "Web kit: Checkbox, used by the group, topic, roles and folder pickers"
status: todo
milestone: M5
branch: task/T-0323-web-checkbox
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0323: kit Checkbox

## Spec (written by Claude, do not edit)

### Why
Web has six checkboxes in pickers, and they look three different ways:
- native with `accent-[var(--accent)]`;
- native with `accent-white`;
- a custom box in the folder editor.

The audit (`docs/audit/ui-kit-audit.md` §2a) lists `Checkbox` as a kit piece. The folder editor's custom box is the look we keep.

### Verified facts (do not re-derive)
- **The custom box** (`apps/web/src/components/FolderEditorDialog.tsx:364-382`):
  - a `<input type="checkbox" className="peer sr-only">` with `checked`, `disabled` and `onChange`;
  - then a `<span aria-hidden="true">` with `flex size-4 shrink-0 items-center justify-center rounded border transition-colors`;
  - when checked: `border-transparent bg-accent text-accent-foreground`, holding `<Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />`;
  - unchecked: `border-border-strong bg-transparent`, plus `opacity-40` when disabled.

  It has no visible focus ring.
- **Native checkboxes**, each inside a `<label>` row:
  - `apps/web/src/components/NewGroupDialog.tsx:183-188` (`accent-[var(--accent)]`, no aria-label: the row's text names it);
  - `apps/web/src/components/NewTopicDialog.tsx:300-307` (members: `disabled={locked}` and an aria-label), `336-342` (AIs, aria-label) and `364-370` (roles, aria-label);
  - `apps/web/src/components/GroupPanel.tsx:807-814` (role holders: `disabled={busy}` and an aria-label).
- **Kit conventions:**
  - components live in `apps/web/src/components/ui/`, with a `*.fixture.tsx` beside each;
  - `apps/web/src/components/ui/fixtures.test.tsx` globs `./*.fixture.tsx` and renders every export;
  - see `apps/web/src/components/ui/switch.tsx` and `switch.fixture.tsx` for the shape.
- **Tests that click these checkboxes** (they must pass unchanged): `apps/web/src/components/NewGroupDialog.test.tsx`, `apps/web/src/components/NewTopicDialog.test.tsx`, `apps/web/src/components/GroupPanel.test.tsx` and `apps/web/src/components/FolderEditorDialog.test.tsx`.

### What to build
1. **New file `apps/web/src/components/ui/checkbox.tsx`:** `Checkbox` with the props `checked`, `onCheckedChange(checked: boolean)`, `disabled?` and `label?` (rendered as `aria-label`).
   - It renders the folder editor's sr-only input plus the visual box.
   - Add a focus ring on the box: `peer-focus-visible:ring-2 peer-focus-visible:ring-ring`.
   - Apply `opacity-40` whenever it is disabled, checked or not.
   - It renders no `<label>` itself: callers keep their row `<label>`, so clicking the row toggles it.
2. **New file `apps/web/src/components/ui/checkbox.fixture.tsx`:** Off, On, Disabled off and Disabled on, each wrapped in a `<label>` with text.
3. **New file `apps/web/src/components/ui/checkbox.test.tsx`:**
   - clicking the row label calls `onCheckedChange(true)`;
   - a disabled box does not call it;
   - `label` sets the accessible name;
   - the Check icon shows only when checked.
4. **Replace the six checkboxes above** with `Checkbox`, keeping each one's `checked`, `disabled`, handler and aria-label.
   - Drop the old `accent-*` classes.
   - In FolderEditorDialog, keep the `!checked && full` disable rule.
   - Remove imports that become unused (`Check` in FolderEditorDialog if nothing else uses it).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/switch.tsx`, `switch.fixture.tsx`, `apps/web/src/components/FolderEditorDialog.tsx:355-395`, and the call sites above with their tests.

### Allowed files
`apps/web/src/components/ui/checkbox.tsx`, `apps/web/src/components/ui/checkbox.fixture.tsx`, `apps/web/src/components/ui/checkbox.test.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `work/T-0323-web-checkbox.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot checkbox fixtures NewGroupDialog NewTopicDialog GroupPanel FolderEditorDialog
pnpm gate
```

### Acceptance
- No `type="checkbox"` is left in `apps/web/src` outside `components/ui/checkbox.tsx` and tests.
- The four caller tests pass unchanged, and the new tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
