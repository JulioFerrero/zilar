---
id: T-0340
title: "Mobile kit migration: the Add machine dialog uses the kit card surface and kit Buttons"
status: merged
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

**Status:** done, ready for review.

**What I did**
1. `AddMachineSheet` card class changed from `w-full max-w-xs rounded-2xl bg-background p-4` to `w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4` (matches `ConfirmDialog`).
2. Replaced the four hand-rolled `Pressable` buttons with the kit `Button` (`@/components/ui/button`):
   - Close: `variant="ghost" size="sm"`;
   - Try again, Copy pairing code and Done: `variant="default" size="sm"`.
   All accessibility labels (`Close`, `Try again`, `Copy pairing code`, `Done`), visible text and `onPress` handlers kept. The `Text` children now take their colour from the button's `TextClassContext`, like `ConfirmDialog`.
3. The Copy/Check icons now use `ACCENT_FOREGROUND[scheme]` instead of `"#fff"`. `scheme` is read the same way as the rest of the file: `const scheme = asColorScheme(useColorScheme().colorScheme);` inside `AddMachineSheet`.
4. Imported `Button` and `ACCENT_FOREGROUND`.

**Deviations from the spec**
- Step 4 said "Drop the `Pressable` import if it becomes unused." It does **not** become unused: `Pressable` is still used 20 times elsewhere in `machines.tsx` (the list rows, the error Retry button, etc.). I therefore kept the import. The spec's own wording is conditional, so this is consistent with it.
- After the migration the file also has `Pressable` at line 289 etc. outside `AddMachineSheet`; the acceptance criterion is scoped to `AddMachineSheet`, where no `Pressable` or `#fff` remains (verified by grep on lines 549-665, no matches).
- Prettier reformatted the two `Button` lines that exceeded the print width. Only whitespace/wrapping in the same file.

**Files changed**
- `apps/mobile/src/app/settings/machines.tsx` — card surface, four kit `Button`s, `ACCENT_FOREGROUND` icons, `Button`/`ACCENT_FOREGROUND` imports, `scheme` in `AddMachineSheet`.
- `apps/mobile/src/components/machines/machines-screen.test.tsx` — mocks only: added `ACCENT_FOREGROUND: { dark, light }` to the `@/lib/colors` mock (the file now imports it).
- `work/T-0340-mobile-add-machine-kit.md` — this Report and the status change.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (Done in 11.8s; only pre-existing peer warnings).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen` — after fixing a missing import, `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
  - First run of this test failed 5/6 with `ReferenceError: Pressable is not defined` because I had dropped the still-needed import; restored it, then green.
- `pnpm gate` (repo root) — first run FAILED on `format` (`apps/mobile/src/app/settings/machines.tsx`, prettier line wrapping). Ran `pnpm exec prettier --write` on that one file, then re-ran. Final gate output:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (10.9s)
  PASS  lint  (0.8s)
  PASS  typecheck  (6.1s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Blocked / needs a decision:** none.

**Pitfalls checked**
- Ran `grep -rl "settings/machines" apps/mobile/src --include=*.test.*`: only `machines-screen.test.tsx` (already in Allowed files, mocks only). No other test loads the migrated file.
- `Button` was already reachable in this test through the existing `ConfirmDialog` import, so no new transitive mocks were needed beyond `ACCENT_FOREGROUND`.

## Review (written by Claude)

**Approved** (pre-review clean, 1 nit). The Add machine card now uses the kit surface (`border-border-strong bg-surface`). Close, Try again, Copy and Done are kit `Button`s with the same labels and handlers. The Copy and Check icons are drawn in `ACCENT_FOREGROUND[scheme]` instead of `#fff`.

The nit is a `#fff` Plus on the empty-state "Add machine" button (`machines.tsx:313`). It falls outside this spec, so it goes into the follow-up sweep of the other hard-coded `#fff` icons on mobile.
