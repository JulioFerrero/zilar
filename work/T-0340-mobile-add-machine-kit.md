---
id: T-0340
title: "Mobile kit migration: the Add machine dialog uses the kit card surface and kit Buttons"
status: todo
milestone: M5
branch: task/T-0340-mobile-add-machine-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0340: Add machine dialog on the kit

## Spec (written by Claude, do not edit)

### Why
`AddMachineSheet` in the mobile Machines screen is the last hand-rolled centred dialog in Settings. It still uses:
- the old `bg-background` card, without the contrast border that the kit `ConfirmDialog` got in T-0317;
- four hand-rolled `Pressable` buttons;
- a literal `"#fff"` icon colour on the accent Copy button. That breaks in light mode, where the accent foreground is dark.

### Verified facts (do not re-derive)
- **`apps/mobile/src/app/settings/machines.tsx`:**
  - `AddMachineSheet` starts at line 549, and its `Modal` at line 577;
  - the card is `<View className="w-full max-w-xs rounded-2xl bg-background p-4">` (line 579);
  - the buttons:
    - error state: "Close" (ghost look, `accessibilityLabel="Close"`) and "Try again" (accent, `accessibilityLabel="Try again"`);
    - code state: "Copy" / "Copied" (accent, small, `accessibilityLabel="Copy pairing code"`, with `Check` or `Copy` lucide icons at `size={14} color="#fff"`) and "Done" (accent, `accessibilityLabel="Done"`).
  - The file already imports `ConfirmDialog` (line 11), `Text` and `ACCENT, ICON` from `@/lib/colors` (line 16), and `useColorScheme` (nativewind) and `asColorScheme`.
- **`apps/mobile/src/components/ui/confirm-dialog.tsx`:**
  - the kit card is `w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4`;
  - its buttons are `<Button variant="ghost" size="sm">` and `<Button variant="default" size="sm">` from `@/components/ui/button`, with a `Text` child that takes the button's text colour from `TextClassContext`.
- **`apps/mobile/src/lib/colors.ts:37`:** `ACCENT_FOREGROUND: Record<ColorScheme, string>`.
- **`apps/mobile/src/components/machines/machines-screen.test.tsx`:**
  - mocks `@/components/ui/text` as `{ Text, TextClassContext: { Provider } }` and `@/lib/colors` as `{ ACCENT, ICON }` only;
  - asserts `'Add machine'` (line 169).
  - If you import `ACCENT_FOREGROUND`, add it to the colors mock: mocks only.

### What to build
1. Change the `AddMachineSheet` card class to the kit surface: `border border-border-strong bg-surface`, replacing `bg-background`.
2. Replace the four `Pressable` buttons with the kit `Button`:
   - Close: `variant="ghost" size="sm"`;
   - Try again, Copy and Done: `variant="default" size="sm"`.

   Keep every accessibility label, the visible text and the `onPress` handlers.
3. Draw the Copy and Check icons in `ACCENT_FOREGROUND[scheme]` instead of `"#fff"`. Get `scheme` the way the file already does elsewhere (`asColorScheme(useColorScheme().colorScheme)` or equivalent).
4. Drop the `Pressable` import if it becomes unused. Leave the rest of the file alone.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `apps/mobile/src/components/ui/confirm-dialog.tsx`, `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/app/settings/machines.tsx:540-700` and `apps/mobile/src/components/machines/machines-screen.test.tsx`.

### Allowed files
`apps/mobile/src/app/settings/machines.tsx`; mocks only: `apps/mobile/src/components/machines/machines-screen.test.tsx`; and `work/T-0340-mobile-add-machine-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen
pnpm gate
```

### Acceptance
- No `Pressable` and no `#fff` remain in `AddMachineSheet`.
- The card has `border-border-strong bg-surface`.
- The test passes, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
