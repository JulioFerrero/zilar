---
id: T-0343
title: "Mobile kit migration: every pill button on the Machines screen uses the kit Button"
status: merged
milestone: M5
branch: task/T-0343-mobile-machines-buttons-kit
model: auto
effort: low
depends_on: [T-0341]
estimate: 0.2 day
---

# T-0343: Machines screen buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The UI kit audit (`docs/audit/ui-kit-audit.md` §5, the mobile mirror) wants hand-rolled pill `Pressable`s replaced by the kit `Button`. The Machines screen has nine of them in `MachinesList`. T-0340 already moved the Add machine dialog's buttons, so this finishes the screen.

### Verified facts (do not re-derive)
- **The nine pill `Pressable`s in `apps/mobile/src/app/settings/machines.tsx`** (`MachinesList`; the line is the `accessibilityLabel`, and its `className` follows two or three lines later):

| Line | Label | Look today | Kit variant |
| --- | --- | --- | --- |
| 291 | "Retry loading machines" (with an icon) | `border border-border-strong` | `outline` |
| 309 | "Add a machine" (`Plus` icon in `ACCENT_FOREGROUND[scheme]`) | `bg-accent` | `default` |
| 333 | `Approve ${machine.name}` | `bg-accent` | `default` |
| 344 | `Deny ${machine.name}` | `border border-border-strong` | `outline` |
| 382 | "Cancel renaming" | plain, `active:bg-surface-raised` | `ghost` |
| 391 | "Save the new name" ("Saving…" while busy) | `bg-accent` | `default` |
| 412 | `Rename ${machine.name}` | `border border-border-strong` | `outline` |
| 421 | `Revoke ${machine.name}` | `border border-border-strong` | `outline` |
| 460 | `Delete ${machine.name}` | `border border-border-strong` | `outline` |

- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `default`, `destructive`, `outline`, `secondary`, `ghost`;
  - sizes include `sm`;
  - `Text` children take their colour from `TextClassContext`;
  - its base classes include `flex-row items-center gap-2`, so an icon plus text keeps its layout.
- **Already in the file:** `machines.tsx` imports `Button` (T-0340).
- **`apps/mobile/src/components/machines/machines-screen.test.tsx`:**
  - already renders through `Button` (its text mock includes `TextClassContext`);
  - asserts the empty-state Plus colour (T-0341).

### What to build
1. Replace each of the nine `Pressable`s with `<Button variant=… size="sm">`, using the variant in the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text and the busy text;
   - the icons and their colours.

   Drop the old `className` and `text-*` colour classes on the child `Text`; the kit sets those. Keep layout classes such as `mt-*` and `self-start` on the Button if the old Pressable had them.
2. Remove `Pressable` from the imports only if nothing else in the file uses it. Name any `Pressable` that remains, and why, in the Report.
3. If a test assertion depended on an old class, update it to the new structure and say so in the Report.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/app/settings/machines.tsx:280-480`, `apps/mobile/src/components/machines/machines-screen.test.tsx` and `work/T-0340-mobile-add-machine-kit.md` (the Report).

### Allowed files
`apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `work/T-0343-mobile-machines-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen
pnpm gate
```

### Acceptance
- No `rounded-full bg-accent` and no `rounded-full border border-border-strong` `Pressable` remain in `machines.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced the nine hand-rolled pill `Pressable`s in `MachinesList` (`apps/mobile/src/app/settings/machines.tsx`) with the kit `Button`, per the table:
- Retry (line 291) → `<Button variant="outline" size="sm">`, kept the `RefreshCw` icon at `ICON[scheme]`;
- Add a machine (line 309) → `variant="default"`, kept the `Plus` icon at `ACCENT_FOREGROUND[scheme]`;
- Approve (line 333) → `variant="default"`;
- Deny (line 344) → `variant="outline"`;
- Cancel renaming (line 382) → `variant="ghost"`;
- Save the new name (line 391) → `variant="default"`, kept the `Saving…` / `Save` busy text;
- Rename (line 412) → `variant="outline"`;
- Revoke (line 421) → `variant="outline"`;
- Delete (line 460) → `variant="outline"`.

For every button I kept the `accessibilityLabel`, `disabled` and `onPress`; kept the visible text and the icons/colours; dropped the old pill `className` and the child `Text` colour classes (`text-[1x]/font-medium/text-*`), which the kit's `TextClassContext` now sets. None of the nine had layout classes (`mt-*`/`self-start`), so no `className` remains on any of them. `accessibilityRole="button"` was dropped because the kit `Button` already sets `role="button"` on its `Pressable`.

**Pressable that remains:** the "Revoked (n)" section toggle at line 435 is still a `Pressable`. It is not one of the nine (no pill styling: `flex-row items-center gap-1 self-start active:opacity-70`) and the spec's table does not list it, so I left it as-is. `Pressable` therefore stays in the react-native import.

**Files changed**
- `apps/mobile/src/app/settings/machines.tsx` — the nine `Pressable`s above replaced with kit `Button`s.
- `work/T-0343-mobile-machines-buttons-kit.md` — status and this Report.

No test changes were needed: `machines-screen.test.tsx` already renders through `Button` (the text mock includes `TextClassContext`) and no assertion depended on a class I removed. All six test cases still pass unchanged.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (Done in 12s; only pre-existing peer/deprecation warnings).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen` — `Test Files 1 passed (1)`, `Tests 6 passed (6)` (only the usual React DOM casing warnings on stderr).
- `pnpm gate` (repo root) — final output:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (17.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (6.4s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec**
- None. Prettier/wrapping was already compliant, so `format` passed on the first gate run.

**Acceptance check**
- `grep -n "rounded-full\|Pressable" apps/mobile/src/app/settings/machines.tsx` → no `rounded-full` anywhere; `Pressable` only at the import (line 5) and the Revoked toggle (lines 435/444). So no `rounded-full bg-accent` and no `rounded-full border border-border-strong` `Pressable` remain.
- Tests pass; `pnpm gate` ends GATE PASS with no file outside the Allowed files.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). All nine pill `Pressable`s in `MachinesList` are now kit `Button`s (size `sm`) with the variants from the spec table. The lead grep found that all 13 Buttons in the file keep their accessibility label and handler, and no `rounded-full bg-accent` or `border-border-strong` pill remains. No test changes were needed.
