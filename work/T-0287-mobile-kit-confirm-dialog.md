---
id: T-0287
title: "Mobile kit: ConfirmDialog; AI delete, rule revoke and machine revoke/delete confirms use it"
status: todo
milestone: M5
branch: task/T-0287-mobile-kit-confirm-dialog
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0287: mobile kit ConfirmDialog

## Spec (written by Claude, do not edit)

### Why
The second mobile `Modal` family (`docs/audit/ui-kit-audit.md` §5 step 6) is the centred confirm. It is the same shell each time:
- `Modal transparent animationType="fade"`;
- a `flex-1 items-center justify-center bg-black/40 p-6` overlay;
- a `w-full max-w-xs rounded-2xl bg-background p-4` card;
- a title, a message, an optional red alert line, and a right-aligned Cancel + destructive confirm pair.

T-0283 already added `ActionSheet` the same way; see `work/T-0283-mobile-kit-action-sheet.md` (Report).

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ais/delete-confirm.tsx`** (`DeleteConfirmDialog`, 52 lines):
  - the shell above;
  - title "Delete {aiName ?? 'AI'}?", message "This removes the AI's chat account and its provider key.";
  - the error line has `accessibilityRole="alert"`;
  - buttons are the kit `Button` (`variant="ghost" size="sm"` "Cancel"; `variant="destructive" size="sm"` "Remove" / "Removing…"), both `disabled={busy}`.
- **`apps/mobile/src/components/approvals/always-allowed-row.tsx`** (`RevokeConfirmDialog`, from line 66; `Modal` at line 81 with `accessibilityLabel="Confirm revoke"`):
  - the same shell and buttons;
  - title "Stop always allowing {rule?.action ?? 'this action'}?", message "The AI will ask for approval again next time.", "Revoke" / "Revoking…".
  - Test: `apps/mobile/src/components/approvals/rows.test.tsx` (line 184 asserts 'Stop always allowing').
- **`apps/mobile/src/app/settings/machines.tsx`**, confirm `Modal` at lines 484-535:
  - the same shell;
  - title "Revoke this machine?" or "Delete this machine?", with matching messages, and an error line;
  - the buttons are hand-rolled `Pressable` pills: Cancel (`accessibilityLabel="Cancel"`), and confirm (`accessibilityLabel` "Confirm revoke" / "Confirm delete", `bg-destructive`, text "Working…" / "Revoke" / "Delete"), both `disabled={busyId !== null}`.
- **Mobile kit:**
  - `apps/mobile/src/components/ui/` has `button.tsx` (variants include `ghost` and `destructive`), `text.tsx` and `action-sheet.tsx`;
  - tests are in `kit.test.tsx` (the stubbed render style);
  - the catalog is `apps/mobile/src/app/dev/kit.tsx`.

### What to build
1. **`apps/mobile/src/components/ui/confirm-dialog.tsx`, `ConfirmDialog`:**
   - props: `visible`, `title`, `message`, `error?`, `confirmLabel`, `busyLabel`, `busy`, `onCancel`, `onConfirm`, `cancelLabel?` (default "Cancel"), `confirmAccessibilityLabel?`, `destructive?` (default true), `accessibilityLabel?` (on the `Modal`);
   - it renders the shell above with kit `Button`s: ghost Cancel, and a destructive confirm, or `default` when `destructive` is false;
   - the Android back button (`onRequestClose`) calls `onCancel`.
2. **Catalog and tests:**
   - add a "Confirm dialog" section to `apps/mobile/src/app/dev/kit.tsx` with a button that opens a sample, showing the error line;
   - kit tests: title and message render, the error renders as an alert, `busy` disables both buttons and shows `busyLabel`.
3. **Migrate the three confirms:**
   - `DeleteConfirmDialog` and `RevokeConfirmDialog` keep their exported names and props as thin wrappers;
   - `machines.tsx` uses `ConfirmDialog` inline;
   - keep every text and accessibility label. The machines buttons become kit `Button`s, the same look as the other two confirms;
   - `rows.test.tsx` keeps its assertions, with mocks updated as needed.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, the three files above, and `rows.test.tsx`.

### Allowed files
`apps/mobile/src/components/ui/confirm-dialog.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/components/ais/delete-confirm.tsx`, `apps/mobile/src/components/approvals/always-allowed-row.tsx`, `apps/mobile/src/components/approvals/rows.test.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `work/T-0287-mobile-kit-confirm-dialog.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit rows
pnpm gate
```

### Acceptance
- None of the three migrated confirms imports or renders `Modal` itself.
- Texts and accessibility labels are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
- The centred modals in `integrations.tsx`, `stickers.tsx` and `sticker-pack.tsx`, and `AddMachineSheet` in `machines.tsx`. They have inputs or more content and come later.
- The message actions sheet's inline delete confirm.

---

## Report (written by the worker when done)

## Review (written by Claude)
