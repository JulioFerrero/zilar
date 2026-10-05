---
id: T-0258
title: "Web kit migration 2: ConfirmDialog, AddContactDialog, InviteDialog and AddMachineDialog render through the kit Dialog"
status: todo
milestone: M5
branch: task/T-0258-web-kit-dialogs-1
model: auto
effort: low
depends_on: [T-0243, T-0253]
estimate: 0.3 day
---

# T-0258: four dialogs on the kit Dialog

## Spec (written by Claude, do not edit)

### Why
This is audit step 6 (`docs/audit/ui-kit-audit.md` section 5): 19 web files build their own `role="dialog"` shell, each with its own Escape handling, backdrop and panel look. The kit `Dialog` (`apps/web/src/components/ui/dialog.tsx`) already has Escape, a focus trap, focus return and a backdrop click to close. This task moves the four simplest dialogs onto it.

### Verified facts (do not re-derive)
- The kit `Dialog` (`apps/web/src/components/ui/dialog.tsx`):
  - props `open`, `onClose`, `title`, `description?`, `children?`, `actions?` (a right-aligned footer) and `size?: 'sm' | 'md'` (lines 4-12);
  - the panel is `rounded-2xl border border-border bg-panel p-5 shadow-xl`, `max-w-sm` or `max-w-md`;
  - the title is an `h2`, 18/600.
- The hand-built shells, each with its own Escape `keydown` handler, a `fixed inset-0 z-40 … bg-black/40 p-4` backdrop and a `max-w-sm rounded-2xl` panel:
  - `apps/web/src/components/ConfirmDialog.tsx`: Escape at line 41, `role="dialog"` at 69, panel at 79 (`border-border-strong bg-surface`). It is imported by 7 non-test files, and its props and behaviour must not change.
  - `apps/web/src/components/AddContactDialog.tsx`: Escape at 76, shell at 90-98 (`bg-background`). Test: `apps/web/src/components/AddContactDialog.test.tsx`.
  - `apps/web/src/components/InviteDialog.tsx`: Escape at 36, shell at 53-61.
  - `apps/web/src/components/machines/AddMachineDialog.tsx`: Escape at 76, shell at 114-123. Test: `apps/web/src/components/machines/AddMachineDialog.test.tsx`.

### What to build
1. Each of the four renders `<Dialog open onClose=… title=… description=… size="sm" actions=…>` with its body as children. Delete its own Escape handler, backdrop and panel markup. Keep every text, button and behaviour, including `ConfirmDialog`'s Cancel focus and danger button. If the kit lacks something one of them needs (for example `ConfirmDialog` focusing Cancel first rather than the first focusable), add a small optional prop to the kit `Dialog` (such as `initialFocusRef`), with a kit test and a fixture case.
2. Each dialog now uses the kit look (`bg-panel border-border`); that is intended.
3. Tests:
   - existing tests keep passing, changed only where they relied on the old markup;
   - add a test per migrated dialog without one (`ConfirmDialog.test.tsx`, `InviteDialog.test.tsx`) checking that Escape closes it and that the title is the dialog's accessible name.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, the four dialog files.

### Allowed files
`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ConfirmDialog.test.tsx` (new), `apps/web/src/components/AddContactDialog.tsx`, `apps/web/src/components/AddContactDialog.test.tsx`, `apps/web/src/components/InviteDialog.tsx`, `apps/web/src/components/InviteDialog.test.tsx` (new), `apps/web/src/components/machines/AddMachineDialog.tsx`, `apps/web/src/components/machines/AddMachineDialog.test.tsx`, `work/T-0258-web-kit-dialogs-1.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ConfirmDialog AddContactDialog InviteDialog AddMachineDialog fixtures
pnpm gate
```

### Acceptance
- None of the four files contains `role="dialog"` or its own Escape handler. Behaviour and texts are unchanged.
- The callers of `ConfirmDialog` need no change.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
The other 15 dialog files (later batches), and the panels (`GroupPanel`, `TopicPanel`, `AiPanel`, …).

---

## Report (written by the worker when done)

## Review (written by Claude)
