---
id: T-0383
title: "Mobile kit: the group roles sheet's Cancel rename, Confirm delete, Cancel delete, Rename and Delete use the kit Button"
status: merged
milestone: M5
branch: task/T-0383-mobile-group-roles-remaining-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0383: last group roles sheet buttons on the kit

## Spec (written by Claude, do not edit)

### Why
T-0361 moved part of the group roles sheet to the kit. Five raw `Pressable` text buttons are left. The confirm-delete one is red with `text-accent-foreground`, the same dark-on-red contrast problem that QA run 29 found on the topic Archive button (fixed in T-0377).

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/button.tsx`:**
  - variants `default`, `destructive` (`bg-destructive`, white text, line 65), `outline`, `secondary` and `ghost`;
  - sizes `default`, `sm`, `lg` and `icon`.
  - **Labels must be inside `<Text>`.** A bare string renders a blank pill (the T-0349 bug).
  - `group-roles-sheet.tsx` already uses `Button` (Save at about line 160, Assign at line 206) and `Text`.
- **The five `Pressable`s in `apps/mobile/src/components/chat/group-roles-sheet.tsx`** (the line is the `<Pressable`). Each has `accessibilityRole="button"`, `disabled={busy}` and `className="rounded-[10px] px-3 py-1.5 …"`:

| Line | `accessibilityLabel` | onPress | Text today | Kit |
| --- | --- | --- | --- | --- |
| 169 | "Cancel rename" | `setRenamingId(undefined)` | "Cancel" | `variant="ghost" size="sm"` |
| 181 | `` `Confirm deleting ${role.name}` `` | `onDeleteRole(role.id).then(...)` | "Delete" (on `bg-danger`, `text-accent-foreground`) | `variant="destructive" size="sm"` |
| 194 | "Cancel delete" | `setConfirmingId(undefined)` | "Cancel" | `variant="ghost" size="sm"` |
| 215 | `` `Rename ${role.name}` `` | `setRenameValue(role.name); setRenamingId(role.id);` | "Rename" | `variant="ghost" size="sm"` |
| 227 | `` `Delete ${role.name}` `` | `setConfirmingId(role.id)` | "Delete" (`text-danger`) | `variant="ghost" size="sm"` with `<Text className="text-danger">Delete</Text>` |

- **Leave alone:** the `Pressable` at line 250 (the member checkbox row).
- **Tests:**
  - `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`;
  - `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`;
  - `apps/mobile/src/components/chat/group-roles-load.test.tsx`.

  These tests already render kit `Button`s (T-0361), so their mocks should cover it.

### What to build
1. Replace the five `Pressable`s with `<Button variant=… size="sm" accessibilityLabel=… disabled={busy} onPress=…><Text>…</Text></Button>`, using the table. Keep every label and handler.
2. If a test fails on the change, add mocks only. Change no assertion.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/button.tsx` and `apps/mobile/src/components/chat/group-roles-sheet.tsx:150-240`.

### Allowed files
`apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx`, `work/T-0383-mobile-group-roles-remaining-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot group-roles-sheet group-roles-mounted group-roles-load
pnpm gate
```

### Acceptance
- Only the member row `Pressable` remains in `group-roles-sheet.tsx`.
- Every new label is inside `<Text>`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Replaced the five raw `Pressable` text buttons in `group-roles-sheet.tsx` with kit `Button` (`size="sm"`), keeping every `accessibilityLabel`, label and handler:
- "Cancel rename" -> `variant="ghost"`.
- Confirm delete -> `variant="destructive"` (kit white-on-destructive, fixes the dark-on-red contrast).
- "Cancel delete" -> `variant="ghost"`.
- Rename -> `variant="ghost"`.
- Delete -> `variant="ghost"` with `<Text className="text-danger">`.
Every label is inside `<Text>`; the member checkbox row `Pressable` (line ~248) is untouched and remains the only `Pressable` in the file. No test changes needed.

Files changed:
- `apps/mobile/src/components/chat/group-roles-sheet.tsx`

Commands:
- `pnpm install`: pass (18.8s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot group-roles-sheet group-roles-mounted group-roles-load`: 3 files, 13 tests passed.
- `pnpm gate`: GATE PASS — PASS install (3.2s), PASS format (28.8s), PASS lint (1.7s), PASS typecheck (23.7s), PASS tests @zilar/mobile (10.7s); scope: every changed file is inside the Allowed files.

Security checklist: no secrets/tokens touched; no deletes/updates, permissions, caps, routes, or audit entries involved — UI-only button swap with unchanged handlers.

## Review (written by Claude)

Approved (lead, 2026-10-06). The five Pressables are kit `Button` `sm` (ghost ×4, destructive Confirm delete with white text), every label inside `<Text>`; only the member row Pressable remains. Pre-review clean (0 findings). Emulator check in the next QA run.
