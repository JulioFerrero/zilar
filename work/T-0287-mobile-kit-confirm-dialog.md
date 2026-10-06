---
id: T-0287
title: "Mobile kit: ConfirmDialog; AI delete, rule revoke and machine revoke/delete confirms use it"
status: merged
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
`apps/mobile/src/components/ui/confirm-dialog.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/components/ais/delete-confirm.tsx`, `apps/mobile/src/components/approvals/always-allowed-row.tsx`, `apps/mobile/src/components/approvals/rows.test.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx` (stubs only; added by the lead after the worker's BLOCKED), `work/T-0287-mobile-kit-confirm-dialog.md`.

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

**What I did (all inside the Allowed files)**

- Added `apps/mobile/src/components/ui/confirm-dialog.tsx` with `ConfirmDialog` exactly per the spec props/shell: fade `Modal` (`transparent`, `onRequestClose={onCancel}`), dimmed `flex-1 items-center justify-center bg-black/40 p-6` overlay, `w-full max-w-xs rounded-2xl bg-background p-4` card; title, message, optional `error` as an `accessibilityRole="alert"` line; right-aligned ghost `Button` Cancel + confirm `Button` (`destructive` by default, `default` when `destructive={false}`), both `disabled={busy}` and showing `busyLabel` while busy; optional `accessibilityLabel` on the `Modal`.
- Migrated `apps/mobile/src/components/ais/delete-confirm.tsx`: `DeleteConfirmDialog` keeps its name/props and is now a thin `ConfirmDialog` wrapper (text, labels, busy behaviour unchanged).
- Migrated the `RevokeConfirmDialog` in `apps/mobile/src/components/approvals/always-allowed-row.tsx`: same shell, but now uses `ConfirmDialog` and renders no `Modal` itself. `AlwaysAllowedRow` is untouched.
- Migrated the confirm in `apps/mobile/src/app/settings/machines.tsx` to `ConfirmDialog` inline (title/message/error/labels/busy unchanged; `confirmAccessibilityLabel` "Confirm revoke"/"Confirm delete", `busyLabel="Working…"`).
- Added a "Confirm dialog" section to `apps/mobile/src/app/dev/kit.tsx` (button opens a sample with the error line).
- Added `ConfirmDialog` tests to `apps/mobile/src/components/ui/kit.test.tsx` (title+message, error alert, busy disables both and shows `busyLabel`); `kit.test.tsx` now stubs `@/components/ui/button` like the other kit-rendering tests.
- Updated the mocks in `apps/mobile/src/components/machines/machines-screen.test.tsx` (which the gate runs because `machines.tsx` changed, and which now pulls in the real kit `Button`): added `Platform` to the `react-native` mock, added `vi.mock('react-native-reanimated', …)`, and added a pass-through `TextClassContext: { Provider: 'TextClassContextProvider' }` to the existing `@/components/ui/text` mock (the real `Button` reads `TextClassContext`). Every existing assertion is unchanged.

**Files changed** (all inside Allowed files)

- `apps/mobile/src/components/ui/confirm-dialog.tsx` (new)
- `apps/mobile/src/components/ui/kit.test.tsx`
- `apps/mobile/src/app/dev/kit.tsx`
- `apps/mobile/src/components/ais/delete-confirm.tsx`
- `apps/mobile/src/components/approvals/always-allowed-row.tsx`
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/components/machines/machines-screen.test.tsx`
- `work/T-0287-mobile-kit-confirm-dialog.md`

`rows.test.tsx` needed no change: it already stubs `@/components/ui/button` and `react-native-reanimated`, so `RevokeConfirmDialog` renders through the new `ConfirmDialog`.

**Commands and results**

- `pnpm install`: finished (12s), no lockfile change.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit rows`: 2 files passed, 21 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit rows machines-screen`: **3 files passed, 27 tests passed.**
- `pnpm gate`: `gate: 8 changed file(s) against main`; summary lines: `PASS install (frozen) (0.9s)`, `PASS format (11.1s)`, `PASS lint (0.4s)`, `PASS typecheck (4.9s)`, `PASS tests @zilar/mobile (1.4s)`; `scope: every changed file is inside the Allowed files`; ends with **`GATE PASS`**.

**Blocker (resolved)**

The first `pnpm gate` was red: the migrated `machines.tsx` pulled the kit `Button` (→ `react-native-reanimated`) into `machines-screen.test.tsx`, which was not in the Allowed files, so all 6 of its tests failed at import on a missing `react-native-worklets` module. I set `status: blocked` and asked. The lead added `apps/mobile/src/components/machines/machines-screen.test.tsx` to the Allowed files and approved the stub changes.

**Deviation from the lead's instruction**

The two stubs the lead quoted (`Platform` + `react-native-reanimated`) were not sufficient: with the real `Button` rendering, the test's `@/components/ui/text` mock also needs `TextClassContext` (Button renders `TextClassContext.Provider`). I added the minimal pass-through provider, keeping the real `Button` and every existing assertion. (Alternative would have been to mock `@/components/ui/button` + `@/lib/depth` as `rows.test.tsx` does; not used.)

**Acceptance check**

- `delete-confirm.tsx` and `always-allowed-row.tsx` no longer import or render `Modal`. `machines.tsx` still imports `Modal` for the out-of-scope `AddMachineSheet`, but its confirm renders `ConfirmDialog`, not `Modal`.
- Texts and accessibility labels are unchanged (Cancel label is now the `Button`'s "Cancel" text; the machines Cancel's former explicit `accessibilityLabel="Cancel"` matched that text, so the accessible name is unchanged).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

**Open questions**

- None.

## Review (written by Claude)

**Approved.** The worker reported one honest BLOCKED: `machines-screen.test.tsx` needed stubs, so the lead allowed it. After that the pre-review was clean.

**What changed:**
- The three confirms render through the kit `ConfirmDialog`, with texts and accessibility labels kept.
- The machines confirm moves from hand-rolled pills to kit `Button`s, on purpose.

**Accepted nits, both test-only:**
- The `match(...)` busy assertion is not null-safe.
- The `TextClassContext` string stub warns about casing.

**Next:** emulator QA in the next run.
