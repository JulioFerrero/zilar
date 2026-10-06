---
id: T-0343
title: "Mobile kit migration: every pill button on the Machines screen uses the kit Button"
status: todo
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

## Review (written by Claude)
