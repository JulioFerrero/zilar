---
id: T-0258
title: "Web kit migration 2: ConfirmDialog, AddContactDialog, InviteDialog and AddMachineDialog render through the kit Dialog"
status: merged
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

### What I did

Moved `ConfirmDialog`, `AddContactDialog`, `InviteDialog` and `AddMachineDialog` onto the kit `Dialog`. Each now renders `<Dialog open onClose=… title=… description=… size="sm" actions=…>`; their own Escape handlers, backdrops and panel markup are gone. All texts, buttons and behaviours are kept:

- `ConfirmDialog`: `cancelRef` focuses the Cancel key via the new `initialFocusRef` prop; the danger confirm key is unchanged. Its props and public behaviour are unchanged, so none of its 7 callers moved.
- `AddContactDialog`: keeps `autoFocus` on the username input (the kit also focuses the first focusable child, same element).
- `InviteDialog`: copy/error/Close markup unchanged; the only stateful behaviour removed is its own document Escape listener.
- `AddMachineDialog`: loading/error/ready/expired bodies unchanged; the footer (Close+Try again, or New code+Done) is passed as `actions` and omitted during `loading`, matching the old markup. `dialogRef` (unused after removing the shell) was dropped.

### Kit `Dialog` changes (Allowed files)

- Added optional `initialFocusRef?: RefObject<HTMLElement | null>`; on open the panel focuses it when present, otherwise the first focusable child, otherwise the panel. Kit test `focuses initialFocusRef instead of the first focusable child` added, plus a fixture case `InitialFocus`.
- Moved Escape handling from the panel's `onKeyDown` to a document-level `keydown` effect, so Escape works from any focus position exactly like the old hand-built shells did. The panel `onKeyDown` now only handles the Tab trap. Reason: existing tests outside the Allowed files (`MachinesPage.test.tsx:461`, `NewChatButton.test.tsx:169`) close these dialogs with `fireEvent.keyDown(document, …)` and would otherwise regress. This is a deliberate deviation from "the kit already has Escape" — see Open questions.

### Tests

- New `ConfirmDialog.test.tsx`: title is the accessible name, Escape calls `onCancel`, Cancel is focused first, confirm key calls `onConfirm`.
- New `InviteDialog.test.tsx`: title is the accessible name and Escape calls `onClose` (store `createInvite` stubbed with a fixed URL).
- `AddContactDialog.test.tsx` and `AddMachineDialog.test.tsx` needed no changes; they passed as-is (the document Escape path still works).

### Files changed

`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ConfirmDialog.test.tsx` (new), `apps/web/src/components/AddContactDialog.tsx`, `apps/web/src/components/InviteDialog.tsx`, `apps/web/src/components/InviteDialog.test.tsx` (new), `apps/web/src/components/machines/AddMachineDialog.tsx`, `work/T-0258-web-kit-dialogs-1.md`.

### Commands and real results

- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ConfirmDialog AddContactDialog InviteDialog AddMachineDialog fixtures`: 6 files passed, 99 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot NewChatButton MachinesPage GroupHandleRoute FolderEditorDialog MessageActions tools` (callers/neighbours, to check the Escape move): 8 files passed, 88 tests passed.
- `pnpm gate` (repo root):
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (18.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (9.5s)
  PASS  tests @zilar/web  (33.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance

- None of the four files contains `role="dialog"` or its own Escape handler (only a comment in `ConfirmDialog.tsx` mentions Escape). Confirmed with grep.
- Callers of `ConfirmDialog` unchanged.
- `pnpm gate` is green and reports no file outside the Allowed files. `pnpm-lock.yaml` untouched.

### Open questions / deviations

- Kit `Dialog` Escape now runs on a document listener instead of the panel's React `onKeyDown`. This preserves the old shells' behaviour and keeps `MachinesPage`/`NewChatButton` tests green, but it drops the earlier `stopPropagation` guard against a nested dialog's Escape also closing an outer dialog. No test covers nested dialogs; later migration batches should decide whether the kit should keep the document listener or return to the panel-scoped handler (and update those out-of-scope tests then).

### Round 1 (fix round)

- Fixed finding 1 (should-fix, `PREREVIEW.md`): the kit `Dialog` document-level Escape handler closed every open dialog. It now closes only the topmost one: on Escape it first checks that its own panel is the last `[role="dialog"]` in the document, so a stacked dialog no longer dismisses the one underneath. The document listener is kept (needed by the out-of-scope `MachinesPage`/`NewChatButton` tests) and all four migrated dialogs inherit the fix.
- Test added: `apps/web/src/components/ui/kit.test.tsx` — "closes only the topmost dialog on Escape when two are open" (asserts the top dialog's `onClose` fires and the background one's does not).
- Nit 2 (`AddMachineDialog.tsx:147`, `actions={actions}`) left as is: it is not a line this round changes, and nits are out of scope unless already touched.
- Commands: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ConfirmDialog AddContactDialog InviteDialog AddMachineDialog fixtures` → 6 files, 100 tests passed (was 99; +1 new test). Neighbours `NewChatButton MachinesPage AddMachineDialog` → 3 files, 28 tests passed. `pnpm gate` → `GATE PASS` (install, format, lint, typecheck, tests @zilar/web all PASS; scope clean).

### Disagreements

None.

## Review (written by Claude)

**Verdict:** Approved; clean after 1 auto round (1 style nit).
- None of the four files has its own `role="dialog"` or Escape handler any more.
- The kit `Dialog` gained `initialFocusRef` (ConfirmDialog keeps Cancel-first focus) and a document-level Escape that closes only the topmost dialog.
- Texts and buttons are unchanged.
