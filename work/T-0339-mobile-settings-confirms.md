---
id: T-0339
title: "Mobile kit migration: the Stickers, Sticker pack and Integrations confirm dialogs use the kit ConfirmDialog"
status: merged
milestone: M5
branch: task/T-0339-mobile-settings-confirms
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0339: settings confirms on ConfirmDialog

## Spec (written by Claude, do not edit)

### Why
Four confirm dialogs in mobile Settings screens hand-roll the same shell:
- a `Modal` with a `bg-black/40` backdrop;
- a `max-w-xs rounded-2xl bg-background p-4` card;
- the title, the body and an optional error;
- a Cancel button and a destructive button.

The kit `ConfirmDialog` (`apps/mobile/src/components/ui/confirm-dialog.tsx`) is that shell, with the contrast fix from T-0317 (`border border-border-strong bg-surface`).

### Verified facts (do not re-derive)
- **`ConfirmDialog` props:**
  - `visible`, `title`, `message`, `error?`, `confirmLabel`, `busyLabel`, `busy`, `onCancel`, `onConfirm`;
  - `cancelLabel?`, `confirmAccessibilityLabel?`, `cancelAccessibilityLabel?`, `destructive?` and `accessibilityLabel?`.

  It imports `Modal` and `View` from `react-native`, the kit `Button` and `Text`. `Button` imports `TextClassContext` from `@/components/ui/text`, `useKeyPress`, `@/lib/depth` and `Platform`.
- **The four hand-rolled dialogs:**
  1. `apps/mobile/src/app/settings/stickers.tsx:592-637`:
     - "Remove this pack?", with the message `${confirming.title} leaves your sticker panel. You can add it again from Discover if it is still shared.`;
     - error `confirmError`, busy `busy`, Cancel → `setConfirming(null)`;
     - confirm "Remove" / "Removing…" → `confirmRemove`, with the accessibility label `Remove ${confirming.title}` (or `Remove pack`).
  2. `apps/mobile/src/app/settings/sticker-pack.tsx:805-847`:
     - "Delete this pack?", with the message "The pack and its files are deleted. Messages already sent keep their sticker URL, which no longer loads a sticker.";
     - error `deleteError`, busy `deleting`;
     - confirm "Delete" / "Deleting…" → `confirmDelete`, with the accessibility label `Delete ${title}` (or `Delete pack`).
  3. `apps/mobile/src/app/settings/sticker-pack.tsx:849-884`:
     - "Discard changes?", with the message "Your changes to this pack are not saved.";
     - cancel "Keep editing" → `setDiscardAsk(false)`;
     - confirm "Discard" → `setDiscardAsk(false); router.back();`. There is no busy state.
  4. `apps/mobile/src/app/settings/integrations.tsx`, function `RemoveConfirmDialog` (from line 262; its `Modal` is at lines 278-310):
     - props `title`, `body`, `removing`, `error`, `onCancel`, `onConfirm`;
     - confirm "Remove" / "Removing…", with the accessibility label "Confirm remove".
- **Screen tests** (they call the screens as functions and render with `renderToStaticMarkup`):
  - `apps/mobile/src/components/stickers/stickers-screen.test.tsx` expects `'Remove this pack?'` at line 306;
  - `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` expects `'Delete this pack?'` at lines 434 and 450;
  - `apps/mobile/src/components/integrations/integrations-screen.test.tsx`.

  They mock `react-native`, `@/components/ui/text` (as `{ Text: 'Text' }`, with no `TextClassContext`), `@/lib/colors` and others by hand. **Transitive mock pitfall** (`docs/LEAD_HANDOFF.md`): importing `ConfirmDialog` pulls in `Button`, which these mocks do not cover. The simplest fix is to stub `@/components/ui/confirm-dialog` in each of the three tests, for example as a component that renders `title` and `message` as text when `visible`.

### What to build
1. Replace each of the four hand-rolled dialogs with `<ConfirmDialog … destructive />`, keeping:
   - every visible string, handler and accessibility label;
   - the error;
   - the busy state and its label.

   For the Discard dialog, pass `busy={false}`, `busyLabel="Discard"`, `cancelLabel="Keep editing"` and `cancelAccessibilityLabel="Keep editing"`.
2. In integrations, `RemoveConfirmDialog` becomes a thin wrapper around `ConfirmDialog`, or its call site uses `ConfirmDialog` directly. Pick the smaller diff.
3. Remove `Modal` and other imports that become unused.
4. In the three screen tests, add only the mocks needed (a `confirm-dialog` stub is preferred), so the existing assertions pass unchanged.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `apps/mobile/src/components/ui/confirm-dialog.tsx`, a ConfirmDialog user such as `apps/mobile/src/app/settings/machines.tsx` (and how its test mocks it, if it has one), the three screens and the three tests.

### Allowed files
`apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/app/settings/integrations.tsx`; mocks only: `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`, `apps/mobile/src/components/integrations/integrations-screen.test.tsx`; and `work/T-0339-mobile-settings-confirms.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen sticker-pack-screen integrations-screen
pnpm gate
```

### Acceptance
- No `<Modal` is left in the three screens, except any that are not one of these four confirms. Name those in the Report.
- The screen tests pass, with only mock changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Replaced the four hand-rolled confirm dialogs with the kit `ConfirmDialog` (`<ConfirmDialog … destructive />`), keeping every visible string, handler, error, busy state/label and accessibility label:
- `apps/mobile/src/app/settings/stickers.tsx`: the "Remove this pack?" dialog now uses `ConfirmDialog` (`confirmAccessibilityLabel` = `Remove <title>` / `Remove pack`).
- `apps/mobile/src/app/settings/sticker-pack.tsx`: the "Delete this pack?" dialog (error, busy `Deleting…`, `confirmAccessibilityLabel` = `Delete <title>` / `Delete pack`) and the "Discard changes?" dialog (`busy={false}`, `busyLabel="Discard"`, `cancelLabel="Keep editing"`, `cancelAccessibilityLabel="Keep editing"`, confirm keeps `setDiscardAsk(false); router.back()`).
- `apps/mobile/src/app/settings/integrations.tsx`: `RemoveConfirmDialog` is now a thin wrapper around `ConfirmDialog` (smaller diff; call sites unchanged), keeping title/body/error/busy and `confirmAccessibilityLabel="Confirm remove"`.
- Removed the now-unused `Modal` imports in all three screens.

Test mocks (only mock changes): added a `@/components/ui/confirm-dialog` stub to the three screen tests, so the existing assertions run unchanged. The spec's example stub rendered `title` and `message`; the sticker-pack test also asserts `Delete Mine` (the confirm accessibility label), so that stub renders `error` and `confirmAccessibilityLabel` too. The stickers and integrations stubs render `title` + `message` and `title`, respectively.

### Files changed (7, all inside Allowed files)
`apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`, `apps/mobile/src/components/integrations/integrations-screen.test.tsx`, `work/T-0339-mobile-settings-confirms.md`.

### Commands and real results
- `pnpm install`: `Done in 11.8s using pnpm v10.32.1` (one pre-existing `@types/react-dom` peer warning).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen sticker-pack-screen integrations-screen`: `Test Files 3 passed (3)`, `Tests 37 passed (37)`.
- `pnpm gate` (first run): `GATE FAIL` — `FAIL format` listed my `stickers.tsx`, `sticker-pack-screen.test.tsx`, `stickers-screen.test.tsx`; scope was already `every changed file is inside the Allowed files`. Fixed with `pnpm exec prettier --write` on those three files.
- `pnpm gate` (second run):
  ```
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.9s)
  PASS  tests @zilar/mobile  (1.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance
- No `<Modal` is left in the three screens. The only remaining `<Modal` in `apps/mobile/src/app/settings/` is `machines.tsx:577` (the add-machine sheet), which is not one of these four confirms and is outside this task's scope.
- The screen tests pass with only mock changes.

### Deviations / notes
- The sticker-pack test stub also renders `error` and `confirmAccessibilityLabel` (the spec's example only mentioned `title` and `message`), because the test asserts `Delete Mine` and the delete-error sentence.
- The Cancel buttons of the stickers/delete/integrations dialogs rely on `ConfirmDialog`'s default cancel (button text "Cancel", which is also the accessible name they had before). Only the Discard dialog passes an explicit `cancelAccessibilityLabel`, as the spec requires.
- No blockers.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). These four confirms now render through the kit `ConfirmDialog` (destructive):
- Remove this pack (Stickers);
- Delete this pack and Discard changes (Sticker pack); Discard keeps "Keep editing" and has no busy state;
- Integrations' `RemoveConfirmDialog`, now a thin wrapper.

The strings, handlers, accessibility labels, errors and busy labels are unchanged, and the lead checked that the `visible` props are in place. The three screen tests changed mocks only.
